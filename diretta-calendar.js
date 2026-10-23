import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'});
export const italianDay=ts=>formatter.format(new Date(ts));
const days=new Map();
const runtime=new URL('./diretta-calendar-cache.json',import.meta.url);
for(const path of [new URL('./diretta-calendar-snapshot.json',import.meta.url),...(process.env.NODE_ENV==='test'?[]:[runtime])])try{
 for(const [day,value] of Object.entries(JSON.parse(readFileSync(path,'utf8')).days||{})){
  if(!days.has(day)||Date.parse(value.fetchedAt)>Date.parse(days.get(day).fetchedAt))days.set(day,value);
 }
}catch{}
export function parseDirettaFeed(text){
 if(typeof text!=='string'||!text.startsWith('SA÷1¬'))throw Error('Calendario Diretta non riconosciuto');
 const events=[],seen=new Set();let league=null;
 for(const block of text.split('~')){
  const fields=Object.fromEntries(block.split('¬').filter(x=>x.includes('÷')).map(x=>{const i=x.indexOf('÷');return[x.slice(0,i),x.slice(i+1)];}));
  if(fields.ZA){league={league:fields.ZA.split(': ').slice(1).join(': ')||fields.ZA,country:fields.ZY||fields.ZA.split(':')[0],competitionId:fields.ZEE||fields.ZC,sourcePath:fields.ZL};continue;}
  if(!fields.AA)continue;
  if(!league||!league.competitionId||!fields.AE||!fields.AF||!/^\w{8}$/.test(fields.AA)||!/^\d{10}$/.test(fields.AD))throw Error('Partita Diretta incompleta');
  if(seen.has(fields.AA))continue;seen.add(fields.AA);
  const timestamp=Number(fields.AD)*1000;
  const score=fields.AB==='3'&&fields.AC==='3'&&/^\d+$/.test(fields.AG||'')&&/^\d+$/.test(fields.AH||'')?{home:Number(fields.AG),away:Number(fields.AH)}:null;
  events.push({...league,score,id:fields.AA,date:new Date(timestamp).toISOString(),home:fields.AE,away:fields.AF,status:fields.AB==='1'&&fields.AC==='1'?'NS':fields.AB==='3'?'FT':'OTHER'});
 }
 return events;
}
export function createCalendarStore({initial={},fetcher=fetch,persist=()=>{}}={}){
 const cache=new Map(Object.entries(initial)),inflight=new Map(),retry=new Map(),errors=new Map();
 async function refresh(day,now){
  if(inflight.has(day))return inflight.get(day);
  if(now<(retry.get(day)||0))return cache.get(day);
  retry.set(day,now+5*60000);
  const job=(async()=>{
   try{
    const offset=Math.round((Date.parse(day+'T12:00:00Z')-Date.parse(italianDay(now)+'T12:00:00Z'))/86400000);
    if(!Number.isFinite(offset)||Math.abs(offset)>7)throw Error('Diretta copre i giorni vicini alla data attuale');
    const response=await fetcher('https://400.flashscore.ninja/400/x/feed/f_1_'+offset+'_2_it_1',{headers:{'x-fsign':'SW9D1eZo'},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Calendario Diretta HTTP '+response.status);
    const text=await response.text();if(text.length>4e6)throw Error('Calendario troppo grande');
    const events=parseDirettaFeed(text);
    // The daily feed can contain rescheduled slots on adjacent Italian days.
    // Preserve them, then filter the joined feeds by the actual kickoff.
    if(events.length&&!events.some(e=>italianDay(e.date)===day))throw Error('Giorno restituito da Diretta diverso da quello richiesto');
    const value={date:day,fetchedAt:new Date(now).toISOString(),sourceUrl:'https://www.diretta.it/',events};
    cache.set(day,value);errors.delete(day);persist(Object.fromEntries([...cache].filter(([date])=>Math.abs(Date.parse(date+'T12:00:00Z')-now)<9*86400000)));
    return value;
   }catch(error){retry.set(day,now+30000);errors.set(day,error.message);return cache.has(day)?{...cache.get(day),issue:error.message}:{date:day,events:[],issue:error.message};}
  })().finally(()=>inflight.delete(day));
  inflight.set(day,job);return job;
 }
 return {async get(day,{now=Date.now(),waitForFresh=false}={}){
  const previous=cache.get(day);
  const age=now-Date.parse(previous?.fetchedAt);
  if(previous&&age>=-5*60000&&age<5*60000)return previous;
  const updating=refresh(day,now);
  // Serve the existing dated calendar immediately while refreshing upstream. Never hide its age.
  if(!waitForFresh&&previous&&age>=-5*60000&&age<7*86400000)return{...previous,refreshing:inflight.has(day),issue:errors.get(day)||null};
  return updating;
 }};
}
const store=createCalendarStore({initial:Object.fromEntries(days),persist:value=>{
 if(process.env.NODE_ENV==='test')return;
 try{const temp=new URL('./diretta-calendar-cache.tmp',import.meta.url);writeFileSync(temp,JSON.stringify({days:value}));renameSync(temp,runtime);}catch{}
}});
export const getDirettaDay=(day,options)=>store.get(day,options);
