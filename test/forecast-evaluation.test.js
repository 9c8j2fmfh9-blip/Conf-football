import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCaptures} from '../forecast-evaluation.js';
import {parseDirettaFeed} from '../diretta-calendar.js';
const f={fixtureId:'diretta_abcdefgh',kickoffAt:'2026-10-22T10:00:00Z',home:'Home',away:'Away',experimentalEstimate:{available:true,estimates:{btts:70,over25:60}}};
const c={capturedAt:'2026-10-22T09:00:00Z',modelRevision:'v1',fixtures:[f]};
const r={id:'abcdefgh',date:f.kickoffAt,home:'Home',away:'Away',status:'FT',score:{home:2,away:1}};
const options={evaluatedAt:'2026-10-22T13:00:00Z'};
test('scores the first pre-kickoff estimate once, keeps revisions separate',()=>{
 const late={...c,capturedAt:'2026-10-22T09:10:00Z',fixtures:[{...f,experimentalEstimate:{available:true,estimates:{btts:99}}}]};
 const report=evaluateCaptures([late,c,c,{...late,modelRevision:'v2'}],[r],options);
 assert.equal(report.settled,2);assert.equal(report.byRevision.length,2);
 const first=report.byRevision.find(x=>x.modelRevision==='v1').markets.btts;
 assert.equal(first.n,1);assert.equal(first.meanForecast,.7);assert.ok(Math.abs(first.brier-.09)<1e-10);
 assert.equal(report.productionBettingApproved,false);
});
test('rejects after-kickoff captures, mismatches, live, absent and ambiguous scores',()=>{
 assert.equal(evaluateCaptures([{...c,capturedAt:f.kickoffAt}],[r],options).recorded,0);
 for(const result of [{...r,home:'Other'},{...r,status:'LIVE'},{...r,score:null},{...r,date:'2026-10-22T11:00:00Z'},{...r,score:{home:null,away:0}}]){
  const report=evaluateCaptures([c],[result],options);assert.equal(report.settled,0);assert.equal(report.pending.length,1);
 }
 assert.equal(evaluateCaptures([c],[r,{...r,score:{home:0,away:0}}],options).settled,0);
 assert.equal(evaluateCaptures([{...c,capturedAt:'bad'}],[r],options).recorded,0);
});
test('calendar admits numeric regulation-time results only, including zero-zero',()=>{
 const base='SA÷1¬~ZA÷ITALIA: Serie A¬ZY÷Italia¬ZEE÷abc¬~AA÷abcdefgh¬AD÷1792663200¬AE÷Home¬AF÷Away¬AB÷3¬AC÷3¬AG÷0¬AH÷0¬';
 assert.deepEqual(parseDirettaFeed(base)[0].score,{home:0,away:0});
 assert.equal(parseDirettaFeed(base.replace('AC÷3','AC÷11'))[0].score,null);
 assert.equal(parseDirettaFeed(base.replace('AG÷0','AG÷'))[0].score,null);
});
