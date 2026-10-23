import {playerMarketResearch} from './mycombo-player-research.js';
import {selectFixture} from './conf-selection.js';
import {MULTIPLE_MINIMUM_SCORE} from './multiple-policy.js';

const club=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

const goalKeys=new Set(['one','draw','two','over25','btts','over35','bttsOver25']);
// Player averages have no event probability: never count them toward a >=70% combo.
const marketCount=leg=>Number(Boolean(leg.goal))+Number(Boolean(leg.corner));

// These are unpriced drafts. Never infer MyCombo prices or joint probabilities
// by multiplying marginal percentages or individual market odds.
export function buildAlternativeMultiples(fixtures,{now=Date.now(),minimumScore=MULTIPLE_MINIMUM_SCORE}={}) {
 const options=[],seen=new Set();
 for(const f of fixtures){
  const kickoff=Date.parse(f.date);
  if(f.status!=='NS'||f.dataStale||!Number.isFinite(kickoff)||kickoff<=now)continue;
  const home=club(f.home),away=club(f.away);
  if(!home||!away||home===away)continue;
  const identity=[home,away,kickoff].join('|');
  if(seen.has(identity))continue;
  const selection=selectFixture(f,minimumScore);
  const goal=selection.candidates.find(p=>goalKeys.has(p.key));
  // Total FT corners are supplied as Diretta historical stat markets. Older
  // corner providers use kind=corner; support both while excluding team/half lines.
  const corner=selection.candidates.find(p=>p.kind==='corner'&&p.side==='total'&&(p.half||'full')==='full')
   ||selection.candidates.find(p=>p.kind==='diretta_stat'&&p.metric==='corners'&&p.key.startsWith('diretta_total_corners_'));
  const playerMarkets=playerMarketResearch(f.direttaPlayerStats);
  if(!goal&&!corner)continue;
  seen.add(identity);
  const evidenceScores=[goal?.evidence,corner?.evidence].filter(Number.isFinite);
  options.push({fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,league:f.league,
   goal:goal?{key:goal.key,label:goal.label,score:goal.score,scoreKind:'model',historicalScore:goal.historicalScore,samples:goal.samples}:null,
   corner:corner?{key:corner.key,label:corner.label,score:corner.score,scoreKind:'historical',hits:corner.hits,sample:corner.sample,samples:corner.samples,side:'total',half:'full',line:corner.line}:null,
   playerMarkets,
   marketCount:0,
   evidence:evidenceScores.length?Math.min(...evidenceScores):0});
  options[options.length-1].marketCount=marketCount(options[options.length-1]);
 }
 options.sort((a,b)=>b.marketCount-a.marketCount||b.evidence-a.evidence||
  Math.min(b.goal?.score??0,b.corner?.score??0)-Math.min(a.goal?.score??0,a.corner?.score??0)||
  Date.parse(a.date)-Date.parse(b.date)||String(a.fixtureId).localeCompare(String(b.fixtureId)));
 const comboPool=[],partialPool=[],clubs=new Set(),ids=new Set();
 for(const option of options){
  const h=club(option.home),a=club(option.away),id=String(option.fixtureId);
  if(clubs.has(h)||clubs.has(a)||ids.has(id))continue;
  clubs.add(h);clubs.add(a);ids.add(id);
  const {evidence,marketCount:_,...leg}=option;
  if(option.marketCount>=2)comboPool.push(leg);else partialPool.push(leg);
 }
 return [10,100].map((target,i)=>{
  const maxMatches=i===0?3:5;
  const legs=comboPool.slice(0,maxMatches);
  const partial=partialPool.slice(0,maxMatches);
  return {target,title:'Quota '+target+' alternativa',available:legs.length>0,isMultiple:legs.length>=2,
   totalOdds:null,oddsVerified:false,targetReached:false,maxMatches,eligibleCount:comboPool.length,legs,partial,
   reason:!legs.length?'Nessuna partita ha almeno due mercati sostenuti dai dati disponibili oggi.':
    legs.length===1?'Una partita supporta una MyCombo; per arrivare a una multipla servono altre partite con dati sufficienti.':
    comboPool.length<=3&&i===1?'Stesse partite della proposta compatta: sono le uniche con mercati combinabili nei dati di oggi.':
    i===0?'Bozza compatta: fino a 3 partite con almeno due mercati disponibili per gara.':
    'Bozza estesa: fino a 5 partite con almeno due mercati disponibili per gara.',
   note:'Ogni mercato gol o corner incluso supera la soglia '+minimumScore+'% di stima CONF (gol) o frequenza storica (corner). I dati giocatore sono solo approfondimenti facoltativi: non hanno una probabilità verificata e non rendono la combo qualificata. Quota non calcolata: verifica la combinazione su Sisal. Le percentuali dei singoli mercati non sono la probabilità congiunta della combo.'};
 });
}
