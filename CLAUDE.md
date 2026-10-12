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
Sam asked to start with **price tracking only**. Was/now cards were paused, then **turned back on by Sam on 12 Oct 2026**:
they are made by `cards_sync.py` (not `daily.py`, which still runs `--no-cards`), stored with the standard cards and shown
on the tracker's Cards page; the new-claim issue links to them. When a claim stops, its cards are withdrawn at once and
kept 30 days marked "Do not use" (Sam chose this), with a "Was/now cards withdrawn" issue. No real claim can qualify
before about 5 Nov 2026 (tracking began 8 Oct; 28 days' reference needed). Don't add any Meta/ads step until Sam asks.
Standard cards (no was/now) are kept ready for every sailing on sale by `cards_sync.py` inside the hourly workflow
(Sam, 12 Oct 2026, "option C"): remade only when something printed on them changes, stored in the planner's Firebase
Storage bucket (us-east1, inside the no-cost allowance; Sam wants no charges: keep usage small, JPEG, changed cards only),
shown on the tracker page. Replaced cards stay 30 days marked out of date (Sam chose this), then are deleted.
The **Make cards** workflow still makes cards on request as a zip.

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
| `enrich.py` | Fetches the Google ad feed CSV + every landing page → `data/snapshot_DATE.json`. Since 12 Oct 2026 also reads each page's promotions (FareSummary `offers`: id, name, description, expiry) into `offers`, and Nectar points (FareSummary `search-data.nectar_points`, per cabin grade for 2 sharing / solo, standard and Ambassador fare) into `nectar`, plus `nectar_pts` = the figure the page shows (site's useMaxNectarPoints: twin, cheapest cabin grade on sale, Ambassador fare, 2 guests; Norway A22629BR = 50,000; 0 if not eligible). Points come from total booking value in bands (Sam's table, 12 Oct 2026: <£250 1,500 · £250 3,500 · £500 8,000 · £1,000 14,000 · £1,750 30,000 · £3,500 50,000 · £5,750 75,000 · £8,000 100,000 · £15,000+ 150,000) |
| `tracker.py` | Folds a snapshot into state, computes was/now claims → `out/state.json`, `out/cabins.json`, `out/run.json`. Promotion history (added 12 Oct 2026): per sailing `promos` = {offer id: [[from, to]]} (`to` = first day gone), offer names/descriptions/expiry once in state `offers`, run lists `promo_added` / `promo_ended` / `promo_changed`. Promotions are recorded only; they never affect was/now claims. Nectar (12 Oct 2026): per sailing `nectar` = [{n, from}] history of the page figure (last 24), current per-grade points in `nectar_grades` (kept in `state/cabins.json`), run list `nectar_changes`, state `nectar_since`; recorded only, never part of claims |
| `render_cards.py` | Renders 1x1 / 4x5 / 9x16 PNG cards with Playwright (4:5 = 1080x1350 replaced 3:4 on 12 Oct 2026, Sam: match Meta's feed spec). Standard cards show the main live promotion plus a second one if there is one (`promo_lines`: % saving or code first, then biggest onboard credit, flights, coach, solo; code and end date added when the page gives them). "Lower/reduced fares" offers are never put on cards: they are price-reduction claims. Nectar strip (Sam, 12 Oct 2026, `nectar_line`): "Collect up to N Nectar points" from snapshot `nectar_pts`, in a Pearl strip above the promotions, and then only the main promotion is shown (Sam); "up to" because the figure is for the Ambassador fare, which costs more than the card's "from" price. Campaign artwork (Sam, 12 Oct 2026, after A12639 cropped badly): `is_campaign` (file name cotw/dig-/carousel/boom-radio/weekender/back_to_/no-logo, or a 2:1 image; `campaign_images.json` {"add","remove"} overrides) → same card design, but the artwork is shown whole between the badge and the strips on a blurred copy of itself (`photo_whole`). 8 sailings on 12 Oct 2026 |
| `make_cards.py`, `.github/workflows/make-cards.yml` | **Make cards** (manual, 12 Oct 2026): type cruise codes (or `all`) and sizes; reads a fresh snapshot, renders standard cards (no was/now), uploads a zip (PNGs + `cards.csv` with the price-read time + `summary.md`) as a 30-day artifact. Nothing committed, nothing sent to Meta |
| `cards_sync.py` | Always-ready standard cards (12 Oct 2026). `plan` / `run` after daily.py in the hourly workflow. Fingerprint of everything printed on a card (`on_card`: name, date, nights, ship, port, flights, price, `promo_lines`, `nectar_line`, photo, `DESIGN`); changed or new → render 1x1/4x5/9x16 JPEGs, upload to `gs://promotions-planner.firebasestorage.app/pricewatch-cards/<code>/<fp>_<size>.jpg` with a Firebase download token (links reach the page only via Firestore `pricewatch/cards`, behind the allowlist; no Storage rules needed). Manifest `state/cards.json` (current + old with `reason`, `out_of_date_since`). Left the feed / departed → withdrawn to old. Old versions deleted after `KEEP_DAYS` = 30. Card step is `continue-on-error`; failures open a "Cards FAILED" issue. Bump `DESIGN` to remake every card after a design change. **Was/now cards** (Sam, 12 Oct 2026): for claims in this check's `out/run.json` (`eligible`, `cabin_eligible`; never any other was price) whose `since` is today, `price_reduction_html` cards in 3 sizes → `.../<code>/wasnow_<fp>_<size>.jpg`, manifest `wasnow` {"lead@since" / "twin.<grade>@since": {was, now, since, ends, cabin, files}}; made once, on the claim's first day; refused if the snapshot's price on sale isn't the claim's now price. A claim no longer in run.json → moved to `old` with `do_not_use` and the reason (`ended_why`, from state), deleted after 30 days; `out/wasnow_ended.md` → "Was/now cards withdrawn" issue. New ones are appended to `out/issue.md` with tracker links (`HOSTING_SITE`). Campaign artwork (Sam, 12 Oct 2026, "matched", after rejecting blurred backgrounds): was/now cards show it whole below the logo and a smaller corner sticker (scale .68), on two plain colours taken from the artwork's own top and bottom edges (`edge_colours`, needs Pillow; straight split at the artwork's bottom, no fade); logo purple on a light top (`campaign_css`); other photos stay full-bleed. Tested on A12634, A12706 and A22629BR (normal photo, unchanged) |
| `card_review.py` | Claude checks new and remade standard cards (Sam, 12 Oct 2026, "option 3"), in the hourly workflow after `cards_sync.py` (`continue-on-error`). Runs on **Sam's Claude plan, not an API key** (Sam chose this): the Claude Code CLI (pinned in the workflow) signs in with the `CLAUDE_CODE_OAUTH_TOKEN` repo secret from `claude setup-token`; skipped until that secret exists. Per sailing whose current cards have no `review` for their fingerprint: downloads the three JPEGs into a temp folder and runs one `claude -p` (model `claude-opus-5-5`, only the Read tool, `--json-schema` structured answer) with what should be printed (from the manifest); stores `current.review` = {fp, at, ok, issues[{size, severity fix/look, problem}], model} in `state/cards.json`. First full check split over 4 of the plan's 5-hour usage windows (Sam): while more than `SMALL` = 15 are waiting, at most `BATCH` = 56 per check and then a `WINDOW_HOURS` = 5 wait (`review_batch_at` in the manifest); after that, remade cards are checked at the next hourly check. Was/now cards are checked first, including that the was/now figures match the claim. Flagged cards → "Cards to check — DATE" issue (one per day, comments after) and "Needs a look" on the Cards page (filter, badge, detail view, CSV column). Read-only: never changes a card, a price or anything outside the repo. Tested 12 Oct 2026 on A12639 (fine; with a deliberately wrong expected price it flagged the price), about 11 s a sailing |
| `daily.py` | **New.** Runs one check deterministically (see its docstring). Since 12 Oct 2026 it runs hourly: each check adds its changes (with `at`, UTC) to `runs/<date>.json`, keeps `checks` and `reported` (claims already reported that day, so each new claim is reported once), and stamps `updated_at` in state. Tested on 12 Oct against real data: normal run, same-day skip, and the broken-feed safety stop all behave. Card rendering through `daily.py` tested 12 Oct in Claude Code on a scratch copy (lead + cabin claim, test prices only, nothing committed). |
| `.github/workflows/price-watch.yml` | Workflow: hourly 09:07–17:07 GMT (cron `7 9-17 * * *`; Sam, 12 Oct 2026; moved off :00 after the 12:00 and 13:00 scheduled runs never started) plus 22:07 and 06:07 GMT (`7 22,6 * * *`, Sam 12 Oct 2026, so evening price changes reach the cards before morning), then cards (`cards_sync.py`) + manual run, commits results (pulls first), opens one GitHub issue per day for new claims or failures and comments on it for later checks (`.github/issue.sh`). Reviewed 12 Oct: actions bumped to v7, fixed the commit step (it staged nothing on days without cards). Not yet run on GitHub. |
| `site/index.html`, `publish.py`, `.github/workflows/publish.yml` | Tracker page (ported from the old Claude tracker page, 12 Oct 2026). `publish.py` copies `state/` and recent `runs/` (up to 90 days, within a 600 KB budget) into Firestore (`pricewatch/current`, `/cabins`, `/runs`), plus every run ever in half-month archive docs (`/runs-YYYY-MM-1`, `-2`; unchanged ones are skipped) that "What changed" loads on demand for older dates, and `/trends` (change counts per day for the Trends page) in the Digital Team Planner's Firebase project; `publish.yml` runs it and deploys `site/` to Firebase Hosting after each daily run and on pushes to `main`. The page signs people in with Google and only shows data to the planner's allowlist. Filters (departure month, port/airport, length, no-fly/fly) and a per-sailing detail view (click a row, or link to `#<cruise code>`): was/now status in words, price chart by cabin grade, cabins now, every change. Added 12 Oct 2026. Promotions: live-promotions summary, offer labels and a promotion filter in the table, promotions in the detail view. "What changed" view (every recorded change by date range and type; mix drops shown as cabin changes, never as price drops) and CSV downloads of the filtered sailings table and of the changes. Layout (Sam, 12 Oct 2026): a purple sidebar switches pages (Overview = summary, was/now queue and the sailings table; Trends; Live promotions; Not in ad feed; What changed; Daily runs; Was/now rules) with count badges; the last page is remembered per browser; on phones it becomes a top bar with swipeable tabs. No folding sections. Trends page (12 Oct 2026): price changes and availability per day (per week beyond 45 days), average from price across the same sailings throughout, sailings with a promotion, sailings in the feed; days with no check are gaps. Mix drops are counted apart, never as drops. Detail view has a month-by-month from-price table (lead segments keep full history; cabin grades keep their last 12 changes). Cards page (12 Oct 2026): its own filters (search, departure month, port/airport, no-fly/fly, made today / last 7 days) and "Download these": a browser-built zip (JSZip from cdnjs) of the filtered cards in the chosen size(s), `<code>_<size>.jpg` + `cards.csv`; falls back to one download per card if the bucket's CORS rule is missing. Clicking a card or a size opens a preview (dialog `#pv`, size tabs, Download button), since the files themselves download as attachments. "Was/now cards live now" block and, per sailing, was/now cards with "use until"; withdrawn ones shown with a red "Do not use" (`storage_cors.py`, run by publish.yml, adds a GET rule for the hosting site and keeps existing rules) |
| `site/adcreator.js`, `site/adcards.js`, `check_adcards.py` | **Ad creator** page on the tracker (Sam, 12 Oct 2026): pick sailings (carousel of 2–10, or a single image ad), reorder (arrows or drag), per card choose design (standard; was/now only for a claim live today, from state `claim` / cabins `cabin_claims`, figures never typed in), image (feed image, the sailing page's photos from enrich `photos`, or an upload kept in the browser only), words on the card, Nectar line and promotions (max 2, or 1 with Nectar), and the Meta headline/description/link; ad primary text and button. Live Facebook/Instagram feed mock (carousel, or single image in 4:5, 1:1 and a 9:16 Stories frame). "Download zip": cards rendered in the browser (`adcards.js` = port of `render_cards.py` card designs, run in iframes, saved with html-to-image 1.11.11 from cdnjs) named `01_<code>_<size>.jpg` in order, `ad_text.txt`, `cards.csv`, `HOW_TO_UPLOAD.md` (Ads Manager steps; was/now "stop running by" date). Data: `state/adkit.json` written by `cards_sync.py plan` every check (all card-safe promotion lines, Nectar line, lead grade, campaign flag, image, page photos) → Firestore `pricewatch/adkit`. Fonts and logo copied into `site/`. If a card design changes in `render_cards.py`, change `adcards.js` too and run `python check_adcards.py data/snapshot_DATE.json` (about 1% of pixels differ = fine). Draft kept in the browser (localStorage). Next (PR 2, Sam chose "draft on request"): Claude-drafted ad text via a button → small Firebase function (allowlist check) → GitHub workflow running Claude Code on Sam's plan |
| `coverage.py`, `.github/workflows/coverage.yml` | Weekly (Mondays 09:30 GMT + manual): sitemap vs ad feed. Writes `state/coverage.json` (sailings on sale on the website but not in the feed, with when each was first spotted), shown on the tracker page; opens an issue only for newly missing sailings. First manual check 12 Oct 2026: 415 site pages, 220 in feed, 15 on sale but missing (13 Curaçao S-codes, A22638, A12705, A12824) |
| `.github/workflows/feed-check.yml` | Manual only. Fetches the feed and landing pages and runs the safety checks without saving anything. First run 12 Oct 2026 from GitHub's runners: 220 sailings, 0 failed pages, safety check passed, so the booking site does not block GitHub |
| `state/current.json`, `state/cabins.json` | Price history exported from the tracker artifact database on 12 Oct 2026 (~afternoon) |
| `runs/*.json` | Daily change lists: 8, 9, 12 Oct (10–11 Oct were never recorded) |
| `archive/2026-10-12-morning-run.json` | The 12 Oct morning change list, which the accidental second run overwrote in `runs/2026-10-12.json` |

Feed: `https://booking.ambassadorcruiseline.com/api/cruises/ad-feeds/google`
Old tracker artifact (Claude-hosted page + database): `https://claude.ai/artifact/7SqEYAwpjpxGn5Z8Ejcztc`. Retired 12 Oct 2026 (Sam): the page now only points to the new tracker; its database and files were left in place.

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
- **Claude review of cards.** Built 12 Oct 2026 as `card_review.py` (see above), on Sam's Claude plan. Needs Sam to add the
  `CLAUDE_CODE_OAUTH_TOKEN` secret. Don't move it to a paid API key, change the model or the batching without asking Sam.
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

## Cutover checklist (done 12 Oct 2026)
- [x] Workflow has run successfully from a manual trigger (12 Oct 2026, several times: prices, Nectar, cards, publish).
- [x] State: GitHub is the only writer from 12 Oct 2026; the old tracker's export was taken that afternoon.
- [x] Both Claude scheduled tasks ("Sailing price watch" 07:57, "Sailing price watch – daily check" 09:07) turned off by Sam, 12 Oct 2026.
- [x] Tracker page decided and live (https://acl-price-watch.web.app); old Claude tracker artifact retired.
- [x] Sam set a £1 budget alert on promotions-planner billing, GitHub email notifications (participating + failed workflows),
      and deleted the temporary probe-nectar branch (12 Oct 2026).
- [x] Backstop timer (12 Oct 2026): GitHub's own `schedule` never fired on 12 Oct (12:00–15:07 UTC all missed, workflow
      "active"). Sam set up a cron-job.org job (his account) that POSTs to
      `https://api.github.com/repos/sambrooker-cmd/sailing-price-watch/actions/workflows/price-watch.yml/dispatches`
      with `{"ref":"main"}` at minute 7 of 06, 09–17 and 22 UTC, using a fine-grained token (only this repo,
      Actions: read and write) that **expires 30 Jul 2027**: renew it before then or the checks stop. First test run
      15:31 UTC 12 Oct 2026 worked. If GitHub's schedule starts firing too, some hours get two checks a few minutes
      apart (harmless: the second finds nothing new; the concurrency group runs them one after the other).
