// lib/flow.js — the implication cards: chips that flow into the prompt box (flowIn) and the
// prompt box that lights up and is relabelled (boxPulse). Ported from the original; take B.
(function () {
  Talk.lib.flow = {
    flowIn: (B, sel, t, dx) => B.els(sel).forEach((e, i) => B.anim(e, t + i * 0.3, 1.6, [{ opacity: 0, transform: 'translate(0,0)' }, { opacity: 1, transform: 'translate(0,0)', offset: 0.25 }, { opacity: 1, transform: 'translate(0,0)', offset: 0.55 }, { opacity: 0, transform: `translate(${dx}px,0)` }], { ease: 'inOut' })),
    // Original: a 0.01 s tween writing `p >= 1 ? label : 'prompt'`; here a B.set step at t
    // (the markup text 'prompt' is the value before it).
    boxPulse: (B, sel, t, label) => {
      B.anim(sel, t, 0.6, [{ borderColor: '#86868b', color: '#86868b' }, { borderColor: '#1d1d1f', color: '#1d1d1f' }]);
      if (label) B.set(sel, t, { text: label });
    },
  };
})();
