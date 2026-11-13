// 로그 주파수 축 계산. 보이는 범위(view)는 log10(Hz) 구간 {a, b}로 표현한다.
import { formatHz } from './freq.js';

const log10 = Math.log10;

export function makeLimits(bands, pad = 0.03) {
  const min = log10(bands[0].lo);
  const max = log10(bands[bands.length - 1].hi);
  return { min: min - pad, max: max + pad, minSpan: 1e-4 };
}

export function clampView(v, lim) {
  const span = Math.min(Math.max(v.b - v.a, lim.minSpan), lim.max - lim.min);
  const a = Math.min(Math.max(v.a, lim.min), lim.max - span);
  return { a, b: a + span };
}

export function fullView(lim) {
  return { a: lim.min, b: lim.max };
}

/** anchor(0~1) 위치의 주파수를 고정한 채 span을 factor배 한다. */
export function zoomView(v, lim, factor, anchor = 0.5) {
  const span = v.b - v.a;
  const next = span * factor;
  const p = v.a + anchor * span;
  return clampView({ a: p - anchor * next, b: p - anchor * next + next }, lim);
}

export function panView(v, lim, fraction) {
  const d = (v.b - v.a) * fraction;
  return clampView({ a: v.a + d, b: v.b + d }, lim);
}

/** lo~hi(Hz)가 화면 가운데에 margin 비율 여백과 함께 들어오는 view. */
export function viewFor(lo, hi, lim, margin = 0.25) {
  const a = log10(lo);
  const b = log10(hi);
  const span = Math.max(b - a, lim.minSpan);
  const pad = span * margin;
  return clampView({ a: a - pad, b: b + pad }, lim);
}

export const xOf = (v, w, hz) => ((log10(hz) - v.a) / (v.b - v.a)) * w;
export const hzAt = (v, w, x) => 10 ** (v.a + (x / w) * (v.b - v.a));

/** lo <= hz < hi 인 밴드 번호. 마지막 밴드는 hi도 포함. 없으면 -1. */
export function bandIndexAt(bands, hz) {
  let lo = 0;
  let hi = bands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = bands[mid];
    if (hz < b.lo) hi = mid - 1;
    else if (hz >= b.hi) lo = mid + 1;
    else return mid;
  }
  const last = bands[bands.length - 1];
  return last && hz === last.hi ? bands.length - 1 : -1;
}

/** hi > hz 인 첫 밴드 번호. 모두 작으면 bands.length. */
function firstEndingAfter(bands, hz) {
  let lo = 0;
  let hi = bands.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bands[mid].hi > hz) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** 화면과 겹치는 밴드 번호 구간 [first, last] (포함). 없으면 first > last. */
export function visibleRange(bands, v) {
  const loHz = 10 ** v.a;
  const hiHz = 10 ** v.b;
  const first = firstEndingAfter(bands, loHz);
  let last = firstEndingAfter(bands, hiHz);
  if (last >= bands.length || bands[last].lo >= hiHz) last -= 1;
  return { first, last: Math.min(last, bands.length - 1) };
}

const NICE = [1, 2, 5, 10];

/**
 * 축 눈금. 폭 w(px)에 맞춰 로그 눈금(1~9 × 10^k) 또는, 많이 확대했을 땐 선형 눈금을 만든다.
 * 반환: [{ hz, x(0~1), label|null, major }]
 */
export function ticks(v, w, minLabelPx = 64) {
  const span = v.b - v.a;
  const out = [];
  if (span < 0.45) {
    const lo = 10 ** v.a;
    const hi = 10 ** v.b;
    const target = (hi - lo) / Math.max(1, w / (minLabelPx + 30));
    const p = 10 ** Math.floor(log10(target));
    const step = p * NICE.find((n) => n * p >= target);
    for (let i = Math.ceil(lo / step); i * step <= hi; i++) {
      const hz = i * step;
      out.push({ hz, x: (log10(hz) - v.a) / span, label: formatHz(hz), major: i % 5 === 0 });
    }
    return out;
  }
  const ppd = w / span; // 한 자릿수(decade)당 픽셀
  const labelSet = ppd >= 1400 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : ppd >= 213 ? [1, 2, 5] : [1];
  const every = Math.max(1, Math.ceil(minLabelPx / ppd));
  for (let k = Math.floor(v.a); k <= Math.ceil(v.b); k++) {
    for (let m = 1; m <= 9; m++) {
      const lg = k + log10(m);
      if (lg < v.a || lg > v.b) continue;
      if (ppd < 40 && m !== 1) continue;
      const hz = m * 10 ** k;
      const labelled = labelSet.includes(m) && (m !== 1 || k % every === 0);
      out.push({ hz, x: (lg - v.a) / span, label: labelled ? formatHz(hz) : null, major: m === 1 });
    }
  }
  return out;
}
