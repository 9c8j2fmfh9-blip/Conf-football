import {italianDay} from './diretta-calendar.js';
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const DAILY_TICKET_CUTOFF='21:30';
export function currentDayTicketFixtures(fixtures,now=Date.now()){
 const today=italianDay(now);
 return fixtures.filter(f=>{
  const at=Date.parse(f.date);
  return f.status==='NS'&&Number.isFinite(at)&&at>now&&italianDay(at)===today&&clock.format(new Date(at))<=DAILY_TICKET_CUTOFF;
 });
}
