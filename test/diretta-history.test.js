import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseHistory,analyzeHistory,createHistoryStore,enrichHistory} from '../diretta-history.js';
const now=Date.parse('2026-10-21T07:00:00Z');
const fixture={fixtureId:'diretta_CCvjjDJs',direttaId:'CCvjjDJs',date:'2026-10-21T11:00:00Z',home:'Como U19',away:'Manchester Utd U19',markets:{},selection:{qualified:false}};
const raw=fs.readFileSync('test/fixtures/diretta-history-youth.txt','utf8');
const estimate=(h,a)=>({available:h.length>=6&&a.length>=6,samples:{home:h.length,away:a.length},estimates:{over25:80}});
test('actual youth feed stays below minimum, preserving team identity and excluding old seasons',()=>{
 const teams=parseHistory(raw);assert.equal(teams[0].name,'Como U19');assert.equal(teams[1].name,'Manchester Utd U19');
 const f=analyzeHistory(fixture,{fetchedAt:new Date(now).toISOString(),teams},estimate,{now});
 assert.equal(f.form.home.recentOverall.sample,2);assert.equal(f.form.away.recentOverall.sample,2);assert.equal(f.selection.qualified,false);
 assert.equal(analyzeHistory({...fixture,home:'Como'}, {fetchedAt:new Date(now).toISOString(),teams},estimate,{now}).source,undefined);
 assert.throws(()=>parseHistory('<html>blocked</html>'));
});
test('excludes same-day, future, duplicate, other-club and prior-period results and rejects stale history',()=>{
 const games=Array.from({length:6},(_,i)=>({id:'past'+i,date:`2026-10-${10+i}T10:00:00Z`,home:'Home',away:'Away',hg:2,ag:2}));
 const invalid=[{...games[0]}, {...games[0],id:'today',date:'2026-10-21T04:00:00Z'}, {...games[0],id:'future',date:'2026-10-22T04:00:00Z'}, {...games[0],id:'old',date:'2026-06-30T04:00:00Z'}, {...games[0],id:'wrong',home:'Other',away:'Another'}];
 const record={fetchedAt:new Date(now).toISOString(),teams:[{name:'Home',games:[...games,...invalid]},{name:'Away',games:[...games,...invalid]}]};
 const f={...fixture,home:'Home',away:'Away'};const result=analyzeHistory(f,record,estimate,{now});
 assert.equal(result.form.home.recentOverall.sample,6);assert.equal(result.form.away.recentOverall.sample,6);assert.equal(result.selection.primary.key,'over25');assert.equal(result.markets.over25.sample,12);
 assert.equal(analyzeHistory(f,{...record,fetchedAt:'2026-10-01T00:00:00Z'},estimate,{now}),f);
});
test('concurrent downloads share requests and a failure cannot erase a usable cache',async()=>{
 let requests=0;const old={fetchedAt:'2026-10-20T00:00:00Z',teams:parseHistory(raw)};
 const store=createHistoryStore({initial:{CCvjjDJs:old},fetcher:async()=>{requests++;return{ok:false,status:503}}});
 const result=await Promise.all([store.get('CCvjjDJs',{now}),store.get('CCvjjDJs',{now})]);assert.equal(requests,1);assert.equal(result[0],old);assert.equal(result[1],old);
 await store.get('CCvjjDJs',{now:now+1000});assert.equal(requests,1);
 const data=await enrichHistory({fixtures:[fixture],method:''},estimate,{now,historyStore:store});assert.equal(data.fixtures.length,1);assert.equal(data.analyzedCount,0);assert.equal(data.historyCoverage.checked,1);
});
test('alternate tabs, head-to-head and annotated scores cannot enlarge recent form',()=>{
 const original=parseHistory(raw);
 const withTabs=parseHistory(raw+'~KA÷Casa¬~KB÷Ultimi Incontri: Como U19¬~KC÷1791975600¬KP÷abcdefgh¬AC÷3¬FH÷Como U19¬FK÷Other U19¬KL÷9:9¬KU÷9¬KT÷9¬');
 assert.deepEqual(withTabs,original);
 const annotated=parseHistory(raw.replace('KL÷1:0¬','KL÷1:0 dts¬'));
 assert.equal(annotated[0].games.length,original[0].games.length-1);
});
test('deadline returns the calendar while the shared history queue continues',async()=>{
 let release;const store=createHistoryStore({fetcher:()=>new Promise(r=>{release=r})});
 const result=await enrichHistory({fixtures:[fixture],method:''},estimate,{now,historyStore:store,waitMs:1});
 assert.equal(result.fixtures.length,1);assert.equal(result.historyCoverage.pending,1);
 release({ok:true,text:async()=>raw});await store.get(fixture.direttaId,{now});
 const updated=await enrichHistory({fixtures:[fixture],method:''},estimate,{now,historyStore:store});assert.equal(updated.historyCoverage.checked,1);assert.equal(updated.fixtures[0].form.home.recentOverall.sample,2);
});
