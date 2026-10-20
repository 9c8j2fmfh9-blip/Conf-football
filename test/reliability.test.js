import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanRows,forecast,evaluate} from '../reliability.js';
const rows=Array.from({length:24},(_,i)=>['2026-01-'+String(i+1).padStart(2,'0'),'A','B',String(i%4),'1']);
test('invalid, duplicate, future and same-day incomplete records are excluded',()=>{
 const dirty=[...rows,rows[0],['2026-01-01','C','D',null,'1'],['2026-01-01','E','F','','1']];
 assert.equal(cleanRows(dirty,Date.parse('2026-01-04T12:00Z')).length,3);
});
test('both teams need six results',()=>{
 assert.equal(forecast(rows.slice(0,5),'A','B'),null);
 assert.equal(forecast(rows,'A','C'),null);
 for(const p of Object.values(forecast(rows,'A','B')))assert.ok(p>=0&&p<=1);
});
test('walk forward uses only earlier dates and reports calibration',()=>{
 const r=evaluate(rows,Date.parse('2026-02-01'));
 assert.equal(r.backtestedFixtures,18);
 for(const m of Object.values(r.markets)){
  assert.ok(m.brier>=0&&m.brier<=1);
  assert.equal(m.calibration.reduce((s,b)=>s+b.count,0),18);
  assert.ok(m.selected70.count<=18);
 }
});
test('later results cannot change earlier predictions or evaluation',()=>{
 const cutoff=Date.parse('2026-01-15');
 const original=evaluate(rows,cutoff);
 const changed=rows.map(r=>r[0]>='2026-01-15'?[...r.slice(0,3),'9','9']:r);
 assert.deepEqual(evaluate(changed,cutoff),original);
});
test('same-date outcomes never supply a missing sixth historical game',()=>{
 const prior=rows.slice(0,5);
 const sameDay=[...prior,['2026-01-06','A','B','2','2'],['2026-01-06','A','B2','2','2']];
 assert.equal(evaluate(sameDay,Date.parse('2026-02-01')).backtestedFixtures,0);
});
