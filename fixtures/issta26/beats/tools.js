// beats/tools.js — chapter "Five tools": one beat per tool (the original's TOOLS loop), then
// the patch evaluation pipeline. Times are relative to each beat's start; c5 = 137.3,
// TT[k] = c5 + 1.2 + 5k, each tool's hold TT[k] + 4.6.

Talk.beat('tools.rr', (B) => {             // @137.3 (c5)
  B.out('#c4-mh, #mp, #mrep, #mops, #g46wrap, #c4-eye', 0, { dur: 0.5, stagger: 0.03 });
  B.anim('#gl', 0.2, 0.4, [{ opacity: 0 }]);
  B.anim('#gl-drawer', 0.7, 0.01, [{ transform: 'translateX(-100%)' }]);
  B.anim('#gl-crash', 0.7, 0.01, [{ opacity: 0 }]);
  B.lib.device.rigShow(B, 0.1, false);
  B.in('#c5-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#tin', 0.6, { dur: 1, x: -30, y: 0 });
  B.lib.tools.tool(B, 0, 1.2);
});
// Each later tool beat starts 0.4 s before its TT[k].
Talk.beat('tools.ntr', (B) => B.lib.tools.tool(B, 1, 0.4));   // @143.1
Talk.beat('tools.d4c', (B) => B.lib.tools.tool(B, 2, 0.4));   // @148.1
Talk.beat('tools.cr', (B) => B.lib.tools.tool(B, 3, 0.4));    // @153.1
Talk.beat('tools.oh', (B) => B.lib.tools.tool(B, 4, 0.4));    // @158.1

Talk.beat('tools.pipeline', (B) => {       // @163.1; the pipeline (c5p = c5 + 26) is 0.2 in
  const p = 0.2;
  B.out('#tc-oh, #tin', p, { dur: 0.5, stagger: 0.03 });
  B.in('#c5-ph', p + 0.4, { dur: 1 });
  B.lib.tools.minis.forEach((d, k) => B.in(d, p + 0.8 + k * 0.1, { dur: 0.7, y: 16 }));
  B.in('#st1, #st2, #st3', p + 1.3, { dur: 0.8, y: 20, stagger: 0.15 });
  B.in('#lb1, #lb2, #lb3, #lb4, #lb5', p + 1.9, { dur: 0.8, y: 20, stagger: 0.1 });
  B.lib.tools.flow(B, p + 2.6);
  [442, 149, 35, 620, 1803].forEach((n, j) => B.count(`#lb${j + 1} .n`, p + 3.4, 5.6, n));
  B.in('#c5-total', p + 3.0, { dur: 0.8, y: 12 });
  B.count('#c5-n', p + 3.4, 5.6, 3049);
});
