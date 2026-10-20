import test from 'node:test';import assert from 'node:assert/strict';
import {formSummary,tableContext,parseStandings,buildContext} from '../match-context.js';
import {contextualForecast} from '../contextual-model.js';
const game=(id,home,away,hg,ag)=>({id,status:'FT',homeId:home,awayId:away,homeGoals:hg,awayGoals:ag,stamp:Date.parse('2026-10-01')+id*86400000});
test('venue form keeps home and away distinct and counts actual points',()=>{
 const games=[game(1,'A','B',2,0),game(2,'C','A',3,1),game(3,'A','D',1,1)];
 assert.deepEqual(formSummary(games,'A','home'),{sample:2,results:['N','V'],points:4,goalsFor:3,goalsAgainst:1});
 assert.equal(formSummary(games,'A','away').points,0);
});
test('table context uses source zone boundaries, not invented motivation',()=>{
 const rows=[{id:'a',name:'A',rank:1,points:20,zone:'Promotion'},{id:'b',name:'B',rank:2,points:15,zone:''},{id:'c',name:'C',rank:3,points:13,zone:'Relegation'}];
 const c=tableContext([{rows,name:'league'}],'c');assert.equal(c.boundary.type,'salvezza');assert.equal(c.boundary.gap,-2);assert.equal(c.boundary.target,'B');
 assert.equal(tableContext([],'c').available,false);
});
test('missing table values do not become zero or fake relegation gaps',()=>{
 const groups=parseStandings({children:[{standings:{entries:[{team:{id:'a'},stats:[{name:'points',value:12}]}]}}]});
 assert.equal(groups[0].rows.length,0);assert.equal(tableContext(groups,'a').available,false);
});
test('recent and venue context do not alter the forecast input',()=>{
 const games=[game(1,'a','x',1,0)];const before=JSON.stringify(games);
 const c=buildContext({homeId:'a',awayId:'b',stamp:Date.parse('2026-10-20')},games,[],[]);
 assert.equal(JSON.stringify(games),before);assert.equal(c.away.daysSinceLast,null);
 assert.match(c.warning,/nessun aumento automatico/i);
});
test('candidate requires both samples and returns bounded probabilities',()=>{
 assert.equal(contextualForecast([],'a','b'),null);
 const rows=Array.from({length:8},(_,i)=>['2026-01-'+String(i+1).padStart(2,'0'),'a','b',2,1]);
 const p=contextualForecast(rows,'a','b');assert.ok(Object.values(p).every(x=>x>=0&&x<=1));
});
