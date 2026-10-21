import {comparisonClub} from './comparison-odds.js';
// Each ticket belongs to one bookmaker. Scores are selection heuristics;
// they are never multiplied into an advertised chance of winning.
export function buildComparisonTickets(fixtures,quotes,{now=Date.now(),maxLegs=16}={}){
 const source=quotes.source||'Quote bookmaker';
 const records=new Map(quotes.fixtures.map(q=>[String(q.fixtureId),q]));const books=new Map();
 for(const f of fixtures){
  if(f.status!=='NS'||!Number.isFinite(Date.parse(f.date))||Date.parse(f.date)<=now||f.dataStale||!f.selection?.qualified)continue;
  const q=records.get(String(f.fixtureId));if(!q||Date.parse(q.date)!==Date.parse(f.date)||comparisonClub(q.home)!==comparisonClub(f.home)||comparisonClub(q.away)!==comparisonClub(f.away))continue;
  if(!Number.isFinite(Date.parse(q.observedAt))||now-Date.parse(q.observedAt)>5*60000||Date.parse(q.observedAt)>now+300000)continue;
  for(const book of Object.values(q.books)){
   const options=(f.selection.candidates||[f.selection.primary]).filter(p=>p&&p.kind!=='corner'&&Number.isFinite(p.score)&&p.score>=60&&p.score<=100&&book.odds[p.key]?.value>1&&!book.odds[p.key]?.ambiguous);
   options.sort((a,b)=>(b.evidence??0)-(a.evidence??0)||b.score-a.score);
   if(!options.length)continue;
   const p=options[0],price=book.odds[p.key];
   if(!books.has(book.code))books.set(book.code,{code:book.code,name:book.name,legs:[]});
   books.get(book.code).legs.push({fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,league:f.league,market:p.key,label:p.label,score:p.score,evidence:p.evidence??0,odds:price.value,bookmaker:book.name,bookmakerCode:book.code,sourceUpdatedAt:q.observedAt,sourceUrl:q.sourceUrl});
  }
 }
 const tickets=[10,100].map(target=>{
  const options=[];
  for(const book of books.values()){
   const sorted=[...book.legs].sort((a,b)=>b.evidence-a.evidence||b.score-a.score||Date.parse(a.date)-Date.parse(b.date));
   const legs=[],clubs=new Set(),ids=new Set();let total=1,cost=0;
   for(const leg of sorted){
    const h=comparisonClub(leg.home),a=comparisonClub(leg.away);if(clubs.has(h)||clubs.has(a)||ids.has(String(leg.fixtureId)))continue;
    if(!Number.isFinite(total*leg.odds))continue;
    legs.push(leg);clubs.add(h);clubs.add(a);ids.add(String(leg.fixtureId));total*=leg.odds;cost-=Math.log(leg.score/100);
    if(total>=target&&legs.length>=2||legs.length>=maxLegs)break;
   }
   if(legs.length>=2)options.push({target,available:true,targetReached:total>=target,fallback:total<target,totalOdds:Number(total.toFixed(2)),legs,bookmaker:book.name,bookmakerCode:book.code,cost});
  }
  options.sort((a,b)=>Number(b.targetReached)-Number(a.targetReached)||(a.targetReached?a.cost-b.cost:b.totalOdds-a.totalOdds)||a.legs.length-b.legs.length||a.totalOdds-b.totalOdds);
  const result=options[0];if(!result)return{target,available:false,totalOdds:null,legs:[],reason:'Quote aggiornate insufficienti per costruire una schedina con un unico bookmaker.'};
  const {cost,...ticket}=result;
  return {...ticket,reason:ticket.targetReached?'Obiettivo indicativo raggiunto con giocate qualificate e quote dello stesso bookmaker.':'Obiettivo non raggiunto: queste sono le giocate disponibili senza aggiungere mercati non qualificati.',source,indicative:true};
 });
 return {tickets,bookmaker:tickets.find(t=>t.available)?.bookmaker||null,eligibleCount:Math.max(0,...[...books.values()].map(b=>b.legs.length)),source,sourceUpdatedAt:quotes.fixtures.map(q=>q.observedAt).filter(Boolean).sort()[0]||null,comparison:true,maxLegs,
  method:'Schedine con un unico bookmaker per ciascuna proposta, quote rilevate dalla fonte indicata e totale indicativo. Soglia CONF e campioni invariati; massimo '+maxLegs+' partite, nessuna squadra ripetuta. Quota 100 è un obiettivo indicativo, senza tetto a 100: la selezione si ferma quando lo raggiunge. Nessuna probabilità di vincita della multipla viene stimata.'};
}
