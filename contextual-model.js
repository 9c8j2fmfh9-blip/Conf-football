// Prespecified candidate: recent form with venue blending. No motivation multiplier.
export function contextualForecast(history,home,away){
 const recent=t=>history.filter(r=>r[1]===t||r[2]===t).slice(-10);
 const h=recent(home),a=recent(away);if(h.length<6||a.length<6)return null;
 const mean=(games,t,against=false)=>{let sum=0,weight=0;[...games].reverse().forEach((r,i)=>{const w=.9**i;sum+=w*Number(r[(r[1]===t)!==against?3:4]);weight+=w;});return sum/weight;};
 const rate=(all,t,isHome,against)=>{const venue=all.filter(r=>isHome?r[1]===t:r[2]===t);const base=mean(all,t,against);const blend=venue.length>=3?venue.length/(venue.length+6):0;const observed=(1-blend)*base+(blend?blend*mean(venue,t,against):0);return (observed*all.length+1.3*6)/(all.length+6);};
 const hGoal=Math.sqrt(rate(h,home,true,false)*rate(a,away,false,true)),aGoal=Math.sqrt(rate(a,away,false,false)*rate(h,home,true,true));
 const sum=hGoal+aGoal;return {over25:1-Math.exp(-sum)*(1+sum+sum*sum/2),btts:(1-Math.exp(-hGoal))*(1-Math.exp(-aGoal))};
}
