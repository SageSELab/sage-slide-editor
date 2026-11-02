#!/usr/bin/env python3
"""Build the public, self-contained version of a talk.

    python3 build-public.py [slug]        → public/<slug>.html (default slug: talk)

What it does to index.html:
  • removes HTML between <!-- private:start --> and <!-- private:end -->
    and script between // private:start and // private:end
    (wrap the follow-up chapter, the backups, the recruiting slide in these);
  • un-comments HTML between <!-- public:start and public:end -->
    and script between /* public:start and public:end */ (the end card);
  • flips `const PUBLIC = false;` to true (DURATION and chapter filtering follow);
  • strips presenter notes from cp(...), swaps the editor for a tiny overrides
    applier, drops presenter/clock keys, autoplays the title build, adds a
    hint pill, hides the slide counter, fits with CSS zoom (iOS-safe);
  • inlines talk.css, talk.js, the font and every assets/ image as data URIs.
"""
import base64, json, mimetypes, os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
slug = sys.argv[1] if len(sys.argv) > 1 else 'talk'
src = open(os.path.join(here, 'index.html'), encoding='utf-8').read()
css = open(os.path.join(here, 'talk.css'), encoding='utf-8').read()
js = open(os.path.join(here, 'talk.js'), encoding='utf-8').read()

# ---- regions ----
src = re.sub(r'[ \t]*<!-- private:start -->[\s\S]*?<!-- private:end -->[ \t]*\n?', '', src)
src = re.sub(r'[ \t]*// private:start[\s\S]*?// private:end[ \t]*\n?', '', src)
src = re.sub(r'<!-- public:start([\s\S]*?)public:end -->', r'\1', src)
src = re.sub(r'/\* public:start([\s\S]*?)public:end \*/', r'\1', src)
assert 'const PUBLIC = false;' in src, 'index.html needs `const PUBLIC = false;` in its script'
src = src.replace('const PUBLIC = false;', 'const PUBLIC = true;', 1)

# ---- notes and editor out ----
src = src.replace('<script src="edit.js"></script>\n', '')
src = re.sub(r"cp\(([^,\n]+),\s*('(?:[^'\\]|\\.)*'),\s*'(?:[^'\\]|\\.)*'(?:,\s*true)?\)", r"cp(\1, \2)", src)
src = src.replace("new TalkEdit(T, { checkpoints: CP })", "new TalkOverrides(CP)")
src = re.sub(r"  ED\.applyNotes\(\);\n", "", src)
src = re.sub(r"  T\.editor = ED;\n", "", src)
src = re.sub(r"  if \(new URLSearchParams\(location\.search\)\.has\('edit'\)\)[^\n]*\n", "", src)
src = re.sub(r"  if \(new URLSearchParams\(location\.search\)\.has\('at'\)\) \{[\s\S]*?\n  \}\n", "", src)   # multi-line block
src = re.sub(r"  if \(new URLSearchParams\(location\.search\)\.has\('(?:eds|dbgpath|hide|debug)'\)\)[^\n]*\n", "", src)
m = re.search(r'(<script type="application/json" id="text-overrides">)([\s\S]*?)(</script>)', src)
if m:
    try:
        ov = json.loads(m.group(2) or '{}'); ov.pop('notes', None)
        src = src[:m.start(2)] + '\n' + json.dumps(ov).replace('</', '<\\/') + '\n' + src[m.end(2):]
    except Exception as e:
        print('overrides block not JSON:', e, file=sys.stderr)

# ---- engine: web variant ----
js = js.replace("""    fit() {
      const r = this.root.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
      this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
    }""", """    // CSS zoom, not transform: scale, so composited layers shrink with the
    // displayed size (a scale transform rasterizes every layer at 1920×1080 and
    // iOS Safari kills the tab).
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
js = js.replace("        else if (k === 't' || k === 'T') { this.started = Date.now(); this.sync?.(); }\n", "")
js = js.replace("      if (q.has('t')) return this.render(parseFloat(q.get('t')));\n      this.render(0);",
                "      if (q.has('t')) return this.render(parseFloat(q.get('t')));\n      this.render(0);\n      if (!q.has('capture')) this.play(this.cps[0]?.at ?? null);")
js = js.replace("    markStart() {\n      if (!this.started) { this.started = Date.now(); this.sync?.(); }\n    }",
                "    markStart() {\n      if (!this.started) { this.started = Date.now(); this.sync?.(); document.querySelector('.hint')?.classList.add('gone'); }\n    }")
js += """
(function () {
  class TalkOverrides {
    constructor(cps) { this.cps = cps; this.stage = document.querySelector('.stage'); this.o = { text: {} };
      try { this.o = Object.assign({ text: {} }, JSON.parse(document.getElementById('text-overrides').textContent || '{}')); } catch (e) {} }
    apply() { for (const [p, html] of Object.entries(this.o.text)) { let el = null; try { el = this.stage.querySelector(':scope>' + p); } catch (e) {} if (el && el.innerHTML !== html) el.innerHTML = html; } }
    applyNotes() {}
  }
  window.TalkOverrides = TalkOverrides;
})();
"""

# ---- CSS: controls visible while holding; end card; hint ----
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
    if path.endswith('.svg'): mime = 'image/svg+xml'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())
src = re.sub(r'src="(assets/[^"]+)"', lambda m: 'src="%s"' % datauri(os.path.join(here, m.group(1))), src)
css = re.sub(r'url\("(assets/[^"]+)"\)', lambda m: 'url("%s")' % datauri(os.path.join(here, m.group(1))), css)

# ---- assemble ----
title = re.search(r'<title>([^<]*)</title>', src)
head_extra = '<meta name="robots" content="noindex">\n<meta name="description" content="Talk slides: %s. Press space or tap to advance.">' % (title.group(1) if title else slug)
src = src.replace('<link rel="stylesheet" href="talk.css">', head_extra + '\n<style>\n' + css + '\n</style>')
src = src.replace('<script src="talk.js"></script>', '<script>\n' + js + '\n</script>')
src = src.replace('<div class="film">\n<div class="stage">', '<div class="film">\n<div class="hint">Press space or tap to play to the next stop · ← back · F fullscreen</div>\n<div class="stage">', 1)
assert 'assets/' not in src, 'unresolved asset reference'
os.makedirs(os.path.join(here, 'public'), exist_ok=True)
out = os.path.join(here, 'public', slug + '.html')
open(out, 'w', encoding='utf-8').write(src)
print('wrote', out, round(len(src) / 1e6, 2), 'MB')
