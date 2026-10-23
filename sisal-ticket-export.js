// Sisal does not publish a confirmed external betslip-construction endpoint.
// Export a clear manual checklist; NEVER claim opening Sisal prefills a betslip.
export const SISAL_SITE_URL = 'https://www.sisal.it/scommesse-matchpoint';

const toItalianTime = date => {
 const timestamp = Date.parse(date);
 if (!Number.isFinite(timestamp)) return 'Orario da verificare';
 return new Intl.DateTimeFormat('it-IT', {
  timeZone:'Europe/Rome', day:'2-digit', month:'2-digit',
  hour:'2-digit', minute:'2-digit'
 }).format(new Date(timestamp));
};

export function ticketForSisalClipboard(ticket) {
 if (!ticket?.available || !Array.isArray(ticket.legs) || !ticket.legs.length) return null;
 const lines = ticket.legs.map((leg, index) => {
  if (!leg || typeof leg.home !== 'string' || !leg.home.trim() ||
      typeof leg.away !== 'string' || !leg.away.trim() ||
      typeof leg.label !== 'string' || !leg.label.trim()) return null;
  const price = Number.isFinite(leg.odds) && leg.odds > 1
   ? ' · quota indicativa ' + leg.odds.toFixed(2).replace('.', ',') : '';
  return (index+1) + '. ' + toItalianTime(leg.date) + ' · ' +
   leg.home.trim() + ' – ' + leg.away.trim() + ' | ' + leg.label.trim() + price;
 });
 if (lines.some(x => x === null)) return null;
 const headline = Number.isFinite(ticket.target) ? 'Obiettivo quota ' + ticket.target : 'Multipla CONF';
 const total = Number.isFinite(ticket.totalOdds) && ticket.totalOdds > 1
  ? 'Quota totale INDICATIVA: ' + ticket.totalOdds.toFixed(2).replace('.', ',') : 'Quota totale non verificata';
 return ['CONF Football · ' + headline, ...lines, total,
  'ATTENZIONE: elenco da inserire manualmente su Sisal. Questo testo NON crea una schedina, NON blocca le quote e NON effettua puntate.',
  SISAL_SITE_URL].join('\n');
}
