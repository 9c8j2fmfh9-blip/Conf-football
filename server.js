import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.API_FOOTBALL_KEY;
const base = 'https://v3.football.api-sports.io';
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // Cache API responses for 1 hour to conserve the daily quota.

app.use(express.static('.'));

async function apiFootball(path, params = {}) {
  if (!apiKey || apiKey.includes('INSERISCI_LA_TUA_CHIAVE')) {
    const err = new Error('API key non configurata. Copia .env.example in .env e inserisci la chiave API-Football.');
    err.status = 503;
    throw err;
  }
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data;
  const response = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(`API-Football ha risposto con HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (body.errors && Object.keys(body.errors).length) {
    const err = new Error('Errore API-Football: ' + JSON.stringify(body.errors));
    err.status = 502;
    throw err;
  }
  cache.set(cacheKey, { time: Date.now(), data: body });
  return body;
}

app.get('/api/status', (_req, res) => {
  res.json({ configured: Boolean(apiKey && !apiKey.includes('INSERISCI_LA_TUA_CHIAVE')), provider: 'API-Football', cacheMinutes: CACHE_TTL_MS / 60000 });
});

app.get('/api/leagues', async (_req, res) => {
  try {
    const data = await apiFootball('/leagues', { current: 'true' });
    res.json({ results: data.results, paging: data.paging, errors: data.errors });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/fixtures', async (req, res) => {
  const { date, league, season, status } = req.query;
  if (!date && !league) return res.status(400).json({ error: 'Indica almeno date (YYYY-MM-DD) oppure league (ID campionato).' });
  try {
    const data = await apiFootball('/fixtures', { date, league, season, status, timezone: 'Europe/Rome' });
    res.json(data);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/fixture-statistics', async (req, res) => {
  const { fixture, team } = req.query;
  if (!fixture) return res.status(400).json({ error: 'Parametro fixture obbligatorio.' });
  try {
    const data = await apiFootball('/fixtures/statistics', { fixture, team });
    res.json({ response: data.response, errors: data.errors });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/odds', async (req, res) => {
  const { fixture, league, season, date } = req.query;
  if (!fixture && !league && !date) return res.status(400).json({ error: 'Indica fixture, league o date.' });
  try {
    const data = await apiFootball('/odds', { fixture, league, season, date });
    res.json({ results: data.results, paging: data.paging, errors: data.errors });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});


app.get('/api/conf', async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit || '12', 10) || 12));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Data non valida: usa YYYY-MM-DD.' });

  try {
    const fixturesData = await apiFootball('/fixtures', { date, timezone: 'Europe/Rome' });
    const upcoming = (fixturesData.response || [])
      .filter(f => f.fixture?.status?.short === 'NS')
      .slice(0, limit);

    const teamIds = [...new Set(upcoming.flatMap(f => [f.teams?.home?.id, f.teams?.away?.id]).filter(Boolean))];
    const forms = new Map();
    const formErrors = new Set();
    let cursor = 0;
    const worker = async () => {
      while (cursor < teamIds.length) {
        const id = teamIds[cursor++];
        let found = false;
        // Il piano Free consente le stagioni 2022-2024, non quella corrente 2026.
        // Proviamo le stagioni accessibili più recenti, senza spacciare dati vecchi per forma attuale.
        for (const season of [2024, 2023, 2022]) {
          try {
            const from = `${season}-01-01`;
            const to = `${season + 1}-12-31`;
            const data = await apiFootball('/fixtures', { team: id, season, from, to, timezone: 'Europe/Rome' });
            const completed = (data.response || []).filter(x =>
              ['FT', 'AET', 'PEN'].includes(x.fixture?.status?.short)
            ).sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date)).slice(0, 5);
            if (completed.length) {
              forms.set(id, completed);
              found = true;
              break;
            }
          } catch (e) {
            const message = e.message || '';
            if (!message.includes('Free plans do not have access to this season')) {
              formErrors.add(message || 'Errore nel recupero delle partite storiche');
            }
          }
        }
        if (!found) forms.set(id, []);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, teamIds.length) }, worker));

    // Corner data are available per historical fixture. Limit to the 2 latest
    // relevant matches per team to control provider requests; cached responses are reused.
    const cornerMatches = new Map();
    const cornerFixtureIds = new Set();
    for (const f of upcoming) {
      const homeAll = forms.get(f.teams.home.id) || [];
      const awayAll = forms.get(f.teams.away.id) || [];
      const homeVenue = homeAll.filter(m => m.teams?.home?.id === f.teams.home.id);
      const awayVenue = awayAll.filter(m => m.teams?.away?.id === f.teams.away.id);
      const home = homeVenue.length >= 3 ? homeVenue : homeAll;
      const away = awayVenue.length >= 3 ? awayVenue : awayAll;
      for (const m of [...home.slice(0, 2), ...away.slice(0, 2)]) {
        if (m.fixture?.id) cornerFixtureIds.add(m.fixture.id);
      }
    }
    const cornerIds = [...cornerFixtureIds];
    let cornerCursor = 0;
    const cornerWorker = async () => {
      while (cornerCursor < cornerIds.length) {
        const fixtureId = cornerIds[cornerCursor++];
        try {
          const data = await apiFootball('/fixtures/statistics', { fixture: fixtureId });
          const teamCorners = {};
          for (const team of data.response || []) {
            const stat = (team.statistics || []).find(s => String(s.type).toLowerCase() === 'corner kicks');
            const value = stat?.value;
            if (team.team?.id && value !== null && value !== undefined && Number.isFinite(Number(value))) {
              teamCorners[team.team.id] = Number(value);
            }
          }
          const rows = Object.values(teamCorners);
          if (rows.length >= 2) {
            cornerMatches.set(fixtureId, { totalCorners: rows[0] + rows[1], teamCorners });
          }
        } catch {
          // Missing corner coverage is kept as missing data, never estimated.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cornerIds.length) }, cornerWorker));

    // First-half event requests are the most expensive part of the analysis.
    // Limit them to at most 12 historical fixtures per run to protect the API quota.
    const eventIds = cornerIds.slice(0, 12);
    let eventCursor = 0;
    const eventWorker = async () => {
      while (eventCursor < eventIds.length) {
        const fixtureId = eventIds[eventCursor++];
        try {
          const data = await apiFootball('/fixtures/events', { fixture: fixtureId });
          const allEvents = data.response || [];
          const events = allEvents.filter(e =>
            String(e.type || '').toLowerCase() === 'corner' &&
            Number(e.time?.elapsed) <= 45
          );
          // Some API-Football plans/endpoints do not expose corner events.
          // An empty corner-event list is missing coverage, not zero corners.
          if (!events.length) continue;
          const counts = {};
          for (const event of events) {
            const teamId = event.team?.id;
            if (teamId) counts[teamId] = (counts[teamId] || 0) + 1;
          }
          const current = cornerMatches.get(fixtureId) || { totalCorners: null, teamCorners: {} };
          cornerMatches.set(fixtureId, { ...current, firstHalfTeamCorners: counts,
            firstHalfTotalCorners: Object.values(counts).reduce((sum, n) => sum + n, 0) });
        } catch {
          // No event coverage: leave first-half corner data unavailable.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cornerIds.length) }, eventWorker));

    const frequency = (matches, predicate) => {
      const valid = matches.filter(m => m.score?.fulltime?.home != null && m.score?.fulltime?.away != null);
      if (!valid.length) return { score: null, hits: 0, sample: 0 };
      const hits = valid.filter(predicate).length;
      return { score: Math.round(100 * hits / valid.length), hits, sample: valid.length };
    };
    const totalGoals = m => m.score.fulltime.home + m.score.fulltime.away;
    const halftimeAvailable = m => m.score?.halftime?.home != null && m.score?.halftime?.away != null;

    const teamPerspective = (matches, teamId) => {
      const valid = matches.filter(m => m.score?.fulltime?.home != null && m.score?.fulltime?.away != null);
      let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
      for (const m of valid) {
        const isHome = m.teams?.home?.id === teamId;
        const gf = isHome ? m.score.fulltime.home : m.score.fulltime.away;
        const ga = isHome ? m.score.fulltime.away : m.score.fulltime.home;
        goalsFor += gf; goalsAgainst += ga;
        if (gf > ga) wins++; else if (gf === ga) draws++; else losses++;
      }
      return { sample: valid.length, wins, draws, losses, goalsFor, goalsAgainst,
        averageFor: valid.length ? Number((goalsFor / valid.length).toFixed(2)) : null,
        averageAgainst: valid.length ? Number((goalsAgainst / valid.length).toFixed(2)) : null };
    };

    const results = upcoming.map(f => {
      const homeAll = forms.get(f.teams.home.id) || [];
      const awayAll = forms.get(f.teams.away.id) || [];
      const homeVenue = homeAll.filter(m => m.teams?.home?.id === f.teams.home.id);
      const awayVenue = awayAll.filter(m => m.teams?.away?.id === f.teams.away.id);
      // Use venue-specific form when there are at least 3 matches; otherwise fall back to overall recent form.
      const home = homeVenue.length >= 3 ? homeVenue : homeAll;
      const away = awayVenue.length >= 3 ? awayVenue : awayAll;
      const sample = [...home, ...away];
      const goals = frequency(sample, m => totalGoals(m) >= 3);
      const btts = frequency(sample, m => m.score.fulltime.home > 0 && m.score.fulltime.away > 0);
      const htMatches = sample.filter(halftimeAvailable);
      const ht = frequency(htMatches, m => m.score.halftime.home + m.score.halftime.away >= 2);
      const cornerSample = [...home.slice(0, 3), ...away.slice(0, 3)]
        .map(m => cornerMatches.get(m.fixture?.id))
        .filter(m => m && Number.isFinite(m.totalCorners));
      const cornerHits = cornerSample.filter(m => m.totalCorners >= 9).length;
      const cornerMarket = {
        score: cornerSample.length ? Math.round(100 * cornerHits / cornerSample.length) : null,
        hits: cornerHits,
        sample: cornerSample.length,
        label: 'Over 8.5 corner FT',
        average: cornerSample.length ? Number((cornerSample.reduce((sum, m) => sum + m.totalCorners, 0) / cornerSample.length).toFixed(2)) : null
      };
      const teamCornerFrequency = (matches, teamId) => {
        const values = matches.map(m => {
          const stats = cornerMatches.get(m.fixture?.id);
          return stats?.teamCorners?.[teamId] ?? null;
        }).filter(n => Number.isFinite(n));
        const hits = values.filter(n => n >= 4).length;
        return {
          score: values.length ? Math.round(100 * hits / values.length) : null,
          hits, sample: values.length,
          average: values.length ? Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(2)) : null
        };
      };
      const homeCornerMarket = { ...teamCornerFrequency(home, f.teams.home.id), label: 'Corner casa Over 3.5' };
      const awayCornerMarket = { ...teamCornerFrequency(away, f.teams.away.id), label: 'Corner trasferta Over 3.5' };
      const firstHalfCornerSample = [...home.slice(0, 2), ...away.slice(0, 2)]
        .map(m => cornerMatches.get(m.fixture?.id))
        .filter(m => Number.isFinite(m?.firstHalfTotalCorners));
      const firstHalfCornerHits = firstHalfCornerSample.filter(m => m.firstHalfTotalCorners >= 5).length;
      const firstHalfCornersMarket = {
        score: firstHalfCornerSample.length ? Math.round(100 * firstHalfCornerHits / firstHalfCornerSample.length) : null,
        hits: firstHalfCornerHits, sample: firstHalfCornerSample.length,
        label: 'Over 4.5 corner 1° tempo',
        average: firstHalfCornerSample.length ? Number((firstHalfCornerSample.reduce((sum, m) => sum + m.firstHalfTotalCorners, 0) / firstHalfCornerSample.length).toFixed(2)) : null
      };
      const firstHalfTeamCornerFrequency = (matches, teamId) => {
        const values = matches.slice(0, 2).map(m => cornerMatches.get(m.fixture?.id)?.firstHalfTeamCorners?.[teamId] ?? null)
          .filter(n => Number.isFinite(n));
        const hits = values.filter(n => n >= 2).length;
        return { score: values.length ? Math.round(100 * hits / values.length) : null, hits, sample: values.length,
          average: values.length ? Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(2)) : null };
      };
      const homeFirstHalfCorners = { ...firstHalfTeamCornerFrequency(home, f.teams.home.id), label: 'Corner casa Over 1.5 1° tempo' };
      const awayFirstHalfCorners = { ...firstHalfTeamCornerFrequency(away, f.teams.away.id), label: 'Corner trasferta Over 1.5 1° tempo' };
      return {
        fixtureId: f.fixture.id,
        date: f.fixture.date,
        status: f.fixture.status.short,
        league: f.league.name,
        country: f.league.country,
        home: f.teams.home.name,
        away: f.teams.away.name,
        form: {
          home: { recentOverall: teamPerspective(homeAll, f.teams.home.id), selected: teamPerspective(home, f.teams.home.id), selectedVenue: homeVenue.length >= 3 ? 'ultime gare in casa' : 'forma generale', selectedSample: home.length },
          away: { recentOverall: teamPerspective(awayAll, f.teams.away.id), selected: teamPerspective(away, f.teams.away.id), selectedVenue: awayVenue.length >= 3 ? 'ultime gare in trasferta' : 'forma generale', selectedSample: away.length }
        },
        markets: {
          over25: { ...goals, label: 'Over 2.5 FT' },
          btts: { ...btts, label: 'GG' },
          over15ht: { ...ht, label: 'Over 1.5 HT' },
          corners: cornerMarket,
          homeCorners: homeCornerMarket,
          awayCorners: awayCornerMarket,
          firstHalfCorners: firstHalfCornersMarket,
          homeFirstHalfCorners,
          awayFirstHalfCorners
        }
      };
    });
    res.json({
      date, warnings: [...formErrors], method: 'Frequenza descrittiva sulle ultime 5 gare concluse reperibili nelle stagioni 2022-2024, perché il piano Free non consente l\'accesso alla stagione corrente. I dati sono storici e non rappresentano la forma attuale; usa casa/trasferta quando ci sono almeno 3 gare, altrimenti la forma generale. Include W/P/V, media gol e corner quando disponibili. Le chiamate agli eventi per i corner del primo tempo sono limitate a 12 gare per esecuzione. Non è una probabilità predittiva calibrata.',
      threshold: 70, limit, fixtures: results,
      note: 'Un punteggio è mostrato solo quando esistono risultati reali utilizzabili. Il campione può essere inferiore a 10 se mancano dati.'
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CONF Football', version: '0.2.0' }));

app.listen(port, () => console.log(`CONF Football attivo su http://localhost:${port}`));
