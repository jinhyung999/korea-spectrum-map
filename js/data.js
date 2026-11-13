// 데이터 읽기와 정리. normalizeData 는 DOM 없이 쓸 수 있다.

const str = (x) => (typeof x === 'string' ? x : '');
const strList = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : []);

// 원문은 단위를 ㎑·㎒·㎓ 한 글자로 적는다. 작은 글씨에서 뭉개지므로 화면에서는 풀어 쓴다.
export const prettyUnits = (s) => s.replace(/\s*㎑/g, ' kHz').replace(/\s*㎒/g, ' MHz').replace(/\s*㎓/g, ' GHz');

export function normalizeData(raw) {
  const src = (raw && raw.source) || {};
  const bands = [];
  for (const b of raw && Array.isArray(raw.bands) ? raw.bands : []) {
    if (!b) continue;
    const lo = Number(b.lo);
    const hi = Number(b.hi);
    if (!(lo > 0) || !(hi > lo) || !Number.isFinite(hi)) continue;
    const services = (Array.isArray(b.services) ? b.services : [])
      .filter((s) => s && typeof s.name === 'string' && s.name.trim())
      .map((s) => ({ name: s.name.trim(), primary: s.primary !== false, notes: strList(s.notes) }));
    const label = str(b.label);
    bands.push({
      lo, hi, label, shown: prettyUnits(label), services,
      notes: strList(b.notes), uses: strList(b.uses), usesNotes: strList(b.usesNotes),
      correctedFrom: str(b.correctedFrom),
    });
  }
  bands.sort((x, y) => x.lo - y.lo);
  return {
    source: {
      title: str(src.title), notice: str(src.notice), effective: str(src.effective), url: str(src.url),
      corrections: Array.isArray(src.corrections) ? src.corrections : [],
    },
    bands,
  };
}

const MAIN = 'data/allocations.json';
const SAMPLE = 'tests/fixtures/allocations.sample.json';

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = normalizeData(await res.json());
  if (!data.bands.length) throw new Error(`${url}: 대역이 없음`);
  return data;
}

/** 주석 번호 → 본문. 파일이 없으면 빈 객체를 돌려주고, 화면은 번호만 보여 준다. */
export async function loadFootnotes(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('data/footnotes.json', { cache: 'no-cache' });
    if (!res.ok) return {};
    const raw = await res.json();
    return raw && typeof raw.notes === 'object' && raw.notes ? raw.notes : {};
  } catch {
    return {};
  }
}

/** 실제 데이터를 먼저 시도하고, 없으면 샘플로 대신한다. */
export async function loadAllocations(fetchImpl = fetch) {
  try {
    return { ...(await fetchJson(MAIN, fetchImpl)), sample: false };
  } catch (e) {
    console.info('data/allocations.json 을 쓸 수 없어 샘플 데이터를 씁니다:', e.message);
  }
  return { ...(await fetchJson(SAMPLE, fetchImpl)), sample: true };
}
