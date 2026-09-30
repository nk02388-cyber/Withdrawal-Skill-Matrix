const HOUR=3600000,DAY=24*HOUR,BANGKOK_OFFSET=7*HOUR;
// Cumulative daily lunch overlap in Bangkok time, including multi-day jobs.
function lunchBefore(time){const local=time+BANGKOK_OFFSET,day=Math.floor(local/DAY),clock=local-day*DAY;return day*HOUR+Math.min(HOUR,Math.max(0,clock-12*HOUR));}
export function workMinutes(startedAt,endedAt){
 if(!startedAt||!endedAt)return null;const start=Date.parse(startedAt),end=Date.parse(endedAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
 return Math.max(0,end-start-(lunchBefore(end)-lunchBefore(start)))/60000;
}
export function workDurationText(startedAt,endedAt){const value=workMinutes(startedAt,endedAt);if(value===null)return '—';if(value>0&&value<1)return '<1 นาที';const mins=Math.round(value);return Math.floor(mins/60)+' ชม. '+mins%60+' นาที';}
