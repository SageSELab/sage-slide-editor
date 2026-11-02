// lib/world.js — chapter 1's world: the APR timeline and the benchmark tiles.
// Generates its DOM into #whtml at load (before any beat runs), and exposes the
// helpers the chapter-1 beats use. Ported from the original deck's script.
(function () {
  const MS = [
    [200, '2009', 'GenProg', 'search-based repair'],
    [350, '2013', 'PAR', 'templates from human fixes'],
    [500, '2014', 'Defects4J', 'the shared benchmark'],
    [650, '2016', 'Prophet · Angelix', 'learned priors, constraints'],
    [800, '2019', 'TBar', 'template-based repair'],
    [950, '2020', 'CoCoNuT · CURE', 'neural machine translation'],
    [1100, '2022', 'RewardRepair', 'execution feedback in training'],
    [1250, '2023', 'ChatRepair', 'conversational LLM repair'],
    [1400, '2024', 'SWE-agent · OpenHands', 'LLM agents'],
  ];
  const TILES = [
    ['ManyBugs', 'php · python · gzip · libtiff · lighttpd · wireshark'],
    ['IntroClass', 'six small C programs: checksum · digits · grade · median · smallest · syllables'],
    ['Defects4J', 'JFreeChart · Closure Compiler · Commons Lang · Commons Math · Joda-Time · Mockito'],
    ['QuixBugs', '40 textbook algorithms: quicksort · knapsack · shortest path · bitcount'],
    ['Bugs.jar', 'Accumulo · Camel · Commons Math · Flink · Jackrabbit Oak · Log4j 2 · Maven · Wicket'],
    ['BugsInPy', 'pandas · keras · matplotlib · scrapy · black · youtube-dl · tornado · luigi'],
    ['SWE-bench', 'django · sympy · scikit-learn · matplotlib · astropy · flask · requests · pytest'],
  ];

  // ---- generated DOM (runs once, at load) ----
  const W = document.getElementById('whtml');
  MS.forEach(([x, yr, nm, ds], i) => {
    const up = i % 2 === 0;
    const el = document.createElement('div');
    el.className = 'ms'; el.id = 'ms' + i;
    el.style.left = x + 'px';
    if (up) el.style.bottom = '389px'; else el.style.top = '669px';
    el.innerHTML = up
      ? `<div class="ds" data-a>${ds}</div><div class="nm" data-a>${nm}</div><div class="yr" data-a style="margin-bottom:14px">${yr}</div><div class="dot" data-a></div>`
      : `<div class="dot" data-a></div><div class="yr" data-a style="margin-top:14px">${yr}</div><div class="nm" data-a>${nm}</div><div class="ds" data-a>${ds}</div>`;
    W.appendChild(el);
  });
  TILES.forEach(([n, projects], i) => {
    const el = document.createElement('div');
    el.className = 'tile'; el.id = 'tile' + i;
    el.style.left = (1800 + i * 230) + 'px'; el.style.top = '560px';
    el.setAttribute('data-a', '');
    el.innerHTML = `<div class="f">${n}</div><div class="b"><b>library code</b><small>unit tests</small><em>${projects}</em></div><div class="nm" data-a>${n}</div>`;
    W.appendChild(el);
  });

  const L = document.getElementById('line').getTotalLength();
  const invInOut = (p) => (p < 0.5 ? Math.cbrt(p / 4) : 1 - Math.cbrt((1 - p) / 4));

  Talk.lib.world = {
    MS, TILES, L,
    // Draw the timeline from arc length a to b (px along the path).
    px: (B, a, b, t, dur, ease) => B.draw('#line', t, dur, a / L, b / L, ease ?? 'linear'),
    // When the pen (started at `penAt`, drawing 160→1280 over 7 s inOut) reaches node x.
    // Relative to the beat; `stubAt` is when nodes on the title stub appear.
    nodeT: (x, penAt, stubAt) => { const s = x - 120; if (s <= 160) return stubAt; return penAt + 7.0 * invInOut((s - 160) / 1120) - 0.08; },
  };
})();
