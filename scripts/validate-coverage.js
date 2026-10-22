import {buildValidationAudit} from '../validation-audit.js';
const audit=buildValidationAudit();
console.log(JSON.stringify(audit,null,2));
if(!audit.evaluatedFixtures||audit.testedCompetitions<7)process.exitCode=1;
