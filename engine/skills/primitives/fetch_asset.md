# fetch_asset — fetch, rasterize, and strip a real external still

Pulls a real external still (brand logo, speaker headshot, book cover, product photo) from
a URL or CDN, converts SVG to PNG where needed, strips the background to clean RGBA, and
deposits a render-ready asset in the job's `images/` directory. Folds in: the WebSearch +
WebFetch + curl workaround that located Gates Foundation / HP / NASA logo PNGs in session
88ca2208 (SVG-to-PNG rasterization via rsvg-convert + cairosvg all ERR'd; resolved by
fetching Wikipedia auto-generated PNG thumbnails); the Humeo SVG logo fetch + bg-strip
chain in session 4a016c4a; the Alissa headshot + book-cover fetch in session cee518a4
(WebFetch for Sylvia Ann Hewlett cover errored → resolved via direct CDN curl); the
Dream2Inspire logo placement in session e00ee210; and the anti-pattern from session
371a0e39, where the absence of this tool forced `generate_image.py` to hallucinate real
institution logos (Harvard, Stanford) on a magenta background for colorkeying — a
counterfeit that this tool exists to prevent. The boundary is sharp: `fetch_asset` only
fetches and prepares **real** assets that must not be faked; generation of any still belongs
to `mint_image`; video acquisition belongs to `pull_video`.

```
fetch_asset --job <job> --type {logo | headshot | cover | generic} --name <name> \
            --url <source_url_or_svg_url> \
            [--strip-bg] \
            [--width <px>] \
            [--format {png|webp}]
```

`--type` is **required** and logged as `usage_role`. `--job` is always passed (MEMORY:
concurrent jobs clobber `.current_job`; every pipeline tool must include `--job`
explicitly). `--strip-bg` is **ON by default** for `logo` and `cover`; **OFF by default**
for `headshot` and `generic` (headshots need the background for compositing context unless
the caller opts in).

---

## `logo` — brand or institution logo

- **purpose:** download the real logo of a brand, institution, or sponsor and prepare it as
  a clean RGBA PNG for overlay compositing (badge, lower-third, stat card).
- **use_when:** the video references a real brand and the logo must be the authentic mark —
  any generative approximation would be an AI-tell and is forbidden here. Canonical examples:
  Humeo logo (4a016c4a), Gates Foundation / HP / NASA (88ca2208), DREAM2INSPIRE (e00ee210),
  Harvard / Stanford referenced in Protocol School segment (371a0e39 — this tool's founding
  anti-pattern).
- **do_not_use_when:** it's a **fictional** or brand-agnostic icon (→ `mint_image --role overlay`);
  the client has supplied the logo file locally (just copy it into `images/` directly).
- **inputs:** `--url` pointing to the official SVG, PNG, or CDN thumbnail; `--name` for the
  output stem (e.g. `logo_humeo`).
- **outputs:** `<job_dir>/images/<name>.png` — RGBA PNG with background stripped, ready for
  Remotion compositing.
- **success_check:** Read the PNG in-chat (MEMORY: always render generated images inline);
  edges clean with no fringe; mark transparent; legible at overlay size (typically 80–120 px
  tall in a 1080p frame).
- **backend:** curl/requests download → cairosvg for SVG → rsvg-convert fallback →
  PIL/rembg for background strip. If CDN blocks the primary URL, WebSearch for
  `site:wikipedia.org <brand> logo` to hit the auto-generated PNG thumbnails (88ca2208
  resolution path).
- **fallback:** SVG rasterization ERR (rsvg-convert / cairosvg missing) → fetch the
  Wikipedia Commons auto-PNG at target width via `?width=<px>` query param (proven in
  88ca2208). If strip-bg produces fringe artifacts → re-strip with a tighter alpha threshold,
  or deliver on a transparent solid if the logo has a defined bounding color.
- **evidence:** 88ca2208 ("WebSearch + WebFetch to locate Gates Foundation, HP, NASA logo
  PNGs; SVG-to-PNG conversion failed [ERR]; resolved by fetching Wikipedia PNG thumbnails
  via curl"); 4a016c4a ("fetched Humeo SVG logo, stripped background"); e00ee210 (Dream2Inspire
  logo placed in overlays); 371a0e39 (generate_image.py hallucinated Harvard / Stanford
  crests — the founding reason for this tool).

---

## `headshot` — real speaker or author photo

- **purpose:** retrieve an authentic photograph of a real person (client headshot, co-cited
  author, book subject) for use in a card, lower-third, or reference overlay. The person's
  real face must appear — a generated approximation is an AI-tell and is not acceptable.
- **use_when:** the script names a real person whose photo should appear on screen: the
  client's own headshot URL, an author photo from a publisher CDN, a co-cited expert.
  Session cee518a4: Alissa headshot + Sylvia Ann Hewlett reference photo.
- **do_not_use_when:** you need a **synthetic** speaker identity (→ `cast_avatar`); you need
  a styled portrait of the real host from a reference photo (→ `mint_image --role portrait`).
- **inputs:** `--url` to the headshot (LinkedIn, publisher site, client-supplied CDN link);
  `--name`; `--strip-bg` only if you want a cutout for compositing on a card background.
- **outputs:** `<job_dir>/images/<name>.png`.
- **success_check:** Read the image in-chat; confirm identity matches the person named in
  the script; confirm no compression artifacts that would read as low-quality on screen.
- **backend:** curl/requests download + optional PIL crop/resize to target aspect; rembg
  bg-strip only when `--strip-bg` explicitly set.
- **fallback:** 404 / auth-wall → try WebSearch for `"<person name>" headshot site:<publisher>.com`
  or official press kit URL; cee518a4: Sylvia Ann Hewlett book image WebFetch errored →
  resolved by hitting the CDN URL directly with curl.
- **evidence:** cee518a4 ("WebFetch for Sylvia Ann Hewlett book cover image errored;
  workaround via curl to CDN URLs"; "Real images sourced: Alissa headshot, book cover").

---

## `cover` — book cover or product art

- **purpose:** fetch the canonical cover image of a book, product, or course for display in
  a book-recommendation card, proof receipt, or B-roll insert. Must be the real cover —
  never generated.
- **use_when:** the script references a real book or product by title and author (→ show the
  real cover). Session cee518a4: Sylvia Ann Hewlett book cover.
- **do_not_use_when:** you want a **card** designed around a book (→ `mint_image --role card`);
  the book is fictional / no cover exists.
- **inputs:** `--url` to the cover image (Amazon CDN, publisher, Open Library, Google Books
  thumbnail API); `--name`; `--strip-bg` OFF by default (keep the full cover rectangle).
- **outputs:** `<job_dir>/images/<name>.png`.
- **success_check:** Read in-chat; confirm correct edition; confirm no watermarks or
  "preview" overlays in the frame area that will be visible.
- **backend:** curl/requests download; optional PIL resize to 2:3 aspect for card
  compositing.
- **fallback:** high-res CDN blocks → fall back to Google Books `?fife=w400` thumbnail;
  Open Library cover API `https://covers.openlibrary.org/b/isbn/<ISBN>-L.jpg` as universal
  fallback.
- **evidence:** cee518a4 ("WebFetch for Sylvia Ann Hewlett book cover image errored;
  workaround via curl to CDN URLs").

---

## `generic` — any other external still

- **purpose:** fetch any other real external still that is not a logo, headshot, or book
  cover — product photo, screenshot, map tile, archival image — and deposit it job-scoped.
- **use_when:** you have a URL to a real image that must appear as-is (not generated, not
  video). Use this as the catch-all when no other `--type` fits.
- **do_not_use_when:** it's a logo (→ `logo`); it's a person's photo (→ `headshot`); it's
  a book cover (→ `cover`); it should be generated (→ `mint_image`).
- **inputs:** `--url`; `--name`; `--strip-bg` defaults OFF.
- **success_check:** file present in `images/`; Read in-chat confirms it's the expected asset.
- **backend:** curl/requests; optional PIL resize/crop.
- **fallback:** same CDN-fallback ladder as `logo`.
- **evidence:** generic class exists to prevent the ad-hoc curl-in-bash pattern seen across
  all five founding sessions (4a016c4a, 88ca2208, e00ee210, cee518a4, 371a0e39).

---

## NOT this tool

- `mint_image` — **generates** a new still from a prompt (icons, cards, illustrations,
  artistic B-roll). If the asset can be invented, use `mint_image`. If it must be real
  (a real brand's logo, a real person's face, a real book's cover), use `fetch_asset`.
- `pull_video` — pulls **video** (yt-dlp / local files). Stills are `fetch_asset`;
  video clips are `pull_video`.
- `cast_avatar` — builds a **synthetic** speaker identity from scratch. If you need a real
  person's photo, use `fetch_asset --type headshot`.
- Manual `curl` / `wget` / `WebFetch` in bash — the ad-hoc pattern across five founding
  sessions that `fetch_asset` replaces: inline curl calls have no `--job` scoping, no
  automatic bg-strip, no SVG rasterization fallback ladder, and no `usage_role` log entry.
