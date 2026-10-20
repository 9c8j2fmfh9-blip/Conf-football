import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fixture={id:'abc',date:'2026-10-20T19:00Z',home:'A <script>bad()</script>',away:'B',league:'Test',country:'Italy',sourceUrl:'https://www.espn.com/soccer/match/_/gameId/123',samples:{home:10,away:10},markets:{over25:{score:80,hits:16,sample:20},btts:{score:65,hits:13,sample:20}},estimate:{over25:65,btts:60},context:{home:{recent:{sample:5,results:['V','N'],points:8},venue:{sample:4,points:7,goalsFor:6,goalsAgainst:3},venueLabel:'in casa',table:{available:true,rank:14,points:12,played:10,zone:'',boundary:null},daysSinceLast:3},away:{recent:{sample:5,results:['N','P'],points:3},venue:{sample:4,points:2,goalsFor:3,goalsAgainst:7},venueLabel:'in trasferta',table:{available:false},daysSinceLast:4},warning:'Nessuna maggiorazione per motivazione'},recommendation:{market:'over25',score:65,qualified:false}};
const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI did not settle');};
test('UI renders cards, keeps historical frequencies separate, filters and persists favorites',async()=>{
 const requests=[];const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',beforeParse(w){
  w.fetch=async url=>{requests.push(String(url));return {ok:true,json:async()=>String(url).includes('/api/corners')?{markets:[],homeSample:0,awaySample:0,note:'No fabricated data'}:{fixtures:[fixture],analyzedCount:1,returned:1,coverage:{available:25,total:25},warnings:[],updatedAt:'2026-10-20T12:00Z'}};};
 }});
 try{
  const d=dom.window.document;await waitFor(()=>d.querySelector('.card'));
  assert.equal(d.querySelectorAll('.card').length,1);assert.ok(d.querySelector('.card').textContent.includes('14ª'));assert.ok(d.querySelector('.card').textContent.includes('Forma casa/trasferta'));
  const card=d.querySelector('.card'),details=card.querySelector('details');
  assert.equal(details.open,false);assert.equal(details.querySelector('summary').textContent,'Dettagli');
  assert.ok(details.querySelector('.pick').textContent.includes('65%'));
  assert.ok(details.contains(card.querySelector('.statistics')));
  const visibleText=[...card.children].filter(el=>el!==details).map(el=>el.textContent).join(' ');
  assert.ok(visibleText.includes('Scommessa suggerita'));assert.ok(visibleText.includes('Over 2.5'));
  assert.ok(!/65%|Forma|14ª|punti/.test(visibleText));
  details.open=true;assert.ok(details.textContent.includes('14ª'));assert.ok(details.textContent.includes('16 su 20'));
  details.open=false;assert.equal(d.querySelector('[data-load-corners]'),null);
  assert.ok([...d.querySelectorAll('.row')].some(row=>row.textContent.includes('16 su 20')));
  assert.equal(d.querySelector('.teams script'),null);
  d.querySelector('[data-favorite]').click();assert.ok(dom.window.localStorage.getItem('conf-favorites-v05').includes('abc'));
  d.getElementById('threshold').checked=true;d.getElementById('threshold').dispatchEvent(new dom.window.Event('change'));
  assert.equal(d.querySelectorAll('.card').length,0);assert.ok(d.querySelector('.empty').textContent.includes('Disattiva'));
  d.getElementById('query').value='Juventus';d.getElementById('date').value='2026-10-21';d.getElementById('search-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await waitFor(()=>requests.some(x=>x.includes('q=Juventus')&&x.includes('date=2026-10-21')));
 }finally{dom.window.close();}
});
test('automatic selection list shows goal evidence and stronger historical corner line',async()=>{
 const f={...fixture,home:'A',learnedSelection:{available:true,probability:.72,score:72,validation:{thresholdHits:16,thresholdSample:17}},recommendation:{market:'over25',score:72,qualified:true}};
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'dangerously',beforeParse(w){
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.fetch=async url=>({ok:true,json:async()=>String(url).includes('corners')?{markets:[{label:'A · Over 1.5 corner FT',score:100,hits:8,sample:8,evidence:{eligible:true,lower:75}},{label:'A · Over 2.5 corner FT',score:100,hits:8,sample:8,evidence:{eligible:true,lower:75}}],homeSample:8,awaySample:8,note:'Storico'}:{fixtures:[f],analyzedCount:1,returned:1,coverage:{available:25,total:25},warnings:[],updatedAt:'2026-10-20T12:00Z'}});
 }});
 try{
  const d=dom.window.document;await waitFor(()=>d.getElementById('selection-list').textContent.includes('Over 2.5 corner'));
  assert.ok(d.getElementById('selection-list').textContent.includes('16/17'));
  assert.ok(!d.getElementById('selection-list').textContent.includes('Over 1.5 corner'));
  d.getElementById('favorites').checked=true;d.getElementById('favorites').dispatchEvent(new dom.window.Event('change'));
  assert.equal(d.querySelectorAll('.card').length,0);d.querySelector('[data-open-pick]').click();assert.equal(d.querySelectorAll('.card').length,1);
 }finally{dom.window.close();}
});
