import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildOpponentAudit} from '../opponent-model-audit.js';
const bytes=readFileSync(new URL('../open-data-snapshot.json',import.meta.url));
const report=buildOpponentAudit(JSON.parse(bytes));
report.datasetSha256=createHash('sha256').update(bytes).digest('hex');
const output=JSON.stringify(report,null,2)+'\n';
if(process.argv[2])writeFileSync(process.argv[2],output);else process.stdout.write(output);
