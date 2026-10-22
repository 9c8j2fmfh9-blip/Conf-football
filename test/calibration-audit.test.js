import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCalibration,calibratedProbability,chronologicalCalibration,jointRateCalibration,pairedDateInterval} from '../calibration-audit.js';
const synthetic=()=>Array.from({length:1000},(_,i)=>({
 date:new Date(Date.UTC(2026,0,1+Math.floor(i/10))).toISOString().slice(0,10),
 probabilities:{btts:50+i%20,over25:45+i%20},truth:{btts:+(i%3!==0),over25:+(i%2===0)},
 expectedGoals:{home:1.3,away:1.2},actualGoals:{home:i%4,away:i%3},selected:i%2?'btts':'over25'
}));
test('later outcomes cannot influence calibration fitting or parameter choice',()=>{
 const rows=synthetic(),first=chronologicalCalibration(rows),joint=jointRateCalibration(rows);
 const changed=rows.map(r=>r.date>=first.partition.testStart?{...r,truth:{btts:1-r.truth.btts,over25:1-r.truth.over25},actualGoals:{home:9,away:9}}:r);
 const second=chronologicalCalibration(changed),jointChanged=jointRateCalibration(changed);
 for(const key of ['btts','over25']){
  assert.equal(second.markets[key].chosenPenalty,first.markets[key].chosenPenalty);
  assert.deepEqual(second.markets[key].parameters,first.markets[key].parameters);
  assert.deepEqual(second.markets[key].tuning,first.markets[key].tuning);
 }
 assert.deepEqual(joint.fittedFactors,jointChanged.fittedFactors);
 assert.equal(joint.chosenStrength,jointChanged.chosenStrength);
 assert.equal(first.validated,false);
 assert.equal(first.deployed,false);
});
test('calibration remains monotone and bounded and rejects tiny training samples',()=>{
 const model=fitCalibration(synthetic(),'btts',.1);
 const values=[.001,.2,.5,.8,.999].map(p=>calibratedProbability(p,model));
 assert.ok(values.every(p=>p>0&&p<1));
 assert.deepEqual(values,values.slice().sort((a,b)=>a-b));
 assert.throws(()=>fitCalibration(synthetic().slice(0,20),'btts',.1),/Insufficient/);
});
test('paired date resampling is deterministic and reports zero for identical forecasts',()=>{
 const rows=synthetic();
 const a=pairedDateInterval(rows,'btts',rows,100);
 assert.equal(a.lower,0);assert.equal(a.upper,0);
 assert.equal(a.dateBlocks,100);
 assert.deepEqual(a,pairedDateInterval(rows,'btts',rows,100));
});
