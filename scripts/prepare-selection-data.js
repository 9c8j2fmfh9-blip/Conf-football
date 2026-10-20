import {readFileSync,writeFileSync} from 'node:fs';
import {cleanRows,forecast} from '../reliability.js';
import {selectionFeatures,FEATURE_NAMES} from '../selection-features.js';
const extra=JSON.parse(readFileSync(new URL('../extra-training-rows.json',import.meta.url)));
const output={featureNames:FEATURE_NAMES,seasons:{}};
for(const [season,file] of [['2023-24','training-2023-24.json'],['2024-25','training-2024-25.json'],['2025-26','openfootball-benchmark.json']]){
 const data=JSON.parse(readFileSync(new URL('../'+file,import.meta.url))),rows=[];
 for(const code of ['en.3','en.4'])if(extra[season+code])data.leagues[code]=extra[season+code];
 for(const [league,input] of Object.entries(data.leagues)){
  const games=cleanRows(input);
  for(let i=0;i<games.length;i++){
   const g=games[i],prior=games.slice(0,i).filter(r=>r[0]<g[0]);
   const features=selectionFeatures(prior,g[1],g[2]);if(!features)continue;
   rows.push({date:g[0],league,features,truth:[Number(Number(g[3])+Number(g[4])>=3),Number(Number(g[3])>0&&Number(g[4])>0)],poisson:forecast(prior,g[1],g[2]),baseline:[prior.reduce((s,r)=>s+Number(Number(r[3])+Number(r[4])>=3),0)/prior.length,prior.reduce((s,r)=>s+Number(Number(r[3])>0&&Number(r[4])>0),0)/prior.length]});
  }
 }
 output.seasons[season]=rows;console.log(season,rows.length);
}
writeFileSync('/tmp/conf-selection-cases.json',JSON.stringify(output));
