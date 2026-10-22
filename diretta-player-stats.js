import {readFileSync,writeFileSync,renameSync} from 'node:fs';

const cleanName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const numeric=value=>{
 if(typeof value==='number'&&Number.isFinite(value))return value;
 const text=String(value??'').trim();
 if(!text||!/-?\d/.test(text))return null;
 const n=Number(text.replace('%','').replace(',','.').match(/^-?\d+(?:\.\d+)?/)?.[0]);
 return Number.isFinite(n)?n:null;
};
const get=(object,...keys)=>{for(const key of keys)if(object?.[key]!==undefined&&object[key]!==null)return object[key];return undefined};
const asArray=value=>Array.isArray(value)?value:[];

function walk(value,visit,seen=new Set()){
 if(!value||typeof value!=='object'||seen.has(value))return;
 seen.add(value);visit(value);
 if(Array.isArray(value))for(const child of value)walk(child,visit,seen);
 else for(const child of Object.values(value))walk(child,visit,seen);
}
function collectDefinitions(root,field,labelField){
 const values=new Map();
 walk(root,node=>{
  for(const item of asArray(node[field])){
   if(!item||typeof item!=='object')continue;
   const key=String(get(item,'key','code','id','statId')??'');
   const label=String(get(item,'label','name','title',labelField)||key);
   if(key)values.set(key,{key,label,format:String(item.format||''),groups:asArray(item.groups).map(String),sentiment:item.sentiment||null});
  }
 });
 return [...values.values()];
}
function playerStatEntries(value){
 if(Array.isArray(value))return value.map((item,index)=>{
  if(item&&typeof item==='object')return [String(get(item,'key','code','id','statId','name')??index),item];
  return [String(index),{value:item}];
 });
 if(value&&typeof value==='object')return Object.entries(value);
 return [];
}
function statValue(value){
 if(value&&typeof value==='object'){
  const raw=get(value,'raw','value','total','displayValue');
  const numericRaw=numeric(raw);
  return {value:String(get(value,'value','displayValue','formatted')??raw??''),raw:numericRaw,rank:numeric(get(value,'rank','position'))};
 }
 const n=numeric(value);return {value:String(value??''),raw:n,rank:null};
}
function candidatePlayer(node){
 const id=String(get(node,'id','playerId','participantId','competitorId')??'');
 const name=String(get(node,'name','fullName','playerName','participantName')??'');
 const stats=get(node,'stats','statistics','playerStats','values');
 return id&&name&&stats&&typeof stats==='object'?{id,name,stats,node}:null;
}
function normalizePlayer(candidate,teamNames){
 const node=candidate.node;
 const team=get(node,'team','teamName','participant','teamData')||{};
 const sideRaw=String(get(node,'side','homeAway','teamSide')??'').toLowerCase();
 const teamId=String(get(node,'team_id','teamId')??get(team,'id','teamId')??'');
 let side=['home','1','home_team'].includes(sideRaw)?'home':['away','2','away_team'].includes(sideRaw)?'away':null;
 const teamName=String(get(node,'team_name','teamName')??get(team,'name','teamName')??'');
 if(!side&&teamNames){
  const byId=teamNames.ids?.get(teamId);if(byId)side=byId;
  if(!side&&teamName)side=teamNames.names?.get(cleanName(teamName))||null;
 }
 const stats=Object.fromEntries(playerStatEntries(candidate.stats).map(([key,value])=>[key,statValue(value)]));
 return {id:candidate.id,name:candidate.name,shortName:String(get(node,'short_name','shortName','displayName')??candidate.name),
  teamId,teamName,side,position:String(get(node,'position','role','line')??''),starter:Boolean(get(node,'starter','isStarter','starting')),
  rating:numeric(get(node,'rating','fs_rating','playerRating')),highlights:asArray(get(node,'highlights','badges')).map(String),topRated:Boolean(get(node,'top_rated','topRated')),stats};
}

/**
 * Parses the match-player statistics payload while retaining every statistic
 * key and group that the provider returns. Missing fields remain missing.
 */
export function parseDirettaPlayerStats(input,{matchId=null}={}){
 let root=input;
 if(typeof input==='string'){
  try{root=JSON.parse(input);}catch{throw Error('Statistiche giocatori Diretta non sono JSON valido');}
 }
 if(!root||typeof root!=='object')throw Error('Statistiche giocatori Diretta non riconosciute');
 const teams=[],teamNames={ids:new Map(),names:new Map()};
 walk(root,node=>{
  if(Array.isArray(node.teams))for(const team of node.teams){
   if(!team||typeof team!=='object')continue;
   const id=String(get(team,'id','teamId')??''),name=String(get(team,'name','teamName')??''),side=String(get(team,'side')??'').toLowerCase();
   if(id&&name&&['home','away'].includes(side)){teamNames.ids.set(id,side);teamNames.names.set(cleanName(name),side);teams.push({id,name,side});}
  }
 });
 const candidates=new Map();
 walk(root,node=>{
  const candidate=candidatePlayer(node);if(candidate)candidates.set(candidate.id,candidate);
 });
 const players=[...candidates.values()].map(x=>normalizePlayer(x,teamNames)).filter(x=>Object.keys(x.stats).length>0);
 if(!players.length)throw Error('Statistiche giocatori assenti o non coperte per questa partita');
 const groups=collectDefinitions(root,'groups','label');
 const statTypes=collectDefinitions(root,'stat_types','label');
 const match=String(matchId||get(root,'match_id','eventId','id')||'');
 return {matchId:match,teams:[...new Map(teams.map(x=>[x.side,x])).values()],groups,statTypes,players,
  fetchedAt:new Date().toISOString(),complete:true,source:'Diretta'};
}

export function createDirettaPlayerStatsStore({initial={},fetcher=fetch,persist=()=>{},concurrency=2,maxQueue=160}={}){
 const cache=new Map(Object.entries(initial)),pending=new Map(),retry=new Map(),queue=[];let active=0;
 const run=()=>{while(active<concurrency&&queue.length){const job=queue.shift();active++;
  (async()=>{try{
   const headers={'x-fsign':'SW9D1eZo','Referer':'https://www.diretta.it/'};
   const response=await fetcher('https://2.ds.lsapp.eu/pq_graphql?_hash=epmsd&eventId='+encodeURIComponent(job.id)+'&providerId=7',{headers,signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Statistiche giocatori HTTP '+response.status);
   const text=await response.text();if(text.length>1000000)throw Error('Statistiche giocatori oltre il limite');
   const value=parseDirettaPlayerStats(text,{matchId:job.id});
   value.fetchedAt=new Date(job.now).toISOString();cache.set(job.id,value);persist(Object.fromEntries(cache));return value;
  }catch{retry.set(job.id,job.now+10*60000);return null;}
  })().then(job.resolve).finally(()=>{active--;pending.delete(job.id);run();});
 }};
 return {peek:id=>cache.get(String(id))||null,get(id,{now=Date.now()}={}){
  const key=String(id||'');if(!/^\w{8}$/.test(key))return Promise.resolve(null);
  const value=cache.get(key);if(value?.complete&&Array.isArray(value.players))return Promise.resolve(value);
  if(now<(retry.get(key)||0)||queue.length>=maxQueue&&!pending.has(key))return Promise.resolve(null);
  if(!pending.has(key))pending.set(key,new Promise(resolve=>{queue.push({id:key,now,resolve});run();}));
  return pending.get(key);
 },stats:()=>({cached:cache.size,queued:queue.length,active,pending:pending.size})};
}

const runtime=new URL('./diretta-player-statistics-cache.json',import.meta.url);
let initial={};if(process.env.NODE_ENV!=='test')try{initial=JSON.parse(readFileSync(runtime,'utf8'));}catch{}
export const direttaPlayerStatsStore=createDirettaPlayerStatsStore({initial,persist:value=>{
 if(process.env.NODE_ENV==='test')return;
 try{const temp=new URL('./diretta-player-statistics-cache.tmp',import.meta.url);writeFileSync(temp,JSON.stringify(value));renameSync(temp,runtime);}catch{}
}});

const groupDefaults=[['top_stats','Statistiche top'],['shots','Tiri'],['attack','Attacco'],['passes','Passaggi'],['defense','Difesa'],['goalkeeping','Portiere'],['general','Generali']];
export function buildDirettaPlayerReport(homeTeam,awayTeam,homeGames,awayGames,statsStore,{now=Date.now(),schedule=true,maxMatches=10}={}){
 const definitions=new Map(),bySide={home:new Map(),away:new Map()},coverage={home:0,away:0},requested={home:0,away:0};
 const process=(games,side,teamName)=>{
  const selected=games.filter(g=>g?.id&&Date.parse(g.date)<now).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,maxMatches);
  requested[side]=selected.length;
  for(const game of selected){
   let match=statsStore.peek(game.id);if(schedule&&!match)void statsStore.get(game.id,{now});
   if(!match?.complete)continue;coverage[side]++;
   for(const definition of match.statTypes||[])definitions.set(definition.key,definition);
   const actualSide=cleanName(game.home)===cleanName(teamName)?'home':'away';
   for(const player of match.players||[]){
    if(player.side!==actualSide)continue;
    const key=String(player.id||cleanName(player.name));if(!key)continue;
    let row=bySide[side].get(key);
    if(!row){row={id:player.id,name:player.name,shortName:player.shortName,position:player.position,appearances:0,starts:0,ratingSum:0,ratingCount:0,topRatedCount:0,lastSeen:game.date,groups:{},observations:{},highlights:new Set()};bySide[side].set(key,row);}
    row.appearances++;if(player.starter)row.starts++;if(player.topRated)row.topRatedCount++;
    if(Number.isFinite(player.rating)){row.ratingSum+=player.rating;row.ratingCount++;}
    for(const highlight of player.highlights||[])row.highlights.add(highlight);
    for(const [statKey,value] of Object.entries(player.stats||{})){
     if(!Number.isFinite(value.raw))continue;
     const meta=definitions.get(statKey)||{key:statKey,label:statKey,format:'',groups:[]};
     row.observations[statKey]??=[];row.observations[statKey].push(value.raw);
     const groups=meta.groups?.length?meta.groups:['general'];
     for(const group of groups){
      row.groups[group]??={};
      const cell=row.groups[group][statKey]??={label:meta.label,total:0,count:0,format:meta.format||''};
      cell.total+=value.raw;cell.count++;
     }
    }
   }
  }
 };
 process(homeGames,'home',homeTeam);process(awayGames,'away',awayTeam);
 const groups=new Map(groupDefaults.map(([key,label])=>[key,{key,label}]));
 for(const [key,label] of [['top_stats','Statistiche top'],['shots','Tiri'],['attack','Attacco'],['passes','Passaggi'],['defense','Difesa'],['goalkeeping','Portiere'],['general','Generali']])groups.set(key,{key,label});
 for(const def of definitions.values())for(const group of def.groups||[])if(!groups.has(group))groups.set(group,{key:group,label:group});
 const teams={home:homeTeam,away:awayTeam},players={};
 for(const side of ['home','away'])players[side]=[...bySide[side].values()].map(player=>({
  id:player.id,name:player.name,shortName:player.shortName,position:player.position,appearances:player.appearances,starts:player.starts,
  averageRating:player.ratingCount?Number((player.ratingSum/player.ratingCount).toFixed(2)):null,topRatedCount:player.topRatedCount,lastSeen:player.lastSeen,
  highlights:[...player.highlights],stats:Object.fromEntries(Object.entries(player.groups).map(([group,values])=>[group,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{label:value.label,total:Number(value.total.toFixed(2)),average:Number((value.total/value.count).toFixed(2)),count:value.count,format:value.format}]))]))
 })).sort((a,b)=>b.appearances-a.appearances||String(a.name).localeCompare(String(b.name)));
 const shotDefinitions=[...definitions.values()].map(def=>{
  const identity=(String(def.key)+' '+String(def.label)).toLowerCase();
  if(/shots[_ ]?(on[_ ]?target|on[_ ]?goal)|shots[_ ]?target|tiri? in porta|tiri? nello specchio/.test(identity))return{key:def.key,label:'tiri in porta',statLabel:def.label};
  if(/shots[_ ]?total|total[_ ]?shots|tiri? totali/.test(identity))return{key:def.key,label:'tiri totali',statLabel:def.label};
  return null;
 }).filter(Boolean);
 const playerMarkets=[];
 for(const side of ['home','away'])for(const player of bySide[side].values())for(const metric of shotDefinitions){
  const values=player.observations[metric.key]||[];
  if(values.length<6)continue;
  const lines=metric.label==='tiri in porta'?[1,2]:[1,2,3];
  const options=lines.map(line=>{const hits=values.filter(value=>value>=line).length;return{line,hits,sample:values.length,score:Math.round(100*hits/values.length)};})
   .filter(m=>m.score>=60).sort((a,b)=>b.line-a.line);
  const selected=options[0];if(!selected)continue;
  playerMarkets.push({kind:'player_shot',key:'player_shots_'+side+'_'+player.id+'_'+metric.key+'_'+selected.line,
   playerId:player.id,player:player.name,position:player.position,side,metric:metric.label,statLabel:metric.statLabel,
   line:selected.line,selection:'Over '+(selected.line-.5).toFixed(1)+' '+metric.label, label:player.name+' · Over '+(selected.line-.5).toFixed(1)+' '+metric.label,
   hits:selected.hits,sample:selected.sample,score:selected.score,qualified:true,scoreKind:'historical',
   source:'Diretta · statistiche individuali archiviate'});
 }
 playerMarkets.sort((a,b)=>b.score-a.score||b.sample-a.sample||b.line-a.line||a.player.localeCompare(b.player));
 return {source:'Diretta · statistiche dei giocatori nelle ultime partite concluse',teams,players,groups:[...groups.values()],markets:playerMarkets.slice(0,20),
  coverage,pending:{home:Math.max(0,requested.home-coverage.home),away:Math.max(0,requested.away-coverage.away)},maxMatches,available:coverage.home>0||coverage.away>0,
  note:'Dati osservati nelle partite precedenti; la presenza nella prossima formazione non è confermata. Le statistiche mancanti non sono considerate zero.'};
}
