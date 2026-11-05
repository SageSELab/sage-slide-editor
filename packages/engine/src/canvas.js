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
//   {type: 'playing', playing}                                  the film started or stopped (overlay hidden or back)
//   {type: 'refused', id, reason}                               'block-children': text edit refused
//
// Selection (Keynote): a click selects the OUTERMOST object under the pointer (a card, not its
// title); a click on the selected object goes one level deeper toward the pointer, and once
// there a click on the deepest text puts the caret in it; a double-click goes straight to the
// deepest text with the caret. While inside a group a click on a sibling selects the sibling.
// Escape (not editing) selects the parent object, then deselects. Objects are elements with an
// id (not scenes, full-stage backgrounds or #slideno) at effective opacity >= 0.05, and inside
// them the elements without an id that draw something (a card's title, an image); those are
// named by an element address, `g1>div.t` (the nearest ancestor with an id, then one
// tag.class[:n] step per level; core edit-html.ts resolves it, and the edit gives the element
// an id, which the host passes back with adopt()). Text is a leaf: nothing inside an editable
// text object is selected separately. Every message's `id` is that id or address.
// Chrome: a 1 px outline with small square handles (larger invisible hit zones); a lighter
// outline shows what a click would select. Dragging and resizing show a size/position HUD.
// Snapping (hold Cmd to disable): only to smart guides, the other visible objects' edges and
// centres and the stage's, within 5 screen px; there is no grid. Shift-drag keeps to one axis;
// Shift on a corner keeps the aspect ratio (images always do); Option resizes about the centre.
// Clicks: a click on empty stage deselects. Keys while something is selected: arrows
// nudge 1 px (Shift: 10 px), Enter edits its text (all selected), typing a character starts
// editing with it, Cmd-B/I/U format it, Escape goes up a level, Tab cycles objects. While
// editing text: Escape or Enter commits and leaves the text (the object stays selected),
// Shift-Enter is a line break, a click elsewhere commits; Cmd-B/I/U format the selected range.
// Inside the edited text a press places the caret, a drag selects (Shift-click extends, a
// double-click takes the word, a triple-click all of it); the canvas does this itself, since a
// transparent full-stage layer above the text would otherwise take the press and move the box.
// Space is never taken from the engine unless the caret is in text.
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
    /** The object a click would select (its light outline), while paused. */
    hover: null,
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
      // snap: the smart-guide distance in screen px
      this.opts = Object.assign({ snap: 5, nudgeDelay: 300, post: null }, opts);
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
      this.hover = null;
      this.drag = null;
      this.lastRect = '';
    },

    listeners() {
      if (!this._ls) {
        this._ls = [
          [window, 'pointerdown', (e) => this.onDown(e)], [window, 'pointermove', (e) => this.onMove(e)], [window, 'pointerup', (e) => this.onUp(e)],
          [window, 'click', (e) => this.onClick(e)], [window, 'dblclick', (e) => this.onDblClick(e)], [window, 'keydown', (e) => this.onKey(e)],
          [window, 'resize', () => this.update()], [document, 'selectionchange', () => this.onSelectionChange()],
          [document, 'mouseleave', () => this.setHover(null)],
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
        this.hud(null);
        this.hover = null;
      }
      this.film.classList.toggle('sage-canvas-on', !playing);
      this.update();
      this.post({ type: 'playing', playing });
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

    // --- objects without an id: element addresses ---------------------------------------

    /** The class an address step names: the first class when it is a plain name (core stepClass). */
    stepClass(cls) {
      const first = String(cls ?? '').trim().split(/\s+/)[0] || '';
      return /^[A-Za-z_][\w-]*$/.test(first) ? first : '';
    },
    /** `g1>div.t`: the nearest ancestor with an id, then tag.class[:n] per level; null when none. */
    addressOf(el) {
      const steps = [];
      let n = el;
      for (; n && n !== this.stage && !n.id; n = n.parentElement) {
        const p = n.parentElement;
        if (!p) return null;
        const tag = n.tagName.toLowerCase(), cls = this.stepClass(n.getAttribute('class'));
        if (!/^[a-z][a-z0-9-]*$/.test(tag)) return null;
        let i = 0;
        for (const c of p.children) { if (c === n) break; if (c.tagName.toLowerCase() === tag && this.stepClass(c.getAttribute('class')) === cls) i++; }
        steps.unshift(tag + (cls ? '.' + cls : '') + (i ? ':' + i : ''));
      }
      if (!n || n === this.stage || !this.stage.contains(n)) return null;
      return steps.length ? `${n.id}>${steps.join('>')}` : n.id;
    },
    /** The id or address the host knows the element by. */
    keyOf(el) { return el ? el.id || this.addressOf(el) : null; },
    /** The element for an id or an address, or null. */
    resolve(key) {
      if (!key) return null;
      if (!key.includes('>')) return document.getElementById(key);
      const [base, ...steps] = key.split('>');
      let cur = document.getElementById(base);
      for (const st of steps) {
        const m = /^([a-z][a-z0-9-]*)(?:\.([A-Za-z_][\w-]*))?(?::(\d+))?$/.exec(st);
        if (!cur || !m) return null;
        const like = [...cur.children].filter((c) => c.tagName.toLowerCase() === m[1] && this.stepClass(c.getAttribute('class')) === (m[2] || ''));
        cur = like[m[3] ? +m[3] : 0] || null;
      }
      return cur;
    },

    /**
     * True when a click can select the element: an object with an id (selectable), or, inside
     * one, an element without an id that draws something or holds text (not inline markup of
     * a text, not inside an SVG drawing).
     */
    candidate(el) {
      if (!el || el === this.stage || !this.stage.contains(el)) return false;
      if (el.id) return this.selectable(el);
      if (el.closest('#slideno') || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg')) return false;
      if (el.tagName !== 'IMG' && getComputedStyle(el).display === 'inline') return false;
      if (!this.visible(el) || this.isBackground(el)) return false;
      if (!this.paints(el) && !this.editable(el)) return false;
      // only to reach what has no id of its own: a wrapper around named objects stays out of the way
      if (el.querySelector('[id]')) return false;
      return !!this.addressOf(el);
    },
    /** The nearest enclosing candidate (Escape goes up to it), or null. */
    parentCandidate(el) {
      for (let n = el?.parentElement; n && n !== this.stage; n = n.parentElement) if (this.candidate(n)) return n;
      return null;
    },

    /**
     * The objects under a stage point, outermost first (a card, then its title), for the
     * topmost element there that draws something. Text is a leaf: the chain ends at the first
     * editable text. Empty when nothing selectable is there.
     */
    chainAt(x, y) {
      const g = this.geom();
      for (const e of document.elementsFromPoint(g.x + x * g.k, g.y + y * g.k)) {
        if (!this.stage.contains(e) || e === this.stage) continue;
        // invisible at this time, or an empty container whose content is hidden: look beneath it
        if (!this.visible(e) || !this.paints(e)) continue;
        const out = [];
        for (let n = e; n && n !== this.stage; n = n.parentElement) if (this.candidate(n)) out.unshift(n);
        const leaf = out.findIndex((n) => this.editable(n));
        if (leaf >= 0) out.length = leaf + 1;
        if (out.length) return out;
      }
      return [];
    },

    /**
     * What a press on `chain` selects (Keynote): the selection itself when it is under the
     * pointer (with the next deeper object, which a click without a drag goes to); inside a
     * group, the object at the selection's level; otherwise the outermost object.
     */
    pick(chain) {
      const sel = this.el(this.sel);
      const i = sel ? chain.indexOf(sel) : -1;
      if (i >= 0) return { el: sel, deeper: chain[i + 1] || null, was: true };
      if (sel) {
        for (let j = chain.length - 1; j >= 0; j--) {
          if (chain[j].contains(sel)) return { el: chain[j + 1] || chain[j], deeper: null, was: false };
        }
      }
      return { el: chain[0] || null, deeper: null, was: false };
    },

    /** Id (or address) of the object a click at a stage point selects from nothing, or null. */
    hitTest(x, y) { return this.keyOf(this.chainAt(x, y)[0]); },

    /** Visible selectable objects that show something, in document order (Tab, snapping). */
    objects() {
      const shows = (el) => this.paints(el) || [...el.querySelectorAll('*')].some((c) => this.paints(c) && this.visible(c));
      return [...this.stage.querySelectorAll('[id]')].filter((el) => this.selectable(el) && shows(el));
    },

    el(id) { return this.resolve(id); },

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
      if (id && id.includes('>') && this.el(id).id) id = this.el(id).id; // it has an id now (after a reload)
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

    /**
     * The host's edit gave an addressed element an id (talk.edit's `assigned`): the element
     * takes it now, without a reload, and the selection follows. True when it was found.
     */
    adopt(key, id) {
      const el = this.el(key);
      if (!el || !id) return false;
      if (!el.id) el.id = id;
      if (this.sel === key) { this.sel = id; this._lastInfo = ''; this.lastRect = ''; }
      if (this.hover === key) this.hover = id;
      return true;
    },

    // --- overlay -------------------------------------------------------------------------

    buildOverlay() {
      const o = document.createElement('div');
      o.className = 'sage-canvas-overlay';
      o.setAttribute('aria-hidden', 'true');
      o.style.cssText = `position:absolute;left:50%;top:50%;width:${W}px;height:${H}px;transform-origin:50% 50%;pointer-events:none;z-index:2147483646;overflow:visible`;
      o.innerHTML = '<div class="sc-hover"></div><div class="sc-box"></div>' + HANDLES.map((h) => `<div class="sc-h" data-h="${h}"></div>`).join('') +
        '<div class="sc-gx"></div><div class="sc-gy"></div><div class="sc-hud"></div>';
      const css = document.createElement('style');
      // Sizes are screen px divided by the stage scale (--sc-px: one screen px in stage px).
      css.textContent = `
        .sage-canvas-overlay { --sc-accent: #0a84ff; }
        .sage-canvas-overlay .sc-box, .sage-canvas-overlay .sc-hover { position:absolute; display:none; box-sizing:border-box; }
        .sage-canvas-overlay .sc-box { outline:var(--sc-px) solid var(--sc-accent); }
        .sage-canvas-overlay .sc-box.sc-editing { outline-style:dashed; outline-color:rgba(10,132,255,0.75); }
        .sage-canvas-overlay .sc-hover { outline:var(--sc-px) solid rgba(10,132,255,0.45); }
        .sage-canvas-overlay .sc-h { position:absolute; display:none; box-sizing:border-box; width:calc(var(--sc-px) * 14); height:calc(var(--sc-px) * 14); margin:calc(var(--sc-px) * -7) 0 0 calc(var(--sc-px) * -7); pointer-events:auto; }
        .sage-canvas-overlay .sc-h::after { content:''; position:absolute; box-sizing:border-box; left:50%; top:50%; width:calc(var(--sc-px) * 7); height:calc(var(--sc-px) * 7); transform:translate(-50%, -50%); background:#fff; border:var(--sc-px) solid var(--sc-accent); border-radius:calc(var(--sc-px) * 1); box-shadow:0 0 calc(var(--sc-px) * 2) rgba(0,0,0,0.35); }
        .sage-canvas-overlay .sc-h[data-h=nw], .sage-canvas-overlay .sc-h[data-h=se] { cursor:nwse-resize; }
        .sage-canvas-overlay .sc-h[data-h=ne], .sage-canvas-overlay .sc-h[data-h=sw] { cursor:nesw-resize; }
        .sage-canvas-overlay .sc-h[data-h=n], .sage-canvas-overlay .sc-h[data-h=s] { cursor:ns-resize; }
        .sage-canvas-overlay .sc-h[data-h=e], .sage-canvas-overlay .sc-h[data-h=w] { cursor:ew-resize; }
        .sage-canvas-overlay .sc-gx, .sage-canvas-overlay .sc-gy { position:absolute; display:none; background:#ffb400; }
        .sage-canvas-overlay .sc-gx { top:0; height:${H}px; width:var(--sc-px); margin-left:calc(var(--sc-px) / -2); }
        .sage-canvas-overlay .sc-gy { left:0; width:${W}px; height:var(--sc-px); margin-top:calc(var(--sc-px) / -2); }
        .sage-canvas-overlay .sc-hud { position:absolute; display:none; white-space:pre; font:500 calc(var(--sc-px) * 11)/1.2 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; font-variant-numeric:tabular-nums; color:#fff; background:rgba(28,28,30,0.86); padding:calc(var(--sc-px) * 3) calc(var(--sc-px) * 6); border-radius:calc(var(--sc-px) * 4); }
        .film.sage-canvas-on .stage [contenteditable] { outline: none; cursor: text; user-select: text; -webkit-user-select: text; caret-color: #0a84ff; }
        .film.sage-canvas-on .stage { cursor: default; }`;
      o.appendChild(css);
      this.film.appendChild(o);
      this.overlay = o;
    },

    /** Draws a box over an element (stage px), or hides it. */
    place(node, el) {
      if (!el) { node.style.display = 'none'; return null; }
      const r = this.rectOf(el);
      Object.assign(node.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      return r;
    },

    /** Redraws the selection box and handles over the selected element, and the hover box. */
    update() {
      const o = this.overlay;
      if (!o) return;
      o.style.display = this.suspended ? 'none' : 'block';
      o.style.transform = this.stage.style.transform;
      const k = this.geom().k;
      o.style.setProperty('--sc-px', `${1 / k}px`);
      const el = this.el(this.sel), box = o.querySelector('.sc-box');
      const hs = o.querySelectorAll('.sc-h');
      const hv = this.hover && this.hover !== this.sel && !this.editing && !this.drag ? this.el(this.hover) : null;
      this.place(o.querySelector('.sc-hover'), hv);
      if (!el) { box.style.display = 'none'; hs.forEach((h) => (h.style.display = 'none')); this.reportRect(null); return; }
      const r = this.place(box, el);
      box.classList.toggle('sc-editing', !!this.editing);
      const show = this.movable(el) && !this.editing;
      // a small object keeps only its corner handles, so the middle ones do not crowd it
      const small = r.w * k < 28 || r.h * k < 28;
      hs.forEach((h) => {
        const k2 = h.dataset.h;
        const x = k2.includes('w') ? r.x : k2.includes('e') ? r.x + r.w : r.x + r.w / 2;
        const y = k2.includes('n') ? r.y : k2.includes('s') ? r.y + r.h : r.y + r.h / 2;
        Object.assign(h.style, { display: show && (k2.length === 2 || !small) ? 'block' : 'none', left: `${x}px`, top: `${y}px` });
      });
      if (!this.suspended && !this._selecting) this.reportRect(el);
    },

    /** The object a click at the pointer would select gets a light outline (paused only). */
    setHover(key) {
      if (key === this.hover) return;
      this.hover = key;
      this.update();
    },
    hoverAt(cx, cy) {
      cancelAnimationFrame(this._hv);
      this._hv = requestAnimationFrame(() => {
        if (!this.on || this.suspended || this.drag || this.editing) return this.setHover(null);
        const p = this.toStage(cx, cy);
        if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return this.setHover(null);
        this.setHover(this.keyOf(this.pick(this.chainAt(p.x, p.y)).el));
      });
    },

    /** The position or size readout beside the pointer while dragging (null hides it). */
    hud(text, cx, cy) {
      const n = this.overlay?.querySelector('.sc-hud');
      if (!n) return;
      if (text == null) { n.style.display = 'none'; return; }
      const p = this.toStage(cx, cy), k = this.geom().k;
      n.textContent = text;
      Object.assign(n.style, { display: 'block', left: `${p.x + 14 / k}px`, top: `${p.y + 18 / k}px` });
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
    /** The snap distance in stage px (opts.snap is screen px). */
    snapDist() { return this.opts.snap / this.geom().k; },
    /** Best offset bringing any of `edges` onto any of `lines`, within the snap distance. */
    nearest(edges, lines) {
      let best = null;
      const lim = this.snapDist();
      for (const e of edges) for (const l of lines) {
        const d = l - e;
        if (Math.abs(d) <= lim && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: l };
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
        if (this.overText(this.editing.el, e.clientX, e.clientY)) return this.startTextDrag(e);
        this.commitText();
      }
      if (!handle && !this.inStage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.flushNudge();
      this.setHover(null);
      if (handle && this.sel) return this.startDrag(e, this.el(this.sel), handle.dataset.h, { was: true });
      const p = this.toStage(e.clientX, e.clientY);
      const hit = this.pick(this.chainAt(p.x, p.y));
      const key = this.keyOf(hit.el);
      if (key !== this.sel) this.select(key);
      if (hit.el) this.startDrag(e, hit.el, null, hit);
    },

    /** True when a client point lies on the edited element's box (a few px of slack). */
    overText(el, x, y) {
      const b = el.getBoundingClientRect(), pad = 4;
      return x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad;
    },

    /**
     * A press on the text being edited: the caret goes to the point, a drag extends the
     * selection, Shift extends the current one, a triple-click selects all of it (a
     * double-click selects the word, onDblClick). Done by hand rather than left to the browser,
     * because a transparent layer above the text (a full-stage background) would take the
     * press, and the browser would neither place the caret nor select.
     */
    startTextDrag(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = this.editing.el, s = getSelection();
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      if (e.detail >= 3) {
        const all = document.createRange();
        all.selectNodeContents(el);
        s?.removeAllRanges();
        s?.addRange(all);
        return;
      }
      const r = this.caretAt(e.clientX, e.clientY);
      if (!r || !s) return;
      if (e.shiftKey && s.rangeCount && el.contains(s.anchorNode)) s.extend(r.startContainer, r.startOffset);
      else { s.removeAllRanges(); s.addRange(r); }
      this.textDrag = { node: s.anchorNode, offset: s.anchorOffset };
    },

    startDrag(e, el, handle, { was = false, deeper = null } = {}) {
      this.drag = {
        el, handle, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId, wasSelected: was, deeper,
        box: this.box(el), rect: this.rectOf(el), unit: this.unit(el), canMove: this.movable(el),
      };
      try { e.target.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic events */ }
    },

    onMove(e) {
      if (this.textDrag) {
        e.preventDefault();
        e.stopPropagation();
        const r = this.editing && this.caretAt(e.clientX, e.clientY), a = this.textDrag;
        if (r) getSelection()?.setBaseAndExtent(a.node, a.offset, r.startContainer, r.startOffset);
        return;
      }
      const d = this.drag;
      if (!d) { if (!this.suspended) this.hoverAt(e.clientX, e.clientY); return; }
      e.preventDefault();
      e.stopPropagation();
      if (!d.canMove) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START) return;
      d.moved = true;
      const k = this.geom().k;
      const dx = (e.clientX - d.x0) / k, dy = (e.clientY - d.y0) / k; // stage px
      const mods = { snap: !e.metaKey, shift: e.shiftKey, alt: e.altKey };
      const r = d.handle ? this.resizeTo(d, dx, dy, mods) : this.moveTo(d, dx, dy, mods);
      d.result = r;
      const s = d.el.style;
      s.left = `${r.left}px`; s.top = `${r.top}px`;
      if (d.handle) { s.width = `${r.width}px`; s.height = `${r.height}px`; }
      this.hud(d.handle ? `W ${r.width}   H ${r.height}` : `X ${r.left}   Y ${r.top}`, e.clientX, e.clientY);
      this.update();
    },

    /** New left/top for a move by (dx, dy) stage px: Shift keeps to one axis; smart guides snap. */
    moveTo(d, dx, dy, { snap = true, shift = false } = {}) {
      const u = d.unit, R = d.rect;
      if (shift) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      let gx = null, gy = null;
      if (snap) {
        const t = this.targets(d.el);
        const sx = shift && !dx ? null : this.nearest([R.x + dx, R.x + dx + R.w / 2, R.x + dx + R.w], t.xs);
        const sy = shift && !dy ? null : this.nearest([R.y + dy, R.y + dy + R.h / 2, R.y + dy + R.h], t.ys);
        if (sx) { dx += sx.d; gx = sx.line; }
        if (sy) { dy += sy.d; gy = sy.line; }
      }
      this.guides(gx, gy);
      return { left: round(d.box.left + dx / u), top: round(d.box.top + dy / u), width: round(d.box.width), height: round(d.box.height) };
    },

    /**
     * New box for dragging handle d.handle by (dx, dy) stage px; the opposite edges stay put
     * (Option: the centre stays put). A corner keeps the aspect ratio with Shift, and always
     * for an image. The moving edges snap to smart guides.
     */
    resizeTo(d, dx, dy, { snap = true, shift = false, alt = false } = {}) {
      const u = d.unit, b = d.box, R = d.rect, h = d.handle;
      const t = snap ? this.targets(d.el) : null;
      let gx = null, gy = null;
      const sx = h.includes('w') ? -1 : h.includes('e') ? 1 : 0, sy = h.includes('n') ? -1 : h.includes('s') ? 1 : 0;
      // the moving edge's stage position, snapped: the delta to use
      const snapEdge = (delta, edge0, lines, set) => {
        if (!t) return delta;
        const s = this.nearest([edge0 + delta], lines);
        if (s) { set(s.line); return delta + s.d; }
        return delta;
      };
      if (sx) dx = snapEdge(dx, sx < 0 ? R.x : R.x + R.w, t?.xs, (l) => (gx = l));
      if (sy) dy = snapEdge(dy, sy < 0 ? R.y : R.y + R.h, t?.ys, (l) => (gy = l));
      const f = alt ? 2 : 1; // about the centre, both sides move
      let w = Math.max(1, b.width + (sx * dx * f) / u), hh = Math.max(1, b.height + (sy * dy * f) / u);
      const aspect = sx && sy && (shift || d.el.tagName === 'IMG') && b.width > 0 && b.height > 0;
      if (aspect) {
        const ratio = b.width / b.height;
        // the edge that moved further sets the size; the other follows (its guide no longer holds)
        if (Math.abs(w / b.width - 1) >= Math.abs(hh / b.height - 1)) { hh = w / ratio; gy = null; } else { w = hh * ratio; gx = null; }
      }
      let left, top;
      if (alt) { left = b.left + (b.width - w) / 2; top = b.top + (b.height - hh) / 2; } else {
        left = sx < 0 ? b.left + b.width - w : b.left;
        top = sy < 0 ? b.top + b.height - hh : b.top;
      }
      if (!sx) { w = b.width; left = b.left; }
      if (!sy) { hh = b.height; top = b.top; }
      this.guides(gx, gy);
      left = round(left); top = round(top);
      return { left, top, width: Math.max(1, round(left + w) - left), height: Math.max(1, round(top + hh) - top) };
    },

    onUp(e) {
      if (this.textDrag) {
        e.preventDefault();
        e.stopPropagation();
        this.textDrag = null;
        return;
      }
      const d = this.drag;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.drag = null;
      this.guides(null, null);
      this.hud(null);
      if (!d.moved || !d.result) {
        // A click on the selected object goes one level deeper toward the pointer; on the
        // deepest, a text object takes the caret there (Keynote).
        if (!d.handle && d.wasSelected && !d.moved) {
          if (d.deeper) this.select(this.keyOf(d.deeper));
          else if (this.editable(d.el)) this.beginText(this.keyOf(d.el), { x: e.clientX, y: e.clientY });
        }
        this.update();
        return;
      }
      const r = d.result, id = this.keyOf(d.el);
      if (d.handle) this.post({ type: 'resize', id, left: r.left, top: r.top, width: r.width, height: r.height });
      else if (r.left !== round(d.box.left) || r.top !== round(d.box.top)) this.post({ type: 'move', id, left: r.left, top: r.top });
      this.update();
    },

    onClick(e) {
      // The engine advances on a stage click; while paused a click only selects.
      if (this.suspended || this.editing?.el.contains(e.target)) return;
      if (this.inStage(e) || e.target?.closest?.('.sage-canvas-overlay')) { e.preventDefault(); e.stopPropagation(); }
    },

    /** A double-click goes straight to the deepest text under the pointer, with the word selected. */
    onDblClick(e) {
      if (this.suspended || !this.inStage(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.editing) { this.selectWordAt(e.clientX, e.clientY); return; }
      const p = this.toStage(e.clientX, e.clientY);
      const chain = this.chainAt(p.x, p.y);
      if (!chain.length) return;
      const el = [...chain].reverse().find((n) => this.editable(n)) || chain[chain.length - 1];
      const id = this.keyOf(el);
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
        const i = objs.indexOf(this.el(this.sel));
        const n = i < 0 ? (shift ? objs.length - 1 : 0) : (i + (shift ? -1 : 1) + objs.length) % objs.length;
        this.select(this.keyOf(objs[n]));
        return true;
      }
      if (!this.sel) return false;
      if (name === 'Escape') { this.select(this.keyOf(this.parentCandidate(this.el(this.sel)))); return true; }
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
      if (n.left !== round(n.from.left) || n.top !== round(n.from.top)) this.post({ type: 'move', id: this.keyOf(n.el), left: n.left, top: n.top });
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
      this.textDrag = null;
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
        this.post({ type: 'refused', id: this.keyOf(el), reason: 'block-children' });
        return null;
      }
      const msg = { type: 'text', id: this.keyOf(el), html };
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
      const msg = Object.assign({ type: 'format', id: this.keyOf(this.editing.el) }, st), key = JSON.stringify(msg);
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
      this.post({ type: 'style', id: this.keyOf(el), style });
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
