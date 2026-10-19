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
    res.json({ results: data.results, paging: data.paging, errors: data.errors, parameters: data.parameters });
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

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CONF Football', version: '0.2.0' }));

app.listen(port, () => console.log(`CONF Football attivo su http://localhost:${port}`));
