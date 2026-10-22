import {createHash} from 'node:crypto';
export function modelFingerprint(parts){
 return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
