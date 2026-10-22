import test from 'node:test';import assert from 'node:assert/strict';
import {modelFingerprint} from '../model-revision.js';
test('model fingerprint tracks calculation sources independently from deployment identifiers',()=>{
 const parts=['goal calculation','historical lookup','selection'];
 assert.equal(modelFingerprint(parts),modelFingerprint(parts.slice()));
 assert.notEqual(modelFingerprint(parts),modelFingerprint(['new calculation',...parts.slice(1)]));
 assert.match(modelFingerprint(parts),/^[a-f0-9]{64}$/);
});
