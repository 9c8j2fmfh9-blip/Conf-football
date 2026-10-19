import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENFOOT_API_KEY;
const base = 'https://openfootapi.com/v1';
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

app.use(express.static('.'));

async function openFoot(path, params = {}) {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.data;

  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let response = await fetch(url, { headers });
  let body = await response.json().catch(() => ({}));

  // If the configured key is rejected (401), retry with the documented public preview.
  // The response metadata makes the reduced demo scope visible; never pretend this is full access.
  if (!response.ok && response.status === 401) {
    const demoHeaders = { Accept: 'application/json', Authorization: 'Bearer of_demo_openfootapi_docs' };
    response = await fetch(url, { headers: demoHeaders });
    body = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const detail = body?.error?.message || body?.error?.code || `HTTP ${response.status}`;
    const err = new Error(`OpenFootAPI: ${detail}`);
    err.status = response.status;
    throw err;
  }
  cache.set(cacheKey, { time: Date.now(), data: body });
  return body;
}

function rows(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.matches)) return body.data.matches;
  if (Array.isArray(body?.matches)) return body.matches;
  return [];
}
function statusCode(status) {
  const s = String(status || '').toLowerCase();
  if (['live', 'in_play', 'in-play'].includes(s)) return 'LIVE';
  if (['finished', 'complete', 'completed', 'ft'].includes(s)) return 'FT';
  if (['postponed'].includes(s)) return 'PST';
  if (['cancelled', 'canceled'].includes(s)) return 'CANC';
  return 'NS';
}
function goals(m) {
  const s = m?.score || {};
  const home = s.fullTime?.home ?? s.fulltime?.home ?? s.home ?? m.homeScore ?? m.scoreHome ?? null;
  const away = s.fullTime?.away ?? s.fulltime?.away ?? s.away ?? m.awayScore ?? m.scoreAway ?? null;
  return { home: numberOrNull(home), away: numberOrNull(away) };
}
function halfGoals(m) {
  const s = m?.score || {};
  const h = s.halfTime || s.halftime || s.half_time || s.ht ||
    m.halfTimeScore || m.halftimeScore || m.halfTime || m.halftime || {};
  const home = h.home ?? h.homeGoals ?? h.homeScore ?? s.halfTimeHome ??
    s.halftimeHome ?? s.htHome ?? m.halfTimeHome ?? m.halftimeHome ??
    m.homeHalfTimeScore ?? null;
  const away = h.away ?? h.awayGoals ?? h.awayScore ?? s.halfTimeAway ??
    s.halftimeAway ?? s.htAway ?? m.halfTimeAway ?? m.halftimeAway ??
    m.awayHalfTimeScore ?? null;
  return { home: numberOrNull(home), away: numberOrNull(away) };
}
function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function teamId(team) {
  return team?.id ?? team?.teamId ?? null;
}
function teamName(team) {
  return team?.name ?? team?.shortName ?? 'Squadra';
}
function toLegacy(m) {
  const score = goals(m);
  const kickoff = m.kickoffAt ?? m.date ?? m.utcDate ?? null;
  const home = m.homeTeam || m.home || {};
  const away = m.awayTeam || m.away || {};
  const status = statusCode(m.status);
  const ht = halfGoals(m);
  return {
    fixture: {
      id: m.id,
      date: kickoff,
      status: { short: status, long: m.status || status, elapsed: m.minute ?? null }
    },
    league: { id: m.competitionId ?? m.competition?.id ?? null, name: m.competitionName ?? m.competition?.name ?? 'Campionato', country: m.country ?? m.competition?.country ?? '' },
    teams: { home: { id: teamId(home), name: teamName(home) }, away: { id: teamId(away), name: teamName(away) } },
    goals: { home: score.home, away: score.away },
    score: { fulltime: { home: score.home, away: score.away }, halftime: { home: ht.home, away: ht.away } }
  };
}
function completed(m) {
  return statusCode(m.status) === 'FT' && goals(m).home !== null && goals(m).away !== null;
}
function frequency(matches, predicate, label) {
  const valid = matches.filter(completed);
  const hits = valid.filter(predicate).length;
  return { score: valid.length ? Math.round(100 * hits / valid.length) : null, hits, sample: valid.length, label };
}
function teamPerspective(matches, id) {
  const valid = matches.filter(completed);
  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
  for (const m of valid) {
    const h = m.homeTeam || m.home || {};
    const isHome = String(teamId(h)) === String(id);
    const s = goals(m);
    const gf = isHome ? s.home : s.away;
    const ga = isHome ? s.away : s.home;
    goalsFor += gf; goalsAgainst += ga;
    if (gf > ga) wins++; else if (gf === ga) draws++; else losses++;
  }
  return { sample: valid.length, wins, draws, losses, goalsFor, goalsAgainst,
    averageFor: valid.length ? Number((goalsFor / valid.length).toFixed(2)) : null,
    averageAgainst: valid.length ? Number((goalsAgainst / valid.length).toFixed(2)) : null };
}

app.get('/api/status', (_req, res) => {
  res.json({ configured: Boolean(apiKey), provider: 'OpenFootAPI', cacheMinutes: CACHE_TTL_MS / 60000 });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CONF Football', version: '0.3.0', provider: 'OpenFootAPI' }));

app.get('/api/key-check', async (_req, res) => {
  const url = new URL(base + '/matches');
  url.searchParams.set('date', new Date().toISOString().slice(0, 10));
  const check = async headers => {
    const response = await fetch(url, { headers });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, message: body?.error?.message || body?.error?.code || (response.ok ? 'OK' : `HTTP ${response.status}`), meta: body.meta || null, returned: rows(body).length };
  };
  try {
    const personal = apiKey
      ? await check({ Accept: 'application/json', Authorization: `Bearer ${apiKey}` })
      : { ok: false, status: null, message: 'OPENFOOT_API_KEY non configurata.' };
    const preview = await check({ Accept: 'application/json', Authorization: 'Bearer of_demo_openfootapi_docs' });
    res.json({
      configured: Boolean(apiKey),
      personalKey: { ok: personal.ok, httpStatus: personal.status, message: personal.message },
      publicPreview: { ok: preview.ok, httpStatus: preview.status, message: preview.message, returned: preview.returned, access: preview.meta?.access || null, scope: preview.meta?.scope || null },
      appCanUsePreview: preview.ok,
      note: personal.ok ? 'La chiave personale funziona.' : preview.ok ? 'La chiave personale è rifiutata, ma l’anteprima pubblica funziona; l’app può continuare con dati limitati.' : 'Anche l’anteprima pubblica non è disponibile.'
    });
  } catch (e) {
    res.status(200).json({ configured: Boolean(apiKey), appCanUsePreview: false, message: e.message });
  }
});

app.get('/api/leagues', async (_req, res) => {
  try {
    const body = await openFoot('/competitions');
    const data = rows(body);
    res.json({ results: data.length, response: data, provider: 'OpenFootAPI' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/fixtures', async (req, res) => {
  const date = String(req.query.date || '');
  const { league, season, status } = req.query;
  if (!date && !league) return res.status(400).json({ error: 'Indica almeno date (YYYY-MM-DD) oppure league.' });
  try {
    const params = { date, competition: league, season, status };
    const body = await openFoot('/matches', params);
    const response = rows(body).map(toLegacy);
    res.json({ results: response.length, response, provider: 'OpenFootAPI', meta: body.meta || null });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/fixture-statistics', (_req, res) => {
  res.json({ response: [], provider: 'OpenFootAPI', note: 'Statistiche corner non disponibili nel piano Starter; non vengono stimate.' });
});
app.get('/api/odds', (_req, res) => {
  res.status(403).json({ error: 'Le quote/benchmark odds richiedono un piano OpenFootAPI che includa questo endpoint.' });
});

app.get('/api/debug-fixtures', async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  try {
    const body = await openFoot('/matches', { date });
    const matches = rows(body);
    res.json({
      date,
      returned: matches.length,
      meta: body.meta || null,
      samples: matches.slice(0, 10).map(m => ({
        id: m.id,
        status: m.status ?? null,
        kickoffAt: m.kickoffAt ?? m.date ?? m.utcDate ?? null,
        home: (m.homeTeam || m.home || {}).name ?? null,
        away: (m.awayTeam || m.away || {}).name ?? null
      }))
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/conf', async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit || '12', 10) || 12));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Data non valida: usa YYYY-MM-DD.' });

  try {
    // Starter/demo plans may expose only a limited preview and prohibit cursor pagination.
    // Use the first permitted page without a cursor; never treat the preview as exhaustive.
    const fixtureBody = await openFoot('/matches', { date });
    const allDayMatches = rows(fixtureBody);

    const isScheduled = m => ['scheduled', 'unknown', 'upcoming', 'not_started', 'not-started', 'ns', 'fixture'].includes(String(m.status || '').toLowerCase());
    const upcoming = allDayMatches
      .filter(m => isScheduled(m) && new Date(m.kickoffAt || m.date || m.utcDate || 0).getTime() > Date.now())
      .sort((a, b) => new Date(a.kickoffAt || a.date || a.utcDate || 0) - new Date(b.kickoffAt || b.date || b.utcDate || 0))
      .slice(0, limit);
    const teamIds = [...new Set(upcoming.flatMap(m => [teamId(m.homeTeam || m.home), teamId(m.awayTeam || m.away)]).filter(Boolean))];
    const forms = new Map();
    const warnings = [];
    let teamCursor = 0;
    const worker = async () => {
      while (teamCursor < teamIds.length) {
        const id = teamIds[teamCursor++];
        try {
          const body = await openFoot('/matches', { team: id, status: 'finished' });
          const recent = rows(body).filter(completed)
            .sort((a, b) => new Date(b.kickoffAt || b.date || b.utcDate || 0) - new Date(a.kickoffAt || a.date || a.utcDate || 0))
            .slice(0, 5);
          forms.set(String(id), recent);
        } catch (e) {
          forms.set(String(id), []);
          warnings.push(`Forma non disponibile per squadra ${id}: ${e.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, teamIds.length) }, worker));

    const fixtures = upcoming.map(m => {
      const homeTeam = m.homeTeam || m.home || {};
      const awayTeam = m.awayTeam || m.away || {};
      const homeId = teamId(homeTeam);
      const awayId = teamId(awayTeam);
      const homeAll = forms.get(String(homeId)) || [];
      const awayAll = forms.get(String(awayId)) || [];
      const combined = [...homeAll, ...awayAll];
      const valid = combined.filter(completed);
      const over25 = frequency(valid, x => { const s = goals(x); return s.home + s.away >= 3; }, 'Over 2.5 FT');
      const btts = frequency(valid, x => { const s = goals(x); return s.home > 0 && s.away > 0; }, 'GG');
      // 1X2 is a transparent descriptive indicator based on recent form, not a calibrated forecast.
      const resultRate = (matches, id, outcome) => {
        const sample = matches.filter(completed);
        let hits = 0;
        for (const x of sample) {
          const h = x.homeTeam || x.home || {};
          const isHome = String(teamId(h)) === String(id);
          const s = goals(x);
          const gf = isHome ? s.home : s.away;
          const ga = isHome ? s.away : s.home;
          if ((outcome === 'W' && gf > ga) || (outcome === 'D' && gf === ga) || (outcome === 'L' && gf < ga)) hits++;
        }
        return { hits, sample: sample.length, rate: sample.length ? hits / sample.length : null };
      };
      const hW = resultRate(homeAll, homeId, 'W');
      const hD = resultRate(homeAll, homeId, 'D');
      const hL = resultRate(homeAll, homeId, 'L');
      const aW = resultRate(awayAll, awayId, 'W');
      const aD = resultRate(awayAll, awayId, 'D');
      const aL = resultRate(awayAll, awayId, 'L');
      const rateMarket = (label, a, b) => {
        const sample = (a.sample || 0) + (b.sample || 0);
        const score = a.rate === null || b.rate === null ? null : Math.round(100 * (a.rate + b.rate) / 2);
        return { label, score, hits: score === null ? 0 : Math.round(score * sample / 100), sample };
      };
      const one = rateMarket('1 · vittoria casa (forma)', hW, aL);
      const draw = rateMarket('X · pareggio (forma)', hD, aD);
      const two = rateMarket('2 · vittoria trasferta (forma)', hL, aW);
      const htValid = combined.filter(x => {
        const ht = halfGoals(x);
        return ht.home !== null && ht.away !== null;
      });
      const over15ht = frequency(htValid, x => { const ht = halfGoals(x); return ht.home + ht.away >= 2; }, 'Over 1.5 HT');
      const htCorner = { score: null, hits: 0, sample: 0, label: 'Corner 1° tempo non disponibili nel piano Starter' };
      const noCorners = { score: null, hits: 0, sample: 0, label: 'Corner FT non disponibili nel piano Starter' };
      const kickoff = m.kickoffAt || m.date || m.utcDate || null;
      const league = m.competitionName || m.competition?.name || m.competitionId || 'Campionato';
      const country = m.country || m.competition?.country || '';
      return {
        fixtureId: m.id, date: kickoff, status: statusCode(m.status), league, country,
        home: teamName(homeTeam), away: teamName(awayTeam),
        form: {
          home: { recentOverall: teamPerspective(homeAll, homeId), selected: teamPerspective(homeAll, homeId), selectedVenue: 'ultime gare disponibili', selectedSample: homeAll.length },
          away: { recentOverall: teamPerspective(awayAll, awayId), selected: teamPerspective(awayAll, awayId), selectedVenue: 'ultime gare disponibili', selectedSample: awayAll.length }
        },
        markets: {
          one, draw, two, over25, btts, over15ht,
          corners: noCorners,
          homeCorners: { ...noCorners, label: 'Corner casa non disponibili nel piano Starter' },
          awayCorners: { ...noCorners, label: 'Corner trasferta non disponibili nel piano Starter' },
          firstHalfCorners: htCorner,
          homeFirstHalfCorners: { ...htCorner, label: 'Corner casa 1° tempo non disponibili nel piano Starter' },
          awayFirstHalfCorners: { ...htCorner, label: 'Corner trasferta 1° tempo non disponibili nel piano Starter' }
        }
      };
    });
    res.json({
      date, warnings,
      method: 'Frequenze descrittive calcolate sulle ultime 5 partite concluse restituite da OpenFootAPI per ciascuna squadra. Campione e mercati sono mostrati solo quando i risultati sono presenti; non sono probabilità predittive calibrate.',
      threshold: 70, limit, fixtures,
      preview: { returned: allDayMatches.length, totalAvailable: fixtureBody?.meta?.total_count ?? null, partial: Boolean(fixtureBody?.meta?.scope?.partial) || allDayMatches.length < Number(fixtureBody?.meta?.total_count ?? allDayMatches.length), paginationAvailable: false },
      note: 'Il piano demo può restituire solo un’anteprima e non consente la paginazione. Corner e quote non vengono inventati: sono indicati come non disponibili nel piano Starter.'
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.listen(port, () => console.log(`CONF Football attivo su http://localhost:${port}`));
