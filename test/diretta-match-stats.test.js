import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDirettaMatchStats,parseDirettaMatchEvents,createDirettaStatsStore,buildDirettaStatMarkets} from '../diretta-match-stats.js';

const feed='SE÷Partita¬~SF÷Statistiche Top¬~SD÷34¬SG÷Tiri totali¬SH÷19¬SI÷9¬~SD÷13¬SG÷Tiri in porta¬SH÷6¬SI÷2¬~SD÷16¬SG÷Calci d\'angolo¬SH÷3¬SI÷1¬~SD÷21¬SG÷Falli¬SH÷13¬SI÷9¬~SE÷1 Tempo¬~SF÷Statistiche Top¬~SD÷34¬SG÷Tiri totali¬SH÷8¬SI÷4¬~SD÷13¬SG÷Tiri in porta¬SH÷5¬SI÷1¬~SD÷16¬SG÷Calci d\'angolo¬SH÷1¬SI÷1¬';

test('parses only full-time team statistics and excludes period-specific rows',()=>{
 const result=parseDirettaMatchStats(feed);
 assert.deepEqual(result.home,{shots:19,shotsOnTarget:6,corners:3,fouls:13});
 assert.deepEqual(result.away,{shots:9,shotsOnTarget:2,corners:1,fouls:9});
 assert.equal(result.complete,true);
 assert.throws(()=>parseDirettaMatchStats('SA÷1¬~empty'),/non riconosciute/);
 assert.throws(()=>parseDirettaMatchStats('SE÷Partita¬~SF÷Statistiche Top¬~SD÷34¬SG÷Tiri totali¬SH÷19¬SI÷9¬'),/complete/);
});

test('counts team yellow cards in regulation and ignores extra-time cards',()=>{
 const result=parseDirettaMatchEvents('AC÷1 Tempo¬~IA÷1¬IK÷Cartellino Giallo¬~IA÷2¬IK÷Cartellino Giallo¬~AC÷2 Tempo¬~IA÷2¬IK÷Cartellino Giallo¬IK÷Cartellino Rosso¬~AC÷Tempi Supplementari¬~IA÷1¬IK÷Cartellino Giallo¬');
 assert.deepEqual(result.cards,{home:{yellow:1,red:0},away:{yellow:2,red:1}});assert.equal(result.cardsAvailable,true);
 assert.equal(parseDirettaMatchEvents('AC÷1 Tempo¬~IA÷1¬IK÷Gol¬~AC÷2 Tempo¬').cardsAvailable,false);
 assert.throws(()=>parseDirettaMatchEvents('blocked'),/non riconosciuti/);
});

test('deduplicates queued match requests and fails closed for unavailable statistics',async()=>{
 let calls=0;const store=createDirettaStatsStore({fetcher:async url=>{calls++;return{ok:true,text:async()=>String(url).includes('df_st_1')?feed:'AC÷1 Tempo¬~AC÷2 Tempo¬'};},persist:()=>{}});
 const [a,b]=await Promise.all([store.get('abcdefgh'),store.get('abcdefgh')]);
 assert.deepEqual(a.home,{shots:19,shotsOnTarget:6,corners:3,fouls:13});assert.equal(b.matchId,'abcdefgh');assert.equal(calls,2);assert.equal(a.cardsAvailable,false);assert.equal(a.cardParserVersion,3);
 const missing=createDirettaStatsStore({fetcher:async()=>({ok:true,text:async()=>'not stats'}),persist:()=>{}});
 assert.equal(await missing.get('ijklmnop'),null);
});

test('refreshes pre-fix cached matches so stale zero-card counts are never reused',async()=>{
 let calls=0;const stale={complete:true,cardsAvailable:true,home:{shots:19,shotsOnTarget:6,corners:3,yellowCards:0},away:{shots:9,shotsOnTarget:2,corners:1,yellowCards:0}};
 const store=createDirettaStatsStore({initial:{abcdefgh:stale},fetcher:async url=>{calls++;return{ok:true,text:async()=>String(url).includes('df_st_1')?feed:'AC÷1 Tempo¬~IA÷1¬IK÷Cartellino Giallo¬IK÷Cartellino Rosso¬AC÷2 Tempo¬'};},persist:()=>{}});
 const value=await store.get('abcdefgh');
 assert.equal(calls,2);assert.equal(value.cardParserVersion,3);assert.equal(value.home.yellowCards,1);assert.equal(value.home.redCards,1);
});

test('creates descriptive shot and corner markets only with two team samples',()=>{
 const initial={},homeGames=[],awayGames=[];const now=Date.parse('2026-10-22T10:00:00Z');
 for(let i=0;i<6;i++){
  const id1='h'+String(i).padStart(7,'0'),id2='a'+String(i).padStart(7,'0');
  initial[id1]={complete:true,home:{shots:15,shotsOnTarget:5,corners:6,fouls:10},away:{shots:8,shotsOnTarget:2,corners:3,fouls:11}};
  initial[id2]={complete:true,home:{shots:12,shotsOnTarget:4,corners:5,fouls:13},away:{shots:10,shotsOnTarget:3,corners:4,fouls:12}};
  homeGames.push({id:id1,date:new Date(now-(i+1)*86400000).toISOString(),home:'Home',away:'Rival '+i,hg:1,ag:0});
  awayGames.push({id:id2,date:new Date(now-(i+1)*86400000).toISOString(),home:'Rival '+i,away:'Away',hg:0,ag:1});
 }
 const store=createDirettaStatsStore({initial});
 const report=buildDirettaStatMarkets('Home','Away',homeGames,awayGames,store,{now,schedule:false});
 const total=report.markets.find(x=>x.key==='diretta_total_shots_19');
 assert.equal(total.sample,12);assert.equal(total.score,100);assert.equal(total.venueSamples.home,6);assert.equal(total.venueSamples.away,6);assert.equal(total.sampleSufficient,true);assert.equal(total.qualified,true);
 const home=report.markets.find(x=>x.key==='diretta_home_sot_2');
 assert.equal(home.score,100);assert.equal(home.hits,12);
 const low=report.markets.find(x=>x.key==='diretta_total_corners_10');assert.equal(low.sampleSufficient,true);assert.equal(low.qualified,false);
 const empty=buildDirettaStatMarkets('Home','Away',homeGames,awayGames,createDirettaStatsStore(),{now,schedule:false});
 assert.equal(empty.markets.find(x=>x.key==='diretta_total_shots_19').score,null);
});
