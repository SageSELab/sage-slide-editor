# Themes (`sage-theme/1`)

A theme is the look of a whole talk: the colors of the light slides and of the dark passage,
the three font roles, and the type scale. Applying one restyles every slide at once, because
the slides are written against the engine's tokens (`var(--ink)`, `var(--display)`, the `.h-*`
classes), never against literal colors and font names.

Use a theme when Kevin asks for a different look, a venue or lab style, brighter or calmer
colors, or other fonts for the talk. Use per-element CSS in the talk's own `theme.css` only for
one object. Do not hand-edit the generated blocks at the top of `theme.css`; apply a theme.

## In the SAGE app

The app's talk tools do the work (they validate, download fonts and rebuild):

- `talk_theme_list` — the library (built-in and Kevin's themes) and the talk's current look.
- `talk_theme_apply {theme}` — by id, name, or the path of a `.talktheme`.
- `talk_theme_create {theme, apply?}` — validates a `theme.json` object, downloads its Google
  fonts, saves it to Kevin's library (`~/Library/Application Support/SAGE Talk/Themes`) and
  applies it. Invalid themes come back as a list of `field: problem` lines; fix and call again.
- `talk_fonts_search {query, category?}` and `talk_fonts_add {id, weights?, styles?}` — one
  Google font for a single element; it returns the `font-family` value to use.

After applying, look at one light beat and one dark beat with `talk_frame`: titles that now wrap,
inline `color:#fff` that no longer suits the dark background, and hard-coded panel colors in the
talk's own CSS are the usual leftovers.

Built-in themes (`assets/themes/`): **SAGE** (the default look; identical to a talk without a
theme), **Paper** (warm cream, Fraunces serif headings), **High Contrast** (black on white,
Inter and Atkinson Hyperlegible, for bright rooms and weak projectors), **Slate** (cool blue-grey,
Space Grotesk and IBM Plex, navy dark passage).

## theme.json

```json
{
  "format": "sage-theme/1",
  "id": "tide",                      // lowercase letters, digits, "-"; the file is <id>.talktheme
  "name": "Tide",
  "description": "One sentence: the feel, the fonts, the dark passage.",
  "light": {                          // the slides
    "bg": "#f7f5f0", "ink": "#0d2b2b", "ink2": "#355454", "ink3": "#6b8585",
    "line": "rgba(13, 43, 43, 0.14)", "panel": "rgba(13, 43, 43, 0.04)",
    "accent1": "#0f766e", "accent2": "#b45309", "accent3": "#be123c",
    "tokens": { "correct": "#1f8a4c" }   // optional: any other custom property, without "--"
  },
  "dark": {                           // the dark passage (".dk" scenes and the #black backdrop)
    "bg": "#041414", "ink": "#ecf5f3", "ink2": "#9fbab6", "ink3": "#5f7d79",
    "line": "rgba(236, 245, 243, 0.14)", "panel": "rgba(236, 245, 243, 0.06)",
    "accent1": "#2dd4bf"              // accents optional; missing ones are the light ones
  },
  "fonts": {
    "display": { "family": "Lora", "fallback": "Georgia, serif", "source": "google", "id": "lora", "weights": [600, 700] },
    "body":    { "family": "Inter", "fallback": "system-ui, sans-serif", "source": "google", "id": "inter", "weights": [400, 500, 600] },
    "mono":    { "family": "Menlo", "fallback": "ui-monospace, monospace", "source": "system" }
  },
  "type": {                           // optional; these are talk.css's values
    "xl": 124, "l": 92, "m": 62, "s": 40, "sub": 34, "cap": 26, "eyebrow": 28,
    "headingWeight": 700, "headingTracking": 1
  },
  "css": ".code { background: #fbfaf6; }"   // optional extra rules for what tokens do not reach
}
```

(The comments are for this page; theme.json is plain JSON.)

- **Tokens.** `bg` → `--bg`, `ink`/`ink2`/`ink3` → `--ink`/`--ink-2`/`--ink-3` (text, secondary,
  captions), `line` → `--line` (borders), `panel` → `--panel` (card fill), `accent1..3` →
  `--a1..--a3` (the `.grad` gradient uses a1 and a2; `.glow` uses a1). Values are CSS colors.
- **Fonts.** `display` is headings, eyebrows, chips and big numbers (`--display`); `body` is
  running text (`--text`); `mono` is code panes and paths (`--mono`). `source`: `google` (embedded
  from the Google Fonts catalog; give the Fontsource `id` from `talk_fonts_search` and the weights
  the slides use: display needs `headingWeight`, body 400 to 600, mono 400 and 600), `system`
  (installed fonts, not embedded: only safe for the Apple system fonts and Menlo), or `engine`
  (Manrope, which talk.css embeds). Embedded fonts travel with the talk and the published file.
- **Type.** Sizes in px for `.h-xl`, `.h-l`, `.h-m`, `.h-s`, `.sub`, `.cap`, `.eyebrow`;
  `headingWeight` for headings and `.stat-num`; `headingTracking` multiplies the headings'
  negative letter-spacing (serif and wide faces want 0.3 to 0.7; Manrope 1). Inline sizes in a
  scene still win.

## Choosing a theme from a description

- Start from the built-in closest to the request and change what was asked; keep `ink2`/`ink3`
  as steps from `ink` toward `bg`, and `line`/`panel` as the ink at about 12 % and 4 % alpha.
- Contrast: body text (`ink`, `ink2`) at least 7:1 against `bg`, captions (`ink3`) at least
  4.5:1; the dark passage the same against `dark.bg`. Projectors wash out light greys and thin
  weights; prefer weight 500+ for body text in the dark passage.
- One accent does the work (`accent1`: highlights, the count-up numbers, links); `accent2` pairs
  with it in gradients; `accent3` is for warnings and the "no" side.
- Two families at most (display and body), plus mono. Pair a characterful display face with a
  plain body face. Check the family has the weights you list (`talk_fonts_search` shows them).
- Name it for the feel ("Paper", "Slate"), and say in `description` what it looks like.

## How it works

A `.talktheme` is a folder: `theme.json`, a generated `theme.css`, and `fonts/*.woff2`. Applying
it copies the fonts to the talk's assets/fonts folder and writes two marked blocks at the top of
the talk's `theme.css`:

```css
/* sage-fonts:begin ... */  @font-face rules for assets/fonts/*.woff2   /* sage-fonts:end */
/* sage-theme:begin {"id":"tide","name":"Tide"} */
:root { --bg: ...; --display: Lora, Georgia, serif; --t-xl: 124px; ... }
.dk { --bg: ...; ... }
#black { background: #041414 !important; }
/* sage-theme:end */
...the talk's own rules (they still win over the blocks)
```

talk.css defines the defaults; a talk without the blocks looks exactly as it always has.
Outside the app, `bash <skill>/scripts/talkc.sh theme talk/ <skill>/assets/themes/paper.talktheme` applies a
package the same way (it does not download fonts: the package must hold them, as the built-ins
and every theme saved by the app do). To make a new one there, copy a built-in package, edit its
`theme.json`, and keep to fonts already in it or `source: "system"`.
