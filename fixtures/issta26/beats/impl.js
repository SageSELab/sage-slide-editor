// beats/impl.js — chapter "Implications": four implications, one beat each, then the summary.
// Times relative to each beat's start; c7 = 218.3.

Talk.beat('impl.im1', (B) => {             // @218.3 (c7)
  const F = B.lib.flow;
  B.out('#c6-h5, #c6-tcap, .pile, #p42, #tpills .chip, #c6-eye', 0, { dur: 0.5, stagger: 0.02 });
  B.in('#c7-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#im1', 0.8, { dur: 1, y: 30 }); F.flowIn(B, '#im1 .flowchip', 1.4, 470); F.boxPulse(B, '#im1 .promptbox', 3.2, 'prompt + real IDs');
});

Talk.beat('impl.im2', (B) => {             // @222.8 (c7 + 4.5)
  const F = B.lib.flow;
  B.in('#im2', 0.1, { dur: 1, y: 30 }); F.flowIn(B, '#im2 .flowchip', 0.7, 470); F.boxPulse(B, '#im2 .promptbox', 2.5, 'prompt + project APIs');
});

Talk.beat('impl.im3', (B) => {             // @227.3 (c7 + 9)
  B.in('#im3', 0.1, { dur: 1, y: 30 });
  B.anim('#im3-shot', 0.8, 1.6, [{ opacity: 0, transform: 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)', offset: 0.3 }, { opacity: 1, transform: 'translateX(0)', offset: 0.55 }, { opacity: 0, transform: 'translateX(470px)' }], { ease: 'inOut' });
  B.anim('#im3-shot2', 1.2, 1.6, [{ opacity: 0, transform: 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)', offset: 0.3 }, { opacity: 1, transform: 'translateX(0)', offset: 0.55 }, { opacity: 0, transform: 'translateX(400px)' }], { ease: 'inOut' });
  B.lib.flow.boxPulse(B, '#im3 .promptbox', 2.6, 'prompt + screens');
});

Talk.beat('impl.im4', (B) => {             // @231.8 (c7 + 13.5)
  B.in('#im4', 0.1, { dur: 1, y: 30 });
  // The original hides these at absolute t = 0; constant keyframes and first owner, so the
  // registered time is immaterial (see dfb.before).
  ['#im4-p1', '#im4-err', '#im4-p2', '#im4-ok'].forEach((s) => B.hide(s, 0));
  B.anim('#im4-p1', 0.7, 1.0, [{ opacity: 0, transform: 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)', offset: 0.3 }, { opacity: 1, transform: 'translateX(220px)', offset: 0.9 }, { opacity: 0, transform: 'translateX(240px)' }], { ease: 'inOut' });
  B.anim('#im4-err', 1.7, 1.2, [{ opacity: 0, transform: 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)', offset: 0.2 }, { opacity: 1, transform: 'translateX(-250px)', offset: 0.85 }, { opacity: 0, transform: 'translateX(-250px)' }], { ease: 'inOut' });
  B.anim('#im4-p2', 2.9, 1.0, [{ opacity: 0, transform: 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)', offset: 0.3 }, { opacity: 1, transform: 'translateX(220px)', offset: 0.9 }, { opacity: 0, transform: 'translateX(240px)' }], { ease: 'inOut' });
  B.anim('#im4-ok', 3.8, 0.5, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }]);
});

Talk.beat('impl.summary', (B) => {         // @236.8 (c7 + 18.5)
  B.out('#im1, #im2, #im3, #im4, #c7-eye', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#sum-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#sum-rows .sumrow', 0.6, { dur: 0.9, y: 24, stagger: 0.18 });
  B.in('#sum-pkg', 1.5, { dur: 1, y: 24 });
  B.in('#sum-qr', 2.1, { dur: 1, y: 24 });
});
