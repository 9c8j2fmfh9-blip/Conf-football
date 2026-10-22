import {openDataObservations,teamStats} from './open-data.js';
import {goalEstimateFromStats} from './experimental-goals.js';
const clamp=p=>Math.max(.001,Math.min(.999,p));
const logit=p=>Math.log(clamp(p)/(1-clamp(p)));
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export function fitCalibration(rows,key,penalty){
 let slope=1,intercept=0;
 if(rows.length<100)throw Error('Insufficient calibration training data');
 for(let step=0;step<1800;step++){
  let ds=0,di=0;
  for(const row of rows){
   const x=logit(row.probabilities[key]/100);
   const error=sigmoid(slope*x+intercept)-row.truth[key];
   ds+=error*x;di+=error;
  }
  slope=Math.max(0,Math.min(3,slope-.15*(ds/rows.length+penalty*(slope-1))));
  intercept=Math.max(-3,Math.min(3,intercept-.15*(di/rows.length+penalty*intercept)));
 }
 return {slope,intercept};
}
export function calibratedProbability(p,model){return sigmoid(model.slope*logit(p)+model.intercept);}
const predict=(row,key,model)=>model?calibratedProbability(row.probabilities[key]/100,model):row.probabilities[key]/100;
const score=(rows,key,model)=>{
 if(!rows.length)return {n:0,brier:null,logLoss:null,meanForecast:null,observedRate:null};
 let brier=0,logLoss=0,forecast=0,observed=0;
 for(const row of rows){const p=clamp(predict(row,key,model)),y=row.truth[key];brier+=(p-y)**2;logLoss-=y*Math.log(p)+(1-y)*Math.log(1-p);forecast+=p;observed+=y;}
 return {n:rows.length,brier:brier/rows.length,logLoss:logLoss/rows.length,meanForecast:forecast/rows.length,observedRate:observed/rows.length};
};
// The final period never influences fitting, penalty choice or market thresholds.
// Previously inspected historical outcomes still make this exploratory research.
export function chronologicalCalibration(observations){
 const ordered=observations.slice().sort((a,b)=>a.date.localeCompare(b.date));
 const dates=[...new Set(ordered.map(r=>r.date))];
 const tuneStart=dates[Math.floor(dates.length*.5)],testStart=dates[Math.floor(dates.length*.7)];
 const train=ordered.filter(r=>r.date<tuneStart),tune=ordered.filter(r=>r.date>=tuneStart&&r.date<testStart),test=ordered.filter(r=>r.date>=testStart);
 if(train.length<100||tune.length<100||test.length<100)throw Error('Insufficient chronological calibration partitions');
 const markets={};
 for(const key of ['btts','over25']){
  const candidates=[{penalty:null,model:null},...[.001,.01,.1,1].map(penalty=>({penalty,model:fitCalibration(train,key,penalty)}))];
  // Prefer unchanged production estimates on an exact tie.
  const selected=candidates.map(c=>({...c,tuning:score(tune,key,c.model)})).sort((a,b)=>a.tuning.brier-b.tuning.brier)[0];
  const raw=score(test,key,null),calibrated=score(test,key,selected.model);
  const screened=test.filter(r=>r.selected===key);
  markets[key]={chosenPenalty:selected.penalty,parameters:selected.model,
   tuning:selected.tuning,finalPeriod:{raw,candidate:calibrated},
   originalScreening:{raw:score(screened,key,null),candidate:score(screened,key,selected.model)},
   improvesFinalBrier:calibrated.brier<raw.brier,
   improvesFinalLogLoss:calibrated.logLoss<raw.logLoss,
   candidates:candidates.map(c=>({penalty:c.penalty,tuning:score(tune,key,c.model)}))};
 }
 return {status:'exploratory',deployed:false,validated:false,productionBettingApproved:false,
  partition:{tuneStart,testStart,training:train.length,tuning:tune.length,finalPeriod:test.length},markets,
  method:'Calibrazione logistica regolarizzata: addestramento sul primo 50% delle date, scelta sul successivo 20%, confronto finale sulle date restanti. Inclusa opzione di non modificare le stime.',
  limitations:['Archivio già esaminato: il periodo finale non è una nuova prova prospettica indipendente.',
   'Correggere separatamente GG e Over 2.5 non definisce una distribuzione coerente per 1X2 e combo: nessuna sostituzione automatica del modello.',
   'Nessuna quota prepartita o rendimento economico verificato.']};
}
// A single home/away rate correction defines a joint Poisson distribution;
// unlike separate binary recalibrations it can preserve combo coherence.
export function pairedDateInterval(rows,key,adjustedRows,iterations=2000){
 const dates=new Map();
 rows.forEach((row,i)=>{
  const raw=row.probabilities[key]/100,candidate=adjustedRows[i].probabilities[key]/100,y=row.truth[key];
  const block=dates.get(row.date)||{n:0,delta:0};block.n++;block.delta+=(raw-y)**2-(candidate-y)**2;dates.set(row.date,block);
 });
 const blocks=[...dates.values()];if(blocks.length<2)return {dateBlocks:blocks.length,lower:null,upper:null};
 let state=271828183;
 const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const differences=[];
 for(let b=0;b<iterations;b++){let sum=0,n=0;for(let i=0;i<blocks.length;i++){const x=blocks[Math.floor(random()*blocks.length)];sum+=x.delta;n+=x.n;}differences.push(sum/n);}
 differences.sort((a,b)=>a-b);
 return {dateBlocks:blocks.length,iterations,lower:differences[Math.floor(iterations*.025)],upper:differences[Math.floor(iterations*.975)],method:'Bootstrap appaiato per data, intervallo descrittivo 95%; dipendenze fra date e campionati possono rimanere.'};
}
export function jointRateCalibration(observations){
 const ordered=observations.slice().sort((a,b)=>a.date.localeCompare(b.date));
 const dates=[...new Set(ordered.map(r=>r.date))];
 const tuneStart=dates[Math.floor(dates.length*.5)],testStart=dates[Math.floor(dates.length*.7)];
 const train=ordered.filter(r=>r.date<tuneStart),tune=ordered.filter(r=>r.date>=tuneStart&&r.date<testStart),test=ordered.filter(r=>r.date>=testStart);
 const sum=(key,side)=>train.reduce((s,r)=>s+r[key][side],0);
 const factors={home:sum('actualGoals','home')/sum('expectedGoals','home'),away:sum('actualGoals','away')/sum('expectedGoals','away')};
 const transform=(rows,strength)=>rows.map(row=>{
  const h=row.expectedGoals.home*Math.pow(factors.home,strength),a=row.expectedGoals.away*Math.pow(factors.away,strength),t=h+a;
  return {...row,probabilities:{...row.probabilities,btts:Math.round(100*(1-Math.exp(-h))*(1-Math.exp(-a))),over25:Math.round(100*(1-Math.exp(-t)*(1+t+t*t/2)))}};
 });
 // Strength zero explicitly preserves rounded production predictions.
 const adjusted=(rows,strength)=>strength===0?rows:transform(rows,strength);
 const loss=(rows,strength)=>(score(adjusted(rows,strength),'btts',null).brier+score(adjusted(rows,strength),'over25',null).brier)/2;
 const candidates=[0,.25,.5,.75,1].map(strength=>({strength,tuningBrier:loss(tune,strength)}));
 const selected=candidates.slice().sort((a,b)=>a.tuningBrier-b.tuningBrier||a.strength-b.strength)[0];
 const metrics=Object.fromEntries(['btts','over25'].map(key=>[key,{raw:score(test,key,null),candidate:score(adjusted(test,selected.strength),key,null),improvementInterval:pairedDateInterval(test,key,adjusted(test,selected.strength)),screenedRaw:score(test.filter(r=>r.selected===key),key,null),screenedCandidate:score(adjusted(test.filter(r=>r.selected===key),selected.strength),key,null)}]));
 return {fittedFactors:factors,chosenStrength:selected.strength,candidates,finalPeriod:metrics,
  improvesBothFinalMarkets:Object.values(metrics).every(m=>m.candidate.brier<m.raw.brier),
  deployed:false,method:'Fattori casa/trasferta stimati solo nel primo periodo; intensità scelta sul periodo intermedio minimizzando la media Brier di GG e Over 2.5. Nessuna scelta sul periodo finale.'};
}
export function buildCalibrationAudit(data){
 const estimate=(h,a,hi,ai)=>{
  const stats=(games,id)=>{const s=teamStats(games,id);return {...s,averageFor:s.averageFor===null?null:+s.averageFor.toFixed(2),averageAgainst:s.averageAgainst===null?null:+s.averageAgainst.toFixed(2)};};
  return goalEstimateFromStats(stats(h,hi),stats(a,ai));
 };
 const observations=openDataObservations(estimate,data).observations;
 return {...chronologicalCalibration(observations),jointRate:jointRateCalibration(observations)};
}
