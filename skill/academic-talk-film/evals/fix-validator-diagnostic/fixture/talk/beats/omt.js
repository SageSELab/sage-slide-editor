// beats/omt.js — chapter "One more thing" (dark, private): the screen goes black, then the close.
// Private chapters are cut from the public build; the spine's "public" block (beats/end.js)
// takes their place there.

Talk.beat('omt.omt', (B) => {
  B.out('#c2-eye, #c2-h, #c2-s, #c2-stat', 0, { dur: 0.5, stagger: 0.03 });
  B.anim('#black', 0.3, 0.9, [{ opacity: 0 }, { opacity: 1 }], { ease: 'inOut' });
  B.show('#omt', 1.4);
  B.type('#omt', 1.4, 1.3, { cursor: true });
});

Talk.beat('omt.thanks', (B) => {
  B.out('#omt', 0, { dur: 0.6 });
  B.in('#cl-h', 0.6, { dur: 1.1 });
  B.in('#cl-s', 1.3, { dur: 1, y: 20 });
  B.in('#cl-l', 2.0, { dur: 1, y: 16 });
});
