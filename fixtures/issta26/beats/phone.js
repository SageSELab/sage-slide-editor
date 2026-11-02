// beats/phone.js — chapter "Inside the phone": the device appears and explodes into four
// layers, one paradigm per hold, then the four kinds of UI bugs.
// Times are relative to each beat's start (= the previous hold). @abs = original time.

Talk.beat('phone.exploded', (B) => {       // @27.5
  const { LAYS } = B.lib.phone;
  B.out('#c1-ui-h, #c1-ui-s, #c1-ui-c, #c1-eye', 0, { dur: 0.6, stagger: 0.04 });
  B.out('#qm, #qdot', 0, { dur: 0.5, y: 0, blur: 6 });
  B.anim('#rig', 0.2, 0.9, [{ opacity: 0, transform: 'translate(0,0) scale(.778)' }, { opacity: 1, transform: 'translate(0,0) scale(.778)' }]);
  B.anim('#wsvg', 0.6, 0.8, [{ opacity: 1 }, { opacity: 0 }]);
  B.anim('#rig', 1.2, 1.4, [{ transform: 'translate(0,0) scale(.778)' }, { transform: 'translate(-990px,-140px) scale(1)' }], { ease: 'inOut' });
  B.in('#c2-eye', 1.8, { dur: 0.8, y: 14 });
  // explode
  B.anim('#tilt', 2.9, 2.0, [{ transform: 'translate(0px,0px) rotateX(0deg) rotateZ(0deg) scale(1)' }, { transform: 'translate(170px,150px) rotateX(58deg) rotateZ(-24deg) scale(.78)' }], { ease: 'inOut' });
  // The layers are visibility:hidden in the scene; they exist from here until phone.crash
  // closes the window (original: one T.tween(0, 343) testing 30.5 <= t <= 58.0).
  B.set('.lay', 3.0, { style: { visibility: 'visible' } });
  LAYS.forEach((s, i) => {
    B.anim(s, 3.1 + i * 0.25, 1.6, [{ opacity: 0, transform: 'translateZ(0px)' }, { opacity: 1, transform: `translateZ(${120 * (i + 1)}px)` }], { ease: 'inOut' });
    B.in(`#ll${i + 1}`, 3.9 + i * 0.3, { dur: 0.9, x: 30, y: 0 });
  });
});

// Layout: the mini screen builds up, row by row, from the XML.
Talk.beat('phone.layout', (B) => {         // @36.0
  B.lib.phone.focus(B, 0, 0);
  B.in('#miniwrap', 0.2, { dur: 1, y: 30 });
  B.in('#pc1', 0.6, { dur: 0.9, y: 16 });
  ['#m-c1', '#m-c2', '#m-c3', '#m-c4'].forEach((s, i) => {
    B.anim(s, 1.4 + i * 0.5, 0.5, [{ opacity: 0, boxShadow: 'inset 0 0 0 2px rgba(10,132,255,0)' }, { opacity: 1, boxShadow: 'inset 0 0 0 2px rgba(10,132,255,.95)' }]);
    B.anim(s, 2.1 + i * 0.5, 0.6, [{ boxShadow: 'inset 0 0 0 2px rgba(10,132,255,0)' }]);
  });
  B.in('#xmlchip', 1.3, { dur: 0.6, y: 10 });
  B.type('#xmlchip code', 1.5, 1.8);
});

// Listeners: a long press on the mini screen; the framework calls the listener.
Talk.beat('phone.listeners', (B) => {      // @41.0
  B.out('#pc1, #xmlchip', 0, { dur: 0.4 });
  B.lib.phone.focus(B, 1, 0.1);
  B.in('#pc2', 0.5, { dur: 0.9, y: 16 });
  B.anim('#m-fg', 1.2, 0.25, [{ opacity: 0, transform: 'translate(0,0) scale(1.6)' }, { opacity: 1, transform: 'translate(0,0) scale(1)' }]);
  B.anim('.lay.listen b:nth-child(1)', 2.1, 0.5, [{ transform: 'scale(1)', background: '#bf5af2' }, { transform: 'scale(1.15)', background: '#ff375f' }, { transform: 'scale(1)', background: '#bf5af2' }]);
  B.anim('#m-menu', 2.2, 0.5, [{ opacity: 0, transform: 'translateY(40px) scale(.96)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }]);
  B.anim('#m-fg', 2.4, 0.3, [{ opacity: 0, transform: 'translate(0,0) scale(.8)' }]);
});

// State: scroll, then collapse a comment; the state card tracks it.
Talk.beat('phone.state', (B) => {          // @46.0
  const { focus, setState, cardFlash } = B.lib.phone;
  B.out('#pc2', 0, { dur: 0.4 });
  B.anim('#m-menu', 0, 0.3, [{ opacity: 0, transform: 'translateY(20px) scale(.98)' }]);
  focus(B, 2, 0.1);
  B.in('#pc3', 0.5, { dur: 0.9, y: 16 });
  B.anim('#m-fg', 1.0, 0.25, [{ opacity: 0, transform: 'translate(0,230px) scale(1.4)' }, { opacity: 1, transform: 'translate(0,230px) scale(1)' }]);
  B.anim('#m-fg', 1.3, 0.7, [{ transform: 'translate(0,230px) scale(1)' }, { transform: 'translate(0,120px) scale(1)' }], { ease: 'inOut' });
  B.anim('#m-list', 1.3, 0.7, [{ transform: 'translateY(0px)' }, { transform: 'translateY(-110px)' }], { ease: 'inOut' });
  B.anim('#m-fg', 2.0, 0.3, [{ opacity: 0 }]);
  setState(B, 1.9, 'true', '620'); cardFlash(B, 1.9);
  B.anim('#m-fg', 2.7, 0.2, [{ opacity: 0, transform: 'translate(0,-10px) scale(1.4)' }, { opacity: 1, transform: 'translate(0,-10px) scale(1)' }]);
  B.anim('#m-fg', 3.0, 0.3, [{ opacity: 0 }]);
  B.anim('#m-c2 .tx', 3.0, 0.5, [{ maxHeight: '400px' }, { maxHeight: '0px' }], { ease: 'inOut' });
  setState(B, 3.1, 'false', '620'); cardFlash(B, 3.1);
});

// Lifecycle: rotate; the screen is destroyed and re-created; unsaved state reverts.
Talk.beat('phone.lifecycle', (B) => {      // @51.0
  const { focus, setState, cardFlash } = B.lib.phone;
  B.out('#pc3', 0, { dur: 0.4 });
  focus(B, 3, 0.1);
  B.in('#pc4', 0.5, { dur: 0.9, y: 16 });
  B.anim('#miniwrap', 1.0, 1.0, [{ transform: 'translate(0,0) rotate(0deg)' }, { transform: 'translate(-90px,110px) rotate(-90deg)' }], { ease: 'inOut' });
  ['#lc3', '#lc4', '#lc5', '#lc1'].forEach((s, i) => B.anim(s, 1.3 + i * 0.35, 0.45, [{ background: '#fff', color: '#0b6b3a' }, { background: '#3ddc84', color: '#fff' }, { background: '#fff', color: '#0b6b3a' }]));
  B.anim('#m-flash', 2.4, 0.5, [{ opacity: 0 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0 }]);
  B.anim('#m-list', 2.5, 0.01, [{ transform: 'translateY(0px)' }]);
  B.set('#mhn', 2.45, { class: { land: true } });   // original: 0.01 s tween toggling on p >= 1
  B.anim('#m-c2 .tx', 2.5, 0.01, [{ maxHeight: '400px' }]);
  setState(B, 2.5, 'true', '0'); cardFlash(B, 2.6);
});

// ===== Four kinds of UI bugs, one hold per type =====
Talk.beat('phone.crash', (B) => {          // @56.5
  const { LAYS } = B.lib.phone;
  B.out('#pc4, #ll1, #ll2, #ll3, #ll4, #miniwrap', 0, { dur: 0.5, stagger: 0.03 });
  LAYS.forEach((s, i) => B.anim(s, 0.1 + i * 0.1, 1.2, [{ opacity: 0, transform: 'translateZ(0px)' }], { ease: 'inOut' }));
  B.anim('#tilt', 0.2, 1.5, [{ transform: 'translate(0px,0px) rotateX(0deg) rotateZ(0deg) scale(1)' }], { ease: 'inOut' });
  B.set('.lay', 1.5, { style: { visibility: 'hidden' } });   // closes the window opened in phone.exploded
  B.in('#c2-th', 1.4, { dur: 1 });
  B.in('#c2-tc', 1.7, { dur: 1, y: 16 });
  B.anim('#crash', 2.4, 0.3, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }]);
  B.in('#tc1', 2.5, { dur: 0.6, y: 14 });
});

Talk.beat('phone.output', (B) => {         // @60.5
  B.anim('#crash', 0, 0.3, [{ opacity: 0 }]);
  // The year glitches to [NaN] through this hold and is restored 0.1 s into phone.cosmetic.
  // Original: one T.tween(60.7, 1.9) that ran 0.1 s past this hold (an explicit hold before
  // the motion end, which the PLAN 3.1 validator would reject); here it is a B.set pair.
  B.set('#yr', 0.2, { text: '[NaN]', style: { color: '#ff6b61' } });
  B.in('#tc2', 0.3, { dur: 0.6, y: 14 });
});

Talk.beat('phone.cosmetic', (B) => {       // @62.5
  B.set('#yr', 0.1, { text: '[2024]', style: { color: '' } });
  B.anim('#cm1tx', 0.2, 0.4, [{ transform: 'translateX(0)' }, { transform: 'translateX(70px)' }]);
  B.in('#tc3', 0.3, { dur: 0.6, y: 14 });
});

Talk.beat('phone.navigation', (B) => {     // @64.5
  B.anim('#cm1tx', 0, 0.4, [{ transform: 'translateX(0)' }]);
  B.anim('#settings', 0.3, 0.45, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }]);
  B.in('#tc4', 0.4, { dur: 0.6, y: 14 });
});
