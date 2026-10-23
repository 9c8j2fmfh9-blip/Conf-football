// Per-selection minimum for the quota 10 / 100 proposals.
// Scores are exploratory model estimates, NOT validated win probabilities.
export const MULTIPLE_MINIMUM_SCORE = 70;

export function eligibleMultipleMarkets(fixture, minimumScore = MULTIPLE_MINIMUM_SCORE) {
 if (!fixture?.selection?.qualified || fixture.dataStale) return [];
 return (fixture.selection.candidates || [fixture.selection.primary]).filter(p=>
  p && p.kind !== 'corner' && p.kind !== 'diretta_stat'
  && Number.isFinite(p.score) && p.score >= minimumScore && p.score <= 100
  // In real CONF selections the observed historical frequency is available.
  // Do not override a lower recorded history with a stronger model estimate.
  && (!Number.isFinite(p.historicalScore) || p.historicalScore >= minimumScore));
}
