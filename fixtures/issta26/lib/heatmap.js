// lib/heatmap.js — "But": every one of the 600 runs of the example study (invented outcomes),
// 12 setting rows by 50 cases, columns sorted by how often they passed; case 114 highlighted. The grid
// is generated at load; build(B, t) animates it (t = the original's HM).
(function () {
  // [bug id, app, type, one outcome letter per row of ROWS] (placeholder data, the same in the original deck).
  const FSE = [[8,"TrickyTripper","C","TAAAACTATTCA"],[18,"calendula","C","CBBAATTTCAAC"],[44,"Omni-Notes","O","TAAAAAABAAAA"],[53,"Markor","C","ACTATATAAATT"],[54,"Markor","O","BTCTAATTACAA"],[71,"KISS","O","ATTACBATCCTA"],[84,"ultrasonic","O","ABAAAATTOCAA"],[92,"WiFiAnalyzer","O","TATAAATTTAAO"],[114,"Harmonic HN","O","AATTAAOCABAA"],[129,"andOTP","C","CTTAABCAAAAT"],[130,"andOTP","C","ATATTATCAAAT"],[136,"Harmonic HN","C","AABCATTACAAA"],[159,"Anki-Android","C","ATCAABACOAAA"],[160,"Anki-Android","C","CAATOATATCAA"],[171,"Harmonic HN","C","TATCATCBTCTA"],[181,"Harmonic HN","O","ATCAAACAACAA"],[191,"android-anuto","O","ATTCAAATTBAT"],[192,"markor","O","TATBATCCBATA"],[271,"Aegis","C","CAAATCTCTAAT"],[273,"Anki-Android","O","TAATABATCAAT"],[275,"Aegis","O","TAAAOATTAATO"],[358,"URLCheck","O","TAAATAATTTAO"],[365,"URLCheck","C","CCACATTCBTAB"],[382,"URLCheck","O","ABTBATACAATT"],[447,"URLCheck","O","TATAAACTAAAA"],[1130,"AntennaPod","O","ABATAAOAAAAA"],[1138,"gpslogger","O","ABAATACAACCC"],[1146,"gpstest","O","ACAAAAACAAAA"],[1151,"gpstest","N","BAOAATACATTT"],[1198,"Images-to-PDF","O","CTTAACOTTCAA"],[1202,"Images-to-PDF","O","TTTTAAACAACT"],[1205,"Images-to-PDF","N","TAATCAAOAACT"],[1207,"andOTP","C","TTAOATATCATB"],[1213,"andOTP","O","AAATTTAAAAAA"],[1214,"andOTP","O","ACATAACAAACC"],[1215,"andOTP","C","CTATAAAAATCT"],[1255,"SkyTube","O","CTAAATCCACTA"],[1299,"FieldBook","C","CAAATAAAACCA"],[1441,"anglers-log","O","AAATCCTCTTTC"],[1445,"Anglerslog","O","ATAATTABBTAA"],[1446,"anglers-log","C","ATTAATATTTTT"],[1563,"lrkFM","C","AATAABAAAAAT"],[1568,"lrkFM","C","ATAATTBAATAA"],[1640,"TrainerApp","C","AATTCACTTAAT"],[1641,"TrainerApp","O","CAAABATTTAAO"],[1645,"TrainerApp","C","ATAABATAATAA"],[2587,"PSLab","C","ATTTATACAAAA"],[2677,"PSLab","O","AATTATAAACTT"],[2678,"PSLab","O","TCCBAAACABAC"],[123451,"Anki-Android","O","OTTAOCTOTBAA"]];
  const score = (s) => [...s].filter((c) => 'CAO'.includes(c)).length * 100 + [...s].filter((c) => c === 'C').length;
  const BUGS = [...FSE].sort((a, b) => score(b[3]) - score(a[3]) || a[0] - b[0]);
  const ROWS = [['Tool A', 'Base'], ['Tool A', '+ X'], ['Tool A', '+ Y'], ['Tool A', '+ X + Y'], ['Tool B', 'Base'], ['Tool B', '+ X'], ['Tool B', '+ Y'], ['Tool B', '+ X + Y'], ['Tool C', 'Base'], ['Tool C', '+ X'], ['Tool C', '+ Y'], ['Tool C', '+ X + Y']];
  const hmg = document.getElementById('hmg');
  const rows = ROWS.map((r, ri) => {
    const l = document.createElement('div'); l.className = 'rl'; l.innerHTML = (ri % 4 === 0 ? `<b>${r[0]}</b> · ` : '') + r[1]; l.setAttribute('data-a', ''); hmg.appendChild(l);
    const cells = BUGS.map((b) => { const c = document.createElement('div'); c.className = 'cl ' + b[3][ri] + (b[0] === 114 ? ' k' : ''); hmg.appendChild(c); return c; });
    return { l, cells };
  });
  Talk.lib.heatmap = {
    FSE, BUGS, ROWS,
    build: (B, t) => {
      let hk = 0;
      rows.forEach(({ l, cells }, ri) => {
        B.in(l, t + 0.4 + ri * 0.05, { dur: 0.6, x: -10, y: 0, blur: 2 });
        cells.forEach((c) => { B.anim(c, t + 0.8 + hk * 0.004, 0.35, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }]); hk++; });
      });
    },
  };
})();
