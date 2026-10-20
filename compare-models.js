import {cleanRows,forecast,MARKETS} from './reliability.js';
import {contextualForecast} from './contextual-model.js';
export function compareModels(leagues,asOf=Date.now()){
 const rows=[];
 for(const [league,data] of Object.entries(leagues)){
  const games=cleanRows(data,asOf);
  for(let i=0;i<games.length;i++){
   const game=games[i],prior=games.slice(0,i).filter(r=>r[0]<game[0]);
   const original=forecast(prior,game[1],game[2]),candidate=contextualForecast(prior,game[1],game[2]);
   if(!original||!candidate)continue;
   const truth={over25:Number(Number(game[3])+Number(game[4])>=3),btts:Number(Number(game[3])>0&&Number(game[4])>0)};
   rows.push({date:game[0],league,original,candidate,truth});
  }
 }
 // Fixed calendar split, never select or tune parameters using the holdout outcomes.
 const split='2026-02-01';
 const measure=items=>Object.fromEntries(MARKETS.map(k=>[k,{count:items.length,originalBrier:items.length?items.reduce((s,r)=>s+(r.original[k]-r.truth[k])**2,0)/items.length:null,candidateBrier:items.length?items.reduce((s,r)=>s+(r.candidate[k]-r.truth[k])**2,0)/items.length:null}]));
 const development=measure(rows.filter(r=>r.date<split)),holdout=measure(rows.filter(r=>r.date>=split));
 const improved=MARKETS.every(k=>development[k].count>=200&&development[k].candidateBrier<development[k].originalBrier&&holdout[k].count>=200&&holdout[k].candidateBrier<holdout[k].originalBrier);
 return {candidate:'Recenza 0.9 e forma casa/trasferta con regolarizzazione',split,development,holdout,adopted:false,improvementObserved:improved,
  decision:improved?'Miglioramento descrittivo nei due periodi; candidato non attivato senza validazione su dati nuovi.':'Il candidato non migliora entrambi i mercati nei due periodi: il modello corrente resta invariato.',
  validated:false,limitations:'Un confronto retrospettivo non dimostra redditività. La motivazione non è ricostruibile dai soli risultati e non è usata per alterare le stime.'};
}
