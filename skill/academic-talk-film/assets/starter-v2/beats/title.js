// beats/title.js — chapter "Title". Times are relative to the beat's start (the previous hold;
// 0 for the first beat). The hold is talk.json's "hold", also relative to the beat's start.

Talk.beat('title.title', (B) => {
  B.in('#t-eye', 0.3, { dur: 0.8, y: 16 });
  B.words('#t-h', 0.6, { stagger: 0.09 });
  B.in('#t-g', 1.9, { dur: 1.1, y: 26, scale: 0.97, blur: 16 });
  B.in('#t-fc > *', 2.5, { dur: 0.7, y: 14, scale: 0.6, blur: 6, stagger: 0.07 });
  B.in('#t-au', 3.0, { dur: 0.9, y: 20 });
  B.in('#t-lg', 3.4, { dur: 0.9, y: 16 });
});
