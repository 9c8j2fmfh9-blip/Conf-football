import {pricedSelection,MINIMUM_ODDS} from './priced-selection.js';
import {matchProposalOdds} from './sisal-odds.js';

// Try all independently qualified priced markets, one per fixture. The node
// budget bounds response time; when reached, label the result as best found.
function bestAvailableTicket(fixtures,sheet,{now,club}){
 const seen=new Set(),groups=[];
 for(const f of fixtures){
  if(!f.selection?.qualified||f.dataStale||f.status!=='NS'||!Number.isFinite(Date.parse(f.date))||Date.parse(f.date)<=now||seen.has(String(f.fixtureId)))continue;
  seen.add(String(f.fixtureId));
  const options=(f.selection.candidates||[f.selection.primary]).filter(p=>p&&Number.isFinite(p.score)&&p.score>=60&&p.score<=100).map(p=>{
   const price=matchProposalOdds({...f,selection:{primary:p}},sheet,{now}).sisal;
   return price.available?{fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,league:f.league,market:p.key,label:p.label,score:p.score,odds:price.value,sourceUpdatedAt:price.sourceUpdatedAt}:null;
  }).filter(Boolean).sort((a,b)=>b.odds-a.odds||b.score-a.score);
  if(options.length)groups.push({options,home:club(f.home),away:club(f.away)});
 }
 groups.sort((a,b)=>b.options[0].odds-a.options[0].odds);
 const upper=Array(groups.length+1).fill(1);for(let i=groups.length-1;i>=0;i--)upper[i]=upper[i+1]*groups[i].options[0].odds;
 let best=null,visits=0,limited=false;
 function visit(i,total,legs,clubs){
  if(++visits>200000){limited=true;return;}
  if(legs.length>=2&&total<=100&&(!best||total>best.total))best={total,legs};
  if(i===groups.length||Math.min(100,total*upper[i])<=(best?.total||1))return;
  const g=groups[i];
  if(!clubs.has(g.home)&&!clubs.has(g.away))for(const leg of g.options){
   if(total*leg.odds<=100)visit(i+1,total*leg.odds,[...legs,leg],new Set([...clubs,g.home,g.away]));
   if(limited)break;
  }
  if(!limited)visit(i+1,total,legs,clubs);
 }
 visit(0,1,[],new Set());return best?{...best,searchComplete:!limited}:null;
}

// Highest confidence tiers first. Bounded subset search avoids forcing every
// intervening low-priced leg into a ticket. Percentages are experimental scores,
// never presented as a calibrated joint probability.
export function buildDailyMultiples(fixtures,sheet,{now=Date.now(),minimumOdds=MINIMUM_ODDS}={}){
 const seen=new Set();
 const candidates=[];
 for(const f of fixtures){
  if(!f.selection?.qualified || f.dataStale || f.status!=='NS' || Date.parse(f.date)<=now || !Number.isFinite(Date.parse(f.date)) || seen.has(String(f.fixtureId)))continue;
  const chosen=pricedSelection(f,sheet,{now,minimumOdds});
  const p=chosen.primary;
  if(!p || !Number.isFinite(p.score) || p.score<60 || p.score>100)continue;
  const price=chosen.odds.sisal;
  if(!price.available)continue;
  seen.add(String(f.fixtureId));
  candidates.push({fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,league:f.league,market:p.key,label:p.label,score:p.score,odds:price.value,sourceUpdatedAt:price.sourceUpdatedAt});
 }
 candidates.sort((a,b)=>b.score-a.score || Date.parse(a.date)-Date.parse(b.date) || String(a.fixtureId).localeCompare(String(b.fixtureId)));
 const club=name=>String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const tickets=[10,100].map(target=>{
  const low=target*.9,high=target*1.1;
  let states=[{legs:[],total:1,cost:0,pricePenalty:0,clubs:new Set()}];
  let chosen=null;
  for(let i=0;i<candidates.length;i++){
   const leg=candidates[i],home=club(leg.home),away=club(leg.away);
   const additions=[];
   for(const s of states){
    const total=s.total*leg.odds;
    if(total>high || s.clubs.has(home) || s.clubs.has(away))continue;
    const next={legs:[...s.legs,leg],total,cost:s.cost-Math.log(leg.score/100),pricePenalty:s.pricePenalty+Math.max(0,Math.log(minimumOdds/leg.odds)),clubs:new Set([...s.clubs,home,away])};
    additions.push(next);
   }
   const pool=[...states,...additions];
   // Finish a full confidence tier before choosing a ticket.
   if(i===candidates.length-1 || candidates[i+1].score<leg.score){
    chosen=pool.filter(s=>s.legs.length>=2&&s.total>=low&&s.total<=high)
     .sort((a,b)=>a.pricePenalty-b.pricePenalty || a.cost-b.cost || Math.abs(a.total-target)-Math.abs(b.total-target) || a.legs.length-b.legs.length)[0]||null;
    if(chosen)break;
   }
   const bins=new Map();
   for(const s of pool){
    const bin=Math.floor(Math.log(s.total)*100);
    // Retain several alternatives: the same price can use different clubs.
    const bucket=bins.get(bin)||[];bucket.push(s);
    bucket.sort((a,b)=>a.pricePenalty-b.pricePenalty || a.cost-b.cost || a.legs.length-b.legs.length);
    if(bucket.length>4)bucket.length=4;
    bins.set(bin,bucket);
   }
   states=[...bins.values()].flat();
  }
  if(!chosen&&target===100){
   const fallback=bestAvailableTicket(fixtures,sheet,{now,club});
   if(fallback)return{target,available:true,targetReached:fallback.total>=low,fallback:fallback.total<low,searchComplete:fallback.searchComplete,totalOdds:Number(fallback.total.toFixed(2)),legs:fallback.legs,bookmaker:'Sisal',reason:fallback.total<low?'Obiettivo quota 100 non raggiunto: '+(fallback.searchComplete?'massima quota disponibile':'migliore quota trovata')+' con proposte qualificate e quote verificate.':'Obiettivo raggiunto con mercati alternativi qualificati.'};
  }
  return chosen?{target,available:true,targetReached:true,fallback:false,totalOdds:Number(chosen.total.toFixed(2)),legs:chosen.legs,bookmaker:'Sisal'}:
   {target,available:false,totalOdds:null,legs:[],reason:!candidates.length&&fixtures.some(f=>f.selection?.qualified)?'Nessuna quota Sisal verificabile per le proposte attuali: multipla non calcolabile.':'Non ci sono combinazioni vicine a quota '+target+' con le proposte qualificate e le quote verificate disponibili.'};
 });
 return {bookmaker:'Sisal',sourceUpdatedAt:sheet?.sourceUpdatedAt||null,eligibleCount:candidates.length,preferredMinimumOdds:minimumOdds,tolerancePercent:10,tickets,
  method:'Combinazioni tra le percentuali più alte, prima le fasce migliori e poi meno peso alle quote basse; una giocata per partita e nessuna squadra ripetuta. Sotto quota '+minimumOdds.toFixed(2)+' si cerca un mercato alternativo qualificato con quota ufficiale più alta, inclusi Over 3.5 e GG + Over 2.5. Se manca, la proposta originale resta consultabile e utilizzabile. Obiettivo quota ±10%. Se quota 100 non è raggiungibile, si mostra la migliore quota trovata entro 100 considerando tutti i mercati alternativi qualificati, senza abbassare i criteri. Quote dei fogli ufficiali, non live. Le percentuali delle singole sono stime sperimentali: non indicano la probabilità di vincere la multipla.'};
}
