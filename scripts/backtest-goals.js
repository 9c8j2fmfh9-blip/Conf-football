// Walk-forward check: each fixture is predicted from strictly earlier matches.
// Run: node scripts/backtest-goals.js
import {readFileSync} from 'node:fs';
const dataset=JSON.parse(readFileSync(new URL('../efl-history-2627.json',import.meta.url),'utf8'));
// Additional completed-league results bundled for FA Cup team context.
// Use each league as its own competition: never pool team history across leagues.
const supporting=JSON.parse(readFileSync(new URL('../fa-cup-support-history-2627.json',import.meta.url),'utf8'));
for(const [league,rows] of Object.entries(supporting.results||{})){
 const normalized=rows.filter(x=>/^\d+$/.test(String(x[4]))&&/^\d+$/.test(String(x[5])))
  .map(x=>[x[0],x[2],x[3],x[4],x[5]]);
 if(normalized.length)dataset.leagues[league]=normalized;
}
const observations=[];
// Forecasts should be evaluated on later dates, never chosen using those outcomes.
const MIN_TRAIN=30;
const summarize=items=>items.length?{n:items.length,winRate:+(items.reduce((a,x)=>a+ +x.actual,0)/items.length).toFixed(3),meanForecast:+(items.reduce((a,x)=>a+x.p,0)/items.length).toFixed(3),brier:+(items.reduce((a,x)=>a+(x.p- +x.actual)**2,0)/items.length).toFixed(4)}:{n:0};
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
  observations.push({league,date,homeSample:h.length,awaySample:a.length,
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
// Strictly prior-data benchmark: no future outcome informs its prediction.
const sequential={};
for(const market of ['gg','over25']){
 const ordered=observations.map((o,i)=>({...o,index:i})).sort((a,b)=>a.date.localeCompare(b.date)||a.league.localeCompare(b.league));
 const evaluated=[];
 for(const row of ordered){
  const history=ordered.filter(o=>o.date<row.date);
  if(history.length<MIN_TRAIN)continue;
  const leagueHistory=history.filter(o=>o.league===row.league);
  const prior=leagueHistory.length>=15?leagueHistory:history;
  const base=(prior.reduce((a,o)=>a+ +o[market+'Hit'],0)+5)/(prior.length+10);
  evaluated.push({actual:row[market+'Hit'],p:row[market],baseline:base,conservative:row[market+'Conservative'],date:row.date,league:row.league});
 }
 const variants={};
 for(const model of ['p','baseline','conservative'])variants[model]=summarize(evaluated.map(x=>({...x,p:x[model]})));
 const byLeague={};
 for(const league of [...new Set(evaluated.map(x=>x.league))]){
  const group=evaluated.filter(x=>x.league===league);
  byLeague[league]={model:summarize(group),baseline:summarize(group.map(x=>({...x,p:x.baseline}))),n:group.length};
 }
 const buckets={};
 for(const [low,high] of [[0,.4],[.4,.5],[.5,.6],[.6,.7],[.7,1.001]]){
  const group=evaluated.filter(o=>o.p>=low&&o.p<high);
  buckets[low.toFixed(1)+'-'+Math.min(high,1).toFixed(1)]=summarize(group);
 }
 const benchmark=variants.baseline.brier;
 const models=['p','conservative'].map(model=>({
  name:model,brier:variants[model].brier,
  improvesBaseline:variants[model].brier<benchmark,
  difference:+(benchmark-variants[model].brier).toFixed(4)
 }));
 // Chronological split: earlier observations are diagnostic, later ones are a holdout.
 // A small holdout cannot certify profitability but reveals retrospective fitting.
 const dates=[...new Set(evaluated.map(x=>x.date))].sort();
 const cutoff=dates[Math.floor(dates.length*0.7)]||null;
 const holdout=evaluated.filter(x=>x.date>=cutoff);
 const holdoutMetrics=Object.fromEntries(['p','baseline','conservative'].map(key=>
  [key,summarize(holdout.map(x=>({...x,p:x[key]})))]));
 // Select blend ONLY using observations before the holdout cutoff.
 // The holdout remains unseen during model choice.
 const training=evaluated.filter(x=>x.date<cutoff);
 const weights=[0,0.25,0.5,0.75,1];
 const scoreBlend=(rows,weight)=>summarize(rows.map(x=>({
  ...x,p:weight*x.p+(1-weight)*x.baseline
 })));
 const trained=weights.map(weight=>({weight,...scoreBlend(training,weight)}))
  .sort((a,b)=>a.brier-b.brier||a.weight-b.weight);
 const selected=trained[0];
 const selectedHoldout=scoreBlend(holdout,selected.weight);
 const improvesHoldout=selectedHoldout.n>=30 &&
  selectedHoldout.brier<holdoutMetrics.baseline.brier;

 // Diagnostic decision, with all thresholds set in advance. This prevents
 // describing a non-improving model as production-ready.
 const evaluation={
  holdoutSamples:holdout.length,
  minimumHoldout:100,
  betterThanBaseline:improvesHoldout,
  enoughEvidence:holdout.length>=100,
  verdict:holdout.length<100?'INSUFFICIENT_HOLDOUT':
   improvesHoldout?'FURTHER_EXTERNAL_VALIDATION_REQUIRED':'NO_HOLDOUT_IMPROVEMENT'
 };
 const qualified=models.filter(x=>x.improvesBaseline);
 sequential[market]={
  variants,buckets,byLeague,evaluation,holdout:{startDate:cutoff,models:holdoutMetrics,blendChosenOnTraining:{weight:selected.weight,trainingBrier:selected.brier,holdout:selectedHoldout,beatsHoldoutBaseline:improvesHoldout}},highConfidenceCount:evaluated.filter(x=>x.p>=.7).length,
  modelComparison:models,
  status:qualified.length?'BETTER_THAN_HISTORICAL_BASELINE_ONLY':'NO_IMPROVEMENT_OVER_HISTORICAL_BASELINE',
  wageringApproved:false,
  rationale:'This small historical sample cannot establish market edge or calibrated betting probabilities; no pre-match bookmaker quotes or independent holdout.'
 };
}
const report={productionBettingApproved:false,sourceLeagueCounts:Object.fromEntries(Object.entries(dataset.leagues).map(([k,v])=>[k,v.length])),sequential,method:'Walk-forward; prior dates only; team venue samples if >=6, otherwise all-match fallback; last 10. No odds, corners or team-strength adjustment.',gg:measure('gg'),ggConservative:measure('gg','ggConservative'),over25:measure('over25'),over25Conservative:measure('over25','over25Conservative')};
console.log(JSON.stringify(report,null,2));
// This audit reports quality; it must never automatically 'approve' bets.
if(Object.values(sequential).some(x=>x.variants.p.n===0))process.exitCode=1;
if(!observations.length)process.exitCode=1;
if(Object.keys(dataset.leagues).length<7) { console.error('Missing expected support leagues: backtest incomplete'); process.exitCode=1; }
