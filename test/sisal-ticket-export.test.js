import test from 'node:test';
import assert from 'node:assert/strict';
import { SISAL_SITE_URL, ticketForSisalClipboard } from '../sisal-ticket-export.js';

const slip={available:true,target:100,totalOdds:54.729,legs:[
 {home:'Atalanta U20',away:'Lazio U20',date:'2026-10-23T13:00:00.000Z',label:'Over 2.5 FT',odds:1.52},
 {home:'Hapoel A',away:'Hapoel B',date:'2026-10-23T14:00:00.000Z',label:'GG',odds:1.73}
]};
test('the mobile copy checklist retains every match, exact market and indicative odds',()=>{
 const text=ticketForSisalClipboard(slip);
 assert.match(text,/Obiettivo quota 100/);
 assert.match(text,/1\. 23\/10, 15:00 · Atalanta U20 – Lazio U20 \| Over 2\.5 FT · quota indicativa 1,52/);
 assert.match(text,/2\. 23\/10, 16:00 · Hapoel A – Hapoel B \| GG · quota indicativa 1,73/);
 assert.match(text,/54,73/);
 assert.match(text,/NON crea una schedina/);
 assert.ok(text.endsWith(SISAL_SITE_URL));
});
test('no auto-fill or pretend success for invalid or unavailable tickets',()=>{
 assert.equal(ticketForSisalClipboard(null),null);
 assert.equal(ticketForSisalClipboard({available:false,legs:slip.legs}),null);
 assert.equal(ticketForSisalClipboard({available:true,legs:[]}),null);
 assert.equal(ticketForSisalClipboard({...slip,legs:[{...slip.legs[0],label:''}]}),null);
});
