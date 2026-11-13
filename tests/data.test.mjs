// data/allocations.json과 data/footnotes.json이 지켜야 하는 성질을 검사한다.
// 변환 스크립트(scripts/build_data.py)를 고친 뒤 결과가 망가지지 않았는지 확인하는 용도다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));

const { source, bands, unallocatedBelow } = read('allocations.json');
const { notes } = read('footnotes.json');

const NOTE_ID = /(?<![\d.A-Za-z])(?:5\.\d{1,3}[A-Z]{0,3}|K\d{1,3}[A-Z]{0,2})(?![\dA-Za-z])/g;
const band = (label) => bands.find((b) => b.label === label);

test('고시 번호와 시행일이 기록되어 있다', () => {
  assert.equal(source.notice, '과학기술정보통신부고시 제2024-44호');
  assert.equal(source.effective, '2025-02-17');
});

test('대역은 8.3 ㎑부터 3000 ㎓까지 빈 구간과 겹침 없이 이어진다', () => {
  assert.equal(bands[0].lo, 8300);
  assert.equal(bands[0].lo, unallocatedBelow);
  assert.equal(bands.at(-1).hi, 3e12);
  for (let i = 0; i < bands.length; i++) {
    assert.ok(bands[i].lo < bands[i].hi, `${bands[i].label}의 범위가 뒤집힘`);
    if (i > 0) {
      assert.equal(bands[i].lo, bands[i - 1].hi, `${bands[i - 1].label} → ${bands[i].label}`);
    }
  }
});

test('모든 대역에 업무가 하나 이상 있고 이름에 주석 번호가 섞여 있지 않다', () => {
  for (const b of bands) {
    assert.ok(b.services.length > 0, `${b.label}에 업무가 없음`);
    for (const s of b.services) {
      assert.ok(s.name.length > 0);
      assert.equal(typeof s.primary, 'boolean');
      assert.equal(s.name.match(NOTE_ID), null, `${b.label}: ${s.name}`);
    }
  }
});

test('원문에서 직접 확인한 대역이 그대로 들어 있다', () => {
  const fm = band('88-100 ㎒');
  assert.deepEqual(
    fm.services.map((s) => [s.name, s.primary]),
    [['방송', true], ['이동', false]],
  );
  assert.deepEqual(fm.uses, ['FM방송용', '재난경보방송용 K208']);

  const ism = band('2400-2450 ㎒');
  assert.deepEqual(
    ism.services.map((s) => [s.name, s.primary]),
    [['고정', true], ['이동', true], ['무선탐지', true], ['아마추어', false]],
  );
  assert.deepEqual(ism.notes, ['5.150', '5.282']);

  // 한 줄에 업무가 둘 적힌 곳과, 줄이 바뀐 주석이 업무에 붙는 곳
  const b2670 = band('2670-2690 ㎒');
  assert.deepEqual(
    b2670.services.slice(0, 3).map((s) => [s.name, s.notes]),
    [
      ['고정', ['5.410']],
      ['이동(항공이동 제외)', ['5.384A']],
      ['이동위성(지구대우주)', ['5.351A', '5.419']],
    ],
  );

  // 업무 이름이 두 줄로 갈라진 곳
  const b1375 = band('13.75-14 ㎓');
  assert.ok(b1375.services.some((s) => s.name === '표준주파수 및 시보위성(지구대우주)' && !s.primary));
});

test('용도 칸이 여러 대역에 걸쳐 병합된 곳은 걸친 대역 모두에 적용된다', () => {
  assert.deepEqual(band('9800-9900 ㎒').uses, ['UWB용 K125B']);
  assert.deepEqual(band('9900-10000 ㎒').uses, ['UWB용 K125B']);
});

test('용도 칸 아래쪽에 따로 적힌 주석은 용도 줄에 붙이지 않고 따로 둔다', () => {
  const b = band('148-149.9 ㎒');
  assert.deepEqual(b.uses, ['위성이동통신시스템(GMPCS) K65']);
  assert.deepEqual(b.usesNotes, ['K16A', 'K60D', 'K60H', 'K64A', 'K64I', 'K71']);
  // 용도 바로 아랫줄의 주석은 그 용도에 붙는다
  assert.deepEqual(band('5060-5250 ㎑').uses, ['5185 ㎑(금융업무) K26A']);
});

test('칸 폭 때문에 끊긴 용도 줄은 한 줄로 이어진다', () => {
  assert.equal(band('285-325 ㎑').uses[0], '무선표지 및 위치측정용 K5');
  assert.deepEqual(band('5350-5460 ㎒').uses, ['항공기상의 레이다 및 비콘용']);
  assert.equal(band('18.1-18.4 ㎓').uses[1], '거리측정, 도난경보 등의 업무용 K163');
  assert.equal(band('328.6-335.4 ㎒').uses[1], '331.4 ㎒(실험국용) K30');
});

test('본문이 대역 전체에 대한 내용인 주석은 대역 주석으로 옮겨져 있다', () => {
  const b472 = band('472-479 ㎑');
  assert.deepEqual(b472.notes, ['5.82', '5.80B']);
  assert.deepEqual(b472.services.find((s) => s.name === '아마추어').notes, ['5.80A']);
  assert.deepEqual(band('13550-13570 ㎑').notes, ['5.150']);
  assert.deepEqual(band('26350-27500 ㎑').notes, ['5.150']);
  assert.equal(source.noteMoves.length, 3);
});

test('원문 오기를 정정한 대역은 원래 표기와 근거가 남아 있다', () => {
  const fixed = bands.filter((b) => b.correctedFrom);
  assert.deepEqual(fixed.map((b) => [b.correctedFrom, b.label]), [
    ['399.9-400.5 ㎒', '399.9-400.05 ㎒'],
  ]);
  assert.equal(source.corrections.length, fixed.length);
  assert.ok(source.corrections[0].reason.length > 0);
});

test('분배표에서 쓰인 주석 번호는 모두 주석 본문을 가진다', () => {
  const used = new Set();
  for (const b of bands) {
    b.notes.forEach((n) => used.add(n));
    b.services.forEach((s) => s.notes.forEach((n) => used.add(n)));
    b.uses.forEach((line) => (line.match(NOTE_ID) ?? []).forEach((n) => used.add(n)));
    b.usesNotes.forEach((n) => used.add(n));
  }
  const missing = [...used].filter((n) => !notes[n]);
  assert.deepEqual(missing, []);
});
