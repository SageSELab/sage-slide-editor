// lib/device.js — the Harmonic device in the rig: finger press/release, the context menu,
// the in-app browser, and showing/hiding the whole rig. Ported from the original deck's
// press/release/menuIn/menuOut/browserIn/browserOut/rigShow; each takes B and a beat-relative t.
(function () {
  Talk.lib.device = {
    press: (B, t) => {
      B.anim('#fg', t, 0.25, [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }]);
      B.draw('#ring', t + 0.15, 0.75, 0, 1, 'linear');
    },
    release: (B, t) => B.anim('#fg', t, 0.3, [{ opacity: 0, transform: 'scale(.8)' }]),
    menuIn: (B, t) => B.anim('#menu', t, 0.5, [{ opacity: 0, transform: 'translateY(40px) scale(.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]),
    menuOut: (B, t) => B.anim('#menu', t, 0.35, [{ opacity: 0, transform: 'translateY(20px) scale(.98)' }]),
    browserIn: (B, t) => B.anim('#browser', t, 0.6, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0%)' }], { ease: 'inOut' }),
    browserOut: (B, t) => B.anim('#browser', t, 0.5, [{ transform: 'translateY(100%)' }], { ease: 'inOut' }),
    rigShow: (B, t, on) => B.anim('#rig', t, 0.6, [{ opacity: on ? 1 : 0 }], { ease: 'inOut' }),
  };
})();
