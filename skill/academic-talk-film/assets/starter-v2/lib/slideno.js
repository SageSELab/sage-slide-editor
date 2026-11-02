// lib/slideno.js — the "pane / total · chapter" counter in #slideno (scenes/layers.html).
// A beat is dark if its own "dark" flag says so, else if its chapter is dark; backups count
// as "Backup n / m". Copied from the starter library (assets/lib-starter/slideno.js).
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
