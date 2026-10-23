import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleMultipleMarkets,MULTIPLE_MINIMUM_SCORE} from '../multiple-policy.js';
import {buildDailyMultiples} from '../daily-multiples.js';
import {buildComparisonTickets} from '../comparison-tickets.js';
import {buildAlternativeMultiples} from '../alternative-multiples.js';

const now=Date.parse('2026-10-20T22:30:00Z');
const pick=(id,score,historicalScore=score)=>({
 fixtureId:id,home:'Home '+id,away:'Away '+id,
 date:'2026-10-21T12:00:00Z',status:'NS',league:'Test',
 selection:{qualified:true,candidates:[{key:'over25',label:'Over 2.5 FT',score,historicalScore,evidence:0.5}],
  primary:{key:'over25',label:'Over 2.5 FT',score,historicalScore,evidence:0.5}}
});
const sheet=fs=>({sourceUpdatedAt:'2026-10-20T21:06:29Z',
 entries:fs.map(f=>({home:f.home,away:f.away,date:'2026-10-21',time:'14:00',odds:{over25:3.2}}))});

test('multiple policy screens model estimate and recorded historical support independently',()=>{
 assert.equal(MULTIPLE_MINIMUM_SCORE,70);
 assert.equal(eligibleMultipleMarkets(pick('low',69)).length,0);
 assert.equal(eligibleMultipleMarkets(pick('history-low',80,69)).length,0);
 assert.equal(eligibleMultipleMarkets(pick('boundary',70,70)).length,1);
});

test('quota 10 and quota 100 never add a 69 percent selection to fill a target',()=>{
 const low=pick('low',69),histLow=pick('history-low',90,65),good=pick('good',70),higher=pick('higher',75);
 const fixtures=[low,histLow,good,higher];
 const result=buildDailyMultiples(fixtures,sheet(fixtures),{now,experimentalDrafts:true});
 assert.equal(result.minimumSelectionScore,70);
 assert.equal(result.eligibleCount,2);
 for(const ticket of result.tickets){
  assert.ok(ticket.legs.every(l=>l.score>=70));
  assert.ok(ticket.legs.every(l=>!['low','history-low'].includes(l.fixtureId)));
 }
});

test('comparison bookmaker tickets enforce the same 70 percent rule',()=>{
 const fs=[pick('low',69),pick('history-low',80,69),pick('good',70),pick('higher',75)];
 const quotes={source:'Comparison',fixtures:fs.map(f=>({
  fixtureId:f.fixtureId,home:f.home,away:f.away,date:f.date,observedAt:new Date(now).toISOString(),
  books:{B:{code:'B',name:'Example bookmaker',odds:{over25:{value:3.2}}}}
 }))};
 const result=buildComparisonTickets(fs,quotes,{now});
 assert.equal(result.eligibleCount,2);
 for(const ticket of result.tickets)for(const leg of ticket.legs){
  assert.ok(leg.score>=70);
  assert.ok(['good','higher'].includes(leg.fixtureId));
 }
});

test('MyCombo only qualifies model goals and historical corners at 70 or higher',()=>{
 const sample=(id,score,cornerScore,cornerHits)=>({
  fixtureId:id,home:'Home '+id,away:'Away '+id,date:'2026-10-21T12:00:00Z',status:'NS',
  experimentalEstimate:{available:true,samples:{home:10,away:10},estimates:{over25:score}},
  markets:{over25:{score:80,venueSamples:{home:10,away:10},teamRates:[.8,.8]}},
  cornerMarkets:{markets:[{key:'corners_total_ft_9',label:'Totale 9+ corner FT',side:'total',half:'full',line:9,
   score:cornerScore,hits:cornerHits,sample:20,venueSamples:{home:10,away:10},teamRates:[.8,.8]}]}
 });
 const tickets=buildAlternativeMultiples([sample('lowgoal',69,80,16),sample('lowcorner',75,65,13),sample('good',75,80,16)],{now});
 for(const ticket of tickets)for(const leg of ticket.legs){
  assert.equal(leg.fixtureId,'good');
  assert.ok(leg.goal.score>=70&&leg.corner.score>=70);
 }
});
