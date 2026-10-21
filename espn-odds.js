import {comparisonClub} from './comparison-odds.js';
const normal=x=>comparisonClub(({'Feyenoord Rotterdam':'Feyenoord','Viking FK':'Viking','LASK Linz':'LASK','Athletic Club':'Ath Bilbao'})[x]||x);
export function decimalOdds(value){if(!/^[+-]?\d+(?:\.\d+)?$/.test(String(value)))return null;const n=Number(value);if(Math.abs(n)<100)return null;return n>0?1+n/100:1+100/-n;}
export function parseEspnOdds(payload,{now=Date.now(),sourceUrl=''}={}){
 if(!Array.isArray(payload?.events))throw Error('Formato quote ESPN non riconosciuto');const events=[];
 for(const e of payload.events)for(const c of e.competitions||[]){
  if(c.status?.type?.state!=='pre'||c.status.type.completed||!Number.isFinite(Date.parse(c.date||e.date))||Date.parse(c.date||e.date)<=now)continue;
  const home=c.competitors?.find(t=>t.homeAway==='home')?.team?.displayName,away=c.competitors?.find(t=>t.homeAway==='away')?.team?.displayName;if(!home||!away)continue;
  const books={};
  for(const offer of c.odds||[]){if(!offer?.provider?.name||!offer.provider.id)continue;const odds={};
   const add=(key,value)=>{const decimal=decimalOdds(value);if(decimal)odds[key]={value:decimal,observedAt:new Date(now).toISOString(),sourceUrl};};
   // Only the current (close) three-way prices. Opening prices are not current.
   if(offer.moneyline?.draw?.close?.odds){add('one',offer.moneyline.home?.close?.odds);add('draw',offer.moneyline.draw.close.odds);add('two',offer.moneyline.away?.close?.odds);}
   const total=offer.total?.over?.close;const key=({'o2.5':'over25','o3.5':'over35'})[total?.line];if(key)add(key,total.odds);
   if(Object.keys(odds).length){const code='espn_'+offer.provider.id;books[code]={code,name:offer.provider.displayName||offer.provider.name,odds};}
  }
  if(Object.keys(books).length)events.push({id:String(e.id),home,away,date:c.date||e.date,books,observedAt:new Date(now).toISOString(),sourceUrl});
 }
 return events;
}
export function createEspnStore({fetcher=fetch}={}){
 const cache=new Map(),pending=new Map();let lastError=null;
 async function day(date){const old=cache.get(date);if(old&&Date.now()-old.at<5*60000)return old.events;
  if(!pending.has(date))pending.set(date,(async()=>{try{const sourceUrl='https://www.espn.com/soccer/scoreboard/_/date/'+date;
   const response=await fetcher('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates='+date+'&limit=1000',{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!response.ok)throw Error('ESPN HTTP '+response.status);
   const events=parseEspnOdds(await response.json(),{sourceUrl});cache.set(date,{at:Date.now(),events});lastError=null;return events;
  }catch(e){lastError=e.message;return [];}finally{pending.delete(date);}})());return pending.get(date);
 }
 return {async probe(){const events=await day(new Date().toISOString().slice(0,10).replaceAll('-',''));return {available:events.length>0,source:'ESPN · quote bookmaker di riferimento',pricedEvents:events.length,bookmakers:[...new Set(events.flatMap(e=>Object.values(e.books).map(b=>b.name)))],observedAt:events[0]?.observedAt||null,error:lastError};},
 async quotes(fixtures){const dates=[...new Set(fixtures.map(f=>String(f.date).slice(0,10).replaceAll('-','')).filter(d=>/^\d{8}$/.test(d)))];const events=(await Promise.all(dates.map(day))).flat();
  const matched=fixtures.flatMap(f=>{const found=events.filter(e=>Date.parse(e.date)===Date.parse(f.date)&&normal(e.home)===normal(f.home)&&normal(e.away)===normal(f.away));return found.length===1?[{...found[0],home:f.home,away:f.away,fixtureId:f.fixtureId}]:[];});
  return {source:'ESPN',fixtures:matched,matchedEvents:matched.length,listedEvents:events.length,error:lastError,generatedAt:new Date().toISOString()};
 }};
}
const store=createEspnStore();export const espnProbe=()=>store.probe();export const getEspnQuotes=fixtures=>store.quotes(fixtures);
