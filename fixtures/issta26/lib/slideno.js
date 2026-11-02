// lib/slideno.js — the "pane / total · chapter" counter in #slideno (was deck boilerplate).
// Dark styling follows the spine instead of hard-coded times: a beat is dark if its own
// `dark` flag says so, else if its chapter is dark. The original's window was 241.1–333.6
// (when #black is mostly up); this one is (240.8, 333.3], from just after the Summary hold to
// the 'Syntax to behavior' hold inclusive, so every hold matches. #slideno is not in the frames.
Talk.ready((T, layout) => {
  const CP = T.cps, CHAP = T.chapters;
  const el = document.getElementById('slideno');
  const spine = JSON.parse(document.getElementById('talk-spine').textContent);
  const darkOf = new Map();
  spine.chapters.forEach((ch) => (ch.beats || []).forEach((b) => darkOf.set(ch.id + '.' + b.id, b.dark ?? !!ch.dark)));
  // A hold frame belongs to the beat that ends on it: beat k is dark over (start, hold].
  const darkAt = (t) => { const b = layout.beats.find((x, i) => t <= x.at || i === layout.beats.length - 1); return !!(b && darkOf.get(b.id)); };
  T.onRender = (t) => {
    const pane = Math.min(CP.length, CP.filter((c) => c.at < t - 0.05).length + 1);
    const mainN = CP.filter((c) => !c.backup).length;
    const ch = [...CHAP].reverse().find((c) => c.at <= t + 0.01) || CHAP[0];
    el.textContent = CP[pane - 1].backup ? 'Backup ' + (pane - mainN) + ' / ' + (CP.length - mainN) : pane + ' / ' + mainN + '  ·  ' + ch.label;
    el.classList.toggle('dark', darkAt(t));
  };
});
