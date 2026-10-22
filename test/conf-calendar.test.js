import {goalEstimateFromStats} from '../experimental-goals.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {parseDirettaFeed,createCalendarStore,italianDay} from '../diretta-calendar.js';
import {calendarConf,mergeCalendar} from '../conf-calendar.js';
import {openDataConf} from '../open-data.js';import {selectFixture} from '../conf-selection.js';
import {buildDailyMultiples} from '../daily-multiples.js';
process.env.NODE_ENV='test';
const snapshot=JSON.parse(fs.readFileSync('diretta-calendar-snapshot.json','utf8'));
const raw=fs.readFileSync('test/fixtures/diretta-japan.txt','utf8');
const now=Date.parse('2026-10-20T22:53:00Z');
const app={use(){},get(){},post(){},listen(){}};const express=()=>app;express.static=()=>{};express.json=()=>{};
const context=vm.createContext({express,goalEstimateFromStats,openDataConf,selectFixture,readFileSync:()=>JSON.stringify({leagues:{},results:{},rows:{}}),URL,process:{env:{}},console:{log(){}},Date,Intl,Map,Set,AbortSignal});
vm.runInContext(fs.readFileSync('server.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'file:///tmp/server.js'"),context);
const estimate=vm.runInContext('experimentalGoalEstimate',context);
const getDay=async day=>snapshot.days[day]||{events:[],issue:'missing'};
test('parses genuine public calendar records and rejects malformed responses',()=>{
 const e=parseDirettaFeed(raw);assert.equal(e.length,4);assert.equal(e.filter(x=>x.league==='J2 League').length,1);
 assert.ok(e.every(x=>x.country==='Giappone'&&x.status==='NS'&&italianDay(x.date)==='2026-10-21'));
 assert.throws(()=>parseDirettaFeed('<html>Error</html>'));
 assert.throws(()=>parseDirettaFeed(raw.replace('AA÷','AA÷!')));
});
test('calendar contains all 30 Japanese league matches plus women, across the complete feed',async()=>{
 const data=await calendarConf({date:'2026-10-21',limit:1},estimate,{now,getDay});
 assert.ok(data.fixtures.length>300);assert.equal(data.calendarCount,data.fixtures.length);
 for(const league of ['J1 League','J2 League','J3 League'])assert.equal(data.fixtures.filter(f=>f.league===league).length,10);
 const jp=data.fixtures.filter(f=>['Japan','Giappone'].includes(f.country));assert.equal(jp.length,33);
 assert.equal(data.selectedCount,12);
 assert.ok(data.fixtures.some(f=>f.selection.primary?.kind==='corner'));assert.equal(data.fixtures.filter(f=>f.experimentalEstimate.available).length,25);
 assert.equal(new Set(data.fixtures.map(f=>f.fixtureId)).size,data.fixtures.length);
 const unknown=data.fixtures.find(f=>f.league==='J2 League');assert.equal(unknown.experimentalEstimate.available,false);assert.equal(unknown.selection.qualified,false);assert.deepEqual(unknown.markets,{});
 const prices=JSON.parse(fs.readFileSync('sisal-odds-snapshot.json','utf8'));
 assert.equal(buildDailyMultiples(data.fixtures,prices,{now}).tickets[0].available,false);
});
test('search covers the full calendar, keeps UCL separate from CAF and honors time windows',async()=>{
 const j2=await calendarConf({q:'J2 League',date:'2026-10-21'},estimate,{now,getDay});assert.equal(j2.fixtures.length,10);
 const japan=await calendarConf({q:'Japan',date:'2026-10-21'},estimate,{now,getDay});assert.equal(japan.fixtures.length,33);
 const ucl=await calendarConf({q:'ucl',date:'2026-10-21'},estimate,{now,getDay});assert.equal(ucl.fixtures.length,9);assert.ok(ucl.fixtures.every(f=>f.experimentalEstimate.available));
 const window=await calendarConf({hours:12},estimate,{now,getDay});assert.ok(window.fixtures.every(f=>Date.parse(f.date)>now&&Date.parse(f.date)<=now+12*3600000));
});
test('past, live, duplicated and homonymous events cannot enter a proposal',()=>{
 const base={fixtures:[{fixtureId:'old',home:'Same',away:'Other',country:'England',date:'2026-10-21T10:00:00Z',experimentalEstimate:{available:true},selection:{qualified:true}}]};
 const events=[{id:'future',home:'Same',away:'Other',country:'Giappone',date:'2026-10-21T10:00:00Z',status:'NS',league:'J2 League'}, {id:'live',date:'2026-10-21T10:00:00Z',status:'OTHER'}, {id:'past',date:'2026-10-20T10:00:00Z',status:'NS'}];
 const r=mergeCalendar(base,[...events,events[0]],{now,params:{hours:24}});
 assert.equal(r.fixtures.length,1);assert.equal(r.fixtures[0].experimentalEstimate.available,false);
});
test('a failed calendar download preserves bootstrap data and retries are shared',async()=>{
 const initial=snapshot.days['2026-10-21'];let requests=0,release;
 const store=createCalendarStore({initial:{'2026-10-21':initial},fetcher:()=>{requests++;return new Promise(r=>release=r)}});
 const at=Date.parse(initial.fetchedAt)+10*60000;
 const a=await store.get('2026-10-21',{now:at});const b=await store.get('2026-10-21',{now:at});
 assert.equal(requests,1);assert.equal(a.events.length,initial.events.length);assert.equal(b.events.length,initial.events.length);
 release({ok:false,status:503});await new Promise(r=>setTimeout(r,0));
 const c=await store.get('2026-10-21',{now:at+1000});assert.ok(c.issue.includes('503'));assert.equal(requests,1);
});
test('source outage is explicit and retains the previous statistical-calendar fallback',async()=>{
 const r=await calendarConf({date:'2026-10-21'},estimate,{now,getDay:async()=>({events:[],issue:'outage'})});
 assert.equal(r.providerIssue.code,'CALENDAR_UNAVAILABLE');assert.equal(r.calendarCoverage.partial,true);assert.ok(r.fixtures.length>9);
});
