import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareCapture} from '../forecast-capture.js';
const root='https://conf-football.onrender.com';
const fetchJson=async(path,timeout=90000)=>{
 let lastError;
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await fetch(root+path,{signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error('HTTP '+response.status);return await response.json();}
  catch(error){lastError=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,5000*(attempt+1)));}
 }
 throw lastError;
};
const health=await fetchJson('/api/health',30000);
const data=await fetchJson('/api/conf?hours=24&limit=200');
let quotes=null;try{quotes=await fetchJson('/api/proposal-odds?hours=24&limit=200');}catch{/* Keep predictions, explicitly mark absent prices. */}
const after=await fetchJson('/api/health',30000);
if(health.gitCommit!==after.gitCommit)throw Error('Deployment changed during capture; retry next run');
const capturedAt=new Date().toISOString();
const capture=prepareCapture(data,quotes,{capturedAt,modelRevision:after.gitCommit||null,runId:process.env.GITHUB_RUN_ID||null});
if(!capture.fixtures.length)throw Error('No future fixtures captured; do not write an empty successful archive');
const folder=resolve(process.argv[2]||'forecast-captures');mkdirSync(folder,{recursive:true});
const filename=capturedAt.replaceAll(':','-')+'-'+(process.env.GITHUB_RUN_ID||'local')+'.json';
writeFileSync(resolve(folder,filename),JSON.stringify(capture,null,2)+'\n',{flag:'wx'});
console.log('Archived '+capture.fixtures.length+' upcoming fixtures; '+capture.fixtures.filter(f=>f.experimentalEstimate?.available).length+' have model estimates.');
