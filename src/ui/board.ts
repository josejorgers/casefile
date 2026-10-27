// The corkboard: draggable cards joined by red string. Pan by dragging the background, zoom with the wheel.
import { esc } from '../data';
import { K, setPlaceHint, toggleLink } from '../state';
import type { Card } from '../types';

export interface CardViewModel { cls: string; type: string; title: string; lines: string[]; flag?: boolean }

interface Hooks {
  view(c: Card): CardViewModel;
  onSelect(): void;
  onOpen(cid: string): void;
  onChange(): void;
}

const OFF = 5000; // the SVG layer is offset so strings can reach negative coordinates

type Drag = { type: 'card'; cid: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; shift: boolean }
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean };

class BoardView {
  selected: string | null = null;
  linkFrom: string | null = null;
  private drag: Drag | null = null;
  private el!: HTMLElement;
  private inner!: HTMLElement;
  private svg!: SVGSVGElement;
  private hooks!: Hooks;

  init(hooks: Hooks) {
    this.hooks = hooks;
    this.el = document.getElementById('board')!;
    this.inner = document.getElementById('boardInner')!;
    this.svg = document.getElementById('links') as unknown as SVGSVGElement;
    this.el.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', () => this.onUp());
    this.el.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.el.addEventListener('dblclick', e => {
      const n = (e.target as HTMLElement).closest<HTMLElement>('.card');
      if (n) hooks.onOpen(n.dataset.cid!);
    });
    setPlaceHint(() => this.viewCenter());
  }

  private get v() { return K.board.view; }
  applyView() {
    const v = this.v;
    this.inner.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    this.el.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }
  private toBoard(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect(), v = this.v;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  }
  viewCenter() {
    const r = this.el.getBoundingClientRect();
    return this.toBoard(r.left + r.width / 2, r.top + r.height / 2);
  }
  centerOn(cid: string) {
    const c = K.board.cards[cid];
    if (!c) return;
    const r = this.el.getBoundingClientRect(), v = this.v;
    v.x = r.width / 2 - (c.x + 85) * v.z;
    v.y = r.height / 2 - (c.y + 40) * v.z;
    this.applyView();
  }
  centerAll() {
    const cs = Object.values(K.board.cards), v = this.v;
    if (!cs.length) { v.x = 0; v.y = 0; v.z = 1; this.applyView(); return; }
    const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + 180, minY = Math.min(...ys), maxY = Math.max(...ys) + 110;
    const r = this.el.getBoundingClientRect();
    v.z = Math.max(0.3, Math.min(1.2, Math.min(r.width / (maxX - minX + 80), r.height / (maxY - minY + 80))));
    v.x = r.width / 2 - ((minX + maxX) / 2) * v.z;
    v.y = r.height / 2 - ((minY + maxY) / 2) * v.z;
    this.applyView();
  }

  private node(cid: string) { return this.inner.querySelector<HTMLElement>(`.card[data-cid="${cid}"]`); }

  render() {
    const cards = K.board.cards;
    this.inner.querySelectorAll<HTMLElement>('.card').forEach(n => { if (!cards[n.dataset.cid!]) n.remove(); });
    for (const c of Object.values(cards)) {
      let n = this.node(c.id);
      if (!n) { n = document.createElement('div'); n.dataset.cid = c.id; this.inner.appendChild(n); }
      const v = this.hooks.view(c);
      n.className = `card t-${v.cls}` + (c.id === this.selected ? ' sel' : '') + (c.id === this.linkFrom ? ' linking' : '') + (v.flag ? ' flag' : '');
      n.style.left = c.x + 'px';
      n.style.top = c.y + 'px';
      n.innerHTML = `<div class="pin"></div><div class="ctype">${esc(v.type)}</div><div class="ctitle">${esc(v.title)}</div>`
        + v.lines.filter(Boolean).map(l => `<div class="cline">${esc(l)}</div>`).join('');
    }
    this.drawLinks();
    this.applyView();
  }

  private anchor(cid: string) {
    const c = K.board.cards[cid], n = this.node(cid);
    if (!c) return null;
    return { x: c.x + (n ? n.offsetWidth : 170) / 2 + OFF, y: c.y + 8 + OFF };
  }
  private drawLinks() {
    let h = '';
    K.board.links.forEach((l, i) => {
      const a = this.anchor(l.a), b = this.anchor(l.b);
      if (!a || !b) return;
      const sag = Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
      const d = `M${a.x},${a.y} Q${(a.x + b.x) / 2},${(a.y + b.y) / 2 + sag} ${b.x},${b.y}`;
      h += `<g data-link="${i}"><path class="hit" d="${d}"/><path class="str" d="${d}"/></g>`;
    });
    this.svg.innerHTML = h;
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const link = t.closest<SVGGElement>('[data-link]');
    if (link) {
      const i = Number(link.dataset.link);
      if (K.board.links[i] && confirm('Cut this string?')) { K.board.links.splice(i, 1); this.drawLinks(); this.hooks.onChange(); }
      return;
    }
    const n = t.closest<HTMLElement>('.card');
    if (n) {
      const c = K.board.cards[n.dataset.cid!];
      this.drag = { type: 'card', cid: c.id, sx: e.clientX, sy: e.clientY, ox: c.x, oy: c.y, moved: false, shift: e.shiftKey };
      n.classList.add('dragging');
    } else {
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: this.v.x, oy: this.v.y, moved: false };
      this.el.classList.add('panning');
    }
    e.preventDefault();
  }
  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.type === 'card') {
      const c = K.board.cards[d.cid], z = this.v.z;
      c.x = Math.round(d.ox + dx / z); c.y = Math.round(d.oy + dy / z);
      const n = this.node(d.cid)!;
      n.style.left = c.x + 'px'; n.style.top = c.y + 'px';
      this.drawLinks();
    } else {
      this.v.x = d.ox + dx; this.v.y = d.oy + dy;
      this.applyView();
    }
  }
  private onUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.el.classList.remove('panning');
    this.inner.querySelectorAll('.dragging').forEach(n => n.classList.remove('dragging'));
    if (d.type === 'card' && !d.moved) this.clickCard(d.cid, d.shift);
    else if (d.type === 'pan' && !d.moved) { this.linkFrom = null; this.select(null); }
    this.hooks.onChange();
  }
  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const v = this.v, r = this.el.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const nz = Math.max(0.25, Math.min(2, v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    v.x = px - (px - v.x) * (nz / v.z);
    v.y = py - (py - v.y) * (nz / v.z);
    v.z = nz;
    this.applyView();
  }

  private clickCard(cid: string, shift: boolean) {
    const from = this.linkFrom || (shift ? this.selected : null);
    if (from && from !== cid) {
      toggleLink(from, cid);
      this.linkFrom = null;
      this.render();
      return;
    }
    this.linkFrom = null;
    this.select(cid);
  }
  select(cid: string | null) {
    this.selected = cid;
    this.render();
    this.hooks.onSelect();
  }
}

export const Board = new BoardView();
