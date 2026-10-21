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
 console.log('PASS: server boots and serves health, homepage, and prediction selector.');
}finally{
 child.kill('SIGTERM');
}
