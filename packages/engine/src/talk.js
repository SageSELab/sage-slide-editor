// talk.js — the publications-film engine (film.js) extended for a live talk.
//
// One 1920×1080 stage, every animation registered at an absolute time on a
// single master clock, so render(t) is deterministic: seeking, scrubbing and
// frame capture (?t=12.5&capture) all go through the same path.
//
// What this adds over film.js:
//   • checkpoints: Space / → plays to the next checkpoint and holds there;
//     ← jumps back one checkpoint; Enter plays through without holding.
//   • a presenter window (N) synced over BroadcastChannel: current notes,
//     talk timer, and the frame currently on the projector.
//   • ?cp=N opens holding at checkpoint N (1-based); ?t=S holds at a time.
(function () {
  'use strict';

  const EASE = {
    out: 'cubic-bezier(.16,1,.3,1)',
    inOut: 'cubic-bezier(.65,0,.35,1)',
    in: 'cubic-bezier(.7,0,.84,0)',
    spring: 'cubic-bezier(.34,1.56,.64,1)',
    linear: 'linear',
  };
  const JS_EASE = {
    out: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    in: (p) => p * p * p,
    linear: (p) => p,
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  class Talk {
    constructor({ duration, chapters = [], checkpoints = [] }) {
      this.duration = duration;
      this.chapters = chapters;
      // Keep the caller's array: scripts register checkpoints after construction.
      this.cps = checkpoints;
      this.root = document.querySelector('.film');
      this.stage = this.root.querySelector('.stage');
      this.anims = [];
      this.tweens = [];
      this.owned = new WeakMap();
      this.t = 0;
      this.playing = false;
      this.stopAt = null;
      this.last = 0;
      this.presenter = new URLSearchParams(location.search).has('presenter');
      this.fit();
      addEventListener('resize', () => this.fit());
    }

    // --- authoring ----------------------------------------------------------

    els(sel) {
      if (typeof sel !== 'string') return sel instanceof Element ? [sel] : [...sel];
      return [...this.stage.querySelectorAll(sel)];
    }

    anim(sel, t, dur, keyframes, { ease = 'out', stagger = 0 } = {}) {
      this.els(sel).forEach((el, i) => {
        const props = new Set();
        for (const k of keyframes) for (const p in k) if (p !== 'offset' && p !== 'easing') props.add(p);
        const owned = this.owned.get(el) ?? new Set();
        const first = [...props].some((p) => !owned.has(p));
        props.forEach((p) => owned.add(p));
        this.owned.set(el, owned);
        const a = el.animate(keyframes, {
          duration: Math.max(1, dur * 1000),
          delay: (t + i * stagger) * 1000,
          fill: first ? 'both' : 'forwards',
          easing: EASE[ease] ?? ease,
        });
        a.pause();
        this.anims.push(a);
      });
      return this;
    }

    in(sel, t, { dur = 1, y = 40, x = 0, scale = 1, blur = 12, stagger = 0, ease = 'out' } = {}) {
      return this.anim(
        sel, t, dur,
        [
          { opacity: 0, transform: `translate(${x}px,${y}px) scale(${scale})`, filter: `blur(${blur}px)` },
          { opacity: 1, transform: 'translate(0,0) scale(1)', filter: 'blur(0px)' },
        ],
        { ease, stagger }
      );
    }

    out(sel, t, { dur = 0.6, y = -30, x = 0, scale = 1, blur = 10, stagger = 0, ease = 'inOut' } = {}) {
      return this.anim(sel, t, dur, [{ opacity: 0, transform: `translate(${x}px,${y}px) scale(${scale})`, filter: `blur(${blur}px)` }], { ease, stagger });
    }

    // Hold an element visible (for things that should simply exist from t on).
    show(sel, t) {
      // From-zero keyframe so the backwards fill keeps the element hidden before t.
      return this.anim(sel, t, 0.01, [{ opacity: 0 }, { opacity: 1 }]);
    }
    hide(sel, t) {
      return this.anim(sel, t, 0.01, [{ opacity: 0 }, { opacity: 0 }]);
    }

    tween(t, dur, fn, ease = 'out') {
      this.tweens.push({ t, dur, fn, ease: JS_EASE[ease] ?? JS_EASE.out });
      return this;
    }

    count(sel, t, dur, to, { from = 0, format = (v) => Math.round(v).toLocaleString('en-US') } = {}) {
      this.els(sel).forEach((el) => this.tween(t, dur, (p) => (el.textContent = format(from + (to - from) * p))));
      return this;
    }

    // Typewriter over the element's own text (set once, at registration).
    type(sel, t, dur, { cursor = false } = {}) {
      this.els(sel).forEach((el) => {
        const full = el.textContent;
        this.tween(t, dur, (p) => {
          if (p <= 0) { el.textContent = ''; return; }
          const n = Math.round(full.length * p);
          el.textContent = full.slice(0, n) + (cursor && p < 1 ? '▍' : '');
        }, 'linear');
      });
      return this;
    }

    // Word-by-word reveal of .w spans inside sel.
    words(sel, t, { stagger = 0.09, dur = 0.9, y = 30, blur = 8 } = {}) {
      this.show(sel, t);
      return this.in(`${sel} .w`, t, { dur, y, blur, stagger });
    }

    // Draw an SVG path by stroke-dashoffset from fraction a to b of its length.
    draw(sel, t, dur, a, b, ease = 'inOut') {
      this.els(sel).forEach((p) => {
        const L = p.getTotalLength();
        // Gap of 2L, not L: with a gap of exactly L WebKit paints the zero-length dash at the
        // pattern boundary as a round-cap dot. Visually identical otherwise.
        p.style.strokeDasharray = L + ' ' + 2 * L;
        this.anim(p, t, dur, [{ strokeDashoffset: L * (1 - a) }, { strokeDashoffset: L * (1 - b) }], { ease });
      });
      return this;
    }

    // --- playback ---------------------------------------------------------------

    render(t) {
      this.t = clamp(t, 0, this.duration);
      const ms = this.t * 1000;
      for (const a of this.anims) a.currentTime = ms;
      for (const tw of this.tweens) tw.fn(tw.ease(clamp((this.t - tw.t) / tw.dur, 0, 1)));
      this.ui?.sync();
      this.sync?.();
      this.onRender?.(this.t);
      if (this.editor?.on && !this.playing) { clearTimeout(this._edT); this._edT = setTimeout(() => this.editor.refresh(), 120); }
    }

    play(stopAt = null) {
      if (this.t >= this.duration) return;
      this.stopAt = stopAt;
      this.playing = true;
      this.last = performance.now();
      this.root.classList.add('is-playing');
      const step = (now) => {
        if (!this.playing) return;
        let nt = this.t + (now - this.last) / 1000;
        this.last = now;
        if (this.stopAt != null && nt >= this.stopAt - 1e-4) {
          this.render(this.stopAt);
          return this.pause();
        }
        this.render(nt);
        if (this.t >= this.duration) return this.pause();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      this.ui?.sync();
    }

    pause() {
      this.playing = false;
      this.stopAt = null;
      this.root.classList.remove('is-playing');
      this.ui?.sync();
      this.sync?.();
    }

    seek(t) {
      this.pause();
      this.render(t);
    }

    // Index of the checkpoint we are holding at or have passed (-1 before the first).
    cpIndex(t = this.t) {
      let i = -1;
      this.cps.forEach((c, k) => { if (c.at <= t + 0.02) i = k; });
      return i;
    }
    nextCp(t = this.t) {
      return this.cps.find((c) => c.at > t + 0.02) ?? null;
    }

    // Space / →: play to the next checkpoint. If already playing, skip to it.
    next() {
      if (this.playing) {
        const target = this.stopAt ?? this.nextCp()?.at ?? this.duration;
        return this.seek(target);
      }
      const n = this.nextCp();
      this.play(n ? n.at : null);
    }
    // ←: back to the previous checkpoint (the held frame of the previous beat).
    prev() {
      const i = this.cpIndex(this.t - 0.05);
      this.seek(i >= 0 ? this.cps[i].at : 0);
    }
    // Enter: play through without holding (rehearsal / video).
    through() {
      this.playing ? this.pause() : this.play(null);
    }

    fit() {
      const r = this.root.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
      this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
    }

    // --- boot ------------------------------------------------------------------------

    start() {
      this.cps.sort((a, b) => a.at - b.at);
      const q = new URLSearchParams(location.search);
      this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('talk-sync') : null;
      if (this.presenter) return this.bootPresenter();
      if (!q.has('capture')) this.buildUI();
      this.bindKeys();
      if (this.channel) {
        this.channel.onmessage = (e) => {
          const m = e.data;
          if (m.cmd === 'next') this.next();
          else if (m.cmd === 'prev') this.prev();
          else if (m.cmd === 'through') this.through();
          else if (m.cmd === 'seek') this.seek(m.t);
          else if (m.cmd === 'hello') this.sync();
          else if (m.cmd === 'note') this.editor?.noteEdit(m.idx, m.text);
        };
        this.sync = () => this.channel.postMessage({ t: this.t, playing: this.playing, started: this.started ?? null });
      }
      if (q.has('cp')) {
        const c = this.cps[clamp(parseInt(q.get('cp'), 10) - 1, 0, this.cps.length - 1)];
        return this.render(c ? c.at : 0);
      }
      if (q.has('t')) return this.render(parseFloat(q.get('t')));
      this.render(0);
    }

    bindKeys() {
      addEventListener('keydown', (e) => {
        const k = e.key;
        if ((e.metaKey || e.ctrlKey) && (k === 's' || k === 'S')) { e.preventDefault(); this.editor?.save(); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (k === 'Escape' && this.editor?.on) { this.editor.exit(); return; }
        if (k === 'e' || k === 'E') { if (!document.activeElement?.isContentEditable) { this.editor?.toggle(); return; } }
        if (document.activeElement?.isContentEditable) return;
        if (k === ' ' || k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); this.markStart(); this.next(); }
        else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); this.prev(); }
        else if (k === 'Enter') { e.preventDefault(); this.markStart(); this.through(); }
        else if (k === 'Home') this.seek(0);
        else if (k === 'End') this.seek(this.duration);
        else if (k === 'f' || k === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        else if (k === 'n' || k === 'N') this.openPresenter();
        else if (k === 't' || k === 'T') { this.started = Date.now(); this.sync?.(); }
        else if (k === 'h' || k === 'H') this.root.classList.toggle('hide-ui');
        else if (k === '.') { const n = this.nextCp(); if (n) this.seek(n.at); }
      });
      this.stage.addEventListener('click', (e) => {
        if (e.target.closest('a') || this.editor?.on) return;
        this.markStart();
        if (e.clientX < innerWidth * 0.12) this.prev(); else this.next();
      });
    }
    markStart() {
      if (!this.started) { this.started = Date.now(); this.sync?.(); }
    }

    openPresenter() {
      const u = new URL(location.href);
      u.searchParams.set('presenter', '1');
      u.searchParams.delete('cp'); u.searchParams.delete('t');
      window.open(u.toString(), 'talk-presenter', 'width=1400,height=900');
    }

    buildUI() {
      const bar = document.createElement('div');
      bar.className = 'film-ui';
      const segs = this.segments();
      bar.innerHTML = `
        <div class="film-track" role="slider" tabindex="0" aria-label="Seek">
          ${segs.map((s) => `<span class="film-seg" style="flex:${s.len}"><i></i><b>${s.label}</b></span>`).join('')}
          <span class="film-ticks">${this.cps.map((c) => `<u style="left:${(c.at / this.duration) * 100}%"></u>`).join('')}</span>
        </div>
        <span class="film-cp"></span>
        <span class="film-time">0:00</span>`;
      this.root.appendChild(bar);
      const track = bar.querySelector('.film-track');
      const time = bar.querySelector('.film-time');
      const cpl = bar.querySelector('.film-cp');
      const fills = [...bar.querySelectorAll('.film-seg i')];
      this.ui = {
        sync: () => {
          segs.forEach((s, i) => { fills[i].style.transform = `scaleX(${clamp((this.t - s.at) / s.len, 0, 1)})`; });
          time.textContent = fmt(this.t) + ' / ' + fmt(this.duration);
          const i = this.cpIndex();
          cpl.textContent = (i + 1) + ' / ' + this.cps.length;
        },
      };
      const scrub = (e) => {
        const r = track.getBoundingClientRect();
        this.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * this.duration);
      };
      track.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        track.setPointerCapture(e.pointerId);
        scrub(e);
        const move = (ev) => scrub(ev);
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', () => track.removeEventListener('pointermove', move), { once: true });
      });
      let idle;
      const wake = () => {
        this.root.classList.add('is-awake');
        clearTimeout(idle);
        idle = setTimeout(() => this.root.classList.remove('is-awake'), 2200);
      };
      this.root.addEventListener('pointermove', wake);
    }

    segments() {
      const c = this.chapters.length ? this.chapters : [{ at: 0, label: '' }];
      return c.map((ch, i) => ({ at: ch.at, len: (c[i + 1]?.at ?? this.duration) - ch.at, label: ch.label }));
    }

    // --- presenter window ----------------------------------------------------------

    bootPresenter() {
      document.body.classList.add('presenter');
      const pane = document.createElement('div');
      pane.className = 'pres';
      pane.innerHTML = `
        <div class="pres-top"><span class="pres-clock">00:00</span><span class="pres-pos"></span><span class="pres-state"></span></div>
        <div class="pres-now"><div class="pres-k">Now</div><div class="pres-notes"></div></div>
        <div class="pres-next"><div class="pres-k">Next</div><div class="pres-nextlabel"></div></div>
        <div class="pres-help">Space / → play to next hold · ← back · Enter play through · T reset clock</div>`;
      document.body.appendChild(pane);
      const clock = pane.querySelector('.pres-clock'), pos = pane.querySelector('.pres-pos'), st = pane.querySelector('.pres-state');
      const notes = pane.querySelector('.pres-notes'), nextl = pane.querySelector('.pres-nextlabel');
      let started = null;
      const paint = () => {
        const i = this.cpIndex();
        const holding = this.cps[i];
        const heading = this.nextCp();
        const cur = this.playing ? heading : holding;
        const idx = cur ? this.cps.indexOf(cur) : -1;
        if (notes.dataset.idx !== String(idx) || document.activeElement !== notes.querySelector('p')) {
          notes.dataset.idx = String(idx);
          notes.innerHTML = cur ? `<b>${cur.label}</b><p contenteditable="plaintext-only" spellcheck="false">${cur.notes || ''}</p><small class="pres-hint">click the notes to edit · ⌘S in the main window saves</small>` : '<p>Press space to begin.</p>';
          const p = notes.querySelector('p[contenteditable]');
          if (p) p.addEventListener('input', () => this.channel?.postMessage({ cmd: 'note', idx, text: p.textContent }));
        }
        const nx = this.playing ? this.cps[this.cps.indexOf(heading) + 1] : heading;
        nextl.textContent = nx ? nx.label : 'End';
        pos.textContent = `hold ${i + 1} / ${this.cps.length} · ${fmt(this.t)}`;
        st.textContent = this.playing ? '▶ playing' : '❚❚ holding';
      };
      setInterval(() => {
        if (started) { const s = Math.floor((Date.now() - started) / 1000); clock.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
      }, 500);
      if (this.channel) {
        this.channel.onmessage = (e) => {
          const m = e.data;
          if (typeof m.t !== 'number') return;
          this.playing = m.playing;
          started = m.started;
          this.render(m.t);
          paint();
        };
        this.channel.postMessage({ cmd: 'hello' });
      }
      addEventListener('keydown', (e) => {
        const k = e.key;
        if (document.activeElement?.isContentEditable) return;
        const send = (cmd) => this.channel?.postMessage({ cmd });
        if (k === ' ' || k === 'ArrowRight') { e.preventDefault(); send('next'); }
        else if (k === 'ArrowLeft') { e.preventDefault(); send('prev'); }
        else if (k === 'Enter') { e.preventDefault(); send('through'); }
      });
      this.render(0);
      paint();
    }
  }

  window.Talk = Talk;
})();
