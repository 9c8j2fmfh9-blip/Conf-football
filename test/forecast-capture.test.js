import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCapture} from '../forecast-capture.js';
test('capture excludes started, near-start, invalid and duplicate fixtures',()=>{
 const f=(fixtureId,date)=>({fixtureId,date,experimentalEstimate:{available:true,estimates:{btts:61}},dataStale:true});
 const data={fixtures:[f('old','2026-10-22T09:00:00Z'),f('near','2026-10-22T10:04:00Z'),f('future','2026-10-22T11:00:00Z'),f('future','2026-10-22T11:00:00Z'),f('bad','unknown')]};
 const record=prepareCapture(data,null,{capturedAt:'2026-10-22T10:00:00Z',modelRevision:'abc'});
 assert.equal(record.fixtures.length,1);
 assert.equal(record.fixtures[0].fixtureId,'future');
 assert.equal(record.fixtures[0].dataStale,true);
 assert.equal(record.modelRevision,'abc');
 assert.equal(record.oddsStatus.available,false);
 assert.equal(record.fixtures[0].prices,null);
});
test('only exact fixture identifiers attach prices and input records are not changed',()=>{
 const fixture={fixtureId:'a',date:'2026-10-22T11:00:00Z',markets:{btts:{score:60}}};
 const before=JSON.stringify(fixture);
 const result=prepareCapture({fixtures:[fixture]},{fixtures:[{fixtureId:'other',odds:2}]},{capturedAt:'2026-10-22T10:00:00Z'});
 assert.equal(result.fixtures[0].prices,null);
 assert.equal(result.oddsStatus.available,false);
 assert.equal(result.oddsStatus.retrieved,true);
 assert.equal(JSON.stringify(fixture),before);
 assert.throws(()=>prepareCapture({},null,{capturedAt:'invalid'}),/Invalid/);
});
