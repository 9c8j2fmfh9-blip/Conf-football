import {openDataCompletedGames,openDataObservations,teamStats} from './open-data.js';
import {goalEstimateFromStats} from './experimental-goals.js';
import {pairedDateInterval} from './calibration-audit.js';

export const opponentCandidates=[.015,.04,.08].flatMap(learningRate=>[.01,.05].map(penalty=>({learningRate,penalty})));
const clamp=x=>Math.max(.15,Math.min(4,x));
function probabilities(home,away){
 const t=home+away;
 return {btts:Math.round(100*(1-Math.exp(-home))*(1-Math.exp(-away))),over25:Math.round(100*(1-Math.exp(-t)*(1+t+t*t/2)))};
}
// Atomic date batches: no result on a forecast date can alter another forecast.
// Separate league states avoid transferring ratings between unrelated competitions.
export function opponentForecasts(games,{learningRate,penalty}){
 const leagues=new Map(),output=new Map();
 const ordered=games.slice().sort((a,b)=>a.resultDate.localeCompare(b.resultDate)||a.id.localeCompare(b.id));
 for(let i=0;i<ordered.length;){
  let end=i+1;while(end<ordered.length&&ordered[end].resultDate===ordered[i].resultDate)end++;
  const updates=[];
  for(const game of ordered.slice(i,end)){
   let league=leagues.get(game.sourceLeague);
   if(!league){league={n:0,home:0,away:0,teams:new Map()};leagues.set(game.sourceLeague,league);}
   const get=id=>{if(!league.teams.has(id))league.teams.set(id,{attack:0,defense:0,n:0});return league.teams.get(id);};
   const h=get(game.homeTeam.id),a=get(game.awayTeam.id);
   const baseH=(league.home+20*1.45)/(league.n+20),baseA=(league.away+20*1.15)/(league.n+20);
   const home=clamp(baseH*Math.exp(h.attack+a.defense)),away=clamp(baseA*Math.exp(a.attack+h.defense));
   if(league.n>=30&&h.n>=6&&a.n>=6)output.set(game.id,{probabilities:probabilities(home,away),expectedGoals:{home,away},leagueN:league.n,homeN:h.n,awayN:a.n});
   updates.push({league,h,a,hg:game.score.home,ag:game.score.away,home,away});
  }
  // Sum gradients before applying them: input ordering within a date is irrelevant.
  const gradients=new Map();
  for(const u of updates){
   const add=(team,attack,defense)=>{const g=gradients.get(team)||{attack:0,defense:0,n:0};g.attack+=attack;g.defense+=defense;g.n++;gradients.set(team,g);};
   const eh=u.hg-u.home,ea=u.ag-u.away;
   add(u.h,eh,ea);add(u.a,ea,eh);
   u.league.n++;u.league.home+=u.hg;u.league.away+=u.ag;
  }
  for(const [team,g] of gradients){
   const rate=learningRate/Math.sqrt(1+team.n/10);
   team.attack=Math.max(-1.5,Math.min(1.5,team.attack+rate*(g.attack-penalty*g.n*team.attack)));
   team.defense=Math.max(-1.5,Math.min(1.5,team.defense+rate*(g.defense-penalty*g.n*team.defense)));
   team.n+=g.n;
  }
  i=end;
 }
 return output;
}
function metrics(rows,key){
 if(!rows.length)return{n:0,brier:null,logLoss:null,meanForecast:null,observedRate:null};
 const mean=fn=>rows.reduce((s,r)=>s+fn(r),0)/rows.length;
 const p=r=>Math.max(.001,Math.min(.999,r.probabilities[key]/100));
 return {n:rows.length,brier:mean(r=>(r.probabilities[key]/100-r.truth[key])**2),logLoss:mean(r=>-r.truth[key]*Math.log(p(r))-(1-r.truth[key])*Math.log(1-p(r))),meanForecast:mean(r=>r.probabilities[key]/100),observedRate:mean(r=>r.truth[key])};
}
export function buildOpponentAudit(data){
 const estimate=(h,a,hi,ai)=>{
  const stats=(games,id)=>{const s=teamStats(games,id);return {...s,averageFor:s.averageFor===null?null:+s.averageFor.toFixed(2),averageAgainst:s.averageAgainst===null?null:+s.averageAgainst.toFixed(2)};};
  return goalEstimateFromStats(stats(h,hi),stats(a,ai));
 };
 const source=openDataObservations(estimate,data),games=openDataCompletedGames(data),rows=source.observations;
 const dates=[...new Set(rows.map(r=>r.date))].sort(),tuneStart=dates[Math.floor(dates.length*.5)],testStart=dates[Math.floor(dates.length*.7)];
 const tuning=rows.filter(r=>r.date>=tuneStart&&r.date<testStart),test=rows.filter(r=>r.date>=testStart);
 if(tuning.length<100||test.length<100)throw Error('Insufficient chronological evaluation data');
 const transform=(subset,forecasts)=>subset.map(r=>forecasts.has(r.id)?{...r,probabilities:{...r.probabilities,...forecasts.get(r.id).probabilities}}:r);
 const averageLoss=subset=>(metrics(subset,'btts').brier+metrics(subset,'over25').brier)/2;
 const candidates=[{parameters:null,tuningBrier:averageLoss(tuning),forecasts:null},...opponentCandidates.map(parameters=>{
  const forecasts=opponentForecasts(games,parameters);
  return{parameters,forecasts,tuningBrier:averageLoss(transform(tuning,forecasts))};
 })];
 const selected=candidates.slice().sort((a,b)=>a.tuningBrier-b.tuningBrier)[0];
 const predictions=selected.forecasts?transform(test,selected.forecasts):test;
 const markets=Object.fromEntries(['btts','over25'].map(key=>[key,{raw:metrics(test,key),candidate:metrics(predictions,key),improvementInterval:pairedDateInterval(test,key,predictions),screenedRaw:metrics(test.filter(r=>r.selected===key),key),screenedCandidate:metrics(predictions.filter(r=>r.selected===key),key)}]));
 return {status:'exploratory',deployed:false,validated:false,productionBettingApproved:false,
  source:{generatedAt:source.generatedAt,fixtures:source.sourceFixtures,competitions:source.competitions},
  partition:{tuneStart,testStart,tuning:tuning.length,finalPeriod:test.length},chosenParameters:selected.parameters,
  finalCandidateCoverage:selected.forecasts?test.filter(r=>selected.forecasts.has(r.id)).length:0,
  candidates:candidates.map(({forecasts,...c})=>c),markets,
  improvesBothFinalMarkets:Object.values(markets).every(m=>m.candidate.brier<m.raw.brier),
  stableImprovementBoth:Object.values(markets).every(m=>m.improvementInterval.lower>0),
  method:'Rating Poisson di attacco e difesa aggiornati rispetto agli avversari; medie casa/trasferta per campionato da risultati precedenti. Minimo 30 partite di lega e 6 per squadra, altrimenti modello attuale. Aggiornamenti solo dopo l’intera data. Scelta di sei candidati o nessuna modifica sul periodo intermedio; confronto finale separato.',
  limitations:['Archivio già esaminato: questo confronto resta esplorativo, non una prova prospettica indipendente.','Stime non calibrate né validate economicamente; nessuna modifica al modello in produzione.','Contesto insufficiente nelle coppe e nelle nuove squadre: in quel caso resta la stima del modello attuale.']};
}
