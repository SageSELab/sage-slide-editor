// lib/dots.js — dot and cell grids: the 50 real / 46 synthetic bug dots coloured by type, the
// "fixed by at least one tool" cells, and the 600-attempt grid. DOM is generated at load (the
// original's mkDots / mkCells / cells600 loop); pop/fill animate a list of cells against B.
(function () {
  const $ = (id) => document.getElementById(id);
  const mkDots = (id, spec) => { const el = $(id); const out = []; spec.forEach(([cls, n]) => { for (let i = 0; i < n; i++) { const d = document.createElement('i'); d.className = cls; el.appendChild(d); out.push(d); } }); return out; };
  const mkCells = (id, n) => Array.from({ length: n }, () => $(id).appendChild(document.createElement('i')));
  const g50 = mkDots('g50', [['crash', 12], ['output', 25], ['cosmetic', 9], ['navigation', 4]]);
  const g46 = mkDots('g46', [['crash', 19], ['output', 8], ['cosmetic', 9], ['delay', 8], ['navigation', 2]]);
  const g46b = mkCells('g46b', 46), g50b = mkCells('g50b', 50);
  const cellsEl = $('cells600'), cells600 = [];
  for (let i = 0; i < 600; i++) { const c = document.createElement('div'); c.className = 'cell600'; c.style.left = (120 + (i % 50) * 17) + 'px'; c.style.top = (836 + Math.floor(i / 50) * 17) + 'px'; c.style.width = c.style.height = '13px'; cellsEl.appendChild(c); cells600.push(c); }
  Talk.lib.dots = {
    mkDots, mkCells, g50, g46, g46b, g50b, cells600,
    // Scale-in, one cell every `step` seconds.
    pop: (B, els, t, step, { dur = 0.4, from = 0.3 } = {}) => els.forEach((d, i) => B.anim(d, t + i * step, dur, [{ opacity: 0, transform: 'scale(' + from + ')' }, { opacity: 1, transform: 'scale(1)' }])),
    // Grey to `color`, one cell every `step` seconds.
    fill: (B, els, t, step, color) => els.forEach((d, i) => B.anim(d, t + i * step, 0.3, [{ background: '#e5e5ea' }, { background: color }])),
  };
})();
