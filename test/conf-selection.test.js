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

const cornerFixture = () => ({cornerMarkets:{markets:[{key:'corners_home_ft_4',label:'Casa · 4+ corner FT',side:'home',line:4,score:80,hits:8,sample:10}]}});
test('selects verified corners independently of an unavailable goal model',()=>{
 const result=selectFixture(cornerFixture());
 assert.equal(result.primary.key,'corners_home_ft_4');assert.equal(result.primary.score,80);
 assert.equal(result.primary.scoreKind,'historical');assert.equal(result.primary.kind,'corner');
 assert.equal(result.primary.samples.home,10);assert.ok(result.reason.includes('Non è una probabilità prevista'));
});
test('does not promote missing, inconsistent, partial or undersampled corners',()=>{
 for(const change of [{sample:5,hits:4},{score:null},{score:59},{sample:10,hits:7},{partial:true},{side:'unknown'},{key:undefined}]) {
  const f=cornerFixture();Object.assign(f.cornerMarkets.markets[0],change);assert.equal(selectFixture(f).qualified,false);
 }
 const f=cornerFixture();f.dataStale=true;assert.equal(selectFixture(f).qualified,false);
});
test('total corners require six observations and historical support from each team',()=>{
 const f=cornerFixture(),m=f.cornerMarkets.markets[0];Object.assign(m,{key:'corners_total_ft_9',side:'total',score:80,hits:16,sample:20,venueSamples:{home:10,away:10},teamRates:[.8,.8]});
 assert.equal(selectFixture(f).primary.key,'corners_total_ft_9');
 m.venueSamples={home:15,away:5};assert.equal(selectFixture(f).qualified,false);
 m.venueSamples={home:10,away:10};m.teamRates=[1,.4];assert.equal(selectFixture(f).qualified,false);
});
test('ranks corners and goals together and keeps a single primary indication',()=>{
 const f=fixture();f.cornerMarkets=cornerFixture().cornerMarkets;
 const r=selectFixture(f);assert.equal(r.primary.kind,'corner');assert.equal(r.candidates.length,2);
 assert.equal(r.candidates[1].key,'over25');
});
