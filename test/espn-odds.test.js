import {gunzipSync} from 'node:zlib';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseEspnOdds,decimalOdds,createEspnStore} from '../espn-odds.js';
const now=Date.parse('2026-10-21T16:00:00Z'),payload=JSON.parse(gunzipSync(fs.readFileSync('test/fixtures/espn-current-odds.json.gz')).toString('utf8'));
test('American odds convert exactly without treating missing or unsupported values as prices',()=>{assert.equal(decimalOdds('+150'),2.5);assert.equal(decimalOdds('-200'),1.5);assert.equal(decimalOdds('-100'),2);assert.equal(decimalOdds(null),null);assert.equal(decimalOdds('1.65'),null);});
test('current total line is never replaced with an opening price for another market',()=>{const events=parseEspnOdds(payload,{now});assert.equal(events.length,9);const como=events.find(e=>e.home==='Como');const book=Object.values(como.books)[0];assert.ok(book.odds.over35);assert.equal(book.odds.over25,undefined);assert.equal(book.odds.one.value,2.4);assert.equal(book.name,'DraftKings');});
test('live events and offers without a current price are excluded',()=>{const p=structuredClone(payload);p.events[0].competitions[0].status.type.state='in';for(const e of p.events.slice(1))for(const o of e.competitions[0].odds){o.moneyline={};o.total={over:{open:{line:'o2.5',odds:'-150'}}};}assert.equal(parseEspnOdds(p,{now}).length,0);});
