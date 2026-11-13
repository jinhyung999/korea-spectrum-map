// 주파수 문자열 해석과 표기. DOM을 쓰지 않는다.

const UNIT_HZ = {
  hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9, thz: 1e12,
  헤르츠: 1, 킬로헤르츠: 1e3, 메가헤르츠: 1e6, 기가헤르츠: 1e9, 테라헤르츠: 1e12,
};
const UNIT_RE = '(thz|ghz|mhz|khz|hz|테라헤르츠|기가헤르츠|메가헤르츠|킬로헤르츠|헤르츠)';
const NUM_RE = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const QUERY_RE = new RegExp(`^${NUM_RE}${UNIT_RE}?(?:[-~–—∼]${NUM_RE}${UNIT_RE}?)?$`);

/**
 * 사람이 입력한 주파수 문자열을 해석한다.
 * 단위가 없으면 MHz로 본다(defaulted: true).
 * 반환: { type:'point', hz } | { type:'range', lo, hi } | null
 */
export function parseFrequency(text) {
  if (typeof text !== 'string') return null;
  // NFKC로 ㎒ → MHz, 전각 숫자/물결 → 반각으로 맞춘다.
  const s = text.normalize('NFKC').toLowerCase().replace(/[\s,]/g, '');
  const m = QUERY_RE.exec(s);
  if (!m) return null;
  const [, n1, u1, n2, u2] = m;
  const defaulted = !u1 && !u2;
  const unit1 = u1 || u2 || 'mhz';
  const v1 = parseFloat(n1) * UNIT_HZ[unit1];
  if (n2 === undefined) {
    if (!(v1 > 0)) return null;
    return { type: 'point', hz: v1, defaulted };
  }
  const v2 = parseFloat(n2) * UNIT_HZ[u2 || unit1];
  if (!(v1 > 0) || !(v2 > 0)) return null;
  const [lo, hi] = v1 <= v2 ? [v1, v2] : [v2, v1];
  if (lo === hi) return { type: 'point', hz: lo, defaulted };
  return { type: 'range', lo, hi, defaulted };
}

const UNITS = [
  [1e12, 'THz'],
  [1e9, 'GHz'],
  [1e6, 'MHz'],
  [1e3, 'kHz'],
  [1, 'Hz'],
];

function trim(x, digits) {
  return String(parseFloat(x.toPrecision(digits)));
}

/** 1.0e6 → "1 MHz", 74.8e6 → "74.8 MHz". */
export function formatHz(hz, digits = 9) {
  if (!Number.isFinite(hz)) return '';
  if (hz === 0) return '0 Hz';
  const abs = Math.abs(hz);
  const [div, unit] = UNITS.find(([d]) => abs >= d * (1 - 1e-12)) || UNITS[UNITS.length - 1];
  return `${trim(hz / div, digits)} ${unit}`;
}

/** 대역 폭 등 간격 표기. */
export function formatSpan(lo, hi) {
  return formatHz(hi - lo, 6);
}

export function formatRange(lo, hi) {
  return `${formatHz(lo)} ~ ${formatHz(hi)}`;
}
