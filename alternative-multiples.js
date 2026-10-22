import {playerMarketResearch} from './mycombo-player-research.js';
import {selectFixture} from './conf-selection.js';

const club=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

const goalKeys=new Set(['one','draw','two','over25','btts','over35','bttsOver25']);
// These are unpriced drafts. Never infer MyCombo prices or joint probabilities
// by multiplying the two marginal percentages or the individual market odds.
export function buildAlternativeMultiples(fixtures,{now=Date.now()}={}) {
 const options=[],seen=new Set();
 for(const f of fixtures){
  const kickoff=Date.parse(f.date);
  if(f.status!=='NS'||f.dataStale||!Number.isFinite(kickoff)||kickoff<=now)continue;
  const home=club(f.home),away=club(f.away);
  if(!home||!away||home===away)continue;
  const identity=[home,away,kickoff].join('|');
  if(seen.has(identity))continue;
  const selection=selectFixture(f);
  const goal=selection.candidates.find(p=>goalKeys.has(p.key));
  const corner=selection.candidates.find(p=>p.kind==='corner'&&p.side==='total'&&p.half==='full');
  const playerMarkets=playerMarketResearch(f.direttaPlayerStats);
  if(!goal||!corner)continue;
  seen.add(identity);
  options.push({fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,league:f.league,
   goal:{key:goal.key,label:goal.label,score:goal.score,scoreKind:'model',historicalScore:goal.historicalScore,samples:goal.samples},
   corner:{key:corner.key,label:corner.label,score:corner.score,scoreKind:'historical',hits:corner.hits,sample:corner.sample,samples:corner.samples,side:'total',half:'full',line:corner.line},
   playerMarkets,
   evidence:Math.min(goal.evidence,corner.evidence)});
 }
 options.sort((a,b)=>b.evidence-a.evidence || Math.min(b.goal.score,b.corner.score)-Math.min(a.goal.score,a.corner.score) || Date.parse(a.date)-Date.parse(b.date) || String(a.fixtureId).localeCompare(String(b.fixtureId)));
 const pool=[],clubs=new Set(),ids=new Set();
 for(const option of options){
  const h=club(option.home),a=club(option.away),id=String(option.fixtureId);
  if(clubs.has(h)||clubs.has(a)||ids.has(id))continue;
  clubs.add(h);clubs.add(a);ids.add(id);pool.push(option);
 }
 return [10,100].map((target,i)=>{
  const maxMatches=i===0?3:5;
  const legs=pool.slice(0,maxMatches).map(({evidence,...leg})=>leg);
  return {target,title:'Quota '+target+' alternativa',available:legs.length>0,isMultiple:legs.length>=2,
   totalOdds:null,oddsVerified:false,targetReached:false,maxMatches,eligibleCount:pool.length,legs,
   reason:!legs.length?'Nessuna partita ha insieme una proposta gol / risultato e corner totali qualificati.':
    legs.length===1?'Una sola combo qualificata disponibile: non basta per una multipla.':
    i===1&&pool.length<=3?'Stesse combo della proposta compatta: non ci sono altre partite qualificate da aggiungere.':
    i===0?'Proposta compatta: fino a 3 partite con le combinazioni meglio supportate dai dati.':'Proposta estesa: fino a 5 partite, senza abbassare i criteri di selezione.',
   note:'Obiettivo '+target+' non verificato. Quota MyCombo da verificare su Sisal. Le statistiche dei giocatori sono spunti opzionali, senza quota o probabilità; la formazione è da confermare. Le percentuali si riferiscono ai singoli mercati, non alla combo o alla multipla.'};
 });
}
