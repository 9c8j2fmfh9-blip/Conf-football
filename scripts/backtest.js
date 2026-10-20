import {readFileSync,writeFileSync} from 'node:fs';
import {report} from '../reliability.js';
const data=JSON.parse(readFileSync(new URL('../efl-history-2627.json',import.meta.url)));
const result=report(data.leagues);
writeFileSync(new URL('../backtest-report.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
