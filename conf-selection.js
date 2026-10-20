// Shared by server and browser: one explicit selection rule for the main card.
// This is a screening heuristic, not a calibrated prediction or value-bet model.
export function selectFixture(fixture, threshold = 60) {
  const estimate = fixture.experimentalEstimate || {};
  const labels = {one:'1 · vittoria casa', draw:'X · pareggio', two:'2 · vittoria trasferta', over25:'Over 2.5 FT', btts:'GG'};
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
  candidates.sort((a,b)=>b.evidence-a.evidence || b.score-a.score || a.key.localeCompare(b.key));
  return {qualified:candidates.length>0, primary:candidates[0] || null, candidates, threshold,
    reason:candidates.length ? candidates[0].reason : 'Nessun mercato soddisfa insieme soglia, campione e riscontro storico delle due squadre.'};
}
