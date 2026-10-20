import 'dotenv/config';
import express from 'express';
import {readFileSync} from 'node:fs';
import {LEAGUES,norm,romeDate,seasonStart,safeHistory,selectUpcoming,buildCornerMarkets,createDataClient} from './free-data.js';
import {forecast,report} from './reliability.js';
const archive=JSON.parse(readFileSync(new URL('./openfootball-benchmark.json',import.meta.url)));
const benchmarkRows=archive.leagues;
export function createApp(client=createDataClient(),clock=()=>Date.now()){
 const app=express(),fixtures=new Map(),histories=new Map(); let lastCatalog=null;
 app.disable('x-powered-by');
 app.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');next();});
 app.get('/',(_req,res)=>res.sendFile(new URL('./index.html',import.meta.url).pathname));
 app.get('/api/health',(_req,res)=>res.json({ok:true,app:'CONF Football',version:'0.5.0',mode:'free',paidProviders:false}));
 app.get('/api/leagues',(_req,res)=>res.json({leagues:LEAGUES}));
 app.get('/api/conf-backtest',(_req,res)=>res.json({...report(benchmarkRows,clock()),source:archive.source,license:archive.license,retrievedAt:archive.retrievedAt,season:archive.season,usage:'Stagione precedente usata solo per test retrospettivo del modello. Le previsioni correnti usano solo la stagione in corso.'}));
 const toRows=games=>games.map(g=>[g.date.slice(0,10),g.homeId,g.awayId,g.homeGoals,g.awayGoals]);
 const unique=games=>[...new Map(games.map(g=>[g.id,g])).values()];
 async function catalog(date){
  const now=clock();
  if(lastCatalog&&lastCatalog.date===date&&now-lastCatalog.at<5*60000)return lastCatalog;
  const end=new Date(date+'T12:00Z');end.setUTCDate(end.getUTCDate()+1);
  const dates=date.replaceAll('-','')+'-'+end.toISOString().slice(0,10).replaceAll('-','');
  const results=await Promise.allSettled(LEAGUES.map(l=>client.calendar(l,dates)));
  const warnings=[];const games=[];
  results.forEach((r,i)=>r.status==='fulfilled'?games.push(...r.value):warnings.push(LEAGUES[i].name+': '+r.reason.message));
  lastCatalog={date,at:now,games:unique(games),warnings,available:results.filter(r=>r.status==='fulfilled').length};return lastCatalog;
 }
 const history=async(f,team)=>{
  const id=team==='home'?f.homeId:f.awayId,key=f.leagueId+':'+id+':'+seasonStart(clock());
  const old=histories.get(key);if(old&&clock()-old.at<3600000)return old.games;
  const league=LEAGUES.find(l=>l.id===f.leagueId);
  // Cross-competition schedule gives current-season domestic form for European fixtures.
  const games=await client.teamHistory(league,id,seasonStart(clock()));
  const seasonCut=Date.parse(seasonStart(clock())+'-07-01T00:00:00Z');
  const valid=safeHistory(games,Math.min(clock(),f.stamp)).filter(g=>g.stamp>=seasonCut);histories.set(key,{games:valid,at:clock()});
  return valid;
 };
 app.get('/api/conf',async(req,res)=>{
  try{
   const now=clock(),hours=[3,12,24].includes(Number(req.query.hours))?Number(req.query.hours):24;
   const query=String(req.query.q||'').trim().slice(0,100),date=String(req.query.date||'');
   if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))))return res.status(400).json({error:'Data non valida.'});
   const explicit=date||'',baseDate=date||romeDate(now);
   const cat=await catalog(baseDate);
   if(!cat.available)return res.status(502).json({error:'Nessuna fonte calendario disponibile. Riprova tra qualche minuto.',warnings:cat.warnings});
   const found=selectUpcoming(cat.games,{now,hours,date:explicit,query});
   const warnings=[...cat.warnings];
   // All discovered fixtures are analyzed before the display limit.
   const analyzed=await Promise.all(found.map(async f=>{
    fixtures.set(f.id,f);
    const results=await Promise.allSettled([history(f,'home'),history(f,'away')]);
    const hh=results[0].status==='fulfilled'?results[0].value:[],aa=results[1].status==='fulfilled'?results[1].value:[];
    const home=safeHistory(hh,Math.min(now,f.stamp)).slice(-10),away=safeHistory(aa,Math.min(now,f.stamp)).slice(-10);
    const prediction=forecast(toRows(unique([...home,...away])).sort((a,b)=>a[0].localeCompare(b[0])),f.homeId,f.awayId);
    const combined=unique([...home,...away]);
    const freq=(label,fn)=>{const hits=combined.filter(fn).length;return {label,hits,sample:combined.length,score:combined.length?Math.round(100*hits/combined.length):null,partial:!home.length||!away.length};};
    const markets={over25:freq('Over 2.5',g=>g.homeGoals+g.awayGoals>=3),btts:freq('GG',g=>g.homeGoals>0&&g.awayGoals>0)};
    const estimates=prediction?Object.fromEntries(Object.entries(prediction).map(([k,v])=>[k,Math.round(v*100)])):null;
    const best=estimates?Object.entries(estimates).sort((a,b)=>b[1]-a[1])[0]:null;
    return {...f,markets,estimate:estimates,samples:{home:home.length,away:away.length},recommendation:best?{market:best[0],score:best[1],qualified:prediction[best[0]]>=0.7,validated:false}:null,
     dataWarning:results.some(r=>r.status==='rejected')?'Storico parzialmente non disponibile.':null,cornerMarkets:null};
   }));
   analyzed.sort((a,b)=>(b.recommendation?.score??-1)-(a.recommendation?.score??-1)||a.stamp-b.stamp);
   const limit=Math.min(100,Math.max(20,Number(req.query.limit)||30));
   res.json({fixtures:analyzed.slice(0,limit),analyzedCount:analyzed.length,discoveredCount:cat.games.length,returned:Math.min(limit,analyzed.length),hours,date:explicit,query,warnings,coverage:{available:cat.available,total:LEAGUES.length,partial:cat.available<LEAGUES.length},mode:'free',updatedAt:new Date(now).toISOString(),note:'Dati pubblici gratuiti; copertura limitata alle competizioni elencate. Stime sperimentali, frequenze storiche separate dalle previsioni.'});
  }catch(e){res.status(502).json({error:'Dati gratuiti temporaneamente non disponibili. '+e.message});}
 });
 app.get('/api/corners',async(req,res)=>{
  try{
   const f=fixtures.get(String(req.query.fixture||''));if(!f)return res.status(404).json({error:'Ricarica prima l’elenco delle partite.'});
   if(f.stamp<=clock())return res.status(409).json({error:'Partita già iniziata.'});
   const [home,away]=await Promise.all([history(f,'home'),history(f,'away')]);
   const [h,a]=await Promise.all([client.corners(safeHistory(home,Math.min(clock(),f.stamp)),f.homeId),client.corners(safeHistory(away,Math.min(clock(),f.stamp)),f.awayId)]);
   res.json(buildCornerMarkets(f.home,f.away,h,a));
  }catch(e){res.status(502).json({error:'Corner non disponibili: '+e.message});}
 });
 return app;
}
export const app=createApp();
if(process.env.NODE_ENV!=='test')app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('CONF Football 0.5 · fonti gratuite'));
