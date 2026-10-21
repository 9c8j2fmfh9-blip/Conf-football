import {getSisalCalendar,sisalClub} from './sisal-online.js';
import {enrichHistory} from './diretta-history.js';
import {openDataConf,canonicalClub} from './open-data.js';
import {getDirettaDay,italianDay} from './diretta-calendar.js';
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const countries={giappone:'japan',europa:'uefa',inghilterra:'england',italia:'italy',spagna:'spain',germania:'germany',francia:'france',brasile:'brazil',messico:'mexico',portogallo:'portugal',olanda:'netherlands',scozia:'scotland',belgio:'belgium',grecia:'greece',turchia:'turkey',svizzera:'switzerland',svezia:'sweden',norvegia:'norway',danimarca:'denmark',finlandia:'finland',polonia:'poland',austria:'austria',ucraina:'ukraine',russia:'russia','repubblica ceca':'czech republic','corea del sud':'south korea','sud corea':'south korea',cina:'china',irlanda:'ireland',galles:'wales',colombia:'colombia',argentina:'argentina',cile:'chile',peru:'peru',paraguay:'paraguay',uruguay:'uruguay',venezuela:'venezuela',ecuador:'ecuador',bolivia:'bolivia',croazia:'croatia',romania:'romania',serbia:'serbia',slovacchia:'slovakia',slovenia:'slovenia',ungheria:'hungary',israele:'israel',sudafrica:'south africa','arabia saudita':'saudi arabia',costarica:'costa rica'};
const country=x=>countries[norm(x)]||norm(x);
const key=f=>[Date.parse(f.date),canonicalClub(f.home),canonicalClub(f.away),country(f.country)].join('|');
export function mergeCalendar(base,events,{now=Date.now(),params={},coverage={}}={}){
 const matches=new Map();for(const f of base.fixtures){const k=key(f);if(!matches.has(k))matches.set(k,[]);matches.get(k).push(f);}
 const hours=Math.min(48,Math.max(1,parseInt(params.hours||24,10)||24));
 const date=/^\d{4}-\d{2}-\d{2}$/.test(String(params.date||''))?String(params.date):'';
 let query=norm(params.q);const onlyUEFA=['ucl','champions','champion league','champions league','uefa champions league'].includes(query);query=onlyUEFA?'champions league':({'league 1':'league one','league 2':'league two','japan':'giappone'})[query]||query;
 const seen=new Set();let fixtures=events.filter(e=>{
  const at=Date.parse(e.date);if(e.status!=='NS'||at<=now||!Number.isFinite(at))return false;
  if(date?italianDay(at)!==date:at>now+hours*3600000)return false;
  if(seen.has(e.id))return false;seen.add(e.id);return true;
 }).map(e=>{
  const known=matches.get(key(e));
  if(known?.length===1)return{...known[0],date:e.date,calendarSource:'Diretta.it',direttaId:e.id,calendarLeague:e.league,calendarCountry:e.country};
  return{fixtureId:'diretta_'+e.id,date:e.date,status:'NS',home:e.home,away:e.away,league:e.league,country:e.country,calendarSource:'Diretta.it',direttaId:e.id,
   markets:{},experimentalEstimate:{available:false,reason:'Storico delle due squadre non disponibile nella fonte statistica collegata.'},selection:{qualified:false,primary:null,candidates:[],reason:'Partita in calendario · dati storici insufficienti per una proposta CONF.'},rankScore:-1,cornerMarkets:{markets:[],note:'Dati corner non disponibili.'},providerExpectedGoals:{available:false,reason:'xG non disponibili.'}};
 });
 if(query){const isEnglish=['league one','league two','championship'].includes(query),countryQuery=Object.hasOwn(countries,query)||Object.values(countries).includes(query);
  fixtures=fixtures.filter(f=>countryQuery?country(f.country)===country(query):(!isEnglish||country(f.country)==='england')&&(!onlyUEFA||country(f.country)==='uefa')&&query.split(' ').every(t=>norm([f.home,f.away,f.league,f.country,f.calendarLeague,f.calendarCountry].join(' ')).includes(t)));}
 fixtures.sort((a,b)=>(b.rankScore??-1)-(a.rankScore??-1)||Date.parse(a.date)-Date.parse(b.date)||String(a.fixtureId).localeCompare(String(b.fixtureId)));
 const selectedCount=fixtures.filter(f=>f.selection?.qualified).length,analyzedCount=fixtures.filter(f=>f.experimentalEstimate?.available).length;
 return{...base,fixtures,query:params.q||null,date:date||null,windowHours:hours,calendarCount:fixtures.length,analyzedCount,selectedCount,provider:'Diretta.it · analisi Open Matchday',calendarCoverage:coverage,
  preview:{returned:fixtures.length,totalAvailable:fixtures.length,partial:!!coverage.partial},providerIssue:coverage.issue?{code:'CALENDAR_PARTIAL',message:coverage.issue}:base.providerIssue,
  method:'Calendario giornaliero da Diretta.it, incluse categorie minori, giovanili e femminili. Solo partite non ancora iniziate. Le analisi usano i risultati della fonte statistica collegata: quando mancano, la partita resta visibile con dati insufficienti. '+(base.method||'')};
}
export async function statisticalCalendarConf(params,estimate,{now=Date.now(),getDay=getDirettaDay,baseData=null,hydrate=process.env.NODE_ENV!=='test'}={}){
 const base=baseData||openDataConf({...params,q:''},estimate,{now,allFixtures:true});
 const hours=Math.min(48,Math.max(1,parseInt(params.hours||24,10)||24));
 const date=/^\d{4}-\d{2}-\d{2}$/.test(String(params.date||''))?String(params.date):'';
 const targetDays=date?[date]:[...new Set([italianDay(now),italianDay(now+hours*3600000),...(hours>24?[italianDay(now+24*3600000)]:[])])];
 const requested=[...new Set(targetDays.flatMap(day=>[-1,0,1].map(delta=>new Date(Date.parse(day+'T12:00:00Z')+delta*86400000).toISOString().slice(0,10))))];
 const results=await Promise.all(requested.map(day=>getDay(day,{now})));
 if(results.every(r=>!r.fetchedAt))return{...(baseData||openDataConf(params,estimate,{now,allFixtures:true})),calendarCount:base.fixtures.length,providerIssue:{code:'CALENDAR_UNAVAILABLE',message:'Calendario Diretta non disponibile: elenco limitato alla copertura statistica.'},calendarCoverage:{partial:true,issue:results.map(r=>r.issue).filter(Boolean).join('; ')}};
 const issue=results.filter(r=>!r.fetchedAt||r.issue||now-Date.parse(r.fetchedAt)>30*60000);
 const merged=mergeCalendar(base,results.flatMap(r=>r.events||[]),{now,params,coverage:{days:targetDays,feedDays:requested,source:'https://www.diretta.it/',fetchedAt:results.map(r=>r.fetchedAt).filter(Boolean).sort()[0],partial:issue.length>0,issue:issue.length?'Aggiornamento di parte del calendario non riuscito; controlla l’orario della fonte.':null}});
 return hydrate?enrichHistory(merged,estimate,{now}):merged;
}

export function mergeSisalCalendar(base,feed,params={},now=Date.now()){
 const identity=f=>[Date.parse(f.date),sisalClub(f.home),sisalClub(f.away)].join('|');
 const known=new Map();for(const f of base.fixtures){const k=identity(f);known.set(k,[...(known.get(k)||[]),f]);}
 const hours=Math.min(48,Math.max(1,parseInt(params.hours||24,10)||24));
 const date=/^\d{4}-\d{2}-\d{2}$/.test(String(params.date||''))?String(params.date):'';
 const query=norm(params.q),ucl=['ucl','champions','champion league','champions league','uefa champions league'].includes(query);
 const seen=new Set();const fixtures=feed.events.filter(e=>{
  const at=Date.parse(e.date);if(e.status!=='NS'||at<=now||!Number.isFinite(at)||seen.has(e.id))return false;
  if(date?italianDay(at)!==date:at>now+hours*3600000)return false;
  const text=norm([e.home,e.away,e.league].join(' '));if(query&&(ucl?e.competitionKey!=='1-856':!query.split(' ').every(t=>text.includes(t))))return false;
  seen.add(e.id);return true;
 }).map(e=>{
  const candidates=known.get(identity(e));const old=candidates?.length===1?candidates[0]:null;
  const f=old?{...old}:{fixtureId:'sisal_'+e.eventId,markets:{},experimentalEstimate:{available:false,reason:'Storico delle due squadre non disponibile nella fonte statistica collegata.'},selection:{qualified:false,primary:null,candidates:[],reason:'Dati storici insufficienti per una proposta CONF.'},rankScore:-1};
  const selection=f.selection||{};
  const qualified=(selection.candidates||[]).filter(p=>p.kind==='corner'||e.odds[p.key]>1);
  const goalPrimary=qualified.find(p=>p.kind!=='corner')||null,cornerPrimary=qualified.find(p=>p.kind==='corner')||null;
  return {...f,home:e.home,away:e.away,date:e.date,status:'NS',league:old?.league||e.league,calendarLeague:e.league,calendarSource:'Sisal online',sisalEventId:e.eventId,sisalRegulatorKey:e.id,bookmaker:'Sisal',bookmakerVerifiedAt:e.verifiedAt,sisalMarketOdds:e.odds,
   selection:{...selection,candidates:qualified,primary:goalPrimary||cornerPrimary,goalPrimary,cornerPrimary,qualified:qualified.length>0},rankScore:(goalPrimary||cornerPrimary)?.evidence??-1};
 });
 fixtures.sort((a,b)=>b.rankScore-a.rankScore||Date.parse(a.date)-Date.parse(b.date));
 return {...base,fixtures,provider:'Sisal online · analisi CONF',calendarCount:fixtures.length,analyzedCount:fixtures.filter(f=>f.experimentalEstimate?.available).length,selectedCount:fixtures.filter(f=>f.selection?.qualified).length,
  bookmakerCoverage:{source:'Sisal online',sourceUpdatedAt:feed.fetchedAt,competitions:feed.competitions,partial:feed.partial},
  preview:{returned:fixtures.length,totalAvailable:fixtures.length,partial:feed.partial},providerIssue:feed.partial?{code:'SISAL_PARTIAL',message:'Palinsesto Sisal parziale: '+(feed.issue||'alcune competizioni non sono aggiornate')}:null,
  method:'Calendario letto dal servizio online Sisal, senza usare i fogli PDF come filtro. Solo partite future aperte. Analisi mantenute soltanto con abbinamento univoco di squadre e orario; nessuna percentuale inventata. '+(base.method||'')};
}
export async function calendarConf(params,estimate,options={}){
 // Keep the independent historical calendar injectable for its regression tests.
 if(options.getDay&&!options.getSisal)return statisticalCalendarConf(params,estimate,options);
 const now=options.now??Date.now();
 const [base,feed]=await Promise.all([statisticalCalendarConf({...params,q:''},estimate,{...options,now}),(options.getSisal||getSisalCalendar)({now})]);
 if(!feed.fetchedAt||!feed.events.length)return {...base,providerIssue:{code:'SISAL_UNAVAILABLE',message:'Palinsesto Sisal online non disponibile: elenco generale temporaneo, disponibilità sul bookmaker non verificata.'}};
 return mergeSisalCalendar(base,feed,params,now);
}
