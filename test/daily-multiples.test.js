import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyMultiples} from '../daily-multiples.js';
const now=Date.parse('2026-10-20T22:30:00Z');
const make=(id,score,odds)=>({fixtureId:id,home:'Home '+id,away:'Away '+id,date:'2026-10-21T12:00:00Z',status:'NS',league:'Test League',selection:{qualified:true,primary:{key:'over25',label:'Over 2.5 FT',score}},price:odds});
const sheet=fixtures=>({sourceUpdatedAt:'2026-10-20T21:06:29Z',entries:fixtures.map(f=>({home:f.home,away:f.away,date:'2026-10-21',time:'14:00',odds:{over25:f.price}}))});
test('quota 10 and 100 are disabled until calibration passes',()=>{
 const f=[make('a',90,2),make('b',85,5),make('c',80,10)];
 const r=buildDailyMultiples(f,sheet(f),{now});
 assert.equal(r.validationStatus,'not_calibrated');
 assert.deepEqual(r.tickets.map(t=>t.target),[10,100]);
 for(const t of r.tickets){assert.equal(t.available,false);assert.equal(t.totalOdds,null);assert.deepEqual(t.legs,[]);}
});
test('high experimental percentages cannot bypass the calibration gate',()=>{
 const f=[make('a',100,2),make('b',100,5)];
 const r=buildDailyMultiples(f,sheet(f),{now});
 assert.equal(r.eligibleCount,0);
 assert.equal(r.tickets[0].available,false);
});
test('even with unavailable or stale odds no automatic ticket is emitted',()=>{
 const f=[make('a',95,2),{...make('b',99,4),status:'LIVE'},make('c',80,NaN)];
 for(const odds of [sheet(f),null,{sourceUpdatedAt:'2020-01-01',entries:[]}]){
  const r=buildDailyMultiples(f,odds,{now});
  assert.equal(r.tickets.every(t=>!t.available&&t.legs.length===0),true);
 }
});
