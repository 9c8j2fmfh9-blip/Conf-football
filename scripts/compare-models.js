import {readFileSync,writeFileSync} from 'node:fs';
import {compareModels} from '../compare-models.js';
const data=JSON.parse(readFileSync(new URL('../openfootball-benchmark.json',import.meta.url)));
const result=compareModels(data.leagues);
writeFileSync(new URL('../model-comparison.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
