import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLimits, clampView, zoomView, panView, viewFor, xOf, hzAt, bandIndexAt, visibleRange, ticks, fullView } from '../js/scale.js';

// 8 kHz ~ 3000 GHz를 빈틈없이 채우는 합성 밴드
function makeBands(n = 1000) {
  const lo = 8e3;
  const hi = 3e12;
  const bands = [];
  for (let i = 0; i < n; i++) {
    bands.push({ lo: lo * (hi / lo) ** (i / n), hi: lo * (hi / lo) ** ((i + 1) / n) });
  }
  return bands;
}

test('xOf와 hzAt는 서로 역함수', () => {
  const v = { a: 6, b: 9 };
  for (const hz of [1e6, 5e7, 9.9e8]) assert.ok(Math.abs(hzAt(v, 800, xOf(v, 800, hz)) / hz - 1) < 1e-9);
  assert.equal(xOf(v, 800, 1e6), 0);
  assert.ok(Math.abs(xOf(v, 800, 1e9) - 800) < 1e-9);
});

test('zoomView는 기준점 주파수를 고정한다', () => {
  const lim = makeLimits(makeBands());
  const v = { a: 6, b: 9 };
  const z = zoomView(v, lim, 0.5, 0.25);
  assert.ok(Math.abs(z.b - z.a - 1.5) < 1e-12);
  assert.ok(Math.abs(z.a + 0.25 * 1.5 - (6 + 0.25 * 3)) < 1e-12);
});

test('확대·이동은 한계 안에 머문다', () => {
  const lim = makeLimits(makeBands());
  const out = zoomView(fullView(lim), lim, 5);
  assert.deepEqual(out, fullView(lim));
  const tiny = zoomView({ a: 6, b: 6.1 }, lim, 1e-9);
  assert.ok(Math.abs(tiny.b - tiny.a - lim.minSpan) < 1e-12);
  const p = panView({ a: lim.min, b: lim.min + 1 }, lim, -3);
  assert.equal(p.a, lim.min);
  const q = panView({ a: lim.max - 1, b: lim.max }, lim, 3);
  assert.equal(q.b, lim.max);
});

test('viewFor는 대역을 여백과 함께 감싼다', () => {
  const lim = makeLimits(makeBands());
  const v = viewFor(88e6, 108e6, lim, 0.25);
  assert.ok(10 ** v.a < 88e6 && 10 ** v.b > 108e6);
});

test('bandIndexAt: 경계는 아래 밴드에 속하지 않는다', () => {
  const bands = [{ lo: 10, hi: 20 }, { lo: 20, hi: 30 }, { lo: 30, hi: 40 }];
  assert.equal(bandIndexAt(bands, 10), 0);
  assert.equal(bandIndexAt(bands, 19.999), 0);
  assert.equal(bandIndexAt(bands, 20), 1);
  assert.equal(bandIndexAt(bands, 40), 2); // 마지막 hi 포함
  assert.equal(bandIndexAt(bands, 9), -1);
  assert.equal(bandIndexAt(bands, 41), -1);
});

test('visibleRange는 화면과 겹치는 밴드만 고른다', () => {
  const bands = makeBands(1000);
  const all = visibleRange(bands, { a: 0, b: 13 });
  assert.deepEqual(all, { first: 0, last: 999 });
  const v = { a: Math.log10(1e6), b: Math.log10(1.2e6) };
  const { first, last } = visibleRange(bands, v);
  for (let i = 0; i < bands.length; i++) {
    const overlaps = bands[i].hi > 10 ** v.a && bands[i].lo < 10 ** v.b;
    assert.equal(i >= first && i <= last, overlaps, `band ${i}`);
  }
  const none = visibleRange(bands, { a: 20, b: 21 });
  assert.ok(none.first > none.last);
});

test('ticks: 전체 범위에서는 자릿수 눈금, 크게 확대하면 선형 눈금', () => {
  const lim = makeLimits(makeBands());
  const full = ticks(fullView(lim), 1000);
  const labels = full.filter((t) => t.label).map((t) => t.label);
  assert.ok(labels.includes('1 MHz') && labels.includes('1 GHz'));
  assert.ok(full.every((t) => t.x >= 0 && t.x <= 1));
  // 폰 폭에서도 라벨이 겹치지 않을 만큼만
  const narrow = ticks(fullView(lim), 360).filter((t) => t.label);
  assert.ok(narrow.length <= 6);
  const zoomed = ticks({ a: Math.log10(75e6), b: Math.log10(75.01e6) }, 800);
  assert.ok(zoomed.length >= 3 && zoomed.length < 30);
  assert.ok(zoomed.every((t) => t.label && t.hz >= 75e6 && t.hz <= 75.01e6 + 1));
});

test('밴드 1500개 가시 범위 계산은 빠르다', () => {
  const bands = makeBands(1500);
  const t = performance.now();
  for (let i = 0; i < 10000; i++) visibleRange(bands, { a: 6 + (i % 100) / 100, b: 7 + (i % 100) / 100 });
  assert.ok(performance.now() - t < 500);
});
