# Storyboard (PLAN.md) template

Write PLAN.md before building and after reading the paper and the package. It is the contract with Kevin: he approves the beats, you implement them. Keep it updated when holds are added or removed; the README's hold count should match.

Every hold in the storyboard becomes one **beat** in the talk folder, so give each chapter and each hold a short id while storyboarding (letters, digits, `-`, `_`; no dots). The mapping is mechanical (see "From storyboard to spine" below), and Kevin can then refer to a hold by its number, its label, or its id.

```markdown
# <Venue year> talk · <paper short title>

## Inputs
- Paper: <path to .tex or .pdf>, <N> pages, accepted at <venue>, presented <date>, <city>.
- Replication package: <path or URL>, with <datasets / patches / logs / prompts>.
- Presenter(s): <name(s)>; co-presenter <name> gets bold on the title and a recruiting slide (if applicable).
- Time: <N> min + <Q&A>. Target: <M> min of motion across <H> holds.
- Constraints: <things not to name, e.g. venue of a follow-up; data that is embargoed>.

## Arc
<One paragraph: the story in his voice, from the opening image to the close.>

## Chapters and holds
Times are motion time only (talking happens at the holds). Data sources in brackets.

### Chapter 1. <name> `<chapter-id>` (0:00 to 0:27)
1. **<hold label>** `<chapter-id>.<beat-id>` (<motion s>) — hero: <object>. Words: "<headline>" / "<sub>". Motion: <what arrives, transforms, leaves>. [<source file or table>]
2. ...

### Chapter 2. ...

## Holds by chapter
| Chapter | id | Holds | Motion | Dark / private / backup |
|---|---|---|---|---|

## Assets to produce
- Device mock of <app> (<screens>), from <screenshots or the app's source colors>.
- Logos: <affiliations>. Headshots: <authors>.
- QR codes: paper, slides, package (generated at publish time).

## Open questions for Kevin
- ...
```

## Budget

- 15 min talk: 30 to 55 holds, 6 to 8 min of motion. Holds average 5 s of motion; builds are 2 s per element.
- 25 to 30 min talk: 55 to 80 holds.
- A keynote or job talk: chapters per project, each with its own "one bug" beat; 80 to 120 holds.
- Backups: 5 to 10 holds after the close, anything a questioner might ask for (per-bug detail, trajectory replay, failure taxonomy, timing, threats).

## Reading the paper into beats

- Introduction's first paragraph → the opening image (a line, a world, a device).
- The gap sentence ("no benchmark exists for…") → the question-mark beat.
- Methodology figure → a station build (one click per step), with the real artifact at each step.
- Each RQ → one chart hold, then a hold that states the number alone.
- Discussion / implications → four cards and a summary.
- Threats and details → backups.
- Follow-up or ongoing work → "One more thing" dark chapter, two panes maximum in the main flow (setup, outcome), everything else backup.

## Mining the replication package

Before writing numbers into the storyboard, compute them from the package and keep the command in PLAN.md (for example a short `node -e` over `derived/outcomes.csv`; Python here is 3.6 without pandas). Prefer the exact figures in the paper when both exist, and flag a discrepancy to Kevin rather than silently choosing. Pull real artifacts for the deck: the bug report text, the test script, the patch diff, the trajectory lines, the prompt. Trim them to what fits in a 1,040 px pane at 20 px mono, never paraphrase code. In the motion file, keep the source path in a comment next to the data (`B.count('#n41', 3.0, 2.1, 41); // derived/outcomes.csv, synthetic, plausible+correct`).

## From storyboard to spine

| Storyboard | Talk folder |
|---|---|
| Chapter `<name>` `<chapter-id>` | a `chapters[]` entry `{ "id", "label": "<name>", "scene": "scenes/<chapter-id>.html" }`; its motion goes in `beats/<chapter-id>.js` |
| Hold *n* **<label>** `<chapter-id>.<beat-id>` | a `beats[]` entry `{ "id": "<beat-id>", "label": "<label>", "notes": "…", "hold": <s> }` and one `Talk.beat('<chapter-id>.<beat-id>', (B) => { … })` |
| Motion time of the hold | the beat's motion, at times relative to the beat start (= the previous hold); the hold is that motion time plus Kevin's slack (start with 0.5 to 1.0 s) |
| Words on screen | elements with ids in the chapter's scene, `data-a` if they animate in |
| Data source in brackets | a comment next to the number or data array in the motion or lib file |
| "One more thing" chapter | `"dark": true, "private": true`; the black is a `#black` scene the first beat fades in |
| Close, recruiting slide | beats of the private dark chapter |
| Backups | a chapter with `"backup": true, "private": true` (and `"dark"` if they stay on black); no scene needed if its DOM lives in the dark scene |
| Public end card | the spine's `"public"` block, its own scene and motion file |
| A persistent object (the device, the line) | `scenes/layers.html`, declared as `"layers"` |
| A pattern repeated across beats (a station, a tap on the device) | a helper in `lib/`, starting from `assets/lib-starter/` |

Hold numbers are positional and change when beats are added; ids do not. When Kevin asks for
"slide 39", map it with `talkc layout` (or `talk_layout` in the app) and name the beat id in
your reply.
