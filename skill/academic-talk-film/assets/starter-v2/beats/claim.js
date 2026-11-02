// beats/claim.js — chapter "Chapter name": an example pane (a claim, then its number).
// The first beat of a chapter clears what the previous chapter left on screen.

Talk.beat('claim.claim', (B) => {
  B.out('#t-eye, #t-h, #t-g, #t-fc, #t-au, #t-lg', 0, { dur: 0.7, y: -40, stagger: 0.05 });
  B.in('#c2-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#c2-h', 0.6, { dur: 1 });
  B.in('#c2-s', 1.2, { dur: 1, y: 16 });
});

Talk.beat('claim.number', (B) => {
  B.in('#c2-stat', 0.2, { dur: 0.8, y: 20 });
  B.count('#c2-n', 0.3, 1.3, 11); // [source: paper Table 2, or the package CSV that holds it]
});
