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
| `enrich.py` | Fetches the Google ad feed CSV + every landing page → `data/snapshot_DATE.json`. Since 12 Oct 2026 also reads each page's promotions (FareSummary `offers`: id, name, description, expiry) into `offers` |
| `tracker.py` | Folds a snapshot into state, computes was/now claims → `out/state.json`, `out/cabins.json`, `out/run.json`. Promotion history (added 12 Oct 2026): per sailing `promos` = {offer id: [[from, to]]} (`to` = first day gone), offer names/descriptions/expiry once in state `offers`, run lists `promo_added` / `promo_ended` / `promo_changed`. Promotions are recorded only; they never affect was/now claims |
| `render_cards.py` | Renders 1x1 / 3x4 / 9x16 PNG cards with Playwright (unchanged) |
| `daily.py` | **New.** Runs one check deterministically (see its docstring). Since 12 Oct 2026 it runs hourly: each check adds its changes (with `at`, UTC) to `runs/<date>.json`, keeps `checks` and `reported` (claims already reported that day, so each new claim is reported once), and stamps `updated_at` in state. Tested on 12 Oct against real data: normal run, same-day skip, and the broken-feed safety stop all behave. Card rendering through `daily.py` tested 12 Oct in Claude Code on a scratch copy (lead + cabin claim, test prices only, nothing committed). |
| `.github/workflows/price-watch.yml` | Workflow: hourly 09:00–17:00 GMT (cron `0 9-17 * * *`, nothing overnight; Sam, 12 Oct 2026) + manual run, commits results (pulls first), opens one GitHub issue per day for new claims or failures and comments on it for later checks (`.github/issue.sh`). Reviewed 12 Oct: actions bumped to v7, fixed the commit step (it staged nothing on days without cards). Not yet run on GitHub. |
| `site/index.html`, `publish.py`, `.github/workflows/publish.yml` | Tracker page (ported from the old Claude tracker page, 12 Oct 2026). `publish.py` copies `state/` and recent `runs/` (up to 90 days, within a 600 KB budget) into Firestore (`pricewatch/current`, `/cabins`, `/runs`) in the Digital Team Planner's Firebase project; `publish.yml` runs it and deploys `site/` to Firebase Hosting after each daily run and on pushes to `main`. The page signs people in with Google and only shows data to the planner's allowlist. Filters (departure month, port/airport, length, no-fly/fly) and a per-sailing detail view (click a row, or link to `#<cruise code>`): was/now status in words, price chart by cabin grade, cabins now, every change. Added 12 Oct 2026. Promotions: live-promotions summary, offer labels and a promotion filter in the table, promotions in the detail view. "What changed" view (every recorded change by date range and type; mix drops shown as cabin changes, never as price drops) and CSV downloads of the filtered sailings table and of the changes |
| `coverage.py`, `.github/workflows/coverage.yml` | Weekly (Mondays 09:30 GMT + manual): sitemap vs ad feed. Writes `state/coverage.json` (sailings on sale on the website but not in the feed, with when each was first spotted), shown on the tracker page; opens an issue only for newly missing sailings. First manual check 12 Oct 2026: 415 site pages, 220 in feed, 15 on sale but missing (13 Curaçao S-codes, A22638, A12705, A12824) |
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
- **Schedule.** Decided by Sam 12 Oct 2026: hourly 09:00–17:00 GMT, nothing overnight (10:00–18:00 UK time while BST applies).
  Sam was told the trade-off: intraday flip-flops (see below) are now recorded, so sold-out-then-back cabins restart
  their reference period more often and some was/now claims qualify later than with one daily check.
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
