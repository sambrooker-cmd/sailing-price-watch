# Sailing Price Watch — handoff for Claude Code

Owner: Sam (Digital Acquisition Lead, Ambassador Cruise Line). Prepared 12 Oct 2026 in a Claude (Cowork) session.

## Goal
Move the daily sailing price checker off a Claude scheduled task and onto **GitHub Actions in this repo**, so the
mechanical work (fetch → compare → save → render cards) runs as plain code every morning, with no AI in the loop.
Claude is only (optionally) brought in for judgement work later.

Why: the scheduled task kept failing. Its safety check blocked running scripts downloaded from the tracker artifact,
and runs sometimes reported "succeeded" while saving nothing (10 and 11 Oct were lost). On 12 Oct a test run also ignored
a "don't write anything" instruction and saved a second run for the day. Deterministic code removes all of that.

## Current scope (12 Oct 2026)
Sam asked to start with **price tracking only**. Card rendering is paused: the workflow runs `daily.py --no-cards`
and no longer installs Playwright. New was/now claims still open a GitHub issue, as information only. Don't turn
cards back on, or add any Meta/ads step, until Sam asks.

## Hard rules (do not change without Sam)
- **Never touch Meta, Google Ads or any ad account.** This system only records prices and renders cards for Sam to approve.
- **Was prices only ever come from `run.json`** (`eligible` / `cabin_eligible`, produced by `tracker.py`). Never compute
  or invent one anywhere else. UK reference-pricing rules apply. The rules live in `tracker.py` (`RULES`, `claim_for`):
  28 days held before a drop, claim runs at most 28 days (and never longer than the reference was held), min £10 saving,
  skip sailings departing within 7 days, like-for-like cabin grade only.
- Lead drops marked `"mix"` are a cheaper cabin grade coming on sale, **not** a price cut. Never present them as reductions.
- Only claims whose `since` equals today are "new" and get cards.
- Was/now card style (chosen by Sam on 9 Oct 2026, matches fly-cruise carousel C277) is implemented in
  `render_cards.py` `price_reduction_html`. Cards rendered without `--was` keep the standard style. Don't restyle.
- Card checks Sam wants: sailing name at most two lines, price fits inside the sticker, and on 9x16 the logo, sticker and
  panel sit clear of the top 14% and bottom 20% of the frame.

## What's in the repo
| Path | What |
|---|---|
| `enrich.py` | Fetches the Google ad feed CSV + every landing page → `data/snapshot_DATE.json` (unchanged from the tracker kit) |
| `tracker.py` | Folds a snapshot into state, computes was/now claims → `out/state.json`, `out/cabins.json`, `out/run.json` (unchanged) |
| `render_cards.py` | Renders 1x1 / 3x4 / 9x16 PNG cards with Playwright (unchanged) |
| `daily.py` | **New.** Runs the whole daily job deterministically (see its docstring). Tested on 12 Oct against real data: normal run, same-day skip, and the broken-feed safety stop all behave. Card rendering through `daily.py` tested 12 Oct in Claude Code on a scratch copy (lead + cabin claim, test prices only, nothing committed). |
| `.github/workflows/price-watch.yml` | Workflow: daily cron + manual run, commits results, opens a GitHub issue for new claims or failures. Reviewed 12 Oct: actions bumped to v7, fixed the commit step (it staged nothing on days without cards). Not yet run on GitHub. |
| `site/index.html`, `publish.py`, `.github/workflows/publish.yml` | Tracker page (ported from the old Claude tracker page, 12 Oct 2026). `publish.py` copies `state/` and the last 21 `runs/` into Firestore (`pricewatch/current`, `/cabins`, `/runs`) in the Digital Team Planner's Firebase project; `publish.yml` runs it and deploys `site/` to Firebase Hosting after each daily run and on pushes to `main`. The page signs people in with Google and only shows data to the planner's allowlist |
| `.github/workflows/feed-check.yml` | Manual only. Fetches the feed and landing pages and runs the safety checks without saving anything. First run 12 Oct 2026 from GitHub's runners: 220 sailings, 0 failed pages, safety check passed, so the booking site does not block GitHub |
| `state/current.json`, `state/cabins.json` | Price history exported from the tracker artifact database on 12 Oct 2026 (~afternoon) |
| `runs/*.json` | Daily change lists: 8, 9, 12 Oct (10–11 Oct were never recorded) |
| `archive/2026-10-12-morning-run.json` | The 12 Oct morning change list, which the accidental second run overwrote in `runs/2026-10-12.json` |

Feed: `https://booking.ambassadorcruiseline.com/api/cruises/ad-feeds/google`
Old tracker artifact (Claude-hosted page + database): `https://claude.ai/artifact/7SqEYAwpjpxGn5Z8Ejcztc`

## Tasks for this session
1. Review `daily.py` and the workflow. Check current major versions of the actions used (checkout, setup-python,
   upload-artifact) rather than trusting the draft.
2. Test card rendering locally: pick any sailing from a snapshot and run
   `python render_cards.py data/snapshot_DATE.json /tmp/cards <ID> --was <any higher price>`. Look at the PNGs against the checks above.
   This is a visual test only; never use a made-up was price in anything that gets committed or sent.
3. (Done 12 Oct 2026: the feed check passed from GitHub's runners.) Push, then run the workflow manually (Actions → Sailing price watch → Run workflow). **First thing to confirm: the
   booking site doesn't block GitHub's runners.** If `enrich.py` gets 403s or timeouts, stop and tell Sam (options: a
   self-hosted runner, or a different host).
4. Confirm Sam gets notified: GitHub issues assigned to him (new claims / failures), plus GitHub's own email on failed
   scheduled workflows. Check his notification settings with him.
5. Cutover (see checklist below).

## Open decisions (ask Sam)
- **Tracker page.** Decided by Sam 12 Oct 2026: same set-up as the Digital Team Planner
  (`sambrooker-cmd/DigitalTeamPlanner`). Data lives in its Firebase project (`promotions-planner`), not on a public
  page; viewers sign in with Google and must be on the planner's Firestore `allowlist` (any role). The repo stays
  private and no GitHub Pro is needed. One-off setup, done by Sam (see "Tracker page setup" below).
- **Schedule.** GitHub cron is UTC: the draft runs at 06:57 UTC (07:57 UK in summer, 06:57 in winter). Fine, or adjust.
- **Phase 2 (optional): Claude review of cards.** Only on days with new claims, a step could ask Claude to look at the
  PNGs and draft the approval message (e.g. Anthropic's Claude Code GitHub Action; needs an API key secret). Look up the
  current action and its inputs before proposing it.
- **Intraday flip-flops.** On 12 Oct the site's prices/availability changed between 07:00 and 10:30 (cabins sold out and
  came back, lead prices moved both ways). Running once a day at a fixed time keeps this consistent. Worth Sam knowing,
  because "sold out then back" resets a cabin's reference period.

## Tracker page setup (one-off)
1. **Firestore rules.** Firebase console → `promotions-planner` → Firestore Database → Rules. Inside the existing
   `match /databases/{database}/documents { ... }` block (next to the other `match` blocks, so it can use the planner's
   `isAllowed()` function), add:
   ```
   match /pricewatch/{docId} {
     allow read: if isAllowed();
     allow write: if false;   // only the GitHub workflow writes, with the service account (rules don't apply to it)
   }
   ```
   Publish the rules.
2. **Hosting site.** Hosting → (Get started, if Hosting has never been used) → **Add another site** → pick a site ID,
   e.g. `acl-price-watch`. The page will be at `https://<site-id>.web.app`. A separate site keeps it clear of the
   planner if the planner ever moves to Firebase Hosting.
3. **Sign-in domain.** Authentication → Settings → Authorized domains → add `<site-id>.web.app`.
4. **Service account key.** Project settings → Service accounts → **Generate new private key**. In this repo:
   Settings → Secrets and variables → Actions → New repository secret `FIREBASE_SERVICE_ACCOUNT`, paste the whole
   JSON file, then delete the downloaded file. The key has admin rights over the whole Firebase project: keep it
   only in that secret.
5. **Site variable.** Same page, Variables tab → New repository variable `FIREBASE_HOSTING_SITE` = the site ID.
6. Run **Actions → Publish tracker page → Run workflow** (once this is on `main`), then open the page and sign in.

## Cutover checklist
- [ ] Workflow has run successfully at least once from a manual trigger (no `--force` needed on a fresh day).
- [ ] **Re-sync state just before go-live.** The Claude scheduled task keeps writing to the tracker database until it
      is turned off, so `state/` here goes stale each day. Either pause the scheduled task now (then `state/` is current),
      or have Claude (Cowork) export the latest `state/current`, `state/cabins` and `runs/*` from the tracker into this
      repo on cutover day.
- [ ] Turn off both Claude scheduled tasks: **"Sailing price watch"** (07:57) and **"Sailing price watch – daily check"**
      (09:07). Otherwise two systems write separate histories, and the 09:07 check will alert on the stale tracker.
- [ ] Decide the tracker page question above.
