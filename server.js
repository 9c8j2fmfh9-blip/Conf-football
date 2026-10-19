import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.API_FOOTBALL_KEY;
const base = 'https://v3.football.api-sports.io';
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

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
    let cursor = 0;
    const worker = async () => {
      while (cursor < teamIds.length) {
        const id = teamIds[cursor++];
        try {
          const data = await apiFootball('/fixtures', { team: id, last: 5, timezone: 'Europe/Rome' });
          forms.set(id, (data.response || []).filter(x =>
            x.fixture?.status?.short === 'FT' || x.fixture?.status?.short === 'AET' || x.fixture?.status?.short === 'PEN'
          ));
        } catch {
          forms.set(id, []);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, teamIds.length) }, worker));

    // Corner data are available per historical fixture. Limit to the 3 latest
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
      for (const m of [...home.slice(0, 3), ...away.slice(0, 3)]) {
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
          const rows = (data.response || []).map(team => {
            const stat = (team.statistics || []).find(s => String(s.type).toLowerCase() === 'corner kicks');
            const value = stat?.value;
            return value === null || value === undefined ? null : Number(value);
          });
          if (rows.length >= 2 && rows.every(n => Number.isFinite(n))) {
            cornerMatches.set(fixtureId, { totalCorners: rows[0] + rows[1] });
          }
        } catch {
          // Missing corner coverage is kept as missing data, never estimated.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cornerIds.length) }, cornerWorker));

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
          corners: cornerMarket
        }
      };
    });
    res.json({
      date, method: 'Frequenza storica descrittiva sulle ultime 5 gare disponibili: usa le gare in casa per la squadra di casa e in trasferta per quella ospite quando sono disponibili almeno 3; altrimenti ripiega sulla forma generale. Include W/P/V, media gol fatti/subiti e Over 8.5 corner FT calcolato sulle ultime 3 gare selezionate per squadra quando il provider fornisce i dati. Non è una probabilità predittiva calibrata.',
      threshold: 70, limit, fixtures: results,
      note: 'Un punteggio è mostrato solo quando esistono risultati reali utilizzabili. Il campione può essere inferiore a 10 se mancano dati.'
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CONF Football', version: '0.2.0' }));

app.listen(port, () => console.log(`CONF Football attivo su http://localhost:${port}`));
