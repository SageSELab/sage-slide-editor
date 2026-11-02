// lib/term.js — backup "A tool at work": an invented tool run replayed in a terminal, with a
// clock showing the run's own (made-up) elapsed time. Lines are generated at load;
// replay(B, base) types them in and steps the clock, with base = the original's tBase.
(function () {
  // [seconds into the run, line class (a assistant, c command, ok, bad), text]
  const TLINES = [
    [3, 'a', 'I will run the example check first, then read the two files it names.'],
    [3, 'c', 'ls -la'],
    [3, 'c', 'rg --files example/checks/'],
    [7, 'c', "sed -n '1,120p' src/example/ListFragment.java"],
    [11, 'c', "sed -n '1,200p' src/example/ListAdapter.java"],
    [43, 'c', "sed -n '1,80p' example/checks/Check7.java"],
    [60, 'a', 'The example check fails because a long press also counts as a tap. Adding a short guard window after the press.'],
    [60, 'c', 'apply_patch   → M ListAdapter.java  (+7 lines)'],
    [174, 'c', './gradlew assembleDebug'],
    [174, 'ok', 'BUILD SUCCESSFUL'],
    [291, 'c', './run_checks.sh Check7'],
    [565, 'bad', '>>> Check7: FAILED'],
    [851, 'a', 'The guard is not enough: the tap still fires on release. Consuming the release event after a long press instead.'],
    [858, 'c', 'apply_patch   → M ListAdapter.java  (+20 lines)'],
    [865, 'c', './run_checks.sh Check7'],
    [1197, 'ok', '>>> Check7: PASSED'],
    [1198, 'c', './run_checks.sh all'],
    [1621, 'ok', '>>> all checks: PASSED'],
    [1633, 'a', 'Done. The change is in ListAdapter.java.'],
  ];
  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  const termEl = document.getElementById('termlines');
  const lines = TLINES.map(([sec, cls, txt]) => { const l = document.createElement('span'); l.className = 'l ' + cls; l.innerHTML = `<span class="ts">${mmss(sec)}</span>${txt}`; termEl.appendChild(l); return l; });
  // When line i appears: every 1.25 s, with two 1.4 s pauses (after the first failing run and
  // after the passing one).
  const tAt = (base, i) => base + i * 1.25 + (i >= 11 ? 1.4 : 0) + (i >= 15 ? 1.4 : 0);
  Talk.lib.term = {
    TLINES, mmss, tAt,
    replay: (B, base) => TLINES.forEach(([sec, cls], i) => {
      B.lib.codepane.tline(B, lines[i], tAt(base, i), cls === 'a' ? 0.9 : 0.45);
      // Original: a 0.01 s tween writing the clock on p >= 1 (history-dependent); a B.set step.
      B.set('#termclock', tAt(base, i), { text: mmss(sec) });
    }),
  };
})();
