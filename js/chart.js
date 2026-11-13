// 캔버스 스펙트럼 차트. 보이는 밴드만 그리고, 입력(휠·드래그·핀치·키보드)을 처리한다.
import { FAMILIES, familyOf } from './families.js';
import {
  makeLimits, fullView, clampView, zoomView, panView, viewFor,
  xOf, hzAt, visibleRange, bandIndexAt, ticks,
} from './scale.js';

const AXIS_H = 32;
const LABEL_H = 17;
const PAD_B = 6;
const GAP = 2;
const PRIMARY_FRAC = 0.62;

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

export class SpectrumChart {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.h = handlers; // onSelect(i), onHover(i, clientX, clientY), onView(view)
    this.bands = [];
    this.meta = [];
    this.view = { a: 3, b: 12 };
    this.limits = { min: 3, max: 12, minSpan: 1e-4 };
    this.selected = -1;
    this.highlights = new Set();
    this.active = new Set();
    this.marker = null; // {lo, hi}
    this.hover = -1;
    this.colors = {};
    this.patterns = new Map();
    this.size = { w: 300, h: 300, dpr: 1 };
    this.pointers = new Map();
    this.dirty = false;
    this.anim = 0;
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.refreshColors();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.refreshColors());
  }

  setData(bands) {
    this.bands = bands;
    this.meta = bands.map((b) => {
      const prim = [];
      const sec = [];
      for (const s of b.services) (s.primary ? prim : sec).push({ name: s.name, fam: familyOf(s.name) });
      return { prim, sec, fams: new Set([...prim, ...sec].map((x) => x.fam)) };
    });
    this.limits = makeLimits(bands);
    this.setView(fullView(this.limits));
  }

  refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim() || '#888888';
    this.colors = { surface: get('--surface'), ink: get('--ink'), muted: get('--muted'), grid: get('--grid'), axis: get('--axis'), accent: get('--accent'), mark: get('--mark') };
    for (const f of FAMILIES) this.colors[f.id] = get(`--fam-${f.id}`);
    this.patterns.clear();
    this.request();
    if (this.h.onTheme) this.h.onTheme();
  }

  // ---- 상태 ----
  setView(v, notify = true) {
    this.view = clampView(v, this.limits);
    this.request();
    if (notify && this.h.onView) this.h.onView(this.view);
  }

  animateTo(target) {
    cancelAnimationFrame(this.anim);
    const from = this.view;
    const to = clampView(target, this.limits);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return this.setView(to);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 320);
      const e = 1 - (1 - k) ** 3;
      this.setView({ a: from.a + (to.a - from.a) * e, b: from.b + (to.b - from.b) * e });
      if (k < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  zoomToBand(i, margin = 0.25) {
    const b = this.bands[i];
    if (b) this.animateTo(viewFor(b.lo, b.hi, this.limits, margin));
  }

  zoomToRange(lo, hi, margin = 0.15) {
    this.animateTo(viewFor(lo, hi, this.limits, margin));
  }

  resetView() {
    this.animateTo(fullView(this.limits));
  }

  zoomBy(factor, anchor = 0.5) {
    cancelAnimationFrame(this.anim);
    this.setView(zoomView(this.view, this.limits, factor, anchor));
  }

  panBy(fraction) {
    cancelAnimationFrame(this.anim);
    this.setView(panView(this.view, this.limits, fraction));
  }

  /** 밴드가 화면에 충분히 보이지 않으면 그쪽으로 이동한다. */
  reveal(i) {
    const b = this.bands[i];
    if (!b) return;
    const w = this.size.w;
    const x1 = xOf(this.view, w, b.lo);
    const x2 = xOf(this.view, w, b.hi);
    const visible = x2 > 0 && x1 < w;
    const wide = x2 - x1 >= 24 && x2 - x1 <= w * 0.9;
    if (visible && (wide || (x2 - x1 > w * 0.9 && x1 < w && x2 > 0))) return;
    this.zoomToBand(i, 0.6);
  }

  setSelected(i) { this.selected = i; this.request(); }
  setHighlights(set) { this.highlights = set; this.request(); }
  setActive(set) { this.active = set; this.request(); }
  setMarker(m) { this.marker = m; this.request(); }

  // ---- 그리기 ----
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.patterns.clear();
    this.request();
  }

  request() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => {
      this.dirty = false;
      this.draw();
    });
  }

  hatch(fam) {
    const key = fam;
    let p = this.patterns.get(key);
    if (p) return p;
    const { dpr } = this.size;
    const s = Math.round(8 * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = this.colors[fam];
    g.globalAlpha = 0.16;
    g.fillRect(0, 0, s, s);
    g.globalAlpha = 1;
    g.strokeStyle = this.colors[fam];
    g.lineWidth = 1.6 * dpr;
    g.beginPath();
    g.moveTo(-1, s + 1);
    g.lineTo(s + 1, -1);
    g.moveTo(-1 - s / 2, s / 2 + 1);
    g.lineTo(s / 2 + 1, -1 - s / 2);
    g.moveTo(s / 2 - 1, s + 1 + s / 2);
    g.lineTo(s + 1 + s / 2, s / 2 - 1);
    g.stroke();
    p = this.ctx.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix().scale(1 / dpr));
    this.patterns.set(key, p);
    return p;
  }

  layout() {
    const { h } = this.size;
    const bodyTop = AXIS_H + LABEL_H;
    const bottom = h - PAD_B;
    const bodyH = bottom - bodyTop;
    const pH = Math.round(bodyH * PRIMARY_FRAC);
    return { labelTop: AXIS_H, bodyTop, pH, sTop: bodyTop + pH + GAP, bottom };
  }

  draw() {
    const { ctx, size, colors: C, view } = this;
    const { w, h, dpr } = size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, w, h);
    const L = this.layout();
    this.drawAxis(L);
    if (!this.bands.length) return;

    const filtering = this.active.size > 0;
    const hl = this.highlights.size > 0;
    const { first, last } = visibleRange(this.bands, view);
    ctx.font = '11px system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    ctx.textBaseline = 'middle';

    for (let i = first; i <= last; i++) {
      const b = this.bands[i];
      const m = this.meta[i];
      const x1 = xOf(view, w, b.lo);
      const x2 = xOf(view, w, b.hi);
      const bw = x2 - x1;
      const gap = bw > 4 ? 1 : 0;
      const x = Math.max(x1, -2) + gap / 2;
      const wd = Math.max(Math.min(x2, w + 2) - Math.max(x1, -2) - gap, 1);
      const bandAlpha = hl && !this.highlights.has(i) ? 0.25 : 1;

      this.drawStripes(m.prim, x, L.bodyTop, wd, L.pH, false, bandAlpha, filtering, bw);
      if (m.sec.length) this.drawStripes(m.sec, x, L.sTop, wd, L.bottom - L.sTop, true, bandAlpha, filtering, bw);
      if (!m.prim.length && !m.sec.length) {
        ctx.globalAlpha = bandAlpha * 0.6;
        ctx.strokeStyle = C.axis;
        ctx.strokeRect(x + 0.5, L.bodyTop + 0.5, Math.max(wd - 1, 0), L.pH - 1);
        ctx.globalAlpha = 1;
      }
      if (bw >= 44 && b.shown) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, L.labelTop, wd, LABEL_H);
        ctx.clip();
        ctx.globalAlpha = bandAlpha;
        ctx.fillStyle = C.ink;
        ctx.fillText(b.shown,Math.max(x1, 0) + 4 > x + wd - 8 ? x + 2 : Math.max(x, 0) + 4, L.labelTop + LABEL_H / 2);
        ctx.restore();
      }
      if (i === this.hover && i !== this.selected) {
        ctx.strokeStyle = C.ink;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, L.bodyTop - 0.5, Math.max(wd - 1, 1), L.bottom - L.bodyTop + 1);
        ctx.globalAlpha = 1;
      }
      if (hl && this.highlights.has(i) && i !== this.selected) {
        ctx.strokeStyle = C.mark;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, L.bodyTop - 1, Math.max(wd - 2, 1), L.bottom - L.bodyTop + 2);
        ctx.lineWidth = 1;
      }
    }
    if (this.selected >= first && this.selected <= last) {
      const b = this.bands[this.selected];
      const x1 = Math.max(xOf(view, w, b.lo), -2);
      const x2 = Math.min(xOf(view, w, b.hi), w + 2);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(x1 + 1.5, L.bodyTop - 2, Math.max(x2 - x1 - 3, 1), L.bottom - L.bodyTop + 4);
      ctx.lineWidth = 1;
    }
    if (this.marker) this.drawMarker(L);
  }

  drawStripes(list, x, y, wd, hgt, hatch, alpha, filtering, bw) {
    const { ctx, colors: C } = this;
    if (!list.length || hgt <= 0) return;
    const n = list.length;
    const sh = hgt / n;
    for (let k = 0; k < n; k++) {
      const s = list[k];
      const sy = y + k * sh;
      const on = !filtering || this.active.has(s.fam);
      ctx.globalAlpha = alpha * (on ? 1 : 0.14);
      ctx.fillStyle = hatch ? this.hatch(s.fam) : C[s.fam];
      ctx.fillRect(x, sy, wd, Math.max(sh - (n > 1 && sh > 4 ? 1 : 0), 1));
      if (bw >= 56 && sh >= 13 && on) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, sy, wd, sh);
        ctx.clip();
        ctx.fillStyle = hatch || luminance(C[s.fam]) > 0.42 ? C.ink : '#ffffff';
        ctx.fillText(s.name, Math.max(x, 0) + 4, sy + sh / 2 + 0.5);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawAxis(L) {
    const { ctx, colors: C, view } = this;
    const { w } = this.size;
    ctx.strokeStyle = C.axis;
    ctx.fillStyle = C.muted;
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, "Malgun Gothic", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const bottom = L.bottom;
    for (const t of ticks(view, w)) {
      const x = Math.round(t.x * w) + 0.5;
      ctx.globalAlpha = t.label ? 0.55 : 0.25;
      ctx.beginPath();
      ctx.moveTo(x, t.label || t.major ? 20 : 26);
      ctx.lineTo(x, bottom);
      ctx.strokeStyle = t.label ? C.axis : C.grid;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (t.label) {
        const tw = ctx.measureText(t.label).width;
        const lx = Math.min(Math.max(x, tw / 2 + 2), w - tw / 2 - 2);
        ctx.fillText(t.label, lx, 14);
      }
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = C.axis;
    ctx.beginPath();
    ctx.moveTo(0, AXIS_H - 0.5);
    ctx.lineTo(w, AXIS_H - 0.5);
    ctx.stroke();
  }

  drawMarker(L) {
    const { ctx, colors: C, view } = this;
    const { w } = this.size;
    const m = this.marker;
    ctx.fillStyle = C.mark;
    ctx.strokeStyle = C.mark;
    if (m.hi > m.lo) {
      const x1 = xOf(view, w, m.lo);
      const x2 = xOf(view, w, m.hi);
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x1, AXIS_H, Math.max(x2 - x1, 1), L.bottom - AXIS_H);
      ctx.globalAlpha = 1;
      ctx.fillRect(x1 - 0.5, AXIS_H, 1.5, L.bottom - AXIS_H);
      ctx.fillRect(x2 - 0.5, AXIS_H, 1.5, L.bottom - AXIS_H);
    } else {
      const x = xOf(view, w, m.lo);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H - 6);
      ctx.lineTo(x, L.bottom);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 5, AXIS_H - 8);
      ctx.lineTo(x + 5, AXIS_H - 8);
      ctx.lineTo(x, AXIS_H - 1);
      ctx.fill();
    }
  }

  // ---- 입력 ----
  hit(x, y) {
    if (!this.bands.length) return -1;
    const L = this.layout();
    if (y < L.labelTop || y > L.bottom) return -1;
    return bandIndexAt(this.bands, hzAt(this.view, this.size.w, x));
  }

  localX(e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  localY(e) {
    return e.clientY - this.canvas.getBoundingClientRect().top;
  }

  bindEvents() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const w = this.size.w;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.panBy(((e.deltaX || e.deltaY) / w) * 0.8);
        return;
      }
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0016;
      this.zoomBy(Math.exp(e.deltaY * unit * k), this.localX(e) / w);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      c.focus({ preventScroll: true });
      cancelAnimationFrame(this.anim);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.gesture = { moved: this.pointers.size > 1, sx: e.clientX, sy: e.clientY, multi: this.pointers.size > 1 };
      if (this.pointers.size === 2) this.pinch = this.pinchState();
      c.classList.add('grabbing');
    });

    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        const i = this.hit(this.localX(e), this.localY(e));
        if (i !== this.hover) {
          this.hover = i;
          this.request();
        }
        if (this.h.onHover) this.h.onHover(i, e.clientX, e.clientY);
        return;
      }
      const w = this.size.w;
      if (this.pointers.size === 1) {
        const dx = e.clientX - p.x;
        if (Math.abs(e.clientX - this.gesture.sx) + Math.abs(e.clientY - this.gesture.sy) > 5) this.gesture.moved = true;
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.gesture.moved) {
          this.setView(panView(this.view, this.limits, -dx / w));
          if (this.h.onHover) this.h.onHover(-1);
        }
      } else if (this.pointers.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const now = this.pinchState();
        const rect = c.getBoundingClientRect();
        const factor = this.pinch.dist / Math.max(now.dist, 1);
        let v = zoomView(this.view, this.limits, factor, (this.pinch.cx - rect.left) / w);
        v = panView(v, this.limits, -(now.cx - this.pinch.cx) / w);
        this.pinch = now;
        this.setView(v);
      }
    });

    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) this.pinch = null;
      if (this.pointers.size === 0) {
        c.classList.remove('grabbing');
        const g = this.gesture;
        if (e.type === 'pointerup' && g && !g.moved) {
          const i = this.hit(this.localX(e), this.localY(e));
          if (i >= 0 && this.h.onSelect) this.h.onSelect(i);
        }
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (this.hover !== -1 && this.pointers.size === 0) {
        this.hover = -1;
        this.request();
        if (this.h.onHover) this.h.onHover(-1);
      }
    });

    c.addEventListener('dblclick', (e) => {
      const i = this.hit(this.localX(e), this.localY(e));
      if (i >= 0) this.zoomToBand(i);
      else this.zoomBy(0.5, this.localX(e) / this.size.w);
    });

    c.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.5 : 0.12;
      switch (e.key) {
        case 'ArrowLeft': this.panBy(-step); break;
        case 'ArrowRight': this.panBy(step); break;
        case 'ArrowUp': case '+': case '=': this.zoomBy(0.7); break;
        case 'ArrowDown': case '-': case '_': this.zoomBy(1 / 0.7); break;
        case 'Home': case '0': this.resetView(); break;
        case '[': case 'PageUp': this.stepSelection(-1); break;
        case ']': case 'PageDown': this.stepSelection(1); break;
        case 'Enter': if (this.selected >= 0) this.zoomToBand(this.selected); break;
        default: return;
      }
      e.preventDefault();
    });
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2 };
  }

  stepSelection(d) {
    if (!this.bands.length) return;
    let i = this.selected < 0 ? bandIndexAt(this.bands, 10 ** ((this.view.a + this.view.b) / 2)) : this.selected + d;
    i = Math.min(Math.max(i, 0), this.bands.length - 1);
    if (this.h.onSelect) this.h.onSelect(i);
  }
}
