import {matchProposalOdds} from './sisal-odds.js';
export const MINIMUM_ODDS=1.60;
// A higher-priced market may replace the primary only if it independently
// passed the same history, sample and model requirements.
export function pricedSelection(fixture,sheet,{now=Date.now(),minimumOdds=MINIMUM_ODDS}={}){
 const candidates=fixture.selection?.qualified?(fixture.selection.candidates||[fixture.selection.primary]).filter(Boolean):[];
 const priced=candidates.map(primary=>({primary,odds:matchProposalOdds({...fixture,selection:{...fixture.selection,primary}},sheet,{now})}));
 const accepted=priced.find(x=>x.odds.sisal.available&&x.odds.sisal.value>=minimumOdds);
 const primary=accepted?.primary||fixture.selection?.primary||null;
 const odds=accepted?.odds||matchProposalOdds({...fixture,selection:{...fixture.selection,primary}},sheet,{now});
 if(odds.sisal.available)odds.sisal.belowMinimum=odds.sisal.value<minimumOdds;
 const alternatives=['over35','bttsOver25'].map(key=>({key,label:fixture.markets?.[key]?.label||key,score:fixture.experimentalEstimate?.estimates?.[key]??null,historicalScore:fixture.markets?.[key]?.score??null,qualified:candidates.some(p=>p.key===key),odds:matchProposalOdds({...fixture,selection:{primary:{key}}},sheet,{now})}));
 return {primary,odds,alternatives,minimumOdds};
}
