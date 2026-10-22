// Shared production calculation: audits and requests must use the same model.
export function goalEstimateFromStats(home, away) {
  if (home.sample < 6 || away.sample < 6) return { available: false, reason: 'Servono almeno 6 risultati per squadra.' };
  const shrink = (v,n) => (v*n + 1.3*6)/(n+6);
  const homeAttack = shrink(home.averageFor,home.sample);
  const awayDefense = shrink(away.averageAgainst,away.sample);
  const awayAttack = shrink(away.averageFor,away.sample);
  const homeDefense = shrink(home.averageAgainst,home.sample);
  const h = Math.max(0.15,Math.min(4,Math.sqrt(homeAttack*awayDefense)));
  const a = Math.max(0.15,Math.min(4,Math.sqrt(awayAttack*homeDefense)));
  const poisson = (lambda,k) => {
    let f=1; for(let i=2;i<=k;i++)f*=i;
    return Math.exp(-lambda)*Math.pow(lambda,k)/f;
  };
  let one=0,draw=0,two=0,over15=0,over25=0,gg=0,over35=0,bttsOver25=0;
  let homeScore=0,awayScore=0,homeOver15=0,awayOver15=0;
  for(let i=0;i<=15;i++)for(let j=0;j<=15;j++){
    const p=poisson(h,i)*poisson(a,j);
    if(i>j)one+=p;else if(i===j)draw+=p;else two+=p;
    if(i+j>1)over15+=p;
    if(i+j>2)over25+=p;
    if(i+j>3)over35+=p;
    if(i>0&&j>0)gg+=p;
    if(i>0&&j>0&&i+j>2)bttsOver25+=p;
    if(i>0)homeScore+=p;
    if(j>0)awayScore+=p;
    if(i>1)homeOver15+=p;
    if(j>1)awayOver15+=p;
  }
  // Team-goal combinations use the JOINT score distribution, not an unjustified
  // multiplication of two rounded market percentages.
  const combos=[];
  for(const homeMin of [1,2,3]) for(const awayMin of [1,2,3]) {
    let probability=0;
    for(let i=homeMin;i<=15;i++) for(let j=awayMin;j<=15;j++)
      probability+=poisson(h,i)*poisson(a,j);
    combos.push({homeOver:(homeMin-0.5).toFixed(1),awayOver:(awayMin-0.5).toFixed(1),
      score:Math.round(probability*100),homeMin,awayMin});
  }
  combos.sort((a,b)=>b.score-a.score || (b.homeMin+b.awayMin)-(a.homeMin+a.awayMin));
  const pct=x=>Math.round(x*100);
  return { available:true, validated:false, model:'Poisson sperimentale con medie gol corrette per piccolo campione', expectedGoals:{home:Number(h.toFixed(2)),away:Number(a.toFixed(2))}, teamGoalCombos:combos, estimates:{
    one:pct(one),draw:pct(draw),two:pct(two),doubleChance1X:pct(one+draw),doubleChanceX2:pct(draw+two),doubleChance12:pct(one+two),
    over15:pct(over15),under15:pct(1-over15),over25:pct(over25),under25:pct(1-over25),btts:pct(gg),noBtts:pct(1-gg),
    over35:pct(over35),under35:pct(1-over35),bttsOver25:pct(bttsOver25),homeScore:pct(homeScore),homeNoScore:pct(1-homeScore),
    awayScore:pct(awayScore),awayNoScore:pct(1-awayScore),homeOver15:pct(homeOver15),awayOver15:pct(awayOver15)
  }, samples:{home:home.sample,away:away.sample}, warning:'STIMA NON VALIDATA. Non tiene conto della forza degli avversari, indisponibili o xG. Non usare come probabilità affidabile o consiglio di scommessa.' };
}
