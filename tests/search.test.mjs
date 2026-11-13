import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeData, loadAllocations } from '../js/data.js';
import { buildIndex, runSearch, searchKeyword } from '../js/search.js';

const raw = JSON.parse(readFileSync(new URL('./fixtures/allocations.sample.json', import.meta.url), 'utf8'));
const { bands, source } = normalizeData(raw);
const index = buildIndex(bands);

test('샘플 데이터를 읽는다', () => {
  assert.equal(bands.length, 8);
  assert.equal(source.notice, '과학기술정보통신부고시 제2024-44호');
});

test('normalizeData는 빠진 값이 있어도 죽지 않는다', () => {
  const d = normalizeData({ bands: [{ lo: 10, hi: 20 }, { lo: 5, hi: 8, services: [{ name: '고정' }, { primary: true }], uses: [''] }, { lo: 30, hi: 20 }, null] });
  assert.equal(d.bands.length, 2);
  assert.equal(d.bands[0].lo, 5);
  assert.equal(d.bands[0].services.length, 1);
  assert.deepEqual(d.bands[0].uses, []);
  assert.equal(d.source.url, '');
  assert.equal(normalizeData(null).bands.length, 0);
});

test('주파수 검색은 해당 대역을 찾는다', () => {
  const r = runSearch('95.1', bands, index);
  assert.equal(r.kind, 'point');
  assert.equal(bands[r.index].label, '88-100 ㎒');
  assert.equal(r.defaulted, true);
  assert.equal(bands[runSearch('52 MHz', bands, index).index].label, '50-54 ㎒');
  assert.equal(runSearch('2.4GHz', bands, index).index, -1);
});

test('범위 검색은 겹치는 대역을 모두 찾는다', () => {
  const r = runSearch('50-76MHz', bands, index);
  assert.equal(r.kind, 'range');
  assert.deepEqual(r.indices.map((i) => bands[i].label), ['50-54 ㎒', '54-72 ㎒', '72-74.8 ㎒', '74.8-75.2 ㎒', '75.2-76 ㎒']);
});

test('키워드 검색: 업무 이름과 용도', () => {
  const labels = (q) => runSearch(q, bands, index).results.map((r) => bands[r.index].label);
  assert.deepEqual(labels('방송'), ['54-72 ㎒', '76-88 ㎒', '88-100 ㎒']);
  assert.deepEqual(labels('아마추어'), ['50-54 ㎒']);
  assert.deepEqual(labels('FM'), ['88-100 ㎒']);
  assert.deepEqual(labels('fm 방송'), ['88-100 ㎒']);
  assert.deepEqual(labels('없는말'), []);
});

test('각주 번호처럼 보이면 숫자여도 키워드로 본다', () => {
  assert.equal(runSearch('K30', bands, index).kind, 'keyword');
  assert.equal(runSearch('5.162A', bands, index).kind, 'keyword');
  assert.equal(runSearch('5.162A', bands, index).results.length, 3);
});

test('결과에는 어디서 맞았는지가 들어 있다', () => {
  const r = searchKeyword(index, 'FM');
  assert.equal(r[0].hits[0].field, 'use');
});

test('loadAllocations: 실제 파일이 없으면 샘플로 대신한다', async () => {
  const fake = async (url) => {
    if (url.includes('allocations.json')) return { ok: false, status: 404 };
    return { ok: true, json: async () => raw };
  };
  const d = await loadAllocations(fake);
  assert.equal(d.sample, true);
  assert.equal(d.bands.length, 8);
  const ok = async () => ({ ok: true, json: async () => raw });
  assert.equal((await loadAllocations(ok)).sample, false);
  await assert.rejects(loadAllocations(async () => { throw new Error('x'); }));
});
