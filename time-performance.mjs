import {workBreakdown} from './operations.mjs?v=4';
import {ticketDocumentCount} from './withdrawal-documents.mjs';

export const MINUTES_PER_DOCUMENT=38;

// Compare closed withdrawal work, including partial picks. Training has no material rows.
export function withdrawalTimePerformance(tickets){
  let jobs=0,documents=0,actualMinutes=0,excluded=0;
  for(const ticket of tickets){
    if(ticket.deleted_at||!['done','partial'].includes(ticket.status)||!ticket.materials?.length)continue;
    const duration=workBreakdown(ticket);
    if(!duration||duration.activeMinutes<=0){excluded++;continue;}
    jobs++;
    documents+=ticketDocumentCount(ticket);
    actualMinutes+=duration.activeMinutes;
  }
  const expectedMinutes=documents*MINUTES_PER_DOCUMENT;
  return {jobs,documents,actualMinutes,expectedMinutes,excluded,efficiency:jobs?Math.round(expectedMinutes/actualMinutes*100):null};
}
