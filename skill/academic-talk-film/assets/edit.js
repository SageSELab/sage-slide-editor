// edit.js — in-page text editing for the talk, saved back into index.html.
//
// Press E to enter edit mode. Any text on the current pane becomes editable in
// place. Presenter notes are editable in the presenter window (N). ⌘S / Ctrl+S
// writes the changes into index.html. Open the deck through serve.py
// (http://localhost:8765) and saves go straight to disk with no dialog; opened
// from disk (file://) Chrome blocks file writing, so the save falls back to the
// File System Access API picker where allowed, or to a download. Edits are kept
// as overrides in a JSON block inside index.html (keyed by the element's path in
// the stage), so the source markup stays untouched and the overrides survive
// re-renders of generated content. A draft is also kept in localStorage until
// the save succeeds. Browsers without the API (Safari) download a new index.html.
(function () {
  'use strict';
  const INLINE = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'CODE', 'BR', 'U', 'SUB', 'SUP']);
  const DRAFT_KEY = 'talk-overrides-draft';

  class TalkEdit {
    constructor(talk, { checkpoints }) {
      this.T = talk;
      this.cps = checkpoints;
      this.stage = document.querySelector('.stage');
      this.block = document.getElementById('text-overrides');
      this.overrides = { text: {}, notes: {} };
      this.pristine = {};
      this.dirty = false;
      this.on = false;
      this.handle = null;
      try { this.overrides = Object.assign({ text: {}, notes: {} }, JSON.parse(this.block.textContent || '{}')); } catch (e) { console.warn('overrides block unreadable', e); }
      this.fileOverrides = JSON.parse(JSON.stringify(this.overrides));
      try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (d && d.text) { this.overrides = d; this.dirty = true; this.draftRestored = true; }
      } catch (e) {}
    }

    // --- paths ----------------------------------------------------------------
    pathOf(el) {
      const parts = [];
      for (let n = el; n && n !== this.stage; n = n.parentElement) {
        let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
        parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      }
      return parts.join('>');
    }
    byPath(p) { try { return this.stage.querySelector(':scope>' + p.split('>').join('>')); } catch (e) { return null; } }

    // Apply text overrides to whatever exists in the stage right now. Safe to call
    // repeatedly (generated content appears in stages during the script).
    apply() {
      for (const [p, html] of Object.entries(this.overrides.text)) {
        const el = this.byPath(p);
        if (!el || el.innerHTML === html) continue;
        if (!(p in this.pristine)) this.pristine[p] = el.innerHTML;
        el.innerHTML = html;
      }
    }
    applyNotes() {
      for (const [i, n] of Object.entries(this.overrides.notes)) if (this.cps[i]) { if (this.cps[i].srcNotes === undefined) this.cps[i].srcNotes = this.cps[i].notes; this.cps[i].notes = n; }
    }

    // --- edit mode ------------------------------------------------------------
    editable(el) {
      if (!el.closest || !this.stage.contains(el) || el.closest('#slideno') || el.closest('svg')) return false;
      if (!el.textContent.trim()) return false;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      for (const c of el.children) { if (!INLINE.has(c.tagName)) return false; if (!ownText && c.hasAttribute('data-a')) return false; }
      return true;
    }
    visible(el) {
      // Visible right now: every ancestor up to the stage is opaque enough and not hidden.
      for (let n = el; n && n !== this.stage; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.3) return false;
      }
      const r = el.getBoundingClientRect(), s = this.stage.getBoundingClientRect();
      return r.width > 0 && r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom;
    }
    targets() {
      const out = [];
      const walk = (el) => {
        if (el !== this.stage) { const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.3) return; }
        if (el !== this.stage && this.editable(el)) { if (this.visible(el)) out.push(el); return; }
        for (const c of el.children) walk(c);
      };
      walk(this.stage);
      return out;
    }
    // Re-scan after the playhead moves while editing, so the editable set follows the pane.
    refresh() { if (!this.on) return; const keep = this.overrides; this.exit(); this.enter(); this.overrides = keep; }
    toggle() { this.on ? this.exit() : this.enter(); }
    enter() {
      this.on = true;
      this.T.pause();
      document.querySelector('.film').classList.add('editing');
      this.orig = new Map();
      this.targets().forEach((el) => {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.classList.add('ed');
        this.orig.set(el, el.innerHTML);
        el.addEventListener('input', this.onInput);
        el.addEventListener('focus', this.onFocus);
      });
      this.bar();
    }
    exit() {
      this.on = false;
      document.querySelector('.film').classList.remove('editing');
      this.stage.querySelectorAll('.ed').forEach((el) => { el.removeAttribute('contenteditable'); el.classList.remove('ed'); el.removeEventListener('input', this.onInput); el.removeEventListener('focus', this.onFocus); });
      this.barEl?.remove(); this.barEl = null;
    }
    onFocus = (e) => { e.target.dataset.edPath = this.pathOf(e.target); };
    onInput = (e) => {
      const el = e.target, p = this.pathOf(el);
      const base = p in this.pristine ? this.pristine[p] : (p in this.fileOverrides.text ? this.fileOverrides.text[p] : null);
      const source = this.pristine[p] ?? this.orig.get(el);
      if (!(p in this.pristine) && !(p in this.overrides.text)) this.pristine[p] = this.orig.get(el);
      if (el.innerHTML === this.pristine[p]) delete this.overrides.text[p]; else this.overrides.text[p] = el.innerHTML;
      this.markDirty();
    };
    noteEdit(i, text) {
      if (!this.cps[i]) return;
      if (this.cps[i].srcNotes === undefined) this.cps[i].srcNotes = this.cps[i].notes;
      this.cps[i].notes = text;
      if (text === this.cps[i].srcNotes) delete this.overrides.notes[i]; else this.overrides.notes[i] = text;
      this.markDirty();
    }
    markDirty() {
      this.dirty = true;
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(this.overrides)); } catch (e) {}
      this.status();
    }
    count() { return Object.keys(this.overrides.text).length + Object.keys(this.overrides.notes).length; }

    bar() {
      const b = document.createElement('div');
      b.className = 'edbar';
      b.innerHTML = `<b>Editing</b><span class="edmsg"></span><button class="edsave">Save to index.html (⌘S)</button><button class="eddl">Download copy</button><button class="edreset">Discard draft</button><button class="edexit">Done (Esc)</button>`;
      document.body.appendChild(b);
      this.barEl = b;
      b.querySelector('.edsave').onclick = () => this.save();
      b.querySelector('.eddl').onclick = () => this.download();
      b.querySelector('.edexit').onclick = () => this.exit();
      b.querySelector('.edreset').onclick = () => { if (confirm('Discard all unsaved text edits and reload?')) { localStorage.removeItem(DRAFT_KEY); location.reload(); } };
      this.status();
    }
    status(msg) {
      const m = this.barEl?.querySelector('.edmsg'); if (!m) return;
      m.textContent = msg || (this.count() ? this.count() + ' change' + (this.count() === 1 ? '' : 's') + (this.dirty ? ' · unsaved' : ' · saved') : 'click any text to edit it');
    }

    // --- persistence ------------------------------------------------------------
    serialize(src) {
      const json = JSON.stringify(this.overrides, null, 1).replace(/<\//g, '<\\/');
      const re = /(<script type="application\/json" id="text-overrides">)[\s\S]*?(<\/script>)/;
      if (!re.test(src)) throw new Error('overrides block not found in index.html');
      return src.replace(re, (_, a, b) => a + '\n' + json + '\n' + b);
    }
    async save() {
      try {
        if (/^https?:$/.test(location.protocol)) {
          // Served by serve.py: it rewrites the overrides block in index.html for us.
          this.status('saving…');
          const r = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.overrides) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || ('server replied ' + r.status));
          this.fileOverrides = JSON.parse(JSON.stringify(this.overrides));
          this.dirty = false; this.draftRestored = false;
          localStorage.removeItem(DRAFT_KEY);
          return this.status('saved ' + j.saved);
        }
        if (!('showOpenFilePicker' in window)) return this.download();
        if (!this.handle) {
          this.status('choose index.html…');
          const [h] = await showOpenFilePicker({ id: 'talk-index', types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }], multiple: false });
          this.handle = h;
        }
        if ((await this.handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await this.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('write permission denied');
        const src = await (await this.handle.getFile()).text();
        const out = this.serialize(src);
        const w = await this.handle.createWritable();
        await w.write(out); await w.close();
        this.fileOverrides = JSON.parse(JSON.stringify(this.overrides));
        this.dirty = false; this.draftRestored = false;
        localStorage.removeItem(DRAFT_KEY);
        this.status('saved ' + new Date().toLocaleTimeString());
      } catch (e) {
        if (e.name === 'AbortError') return this.status('save cancelled');
        console.error(e);
        const hint = location.protocol === 'file:' ? ' · run serve.py and open localhost:8765 to save in place' : ' (use Download copy)';
        this.status('save failed: ' + e.message + hint);
      }
    }
    async download() {
      // No file handle available: rebuild the file from the live document source.
      const src = document.documentElement.outerHTML; // last resort; prefer the real file when the API exists
      let out;
      try { out = this.serialize('<!doctype html>\n' + src); } catch (e) { return this.status('could not serialize'); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'text/html' })); a.download = 'index.html'; a.click();
      this.status('downloaded index.html · replace the file in talk/');
    }
  }
  window.TalkEdit = TalkEdit;
})();
