// Shared by server and browser: one explicit selection rule for the main card.
// This is a screening heuristic, not a calibrated prediction or value-bet model.
export function selectFixture(fixture, threshold = 60) {
  if (fixture.dataStale) return {qualified:false,primary:null,candidates:[],threshold,reason:"Dati non aggiornati: selezione sospesa."};
  const estimate = fixture.experimentalEstimate || {};
  const labels = {one:'1 · vittoria casa',draw:'X · pareggio',two:'2 · vittoria trasferta',doubleChance1X:'1X · doppia chance',doubleChanceX2:'X2 · doppia chance',doubleChance12:'12 · escluso pareggio',
    over15:'Over 1.5 FT',under15:'Under 1.5 FT',over25:'Over 2.5 FT',under25:'Under 2.5 FT',btts:'GG',noBtts:'NoGoal',over35:'Over 3.5 FT',under35:'Under 3.5 FT',
    homeScore:'Segna casa · Sì',homeNoScore:'Segna casa · No',awayScore:'Segna ospite · Sì',awayNoScore:'Segna ospite · No',homeOver15:'Casa Over 1.5 gol',awayOver15:'Ospite Over 1.5 gol',bttsOver25:'GG + Over 2.5 FT'};
  const candidates = [];
  if (estimate.available && Number(estimate.samples?.home) >= 6 && Number(estimate.samples?.away) >= 6) {
    for (const [key, label] of Object.entries(labels)) {
      const market = fixture.markets?.[key];
      const predicted = estimate.estimates?.[key];
      if (!market || market.partial || typeof predicted !== 'number' || !Number.isFinite(predicted) || predicted < threshold || predicted > 100) continue;
      const historical = market.score;
      const home = Number(market.venueSamples?.home) || 0;
      const away = Number(market.venueSamples?.away) || 0;
      const rates = market.teamRates;
      if (typeof historical !== 'number' || !Number.isFinite(historical) || historical < threshold || historical > 100 || home < 6 || away < 6) continue;
      if (!Array.isArray(rates) || rates.length !== 2 || rates.some(r => typeof r !== 'number' || !Number.isFinite(r) || r < 0.5 || r > 1)) continue;
      // Conservative score for ordering only. Use the smaller team sample,
      // since the histories can overlap and are not independent observations.
      const n = Math.min(home, away);
      const p = Math.min(predicted, historical) / 100;
      const z = 1.28;
      const evidence = (p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n);
      candidates.push({key,label,score:predicted,historicalScore:historical,samples:{home,away},evidence,
        reason:'Stima e frequenza storica ≥'+threshold+'%; almeno 6 gare per squadra; riscontro in entrambi gli storici.'});
    }
  }
  // Corner percentages are observed frequencies, independent of the goal model.
  for (const market of fixture.cornerMarkets?.markets || []) {
    const {key,label,score,sample,hits,side,venueSamples,teamRates} = market;
    if (!key?.startsWith('corners_') || !label || market.partial || !Number.isFinite(score) || score < threshold || score > 100 || !Number.isInteger(sample) || sample < 6 || !Number.isInteger(hits) || hits < 0 || hits > sample) continue;
    if (Math.round(100*hits/sample) !== score) continue;
    let n = sample;
    let samples = {[side]:sample};
    if (side === 'total') {
      const h = venueSamples?.home, a = venueSamples?.away;
      if (!Number.isInteger(h) || !Number.isInteger(a) || h < 6 || a < 6 || h+a !== sample || !Array.isArray(teamRates) || teamRates.length !== 2 || teamRates.some(r=>!Number.isFinite(r)||r<0.5||r>1)) continue;
      n = Math.min(h,a); samples = {home:h,away:a};
    } else if (!['home','away'].includes(side)) continue;
    const p = hits/sample, z = 1.28;
    const evidence = (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n);
    candidates.push({key,label,score,historicalScore:score,sample,hits,samples,evidence,kind:'corner',scoreKind:'historical',side,half:market.half||'full',line:market.line,
      reason:'Frequenza storica corner ≥'+threshold+'%; almeno 6 gare con dati corner'+(side==='total'?' per ciascuna squadra.': ' della squadra indicata.')+' Non è una probabilità prevista.'});
  }
  // Shots and other Diretta event statistics are explicitly descriptive. They
  // can be screened for data coverage, but must never be represented as a
  // calibrated probability or as a bookmaker price.
  for (const market of fixture.direttaStatMarkets?.markets || []) {
    const {key,label,score,sample,hits,venueSamples,teamRates}=market;
    const home=venueSamples?.home,away=venueSamples?.away;
    if(!key?.startsWith('diretta_')||!label||market.partial||!Number.isFinite(score)||score<threshold||score>100||
       !Number.isInteger(sample)||sample<12||!Number.isInteger(hits)||hits<0||hits>sample||home<6||away<6||
       !Array.isArray(teamRates)||teamRates.length!==2||teamRates.some(r=>!Number.isFinite(r)||r<.5||r>1)||Math.round(100*hits/sample)!==score)continue;
    const n=Math.min(home,away),p=hits/sample,z=1.28;
    const evidence=(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n);
    candidates.push({key,label,score,historicalScore:score,sample,hits,samples:{home,away},evidence,kind:'diretta_stat',scoreKind:'historical',
      metric:market.metric,line:market.line,reason:'Frequenza storica Diretta ≥'+threshold+'%; almeno 6 partite statistiche valide per ciascuna squadra. Non è una probabilità prevista e la quota può non essere disponibile.'});
  }
  candidates.sort((a,b)=>b.evidence-a.evidence || b.score-a.score || (a.kind==='corner'&&b.kind==='corner'&&a.side===b.side&&a.half===b.half ? b.line-a.line : 0) || a.key.localeCompare(b.key));
  const goalPrimary=candidates.find(p=>p.kind!=='corner'&&p.kind!=='diretta_stat')||null;
  const cornerPrimary=candidates.find(p=>p.kind==='corner')||null;
  const direttaStatPrimary=candidates.find(p=>p.kind==='diretta_stat')||null;
  const primary=goalPrimary||cornerPrimary||direttaStatPrimary;
  // Screening is allowed for research, but never equate it to a validated
  // betting recommendation. The active model explicitly reports validated:false.
  const validated=estimate.validated===true && estimate.calibration?.status==='passed';
  return {qualified:candidates.length>0, validated, bettingQualified:validated && candidates.length>0,
    primary, goalPrimary, cornerPrimary,direttaStatPrimary, candidates, threshold,
    reason:primary ? primary.reason : 'Nessun mercato soddisfa insieme soglia, campione e riscontro storico delle due squadre.',
    warning:validated?null:'Analisi esplorativa: percentuali non calibrate. Non è una raccomandazione di puntata.'};
}
