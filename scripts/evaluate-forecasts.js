import {readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {getDirettaDay,italianDay} from '../diretta-calendar.js';
import {evaluateCaptures} from '../forecast-evaluation.js';
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
const report=evaluateCaptures(captures,[...results.values()],{evaluatedAt:new Date(now).toISOString()});
report.sourceIssues=issues;
mkdirSync(resolve(root,'forecast-evaluation'),{recursive:true});
writeFileSync(resolve(root,'forecast-evaluation/results.json'),JSON.stringify({results:[...results.values()]},null,2)+'\n');
writeFileSync(resolve(root,'forecast-evaluation/latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({recorded:report.recorded,settled:report.settled,pending:report.pending.length,sourceIssues:issues}));
