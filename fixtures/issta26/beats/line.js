// beats/line.js — chapter "The line": title, fifteen years of APR, where it was measured,
// where it never went. Times are relative to each beat's start (= the previous hold).
// Original absolute times are noted in the comments as @abs.

Talk.beat('line.title', (B) => {           // @0
  const W = B.lib.world;
  B.in('#t-eye', 0.3, { dur: 0.8, y: 16 });
  B.words('#t-h', 0.6, { stagger: 0.09 });
  B.in('#t-g', 1.9, { dur: 1.1, y: 26, scale: 0.97, blur: 16 });
  W.px(B, 0, 160, 2.3, 1.0, 'inOut');
  B.in('#t-fc > *', 2.5, { dur: 0.7, y: 14, scale: 0.6, blur: 6, stagger: 0.07 });
  B.in('#t-au', 3.0, { dur: 0.9, y: 20 });
  B.in('#t-lg', 3.4, { dur: 0.9, y: 16 });
});

Talk.beat('line.fifteen', (B) => {         // @5.0
  const W = B.lib.world;
  B.out('#t-eye, #t-h, #t-g, #t-fc, #t-au, #t-lg', 0, { dur: 0.7, y: -40, stagger: 0.05 });
  B.in('#c1-eye', 0.4, { dur: 0.8, y: 14 });
  // One eased stroke from the title stub to the last node; each node appears as the pen reaches it.
  W.px(B, 160, 1280, 0.6, 7.0, 'inOut');
  W.MS.forEach(([x], i) => {
    const t = W.nodeT(x, 0.6, 0.45);
    B.in(`#ms${i} .dot`, t, { dur: 0.5, y: 0, scale: 0.3, blur: 0 });
    B.in(`#ms${i} .yr`, t + 0.1, { dur: 0.6, y: 10, blur: 4 });
    B.in(`#ms${i} .nm`, t + 0.18, { dur: 0.7, y: 14, blur: 6 });
    B.in(`#ms${i} .ds`, t + 0.28, { dur: 0.7, y: 10, blur: 4 });
  });
});

Talk.beat('line.measured', (B) => {        // @13.5
  const W = B.lib.world;
  B.anim('.world', 0, 1.6, [{ transform: 'translateX(0px)' }, { transform: 'translateX(-1480px)' }], { ease: 'inOut' });
  B.anim('.ms', 0.1, 0.8, [{ opacity: 1 }, { opacity: 0 }], { ease: 'inOut' });
  W.px(B, 1280, 3060, 0, 6.36);
  W.TILES.forEach((n, i) => {
    const x = 1800 + i * 230;
    const t = (x - 1400) / 280;            // the pen reaches tile i
    B.in(`#tile${i}`, 0.4 + i * 0.1, { dur: 0.8, y: 24, blur: 6 });
    B.anim(`#tile${i} .f`, t, 0.7, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-180deg)' }], { ease: 'inOut' });
    B.anim(`#tile${i} .b`, t, 0.7, [{ transform: 'rotateX(180deg)' }, { transform: 'rotateX(0deg)' }], { ease: 'inOut' });
    B.in(`#tile${i} .nm`, t + 0.3, { dur: 0.5, y: 8, blur: 2 });
  });
  B.in('#c1-bench', 4.1, { dur: 1, y: 20 });
});

Talk.beat('line.never', (B) => {           // @20.5
  const W = B.lib.world;
  B.out('#c1-bench', 0, { dur: 0.5 });
  B.out('.tile', 0.1, { dur: 0.6, y: 0, blur: 8, stagger: 0.04 });
  B.anim('.world', 0, 1.4, [{ transform: 'translateX(-2150px)' }], { ease: 'inOut' });
  W.px(B, 3060, 3180, 0.3, 0.5);
  W.px(B, 3180, W.L, 1.1, 3.2, 'inOut');
  B.draw('#qm', 4.5, 0.9, 0, 1);
  B.in('#qdot', 5.4, { dur: 0.4, y: 0, scale: 0.2, blur: 0 });
  B.in('#c1-ui-h', 2.9, { dur: 1.1 });
  B.in('#c1-ui-s', 5.1, { dur: 1, y: 24 });
  B.in('#c1-ui-c', 5.8, { dur: 1, y: 16 });
});
