# Storyboard (PLAN.md) template

Write PLAN.md before building and after reading the paper and the package. It is the contract with Kevin: he approves the beats, you implement them. Keep it updated when holds are added or removed; the README's hold count should match.

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

### Chapter 1. <name> (0:00 to 0:27)
1. **<hold label>** (<motion s>) — hero: <object>. Words: "<headline>" / "<sub>". Motion: <what arrives, transforms, leaves>. [<source file or table>]
2. ...

### Chapter 2. ...

## Holds by chapter
| Chapter | Holds | Motion | Notes |
|---|---|---|---|

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

Before writing numbers into the storyboard, compute them from the package and keep the command in PLAN.md (for example: `python3 - <<EOF ... pandas.read_csv('derived/outcomes.csv') ... EOF`). Prefer the exact figures in the paper when both exist, and flag a discrepancy to Kevin rather than silently choosing. Pull real artifacts for the deck: the bug report text, the test script, the patch diff, the trajectory lines, the prompt. Trim them to what fits in a 1,040 px pane at 20 px mono, never paraphrase code.
