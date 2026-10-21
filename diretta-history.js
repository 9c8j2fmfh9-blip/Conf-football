import {gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {marketsFor,teamStats,canonicalClub} from './open-data.js';
import {selectFixture} from './conf-selection.js';

const fields=block=>Object.fromEntries(block.split('¬').filter(x=>x.includes('÷')).map(x=>{const i=x.indexOf('÷');return [x.slice(0,i),x.slice(i+1)];}));
// Only the first (overall) tab; never concatenate venue tabs or head-to-head.
export function parseHistory(text){
 if(typeof text!=='string'||!text.startsWith('SA÷1¬'))throw Error('Storico non riconosciuto');
 const teams=[];let tab=0,current;
 for(const block of text.split('~')){
  const f=fields(block);
  if(f.KA){if(++tab>1)break;}
  if(f.KB){current={name:f.KB.replace(/^Ultimi Incontri:\s*/,''),games:[]};teams.push(current);}
  if(!f.KC||!current||teams.length>2)continue;
  if(f.AC!=='3'||!/^\d{10}$/.test(f.KC)||!/^\w{8}$/.test(f.KP)||!f.FH||!f.FK)continue;
  // Reject extra time/penalty annotations: those displayed scores are not FT.
  if(!/^\d+:\d+$/.test(f.KL||'')||!/^\d+$/.test(f.KU||'')||!/^\d+$/.test(f.KT||''))continue;
  if(f.KL!==f.KU+':'+f.KT)continue;
  current.games.push({id:f.KP,date:new Date(Number(f.KC)*1000).toISOString(),home:f.FH,away:f.FK,hg:Number(f.KU),ag:Number(f.KT)});
 }
 if(teams.length<2)throw Error('Storico delle due squadre incompleto');
 return teams.slice(0,2);
}

// Conservative current-season subset: never import the previous year's form.
// July-to-December uses results since July; January-to-June since January.
export function historyStart(now){const d=new Date(now);return d.getUTCFullYear()+(d.getUTCMonth()>=6?'-07-01':'-01-01');}
export function analyzeHistory(f,record,estimate,{now=Date.now()}={}){
 if(!record||!Number.isFinite(Date.parse(record.fetchedAt))||now-Date.parse(record.fetchedAt)>72*3600000||Date.parse(record.fetchedAt)>now+300000)return f;
 const teams=record.teams;
 if(!Array.isArray(teams)||teams.length!==2||canonicalClub(teams[0].name)!==canonicalClub(f.home)||canonicalClub(teams[1].name)!==canonicalClub(f.away))return f;
 const before=new Date(Math.min(now,Date.parse(f.date))).toISOString().slice(0,10),start=historyStart(now);
 const id=name=>'dh_'+canonicalClub(name).replaceAll(' ','_');
 const sample=(team,name)=>{
  const seen=new Set();return team.games.filter(g=>{
   if(seen.has(g.id)||g.id===f.direttaId||g.date.slice(0,10)<start||g.date.slice(0,10)>=before)return false;
   if(![g.home,g.away].some(n=>canonicalClub(n)===canonicalClub(name)))return false;
   if(!Number.isInteger(g.hg)||g.hg<0||!Number.isInteger(g.ag)||g.ag<0)return false;
   seen.add(g.id);return true;
  }).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,10).map(g=>({id:g.id,kickoffAt:g.date,status:'FT',homeTeam:{id:id(g.home),name:g.home},awayTeam:{id:id(g.away),name:g.away},score:{home:g.hg,away:g.ag}}));
 };
 const h=sample(teams[0],f.home),a=sample(teams[1],f.away);
 const result={...f,markets:marketsFor(h,a,id(f.home),id(f.away)),experimentalEstimate:estimate(h,a,id(f.home),id(f.away)),
  form:{home:{recentOverall:teamStats(h,id(f.home))},away:{recentOverall:teamStats(a,id(f.away))}},
  dataUpdatedAt:record.fetchedAt,source:'Diretta.it · risultati precedenti dal '+start,historyPeriod:{from:start,before},dataStale:false};
 result.selection=selectFixture(result);result.rankScore=result.selection.primary?.evidence??-1;return result;
}

export function createHistoryStore({initial={},fetcher=fetch,persist=()=>{},concurrency=3}={}){
 const cache=new Map(Object.entries(initial)),pending=new Map(),retry=new Map(),queue=[];let active=0;
 const run=()=>{while(active<concurrency&&queue.length){const {id,now,resolve}=queue.shift();active++;
  (async()=>{try{
   const response=await fetcher('https://400.flashscore.ninja/400/x/feed/df_hh_1_'+id,{headers:{'x-fsign':'SW9D1eZo'},signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Storico HTTP '+response.status);
   const text=await response.text();if(text.length>500000)throw Error('Storico troppo grande');
   const teams=parseHistory(text),value={fetchedAt:new Date(now).toISOString(),teams};cache.set(id,value);
   persist(Object.fromEntries([...cache].filter(([,r])=>now-Date.parse(r.fetchedAt)<72*3600000)));return value;
  }catch{retry.set(id,now+60000);return cache.get(id)||null;}
  })().then(resolve).finally(()=>{active--;pending.delete(id);run();});
 }};
 return {peek:id=>cache.get(id),get(id,{now=Date.now()}={}){
  if(!/^\w{8}$/.test(id))return Promise.resolve(null);
  const old=cache.get(id),age=now-Date.parse(old?.fetchedAt);
  if(age>=-300000&&age<6*3600000||now<(retry.get(id)||0))return Promise.resolve(old||null);
  if(!pending.has(id)){pending.set(id,new Promise(resolve=>queue.push({id,now,resolve})));run();}
  return pending.get(id);
 }};
}
let initial={};for(const name of ['diretta-history-snapshot.json.gz','diretta-history-cache.json'])try{const raw=readFileSync(new URL('./'+name,import.meta.url));Object.assign(initial,JSON.parse(name.endsWith('.gz')?gunzipSync(raw).toString('utf8'):raw.toString('utf8')));}catch{}
const store=createHistoryStore({initial,persist:value=>{
 if(process.env.NODE_ENV==='test')return;
 try{const tmp=new URL('./diretta-history-cache.tmp',import.meta.url);writeFileSync(tmp,JSON.stringify(value));renameSync(tmp,new URL('./diretta-history-cache.json',import.meta.url));}catch{}
}});
export async function enrichHistory(data,estimate,{now=Date.now(),historyStore=store,waitMs=18000}={}){
 const started=Date.now();
 const missing=data.fixtures.filter(f=>f.direttaId&&!f.experimentalEstimate?.available);
 const jobs=missing.map(f=>historyStore.get(f.direttaId,{now}));
 // Keep the calendar responsive; queued work continues, shared across requests.
 let timer;await Promise.race([Promise.allSettled(jobs),new Promise(r=>{timer=setTimeout(r,waitMs);})]);clearTimeout(timer);
 const effectiveNow=now+Date.now()-started;
 const fixtures=data.fixtures.filter(f=>Date.parse(f.date)>effectiveNow).map(f=>f.direttaId&&!f.experimentalEstimate?.available?analyzeHistory(f,historyStore.peek(f.direttaId),estimate,{now}):f);
 fixtures.sort((a,b)=>(b.rankScore??-1)-(a.rankScore??-1)||Date.parse(a.date)-Date.parse(b.date));
 return {...data,fixtures,calendarCount:fixtures.length,preview:{...data.preview,returned:fixtures.length,totalAvailable:fixtures.length},provider:'Diretta.it · analisi Open Matchday e storico Diretta',analyzedCount:fixtures.filter(f=>f.experimentalEstimate?.available).length,selectedCount:fixtures.filter(f=>f.selection?.qualified).length,
  historyCoverage:{source:'Diretta.it',checked:missing.filter(f=>historyStore.peek(f.direttaId)).length,pending:missing.filter(f=>!historyStore.peek(f.direttaId)).length},
  method:data.method+' Storici aggiuntivi Diretta: solo risultati antecedenti, nel periodo corrente dal '+historyStart(now)+'.'};
}
