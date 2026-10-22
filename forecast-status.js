const source='https://raw.githubusercontent.com/9c8j2fmfh9-blip/Conf-football/conf-forecast-archive/forecast-evaluation/latest.json';
export function summarizeForecastReport(report,{now=Date.now()}={}){
 const at=Date.parse(report?.evaluatedAt);
 if(report?.schemaVersion!==1||!Number.isFinite(at)||at>now+300000||!Number.isInteger(report.recorded)||report.recorded<0||!Number.isInteger(report.settled)||report.settled<0||report.settled>report.recorded||!Array.isArray(report.pending)||report.pending.length!==report.recorded-report.settled)throw Error('Archivio di verifica non valido');
 return {available:true,validated:false,productionBettingApproved:false,evaluatedAt:report.evaluatedAt,lastCapturedAt:report.lastCapturedAt||null,
  stale:now-at>2*3600000,captureStale:report.lastCapturedAt?now-Date.parse(report.lastCapturedAt)>2*3600000:null,recorded:report.recorded,settled:report.settled,pending:report.pending.length,
  estimated:report.estimated??null,evaluatedForecasts:report.evaluatedForecasts??null,
  pendingReasons:report.pending.reduce((counts,r)=>(counts[r.reason]=(counts[r.reason]||0)+1,counts),{}),
  byRevision:report.byRevision||[],sourceIssues:report.sourceIssues||[],
  method:'Confronto delle prime stime registrate prima del calcio d’inizio con risultati finali confermati. Una partita per versione del modello. Il confronto non certifica il rendimento delle multiple.'};
}
export function createForecastStatusStore({fetcher=fetch,clock=Date.now}={}){
 let cached=null,readAt=0,inflight=null;
 return {async get(){
  const now=clock();
  if(cached&&now-readAt<60000)return summarizeForecastReport(cached,{now});
  if(inflight)return inflight;
  inflight=(async()=>{
   try{
    const response=await fetcher(source,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
    if(!response.ok)throw Error('Archivio HTTP '+response.status);
    const report=await response.json();const summary=summarizeForecastReport(report,{now:clock()});
    cached=report;readAt=clock();return summary;
   }catch(error){
    if(cached)return {...summarizeForecastReport(cached,{now:clock()}),stale:true,warning:'Aggiornamento della verifica non riuscito: '+error.message};
    return {available:false,validated:false,productionBettingApproved:false,warning:'Verifica automatica momentaneamente non raggiungibile: '+error.message};
   }finally{inflight=null;}
  })();
  return inflight;
 }};
}
