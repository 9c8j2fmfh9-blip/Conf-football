import test from 'node:test';
import assert from 'node:assert/strict';
import {selectFixture} from '../conf-selection.js';
const fixture = (changes={}) => ({experimentalEstimate:{available:true,samples:{home:10,away:10},estimates:{over25:72}}, markets:{over25:{score:70,venueSamples:{home:10,away:10},teamRates:[.7,.7],...changes}}});
test('requires both model and history to meet 60%',()=>{
 assert.equal(selectFixture(fixture()).primary.key,'over25');
 assert.equal(selectFixture(fixture({score:59})).qualified,false);
 const f=fixture();f.experimentalEstimate.estimates.over25=59;
 assert.equal(selectFixture(f).qualified,false);
});
test('rejects missing values, partial history and small samples on either side',()=>{
 for(const change of [{score:null},{partial:true},{venueSamples:{home:10,away:5}},{teamRates:[.8,.3]},{teamRates:[.7,null]}]) assert.equal(selectFixture(fixture(change)).qualified,false);
 const f=fixture();f.experimentalEstimate.samples.away=5;assert.equal(selectFixture(f).qualified,false);
 assert.equal(selectFixture({}).qualified,false);
});
test('keeps forecast and historical frequency distinct',()=>{
 const p=selectFixture(fixture()).primary;assert.equal(p.score,72);assert.equal(p.historicalScore,70);assert.ok(p.evidence < .7);
});
test('penalizes fragile samples before ranking candidates',()=>{
 const small=fixture({venueSamples:{home:6,away:6}});const large=fixture({venueSamples:{home:10,away:10}});
 assert.ok(selectFixture(large).primary.evidence>selectFixture(small).primary.evidence);
});
test('does not select a market absent from the model',()=>{
 const f=fixture();f.experimentalEstimate.estimates={one:80};assert.equal(selectFixture(f).qualified,false);
});
