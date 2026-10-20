import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyMultiples} from '../daily-multiples.js';
const now=Date.parse('2026-10-20T22:30:00Z');
const make=(id,score,odds)=>({fixtureId:id,home:'Home '+id,away:'Away '+id,date:'2026-10-21T12:00:00Z',status:'NS',league:'Test League',selection:{qualified:true,primary:{key:'over25',label:'Over 2.5 FT',score}},price:odds});
const sheet=fixtures=>({sourceUpdatedAt:'2026-10-20T21:06:29Z',entries:fixtures.map(f=>({home:f.home,away:f.away,date:'2026-10-21',time:'14:00',odds:{over25:f.price}}))});
test('builds both targets with genuine products; higher-confidence candidates lead',()=>{
 const f=[make('a',90,2),make('b',85,5),make('c',80,10)];
 const result=buildDailyMultiples(f,sheet(f),{now});
 assert.deepEqual(result.tickets.map(t=>t.totalOdds),[10,100]);
 assert.deepEqual(result.tickets[0].legs.map(x=>x.fixtureId),['a','b']);
 for(const t of result.tickets)assert.equal(t.totalOdds,Number(t.legs.reduce((p,l)=>p*l.odds,1).toFixed(2)));
 assert.equal('probability' in result.tickets[0],false);
});
test('can skip an intervening leg to hit the target without going to lower confidence',()=>{
 const f=[make('a',90,2),make('b',85,1.2),make('c',80,5),make('d',60,5)];
 const t=buildDailyMultiples(f,sheet(f),{now}).tickets[0];
 assert.equal(t.available,true);assert.equal(t.totalOdds,10);assert.deepEqual(t.legs.map(x=>x.fixtureId),['a','c']);
});
test('does not invent a quota 100 or relax quality when too few prices exist',()=>{
 const f=[make('a',72,1.33),make('b',67,1.2),make('c',66,1.8),make('d',64,1.6),make('e',62,1.4),make('f',60,1.65),make('bad',59,10)];
 const r=buildDailyMultiples(f,sheet(f),{now});
 assert.equal(r.eligibleCount,6);assert.equal(r.tickets[0].totalOdds,10.62);
 assert.equal(r.tickets[1].available,false);assert.deepEqual(r.tickets[1].legs,[]);
});
test('rejects missing, expired, past, live, unqualified and stale data; no duplicate legs or clubs',()=>{
 const a=make('a',90,2),b={...make('b',85,5),home:a.home};
 const f=[a,a,b,{...make('c',80,5),status:'LIVE'}, {...make('d',80,5),date:'2026-10-20T12:00:00Z'}, {...make('e',80,5),dataStale:true},{...make('f',80,5),selection:{qualified:false,primary:null}},make('g',80,NaN)];
 const s=sheet(f);s.entries=s.entries.filter((e,i)=>i!==1);
 const r=buildDailyMultiples(f,s,{now});assert.equal(r.eligibleCount,2);assert.equal(r.tickets[0].available,false);
 assert.equal(buildDailyMultiples([a],null,{now}).eligibleCount,0);
 assert.equal(buildDailyMultiples([a],{...sheet([a]),sourceUpdatedAt:'2026-10-19T00:00:00Z'},{now}).eligibleCount,0);
});
test('only returns tickets within the declared range and excludes events once started',()=>{
 const f=[make('a',90,3),make('b',85,3)];
 assert.equal(buildDailyMultiples(f,sheet(f),{now}).tickets[0].totalOdds,9);
 f[1].date=new Date(now).toISOString();
 assert.equal(buildDailyMultiples(f,sheet(f),{now}).tickets[0].available,false);
});
test('prefers less burden from low prices among feasible combinations of the same confidence tier',()=>{
 const f=[make('madrid',67,1.2),make('sporting',66,1.8),make('villa',64,1.6),make('betis',62,1.62),make('brugge',62,1.4),make('kyoto',60,1.65)];
 const t=buildDailyMultiples(f,sheet(f),{now}).tickets[0];
 assert.equal(t.totalOdds,10.78);assert.ok(!t.legs.some(l=>l.fixtureId==='madrid'));
});
