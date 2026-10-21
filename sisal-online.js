import {gunzipSync} from 'node:zlib';
import {canonicalClub} from './open-data.js';
import {readFileSync} from 'node:fs';
export const SISAL_API='https://betting.sisal.it/api/lettura-palinsesto-sport/palinsesto/prematch';
export const SISAL_HEADERS={'Content-Type':'application/json','bet-brand':'175','bet-offer':'0','bet-locale':'it_IT',user_data:JSON.stringify({accountId:null,token:null,tokenJWT:null,loggedIn:false,brandId:175,offerId:0,locale:'it_IT',channel:62,clientType:'WEB'})};
const MAX_AGE=10*60000;
export function parseCompetition(payload,competition,{now=Date.now()}={}){
 if(!Array.isArray(payload?.avvenimentoFeList)||!payload.infoAggiuntivaMap)throw Error('Risposta Sisal non riconosciuta');
 return payload.avvenimentoFeList.filter(e=>e.codiceDisciplina===1&&e.stato===1&&!e.live&&e.eventType==='MATCH'&&e.firstCompetitor?.description&&e.secondCompetitor?.description&&Number.isFinite(Date.parse(e.data))).map(e=>{
  const odds={};
  for(const group of Object.values(payload.infoAggiuntivaMap)){
   if(group.codicePalinsesto!==e.codicePalinsesto||group.codiceAvvenimento!==e.codiceAvvenimento||group.stato!==1||group.offertaLive)continue;
   const market=payload.scommessaMap?.[`${e.key}-${group.codiceScommessa}`];if(!market||market.stato!==1)continue;
   for(const choice of group.esitoList||[]){
    if(choice.stato!==1||!Number.isFinite(choice.quota)||choice.quota<=100)continue;
    let key=null;
    if(group.codiceScommessa===3&&group.idInfoAggiuntiva===0)key=({1:'one',2:'draw',3:'two'})[choice.codiceEsito];
    if(group.codiceScommessa===18&&group.idInfoAggiuntiva===0&&choice.descrizione?.trim()==='GOAL')key='btts';
    if(group.codiceScommessa===7989&&choice.descrizione?.trim()==='OVER')key=({250:'over25',350:'over35'})[group.idInfoAggiuntiva];
    if(key)odds[key]=choice.quota/100;
   }
  }
  return {id:e.key,eventId:e.eventId,home:e.firstCompetitor.description,away:e.secondCompetitor.description,date:e.data,status:'NS',league:competition.descrizione,country:competition.country||'',competitionCode:competition.sigla,competitionKey:competition.key,odds,verifiedAt:new Date(now).toISOString(),source:'Sisal online'};
 });
}
export function createSisalStore({initial={},fetcher=fetch,persist=()=>{}}={}){
 let competitions=initial.competitions||{},rows=initial.rows||{},treeAt=0,inflight=null,lastIssue=null;
 const request=async path=>{const r=await fetcher(SISAL_API+path,{headers:SISAL_HEADERS,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Sisal HTTP '+r.status);return r.json();};
 async function refresh(now){
  const tree=await request('/alberaturaPrematch');
  if(!tree.manifestazioneMap||!tree.manifestazioneListByDisciplinaOggi)throw Error('Elenco competizioni Sisal non valido');
  const keys=[...new Set(['Oggi','Domani','DopoDomani'].flatMap(k=>tree['manifestazioneListByDisciplina'+k]?.['1']||[]))];
  if(!keys.length)throw Error('Nessuna competizione calcio Sisal');
  competitions=Object.fromEntries(keys.map(k=>[k,tree.manifestazioneMap[k]]).filter(([,v])=>v));
  let cursor=0,failed=0;
  await Promise.all(Array.from({length:6},async()=>{while(cursor<keys.length){const key=keys[cursor++];try{const payload=await request('/v1/schedaManifestazione/0/'+encodeURIComponent(key)+'?offerId=0&metaTplEnabled=true&deep=true');rows[key]={fetchedAt:new Date(now).toISOString(),events:parseCompetition(payload,competitions[key],{now})};}catch{failed++;}}}));
  treeAt=now;lastIssue=failed?`${failed} competizioni Sisal non aggiornate`:null;
  persist({competitions,rows});
 }
 return {async get({now=Date.now(),wait=false}={}){
  const usable=Object.values(rows).some(r=>now-Date.parse(r.fetchedAt)<=MAX_AGE);
  if(!inflight&&now-treeAt>120000)inflight=refresh(now).catch(e=>{lastIssue=e.message;treeAt=now-90000;}).finally(()=>{inflight=null;});
  if(inflight&&wait)await inflight;
  else if(inflight&&!usable){let timer;await Promise.race([inflight,new Promise(r=>{timer=setTimeout(r,18000);})]);clearTimeout(timer);}
  const active=Object.entries(rows).filter(([k,r])=>competitions[k]&&now-Date.parse(r.fetchedAt)<=MAX_AGE&&Date.parse(r.fetchedAt)<=now+300000);
  return {events:active.flatMap(([,r])=>r.events).filter(e=>Date.parse(e.date)>now),fetchedAt:active.map(([,r])=>r.fetchedAt).sort()[0]||null,competitions:Object.keys(competitions).length,partial:!!lastIssue||active.length<Object.keys(competitions).length,issue:lastIssue,refreshing:!!inflight};
 }};
}
let initial={};try{initial=JSON.parse(gunzipSync(readFileSync(new URL('./sisal-online-snapshot.json.gz',import.meta.url))).toString('utf8'));}catch{}
const store=createSisalStore({initial});
export const getSisalCalendar=options=>store.get(options);

const alias={'viking fk':'viking','sporting lisbona':'sporting lisbon',sporting:'sporting lisbon','bayern monaco':'bayern munich',lipsia:'rb leipzig','rb lipsia':'rb leipzig',betis:'real betis',lilla:'lille',inter:'internazionale','club bruges':'club brugge','man city':'manchester city','man utd':'manchester united',psg:'paris saint germain'};
export function sisalClub(name){const n=canonicalClub(name);return canonicalClub(alias[n]||n);}
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'});
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export async function getOnlineOdds(options={}){
 const data=await getSisalCalendar(options);if(!data.fetchedAt||!data.events.length)return null;
 return {sourceUrl:SISAL_API,sourceUpdatedAt:data.fetchedAt,fetchedAt:data.fetchedAt,online:true,entries:data.events.map(e=>({date:day.format(new Date(e.date)),time:clock.format(new Date(e.date)),home:e.home,away:e.away,competitionCode:e.competitionKey==='1-856'?'EUCHL':e.competitionCode,odds:e.odds,eventId:e.eventId}))};
}
