# ISSTA 2026 talk, revision plan: from slides to a film with checkpoints

## 1. What changes

The current deck is a slide deck with step reveals. The revision is a single continuous 1920x1080 film,
built on the same engine as the publications films (`film.js`: one master clock, every animation
registered at an absolute time, deterministic `render(t)`), with **checkpoints**. Playback runs to the
next checkpoint and holds. Space resumes. Nothing cuts; objects stay on screen and transform into the
next beat, the way the Duo segment moves from one idea to the next without a slide break.

Design language taken from the Duo segment and the films:

- One hero object per beat (a line, a phone, a block of code, a number). It arrives, the words arrive
  beside it, the words leave, the object transforms into the next hero.
- Big type appears word by word with the expo "settle" easing, leaves with blur-out. One statement at a time.
- Devices are drawn, not photographed: HTML mock screens that can be exploded into layers, tapped,
  scrolled, and re-skinned. The real Harmonic screenshots stay for one beat of authenticity.
- Light background for the ISSTA story (as requested), with the film motion vocabulary. The screen
  goes black for "One more thing." and stays dark for that section, so the surprise reads as a
  change of film stock.
- No titles-as-jokes. Captions say the fact.

## 2. Engine: `talk.js` (a fork of `film.js`)

- Keep: absolute-time WAAPI animations, `in/out/anim/tween/count/type`, deterministic seek (`?t=`),
  chaptered scrub bar, 1920x1080 letterboxing.
- Add: `checkpoints: [t0, t1, ...]`. Space / right arrow plays to the next checkpoint and pauses.
  Left arrow jumps back to the previous checkpoint (seek, no replay). `Enter` plays through without
  stopping (rehearsal). `?cp=12` opens at a checkpoint.
- Add: presenter window (N): notes for the current segment, elapsed talk time, time of the film
  segment that will play next, next checkpoint label. Opens as a second window synced through
  `BroadcastChannel`, so the laptop shows notes while the projector shows the film.
- Add: light theme tokens; a `scene` helper that keeps a persistent object (the phone, the line)
  across chapters instead of fading everything out.
- QA: because `render(t)` is deterministic, I screenshot every checkpoint with headless Chrome at
  `?t=` and check it, which also fixes the fade artifact we saw in the slide version.

Target length: about 7 minutes of motion across 26 checkpoints, leaving about 8 minutes of talking.
Each checkpoint lists its motion time below so the total can be tuned.

## 3. Storyboard

Times are motion time only (talking happens at the holds). Data sources in brackets.

### Chapter 1. The line (0:00 to 1:05)

1. **Title.** Title sets word by word. A single stroke draws under it, then the title lifts away and
   the stroke stays. The stroke is the timeline. (6 s)
2. **Fifteen years.** The line draws right. At each year a node pops and a name settles above or
   below it: GenProg 2009, PAR 2013, Defects4J 2014, Prophet and Angelix 2016, TBar 2019, CoCoNuT and
   CURE 2020, RewardRepair 2022, ChatRepair 2023, SWE-agent and OpenHands 2024. (14 s)
3. **Where it was measured.** The line keeps going and passes through a row of benchmark tiles
   (ManyBugs, IntroClass, Defects4J, QuixBugs, Bugs.jar, BugsInPy, SWE-bench). Each tile the line
   passes flips to show the same two words: library code, unit tests. (8 s)
4. **Where it never went.** The line bends and draws a phone outline. Inside, a UI fills in
   (header, list, button). The line ends in a question mark drawn in the same stroke. Caption: the UI
   is nearly half of user-facing software. (10 s)

### Chapter 2. Inside the phone (1:05 to 1:50)

5. **Exploded view.** The drawn phone becomes a rendered app screen (an HTML mock of Harmonic's
   comments screen, dark app theme). The screen separates into four layers in perspective, like an
   Apple device teardown: layout XML, event listeners, state, lifecycle callbacks. Each layer gets a
   label as it separates. (12 s)
6. **Inversion of control.** A tap on the top layer sends a pulse down through the layers to a
   listener; the framework, not the code, decides which one runs. Then the phone rotates, the
   lifecycle layer flashes `onPause → onDestroy → onCreate`, and the state layer empties. (10 s)
7. **Four bug types.** Layers collapse back into the phone. Four short glitches on the screen, one
   per type: a crash dialog, a wrong number in a field, a clipped label, a wrong screen. Each leaves a
   colored chip: crash, output, cosmetic, navigation. [Johnson et al., AndroR2+] (10 s)

### Chapter 3. One bug, live (1:50 to 2:50)

8. **Harmonic #114, the bug.** The mock comments screen plays the bug: finger long-presses a link,
   the context menu rises (expected), then a browser sheet slides over it (not expected). The issue
   text appears beside it exactly as filed. [issue text from `Dataset/real-bug-buggy-fixed-code.csv`]
   Then the three real screenshots fade in behind the mock for one beat, to show this is the actual
   app. (14 s)
9. **Why it happens.** Split: mock left, code right. The long-press pulse reaches
   `onItemClick` (menu), and a second pulse reaches `onClick` on the link (browser). Both fire; the
   framework orders them. (10 s)
10. **The developer's fix.** The flag types into both methods (real diff, both hunks). Replay the
    gesture: menu opens, no browser. Caption: two handlers on one view, arbitrated by state that
    outlives a single event. (12 s)
11. **No tool fixed it.** Five tool names appear under the phone and each dims to a gray x. Hold.
    (6 s)

### Chapter 4. Building DroidFixBench (2:50 to 4:05)

12. **What a repair tool needs.** A bug chip in the center. Five cards dock onto it one at a time:
    compilable snapshot, statement-level localization, correct patch, GUI tests, description. A row of
    existing dataset names (AndroR2, Themis, DroixBench, Xiong et al., SWE-bench Multimodal) slides
    under it and each one shows which cards it lacks. (14 s)
13. **Mining as a funnel.** Particles. 80 reports enter from the left and pass three filters
    (builds, reproduces, fix is in Java and testable); only 35 get through. Second stream of 30 issues
    from five F-Droid apps: 13 get through. Third stream of 22 from FBO4A: 2. Survivors settle into a
    50-dot grid that sorts by type. [evaluation.tex counts] (16 s)
14. **Writing the tests.** The real UiAutomator test for #114 types into a code panel
    (`mDevice.swipe`, tap "Get started", open the story, long-press the link) while the mock phone
    performs the same actions in sync. On the buggy build a red x; the fixed build, green check. A
    second test guards the surrounding UI. Pixel 2, Android 9, 2.5 min per test. [`real-bug-test-cases.csv`] (16 s)
15. **Synthetic bugs.** A real MDroid+ mutant lands on real code: GPSLogger mutant 17 replaces an
    `Intent` with `null`; the diff types in, the phone shows the crash. Ten operator chips with counts,
    46 dots by type. [`synthetic-bug-buggy-fixed-code.csv`] (12 s)

### Chapter 5. Five tools, one pipeline (4:05 to 4:50)

16. **Five tools.** The same input (bug 1445's `tripExists` method, report, failing test) sits on
    the left. Five cards cross it left to right, each with a four-second mechanism animation:
    RewardRepair (tokens in, tokens out, a pre-trained model), NTR (a template slot gets filled by
    CodeLlama), D4C (one prompt, whole function rewritten by GPT-4), ChatRepair (a loop: patch, test
    failure feeds the next prompt, GPT-3.5), OpenHands (a terminal: read, edit, run, with
    Qwen2.5-Coder). (22 s)
17. **The pipeline.** Patches flow out of the cards into apply, build, emulator. A sorter drops each
    into one of five colored lanes: correct, plausible but not correct, overfit, test failure, build
    failure. Counter runs to 3,049. (12 s)

### Chapter 6. Results (4:50 to 6:20)

18. **Synthetic.** 1,457 tiny squares pour into five rows and settle into the stacked bars; the
    green dominates for OpenHands, ChatRepair, D4C. The 46-dot grid lights 41. [Table, synthetic] (14 s)
19. **Real.** Same motion, 1,592 squares. Gray takes over. The 50-dot grid lights 11. Then the two
    grids sit side by side: 41/46, 11/50. A bar fills to 67%: did not build. [Table, real] (16 s)
20. **A near miss, with real patches.** `tripExists` on screen. D4C patch 62 types in
    (`object instanceof Trip &&`): the test runs on the mock, passes, but the trip still cannot be
    saved. D4C patch 60 (`trip.equals((Trip) object)`): passes by accident, reference equality.
    OpenHands: right idea, `getId()` unknown, test fails. The patches are the actual rows from the
    D4C CSV. [`GeneratedPatches/D4C/D4C-result-real-bugs.csv`, OpenHands CSV] (18 s)
21. **Overfitting.** PSLab #2678: `degree = 0` types in over the developer's `Math.round(...)`.
    The dial on the mock stays at zero while both checks go green. 19 overfit patches. (8 s)
22. **Why 379 failed.** 379 chips rain down and cluster into nine piles sized by count. The four
    Android piles turn green and a 42% rises out of them. Then the top single causes surface as
    pills: non-existent method 37, non-existent component ID 35, non-existent Activity 18, with a
    short "hallucinated identifier" animation (an `R.id.` that resolves to nothing). (16 s)

### Chapter 7. Implications and summary (6:20 to 6:50)

23. **Four implications**, each as a four-second micro-scene: a list of real component IDs and
    Activity names flowing into the prompt; the project's API signatures flowing in; a screenshot
    flowing in; a build loop that bounces a red patch back until it compiles. (18 s)
24. **Summary and package.** The four numbers assemble (96, 5, 41/46 and 11/50, 42%) with the
    GitHub and Zenodo links. Hold. (8 s)

### Chapter 8. One more thing (6:50 to 9:20, dark)

25. **Cut to black.** "One more thing." types. (5 s)
26. **The setup.** (Placeholder: the fixture's private chapter is an invented example study.)
    Three tool marks rise (Tool A, Tool B, Tool C). A 2x2 grid of settings builds. A counter runs
    2 to 5. The grid multiplies into 600 cells. (14 s)
27. **A tool at work.** A terminal replays an invented run with made-up timestamps, while the
    mock phone on the right runs a check and fails, then passes. (30 s)
28. **The headline.** Three counters with invented numbers. (10 s)
29. **But.** A 50x12 heatmap of invented outcomes fills cell by cell; one column lifts out and a
    file-tree view shows which file each of twelve variants touched. (24 s)
30. **Setting Y.** The 2x2 grid again; each cell fills to an invented pass rate per tool. (14 s)
31. **Why runs fail.** Six placeholder categories as bars, an example code card, then one line
    that animates word by word across the bottom. (22 s)
32. **Close.** How far are we? Links, logos. (8 s)

Total motion: about 7.5 minutes. 32 checkpoints. If that is too many holds, chapters 2 and 7 can be
played straight through (checkpoints removed) without changing the build.

## 4. Data pulled directly from the replication packages

| Beat | Source |
|---|---|
| Issue texts, developer diffs (114, 1146, 1445, 2678, 1299) | `UI-Program-Repair/Dataset/real-bug-buggy-fixed-code.csv` |
| UiAutomator test for #114 | `UI-Program-Repair/Dataset/real-bug-test-cases.csv` |
| Mutant diff (GPSLogger mutant 17, NullIntent) | `UI-Program-Repair/Dataset/synthetic-bug-buggy-fixed-code.csv` |
| D4C and OpenHands patches for `tripExists` | `UI-Program-Repair/GeneratedPatches/{D4C,OpenHands}/*-real-bugs.csv` |

## 5. Build order

1. `talk.js` and light theme, checkpoint and presenter logic, QA script that screenshots every checkpoint.
2. Shared objects: the drawn line, the phone mock with layer explosion, the Harmonic comments mock,
   the code panel with typed diffs, the particle funnel, the square-pour bar chart, the terminal.
3. Chapters 1 to 3 (the opening is where the style is set; review this before the rest).
4. Chapters 4 to 7.
5. Chapter 8.
6. Timing pass with the notes, then a full headless render of all checkpoints.

## 6. Decisions needed

1. Background: light for the ISSTA story and dark only for "One more thing" (recommended), or dark
   throughout like the films.
2. Checkpoint behavior: play to the next checkpoint and hold (recommended), or every beat waits
   for a key like the current deck.
3. Phones: HTML mocks that can be animated (recommended), with the real screenshots used once, or
   screenshots throughout.
4. The 32 checkpoints above, or fewer holds with longer continuous runs.
