// beats/omt.js — chapter "One more thing" (private, dark): an example study with invented
// numbers (the fixture's placeholder for a private chapter), the close, and the recruiting slide. Times relative to each beat's start; c8 = 240.8.

Talk.beat('omt.omt', (B) => {              // @240.8 (c8)
  B.out('#sum-eye, #sum-rows .sumrow, #sum-pkg, #sum-qr', 0, { dur: 0.5, stagger: 0.03 });
  B.anim('#black', 0.3, 0.9, [{ opacity: 0 }, { opacity: 1 }], { ease: 'inOut' });
  B.show('#omt', 1.4);
  B.type('#omt', 1.4, 1.3, { cursor: true });
});

Talk.beat('omt.setup', (B) => {            // @244.8 (c8 + 4)
  B.out('#omt', 0, { dur: 0.6, y: -20 });
  B.in('#c8-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#c8-h', 0.6, { dur: 1 });
  B.in('#c8-s', 1.0, { dur: 1, y: 16 });
  B.in('#agents .agent', 1.6, { dur: 0.9, y: 24, stagger: 0.25 });
  B.in('#cf1, #cf2, #cf3, #cf4', 3.0, { dur: 0.8, y: 20, stagger: 0.2 });
  B.in('#c8-t5', 4.2, { dur: 0.9, y: 16 });
  B.count('#n5', 4.8, 0.8, 5, { from: 2 });
  B.in('#c8-600', 5.0, { dur: 0.9, y: 16 });
  B.count('#n600', 5.3, 2.4, 600);
  B.lib.dots.pop(B, B.lib.agents.cells600, 5.3, 0.004, { dur: 0.3, from: 0.4 });
});

// setup → every run → close
Talk.beat('omt.but', (B) => {              // @253.8 (c8 + 13); HM = c8 + 13.5 is 0.5 in
  B.out('#c8-h, #c8-s, #agents .agent, #cf1, #cf2, #cf3, #cf4, #c8-t5, #c8-600', 0, { dur: 0.5, stagger: 0.02 });
  B.anim('.cell600', 0, 0.4, [{ opacity: 0 }]);
  const hm = 0.5;
  B.in('#c8-hh', hm, { dur: 0.9, y: 14 });
  B.lib.heatmap.build(B, hm);
  B.in('#hmleg', hm + 3.6, { dur: 0.8, y: 10 });
  B.in('#pct14', hm + 4.2, { dur: 1, y: 20 });
  B.count('#n74b', hm + 4.4, 1.2, 67);
  B.count('#n14', hm + 4.6, 1.2, 14);
});

Talk.beat('omt.thanks', (B) => {           // @261.8 (CL)
  B.out('#pct14, #hmleg, #c8-hh, #c8-eye', 0, { dur: 0.5, stagger: 0.03 });
  B.anim('#hmg', 0, 0.5, [{ opacity: 1 }, { opacity: 0 }], { ease: 'inOut' });
  B.in('#cl-h', 0.6, { dur: 1.1 });
  B.in('#cl-s', 1.3, { dur: 1, y: 20 });
  B.in('#cl-l', 2.0, { dur: 1, y: 16 });
  B.in('#cl-qr', 2.3, { dur: 1, y: 16 });
  B.in('#cl-g', 2.6, { dur: 1, y: 12 });
});

Talk.beat('omt.sparsh', (B) => {           // @266.8 (SP)
  B.out('#cl-h, #cl-s, #cl-l, #cl-g, #cl-qr', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#sp-img', 0.5, { dur: 1.1, y: 0, scale: 0.85, blur: 18 });
  B.in('#sp-eye', 0.8, { dur: 0.8, y: 14 });
  B.in('#sp-h', 1.0, { dur: 1 });
  B.in('#sp-s', 1.5, { dur: 1, y: 18 });
  B.in('#sp-a', 2.3, { dur: 1, y: 18 });
  B.in('#sp-c', 2.9, { dur: 1, y: 14 });
});
