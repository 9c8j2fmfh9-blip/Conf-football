process.env.NODE_ENV='test';
const {app}=await import('../server.js');
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{
 const start=Date.now();
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/conf?hours=24&limit=30`);
 const d=await response.json();
 const fs=await import('node:fs');fs.writeFileSync('/tmp/conf-free-live.json',JSON.stringify(d));
 const f=d.fixtures?.[0];const corners=f?await (await fetch(`http://127.0.0.1:${server.address().port}/api/corners?fixture=${f.id}`)).json():null;
 console.log(JSON.stringify({seconds:(Date.now()-start)/1000,status:response.status,analyzed:d.analyzedCount,coverage:d.coverage,warnings:d.warnings,top:f?{home:f.home,away:f.away,estimate:f.estimate}:null,corners}));
}finally{server.closeAllConnections();server.close();}
