// beats/end.js — the public end card (public build only: `talkc publish` cuts the private
// chapters and appends this block after the last public hold). Clears that hold's pane first.

Talk.beat('end.end', (B) => {
  B.out('#c2-eye, #c2-h, #c2-s', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#end-eye', 0.6, { dur: 0.8, y: 14 });
  B.in('#end-h', 0.8, { dur: 1.1, y: 26 });
  B.in('#end-au', 1.4, { dur: 1, y: 18 });
  B.in('#end-links', 1.9, { dur: 0.9, y: 16 });
});
