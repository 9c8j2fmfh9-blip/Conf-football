import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeForecastReport,createForecastStatusStore} from '../forecast-status.js';
const now=Date.parse('2026-10-22T12:00:00Z');
const report={schemaVersion:1,evaluatedAt:'2026-10-22T11:45:00Z',recorded:3,settled:1,pending:[{reason:'Risultato finale non confermato'},{reason:'Identificativo calendario assente'}],rows:[{privateExtra:'do not return'}],byRevision:[]};
test('status distinguishes pending from confirmed results and does not expose raw records',()=>{
 const s=summarizeForecastReport(report,{now});assert.equal(s.recorded,3);assert.equal(s.pending,2);assert.equal(s.settled,1);assert.equal(s.stale,false);assert.equal(s.rows,undefined);assert.equal(s.validated,false);
 assert.equal(s.pendingReasons['Identificativo calendario assente'],1);
 assert.equal(summarizeForecastReport(report,{now:now+3*3600000}).stale,true);
 assert.throws(()=>summarizeForecastReport({...report,settled:4},{now}));
 assert.throws(()=>summarizeForecastReport({...report,pending:[]},{now}));
 assert.throws(()=>summarizeForecastReport({...report,evaluatedAt:'2030-01-01'},{now}));
});
test('shared fetches and cache preserve the last report on a source failure, marked stale',async()=>{
 let time=now,calls=0;
 const store=createForecastStatusStore({clock:()=>time,fetcher:async()=>{calls++;if(calls>1)throw Error('offline');return{ok:true,json:async()=>report};}});
 const [a,b]=await Promise.all([store.get(),store.get()]);assert.equal(calls,1);assert.deepEqual(a,b);
 await store.get();assert.equal(calls,1);
 time+=61000;const stale=await store.get();assert.equal(stale.available,true);assert.equal(stale.stale,true);assert.match(stale.warning,/offline/);
 const offline=createForecastStatusStore({clock:()=>now,fetcher:async()=>{throw Error('offline');}});
 assert.equal((await offline.get()).available,false);
});
