// beats/bug.js — chapter "One bug": Harmonic HN issue #114, live; why it happens; the
// developer's fix; the fixed app; no tool fixed it. Times are relative to each beat's start
// (= the previous hold). @abs = original time; c3 = 66.5.

Talk.beat('bug.bug', (B) => {              // @66.5 (c3)
  const D = B.lib.device;
  B.anim('#settings', 0, 0.4, [{ transform: 'translateX(100%)' }]);
  B.out('#c2-th, #c2-tc, #tc1, #tc2, #tc3, #tc4, #c2-eye', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c3-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#rep', 0.6, { dur: 1, y: 30 });
  D.press(B, 1.8); D.menuIn(B, 2.8); D.release(B, 3.0); D.browserIn(B, 3.9);
  B.in('#c3-obs', 4.8, { dur: 0.9, y: 16 });
});

Talk.beat('bug.why', (B) => {              // @73.5 (c3 + 7)
  const D = B.lib.device, C = B.lib.codepane;
  B.out('#rep, #c3-obs, #c3-eye', 1.0, { dur: 0.5, stagger: 0.03 });
  D.browserOut(B, 1.1); D.menuOut(B, 1.3);
  B.in('#pa', 1.9, { dur: 1, y: 30 });
  B.in('#pb', 2.1, { dur: 1, y: 30 });
  B.in('#c3-why', 2.4, { dur: 1, y: 16 });
  D.press(B, 3.2);
  C.pulse(B, '#pl1', 3.9, 0.7); C.flash(B, '#pb-long', 4.5, '#fff4d6'); D.menuIn(B, 4.6); D.release(B, 4.7);
  C.pulse(B, '#pl2', 5.4, 0.7); C.flash(B, '#pb-click', 6.0, '#fde7e4'); C.flash(B, '#pb-open', 6.0, '#fde7e4'); D.browserIn(B, 6.2);
});

Talk.beat('bug.fix', (B) => {              // @81.5 (c3 + 15)
  const D = B.lib.device, C = B.lib.codepane;
  D.browserOut(B, 0); D.menuOut(B, 0.2);
  B.out('#c3-why', 0, { dur: 0.5 });
  B.anim('#pb-click, #pb-open', 0.2, 0.4, [{ background: 'rgba(255,255,255,0)' }]);
  C.grow(B, '#pa .ln.new', 0.8);
  C.grow(B, '#pb .ln.new', 2.6, 0.3);
  B.in('#c3-fix', 3.4, { dur: 1, y: 16 });
});

Talk.beat('bug.fixed', (B) => {            // @86.5 (c3 + 20)
  const D = B.lib.device, C = B.lib.codepane;
  D.press(B, 0.2);
  C.pulse(B, '#pl3', 0.9, 0.7); C.flash(B, '#pb-long', 1.5, '#fff4d6'); D.menuIn(B, 1.6); D.release(B, 1.7);
  C.pulse(B, '#pl4', 2.4, 0.7); C.flash(B, '#pb-if', 3.0, '#c8efd6');
  B.in('#ok1', 3.6, { dur: 0.6, y: 0, scale: 0.4, blur: 0, ease: 'spring' });
});

Talk.beat('bug.none', (B) => {             // @91.5 (c3 + 25)
  B.out('#pa, #pb, #c3-fix, #ok1', 0, { dur: 0.5, stagger: 0.04 });
  B.lib.device.menuOut(B, 0);
  B.in('#c3-none', 0.6, { dur: 1 });
  B.in('#verd .verdict', 1.3, { dur: 0.7, y: 20, stagger: 0.12 });
  // Each tool's mark turns into a red cross. Original: a 0.01 s tween writing p >= 1 ? '✕' : '·';
  // here a B.set step (the markup's '·' is the value before it).
  B.els('#verd .verdict i').forEach((el, i) => {
    B.set(el, 2.4 + i * 0.2, { text: '✕' });
    B.anim(el, 2.4 + i * 0.2, 0.4, [{ background: '#86868b', transform: 'scale(1)' }, { background: '#d93b2b', transform: 'scale(1.25)' }, { background: '#d93b2b', transform: 'scale(1)' }]);
  });
});
