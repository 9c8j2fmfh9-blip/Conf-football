import 'dotenv/config';
import express from 'express';
import { selectFixture } from './conf-selection.js';
import { openDataConf } from './open-data.js';
import {getSisalOdds,matchProposalOdds} from './sisal-odds.js';
import {buildDailyMultiples} from './daily-multiples.js';
import {pricedSelection} from './priced-selection.js';
import { readFileSync } from 'node:fs';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENFOOT_API_KEY;
const base = 'https://openfootapi.com/v1';
const cache = new Map();
let openFootBlock = null;
const CACHE_TTL_MS = 60 * 1000; // Cache breve: evita stati LIVE obsoleti nelle partite in corso.

app.use(express.static('.'));

const apiFootballKey = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_API_KEY || process.env.APISPORTS_KEY || '';
const secondaryCache = new Map();
async function apiFootball(path, params = {}) {
  if (!apiFootballKey) return null;
  const url = new URL('https://v3.football.api-sports.io/' + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const key = url.toString();
  const cached = secondaryCache.get(key);
  if (cached && Date.now() - cached.time < 6 * 60 * 60 * 1000) return cached.value;
  const response = await fetch(url, { headers: { 'x-apisports-key': apiFootballKey } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.errors && Object.keys(body.errors).length)) {
    const errorCodes = Object.keys(body.errors || {});
    const reason = response.status === 401 || response.status === 403 ? 'chiave non autorizzata'
      : response.status === 429 ? 'limite richieste raggiunto'
      : errorCodes.some(k => /requests|quota|limit/i.test(k)) ? 'quota o limite API'
      : errorCodes.some(k => /token|key|auth/i.test(k)) ? 'problema autenticazione'
      : errorCodes.includes('access') ? 'accesso non consentito dal piano API-Football'
      : 'errore provider';
    throw new Error(reason + ' (HTTP ' + response.status + ', categorie: ' + (errorCodes.join(',') || 'nessuna') + ')');
  }
  secondaryCache.set(key, { value: body, time: Date.now() });
  return body;
}



/**
 * Independent, keyless EFL calendar (full-season feed) and actual completed
 * 2026/27 results from a public, open matchday dataset.
 * Do not confuse this feed with the statistics API; only real results
 * enter CONF calculations.
 */
// FA Cup fourth qualifying round replays verified against the official FA
// fixture list on 2026-10-20. This is a dated snapshot, not a live API.
const verifiedFaCupFixtures = {
  '2026-10-20': [
    ['Worcester City','Chorley'], ['Stafford Rangers','Gateshead'],
    ['Gloucester City','Barrow AFC'], ['Anstey Nomads','Macclesfield'],
    ['FC United of Manchester','Altrincham'], ['Harrogate Town AFC','Bury'],
    ['Alvechurch','Spalding United'], ['Forest Green Rovers','Chesham United'],
    ['Yeovil Town','Leatherhead'], ['Cray Wanderers','Bedford Town'],
    ['Tadley Calleva','Aldershot Town']
  ]
};
function faCupSnapshots(date) {
  return (verifiedFaCupFixtures[date] || []).map(([home,away], index) => ({
    id: 'fa_official_' + date + '_' + index,
    kickoffAt: date + 'T18:45:00Z', // 19:45 BST = 20:45 Europe/Rome
    status: 'NS',
    homeTeam: { id: 'facup_' + home.toLowerCase().replace(/[^a-z0-9]+/g,'_'), name: home },
    awayTeam: { id: 'facup_' + away.toLowerCase().replace(/[^a-z0-9]+/g,'_'), name: away },
    competition: { id: 'eng_fa_cup', name: 'FA Cup', country: 'England' },
    competitionId: 'eng_fa_cup', competitionName: 'FA Cup', country: 'England',
    source: 'Official FA fixture list (verified 2026-10-20)'
  }));
}
const eflSources = {
  'championship': { slug: 'championship-2026', folder: 'ENG_2_championship', name: 'Championship' },
  'league one': { slug: 'efl-league-one-2026', folder: 'ENG_3_league-one', name: 'League One' },
  'league two': { slug: 'efl-league-two-2026', folder: 'ENG_4_league-two', name: 'League Two' }
};
// Local fallback is bundled during deployment: these are real completed
// 2026/27 league results, not simulated or predicted matches.
const eflBundled = JSON.parse(readFileSync(new URL('./efl-history-2627.json', import.meta.url), 'utf8'));

const faCupBundled = JSON.parse(readFileSync(new URL('./fa-cup-support-history-2627.json', import.meta.url), 'utf8'));
const teamStatsBundled = JSON.parse(readFileSync(new URL('./team-stats-2627.json', import.meta.url), 'utf8'));
function teamStatName(name) {
  const aliases = {
    'barrow afc':'barrow', 'harrogate town afc':'harrogate town',
    'fc united of manchester':'fc united', 'chesham united':'chesham',
    'bedford town':'bedford', 'mk dons':'mk dons'
  };
  const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return aliases[normalized] || normalized;
}
function cornerHistoryForTeam(name, leagueId, beforeTimestamp) {
  const isCup = leagueId === 'eng_fa_cup';
  // Avoid mixing homonymous teams across unrelated leagues.
  const folders = isCup ? Object.keys(teamStatsBundled.rows) : [leagueId];
  const matches = [];
  const normalizedTeam = teamStatName(name);
  for (const folder of folders) {
    for (const [date, home, away, hcorn, acorn] of (teamStatsBundled.rows[folder] || [])) {
      if (Date.parse(date + 'T12:00:00Z') >= beforeTimestamp) continue;
      const isHome = teamStatName(home) === normalizedTeam;
      const isAway = teamStatName(away) === normalizedTeam;
      if (!isHome && !isAway) continue;
      const val = isHome ? hcorn : acorn;
      if (!/^\d+$/.test(String(val))) continue;
      const other = isHome ? acorn : hcorn;
      matches.push({
        date, corners: Number(val), total: /^\d+$/.test(String(other)) ? Number(val) + Number(other) : null,
        home: isHome
      });
    }
  }
  return matches.sort((a,b) => b.date.localeCompare(a.date)).slice(0,10);
}
function buildCornerMarkets(home, away, leagueId, beforeTimestamp) {
  const h = cornerHistoryForTeam(home, leagueId, beforeTimestamp);
  const a = cornerHistoryForTeam(away, leagueId, beforeTimestamp);
  const result = { source:'Risultati 2026/27 verificati · corner a tempo pieno', homeSample:h.length, awaySample:a.length, markets:[] };
  const add = (label, sample, predicate) => {
    const hits = sample.filter(predicate).length;
    result.markets.push({
      label, score:sample.length ? Math.round(100*hits/sample.length) : null,
      hits, sample:sample.length, qualified:sample.length>=6 && hits/sample.length>=0.6
    });
  };
  for (const line of [2,3,4,5]) {
    add(home + ' · ' + line + '+ corner FT',h,x=>x.corners>=line);
    add(away + ' · ' + line + '+ corner FT',a,x=>x.corners>=line);
  }
  const totals = [...h,...a].filter(x=>x.total!==null);
  for (const line of [7,8,9,10]) add('Totale ' + line + '+ corner FT',totals,x=>x.total>=line);
  result.note = (!h.length || !a.length) ? 'Storico incompleto: non sono disponibili i corner per entrambe le squadre.' :
    'Frequenze storiche descrittive, non probabilità calibrate. I dati per tempo non sono disponibili.';
  return result;
}

// Explicit mappings only: avoid accidentally equating different football clubs.
const faCupAliases = {
  'Barrow AFC': 'Barrow',
  'FC United of Manchester': 'FC United',
  'Harrogate Town AFC': 'Harrogate Town',
  'Chesham United': 'Chesham',
  'Bedford Town': 'Bedford'
};
function faCupHistoricalForm(teamName, beforeTime) {
  const lookup = faCupAliases[teamName] || teamName;
  const games = [];
  for (const [league, results] of Object.entries(faCupBundled.results)) {
    const teamIdentifier = 'facup_' + teamName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    for (const [date, time, home, away, homeGoals, awayGoals] of results) {
      if (home !== lookup && away !== lookup) continue;
      if (!/^\d+$/.test(String(homeGoals)) || !/^\d+$/.test(String(awayGoals))) continue;
      // Exclude any result on/after the future fixture's kickoff, to
      // prevent leakage into predictions for a specified historical date.
      const kickoff = eflStart(date, time) || (date + 'T12:00:00Z');
      if (Date.parse(kickoff) >= beforeTime) continue;
      const otherName = home === lookup ? away : home;
      const opposite = 'faopp_' + league + '_' + otherName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      games.push({
        id: 'facup_history_' + league + '_' + date + '_' + home + '_' + away,
        kickoffAt: kickoff, status: 'FT',
        homeTeam: { id: home === lookup ? teamIdentifier : opposite, name: home },
        awayTeam: { id: away === lookup ? teamIdentifier : opposite, name: away },
        score: { home: Number(homeGoals), away: Number(awayGoals) }
      });
    }
  }
  return games.sort((a,b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt)).slice(0,10);
}

const eflCache = new Map();
async function eflDownload(url, asCsv = false) {
  const cached = eflCache.get(url);
  if (cached && Date.now() - cached.at < (asCsv ? 2 * 60 : 20) * 60 * 1000) return cached.value;
  const response = await fetch(url, { headers: { 'User-Agent': 'CONF-Football/1.0' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const value = asCsv ? await response.text() : await response.json();
  eflCache.set(url, { at: Date.now(), value });
  return value;
}
function eflCsv(text) {
  const records = [];
  const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const parse = line => {
    let quote = false, cell = '', out = [];
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && quote && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quote = !quote;
      else if (c === ',' && !quote) { out.push(cell); cell = ''; }
      else cell += c;
    }
    out.push(cell);
    return out;
  };
  if (lines.length < 2) return records;
  const keys = parse(lines.shift());
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = parse(line);
    const row = {};
    keys.forEach((k, i) => { row[k] = values[i] || ''; });
    records.push(row);
  }
  return records;
}
function eflTeamKey(name, folder) {
  return 'efl_' + folder + '_' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function eflStart(date, time) {
  // Dataset fixture CSV times are UK local; determine UK DST using noon UTC.
  const [hour, minute] = String(time || '').split(':').map(Number);
  if (!date || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const noon = new Date(date + 'T12:00:00Z');
  const londonHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23'
  }).format(noon));
  const offset = londonHour - 12;
  return new Date(Date.parse(date + 'T00:00:00Z') + (hour - offset) * 3600000 + minute * 60000).toISOString();
}
async function eflLeagueData(key) {
  const conf = eflSources[key];
  const feedUrl = 'https://fixturedownload.com/feed/json/' + conf.slug;
  const csvBase = 'https://raw.githubusercontent.com/oladeeayo/open-matchday/main/data/' + conf.folder + '/';
  const [feedResult, fixturesResult, historyResult] = await Promise.allSettled([
    eflDownload(feedUrl),
    eflDownload(csvBase + 'fixtures_2627.csv', true),
    eflDownload(csvBase + 'results_2627.csv', true)
  ]);
  if (feedResult.status !== 'fulfilled' && fixturesResult.status !== 'fulfilled')
    throw new Error('Calendario ' + key + ' non disponibile da entrambe le fonti');
  const feed = feedResult.status === 'fulfilled' && Array.isArray(feedResult.value) ? feedResult.value : [];
  const csvFixtures = fixturesResult.status === 'fulfilled' ? eflCsv(fixturesResult.value) : [];
  const remotelyAvailable = historyResult.status === 'fulfilled' ? eflCsv(historyResult.value) : [];
  const bundled = (eflBundled.leagues[key] || []).map(([date, home, away, ft_home, ft_away]) =>
    ({ date, home, away, ft_home, ft_away, time: '12:00' }));
  // Prefer the most complete actual-results sample. Crucially, the locally
  // bundled history still works if GitHub's raw CDN is inaccessible on Render.
  const history = remotelyAvailable.length > bundled.length ? remotelyAvailable : bundled;
  const calendar = feed.length ? feed.map(m => ({
    home: m.HomeTeam, away: m.AwayTeam,
    date: m.DateUtc ? new Date(String(m.DateUtc).replace(' ', 'T')).toISOString() : null,
    id: m.MatchNumber, finished: m.HomeTeamScore != null && m.AwayTeamScore != null
  })) : csvFixtures.map((m,i) => ({
    home: m.home, away: m.away, date: eflStart(m.date, m.time), id: m.gw + '_' + i, finished: false
  }));
  const matches = calendar.filter(m => m.home && m.away && m.date && !m.finished).map(m => ({
    id: 'efl_' + conf.slug + '_' + m.id,
    kickoffAt: m.date, status: 'NS',
    homeTeam: { id: eflTeamKey(m.home, conf.folder), name: m.home },
    awayTeam: { id: eflTeamKey(m.away, conf.folder), name: m.away },
    competition: { id: conf.folder, name: conf.name, country: 'England' },
    competitionId: conf.folder, competitionName: conf.name, country: 'England',
    source: feed.length ? 'FixtureDownload' : 'Open Matchday'
  }));
  const historical = history.filter(m => /^\d+$/.test(m.ft_home) && /^\d+$/.test(m.ft_away))
    .map((m,i) => ({
      id: 'efl_history_' + conf.folder + '_' + i,
      kickoffAt: eflStart(m.date, m.time) || (m.date + 'T12:00:00Z'),
      status: 'FT',
      homeTeam: { id: eflTeamKey(m.home, conf.folder), name: m.home },
      awayTeam: { id: eflTeamKey(m.away, conf.folder), name: m.away },
      score: { home: Number(m.ft_home), away: Number(m.ft_away) }
    }));
  return { matches, historical, source: feed.length ? 'FixtureDownload' : 'Open Matchday', historyCount: history.length };
}

async function openFoot(path, params = {}) {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < (params.status === 'finished' ? 6 * 60 * 60 * 1000 : CACHE_TTL_MS)) return cached.data;

  if (openFootBlock && Date.now() < openFootBlock.until) {
    const error = new Error(openFootBlock.message); error.code = 'MONTHLY_QUOTA'; error.status = 429; throw error;
  }
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  let body = await response.json().catch(() => ({}));

  // If the configured key is rejected (401), retry with the documented public preview.
  // The response metadata makes the reduced demo scope visible; never pretend this is full access.
  if (!response.ok && response.status === 401) {
    const demoHeaders = { Accept: 'application/json', Authorization: 'Bearer of_demo_openfootapi_docs' };
    response = await fetch(url, { headers: demoHeaders, signal: AbortSignal.timeout(12000) });
    body = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const detail = body?.error?.message || body?.error?.code || `HTTP ${response.status}`;
    const err = new Error(`OpenFootAPI: ${detail}`);
    err.status = response.status;
    if (/monthly quota|monthly.*limit|quota.*mensil/i.test(String(detail))) {
      err.code = 'MONTHLY_QUOTA';
      openFootBlock = { message: err.message, until: Date.now() + 15 * 60 * 1000 };
    }
    throw err;
  }
  cache.set(cacheKey, { time: Date.now(), data: body });
  return body;
}

async function openFootAll(path, params = {}, maxPages = 10) {
  const collected = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const body = await openFoot(path, { ...params, ...(cursor ? { cursor } : {}) });
    collected.push(...rows(body));
    cursor = body?.meta?.pagination?.next_cursor || null;
    if (!cursor) break;
  }
  return collected;
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


// Experimental goal model: historical goal averages, venue-aware, no claim of calibration.
// Require both teams >= 6 completed matches; use shrinkage toward 1.3 goals per team.

const goalContextCache = new Map();
async function providerGoalContext(id) {
  const unavailable = reason => ({ available:false, reason });
  if (!apiKey || !/^(match_fmb_|match_olg_|match_of_epl_)/.test(String(id)))
    return unavailable('xG provider non disponibili per questa partita.');
  const cached = goalContextCache.get(String(id));
  if (cached && Date.now()-cached.at < 6*60*60*1000) return cached.value;
  let value;
  try {
    const response = await fetch(base+'/matches/'+encodeURIComponent(id)+'/context', {
      headers:{Accept:'application/json',Authorization:'Bearer '+apiKey},
      signal:AbortSignal.timeout(8000)
    });
    const body = await response.json();
    const xg = body?.data?.analytics?.expectedGoals;
    const h = numberOrNull(xg?.home);
    const a = numberOrNull(xg?.away);
    value = response.ok && h!==null && a!==null && h>=0 && a>=0
      ? {available:true,home:h,away:a,source:'OpenFootAPI · analytics.expectedGoals',
         note:'Previsione prepartita del provider; non xG dei tiri della partita futura.'}
      : unavailable(response.status===401 || response.status===403
        ? 'xG provider non accessibili con la chiave o il piano attuale.'
        : 'xG prepartita non restituiti dal provider.');
  } catch { value=unavailable('xG provider temporaneamente non disponibili.'); }
  goalContextCache.set(String(id),{at:Date.now(),value});
  return value;
}

function experimentalGoalEstimate(homeGames, awayGames, homeId, awayId) {
  const home = teamPerspective(homeGames, homeId);
  const away = teamPerspective(awayGames, awayId);
  if (home.sample < 6 || away.sample < 6) return { available: false, reason: 'Servono almeno 6 risultati per squadra.' };
  const shrink = (v,n) => (v*n + 1.3*6)/(n+6);
  const homeAttack = shrink(home.averageFor,home.sample);
  const awayDefense = shrink(away.averageAgainst,away.sample);
  const awayAttack = shrink(away.averageFor,away.sample);
  const homeDefense = shrink(home.averageAgainst,home.sample);
  const h = Math.max(0.15,Math.min(4,Math.sqrt(homeAttack*awayDefense)));
  const a = Math.max(0.15,Math.min(4,Math.sqrt(awayAttack*homeDefense)));
  const poisson = (lambda,k) => {
    let f=1; for(let i=2;i<=k;i++)f*=i;
    return Math.exp(-lambda)*Math.pow(lambda,k)/f;
  };
  let one=0,draw=0,two=0,over25=0,gg=0,over35=0,bttsOver25=0;
  for(let i=0;i<=15;i++)for(let j=0;j<=15;j++){
    const p=poisson(h,i)*poisson(a,j);
    if(i>j)one+=p;else if(i===j)draw+=p;else two+=p;
    if(i+j>2)over25+=p;
    if(i+j>3)over35+=p;
    if(i>0&&j>0)gg+=p;
    if(i>0&&j>0&&i+j>2)bttsOver25+=p;
  }
  // Team-goal combinations use the JOINT score distribution, not an unjustified
  // multiplication of two rounded market percentages.
  const combos=[];
  for(const homeMin of [1,2,3]) for(const awayMin of [1,2,3]) {
    let probability=0;
    for(let i=homeMin;i<=15;i++) for(let j=awayMin;j<=15;j++)
      probability+=poisson(h,i)*poisson(a,j);
    combos.push({homeOver:(homeMin-0.5).toFixed(1),awayOver:(awayMin-0.5).toFixed(1),
      score:Math.round(probability*100),homeMin,awayMin});
  }
  combos.sort((a,b)=>b.score-a.score || (b.homeMin+b.awayMin)-(a.homeMin+a.awayMin));
  return { available:true, validated:false, model:'Poisson sperimentale con medie gol corrette per piccolo campione', expectedGoals:{home:Number(h.toFixed(2)),away:Number(a.toFixed(2))}, teamGoalCombos:combos, estimates:{one:Math.round(one*100),draw:Math.round(draw*100),two:Math.round(two*100),over25:Math.round(over25*100),btts:Math.round(gg*100),over35:Math.round(over35*100),bttsOver25:Math.round(bttsOver25*100)}, samples:{home:home.sample,away:away.sample}, warning:'STIMA NON VALIDATA. Non tiene conto della forza degli avversari, indisponibili o xG. Non usare come probabilità affidabile o consiglio di scommessa.' };
}


/**
 * Time-ordered walk-forward backtest on bundled completed EFL matches.
 * For each fixture use ONLY matches from strictly earlier dates (unknown
 * same-day kickoff times cannot safely establish ordering).
 */
app.get('/api/conf-backtest', (_req, res) => {
  try {
    const stats = {};
    const markets = ['one','draw','two','over25','btts','over35','bttsOver25'];
    for (const [league, rows] of Object.entries(eflBundled.leagues || {})) {
      const games = rows.filter(x => /^\d+$/.test(String(x[3])) && /^\d+$/.test(String(x[4])))
        .map(([date,h,a,hg,ag],i)=>({
          id: 'backtest_'+league+'_'+i, date, kickoffAt:date+'T12:00:00Z', status:'FT',
          homeTeam:{id:h,name:h}, awayTeam:{id:a,name:a},
          score:{home:Number(hg),away:Number(ag)}
        })).sort((a,b)=>a.date.localeCompare(b.date));
      const seen = new Map();
      const evaluated=[];
      for (const game of games) {
        const homeId=game.homeTeam.id, awayId=game.awayTeam.id;
        const hAll=(seen.get(homeId)||[]).slice(-10).reverse();
        const aAll=(seen.get(awayId)||[]).slice(-10).reverse();
        const hV=hAll.filter(g=>g.homeTeam.id===homeId);
        const aV=aAll.filter(g=>g.awayTeam.id===awayId);
        const est=experimentalGoalEstimate(hV.length>=6?hV:hAll,aV.length>=6?aV:aAll,homeId,awayId);
        if(est.available) {
          const score=goals(game);
          const truth={one:Number(score.home>score.away),draw:Number(score.home===score.away),two:Number(score.home<score.away),over25:Number(score.home+score.away>=3),btts:Number(score.home>0&&score.away>0),over35:Number(score.home+score.away>=4),bttsOver25:Number(score.home>0&&score.away>0&&score.home+score.away>=3)};
          evaluated.push({ date:game.date, probabilities:est.estimates, truth });
        }
        // Update after processing the COMPLETE date, to avoid same-date leakage.
        // Deferred updates are staged until the next date begins.
        if (!seen._pending) seen._pending=[];
        seen._pending.push(game);
        const next=games[games.indexOf(game)+1];
        if(!next || next.date!==game.date) {
          for(const g of seen._pending){
            for(const id of [g.homeTeam.id,g.awayTeam.id]){
              const arr=seen.get(id)||[];
              arr.push(g);
              seen.set(id,arr.slice(-10));
            }
          }
          seen._pending=[];
        }
      }
      const count=evaluated.length;
      const measures={};
      for(const key of markets){
        const hits=evaluated.reduce((acc,row)=>acc+row.truth[key],0);
        const base=count?hits/count:null;
        const brier=count?evaluated.reduce((acc,row)=>acc+Math.pow(row.probabilities[key]/100-row.truth[key],2),0)/count:null;
        const baseline=count?evaluated.reduce((acc,row)=>acc+Math.pow(base-row.truth[key],2),0)/count:null;
        measures[key]={brier:brier===null?null:Number(brier.toFixed(4)),baselineBrier:baseline===null?null:Number(baseline.toFixed(4)),observedRate:count?Math.round(100*base):null,betterThanBaseline:brier===null?null:brier<baseline};
      }
      stats[league]={historicalFixtures:games.length,backtestedFixtures:count,measurements:measures};
    }
    res.json({status:'experimental',validated:false,method:'Walk-forward su risultati storici per data, ogni stima usa solo partite di date precedenti; ultimi 10 incontri/squadra, almeno 6 per squadra.',metric:'Brier score (inferiore è meglio); confronto con la frequenza media osservata nel campione come baseline descrittiva, non out-of-sample.',limitations:'Dataset limitato a 2026/27 e leghe inglesi disponibili. Solo un primo controllo retrospettivo, non una validazione esterna; nessuna previsione può essere dichiarata affidabile.',leagues:stats});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/status', (_req, res) => {
  res.json(process.env.CONF_PROVIDER === 'openfoot' ? { configured: Boolean(apiKey), provider: 'OpenFootAPI', cacheMinutes: CACHE_TTL_MS / 60000 } : {configured:true,provider:'Open Matchday',refreshHours:6,competitions:75});
});

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CONF Football', version: '0.4.0', provider: process.env.CONF_PROVIDER === 'openfoot' ? 'OpenFootAPI' : 'Open Matchday' }));

app.get('/api/key-check', async (_req, res) => {
  const url = new URL(base + '/matches');
  url.searchParams.set('date', new Date().toISOString().slice(0, 10));
  const check = async headers => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
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
  const dateInput = String(req.query.date || '');
  const date = dateInput.length === 10 && dateInput[4] === '-' && dateInput[7] === '-' ? dateInput : new Date().toISOString().slice(0, 10);
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
        return { count: all.length, matches: matches.slice(0, 10).map(c => ({ id: c.id ?? c.competitionId ?? c.competition?.id, name: c.name ?? c.competitionName ?? c.competition?.name, currentSeason: c.currentSeason ?? null, availableSeasons: c.availableSeasons ?? null, keys: Object.keys(c).slice(0, 20) })) };
      }).catch(e => ({ error: e.message, status: e.status || null })),
      openFoot('/search', { q: query }).then(body => ({ count: rows(body).length, sample: rows(body).slice(0, 10).map(x => ({ id: x.id ?? x.teamId ?? x.competitionId ?? x.competition?.id ?? x.team?.id, name: x.name ?? x.displayName ?? x.team?.name ?? x.competition?.name ?? x.label, type: x.type ?? x.entityType ?? x.kind, keys: Object.keys(x).slice(0, 20) })) })).catch(e => ({ error: e.message, status: e.status || null }))
    ]);
    const competitionMatches = (competitionResult.matches || []).slice(0, 5);
    const competitionFixtures = await Promise.all(competitionMatches.map(async c => {
      const id = c.id;
      const season = c.currentSeason || null;
      const test = async (params) => {
        try {
          const body = await openFoot('/matches', params);
          const list = rows(body);
          return { params, count: list.length, sample: list.slice(0, 3).map(summarize), meta: body?.meta ?? null, topKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 20) : [] };
        } catch (e) { return { params, error: e.message, status: e.status || null }; }
      };
      const tests = await Promise.all([
        test({ date, competition: id }),
        test({ competition: id, ...(season ? { season } : {}) }),
        test({ competition: id })
      ]);
      const nextCursor = tests[1]?.meta?.pagination?.next_cursor || null;
      const secondPage = nextCursor
        ? await test({ competition: id, ...(season ? { season } : {}), cursor: nextCursor })
        : { note: 'Nessun next_cursor nella prima pagina', cursor: null };
      return { id, name: c.name, season, tests, secondPage };
    }));
    res.json({ query, date, matchResult, competitionResult, searchResult, competitionFixtures });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search-fixtures', async (req, res) => {
  const date = String(req.query.date || '');
  const query = String(req.query.q || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !query) return res.status(400).json({ error: 'Indica data valida e testo da cercare.' });
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, ' ').trim();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  try {
    const [catalog, found] = await Promise.all([
      openFoot('/competitions').then(rows).catch(() => []),
      openFoot('/search', { q: query }).then(rows).catch(() => [])
    ]);
    const matchingCompetitions = catalog.filter(c => terms.every(t => norm(c.name || c.competitionName || c.competition?.name).includes(t)));
    const entities = [...matchingCompetitions.map(c => ({ ...c, type: 'competition' })), ...found].filter(item => {
      const name = item.name || item.displayName || item.team?.name || item.competition?.name || item.label || '';
      return terms.every(t => norm(name).includes(t));
    });
    const unique = new Map();
    for (const item of entities) {
      const id = item.id ?? item.teamId ?? item.competitionId ?? item.team?.id ?? item.competition?.id;
      if (id != null && !unique.has(String(id))) unique.set(String(id), item);
    }
    const resolved = [...unique.values()].slice(0, 20);
    const requests = resolved.map(async item => {
      const id = item.id ?? item.teamId ?? item.competitionId ?? item.team?.id ?? item.competition?.id;
      const kind = String(item.type || item.entityType || item.kind || '').toLowerCase();
      const competition = kind.includes('competition') || kind.includes('league') || String(id).startsWith('comp_');
      const filter = competition ? { competition: id } : { team: id };
      const scoped = await openFoot('/matches', { date, ...filter }).then(rows).catch(() => []);
      // A provider may ignore a date+team filter or omit those fixtures from its daily preview.
      const broader = scoped.length ? [] : await openFootAll('/matches', filter, 5).catch(() => []);
      return [...scoped, ...broader].map(m => ({
        ...m,
        competitionName: m.competitionName || m.competition?.name || (competition ? item.name : ''),
        competitionId: m.competitionId ?? m.competition?.id ?? (competition ? id : null)
      }));
    });
    const [daily, ...entityResults] = await Promise.all([
      openFoot('/matches', { date }).then(rows).catch(() => []),
      ...requests
    ]);
    const source = [...daily, ...entityResults.flat()];
    const now = Date.now();
    const seen = new Set();
    const response = source.map(toLegacy).filter(f => {
      const state = f.fixture?.status?.short || 'NS';
      if (['FT', 'PST', 'CANC'].includes(state)) return false;
      const kickoff = new Date(f.fixture?.date || 0).getTime();
      if (!Number.isFinite(kickoff)) return false;
      const italianDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(kickoff));
      if (italianDate !== date) return false;
      if (state === 'LIVE') {
        if (kickoff > now + 5 * 60000 || now - kickoff > 180 * 60000) return false;
      } else if (kickoff <= now) return false;
      const text = norm([f.league?.name, f.league?.country, f.teams?.home?.name, f.teams?.away?.name].join(' '));
      const ids = [f.teams?.home?.id, f.teams?.away?.id, f.league?.id].filter(Boolean).map(String);
      const matchedById = [...unique.keys()].some(id => ids.includes(id));
      if (!matchedById && !terms.every(t => text.includes(t))) return false;
      const key = String(f.fixture?.id || [f.fixture?.date, f.teams?.home?.name, f.teams?.away?.name].join('|'));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.json({ results: response.length, response, provider: 'OpenFootAPI', searchMode: resolved.length ? 'entity' : 'date', query, entitiesFound: resolved.length, competitionsFound: matchingCompetitions.length });
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


/**
 * Optional on-demand player shot-on-target history. No estimated individual
 * shot percentages and no request on the automatic CONF feed.
 * A single click costs at most 9 API-Sports calls (subject to cache).
 */

const detailCache = new Map();
function safeMatchName(name) {
  return String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
async function apiFootballMatch(home, away, date) {
  const fixtures = (await apiFootball('fixtures',{date,timezone:'Europe/Rome'}))?.response || [];
  return fixtures.find(x=>safeMatchName(x.teams?.home?.name)===safeMatchName(home) &&
    safeMatchName(x.teams?.away?.name)===safeMatchName(away)) || null;
}
function inputMatch(req,res) {
  const home=String(req.query.home||'').trim(), away=String(req.query.away||'').trim();
  const date=String(req.query.date||'').slice(0,10);
  if (!home || !away || home.length>90 || away.length>90 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({error:'Squadre o data non valide.'});return null;
  }
  return {home,away,date};
}
async function recentTeamFixtures(teamId,matchStart,count=4) {
  const matches=(await apiFootball('fixtures',{team:teamId,last:count+3}))?.response || [];
  return matches.filter(x=>Date.parse(x.fixture?.date)<matchStart &&
    ['FT','AET','PEN'].includes(x.fixture?.status?.short)).slice(0,count);
}
// Every detailed lookup is on user demand, cached for 6 hours to protect daily API quotas.
function statNumber(v) {
  if (v===null||v===undefined||v==='')return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function halfCornerValues(response,teamId) {
  const entry=(Array.isArray(response)?response:[]).find(x=>Number(x.team?.id)===Number(teamId));
  if(!entry)return null;
  const stats=entry.statistics||[];
  // The half=true API response can contain independent first/second period
  // blocks, or a structured value. Ignore unlabeled FT corner totals.
  let first=null,second=null;
  function pick(block, fallbackPeriod='') {
    if(!block||typeof block!=='object')return;
    const name=String(block.type||block.name||'');
    if(!/corner/i.test(name))return;
    const value=block.value;
    const period=String(block.half||block.period||block.time||block.segment||fallbackPeriod).toLowerCase();
    const firstHalf=/^(1|1h|1st|first|firsthalf|first half|half1|ht)$/.test(period);
    const secondHalf=/^(2|2h|2nd|second|secondhalf|second half|half2)$/.test(period);
    if(firstHalf)first=statNumber(value);
    if(secondHalf)second=statNumber(value);
    if(value && typeof value==='object') {
      first ??= statNumber(value.firstHalf??value.first_half??value.first??value['1']);
      second ??= statNumber(value.secondHalf??value.second_half??value.second??value['2']);
    }
  }
  if(Array.isArray(stats))for(const stat of stats) {
    if(Array.isArray(stat.statistics))for(const inner of stat.statistics)pick(inner,stat.period||stat.half||'');
    else pick(stat);
  }
  else if(stats && typeof stats==='object') {
    for(const [period,entries] of Object.entries(stats)) {
      if(Array.isArray(entries))for(const item of entries)pick(item,period);
    }
  }
  return first!==null&&second!==null?{first,second}:null;
}
app.get('/api/corners-halves',async(req,res)=>{
  const input=inputMatch(req,res);if(!input)return;
  if(!apiFootballKey)return res.json({markets:[],warning:'API-Football non configurata; corner per tempo non disponibili.'});
  const cacheKey='corners-halves:'+JSON.stringify(input),cached=detailCache.get(cacheKey);
  if(cached&&Date.now()-cached.at<21600000)return res.json(cached.value);
  try{
    const match=await apiFootballMatch(input.home,input.away,input.date);
    if(!match)return res.json({markets:[],warning:'La partita non è identificata dal provider, impossibile associare le statistiche ai tempi.'});
    const sets={home:[],away:[]};
    let sampled=0;
    for(const side of ['home','away']) {
      const team=match.teams[side];
      const games=await recentTeamFixtures(team.id,Date.parse(match.fixture.date),4);
      for(const game of games) {
        const details=(await apiFootball('fixtures/statistics',{fixture:game.fixture.id,half:'true'}))?.response || [];
        const value=halfCornerValues(details,team.id);
        if(value){sets[side].push(value);sampled++;}
      }
    }
    const markets=[];
    for(const side of ['home','away'])for(const half of ['first','second'])for(const line of [1,2,3,4]) {
      const rows=sets[side],hits=rows.filter(x=>x[half]>=line).length;
      markets.push({
        label:(side==='home'?input.home:input.away)+' · '+(half==='first'?'1°':'2°')+' tempo · '+line+'+ corner',
        score:rows.length?Math.round(100*hits/rows.length):null,
        hits,sample:rows.length,qualified:rows.length>=3&&hits/rows.length>=0.6,
        half,side,line
      });
    }
    const value={markets:markets.filter(x=>x.score!==null),matchesChecked:sampled,
      warning:sampled?'Campione limitato: frequenze storiche per tempo, non probabilità calibrate.':
      'Nessun dettaglio 1°/2° tempo disponibile tramite il piano/API attuale. Non possiamo ricostruirlo dai corner FT.'};
    detailCache.set(cacheKey,{at:Date.now(),value});return res.json(value);
  }catch(e){return res.json({markets:[],warning:'Corner per tempo non disponibili: '+e.message});}
});


// One shared official sheet refresh for all visible proposals. Odds failures
// never prevent the independent calendar / analysis response from loading.
app.get('/api/proposal-odds', async (req,res)=>{
 try {
  const data=openDataConf(req.query,experimentalGoalEstimate);
  const proposals=data.fixtures;
  const sheet=proposals.length?await getSisalOdds():null;
  res.json({source:'Sisal · foglio ufficiale',sourceUpdatedAt:sheet?.sourceUpdatedAt||null,
   fixtures:proposals.map(f=>{const result=pricedSelection(f,sheet);return {fixtureId:f.fixtureId,market:result.primary?.key||null,...result};})});
 } catch {res.status(503).json({error:'Quote momentaneamente non disponibili',fixtures:[]});}
});

// All qualified proposals in the day/window, independent of text search and
// the card limit. Recomputed on access so kicked-off events cannot survive.
app.get('/api/daily-multiples',async(req,res)=>{
 try{
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date||''))?String(req.query.date):'';
  const data=openDataConf({date,hours:24},experimentalGoalEstimate,{allFixtures:true});
  const sheet=data.selectedCount?await getSisalOdds():null;
  res.set('Cache-Control','no-store').json({...buildDailyMultiples(data.fixtures,sheet),date:date||null,windowHours:24,generatedAt:new Date().toISOString(),selectedCount:data.selectedCount,competitionsCovered:data.competitionsCovered});
 }catch{res.status(503).json({error:'Multiple momentaneamente non disponibili',tickets:[]});}
});

app.get('/api/conf', async (req, res) => {
  if (process.env.CONF_PROVIDER !== 'openfoot') {
    try { return res.json(openDataConf(req.query, experimentalGoalEstimate)); }
    catch (error) { return res.status(503).json({error:'Archivio calcio non disponibile: '+error.message}); }
  }
  // Recover gracefully if a pasted URL accidentally encodes all query parameters inside q.
  const rawQuery = String(req.query.q || '').trim();
  const embedded = rawQuery.includes('&') ? new URLSearchParams(rawQuery.replace(/^.*?\?/, '')) : null;
  const cleanQuery = embedded && (embedded.has('date') || embedded.has('hours') || embedded.has('limit'))
    ? (embedded.get('q') || rawQuery.split('&')[0].replace(/^q=/, '').replace(/\+/g, ' '))
    : rawQuery;
  const hours = Math.min(48, Math.max(1, Number.parseInt(req.query.hours || embedded?.get('hours') || '24', 10) || 24));
  const limit = Math.min(40, Math.max(1, Number.parseInt(req.query.limit || embedded?.get('limit') || '20', 10) || 20));
  const query = cleanQuery;
  const dateValue = String(req.query.date || embedded?.get('date') || '');
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : '';
  const romeDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const normSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, ' ').trim();
  // Resolve ambiguous English competition names to an explicit EFL identity.
  // Do not confuse League One with similarly named competitions worldwide.
  const eflAliases = {
    'league one': 'league one', 'league 1': 'league one', 'efl league one': 'league one',
    'league two': 'league two', 'league 2': 'league two', 'efl league two': 'league two',
    'championship': 'championship', 'efl championship': 'championship',
    'national league': 'national league'
  };
  const rawNormalizedQuery = normSearch(query);
  const championsRequested = ['champions league','champion league','uefa champions league','champions','ucl','champions ligue'].includes(rawNormalizedQuery);
  const normalizedQuery = championsRequested ? 'champions league' : rawNormalizedQuery;
  const englishCompetition = eflAliases[normalizedQuery] || '';
  const searchTerms = (englishCompetition || normalizedQuery).split(/\s+/).filter(Boolean);
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
    const datesToFetch = requestedDate ? [requestedDate] : [today, tomorrow];
    // The provider can return a limited preview. Also request scheduled fixtures,
    // then deduplicate; this does not guarantee complete coverage.
    const [dateBodies, scheduledBodies] = await Promise.all([
      Promise.all(datesToFetch.map(date => openFoot('/matches', { date }).catch(error => ({ response: [], providerError: error.message, providerCode: error.code || null })))),
      Promise.all(datesToFetch.map(date => openFoot('/matches', { date, status: 'scheduled' }).catch(error => ({ response: [], providerError: error.message, providerCode: error.code || null }))))
    ]);
    const todayBody = dateBodies[0] || {};
    const tomorrowBody = dateBodies[1] || {};
    let allDayMatches = [...dateBodies, ...scheduledBodies].flatMap(rows);
    let searchEntities = [];
    if (query) {
      // Resolve the typed team/competition through OpenFootAPI, then fetch matches by stable IDs.
      let searchItems = [];
      try {
        searchItems = rows(await openFoot('/search', { q: championsRequested ? 'UEFA Champions League' : query }));
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
        const catalogItems = await openFootAll('/competitions', {}, 10);
        catalogMatches = catalogItems.filter(item => {
          const name = item.name || item.displayName || item.competition?.name || item.label || '';
          return searchTerms.every(term => normSearch(name).includes(term)) &&
            (item.id || item.competitionId || item.competition?.id);
        }).map(item => ({ ...item, type: 'competition' }));
      } catch (_) {
        // Keep search endpoint results if the competition catalog is unavailable.
      }
      // Try alternative catalog names (EFL / English / Sky Bet) when the provider
      // doesn't index the colloquial league name.
      if (englishCompetition && !catalogMatches.length) {
        const aliasSearches = englishCompetition === 'league one'
          ? ['EFL League One', 'English League One', 'League 1']
          : englishCompetition === 'league two'
            ? ['EFL League Two', 'English League Two', 'League 2']
            : ['EFL ' + englishCompetition];
        const alternatives = await Promise.all(aliasSearches.map(q =>
          openFoot('/search', { q }).then(rows).catch(() => [])
        ));
        searchedEntities.push(...alternatives.flat().filter(item =>
          item.id || item.teamId || item.competitionId || item.competition?.id
        ));
      }
      // Known OpenFootAPI competition identifiers: catalog search can be incomplete
      // or use a generic competition label such as "League One".
      const knownEnglishIds = {
        'league one': ['comp_league_one_eng', 'comp_efl_league_one_eng', 'comp_league_one_efl'],
        'league two': ['comp_league_two_eng', 'comp_efl_league_two_eng', 'comp_league_two_efl'],
        'championship': ['comp_championship_eng', 'comp_efl_championship_eng'],
        'national league': ['comp_national_league_eng']
      };
      const knownCandidates = (knownEnglishIds[englishCompetition] || []).map(id => ({
        id, name: englishCompetition, type: 'competition'
      }));
      const merged = [...catalogMatches, ...searchedEntities, ...knownCandidates];
      const knownIds = new Set();
      searchEntities = merged.filter(item => {
        const id = String(item.id ?? item.competitionId ?? item.competition?.id ?? item.teamId ?? item.team?.id ?? '');
        if (!id || knownIds.has(id)) return false;
        knownIds.add(id);
        return true;
      }).slice(0, 24);
      const entityMatches = await Promise.all(searchEntities.map(async item => {
        const id = item.id ?? item.teamId ?? item.competitionId ?? item.team?.id ?? item.competition?.id;
        const kind = String(item.type || item.entityType || item.kind || '').toLowerCase();
        const isCompetition = kind.includes('competition') || kind.includes('league') || String(id).startsWith('comp_') || item.competitionId != null || item.competition != null;
        const param = isCompetition ? { competition: id } : { team: id };
        const seasonForDate = date => {
          const supplied = item.currentSeason;
          if (typeof supplied === 'string' && supplied) return supplied;
          if (supplied && typeof supplied === 'object') {
            const label = supplied.label || supplied.name || supplied.season;
            if (typeof label === 'string' && label) return label;
          }
          if (!championsRequested) return null;
          const d = new Date(date + 'T12:00:00Z');
          const year = d.getUTCFullYear() - (d.getUTCMonth() < 6 ? 1 : 0);
          return year + '/' + String(year + 1).slice(-2);
        };
        const dateCalls = await Promise.all(datesToFetch.map(async date => {
          try {
            // Champions sources require season even when filtering by date.
            const season = isCompetition ? seasonForDate(date) : null;
            const matches=await openFootAll('/matches', { date, ...param, ...(season ? { season } : {}) }, 5);
            return matches.map(match=>isCompetition ? {
              ...match,competitionId:match.competitionId ?? match.competition?.id ?? id,
              competitionName:match.competitionName || match.competition?.name || item.name || item.displayName || '',
              competition:match.competition || {id,name:item.name || item.displayName || ''}
            } : match);
          }
          catch (_) { return []; }
        }));
        // Team searches must not depend solely on the provider's capped daily list.
        const teamMatches = !isCompetition && dateCalls.flat().length === 0
          ? await openFootAll('/matches', param, 5).catch(() => [])
          : [];
        // Some provider sources return no rows for date+competition even when the
        // competition has scheduled fixtures. Also query the current season by its
        // stable competition ID, then let the normal upcoming/date filters decide.
        let seasonMatches = [];
        if (isCompetition) {
          try {
            // Many competition catalog entries do not include currentSeason.
            // A competition-only lookup is still worth trying in that case.
            seasonMatches = await openFootAll('/matches', {
              competition: id,
              ...(seasonForDate(requestedDate || today) ? { season: seasonForDate(requestedDate || today) } : {})
            }, 5);
          } catch (_) {
            // Keep date-scoped results if competition-wide lookup is unavailable.
          }
        }
        // Season-wide API rows often omit the competition object/name. Attach the
        // resolved catalog identity so the normal search filter can recognize them.
        const competitionName = item.name || item.displayName || item.competition?.name || item.label || '';
        const taggedSeasonMatches = seasonMatches.map(match => ({
          ...match,
          competitionId: match.competitionId ?? match.competition?.id ?? (isCompetition ? id : null),
          competitionName: match.competitionName || match.competition?.name || (isCompetition ? competitionName : ''),
          competition: match.competition || (isCompetition ? { id, name: competitionName } : {})
        }));
        return [...dateCalls.flat(), ...teamMatches, ...taggedSeasonMatches];
      }));
      allDayMatches = [...allDayMatches, ...entityMatches.flat()];
    }


    // API-Football supplements incomplete OpenFootAPI previews. Only use it for
    // explicit searches with no matching fixtures in the primary provider, to
    // preserve the free daily quota. Never fabricate missing statistics.
    let secondaryStatus = null;
    const eflHistory = new Map();
    const eflWanted = englishCompetition && eflSources[englishCompetition]
      ? [englishCompetition]
      : !query ? Object.keys(eflSources) : [];
    const calendarWarnings = [...dateBodies, ...scheduledBodies].filter(x=>x.providerError).map(()=> 'Calendario principale temporaneamente non disponibile.');
    const eflResults = await Promise.allSettled(eflWanted.map(key=>eflLeagueData(key)));
    for (let index=0; index<eflWanted.length; index++) {
      const key=eflWanted[index];
      try {
        if (eflResults[index].status !== 'fulfilled') throw eflResults[index].reason;
        const data = eflResults[index].value;
        // The EFL feed is the calendar authority for these competitions.
        // Avoid parallel duplicated OpenFoot games with incompatible team IDs.
        allDayMatches = allDayMatches.filter(m => {
          const comp = m.competition || m.league || {};
          const country = normSearch(m.country || comp.country);
          const title = normSearch(m.competitionName || comp.name);
          return !(country === 'england' && title.includes(key));
        });
        allDayMatches.push(...data.matches);
        for (const game of data.historical) {
          for (const id of [teamId(game.homeTeam), teamId(game.awayTeam)]) {
            const list = eflHistory.get(String(id)) || [];
            list.push(game);
            eflHistory.set(String(id), list);
          }
        }
        if (query) secondaryStatus = 'efl_calendar_' + data.matches.length + '_history_' + data.historyCount;
      } catch (error) {
        calendarWarnings.push('Calendario '+key+' temporaneamente non disponibile.');
        if (query) secondaryStatus = 'efl_error: ' + error.message;
      }
    }
    const faCupRequested = ['fa cup','the fa cup','emirates fa cup','fa cup england'].includes(normalizedQuery);
    if (faCupRequested || !query) {
      const days = requestedDate ? [requestedDate] : [today, tomorrow];
      let inserted = 0;
      for (const day of days) {
        const official = faCupSnapshots(day);
        // FA Cup replay names are independent from the EFL team catalog.
        allDayMatches.push(...official);
        inserted += official.length;
      }
      if (faCupRequested && inserted) secondaryStatus = 'fa_official_' + inserted;
    }
    if (query && !secondaryStatus?.startsWith('efl_calendar_') && !secondaryStatus?.startsWith('fa_official_')) {
      const matchesQuery = m => {
        const home = m.homeTeam || m.home || {};
        const away = m.awayTeam || m.away || {};
        const comp = m.competition || {};
        const text = normSearch([home.name, away.name, m.competitionName, comp.name, m.country, comp.country].join(' '));
        const ids = [teamId(home), teamId(away), m.competitionId, comp.id].filter(Boolean).map(String);
        const found = searchEntities.some(item => ids.includes(String(item.id ?? item.teamId ?? item.competitionId ?? item.team?.id ?? item.competition?.id)));
        return found || searchTerms.every(term => text.includes(term));
      };
      const primaryFound = allDayMatches.some(m => {
        const kickoff = new Date(m.kickoffAt || m.date || m.utcDate || m.fixture?.date || 0).getTime();
        return Number.isFinite(kickoff) && kickoff > now &&
          (requestedDate ? romeDate(kickoff) === requestedDate : kickoff <= cutoff) &&
          !['FT','LIVE','PST','CANC'].includes(statusCode(m.status ?? m.fixture?.status)) &&
          (englishCompetition
            ? normSearch(m.country || m.competition?.country) === 'england' &&
              normSearch(m.competitionName || m.competition?.name).includes(englishCompetition)
            : matchesQuery(m));
      });
      if (!primaryFound && apiFootballKey) {
        try {
          // Discover fixtures separately from historical analysis. Query the
          // date catalog first; if an explicitly named English league is
          // missing, resolve its real league ID rather than guessing IDs.
          const days = requestedDate ? [requestedDate] : [today, tomorrow];
          const found = [];
          let inspected = 0;
          for (const targetDate of days) {
            const daily = await apiFootball('fixtures', { date: targetDate, timezone: 'Europe/Rome' });
            const entries = Array.isArray(daily?.response) ? daily.response : [];
            inspected += entries.length;
            found.push(...entries);
          }
          const belongs = x => englishCompetition
            ? normSearch(x.league?.country) === 'england' &&
              normSearch(x.league?.name).includes(englishCompetition)
            : matchesQuery({
                homeTeam: x.teams?.home, awayTeam: x.teams?.away,
                competitionName: x.league?.name, country: x.league?.country
              });
          let matched = found.filter(belongs);
          if (!matched.length && englishCompetition) {
            const leaguesResult = await apiFootball('leagues', { search: englishCompetition });
            const leagues = Array.isArray(leaguesResult?.response) ? leaguesResult.response : [];
            const league = leagues.find(x => normSearch(x.country?.name) === 'england' &&
              normSearch(x.league?.name).includes(englishCompetition));
            if (league) {
              for (const targetDate of days) {
                const year = Number(targetDate.slice(0, 4));
                const month = Number(targetDate.slice(5, 7));
                const season = month < 7 ? year - 1 : year;
                const single = await apiFootball('fixtures', {
                  league: league.league.id, season, date: targetDate, timezone: 'Europe/Rome'
                });
                matched.push(...(Array.isArray(single?.response) ? single.response : []).filter(belongs));
              }
            }
          }
          const converted = matched.filter(x => x?.fixture?.id && x?.teams?.home && x?.teams?.away).map(x => ({
            id: 'apisports_' + x.fixture.id,
            kickoffAt: x.fixture.date,
            status: x.fixture.status?.short || 'NS',
            homeTeam: { id: 'apisports_' + x.teams.home.id, name: x.teams.home.name },
            awayTeam: { id: 'apisports_' + x.teams.away.id, name: x.teams.away.name },
            competition: { id: 'apisports_' + x.league.id, name: x.league.name, country: x.league.country },
            competitionId: 'apisports_' + x.league.id,
            competitionName: x.league.name,
            country: x.league.country,
            score: { home: x.goals?.home, away: x.goals?.away }
          }));
          allDayMatches.push(...converted);
          secondaryStatus = 'fixtures_returned_' + converted.length + '_from_' + inspected;

        } catch (error) {
          secondaryStatus = 'provider_error: ' + error.message;
        }
      } else if (!primaryFound) {
        secondaryStatus = 'missing_api_key';
      } else {
        secondaryStatus = 'primary_provider';
      }
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
        if (requestedDate) {
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
          if (englishCompetition) {
            const country = normSearch(m.country || comp.country);
            if (country !== 'england') return false;
            if (!normSearch(m.competitionName || comp.name).includes(englishCompetition)) return false;
          } else if (!directMatch && !searchTerms.every(term => searchable.includes(term))) return false;
        }
        const id = String(m.id || '');
        if (id && seen.has(id)) return false;
        if (id) seen.add(id);
        return true;
      })
      .sort((a, b) => new Date(a.kickoffAt || a.date || a.utcDate || 0) - new Date(b.kickoffAt || b.date || b.utcDate || 0))
      ;
    // API-Football IDs are not valid OpenFootAPI team IDs. Display those
    // fixtures even without stats instead of making misleading provider calls.
    const teamIds = [...new Set(upcoming.flatMap(m => [teamId(m.homeTeam || m.home), teamId(m.awayTeam || m.away)])
      .filter(id => id && !String(id).startsWith('apisports_') && !String(id).startsWith('efl_') && !String(id).startsWith('facup_')))];
    const forms = new Map();
    const warnings = [...new Set(calendarWarnings)];
    let teamCursor = 0;
    const formDeadline = Date.now() + 45000;
    const worker = async () => {
      while (teamCursor < teamIds.length && Date.now() < formDeadline) {
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
    if (teamCursor < teamIds.length) warnings.push('Tempo massimo per gli storici raggiunto: alcune squadre restano senza analisi.');
    // Merge EFL's real historical results into the existing CONF machinery.
    // Keep the latest 10 completed matches per team, with no future results.
    for (const [id, games] of eflHistory) {
      forms.set(id, games.filter(g => Date.parse(g.kickoffAt) < now)
        .sort((a,b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt)).slice(0, 10));
    }

    // National League / regional league results are mapped by explicit team
    // names. Both FA Cup participants may come from separate competitions.
    const faFixtures = upcoming.filter(m => String(m.id || '').startsWith('fa_official_'));
    for (const m of faFixtures) {
      const fixtureStart = Date.parse(m.kickoffAt);
      for (const team of [m.homeTeam, m.awayTeam]) {
        forms.set(String(teamId(team)), faCupHistoricalForm(teamName(team), Math.min(now, fixtureStart)));
      }
    }

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
      const homeSample = homeVenue.length >= 6 ? homeVenue : homeAll.filter(completed);
      const awaySample = awayVenue.length >= 6 ? awayVenue : awayAll.filter(completed);
      const combined = [...homeSample, ...awaySample];
      const pairedFrequency = (label, predicate) => {
        const a = frequency(homeSample, predicate, label);
        const b = frequency(awaySample, predicate, label);
        if (!a.sample || !b.sample) {
          const valid = combined.filter(completed);
          const result = frequency(valid, predicate, label);
          if (String(m.id || '').startsWith('fa_official_')) {
            result.partial = true;
            result.method = 'Dato parziale: storico disponibile per una sola squadra; non qualificabile CONF';
            result.venueSamples = { home: a.sample, away: b.sample };
          }
          return result;
        }
        return {
          label,
          score: Math.round(100 * (a.hits + b.hits) / (a.sample + b.sample)),
          hits: a.hits + b.hits,
          teamRates: [a.hits/a.sample, b.hits/b.sample],
          sample: a.sample + b.sample,
          venueSamples: { home: a.sample, away: b.sample },
          method: (homeVenue.length >= 6 ? 'casa' : 'forma generale') + ' / ' + (awayVenue.length >= 6 ? 'trasferta' : 'forma generale')
        };
      };
      const over25 = pairedFrequency('Over 2.5 FT', x => { const sc = goals(x); return sc.home + sc.away >= 3; });
      const btts = pairedFrequency('GG', x => { const sc = goals(x); return sc.home > 0 && sc.away > 0; });
      const over35 = pairedFrequency('Over 3.5 FT', x => { const sc = goals(x); return sc.home + sc.away >= 4; });
      const bttsOver25 = pairedFrequency('GG + Over 2.5 FT', x => { const sc = goals(x); return sc.home > 0 && sc.away > 0 && sc.home + sc.away >= 3; });
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
      // 1X2 uses home/away-specific results when there are at least 3
      // relevant games, consistently with Over 2.5 and GG.
      const homeResults = homeVenue.length >= 6 ? homeVenue : homeAll;
      const awayResults = awayVenue.length >= 6 ? awayVenue : awayAll;
      const hW = resultRate(homeResults, homeId, 'W');
      const hD = resultRate(homeResults, homeId, 'D');
      const hL = resultRate(homeResults, homeId, 'L');
      const aW = resultRate(awayResults, awayId, 'W');
      const aD = resultRate(awayResults, awayId, 'D');
      const aL = resultRate(awayResults, awayId, 'L');
      const rateMarket = (label, a, b) => {
        // Each side contributes equally: the home team's result and the away team's
        // opposite result. Keep actual hits; never fabricate a hit count from a rounded score.
        const sample = (a.sample || 0) + (b.sample || 0);
        const valid = a.rate !== null && b.rate !== null;
        const score = valid ? Math.round(100 * (a.rate + b.rate) / 2) : null;
        return { label, score, hits: valid ? a.hits + b.hits : 0, sample,
          method: 'Media delle frequenze delle due squadre (casa/trasferta se disponibili)',
          teamRates: valid ? [a.rate, b.rate] : [],
          venueSamples: { home: a.sample, away: b.sample } };
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
          one, draw, two, over25, btts, over35, bttsOver25
        },
        experimentalEstimate: experimentalGoalEstimate(homeVenue.length>=6?homeVenue:homeAll.filter(completed), awayVenue.length>=6?awayVenue:awayAll.filter(completed), homeId, awayId),
        cornerMarkets: buildCornerMarkets(teamName(homeTeam),teamName(awayTeam),m.competitionId || m.competition?.id || '', Date.parse(kickoff) || now)
      };
    });
    // Screen every future fixture returned by the calendar before enriching
    // the strongest candidates. The card uses this same selection object.
    for (const f of fixtures) {
      f.selection = selectFixture(f);
      f.rankScore = f.selection.primary?.evidence ?? -1;
    }
    fixtures.sort((a,b) => b.rankScore-a.rankScore || Date.parse(a.date)-Date.parse(b.date));
    const selectedCount = fixtures.filter(f=>f.selection.qualified).length;
    const analyzedCount = fixtures.length;
    fixtures = fixtures.slice(0, limit);
    let goalCursor=0;
    await Promise.all(Array.from({length:Math.min(4,fixtures.length)},async()=>{
      while(goalCursor<fixtures.length){
        const fixture=fixtures[goalCursor++];
        if (fixture.selection.qualified || query) fixture.providerExpectedGoals=await providerGoalContext(fixture.fixtureId);
      }
    }));
    const metaToday = todayBody?.meta || {};
    const metaTomorrow = tomorrowBody?.meta || {};
    const providerTotal = Number(metaToday.total_count || 0) + Number(metaTomorrow.total_count || 0);
    res.json({
      providerIssue: [...dateBodies, ...scheduledBodies].some(x=>x.providerCode === 'MONTHLY_QUOTA')
        ? {code:'MONTHLY_QUOTA',message:'OpenFootAPI: quota mensile di 5.000 richieste esaurita. Calendario completo e analisi non disponibili; le eventuali partite sotto provengono dalle fonti alternative.'}
        : calendarWarnings.length ? {code:'PARTIAL_CALENDAR',message:'Calendario incompleto: uno o più provider non sono disponibili.'} : null,
      secondaryStatus, windowHours: hours, query: query || null, date: requestedDate ? requestedDate : null, from: new Date(now).toISOString(), until: new Date(cutoff).toISOString(), warnings,
      method: 'Selezione: stima e frequenza storica almeno 60%, almeno 6 gare per ciascuna squadra e riscontro in entrambi gli storici. Ordinamento conservativo per campione e concordanza; modello sperimentale non calibrato. Quote non considerate.',
      threshold: 60, limit, analyzedCount, selectedCount, fixtures,
      preview: { returned: allDayMatches.length, totalAvailable: providerTotal || null, partial: calendarWarnings.length > 0 || Boolean(metaToday?.scope?.partial || metaTomorrow?.scope?.partial) || (providerTotal > 0 && allDayMatches.length < providerTotal), paginationAvailable: false },
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
      if (market.includes('over') && market.includes('2.5') && (market.includes('gg') || market.includes('entrambe'))) won = sc.home > 0 && sc.away > 0 && sc.home + sc.away >= 3;
      else if (market.includes('over') && market.includes('3.5')) won = sc.home + sc.away >= 4;
      else if (market.includes('over') && market.includes('2.5')) won = sc.home + sc.away >= 3;
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

