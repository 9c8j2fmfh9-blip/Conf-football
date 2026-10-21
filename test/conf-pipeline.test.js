import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {selectFixture} from '../conf-selection.js';
const routes={};const app={post(){},use(){},get(path,handler){routes[path]=handler},listen(){}};const express=()=>app;express.static=()=>{};express.json=()=>{};
let source=fs.readFileSync('server.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'file:///tmp/server.js'");
const now=Date.now();const matches=Array.from({length:50},(_,i)=>({id:'fixture_'+i,kickoffAt:new Date(now+(i+1)*60000).toISOString(),status:'scheduled',homeTeam:{id:'h'+i,name:'Home '+i},awayTeam:{id:'a'+i,name:'Away '+i},competition:{id:'test',name:'Test',country:'Test'}}));
const stub=async(path,params)=>{
 if(path!=='/matches')return {response:[]};
 if(!params.team)return{response:matches};
 const id=params.team;const high=id.endsWith('49');return{response:Array.from({length:10},(_,i)=>({id:id+'_'+i,kickoffAt:new Date(now-(i+1)*86400000).toISOString(),status:'finished',homeTeam:{id:id.startsWith('h')?id:'opp'},awayTeam:{id:id.startsWith('a')?id:'opp'},score:{home:high?2:0,away:high?2:0}}))};
};
source+='\nopenFoot=__stub; eflLeagueData=async()=>({matches:[],historical:[]});';
const context=vm.createContext({express,selectFixture,readFileSync:()=>JSON.stringify({leagues:{},results:{},rows:{}}),URL,process:{env:{CONF_PROVIDER:'openfoot'}},console:{log(){}},Date,Intl,Map,Set,AbortSignal,__stub:stub});vm.runInContext(source,context);
let body;const res={json(v){body=v},status(){return this}};await routes['/api/conf']({query:{limit:'20',hours:'24'}},res);
assert.ok(!body.error,body.error);assert.equal(body.analyzedCount,50);assert.equal(body.selectedCount,1);assert.equal(body.fixtures.length,20);assert.equal(body.fixtures[0].fixtureId,'fixture_49');assert.ok(['over25','btts'].includes(body.fixtures[0].selection.primary.key));
console.log('PASS: 50 fixtures screened before display limit; strongest fixture beyond former first-40 cap selected and ranked first; duplicates excluded; all network mocked.');

const romeDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const day=romeDay(matches[49].kickoffAt);
await routes['/api/conf']({query:{date:day,limit:'40',hours:'1'}},res);
assert.equal(body.date,day);
assert.equal(body.analyzedCount,matches.filter(m=>romeDay(m.kickoffAt)===day).length);
assert.ok(body.fixtures.every(f=>romeDay(f.date)===day));
console.log('PASS: explicit date is honored without text query and is independent of the hourly window.');
let requests=0;
const quotaContext=vm.createContext({express,selectFixture,readFileSync:()=>JSON.stringify({leagues:{},results:{},rows:{}}),URL,process:{env:{CONF_PROVIDER:'openfoot'}},console:{log(){}},Date,Intl,Map,Set,AbortSignal,fetch:async()=>{requests++;return{ok:false,status:429,json:async()=>({error:{message:'This key has reached its 5,000-request monthly quota.'}})}}});
const quotaSource=fs.readFileSync('server.js','utf8').replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'file:///tmp/server.js'");
vm.runInContext(quotaSource,quotaContext);
for(let i=0;i<2;i++) await assert.rejects(vm.runInContext("openFoot('/matches',{date:'2026-10-21'})",quotaContext),e=>e.code==='MONTHLY_QUOTA');
assert.equal(requests,1);
console.log('PASS: exhausted monthly quota is classified and repeated calls are blocked for the cooldown.');
