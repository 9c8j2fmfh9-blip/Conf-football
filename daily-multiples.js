import {matchProposalOdds} from './sisal-odds.js';

// Highest confidence tiers first. Bounded subset search avoids forcing every
// intervening low-priced leg into a ticket. Percentages are experimental scores,
// never presented as a calibrated joint probability.
export function buildDailyMultiples(fixtures,sheet,{now=Date.now()}={}){
 const seen=new Set();
 const candidates=[];
 for(const f of fixtures){
  const p=f.selection?.primary;
  if(!p || !f.selection.qualified || f.dataStale || f.status!=='NS' || Date.parse(f.date)<=now || !Number.isFinite(Date.parse(f.date)) || !Number.isFinite(p.score) || p.score<60 || p.score>100 || seen.has(String(f.fixtureId)))continue;
  const price=matchProposalOdds(f,sheet,{now}).sisal;
  if(!price.available)continue;
  seen.add(String(f.fixtureId));
  candidates.push({fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,league:f.league,market:p.key,label:p.label,score:p.score,odds:price.value,sourceUpdatedAt:price.sourceUpdatedAt});
 }
 candidates.sort((a,b)=>b.score-a.score || Date.parse(a.date)-Date.parse(b.date) || String(a.fixtureId).localeCompare(String(b.fixtureId)));
 const club=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const tickets=[10,100].map(target=>{
  const low=target*.9,high=target*1.1;
  let states=[{legs:[],total:1,cost:0,clubs:new Set()}];
  let chosen=null;
  for(let i=0;i<candidates.length;i++){
   const leg=candidates[i],home=club(leg.home),away=club(leg.away);
   const additions=[];
   for(const s of states){
    const total=s.total*leg.odds;
    if(total>high || s.clubs.has(home) || s.clubs.has(away))continue;
    const next={legs:[...s.legs,leg],total,cost:s.cost-Math.log(leg.score/100),clubs:new Set([...s.clubs,home,away])};
    additions.push(next);
   }
   const pool=[...states,...additions];
   // Finish a full confidence tier before choosing a ticket.
   if(i===candidates.length-1 || candidates[i+1].score<leg.score){
    chosen=pool.filter(s=>s.legs.length>=2&&s.total>=low&&s.total<=high)
     .sort((a,b)=>a.cost-b.cost || Math.abs(a.total-target)-Math.abs(b.total-target) || a.legs.length-b.legs.length)[0]||null;
    if(chosen)break;
   }
   const bins=new Map();
   for(const s of pool){
    const bin=Math.floor(Math.log(s.total)*100);
    // Retain several alternatives: the same price can use different clubs.
    const bucket=bins.get(bin)||[];bucket.push(s);
    bucket.sort((a,b)=>a.cost-b.cost || a.legs.length-b.legs.length);
    if(bucket.length>4)bucket.length=4;
    bins.set(bin,bucket);
   }
   states=[...bins.values()].flat();
  }
  return chosen?{target,available:true,totalOdds:Number(chosen.total.toFixed(2)),legs:chosen.legs,bookmaker:'Sisal'}:
   {target,available:false,totalOdds:null,legs:[],reason:'Non ci sono combinazioni vicine a quota '+target+' con le proposte qualificate e le quote verificate disponibili.'};
 });
 return {bookmaker:'Sisal',sourceUpdatedAt:sheet?.sourceUpdatedAt||null,eligibleCount:candidates.length,tolerancePercent:10,tickets,
  method:'Combinazioni tra le percentuali più alte, prima le fasce migliori; una giocata per partita e nessuna squadra ripetuta. Obiettivo quota ±10%. Quote del foglio ufficiale, non live. Le percentuali delle singole sono stime sperimentali: non indicano la probabilità di vincere la multipla.'};
}
