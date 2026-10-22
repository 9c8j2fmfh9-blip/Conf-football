import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirettaPlayerStatsStore,buildDirettaPlayerReport} from '../diretta-player-stats.js';

test('builds MyCombo player-shot ideas only with six historical observations',()=>{
 const initial={},games=[];
 const totals=[2,2,1,1,1,0],targets=[1,2,0,1,1,0];
 const statTypes=[
  {key:'shots_total',label:'Tiri totali',format:'count',groups:['shots']},
  {key:'shots_on_target',label:'Tiri in porta',format:'count',groups:['shots']}
 ];
 for(let i=0;i<6;i++){
  const id='shot00'+i;
  initial[id]={complete:true,matchId:id,statTypes,players:[{
   id:'player001',name:'Attaccante',shortName:'Attaccante',position:'Striker',side:'home',starter:true,rating:7,
   stats:{shots_total:{raw:totals[i],value:String(totals[i])},shots_on_target:{raw:targets[i],value:String(targets[i])}}
  }]};
  games.push({id,date:new Date(Date.parse('2026-10-21T20:00:00Z')-i*86400000).toISOString(),home:'Home',away:'Rival '+i});
 }
 const report=buildDirettaPlayerReport('Home','Away',games,[],createDirettaPlayerStatsStore({initial}),
  {now:Date.parse('2026-10-22T12:00:00Z'),schedule:false});
 const totalShots=report.markets.find(x=>x.metric==='tiri totali');
 const shotsOnTarget=report.markets.find(x=>x.metric==='tiri in porta');
 assert.equal(totalShots.label,'Attaccante · Over 0.5 tiri totali');
 assert.equal(totalShots.hits,5);assert.equal(totalShots.sample,6);assert.equal(totalShots.score,83);
 assert.equal(shotsOnTarget.label,'Attaccante · Over 0.5 tiri in porta');
 assert.equal(shotsOnTarget.hits,4);assert.equal(shotsOnTarget.score,67);
});

test('does not create player-shot ideas below the historical sample minimum',()=>{
 const initial={},games=[];
 for(let i=0;i<5;i++){
  const id='few0000'+i;
  initial[id]={complete:true,players:[{id:'player001',name:'Attaccante',side:'home',stats:{shots_total:{raw:2,value:'2'}}}]};
  games.push({id,date:'2026-10-20T12:00:00Z',home:'Home',away:'Rival'});
 }
 const report=buildDirettaPlayerReport('Home','Away',games,[],createDirettaPlayerStatsStore({initial}),
  {now:Date.parse('2026-10-22T12:00:00Z'),schedule:false});
 assert.deepEqual(report.markets,[]);
});
