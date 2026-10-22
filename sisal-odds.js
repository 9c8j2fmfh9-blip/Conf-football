import {readFileSync,writeFileSync,renameSync} from 'node:fs';
export const SISAL_URL='https://landing.sisal.it/volantini/Scommesse_Sport/Quote/calcio%20base%20per%20data.pdf';
export const SISAL_COMBINED_URL='https://landing.sisal.it/volantini/Scommesse_Sport/Quote/calcio%20combinate.pdf';
const cachePath=new URL('./sisal-odds-cache.json',import.meta.url);
const MAX_AGE=6*3600000,REFRESH_MS=10*60000;
let cached=null,inflight=null,nextAttempt=0;
// A verified, timestamped bootstrap survives deployments; runtime updates
// supersede each individual sheet only when their publication is newer.
function newerSheet(a,b){const x=Date.parse(a?.sourceUpdatedAt),y=Date.parse(b?.sourceUpdatedAt);return Number.isFinite(y)&&(!Number.isFinite(x)||y>x)?b:a||b||null;}
for(const path of [new URL('./sisal-odds-snapshot.json',import.meta.url),...(process.env.NODE_ENV==='test'?[]:[cachePath])])try{
 const value=JSON.parse(readFileSync(path,'utf8'));
 const base=newerSheet(cached,value),combined=newerSheet(cached?.combined,value.combined);
 cached=base?{...base,combined}:combined?{entries:[],combined}:null;
}catch{}
const refreshState={base:{},combined:{}};
function fresh(sheet,now){const stamp=Date.parse(sheet?.sourceUpdatedAt);return Number.isFinite(stamp)&&now-stamp<=MAX_AGE&&stamp<=now+5*60000&&Array.isArray(sheet.entries)&&sheet.entries.length>0;}
export function sisalOddsStatus({now=Date.now()}={}){
 return {refreshing:!!inflight,base:{...refreshState.base,available:fresh(cached,now),sourceUpdatedAt:cached?.sourceUpdatedAt||null},combined:{...refreshState.combined,available:fresh(cached?.combined,now),sourceUpdatedAt:cached?.combined?.sourceUpdatedAt||null},retryAfterMs:Math.max(0,nextAttempt-now)};
}
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// Only explicit, verified bookmaker spellings. No approximate team matching.
const aliases={betis:'real betis',lipsia:'rb leipzig',leipzig:'rb leipzig','bayern monaco':'bayern munich','bayern munchen':'bayern munich','fc bayern munchen':'bayern munich',
 lilla:'lille','losc lille':'lille','rc lens':'lens','club bruges':'club brugge','man utd':'manchester united','man city':'manchester city',
 inter:'internazionale','inter milano':'internazionale',shakhtar:'shakhtar donetsk','sporting cp':'sporting lisbon',
 'sporting lisbona':'sporting lisbon',sporting:'sporting lisbon','lask linz':'lask','rb lipsia':'rb leipzig',
 'viking fk':'viking','b dortmund':'borussia dortmund','atleti':'atletico madrid',paris:'paris saint germain','psg':'paris saint germain','vfb stuttgart':'stuttgart'};
const team=x=>aliases[norm(x)]||norm(x);
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'});
const clockFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function italianTimestamp(date,time){
 const [d,m,y]=date.split('/').map(Number);const [h,min,sec=0]=time.split(':').map(Number);
 const noon=new Date(Date.UTC(y,m-1,d,12));const localNoon=Number(clockFormatter.format(noon).slice(0,2));
 return new Date(Date.UTC(y,m-1,d,h-(localNoon-12),min,sec)).toISOString();
}
function groupedRows(items,tolerance=1){
 const rows=[];
 for(const item of items.filter(x=>x.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){
  let row=rows.find(r=>Math.abs(r.y-item.transform[5])<tolerance);
  if(!row){row={y:item.transform[5],items:[]};rows.push(row);}row.items.push(item);
 }
 return rows.sort((a,b)=>b.y-a.y).map(r=>({...r,items:r.items.sort((a,b)=>a.transform[4]-b.transform[4])}));
}
const center=i=>i.transform[4]+i.width/2;
// PDF text runs can contain several odds. Font digits are tabular; punctuation
// and spaces are half-width. Recover the individual printed cell centres.
function decimalTokens(item){
 const text=item.str; if(!/^[\d,.\s]+$/.test(text))return[];
 const weight=s=>[...s].reduce((n,c)=>n+(/[0-9]/.test(c)?1:.5),0);
 const total=weight(text);if(!total)return[];
 return [...text.matchAll(/\d{1,4}(?:[,.]\d{1,2})?/g)].map(m=>({
  value:Number(m[0].replace(',','.')),
  x:item.transform[4]+item.width*(weight(text.slice(0,m.index))+weight(m[0])/2)/total
 })).filter(x=>x.value>1&&x.value<=1000);
}
function columnsFor(items,height){
 const top=items.filter(i=>i.transform[5]>height*.88);
 const heading=top.find(i=>i.str==='Esito Finale');
 const line25=top.find(i=>i.str==='2,5');
 const line35=top.find(i=>i.str==='3,5');
 const first=top.find(i=>i.str==='Squadra 1'),second=top.find(i=>i.str==='Squadra 2');
 const goal=top.find(i=>i.str==='Goal'),noGoal=top.find(i=>i.str==='NoGoal');
 const line15=top.find(i=>i.str==='1,5'),doubleChance=top.find(i=>i.str==='1X X2 12');
 const home=top.find(i=>i.str==='Casa'),away=top.find(i=>i.str==='Ospite');
 if(!heading||!line15||!line25||!line35||!first||!second||!goal||!noGoal||!doubleChance||!home||!away)throw Error('Formato foglio Sisal non riconosciuto');
 const label=(text,predicate)=>{const found=top.filter(i=>i.str===text&&predicate(i));if(found.length!==1)throw Error('Colonna Sisal ambigua: '+text);return center(found[0]);};
 const x1=heading.transform[4],x2=x1+heading.width;
 return {home:first.transform[4],away:second.transform[4],firstOdds:x1-4,
  one:label('1',i=>center(i)>=x1&&center(i)<=x2&&i.transform[5]<heading.transform[5]),
  draw:label('X',i=>center(i)>=x1&&center(i)<=x2&&i.transform[5]<heading.transform[5]),
  two:label('2',i=>center(i)>=x1&&center(i)<=x2&&i.transform[5]<heading.transform[5]),
  doubleChance1X:doubleChance.transform[4]+5,doubleChanceX2:doubleChance.transform[4]+20,doubleChance12:doubleChance.transform[4]+35,
  under15:label('U',i=>center(i)<center(line15)&&center(i)>center(line15)-12&&i.transform[5]<line15.transform[5]),
  over15:label('O',i=>center(i)>center(line15)&&center(i)<center(line15)+12&&i.transform[5]<line15.transform[5]),
  under25:label('U',i=>center(i)<center(line25)&&center(i)>center(line25)-12&&i.transform[5]<line25.transform[5]),
  over25:label('O',i=>center(i)>center(line25)&&center(i)<center(line25)+12&&i.transform[5]<line25.transform[5]),
  under35:label('U',i=>center(i)<center(line35)&&center(i)>center(line35)-12&&i.transform[5]<line35.transform[5]),
  over35:label('O',i=>center(i)>center(line35)&&center(i)<center(line35)+12&&i.transform[5]<line35.transform[5]),
  btts:label('G',i=>center(i)>=Math.min(goal.transform[4],noGoal.transform[4])&&center(i)<=noGoal.transform[4]+noGoal.width),
  noBtts:label('NG',i=>center(i)>=Math.min(goal.transform[4],noGoal.transform[4])&&center(i)<=noGoal.transform[4]+noGoal.width),
  homeScore:label('SI',i=>i.transform[4]>home.transform[4]-8&&i.transform[4]<home.transform[4]+8),
  homeNoScore:label('NO',i=>i.transform[4]>home.transform[4]&&i.transform[4]<away.transform[4]-8),
  awayScore:label('SI',i=>i.transform[4]>away.transform[4]&&i.transform[4]<away.transform[4]+8),
  awayNoScore:label('NO',i=>i.transform[4]>away.transform[4]+8)};
}
function combinedColumns(items,height){
 const top=items.filter(i=>i.transform[5]>height*.84);
 const heading=top.find(i=>i.str==='G/NG + U/O2,5');
 const first=top.find(i=>i.str==='Squadra 1'),second=top.find(i=>i.str==='Squadra 2');
 if(!heading||!first||!second)throw Error('Formato combinate Sisal non riconosciuto');
 const group=top.filter(i=>i.str==='G'&&i.transform[4]>=heading.transform[4]&&center(i)<center(heading)&&i.transform[5]<heading.transform[5]);
 if(group.length!==1)throw Error('Gruppo Goal ambiguo');
 const overs=top.filter(i=>i.str==='O'&&center(i)>center(group[0])&&center(i)<center(group[0])+12&&i.transform[5]<group[0].transform[5]);
 if(overs.length!==1)throw Error('Colonna Goal + Over 2.5 ambigua');
 const firstMarket=top.find(i=>i.str==='1X2 Finale + U/O 1,5');
 if(!firstMarket)throw Error('Prima colonna combinate non riconosciuta');
 return{home:first.transform[4],away:second.transform[4],firstOdds:firstMarket.transform[4]-8,bttsOver25:center(overs[0])};
}
const months=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
export function parseSisalPages(pages,{now=Date.now(),kind='base'}={}){
 const stamps=pages.flatMap(p=>p.items.map(i=>i.str).filter(s=>s.includes('Dati aggiornati al')));
 const stamp=stamps[0]?.match(/Dati aggiornati al (\d{2}\/\d{2}\/\d{4})\s*-\s*ore (\d{2}:\d{2}:\d{2})/);
 if(!stamp||stamps.some(s=>s!==stamps[0]))throw Error('Data del foglio Sisal mancante o incoerente');
 const sourceUpdatedAt=italianTimestamp(stamp[1],stamp[2]);
 if(Date.parse(sourceUpdatedAt)>now+5*60000)throw Error('Data futura del foglio Sisal');
 const [publishedDay,publishedMonth,publishedYear]=stamp[1].split('/').map(Number);
 const reference=Date.UTC(publishedYear,publishedMonth-1,publishedDay);
 let date=null;const entries=[];
 for(const page of pages){
  const columns=kind==='combined'?combinedColumns(page.items,page.height):columnsFor(page.items,page.height);
  for(const row of groupedRows(page.items,kind==='combined'?3:1)){
   const dateText=row.items.map(x=>x.str).join(' ');const heading=dateText.match(/(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica),?\s+(\d{1,2})\s+([a-z]+)/i)||norm(dateText).match(/(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\s+(\d{1,2})\s+([a-z]+)/);
   if(heading){
    const month=months.indexOf(heading[2].toLowerCase());if(month<0)throw Error('Mese del foglio Sisal non valido');
    const possible=[publishedYear-1,publishedYear,publishedYear+1].map(y=>Date.UTC(y,month,Number(heading[1]))).filter(t=>t>=reference-86400000&&t<=reference+32*86400000);
    if(possible.length!==1)throw Error('Giorno del foglio Sisal ambiguo');date=new Date(possible[0]).toISOString().slice(0,10);continue;
   }
   if(!date||row.y>page.height*.89||row.y<30)continue;
   const timeItem=row.items.find(i=>i.transform[4]<columns.home*.32&&/^\d{2}\.\d{2}$/.test(i.str));if(!timeItem)continue;
   const clock=timeItem.str.replace('.',':');
   const home=row.items.filter(i=>i.transform[4]>=columns.home-1&&i.transform[4]<columns.away-1).map(i=>i.str).join(' ').trim();
   const away=row.items.filter(i=>i.transform[4]>=columns.away-1&&i.transform[4]<columns.firstOdds).map(i=>i.str).join(' ').trim();
   if(!home||!away)continue;
   const tokens=row.items.flatMap(decimalTokens);const odds={};
   for(const key of kind==='combined'?['bttsOver25']:['one','draw','two','doubleChance1X','doubleChanceX2','doubleChance12','under15','over15','under25','over25','under35','over35','btts','noBtts','homeScore','homeNoScore','awayScore','awayNoScore']){
    const candidates=tokens.filter(t=>Math.abs(t.x-columns[key])<3.4);
    if(candidates.length===1)odds[key]=candidates[0].value;
   }
   // Reject rows if the expected basic 1X2 cells were not decoded. Never shift
   // later columns to fill blanks or accidentally use handicap / youth odds.
   if(kind==='combined'?!odds.bttsOver25:(!odds.one||!odds.draw||!odds.two))continue;
   const competitionCode=row.items.find(i=>i.transform[4]>31&&i.transform[4]<64&&/^[A-Z][A-Z0-9]+$/.test(i.str))?.str||'';
   entries.push({date,time:clock,home,away,competitionCode,odds});
  }
 }
 if(!entries.length)throw Error('Nessuna quota Sisal leggibile');
 return{sourceUrl:kind==='combined'?SISAL_COMBINED_URL:SISAL_URL,sourceUpdatedAt,fetchedAt:new Date(now).toISOString(),entries};
}
export async function parseSisalPdf(bytes,options={}){
 const {getDocument,Util}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
 try{const doc=await task.promise;if(doc.numPages>50)throw Error('Foglio Sisal troppo grande');const pages=[];
  for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const {items}=await page.getTextContent();const viewport=page.getViewport({scale:1});pages.push({height:viewport.height,items:items.map(i=>{const t=Util.transform(viewport.transform,i.transform);return{str:i.str||'',transform:[t[0],t[1],t[2],t[3],t[4],viewport.height-t[5]],width:i.width||0}})});page.cleanup();}
  return parseSisalPages(pages,options);
 }finally{await task.destroy();}
}
export async function getSisalOdds({now=Date.now(),fetcher=fetch,waitForRefresh=false}={}){
 const usable=fresh(cached,now)||fresh(cached?.combined,now);
 if(inflight)return usable&&!waitForRefresh?cached:inflight;
 if(now<nextAttempt)return cached;
 nextAttempt=now+REFRESH_MS;
 inflight=(async()=>{
  const readSheet=async(url,kind,previous)=>{try{
   refreshState[kind==='base'?'base':'combined']={attemptedAt:new Date(now).toISOString()};
   const response=await fetcher(url,{signal:AbortSignal.timeout(30000),headers:{Accept:'application/pdf'}});
   if(!response.ok)throw Error('Sisal HTTP '+response.status);
   if(Number(response.headers?.get('content-length')||0)>8*1024*1024)throw Error('PDF troppo grande');
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>8*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Risposta non PDF');
   const result=await parseSisalPdf(bytes,{now,kind});
   refreshState[kind==='base'?'base':'combined'].updatedAt=new Date().toISOString();
   return newerSheet(previous,result);
  }catch(error){
   refreshState[kind==='base'?'base':'combined'].error=error.name==='TimeoutError'||error.name==='AbortError'?'Download Sisal oltre il tempo massimo':String(error.message||'Aggiornamento Sisal fallito').slice(0,160);
   nextAttempt=now+30000;return previous;
  }};
  const [base,combined]=await Promise.all([readSheet(SISAL_URL,'base',cached),readSheet(SISAL_COMBINED_URL,'combined',cached?.combined)]);
  cached=base?{...base,combined}:combined?{entries:[],combined}:null;
  if(cached&&process.env.NODE_ENV!=='test')try{const temp=new URL('./sisal-odds-cache.tmp',import.meta.url);writeFileSync(temp,JSON.stringify(cached));renameSync(temp,cachePath);}catch{}
  return cached;
 })().finally(()=>{inflight=null;});return usable&&!waitForRefresh?cached:inflight;
}
export function matchProposalOdds(fixture,sheet,{now=Date.now()}={}){
 const missing=reason=>({available:false,reason});
 const result={sisal:missing('Quota non disponibile'),bet365:missing('Collegamento automatico Bet365 non disponibile')};
 const key=fixture.selection?.primary?.key;if(!key)return result;
 if(key==='bttsOver25')sheet=sheet?.combined;
 if(!sheet){result.sisal=missing('Foglio Sisal momentaneamente non disponibile');return result;}
 const stamp=Date.parse(sheet.sourceUpdatedAt);
 if(!Number.isFinite(stamp)||now-stamp>MAX_AGE||stamp>now+5*60000){result.sisal=missing('Foglio quote non aggiornato');return result;}
 const date=dayFormatter.format(new Date(fixture.date)),time=clockFormatter.format(new Date(fixture.date));
 const matches=sheet.entries.filter(e=>!/(U19|U20|UYL)/.test(e.competitionCode||'')&&(!/champions league/i.test(fixture.league||'')||e.competitionCode==='EUCHL')&&e.date===date&&e.time===time&&team(e.home)===team(fixture.home)&&team(e.away)===team(fixture.away));
 if(matches.length!==1){result.sisal=missing(matches.length?'Abbinamento quote ambiguo':'Quota non trovata nel foglio ufficiale');return result;}
 const value=matches[0].odds[key];if(typeof value!=='number'||!Number.isFinite(value)||value<=1)return result;
 result.sisal={available:true,value,market:key,sourceUpdatedAt:sheet.sourceUpdatedAt,fetchedAt:sheet.fetchedAt,sourceUrl:sheet.sourceUrl||SISAL_URL,live:false};return result;
}
