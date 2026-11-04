# Style: how Kevin's talk films look, move, and read

## Principles

1. **One hero per beat.** A line, a phone, a block of code, a number, a chart. It arrives, the words arrive beside it, the words leave, the hero transforms into the next beat. Never two competing objects.
2. **One idea per click.** A hold is where he talks. If a segment contains two things he would explain separately, it is two holds. Builds (five steps, five tools, four implications) are one click per element, and nothing of element k+1 moves before the hold on element k.
3. **Objects persist.** The phone that showed the bug stays and runs the test. The code pane that showed the original line mutates in place. Scenes change by transformation, not by cut.
4. **Light stage, dark surprise.** White background, ink type, one accent gradient (`--a1` blue to `--a2` purple) for the question or the headline number. The "One more thing" chapter goes black and stays dark to the end, like a change of film stock.
5. **Real things.** The bug report is the real report. The test is the real UiAutomator script. The patch is the real diff. The counts come from the CSVs. Mocked UI is drawn to look like the real app (same colors, same strings) rather than a generic placeholder.
6. **Say the fact.** Headlines are claims in his voice. No jokes as titles, no "Agenda", no bullet lists, no paragraphs. Captions are one sentence.

## Type scale (talk.css)

- `.eyebrow` 28px caps, `--ink-3`: chapter label at the top-left of a pane ("BUILDING DROIDFIXBENCH", "RESULTS", "ONGOING WORK").
- `.h-xl` 124px: title, the "How far are we?" close, the "One more thing." typed line. Use `.grad` for the gradient subtitle.
- `.h-l` 92px: pane headline ("How a real bug is built", "Patch evaluation methodology").
- `.h-m` 62px (often set to 48px inline) for chart titles ("Effectiveness on real bugs").
- `.sub` for one- or two-line explanations; `.cap` for small captions; `.mono` for identifiers, URLs, emails; `.stat-num` for big numbers (96 to 150px) with a smaller `/46` suffix in `--ink-3`.
- Emphasis inside a headline: `<span class="ul">` (thick accent underline), `<b>` for names in subtitles.
- Descenders: display type that blurs in needs the padding guard already in talk.css; do not add `overflow:hidden` to headline containers.

## Components already in talk.css

`.panel` and `.report` (cards with a header dot), `.chip` / `.chip.solid`, `.code` with `.ln`, `.ln.add/.del/.hl/.new`, `.k` `.s` `.cm` token colors, `.device` + `.screen` + `.notch` inside a `.rig` (with `.tilt` and exploded `.lay` layers), `.touch` finger ring, `.tile` (benchmark cards), `.stn` (station tiles with `.k` number, `.t` title, `.micro` illustration, `.d` caption), `.brow` (stacked bar row with `.seg` segments), `.grid46`/`.dots50` (dot grids), `.tile-big` (stat tiles), `.pcard` (patch card with tag, code, tests, why), `.impl` (implication cards), `.term` (terminal replay), `.hmg` (heat-map grid), `.ftree` (file tree), `.toolcard`, `.agents`/`.agent`, `.qrtile`, `.faces` (round author headshots), `.verdict`, `.badge`, `.legend`. Per-talk CSS goes in the talk's `theme.css`, not in talk.css.

## Beat patterns (with timings that felt right)

**Title.** Eyebrow in (0.3), title word by word (`B.words`, stagger 0.09), gradient subtitle in with blur (1.9), author faces pop in staggered (`scale:.6`, stagger 0.07), authors line, logos. First hold at ~5 s. A timeline stroke may already start drawing under the title so the first chapter grows out of it.

**A line through history.** An SVG path drawn with `B.draw` across a `.world` layer that the "camera" pans (`transform: translateX`), milestones fading in beside it (`.ms` with year, name, one-line description), benchmark tiles blurring in. The line ends in a question mark drawn as a path.

**Inside the phone.** The device rig scales up, the screen explodes into labelled layers (`.lay.wire`, `.lay.listen`, `.lay.state`, `.lay.life`) at 0.16 alpha, each layer brought to full opacity for its own hold while the others dim, then collapses back.

**One bug, end to end.** Real report excerpt (`.report` card with Expected/Observed), the mock app on the device reproduces it (scroll, long-press with `press()`, menu that should appear does not), the fix as a diff (`.ln.del` struck through, `.ln.add` growing from height 0), "No tool fixed it" verdict.

**Station build.** Five `.stn` tiles 345 px apart; a bug chip slides along a track from tile to tile; one beat per tile (`B.lib.stations.station(B, k, s)`): the tile comes in at `s-0.5`, accent border at `s`, its micro animation (progress bars, check mark, highlighted lines, test pills, buggy/fixed marks) finishing by `s+1.3`, hold at `s+1.4`; the next beat starts there. A hold before the first tile shows only the sources and the empty track.

**Numbers.** `B.count` into a `.stat-num` over 1.3 s while a dot grid (`B.lib.dots.mkDots`, `pop`, `fill`) fills category by category (stagger 0.03 to 0.04 per dot); a legend and a small stats table fade in after.

**Charts.** Stacked horizontal `.brow` rows, one per tool, segments growing by width with the percentage labels inside; a dot grid at the right counting bugs fixed; the headline number lands last. One chart per hold; the gap between two charts is its own hold with the two big numbers side by side.

**Code and patches.** `.code` panes with 20px mono, per-line reveal via clip-path wipe (`tline`), `flash` on the line that matters, `.pcard` for a patch with a tag (correct / plausible / overfit), the diff, the test outcome pills, and a one-line "why".

**Implications.** Four `.impl` cards entering staggered, each with a number, a claim, one sentence, and a mini illustration; then a summary pane with the four big numbers and a `.report` package card plus `.qrtile` row.

**One more thing.** Fade `#black` to 1 over 0.9 s, type "One more thing." with a cursor, hold; then the dark setup pane (agents with logos, configurations, the 600-cell grid) and the heat-map outcome grid; back to light only for backups.

**Close.** `.h-xl` "How far are we?", two-line verdict, links block (package, DOI, contact emails, lab URL), QR tiles beside the title, affiliation logos in white.

**Recruiting slide.** A round headshot, eyebrow "One more one more thing", the student's name in `.h-xl`, two lines on who they are, the bold line about what they are looking for, an email. Private (stripped from the public build).

**Backups.** Title card "Backup", then each backup as its own hold with `backup=true`: agent trajectory replay in a `.term`, headline counters, per-bug patch tree, failure families, the test replay. Backups may re-show the light theme by fading `#black` out.

## Writing on slides

- No commas in any headline, card title, or hold label (Kevin's rule). Rewrite with "and", "on", "over", "but" or "for". Dates inside a milestone label are not titles and may keep theirs.
- Headline ≤ 6 words, verb optional, in his paper voice: "Fifteen years of automated program repair", "What a repair tool needs", "Synthetic bugs: Android mutants injected into real code."
- Subtitle ≤ 2 lines, concrete: "Three software engineering agents on the real bugs of DroidFixBench".
- Captions state the data source or the mechanism: "1,074 of 1,592. The tools reference things that do not exist in the project."
- Eyebrows are the chapter: BUILDING DROIDFIXBENCH · FIVE REPAIR TECHNIQUES · RESULTS · IMPLICATIONS · ONGOING WORK.
- Dataset, tool, app, and person names bold on first appearance. Co-presenter bold on the title and on the end card.
- Presenter notes (the third argument of `cp`) are what he will say, written as spoken sentences, 40 to 90 words, in first person plural.
- Never name the venue of unpublished or under-review work; say "a follow-up study" or "ongoing work". Never write "under review" on a slide.
- Spell out acronyms once (APR, GUI are fine; the benchmark's name is not).

## Motion vocabulary

Arrive: `B.in` with `y:14..26` and blur (default `out` easing, the expo settle). Marks and chips: `scale:.4, blur:0, ease:'spring'`. Leave: `B.out` upward with blur, stagger 0.03 to 0.05 across a group. Draw: `B.draw` for lines, rings, question marks. Count: 1.0 to 1.5 s. Type: 1.3 s with cursor for "One more thing.", 1.8 s for a code chip. Wipe: clip-path `inset(0 100% 0 0)` to `inset(0 0% 0 0)` in `steps(24)` for code lines. Camera: `.world` translateX over 1.4 s `inOut`. Device: `transform: translate(x,y) scale(s)` on `.rig`, 0.9 to 1.4 s `inOut`. A finger press is a ring that scales in, holds, scales out. Hold-to-hold motion is 3 to 8 s; longer than 10 s and he is waiting.
