const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/sync-pk-bom.cjs <PK-WMS index.html>');
const html = fs.readFileSync(source, 'utf8');
const marker = 'const DATA = ';
const begin = html.indexOf(marker);
if (begin < 0) throw new Error('PK WMS DATA not found');
const end = html.indexOf(';', begin);
const data = JSON.parse(html.slice(begin + marker.length, end));
const detail = data.bomPk?.bom_detail;
if (!detail || typeof detail !== 'object') throw new Error('PK WMS BOM not found');
const formulas = Object.entries(detail).map(([fg_code, formula]) => ({
  fg_code,
  fg_name: formula.fg_name,
  lines: formula.lines.filter(line=>!String(line.pk_code||'').trim().startsWith('5')).map(line => ({
    pk_code: line.pk_code,
    pk_name: line.pk_name,
    unit: line.unit,
    qty_per_unit: line.qty_per_unit
  }))
})).filter(formula=>formula.lines.length>0).sort((a,b) => a.fg_code.localeCompare(b.fg_code));
if (formulas.length < 100) throw new Error('Suspiciously few BOM formulas; refusing to overwrite');
const output = {
  source: 'nk02388-cyber/PK-WMS:index.html',
  excludes_wip: true,
  source_sha256: crypto.createHash('sha256').update(JSON.stringify(formulas)).digest('hex'),
  formulas
};
const target = path.join(__dirname, '..', 'pk-bom.json');
fs.writeFileSync(target, JSON.stringify(output));
console.log(`${formulas.length} formulas, ${formulas.reduce((n, f) => n + f.lines.length, 0)} lines -> ${target}`);
