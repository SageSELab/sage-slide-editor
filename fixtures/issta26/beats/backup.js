// beats/backup.js — chapter "Backup" (private, backup; dark except the last beat): the agent
// at work, the headline, twelve patches, tests vs localization, why agents fail, and the
// two-tests-per-bug replay. Times relative to each beat's start; BK = 271.3.

Talk.beat('backup.backup', (B) => {        // @271.3 (BK)
  B.out('#sp-img, #sp-eye, #sp-h, #sp-s, #sp-a, #sp-c', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#bkp', 0.5, { dur: 0.9, y: 20 });
});

Talk.beat('backup.agent', (B) => {         // @273.3 (AG)
  const D = B.lib.device, M = B.lib.term, at = (i) => M.tAt(1.6, i);
  B.out('#bkp', 0, { dur: 0.5 });
  B.anim('#rig', 0.4, 0.9, [{ opacity: 0, transform: 'translate(330px,-140px) scale(1)' }, { opacity: 1, transform: 'translate(330px,-140px) scale(1)' }]);
  B.in('#c8-th', 0.6, { dur: 0.9, y: 14 });
  B.in('#bigterm', 0.8, { dur: 0.9, y: 24 });
  M.replay(B, 1.6);
  D.press(B, at(10) + 0.1); D.menuIn(B, at(10) + 1.0); D.release(B, at(10) + 1.1); D.browserIn(B, at(10) + 1.6);
  B.in('#ax', at(11) + 0.3, { dur: 0.5, y: 0, scale: 0.4, blur: 0, ease: 'spring' });
  D.browserOut(B, at(14) - 0.2); D.menuOut(B, at(14) - 0.1); B.out('#ax', at(14) - 0.2, { dur: 0.4 });
  D.press(B, at(14) + 0.2); D.menuIn(B, at(14) + 1.1); D.release(B, at(14) + 1.2);
  B.in('#aok', at(15) + 0.3, { dur: 0.5, y: 0, scale: 0.4, blur: 0, ease: 'spring' });
  B.in('#c8-tcap', at(18) + 1.0, { dur: 0.9, y: 10 });
});

Talk.beat('backup.headline', (B) => {      // @303.8 (HL)
  B.out('#c8-th, #bigterm, #c8-tcap, #aok', 0, { dur: 0.5, stagger: 0.03 });
  B.lib.device.menuOut(B, 0); B.lib.device.rigShow(B, 0, false);
  B.in('#hl1', 0.5, { dur: 1, y: 0, scale: 0.9, blur: 16 }); B.count('#n74', 0.7, 1.4, 74);
  B.in('#hl2', 1.0, { dur: 1, y: 0, scale: 0.9, blur: 16 }); B.count('#n50b', 1.2, 1.4, 50);
  B.in('#hl3', 1.5, { dur: 1, y: 0, scale: 0.9, blur: 16 }); B.count('#n9', 1.7, 1.4, 9);
});

Talk.beat('backup.patches', (B) => {       // @308.8 (TP)
  B.out('#hl1, #hl2, #hl3', 0, { dur: 0.5, stagger: 0.04 });
  B.in('#c8-fh', 0.5, { dur: 0.9, y: 14 });
  B.els('#ftree div').forEach((d, i) => B.anim(d, 1.0 + i * 0.22, 0.6, [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'translateX(0)' }]));
  B.in('#fp1', 3.4, { dur: 0.9, y: 24 });
  B.in('#fp2', 4.4, { dur: 0.9, y: 24 });
  B.in('#c8-fcap', 5.4, { dur: 1, y: 16 });
});

Talk.beat('backup.tests', (B) => {         // @317.3 (VL)
  B.out('#c8-fh, #ftree div, #fp1, #fp2, #c8-fcap', 0, { dur: 0.5, stagger: 0.02 });
  B.in('#c8-vh', 0.5, { dur: 0.9, y: 14 });
  B.lib.bars.vbars(B, 0.8);
  B.in('#c8-vcap', 3.8, { dur: 1, y: 16 });
});

Talk.beat('backup.why', (B) => {           // @323.8 (WH)
  B.out('#c8-vh, #vbars > div, #c8-vcap', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c8-xh', 0.5, { dur: 0.9, y: 14 });
  B.lib.bars.families(B, 0.9);
  B.in('#gps', 3.3, { dur: 1, y: 24 });
});

Talk.beat('backup.syntax', (B) => {        // @330.3 (WH + 6.5)
  B.words('#c8-line', 0.2, { stagger: 0.1 });
});

// Two tests per bug (the fixed-build replay); leaves the dark passage.
Talk.beat('backup.twotests', (B) => {      // @333.3 (TB)
  const D = B.lib.device, C = B.lib.codepane;
  B.out('#c8-xh, #fam .brow, #gps, #c8-line, #c8-eye', 0, { dur: 0.5, stagger: 0.02 });
  B.anim('#black', 0.3, 0.8, [{ opacity: 0 }], { ease: 'inOut' });
  B.anim('#rig', 0.5, 0.01, [{ transform: 'translate(-990px,-140px) scale(1)' }]);
  D.rigShow(B, 0.6, true);
  B.in('#c4-eye', 0.8, { dur: 0.8, y: 14 });
  B.in('#c4-th', 1.0, { dur: 0.9, y: 14 });
  B.in('#tp', 1.2, { dur: 0.9, y: 24 });
  ['#tl1', '#tl2', '#tl3', '#tl4', '#tl4b', '#tl5'].forEach((l, i) => C.tline(B, l, 1.6 + i * 0.22));
  B.in('#tbad2', 3.2, { dur: 0.6, y: 12 });
  D.press(B, 3.6); D.menuIn(B, 4.6); D.release(B, 4.7);
  C.flash(B, '#tl4b', 5.0, '#c8efd6');
  B.in('#tok', 5.4, { dur: 0.5, y: 0, scale: 0.4, blur: 0, ease: 'spring' });
  B.in('#c4-tc', 6.0, { dur: 1, y: 16 });
  B.in('#c4-tc2', 6.8, { dur: 1, y: 12 });
});
