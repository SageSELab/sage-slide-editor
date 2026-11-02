// lib/agents.js — generated DOM for the example study (private chapters omt and backup; all
// placeholder data): the 600-run grid, the pass-rate columns and the failure categories. Split out of
// dots.js and bars.js so the public build, which drops libs only private beats use, carries none
// of it.
(function () {
  const $ = (id) => document.getElementById(id);
  const cellsEl = $('cells600'), cells600 = [];
  for (let i = 0; i < 600; i++) { const c = document.createElement('div'); c.className = 'cell600'; c.style.left = (120 + (i % 50) * 17) + 'px'; c.style.top = (836 + Math.floor(i / 50) * 17) + 'px'; c.style.width = c.style.height = '13px'; cellsEl.appendChild(c); cells600.push(c); }

  // ---- backup: pass rate per tool and setting ----
  const VB = [['Tool A', [61, 70, 79, 75]], ['Tool B', [52, 63, 88, 84]], ['Tool C', [57, 62, 69, 73]]];
  const vbEl = $('vbars');
  const vgroups = VB.map(([n, vals], g) => {
    const grp = document.createElement('div'); grp.setAttribute('data-a', ''); grp.style.cssText = `position:absolute;left:${120 + g * 580}px;top:200px;width:520px;height:400px`;
    grp.innerHTML = `<div class="cap" style="position:absolute;left:0;top:-50px;font-weight:600;color:var(--ink)">${n} · pass rate</div>`;
    vals.forEach((v, b) => {
      const h = v * 3.6;
      grp.insertAdjacentHTML('beforeend', `<div class="vb ${b >= 2 ? 'hi' : ''}" style="left:${40 + b * 120}px" data-h="${h}"></div><div class="vbv" style="left:${40 + b * 120}px;top:${400 - h - 36}px" data-a>${v}%</div><div class="vbl" style="left:${40 + b * 120}px;top:412px">${['Base', '+ X', '+ Y', '+ X<br>+ Y'][b]}</div>`);
    });
    vbEl.appendChild(grp);
    return grp;
  });

  // ---- backup: why runs fail, one bar per category ----
  const FAM = [['Category one', 26.0, '#2f6fed'], ['Category two', 23.0, '#d2d2d7'], ['Category three', 19.5, '#d2d2d7'], ['Category four', 16.5, '#3ddc84'], ['Category five', 8.5, '#5a5a5e'], ['Category six', 6.5, '#5a5a5e']];
  const famEl = $('fam');
  const fams = FAM.map(([n, v, col]) => {
    const row = document.createElement('div'); row.className = 'brow'; row.setAttribute('data-a', '');
    row.innerHTML = `<div class="lbl" style="width:440px;font-size:26px">${n}</div><div class="track" style="background:transparent;height:44px"><div class="seg" style="background:${col};color:${col === '#d2d2d7' || col === '#3ddc84' ? '#000' : '#fff'}">${v}%</div></div>`;
    famEl.appendChild(row);
    return { row, v };
  });

  Talk.lib.agents = {
    cells600,
    vbars: (B, t) => vgroups.forEach((grp, g) => {
      B.in(grp, t + g * 0.2, { dur: 0.8, y: 20 });
      grp.querySelectorAll('.vb').forEach((bar, b) => B.anim(bar, t + 0.6 + g * 0.25 + b * 0.12, 1.0, [{ height: '0px' }, { height: bar.dataset.h + 'px' }]));
      grp.querySelectorAll('.vbv').forEach((vv, b) => B.in(vv, t + 1.4 + g * 0.25 + b * 0.12, { dur: 0.5, y: 8 }));
    }),
    families: (B, t) => fams.forEach(({ row, v }, i) => {
      B.in(row, t + i * 0.12, { dur: 0.8, x: -20, y: 0, blur: 3 });
      B.anim(row.querySelector('.seg'), t + 0.5 + i * 0.12, 1.0, [{ width: '0%' }, { width: (v * 3.3) + '%' }]);
    }),
  };
})();
