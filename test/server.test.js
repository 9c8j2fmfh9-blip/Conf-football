import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {app}=await import('../server.js');
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=()=>`http://127.0.0.1:${server.address().port}`;
test.after(()=>server.close());
test('public UI loads and private source/data stay private',async()=>{
 assert.equal((await fetch(base())).status,200);
 for(const path of ['/server.js','/package.json','/team-stats-2627.json','/.env'])assert.equal((await fetch(base()+path)).status,404);
});
test('backtest endpoint returns measured, unvalidated results',async()=>{
 const r=await fetch(base()+'/api/conf-backtest');
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.validated,false);
 assert.equal(Object.keys(data.leagues).length,3);
 assert.ok(Object.values(data.leagues).every(l=>l.backtestedFixtures>0));
});
test('missing half-corner API key does not fabricate percentages',async()=>{
 const r=await fetch(base()+'/api/corners-halves?home=A&away=B&date=2026-10-20');
 const data=await r.json();
 assert.deepEqual(data.markets,[]);
});
test('CONF analyzes beyond the first 40 fixtures, follows cursors and rejects live fixtures',async()=>{
 const native=globalThis.fetch;
 const future=new Date(Date.now()+3600000).toISOString();
 const matches=Array.from({length:45},(_,i)=>({id:'fixture_'+i,status:'scheduled',kickoffAt:future,homeTeam:{id:'h'+i,name:'Test '+i},awayTeam:{id:'a'+i,name:'Away '+i},competitionName:'Test Cup'}));
 matches.push({...matches[0],id:'live',status:'live'});
 let cursors=0;
 globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://openfootapi.com/'))return native(url,options);
  const u=new URL(url);let body={data:[]};
  if(u.pathname.endsWith('/matches')){
   if(u.searchParams.has('team')){
    const id=u.searchParams.get('team');
    body={data:Array.from({length:7},(_,i)=>({id:id+'_'+i,status:'finished',kickoffAt:new Date(Date.now()-(i+1)*86400000).toISOString(),homeTeam:{id},awayTeam:{id:'other'},score:{home:2,away:1}}))};
   }else if(u.searchParams.has('cursor')){cursors++;body={data:matches.slice(30)};}
   else body={data:matches.slice(0,30),meta:{pagination:{next_cursor:'next'}}};
  }
  return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const r=await native(base()+'/api/conf?q=Test&hours=3&limit=20');
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.analyzedCount,45);
  assert.equal(body.fixtures.length,20);
  assert.ok(cursors>0);
  assert.ok(body.fixtures.every(f=>f.status==='NS'&&f.experimentalEstimate.available));
 }finally{globalThis.fetch=native;}
});
