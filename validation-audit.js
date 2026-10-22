import {openDataObservations,teamStats} from './open-data.js';
import {goalEstimateFromStats} from './experimental-goals.js';
export const auditMarkets=['one','draw','two','over25','btts','over35','bttsOver25'];
const estimate=(h,a,hi,ai)=>{
 const rounded=(games,id)=>{const s=teamStats(games,id);return {...s,averageFor:s.averageFor===null?null:+s.averageFor.toFixed(2),averageAgainst:s.averageAgainst===null?null:+s.averageAgainst.toFixed(2)};};
 return goalEstimateFromStats(rounded(h,hi),rounded(a,ai));
};
const summary=rows=>{
 if(!rows.length)return {n:0,brier:null,baselineBrier:null,meanForecast:null,observedRate:null};
 const avg=fn=>rows.reduce((s,r)=>s+fn(r),0)/rows.length;
 return {n:rows.length,brier:+avg(r=>(r.p-r.y)**2).toFixed(5),baselineBrier:+avg(r=>(r.base-r.y)**2).toFixed(5),meanForecast:+avg(r=>r.p).toFixed(4),observedRate:+avg(r=>r.y).toFixed(4)};
};
// Public for leakage regression tests: process whole dates before updating prior.
export function priorBenchmarks(observations){
 const leagueStats=new Map(),global={n:0,hits:Object.fromEntries(auditMarkets.map(k=>[k,0]))};
 const output=[];
 const sorted=observations.slice().sort((a,b)=>a.date.localeCompare(b.date));
 for(let i=0;i<sorted.length;){
  let end=i+1;while(end<sorted.length&&sorted[end].date===sorted[i].date)end++;
  for(const row of sorted.slice(i,end)){
   const local=leagueStats.get(row.league);
   const history=local?.n>=30?local:global;
   if(history.n>=30)output.push({...row,baseline:Object.fromEntries(auditMarkets.map(k=>[k,(history.hits[k]+5)/(history.n+10)]))});
  }
  for(const row of sorted.slice(i,end)){
   let local=leagueStats.get(row.league);
   if(!local){local={n:0,hits:Object.fromEntries(auditMarkets.map(k=>[k,0]))};leagueStats.set(row.league,local);}
   for(const stats of [local,global]){stats.n++;for(const k of auditMarkets)stats.hits[k]+=row.truth[k];}
  }
  i=end;
 }
 return output;
}
export function buildValidationAudit(data){
 const source=openDataObservations(estimate,data);
 const evaluated=priorBenchmarks(source.observations);
 const dates=[...new Set(evaluated.map(r=>r.date))].sort();
 const cutoff=dates[Math.floor(dates.length*.7)]||null;
 const holdout=evaluated.filter(r=>r.date>=cutoff);
 const marketSummary=(rows,key)=>summary(rows.map(r=>({p:r.probabilities[key]/100,y:r.truth[key],base:r.baseline[key]})));
 const markets=Object.fromEntries(auditMarkets.map(key=>{
  const train=evaluated.filter(r=>r.date<cutoff);
  const bucketRows=holdout.map(r=>({p:r.probabilities[key]/100,y:r.truth[key],base:r.baseline[key]}));
  return [key,{development:marketSummary(train,key),laterPeriod:marketSummary(holdout,key),
   screened:marketSummary(holdout.filter(r=>r.selected===key),key),
   buckets:[[0,.4],[.4,.5],[.5,.6],[.6,.7],[.7,1.01]].map(([low,high])=>({from:low,to:Math.min(1,high),...summary(bucketRows.filter(r=>r.p>=low&&r.p<high))}))}];
 }));
 const byLeague=Object.fromEntries([...new Set(holdout.map(r=>r.league))].sort().map(league=>[league,{n:holdout.filter(r=>r.league===league).length,markets:Object.fromEntries(auditMarkets.map(k=>[k,marketSummary(holdout.filter(r=>r.league===league),k)]))}]));
 return {status:'experimental',validated:false,productionBettingApproved:false,
  source:{generatedAt:source.generatedAt,fixtures:source.sourceFixtures,competitions:source.competitions},
  evaluatedFixtures:evaluated.length,eligibleFixtures:source.observations.length,laterPeriodStart:cutoff,laterPeriodFixtures:holdout.length,
  testedCompetitions:new Set(evaluated.map(r=>r.league)).size,markets,byLeague,
  method:'Replay del provider principale con ultimi 10 risultati, almeno 6 per squadra; calcolo e selezione condivisi con app. Benchmark aggiornato solo dopo ogni data, almeno 30 osservazioni precedenti; prior Beta(5,5).',
  limitations:['Archivio retrospettivo, non prova indipendente: parte delle partite è già stata esaminata durante lo sviluppo.',
   'La freschezza delle fonti al momento storico non è verificabile; il controllo riguarda il modello, non la disponibilità operativa dei dati.',
   'Nessuna quota prepartita archiviata: rendimento, valore delle quote e multiple non validati.',
   'Corner esclusi da questa verifica delle probabilità dei gol; gli incontri fra competizioni condividono gli storici come nel provider principale.']};
}
