#!/usr/bin/env python3
"""Build the public, self-contained version of the ISSTA'26 talk.

Output: public/ui-repair-issta26.html — one file with the CSS, engine, font and
images inlined, ending after the Summary with an end card. The private chapter,
the backup slides, the recruiting slide, the speaker notes, the presenter
window and the in-page editor are all stripped.
"""
import base64, json, mimetypes, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'index.html'), encoding='utf-8').read()
css = open(os.path.join(here, 'talk.css'), encoding='utf-8').read()
js = open(os.path.join(here, 'talk.js'), encoding='utf-8').read()

def cut(s, a, b, repl=''):
    i = s.index(a); j = s.index(b, i)
    return s[:i] + repl + s[j:]

# ---- HTML: drop the dark chapter, the Sparsh slide, the close card; add an end card ----
src = cut(src, '  <div class="scene" id="black"', '\n</div>\n</div>\n\n<script type="application/json"', '''  <!-- ===================== END CARD (public build) ===================== -->
  <div class="scene center" id="end">
    <div class="eyebrow" id="end-eye" data-a>ISSTA 2026 · Oakland, California</div>
    <h1 class="h-l" id="end-h" data-a style="margin-top:20px;max-width:1500px;font-size:80px">Automated Program Repair for UI-centric Android Bugs: How Far are We?</h1>
    <p class="authors-line" id="end-au" data-a style="margin-top:30px;text-align:center">Junayed Mahmud · Sparsh Pandey · Nadeeshan De Silva · Atish Kumar Dipongkor · Jingjing Wu<br>Oscar Chaparro · Mattia Fazzini · <b>Kevin Moran</b></p>
    <div id="end-links" data-a style="margin-top:46px;display:flex;gap:18px;justify-content:center">
      <a class="endbtn" href="https://github.com/SageSELab/UI-Program-Repair" target="_blank" rel="noopener">Code &amp; benchmark</a>
      <a class="endbtn ghost" href="https://doi.org/10.5281/zenodo.21521939" target="_blank" rel="noopener">Zenodo archive</a>
      <a class="endbtn ghost" href="https://sagelab.io" target="_blank" rel="noopener">SAGE Lab</a>
    </div>
    <div class="logos" id="end-lg" data-a style="margin-top:60px;justify-content:center"><img class="sage" src="assets/sage.png" alt=""><img src="assets/ucf.png" alt=""><img src="assets/wm.png" alt=""><img src="assets/umn.png" alt="University of Minnesota" style="height:46px"></div>
  </div>
''')
# text overrides block: keep (edits made in the talk carry over); drop the editor + presenter scripts
src = src.replace('<script src="edit.js"></script>\n', '')

# ---- script: cut chapter 8 .. before CHAP, replace with the end card script ----
src = cut(src, '  // ======================================================================\n  // CHAPTER 8', '  const CHAP = T.chapters;', '''  // ---- end card (public build) ----
  const c8 = c7 + 22.5;
  T.out('#sum-eye, #sum-rows .sumrow, #sum-pkg', c8, { dur: 0.5, stagger: 0.03 });
  T.in('#end-eye', c8 + 0.6, { dur: 0.8, y: 14 });
  T.in('#end-h', c8 + 0.8, { dur: 1.1, y: 26 });
  T.in('#end-au', c8 + 1.4, { dur: 1, y: 18 });
  T.in('#end-links', c8 + 1.9, { dur: 0.9, y: 16 });
  T.in('#end-lg', c8 + 2.3, { dur: 0.9, y: 12 });
  cp(c8 + 4.0, 'Paper');
''')
src = src.replace("{ at: 240.9, label: 'One more thing' }, { at: 271.9, label: 'Backup' }], checkpoints: CP });", "{ at: 240.9, label: 'Paper' }], checkpoints: CP });")
src = re.sub(r"const T = new Talk\(\{ duration: \d+(?:\.\d+)?,", "const T = new Talk({ duration: 244.8,", src)
src = re.sub(r"T\.tween\(0, \d+(?:\.\d+)?, \(p\) => \{ const t = p \* \d+(?:\.\d+)?;", "T.tween(0, 244.8, (p) => { const t = p * 244.8;", src)
# speaker notes out of the public source
src = re.sub(r"cp\(([^,\n]+),\s*('(?:[^'\\]|\\.)*'),\s*'(?:[^'\\]|\\.)*'(?:,\s*true)?\)", r"cp(\1, \2)", src)
# editor hooks out
src = src.replace("  const ED = new TalkEdit(T, { checkpoints: CP });\n  ED.apply();\n", "  const ED = new TalkOverrides(CP);\n  ED.apply();\n")
src = re.sub(r"  ED\.apply\(\); ED\.applyNotes\(\);\n  T\.editor = ED;\n  window\.ED = ED;\n  if \(new URLSearchParams\(location\.search\)\.has\('edit'\)\) setTimeout\(\(\) => ED\.enter\(\), 50\);\n", "  ED.apply();\n", src)
src = re.sub(r"  if \(new URLSearchParams\(location\.search\)\.has\('eds'\)\)[^\n]*\n", "", src)
src = re.sub(r"  if \(new URLSearchParams\(location\.search\)\.has\('dbgpath'\)\)[^\n]*\n", "", src)
src = cut(src, "  // ?debug: dump the state of the pulse dots", "})();\n</script>", '')
# slide counter: plain pane number
src = src.replace("slideno.textContent = CP[pane - 1].backup ? 'Backup ' + (pane - mainN) + ' / ' + (CP.length - mainN) : pane + ' / ' + mainN + '  ·  ' + ch.label;", "slideno.textContent = pane + ' / ' + mainN + '  ·  ' + ch.label;")
src = src.replace("slideno.classList.toggle('dark', t >= 241.1 && t < 333.6);", "")

# ---- engine: web variant ----
js = js.replace("""    fit() {
      const r = this.root.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
      this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
    }""", """    // CSS zoom, not transform: scale, so composited layers shrink with the
    // displayed size (a scale transform rasterizes every layer at 1920×1080 and
    // iOS Safari kills the tab). Same approach as the paper films.
    fit() {
      const r = this.root.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
      const ZOOM = typeof CSS !== 'undefined' && CSS.supports('zoom', '0.5');
      const IOS = /Apple/.test(navigator.vendor) && navigator.maxTouchPoints > 1;
      if (ZOOM) {
        this.stage.style.transform = 'none';
        this.stage.style.zoom = s;
        if (IOS) this.stage.style.webkitTextSizeAdjust = s * 100 + '%';
        this.stage.style.left = (r.width - 1920 * s) / 2 / s + 'px';
        this.stage.style.top = (r.height - 1080 * s) / 2 / s + 'px';
      } else {
        this.stage.style.left = '50%'; this.stage.style.top = '50%';
        this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
      }
    }""")
js = js.replace("        else if (k === 'n' || k === 'N') this.openPresenter();\n", "")
js = js.replace("      if (q.has('t')) return this.render(parseFloat(q.get('t')));\n      this.render(0);", "      if (q.has('t')) return this.render(parseFloat(q.get('t')));\n      this.render(0);\n      // Web: play the title build on load, then hold at the first stop.\n      if (!q.has('capture')) this.play(this.cps[0]?.at ?? null);")
js = js.replace("        else if (k === 't' || k === 'T') { this.started = Date.now(); this.sync?.(); }\n", "")
js = js.replace("    markStart() {\n      if (!this.started) { this.started = Date.now(); this.sync?.(); }\n    }", "    markStart() {\n      if (!this.started) { this.started = Date.now(); this.sync?.(); document.querySelector('.hint')?.classList.add('gone'); }\n    }")
# a tiny overrides applier replaces the editor
js += """
(function () {
  class TalkOverrides {
    constructor(cps) { this.cps = cps; this.stage = document.querySelector('.stage'); this.o = { text: {} };
      try { this.o = Object.assign({ text: {} }, JSON.parse(document.getElementById('text-overrides').textContent || '{}')); } catch (e) {} }
    apply() { for (const [p, html] of Object.entries(this.o.text)) { let el = null; try { el = this.stage.querySelector(':scope>' + p); } catch (e) {} if (el && el.innerHTML !== html) el.innerHTML = html; } }
  }
  window.TalkOverrides = TalkOverrides;
})();
"""
# public build: scrub notes from the overrides block too
m = re.search(r'(<script type="application/json" id="text-overrides">)([\s\S]*?)(</script>)', src)
try:
    ov = json.loads(m.group(2)); ov.pop('notes', None)
    src = src[:m.start(2)] + '\n' + json.dumps(ov).replace('</', '<\\/') + '\n' + src[m.end(2):]
except Exception as e:
    print('overrides block not JSON:', e, file=sys.stderr)

# ---- CSS: keep the controls visible while holding; end card; hint ----
css += """
.film:not(.is-playing) .film-ui { opacity: 1; }
.film-ui { padding-bottom: 14px; }
.endbtn { display: inline-block; padding: 16px 34px; border-radius: 999px; background: var(--ink); color: #fff; font: 700 26px var(--display); text-decoration: none; }
.endbtn.ghost { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 2px var(--line); }
.endbtn:hover { background: var(--a1); color: #fff; box-shadow: none; }
.hint { position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 20; padding: 12px 22px; border-radius: 999px; background: rgba(20,20,22,.88); color: #f5f5f7; font: 600 15px var(--text); letter-spacing: .02em; transition: opacity .5s; pointer-events: none; backdrop-filter: blur(8px); }
.hint.gone { opacity: 0; }
#slideno { display: none; }
@media (max-width: 900px) { .hint { font-size: 12px; padding: 9px 14px; bottom: 52px; white-space: nowrap; } }
"""

# ---- inline assets ----
def datauri(path):
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if path.endswith('.woff2'): mime = 'font/woff2'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())
used = set()
def inline_html(m):
    p = m.group(1); used.add(p)
    return 'src="%s"' % datauri(os.path.join(here, p))
src = re.sub(r'src="(assets/[^"]+)"', inline_html, src)
css = re.sub(r'url\("(assets/[^"]+)"\)', lambda m: 'url("%s")' % datauri(os.path.join(here, m.group(1))), css)

# ---- assemble ----
head_extra = '<meta name="robots" content="noindex">\n<link rel="icon" href="/icon-192.png" sizes="any" type="image/png">\n<meta name="description" content="Talk slides for “Automated Program Repair for UI-centric Android Bugs: How Far are We?” (ISSTA 2026). Press space or tap to advance.">'
src = src.replace('<link rel="stylesheet" href="talk.css">', head_extra + '\n<style>\n' + css + '\n</style>')
src = src.replace('<script src="talk.js"></script>', '<script>\n' + js + '\n</script>')
src = src.replace('<div class="film">\n<div class="stage">', '<div class="film">\n<div class="hint">Press space or tap to play to the next stop · ← back · F fullscreen</div>\n<div class="stage">', 1)
assert 'assets/' not in src, 'unresolved asset reference'
os.makedirs(os.path.join(here, 'public'), exist_ok=True)
out = os.path.join(here, 'public', 'ui-repair-issta26.html')
open(out, 'w', encoding='utf-8').write(src)
print('wrote', out, round(len(src) / 1e6, 2), 'MB')
