import test from 'node:test';import assert from 'node:assert/strict';
import {currentDayTicketFixtures} from '../daily-ticket-scope.js';
const f=(fixtureId,date,status='NS')=>({fixtureId,date,status});
test('all daily ticket sources exclude the following night at 02:00 and midnight itself in Italian time',()=>{
 const games=[f('today','2026-10-22T19:00:00Z'),f('last','2026-10-22T19:30:00Z'),f('late','2026-10-22T19:31:00Z'),f('midnight','2026-10-22T22:00:00Z'),f('night','2026-10-23T00:00:00Z'),f('past','2026-10-22T07:00:00Z'),f('live','2026-10-22T19:00:00Z','LIVE'),f('bad','invalid')];
 assert.deepEqual(currentDayTicketFixtures(games,Date.parse('2026-10-22T08:00:00Z')).map(f=>f.fixtureId),['today','last']);
});
test('today follows Rome rather than UTC and switches at local midnight, including winter time',()=>{
 const summer=[f('summer-today','2026-10-22T01:00:00Z'),f('summer-tomorrow','2026-10-22T22:00:00Z')];
 assert.deepEqual(currentDayTicketFixtures(summer,Date.parse('2026-10-21T22:30:00Z')).map(f=>f.fixtureId),['summer-today']);
 const winter=[f('winter-today','2026-12-22T20:30:00Z'),f('winter-late','2026-12-22T20:31:00Z'),f('winter-tomorrow','2026-12-22T23:00:00Z')];
 assert.deepEqual(currentDayTicketFixtures(winter,Date.parse('2026-12-22T08:00:00Z')).map(f=>f.fixtureId),['winter-today']);
 assert.deepEqual(currentDayTicketFixtures(winter,Date.parse('2026-12-22T23:00:00Z')),[]);
 assert.deepEqual(currentDayTicketFixtures(winter,Date.parse('2026-12-22T20:31:00Z')),[]);
});
