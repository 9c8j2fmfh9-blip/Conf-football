import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEvent,safeHistory,selectUpcoming,buildCornerMarkets,cornerValues,createDataClient} from '../free-data.js';
const league={id:'eng.1',name:'Premier League',country:'England'};
const event=(state='pre',name='STATUS_SCHEDULED')=>({id:'123',date:'2026-10-20T18:00Z',competitions:[{date:'2026-10-20T18:00Z',timeValid:true,status:{type:{state,name,completed:state==='post'}},competitors:[{homeAway:'home',team:{id:'1',displayName:'A'},score:'2'},{homeAway:'away',team:{id:'2',displayName:'B'},score:{displayValue:'1'}}]}]});
test('scheduled zeros and unknown statuses never become historical results',()=>{
 const pre=parseEvent(event(),league);assert.equal(pre.homeGoals,null);
 assert.equal(safeHistory([pre],Date.parse('2027-01-01')).length,0);
 assert.equal(parseEvent(event('pre','STATUS_POSTPONED'),league).status,'OTHER');
});
test('only explicit FT states with valid scores enter history, deduplicated',()=>{
 const g=parseEvent(event('post','STATUS_FULL_TIME'),league);
 assert.equal(g.homeGoals,2);assert.equal(g.awayGoals,1);
 assert.equal(safeHistory([g,g],Date.parse('2027-01-01')).length,1);
 assert.equal(safeHistory([g],Date.parse('2026-10-20T12:00Z')).length,0);
 assert.equal(parseEvent(event('post','STATUS_FINAL_AET'),league).status,'OTHER');
});
test('Rome date and future windows are enforced',()=>{
 const g=parseEvent(event(),league),now=Date.parse('2026-10-20T12:00Z');
 assert.equal(selectUpcoming([g,g],{now,hours:3}).length,0);
 assert.equal(selectUpcoming([g,g],{now,hours:12}).length,1);
 assert.equal(selectUpcoming([g],{now,date:'2026-10-21'}).length,0);
});
test('missing corners stay unknown; zero is legitimate',()=>{
 const e={id:'123',homeId:'1',awayId:'2'};
 const body={header:{id:'123',competitions:[{date:'2026-01-01T12:00Z',status:{type:{completed:true}}}]},boxscore:{teams:[{team:{id:'1'},statistics:[{name:'wonCorners',displayValue:'0'}]},{team:{id:'2'},statistics:[{name:'wonCorners',displayValue:'5'}]}]}};
 assert.equal(cornerValues(body,e).home,0);
 body.boxscore.teams[0].statistics=[];assert.equal(cornerValues(body,e),null);
});
test('shared head-to-head game counts once for total corner sample',()=>{
 const d=buildCornerMarkets('A','B',[{id:'one',own:4,total:9}],[{id:'one',own:5,total:9}]);
 assert.equal(d.markets.find(m=>m.label.startsWith('Totale')).sample,1);
});
test('parallel identical requests coalesce and cache',async()=>{
 let n=0;const client=createDataClient(async()=>{n++;return {ok:true,json:async()=>({events:[]})};});
 await Promise.all([client.calendar(league,'20261020'),client.calendar(league,'20261020')]);
 await client.calendar(league,'20261020');assert.equal(n,1);
});
