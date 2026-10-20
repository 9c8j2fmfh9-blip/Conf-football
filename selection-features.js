// Shared by the offline trainer and live Node inference. No match outcome or future table is a feature.
export const FEATURE_NAMES=['homeGF','homeGA','awayGF','awayGA','homeOver','awayOver','homeGG','awayGG','homePPG','awayPPG','homeVenueGF','homeVenueGA','awayVenueGF','awayVenueGA','homeVenueOver','awayVenueOver','homeVenueGG','awayVenueGG','homeRecentGF','homeRecentGA','awayRecentGF','awayRecentGA','homeSample','awaySample','goalTotalMean','goalDifference','overMean','ggMean'];
const avg=(r,fn)=>r.reduce((s,g)=>s+fn(g),0)/r.length;
export function selectionFeatures(history,home,away){
 const h=history.filter(r=>r[1]===home||r[2]===home).slice(-10),a=history.filter(r=>r[1]===away||r[2]===away).slice(-10);
 if(h.length<6||a.length<6)return null;
 const metrics=(r,t)=>{const gf=g=>Number(g[g[1]===t?3:4]),ga=g=>Number(g[g[1]===t?4:3]);return [avg(r,gf),avg(r,ga),avg(r,g=>Number(Number(g[3])+Number(g[4])>=3)),avg(r,g=>Number(Number(g[3])>0&&Number(g[4])>0)),avg(r,g=>gf(g)>ga(g)?3:gf(g)===ga(g)?1:0)];};
 const hm=metrics(h,home),am=metrics(a,away),hv=h.filter(r=>r[1]===home),av=a.filter(r=>r[2]===away);
 const venue=(rows,t,base)=>{if(!rows.length)return base;const m=metrics(rows,t),w=rows.length/(rows.length+4);return m.map((x,i)=>w*x+(1-w)*base[i]);};
 const hvm=venue(hv,home,hm),avm=venue(av,away,am),hr=metrics(h.slice(-5),home),ar=metrics(a.slice(-5),away);
 return [hm[0],hm[1],am[0],am[1],hm[2],am[2],hm[3],am[3],hm[4],am[4],hvm[0],hvm[1],avm[0],avm[1],hvm[2],avm[2],hvm[3],avm[3],hr[0],hr[1],ar[0],ar[1],h.length,a.length,(hm[0]+hm[1]+am[0]+am[1])/2,Math.abs(hm[4]-am[4]),(hm[2]+am[2])/2,(hm[3]+am[3])/2];
}
