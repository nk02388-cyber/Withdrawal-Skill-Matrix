import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesKeywords, searchStock } from '../stock-search.mjs';

const items = [
  { code: '31-0001-07-51', name: 'ขวด PET ใส 500 มล.', unit: 'ขวด' },
  { code: '31-0001-07-52', name: 'ฝาเกลียว ขาว', unit: 'ชิ้น' },
  { code: '40-1234', name: 'กล่องบรรจุ ขวด 500 มล.', unit: 'กล่อง' },
];

test('finds partial code, Thai name, and multiple keywords', () => {
  assert.deepEqual(searchStock(items, '07-51').matches.map(x => x.code), ['31-0001-07-51']);
  assert.deepEqual(searchStock(items, 'ขวด').matches.map(x => x.code), ['31-0001-07-51', '40-1234']);
  assert.deepEqual(searchStock(items, 'ขวด 500').matches.map(x => x.code), ['31-0001-07-51', '40-1234']);
  assert.deepEqual(searchStock(items, '31 ขาว').matches.map(x => x.code), ['31-0001-07-52']);
  assert.equal(matchesKeywords('21-0001-33','แจ๊บส์ บอดี้โลชั่น','33 โลชั่น'),true);
  assert.equal(matchesKeywords('21-0001-33','แจ๊บส์ บอดี้โลชั่น','33 แชมพู'),false);
});

test('exact code comes first and result limit preserves total', () => {
  const result = searchStock(items, '31-0001-07-52');
  assert.equal(result.matches[0].code, '31-0001-07-52');
  assert.deepEqual(searchStock(items, '31-', 1).total, 2);
  assert.deepEqual(searchStock(items, 'unknown').matches, []);
});
