// canvas.js — the editing overlay for the app's canvas (PLAN 5.3, 12.4).
//
// Injected by the Mac app into the canvas film of an editable talk; never part of a build, a
// presentation, or a published file. There is no edit mode: whenever the film is paused the
// canvas is directly editable (Keynote-style), and while it plays the overlay steps aside and
// lets the engine have every click and key. It selects, moves, resizes and edits the text of
// objects (elements with an id) and reports every change to the host as one precise message;
// the host writes the source through the sidecar (talk.edit) and reloads. Nothing here writes
// files.
//
// Messages (posted to window.webkit.messageHandlers.sage as {kind: 'canvas', ...msg}, or to
// opts.post(msg)). Numbers are stage px (the 1920x1080 stage); left/top are the element's
// CSS left/top (its offset parent's coordinates, which for a top-level positioned object are
// the stage's), rounded to whole px. `rect` is the element's box in the page's client px (where
// the host floats its format bar):
//   {type: 'select', id: null}                                  selection cleared
//   {type: 'select', id, tag, left, top, width, height, fontSize, movable, editable, html, src,
//    rect, text}                  text: {bold, italic, underline, color, align, family} (computed)
//   {type: 'move', id, left, top}                               drag ended, or nudges settled
//   {type: 'resize', id, left, top, width, height}              handle drag ended
//   {type: 'text', id, html}                                    in-place text committed (changed)
//   {type: 'style', id, style}                                  a format change for the whole element
//                                                               (setStyle keys: fontWeight, color, ...)
//   {type: 'editing', id}                                       the caret went into #id's text (id null: left it)
//   {type: 'format', id, bold, italic, underline, color, range} the text selection's formatting while editing
//   {type: 'rect', id, rect}                                    the selected element's client box changed
//   {type: 'refused', id, reason}                               'block-children': text edit refused
//
// Selection: the topmost element with an id at the point whose own effective opacity is at
// least 0.05 (an element at opacity 0 is skipped and the one beneath considered). Scene
// containers (.scene) and full-stage backgrounds (#black and the like) are never selected.
// Snapping (hold Cmd to disable): to other visible objects' edges and centres and the stage's,
// within 8 px, with guides; otherwise to a 10 px grid.
// Clicks: a click selects; a click on the selected text object (or a double-click) puts the
// caret there; a click on empty stage deselects. Keys while something is selected: arrows
// nudge 1 px (Shift: 10 px), Enter edits its text (all selected), typing a character starts
// editing with it, Cmd-B/I/U format it, Escape deselects, Tab cycles objects. While editing
// text: Escape or Enter commits and leaves the text (the object stays selected), Shift-Enter is
// a line break, a click elsewhere commits; Cmd-B/I/U format the selected range. Space is never
// taken from the engine unless the caret is in text.
(function () {
  'use strict';
  if (window.SageCanvas) return;

  const W = 1920, H = 1080;
  const INLINE = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'CODE', 'BR', 'U', 'SUB', 'SUP', 'A', 'MARK', 'S']);
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const MIN_OPACITY = 0.05;
  const DRAG_START = 3; // screen px before a press becomes a drag
  const INLINE_CMDS = { bold: 'bold', italic: 'italic', underline: 'underline', color: 'foreColor' };

  const round = (v) => Math.round(v);
  const r2 = (v) => Math.round(v * 100) / 100;
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(+n))).toString(16).padStart(2, '0');
  /** rgb()/rgba() with full alpha to #rrggbb; anything else unchanged. */
  const toHex = (c) => {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(String(c || '').trim());
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < (m[4].endsWith('%') ? 100 : 1))) return c;
    return '#' + hex2(m[1]) + hex2(m[2]) + hex2(m[3]);
  };

  const C = {
    on: false,
    /** The film is playing: the overlay is hidden and every event goes to the engine. */
    suspended: false,
    sel: null,
    editing: null,
    opts: null,
    stage: null,
    film: null,
    overlay: null,
    drag: null,
    nudge: null,
    prev: null,
    lastRect: '',

    // --- lifecycle ---------------------------------------------------------------------

    enable(opts = {}) {
      if (this.on) return;
      this.stage = document.querySelector('.stage');
      this.film = document.querySelector('.film');
      if (!this.stage || !this.film) return;
      this.opts = Object.assign({ grid: 10, snap: 8, nudgeDelay: 300, post: null }, opts);
      this.on = true;
      this.buildOverlay();
      for (const [target, type, fn] of this.listeners()) target.addEventListener(type, fn, true);
      const T = window.T;
      if (T) {
        // Follow play state: playing hides the overlay, a pause (or seek) brings it back.
        this.prev = { onRender: T.onRender, play: Object.prototype.hasOwnProperty.call(T, 'play') ? T.play : null,
          pause: Object.prototype.hasOwnProperty.call(T, 'pause') ? T.pause : null };
        const play = T.play, pause = T.pause;
        T.onRender = (t) => { this.prev?.onRender?.(t); this.rendered(); };
        T.play = function (...a) { C.leaveText(); const r = play.apply(this, a); C.follow(); return r; };
        T.pause = function (...a) { const r = pause.apply(this, a); C.follow(); return r; };
      }
      this.suspended = !!T?.playing;
      this.film.classList.toggle('sage-canvas-on', !this.suspended);
      this.update();
    },

    disable() {
      if (!this.on) return;
      this.flushNudge();
      if (this.editing) this.commitText();
      for (const [target, type, fn] of this.listeners()) target.removeEventListener(type, fn, true);
      const T = window.T;
      if (T && this.prev) {
        T.onRender = this.prev.onRender;
        if (this.prev.play) T.play = this.prev.play; else delete T.play;
        if (this.prev.pause) T.pause = this.prev.pause; else delete T.pause;
      }
      this.prev = null;
      this.overlay?.remove();
      this.overlay = null;
      this.film.classList.remove('sage-canvas-on');
      this.on = false;
      this.suspended = false;
      this.sel = null;
      this.drag = null;
      this.lastRect = '';
    },

    listeners() {
      if (!this._ls) {
        this._ls = [
          [window, 'pointerdown', (e) => this.onDown(e)], [window, 'pointermove', (e) => this.onMove(e)], [window, 'pointerup', (e) => this.onUp(e)],
          [window, 'click', (e) => this.onClick(e)], [window, 'dblclick', (e) => this.onDblClick(e)], [window, 'keydown', (e) => this.onKey(e)],
          [window, 'resize', () => this.update()], [document, 'selectionchange', () => this.onSelectionChange()],
        ];
      }
      return this._ls;
    },

    post(msg) {
      if (this.opts?.post) return this.opts.post(msg);
      try { window.webkit.messageHandlers.sage.postMessage(Object.assign({ kind: 'canvas' }, msg)); } catch (e) { /* no host */ }
    },

    // --- play state ------------------------------------------------------------------------

    /** Called after play() and pause() (seek pauses too): hide or bring back the overlay. */
    follow() {
      if (!this.on) return;
      const playing = !!window.T?.playing;
      if (playing === this.suspended) return;
      this.suspended = playing;
      if (playing) {
        this.leaveText();
        this.drag = null;
        this.guides(null, null);
      }
      this.film.classList.toggle('sage-canvas-on', !playing);
      this.update();
      if (!playing) this.revalidate();
    },

    /** Ends text editing (committing it) and settles nudges, before the film moves. */
    leaveText() {
      this.flushNudge();
      if (this.editing) this.commitText();
    },

    /** After every engine render: redraw, and while paused keep the selection honest. */
    rendered() {
      this.update();
      if (this.suspended || window.T?.playing) return;
      clearTimeout(this._rv);
      this._rv = setTimeout(() => this.revalidate(), 0);
    },

    /**
     * The film moved while something was selected: keep the selection when the element still
     * exists and shows, and report its state at the new time; otherwise clear it.
     */
    revalidate() {
      if (!this.on || this.suspended || !this.sel || this.editing || this.drag) return;
      const el = this.el(this.sel);
      if (!el || !this.visible(el)) { this.select(null); return; }
      const msg = this.info(this.sel);
      const key = JSON.stringify(msg);
      if (key !== this._lastInfo) { this._lastInfo = key; this.post(msg); }
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
    /** The element's box in client px (the web view's points). */
    clientRect(el) {
      const b = el.getBoundingClientRect();
      return { x: r2(b.left), y: r2(b.top), w: r2(b.width), h: r2(b.height) };
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

    /** The element's computed text formatting (the format bar's state when not editing). */
    textInfo(el) {
      const cs = getComputedStyle(el);
      const w = parseInt(cs.fontWeight, 10);
      return {
        bold: (Number.isFinite(w) ? w : cs.fontWeight === 'bold' ? 700 : 400) >= 600,
        italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
        underline: (cs.textDecorationLine || cs.textDecoration || '').includes('underline'),
        color: toHex(cs.color), align: cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign,
        family: cs.fontFamily,
      };
    },

    info(id) {
      const el = this.el(id);
      if (!el) return null;
      const b = this.box(el), cs = getComputedStyle(el), editable = this.editable(el);
      return {
        type: 'select', id, tag: el.tagName.toLowerCase(),
        left: r2(b.left), top: r2(b.top), width: r2(b.width), height: r2(b.height),
        fontSize: r2(parseFloat(cs.fontSize) || 0), movable: this.movable(el), editable,
        html: editable ? el.innerHTML : null, src: el.tagName === 'IMG' ? el.getAttribute('src') : null,
        rect: this.clientRect(el), text: this.textInfo(el),
      };
    },

    /** Selects #id (null clears). `silent` restores a selection without telling the host. */
    select(id, { silent = false } = {}) {
      if (!this.on) return null;
      if (id && !this.el(id)) id = null;
      if (id !== this.sel) { this.flushNudge(); if (this.editing) this.commitText(); }
      this.sel = id;
      this._selecting = true; // the select message carries the rect: no separate rect message
      this.update();
      this._selecting = false;
      const msg = id ? this.info(id) : { type: 'select', id: null };
      this.lastRect = id ? this.rectKey(msg.rect) : '';
      this._lastInfo = JSON.stringify(msg);
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
        .sage-canvas-overlay .sc-box.sc-editing { outline-style:dashed; outline-color:rgba(10,132,255,0.75); }
        .sage-canvas-overlay .sc-h { position:absolute; display:none; box-sizing:border-box; width:var(--sc-hs); height:var(--sc-hs); margin:calc(var(--sc-hs) / -2) 0 0 calc(var(--sc-hs) / -2); background:#fff; border:var(--sc-line) solid #0a84ff; border-radius:2px; pointer-events:auto; }
        .sage-canvas-overlay .sc-h[data-h=nw], .sage-canvas-overlay .sc-h[data-h=se] { cursor:nwse-resize; }
        .sage-canvas-overlay .sc-h[data-h=ne], .sage-canvas-overlay .sc-h[data-h=sw] { cursor:nesw-resize; }
        .sage-canvas-overlay .sc-h[data-h=n], .sage-canvas-overlay .sc-h[data-h=s] { cursor:ns-resize; }
        .sage-canvas-overlay .sc-h[data-h=e], .sage-canvas-overlay .sc-h[data-h=w] { cursor:ew-resize; }
        .sage-canvas-overlay .sc-gx, .sage-canvas-overlay .sc-gy { position:absolute; display:none; background:#ff2d78; }
        .sage-canvas-overlay .sc-gx { top:0; height:${H}px; width:var(--sc-line); }
        .sage-canvas-overlay .sc-gy { left:0; width:${W}px; height:var(--sc-line); }
        .film.sage-canvas-on .stage [contenteditable] { outline: none; cursor: text; user-select: text; -webkit-user-select: text; caret-color: #0a84ff; }
        .film.sage-canvas-on .stage { cursor: default; }`;
      o.appendChild(css);
      this.film.appendChild(o);
      this.overlay = o;
    },

    /** Redraws the selection box and handles over the selected element. */
    update() {
      const o = this.overlay;
      if (!o) return;
      o.style.display = this.suspended ? 'none' : 'block';
      o.style.transform = this.stage.style.transform;
      const k = this.geom().k;
      o.style.setProperty('--sc-line', `${2 / k}px`);
      o.style.setProperty('--sc-hs', `${10 / k}px`);
      const el = this.el(this.sel), box = o.querySelector('.sc-box');
      const hs = o.querySelectorAll('.sc-h');
      if (!el) { box.style.display = 'none'; hs.forEach((h) => (h.style.display = 'none')); this.reportRect(null); return; }
      const r = this.rectOf(el);
      Object.assign(box.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      box.classList.toggle('sc-editing', !!this.editing);
      const show = this.movable(el) && !this.editing;
      hs.forEach((h) => {
        const k2 = h.dataset.h;
        const x = k2.includes('w') ? r.x : k2.includes('e') ? r.x + r.w : r.x + r.w / 2;
        const y = k2.includes('n') ? r.y : k2.includes('s') ? r.y + r.h : r.y + r.h / 2;
        Object.assign(h.style, { display: show ? 'block' : 'none', left: `${x}px`, top: `${y}px` });
      });
      if (!this.suspended && !this._selecting) this.reportRect(el);
    },

    rectKey(rect) { return rect ? `${this.sel} ${rect.x} ${rect.y} ${rect.w} ${rect.h}` : ''; },

    /** Tells the host where the selected element is on screen, when that changed. */
    reportRect(el) {
      const rect = el ? this.clientRect(el) : null;
      const key = this.rectKey(rect);
      if (key === this.lastRect) return;
      this.lastRect = key;
      if (rect) this.post({ type: 'rect', id: this.sel, rect });
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
      if (e.button !== 0 || this.suspended) return;
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
      if (handle && this.sel) return this.startDrag(e, this.el(this.sel), handle.dataset.h, true);
      const id = this.hitTest(p.x, p.y);
      const was = !!id && id === this.sel;
      if (id !== this.sel) this.select(id);
      if (id) this.startDrag(e, this.el(id), null, was);
    },

    startDrag(e, el, handle, wasSelected) {
      this.drag = {
        el, handle, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId, wasSelected,
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
      if (!d.moved || !d.result) {
        // A click on the already selected text object puts the caret there (Keynote).
        if (!d.handle && d.wasSelected && !d.moved && this.editable(d.el)) this.beginText(d.el.id, { x: e.clientX, y: e.clientY });
        return;
      }
      const r = d.result, id = d.el.id;
      if (d.handle) this.post({ type: 'resize', id, left: r.left, top: r.top, width: r.width, height: r.height });
      else if (r.left !== round(d.box.left) || r.top !== round(d.box.top)) this.post({ type: 'move', id, left: r.left, top: r.top });
      this.update();
    },

    onClick(e) {
      // The engine advances on a stage click; while paused a click only selects.
      if (this.suspended || this.editing?.el.contains(e.target)) return;
      if (this.inStage(e) || e.target?.closest?.('.sage-canvas-overlay')) { e.preventDefault(); e.stopPropagation(); }
    },

    onDblClick(e) {
      if (this.suspended || !this.inStage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.editing) { this.selectWordAt(e.clientX, e.clientY); return; }
      const p = this.toStage(e.clientX, e.clientY);
      const id = this.hitTest(p.x, p.y);
      if (!id) return;
      if (id !== this.sel) this.select(id);
      if (this.beginText(id, { x: e.clientX, y: e.clientY })) this.selectWordAt(e.clientX, e.clientY);
    },

    selectWordAt(x, y) {
      const s = getSelection(), r = this.caretAt(x, y);
      if (!s || !r) return;
      s.removeAllRanges();
      s.addRange(r);
      s.modify?.('move', 'backward', 'word');
      s.modify?.('extend', 'forward', 'word');
    },

    /** A collapsed range at a client point inside the edited element, or null. */
    caretAt(x, y) {
      const el = this.editing?.el;
      if (!el) return null;
      const r = document.caretRangeFromPoint?.(x, y);
      if (r && el.contains(r.startContainer)) return r;
      // Something transparent lies on top (a full-stage background, the overlay): find the
      // character under the point, or the nearest one, in the element's own text.
      let best = null;
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const probe = document.createRange();
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        for (let i = 0; i < t.data.length; i++) {
          probe.setStart(t, i); probe.setEnd(t, i + 1);
          const b = probe.getBoundingClientRect();
          if (!b.width && !b.height) continue;
          const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
          const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
          const d = dy * 1000 + dx; // same line first
          if (!best || d < best.d) best = { d, t, i: x > (b.left + b.right) / 2 ? i + 1 : i };
          if (!d) break;
        }
        if (best && !best.d) break;
      }
      if (!best) return null;
      const out = document.createRange();
      out.setStart(best.t, best.i);
      out.collapse(true);
      return out;
    },

    // --- keyboard -------------------------------------------------------------------------

    onKey(e) {
      if (this.suspended) return;
      if (e.metaKey || e.ctrlKey) {
        // Cmd-B/I/U format the text (the selected range while editing, else the whole object).
        const cmd = !e.altKey && !e.shiftKey && { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
        if (cmd && this.sel && this.editable(this.el(this.sel))) { e.preventDefault(); e.stopImmediatePropagation(); this.format(cmd); }
        return; // other app shortcuts
      }
      if (this.key(e.key, { shift: e.shiftKey, alt: e.altKey })) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (this.editing || e.key.length !== 1) return;
      // Typing with a text object selected starts editing it with that character (not Space: play).
      const el = this.el(this.sel);
      if (e.key !== ' ' && el && this.editable(el) && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (this.beginText(this.sel, 'end')) document.execCommand('insertText', false, e.key);
        return;
      }
      // Keep the engine's letter keys (E, N, F, H, T, ...) off while editing is possible.
      if (e.key !== ' ') e.stopImmediatePropagation();
    },

    /** Handles a key (from the page, or forwarded by the host). Returns true when handled. */
    key(name, { shift = false } = {}) {
      if (!this.on || this.suspended) return false;
      if (this.editing) {
        if (name === 'Escape') { this.commitText(); return true; }
        if (name === 'Enter' && !shift) { this.commitText(); return true; }
        if (name === 'Enter' && shift) { document.execCommand('insertLineBreak'); return true; }
        if (name === 'Tab') { this.commitText(); return this.key('Tab', { shift }); }
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
      if (name === 'Enter') return this.beginText(this.sel, 'all') || true;
      const step = shift ? 10 : 1;
      const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[name];
      if (!dir || !this.movable(this.el(this.sel))) return false; // arrows drive the film then
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

    /**
     * Puts the caret into #id's text: at a client point ({x, y}), at the 'end', or with 'all'
     * of it selected. Refuses (with a message) text that has block children.
     */
    beginText(id, at = 'all') {
      const el = this.el(id);
      if (!el || this.suspended) return false;
      if (this.editing) { if (this.editing.el === el) return true; this.commitText(); }
      if (!this.editable(el)) { this.post({ type: 'refused', id, reason: 'block-children' }); return false; }
      if (id !== this.sel) this.select(id);
      this.flushNudge();
      const before = new Set(el.querySelectorAll('*'));
      const ed = { el, orig: el.innerHTML, range: null, old: (n) => before.has(n) };
      ed.onPaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' ')); };
      ed.onDrop = (e) => e.preventDefault();
      ed.onInput = () => this.update();
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
      el.addEventListener('paste', ed.onPaste);
      el.addEventListener('drop', ed.onDrop);
      el.addEventListener('input', ed.onInput);
      this.editing = ed;
      el.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* older engines */ }
      const s = getSelection();
      let r = at && typeof at === 'object' ? this.caretAt(at.x, at.y) : null;
      if (!r) {
        r = document.createRange();
        r.selectNodeContents(el);
        if (at !== 'all') r.collapse(false);
      }
      s?.removeAllRanges();
      s?.addRange(r);
      ed.range = r.cloneRange();
      this.update();
      this.post({ type: 'editing', id });
      this.postFormat();
      return true;
    },

    endText() {
      const ed = this.editing;
      this.editing = null;
      ed.el.removeEventListener('paste', ed.onPaste);
      ed.el.removeEventListener('drop', ed.onDrop);
      ed.el.removeEventListener('input', ed.onInput);
      ed.el.removeAttribute('contenteditable');
      ed.el.removeAttribute('spellcheck');
      getSelection()?.removeAllRanges();
      if (document.activeElement === ed.el) ed.el.blur();
      this.update();
      this.post({ type: 'editing', id: null });
      return ed;
    },

    /**
     * Normalises what the browser's editing wrote: <font color> becomes a span with a color,
     * rgb() colours become hex, empty style attributes go, a trailing <br> the browser added
     * goes, and non-breaking spaces the browser used for typed spaces become spaces.
     */
    sanitize(el, { orig, old }) {
      for (const f of [...el.querySelectorAll('font')]) {
        const s = document.createElement('span');
        if (f.getAttribute('color')) s.style.color = f.getAttribute('color');
        s.append(...f.childNodes);
        f.replaceWith(s);
      }
      for (const n of [...el.querySelectorAll('[style]')]) {
        const raw = n.getAttribute('style');
        if (!raw.trim()) { n.removeAttribute('style'); continue; }
        if (old(n) && !/rgba?\(/.test(raw)) continue; // as written in the source
        const css = raw.replace(/rgba?\([^)]*\)/g, (m) => toHex(m)).replace(/\s*:\s*/g, ':').replace(/\s*;\s*/g, ';').replace(/;$/, '').trim();
        if (!old(n) && n.tagName !== 'SPAN') {
          // a style the browser put on a new <b>/<i>/<u>: keep the tag, carry the style on a span inside
          const s = document.createElement('span');
          s.setAttribute('style', css);
          s.append(...n.childNodes);
          n.append(s);
          n.removeAttribute('style');
        } else n.setAttribute('style', css);
      }
      for (const n of [...el.querySelectorAll('span')]) if (!old(n) && !n.attributes.length) n.replaceWith(...n.childNodes);
      if (!/<br\s*\/?>\s*$/i.test(orig)) while (el.lastChild?.nodeName === 'BR') el.lastChild.remove();
      if (!orig.includes('&nbsp;') && el.innerHTML.includes('&nbsp;')) {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let t = walk.nextNode(); t; t = walk.nextNode()) t.data = t.data.replace(/\u00a0/g, ' ');
      }
    },

    /**
     * Ends editing. Returns the text message when the inner HTML changed and holds only inline
     * markup (posting it unless `post` is false), a refusal (posted), or null.
     */
    commitText({ post = true } = {}) {
      if (!this.editing) return null;
      const ed = this.endText(), el = ed.el;
      this.sanitize(el, ed);
      const html = el.innerHTML;
      if (html === ed.orig) return null;
      if ([...el.querySelectorAll('*')].some((c) => !INLINE.has(c.tagName))) {
        el.innerHTML = ed.orig;
        this.update();
        this.post({ type: 'refused', id: el.id, reason: 'block-children' });
        return null;
      }
      const msg = { type: 'text', id: el.id, html };
      if (post) this.post(msg);
      this.update();
      return msg;
    },

    /** The host ends text editing before an edit of its own: the text message, or null. */
    takeText() { return this.commitText({ post: false }); },

    cancelText() {
      if (!this.editing) return;
      const ed = this.endText();
      ed.el.innerHTML = ed.orig;
      this.update();
    },

    onSelectionChange() {
      const ed = this.editing;
      if (!ed) return;
      const s = getSelection();
      if (s?.rangeCount && ed.el.contains(s.getRangeAt(0).commonAncestorContainer)) ed.range = s.getRangeAt(0).cloneRange();
      cancelAnimationFrame(this._fmt);
      this._fmt = requestAnimationFrame(() => this.postFormat());
    },

    /** The formatting at the text selection (while editing). */
    textState() {
      const ed = this.editing;
      if (!ed) return null;
      const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
      let color = '';
      try { color = toHex(document.queryCommandValue('foreColor')); } catch (e) { /* none */ }
      return { bold: q('bold'), italic: q('italic'), underline: q('underline'), color, range: !!ed.range && !ed.range.collapsed };
    },

    postFormat() {
      const st = this.textState();
      if (!st) return;
      const msg = Object.assign({ type: 'format', id: this.editing.el.id }, st), key = JSON.stringify(msg);
      if (key === this.editing.lastFormat) return; // unchanged
      this.editing.lastFormat = key;
      this.post(msg);
    },

    /** Puts the saved text selection back (a host control may have taken focus). */
    restoreRange() {
      const ed = this.editing;
      if (!ed?.range) return null;
      if (document.activeElement !== ed.el) ed.el.focus();
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(ed.range);
      return ed.range;
    },

    /**
     * Formats the selected object's text: `cmd` is bold, italic, underline, color (value a
     * CSS colour), align (left/center/right/justify), fontSize (px) or fontFamily (CSS). While
     * editing with a range selected, bold/italic/underline/color apply to that range in place
     * (as <b>/<i>/<u> and a span with a color, committed with the text). Otherwise the whole
     * element changes: the style is applied at once and posted as {type: 'style'} for setStyle.
     * Returns 'inline', 'element', or null when nothing is selected.
     */
    format(cmd, value) {
      const el = this.el(this.sel);
      if (!el || this.suspended) return null;
      if (this.editing?.el === el && INLINE_CMDS[cmd]) {
        const r = this.restoreRange();
        if (r && !r.collapsed) {
          try {
            document.execCommand('styleWithCSS', false, cmd === 'color');
            document.execCommand(INLINE_CMDS[cmd], false, cmd === 'color' ? value : null);
            document.execCommand('styleWithCSS', false, false);
          } catch (e) { return null; }
          const s = getSelection();
          if (s?.rangeCount) this.editing.range = s.getRangeAt(0).cloneRange();
          this.update();
          this.postFormat();
          return 'inline';
        }
      }
      const style = this.elementStyle(el, cmd, value);
      if (!style) return null;
      for (const [k, v] of Object.entries(style)) el.style[k] = v === null ? '' : typeof v === 'number' && k !== 'fontWeight' ? `${v}px` : String(v);
      this.update();
      this.post({ type: 'style', id: el.id, style });
      return 'element';
    },

    /** The setStyle change for a whole-element format command (null: no change). */
    elementStyle(el, cmd, value) {
      const toggle = (prop, isOn, on, off) => {
        // Toggle against what the element shows; drop our own inline value when the stylesheet
        // alone gives the wanted state.
        const want = !isOn(getComputedStyle(el));
        const own = el.style[prop];
        el.style[prop] = '';
        const base = isOn(getComputedStyle(el));
        el.style[prop] = own;
        return { [prop]: base === want ? null : want ? on : off };
      };
      const weight = (cs) => { const w = parseInt(cs.fontWeight, 10); return (Number.isFinite(w) ? w : cs.fontWeight === 'bold' ? 700 : 400) >= 600; };
      switch (cmd) {
        case 'bold': return toggle('fontWeight', weight, '700', '400');
        case 'italic': return toggle('fontStyle', (cs) => cs.fontStyle !== 'normal', 'italic', 'normal');
        case 'underline': return toggle('textDecoration', (cs) => (cs.textDecorationLine || cs.textDecoration || '').includes('underline'), 'underline', 'none');
        case 'color': return value ? { color: String(value) } : null;
        case 'align': return value ? { textAlign: String(value) } : null;
        case 'fontSize': return Number.isFinite(+value) && +value > 0 ? { fontSize: +value } : null;
        case 'fontFamily': return value ? { fontFamily: String(value) } : null;
        default: return null;
      }
    },
  };

  window.SageCanvas = C;
})();
