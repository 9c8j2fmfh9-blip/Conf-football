import test from 'node:test';import assert from 'node:assert/strict';
import {selectFixture} from '../conf-selection.js';import {pricedSelection} from '../priced-selection.js';import {buildDailyMultiples} from '../daily-multiples.js';
const now=Date.parse('2026-10-20T22:45:00Z');
const f={fixtureId:'test',home:'Real Betis',away:'Feyenoord',date:'2026-10-21T19:00:00Z',status:'NS',league:'UEFA Champions League',experimentalEstimate:{available:true,samples:{home:10,away:10},estimates:{over25:72,over35:61,bttsOver25:62}},markets:Object.fromEntries(['over25','over35','bttsOver25'].map(key=>[key,{score:70,venueSamples:{home:10,away:10},teamRates:[.7,.7]}]))};f.selection=selectFixture(f);
const entry={home:'Betis',away:'Feyenoord',date:'2026-10-21',time:'21:00',competitionCode:'EUCHL'};
const sheet={sourceUpdatedAt:'2026-10-20T21:06:29Z',entries:[{...entry,odds:{over25:1.33,over35:1.85}}],combined:{sourceUpdatedAt:'2026-10-20T21:07:39Z',entries:[{...entry,odds:{bttsOver25:1.62}}]}};
test('replaces a low-priced primary with an independently qualified higher-priced alternative',()=>{
 const r=pricedSelection(f,sheet,{now});assert.equal(r.primary.key,'bttsOver25');assert.equal(r.primary.score,62);assert.equal(r.odds.sisal.value,1.62);
 assert.equal(r.alternatives.find(a=>a.key==='over35').odds.sisal.value,1.85);
 assert.equal(f.selection.primary.key,'over25');
 const all=buildDailyMultiples([f],sheet,{now});assert.equal(all.eligibleCount,1);
});
test('never promotes an unqualified or unpriced alternative; an already adequate price keeps its higher score',()=>{
 const bad=structuredClone(f);bad.experimentalEstimate.estimates.over35=59;bad.experimentalEstimate.estimates.bttsOver25=59;bad.selection=selectFixture(bad);
 assert.equal(pricedSelection(bad,sheet,{now}).primary.key,'over25');
 const noPrices={...sheet,combined:null,entries:[{...entry,odds:{over25:1.33}}]};
 const r=pricedSelection(f,noPrices,{now});assert.equal(r.primary.key,'over25');assert.equal(r.odds.sisal.belowMinimum,true);
 const adequate={...sheet,entries:[{...entry,odds:{over25:1.7,over35:2}}]};assert.equal(pricedSelection(f,adequate,{now}).primary.key,'over25');
});

test('goal pricing preserves the independent corner recommendation',()=>{
 const c=structuredClone(f);c.cornerMarkets={markets:[{key:'corners_home_ft_4',label:'Casa · 4+ corner FT',side:'home',score:100,hits:10,sample:10}]};c.selection=selectFixture(c);
 const r=pricedSelection(c,sheet,{now});assert.equal(r.primary.key,'bttsOver25');assert.equal(r.primary.score,62);assert.equal(r.odds.sisal.value,1.62);
 assert.equal(c.selection.cornerPrimary.key,'corners_home_ft_4');assert.equal(c.selection.cornerPrimary.score,100);
 const only={...c,experimentalEstimate:{available:false},markets:{}};only.selection=selectFixture(only);
 const corner=pricedSelection(only,sheet,{now});assert.equal(corner.primary.kind,'corner');assert.equal(corner.odds.sisal.available,false);
});
