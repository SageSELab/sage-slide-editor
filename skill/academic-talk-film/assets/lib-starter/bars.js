// lib/bars.js — the bar charts: RQ1/RQ2 stacked outcome bars (the original's buildBars) and the
// nine failure-category piles. All DOM is generated at load; each chart has one animate helper taking B.
(function () {
  const $ = (id) => document.getElementById(id);

  // ---- RQ1 / RQ2: one row per tool, five outcome segments ----
  const SYN = [['OpenHands', '46 patches', [84.8, 2.2, 0, 6.5, 6.5]], ['ChatRepair', '46 patches', [67.4, 13.0, 2.2, 4.3, 13.0]], ['D4C', '460 patches', [50.9, 5.2, 0, 13.3, 30.7]], ['NTR', '445 patches', [17.3, 3.8, 2.0, 45.2, 31.7]], ['RewardRepair', '460 patches', [1.7, 0.9, 1.3, 20.2, 75.9]]];
  const REAL = [['OpenHands', '50 patches', [12, 8, 0, 20, 60]], ['ChatRepair', '50 patches', [8, 26, 0, 10, 56]], ['D4C', '500 patches', [8, 8.6, 3.4, 13, 67]], ['NTR', '492 patches', [0.6, 4.7, 0.2, 25, 69.5]], ['RewardRepair', '500 patches', [0, 2.8, 0.2, 11.4, 85.6]]];
  const mkBars = (id, rows) => rows.map((r) => {
    const row = document.createElement('div'); row.className = 'brow'; row.setAttribute('data-a', '');
    row.innerHTML = `<div class="lbl">${r[0]}<small>${r[1]}</small></div><div class="track">${['c', 'a', 'o', 't', 'b'].map((c, s) => `<div class="seg ${c}">${r[2][s] >= 9 ? Math.round(r[2][s]) + '%' : ''}</div>`).join('')}</div>`;
    $(id).appendChild(row);
    return { row, vals: r[2] };
  });
  const BARS = { rq1: mkBars('rq1', SYN), rq2: mkBars('rq2', REAL) };

  // ---- RQ3: nine piles of failed patches ----
  const PILES = [['Java-specific', 79, 0], ['GUI constructs', 63, 1], ['APIs & libraries', 61, 1], ['Patch-specific', 56, 0], ['Coding logic', 46, 0], ['OOP', 37, 0], ['Activities & Intents', 23, 1], ['Threading', 12, 1], ['Other', 2, 0]];
  const pilesEl = $('piles');
  const piles = PILES.map(([n, v, ui], i) => {
    const p = document.createElement('div'); p.className = 'pile' + (ui ? ' ui' : ''); p.style.left = (120 + i * 186) + 'px';
    p.innerHTML = `<div class="pv" data-a>${v}</div><div class="pn" data-a>${n}${ui ? ' <span style="color:#1f8a4c">●</span>' : ''}</div>`;
    const bars = [];
    for (let j = 0, nb = Math.ceil(v / 4); j < nb; j++) bars.push(p.appendChild(document.createElement('i')));
    pilesEl.appendChild(p);
    return { p, bars };
  });

  Talk.lib.bars = {
    // The original's buildBars(id, rows, t), minus the DOM it now finds ready-made.
    buildBars: (B, id, t) => BARS[id].forEach(({ row, vals }, ri) => {
      B.in(row, t + ri * 0.12, { dur: 0.8, x: -24, y: 0, blur: 4 });
      row.querySelectorAll('.seg').forEach((seg, s) => B.anim(seg, t + 0.5 + ri * 0.12 + s * 0.06, 1.1, [{ width: '0%' }, { width: vals[s] + '%' }]));
    }),
    piles: (B, t) => piles.forEach(({ p, bars }, i) => {
      bars.forEach((b, j) => B.anim(b, t + i * 0.3 + j * 0.06, 0.3, [{ opacity: 0, transform: 'translateY(-40px)' }, { opacity: 1, transform: 'translateY(0)' }], { ease: 'in' }));
      B.in(p.querySelector('.pn'), t + 0.1 + i * 0.3, { dur: 0.6, y: 10 });
      B.in(p.querySelector('.pv'), t + 0.4 + i * 0.3 + bars.length * 0.06, { dur: 0.5, y: 10 });
    }),
  };
})();
