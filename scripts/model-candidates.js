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
const dates=[...new Set(observations.map(x=>x.date))].sort();
const cutoff=dates[Math.floor(dates.length*0.7)];
const train=observations.filter(x=>x.date<cutoff),holdout=observations.filter(x=>x.date>=cutoff);
const forecast=(r,strength,baseline,aggregation)=>{
 const shrink=(v,n)=>(v*n+baseline*strength)/(n+strength);
 const combine=aggregation==='arithmetic'?(a,b)=>(a+b)/2:(a,b)=>Math.sqrt(a*b);
 const h=Math.max(.15,Math.min(4,combine(shrink(r.hf,r.hN),shrink(r.aa,r.aN))));
 const a=Math.max(.15,Math.min(4,combine(shrink(r.af,r.aN),shrink(r.ha,r.hN))));
 const l=h+a;
 return {gg:(1-Math.exp(-h))*(1-Math.exp(-a)),over:1-Math.exp(-l)*(1+l+l*l/2)};
};
const loss=(rows,params,key)=>rows.reduce((sum,row)=>{
 const diff=forecast(row,...params)[key]-Number(row[key+'Hit']);return sum+diff*diff;
},0)/rows.length;
const candidates=[];
for(const strength of [3,6,10,16])
 for(const baseline of [1.1,1.3,1.5])
  for(const aggregate of ['geometric','arithmetic']){
   const params=[strength,baseline,aggregate];
   candidates.push({params,trainGG:loss(train,params,'gg'),trainOver:loss(train,params,'over'),
    holdoutGG:loss(holdout,params,'gg'),holdoutOver:loss(holdout,params,'over')});
  }
const current=candidates.find(c=>c.params.join('|')==='6|1.3|geometric');
const chosenGG=candidates.slice().sort((a,b)=>a.trainGG-b.trainGG)[0];
const chosenOver=candidates.slice().sort((a,b)=>a.trainOver-b.trainOver)[0];
const report={train:train.length,holdout:holdout.length,cutoff,candidates:candidates.length,
 current,chosenGG,chosenOver,
 improvedGG:chosenGG.holdoutGG<current.holdoutGG,
 improvedOver:chosenOver.holdoutOver<current.holdoutOver,
 deployed:false,note:'Candidate search is exploratory; later matches never influence training selection. No odds or profit claims.'};
console.log(JSON.stringify(report,null,2));
if(observations.length<300||holdout.length<100)process.exitCode=1;
