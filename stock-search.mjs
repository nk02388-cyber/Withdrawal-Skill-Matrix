const keywords = query => String(query || '').trim().toLocaleLowerCase('th-TH').split(/\s+/).filter(Boolean);

export function matchesKeywords(code, name, query) {
  const text = `${code} ${name}`.toLocaleLowerCase('th-TH');
  return keywords(query).every(term => text.includes(term));
}

export function searchStock(items, query, limit = 30) {
  const terms = keywords(query);
  if (!terms.length) return { matches: [], total: 0 };
  const matching = items.filter(item => matchesKeywords(item.code, item.name, query));
  matching.sort((a, b) => {
    const q = terms.join(' ');
    const rank = item => {
      const code = item.code.toLocaleLowerCase('th-TH');
      const name = item.name.toLocaleLowerCase('th-TH');
      return code === q ? 0 : code.startsWith(q) ? 1 : name.startsWith(q) ? 2 : code.includes(q) ? 3 : 4;
    };
    return rank(a) - rank(b) || a.code.localeCompare(b.code);
  });
  return { matches: matching.slice(0, limit), total: matching.length };
}
