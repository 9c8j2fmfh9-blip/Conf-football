import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{parseSisalPages,matchProposalOdds,getSisalOdds,sisalOddsStatus}from'../sisal-odds.js';
process.env.NODE_ENV='test';
const now=Date.parse('2026-10-20T22:30:00Z');
const pages=JSON.parse(readFileSync('test/fixtures/sisal-items.json','utf8'));
const sheet=parseSisalPages(pages,{now});
const fixture=(market='over25')=>({fixtureId:'betis',home:'Real Betis',away:'Feyenoord',league:'UEFA Champions League',date:'2026-10-21T19:00:00Z',selection:{primary:{key:market}}});
test('reads the actual printed columns, including decimal runs and official update time',()=>{
 const e=sheet.entries.find(e=>e.home==='Betis');assert.deepEqual(e.odds,{one:1.55,draw:4.75,two:5.25,over25:1.33,btts:1.4,over35:1.85});
 const madrid=sheet.entries.find(e=>e.home==='Real Madrid');assert.equal(madrid.odds.over25,1.2);assert.equal(madrid.odds.btts,1.45);
 assert.equal(sheet.sourceUpdatedAt,'2026-10-20T21:06:29.000Z');
});
test('matches date, Italian kickoff, explicit club aliases and exact proposed market',()=>{
 for(const[key,value]of Object.entries({one:1.55,draw:4.75,two:5.25,over25:1.33,btts:1.4,over35:1.85}))assert.equal(matchProposalOdds(fixture(key),sheet,{now}).sisal.value,value);
 assert.equal(matchProposalOdds({...fixture(),home:'Feyenoord',away:'Real Betis'},sheet,{now}).sisal.available,false);
 assert.equal(matchProposalOdds({...fixture(),date:'2026-10-21T13:00:00Z'},sheet,{now}).sisal.available,false);
 assert.equal(matchProposalOdds({...fixture(),date:'2026-10-22T19:00:00Z'},sheet,{now}).sisal.available,false);
 const v={...fixture('btts'),home:'Aston Villa',away:'Viking'};assert.equal(matchProposalOdds(v,sheet,{now}).sisal.value,1.6);
 assert.equal(matchProposalOdds(fixture(),sheet,{now}).bet365.available,false);
});
test('never substitutes missing or ambiguous odds, youth events or stale / future sheets',()=>{
 const entry=sheet.entries.find(e=>e.home==='Betis');
 for(const altered of [{...sheet,entries:[{...entry,odds:{one:1.5}}]}, {...sheet,entries:[entry,entry]}, {...sheet,entries:[{...entry,competitionCode:'EUUYL'}]}, {...sheet,sourceUpdatedAt:'2026-10-19T00:00:00Z'}, {...sheet,sourceUpdatedAt:'2026-10-21T10:00:00Z'}])assert.equal(matchProposalOdds(fixture(),altered,{now}).sisal.available,false);
});
test('rejects changed templates and missing publication dates',()=>{
 assert.throws(()=>parseSisalPages([{height:842,items:[]}],{now}));
 const bad=structuredClone(pages);bad[0].items=bad[0].items.filter(i=>i.str!=='Esito Finale');assert.throws(()=>parseSisalPages(bad,{now}));
});
test('reads joint GG + Over 2.5 from its own sheet and never multiplies single prices',()=>{
 const pages=JSON.parse(readFileSync('test/fixtures/sisal-combined-items.json','utf8'));
 const combined=parseSisalPages(pages,{now,kind:'combined'});
 assert.equal(combined.entries.find(e=>e.home==='Betis').odds.bttsOver25,1.62);
 assert.equal(combined.sourceUpdatedAt,'2026-10-20T21:07:39.000Z');
 const price=matchProposalOdds(fixture('bttsOver25'),{...sheet,combined},{now}).sisal;
 assert.equal(price.value,1.62);assert.ok(price.sourceUrl.includes('combinate'));
 assert.equal(matchProposalOdds(fixture('bttsOver25'),sheet,{now}).sisal.available,false);
 assert.equal(matchProposalOdds(fixture('bttsOver25'),{...sheet,combined:{...combined,sourceUpdatedAt:'2026-10-19T00:00:00Z'}},{now}).sisal.available,false);
 const bad=structuredClone(pages);bad[0].items=bad[0].items.filter(i=>i.str!=='G/NG + U/O2,5');
 assert.throws(()=>parseSisalPages(bad,{now,kind:'combined'}));
 const missing=structuredClone(pages);missing[0].items=missing[0].items.filter(i=>i.str!=='1,62 4,25 6,50');
 assert.throws(()=>parseSisalPages(missing,{now,kind:'combined'}));
});
test('shares a failed refresh between concurrent requests and applies a retry cooldown',async()=>{
 let requests=0;const fetcher=async()=>{requests++;return{ok:false,status:503}};
 await Promise.all([getSisalOdds({now,fetcher,waitForRefresh:true}),getSisalOdds({now,fetcher,waitForRefresh:true})]);
 await getSisalOdds({now:now+1000,fetcher});assert.equal(requests,2);
});
test('cold starts keep verified bootstrap prices available while a slow refresh is pending or fails',async()=>{
 const bootstrap=JSON.parse(readFileSync('sisal-odds-snapshot.json','utf8'));
 const at=Date.parse(bootstrap.sourceUpdatedAt)+2*3600000;
 const pending=[];
 const fetcher=()=>new Promise(resolve=>pending.push(resolve));
 const immediate=await getSisalOdds({now:at,fetcher});
 assert.equal(pending.length,2);
 assert.ok(immediate.entries.length>0);assert.ok(immediate.combined.entries.length>0);
 assert.equal(sisalOddsStatus({now:at}).refreshing,true);
 assert.equal(matchProposalOdds(fixture('bttsOver25'),immediate,{now:at}).sisal.available,true);
 const finish=getSisalOdds({now:at,fetcher,waitForRefresh:true});
 pending.forEach(resolve=>resolve({ok:false,status:503}));
 const retained=await finish;
 assert.equal(retained.sourceUpdatedAt,immediate.sourceUpdatedAt);
 assert.equal(sisalOddsStatus({now:at}).refreshing,false);
 assert.ok(sisalOddsStatus({now:at}).base.error.includes('503'));
 assert.equal(sisalOddsStatus({now:at+7*3600000}).base.available,false);
 assert.equal(matchProposalOdds(fixture(),retained,{now:at+7*3600000}).sisal.available,false);
});
