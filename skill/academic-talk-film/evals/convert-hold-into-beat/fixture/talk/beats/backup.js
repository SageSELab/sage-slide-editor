// beats/backup.js — chapter "Backup" (backup, dark, private). Its DOM lives in scenes/omt.html.
// Backup holds are numbered "Backup n / m" by lib/slideno.js. A backup must recreate the state
// it needs (bring the device or a code pane back in) because Kevin may jump straight to it.

Talk.beat('backup.backup', (B) => {
  B.out('#cl-h, #cl-s, #cl-l', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#backup-title', 0.6, { dur: 0.8 });
});
