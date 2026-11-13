// 검색: 주파수 점프와 키워드. DOM을 쓰지 않는다.
import { parseFrequency } from './freq.js';
import { bandIndexAt } from './scale.js';

const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** 밴드마다 검색 대상 문자열을 미리 만들어 둔다. */
export function buildIndex(bands) {
  return bands.map((b) => {
    const entries = [];
    if (b.label) entries.push({ field: 'label', text: b.label });
    for (const s of b.services) entries.push({ field: s.primary ? 'primary' : 'secondary', text: s.name });
    for (const u of b.uses) entries.push({ field: 'use', text: u });
    for (const n of [...b.notes, ...(b.usesNotes ?? [])]) entries.push({ field: 'note', text: n });
    for (const s of b.services) for (const n of s.notes) entries.push({ field: 'note', text: n });
    return entries.map((e) => ({ ...e, norm: norm(e.text) }));
  });
}

/** 공백으로 나눈 모든 낱말이 한 밴드 안에서 나타나면 일치(AND). */
export function searchKeyword(index, query) {
  const tokens = String(query).split(/\s+/).map(norm).filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  index.forEach((entries, i) => {
    const hits = [];
    for (const t of tokens) {
      const found = entries.filter((e) => e.norm.includes(t));
      if (!found.length) return;
      for (const f of found) if (!hits.includes(f)) hits.push(f);
    }
    out.push({ index: i, hits: hits.map(({ field, text }) => ({ field, text })) });
  });
  return out;
}

export function bandsInRange(bands, lo, hi) {
  const out = [];
  bands.forEach((b, i) => {
    if (b.hi > lo && b.lo < hi) out.push(i);
  });
  return out;
}

// 각주 번호처럼 보이는 입력은 숫자라도 키워드로 본다(5.149A, K114).
const NOTE_LIKE = /^(k\d+[a-z]*|5\.\d+[a-z]+)$/i;

/**
 * 입력 한 줄을 해석해 어떤 검색인지 알려 준다.
 * 반환: { kind:'empty' }
 *     | { kind:'point', hz, index, defaulted }   index -1 이면 범위 밖
 *     | { kind:'range', lo, hi, indices, defaulted }
 *     | { kind:'keyword', results }
 */
export function runSearch(query, bands, index) {
  const q = String(query).trim();
  if (!q) return { kind: 'empty' };
  const f = NOTE_LIKE.test(q.replace(/\s+/g, '')) ? null : parseFrequency(q);
  if (f && f.type === 'point') {
    return { kind: 'point', hz: f.hz, index: bandIndexAt(bands, f.hz), defaulted: f.defaulted };
  }
  if (f && f.type === 'range') {
    return { kind: 'range', lo: f.lo, hi: f.hi, indices: bandsInRange(bands, f.lo, f.hi), defaulted: f.defaulted };
  }
  return { kind: 'keyword', results: searchKeyword(index, q) };
}
