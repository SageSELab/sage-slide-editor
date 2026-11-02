# Publishing a talk

## Public build

For a `sage-talk/1` talk folder (`talk.json`), use the SAGE talk editor's compiler:

```
talkc publish issta26.talk <slug>            # writes issta26.talk/build/public/<slug>.html
talkc shoot issta26.talk/build/public/<slug>.html --holds   # check the title autoplays and the end card renders
```

It cuts by the spine instead of comment markers: chapters flagged `private` and all backups
are dropped, the spine's `public` section supplies the end card, notes are stripped, and every
asset is inlined. It warns when a private label or a speaker note would ship. The rest of this
section describes the legacy path for hand-written single-file decks:

```
cd talk && python3 build-public.py <slug>      # legacy decks: writes public/<slug>.html
```

Before building, make sure the markers are placed (see legacy/engine-api-v1.md): private regions around the follow-up chapter, backups, and recruiting slide; a public end card inside `<!-- public:start … public:end -->` with the paper title, authors, links (code, archive, lab), and logos; `DURATION` with both values. Shoot the public file at its first hold and its last time to confirm the title autoplays and the end card renders:

```
bash <skill>/scripts/legacy/shoot.sh talk/public/<slug>.html 4.9 244.8
```

## Where it goes

Kevin's sites are two Astro repos that deploy on push to `main` via GitHub Actions:

- Personal site: `~/Dropbox/Documents/My_Faculty_Work/SAGE/Personal-Website` → kpmoran.com. Talks live in `public/talks/<slug>.html`; the talk is listed in `src/content/talks.yaml` and linked from the paper's entry in `src/content/publications.yaml` (`links: - label: "slides" url: "/talks/<slug>.html"`). PDFs live in `public/documents/`; link them as `- label: "pdf" url: "/documents/<file>.pdf"` and remove any "Preprint-Coming-Soon" placeholder on that entry.
- Lab site: `~/Dropbox/Documents/My_Faculty_Work/SAGE/SAGE-Lab-Website/sageselab.github.io` → sagelab.io. Copy the same file to `public/talks/<slug>.html`; the publication sync from the personal site does not carry `/talks/` files. Local builds need Node ≥ 22.12; CI builds with Node 24, so verify live with `curl -s -o /dev/null -w "%{http_code}" https://sagelab.io/talks/<slug>.html` after the Action finishes (`gh` is not authenticated on this machine).

Commit in each repo with a message file (`git commit -q -F msg.txt`) and push `origin main`. Commit the talk sources in the paper repo too.

## QR codes

Generate with the `qrcode` npm package in a scratch folder (Python has no qrcode module here):

```
mkdir -p /tmp/qr && cd /tmp/qr && npm init -y >/dev/null && npm install qrcode@1 --silent
node -e "const Q=require('qrcode'),fs=require('fs');
[['qr-paper','https://kpmoran.com/documents/<file>.pdf'],['qr-slides','https://kpmoran.com/talks/<slug>.html'],['qr-package','https://github.com/<org>/<repo>']]
.forEach(([n,u])=>Q.toString(u,{type:'svg',margin:0,errorCorrectionLevel:'M'}).then(s=>fs.writeFileSync(n+'.svg',s)))"
cp qr-*.svg <talk>/assets/
```

Place them as `.qrtile` rows: under the package card on the summary pane (140 px), and beside the title on the close (`.qrtile.dk`, 108 px, white tiles on black). Labels: Paper · Slides · Replication package. If the paper has no public PDF yet, host the camera-ready in `public/documents/` on the personal site and point the QR there; tell Kevin, since that publishes the PDF.

## Headshots

Pull from the lab site (`public/images/`), the personal site, co-authors' faculty or lab pages. Crop to 240 px squares with `sips`, save as `assets/faces/<first>.jpg`, show in a `.faces` row on the title in author order, with a `JW`-style initials placeholder (`<span class="ph">`) for anyone without a photo.

## README for the talk folder

Keys, URL parameters, file list, the talkc commands, and the hold count ("N main holds plus M backups"; `talkc layout`). Update the hold count whenever holds change.
