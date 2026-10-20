// Safe standalone comparison probe. NOT imported by server.js.
// Usage: node experiments/probe-external-model.mjs
// Does not change CONF or use bookmaker credentials.
const endpoint = 'https://football-predictor-api-2wwd.onrender.com';
async function get(path) {
  const response = await fetch(endpoint + path, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + path);
  return response.json();
}
try {
  const leagues = await get('/leagues');
  console.log('Supported leagues:', leagues);
  for (const league of leagues.slice(0, 6)) {
    try {
      const fixtures = await get('/leagues/' + encodeURIComponent(league) + '/fixtures');
      const valid = Array.isArray(fixtures) ? fixtures.filter(x =>
        x.probs && ['home','draw','away'].every(k => Number.isFinite(x.probs[k])) &&
        Math.abs(x.probs.home + x.probs.draw + x.probs.away - 1) < 0.02) : [];
      console.log(league, ':', valid.length, 'fixtures with coherent 1X2 probabilities',
        Array.isArray(fixtures) ? '(' + fixtures.length + ' returned)' : '(invalid response)');
    } catch(e) { console.log(league, ': unavailable -', e.message); }
  }
} catch(e) { console.error('External candidate unavailable:', e.message); process.exitCode = 1; }
