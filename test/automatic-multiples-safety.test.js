import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyMultiples} from '../daily-multiples.js';

test('never generates betting tickets from uncalibrated CONF percentages',()=>{
 const fixtures=[{
  fixtureId:'demo',home:'Team A',away:'Team B',
  date:'2030-01-01T20:00:00Z',status:'NS',
  selection:{qualified:true,primary:{key:'btts',label:'GG',score:95},candidates:[{key:'btts',label:'GG',score:95}]}
 }];
 const result=buildDailyMultiples(fixtures,{sourceUpdatedAt:null},{now:Date.parse('2029-01-01T00:00:00Z')});
 assert.equal(result.validationStatus,'not_calibrated');
 assert.equal(result.tickets.length,2);
 for(const ticket of result.tickets){
  assert.equal(ticket.available,false);
  assert.deepEqual(ticket.legs,[]);
  assert.match(ticket.reason,/sospesa/i);
 }
 assert.deepEqual(result.alternatives,[]);
});
