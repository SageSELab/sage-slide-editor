// lib/tools.js — "Five tools, one pipeline": one card per tool with its mechanism, then the
// patch pipeline. Generated DOM (RewardRepair tokens, tool minis, the 70 travelling patch
// squares) is built at load; tool(B, k, u) is one tool iteration with u = the beat-relative
// time of the original's TT[k].
(function () {
  const $ = (id) => document.getElementById(id);
  const TOOLS = ['#tc-rr', '#tc-ntr', '#tc-d4c', '#tc-cr', '#tc-oh'];
  const NAMES = ['RewardRepair', 'NTR', 'D4C', 'ChatRepair', 'OpenHands'];

  // RewardRepair: tokens in, tokens out.
  const mrr = $('m-rr');
  const TOK_IN = ['if (', 'trip', '.overlapsTrip', '(object)', ')'], TOK_OUT = ['if (', 'trip.equals', '(object)', ')'];
  const tok = (w, cls, left) => { const e = document.createElement('div'); e.className = cls; e.textContent = w; e.style.left = left + 'px'; e.style.width = '70px'; mrr.appendChild(e); return e; };
  const tokIn = TOK_IN.map((w, i) => tok(w, 'tok', 20 + i * 76));
  const tokOut = TOK_OUT.map((w, i) => tok(w, 'tok o', 640 + i * 76));
  // D4C: the arrow and response start hidden.
  $('d4c-arrow').setAttribute('data-a', ''); $('d4c-out').setAttribute('data-a', '');
  // Pipeline: one mini card per tool, and 70 patches routed to the five outcome lanes.
  const tmEl = $('tminis');
  const minis = NAMES.map((n, k) => { const d = document.createElement('div'); d.className = 'toolmini'; d.setAttribute('data-a', ''); d.style.left = (120 + k * 330) + 'px'; d.textContent = n; tmEl.appendChild(d); return d; });
  const LANE_X = [265, 585, 905, 1225, 1545], LANE_C = ['#1f8a4c', '#2f6fed', '#c47a00', '#8e8e93', '#a1a1a6'], CUM = [442, 591, 626, 1246, 3049];
  const sqEl = $('sqs'), squares = [];
  for (let i = 0; i < 70; i++) {
    const k = i % 5, pick = (i * 7919) % 3049; let j = 0; while (pick >= CUM[j]) j++;
    const cx = 230 + k * 330, lx = LANE_X[j];
    const s = document.createElement('div'); s.className = 'sq'; s.style.background = LANE_C[j];
    s.style.offsetPath = `path('M ${cx} 300 C ${cx} 430, 960 380, 960 495 C 960 620, ${lx} 650, ${lx} 790')`;
    sqEl.appendChild(s); squares.push(s);
  }

  // Each tool's mechanism, relative to u.
  const MECH = [
    (B, u) => {
      tokIn.forEach((e, i) => B.anim(e, u + 0.8 + i * 0.1, 1.3, [{ opacity: 0, transform: 'translateX(-20px)' }, { opacity: 1, transform: 'translateX(0)', offset: 0.25 }, { opacity: 1, transform: 'translateX(0)', offset: 0.55 }, { opacity: 0, transform: `translateX(${380 - (20 + i * 76)}px)` }], { ease: 'inOut' }));
      tokOut.forEach((e, i) => B.anim(e, u + 2.4 + i * 0.12, 0.7, [{ opacity: 0, transform: 'translateX(-40px)' }, { opacity: 1, transform: 'translateX(0)' }]));
      B.anim('.mbox', u + 2.0, 0.5, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }]);
    },
    (B, u) => {   // NTR: fill the hole
      B.anim('#hole', u + 1.2, 0.5, [{ width: '230px', opacity: 1, paddingLeft: '10px', paddingRight: '10px', borderWidth: '2px' }, { width: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px', borderWidth: '0px' }], { ease: 'inOut' });
      B.anim('#fill', u + 1.6, 1.2, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { ease: 'steps(32)' });
    },
    (B, u) => {   // D4C: the response appears
      B.in('#d4c-arrow', u + 1.2, { dur: 0.5, x: -14, y: 0 });
      B.in('#d4c-out', u + 1.5, { dur: 0.8, y: 14 });
    },
    (B, u) => [0, 1, 2].forEach((i) => B.draw('#loopc', u + 0.9 + i * 1.15, 1.0, 0, 1)),   // ChatRepair: the loop turns three times
    (B, u) => B.els('#ohterm .l').forEach((el, i) => B.lib.codepane.tline(B, el, u + 0.9 + i * 0.5, 0.45)),   // OpenHands: terminal lines
  ];

  Talk.lib.tools = {
    TOOLS, minis, squares,
    // One tool card: the previous card leaves, this one enters, its mechanism plays.
    tool: (B, k, u) => {
      if (k) B.out(TOOLS[k - 1], u - 0.2, { dur: 0.45, y: -24 });
      B.in(TOOLS[k], u + 0.2, { dur: 0.9, y: 30 });
      MECH[k](B, u);
    },
    // The 70 patches travel from their tool down to an outcome lane.
    flow: (B, t) => squares.forEach((s, i) => B.anim(s, t + i * 0.075, 1.7, [{ opacity: 0, offsetDistance: '0%' }, { opacity: 1, offsetDistance: '6%', offset: 0.06 }, { opacity: 1, offsetDistance: '94%', offset: 0.94 }, { opacity: 0, offsetDistance: '100%' }], { ease: 'inOut' })),
  };
})();
