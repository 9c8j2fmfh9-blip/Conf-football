// Public JSON endpoints, no credentials and no billing integration.
export const LEAGUES = [
 ['uefa.champions','Champions League','Europa'],['uefa.europa','Europa League','Europa'],['uefa.europa.conf','Conference League','Europa'],
 ['eng.1','Premier League','Inghilterra'],['eng.2','Championship','Inghilterra'],['eng.3','League One','Inghilterra'],['eng.4','League Two','Inghilterra'],['eng.5','National League','Inghilterra'],['eng.fa','FA Cup','Inghilterra'],
 ['ita.1','Serie A','Italia'],['ita.2','Serie B','Italia'],['ger.1','Bundesliga','Germania'],['ger.2','2. Bundesliga','Germania'],['esp.1','La Liga','Spagna'],['esp.2','Segunda Division','Spagna'],['fra.1','Ligue 1','Francia'],['fra.2','Ligue 2','Francia'],['ned.1','Eredivisie','Paesi Bassi'],['por.1','Primeira Liga','Portogallo'],['bel.1','Pro League','Belgio'],['sco.1','Premiership','Scozia'],['tur.1','Super Lig','Turchia'],['usa.1','MLS','USA'],['bra.1','Serie A Brasile','Brasile'],['arg.1','Primera Division','Argentina']
].map(([id,name,country])=>({id,name,country}));
export const norm = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const romeDate = ms => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
export function seasonStart(now=Date.now()) { const d=new Date(now);return d.getUTCMonth()<6?d.getUTCFullYear()-1:d.getUTCFullYear(); }
const integer=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&/^\d+$/.test(String(v))?Number(v):null;
export function parseEvent(e,league) {
 const c=e?.competitions?.[0]; if(!c)return null;
 const h=c.competitors?.find(x=>x.homeAway==='home'),a=c.competitors?.find(x=>x.homeAway==='away');
 const state=c.status?.type||e.status?.type||{};
 const date=c.date||e.date,stamp=Date.parse(date);
 if(!h?.team?.id||!a?.team?.id||!Number.isFinite(stamp))return null;
 const score=x=>integer(typeof x.score==='object'?x.score?.displayValue:x.score);
 // Only regulation full-time results enter goal and corner models.
 const completed=state.completed===true&&['STATUS_FULL_TIME','STATUS_FINAL'].includes(state.name);
 const scheduled=state.state==='pre'&&/SCHEDULED/.test(state.name||'')&&c.timeValid!==false&&e.timeValid!==false;
 return {id:String(e.id),date,stamp,homeId:String(h.team.id),awayId:String(a.team.id),home:h.team.displayName||h.team.name,away:a.team.displayName||a.team.name,
  homeGoals:completed?score(h):null,awayGoals:completed?score(a):null,status:completed?'FT':scheduled?'NS':'OTHER',league:league.name,leagueId:league.id,country:league.country,
  source:'ESPN',sourceUrl:`https://www.espn.com/soccer/match/_/gameId/${e.id}`};
}
export function safeHistory(games,before=Date.now()) {
 const seen=new Set();
 return games.filter(g=>g&&g.status==='FT'&&g.stamp<before&&g.homeGoals!==null&&g.awayGoals!==null&&!seen.has(g.id)&&seen.add(g.id))
  .sort((a,b)=>a.stamp-b.stamp);
}
export function selectUpcoming(games,{now=Date.now(),hours=24,date='',query=''}={}) {
 const terms=norm(query).split(' ').filter(Boolean),seen=new Set();
 return games.filter(g=>{
  if(!g||g.status!=='NS'||g.stamp<=now)return false;
  if(date ? romeDate(g.stamp)!==date : g.stamp>now+hours*3600000)return false;
  const text=norm([g.home,g.away,g.league,g.country].join(' '));
  if(!terms.every(t=>text.includes(t)))return false;
  // Stable event identity across multiple competition/date responses.
  if(seen.has(g.id))return false;seen.add(g.id);return true;
 }).sort((a,b)=>a.stamp-b.stamp);
}
export function cornerValues(body,event) {
 const header=body.header?.competitions?.[0];
 if(String(body.header?.id)!==event.id||!header?.status?.type?.completed||Date.parse(header.date)>=Date.now())return null;
 const teams=body.boxscore?.teams||[];
 const value=id=>{
  const s=teams.find(t=>String(t.team?.id)===id)?.statistics?.find(x=>x.name==='wonCorners');
  return s?integer(s.displayValue):null;
 };
 const home=value(event.homeId),away=value(event.awayId);
 return home===null||away===null?null:{id:event.id,date:event.date,home,away,total:home+away};
}
export function buildCornerMarkets(home,away,homeRows,awayRows) {
 const make=(label,rs,fn)=>{const hits=rs.filter(fn).length;return {label,hits,sample:rs.length,score:rs.length?Math.round(hits*100/rs.length):null,qualified:rs.length>=6&&hits/rs.length>=.7};};
 const markets=[];
 for(const line of [2,3,4,5]){
  markets.push(make(`${home} · Over ${line-.5} corner FT`,homeRows,r=>r.own>=line));
  markets.push(make(`${away} · Over ${line-.5} corner FT`,awayRows,r=>r.own>=line));
 }
 const pooled=[...new Map([...homeRows,...awayRows].map(r=>[r.id,r])).values()];
 for(const line of [7,8,9,10]){const m=make(`Totale · Over ${line-.5} corner FT`,pooled,r=>r.total>=line);m.partial=homeRows.length<6||awayRows.length<6;m.qualified=m.qualified&&!m.partial;markets.push(m);}
 return {markets,homeSample:homeRows.length,awaySample:awayRows.length,source:'ESPN · statistiche FT',note:'Percentuali = frequenze storiche. I corner per tempo non sono ricostruiti dai totali.'};
}
export function createDataClient(fetcher=globalThis.fetch) {
 const cache=new Map(),pending=new Map(); let active=0; const queue=[];
 async function limited(fn){if(active>=4)await new Promise(r=>queue.push(r));active++;try{return await fn();}finally{active--;queue.shift()?.();}}
 async function get(url,ttl=15*60000){
  const old=cache.get(url);if(old&&Date.now()-old.at<ttl)return old.value;
  if(pending.has(url))return pending.get(url);
  const work=limited(async()=>{
   let value;
   for(let attempt=0;attempt<2;attempt++){
    try{
     const r=await fetcher(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
     if(!r.ok){const e=new Error(`Fonte ESPN: HTTP ${r.status}`);e.retryable=r.status>=500;throw e;}
     value=await r.json();break;
    }catch(e){
     if(attempt||e.retryable===false)throw e;
     await new Promise(resolve=>setTimeout(resolve,300));
    }
   }
   cache.set(url,{at:Date.now(),value});
   if(cache.size>2500)cache.delete(cache.keys().next().value);
   return value;
  }).finally(()=>pending.delete(url));pending.set(url,work);return work;
 }
 const root='https://site.api.espn.com/apis/site/v2/sports/soccer/';
 async function calendar(league,dates){
  // Soccer scoreboards accept a single day. Fetch each day explicitly.
  const parts=dates.split('-'),start=parts[0],end=parts[1]||parts[0];
  const days=[];for(let t=Date.parse(start.slice(0,4)+'-'+start.slice(4,6)+'-'+start.slice(6,8)+'T12:00Z');;t+=86400000){
   const d=new Date(t).toISOString().slice(0,10).replaceAll('-','');days.push(d);if(d>=end||days.length>=3)break;
  }
  const results=await Promise.all(days.map(async date=>{
   const body=await get(root+league.id+'/scoreboard?dates='+date+'&limit=100',5*60000);
   if(!Array.isArray(body.events))throw new Error('Calendario non riconosciuto: '+league.name);
   return body.events.map(e=>parseEvent(e,league)).filter(Boolean);
  }));return results.flat();
 }
 async function teamHistory(league,id,year){
  if(!/^\d+$/.test(String(id)))throw new Error('ID squadra non valido');
  const body=await get(root+'all/teams/'+id+'/schedule?season='+year,60*60000);
  if(!Array.isArray(body.events))throw new Error('Storico squadra non disponibile');
  return body.events.map(e=>parseEvent(e,league)).filter(Boolean);
 }
 async function corners(events,id){
  const recent=safeHistory(events).filter(e=>e.homeId===id||e.awayId===id).slice(-8).reverse();
  const result=await Promise.allSettled(recent.map(async e=>{
   const body=await get(root+'all/summary?event='+e.id,24*3600000);
   const v=cornerValues(body,e);return v?{...v,own:e.homeId===id?v.home:v.away}:null;
  }));
  return result.flatMap(r=>r.status==='fulfilled'&&r.value?[r.value]:[]);
 }
 return {calendar,teamHistory,corners};
}
