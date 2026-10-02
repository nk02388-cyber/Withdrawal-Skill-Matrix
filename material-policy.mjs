// Codes beginning with 5 are WIP and do not belong to this picking workflow.
export const isWipCode=code=>String(code??'').trim().startsWith('5');
export const excludeWipLines=lines=>(lines||[]).filter(line=>!isWipCode(line.pk_code));
export const pickingFormulas=formulas=>(formulas||[]).map(formula=>({...formula,lines:excludeWipLines(formula.lines)})).filter(formula=>formula.lines.length>0);
