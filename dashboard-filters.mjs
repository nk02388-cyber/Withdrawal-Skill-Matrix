import {bangkokDate} from './ticket-report.mjs';
export function presetDates(preset,now=new Date()){
  const today=bangkokDate(now);
  if(preset==='all'||preset==='custom')return {dateFrom:'',dateTo:''};
  if(preset==='today')return {dateFrom:today,dateTo:today};
  if(preset==='month')return {dateFrom:today.slice(0,7)+'-01',dateTo:today};
  const date=new Date(today+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  return {dateFrom:date.toISOString().slice(0,10),dateTo:today};
}
