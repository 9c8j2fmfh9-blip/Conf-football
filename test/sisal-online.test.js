import {gunzipSync} from 'node:zlib';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseCompetition,createSisalStore} from '../sisal-online.js';
import {mergeSisalCalendar} from '../conf-calendar.js';
const now=Date.parse('2026-10-21T15:30:00Z');
const payload=JSON.parse(gunzipSync(fs.readFileSync('test/fixtures/sisal-ucl-online.json.gz')).toString('utf8'));
const competition={key:'1-856',descrizione:'INT Champions League',sigla:'CHAMLEAG'};
test('real Sisal online payload supplies nine UCL matches, exact teams, times and decimal prices',()=>{
 const events=parseCompetition(payload,competition,{now});assert.equal(events.length,9);assert.ok(events.every(e=>e.odds.one>1&&e.odds.btts>1&&e.odds.over25>1));
 const lille=events.find(e=>e.home==='Lille');assert.equal(lille.odds.btts,1.48);assert.equal(lille.date,'2026-10-21T16:45:00.000Z');
});
test('closed, live and invalid events and suspended prices never become available',()=>{
 const p=structuredClone(payload);p.avvenimentoFeList[0].live=true;p.avvenimentoFeList[1].stato=2;
 const e=p.avvenimentoFeList[2];for(const group of Object.values(p.infoAggiuntivaMap))if(group.codiceAvvenimento===e.codiceAvvenimento)group.stato=2;
 const events=parseCompetition(p,competition,{now});assert.equal(events.length,7);assert.deepEqual(events.find(x=>x.id===e.key).odds,{});assert.throws(()=>parseCompetition({},competition));
});
test('Sisal supplies the calendar even when no statistical match exists; only unique team/time matches inherit analysis',()=>{
 const events=parseCompetition(payload,competition,{now});const e=events.find(e=>e.home==='Sporting Lisbona');
 const f={fixtureId:'known',date:e.date,home:'Sporting Lisbon',away:'LASK',experimentalEstimate:{available:true},selection:{candidates:[{key:'btts',evidence:0.8},{key:'bttsOver25',evidence:0.9}]}};
 const result=mergeSisalCalendar({fixtures:[f]},{events,fetchedAt:new Date(now).toISOString(),competitions:1,partial:false},{q:'champions league'},now);
 assert.equal(result.fixtures.length,9);assert.equal(result.analyzedCount,1);assert.equal(result.fixtures.find(x=>x.fixtureId==='known').selection.primary.key,'btts');assert.ok(result.fixtures.every(x=>x.bookmaker==='Sisal'));
 const duplicate=mergeSisalCalendar({fixtures:[f,{...f,fixtureId:'ambiguous'}]},{events,fetchedAt:new Date(now).toISOString(),competitions:1,partial:false},{},now);assert.equal(duplicate.analyzedCount,0);
});
test('network outage retains fresh verified rows and expires them explicitly',async()=>{
 const events=parseCompetition(payload,competition,{now});const store=createSisalStore({initial:{competitions:{'1-856':competition},rows:{'1-856':{fetchedAt:new Date(now).toISOString(),events}}},fetcher:async()=>{throw Error('offline')}});
 const fresh=await store.get({now,wait:true});assert.equal(fresh.events.length,9);assert.ok(fresh.partial);
 const old=await store.get({now:now+11*60000,wait:true});assert.equal(old.events.length,0);assert.equal(old.fetchedAt,null);
});
