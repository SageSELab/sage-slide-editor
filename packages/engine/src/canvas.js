// canvas.js — the editing overlay for the app's canvas (PLAN 5.3, 12.4).
//
// Injected by the Mac app into the compiled film only in edit mode; never part of a build, a
// presentation, or a published file. It selects, moves, resizes and edits the text of objects
// (elements with an id) and reports every change to the host as one precise message; the host
// writes the source through the sidecar (talk.edit) and reloads. Nothing here writes files.
//
// Messages (posted to window.webkit.messageHandlers.sage as {kind: 'canvas', ...msg}, or to
// opts.post(msg)). Numbers are stage px (the 1920x1080 stage); left/top are the element's
// CSS left/top (its offset parent's coordinates, which for a top-level positioned object are
// the stage's), rounded to whole px:
//   {type: 'select', id: null}                                  selection cleared
//   {type: 'select', id, tag, left, top, width, height, fontSize, movable, editable, html, src}
//   {type: 'move', id, left, top}                               drag ended, or nudges settled
//   {type: 'resize', id, left, top, width, height}              handle drag ended
//   {type: 'text', id, html}                                    in-place text committed (changed)
//   {type: 'refused', id, reason}                               'block-children': text edit refused
//
// Selection: the topmost element with an id at the point whose own effective opacity is at
// least 0.05 (an element at opacity 0 is skipped and the one beneath considered). Scene
// containers (.scene) and full-stage backgrounds (#black and the like) are never selected.
// Snapping (hold Cmd to disable): to other visible objects' edges and centres and the stage's,
// within 8 px, with guides; otherwise to a 10 px grid. Keys while something is selected:
// arrows nudge 1 px (Shift: 10 px), Enter edits text, Escape deselects, Tab cycles objects.
// While editing text: Escape cancels, Enter or a click elsewhere (blur) commits.
(function () {
  'use strict';
  if (window.SageCanvas) return;

  const W = 1920, H = 1080;
  const INLINE = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'CODE', 'BR', 'U', 'SUB', 'SUP', 'A', 'MARK', 'S']);
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const MIN_OPACITY = 0.05;
  const DRAG_START = 3; // screen px before a press becomes a drag

  const round = (v) => Math.round(v);
  const r2 = (v) => Math.round(v * 100) / 100;

  const C = {
    on: false,
    sel: null,
    editing: null,
    opts: null,
    stage: null,
    film: null,
    overlay: null,
    drag: null,
    nudge: null,
    prevOnRender: null,

    // --- lifecycle ---------------------------------------------------------------------

    enable(opts = {}) {
      if (this.on) return;
      this.stage = document.querySelector('.stage');
      this.film = document.querySelector('.film');
      if (!this.stage || !this.film) return;
      this.opts = Object.assign({ grid: 10, snap: 8, nudgeDelay: 300, post: null }, opts);
      this.on = true;
      window.T?.pause?.();
      this.buildOverlay();
      for (const [type, fn] of this.listeners()) window.addEventListener(type, fn, true);
      const T = window.T;
      if (T) {
        this.prevOnRender = T.onRender;
        T.onRender = (t) => { this.prevOnRender?.(t); this.update(); };
      }
      this.film.classList.add('sage-canvas-on');
      this.update();
    },

    disable() {
      if (!this.on) return;
      this.flushNudge();
      if (this.editing) this.cancelText();
      for (const [type, fn] of this.listeners()) window.removeEventListener(type, fn, true);
      if (window.T) window.T.onRender = this.prevOnRender;
      this.prevOnRender = null;
      this.overlay?.remove();
      this.overlay = null;
      this.film.classList.remove('sage-canvas-on');
      this.on = false;
      this.sel = null;
      this.drag = null;
    },

    listeners() {
      if (!this._ls) {
        this._ls = [
          ['pointerdown', (e) => this.onDown(e)], ['pointermove', (e) => this.onMove(e)], ['pointerup', (e) => this.onUp(e)],
          ['click', (e) => this.onClick(e)], ['dblclick', (e) => this.onDblClick(e)], ['keydown', (e) => this.onKey(e)],
          ['resize', () => this.update()],
        ];
      }
      return this._ls;
    },

    post(msg) {
      if (this.opts?.post) return this.opts.post(msg);
      try { window.webkit.messageHandlers.sage.postMessage(Object.assign({ kind: 'canvas' }, msg)); } catch (e) { /* no host */ }
    },

    // --- geometry ----------------------------------------------------------------------

    geom() {
      const r = this.stage.getBoundingClientRect();
      return { x: r.left, y: r.top, k: r.width / W || 1 };
    },
    toStage(cx, cy) { const g = this.geom(); return { x: (cx - g.x) / g.k, y: (cy - g.y) / g.k }; },
    /** The element's box in stage px (transforms included). */
    rectOf(el) {
      const g = this.geom(), b = el.getBoundingClientRect();
      return { x: (b.left - g.x) / g.k, y: (b.top - g.y) / g.k, w: b.width / g.k, h: b.height / g.k };
    },
    /** Stage px per CSS px of the element's own coordinates (a scaled ancestor, e.g. a camera). */
    unit(el) {
      const p = el.offsetParent;
      if (!p || p === this.stage || !this.stage.contains(p) || !p.offsetWidth) return 1;
      return this.rectOf(p).w / p.offsetWidth || 1;
    },
    /** CSS box: left/top as the element's inline-positioning values, width/height in CSS px. */
    box(el) {
      const cs = getComputedStyle(el);
      let left = parseFloat(cs.left), top = parseFloat(cs.top);
      if (!Number.isFinite(left)) left = el.offsetLeft ?? 0;
      if (!Number.isFinite(top)) top = el.offsetTop ?? 0;
      const r = this.rectOf(el), u = this.unit(el);
      const width = el.offsetWidth ?? r.w / u, height = el.offsetHeight ?? r.h / u;
      return { left, top, width, height };
    },

    // --- what can be selected ------------------------------------------------------------

    opacity(el) {
      let o = 1;
      for (let n = el; n && n !== this.stage; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
        o *= parseFloat(cs.opacity);
        if (o < MIN_OPACITY) return o;
      }
      return o;
    },
    visible(el) { return this.opacity(el) >= MIN_OPACITY; },
    /** True when the element draws something itself (text, an image, a background, a border). */
    paints(el) {
      if (el instanceof SVGElement || /^(IMG|CANVAS|VIDEO|INPUT|TEXTAREA|IFRAME)$/.test(el.tagName)) return true;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return true;
      const cs = getComputedStyle(el);
      const seen = (c) => !/^(transparent|rgba\(.*,\s*0\))$/.test(c);
      return seen(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
        ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && seen(cs[`border${s}Color`]));
    },
    isBackground(el) { const r = this.rectOf(el); return r.w >= W * 0.98 && r.h >= H * 0.98; },
    selectable(el) {
      return !!(el && el.id && el !== this.stage && this.stage.contains(el) && !el.classList.contains('scene') &&
        !el.closest('#slideno') && !this.isBackground(el) && this.visible(el));
    },
    movable(el) { return !(el instanceof SVGElement) && getComputedStyle(el).position !== 'static'; },
    editable(el) {
      if (el instanceof SVGElement || el.closest('svg') || !el.textContent.trim()) return false;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      for (const c of el.children) { if (!INLINE.has(c.tagName)) return false; if (!ownText && c.hasAttribute('data-a')) return false; }
      return true;
    },

    /** Id of the topmost selectable object at a stage point, or null. */
    hitTest(x, y) {
      const g = this.geom();
      for (const e of document.elementsFromPoint(g.x + x * g.k, g.y + y * g.k)) {
        if (!this.stage.contains(e) || e === this.stage) continue;
        // invisible at this time, or an empty container whose content is hidden: look beneath it
        if (!this.visible(e) || !this.paints(e)) continue;
        for (let n = e; n && n !== this.stage; n = n.parentElement) {
          if (this.selectable(n)) return n.id;
        }
      }
      return null;
    },

    /** Visible selectable objects that show something, in document order (Tab, snapping). */
    objects() {
      const shows = (el) => this.paints(el) || [...el.querySelectorAll('*')].some((c) => this.paints(c) && this.visible(c));
      return [...this.stage.querySelectorAll('[id]')].filter((el) => this.selectable(el) && shows(el));
    },

    el(id) { return id ? document.getElementById(id) : null; },

    // --- selection -----------------------------------------------------------------------

    info(id) {
      const el = this.el(id);
      if (!el) return null;
      const b = this.box(el), cs = getComputedStyle(el), editable = this.editable(el);
      return {
        type: 'select', id, tag: el.tagName.toLowerCase(),
        left: r2(b.left), top: r2(b.top), width: r2(b.width), height: r2(b.height),
        fontSize: r2(parseFloat(cs.fontSize) || 0), movable: this.movable(el), editable,
        html: editable ? el.innerHTML : null, src: el.tagName === 'IMG' ? el.getAttribute('src') : null,
      };
    },

    /** Selects #id (null clears). `silent` restores a selection without telling the host. */
    select(id, { silent = false } = {}) {
      if (!this.on) return null;
      if (id && !this.el(id)) id = null;
      if (id !== this.sel) { this.flushNudge(); if (this.editing) this.commitText(); }
      this.sel = id;
      this.update();
      const msg = id ? this.info(id) : { type: 'select', id: null };
      if (!silent) this.post(msg);
      return msg;
    },

    selection() { return this.sel; },

    // --- overlay -------------------------------------------------------------------------

    buildOverlay() {
      const o = document.createElement('div');
      o.className = 'sage-canvas-overlay';
      o.setAttribute('aria-hidden', 'true');
      o.style.cssText = `position:absolute;left:50%;top:50%;width:${W}px;height:${H}px;transform-origin:50% 50%;pointer-events:none;z-index:2147483646;overflow:visible`;
      o.innerHTML = '<div class="sc-box"></div>' + HANDLES.map((h) => `<div class="sc-h" data-h="${h}"></div>`).join('') + '<div class="sc-gx"></div><div class="sc-gy"></div>';
      const css = document.createElement('style');
      css.textContent = `
        .sage-canvas-overlay .sc-box { position:absolute; display:none; box-sizing:border-box; outline:var(--sc-line) solid #0a84ff; }
        .sage-canvas-overlay .sc-h { position:absolute; display:none; box-sizing:border-box; width:var(--sc-hs); height:var(--sc-hs); margin:calc(var(--sc-hs) / -2) 0 0 calc(var(--sc-hs) / -2); background:#fff; border:var(--sc-line) solid #0a84ff; border-radius:2px; pointer-events:auto; }
        .sage-canvas-overlay .sc-h[data-h=nw], .sage-canvas-overlay .sc-h[data-h=se] { cursor:nwse-resize; }
        .sage-canvas-overlay .sc-h[data-h=ne], .sage-canvas-overlay .sc-h[data-h=sw] { cursor:nesw-resize; }
        .sage-canvas-overlay .sc-h[data-h=n], .sage-canvas-overlay .sc-h[data-h=s] { cursor:ns-resize; }
        .sage-canvas-overlay .sc-h[data-h=e], .sage-canvas-overlay .sc-h[data-h=w] { cursor:ew-resize; }
        .sage-canvas-overlay .sc-gx, .sage-canvas-overlay .sc-gy { position:absolute; display:none; background:#ff2d78; }
        .sage-canvas-overlay .sc-gx { top:0; height:${H}px; width:var(--sc-line); }
        .sage-canvas-overlay .sc-gy { left:0; width:${W}px; height:var(--sc-line); }
        .film.sage-canvas-on .stage [contenteditable] { outline: none; cursor: text; user-select: text; -webkit-user-select: text; }
        .film.sage-canvas-on .stage { cursor: default; }`;
      o.appendChild(css);
      this.film.appendChild(o);
      this.overlay = o;
    },

    /** Redraws the selection box and handles over the selected element. */
    update() {
      const o = this.overlay;
      if (!o) return;
      o.style.transform = this.stage.style.transform;
      const k = this.geom().k;
      o.style.setProperty('--sc-line', `${2 / k}px`);
      o.style.setProperty('--sc-hs', `${10 / k}px`);
      const el = this.el(this.sel), box = o.querySelector('.sc-box');
      const hs = o.querySelectorAll('.sc-h');
      if (!el) { box.style.display = 'none'; hs.forEach((h) => (h.style.display = 'none')); return; }
      const r = this.rectOf(el);
      Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      const show = this.movable(el) && !this.editing;
      hs.forEach((h) => {
        const k2 = h.dataset.h;
        const x = k2.includes('w') ? r.x : k2.includes('e') ? r.x + r.w : r.x + r.w / 2;
        const y = k2.includes('n') ? r.y : k2.includes('s') ? r.y + r.h : r.y + r.h / 2;
        Object.assign(h.style, { display: show ? 'block' : 'none', left: `${x}px`, top: `${y}px` });
      });
    },

    guides(gx, gy) {
      const x = this.overlay?.querySelector('.sc-gx'), y = this.overlay?.querySelector('.sc-gy');
      if (!x || !y) return;
      x.style.display = gx == null ? 'none' : 'block';
      y.style.display = gy == null ? 'none' : 'block';
      if (gx != null) x.style.left = `${gx}px`;
      if (gy != null) y.style.top = `${gy}px`;
    },

    // --- snapping --------------------------------------------------------------------------

    /** Snap lines (stage px) from the stage and every other visible object. */
    targets(exclude) {
      const xs = [0, W / 2, W], ys = [0, H / 2, H];
      for (const o of this.objects()) {
        if (o === exclude || o.contains(exclude) || exclude.contains(o)) continue;
        const r = this.rectOf(o);
        xs.push(r.x, r.x + r.w / 2, r.x + r.w);
        ys.push(r.y, r.y + r.h / 2, r.y + r.h);
      }
      return { xs, ys };
    },
    /** Best offset bringing any of `edges` onto any of `lines`, within the snap distance. */
    nearest(edges, lines) {
      let best = null;
      for (const e of edges) for (const l of lines) {
        const d = l - e;
        if (Math.abs(d) <= this.opts.snap && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l };
      }
      return best;
    },

    // --- pointer ------------------------------------------------------------------------

    inStage(e) {
      const p = this.toStage(e.clientX, e.clientY);
      return p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
    },

    onDown(e) {
      if (e.button !== 0) return;
      const handle = e.target?.closest?.('.sage-canvas-overlay .sc-h');
      if (this.editing) {
        if (this.editing.el.contains(e.target)) return; // caret placement inside the edited text
        this.commitText();
      }
      if (!handle && !this.inStage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.flushNudge();
      const p = this.toStage(e.clientX, e.clientY);
      if (handle && this.sel) return this.startDrag(e, this.el(this.sel), handle.dataset.h);
      const id = this.hitTest(p.x, p.y);
      if (id !== this.sel) this.select(id);
      if (id) this.startDrag(e, this.el(id), null);
    },

    startDrag(e, el, handle) {
      this.drag = {
        el, handle, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId,
        box: this.box(el), rect: this.rectOf(el), unit: this.unit(el), canMove: this.movable(el),
      };
      try { e.target.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic events */ }
    },

    onMove(e) {
      const d = this.drag;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      if (!d.canMove) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START) return;
      d.moved = true;
      const k = this.geom().k;
      const dx = (e.clientX - d.x0) / k, dy = (e.clientY - d.y0) / k; // stage px
      const r = d.handle ? this.resizeTo(d, dx, dy, !e.metaKey) : this.moveTo(d, dx, dy, !e.metaKey);
      d.result = r;
      const s = d.el.style;
      s.left = `${r.left}px`; s.top = `${r.top}px`;
      if (d.handle) { s.width = `${r.width}px`; s.height = `${r.height}px`; }
      this.update();
    },

    /** New left/top for a move by (dx, dy) stage px, snapped. */
    moveTo(d, dx, dy, snap) {
      const u = d.unit, R = d.rect;
      let left = d.box.left + dx / u, top = d.box.top + dy / u, gx = null, gy = null;
      if (snap) {
        const t = this.targets(d.el);
        const sx = this.nearest([R.x + dx, R.x + dx + R.w / 2, R.x + dx + R.w], t.xs);
        const sy = this.nearest([R.y + dy, R.y + dy + R.h / 2, R.y + dy + R.h], t.ys);
        const g = this.opts.grid;
        if (sx) { left = d.box.left + (dx + sx.d) / u; gx = sx.line; } else left = Math.round(left / g) * g;
        if (sy) { top = d.box.top + (dy + sy.d) / u; gy = sy.line; } else top = Math.round(top / g) * g;
      }
      this.guides(gx, gy);
      return { left: round(left), top: round(top), width: round(d.box.width), height: round(d.box.height) };
    },

    /** New box for dragging handle d.handle by (dx, dy) stage px; the opposite edges stay put. */
    resizeTo(d, dx, dy, snap) {
      const u = d.unit, b = d.box, R = d.rect, h = d.handle, g = this.opts.grid;
      const t = snap ? this.targets(d.el) : null;
      let gx = null, gy = null;
      // the moving edge in CSS px of the element's coordinates, snapped
      const edge = (css0, delta, stage0, lines, setGuide) => {
        let v = css0 + delta / u;
        if (snap) {
          const s = this.nearest([stage0 + delta], lines);
          if (s) { v = css0 + (delta + s.d) / u; setGuide(s.line); } else v = Math.round(v / g) * g;
        }
        return v;
      };
      let left = b.left, top = b.top, right = b.left + b.width, bottom = b.top + b.height;
      if (h.includes('w')) left = Math.min(edge(b.left, dx, R.x, t?.xs, (l) => (gx = l)), right - 1);
      if (h.includes('e')) right = Math.max(edge(right, dx, R.x + R.w, t?.xs, (l) => (gx = l)), left + 1);
      if (h.includes('n')) top = Math.min(edge(b.top, dy, R.y, t?.ys, (l) => (gy = l)), bottom - 1);
      if (h.includes('s')) bottom = Math.max(edge(bottom, dy, R.y + R.h, t?.ys, (l) => (gy = l)), top + 1);
      this.guides(gx, gy);
      left = round(left); top = round(top);
      return { left, top, width: round(right) - left, height: round(bottom) - top };
    },

    onUp(e) {
      const d = this.drag;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.drag = null;
      this.guides(null, null);
      if (!d.moved || !d.result) return;
      const r = d.result, id = d.el.id;
      if (d.handle) this.post({ type: 'resize', id, left: r.left, top: r.top, width: r.width, height: r.height });
      else if (r.left !== round(d.box.left) || r.top !== round(d.box.top)) this.post({ type: 'move', id, left: r.left, top: r.top });
      this.update();
    },

    onClick(e) {
      // The engine advances on a stage click; in edit mode a click only selects.
      if (this.editing?.el.contains(e.target)) return;
      if (this.inStage(e) || e.target?.closest?.('.sage-canvas-overlay')) { e.preventDefault(); e.stopPropagation(); }
    },

    onDblClick(e) {
      if (!this.inStage(e) || this.editing) return;
      e.preventDefault();
      e.stopPropagation();
      const p = this.toStage(e.clientX, e.clientY);
      const id = this.hitTest(p.x, p.y);
      if (id) { if (id !== this.sel) this.select(id); this.beginText(id); }
    },

    // --- keyboard -------------------------------------------------------------------------

    onKey(e) {
      if (e.metaKey || e.ctrlKey) return; // app shortcuts
      if (this.key(e.key, { shift: e.shiftKey, alt: e.altKey })) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      // Keep the engine's and edit.js's letter keys (E, N, F, H, T, ...) off while editing.
      if (!this.editing && e.key.length === 1 && e.key !== ' ') e.stopImmediatePropagation();
    },

    /** Handles a key (from the page, or forwarded by the host). Returns true when handled. */
    key(name, { shift = false } = {}) {
      if (!this.on) return false;
      if (this.editing) {
        if (name === 'Escape') { this.cancelText(); return true; }
        if (name === 'Enter' && !shift) { this.commitText(); return true; }
        if (name === 'ArrowLeft' || name === 'ArrowRight') {
          getSelection()?.modify?.(shift ? 'extend' : 'move', name === 'ArrowLeft' ? 'backward' : 'forward', 'character');
          return true;
        }
        return false;
      }
      if (name === 'Tab') {
        const objs = this.objects();
        if (!objs.length) return true;
        const i = objs.findIndex((o) => o.id === this.sel);
        const n = i < 0 ? (shift ? objs.length - 1 : 0) : (i + (shift ? -1 : 1) + objs.length) % objs.length;
        this.select(objs[n].id);
        return true;
      }
      if (!this.sel) return false;
      if (name === 'Escape') { this.select(null); return true; }
      if (name === 'Enter') { this.beginText(this.sel); return true; }
      const step = shift ? 10 : 1;
      const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[name];
      if (!dir) return false;
      this.nudgeBy(dir[0], dir[1]);
      return true;
    },

    /** Moves the selection by (dx, dy) CSS px now; one move message once the keys settle. */
    nudgeBy(dx, dy) {
      const el = this.el(this.sel);
      if (!el || !this.movable(el)) return;
      const n = this.nudge && this.nudge.el === el ? this.nudge : { el, from: this.box(el) };
      n.left = (n.left ?? round(n.from.left)) + dx;
      n.top = (n.top ?? round(n.from.top)) + dy;
      el.style.left = `${n.left}px`;
      el.style.top = `${n.top}px`;
      clearTimeout(n.timer);
      n.timer = setTimeout(() => this.flushNudge(), this.opts.nudgeDelay);
      this.nudge = n;
      this.update();
    },

    flushNudge() {
      const n = this.nudge;
      if (!n) return;
      clearTimeout(n.timer);
      this.nudge = null;
      if (n.left !== round(n.from.left) || n.top !== round(n.from.top)) this.post({ type: 'move', id: n.el.id, left: n.left, top: n.top });
    },

    // --- text -------------------------------------------------------------------------------

    /** Starts in-place editing of #id. Refuses (with a message) text that has block children. */
    beginText(id) {
      const el = this.el(id);
      if (!el || this.editing) return false;
      if (!this.editable(el)) { this.post({ type: 'refused', id, reason: 'block-children' }); return false; }
      this.flushNudge();
      const ed = { el, orig: el.innerHTML };
      ed.onBlur = () => { if (this.editing === ed) this.commitText(); };
      el.setAttribute('contenteditable', 'plaintext-only');
      el.setAttribute('spellcheck', 'false');
      el.addEventListener('blur', ed.onBlur);
      this.editing = ed;
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
      this.update();
      return true;
    },

    endText() {
      const ed = this.editing;
      this.editing = null;
      ed.el.removeEventListener('blur', ed.onBlur);
      ed.el.removeAttribute('contenteditable');
      ed.el.removeAttribute('spellcheck');
      getSelection()?.removeAllRanges();
      if (document.activeElement === ed.el) ed.el.blur();
      this.update();
      return ed;
    },

    /** Ends editing; posts the new inner HTML when it changed and holds only inline markup. */
    commitText() {
      if (!this.editing) return;
      const ed = this.endText(), el = ed.el;
      const html = el.innerHTML;
      if (html === ed.orig) return;
      if ([...el.children].some((c) => !INLINE.has(c.tagName))) {
        el.innerHTML = ed.orig;
        this.post({ type: 'refused', id: el.id, reason: 'block-children' });
        return;
      }
      this.post({ type: 'text', id: el.id, html });
    },

    cancelText() {
      if (!this.editing) return;
      const ed = this.endText();
      ed.el.innerHTML = ed.orig;
      this.update();
    },
  };

  window.SageCanvas = C;
})();
