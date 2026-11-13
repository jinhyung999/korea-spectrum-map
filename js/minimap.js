// 전체 스펙트럼 개요 줄. 현재 보는 범위를 표시하고, 누르거나 끌어서 이동한다.
import { panView } from './scale.js';

export class Minimap {
  constructor(canvas, chart) {
    this.canvas = canvas;
    this.chart = chart;
    this.ctx = canvas.getContext('2d');
    this.dirty = false;
    this.size = { w: 300, h: 34, dpr: 1 };
    new ResizeObserver(() => this.resize()).observe(canvas);
    const move = (e) => {
      const r = canvas.getBoundingClientRect();
      const { min, max } = chart.limits;
      const log = min + ((e.clientX - r.left) / r.width) * (max - min);
      const v = chart.view;
      const center = (v.a + v.b) / 2;
      chart.setView(panView(v, chart.limits, (log - center) / (v.b - v.a)));
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      move(e);
    });
    canvas.addEventListener('pointermove', (e) => this.dragging && move(e));
    canvas.addEventListener('pointerup', () => (this.dragging = false));
    canvas.addEventListener('pointercancel', () => (this.dragging = false));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.size = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
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

  draw() {
    const { ctx, chart } = this;
    const { w, h, dpr } = this.size;
    const C = chart.colors;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, w, h);
    const { min, max } = chart.limits;
    const sx = (hz) => ((Math.log10(hz) - min) / (max - min)) * w;
    chart.bands.forEach((b, i) => {
      const m = chart.meta[i];
      const f = (m.prim[0] || m.sec[0] || {}).fam;
      const x = sx(b.lo);
      ctx.fillStyle = f ? C[f] : C.grid;
      ctx.fillRect(x, 4, Math.max(sx(b.hi) - x, 1), h - 8);
    });
    const v = chart.view;
    const x1 = ((v.a - min) / (max - min)) * w;
    const x2 = ((v.b - min) / (max - min)) * w;
    ctx.fillStyle = C.surface;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, x1, h);
    ctx.fillRect(x2, 0, w - x2, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1 + 1, 1, Math.max(x2 - x1 - 2, 2), h - 2);
    ctx.lineWidth = 1;
  }
}
