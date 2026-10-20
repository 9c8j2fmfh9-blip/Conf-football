import {readFileSync,writeFileSync} from 'node:fs';
import {report} from '../reliability.js';
const data=JSON.parse(readFileSync(new URL('../openfootball-benchmark.json',import.meta.url)));
const rows=data.leagues;
const result={...report(rows),source:data.source,license:data.license,retrievedAt:data.retrievedAt,season:data.season};
writeFileSync(new URL('../backtest-report.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
