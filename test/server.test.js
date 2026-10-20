import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {createApp}=await import('../server.js');
const now=Date.parse('2026-10-20T12:00Z');
const game=(i,extra={})=>({id:'f'+i,date:'2026-10-20T18:00:00Z',stamp:Date.parse('2026-10-20T18:00Z'),homeId:'h'+i,awayId:'a'+i,home:'Test '+i,away:'Away '+i,league:'Test Cup',leagueId:'eng.1',country:'England',status:'NS',...extra});
const old=(id,i)=>game(id+i,{id:id+i,homeId:id,awayId:'opponent',homeGoals:2,awayGoals:1,date:`2026-10-${String(i+1).padStart(2,'0')}T12:00Z`,stamp:Date.parse(`2026-10-${String(i+1).padStart(2,'0')}T12:00Z`),status:'FT'});
const fake={standings:async()=>({children:[{standings:{season:2026,entries:[{team:{id:'h44',displayName:'Test 44'},stats:[{name:'rank',value:3},{name:'points',value:10},{name:'gamesPlayed',value:8}]}]}}]}),calendar:async(l)=>l.id==='eng.1'?[...Array.from({length:45},(_,i)=>game(i)),game('live',{status:'OTHER'}),game('past',{stamp:now-1}),game(0)]:[],teamHistory:async(l,id)=>Array.from({length:8},(_,i)=>old(id,i)),corners:async(events,id)=>events.map(e=>({id:e.id,own:5,total:9}))};
const app=createApp(fake,()=>now),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=()=>`http://127.0.0.1:${server.address().port}`;
test.after(()=>{server.closeAllConnections();server.close();});
test('public UI loads; code, private data and environment stay private',async()=>{
 assert.equal((await fetch(base())).status,200);
 for(const path of ['/server.js','/package.json','/openfootball-snapshot.json','/.env'])assert.equal((await fetch(base()+path)).status,404);
});
test('45 future fixtures analyzed before display limit; duplicates and live excluded',async()=>{
 const r=await fetch(base()+'/api/conf?q=Test&hours=24&limit=20');const d=await r.json();
 assert.equal(r.status,200);assert.equal(d.analyzedCount,45);assert.equal(d.fixtures.length,20);
 assert.ok(d.fixtures.every(f=>f.status==='NS'&&f.estimate));
});
test('query searches whole source set, not only displayed cards',async()=>{
 const d=await (await fetch(base()+'/api/conf?q=Test%2044')).json();
 assert.equal(d.fixtures.length,1);assert.equal(d.fixtures[0].home,'Test 44');assert.equal(d.fixtures[0].context.home.table.points,10);assert.equal(d.fixtures[0].context.home.venue.sample,6);
});
test('corner response uses explicit historical data and never estimates periods',async()=>{
 const d=await (await fetch(base()+'/api/corners?fixture=f44')).json();
 assert.equal(d.homeSample,8);assert.equal(d.awaySample,8);assert.equal(d.markets[0].score,100);
 assert.ok(d.markets.every(m=>/FT/.test(m.label)));
});
test('backtest endpoint uses licensed, fetched previous-season benchmark',async()=>{
 const r=await fetch(base()+'/api/conf-backtest');const d=await r.json();
 assert.equal(r.status,200);assert.equal(d.validated,false);assert.equal(d.license,'CC0-1.0');
 assert.equal(Object.keys(d.leagues).length,8);assert.ok(Object.values(d.leagues).some(l=>l.backtestedFixtures>0));
});
test('free health and invalid input checks',async()=>{
 assert.equal((await (await fetch(base()+'/api/health')).json()).paidProviders,false);
 assert.equal((await fetch(base()+'/api/conf?date=no')).status,400);
 assert.equal((await fetch(base()+'/api/corners?fixture=not-found')).status,404);
});
