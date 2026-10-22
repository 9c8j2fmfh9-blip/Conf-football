import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const port=31977;
const child=spawn(process.execPath,['server.js'],{
 env:{...process.env,PORT:String(port),OPENFOOT_API_KEY:'',CONF_PROVIDER:'openmatchday'},
 stdio:['ignore','pipe','pipe']
});
let stderr='';
child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
const root='http://127.0.0.1:'+port;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(){
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw Error('Server exited: '+stderr.slice(-1200));
  try{const response=await fetch(root+'/api/health',{signal:AbortSignal.timeout(1500)});
   if(response.ok)return;
  }catch{}
  await sleep(200);
 }
 throw Error('Server did not become ready: '+stderr.slice(-1200));
}
try{
 await ready();
 const health=await fetch(root+'/api/health',{signal:AbortSignal.timeout(4000)});
 const data=await health.json();
 assert.equal(health.status,200);
 assert.equal(data.ok,true);
 const html=await fetch(root+'/',{signal:AbortSignal.timeout(4000)});
 assert.equal(html.status,200);
 const body=await html.text();
 assert.match(body,/CONF Football/);
 assert.match(body,/GG e Over 2\.5/);
 const selection=await fetch(root+'/conf-selection.js',{signal:AbortSignal.timeout(4000)});
 assert.equal(selection.status,200);
 assert.match(await selection.text(),/export function selectFixture/);
 const auditResponse=await fetch(root+'/api/conf-backtest',{signal:AbortSignal.timeout(10000)});
 assert.equal(auditResponse.status,200);
 const audit=await auditResponse.json();
 assert.equal(audit.validated,false);
 assert.equal(audit.status,'experimental');
 const leagues=Object.values(audit.leagues);
 assert.ok(leagues.length>=3,'Expected bundled EFL leagues');
 let evaluated=0;
 for(const league of leagues){
  assert.ok(league.backtestedFixtures>0,'Backtest must evaluate real fixtures');
  assert.ok(league.backtestedFixtures<=league.historicalFixtures);
  evaluated+=league.backtestedFixtures;
  for(const market of ['one','draw','two','over25','btts','over35','bttsOver25']){
   const metric=league.measurements[market];
   assert.ok(metric,'Missing market '+market);
   for(const key of ['brier','baselineBrier']){
    assert.equal(typeof metric[key],'number');
    assert.ok(Number.isFinite(metric[key])&&metric[key]>=0&&metric[key]<=1);
   }
   assert.ok(metric.observedRate>=0&&metric.observedRate<=100);
  }
 }
 const validationResponse=await fetch(root+'/api/conf-validation',{signal:AbortSignal.timeout(10000)});
 assert.equal(validationResponse.status,200);
 const validation=await validationResponse.json();
 assert.equal(validation.validated,false);
 assert.ok(validation.evaluatedFixtures>3500);
 assert.ok(validation.testedCompetitions>50);
 assert.ok(validation.markets.btts.screened.n>0);
 const calibrationResponse=await fetch(root+'/api/conf-calibration',{signal:AbortSignal.timeout(20000)});
 assert.equal(calibrationResponse.status,200);
 const calibration=await calibrationResponse.json();
 assert.equal(calibration.deployed,false);
 assert.equal(calibration.validated,false);
 assert.ok(calibration.partition.finalPeriod>2500);
 assert.ok(calibration.jointRate.finalPeriod.over25.improvementInterval.dateBlocks>30);
 console.log('PASS: server boots, serves homepage and selector, and evaluates '+evaluated+' historical fixtures across seven markets.');
}finally{
 child.kill('SIGTERM');
}
