import {readFileSync,writeFileSync,renameSync} from 'node:fs';

const STAT_FIELDS={34:'shots',13:'shotsOnTarget',16:'corners',21:'fouls',432:'xg'};
const number=value=>{
 const found=String(value??'').trim().match(/^-?\d+(?:[.,]\d+)?/);
 return found?Number(found[0].replace(',','.')):null;
};
const normalizeTeam=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const fields=block=>Object.fromEntries(block.split('¬').filter(x=>x.includes('÷')).map(x=>{const i=x.indexOf('÷');return[x.slice(0,i),x.slice(i+1)]}));

// The first segment is the completed full-match state. Later segments are
// first/second-half statistics and must not be mixed into full-time markets.
export function parseDirettaMatchStats(text){
 if(typeof text!=='string'||!text.includes('SF÷'))throw Error('Statistiche Diretta non riconosciute');
 const full=text.split('~').filter(Boolean).slice(0,text.split('~').findIndex(x=>x.startsWith('SE÷1 Tempo'))<0?undefined:text.split('~').findIndex(x=>x.startsWith('SE÷1 Tempo')));
 const found={};
 for(const block of full){
  const row=fields(block),key=STAT_FIELDS[row.SD];
  if(!key||found[key]||!row.SH||!row.SI)continue;
  const home=number(row.SH),away=number(row.SI);
  if(home!==null&&away!==null&&home>=0&&away>=0)found[key]={home,away};
 }
 if(!found.shots||!found.shotsOnTarget||!found.corners)throw Error('Statistiche complete di tiri e corner non presenti');
 return {home:Object.fromEntries(Object.entries(found).map(([key,value])=>[key,value.home])),away:Object.fromEntries(Object.entries(found).map(([key,value])=>[key,value.away])),fetchedAt:new Date().toISOString(),complete:true};
}

export function parseDirettaMatchEvents(text){
 if(typeof text!=='string'||!text.includes('AC÷1 Tempo'))throw Error('Eventi Diretta non riconosciuti');
 const regulation=text.split('~').filter(Boolean).slice(0,text.split('~').findIndex(x=>/AC÷.*(?:Supplementari|Rigori)/i.test(x))<0?undefined:text.split('~').findIndex(x=>/AC÷.*(?:Supplementari|Rigori)/i.test(x)));
 const cards={home:{yellow:0,red:0},away:{yellow:0,red:0}};
 for(const block of regulation){
  const row=fields(block),kinds=block.split('¬').filter(x=>x.startsWith('IK÷')).map(x=>normalizeTeam(x.slice(3)));
  const side=row.IA==='1'?'home':row.IA==='2'?'away':null;if(!side)continue;
  for(const kind of kinds){
   if(!kind.includes('cartellino')&&!kind.includes('card'))continue;
   if(kind.includes('giallo')||kind.includes('yellow'))cards[side].yellow++;
   if(kind.includes('rosso')||kind.includes('red'))cards[side].red++;
  }
 }
 return{cards,cardsAvailable:true};
}

export function createDirettaStatsStore({initial={},fetcher=fetch,persist=()=>{},concurrency=2,maxQueue=240}={}){
 const cache=new Map(Object.entries(initial)),pending=new Map(),retry=new Map(),queue=[];let active=0;
 const run=()=>{while(active<concurrency&&queue.length){const job=queue.shift();active++;
  (async()=>{try{
   const headers={'x-fsign':'SW9D1eZo','Referer':'https://www.diretta.it/'};
   const [response,eventResponse]=await Promise.all([
    fetcher('https://400.flashscore.ninja/400/x/feed/df_st_1_'+job.id,{headers,signal:AbortSignal.timeout(12000)}),
    fetcher('https://400.flashscore.ninja/400/x/feed/df_sui_1_'+job.id,{headers,signal:AbortSignal.timeout(12000)})
   ]);
   if(!response.ok)throw Error('Statistiche HTTP '+response.status);
   const [text,eventText]=await Promise.all([response.text(),eventResponse.ok?eventResponse.text():Promise.resolve('')]);
   if(text.length>150000||eventText.length>150000)throw Error('Statistiche oltre il limite');
   const value=parseDirettaMatchStats(text);
   try{Object.assign(value,parseDirettaMatchEvents(eventText));}catch{value.cardsAvailable=false;}
   value.cardParserVersion=2;
   if(value.cardsAvailable){for(const side of ['home','away']){value[side].yellowCards=value.cards[side].yellow;value[side].redCards=value.cards[side].red;}}
   value.fetchedAt=new Date(job.now).toISOString();value.matchId=job.id;cache.set(job.id,value);
   persist(Object.fromEntries(cache));return value;
  }catch{retry.set(job.id,job.now+10*60000);return null;}
  })().then(job.resolve).finally(()=>{active--;pending.delete(job.id);run();});
 }};
 return {peek:id=>cache.get(String(id))||null,get(id,{now=Date.now()}={}){
  const key=String(id||'');if(!/^\w{8}$/.test(key))return Promise.resolve(null);
  const value=cache.get(key);if(value?.complete&&value.cardParserVersion===2)return Promise.resolve(value);
  if(now<(retry.get(key)||0)||queue.length>=maxQueue&&!pending.has(key))return Promise.resolve(null);
  if(!pending.has(key)){pending.set(key,new Promise(resolve=>{queue.push({id:key,now,resolve});run();}));}
  return pending.get(key);
 },stats:()=>({cached:cache.size,queued:queue.length,active,pending:pending.size})};
}

let initial={};
if(process.env.NODE_ENV!=='test')try{initial=JSON.parse(readFileSync(new URL('./diretta-statistics-cache.json',import.meta.url),'utf8'));}catch{}
export const direttaStatsStore=createDirettaStatsStore({initial,persist:value=>{
 if(process.env.NODE_ENV==='test')return;
 try{const path=new URL('./diretta-statistics-cache.json',import.meta.url),temp=new URL('./diretta-statistics-cache.tmp',import.meta.url);writeFileSync(temp,JSON.stringify(value));renameSync(temp,path);}catch{}
}});

const DEFINITIONS=[
 ['home_shots_9','Casa · Over 9.5 tiri','shots','home',null,10],['home_shots_11','Casa · Over 11.5 tiri','shots','home',null,12],['home_shots_13','Casa · Over 13.5 tiri','shots','home',null,14],
 ['away_shots_9','Ospite · Over 9.5 tiri','shots','away',null,10],['away_shots_11','Ospite · Over 11.5 tiri','shots','away',null,12],['away_shots_13','Ospite · Over 13.5 tiri','shots','away',null,14],
 ['total_shots_19','Totale Over 19.5 tiri','shots','total',null,20],['total_shots_21','Totale Over 21.5 tiri','shots','total',null,22],['total_shots_23','Totale Over 23.5 tiri','shots','total',null,24],
 ['home_sot_2','Casa · Over 2.5 tiri in porta','shotsOnTarget','home',null,3],['home_sot_3','Casa · Over 3.5 tiri in porta','shotsOnTarget','home',null,4],['home_sot_4','Casa · Over 4.5 tiri in porta','shotsOnTarget','home',null,5],
 ['away_sot_2','Ospite · Over 2.5 tiri in porta','shotsOnTarget','away',null,3],['away_sot_3','Ospite · Over 3.5 tiri in porta','shotsOnTarget','away',null,4],['away_sot_4','Ospite · Over 4.5 tiri in porta','shotsOnTarget','away',null,5],
 ['total_sot_5','Totale Over 5.5 tiri in porta','shotsOnTarget','total',null,6],['total_sot_6','Totale Over 6.5 tiri in porta','shotsOnTarget','total',null,7],['total_sot_7','Totale Over 7.5 tiri in porta','shotsOnTarget','total',null,8],
 ['total_corners_7','Totale Over 7.5 corner','corners','total',null,8],['total_corners_8','Totale Over 8.5 corner','corners','total',null,9],['total_corners_9','Totale Over 9.5 corner','corners','total',null,10],['total_corners_10','Totale Over 10.5 corner','corners','total',null,11],
 ['home_yellow_0','Casa · Over 0.5 cartellini gialli','yellowCards','home',null,1],['home_yellow_1','Casa · Over 1.5 cartellini gialli','yellowCards','home',null,2],
 ['away_yellow_0','Ospite · Over 0.5 cartellini gialli','yellowCards','away',null,1],['away_yellow_1','Ospite · Over 1.5 cartellini gialli','yellowCards','away',null,2],
 ['total_yellow_2','Totale Over 2.5 cartellini gialli','yellowCards','total',null,3],['total_yellow_3','Totale Over 3.5 cartellini gialli','yellowCards','total',null,4],
 ['total_yellow_4','Totale Over 4.5 cartellini gialli','yellowCards','total',null,5],['total_yellow_5','Totale Over 5.5 cartellini gialli','yellowCards','total',null,6]
];
export function buildDirettaStatMarkets(homeTeam,awayTeam,homeGames,awayGames,statsStore,{now=Date.now(),schedule=true}={}){
 const prepare=(games,name)=>games.filter(g=>g?.id&&Date.parse(g.date)<now&&Number.isInteger(g.hg)&&Number.isInteger(g.ag)).slice(0,10).map(g=>{
  const stats=statsStore.peek(g.id);if(schedule&&(!stats||stats.cardParserVersion!==2))void statsStore.get(g.id,{now});
  const isHome=normalizeTeam(g.home)===normalizeTeam(name);
  return stats?.complete?{stats,isHome}:null;
 }).filter(Boolean);
 const home=prepare(homeGames,homeTeam),away=prepare(awayGames,awayTeam),markets=[];
 for(const[key,label,metric,side,,line]of DEFINITIONS){
  const own=(x)=>x.stats[x.isHome?'home':'away'][metric],conceded=(x)=>x.stats[x.isHome?'away':'home'][metric];
  const total=x=>Number.isFinite(x.stats.home[metric])&&Number.isFinite(x.stats.away[metric])?x.stats.home[metric]+x.stats.away[metric]:null;
  const available=x=>metric!=='yellowCards'||(x.stats.cardsAvailable&&x.stats.cardParserVersion===2);
  const ownValue=x=>available(x)?own(x):null,opponentValue=x=>available(x)?conceded(x):null,totalValue=x=>available(x)?total(x):null;
  const homeValues=side==='home'?home.map(ownValue):side==='away'?home.map(opponentValue):home.map(totalValue);
  const awayValues=side==='home'?away.map(opponentValue):side==='away'?away.map(ownValue):away.map(totalValue);
  const validHome=homeValues.filter(Number.isFinite),validAway=awayValues.filter(Number.isFinite),values=[...validHome,...validAway];
  const homeHits=validHome.filter(x=>x>=line).length,awayHits=validAway.filter(x=>x>=line).length;
  const hits=homeHits+awayHits,sample=values.length,homeSample=validHome.length,awaySample=validAway.length;
  const rates=homeSample&&awaySample?[homeHits/homeSample,awayHits/awaySample]:[];
  const sampleSufficient=homeSample>=6&&awaySample>=6&&sample>=12;
  const score=sample?Math.round(100*hits/sample):null;
  markets.push({key:'diretta_'+key,label,metric,side,line,score,hits,sample,venueSamples:{home:homeSample,away:awaySample},teamRates:rates,
   sampleSufficient,qualified:sampleSufficient&&score>=60&&rates.length===2&&rates.every(rate=>rate>=.5),scoreKind:'historical',source:'Diretta · statistiche FT archiviate',available:homeSample>0&&awaySample>0});
 }
 return{source:'Diretta · statistiche finali delle ultime partite',homeSample:home.length,awaySample:away.length,markets,
  pending:Math.max(0,Math.min(10,homeGames.length)-home.length)+Math.max(0,Math.min(10,awayGames.length)-away.length),
  note:'Frequenze descrittive, non probabilità calibrate. Nessuna proposta viene qualificata con meno di 6 partite statistiche valide per ciascuna squadra.'};
}
