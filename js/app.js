// 화면 연결. 계산은 다른 모듈에 있고, 여기서는 DOM과 상태만 다룬다.
import { loadAllocations, loadFootnotes, prettyUnits } from './data.js';
import { FAMILIES, FAMILY_BY_ID, familyOf } from './families.js';
import { formatHz, formatRange, formatSpan } from './freq.js';
import { buildIndex, runSearch } from './search.js';
import { SpectrumChart } from './chart.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k) n.append(k);
  return n;
}

const app = {
  data: null, index: [], chart: null, minimap: null,
  selected: -1, results: [], pos: -1, active: new Set(), notes: {},
};

const NOTE_ID = /(?<![\d.A-Za-z])(?:5\.\d{1,3}[A-Z]{0,3}|K\d{1,3}[A-Z]{0,2})(?![\dA-Za-z])/g;
const nameOf = (b) => b.shown || formatRange(b.lo, b.hi);

const FIELD_LABEL = { primary: '1순위 업무', secondary: '2순위 업무', use: '용도', note: '주석', label: '대역' };

function noteTitle(id) {
  if (id.startsWith('5.')) return '국제(ITU) 주석';
  if (id.startsWith('K')) return '국내 주석';
  return '주석';
}

const noteChip = (id) => el('span', { class: 'note', title: noteTitle(id), text: id });

// 이 대역에 걸린 주석을 모아 본문과 함께 보여 준다. 국내(K) 주석을 먼저 둔다.
function footnoteSection(b) {
  const ids = new Set([
    ...b.uses.flatMap((u) => u.match(NOTE_ID) ?? []),
    ...b.usesNotes,
    ...b.services.flatMap((s) => s.notes),
    ...b.notes,
  ]);
  if (!ids.size) return null;
  const sorted = [...ids].sort((x, y) => (y.startsWith('K') - x.startsWith('K')) || x.localeCompare(y, 'en', { numeric: true }));
  const wrap = el('div', { class: 'fn-list' });
  for (const id of sorted) {
    const text = app.notes[id] ? prettyUnits(app.notes[id]) : '';
    const first = text.split('\n')[0];
    const d = el('details', { class: 'fn' },
      el('summary', {}, noteChip(id), el('span', { class: 'fn-kind', text: noteTitle(id) }),
        el('span', { class: 'fn-peek', text: first.length > 70 ? `${first.slice(0, 70)}…` : first })),
      el('p', { class: 'fn-body', text: text || '주석 본문을 불러오지 못했습니다. 고시 원문에서 확인하세요.' }));
    if (id.startsWith('K') && sorted.length <= 6) d.setAttribute('open', '');
    wrap.append(d);
  }
  return wrap;
}
const swatch = (fam, hatch) => el('span', { class: `sw${hatch ? ' hatch' : ''}`, style: `--c: var(--fam-${fam})` });

// ---- 상세 ----
function renderDetail() {
  const box = $('detail');
  box.replaceChildren();
  const i = app.selected;
  const b = app.data.bands[i];
  if (!b) {
    box.append(el('h2', { text: '대역 자세히' }), el('p', { class: 'muted', text: '차트에서 대역을 누르거나 검색해 보세요. 여기에 이 대역의 업무와 용도가 나옵니다.' }));
    return;
  }
  const nav = el('div', { class: 'detail-nav' },
    el('button', { type: 'button', text: '이 대역으로 확대', onclick: () => app.chart.zoomToBand(i) }),
    el('button', { type: 'button', 'aria-label': '이전 대역', text: '◀', onclick: () => selectBand(i - 1, true), ...(i <= 0 ? { disabled: '' } : {}) }),
    el('button', { type: 'button', 'aria-label': '다음 대역', text: '▶', onclick: () => selectBand(i + 1, true), ...(i >= app.data.bands.length - 1 ? { disabled: '' } : {}) }),
  );
  box.append(
    el('h2', { text: nameOf(b) }),
    el('p', { class: 'range', text: `${formatRange(b.lo, b.hi)} (폭 ${formatSpan(b.lo, b.hi)})` }),
    nav,
  );
  if (b.correctedFrom) {
    const fix = app.data.source.corrections.find((c) => c.original === b.correctedFrom);
    box.append(el('p', { class: 'fix', text: `고시 원문에는 "${b.correctedFrom}"로 적혀 있어 바로잡았습니다. ${fix ? fix.reason : ''}` }));
  }
  const prim = b.services.filter((s) => s.primary);
  const sec = b.services.filter((s) => !s.primary);
  const svcList = (list, hatch) => {
    const ul = el('ul', { class: 'svc' });
    for (const s of list) {
      const fam = familyOf(s.name);
      ul.append(el('li', {}, swatch(fam, hatch), el('span', { class: 'svc-name', text: s.name }), FAMILY_BY_ID[fam].label !== s.name && el('span', { class: 'fam', text: FAMILY_BY_ID[fam].label }), ...s.notes.map(noteChip)));
    }
    return ul;
  };
  if (!b.services.length) box.append(el('p', { class: 'muted', text: '이 대역에 표시된 업무가 없습니다.' }));
  if (prim.length) box.append(el('h3', { text: '1순위 업무' }), svcList(prim, false));
  if (sec.length) {
    box.append(el('h3', { text: '2순위 업무' }), el('p', { class: 'muted small', text: '1순위 업무에 혼신을 주거나 보호를 요구할 수 없는 업무입니다.' }), svcList(sec, true));
  }
  if (b.notes.length) {
    box.append(el('h3', { text: '대역 전체에 걸린 주석' }), el('p', { class: 'notes' }, ...b.notes.map(noteChip)));
  }
  if (b.uses.length || b.usesNotes.length) {
    const ul = el('ul', { class: 'uses' });
    for (const u of b.uses) ul.append(el('li', { text: prettyUnits(u) }));
    box.append(el('h3', { text: '용도 등' }), ul);
    if (b.usesNotes.length) {
      // 원문에서 용도 칸 아래쪽에 따로 적힌 주석. 어느 용도에 대한 것인지는 주석 본문에 나온다.
      box.append(el('p', { class: 'notes loose' }, el('span', { class: 'muted small', text: '용도 칸에 따로 적힌 주석 ' }), ...b.usesNotes.map(noteChip)));
    }
  }
  const fn = footnoteSection(b);
  if (fn) {
    box.append(el('h3', { text: '주석 풀이' }),
      el('p', { class: 'muted small', text: 'K로 시작하면 국내 주석, 5.로 시작하면 국제(ITU) 주석입니다. 줄을 누르면 전문이 펼쳐집니다.' }), fn);
  }
}

function selectBand(i, reveal = false) {
  if (i < 0 || i >= app.data.bands.length) return;
  app.selected = i;
  app.chart.setSelected(i);
  if (reveal) app.chart.reveal(i);
  renderDetail();
}

// ---- 범례 ----
function renderLegend() {
  const counts = new Map();
  app.chart.meta.forEach((m) => m.fams.forEach((f) => counts.set(f, (counts.get(f) || 0) + 1)));
  const box = $('legend');
  box.replaceChildren();
  for (const f of FAMILIES) {
    if (!counts.has(f.id)) continue;
    const on = app.active.has(f.id);
    box.append(el('button', {
      type: 'button', class: `leg${on ? ' on' : ''}`, 'aria-pressed': String(on), title: f.desc,
      onclick: () => {
        if (app.active.has(f.id)) app.active.delete(f.id);
        else app.active.add(f.id);
        app.chart.setActive(app.active);
        renderLegend();
      },
    }, swatch(f.id, false), el('span', { text: f.label }), el('small', { text: String(counts.get(f.id)) })));
  }
  if (app.active.size) {
    box.append(el('button', { type: 'button', class: 'leg reset', text: '필터 해제', onclick: () => { app.active = new Set(); app.chart.setActive(app.active); renderLegend(); } }));
  }
}

// ---- 검색 ----
function setMsg(t) { $('search-msg').textContent = t; }

function clearSearch() {
  app.results = [];
  app.pos = -1;
  app.chart.setHighlights(new Set());
  app.chart.setMarker(null);
  $('results').hidden = true;
}

function doSearch(q) {
  // 주소에 검색어를 남겨 두면 그 주소를 그대로 공유할 수 있다.
  history.replaceState(null, '', q.trim() ? `#q=${encodeURIComponent(q.trim())}` : location.pathname + location.search);
  const res = runSearch(q, app.data.bands, app.index);
  const bands = app.data.bands;
  clearSearch();
  if (res.kind === 'empty') return setMsg('');
  const unit = (d) => (d ? ' (단위가 없어 MHz로 해석)' : '');
  if (res.kind === 'point') {
    if (res.index < 0) {
      const lo = bands[0].lo;
      const hi = bands[bands.length - 1].hi;
      return setMsg(`${formatHz(res.hz)}은(는) 이 데이터의 범위(${formatHz(lo)} ~ ${formatHz(hi)}) 밖입니다.`);
    }
    app.chart.setMarker({ lo: res.hz, hi: res.hz });
    app.chart.setHighlights(new Set([res.index]));
    selectBand(res.index);
    app.chart.zoomToRange(Math.min(res.hz, bands[res.index].lo), Math.max(res.hz, bands[res.index].hi), 0.4);
    return setMsg(`${formatHz(res.hz)}${unit(res.defaulted)} → ${nameOf(bands[res.index])} 대역에 있습니다.`);
  }
  if (res.kind === 'range') {
    if (!res.indices.length) return setMsg('해당 범위에 대역이 없습니다.');
    app.chart.setMarker({ lo: res.lo, hi: res.hi });
    app.chart.zoomToRange(res.lo, res.hi);
    showResults(res.indices.map((index) => ({ index, hits: [] })), `${formatRange(res.lo, res.hi)}${unit(res.defaulted)}와 겹치는 대역 ${res.indices.length}개`, false);
    return setMsg('');
  }
  if (!res.results.length) return setMsg(`"${q.trim()}"에 맞는 대역이 없습니다.`);
  showResults(res.results, `"${q.trim()}" 검색 결과 ${res.results.length}개 대역`, true);
  setMsg('');
}

function showResults(list, title, jump) {
  app.results = list;
  app.chart.setHighlights(new Set(list.map((r) => r.index)));
  renderResults(title);
  stepResult(0, jump, true);
}

function stepResult(d, jump = true, absolute = false) {
  if (!app.results.length) return;
  const n = app.results.length;
  app.pos = absolute ? d : (app.pos + d + n) % n;
  selectBand(app.results[app.pos].index, false);
  if (jump) app.chart.zoomToBand(app.results[app.pos].index, 0.6);
  updateResultState();
}

let resultTitle = '';
function renderResults(title) {
  if (title) resultTitle = title;
  const box = $('results');
  box.hidden = false;
  box.replaceChildren();
  const bands = app.data.bands;
  const n = app.results.length;
  box.append(
    el('h2', { text: resultTitle }),
    el('div', { class: 'detail-nav' },
      el('button', { type: 'button', text: '◀ 이전', onclick: () => stepResult(-1) }),
      el('span', { id: 'res-pos', class: 'pos' }),
      el('button', { type: 'button', text: '다음 ▶', onclick: () => stepResult(1) }),
      el('button', { type: 'button', class: 'quiet', text: '검색 지우기', onclick: () => { $('q').value = ''; clearSearch(); setMsg(''); } })),
  );
  const ul = el('ul', { class: 'result-list' });
  app.results.slice(0, 150).forEach((r, k) => {
    const b = bands[r.index];
    const hit = r.hits.filter((h) => h.field !== 'label' && h.field !== 'note').slice(0, 2);
    const text = hit.length ? hit.map((h) => h.text).join(' · ') : (b.uses[0] || b.services.map((s) => s.name).join(', '));
    ul.append(el('li', {}, el('button', { type: 'button', 'data-k': String(k), onclick: () => stepResult(k, true, true) },
      el('strong', { text: nameOf(b) }), el('span', { text }))));
  });
  box.append(ul);
  if (n > 150) box.append(el('p', { class: 'muted small', text: `처음 150개만 목록에 보입니다. 나머지는 차트의 강조 표시와 이전·다음 버튼으로 확인하세요.` }));
  updateResultState();
}

function updateResultState() {
  const p = $('res-pos');
  if (p) p.textContent = `${app.pos + 1} / ${app.results.length}`;
  document.querySelectorAll('#results .result-list button').forEach((b) => {
    const cur = Number(b.dataset.k) === app.pos;
    b.classList.toggle('cur', cur);
    if (cur) {
      // 목록 안에서만 움직인다. scrollIntoView는 페이지 전체를 끌어내려 차트가 화면 밖으로 나간다.
      const list = b.closest('.result-list');
      const li = b.parentElement;
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
  });
}

// ---- 시작 ----
function updateViewRange(v) {
  $('view-range').textContent = `보는 범위: ${formatHz(10 ** v.a, 4)} ~ ${formatHz(10 ** v.b, 4)}`;
  if (app.minimap) app.minimap.request();
}

function showTip(i, x, y) {
  const tip = $('tip');
  const b = app.data.bands[i];
  if (!b) { tip.hidden = true; return; }
  const names = (list) => list.map((s) => s.name).join(', ');
  const prim = names(b.services.filter((s) => s.primary));
  const sec = names(b.services.filter((s) => !s.primary));
  tip.replaceChildren(el('strong', { text: nameOf(b) }));
  if (prim) tip.append(el('div', { text: `1순위: ${prim}` }));
  if (sec) tip.append(el('div', { class: 'muted', text: `2순위: ${sec}` }));
  tip.hidden = false;
  const wrap = tip.parentElement.getBoundingClientRect();
  const left = Math.min(Math.max(x - wrap.left + 12, 4), Math.max(wrap.width - tip.offsetWidth - 4, 4));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.min(y - wrap.top + 16, wrap.height - tip.offsetHeight - 4)}px`;
}

function renderSource(d) {
  const s = d.source;
  const p = $('source');
  p.replaceChildren('출처: ');
  const name = [s.title, s.notice].filter(Boolean).join(' ');
  if (s.url) p.append(el('a', { href: s.url, rel: 'noopener', text: name || s.url }));
  else p.append(name || '정보 없음');
  if (s.effective) p.append(` (시행 ${s.effective})`);
  p.append('.');
}

async function start() {
  let data;
  try {
    data = await loadAllocations();
  } catch (e) {
    $('error').hidden = false;
    $('error').textContent = '데이터를 불러오지 못했습니다. data/allocations.json 이 있는지 확인하세요.';
    return;
  }
  app.data = data;
  app.index = buildIndex(data.bands);
  if (data.sample) {
    $('notice').hidden = false;
    $('notice').textContent = '샘플 데이터입니다. data/allocations.json 이 없어 일부 대역만 들어 있는 시험용 자료를 보여 주고 있습니다. 실제 분배표와 다를 수 있습니다.';
  }
  app.chart = new SpectrumChart($('chart'), {
    onSelect: (i) => selectBand(i),
    onHover: (i, x, y) => showTip(i, x, y),
    onView: updateViewRange,
    onTheme: () => app.minimap && app.minimap.request(),
  });
  app.minimap = new Minimap($('minimap'), app.chart);
  app.chart.setData(data.bands);
  renderLegend();
  renderDetail();
  renderSource(data);

  $('zoom-in').onclick = () => app.chart.zoomBy(0.5);
  $('zoom-out').onclick = () => app.chart.zoomBy(2);
  $('zoom-reset').onclick = () => app.chart.resetView();
  $('search').addEventListener('submit', (e) => { e.preventDefault(); doSearch($('q').value); });
  $('q').addEventListener('input', () => { if (!$('q').value.trim()) { clearSearch(); setMsg(''); } });
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { $('q').value = c.dataset.q; doSearch(c.dataset.q); }));

  loadFootnotes().then((notes) => { app.notes = notes; renderDetail(); });
  const fromHash = () => {
    const shared = new URLSearchParams(location.hash.slice(1)).get('q');
    if (shared && shared !== $('q').value.trim()) { $('q').value = shared; doSearch(shared); }
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
}

start();
