import test from 'node:test';
import assert from 'node:assert/strict';
import {selectFixture} from '../conf-selection.js';

test('high historical scores are research signals, not betting validation',()=>{
 const market={score:95,venueSamples:{home:10,away:10},teamRates:[.9,.9]};
 const fixture={experimentalEstimate:{available:true,validated:false,samples:{home:10,away:10},estimates:{btts:95}},markets:{btts:market}};
 const result=selectFixture(fixture,60);
 assert.equal(result.qualified,true);
 assert.equal(result.validated,false);
 assert.equal(result.bettingQualified,false);
 assert.match(result.warning,/non calibrate/i);
});
test('calibration not marked passed means betting is still blocked',()=>{
 const market={score:90,venueSamples:{home:10,away:10},teamRates:[.9,.9]};
 const result=selectFixture({experimentalEstimate:{available:true,validated:true,samples:{home:10,away:10},estimates:{btts:90}},markets:{btts:market}},60);
 assert.equal(result.bettingQualified,false);
});
