import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {selectionFeatures} from '../selection-features.js';import {inferParameters,learnedSelection,cornerEvidence} from '../selection-engine.js';
const model=JSON.parse(readFileSync(new URL('../selection-model.json',import.meta.url))),gold=JSON.parse(readFileSync(new URL('../selection-inference-cases.json',import.meta.url))),report=JSON.parse(readFileSync(new URL('../selection-validation.json',import.meta.url)));
test('Node inference matches independent sklearn calibrated outputs',()=>{for(const [k,cases] of Object.entries(gold))for(const c of cases)assert.ok(Math.abs(inferParameters(model.markets[k],c.features)-c.expected)<1e-12);});
test('model requires separate samples and reports unsupported competitions',()=>{
 assert.equal(selectionFeatures([],'a','b'),null);assert.equal(learnedSelection(model,report,[],'a','b','uefa.champions').available,false);
 assert.equal(learnedSelection(model,report,[],'a','b','eng.3').available,false);
});
test('corner confidence penalizes small samples and partial totals',()=>{
 assert.equal(cornerEvidence({sample:2,hits:2}),null);assert.equal(cornerEvidence({sample:8,hits:8}).eligible,true);
 assert.equal(cornerEvidence({sample:8,hits:7}).eligible,false);assert.equal(cornerEvidence({sample:8,hits:8,partial:true}),null);
});
test('validation exposes near-baseline result and small threshold sample honestly',()=>{
 assert.equal(report.protocol.test,2624);assert.equal(report.markets.over25.selected70.count,17);assert.equal(report.markets.over25.selectionEvidenceSufficient,false);
 assert.equal(report.markets.over25.betterThanPrevious,true);assert.equal(report.markets.over25.betterThanBaseline,false);
});
