import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {openDataConf,datasetKickoff,parseCsv,refreshOpenData} from '../open-data.js';import {selectFixture} from '../conf-selection.js';
process.env.NODE_ENV='test';
const app={use(){},get(){},post(){},listen(){}};const express=()=>app;express.static=()=>{};express.json=()=>{};
const context=vm.createContext({express,openDataConf,selectFixture,readFileSync:()=>JSON.stringify({leagues:{},results:{},rows:{}}),URL,process:{env:{}},console:{log(){}},Date,Intl,Map,Set,AbortSignal});
const source=fs.readFileSync('server.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'file:///tmp/server.js'");vm.runInContext(source,context);
const estimate=vm.runInContext('experimentalGoalEstimate',context);
const now=Date.parse('2026-10-20T21:00:00Z');
test('tomorrow returns all nine UCL fixtures with current-season analysis and correct Italian kickoff',()=>{
 const data=openDataConf({q:'Champions League',date:'2026-10-21',limit:100},estimate,{now});
 assert.equal(data.fixtures.length,9);assert.ok(data.fixtures.every(f=>f.experimentalEstimate.available));
 assert.ok(data.fixtures.some(f=>f.home==='Inter'&&f.away==='Shakhtar'));
 const como=data.fixtures.find(f=>f.home==='Como');assert.equal(como.date,'2026-10-21T16:45:00Z');
 assert.equal(como.experimentalEstimate.available,true);assert.ok(como.experimentalEstimate.samples.home>=6);
 const inter=data.fixtures.find(f=>f.home==='Inter');assert.equal(inter.experimentalEstimate.available,true);
 assert.ok(data.fixtures.every(f=>Date.parse(f.date)>now));
 assert.equal(new Set(data.fixtures.map(f=>f.fixtureId)).size,9);
 console.log('UCL:',data.fixtures.length,'fixtures;',data.fixtures.filter(f=>f.experimentalEstimate.available).length,'with model;',data.selectedCount,'selected');
});
test('free calendar covers more than one match and honors date, time window and English League One search',()=>{
 const data=openDataConf({date:'2026-10-21',limit:200},estimate,{now});
 assert.ok(data.analyzedCount>9);assert.equal(data.competitionsCovered,75);
 const england=openDataConf({q:'league one',date:'2026-10-21'},estimate,{now});assert.ok(england.fixtures.every(f=>f.country==='England'));
 const window=openDataConf({hours:3},estimate,{now});assert.ok(window.fixtures.every(f=>Date.parse(f.date)<=now+3*3600000));
 console.log('21 October:',data.analyzedCount,'fixtures;',data.fixtures.filter(f=>f.experimentalEstimate.available).length,'with model;',data.selectedCount,'selected');
});
test('timezone convention survives winter DST changes and quoted CSV names',()=>{
 assert.equal(datasetKickoff('2026-11-03','21:00'),'2026-11-03T20:00:00Z');
 assert.equal(datasetKickoff('2026-10-21','00:30'),'2026-10-21T23:30:00Z');
 assert.equal(datasetKickoff('2026-10-21',''),null);
 assert.equal(parseCsv('date,home,away\n2026-10-21,"A, B",C')[0].home,'A, B');
});
test('daily selection can inspect all fixtures regardless of the card display limit',()=>{
 const limited=openDataConf({date:'2026-10-21',limit:1},estimate,{now});
 const all=openDataConf({date:'2026-10-21',limit:1},estimate,{now,allFixtures:true});
 assert.equal(limited.fixtures.length,1);assert.equal(all.fixtures.length,all.analyzedCount);
 assert.equal(all.fixtures.filter(f=>f.selection.qualified).length,all.selectedCount);
 assert.ok(all.fixtures.length>limited.fixtures.length);
});
test('stale data and future results cannot qualify a prediction',()=>{
 const snapshot=JSON.parse(fs.readFileSync('open-data-snapshot.json','utf8'));
 snapshot.generatedAt='2026-10-01T00:00:00Z';snapshot.leagues=snapshot.leagues.map(l=>({...l,updatedAt:snapshot.generatedAt}));
 const data=openDataConf({q:'ucl',date:'2026-10-21'},estimate,{now,data:snapshot});
 assert.equal(data.selectedCount,0);assert.equal(data.providerIssue.code,'STALE_DATA');
 const future={...snapshot,leagues:[{id:'ENG_1_demo',name:'Demo',country:'England',updatedAt:'2026-10-20T12:00:00Z',fixturesCsv:'date,time,home,away\n2026-10-21,20:00,A,B',resultsCsv:'date,home,away,ft_home,ft_away\n2026-10-22,A,B,9,9'}]};
 const f=openDataConf({date:'2026-10-21'},estimate,{now,data:future}).fixtures[0];assert.equal(f.experimentalEstimate.available,false);
});

test('background refresh retains a league when its update fails and uses no metered provider',async()=>{
 const snapshot=JSON.parse(fs.readFileSync('open-data-snapshot.json','utf8'));
 const originalFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{
  calls++;const path=String(url);
  if(path.endsWith('build_summary.json'))return{ok:true,text:async()=>JSON.stringify({season:'2627',generated_utc:'2026-10-20T05:10:46Z'})};
  assert.ok(path.startsWith('https://raw.githubusercontent.com/oladeeayo/open-matchday/master/'));
  const league=snapshot.leagues.find(l=>path.includes('/'+l.id+'/'));
  if(league.id==='UEFA_1_champions-league')throw Error('temporary outage');
  return{ok:true,text:async()=>path.includes('/fixtures_')?league.fixturesCsv:league.resultsCsv};
 };
 try { await refreshOpenData();const after=openDataConf({q:'ucl',date:'2026-10-21'},estimate,{now});assert.equal(after.fixtures.length,9);assert.equal(after.fixtures[0].dataUpdatedAt,snapshot.generatedAt);assert.ok(calls>1); }
 finally{globalThis.fetch=originalFetch;}
});
