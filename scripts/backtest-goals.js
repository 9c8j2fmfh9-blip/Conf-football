// Walk-forward check: each fixture is predicted from strictly earlier matches.
// Run: node scripts/backtest-goals.js
import {readFileSync} from 'node:fs';
const dataset=JSON.parse(readFileSync(new URL('../efl-history-2627.json',import.meta.url),'utf8'));
const observations=[];
const blend=(p,base,w)=>w*p+(1-w)*base;
const avg=(matches,team,isFor)=>matches.reduce((sum,m)=>{
 const home=m[1]===team;
 return sum+Number(m[isFor?(home?3:4):(home?4:3)]);
},0)/matches.length;
const shrink=(value,n)=>(value*n+1.3*6)/(n+6);
for(const [league,games] of Object.entries(dataset.leagues)){
 const sorted=games.slice().sort((a,b)=>a[0].localeCompare(b[0]));
 for(const match of sorted){
  const [date,home,away,hg,ag]=match;
  const previous=sorted.filter(x=>x[0]<date);
  const homeVenue=previous.filter(x=>x[1]===home).slice(-10);
  const awayVenue=previous.filter(x=>x[2]===away).slice(-10);
  const h=homeVenue.length>=6?homeVenue:previous.filter(x=>x[1]===home||x[2]===home).slice(-10);
  const a=awayVenue.length>=6?awayVenue:previous.filter(x=>x[1]===away||x[2]===away).slice(-10);
  if(h.length<6||a.length<6)continue;
  const homeLambda=Math.max(0.15,Math.min(4,Math.sqrt(shrink(avg(h,home,true),h.length)*shrink(avg(a,away,false),a.length))));
  const awayLambda=Math.max(0.15,Math.min(4,Math.sqrt(shrink(avg(a,away,true),a.length)*shrink(avg(h,home,false),h.length))));
  const total=homeLambda+awayLambda;
  const ggRaw=(1-Math.exp(-homeLambda))*(1-Math.exp(-awayLambda));
  const overRaw=1-Math.exp(-total)*(1+total+total*total/2);
  // Shrinking toward a fixed neutral probability reduces overconfidence.
  // This is a diagnostic candidate, NOT a fitted/calibrated production model.
  const ggConservative=blend(ggRaw,0.5,0.5);
  const overConservative=blend(overRaw,0.5,0.5);
  observations.push({league,date,
   gg:ggRaw,ggConservative,
   ggHit:Number(hg)>0&&Number(ag)>0,
   over25:overRaw,over25Conservative:overConservative,
   over25Hit:Number(hg)+Number(ag)>2});
 }
}
function measure(market, predictionKey=market){
 const n=observations.length;
 const actual=observations.reduce((s,x)=>s+Number(x[market+'Hit']),0)/n;
 const forecast=observations.reduce((s,x)=>s+x[predictionKey],0)/n;
 const brier=observations.reduce((s,x)=>s+(x[predictionKey]-Number(x[market+'Hit']))**2,0)/n;
 const baseline=actual*(1-actual);
 const high=observations.filter(x=>x[predictionKey]>=.7);
 return {n,actualRate:+actual.toFixed(4),meanForecast:+forecast.toFixed(4),
 brier:+brier.toFixed(4),baselineBrier:+baseline.toFixed(4),
 over70:high.length,over70Wins:high.filter(x=>x[market+'Hit']).length};
}
const report={method:'Walk-forward; prior dates only; team venue samples if >=6, otherwise all-match fallback; last 10. No odds, corners or team-strength adjustment.',gg:measure('gg'),ggConservative:measure('gg','ggConservative'),over25:measure('over25'),over25Conservative:measure('over25','over25Conservative')};
console.log(JSON.stringify(report,null,2));
if(!observations.length)process.exitCode=1;
