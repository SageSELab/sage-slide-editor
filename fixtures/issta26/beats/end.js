// beats/end.js — the public end card (public build only; replaces the private chapters).
// Ported from build-public.py. Unlike omt.omt, it leaves the summary's QR codes on screen.

Talk.beat('end.end', (B) => {              // @240.8 (c8)
  B.out('#sum-eye, #sum-rows .sumrow, #sum-pkg', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#end-eye', 0.6, { dur: 0.8, y: 14 });
  B.in('#end-h', 0.8, { dur: 1.1, y: 26 });
  B.in('#end-au', 1.4, { dur: 1, y: 18 });
  B.in('#end-links', 1.9, { dur: 0.9, y: 16 });
  B.in('#end-lg', 2.3, { dur: 0.9, y: 12 });
});
