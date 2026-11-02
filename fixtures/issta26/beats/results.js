// beats/results.js — chapter "Results": RQ1 synthetic, RQ2 real, overview, limitations,
// overfitting, the nine categories, UI-specific failures. Times relative to each beat's start;
// c6 = 173.3.

Talk.beat('results.rq1', (B) => {          // @173.3 (c6)
  B.out('#c5-ph, .toolmini, .station, .lanebox, #c5-total, #c5-eye', 0, { dur: 0.5, stagger: 0.02 });
  B.in('#c6-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#c6-h1', 0.6, { dur: 1 });
  B.lib.bars.buildBars(B, 'rq1', 1.0);
  B.in('#lg1', 2.2, { dur: 0.8, y: 10 });
  B.in('#g46r', 2.6, { dur: 0.8, y: 16 });
  B.lib.dots.fill(B, B.lib.dots.g46b.slice(0, 41), 3.0, 0.05, '#1f8a4c');
  B.count('#n41', 3.0, 2.1, 41);
});

Talk.beat('results.rq2', (B) => {          // @180.3 (c6 + 7)
  B.out('#c6-h1, #rq1 .brow, #lg1, #g46r', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c6-h2', 0.4, { dur: 1 });
  B.lib.bars.buildBars(B, 'rq2', 0.8);
  B.in('#lg2', 2.0, { dur: 0.8, y: 10 });
  B.in('#g50r', 2.4, { dur: 0.8, y: 16 });
  B.lib.dots.fill(B, B.lib.dots.g50b.slice(0, 11), 2.8, 0.09, '#2f6fed');
  B.count('#n11', 2.8, 1.1, 11);
});

Talk.beat('results.overview', (B) => {     // @186.8 (c6 + 13.5)
  B.out('#c6-h2, #rq2 .brow, #lg2, #g50r', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c6-h6', 0.5, { dur: 1 });
  B.in('#ct1', 0.5, { dur: 1, y: 0, scale: 0.9, blur: 16 });
  B.in('#ct2', 0.9, { dur: 1, y: 0, scale: 0.9, blur: 16 });
  B.in('#ct3', 1.9, { dur: 1, y: 20 });
  B.anim('#bar67', 2.3, 1.3, [{ width: '0%' }, { width: '67%' }]);
  B.count('#n67', 2.3, 1.3, 67, { format: (v) => Math.round(v) + '%' });
});

Talk.beat('results.limits', (B) => {       // @191.8 (c6 + 18.5)
  B.out('#c6-h6, #ct1, #ct2, #ct3', 0, { dur: 0.5, stagger: 0.04 });
  B.in('#c6-h3', 0.5, { dur: 1 });
  B.in('#lim-issue', 0.9, { dur: 0.9, y: 24 });
  B.in('#lim-real', 1.5, { dur: 0.9, y: 24 });
  [['#lim1', 2.5], ['#lim2', 3.9], ['#lim3', 5.3], ['#lim4', 6.7]].forEach(([s, t]) => {
    B.in(s, t, { dur: 0.9, y: 24 });
    B.anim(s + ' .tests b', t + 1.0, 0.3, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }]);
  });
  B.in('#c6-nm', 8.1, { dur: 1, y: 16 });
});

Talk.beat('results.overfit', (B) => {      // @201.3 (c6 + 28)
  B.out('#c6-h3, #lim-issue, #lim-real, #lim1, #lim2, #lim3, #lim4, #c6-nm', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c6-h4', 0.4, { dur: 1 });
  B.in('#ov-dev', 0.8, { dur: 0.9, y: 24 });
  B.in('#ov-d4c', 1.6, { dur: 0.9, y: 24 });
  B.anim('#ov-d4c .tests b', 2.5, 0.3, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { stagger: 0.3 });
  B.in('#ov19', 3.3, { dur: 1, y: 20 });
  B.count('#n19', 3.4, 1.0, 19);
});

Talk.beat('results.nine', (B) => {         // @206.8 (c6 + 33.5)
  B.out('#c6-h4, #ov-dev, #ov-d4c, #ov19', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c6-h5', 0.5, { dur: 1 });
  B.in('#c6-tcap', 0.8, { dur: 0.9, y: 10 });
  B.lib.bars.piles(B, 1.1);
});

Talk.beat('results.ui', (B) => {           // @213.3 (c6 + 40)
  B.anim('.pile:not(.ui)', 0, 0.6, [{ opacity: 1 }, { opacity: 0.28 }]);
  B.in('#p42', 0.4, { dur: 1, y: 0, scale: 0.9, blur: 14 });
  B.count('#n42', 0.5, 1.4, 42);
  B.in('#tpills .chip', 1.8, { dur: 0.7, y: 20, stagger: 0.11 });
});
