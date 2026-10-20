import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{parseSisalPages,matchProposalOdds,getSisalOdds}from'../sisal-odds.js';
process.env.NODE_ENV='test';
const now=Date.parse('2026-10-20T22:30:00Z');
const pages=JSON.parse(readFileSync('test/fixtures/sisal-items.json','utf8'));
const sheet=parseSisalPages(pages,{now});
const fixture=(market='over25')=>({fixtureId:'betis',home:'Real Betis',away:'Feyenoord',league:'UEFA Champions League',date:'2026-10-21T19:00:00Z',selection:{primary:{key:market}}});
test('reads the actual printed columns, including decimal runs and official update time',()=>{
 const e=sheet.entries.find(e=>e.home==='Betis');assert.deepEqual(e.odds,{one:1.55,draw:4.75,two:5.25,over25:1.33,btts:1.4});
 const madrid=sheet.entries.find(e=>e.home==='Real Madrid');assert.equal(madrid.odds.over25,1.2);assert.equal(madrid.odds.btts,1.45);
 assert.equal(sheet.sourceUpdatedAt,'2026-10-20T21:06:29.000Z');
});
test('matches date, Italian kickoff, explicit club aliases and exact proposed market',()=>{
 for(const[key,value]of Object.entries({one:1.55,draw:4.75,two:5.25,over25:1.33,btts:1.4}))assert.equal(matchProposalOdds(fixture(key),sheet,{now}).sisal.value,value);
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
test('shares a failed refresh between concurrent requests and applies a retry cooldown',async()=>{
 let requests=0;const fetcher=async()=>{requests++;return{ok:false,status:503}};
 await Promise.all([getSisalOdds({now,fetcher}),getSisalOdds({now,fetcher})]);
 await getSisalOdds({now:now+1000,fetcher});assert.equal(requests,1);
});
