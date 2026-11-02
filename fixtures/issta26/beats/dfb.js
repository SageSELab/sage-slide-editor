// beats/dfb.js — chapter "DroidFixBench": what a repair tool needs, three sources, five
// stations (one beat each), fifty real bugs, the mutant, forty-six synthetic bugs.
// Times are relative to each beat's start. @abs = original time; c4 = 101.5.

Talk.beat('dfb.title', (B) => {            // @96.0
  B.out('#c3-none, #verd .verdict', 0.5, { dur: 0.5, stagger: 0.03 });
  B.lib.device.rigShow(B, 0.5, false);
  B.in('#dfb-eye', 1.2, { dur: 0.8, y: 14 });
  B.in('#dfb-h', 1.4, { dur: 1.2, y: 0, scale: 0.94, blur: 22 });
  B.in('#dfb-s', 2.2, { dur: 1, y: 18 });
});

Talk.beat('dfb.needs', (B) => {            // @100.5 (c4 - 1)
  B.out('#dfb-eye, #dfb-h, #dfb-s', 1.0, { dur: 0.6, y: -24, stagger: 0.05 });
  // The original repeats the previous beat's exit and rig fade here, at c4; kept verbatim.
  B.out('#c3-none, #verd .verdict', 1.0, { dur: 0.5, stagger: 0.03 });
  B.lib.device.rigShow(B, 1.0, false);
  B.in('#c4-eye', 1.4, { dur: 0.8, y: 14 });
  B.in('#c4-h', 1.6, { dur: 1 });
  B.in('#bugchip', 2.2, { dur: 0.7, y: 0, scale: 0.4, blur: 0, ease: 'spring' });
  [['#need1', -60, -40], ['#need2', 60, -40], ['#need3', -80, 0], ['#need4', 80, 0], ['#need5', 0, 60]].forEach(([s, x, y], i) => {
    B.in(s, 2.9 + i * 0.45, { dur: 0.9, x, y, blur: 6 });
    B.draw('#nl' + (i + 1), 2.7 + i * 0.45, 0.5, 0, 1);
  });
});

Talk.beat('dfb.sources', (B) => {          // @108.5 (c4 + 7)
  B.out('#c4-h, #bugchip, #need1, #need2, #need3, #need4, #need5, #needlines', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c4-fh', 0.4, { dur: 1 });
  B.in('#src1, #src2, #src3', 0.8, { dur: 0.8, y: 18, stagger: 0.15 });
  B.in('#strack', 1.4, { dur: 0.6, y: 0, blur: 0 });
  B.in('#bugcard', 1.6, { dur: 0.6, y: 10 });
});

// One beat per station. The station lights up at s: 0.7 into the first beat, 0.6 into the rest
// (sAt(k) = c4 + 10 + 2k; each hold is sAt(k) + 1.4).
Talk.beat('dfb.build', (B) => B.lib.stations.station(B, 0, 0.7));        // @110.8
Talk.beat('dfb.reproduce', (B) => B.lib.stations.station(B, 1, 0.6));    // @112.9
Talk.beat('dfb.localize', (B) => B.lib.stations.station(B, 2, 0.6));     // @114.9
Talk.beat('dfb.tests', (B) => B.lib.stations.station(B, 3, 0.6));        // @116.9
Talk.beat('dfb.validate', (B) => B.lib.stations.station(B, 4, 0.6));     // @118.9

Talk.beat('dfb.fifty', (B) => {            // @120.9 (c4 + 19.4)
  B.out('#src1, #src2, #src3, #strack, #bugcard, #stn1, #stn2, #stn3, #stn4, #stn5', 0, { dur: 0.5, stagger: 0.03 });
  B.out('#c4-fh', 0, { dur: 0.5 });
  B.in('#c4-gh', 0.5, { dur: 1 });
  B.in('#fifty-n', 0.7, { dur: 1 });
  B.count('#n50', 0.8, 1.3, 50);
  B.in('#fifty-g', 1.3, { dur: 0.8 });
  B.lib.dots.pop(B, B.lib.dots.g50, 1.5, 0.04);
  B.in('#fifty-c', 3.3, { dur: 1, y: 16 });
});

// To the synthetic half (the test replay, 'Two tests per bug', lives in the backups).
Talk.beat('dfb.before', (B) => {           // @126.4 (c4 + 24.9)
  B.out('#fifty-n, #fifty-g, #fifty-c, #c4-gh', 0, { dur: 0.5, stagger: 0.04 });
  // The original hides the test-replay lines at absolute t = 0. The keyframes are constant
  // (opacity 0 → 0) and this is their first animation, so it fills both ways and the time
  // registered is immaterial; registered at this beat's t = 0.
  ['#tl1', '#tl2', '#tl3', '#tl4', '#tl4b', '#tl5'].forEach((s) => B.hide(s, 0));
  B.lib.device.rigShow(B, 0.4, true);
  B.anim('#gl', 0.1, 0.3, [{ opacity: 0 }, { opacity: 1 }]);  // GPSLogger is on screen before the device fades in
  B.in('#c4-mh', 0.7, { dur: 0.9, y: 14 });
  B.in('#mp', 0.9, { dur: 0.9, y: 24 });
});

Talk.beat('dfb.mutant', (B) => {           // @128.4 (c4 + 26.9)
  B.anim('#ml-del', 0.3, 0.5, [{ background: 'rgba(0,0,0,0)', color: '#1d1d1f' }, { background: '#fde7e4', color: '#9a1b0f', textDecoration: 'line-through' }]);
  B.lib.codepane.grow(B, '#ml-add', 0.8);
  B.anim('#gl-drawer', 1.7, 0.5, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }]);
  B.anim('#gl-item', 2.4, 0.3, [{ background: '#fff' }, { background: '#e8f3ec' }]);
  B.anim('#gl-crash', 3.0, 0.3, [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'scale(1)' }]);
  B.in('#mrep', 3.3, { dur: 0.9, y: 20 });
});

Talk.beat('dfb.synthetic', (B) => {        // @133.8 (c4 + 32.3)
  B.in('#mops', 0.3, { dur: 0.9, y: 16 });
  B.in('#g46wrap', 0.7, { dur: 0.8 });
  B.lib.dots.pop(B, B.lib.dots.g46, 0.9, 0.03);
});
