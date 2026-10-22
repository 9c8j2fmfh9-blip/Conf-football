// Descriptive player markets for MyCombo research. No odds or win probabilities.
const rules=[
 {id:'shots_on_target',labels:/^(tiri in porta|shots on target|tiri nello specchio)$/i,line:0.5,minAverage:0.75,label:'1+ tiro in porta'},
 {id:'shots_total',labels:/^(tiri|tiri totali|total shots|shots)$/i,line:1.5,minAverage:1.75,label:'2+ tiri totali'},
 {id:'fouls_committed',labels:/^(falli commessi|fouls committed|fouls)$/i,line:0.5,minAverage:0.75,label:'1+ fallo commesso'}
];
export function playerMarketResearch(report,{minGames=3,maxCandidates=3}={}){
 if(!report?.available)return [];
 const result=[];
 for(const side of ['home','away'])for(const player of report.players?.[side]||[]){
  if(!player?.name || (player.appearances||0)<minGames)continue;
  const stats=Object.values(player.stats||{}).flatMap(group=>Object.values(group||{}));
  for(const rule of rules){
   const found=stats.filter(v=>rule.labels.test(String(v?.label||'').trim())&&Number.isFinite(v?.average)&&v.count>=minGames)
    .sort((a,b)=>b.count-a.count)[0];
   if(!found||found.average<rule.minAverage)continue;
   result.push({player:player.name,side,market:rule.id,label:player.name+' · '+rule.label,
    average:found.average,sample:found.count,indicativeLine:rule.line,
    bookmakerOdds:null,probability:null,starterConfirmed:false,descriptiveOnly:true});
  }
 }
 return result.sort((a,b)=>b.sample-a.sample||b.average-a.average||a.player.localeCompare(b.player)).slice(0,maxCandidates);
}
