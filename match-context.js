// Context describes observable results and table position; it does not assign motivation points.
export function formSummary(games,teamId,venue=null){
 const eligible=games.filter(g=>g.status==='FT'&&(g.homeId===teamId||g.awayId===teamId)&&(!venue||(venue==='home'?g.homeId===teamId:g.awayId===teamId)))
  .sort((a,b)=>b.stamp-a.stamp).slice(0,venue?6:5);
 const results=eligible.map(g=>{const own=g.homeId===teamId?g.homeGoals:g.awayGoals,against=g.homeId===teamId?g.awayGoals:g.homeGoals;return {own,against,result:own>against?'V':own===against?'N':'P'};});
 return {sample:results.length,results:results.map(r=>r.result),points:results.reduce((s,r)=>s+(r.result==='V'?3:r.result==='N'?1:0),0),goalsFor:results.reduce((s,r)=>s+r.own,0),goalsAgainst:results.reduce((s,r)=>s+r.against,0)};
}
export function parseStandings(body,expectedSeason=null){
 const groups=[];
 function walk(node){
  if(node?.standings?.entries?.length&&(!expectedSeason||Number(node.standings.season)===expectedSeason)){
   const rows=node.standings.entries.map(e=>{
    const stat=name=>{const x=e.stats?.find(s=>s.name===name);const v=x?.value??x?.displayValue;return v!==undefined&&v!==null&&Number.isFinite(Number(v))?Number(v):null;};
    return {id:String(e.team?.id||''),name:e.team?.displayName,rank:stat('rank'),points:stat('points'),played:stat('gamesPlayed'),zone:e.note?.description||e.note?.text||'',deductions:stat('deductions')};
   }).filter(r=>r.id&&r.rank!==null&&r.points!==null).sort((a,b)=>a.rank-b.rank);
   groups.push({name:node.name||node.standings.name||'',rows});
  }
  for(const child of node?.children||[])walk(child);
 }
 walk(body);return groups;
}
export function tableContext(groups,teamId){
 const group=groups.find(g=>g.rows.some(r=>r.id===teamId));if(!group)return {available:false,reason:'Classifica non disponibile per questa squadra.'};
 const row=group.rows.find(r=>r.id===teamId),rows=group.rows;
 const zoneType=s=>/relegat|retrocess/i.test(s)?'salvezza':/champions|promotion|promoz|play.?off|qualif|europa|conference/i.test(s)?'qualificazione':null;
 const boundaries=[];
 for(let i=1;i<rows.length;i++){
  if(rows[i].zone===rows[i-1].zone)continue;
  const type=zoneType(rows[i].zone)||zoneType(rows[i-1].zone);if(!type)continue;
  const target=row.rank<=rows[i-1].rank?rows[i].points:rows[i-1].points;
  boundaries.push({type,label:rows[i].zone||rows[i-1].zone,position:rows[i].rank,target:row.rank<=rows[i-1].rank?rows[i].name:rows[i-1].name,gap:row.points-target});
 }
 const nearest=boundaries.sort((a,b)=>Math.abs(a.gap)-Math.abs(b.gap))[0]||null;
 return {available:true,...row,totalTeams:rows.length,group:group.name,boundary:nearest,
  note:'Distanza in punti dalla squadra sul confine di zona indicato dalla fonte. Non equivale alla salvezza/qualificazione matematica; spareggi e recuperi non sono risolti.'};
}
export function buildContext(f,homeGames,awayGames,groups=[]){
 const team=(id,games,venue)=>({recent:formSummary(games,id),venue:formSummary(games,id,venue),venueLabel:venue==='home'?'in casa':'in trasferta',
  daysSinceLast:games.length?Number(((f.stamp-Math.max(...games.map(g=>g.stamp)))/86400000).toFixed(1)):null,table:tableContext(groups,id)});
 return {home:team(f.homeId,homeGames,'home'),away:team(f.awayId,awayGames,'away'),source:'ESPN · risultati e classifica al momento della consultazione',
  warning:'Contesto descrittivo: nessun aumento automatico della percentuale per presunta motivazione. Assenze e turnover non valutati senza informazioni confermate.'};
}
