import {canonicalClub} from './open-data.js';
export const COMPARISON_URL='https://www.oddschecker.com/it/calcio';
const TTL=5*60000;
const entity=s=>s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function script(html,id){const m=html.match(new RegExp('<script[^>]*id="'+id+'"[^>]*>([\\s\\S]*?)</script>'));if(!m)throw Error('Dati quote assenti nella pagina');return JSON.parse(m[1]);}
function decode(x){if(Array.isArray(x)&&x[0]===0)return x.length>1?decode(x[1]):null;if(Array.isArray(x)&&x[0]===1)return x[1].map(decode);if(x&&typeof x==='object'&&!Array.isArray(x))return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,decode(v)]));return x;}
const aliases={'man utd':'manchester united','manchester utd':'manchester united','inter milan':'internazionale',inter:'internazionale','sporting lisbon':'sporting cp','sporting lisbona':'sporting cp','lask linz':'lask','viking fk':'viking','bayern monaco':'bayern munich',lipsia:'rb leipzig','club bruges':'club brugge',betis:'real betis','lille osc':'lille','galatasaray istanbul':'galatasaray'};
export const comparisonClub=x=>{const n=canonicalClub(x);return canonicalClub(aliases[n]||n);};
export function parseListing(html,{now=Date.now()}={}){
 const data=script(html,'cx-island-data');const events=new Map();
 for(const island of Object.values(data))for(const q of island.queries||[])for(const e of q.state?.data?.subevents||[]){
  if(e.type!=='MATCH'||e.inRunning||!e.urlPath?.startsWith('/it/calcio/')||!Number.isFinite(Date.parse(e.startTime))||Date.parse(e.startTime)<=now)continue;
  const pair=e.name?.split(' v ');if(pair?.length!==2)continue;
  events.set(String(e.id),{id:String(e.id),home:pair[0],away:pair[1],date:e.startTime,url:'https://www.oddschecker.com'+e.urlPath});
 }
 if(!events.size)throw Error('Nessuna partita futura leggibile nella fonte quote');return [...events.values()];
}
export function parseMatch(html,{now=Date.now(),url=''}={}){
 const data=script(html,'cx-island-data');let header;
 for(const island of Object.values(data))for(const q of island.queries||[])if(q.queryKey?.[0]==='subevent-header')header=q.state?.data;
 if(!header||header.inRunning||header.subeventInRunning||!Number.isFinite(Date.parse(header.subeventStartTime))||header.subeventType!=='MATCH'||Date.parse(header.subeventStartTime)<=now)throw Error('Partita non futura o non identificata');
 const pair=header.subeventName?.split(' v ');if(pair?.length!==2)throw Error('Squadre non identificate');
 const books={};
 for(const m of html.matchAll(/<astro-island\b([^>]+)>/g)){
  const attrs=Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));
  if(attrs['component-export']!=='GridGroupIsland')continue;
  const props=decode(JSON.parse(entity(attrs.props||'{}'))).componentArgs;
  const metadata=Object.values(props?.marketGroups||{}).flat();
  for(const market of metadata){
   if(market.marketStatus!=='ACTIVE'||market.subeventInRunning||String(market.ocSubeventId)!==String(header.subeventId))continue;
   if(![1,9,4323,1535366].includes(market.ocBetTypeId))continue;
   const queries=props.oddsGrids?.[market.ocMarketId]?.queries||[];
   for(const q of queries){const stamp=q.state?.dataUpdatedAt;if(!Number.isFinite(stamp)||now-stamp>15*60000||stamp>now+300000)continue;const grid=q.state?.data;if(!grid||grid.subeventStartTime!==header.subeventStartTime)continue;
    const names=new Map((grid.bookmakers||[]).filter(b=>b.type==='TRADITIONAL').map(b=>[b.code,b.name]));
    for(const bet of grid.bets||[]){let key;
     if(market.ocBetTypeId===1)key=({HOME:'one',DRAW:'draw',AWAY:'two'})[bet.genericName];
     if(market.ocBetTypeId===4323&&bet.genericName==='YES')key='btts';
     if(market.ocBetTypeId===9&&bet.name==='Over')key=({'2.5':'over25','3.5':'over35'})[bet.line?.name];
     if(market.ocBetTypeId===1535366&&bet.name==='Over 2.5 and Yes')key='bttsOver25';
     if(!key)continue;
     for(const price of bet.odds||[]){if(price.status!=='ACTIVE'||!Number.isFinite(price.decimal)||price.decimal<=1||!names.has(price.bookmakerCode))continue;
      const code=price.bookmakerCode;books[code]??={code,name:names.get(code),odds:{}};
      const old=books[code].odds[key];if(old&&old.value!==price.decimal){books[code].odds[key]={ambiguous:true};continue;}if(old?.ambiguous)continue;
      books[code].odds[key]={value:price.decimal,observedAt:new Date(now).toISOString(),sourceUrl:url};
     }
    }
   }
  }
 }
 if(!Object.keys(books).length)throw Error('Nessuna quota attiva leggibile');
 return {id:String(header.subeventId),home:pair[0],away:pair[1],date:header.subeventStartTime,books,observedAt:new Date(now).toISOString(),sourceUrl:url};
}
export function createComparisonStore({fetcher=fetch}={}){
 let listing=null,listJob=null,lastError=null;const matches=new Map(),pending=new Map();
 const read=async url=>{if(!url.startsWith('https://www.oddschecker.com/it/calcio'))throw Error('URL fonte non consentito');const r=await fetcher(url,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Fonte quote HTTP '+r.status);const text=await r.text();if(text.length>12*1024*1024)throw Error('Pagina quote troppo grande');return text;};
 const list=async()=>{if(listing&&Date.now()-listing.at<TTL)return listing.events;if(!listJob)listJob=read(COMPARISON_URL).then(html=>{const events=parseListing(html);listing={at:Date.now(),events};lastError=null;return events;}).catch(e=>{lastError=e.message;return [];}).finally(()=>{listJob=null;});return listJob;};
 const match=async e=>{const old=matches.get(e.id);if(old&&Date.now()-Date.parse(old.observedAt)<TTL)return old;if(!pending.has(e.id))pending.set(e.id,read(e.url).then(html=>{const value=parseMatch(html,{url:e.url});matches.set(e.id,value);return value;}).catch(error=>{lastError=error.message;return null;}).finally(()=>pending.delete(e.id)));return pending.get(e.id);};
 return {async probe(){const events=await list();const first=[...events].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];const sample=first?await match(first):null;return {available:!!sample,source:'Oddschecker Italia',listedEvents:events.length,bookmakers:sample?Object.values(sample.books).map(b=>({code:b.code,name:b.name,markets:Object.keys(b.odds)})):[],sample:sample?{home:sample.home,away:sample.away,date:sample.date}:null,observedAt:sample?.observedAt||null,error:lastError};},
 async quotes(fixtures){const events=await list(),results=[];let cursor=0;
  const groups=fixtures.map(f=>({f,events:events.filter(e=>Date.parse(e.date)===Date.parse(f.date)&&comparisonClub(e.home)===comparisonClub(f.home)&&comparisonClub(e.away)===comparisonClub(f.away))})).filter(g=>g.events.length===1);
  await Promise.all(Array.from({length:4},async()=>{while(cursor<groups.length){const {f,events}=groups[cursor++];const value=await match(events[0]);if(value)results.push({...value,fixtureId:f.fixtureId});}}));
  return {source:'Oddschecker Italia',fixtures:results,listedEvents:events.length,matchedEvents:results.length,error:lastError,generatedAt:new Date().toISOString()};
 }};
}
const store=createComparisonStore();export const comparisonProbe=()=>store.probe();export const getComparisonQuotes=fixtures=>store.quotes(fixtures);
