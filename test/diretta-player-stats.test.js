import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDirettaPlayerStats,createDirettaPlayerStatsStore,buildDirettaPlayerReport} from '../diretta-player-stats.js';

const payload={data:{event:{match_id:'abcdefgh',teams:[
 {id:'homeid01',name:'Home',side:'home'},{id:'awayid01',name:'Away',side:'away'}
],groups:[{key:'shots',label:'Tiri',stats:['shots_total','shots_on_target']}],
stat_types:[
 {key:'shots_total',label:'Tiri totali',format:'count',groups:['shots']},
 {key:'shots_on_target',label:'Tiri in porta',format:'count',groups:['shots']},
 {key:'fouls_committed',label:'Falli commessi',format:'count',groups:['defense']}
],players:[
 {id:'player001',name:'Player One',team_id:'homeid01',position:'Attaccante',starter:true,rating:8.1,stats:{
  shots_total:{value:'3',raw:3,rank:1},shots_on_target:{value:'2',raw:2,rank:1},fouls_committed:{value:'1',raw:1,rank:8}
 }},
 {id:'player002',name:'Player Two',team_id:'awayid01',position:'Difensore',stats:{fouls_committed:{value:'2',raw:2,rank:2}}}
]}}};

test('parses all player rows, groups and statistics without filling missing values',()=>{
 const result=parseDirettaPlayerStats(JSON.stringify(payload));
 assert.equal(result.players.length,2);
 assert.equal(result.players[0].side,'home');
 assert.equal(result.players[0].stats.shots_total.raw,3);
 assert.equal(result.players[1].side,'away');
 assert.equal(result.players[1].stats.shots_total,undefined);
 assert.equal(result.groups[0].key,'shots');
 assert.equal(result.statTypes.find(x=>x.key==='fouls_committed').label,'Falli commessi');
 assert.throws(()=>parseDirettaPlayerStats('not json'),/JSON valido/);
 assert.throws(()=>parseDirettaPlayerStats({data:{event:{players:[]}}}),/assenti/);
});

test('fetches and caches an individual-stat match payload',async()=>{
 let calls=0;
 const store=createDirettaPlayerStatsStore({fetcher:async url=>{
  calls++;assert.match(String(url),/eventId=abcdefgh/);
  return{ok:true,text:async()=>JSON.stringify(payload)};
 },persist:()=>{}});
 const [a,b]=await Promise.all([store.get('abcdefgh'),store.get('abcdefgh')]);
 assert.equal(calls,1);assert.equal(a.matchId,'abcdefgh');assert.equal(b.players.length,2);
});

test('builds player averages grouped by team while leaving unavailable measures absent',()=>{
 const game=(id,home,away)=>({id,date:'2026-10-01T12:00:00Z',home,away});
 const matches={};
 for(const id of ['match001','match002']){
  const parsed=parseDirettaPlayerStats(payload,{matchId:id});
  parsed.players[0].stats.shots_total.raw=id==='match001'?2:4;
  matches[id]=parsed;
 }
 const store=createDirettaPlayerStatsStore({initial:matches});
 const report=buildDirettaPlayerReport('Home','Away',
  [game('match001','Home','Other'),game('match002','Home','Other')],
  [game('match001','Other','Away'),game('match002','Other','Away')],store,
  {now:Date.parse('2026-10-22T00:00:00Z'),schedule:false});
 const player=report.players.home.find(x=>x.id==='player001');
 assert.equal(player.appearances,2);
 assert.equal(player.stats.shots.shots_total.average,3);
 assert.equal(player.stats.shots.shots_total.total,6);
 assert.equal(player.stats.defense.fouls_committed.average,1);
 assert.equal(report.players.home.some(x=>x.id==='player002'),false);
 const awayPlayer=report.players.away.find(x=>x.id==='player002');
 assert.equal(awayPlayer.appearances,2);
 assert.equal(awayPlayer.stats.defense.fouls_committed.average,2);
 assert.equal(report.coverage.home,2);
});
