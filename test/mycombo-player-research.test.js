import test from 'node:test';import assert from 'node:assert/strict';
import {playerMarketResearch} from '../mycombo-player-research.js';
test('never fabricates odds, probabilities or missing player data',()=>{
 const out=playerMarketResearch({available:true,players:{home:[{name:'Example',appearances:5,stats:{shots:{x:{label:'Tiri in porta',average:1.2,count:5},y:{label:'Tiri totali',average:2.4,count:5}}}}],away:[]}});
 assert.equal(out.length,2);assert.ok(out.every(x=>x.bookmakerOdds===null&&x.probability===null&&x.descriptiveOnly));
});
test('includes player yellow-card markets only from supplied match samples',()=>{
 const out=playerMarketResearch({available:true,players:{home:[{name:'Defender',appearances:5,stats:{defense:{yellow:{label:'Cartellini gialli',average:.8,count:5}}}}],away:[]}});
 assert.equal(out.length,1);
 assert.equal(out[0].market,'yellow_cards');
 assert.equal(out[0].label,'Defender · 1+ cartellino giallo');
 assert.equal(out[0].bookmakerOdds,null);
 assert.equal(out[0].probability,null);
});
test('requires sample and only explicitly recognized markets',()=>{
 assert.deepEqual(playerMarketResearch({available:true,players:{home:[{name:'A',appearances:2,stats:{shots:{x:{label:'Shots',average:3,count:2}}}}],away:[]}}),[]);
 assert.deepEqual(playerMarketResearch({available:false,players:{home:[],away:[]}}),[]);
});
