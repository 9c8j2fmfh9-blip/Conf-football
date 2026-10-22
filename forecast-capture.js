// Immutable prospective evidence. Never reconstruct an observation after kickoff.
export function prepareCapture(data,quotes,{capturedAt,modelRevision=null,runId=null}={}){
 const now=Date.parse(capturedAt);if(!Number.isFinite(now))throw Error('Invalid capture timestamp');
 const byId=new Map((quotes?.fixtures||[]).map(f=>[String(f.fixtureId),f]));
 const seen=new Set();
 const fixtures=(data.fixtures||[]).filter(f=>{
  const id=String(f.fixtureId||'');
  if(!id||seen.has(id)||Date.parse(f.date)<=now+5*60000||!Number.isFinite(Date.parse(f.date)))return false;
  seen.add(id);return true;
 }).map(f=>({fixtureId:f.fixtureId,kickoffAt:f.date,home:f.home,away:f.away,league:f.league,country:f.country,
  source:f.source||data.provider,dataUpdatedAt:f.dataUpdatedAt||null,dataStale:!!f.dataStale,
  experimentalEstimate:f.experimentalEstimate||null,markets:f.markets||{},selection:f.selection||null,
  prices:byId.get(String(f.fixtureId))||null}));
 return {schemaVersion:1,capturedAt,modelRevision,runId,
  sourceStatus:{provider:data.provider||null,coverage:data.calendarCoverage||null,providerIssue:data.providerIssue||null,analyzedCount:data.analyzedCount??null,returned:fixtures.length},
  oddsStatus:quotes?{available:true,source:quotes.source||null,sourceUpdatedAt:quotes.sourceUpdatedAt||null,status:quotes.oddsStatus||null}:{available:false,reason:'Quote non recuperate: nessuna valutazione economica possibile.'},
  fixtures,note:'Previsioni registrate prima del calcio d’inizio. Non sono puntate né risultati ricostruiti.'};
}
