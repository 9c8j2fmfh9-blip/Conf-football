// Dependency-free, chronological evaluation. No evaluation outcome is used in its forecast.
export const MARKETS = ['over25', 'btts'];
export function cleanRows(rows, asOf = Date.now()) {
  const seen = new Set();
  return rows.filter(row => {
    const [date,h,a,hg,ag] = row;
    const key = `${date}|${h}|${a}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !h || !a || h === a || seen.has(key)) return false;
    if (![hg,ag].every(x => /^\d+$/.test(String(x)))) return false;
    // Date-only records become eligible the following UTC day.
    if (Date.parse(date+'T00:00:00Z') + 86400000 > asOf) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a[0].localeCompare(b[0]));
}
const truth = r => ({over25: Number(Number(r[3])+Number(r[4])>=3), btts:Number(Number(r[3])>0&&Number(r[4])>0)});
export function forecast(history, home, away) {
  const recent = team => history.filter(r=>r[1]===team||r[2]===team).slice(-10);
  const h=recent(home),a=recent(away);
  if(h.length<6||a.length<6)return null;
  const avg=(games,team,against=false)=>games.reduce((s,r)=>s+Number(r[(r[1]===team)!==against?3:4]),0)/games.length;
  const shrink=(v,n)=>(v*n+1.3*6)/(n+6);
  const lh=Math.sqrt(shrink(avg(h,home),h.length)*shrink(avg(a,away,true),a.length));
  const la=Math.sqrt(shrink(avg(a,away),a.length)*shrink(avg(h,home,true),h.length));
  const sum=lh+la;
  return {over25:1-Math.exp(-sum)*(1+sum+sum*sum/2),btts:(1-Math.exp(-lh))*(1-Math.exp(-la))};
}
export function evaluate(rows, asOf=Date.now()) {
  const games=cleanRows(rows,asOf), evaluated=[];
  for(let i=0;i<games.length;i++) {
    const r=games[i], prior=games.slice(0,i).filter(x=>x[0]<r[0]);
    const prediction=forecast(prior,r[1],r[2]);
    if(!prediction)continue;
    const baseline=Object.fromEntries(MARKETS.map(k=>[k,prior.reduce((s,x)=>s+truth(x)[k],0)/prior.length]));
    evaluated.push({date:r[0],prediction,baseline,truth:truth(r)});
  }
  const markets={};
  for(const key of MARKETS) {
    const n=evaluated.length;
    const mean=fn=>n?evaluated.reduce((s,r)=>s+fn(r),0)/n:null;
    const brier=mean(r=>(r.prediction[key]-r.truth[key])**2);
    const baselineBrier=mean(r=>(r.baseline[key]-r.truth[key])**2);
    const selected=evaluated.filter(r=>r.prediction[key]>=0.7);
    const bins=Array.from({length:5},(_,i)=>{
      const items=evaluated.filter(r=>Math.min(4,Math.floor(r.prediction[key]*5))===i);
      return {from:i/5,to:(i+1)/5,count:items.length,predicted:items.length?items.reduce((s,r)=>s+r.prediction[key],0)/items.length:null,observed:items.length?items.reduce((s,r)=>s+r.truth[key],0)/items.length:null};
    });
    markets[key]={count:n,brier,baselineBrier,betterThanBaseline:n?brier<baselineBrier:null,selected70:{count:selected.length,hits:selected.reduce((s,r)=>s+r.truth[key],0),hitRate:selected.length?selected.reduce((s,r)=>s+r.truth[key],0)/selected.length:null},calibration:bins};
  }
  return {historicalFixtures:games.length,backtestedFixtures:evaluated.length,markets};
}
export function report(leagues,asOf=Date.now()) {
  return {status:'experimental',validated:false,asOf:new Date(asOf).toISOString(),method:'Walk-forward per data: ultime 10 gare, minimo 6 per squadra. Baseline progressiva calcolata solo sulle date precedenti. Nessun risultato della data valutata entra nelle stime.',limitations:'Dati locali non verificati in tempo reale; campione limitato. Brier e calibrazione descrivono questo test, non garantiscono prestazioni future. Corner: frequenze storiche, modello non validato.',leagues:Object.fromEntries(Object.entries(leagues).map(([k,v])=>[k,evaluate(v,asOf)]))};
}
