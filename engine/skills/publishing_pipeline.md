# Publish & Distribute — generic pipeline (brand-agnostic)

**The step that comes AFTER a video is rendered.** The video-production pipeline in `agent/CLAUDE.md` ends at a finished `.mp4`. **A finished video is not done — it has to be captioned, covered, scheduled, tracked, and (if it makes a promise) backed by a real deliverable.** This doc is the canonical, reusable workflow for that. It is NOT brand-specific — any creator/brand pipeline plugs into it by setting the config in §6.

> Reference implementation: **Joseph Chin** — see [`agent/josephchin/POSTING_PIPELINE.md`](../josephchin/POSTING_PIPELINE.md) for the live, configured instance (account IDs, slot times, current schedule, freebie pages).

---

## 0. The flow

```
finished render (.mp4)
  → caption.txt        (per concept; held constant across hook variants for a clean A/B)
  → make_cover.py      (video → Gemini frame pick → gpt-image-2 baked-text cover)
  → post_instagram.py  (upload video+cover → schedule Trial Reel via Publer → write ledger)
  → check_promotions.py (48h later: did it perform? promote the winner)
  └→ DELIVERABLE        (if the caption says "comment KEYWORD", a real asset + automation MUST exist — §5)
```

## 1. Tools (all in `agent/tools/`, brand-agnostic)

| Tool | What it does |
|---|---|
| `make_cover.py suggest --video <mp4> --name <slot>` | Gemini proposes strong base frames; extracts them. Read them, pick one. (Gemini 504s sometimes → ffmpeg-extract frames yourself and pick.) |
| `make_cover.py generate --base-frame <png> --name <slot> --variants 2 --prompt "<detailed>"` | gpt-image-2 builds a designed cover with **baked-in text** (it renders text cleanly — give the exact headline in quotes + "no garbled letters"). Writes `<slot>_v{1,2}.png` (2:3) + `_reel.png` (1080×1920 blur-padded). |
| `post_instagram.py --concept <label> --video <mp4> --cover <png> --caption-file <txt> [--keyword X] --at "YYYY-MM-DD HH:MM" [--no-trial]` | Uploads media (as `video/mp4` — mime matters), schedules a **Trial Reel** (`trial_reel: MANUAL`, non-followers only) via Publer, appends a ledger entry with `promote_check_due_at = +48h`. `--slot midday\|evening` for next-occurrence convenience. |
| `check_promotions.py [--all] [--promote <concept>] [--kill <concept>] [--notify]` | Reports trial reels past their 48h window + pulls reach/saves from Publer analytics. Promoting a trial reel itself is a manual IG-app action (no organic API); this records the decision. `--notify` fires a macOS notification (for cron). |

## 2. Cover doctrine
Hand-drawn-doodle or whatever the brand's style is; the constant: **one bold headline that mirrors the hook + ONE central metaphor doodle + the creator's engaged face**. gpt-image-2 maxes at **2:3** (no 9:16) — generate at 2:3, the tool blur-pads to a 1080×1920 `_reel.png`. Reuse the reel's own cover frame as a poster on the deliverable page to tie the loop.

## 3. Trial-Reel A/B strategy
Each concept can have N hook variants (same body video, different spoken first line). Post all variants as **Trial Reels** (shown only to non-followers), **same time-of-day on consecutive days**, **caption + cover held constant** so the hook is the only variable. After ~48h, **promote the winning hook** to the grid; let losers die in trial. This A/B's the hook on cold audience without spamming followers or cluttering the grid, and spacing a day apart reduces IG duplicate-content damping.

## 4. The ledger (local source of truth) — ONE PER BRAND
`post_instagram.py` appends every scheduled post to a JSON ledger with: concept, **account** (the Publer IG account id it posted to), video, cover, caption, keyword, `scheduled_at`, `promote_check_due_at` (+48h), publer job/media ids, status (`scheduled → live → promoted | killed`). `check_promotions.py` reads it.

**Never share one ledger across brands** — it tangles the promote tracker and risks cross-posting. Each brand gets its own:
- `post_instagram.py --account <ig_account_id> --ledger agent/<brand>/posting_ledger.json …`
- `check_promotions.py --ledger agent/<brand>/posting_ledger.json` (account is read from each entry; override with `--account`).
- Defaults: `--account` → `$PUBLER_IG_ACCOUNT_ID`, `--ledger` → `$PUBLER_LEDGER`, both falling back to josephchin's. So josephchin runs flag-free; every OTHER brand MUST pass `--account` + `--ledger`.
- Reference ledgers in this repo: `agent/josephchin/`, `agent/docworker/`, `agent/medigirlie/` — one each.

**Promote decisions are a hook A/B, not an absolute bar.** Trial reels are shown to a *capped non-follower pool*, so their reach is NOT comparable to normal-post averages. `check_promotions.py` compares a concept's hook variants *to each other* and only calls a winner once **all** hooks of that concept have had their full 48h. Run it daily (cron / launchd) so decisions never slip.

## 5. Deliverables rule — NEVER promise what you can't deliver
**A caption may only contain `Comment "KEYWORD"` if BOTH exist:** (1) a real asset to send (a page/guide/tool list/template — host it somewhere always-on), and (2) an automation wired to send it (e.g. a ManyChat IG comment→DM keyword trigger — built in the ManyChat UI; the API can't create the trigger). Empty promises burn trust.
- **Make deliverables genuinely valuable** (curated + verified video embeds, GitHub repo cards with live stars, real links) — viewers are suspicious of obviously-auto-generated pages. **Verify every embedded URL resolves** (YouTube via oEmbed, GitHub via API, links via HTTP status) before shipping — a dead embed looks *more* AI, not less.
- A non-keyword "save this / follow" CTA needs no deliverable.

## 6. Per-brand CONFIG (what each pipeline sets)
To use this pipeline for a new brand, set:
- **`.env`** (repo root, gitignored): `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`, `PUBLER_IG_ACCOUNT_ID`. (ManyChat: `MANYCHAT_API_KEY` for send/verify; the comment trigger is built in the UI.)
- **Slot times** — convert the target audience's peak hours to the poster's local tz (e.g. for US audiences from Malaysia: `00:00 MY ≈ 12pm ET`, `08:00 MY ≈ 8pm ET`). Posting on the *audience's* time is the lever that shifts reach.
- **Ledger path + IG account** — per-brand, ALWAYS. Every `post_instagram.py` / `check_promotions.py` call for a non-default brand passes `--account <publer_ig_account_id> --ledger agent/<brand>/posting_ledger.json` (or sets `$PUBLER_IG_ACCOUNT_ID` + `$PUBLER_LEDGER`). One ledger + one IG account id per brand — never shared.
- **Deliverable host** — where freebie pages live (a Next.js/Vercel site, etc.) + the email-capture backend if used. Watch free-tier DB auto-pause (keep-warm cron).
- **Caption formula** — the brand's voice (read the brand's own top-performing captions).

## 7. Tools verified against live APIs (Publer)
- Publer auth: header `Authorization: Bearer-API <key>` + `Publer-Workspace-Id: <id>`. Posting is **async** (POST `/posts/schedule` → `job_id` → poll `GET /job_status/{job_id}`). Media: `POST /media` multipart (returns `id` synchronously; ≤200MB). Analytics: `GET /analytics/{account_id}/post_insights?from=&to=` + `/best_times`.
- Works with `ig_business` accounts even when Publer shows `instagram_api: false`.
