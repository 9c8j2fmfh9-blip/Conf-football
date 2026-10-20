import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {selectFixture} from './conf-selection.js';

const snapshotPath=new URL('./open-data-snapshot.json',import.meta.url);
let dataset=JSON.parse(readFileSync(snapshotPath,'utf8'));
let refreshAt=0, refreshing=null, indexed=null;
const rawBase='https://raw.githubusercontent.com/oladeeayo/open-matchday/master/';
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// Explicit spelling aliases, never fuzzy matches between unrelated clubs.
const aliases={
 'fc bayern munchen':'bayern munich','losc lille':'lille','rc lens':'lens','vfb stuttgart':'stuttgart','psv eindhoven':'psv',
 'inter':'internazionale','inter milan':'internazionale','man utd':'manchester united','man united':'manchester united',
 'man city':'manchester city','b dortmund':'borussia dortmund','dortmund':'borussia dortmund',
 'bayern munchen':'bayern munich','bayern':'bayern munich','leipzig':'rb leipzig',
 'atleti':'atletico madrid','atletico de madrid':'atletico madrid','paris':'paris saint germain','psg':'paris saint germain',
 'shakhtar':'shakhtar donetsk','sporting cp':'sporting lisbon','sporting':'sporting lisbon',
 's bratislava':'slovan bratislava','slavia praha':'slavia prague','barrow afc':'barrow',
 'harrogate town afc':'harrogate town'
};
const club=x=>aliases[norm(x)]||norm(x);
Object.assign(aliases,{'atl san luis':'atletico de san luis',juarez:'fc juarez',tigres:'tigres uanl',levante:'levante ud','ath bilbao':'athletic club','betis':'real betis','rb lipsia':'rb leipzig','manchester utd':'manchester united',lilla:'lille',sporting:'sporting lisbon',kyoto:'kyoto sanga',kashima:'kashima antlers','g osaka':'gamba osaka','c osaka':'cerezo osaka',kawasaki:'kawasaki frontale',kobe:'vissel kobe',nagoya:'nagoya grampus',okayama:'fagiano okayama',mito:'mito hollyhock',shimizu:'shimizu s pulse',machida:'machida zelvia',tokyo:'fc tokyo',kashiwa:'kashiwa reysol',hiroshima:'sanfrecce hiroshima','yokohama m':'yokohama f marinos',verdy:'tokyo verdy 1969',urawa:'urawa red diamonds',chiba:'jef united ichihara chiba'});
export const canonicalClub=club;
export function parseCsv(text){
 const lines=String(text||'').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const parse=line=>{const cells=[];let cell='',quoted=false;for(let i=0;i<line.length;i++){
  const c=line[i];if(c==='"'&&quoted&&line[i+1]==='"'){cell+='"';i++;}
  else if(c==='"')quoted=!quoted;else if(c===','&&!quoted){cells.push(cell);cell='';}else cell+=c;
 }cells.push(cell);return cells;};
 const keys=parse(lines.shift()||'');
 if(!['date','home','away'].every(k=>keys.includes(k)))throw Error('Schema CSV non valido');
 return lines.filter(Boolean).map(line=>{const values=parse(line);return Object.fromEntries(keys.map((k,i)=>[k,values[i]||'']));});
}
const validScore=v=>/^\d+$/.test(String(v));
// Upstream builder.py writes UTC date with clock = UTC+1 (fixed CET),
// not Europe/London. Preserve the UTC date when this clock wraps midnight.
export function datasetKickoff(date,time){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null;
 const [h,m]=time.split(':').map(Number);if(h>23||m>59)return null;
 return date+'T'+String((h+23)%24).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00Z';
}
function makeIndex(data){
 const leagues=data.leagues.map(l=>({...l,fixtures:parseCsv(l.fixturesCsv),results:parseCsv(l.resultsCsv)}));
 const countries=new Map();
 for(const l of leagues.filter(l=>l.country!=='UEFA'&&!l.id.includes('_CUP_'))){
  for(const row of [...l.fixtures,...l.results])for(const name of [row.home,row.away]){
   const key=club(name);if(!countries.has(key))countries.set(key,new Set());countries.get(key).add(l.country);
  }
 }
 const team=(name,country)=>{
  const key=club(name);const candidates=countries.get(key);
  const scope=country==='UEFA'&&candidates?.size===1?[...candidates][0]:country;
  return{id:'open_'+norm(scope).replaceAll(' ','_')+'_'+key.replaceAll(' ','_'),name};
 };
 const history=new Map(),seen=new Set(),fixtures=[];
 const addHistory=m=>{for(const t of [m.homeTeam,m.awayTeam]){if(!history.has(t.id))history.set(t.id,[]);history.get(t.id).push(m);}};
 for(const l of leagues){
  for(const r of l.results){
   if(!validScore(r.ft_home)||!validScore(r.ft_away)||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))continue;
   const home=team(r.home,l.country),away=team(r.away,l.country);
   const key=r.date+'_'+home.id+'_'+away.id;if(seen.has(key))continue;seen.add(key);
   addHistory({id:'history_'+key,kickoffAt:r.date+'T12:00:00Z',resultDate:r.date,status:'FT',homeTeam:home,awayTeam:away,
    score:{home:Number(r.ft_home),away:Number(r.ft_away),halfTime:{home:validScore(r.ht_home)?Number(r.ht_home):null,away:validScore(r.ht_away)?Number(r.ht_away):null}},
    corners:{home:validScore(r.home_corners)?Number(r.home_corners):null,away:validScore(r.away_corners)?Number(r.away_corners):null},
    sourceLeague:l.id,updatedAt:l.updatedAt||data.generatedAt});
  }
  for(const r of l.fixtures){
   const kickoff=datasetKickoff(r.date,r.time);if(!kickoff)continue; // unknown kickoff cannot safely be classified as future
   const home=team(r.home,l.country),away=team(r.away,l.country);
   fixtures.push({id:'open_'+l.id+'_'+r.date+'_'+club(r.home).replaceAll(' ','_')+'_'+club(r.away).replaceAll(' ','_'),
    kickoffAt:kickoff,status:'NS',homeTeam:home,awayTeam:away,competitionId:l.id,competitionName:l.name,country:l.country,
    competition:{id:l.id,name:l.name,country:l.country},updatedAt:l.updatedAt||data.generatedAt});
  }
 }
 return{leagues,fixtures,history};
}
function getIndex(){if(!indexed)indexed=makeIndex(dataset);return indexed;}
async function fetchText(path){
 const response=await fetch(rawBase+path,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'CONF-Football personal dashboard'}});
 if(!response.ok)throw Error('HTTP '+response.status);return response.text();
}
export async function refreshOpenData(){
 if(refreshing)return refreshing;
 if(Date.now()<refreshAt)return;
 refreshAt=Date.now()+6*3600000;
 refreshing=(async()=>{
  const summary=JSON.parse(await fetchText('build_summary.json'));
  if(!summary.generated_utc||!Number.isFinite(Date.parse(summary.generated_utc)))throw Error('Data aggiornamento mancante');
  if(summary.season!==dataset.season)throw Error('Stagione fonte diversa: aggiornare la configurazione');
  if(summary.generated_utc===dataset.generatedAt)return;
  const previous=dataset;
  const updated=previous.leagues.map(l=>({...l}));let cursor=0,success=0;
  await Promise.all(Array.from({length:6},async()=>{while(cursor<updated.length){
   const l=updated[cursor++];try{
    const [fixturesCsv,resultsCsv]=await Promise.all(['fixtures','results'].map(kind=>fetchText('data/'+l.id+'/'+kind+'_'+previous.season+'.csv')));
    parseCsv(fixturesCsv);parseCsv(resultsCsv);
    Object.assign(l,{fixturesCsv,resultsCsv,updatedAt:summary.generated_utc});success++;
   }catch{/* Keep the last usable version of this league; freshness remains visible. */}
  }}));
  if(!success)return;
  const next={...previous,generatedAt:success===updated.length?summary.generated_utc:previous.generatedAt,leagues:updated};
  const nextIndex=makeIndex(next);dataset=next;indexed=nextIndex;
  try{if(process.env.NODE_ENV==='test')return;const temp=new URL('./open-data-snapshot.tmp',import.meta.url);writeFileSync(temp,JSON.stringify(next));renameSync(temp,snapshotPath);}catch{/* Memory cache still works on a read-only host. */}
 })().catch(()=>{refreshAt=Date.now()+15*60000;}).finally(()=>{refreshing=null;});
 return refreshing;
}
const romeFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'});
const dayRome=timestamp=>romeFormatter.format(new Date(timestamp));
const sampleFor=(index,t,now,beforeDay)=> (index.history.get(t.id)||[])
 .filter(m=>m.resultDate<beforeDay&&Date.parse(m.resultDate+'T23:59:59Z')<now)
 .sort((a,b)=>b.resultDate.localeCompare(a.resultDate)).slice(0,10);
const teamStats=(games,id)=>{
 const values=games.map(m=>{const home=m.homeTeam.id===id;return{for:home?m.score.home:m.score.away,against:home?m.score.away:m.score.home};});
 return {sample:values.length,averageFor:values.length?values.reduce((s,v)=>s+v.for,0)/values.length:null,averageAgainst:values.length?values.reduce((s,v)=>s+v.against,0)/values.length:null};
};
function marketsFor(home,away,homeId,awayId){
 const own=(m,id)=>m.homeTeam.id===id?[m.score.home,m.score.away]:[m.score.away,m.score.home];
 const definitions={one:['1 · vittoria casa',m=>{const[a,b]=own(m,homeId);return a>b;},m=>{const[a,b]=own(m,awayId);return a<b;}],
 draw:['X · pareggio',m=>m.score.home===m.score.away,m=>m.score.home===m.score.away],
 two:['2 · vittoria trasferta',m=>{const[a,b]=own(m,homeId);return a<b;},m=>{const[a,b]=own(m,awayId);return a>b;}],
 over25:['Over 2.5 FT',m=>m.score.home+m.score.away>=3,m=>m.score.home+m.score.away>=3],
 btts:['GG',m=>m.score.home>0&&m.score.away>0,m=>m.score.home>0&&m.score.away>0],
 over35:['Over 3.5 FT',m=>m.score.home+m.score.away>=4,m=>m.score.home+m.score.away>=4],
 bttsOver25:['GG + Over 2.5 FT',m=>m.score.home>0&&m.score.away>0&&m.score.home+m.score.away>=3,m=>m.score.home>0&&m.score.away>0&&m.score.home+m.score.away>=3]};
 return Object.fromEntries(Object.entries(definitions).map(([key,[label,h,a]])=>{
  const hh=home.filter(h).length,ah=away.filter(a).length,valid=home.length>0&&away.length>0;
  const rates=valid?[hh/home.length,ah/away.length]:[];
  return[key,{label,score:valid?Math.round(50*(rates[0]+rates[1])):null,hits:hh+ah,sample:home.length+away.length,
   venueSamples:{home:home.length,away:away.length},teamRates:rates,partial:!valid,method:'Media dei riscontri nelle ultime gare di ciascuna squadra · stagione corrente'}];
 }));
}
function cornersFor(home,away,homeId,awayId){
 const convert=(games,id)=>games.map(m=>({own:m.homeTeam.id===id?m.corners.home:m.corners.away,
 total:m.corners.home!==null&&m.corners.away!==null?m.corners.home+m.corners.away:null}));
 const h=convert(home,homeId),a=convert(away,awayId),markets=[];
 const add=(label,values,line)=>{const v=values.filter(x=>x!==null);const hits=v.filter(x=>x>=line).length;markets.push({label,score:v.length?Math.round(100*hits/v.length):null,hits,sample:v.length,qualified:v.length>=6&&hits/v.length>=.6});};
 for(const line of [2,3,4,5]){add('Casa · '+line+'+ corner FT',h.map(x=>x.own),line);add('Trasferta · '+line+'+ corner FT',a.map(x=>x.own),line);}
 for(const line of [7,8,9,10])add('Totale '+line+'+ corner FT',[...h,...a].map(x=>x.total),line);
 return{markets,homeSample:h.filter(x=>x.own!==null).length,awaySample:a.filter(x=>x.own!==null).length,
 note:'Corner osservati nei risultati disponibili. Dati talvolta in ritardo; nessuna stima per tempo quando mancano i dati.'};
}
export function openDataConf(params,estimate,{now=Date.now(),data=null,allFixtures=false}={}){
 const index=data?makeIndex(data):getIndex();
 if(!data&&process.env.NODE_ENV!=='test')void refreshOpenData();
 const source=data||dataset;
 const date=/^\d{4}-\d{2}-\d{2}$/.test(String(params.date||''))?String(params.date):'';
 const hours=Math.min(48,Math.max(1,parseInt(params.hours||'24',10)||24));
 const limit=Math.min(200,Math.max(1,parseInt(params.limit||'60',10)||60));
 let query=norm(params.q);
 const searchAliases={'ucl':'uefa champions league','champion league':'champions league','champions':'champions league','serie a italiana':'serie a','league 1':'league one','league 2':'league two'};
 query=searchAliases[query]||query;
 const competitionMatches=index.leagues.filter(l=>query&&query.split(' ').every(t=>norm(l.name).includes(t))&&
  (!['league one','league two','championship'].includes(query)||l.country==='England'));
 const competitionIds=new Set(competitionMatches.map(l=>l.id));
 const seen=new Set();
 const matches=index.fixtures.filter(m=>{
  const kickoff=Date.parse(m.kickoffAt);if(kickoff<=now)return false;
  if(date?dayRome(kickoff)!==date:kickoff>now+hours*3600000)return false;
  if(query){if(competitionIds.size){if(!competitionIds.has(m.competitionId))return false;}
   else if(!query.split(' ').every(t=>norm(m.homeTeam.name+' '+m.awayTeam.name+' '+m.competitionName).includes(t)))return false;}
  const key=m.competitionId+'_'+dayRome(kickoff)+'_'+m.homeTeam.id+'_'+m.awayTeam.id;if(seen.has(key))return false;seen.add(key);return true;
 });
 const fixtures=matches.map(m=>{
  const beforeDay=new Date(Math.min(now,Date.parse(m.kickoffAt))).toISOString().slice(0,10);
  const h=sampleFor(index,m.homeTeam,now,beforeDay),a=sampleFor(index,m.awayTeam,now,beforeDay);
  const stale=now-Date.parse(m.updatedAt)>72*3600000||[...h,...a].some(x=>now-Date.parse(x.updatedAt)>72*3600000);
  const f={fixtureId:m.id,date:m.kickoffAt,status:'NS',home:m.homeTeam.name,away:m.awayTeam.name,league:m.competitionName,country:m.country,
   markets:marketsFor(h,a,m.homeTeam.id,m.awayTeam.id),experimentalEstimate:estimate(h,a,m.homeTeam.id,m.awayTeam.id),
   form:{home:{recentOverall:teamStats(h,m.homeTeam.id)},away:{recentOverall:teamStats(a,m.awayTeam.id)}},
   cornerMarkets:cornersFor(h,a,m.homeTeam.id,m.awayTeam.id),
   providerExpectedGoals:{available:false,reason:'Questa fonte gratuita non fornisce xG. I gol attesi CONF sono una stima distinta.'},
   dataUpdatedAt:m.updatedAt,source:'Open Matchday · risultati stagione corrente',dataStale:stale};
  f.selection=selectFixture(f);
  if(stale)f.selection={qualified:false,primary:null,candidates:[],reason:'Dati non aggiornati nelle ultime 72 ore: selezione sospesa.'};
  f.rankScore=f.selection.primary?.evidence??-1;return f;
 });
 fixtures.sort((a,b)=>b.rankScore-a.rankScore||Date.parse(a.date)-Date.parse(b.date));
 const selectedCount=fixtures.filter(f=>f.selection.qualified).length;
 const staleCount=fixtures.filter(f=>f.dataStale).length;
 return{query:params.q||null,date:date||null,windowHours:hours,analyzedCount:fixtures.length,selectedCount,fixtures:allFixtures?fixtures:fixtures.slice(0,limit),threshold:60,
  provider:'Open Matchday',dataUpdatedAt:source.generatedAt,competitionsCovered:index.leagues.length,
  providerIssue:staleCount?{code:'STALE_DATA',message:'Alcuni dati hanno più di 72 ore: le relative selezioni sono sospese.'}:null,
  warnings:staleCount?['Aggiornamento archivio in ritardo.']:[],preview:{returned:matches.length,totalAvailable:matches.length,partial:true},
  method:'Calendari e risultati 2026/27 da Open Matchday: '+index.leagues.length+' competizioni. Aggiornamento archivio '+source.generatedAt+'. Campioni recenti di almeno 6 gare per squadra; modello sperimentale non calibrato, quote non considerate. Copertura limitata alle competizioni elencate nella fonte.',
  sourceUrl:source.source,note:'Fonte gratuita con aggiornamento periodico, non un servizio live. xG e dati per tempo non vengono inventati.'};
}
