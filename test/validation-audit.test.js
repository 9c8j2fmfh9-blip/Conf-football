import test from 'node:test';
import assert from 'node:assert/strict';
import {priorBenchmarks,auditMarkets,buildValidationAudit} from '../validation-audit.js';
import {goalEstimateFromStats} from '../experimental-goals.js';
const row=(date,hit,id)=>({id,date,league:'L',probabilities:Object.fromEntries(auditMarkets.map(k=>[k,60])),truth:Object.fromEntries(auditMarkets.map(k=>[k,hit]))});
test('benchmarks exclude every outcome on the forecast date and all later dates',()=>{
 const early=Array.from({length:30},(_,i)=>row('2026-01-01',1,'e'+i));
 const original=priorBenchmarks([...early,row('2026-01-02',0,'a'),row('2026-01-02',1,'b')]);
 assert.equal(original.length,2);
 assert.equal(original[0].baseline.btts,35/40);
 assert.equal(original[1].baseline.btts,35/40);
 const changed=priorBenchmarks([...early,row('2026-01-02',1,'a'),row('2026-01-02',0,'b'),row('2026-01-03',1,'c')]);
 assert.deepEqual(changed.slice(0,2).map(r=>r.baseline),original.map(r=>r.baseline));
});
test('shared production model keeps score probabilities coherent and requires six games each',()=>{
 const h={sample:10,averageFor:1.7,averageAgainst:1.1},a={sample:10,averageFor:1.4,averageAgainst:1.8};
 const m=goalEstimateFromStats(h,a);
 assert.equal(m.validated,false);
 assert.ok(Math.abs(m.estimates.one+m.estimates.draw+m.estimates.two-100)<=1);
 assert.ok(m.estimates.bttsOver25<=m.estimates.btts);
 assert.ok(m.estimates.bttsOver25<=m.estimates.over25);
 assert.equal(goalEstimateFromStats({...h,sample:5},a).available,false);
});
test('expanded replay reports actual coverage without declaring betting validation',()=>{
 const report=buildValidationAudit();
 assert.ok(report.source.fixtures>7000);
 assert.ok(report.evaluatedFixtures>3500);
 assert.ok(report.testedCompetitions>50);
 assert.equal(report.validated,false);
 for(const key of auditMarkets){
  const m=report.markets[key];
  assert.equal(m.laterPeriod.n,report.laterPeriodFixtures);
  assert.equal(m.buckets.reduce((sum,b)=>sum+b.n,0),m.laterPeriod.n);
  assert.ok(m.screened.n<=m.laterPeriod.n);
  assert.ok(Number.isFinite(m.laterPeriod.brier));
 }
});
