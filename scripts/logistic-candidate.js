// Independent chronological parameter experiment. Never updates live predictions.
import {readFileSync} from 'node:fs';
const efl=JSON.parse(readFileSync(new URL('../efl-history-2627.json',import.meta.url),'utf8'));
const support=JSON.parse(readFileSync(new URL('../fa-cup-support-history-2627.json',import.meta.url),'utf8'));
for(const [league,rows] of Object.entries(support.results||{}))efl.leagues[league]=rows.map(x=>[x[0],x[2],x[3],x[4],x[5]]);
const observations=[];
const average=(rows,team,isFor)=>rows.reduce((total,r)=>total+Number(r[isFor?(r[1]===team?3:4):(r[1]===team?4:3)]),0)/rows.length;
for(const [league,rows] of Object.entries(efl.leagues)){
 const games=rows.slice().sort((a,b)=>a[0].localeCompare(b[0]));
 for(const [date,home,away,hg,ag] of games){
  const earlier=games.filter(g=>g[0]<date);
  // Match the app: select the last ten overall games before filtering venue.
  const hAll=earlier.filter(g=>g[1]===home||g[2]===home).slice(-10);
  const aAll=earlier.filter(g=>g[1]===away||g[2]===away).slice(-10);
  const hVenue=hAll.filter(g=>g[1]===home);
  const aVenue=aAll.filter(g=>g[2]===away);
  const h=hVenue.length>=6?hVenue:hAll;
  const a=aVenue.length>=6?aVenue:aAll;
  if(h.length<6||a.length<6)continue;
  observations.push({league,date,hN:h.length,aN:a.length,
   hf:average(h,home,true),ha:average(h,home,false),af:average(a,away,true),aa:average(a,away,false),
   ggHit:Number(hg)>0&&Number(ag)>0,overHit:Number(hg)+Number(ag)>2});
 }
}

const dates=[...new Set(observations.map(r=>r.date))].sort();
const cutoff=dates[Math.floor(dates.length*.7)];
const train=observations.filter(r=>r.date<cutoff),holdout=observations.filter(r=>r.date>=cutoff);
const features=r=>[1,r.hf,r.ha,r.af,r.aa,Math.log(1+r.hN),Math.log(1+r.aN)];
const sigmoid=x=>1/(1+Math.exp(-Math.max(-20,Math.min(20,x))));
const poisson=r=>{
 const shrink=(v,n)=>(v*n+7.8)/(n+6);
 const h=Math.sqrt(shrink(r.hf,r.hN)*shrink(r.aa,r.aN));
 const a=Math.sqrt(shrink(r.af,r.aN)*shrink(r.ha,r.hN));
 const total=h+a;
 return {gg:(1-Math.exp(-h))*(1-Math.exp(-a)),over:1-Math.exp(-total)*(1+total+total*total/2)};
};
const fit=(market,lambda)=>{
 const means=Array(6).fill(0),sds=Array(6).fill(0);
 const matrix=train.map(features);
 for(let j=1;j<7;j++){
  means[j-1]=matrix.reduce((s,x)=>s+x[j],0)/matrix.length;
  sds[j-1]=Math.sqrt(matrix.reduce((s,x)=>s+(x[j]-means[j-1])**2,0)/matrix.length)||1;
 }
 const transform=r=>features(r).map((x,j)=>j===0?1:(x-means[j-1])/sds[j-1]);
 const X=train.map(transform),y=train.map(r=>+r[market+'Hit']);
 let w=Array(7).fill(0);
 const rate=(y.reduce((s,v)=>s+v,0)+1)/(y.length+2);
 w[0]=Math.log(rate/(1-rate));
 for(let epoch=0;epoch<2500;epoch++){
  const grad=Array(7).fill(0);
  for(let i=0;i<X.length;i++){
   const err=sigmoid(X[i].reduce((sum,v,j)=>sum+v*w[j],0))-y[i];
   for(let j=0;j<7;j++)grad[j]+=err*X[i][j];
  }
  for(let j=0;j<7;j++)w[j]-=.12*(grad[j]/X.length+(j?lambda*w[j]:0));
 }
 return r=>sigmoid(transform(r).reduce((sum,v,j)=>sum+v*w[j],0));
};
const brier=(rows,key,predict)=>rows.reduce((s,r)=>s+(predict(r)- +r[key+'Hit'])**2,0)/rows.length;
const results={};
for(const key of ['gg','over']){
 const alternatives=[0.01,0.1,1].map(lambda=>({lambda,fn:fit(key,lambda)}));
 for(const c of alternatives)c.trainingBrier=brier(train,key,c.fn);
 const winner=alternatives.sort((a,b)=>a.trainingBrier-b.trainingBrier)[0];
 const baseline= r=>poisson(r)[key];
 results[key]={trainedRegularization:winner.lambda,trainingRows:train.length,holdoutRows:holdout.length,
  baselineBrier:brier(holdout,key,baseline),logisticBrier:brier(holdout,key,winner.fn),
  improvesBaseline:brier(holdout,key,winner.fn)<brier(holdout,key,baseline)};
}
console.log(JSON.stringify({model:'regularized logistic regression',cutoff,results,productionReady:false},null,2));
if(train.length<100||holdout.length<100)process.exitCode=1;
