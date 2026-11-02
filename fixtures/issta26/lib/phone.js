// lib/phone.js — helpers for "Inside the phone": the exploded device layers and the
// mini phone that acts out each paradigm. Ported from the original deck; each takes B.
(function () {
  const LAYS = ['.lay.wire', '.lay.listen', '.lay.state', '.lay.life'];
  Talk.lib.phone = {
    LAYS,
    // Spotlight layer i (0..3) and its label; dim the rest.
    focus: (B, i, t) => {
      LAYS.forEach((s, j) => B.anim(s, t, 0.6, [{ opacity: j === i ? 1 : 0.07 }], { ease: 'inOut' }));
      [1, 2, 3, 4].forEach((k) => B.anim(`#ll${k}`, t, 0.6, [{ opacity: k === i + 1 ? 1 : 0.22 }], { ease: 'inOut' }));
    },
    // The state card's two values. Original: a 0.01 s tween that wrote on p >= 1 and did
    // nothing otherwise (so seeking backwards kept the later value). B.set is a step that
    // is exact in both directions; it takes effect at t instead of t + 0.01.
    setState: (B, t, exp, scr) => { B.set('#st-exp', t, { text: exp }); B.set('#st-scr', t, { text: scr }); },
    cardFlash: (B, t) => B.anim('.lay.state .card', t, 0.6, [{ boxShadow: '0 0 0 0 rgba(255,159,10,0)' }, { boxShadow: '0 0 0 10px rgba(255,159,10,.35)' }, { boxShadow: '0 10px 30px rgba(0,0,0,.12)' }]),
  };
})();
