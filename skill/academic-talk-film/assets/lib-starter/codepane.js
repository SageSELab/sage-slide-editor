// lib/codepane.js — code-pane and terminal effects: pulse (a dot travelling along an
// offset-path), flash (line background), grow (new lines open and type in), tline (a line
// types in). Ported from the original deck; each takes B and a beat-relative t.
(function () {
  Talk.lib.codepane = {
    pulse: (B, id, t, dur) => B.anim(id, t, dur, [{ opacity: 0, offsetDistance: '0%' }, { opacity: 1, offsetDistance: '8%', offset: 0.1 }, { opacity: 1, offsetDistance: '92%', offset: 0.9 }, { opacity: 0, offsetDistance: '100%' }], { ease: 'inOut' }),
    flash: (B, sel, t, c) => B.anim(sel, t, 0.5, [{ background: 'rgba(255,255,255,0)' }, { background: c }], { ease: 'out' }),
    grow: (B, sel, t, stagger = 0.16) => {
      B.els(sel).forEach((el, i) => {
        B.anim(el, t + i * stagger, 0.25, [{ height: '0px', opacity: 0 }, { height: '30px', opacity: 1 }], { ease: 'inOut' });
        B.anim(el, t + i * stagger + 0.2, 0.35, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { ease: 'steps(16)' });
      });
    },
    tline: (B, id, t, dur = 0.5) => {
      B.anim(id, t, 0.01, [{ opacity: 0 }, { opacity: 1 }]);
      B.anim(id, t, dur, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { ease: 'steps(24)' });
    },
  };
})();
