# ISSTA 2026 talk — Automated Program Repair of UI-centric Android Bugs

A single continuous film with checkpoints, built on the publications-film engine (`talk.js`, a fork of
`film.js`). Open `index.html` in Chrome or Safari (double-click, no server needed). Press `F` for fullscreen.

Keys
- `Space` / `→`: play to the next checkpoint and hold (press again while playing to skip ahead to it)
- `←`: back to the previous checkpoint
- `Enter`: play straight through without holding (rehearsal)
- `N`: open the presenter window (notes, talk clock, mirrored frame); keys work from either window
- `T`: reset the talk clock · `H`: hide the scrub bar · `Home` / `End`
- Click: right 88% of the picture = next, left 12% = back

URL parameters
- `?cp=7` opens holding at checkpoint 7 · `?t=61.5` holds at a time · `&capture` hides the controls

Files
- `index.html` — the film (scenes + script with absolute times and checkpoints)
- `talk.js`, `talk.css` — engine and light theme · `assets/` — screenshots, logos, Manrope font
- `PLAN.md` — the storyboard this is built from · `slides-v1.html` — the earlier slide deck, kept for reference

Status: all eight chapters are built. 53 main holds (the last is the Sparsh recruiting slide) plus 8 backup holds after it (press space past the end to reach them). The storyboard is in PLAN.md.

Editing text
- Press `E` on any hold. Visible text gets a dashed outline; click into it and type. `Esc` leaves edit mode.
- To save edits in place, open the deck through the local server: double-click `Edit talk.command` (or run
  `python3 serve.py`) and the deck opens at http://localhost:8765/. `⌘S` (or the Save button) then writes the
  edits straight into `index.html` with no dialog, keeping the previous file as `index.html.bak`. Works in any browser.
- Opened directly from disk (file://), Chrome does not let a page write files, so `⌘S` can only offer a download;
  if you end up there, replace `talk/index.html` with the downloaded file.
- Presenter notes: in the presenter window (`N`), click the notes text and type. Save from the main window.
- Edits are stored as overrides in the `text-overrides` JSON block at the bottom of `index.html`, keyed by the
  element's position, so the slide markup itself is untouched. An unsaved draft also lives in the browser's
  localStorage until a save succeeds; "Discard draft" throws it away.
- `?edit` in the URL opens in edit mode. Editing changes text only; layout and timing stay in the file.
