export function pickDelta(required,actual){return Math.round((Number(actual)-Number(required))*10000)/10000;}
export function fractionalVariance(required,actual){const d=Math.abs(pickDelta(required,actual));return Number.isFinite(d)&&d>0&&d<1;}
export function significantShortage(required,actual){return pickDelta(required,actual)<=-1;}
