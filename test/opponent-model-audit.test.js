import test from 'node:test';
import assert from 'node:assert/strict';
import {opponentForecasts,buildOpponentAudit} from '../opponent-model-audit.js';
const options={learningRate:.04,penalty:.05};
const game=(i,date,home=2,away=1)=>({id:'g'+i,resultDate:date,sourceLeague:'test',homeTeam:{id:'home'},awayTeam:{id:'away'},score:{home,away}});
const history=Array.from({length:35},(_,i)=>game(i,new Date(Date.UTC(2026,6,i+1)).toISOString().slice(0,10)));
test('opponent updates exclude every same-day result and all future games',()=>{
 const date='2026-08-06',a=game(36,date),b=game(37,date),future=game(38,'2026-08-07');
 const original=opponentForecasts([...history,a,b,future],options);
 const changed=opponentForecasts([...history,{...a,score:{home:9,away:9}},b,future],options);
 assert.deepEqual(changed.get(a.id),original.get(a.id));assert.deepEqual(changed.get(b.id),original.get(b.id));
 assert.notDeepEqual(changed.get(future.id),original.get(future.id));
 const withoutFuture=opponentForecasts([...history,a,b],options);
 assert.deepEqual(withoutFuture.get(a.id),original.get(a.id));
 for(const p of original.values())for(const value of Object.values(p.probabilities))assert.ok(value>=0&&value<=100);
});
test('league states remain isolated and insufficient team history has no rating forecast',()=>{
 assert.equal(opponentForecasts(history.slice(0,8),options).size,0);
 const target=game(99,'2026-08-10');
 const extra=history.map(g=>({...g,id:'other'+g.id,sourceLeague:'other',score:{home:9,away:0}}));
 assert.deepEqual(opponentForecasts([...history,...extra,target],options).get(target.id),opponentForecasts([...history,target],options).get(target.id));
});
test('audit selects only on tuning data, keeps unchanged model eligible and preserves actual forecasts',()=>{
 const report=buildOpponentAudit();
 const best=report.candidates.reduce((a,b)=>b.tuningBrier<a.tuningBrier?b:a);
 assert.deepEqual(report.chosenParameters,best.parameters);assert.equal(report.deployed,false);assert.equal(report.validated,false);
 assert.ok(report.partition.finalPeriod>2500);assert.ok(report.partition.tuning>100);
 assert.ok(report.partition.testStart>report.partition.tuneStart);
 if(!report.chosenParameters)assert.deepEqual(report.markets.btts.raw,report.markets.btts.candidate);
});
