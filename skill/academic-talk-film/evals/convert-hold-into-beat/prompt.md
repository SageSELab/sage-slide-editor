---
tags: [academic-talk-film]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I'm moving my old single-file deck into the new talk folder at /Users/KevinMoran/Dropbox/Documents/My_Faculty_Work/SAGE/git-src-code/sage-slide-editor/skill/academic-talk-film/evals/convert-hold-into-beat/fixture/talk (copy it to /tmp/talk-eval4 and work there; don't change the original). The pane with the claim is already in, but the hold after it that counts up the number is still only in the old index.html, written by hand like this:

```js
  const c2 = 6.0;
  // ...
  cp(c2 + 3.0, 'The claim', 'What this pane is for.');
  T.in('#c2-stat', c2 + 3.2, { dur: 0.8, y: 20 });
  T.count('#c2-n', c2 + 3.3, 1.3, 11);
  cp(c2 + 6.0, 'The number', 'Eleven of fifty.');
```

Bring "The number" over as its own click right after "The claim", with the same timing and notes, and make sure the number is gone again when "One more thing" starts.
