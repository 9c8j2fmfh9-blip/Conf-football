import {readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {getDirettaDay,italianDay} from '../diretta-calendar.js';
import {evaluateCaptures} from '../forecast-evaluation.js';
import {parseDirettaMatchStats,parseDirettaMatchEvents} from '../diretta-match-stats.js';
const root=resolve(process.argv[2]||'.');
const captures=readdirSync(resolve(root,'forecast-captures')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(resolve(root,'forecast-captures',n),'utf8')));
const now=Date.now();
const dates=[...new Set(captures.flatMap(c=>(c.fixtures||[]).filter(f=>Date.parse(f.kickoffAt)<now).map(f=>italianDay(f.kickoffAt))))];
// Retain confirmed results beyond the public feed's seven-day window.
let previous=[];try{previous=JSON.parse(readFileSync(resolve(root,'forecast-evaluation/results.json'),'utf8')).results||[];}catch{}
const results=new Map(previous.map(r=>[r.id,r])),issues=[];
for(const date of dates){
 if(Math.abs(Date.parse(date+'T12:00:00Z')-now)>7*86400000)continue;
 const day=await getDirettaDay(date,{now});
 if(day.issue)issues.push({date,issue:day.issue});
 for(const r of day.events||[])if(r.status==='FT'&&r.score)results.set(r.id,r);
}
// Fetch final match stats only for fixtures whose pre-match capture actually
// recorded a qualified Diretta market. Keep this bounded for the scheduled job.
const needsStats=new Set(captures.flatMap(c=>(c.fixtures||[]).filter(f=>(f.direttaStatMarkets||[]).some(m=>m.score!==null&&m.sample>=12)).map(f=>String(f.direttaId||String(f.fixtureId||'').replace(/^diretta_/,'')))));
const statTargets=[...results.values()].filter(r=>needsStats.has(String(r.id))&&r.status==='FT'&&r.score&&!r.statistics).slice(0,60);
let cursor=0;const workers=Array.from({length:2},async()=>{while(cursor<statTargets.length){const result=statTargets[cursor++];try{
 const headers={'x-fsign':'SW9D1eZo','Referer':'https://www.diretta.it/'};
 const [statsResponse,eventsResponse]=await Promise.all([
  fetch('https://400.flashscore.ninja/400/x/feed/df_st_1_'+result.id,{headers,signal:AbortSignal.timeout(12000)}),
  fetch('https://400.flashscore.ninja/400/x/feed/df_sui_1_'+result.id,{headers,signal:AbortSignal.timeout(12000)})
 ]);
 if(!statsResponse.ok)throw Error('statistiche HTTP '+statsResponse.status);
 const [statsText,eventsText]=await Promise.all([statsResponse.text(),eventsResponse.ok?eventsResponse.text():Promise.resolve('')]);
 const statistics=parseDirettaMatchStats(statsText);try{Object.assign(statistics,parseDirettaMatchEvents(eventsText));}catch{statistics.cardsAvailable=false;}
 if(statistics.cardsAvailable)for(const side of ['home','away']){statistics[side].yellowCards=statistics.cards[side].yellow;statistics[side].redCards=statistics.cards[side].red;}
 statistics.fetchedAt=new Date().toISOString();result.statistics=statistics;
 }catch(error){issues.push({matchId:result.id,issue:'Statistiche finali non recuperate: '+String(error?.message||error)});}}});
await Promise.all(workers);
const report=evaluateCaptures(captures,[...results.values()],{evaluatedAt:new Date(now).toISOString()});
report.sourceIssues=issues;
mkdirSync(resolve(root,'forecast-evaluation'),{recursive:true});
writeFileSync(resolve(root,'forecast-evaluation/results.json'),JSON.stringify({results:[...results.values()]},null,2)+'\n');
writeFileSync(resolve(root,'forecast-evaluation/latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({recorded:report.recorded,settled:report.settled,pending:report.pending.length,sourceIssues:issues}));
