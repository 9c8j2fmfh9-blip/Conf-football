import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENFOOT_API_KEY;
const base = 'https://openfootapi.com/v1';
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // Cache breve: evita stati LIVE obsoleti nelle partite in corso.

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
  const candidates = [
    body?.response,
    body?.data,
    body?.data?.matches,
    body?.data?.results,
    body?.data?.entities,
    body?.data?.items,
    body?.data?.teams,
    body?.data?.competitions,
    body?.data?.results?.matches,
    body?.data?.results?.entities,
    body?.data?.results?.items,
    body?.data?.results?.teams,
    body?.data?.results?.competitions,
    body?.results,
    body?.results?.matches,
    body?.results?.entities,
    body?.results?.items,
    body?.results?.teams,
    body?.results?.competitions,
    body?.matches,
    body?.fixtures,
    body?.competitions,
    body?.teams,
    body?.entities,
    body?.items
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
function statusCode(status) {
  // OpenFootAPI può restituire lo stato come testo oppure come oggetto.
  const raw = status && typeof status === 'object'
    ? (status.short ?? status.code ?? status.name ?? status.long ?? status.status ?? '')
    : status;
  const s = String(raw || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  if (['live', 'in_play', '1h', 'ht', '2h', 'et', 'bt', 'p', 'in_progress', 'inprogress'].includes(s)) return 'LIVE';
  if (['finished', 'finish', 'complete', 'completed', 'ft', 'aet', 'pen', 'after_extra_time', 'after_penalties', 'awarded', 'awd', 'wo'].includes(s)) return 'FT';
  if (['postponed', 'pst', 'suspended'].includes(s)) return 'PST';
  if (['cancelled', 'canceled', 'cancelled_match', 'canc'].includes(s)) return 'CANC';
  return 'NS';
}
function goals(m) {
  const s = m?.score || {};
  const home = s.fullTime?.home ?? s.fulltime?.home ?? s.home ?? m.goals?.home ?? m.homeScore ?? m.scoreHome ?? null;
  const away = s.fullTime?.away ?? s.fulltime?.away ?? s.away ?? m.goals?.away ?? m.awayScore ?? m.scoreAway ?? null;
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
  const kickoff = m.kickoffAt ?? m.date ?? m.utcDate ?? m.fixture?.date ?? null;
  const home = m.homeTeam || m.home || m.teams?.home || {};
  const away = m.awayTeam || m.away || m.teams?.away || {};
  const rawStatus = m.status ?? m.fixture?.status;
  const status = statusCode(rawStatus);
  const ht = halfGoals(m);
  return {
    fixture: {
      id: m.id ?? m.fixture?.id,
      date: kickoff,
      status: { short: status, long: (typeof rawStatus === 'object' ? rawStatus.long ?? rawStatus.name : rawStatus) || status, elapsed: m.minute ?? m.elapsed ?? (typeof rawStatus === 'object' ? rawStatus.elapsed : null) ?? null }
    },
    league: { id: m.competitionId ?? m.competition?.id ?? m.league?.id ?? null, name: m.competitionName ?? m.competition?.name ?? m.league?.name ?? 'Campionato', country: m.country ?? m.competition?.country ?? m.league?.country ?? '' },
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

app.get('/api/debug-search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const date = String(req.query.date || '').match(/^\\d{4}-\\d{2}-\\d{2}$/) ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  const norm = value => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, ' ').trim();
  const terms = norm(query).split(/\\s+/).filter(Boolean);
  const summarize = m => ({
    id: m?.id ?? m?.fixture?.id ?? null,
    keys: m && typeof m === 'object' ? Object.keys(m).slice(0, 30) : [],
    kickoff: m?.kickoffAt ?? m?.date ?? m?.utcDate ?? m?.fixture?.date ?? null,
    status: m?.status ?? m?.fixture?.status ?? null,
    home: m?.homeTeam?.name ?? m?.home?.name ?? m?.teams?.home?.name ?? null,
    away: m?.awayTeam?.name ?? m?.away?.name ?? m?.teams?.away?.name ?? null,
    competition: m?.competition?.name ?? m?.competitionName ?? m?.league?.name ?? null,
    competitionId: m?.competitionId ?? m?.competition?.id ?? m?.league?.id ?? null
  });
  try {
    const [matchResult, competitionResult, searchResult] = await Promise.all([
      openFoot('/matches', { date }).then(body => ({ count: rows(body).length, sample: rows(body).slice(0, 3).map(summarize) })).catch(e => ({ error: e.message, status: e.status || null })),
      openFoot('/competitions').then(body => {
        const all = rows(body);
        const matches = all.filter(c => terms.every(t => norm(c.name || c.competitionName || c.competition?.name || c.label).includes(t)));
        return { count: all.length, matches: matches.slice(0, 10).map(c => ({ id: c.id ?? c.competitionId ?? c.competition?.id, name: c.name ?? c.competitionName ?? c.competition?.name, keys: Object.keys(c).slice(0, 20) })) };
      }).catch(e => ({ error: e.message, status: e.status || null })),
      openFoot('/search', { q: query }).then(body => ({ count: rows(body).length, sample: rows(body).slice(0, 10).map(x => ({ id: x.id ?? x.teamId ?? x.competitionId ?? x.competition?.id ?? x.team?.id, name: x.name ?? x.displayName ?? x.team?.name ?? x.competition?.name ?? x.label, type: x.type ?? x.entityType ?? x.kind, keys: Object.keys(x).slice(0, 20) })) })).catch(e => ({ error: e.message, status: e.status || null }))
    ]);
    const competitionMatches = (competitionResult.matches || []).slice(0, 5);
    const competitionFixtures = await Promise.all(competitionMatches.map(async c => {
      const id = c.id;
      try {
        const body = await openFoot('/matches', { date, competition: id });
        return { id, name: c.name, count: rows(body).length, sample: rows(body).slice(0, 3).map(summarize) };
      } catch (e) { return { id, name: c.name, error: e.message, status: e.status || null }; }
    }));
    res.json({ query, date, matchResult, competitionResult, searchResult, competitionFixtures });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search-fixtures', async (req, res) => {
  const date = String(req.query.date || '');
  const query = String(req.query.q || '').trim();
  if (!date || !query) return res.status(400).json({ error: 'Indica data e testo da cercare.' });
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, ' ').trim();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  try {
    const competitions = rows(await openFoot('/competitions'));
    const matchingCompetitions = competitions.filter(c => {
      const name = norm(c.name || c.competitionName || c.competition?.name || '');
      return terms.every(term => name.includes(term));
    });
    let source = [];
    let searchMode = 'date';
    if (matchingCompetitions.length) {
      searchMode = 'competition';
      const results = await Promise.all(matchingCompetitions.slice(0, 5).map(async c => {
        const id = c.id ?? c.competitionId ?? c.competition?.id;
        if (id == null) return [];
        try { return rows(await openFoot('/matches', { date, competition: id })); }
        catch (_) { return []; }
      }));
      source = results.flat();
    } else {
      source = rows(await openFoot('/matches', { date }));
    }
    const now = Date.now();
    const seen = new Set();
    const response = source.map(toLegacy).filter(f => {
      const state = f.fixture?.status?.short || 'NS';
      if (['FT','PST','CANC'].includes(state)) return false;
      const kickoff = new Date(f.fixture?.date || 0).getTime();
      if (!Number.isFinite(kickoff)) return false;
      if (state === 'LIVE') {
        if (kickoff > now + 5 * 60 * 1000 || now - kickoff > 180 * 60 * 1000) return false;
      } else if (kickoff <= now) return false;
      const text = norm([f.league?.name, f.league?.country, f.teams?.home?.name, f.teams?.away?.name].join(' '));
      if (!terms.every(term => text.includes(term))) return false;
      const key = String(f.fixture?.id || [f.fixture?.date, f.teams?.home?.name, f.teams?.away?.name].join('|'));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.json({ results: response.length, response, provider: 'OpenFootAPI', searchMode, query, competitionsFound: matchingCompetitions.length });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/fixtures', async (req, res) => {
  const date = String(req.query.date || '');
  const { league, season, status } = req.query;
  if (!date && !league) return res.status(400).json({ error: 'Indica almeno date (YYYY-MM-DD) oppure league.' });
  try {
    const params = { date, competition: league, season, status };
    const body = await openFoot('/matches', params);
    const now = Date.now();
    const response = rows(body)
      .filter(m => {
        const state = statusCode(m.status);
        // Mostra le partite live e quelle che devono ancora iniziare.
        // Esclude terminate/rinviate/annullate e ogni kickoff già passato.
        if (['FT', 'PST', 'CANC'].includes(state)) return false;
        const kickoff = new Date(m.kickoffAt || m.date || m.utcDate || 0).getTime();
        if (state === 'LIVE') {
          const rawStatus = m.status && typeof m.status === 'object' ? m.status : {};
          const elapsed = Number(rawStatus.elapsed ?? m.minute ?? m.elapsed);
          if (!Number.isFinite(kickoff)) return false;
          // OpenFootAPI può lasciare LIVE dopo il 90': scarta stati palesemente obsoleti.
          if (Number.isFinite(elapsed) && elapsed >= 90 && now - kickoff > 100 * 60 * 1000) return false;
          if (!Number.isFinite(elapsed) && now - kickoff > 150 * 60 * 1000) return false;
          return kickoff <= now + 5 * 60 * 1000;
        }
        return Number.isFinite(kickoff) && kickoff > now;
      })
      .map(toLegacy);
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
  const hours = Math.min(48, Math.max(1, Number.parseInt(req.query.hours || '24', 10) || 24));
  const limit = Math.min(40, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
  const query = String(req.query.q || '').trim();
  const requestedDate = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(req.query.date) : '';
  const romeDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const normSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, ' ').trim();
  const searchTerms = normSearch(query).split(/\s+/).filter(Boolean);
  const now = Date.now();
  const cutoff = now + hours * 60 * 60 * 1000;
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(now));
  const part = key => dateParts.find(x => x.type === key).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const tomorrowDate = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + 1));
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);

  try {
    // L'endpoint /matches filtra per data: interroghiamo oggi e domani,
    // poi selezioniamo solo i kickoff compresi nelle prossime N ore.
    const datesToFetch = query && requestedDate ? [requestedDate] : [today, tomorrow];
    const dateBodies = await Promise.all(datesToFetch.map(date => openFoot('/matches', { date })));
    const todayBody = dateBodies[0] || {};
    const tomorrowBody = dateBodies[1] || {};
    let allDayMatches = dateBodies.flatMap(rows);
    let searchEntities = [];
    if (query) {
      // Resolve the typed team/competition through OpenFootAPI, then fetch matches by stable IDs.
      let searchItems = [];
      try {
        searchItems = rows(await openFoot('/search', { q: query }));
      } catch (_) {
        // Competition search must still work when the provider's /search endpoint fails.
      }
      const searchedEntities = searchItems.filter(item => {
        const name = item.name || item.displayName || item.team?.name || item.competition?.name || item.label || '';
        const termsMatch = searchTerms.every(term => normSearch(name).includes(term));
        return termsMatch && (item.id || item.teamId || item.competitionId || item.team?.id || item.competition?.id);
      });

      // Resolve competition names against the official catalog first. Search results can
      // contain unrelated entities and push the exact league beyond the old 8-result limit.
      let catalogMatches = [];
      try {
        const catalogItems = rows(await openFoot('/competitions', {}));
        catalogMatches = catalogItems.filter(item => {
          const name = item.name || item.displayName || item.competition?.name || item.label || '';
          return searchTerms.every(term => normSearch(name).includes(term)) &&
            (item.id || item.competitionId || item.competition?.id);
        }).map(item => ({ ...item, type: 'competition' }));
      } catch (_) {
        // Keep search endpoint results if the competition catalog is unavailable.
      }
      const merged = [...catalogMatches, ...searchedEntities];
      const knownIds = new Set();
      searchEntities = merged.filter(item => {
        const id = String(item.id ?? item.competitionId ?? item.competition?.id ?? item.teamId ?? item.team?.id ?? '');
        if (!id || knownIds.has(id)) return false;
        knownIds.add(id);
        return true;
      }).slice(0, 8);
      const entityMatches = await Promise.all(searchEntities.map(async item => {
        const id = item.id ?? item.teamId ?? item.competitionId ?? item.team?.id ?? item.competition?.id;
        const kind = String(item.type || item.entityType || item.kind || '').toLowerCase();
        const isCompetition = kind.includes('competition') || kind.includes('league') || String(id).startsWith('comp_') || item.competitionId != null || item.competition != null;
        const param = isCompetition ? { competition: id } : { team: id };
        const dateCalls = await Promise.all(datesToFetch.map(async date => {
          try { return rows(await openFoot('/matches', { date, ...param })); }
          catch (_) { return []; }
        }));
        return dateCalls.flat();
      }));
      allDayMatches = [...allDayMatches, ...entityMatches.flat()];
    }

    // Normalize both OpenFootAPI's current schema and its legacy fixture/teams schema
    // before date, competition, team and status filtering.
    allDayMatches = allDayMatches.map(m => {
      const legacy = m.fixture || m.teams;
      const homeTeam = m.homeTeam || m.home || m.teams?.home || {};
      const awayTeam = m.awayTeam || m.away || m.teams?.away || {};
      const competition = m.competition || m.league || {};
      const fixtureDate = m.kickoffAt || m.date || m.utcDate || m.fixture?.date || null;
      const rawStatus = m.status ?? m.fixture?.status ?? 'NS';
      const oldGoals = m.goals || {};
      return {
        ...m,
        id: m.id ?? m.fixture?.id,
        kickoffAt: fixtureDate,
        status: rawStatus,
        homeTeam,
        awayTeam,
        competition,
        competitionName: m.competitionName || competition.name || '',
        competitionId: m.competitionId ?? competition.id ?? null,
        score: m.score || {
          home: oldGoals.home ?? m.homeScore ?? m.scoreHome ?? null,
          away: oldGoals.away ?? m.awayScore ?? m.scoreAway ?? null
        }
      };
    });

    const seen = new Set();
    const upcoming = allDayMatches
      .filter(m => {
        const state = statusCode(m.status);
        const kickoff = new Date(m.kickoffAt || m.date || m.utcDate || 0).getTime();
        if (!Number.isFinite(kickoff) || kickoff <= now) return false;
        if (query && requestedDate) {
          if (romeDate(kickoff) !== requestedDate) return false;
        } else if (kickoff > cutoff) return false;
        if (['LIVE', 'FT', 'PST', 'CANC'].includes(state)) return false;
        if (query) {
          const home = m.homeTeam || m.home || {};
          const away = m.awayTeam || m.away || {};
          const comp = m.competition || {};
          const searchable = normSearch([home.name, away.name, m.competitionName, comp.name, m.country, comp.country].join(' '));
          const entityIds = searchEntities.map(item => String(item.id ?? item.teamId ?? item.competitionId ?? item.team?.id ?? item.competition?.id));
          const matchIds = [teamId(home), teamId(away), m.competitionId, comp.id].filter(Boolean).map(String);
          const directMatch = entityIds.some(id => matchIds.includes(id));
          if (!directMatch && !searchTerms.every(term => searchable.includes(term))) return false;
        }
        const id = String(m.id || '');
        if (id && seen.has(id)) return false;
        if (id) seen.add(id);
        return true;
      })
      .sort((a, b) => new Date(a.kickoffAt || a.date || a.utcDate || 0) - new Date(b.kickoffAt || b.date || b.utcDate || 0))
      .slice(0, Math.min(40, Math.max(limit, limit * 2)));
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
            .slice(0, 10);
          forms.set(String(id), recent);
        } catch (e) {
          forms.set(String(id), []);
          warnings.push(`Forma non disponibile per squadra ${id}: ${e.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, teamIds.length) }, worker));

    let fixtures = upcoming.map(m => {
      const homeTeam = m.homeTeam || m.home || {};
      const awayTeam = m.awayTeam || m.away || {};
      const homeId = teamId(homeTeam);
      const awayId = teamId(awayTeam);
      const homeAll = forms.get(String(homeId)) || [];
      const awayAll = forms.get(String(awayId)) || [];
      // Per Over 2.5 e GG valutiamo separatamente la squadra di casa nelle gare in casa
      // e quella ospite nelle gare in trasferta. Se il sotto-campione è troppo piccolo,
      // usiamo le ultime gare complessive e rendiamo esplicito il campione usato.
      const venueMatches = (matches, id, venue) => matches.filter(x => {
        const home = x.homeTeam || x.home || {};
        const isHome = String(teamId(home)) === String(id);
        return venue === 'home' ? isHome : !isHome;
      }).filter(completed);
      const homeVenue = venueMatches(homeAll, homeId, 'home');
      const awayVenue = venueMatches(awayAll, awayId, 'away');
      const homeSample = homeVenue.length >= 3 ? homeVenue : homeAll.filter(completed);
      const awaySample = awayVenue.length >= 3 ? awayVenue : awayAll.filter(completed);
      const combined = [...homeSample, ...awaySample];
      const pairedFrequency = (label, predicate) => {
        const a = frequency(homeSample, predicate, label);
        const b = frequency(awaySample, predicate, label);
        if (!a.sample || !b.sample) {
          const valid = combined.filter(completed);
          return frequency(valid, predicate, label);
        }
        return {
          label,
          score: Math.round(100 * (a.hits + b.hits) / (a.sample + b.sample)),
          hits: a.hits + b.hits,
          sample: a.sample + b.sample,
          venueSamples: { home: a.sample, away: b.sample },
          method: (homeVenue.length >= 3 ? 'casa' : 'forma generale') + ' / ' + (awayVenue.length >= 3 ? 'trasferta' : 'forma generale')
        };
      };
      const over25 = pairedFrequency('Over 2.5 FT', x => { const sc = goals(x); return sc.home + sc.away >= 3; });
      const btts = pairedFrequency('GG', x => { const sc = goals(x); return sc.home > 0 && sc.away > 0; });
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
          one, draw, two, over25, btts
        }
      };
    });
    // Classifica per qualità dell'evidenza: prima i mercati che superano CONF 70%
    // con almeno 6 gare, poi i dati utilizzabili con campione sufficiente, infine gli altri.
    const marketList = f => Object.values(f.markets || {}).filter(m => m.score !== null);
    for (const f of fixtures) {
      const ms = marketList(f);
      const qualified = ms.filter(m => m.score >= 70 && m.sample >= 6);
      const enoughSample = ms.filter(m => m.sample >= 6);
      const bestQualified = qualified.reduce((best, m) => !best || m.score > best.score || (m.score === best.score && m.sample > best.sample) ? m : best, null);
      const bestEvidence = enoughSample.reduce((best, m) => !best || m.score > best.score || (m.score === best.score && m.sample > best.sample) ? m : best, null);
      const bestAny = ms.reduce((best, m) => !best || m.score > best.score || (m.score === best.score && m.sample > best.sample) ? m : best, null);
      f.ranking = {
        tier: bestQualified ? 3 : bestEvidence ? 2 : bestAny ? 1 : 0,
        score: bestQualified?.score ?? bestEvidence?.score ?? bestAny?.score ?? -1,
        sample: bestQualified?.sample ?? bestEvidence?.sample ?? bestAny?.sample ?? 0,
        qualified: Boolean(bestQualified),
        basis: bestQualified ? 'Mercato ≥70% con almeno 6 gare' : bestEvidence ? 'Miglior frequenza con almeno 6 gare, sotto soglia' : bestAny ? 'Campione insufficiente' : 'Nessun dato storico'
      };
      // Punteggio solo per ordinare le schede, non è una probabilità.
      f.rankScore = f.ranking.tier * 10000 + f.ranking.score * 100 + Math.min(f.ranking.sample, 10);
    }
    fixtures.sort((a, b) => b.rankScore - a.rankScore);
    const analyzedCount = fixtures.length;
    fixtures = fixtures.slice(0, limit);
    const metaToday = todayBody?.meta || {};
    const metaTomorrow = tomorrowBody?.meta || {};
    const providerTotal = Number(metaToday.total_count || 0) + Number(metaTomorrow.total_count || 0);
    res.json({
      windowHours: hours, query: query || null, date: query && requestedDate ? requestedDate : null, from: new Date(now).toISOString(), until: new Date(cutoff).toISOString(), warnings,
      method: 'Le schede sono ordinate prima per presenza di un mercato ≥70% con almeno 6 gare storiche, poi per la migliore frequenza con campione sufficiente e dimensione del campione. Le percentuali sono frequenze descrittive, non probabilità predittive calibrate.',
      threshold: 70, limit, analyzedCount, fixtures,
      preview: { returned: allDayMatches.length, totalAvailable: providerTotal || null, partial: Boolean(metaToday?.scope?.partial || metaTomorrow?.scope?.partial) || (providerTotal > 0 && allDayMatches.length < providerTotal), paginationAvailable: false },
      note: (query ? 'Ricerca provider per “' + query + '” integrata nell’analisi CONF. ' : 'Lista generale ') + 'Oggi e domani, filtrati sulle prossime ' + hours + ' ore. Se il provider limita l’anteprima, il sito non può mostrare le gare che l’API non restituisce. Quote non disponibili nel piano Starter; non vengono inventate.'
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});


function historyConfigOk(res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.HISTORY_ACCESS_TOKEN) {
    res.status(503).json({ error: 'Sincronizzazione non configurata: controlla le variabili ambiente su Render.' });
    return false;
  }
  return true;
}
function historyAuthorized(req, res) {
  if (!historyConfigOk(res)) return false;
  if (req.get('x-history-token') !== process.env.HISTORY_ACCESS_TOKEN) {
    res.status(401).json({ error: 'Codice di sincronizzazione non valido.' });
    return false;
  }
  return true;
}
function supabaseHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}
app.get('/api/history', async (req, res) => {
  if (!historyAuthorized(req, res)) return;
  try {
    const url = new URL('/rest/v1/bet_history', process.env.SUPABASE_URL);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'recorded_at.desc');
    url.searchParams.set('limit', '500');
    const response = await fetch(url, { headers: supabaseHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Errore lettura Supabase.' });
    res.json({ history: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/history', express.json({ limit: '1mb' }), async (req, res) => {
  if (!historyAuthorized(req, res)) return;
  const items = Array.isArray(req.body?.history) ? req.body.history.slice(0, 500) : null;
  if (!items) return res.status(400).json({ error: 'Formato storico non valido.' });
  const rows = items.map(x => ({
    id: String(x.id || ''),
    fixture_id: String(x.fixtureId || x.fixture_id || ''),
    match_date: x.date || x.match_date || null,
    league: String(x.league || ''),
    home: String(x.home || ''),
    away: String(x.away || ''),
    market: String(x.market || ''),
    score: Number(x.score || 0),
    hits: Number(x.hits || 0),
    sample: Number(x.sample || 0),
    outcome: ['pending', 'win', 'loss'].includes(x.outcome) ? x.outcome : 'pending',
    recorded_at: x.recordedAt || x.recorded_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  })).filter(x => x.id && x.fixture_id && x.market);
  try {
    if (!rows.length) return res.json({ saved: 0 });
    const url = new URL('/rest/v1/bet_history', process.env.SUPABASE_URL);
    url.searchParams.set('on_conflict', 'id');
    const response = await fetch(url, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Errore scrittura Supabase.' });
    res.json({ saved: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/history/settle', async (req, res) => {
  if (!historyAuthorized(req, res)) return;
  try {
    const historyUrl = new URL('/rest/v1/bet_history', process.env.SUPABASE_URL);
    historyUrl.searchParams.set('select', '*');
    historyUrl.searchParams.set('outcome', 'eq.pending');
    historyUrl.searchParams.set('limit', '500');
    const historyResponse = await fetch(historyUrl, { headers: supabaseHeaders() });
    const pending = await historyResponse.json().catch(() => []);
    if (!historyResponse.ok) return res.status(historyResponse.status).json({ error: pending.message || 'Errore lettura storico.' });
    if (!Array.isArray(pending) || !pending.length) return res.json({ checked: 0, settled: 0, message: 'Nessuna selezione in attesa.' });

    const byDate = new Map();
    for (const item of pending) {
      const date = String(item.match_date || '').slice(0, 10);
      if (date && !byDate.has(date)) byDate.set(date, null);
    }
    for (const date of byDate.keys()) {
      try {
        const body = await openFoot('/matches', { date });
        byDate.set(date, rows(body));
      } catch {
        byDate.set(date, []);
      }
    }

    let checked = 0, settled = 0;
    const unresolved = [];
    for (const item of pending) {
      const date = String(item.match_date || '').slice(0, 10);
      const matches = byDate.get(date) || [];
      const match = matches.find(m => String(m.id) === String(item.fixture_id));
      if (!match || !completed(match)) { unresolved.push(item.id); continue; }
      const sc = goals(match);
      const market = String(item.market || '').toLowerCase();
      let won = null;
      if (market.includes('over') && market.includes('2.5')) won = sc.home + sc.away >= 3;
      else if (market === 'gg' || market.includes('entrambe')) won = sc.home > 0 && sc.away > 0;
      else if (market.startsWith('x') || market.includes('pareggio')) won = sc.home === sc.away;
      else if (market.startsWith('2') || market.includes('vittoria trasferta')) won = sc.away > sc.home;
      else if (market.startsWith('1') || market.includes('vittoria casa')) won = sc.home > sc.away;
      if (won === null) { unresolved.push(item.id); continue; }
      checked++;
      const patchUrl = new URL('/rest/v1/bet_history', process.env.SUPABASE_URL);
      patchUrl.searchParams.set('id', 'eq.' + item.id);
      patchUrl.searchParams.set('outcome', 'eq.pending');
      const patch = await fetch(patchUrl, {
        method: 'PATCH',
        headers: supabaseHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ outcome: won ? 'win' : 'loss', updated_at: new Date().toISOString() })
      });
      if (patch.ok) settled++;
    }
    res.json({ checked, settled, pending: unresolved.length, message: 'Aggiornate solo partite concluse con risultato verificato dal provider.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(port, () => console.log(`CONF Football attivo su http://localhost:${port}`));
