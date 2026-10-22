import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCaptures} from '../forecast-evaluation.js';
import {parseDirettaFeed} from '../diretta-calendar.js';
const f={fixtureId:'diretta_abcdefgh',kickoffAt:'2026-10-22T10:00:00Z',home:'Home',away:'Away',experimentalEstimate:{available:true,estimates:{btts:70,over25:60}}};
const c={capturedAt:'2026-10-22T09:00:00Z',modelRevision:'v1',fixtures:[f]};
const r={id:'abcdefgh',date:f.kickoffAt,home:'Home',away:'Away',status:'FT',score:{home:2,away:1}};
const options={evaluatedAt:'2026-10-22T13:00:00Z'};
test('scores the first pre-kickoff estimate once, keeps revisions separate',()=>{
 const late={...c,capturedAt:'2026-10-22T09:10:00Z',fixtures:[{...f,experimentalEstimate:{available:true,estimates:{btts:99}}}]};
 const report=evaluateCaptures([late,c,c,{...late,modelRevision:'v2'}],[r],options);
 assert.equal(report.settled,2);assert.equal(report.byRevision.length,2);
 const first=report.byRevision.find(x=>x.modelRevision==='v1').markets.btts;
 assert.equal(first.n,1);assert.equal(first.meanForecast,.7);assert.ok(Math.abs(first.brier-.09)<1e-10);
 assert.equal(report.productionBettingApproved,false);
});
test('rejects after-kickoff captures, mismatches, live, absent and ambiguous scores',()=>{
 assert.equal(evaluateCaptures([{...c,capturedAt:f.kickoffAt}],[r],options).recorded,0);
 for(const result of [{...r,home:'Other'},{...r,status:'LIVE'},{...r,score:null},{...r,date:'2026-10-22T11:00:00Z'},{...r,score:{home:null,away:0}}]){
  const report=evaluateCaptures([c],[result],options);assert.equal(report.settled,0);assert.equal(report.pending.length,1);
 }
 assert.equal(evaluateCaptures([c],[r,{...r,score:{home:0,away:0}}],options).settled,0);
 assert.equal(evaluateCaptures([{...c,capturedAt:'bad'}],[r],options).recorded,0);
});
test('calendar admits numeric regulation-time results only, including zero-zero',()=>{
 const base='SA÷1¬~ZA÷ITALIA: Serie A¬ZY÷Italia¬ZEE÷abc¬~AA÷abcdefgh¬AD÷1792663200¬AE÷Home¬AF÷Away¬AB÷3¬AC÷3¬AG÷0¬AH÷0¬';
 assert.deepEqual(parseDirettaFeed(base)[0].score,{home:0,away:0});
 assert.equal(parseDirettaFeed(base.replace('AC÷3','AC÷11'))[0].score,null);
 assert.equal(parseDirettaFeed(base.replace('AG÷0','AG÷'))[0].score,null);
});
test('uses the first available pre-match estimate when earlier captures had no estimate',()=>{
 const empty={...c,capturedAt:'2026-10-22T08:00:00Z',fixtures:[{...f,experimentalEstimate:{available:false}}]};
 const report=evaluateCaptures([empty,c],[r],options);
 assert.equal(report.estimated,1);assert.equal(report.evaluatedForecasts,1);assert.equal(report.rows[0].capturedAt,c.capturedAt);
 assert.equal(report.byRevision[0].markets.btts.meanForecast,.7);
});
test('calendar names resolve spelling differences without fuzzy matching or changing archived forecasts',()=>{
 const forecast={...f,fixtureId:'open_home_away',direttaId:r.id,home:'Home FC',calendarHome:'Home',calendarAway:'Away'};
 const capture={...c,fixtures:[forecast]};const before=JSON.stringify(capture);
 assert.equal(evaluateCaptures([capture],[r],options).settled,1);
 assert.equal(evaluateCaptures([capture],[{...r,id:'other'}],options).settled,0);
 assert.equal(JSON.stringify(capture),before);
});
test('prospective comparison uses only historical baselines already present before kickoff, on the same cohort',()=>{
 const forecast={...f,markets:{btts:{score:50,venueSamples:{home:6,away:6}}}};
 const capture={...c,fixtures:[forecast]};
 const m=evaluateCaptures([capture],[r],options).byRevision[0].markets.btts;
 assert.equal(m.baselineN,1);assert.equal(m.baselineBrier,.25);assert.ok(Math.abs(m.brierImprovement-.16)<1e-10);
 const absent=evaluateCaptures([c],[r],options).byRevision[0].markets.btts;
 assert.equal(absent.baselineN,0);assert.equal(absent.baselineBrier,null);assert.equal(absent.pairedModelBrier,null);
 const partial={...capture,fixtures:[{...forecast,markets:{btts:{...forecast.markets.btts,partial:true}}}]};
 assert.equal(evaluateCaptures([partial],[r],options).byRevision[0].markets.btts.baselineN,0);
});
test('stale estimates hidden by the app cannot enter prediction metrics, and the first fresh capture can replace them',()=>{
 const stale={...c,capturedAt:'2026-10-22T08:00:00Z',fixtures:[{...f,dataStale:true}]};
 const absent=evaluateCaptures([stale],[r],options);
 assert.equal(absent.estimated,0);assert.equal(absent.byRevision[0].markets.btts.n,0);
 const fresh=evaluateCaptures([stale,c],[r],options);
 assert.equal(fresh.estimated,1);assert.equal(fresh.byRevision[0].markets.btts.n,1);assert.equal(fresh.rows[0].capturedAt,c.capturedAt);
});
test('evaluates recorded Diretta frequency markets against final stats and merges later stat snapshots',()=>{
 const stat={key:'diretta_total_shots_19',label:'Totale Over 19.5 tiri',metric:'shots',side:'total',line:20,score:67,sample:12};
 const early={...c,capturedAt:'2026-10-22T08:00:00Z',fixtures:[{...f,direttaStatMarkets:[]}]};
 const later={...c,capturedAt:'2026-10-22T09:10:00Z',fixtures:[{...f,direttaStatMarkets:[stat]}]};
 const result={...r,statistics:{complete:true,home:{shots:11},away:{shots:9}}};
 const report=evaluateCaptures([early,later],[result],options);
 const market=report.byRevision[0].markets.diretta_total_shots_19;
 assert.equal(market.n,1);assert.equal(market.meanForecast,.67);assert.equal(market.observedRate,1);
 assert.ok(Math.abs(market.brier-.1089)<1e-10);assert.equal(report.pending.length,0);
});
test('keeps confirmed score evaluation while marking missing final Diretta stats pending',()=>{
 const forecast={...f,direttaStatMarkets:[{key:'diretta_total_shots_19',metric:'shots',side:'total',line:20,score:60,sample:12}]};
 const report=evaluateCaptures([{...c,fixtures:[forecast]}],[r],options);
 assert.equal(report.settled,1);assert.equal(report.rows[0].markets.diretta_total_shots_19,undefined);
 assert.equal(report.pending[0].reason,'Risultato confermato; statistiche Diretta finali in attesa');
});
test('marks card markets pending when the final Diretta feed contains no card events',()=>{
 const markets=[{key:'diretta_total_yellow_2',metric:'yellowCards',side:'total',line:3,score:67,sample:12}];
 const forecast={...f,direttaStatMarkets:markets};
 const result={...r,statistics:{complete:true,cardsAvailable:false,home:{shots:10},away:{shots:12}}};
 const report=evaluateCaptures([{...c,fixtures:[forecast]}],[result],options);
 assert.equal(report.rows[0].markets.diretta_total_yellow_2,undefined);
 assert.equal(report.pending[0].reason,'Risultato confermato; dato finale Diretta assente per uno o più mercati');
});
