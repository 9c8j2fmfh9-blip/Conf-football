import test from 'node:test';
import assert from 'node:assert/strict';
import {filterSisalCalendar} from '../conf-calendar.js';
const now=Date.parse('2026-10-21T12:00:00Z');
const fixture={fixtureId:'1',date:'2026-10-21T19:00:00Z',home:'Inter',away:'Bayern Munich',league:'Champions League',selection:{qualified:true},experimentalEstimate:{available:true}};
const data={fixtures:[fixture,{...fixture,fixtureId:'2',away:'Chelsea'}]};
const sheet={sourceUpdatedAt:'2026-10-21T11:00:00Z',entries:[{date:'2026-10-21',time:'21:00',home:'Inter',away:'Bayern Monaco',competitionCode:'EUCHL',odds:{one:2}}]};
test('Sisal filter keeps only exact verified events with alias support',()=>{
 const result=filterSisalCalendar(data,sheet,{now});assert.deepEqual(result.fixtures.map(f=>f.fixtureId),['1']);assert.equal(result.selectedCount,1);assert.equal(result.bookmaker,'Sisal');
});
test('missing or expired Sisal sheets fail closed',()=>{
 for(const value of [null,{...sheet,sourceUpdatedAt:'2026-10-20T10:00:00Z'}]){const result=filterSisalCalendar(data,value,{now});assert.equal(result.fixtures.length,0);assert.equal(result.providerIssue.code,'SISAL_UNAVAILABLE');}
});
test('different kickoff and ambiguous bookmaker rows are excluded',()=>{
 for(const entries of [[{...sheet.entries[0],time:'20:00'}],[...sheet.entries,...sheet.entries]])assert.equal(filterSisalCalendar(data,{...sheet,entries},{now}).fixtures.length,0);
});
