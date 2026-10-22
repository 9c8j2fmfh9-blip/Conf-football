// Score the first recorded forecast per fixture and model revision, once only.
// Results must carry an exact calendar identifier and a regulation-time score.
export function evaluateCaptures(captures, results, {evaluatedAt=new Date().toISOString()}={}) {
 const hasEstimate=f=>f.experimentalEstimate?.available&&!f.dataStale;
 const hasStatMarkets=f=>(f.direttaStatMarkets||[]).some(m=>m.score!==null&&m.sample>=12);
const GOAL_MARKETS=['one','draw','two','doubleChance1X','doubleChanceX2','doubleChance12','over15','under15','over25','under25','btts','noBtts','over35','under35','homeScore','homeNoScore','awayScore','awayNoScore','homeOver15','awayOver15','bttsOver25'];
 const now=Date.parse(evaluatedAt);
 if(!Number.isFinite(now))throw Error('Invalid evaluation timestamp');
 const earliest=new Map(), resultMap=new Map();
 for(const result of results){
  if(!resultMap.has(result.id))resultMap.set(result.id,result);
  else if(JSON.stringify(resultMap.get(result.id))!==JSON.stringify(result)){
   const old=resultMap.get(result.id);
   resultMap.set(result.id,old&&old.score?.home===result.score?.home&&old.score?.away===result.score?.away?{...old,...result,statistics:result.statistics||old.statistics}:null);
  }
 }
 for(const capture of captures.slice().sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt))){
  const at=Date.parse(capture.capturedAt);
  if(!Number.isFinite(at)||at>now)continue;
  for(const f of capture.fixtures||[]){
   if(!f.fixtureId||!Number.isFinite(Date.parse(f.kickoffAt))||Date.parse(f.kickoffAt)<=at+300000)continue;
   const key=JSON.stringify([f.fixtureId,capture.modelRevision]);
   if(!earliest.has(key)||(!hasEstimate(earliest.get(key))&&hasEstimate(f)))earliest.set(key,{...f,capturedAt:capture.capturedAt,modelRevision:capture.modelRevision});
   else if(hasStatMarkets(f)&&!hasStatMarkets(earliest.get(key)))earliest.set(key,{...earliest.get(key),direttaStatMarkets:f.direttaStatMarkets});
  }
 }
 const rows=[],pending=[];
 for(const [key,f] of earliest){
  const id=f.direttaId||(String(f.fixtureId).startsWith('diretta_')?String(f.fixtureId).slice(8):null);
  const r=resultMap.get(id),score=r?.score;
  const valid=r?.status==='FT'&&Number.isInteger(score?.home)&&Number.isInteger(score?.away)&&score.home>=0&&score.away>=0&&
   r.home===(f.calendarHome||f.home)&&r.away===(f.calendarAway||f.away)&&Date.parse(r.date)===Date.parse(f.kickoffAt)&&Date.parse(r.date)<now;
  if(!valid){pending.push({key,fixtureId:f.fixtureId,reason:id?'Risultato finale non confermato':'Identificativo calendario assente'});continue;}
  const h=score.home,a=score.away;
  const truth={one:+(h>a),draw:+(h===a),two:+(h<a),doubleChance1X:+(h>=a),doubleChanceX2:+(h<=a),doubleChance12:+(h!==a),
   over15:+(h+a>=2),under15:+(h+a<2),over25:+(h+a>=3),under25:+(h+a<3),btts:+(h>0&&a>0),noBtts:+(h===0||a===0),
   over35:+(h+a>=4),under35:+(h+a<4),homeScore:+(h>0),homeNoScore:+(h===0),awayScore:+(a>0),awayNoScore:+(a===0),
   homeOver15:+(h>=2),awayOver15:+(a>=2),bttsOver25:+(h>0&&a>0&&h+a>=3)};
  const probabilities=hasEstimate(f)?f.experimentalEstimate.estimates:{};
  const markets=Object.fromEntries(Object.entries(truth).filter(([k])=>typeof probabilities?.[k]==='number'&&Number.isFinite(probabilities[k])&&probabilities[k]>=0&&probabilities[k]<=100).map(([k,y])=>{
   const historical=f.markets?.[k],value=historical?.score;
   const baseline=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100&&!historical.partial&&historical.venueSamples?.home>=6&&historical.venueSamples?.away>=6?value/100:null;
   return[k,{p:probabilities[k]/100,y,brier:(probabilities[k]/100-y)**2,baselineP:baseline,baselineBrier:baseline===null?null:(baseline-y)**2}];
  }));
  const statMetrics={};
  if(r.statistics?.complete)for(const m of f.direttaStatMarkets||[]){
   const homeStat=r.statistics.home?.[m.metric],awayStat=r.statistics.away?.[m.metric];
   const value=m.side==='home'?homeStat:m.side==='away'?awayStat:Number.isFinite(homeStat)&&Number.isFinite(awayStat)?homeStat+awayStat:null;
   if(Number.isFinite(value)&&Number.isFinite(m.line)&&Number.isFinite(m.score)&&m.score>=0&&m.score<=100){
    const p=m.score/100,y=+(value>=m.line);statMetrics[m.key]={p,y,brier:(p-y)**2,baselineP:null,baselineBrier:null,sample:m.sample,observed:value};
   }
  }
  Object.assign(markets,statMetrics);
  if(hasStatMarkets(f)&&!r.statistics?.complete)pending.push({key,fixtureId:f.fixtureId,reason:'Risultato confermato; statistiche Diretta finali in attesa'});
  rows.push({key,fixtureId:f.fixtureId,modelRevision:f.modelRevision,capturedAt:f.capturedAt,kickoffAt:f.kickoffAt,score,markets});
 }
 const revisions=[...new Set(rows.map(r=>r.modelRevision))];
 const byRevision=revisions.map(modelRevision=>({modelRevision,markets:Object.fromEntries([...GOAL_MARKETS,...new Set(rows.flatMap(r=>Object.keys(r.markets).filter(k=>k.startsWith('diretta_'))))].map(k=>{
  const values=rows.filter(r=>r.modelRevision===modelRevision&&r.markets[k]).map(r=>r.markets[k]);
  const mean=fn=>values.length?values.reduce((s,r)=>s+fn(r),0)/values.length:null;
  const paired=values.filter(v=>v.baselineP!==null&&Number.isFinite(v.baselineP));
  const pairedMean=fn=>paired.length?paired.reduce((s,r)=>s+fn(r),0)/paired.length:null;
  return[k,{n:values.length,brier:mean(r=>r.brier),meanForecast:mean(r=>r.p),observedRate:mean(r=>r.y),baselineN:paired.length,pairedModelBrier:pairedMean(r=>r.brier),baselineBrier:pairedMean(r=>r.baselineBrier),brierImprovement:pairedMean(r=>r.baselineBrier-r.brier)}];
 }))}));
 return {schemaVersion:1,evaluatedAt,lastCapturedAt:captures.map(c=>c.capturedAt).filter(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)<=now).sort().at(-1)||null,validated:false,productionBettingApproved:false,recorded:earliest.size,estimated:[...earliest.values()].filter(hasEstimate).length,evaluatedForecasts:rows.filter(r=>Object.keys(r.markets).length).length,settled:rows.length,pending,byRevision,rows,
  note:'Prima stima disponibile per partita e revisione; esiti nei tempi regolamentari. Nessuna stima di rendimento senza quote verificate.'};
}
