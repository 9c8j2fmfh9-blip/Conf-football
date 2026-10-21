import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAlternativeMultiples} from '../alternative-multiples.js';
import {buildDailyMultiples} from '../daily-multiples.js';
const now=Date.parse('2026-10-21T08:00:00Z');
const fixture=(id,score=75,key='over25')=>({fixtureId:id,home:'Home '+id,away:'Away '+id,status:'NS',date:'2026-10-21T19:00:00Z',
 experimentalEstimate:{available:true,samples:{home:10,away:10},estimates:{[key]:score}},
 markets:{[key]:{score:80,venueSamples:{home:10,away:10},teamRates:[.8,.8]}},
 cornerMarkets:{markets:[
  {key:'corners_home_ft_2',label:'Casa · 2+ corner FT',side:'home',half:'full',line:2,score:100,hits:10,sample:10},
  {key:'corners_total_ft_9',label:'Totale 9+ corner FT',side:'total',half:'full',line:9,score:80,hits:16,sample:20,venueSamples:{home:10,away:10},teamRates:[.8,.8]}
 ]}});
test('two unpriced drafts use only total corners plus the best eligible goal/result, independently of odds',()=>{
 const fixtures=Array.from({length:6},(_,i)=>fixture(String(i),80-i));
 const result=buildDailyMultiples(fixtures,null,{now});
 assert.ok(result.tickets.every(t=>!t.available));
 const [compact,extended]=buildAlternativeMultiples(fixtures,{now});
 assert.deepEqual(result.alternatives,[]);
 assert.equal(compact.legs.length,3);assert.equal(extended.legs.length,5);
 assert.deepEqual(compact.legs.map(l=>l.fixtureId),['0','1','2']);
 for(const ticket of result.alternatives){
  assert.equal(ticket.totalOdds,null);assert.equal(ticket.oddsVerified,false);assert.equal(ticket.targetReached,false);
  assert.equal('probability' in ticket,false);
  for(const leg of ticket.legs){
   assert.equal(leg.corner.side,'total');assert.equal(leg.corner.key,'corners_total_ft_9');
   assert.equal(leg.goal.key,'over25');assert.equal(leg.corner.score,80);assert.equal('score' in leg,false);assert.equal('odds' in leg,false);
  }
 }
});
test('each supported result and goal market can form a combo with total corners',()=>{
 for(const key of ['one','draw','two','btts','over25','over35','bttsOver25']){
  const t=buildAlternativeMultiples([fixture(key,75,key)],{now})[0];assert.equal(t.legs[0].goal.key,key);
 }
});
test('rejects live, past, stale, small, one-sided or missing corner samples and never substitutes team corners',()=>{
 const bad=fixture('bad');bad.cornerMarkets.markets=bad.cornerMarkets.markets.slice(0,1);
 const weak=fixture('weak');Object.assign(weak.cornerMarkets.markets[1],{venueSamples:{home:15,away:5}});
 const unqualified=fixture('low',59);
 const firstHalf=fixture('half');firstHalf.cornerMarkets.markets[1].half='first';
 const fixtures=[bad,weak,unqualified,firstHalf,{...fixture('live'),status:'LIVE'},{...fixture('past'),date:new Date(now).toISOString()},{...fixture('stale'),dataStale:true}];
 for(const t of buildAlternativeMultiples(fixtures,{now})){assert.equal(t.available,false);assert.equal(t.legs.length,0);}
});
test('deduplicates matches and clubs, preserves limited availability and flags identical profiles',()=>{
 const a=fixture('a'),dup={...a,fixtureId:'same'},b={...fixture('b'),home:a.home},c=fixture('c');
 const r=buildAlternativeMultiples([a,a,dup,b,c],{now});
 assert.deepEqual(r[0].legs.map(l=>l.fixtureId),['a','c']);assert.equal(r[1].isMultiple,true);
 assert.ok(r[1].reason.includes('Stesse combo'));
 const single=buildAlternativeMultiples([a],{now})[0];assert.equal(single.isMultiple,false);assert.equal(single.legs.length,1);
});
