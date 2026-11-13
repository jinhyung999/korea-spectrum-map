import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrequency, formatHz, formatRange } from '../js/freq.js';

const pt = (s) => parseFrequency(s);

test('단일 주파수 입력 형태', () => {
  assert.equal(pt('2.4GHz').hz, 2.4e9);
  assert.equal(pt('700 MHz').hz, 700e6);
  assert.equal(pt('13.56㎒').hz, 13.56e6);
  assert.equal(pt('900khz').hz, 900e3);
  assert.equal(pt('1,800 MHz').hz, 1800e6);
  assert.equal(pt('３.５GHz').hz, 3.5e9);
});

test('단위가 없으면 MHz로 보고 표시한다', () => {
  const r = pt('95.1');
  assert.equal(r.type, 'point');
  assert.equal(r.hz, 95.1e6);
  assert.equal(r.defaulted, true);
  assert.equal(pt('95.1MHz').defaulted, false);
});

test('범위 입력', () => {
  const r = pt('88-108MHz');
  assert.deepEqual([r.type, r.lo, r.hi], ['range', 88e6, 108e6]);
  const m = pt('900MHz ~ 2GHz');
  assert.deepEqual([m.lo, m.hi], [900e6, 2e9]);
  const rev = pt('108-88MHz');
  assert.deepEqual([rev.lo, rev.hi], [88e6, 108e6]);
  assert.equal(pt('88-88MHz').type, 'point');
});

test('주파수가 아닌 입력은 null', () => {
  for (const s of ['방송', '', '   ', 'abc', '5G', '0', '-5', '2.4GHz 이동', null]) {
    assert.equal(pt(s), null, String(s));
  }
});

test('formatHz는 알맞은 단위를 고른다', () => {
  assert.equal(formatHz(44e6), '44 MHz');
  assert.equal(formatHz(74.8e6), '74.8 MHz');
  assert.equal(formatHz(8000), '8 kHz');
  assert.equal(formatHz(3e12), '3 THz');
  assert.equal(formatHz(999), '999 Hz');
  assert.equal(formatHz(2.4e9), '2.4 GHz');
  assert.equal(formatHz(0.1 * 3 * 1e6), '300 kHz');
  assert.equal(formatRange(44e6, 50e6), '44 MHz ~ 50 MHz');
});
