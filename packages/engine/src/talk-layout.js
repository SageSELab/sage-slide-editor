// talk-layout.js — the sage-talk/1 layout runtime (first cut, Phase 0 format spike).
//
// Turns a beat-based talk (a JSON spine + Talk.beat registrations) into the absolute-time
// registrations and checkpoints that talk.js already understands. talk.js is unchanged.
//
// Load order in build/index.html (classic scripts, works from file://):
//   talk.js · edit.js (optional) · talk-layout.js · lib/*.js · beats/*.js · <script>Talk.boot()</script>
// The spine is the compiled talk.json, inlined as <script type="application/json" id="talk-spine">.
//
// Layout (PLAN 3.6), walked once, in spine order:
//   beat.start = previous beat's hold time (0 for the first beat)
//   run the beat's function against B (times relative to beat.start) — it registers on the real
//     Talk immediately, while an instrument on T.anim / T.tween records the latest motion end
//   hold = beat.hold ?? lastEnd + holdPad ; checkpoint at beat.start + hold
//   chapter marker = first beat's start + 0.1 (the first chapter stays at 0)
//   duration = last hold + tail (spine.defaults.tail, default 1.0; ISSTA uses 0.5)
// Boundary rule: a beat owns the motion from the previous hold (its t = 0) up to its own hold.
// Motion registered exactly at a hold belongs to the NEXT beat, at t = 0.
(function () {
  'use strict';
  const Talk = window.Talk;
  const beats = new Map(); // 'chapter.beat' -> fn(B)
  const readyFns = [];
  // Snap float noise from start + t back onto the hand-written decimal (27.5 + 0.1 -> 27.6, not
  // 27.600000000000001), but leave genuinely computed times (13.5 + 6/7) untouched.
  const r6 = (v) => { const s = Math.round(v * 1e6) / 1e6; return Math.abs(v - s) < 1e-9 ? s : v; };

  Talk.beat = (id, fn) => { if (beats.has(id)) console.warn('[layout] beat registered twice:', id); beats.set(id, fn); };
  Talk.lib = Talk.lib || {};               // helpers: Talk.lib.<name> = { fn(B, ...) }
  Talk.ready = (fn) => readyFns.push(fn);  // per-talk hooks after layout, before start (slide counter etc.)

  // ---------------------------------------------------------------------------------------
  // B.set: discrete state changes (text, classes, inline style) as a step track per
  // (element, key). One engine tween per track reads T.t and applies the latest step at or
  // before it, else the value captured at registration. Seeking backwards is exact, and a
  // window that spans many beats is just two sets in the beats where it opens and closes.
  // ---------------------------------------------------------------------------------------
  function makeSetter(T, rawTween) {
    const tracks = new Map(); // el -> Map(key -> {steps, initial, apply})
    const track = (el, key, read, write) => {
      let m = tracks.get(el);
      if (!m) tracks.set(el, (m = new Map()));
      let tr = m.get(key);
      if (!tr) {
        tr = { steps: [], initial: read() };
        m.set(key, tr);
        // dur 1, linear: p is irrelevant, the fn reads the engine's current time.
        rawTween(0, 1, () => {
          let v = tr.initial;
          for (const s of tr.steps) if (T.t >= s.at - 1e-9) v = s.value; // steps kept sorted
          write(v);
        }, 'linear');
      }
      return tr;
    };
    return (sel, at, { text, class: cls, style } = {}) => {
      T.els(sel).forEach((el) => {
        const add = (tr, value) => { tr.steps.push({ at, value }); tr.steps.sort((a, b) => a.at - b.at); };
        if (text !== undefined) add(track(el, 'text', () => el.textContent, (v) => { if (el.textContent !== v) el.textContent = v; }), String(text));
        if (cls) for (const c in cls) add(track(el, 'class:' + c, () => el.classList.contains(c), (v) => el.classList.toggle(c, !!v)), !!cls[c]);
        if (style) for (const p in style) add(track(el, 'style:' + p, () => el.style[p], (v) => { el.style[p] = v; }), style[p]);
      });
    };
  }

  // ---------------------------------------------------------------------------------------
  // The beat-scoped API. Every method mirrors T's, with t relative to the beat start.
  // ---------------------------------------------------------------------------------------
  function makeB(T, start, set, noteEnd) {
    const a = (t) => r6(start + t);
    return {
      at: start,          // absolute start of this beat (escape hatch for helpers)
      lib: Talk.lib,
      T,                  // the engine, for anything not covered (registers at absolute times!)
      els: (sel) => T.els(sel),
      in: (sel, t, o) => (T.in(sel, a(t), o), undefined),
      out: (sel, t, o) => (T.out(sel, a(t), o), undefined),
      anim: (sel, t, dur, kf, o) => (T.anim(sel, a(t), dur, kf, o), undefined),
      show: (sel, t) => (T.show(sel, a(t)), undefined),
      hide: (sel, t) => (T.hide(sel, a(t)), undefined),
      words: (sel, t, o) => (T.words(sel, a(t), o), undefined),
      count: (sel, t, dur, to, o) => (T.count(sel, a(t), dur, to, o), undefined),
      type: (sel, t, dur, o) => (T.type(sel, a(t), dur, o), undefined),
      draw: (sel, t, dur, from, to, ease) => (T.draw(sel, a(t), dur, from, to, ease), undefined),
      tween: (t, dur, fn, ease) => (T.tween(a(t), dur, fn, ease), undefined),
      set: (sel, t, props) => { set(sel, a(t), props); noteEnd(a(t)); },
    };
  }

  function boot() {
    const spineEl = document.getElementById('talk-spine');
    const spine = JSON.parse(spineEl.textContent);
    const q = new URLSearchParams(location.search);
    const holdPad = spine.defaults?.holdPad ?? 1.0; // PLAN 3.1: seeds new beats only
    const CP = [];
    const T = new Talk({ duration: 1, chapters: [], checkpoints: CP });
    const ED = window.TalkEdit ? new TalkEdit(T, { checkpoints: CP }) : null;
    ED?.apply();

    // Instrument: every authoring primitive bottoms out in anim() or tween().
    const rawAnim = T.anim.bind(T), rawTween = T.tween.bind(T);
    let lastEnd = -Infinity, curBeat = null;
    const diagnostics = [];
    const noteEnd = (e) => { if (e > lastEnd) lastEnd = e; };
    T.anim = function (sel, t, dur, kf, o = {}) {
      const n = this.els(sel).length;
      if (!n && curBeat) diagnostics.push({ beat: curBeat, code: 'empty-selector', sel: String(sel) });
      if (n) noteEnd(t + (o.stagger || 0) * (n - 1) + dur);
      return rawAnim(sel, t, dur, kf, o);
    };
    T.tween = function (t, dur, fn, ease) { noteEnd(t + dur); return rawTween(t, dur, fn, ease); };
    const set = makeSetter(T, rawTween);

    // Walk the spine.
    const chapters = [], layout = [];
    let cursor = 0;
    const seen = new Set();
    spine.chapters.forEach((ch, ci) => {
      const chBeats = ch.beats || [];
      if (chBeats.length) chapters.push({ at: ci === 0 && cursor === 0 ? 0 : r6(cursor + 0.1), label: ch.label, dark: !!ch.dark, private: !!ch.private, id: ch.id });
      chBeats.forEach((b) => {
        const id = ch.id + '.' + b.id;
        seen.add(id);
        const fn = beats.get(id);
        if (!fn) diagnostics.push({ beat: id, code: 'no-motion-registered' });
        const start = cursor;
        lastEnd = start; curBeat = id;
        if (fn) fn(makeB(T, start, set, noteEnd));
        curBeat = null;
        const rel = r6(lastEnd - start);
        const hold = b.hold ?? r6(rel + holdPad);
        if (b.hold != null && b.hold < rel - 1e-6) diagnostics.push({ beat: id, code: 'hold-before-motion-end', hold: b.hold, lastEnd: rel });
        const at = r6(start + hold);
        CP.push({ at, label: b.label, notes: b.notes || '', backup: !!(b.backup || ch.backup), id });
        layout.push({ id, start, lastEnd: rel, hold, auto: b.hold == null, at });
        cursor = at;
      });
    });
    for (const id of beats.keys()) if (!seen.has(id)) diagnostics.push({ beat: id, code: 'beat-not-in-spine' });
    T.anim = rawAnim; T.tween = rawTween; // authoring after layout (ready hooks) is not timed

    T.chapters = chapters;
    T.duration = r6(cursor + (spine.defaults?.tail ?? 1.0));
    Talk.layout = { beats: layout, chapters, duration: T.duration, diagnostics };
    diagnostics.forEach((d) => console.warn('[layout]', JSON.stringify(d)));

    readyFns.forEach((fn) => fn(T, Talk.layout));
    if (ED) { ED.apply(); ED.applyNotes(); T.editor = ED; window.ED = ED; if (q.has('edit')) setTimeout(() => ED.enter(), 50); }

    // Debug/listing params (formerly per-deck boilerplate).
    const pre = (id, text) => { const p = document.createElement('pre'); p.id = id; p.textContent = text; document.body.appendChild(p); };
    if (q.has('cplist')) pre('cplist', CP.map((c, i) => (i + 1) + ' ' + c.at.toFixed(1) + ' ' + c.label).join('\n'));
    if (q.has('layout')) pre('layout', JSON.stringify(Talk.layout));
    T.start();
    if (q.has('hide')) q.get('hide').split(',').forEach((s) => document.querySelectorAll(s).forEach((e) => (e.style.display = 'none')));
    window.T = T;
    return T;
  }

  Talk.boot = boot;
})();
