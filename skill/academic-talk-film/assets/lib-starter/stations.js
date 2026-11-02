// lib/stations.js — "how a real bug is built": five stations on a track, the bug card moving
// along it. One beat per station; station(B, k, s) builds station k (0..4) with s = the beat-
// relative time the station lights up (the original's sAt(k)).
(function () {
  const SX = [0, 345, 690, 1035, 1380];
  const lit = { boxShadow: '0 24px 60px rgba(10,132,255,.18)', borderColor: '#0a84ff' };
  const unlit = { boxShadow: '0 20px 50px rgba(0,0,0,.06)', borderColor: 'rgba(0,0,0,.12)' };
  const pop = (B, sel, t) => B.anim(sel, t, 0.4, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { ease: 'spring' });
  const rise = (B, sel, t) => B.anim(sel, t, 0.4, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }]);
  // Each station's own micro-animation, relative to its light-up time s.
  const MICRO = [
    (B, s) => B.els('#stn1 .gb i').forEach((b, i) => B.anim(b, s + 0.1 + i * 0.3, 0.6, [{ width: '0%' }, { width: b.style.getPropertyValue('--w') || '100%' }])),
    (B, s) => B.anim('#rep-ok', s + 0.6, 0.4, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { ease: 'spring' }),
    (B, s) => B.els('#stn3 .cl i.hit').forEach((l, i) => B.anim(l, s + 0.4 + i * 0.3, 0.4, [{ background: '#e5e5ea', transform: 'scaleX(1)' }, { background: '#ff9f0a', transform: 'scaleX(1)' }])),
    (B, s) => { rise(B, '#tch1', s + 0.3); rise(B, '#tch2', s + 0.7); },
    (B, s) => { pop(B, '#vm1', s + 0.3); pop(B, '#vm2', s + 0.9); },
  ];
  Talk.lib.stations = {
    SX,
    station: (B, k, s) => {
      if (k) B.anim(`#stn${k}`, s - 0.3, 0.5, [unlit]);                 // the previous station dims
      B.in(`#stn${k + 1}`, s - 0.5, { dur: 0.7, y: 24 });
      if (k) B.anim('#bugcard', s - 0.45, 0.6, [{ transform: `translateX(${SX[k - 1]}px)` }, { transform: `translateX(${SX[k]}px)` }], { ease: 'inOut' });
      B.anim(`#stn${k + 1}`, s, 0.5, [unlit, lit]);
      MICRO[k](B, s);
    },
  };
})();
