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

    const frequency = (matches, predicate) => {
      const valid = matches.filter(m => m.score?.fulltime?.home != null && m.score?.fulltime?.away != null);
      if (!valid.length) return { score: null, hits: 0, sample: 0 };
      const hits = valid.filter(predicate).length;
      return { score: Math.round(100 * hits / valid.length), hits, sample: valid.length };
    };
    const totalGoals = m => m.score.fulltime.home + m.score.fulltime.away;
    const halftimeAvailable = m => m.score?.halftime?.home != null && m.score?.halftime?.away != null;

    const results = upcoming.map(f => {
      const home = forms.get(f.teams.home.id) || [];
      const away = forms.get(f.teams.away.id) || [];
      const sample = [...home, ...away];
      const goals = frequency(sample, m => totalGoals(m) >= 3);
      const btts = frequency(sample, m => m.score.fulltime.home > 0 && m.score.fulltime.away > 0);
      const htMatches = sample.filter(halftimeAvailable);
      const ht = frequency(htMatches, m => m.score.halftime.home + m.score.halftime.away >= 2);
      return {
        fixtureId: f.fixture.id,
        date: f.fixture.date,
        status: f.fixture.status.short,
        league: f.league.name,
        country: f.league.country,
        home: f.teams.home.name,
        away: f.teams.away.name,
        markets: {
          over25: { ...goals, label: 'Over 2.5 FT' },
          btts: { ...btts, label: 'GG' },
          over15ht: { ...ht, label: 'Over 1.5 HT' },
          corners: { score: null, hits: 0, sample: 0, label: 'Corner', note: 'Statistiche corner non ancora calcolate' }
        }
      };
    });
    res.json({
      date, method: 'Frequenza storica descrittiva sulle ultime 5 gare disponibili per ciascuna squadra; non è una probabilità predittiva calibrata.',
      threshold: 70, limit, fixtures: results,
      note: 'Un punteggio è mostrato solo quando esistono risultati reali utilizzabili. Il campione può essere inferiore a 10 se mancano dati.'
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CONF Football', version: '0.2.0' }));

app.listen(port, () => console.log(`CONF Football attivo su http://localhost:${port}`));
