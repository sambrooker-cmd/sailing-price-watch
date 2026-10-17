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

## QA sweep (13 Oct 2026)
Code review (Python and browser) plus a UX sweep (every page at 1440 desktop, 390 phone and dark mode; flows: search,
detail view, CSVs, T&Cs dialog, Ad creator zip, Email cards, links). Fixed: was/now claims ran one day long (now
exactly `limit` days, `ends` = since + limit − 1, capped at departure − 7 days); a sailing back in the feed after more
than `RETURN_RESET_HOURS` = 24 h starts a fresh reference period (lead and cabins, `back` segment; `removed_at`); a
page that fails keeps its departure date and offer (`PAGE_FIELDS`); an empty cabin list no longer marks every cabin
sold out; `daily.py` safety stop when most page prices can't be read; feed gaps stay open while a sailing flickers
out of the feed; card steps `continue-on-error` and the commit step `always()`; `terms.py` keeps the old terms after a
partial read; `publish.py` publishes only the newest `OLD_SHOWN` = 2 out-of-date standard cards per sailing (was
growing ~60 KB a day toward Firestore's limit); `card_review.py` campaign layout check. Browser: shared-ad photos must
be the sailing's own (and image sources are escaped: a crafted link could run script); Email creator links limited to
http(s)/mailto/tel/{{token}}; Email cards solo falls back to twin when no solo is on sale, picture cache capped;
carousels trimmed (with a note) when an opening/closing card is switched on; malformed `#` links ignored; UK dates in
`fmtWhen`; CSV formula guard on tab/CR; `makeVideo` marks a request failed if GitHub can't be reached. UX: table links
in the brand colour; on phones What changed stacks each change, Feed vs website and Not in ad feed drop their least
useful columns.

## Creator layout (14 Oct 2026, Sam: "lots of options and it's not always clear"; no numbers)
`site/sections.js`: the creators' option columns are collapsible sections with clear titles and, while closed, a one-line
summary of what's set (refreshed when a section is closed); open/closed remembered per browser (localStorage
`spw-sections`); the selected card/sailing's own options are never folded. Photo grids show two rows with "Show all N
photos" (the chosen one always stays in view). Order: **Ad creator** saved bar · Sailings in order (format, size, add,
list) · the selected card · Opening and closing cards (closed by default) · Ad text (primary text, button, suggestions
closed by default, Draft with Claude). **Email creator** saved bar · Sailings in order · the selected sailing · Header ·
Words (subject, preview text, intro, suggestions, Draft with Claude, button) · Nectar and Trustpilot (closed) · Small
print (closed). **Email cards** Sailings · Sizes and downloads (closed) · the selected card (file name moved below photo,
caption and badges). The 13 Oct "no folding sections" was for the main tracker pages, which are unchanged.

## Was/now rehearsal (14 Oct 2026)
End-to-end rehearsal on a scratch copy (test prices only, nothing committed, uploaded or published): A12702 given a
fake £1,129 inside / £1,899 balcony history from 1 Sep, then the real 14 Oct snapshot (£1,029 / £1,739). Worked: both
claims (ends 10 Nov = since + 27), A12703's 10-day drop refused, issue text with tracker links, 6 was/now JPEGs (Sam's
checks passed: name one line, price in the sticker, 9:16 clear of the top 14% / bottom 20%), no repeat at the next
check, Overview queue, detail view, Cards "live now", Ad creator option + zip ("stop running by"), Email creator,
Draft facts; next day the inside price rose → lead cards withdrawn "Do not use" with the issue, balcony claim kept.
Fixed: a draft ad/email left open in the browser now says what normalise() changed ("Since this ad was last
open: …"; it was silent); the withdrawn issue names the cards (grade, was → now); `card_review.py` tells Claude the
lead price's own grade. Not covered: real Storage upload and GitHub issue creation (same code paths as every hourly
check). Email cards have no was/now design (prices are "From" only). Ad creator (Sam, 14 Oct 2026): a card's Meta description defaults to "Now £Ypp, was £X" on was/now cards
(`descFor`, figures from the claim) and "From £Xpp" otherwise; an automatic description (`autoDesc`) follows the design
and is refreshed with the latest price whenever the ad is opened (saved ads kept old prices before); typed wording is
never changed. Email cards was/now (Sam, 14 Oct 2026: option A of two mock-ups, "an option rather than automatic"; the emails
that need it will already carry a price-reduction badge, so no badge is added): per card **Price** select, shown
only when the sailing has a claim live today (`claims()`, as the Email creator), default "From price". Chosen
(`it.wasnow` = claim key): "Balcony cabins: was ~~£1,899~~" (lead: "Was ~~£X~~") above a "Now £Ypp" button, twin
(fare/cabin choices hidden, booking link uses the claim's grade), in the whole-card PNG, the HTML block, Copy text
("Was/now price: use by …"), the CSV ("Was £", "Was/now use until"), file names ("Was-now"), the cards list and
the toolbar ("Was/now cards: use by" the earliest end). A claim that has ended switches the card back to "From"
with a note when the page opens.

## Usability round (13 Oct 2026, Sam picked from the QA suggestions)
- **Find a sailing** in the sidebar (`#gq`, "/" focuses it): name, port, ship, airport or code → its detail view (on-sale first).
- **Add to ad / Make email card** buttons in a sailing's detail view (`data-make`): open that page with the sailing added
  (`addSailing` exported by adcreator.js and emailcards.js; `pendingAdd` when the page isn't loaded yet).
- **Last checked … · N min ago**, amber "the HH:MM check hasn't come in" when a scheduled check (:07 past 06, 09–17, 22
  UK, `SLOTS`) is over 40 minutes late (`renderMeta`, refreshed every minute).
- **Phones**: per-cabin offer descriptions shown as one line (`promoShort`, e.g. "£50–£200 onboard credit per cabin, by
  cabin grade"); bigger tap areas for small text links; the pages are a "☰ <page>" button opening the grouped list
  (`#navtoggle`) instead of a sideways-scrolling tab bar. Not done (Sam): a "copy for the feed owner" message, a phone
  thumbnail grid for Cards.

## Shared saved ads and emails (13 Oct 2026, Sam)
Saved ads (Ad creator) and saved emails (Email creator) are kept in Firestore `pricewatch_saved/<id>` {kind "ad" |
"email", name, by, saved_at, created_at, data (the ad/email JSON: no prices, no uploads)} through the Firebase function
`saved` (functions/index.js; allowlist checked; deployed by video-function.yml with makeVideo, emailImages and drafts): GET
?kind= lists all with `me`; POST op save (new, or over your own), rename, delete. Everyone on the allowlist sees and can
open or copy everything; only the person who saved an item can save over, rename or delete it (403 otherwise; opening
someone else's shows "Saved by X. Save a copy…"). Browser side: `saved.js` `sharedStore` (falls back to the old
browser-only storage, with a note, if the function can't be reached) and the Saved dialog shows "by you / by X", an
Everyone's / Mine filter, and Rename/Delete only on your own. Ads saved in a browser before this get "Move them to the
shared list" (`moveLocal`), which uploads them and clears the browser copy. Limits: 300 KB an item, 1,000 per kind.
`make_video.py` answers the function calls with 503 (not needed there).
Out-of-date warnings (Sam, 14 Oct 2026, picked from: warnings / thumbnail grid / Email cards sets / more filters):
each creator's `normalise()` also returns short `issues` (sailings no longer on sale, was/now claim ended, offer badge
ended, cabin choice sold out, uploaded photo to add again); the Saved dialog shows them on the item ("Needs updating:
… Opening it brings it up to date."), adds a "Needs updating (N)" filter, and the button says "Saved ads (N) · M need
updating". The thumbnail uses the first sailing still on sale.

## France (14 Oct 2026, Sam: "do all of it for France"; all markets managed by the UK team)
Ambassador Croisières, `https://www.ambassadorcroisieres.fr` (Next.js site, ex-CFC; ship Renaissance, booking code RN2).
Built **as if France has no ad feed** (Sam). **No was/now for France** (Sam: "leave the was now pricing for now"): prices
only. Germany (Ambassador Kreuzfahrten, ambassadorkreuzfahrten.de) is only a holding page so far; it can follow the same
pattern when bookings open. Stages, one PR each: 1 prices (done), 2 French cards + Ad creator, 3 emails, Email cards,
Google Ads and Draft with Claude in French. The tracker's own screens stay in English; only what goes out is French.
- `fr_enrich.py` → `data/fr/snapshot_DATE.json` (same shape as enrich.py's): sailings from the cruise list page
  `/croisieres` (its `totalCount`, 54 on 14 Oct 2026) plus the sitemap; details from each cruise page's Next.js payload
  (`cruise_code` R######, title, dates, nights, `port`/`arrival_port`, offer tags, banner photos with captions
  `photo_captions`, e.g. "Bastia, Corse, France", from `cms.ambassadorcroisieres.fr/assets/<id>`); **prices from the
  site's booking API** `POST /api/tiller/cabin-categories` {locale, cruise_code, departure_date, no_of_passengers}
  (what the page's "Les cabines" block asks): per category `lowestPerPersonPrice` and `cabinsAvailable`, for 2 adults
  (twin) and 1 (solo). Calls are made one at a time (in parallel it answered "TCE - Internal Server Error"). Cabin keys
  (`CABIN_IDS`): inside, obstructed (Vue Mer Obstruée), ocean_view, promenade (Terrasse Promenade), balcony, suite,
  grand_suite (Grande Suite Renaissance). From price = cheapest twin cabin on sale (`price_source` "page"); booking
  unreadable → "feed" (tracker keeps the last price). A sailing with no cabin on sale is left out (as the UK feed does).
  Tags that are travel notices ("Passeport obligatoire", "Taxes … non incluses") go to `notices`, not offers. The
  page's own "À partir de" figure is `feed_price_pp`, so tracker.py's feed-gap check is **"page vs booking"** for France
  (on 14 Oct 2026, 7 pages differed, 6 lower than booking, e.g. Corsica R280508 page 569 € vs booking 679 €). The site's
  struck-through `barred_price` ("1 acheté = 1 offert": double the price) is kept in the snapshot only
  (`site_barred_pp`), never in state or on the tracker. Caribbean sailings say "Vols disponibles" (flights from Paris by
  phone, not included): `flights_available`, snapshot only.
- `tracker.py --no-claims` (price history only; state `claims: false`, `rules: null`); `CABIN_ORDER` has France's grades.
- `daily.py --market fr`: files in `data/fr`, `state/fr`, `runs/fr`, `out/fr`; prices in euros; a page-vs-booking gap
  lasting 3 h → `out/fr/feed_gaps.md` → "France: pages don't match booking — DATE" issue; safety stop also when fewer than
  70% of the cruise list's sailings were read. Workflow step **France prices** right after the UK one (`continue-on-error`,
  runs even if the UK check failed; its own "France price watch FAILED" issue). About 2 minutes a check.
- `publish.py`: `pricewatch/fr-current`, `fr-cabins`, `fr-runs`, `fr-trends`, `fr-runs-YYYY-MM-1/-2` (once `state/fr` exists;
  the Firestore rule for `pricewatch/{docId}` already covers them).
- Tracker page: **UK / France** switch under the logo (`MKT`, `?m=fr`, remembered in `spw-market`; switching reloads).
  France shows Overview (third tile "Page vs booking"), Trends, What changed, Live promotions, Page vs booking and Check
  history, in euros (€1,029), with Renaissance's 7 cabin grades (chart colours `--c5`…`--c7`); no ship buttons, fly
  filter, was/now queue, Nectar, cards, creators, coverage or rules (`FR_HIDE`). Filters are remembered per market
  (`spw-prefs-fr`). A shared Ad/Email creator link opened in France switches to the UK.
- **Stage 2 (14 Oct 2026): French cards and Ad creator.** `render_cards.py` draws French sailings (`is_fr`: snapshot
  `market` "fr") in the same standard design: logo `logo-fr-white.svg` (the site's own Ambassador Croisières logo, made
  white; colour copy `site/logo-fr.svg`), badge "À bord du Renaissance / Départ de <town>", "7 nuits", "8 mai 2028",
  "À partir de 679 €/pers." (`fr_money`, `fr_date`), photos cropped by the CMS (`?width&height&fit=cover`). Offers:
  `PRICE_CLAIM_FR` keeps "1 acheté = 1 offert" (shown on the site with a struck-through price) and price-cut wording
  off cards; emoji/asterisks stripped; % offers first, then "offert". No was/now. `cards_sync.py --market fr`
  (`use_market`): manifest `state/fr/cards.json`, files `pricewatch-cards/fr/…`, ad kit `state/fr/adkit.json` (with
  photo `captions`), summary `out/fr`; workflow steps "Which French cards need making" / "Make and upload French cards"
  (`continue-on-error`, own "France cards FAILED" issue). **French photos are copied into Storage**
  (`pricewatch-cards/fr/photos/<asset id>.jpg`, 2400 px, `state/fr/photos.json`, never deleted, ~270 photos ≈ 100 MB):
  cms.ambassadorcroisieres.fr only allows ambassadorcroisieres.fr to read its pictures from a browser, so the Ad creator
  couldn't draw them; the ad kit points at the copies (a photo not copied yet is left out until the next run).
  `publish.py`: `fr-cards`, `fr-adkit`. The card check (`card_review.py`) covers France since stage 4 (below).
  Tracker page in France: Cards page and the **Ad creator** (`market: "fr"`): `adcards.js` French design (`d.fr`,
  `frMoney`, `frDate`), French opening/closing cards ("Où naviguerez-vous ensuite ?", no Ambassador A by default;
  "L'accueil le plus chaleureux en mer", "Réservez votre croisière", ambassadorcroisieres.fr; check these with Sam),
  eyebrow "Au départ de …", Meta description "À partir de 679 €/pers.", feed preview "Ambassador Croisières ·
  Sponsorisé", CTA shown as Meta shows it to French viewers (`CTA_FR`, the zip keeps Ads Manager's English name),
  French suggested primary text (`site/adcopy_fr.js`, no AI, "vous", French typography), up to 2 offers, no Nectar,
  Trustpilot, was/now or Draft with Claude. French ads are kept apart: browser draft `spw-ad-draft-fr`, `"market": "fr"`
  in the shared saved list (each market lists only its own), share links `#adfr=` (opening one switches to France),
  zip `ad_fr_…`. Make video works for French ads: `make_video.py` reads the market from the link and opens
  `?m=fr#adfr=…`, letting its stand-in page read the Storage photo copies.
- **Stage 3 (14 Oct 2026): Google Ads, Email cards, Email creator and Draft with Claude in French** (each page's
  `mount(…, {market: "fr"})`, own browser draft `…-fr`). **Google Ads**: French images (`gbanners.js` d.fr: "À partir de
  989 €/pers.", "Départ de …", buttons Réserver / En savoir plus / Voir la croisière / Découvrir; French logo), copy from
  `site/gcopy_fr.js` (no AI, Google's limits, "Dès 679 €/pers.", "Croisière sans avion" only from mainland French
  ports, sitelink "Nos offres" → /offres, display path Croisieres/<place>, business name "Ambassador Croisières",
  campaigns "… - Croisières FR"), feeds (`gfeeds.js` s.fr: French Custom feed in EUR with the site's own photos, French
  customiser values and lines; no sale prices). **Email cards**: French words ("8 mai 2028", "7 nuits au départ de
  Marseille", "À partir de 679 €/pers.", French cabin grades, "Solo à partir de …"), links to the sailing's page (the
  French booking site has no deep link, so no "Booking" choice), captions suggested from the page's own photo
  captions, French copy text and T&Cs fallback (conditions particulières). **Email creator** (still only shown to Sam):
  French logo, phone 0 801 34 22 22, links (Nos croisières, Nos offres, Vie à bord, Brochure), small print ("Prix par
  personne, base deux personnes, relevés le …"), "Gérer mes préférences", `lang="fr"`, French suggestions; no Nectar or
  Trustpilot. The default legal line ("© 2026 Ambassador Croisières" + phone hours) has **no company details: check with
  Sam**. French emails: `"market": "fr"` in the shared saved list, `#emailfr=` links. **Draft with Claude**: the pages send
  `market: "fr"`; the `drafts` function stores it; `draft_job.py` builds French facts from `state/fr`
  (`build_facts_fr`), uses a French tone-of-voice brief (`VOICE_FR`, `RULES_FR`, "vous", French typography) and checks
  (`figures_fr`, `problems_fr`: any € or % figure not in the facts, or reduction wording such as "prix barré",
  "réduction", "au lieu de", throws an option away); ads end with "Prix par personne, base deux personnes, sous réserve
  de disponibilité."
- **Stage 4 (14 Oct 2026, Sam: "build the things not built yet")**. **Promotion T&Cs**: `terms.py --market fr` (workflow
  step "French promotion terms", `continue-on-error`) reads every French sitemap page except the cruise pages once a UK
  day (and when a new promotion has no terms): the offer pages' "Conditions de l'offre <name>" blocks (`sections_fr`,
  `infoCard`) and "*Offre … valable …" footnotes (title: the « name », else the words before "valable", else the line
  above: "1 acheté = 1 offert" on /offres). Matched by name (`match_fr`, `norm` drops accents/emoji/figures): name =
  terms title or the text's « name » ("type"), else a main word not in `STOP_FR` ("name", check). 14 Oct 2026: 6 terms,
  every promotion matched except "Dernière chance" (its page has none; the general terms are the Conditions
  particulières page). → `state/fr/terms.json` → `fr-terms`; Live promotions shows the Terms column in France too, and
  Email cards' Copy offer T&Cs uses them (badge names compared without emoji or case). **Coverage**: France has no feed,
  so `coverage.py --market fr` (weekly in coverage.yml after the UK check, `continue-on-error`, own issues "France:
  sailings missing from the sitemap or cruise list" / "France coverage check FAILED") compares the cruise list
  (/croisieres) with the sitemap: on the list but not in the sitemap (search engines may miss them; 4 on 14 Oct 2026:
  R280428, R280618, R280705, R280822), on sale with a page but not on the list, sitemap pages that 404 (`fr_status`).
  → `state/fr/coverage.json` → `fr-coverage`; tracker page France: "List vs sitemap" (was hidden). **Card check**:
  `card_review.py` queues French cards (`state/fr/cards.json`) after every UK card, in the same batches (BATCH,
  WINDOW_HOURS, START and the model unchanged; the batch time stays in the UK manifest), with a French description of
  the design (`GUIDE_FR`, `expected_fr`); flagged ones are listed "France · …" in the same issue. That's ~53 more
  sailings for the first pass: the UK cards still finish by Sunday night, the last French ones at Monday 06:07 UK.
  Repo variable `CARD_CHECK_FR` = `off` leaves France out. Not done for France: was/now (Sam: later).

## Competitors (15 Oct 2026, Sam: "Go ahead with Fred Olsen and Planet Cruise")
**Terms review first** (14–15 Oct 2026; Sam: legal sign-off "leave with me"): of the 15 names in the competitor analysis
(the CompetitorTracker repo's seed), reading is only done where neither robots.txt nor the website terms forbid it:
- **Clear**: Fred. Olsen (no website terms of use, only booking conditions; robots.txt allows /cruise/ and the deals
  pages), and the agents Planet Cruise, iglu (same platform and, it appears, the same company), Cruise.co.uk and Cruise
  Nation (booking terms only). Cruise.co.uk and Cruise Nation draw prices with JavaScript: not used.
- **Not read, ever**: P&O (terms ban automated scraping; Sam's own check, Sept 2026; the site also refuses automated
  requests), Princess (Website Terms §5: "You must not use automated tools to scrape, extract or mine content or data";
  robots.txt also disallows its pricing pages), Marella/TUI (website terms: "personal, non-commercial use only", no
  extracting information "for any commercial purpose"; site refuses automated requests), Cunard (Carnival, as P&O and
  Princess; blocks), Saga (blocks even a normal browser), MSC (401), Cruise1st (Cloudflare challenge), Bolsover
  ("domestic and private use… not… any commercial or business purposes"). Royal Caribbean and Celebrity's own sites
  couldn't be read from here (maintenance / "on vacation" pages). **Never get round a block** (no disguised browsers,
  bot-bypass or proxy services): that's beyond a terms question. Sam was told website terms are probably binding once
  read, database right applies to systematic extraction (hence a sample, not the catalogue), and that a block is not
  the only consequence.
- `competitors.py` (Sam, 15 Oct 2026: "capture all sailings that ambassador would compete with so no fly uk sailings and
  fly caribbean"): **every competing sailing**, not a sample. `competes()`: **no-fly** = departs from a UK port
  (`UK_PORTS`); **fly-Caribbean** = a Caribbean sailing (`CARIB` in the title, port or Planet Cruise itinerary) sold
  from the UK with flights (a UK-airport package such as Planet Cruise's "London Airports"), departing from a Caribbean
  island (P&O, Fred. Olsen and Ambassador base ships there for UK guests), or any Marella Caribbean holiday. Florida
  cruise-only sailings and Mediterranean/other fly-cruises are left out. **Tightened 15 Oct 2026** (Sam saw MSC "from Valencia with
  Stay" listed as no-fly: Planet Cruise gives a fly-cruise package's departure as the UK airport, "London Heathrow", which
  matched "London"): a departure matching `AIR` (airport, Heathrow, Gatwick, Manchester…) is a flight (`flights`, shown as
  "flights from …"), the cruise's own start/end come from the title; `competes()` uses `ends()` (start, end, stay):
  no-fly = starts and ends at a UK port with no stay abroad (one-way crossings and "with New York Stay" packages are
  out); fly-Caribbean = starts in the Caribbean, or sails between the UK and the Caribbean. On 15 Oct 2026's data:
  26 sailings dropped (Valencia, Barcelona, Florida, Hawaii, Buenos Aires, QM2 New York stays), 5 moved to fly-Caribbean. After the forced re-run 11 more
  were found with a port line of just "Southampton" but a title saying "… from Southampton to Barcelona" or "Niagara Falls & New
  York Stays with …": `ends()` now also reads the end port and any stays from the title (only the words after "with"). Departures at least `MIN_DAYS` = 7 ahead, no
  upper limit. Each candidate page is read once to see whether it competes; ones that don't are kept in `tried` and
  never read again (up to `NEW_PER_RUN` = 80 new pages a line a day, Fred. Olsen's ~180 on day one, so the lists are
  discovered within about a week); competing ones (`sample` in state, kept for continuity) are read every day, and a
  tracked sailing that stops competing is dropped. Ambassador at Planet Cruise stays a sample of `CAP` = 20. Sources:
  Planet Cruise's per-line product sitemaps (at most 500 sailings a line, which is everything for most lines; P&O,
  Princess, Cunard, MSC, Royal Caribbean and Celebrity list exactly 500 and page 2 repeats page 1, so a few far-off
  sailings may be missing; its ship pages only feature 9), Marella from its line page, Fred. Olsen's sitemap.
  Volume (estimate, 15 Oct 2026): ~1,000 competing sailings a day once discovered, `PAUSE` = 2 s → 30–50 minutes; robots.txt
  checked before every request, one at a time, honest User-Agent, `--max-pages` 2500. **Own workflow**
  `.github/workflows/competitors.yml` (manual with a "force" box, a 07:37 UTC backstop, concurrency `competitors`,
  150-minute limit, commits `state/competitors` and `runs/competitors` with pull-and-retry, opens "Competitor check
  FAILED" on failure, then publishes): the hourly price watch's **Start the competitor check** step starts it at the first
  check of a UK day (`actions: write`; skipped when today's check is done, or one is running or ran in the last 3 hours).
  Read per sailing: title, ship, port, date, nights, `segment` (no-fly / fly-caribbean), per cabin type (inside / outside /
  balcony / suite, plus Fred. Olsen's terrace and single) the from price pp for two sharing, Planet Cruise's "was" figure
  and fare name, Fred. Olsen's solo prices and fare ("Freedom Fare"); offers: Planet Cruise's promo line and offer-like
  tags (`OFFERISH`, minus `NOT_OFFER` features), Fred. Olsen's brand-wide deals (each /cruise-deals page's headline and
  first line; pages saying the deal is closed are skipped). → `state/competitors/current.json` (prices as segments {p,
  was, from}, last 24 changes; offers [[from, to]]; `gone` when a sailing departs or leaves the list; a cabin type no
  longer priced → a null segment; gone ones dropped after 60 days) and `runs/competitors/DATE.json` (price_drop /
  price_rise / cabin_off / offer_added / offer_ended / new / gone). Safety stop: fewer than half the pages read → nothing
  saved, exit 2. The first sample-based version ran live 14 Oct 2026 (129 pages, 6.5 min).
- `publish.py`: `pricewatch/comp-current` (meta, brand-wide offers, `parts`), one `comp-<line>` document per cruise line
  with its sailings (a single document would near Firestore's 1 MiB), and `comp-runs` (last 60 days, ≤ 400 KB).
- Tracker page, its own menu group **Competitors** (Sam, 15 Oct 2026: "a separate section in the nav… an offers and vs
  Ambassador section"; `site/competitors.js`, UK only, data read once and shared, redrawn whenever one of the pages is
  opened; filters shared and remembered per browser, `spw-comp`): **Competitor prices** (tiles with no-fly / fly-Caribbean
  counts; every competing sailing (first 300, "Show all") with filters line / cabin type / two sharing or solo / month /
  no-fly or fly-Caribbean / sort, from price, was, fare, per night, change
  over 7 days, offers; what changed in the last 7 days; CSV). **Competitor offers** (their live offers: Fred. Olsen's
  brand-wide deals and each line's offers with "N of M sampled sailings"; ended in the last 30 days; **Ambassador's own
  live promotions** from our state for comparison). **Vs Ambassador** ("Typical price per night" by line and cabin type,
  median, with **Ambassador (our website)** over the same months and "we're N% cheaper/dearer" per cell; head to head by
  line: sailings matched, "we're cheaper on N of M", typical difference; every matched sailing against **our closest** =
  our cheapest of the same cabin type in the same month, within 3 nights' length, no-fly against our no-fly and
  fly-Caribbean against our fly-cruises, linked to its detail
  view, sorted where we're dearest first; CSV; and **Ambassador at Planet Cruise vs our website**: the agent's price per
  cabin type for our own sailings, matched by ship and date). Not done: Saga; iglu (the
  same data as Planet Cruise).

## Competitor offers: newsletters and live ads (15 Oct 2026, Sam: "build 1 and 2")
Sam found the scraped offers unreliable (old, marketing lines rather than promotions, no click-through). The
**Competitor offers** page now leads with:
- **Their live ads** (own menu page **Competitors → Competitor ads** since 15 Oct 2026, Sam; `renderAds`, needs no price data; Competitor offers points to it): per brand (P&O, Princess, Cunard, Marella, Saga, Fred. Olsen, MSC, Royal Caribbean, Celebrity;
  `BRANDS` in `site/competitors.js`) links to the Meta Ad Library (name search, UK) and Google's Ads Transparency
  Center (by domain, UK). Links only: nothing is read from those pages.
- **Facebook and Instagram ads from Meta's Ad Library API** (`meta_ads.py`, Sam, 15 Oct 2026: "grab them from ad libraries";
  Sam set up a Meta developer account; checked 15 Oct 2026: the API returns all kinds of ads shown in the UK and EU, kept a
  year after they stop; no pictures/videos: downloading them from the library's pages would be collecting from the site,
  which Meta's terms forbid). Hourly workflow step "Competitor ads (Meta Ad Library)", once a UK day (`read_on`; `--force`),
  `continue-on-error`: each brand's own Facebook page(s) found by a name search whose page name must match in full
  (`BRANDS`, e.g. `^P&O Cruises( UK)?$`, so fan and agent pages are left out; re-found weekly; `meta_pages.json`
  {"<brand>": ["<page id>"]} fixes them by hand), then every ACTIVE ad they've shown in the UK (`ad_reached_countries` GB,
  100 a request, at most `MAX_CALLS` = 120 a run): page, start/stop, words (body cut to 600, headline, description),
  platforms; an ad no longer active → `ended`; ended ads dropped after `KEEP_DAYS` = 120. → `state/competitors/meta_ads.json`
  → `publish.py` `pricewatch/comp-meta` (summary) + `comp-meta-<brand>`. The token is repo secret `META_AD_LIBRARY_TOKEN`
  (Graph API Explorer → Generate Access Token → Access Token Debugger → Extend: ~60 days); `ad_snapshot_url` carries the
  token, so it is never requested or stored ("View ad" = facebook.com/ads/library/?id=<id>). Rejected token or refused
  access → `out/meta_ads_problem.md` → "Competitor ads: Meta token needs renewing" issue with the fix. Optional repo variable
  `META_API_VERSION` (e.g. v23.0; empty = the app's default). Page **Competitor ads**: per brand live UK ads, new and ended
  in 7 days, longest running, library links; ads grouped where the wording is the same ("N versions", View ad 1–3),
  filters (brand, words, running now / ended in 30 days, started in 7/30 days), CSV. Tested 15 Oct 2026 against a fake API.
- **From their newsletters** (`offers_inbox.py`): a team mailbox signed up by hand to the brands' marketing emails
  (receiving emails the brands send us is not covered by their website terms). Hourly workflow step "Competitor
  newsletters" (`fetch`): IMAP over SSL, inbox opened **read-only** (EXAMINE, `BODY.PEEK`: nothing marked read, moved
  or deleted), emails from the last `DAYS` = 30 whose sender matches a brand; never opens a link or loads an image.
  Keeps subject, preheader, date, text, the "view in browser" link and the email's own links (unsubscribe, social and
  preference links dropped). Simple rules pick offer-like lines and an end date first ("found by rules: check"); then
  "Read new newsletters with Claude" (`extract`, up to `PER_RUN` = 25 a check, on Sam's plan via
  `CLAUDE_CODE_OAUTH_TOKEN`, model `claude-opus-5-5`, no tools, `--json-schema`) decides whether it's a promotion and
  lists the offers; its answer is checked (`checked`: a link must be one of the email's own, an end date a real
  date). → `state/competitors/inbox.json` (kept `KEEP_DAYS` = 90) → `publish.py` `pricewatch/comp-inbox` (no email
  text, newest 400). Page: grouped by brand, last 30/90 days, View email / Offer page links, "ends" chips, non-offer
  emails folded away. Fred. Olsen's deals pages and Planet Cruise's agent lines (now folded, secondary) stay below.
- **Setup (Sam, one-off)**: a new mailbox, Gmail recommended (Microsoft 365 usually blocks IMAP passwords) with 2-Step
  Verification and an **app password**; repo secrets `OFFERS_IMAP_USER` (the address) and `OFFERS_IMAP_PASSWORD` (the
  app password; spaces are removed), and repo variable `OFFERS_IMAP_HOST` only if not Gmail (default
  `imap.gmail.com`). Then sign it up on each brand's website. Until the secrets exist the step is skipped and the page
  says the inbox isn't set up. Repo variable `OFFERS_CLAUDE` = `off` keeps the rules only (no plan usage).
  Set up by Sam, 15 Oct 2026 (Gmail with an app password; signed up to all nine brands).
- **Competitor emails: the email library** (Sam, 15 Oct 2026: "a library of competitor emails to be able to view,
  filter, compare etc for the email team"; menu Competitors → Competitor emails, `site/compemails.js`, UK only, everyone
  on the allowlist). Workflow step "Add new emails to the email library" (`offers_inbox.py archive`, after the card
  steps, sharing their browser install; `continue-on-error`) reads each new email again (read-only, by IMAP UID, else
  Message-ID), makes it safe (`safe_html`: scripts, frames, forms, event handlers, javascript: links, refresh/base
  tags and 1 px tracking pixels removed; unsubscribe/preference links switched off, `data-spw-off`) and uploads it with
  a thumbnail (top 1,400 px at half size, JPEG) to Storage `pricewatch-emails/<YYYY-MM>/<id>.html` / `_thumb.jpg`
  (~100 KB an email; free allowance). Pictures inside the emails stay on the brands' servers (copying them would pass
  the free allowance). Kept `LIBRARY_DAYS` = 730 (text only `KEEP_DAYS` = 90), then deleted with their files; at most
  `ARCHIVE_PER_RUN` = 40 a check, 3 tries each. Claude's answer (same call as the offers) also gives `kind` (`KINDS`),
  `summary`, `headline`, `cta`, `destinations`, `from_price` (kept only if the email quotes that £ figure:
  `checked_meta`); without Claude `rule_meta` (`DEST` regions). → `publish.py` `pricewatch/comp-emails-YYYY-MM-1/-2`
  (`LIBRARY_FIELDS`, rewritten only when changed; listed in `comp-inbox` `parts`). Page: filters (words, brand, type,
  destination, offers, period up to 2 years, sort, remembered `spw-comp-emails`), "How each brand sends" (emails, a
  week, % with an offer, Mon–Sun counts, usual UK send time, mostly which types, latest), pictures or list, the viewer
  (the email in a sandboxed frame without scripts and a CSP allowing only pictures/styles/fonts, Desktop 680 / Phone
  390, previous/next, details, links, View in browser), Compare (2–4 side by side, scaled, with a row-by-row table),
  CSV. Tested 15 Oct 2026 with fake mailbox data (nothing published).

## Competitor offers page, rebuilt (16 Oct 2026, Sam: "needs improvement"; picked grid, new/ended, clean-up, timeline)
`site/offerkit.js` `collect()` gathers every offer into one list (brand, wording, `types`, `value`, sources, reach "on N
of M sailings", first seen, ended, own end date) from the newsletters (`email`), Fred. Olsen's deals pages (`deals`),
Planet Cruise's lines on every sailing (`agent`; Ambassador-at-Planet-Cruise left out) and our own promotions (`ours`),
merged by brand and wording (`keyOf`: case, punctuation, asterisks). `TYPES`: onboard credit, discounts, low deposit,
free extras, past guests, solo/children/family, transfers and flights, flash/late/launch. Not offers (no type, or
`NOT_OFFER`: "Book the Select Price fare…", "Book this deal online") are dropped; a saving on flights or flight seats is a
travel offer, not a discount (`FLIGHT_SAVING`). `valueOf`: biggest credit / % or £ saving ("save up to £750", "£550 cabin
savings", never "£1pp deposit"), smallest deposit. `endsIn`: an end date in the wording ("Must end Mon 12th Oct", "Book by
… 20th October 2026"; year assumed) → past = ended (`expired`); `staleSince`: a dd/mm/yy date over 60 days old ("price
correct at time of send 05/02/26") → "probably an old offer", kept out of the grid. Page (`renderOffers` in
competitors.js; filters brand incl. Ambassador, offer type `st.otype`; CSV): **Who's offering what** (brands × types,
Ambassador first; best figure and share of sailings; clicking one filters the list), **New and ended in the last 7 days**
(new = first seen after recording began for that brand and source (`baselines`, "source|brand"); for Planet Cruise only
when it appeared on a sailing already being read (`fresh`), since sailings found later bring offers already running),
**Every live offer** (our onboard credit tiers grouped as one row, `groupOurs`; ended / out-of-date folded), **When each
offer ran** (bars per brand, folded except Ambassador or the chosen brand), **Their newsletters** (each email and its
offers; pictures in Competitor emails).

## Competitor prices and Vs Ambassador: trends (16 Oct 2026, Sam: "do better at displaying trends over time… as well as vs ambassador"; picked all eight)
`site/comptrend.js` (pure helpers): **destination regions** (`REGIONS`, `regionOf`: Caribbean, Iceland and the Arctic,
Norway, Baltic and Scandinavia, British Isles, Spain/Portugal/Atlantic islands (also "Southern"/"Western Europe" cruises),
Mediterranean, Holland/Belgium/Germany/France, long-haul; most keyword hits wins) from their titles and, for ours, our
title plus our page photos' file names (ad kit `photos`, `photoWords`; passed in as `getAdkit`); on 16 Oct 2026 218 of
223 of ours and all but ~54 of theirs ("Northern Europe cruise", themed sailings) got one. `priceOn(segs, d)`,
`chainIndex` (first day 100; each day moves by the mean log change of the sailings priced on both days, so sailings
found later or departing don't move it), `movesOf` (changes after a sailing's first reading), `lineChart` (SVG in the
tracker's chart style: direct labels, hover tooltip, `step` for price histories, `zero` line; a single day still draws).
competitors.js: shared controls gain **destination** (`st.region`); our sailings keep each cabin type's history (`sg`)
and `region`; `candidates(r)` = ours in the same month, ±3 nights, same no-fly/fly and, with **Match destination too**
(`st.like`, default on), the same region; `ourMatch(r, occ, cab, d)` works on any past day.
- **Competitor prices**: Price trend by line (index chart per line with Ambassador bold, weekly beyond 6 weeks; table of
  sailings, typical per night now and change since the first day), Price moves per week (↓/↑ counts and average change
  per line and week, Ambassador first; biggest cuts in 7 days), By departure month (line × month typical per night,
  green/red where we're ≥5% cheaper/dearer), and **Price history** on every sailing (step chart per cabin type, our
  closest's dashed, Planet Cruise's "was" figures, offers with dates). CSV gains Destination.
- **Vs Ambassador**: Where we're losing (line × month × cabin × no-fly/fly groups where our closest is typically ≥10%
  dearer, at least 2 sailings; their cuts in 7 days that took a sailing below our closest), The gap over time (per line,
  daily median of ours vs theirs per night; the first days jump while sailings were still being found), the typical
  table and head to head (destination-aware; how many of theirs couldn't be placed is said), **Solo: us against Fred.
  Olsen** (month × cabin, ours vs theirs per night), Ambassador at Planet Cruise.

## Google Ads: banner fixes and a Performance Max preview (16 Oct 2026, Sam: "build a preview viewer for the PMAX assets"; "this PMAX size doesn't look good, fix the logo size and the padding of the CTA")
- **Banners** (`gbanners.js` `bannerDoc`): the skyscrapers (300×600, 160×600) are rebuilt: the logo sits on the photo
  under a Palatyn scrim (it was at the bottom of a flex column and got squashed to nothing), name and details under it,
  then the price and button together at the bottom with fixed spacing (`.bottom`, `margin-top:auto`); sizes follow
  the width capped at 1.5× the 160 design (`f`), narrow ones get 4 lines for the name and a taller photo. Rectangles'
  logo bigger (7% of the width, at least 16 px) and their button can't be pushed out; `fit()` now checks every element
  against the banner's edges and shrinks the name too.
- **Preview tab** (`site/gpreview.js` `previewHtml`, `googleads.js` `previewMain` / `wirePreview`): the chosen
  sailing's assets in Google's placements, phone or desktop: Search (text ad with the Search headlines/descriptions,
  display path, square image, sitelinks), Display (the responsive ad Google builds: landscape image, long headline,
  description, logo, button; and the uploaded 728×90 / 320×50 and 300×250 banners on a page), YouTube in-feed and
  Shorts (portrait image), Discover, Gmail (Promotions row and opened). Text from the Ad copy tab (edits kept), images
  as the Images tab makes them (photo only or card design), the banner button text. "Show another mix" steps through
  headline/description combinations (Google mixes them itself; the page says it's a guide, not Google's own preview).
  The mock-ups' CSS is scoped (`.gp-dev` resets) so the tracker's styles don't leak in.

## Route video per sailing (16 Oct 2026, Sam: "a route video per sailing, on each of the sailing cards using this as the template")
Template: Sam's A32651 Tropical Treasures video (1080×1920, 64 s; three versions: Heathrow, Manchester, combined). Sam
picked: the template's music; 9:16, 4:5 and 1:1; Renaissance reuses the template's ship clip, Ambience/Ambition their ship
photo with a slow zoom; words over the ship default by destination, editable. UK only. No prices in the video.
- `route_data.py`: the sailing page's Astro props (the hourly enrich reads the same pages): `Itinerary` items (port code,
  name, country, times, the port's own photo `port.content.image`), FareSummary `search-data` (ship, `isFlyCruise`,
  `flights[].airportCode`, `outbound` / `inbound` → `fly_out` / `fly_home`: A32650 sails from Tilbury and only flies
  home). Port positions: **`route/ports.json`** (all 156 ports on sale on 16 Oct 2026, checked by hand: UN/LOCODE had
  Belfast, Douglas, La Coruña, Getxo and Newcastle Tyne in the wrong places) → else UN/LOCODE (downloaded, flagged in the
  run summary "placed from UN/LOCODE: look at the map") → else the port is left off (summary says so; add it to
  ports.json). Coastlines: Natural Earth 1:10m land + minor islands (public domain), downloaded into `img_cache/route`
  (kept between runs by actions/cache). `sea_route`: A* per leg on a land grid (land cells cost 60, not forbidden, so
  ports deep in fjords work; cells near the coast cost a little more), pulled tight, Chaikin-smoothed.
- `route_video.py` (PIL + ffmpeg, ~2 min a size on a laptop): scenes as the template: (fly out) UK map, planes leave the
  airport(s) on great circles → plane lands at the first port → the voyage (purple capsule ship with the template's
  pointed bow on a dotted route, camera following: `follow_rect` 5–10° of longitude across, ship kept inside 22% of the
  edges; port dots and names; Pearl sea `SEA`, Aloe land `LAND`, Amber first port) → whole route → a photo per port
  (each once, the page's port photos, up to 9, 1.6–2 s; name in spaced capitals over a purple fade: the island where the
  country is the island, "BONAIRE", else the town, "for Bergen" → "BERGEN") → (fly home) planes into the UK airport(s)
  → the ship (`route/renaissance.mp4`: the template's clip 53.2–57.7 s with its words painted out from the sky's edges;
  else `site/ships/<ship>.jpg`) with the words fading in word by word → the template's end card (`route/end_*.png`
  cut from its last frame: logo, tagline container, booking line, ABTA/ATOL/Nectar; purple bar), entered with a white
  20° wipe. Land drawn fresh each frame (2× anti-aliased, coastline clamped to the frame) so it stays sharp at any zoom.
  Length fitted under the music (`timeline`, ≤ ~60 s; music `route/music.m4a` from the template, faded out). Text in
  Quicksand (`route/Quicksand.ttf`, OFL). Defaults: "<PLACE>, THE WAY IT SHOULD FEEL." (THE CARIBBEAN, THE FJORDS (THEY),
  ICELAND, THE BALTIC, THE BRITISH ISLES, SPAIN AND PORTUGAL, THE MEDITERRANEAN, EUROPE) and "Smaller ship. Direct
  flight. Everything sorted." (flies out) / "Smaller ship. Sail from <port>. Everything sorted.". Files
  `route_<code>_<size>_<secs>s.mp4`, `info.json`, `summary.md`.
- `.github/workflows/route-video.yml` (manual: cruise code, airports, words, sizes; or from the tracker page with
  `request`) → `video_job.py` uploads to Storage `pricewatch-videos/<id>/` as the Ad creator's videos (30 days).
  `functions/index.js` `makeVideo` takes `{kind: "route", sailing, airports, headline, line}` (words cleaned and cut to
  90 characters; same daily limit of 20 and 2 waiting per person) and dispatches it; GET returns `kind`, `headline`,
  `airports` (the Ad creator's Videos list leaves route videos out).
- Tracker page: **Route video** section in a sailing's detail view (`site/routevideo.js`; UK, on sale): words over the
  ship and the line under them (defaults shown in grey, from `comptrend.regionOf`), **Planes from** for fly-cruises
  (default both airports, as the template's combined version: every fly-cruise has a Manchester twin, A32651 ↔ A32651M;
  or either one), Make route video, and the sailing's route videos (both twins'), with downloads and ▶; checks every 20 s
  while one is being made. If the function can't be reached it opens the GitHub workflow with what to type. The Cards
  page has a "Route video" link per sailing that opens the detail view at that section.
- Tested 16 Oct 2026 (locally, nothing uploaded): A32651 (combined airports, all sizes), A12704 (Norway fjords, no-fly),
  A32650 (Tilbury → Caribbean, flies home); the page section against a stand-in function.

## Landing pages and blog posts: PROTOTYPE (16 Oct 2026, Sam: "scope out and prototype landing and page blog creation functionality")
How the website's pages are built (read 16 Oct 2026; Storyblok CMS rendered by Astro, server-side): **landing pages**
(/cruise-types/…, /deals/…, /no-fly-cruises/…) = hero (H1 in capitals, subtitle) → `CruiseList` island (props `category` or
`cruise-codes`, `count`, `sort-by` date:asc, `use-solo-pricing`) → H2 text sections → FAQs → terms; **blog posts** (266 under
/blog/) = date, H1, intro, H2 sections with pictures, "READ MORE:" internal links, closing call to action, ~1,300 words; no
schema.org markup on either (FAQPage / BlogPosting / ItemList are an easy SEO win). Titles "… | Ambassador".
`site/pagemaker.js` (SEO → **Pages and blog**, its own menu section since 16 Oct 2026; UK only, "Prototype" chip): starting points from the tracker's data, no AI:
landing = destination/port (region via `comptrend.regionOf`, port, no-fly/fly, months, ship), campaign or offer (sailings by
cruise code), month or season; blog = "10 reasons to…", destination guide, sailing spotlight. Fills SEO title, meta
description, address, H1, intro, sections (the brand section from the messaging matrix), FAQs from the facts (from price,
ports, lengths, ships), the sailings list and photos from the ad kit; sections still to write show as amber hints. Block
editor (section, picture, sailings, FAQs, read more, button; move/remove; `[words](/path/)` links, "- " lists), hero/picture
picker with alt text (suggested from the file name), sailings by filters or picked by hand. Preview in the site's style
(iframe, desktop / phone). **Checks**: title 30–60, description 120–155, keyword in title/description/H1/first
paragraph/an H2/address, words (landing 300+, blog 800+), H2 count, alt text, internal links, every £ figure a current from
price of the page's sailings, reduction wording next to a price refused (was/now only from a live claim). **Exports**: "Copy
for Storyblok" (every field labelled, the CruiseList's cruise codes, the JSON-LD), "Download HTML" (a standalone page to
share for review), "Copy schema". Draft in the browser (`spw-pages`). Nothing is published.
**Draft with Claude for pages** (Sam, 16 Oct 2026: "build Draft with Claude for pages"): a "Draft with Claude" section
at the top of the page creator (`drafts.js` kind "page"). The request carries the page's outline (kind, starting point,
keyword, H1, each text section's heading and guidance, the FAQ questions) and up to 24 of its sailings (with their live
offers); the `drafts` function cleans and stores it (`page`, JSON); `draft_job.py` builds the facts from saved state as for
ads, adds each of the first 8 sailings' **ports of call** from its page (`route_data.read_sailing`, `add_ports`), and asks
Claude (Opus, Sam's plan, no tools, `PAGE_SCHEMA`, up to 9 minutes) for one draft: SEO title (≤ 60, "| Ambassador"),
meta description (120–155), H1, intro, every section (blog 120–200 words, landing 70–140) and FAQs, using the keyword
naturally, internal links only from `PAGE_LINKS`, places from general knowledge without precise figures, ports only
from the facts. `check_page`: any part quoting a figure not in the facts (or reduction wording without a claim) is
left empty with a note; the rest is kept. "Use this" fills the title, description, H1, intro, sections (in order)
and FAQs; pictures, sailings and links stay. The page's £ check accepts the sailings' offer figures too. Tested 16 Oct
2026: a Norway guide (5 sailings) drafted in 99 s, 834 words, nothing left out; the page flow against a stand-in
function. Draft text workflow limit 10 → 15 minutes.
**Saved pages** (Sam, 16 Oct 2026, point 2): Save as… / Save / Save a copy… / New page and **Saved pages (N)** (the
`saved.js` dialog, both page types together, "Landing page · H1 · keyword") in the team's shared list (`saved` function
kind "page"; browser-only `spw-pages-saved` if it can't be reached), as the Ad creator: anyone can open or copy, only
the person who saved one can change it. The whole page is saved, never prices. `normalise()` on opening: hand-picked
sailings no longer on sale are taken off ("brought up to date"); no sailings matching, or £ figures in the text that
aren't a current price or offer, are "still to fix"; both show as "Needs updating" in the list. `st.saved` keeps the
open page's saved id per page type.
**Keyword ideas from Google Search Console** (Sam, 16 Oct 2026, point 4; Search Console chosen over Semrush): `seo_gsc.py`,
hourly workflow step "Search Console queries" once a UK day (`continue-on-error`), Search Analytics API (query + page,
last `DAYS` = 90 days ending 2 days ago, `dataState` final) with the Firebase service account (scope webmasters.readonly),
property picked from the ones it can see (a Domain property first) → `state/seo/gsc.json` {pages, queries [[query,
clicks, impressions, position, [page index]]], most impressions first, `MAX_QUERIES` = 8000; `problem` says what's missing
if it can't read (API not switched on / account not added)} → `publish.py` `pricewatch/seo-gsc`. **Setup (Sam, one-off)**:
Google Cloud promotions-planner → APIs & Services → Library → Google Search Console API → Enable; Search Console → the
site's property → Settings → Users and permissions → Add user → the `firebase-adminsdk-…@promotions-planner.iam.gserviceaccount.com`
address, **Restricted** (read-only). Page creator: "Keyword ideas from Search Console" section: searches sharing a word with
the page's topic (keyword, H1, destination; `STOP` words left out) or a typed search, with impressions, clicks, average
position ("page 2" from 11), the page of ours they land on; "Use as keyword", and "Add to FAQs" for questions.
**Duplicate check against the website** (Sam, 16 Oct 2026, point 5): `seo_pages.py`, hourly workflow step "Website pages
for the duplicate check" once a UK day (`continue-on-error`): every sitemap page except /cruise/ (481 on 16 Oct 2026), title,
meta description and H1 read (new pages first, each again after `REREAD_DAYS` = 7, at most `PER_RUN` = 150 a day, 0.5 s
apart; dropped when they leave the sitemap; a sitemap under 50 pages changes nothing) → `state/seo/pages.json` {pages
{"/path/": {t, d, h, r, s}}} → `publish.py` `pricewatch/seo-pages`. Page creator checks (`dupes`): same address or same
SEO title (title before "|", normalised) = ✕; SEO title very like (word overlap ≥ 0.75, `STOP` words left out) or same H1 =
warning; pages whose title/H1 has every word of the keyword = "already aimed at this keyword" (they'd compete in Google);
listed under Checks with links, one row per page (`dupeRows`). First read 16 Oct 2026: the site already repeats titles
("Cruise drinks packages" ×4, "Travel partners login" ×12, "Blog" ×3); a Norwegian Fjords landing page exists at
/destinations/fjordland-cruises/ with 7 Norway blog posts on the same keyword.
Not built: Storyblok Management API to create a **draft** story (needs a Storyblok token and the space's component
names; a person still publishes); Semrush keyword data (needs an API key).

## Core Web Vitals (17 Oct 2026, Sam: "a core web vitals checker and competitor analysis tool"; content coverage left out)
`seo_cwv.py`, once a UK day in its own workflow `.github/workflows/cwv.yml` (manual with "force", 08:23 UTC backstop,
concurrency `cwv`, commits `state/seo/cwv.json`, then publishes), started by the hourly price watch's **Start the Core Web
Vitals check** step (skipped when today's read is done or one is running). Google's free APIs only, with one API key:
- **Real visitors** (Chrome UX Report API, phone and desktop, 75th percentile of the last 28 days: what Google ranks
  with): LCP, INP, CLS, TTFB for our origin and the competitors' (`COMPETITORS`: P&O, Princess, Cunard, Marella (all of
  tui.co.uk), Saga, Fred. Olsen, MSC, Royal Caribbean, Celebrity, Planet Cruise), plus ~6 months of weekly history (CrUX
  History API). This is Google's public dataset: **nothing is read from the competitors' sites**, so their terms don't
  come into it. A site without enough Chrome visits (404) shows "not enough Chrome visits".
- **Lab test** of our own pages (PageSpeed Insights API, Lighthouse, mobile and desktop, `WORKERS` = 4): `PAGES` (home,
  no-fly, festive markets, Caribbean no-fly, Norway, offers, cruises of the week, search, ships, blog) + one on-sale
  sailing per ship (soonest) + 3 blog posts (most Search Console clicks, from `state/seo/gsc.json`): score, LCP, TBT, CLS,
  FCP, speed index, the top 5 opportunities (≥ 100 ms), and the page's own field LCP (or the site's, `field_src`).
  Scores kept `LAB_DAYS` = 180 in `lab_history` (sparklines).
- A phone metric of ours dropping a rating (good → needs improvement → poor) → `out/cwv_alert.md` → "Core Web Vitals got
  worse — DATE" issue; a failed run → "Core Web Vitals check FAILED — DATE".
- → `publish.py` `pricewatch/seo-cwv` → page **SEO → Core Web Vitals** (`site/cwv.js`): Phones/Desktop, our four
  tiles with Passes / Doesn't pass, the competitor table (rank "N of M"), over time chart by metric, our pages worst
  first (click: what would help, link to pagespeed.web.dev).
- **France** (Sam, 17 Oct 2026): `seo_cwv.py --market fr` (second workflow step, `if: always()`, `continue-on-error`, own
  "France: Core Web Vitals got worse" / "France Core Web Vitals check FAILED" issues): ambassadorcroisieres.fr against
  `COMPETITORS_FR` (MSC msccroisieres.fr, Costa costacroisieres.fr, Havas Voyages, Croisierenet, Ponant; CrUX only, so
  Croisierenet's terms don't come into it), lab test of `PAGES_FR` (home, /croisieres, /offres, Dernière chance, three
  destination pages, /navire, /vie-a-bord) + one sailing per departure port → `state/fr/cwv.json` → `fr-cwv`; the same
  page in France (ours is always the first site; if Google has too few Chrome visits to our French site it says so and
  the lab test still shows).
- **Setup (Sam, one-off)**: Google Cloud console → promotions-planner → APIs & Services → Library → enable **PageSpeed
  Insights API** and **Chrome UX Report API**; Credentials → Create credentials → API key → restrict it to those two
  APIs; repo secret `PAGESPEED_API_KEY`. Until then the page says what's missing. Tested 17 Oct 2026 with fake API answers
  (Google's shared keyless quota answered 429).

## France: competitor prices (16 Oct 2026, Sam: "check havas" then "go ahead and build it")
**Terms review** (15–16 Oct 2026, read-only, robots.txt + terms + one sample page per site): France's real competitors are
**MSC and Costa** (Marseille and the French Caribbean; nobody else is based at Dunkerque; Ponant and Club Med 2 sail the
Caribbean too, at other prices). Not read: MSC's own site (blocks, 401), Costa's own site (no website terms, but prices
only by JavaScript), Club Med, Royal Caribbean, Celebrity, Celestyal (terms forbid); every French agent except Havas:
**Croisierenet / Croisières.fr** ("à des fins personnelles et en aucune manière à des fins commerciales"; Sam asked
for Croisières.fr on 16 Oct 2026 and was told it needs their written permission or legal sign-off: not built),
abcroisière / Promovacances / PromoCroisière (Karavel: database extraction banned), Selectour, Carrefour Voyages
(forbid), Croisiland (no prices in its pages), lastminute / E.Leclerc / Directours (Cloudflare blocks). **Havas
Voyages** (havas-voyages.fr) has no website terms of use (its "Informations légales" are company details only; its
booking and offer conditions say nothing about using the site), robots.txt allows the cruise pages (not /ajax/, /serp?,
/account), no block: read as Planet Cruise is in the UK. French database law (CPI L.342-1) still covers systematic
reading: Sam's legal sign-off as for the UK. Notes: scratchpad only (not in the repo).
- `competitors_fr.py` (in `competitors.yml` after the UK check, step "Read French competitor prices (Havas Voyages)",
  `if: always()`, `continue-on-error`, own "France competitor check FAILED" issue; commits `state/fr/competitors.json`
  and `runs/fr/competitors/`): `competitors.Site` (robots.txt before every request, `PAUSE` 2 s, `Accept-Language`
  fr-FR). Cruise pages from `sitemap_produits.xml` (`/c-croisiere/`, ~730; it is ~7 MB, sometimes cut off or a
  "Maintenance Page" 504: retried, and a cut-off sitemap never marks anything gone). Its addresses carry an apostrophe
  ("cote-d'azur-…") that the server rejects with 400: dropped. `slug_rank`: Costa's addresses start with the departure
  region and town (`FRENCH_SLUG`), MSC's (and some Costa ones) with a country on the route and "-0-", so those are read
  once to see where they depart (~380 candidates, `NEW_PER_RUN` = 150 a day, then `tried`). A page gives (HTML only):
  `to-label` (line), h1 title, ship, "Réf" (the id), `final-price` "À partir de 139€ TTC /personne", `package-time`
  nights, the day-by-day `cruise-day-title` ports (MSC's are UTF-8 encoded twice: `fix`). **No dates and no cabin
  types** (the "Dates et tarifs" box loads by JavaScript through /ajax/, disallowed): one from price per itinerary.
  `competes`: starts and ends at a French port (`PORTS`: med / north / antilles), as ours (round trips from Dunkerque,
  Marseille, Pointe-à-Pitre and a few between them); one-way trips ending abroad (Marseille → Naples) and crossings
  (Las Palmas → Guadeloupe) are out. Record per itinerary: line, ship, title, start/end, ports, area, nights, link,
  `prices` segments {p, from}; `gone` on 404 / no price / no longer in a complete sitemap (dropped after 60 days).
  Runs: price_drop / price_rise / new / gone. Safety stop: under half the pages read → nothing saved, exit 2.
- `publish.py`: `pricewatch/fr-comp` (without `tried`) and `fr-comp-runs` (60 days, ≤ 300 KB).
- Tracker page, France: **Competitor prices** and **Vs Ambassador** shown (`FR_HIDE` no longer hides them; headings
  "Competitor prices · France", "Ambassador Croisières vs competitors"); `site/competitors_fr.js` (own filters
  `spw-comp-fr`: line, area, length 2–4 / 5–8 / 9+ nights, sort). Prices page: tiles, every itinerary (from € pp, per
  night, 7-day change, link to Havas), what changed, CSV. Vs page: median price per night by area and length, ours
  (cheapest twin cabin, `segments`, sailings on sale; Dunkerque → north, Marseille → med, Pointe-à-Pitre → antilles)
  against MSC and Costa, and each itinerary against our cheapest per night in the same area within 3 nights' length at
  any date ("Havas's pages give no dates"), dearest first, CSV. Competitor offers / ads / emails stay UK only.
  Tested 16 Oct 2026 against the live site (discovery runs on a scratch copy; nothing committed).

## Design system v4.3 (16 Oct 2026, Sam: "make sure these changes are pushed to all aspects of this app")
Sam updated the "Ambassador Cruise Line" design system (claude.ai artifact XAtqddrEMdLfjbSyPFLXVz) to Brand Guidelines
v4.3 and the FINAL messaging matrix (14 Oct 2026; its `messaging.md` section). Checked across the app: colours (all hex
values already match), text on Amber (white or Allium only, never black: already so on cards, banners, email badges),
the logo on photos (whiteout with the Palatyn scrim, never in a box: already so). Changed:
- **Messaging matrix** ("Welcome to…" headlines by theme; "the warmest welcome at sea - because moments matter" across
  every theme; button labels): `adcopy.js` new "Welcome to…" suggestion (no-fly "Welcome to hassle-free holidaying",
  fly "Welcome to fly-cruising without the fuss", mixed "Welcome to holidaying your way"; also in the Email creator's
  suggested intros) and the Value option ends with the brand line; Ad creator opening card headline left blank =
  that theme headline (`autoHeadline`, shown as the placeholder; Meta headline blank = the same), closing card
  defaults "The warmest welcome at sea - because moments matter" / "Book your sailing today" (ads saved with other
  words keep them); `withA` keeps the word holding the Ambassador A on one line; `gcopy.js` theme headline,
  "Because moments matter" and the brand line in Search / PMax / Demand Gen; Google banner buttons Book now / Find
  out more / Discover more / View cruise ("Explore" dropped; a saved one is kept); Email creator button default
  "Discover more". `draft_job.py` VOICE: v4.3 vocabulary (never "The Renaissance", "Ambassador Cruises", "ACL",
  boats, "green"), the matrix lines, and the proof points "94% of our guests would recommend Ambassador" and "best
  value at sea" (Cruise Critic); `PROOF_FIGURES` lets 94% through the figure check.
- **Taviraj** (secondary typeface, v4.3: "mainly alternative body copy for the French market", 11pt minimum, never
  headings): French emails' intro is set in Taviraj (Google Fonts link added only then; Georgia fallback), with a
  tick box "Intro in Taviraj" (`em.taviraj`). Not used on cards or Email cards (their text is headings or under 11pt).
- Not changed, for Sam (design system says otherwise): the was/now cards' rounded sticker and panel with shadows and
  the logo's drop shadow (hard rule: don't restyle was/now cards); rounded email buttons (matched to the HubSpot
  emails) and the Google banner button's 4 px corners (the system says every box is square). RAL codes and value-card
  copy aren't used by the app.

## Speed and growth (15 Oct 2026, Sam: "sometimes gets stuck on a loading screen or takes ages… future proof it")
Measured: drawing is fast (0.6 s first render, every page under 0.5 s with the data in hand); the waits were the network.
- **Saved lists no longer block pages**: the Ad creator, Email creator and Email cards waited for the `saved` function
  (a cold start after a quiet spell takes seconds; no time limit, so a hang meant "Loading…" for good). `saved.js`
  `sharedStore().load()` now runs in the background with `TIMEOUT_MS` = 12 s; the page draws at once with "Loading saved
  …" in the saved bar; save/rename/delete wait for it (`ready`), so nothing is saved to the browser by mistake.
- **Functions**: `maxInstances` 2 → 10 (at 256 MiB a copy answers one request at a time; copies cost nothing idle; the
  daily limits still cap use).
- **Documents never outgrow Firestore**: `publish.py` `split()` moves the biggest dict/list of any document over
  `SPLIT_AT` = 600 KB into parts `<name>~1…` (`{"_split": [...]}` in its place; unchanged parts not rewritten);
  `index.html` `readJson` reassembles, so every page (and make_video.py's stand-in page) reads them as before.
  current.json grows ~7 KB a day (would have hit the 1 MiB limit, and stopped publishing, in about 3 months); comp-po
  grows as P&O sailings are found.
- **Start-up**: after 15 s still "Loading the latest prices…", the gate says so (slow connection, VPN or work network
  filter) with a Reload button.
Not done (options): caching the data in the browser between visits; keeping a function copy always warm (costs a few
pounds a month).

## Hard rules (do not change without Sam)
- **Never touch Meta, Google Ads or any ad account.** This system only records prices and renders cards for Sam to approve.
- **Was prices only ever come from `run.json`** (`eligible` / `cabin_eligible`, produced by `tracker.py`). Never compute
  or invent one anywhere else. UK reference-pricing rules apply. The rules live in `tracker.py` (`RULES`, `claim_for`; the code is the only source since 13 Oct 2026, the copy in state just mirrors it):
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
| `enrich.py` | Fetches the Google ad feed CSV + every landing page → `data/snapshot_DATE.json`. **The "from" price (`price_pp`) is the cheapest twin cabin on the sailing's page** (Sam, 13 Oct 2026, after hearing the feed is refreshed daily; on that day 5 of 224 sailings' feed prices were below the page's): `price_source` page / solo (no twin on sale: the feed's price, a solo price, as before) / feed (the page's prices couldn't be read); the feed's own figure is kept as `feed_price_pp` and a mismatch is flagged. Page photos (`photos`) leave out pictures whose file name names another ship (Sam, 13 Oct 2026: the site menu's Renaissance picture, on every page, was offered for Ambition sailings). Instead `cards_sync.py` `write_adkit` adds the sailing's own ship photo, `/ships/<ship>.jpg`, to every sailing's photo list (Ad creator, Email cards, Email creator; Sam, 13 Oct 2026): files in `site/ships/` taken from the website (ambition.jpg 1200×675 from the "Introducing Ambition" blog post, ambience.jpg 1200×675 "Ambience in Fjords" from "Small ships, big experiences", renaissance.jpg from the "Our ships" menu picture, 1600 wide); replace a file (same name) for a better one. No caption hint for them. Since 12 Oct 2026 also reads each page's promotions (FareSummary `offers`: id, name, description, expiry) into `offers`, and Nectar points (FareSummary `search-data.nectar_points`, per cabin grade for 2 sharing / solo, standard and Ambassador fare) into `nectar`, plus `nectar_pts` = the figure the page shows (site's useMaxNectarPoints: twin, cheapest cabin grade on sale, Ambassador fare, 2 guests; Norway A22629BR = 50,000; 0 if not eligible). Points come from total booking value in bands (Sam's table, 12 Oct 2026: <£250 1,500 · £250 3,500 · £500 8,000 · £1,000 14,000 · £1,750 30,000 · £3,500 50,000 · £5,750 75,000 · £8,000 100,000 · £15,000+ 150,000) |
| `tracker.py` | Folds a snapshot into state, computes was/now claims → `out/state.json`, `out/cabins.json`, `out/run.json`. Promotion history (added 12 Oct 2026): per sailing `promos` = {offer id: [[from, to]]} (`to` = first day gone), offer names/descriptions/expiry once in state `offers`, run lists `promo_added` / `promo_ended` / `promo_changed`. Promotions are recorded only; they never affect was/now claims. Page "from" price (13 Oct 2026): when a page can't be read (`price_source` feed) the last from price is kept, never the feed's; the first check reading page prices (state `lead_from_page_since`) put the sailings whose price moved into a `switch` segment and run list `lead_source_switch` (not drops or rises; `claim_for` says "new reference period"; the tracker page shows it as "not a price change"); `cards_sync.py` and `make_cards.py` skip sailings whose page prices couldn't be read. Nectar (12 Oct 2026): per sailing `nectar` = [{n, from}] history of the page figure (last 24), current per-grade points in `nectar_grades` (kept in `state/cabins.json`), run list `nectar_changes`, state `nectar_since`; recorded only, never part of claims |
| `render_cards.py` | Renders 1x1 / 4x5 / 9x16 PNG cards with Playwright (4:5 = 1080x1350 replaced 3:4 on 12 Oct 2026, Sam: match Meta's feed spec). Standard cards show the main live promotion plus a second one if there is one (`promo_lines`: % saving or code first, then biggest onboard credit, flights, coach, solo; code and end date added when the page gives them). "Lower/reduced fares" offers, and "Lower solo supplement" (Sam, 13 Oct 2026), are never put on cards: they are price-reduction claims (`PRICE_CLAIM`: lower/reduced/reduction … fares/supplement/prices). Nectar strip (Sam, 12 Oct 2026, `nectar_line`): "Collect up to N Nectar points" from snapshot `nectar_pts`, in a Pearl strip above the promotions, and then only the main promotion is shown (Sam); "up to" because the figure is for the Ambassador fare, which costs more than the card's "from" price. Campaign artwork (Sam, 12 Oct 2026, after A12639 cropped badly): `is_campaign` (file name cotw/dig-/carousel/boom-radio/weekender/back_to_/no-logo, or a 2:1 image; `campaign_images.json` {"add","remove"} overrides) → same card design, but the artwork is shown whole between the badge and the strips (`photo_whole`). 8 sailings on 12 Oct 2026. Since 13 Oct 2026 (Sam) its background is the "matched" one, as on was/now cards: plain colours from the artwork's own top and bottom edges, split at the artwork's bottom, no blur, logo Allium on a light top (`matched_css`); `cards_sync.py` layout key `campaign-matched` remade just these sailings ("campaign artwork on matched colours"); `adcards.js` does the same in the browser (`EDGES`) |
| `make_cards.py`, `.github/workflows/make-cards.yml` | **Make cards** (manual, 12 Oct 2026): type cruise codes (or `all`) and sizes; reads a fresh snapshot, renders standard cards (no was/now), uploads a zip (PNGs + `cards.csv` with the price-read time + `summary.md`) as a 30-day artifact. Nothing committed, nothing sent to Meta |
| `cards_sync.py` | Always-ready standard cards (12 Oct 2026). `plan` / `run` after daily.py in the hourly workflow. Fingerprint of everything printed on a card (`on_card`: name, date, nights, ship, port, flights, price, `promo_lines`, `nectar_line`, photo, `DESIGN`); changed or new → render 1x1/4x5/9x16 JPEGs, upload to `gs://promotions-planner.firebasestorage.app/pricewatch-cards/<code>/<fp>_<size>.jpg` with a Firebase download token (links reach the page only via Firestore `pricewatch/cards`, behind the allowlist; no Storage rules needed). Manifest `state/cards.json` (current + old with `reason`, `out_of_date_since`). Left the feed / departed → withdrawn to old. Old versions deleted after `KEEP_DAYS` = 30. Card step is `continue-on-error`; failures open a "Cards FAILED" issue. Bump `DESIGN` to remake every card after a design change. **Was/now cards** (Sam, 12 Oct 2026): for claims in this check's `out/run.json` (`eligible`, `cabin_eligible`; never any other was price) whose `since` is today, `price_reduction_html` cards in 3 sizes → `.../<code>/wasnow_<fp>_<size>.jpg`, manifest `wasnow` {"lead@since" / "twin.<grade>@since": {was, now, since, ends, cabin, files}}; made once, on the claim's first day; refused if the snapshot's price on sale isn't the claim's now price. A claim no longer in run.json → moved to `old` with `do_not_use` and the reason (`ended_why`, from state), deleted after 30 days; `out/wasnow_ended.md` → "Was/now cards withdrawn" issue. New ones are appended to `out/issue.md` with tracker links (`HOSTING_SITE`). Campaign artwork (Sam, 12 Oct 2026, "matched", after rejecting blurred backgrounds): was/now cards show it whole below the logo and a smaller corner sticker (scale .68), on two plain colours taken from the artwork's own top and bottom edges (`edge_colours`, needs Pillow; straight split at the artwork's bottom, no fade); logo purple on a light top (`campaign_css`); other photos stay full-bleed. Tested on A12634, A12706 and A22629BR (normal photo, unchanged) |
| `card_review.py` | Claude checks new and remade standard cards (Sam, 12 Oct 2026, "option 3"), in the hourly workflow after `cards_sync.py` (`continue-on-error`). Runs on **Sam's Claude plan, not an API key** (Sam chose this): the Claude Code CLI (pinned in the workflow) signs in with the `CLAUDE_CODE_OAUTH_TOKEN` repo secret from `claude setup-token`; skipped until that secret exists. Per sailing whose current cards have no `review` for their fingerprint: downloads the three JPEGs into a temp folder and runs one `claude -p` (model `claude-opus-5-5`, only the Read tool, `--json-schema` structured answer) with what should be printed (from the manifest); stores `current.review` = {fp, at, ok, issues[{size, severity fix/look, problem}], model} in `state/cards.json`. First full check split over 4 of the plan's 5-hour usage windows (Sam): while more than `SMALL` = 15 are waiting, at most `BATCH` = 56 per check and then a `WINDOW_HOURS` = 5 wait (`review_batch_at` in the manifest); after that, remade cards are checked at the next hourly check. Was/now cards are checked first, including that the was/now figures match the claim. Flagged cards → "Cards to check — DATE" issue (one per day, comments after) and "Needs a look" on the Cards page (filter, badge, detail view, CSV column). Read-only: never changes a card, a price or anything outside the repo. Tested 12 Oct 2026 on A12639 (fine; with a deliberately wrong expected price it flagged the price), about 11 s a sailing. First real run (16:07 UTC 12 Oct) got 401 "Invalid bearer token" for every sailing: the workflow now strips whitespace from the token (copying from PowerShell adds line breaks), and a sign-in failure stops the batch at once and opens a "Card check can't sign in" issue with the fix |
| `daily.py` | **New.** Runs one check deterministically (see its docstring). Since 12 Oct 2026 it runs hourly: each check adds its changes (with `at`, UTC) to `runs/<date>.json`, keeps `checks` and `reported` (claims already reported that day, so each new claim is reported once), and stamps `updated_at` in state. Tested on 12 Oct against real data: normal run, same-day skip, and the broken-feed safety stop all behave. Card rendering through `daily.py` tested 12 Oct in Claude Code on a scratch copy (lead + cabin claim, test prices only, nothing committed). |
| `.github/workflows/price-watch.yml` | Workflow: hourly 09:07–17:07 GMT (cron `7 9-17 * * *`; Sam, 12 Oct 2026; moved off :00 after the 12:00 and 13:00 scheduled runs never started) plus 22:07 and 06:07 GMT (`7 22,6 * * *`, Sam 12 Oct 2026, so evening price changes reach the cards before morning), then cards (`cards_sync.py`) + manual run, commits results (pulls first), opens one GitHub issue per day for new claims or failures and comments on it for later checks (`.github/issue.sh`). Reviewed 12 Oct: actions bumped to v7, fixed the commit step (it staged nothing on days without cards). Not yet run on GitHub. |
| `site/index.html`, `publish.py`, `.github/workflows/publish.yml` | Tracker page (ported from the old Claude tracker page, 12 Oct 2026). `publish.py` copies `state/` and recent `runs/` (up to 90 days, within a 600 KB budget) into Firestore (`pricewatch/current`, `/cabins`, `/runs`), plus every run ever in half-month archive docs (`/runs-YYYY-MM-1`, `-2`; unchanged ones are skipped) that "What changed" loads on demand for older dates, and `/trends` (change counts per day for the Trends page) in the Digital Team Planner's Firebase project; Writes retry with backoff on 429/5xx (Firestore refused a write once, 16:12 UTC 12 Oct 2026). `publish.yml` runs it and deploys `site/` to Firebase Hosting after each daily run and on pushes to `main` (page, `.js` and `.json` served with `Cache-Control: no-cache`, 13 Oct 2026, after a merged Ad creator change stayed hidden behind Firebase's default one-hour cache; module imports carry `?v=__BUILD__`, which the deploy step replaces with the commit, so a browser never reuses an older adcreator/adcards/adcopy/cardmaker). The page signs people in with Google and only shows data to the planner's allowlist. Filters (departure month, port/airport, length, no-fly/fly) and a per-sailing detail view (click a row, or link to `#<cruise code>`): was/now status in words, price chart by cabin grade, cabins now, every change. Added 12 Oct 2026. Promotions: live-promotions summary, offer labels and a promotion filter in the table, promotions in the detail view. "What changed" view (every recorded change by date range and type; mix drops shown as cabin changes, never as price drops) and CSV downloads of the filtered sailings table and of the changes. Layout (Sam, 12 Oct 2026; tidied 13 Oct 2026): a purple sidebar switches pages, grouped Prices (Overview = summary, was/now queue and the sailings table; Trends; What changed; Live promotions), Creative (Cards; Ad creator) and Checks (Not in ad feed; Feed vs website; Check history, was "Daily runs"; Was/now rules); count badges only on Live promotions, Not in ad feed and Feed vs website; the last page is remembered per browser; on phones it becomes a top bar with swipeable tabs. No folding sections. Trends page (12 Oct 2026): price changes and availability per day (per week beyond 45 days), average from price across the same sailings throughout, sailings with a promotion, sailings in the feed; days with no check are gaps. Mix drops are counted apart, never as drops. Detail view has a month-by-month from-price table (lead segments keep full history; cabin grades keep their last 12 changes). Cards page (12 Oct 2026): its own filters (search, departure month, port/airport, no-fly/fly, made today / last 7 days) and "Download these": a browser-built zip (JSZip from cdnjs) of the filtered cards in the chosen size(s), `<code>_<size>.jpg` + `cards.csv`; falls back to one download per card if the bucket's CORS rule is missing. Clicking a card or a size opens a preview (dialog `#pv`, size tabs, Download button), since the files themselves download as attachments. "Was/now cards live now" block and, per sailing, was/now cards with "use until"; withdrawn ones shown with a red "Do not use" (`storage_cors.py`, run by publish.yml, adds a GET rule for the hosting site and keeps existing rules) |
| `site/adcreator.js`, `site/adcards.js`, `check_adcards.py` | **Ad creator** page on the tracker (Sam, 12 Oct 2026): pick sailings (carousel of 2–10, or a single image ad), reorder (arrows or drag), per card choose design (standard; was/now only for a claim live today, from state `claim` / cabins `cabin_claims`, figures never typed in), image (feed image, the sailing page's photos from enrich `photos`, or an upload kept in the browser only), words on the card, Nectar line and promotions (max 2, or 1 with Nectar), and the Meta headline/description/link; ad primary text and button. Live Facebook/Instagram feed mock (carousel, or single image in 4:5, 1:1 and a 9:16 Stories frame; its profile picture is `site/meta-profile.jpg`, a 160 px copy of Ambassador's own Facebook page picture, Sam 13 Oct 2026: replace the file if the page picture changes). The app's tab icon uses the same picture (`site/favicon.ico` 16/32/48, `favicon.png` 64, rounded and cropped closer so the A reads at tab size; `apple-touch-icon.png` 180 for phone home screens; Sam, 13 Oct 2026). "Download zip": cards rendered in the browser (`adcards.js` = port of `render_cards.py` card designs, run in iframes, saved with html-to-image 1.11.11 from cdnjs) named `01_<code>_<size>.jpg` in order, `ad_text.txt`, `cards.csv`, `HOW_TO_UPLOAD.md` (Ads Manager steps; was/now "stop running by" date). Data: `state/adkit.json` written by `cards_sync.py plan` every check (all card-safe promotion lines, Nectar line, lead grade, campaign flag, image, page photos) → Firestore `pricewatch/adkit`. Fonts and logo copied into `site/`. If a card design changes in `render_cards.py`, change `adcards.js` too and run `python check_adcards.py data/snapshot_DATE.json` (about 1% of pixels differ = fine). Draft kept in the browser (localStorage `spw-ad-draft`). **Saved ads, duplicate, share link** (Sam, 13 Oct 2026): named ads saved in the browser (`spw-ad-drafts`: Save / Save a copy / Copy link / New ad, and a **Saved ads (N)** button opening `site/saved.js`, shared with the Email creator: a dialog with search over names and sailings, sort newest / oldest / A–Z (remembered, `spw-saved-sort`), one row per item with thumbnail, sailings count, saved time and names, and Open / Duplicate / Rename / Delete; Sam, 13 Oct 2026, replacing the dropdown); tabs above the card editor jump between sailing cards (Sam, 13 Oct 2026; click or ←/→ keys); ⧉ duplicates a card (same sailing twice is allowed, e.g. a different photo or wording); "Copy link" packs the ad (no prices, no uploads) as deflate-raw + base64url after `#ad=`, which `index.html` `fromHash` routes to `adcreator.js` `openShared` (opens as the viewer's own copy, then clears the hash). `normalise()` brings any saved/shared ad up to date and says what changed: sailings no longer on sale dropped, was/now cards whose claim ended switched to standard, uploaded photos flagged to add again (`uploadLost`). Prices always come from the viewer's latest data. **Opening and closing cards** (carousels only, Sam, 13 Oct 2026, designs "Intro 2" and "End 1" picked from mock-ups): `adcards.js` `introDoc` / `endDoc`, built from the design system (solid Allium with the 20° hatch pattern `#753685`, whiteout logo, Display Headline caps tracking 180 with the Ambassador A replacing the first letter A in Aloe, Aloe tagline container). Opening: small line (blank = a fact true of all chosen sailings, e.g. "No-fly cruises from UK ports"), headline (default "Where will you sail next?"), "Swipe to explore ›". Closing: big logo, "The warmest welcome at sea", "Book your sailing", ambassadorcruiseline.com. Each on/off, words editable, own Meta headline/description/link; they count towards Meta's 10 cards (`maxSailings`); zip files `01_opening_<size>.jpg` … `NN_closing_<size>.jpg`, listed in the upload steps. Nectar / Trustpilot switches on every card in the "Sailings in order" list, plus "Every card" on/off (Sam, 13 Oct 2026; `stripBlock` / `setStrip`: standard cards only, not when there's nothing to show). **Make a version** (`site/cardmaker.js`, Sam, 13 Oct 2026): in a sailing's detail view, under its automatic cards, Nectar line / Trustpilot widget (and layout) tick boxes build that sailing's standard card in the browser (same adcards.js design and ad kit data), preview all three sizes and download each (`<code>_<size>[_nectar][_trustpilot].jpg`); not saved anywhere. **Trustpilot widget** (Sam, 13 Oct 2026): a tick box on standard cards adds Trustpilot's own widget image as a Pearl strip under the Nectar line (then at most 1 promotion); never on was/now cards. Artwork in `site/trustpilot/`, listed in `widget.json` {"as_of", "images": [{file, label}]}: three one-line layouts (Great / 3.9 + stars + 1.3K+ reviews + logo; Great + stars + logo) made 13 Oct 2026 from the stacked Trustpilot marketing assets Sam sent (score 3.9 "Great", 1.3K+ reviews), cut and laid side by side with Trustpilot's logo and stars unaltered (Sam allowed a redesign). Strip 96px tall, image 64px. The editor picks the layout per card. When the score changes, Sam sends new assets: rebuild the three files and update `as_of`. The score couldn't be read automatically (trustpilot.com returned 403); the page shows "score as of" so an old score is spotted. **Suggested primary text** (`site/adcopy.js`, Sam, 12 Oct 2026, no AI): 3–6 options (Welcoming, Wondrous, Value, plus Offer when a promotion is shared by every chosen sailing, Nectar, and Price reduction only for cards using a live claim) built from the chosen sailings' own facts, written to the tone of voice in the "Ambassador Cruise Line" design system (claude.ai artifact XAtqddrEMdLfjbSyPFLXVz, Content fundamentals, Brand Guidelines v4.2; v4.3 and the messaging matrix since 16 Oct 2026): we/contractions/a question, factual, evocative -ing words; "Ambassador Cruise Line" in full, "guests", "sailings", "ships", "Ambience"/"Ambition" without "The", no ampersands in body copy; ends "Based on two sharing and subject to availability." The bold part is what Meta shows before "See more" (125). **Draft with Claude** (built 14 Oct 2026, see `draft_job.py`) sits under the suggestions |
| `draft_job.py`, `site/drafts.js`, `.github/workflows/draft-text.yml`, `functions/index.js` `drafts` | **Draft with Claude** (Sam, 14 Oct 2026: "build the free option for now"; a paid API key, about 3–5p a draft on Opus, may follow if people use it and budget is signed off). Ad creator (under the suggested primary text: 4 primary text options) and Email creator (under the intro: 3 sets of subject, preview text, header headline + second line, intro); an optional note steers it ("lead on the Christmas markets"). The page POSTs the chosen sailings' codes and choices (was/now claim key, offers, Nectar on/off) to the function `drafts` (allowlist; 60 a day for everyone, one at a time per person; Firestore `pricewatch_drafts/<id>`, deleted after 30 days), which dispatches `draft-text.yml` with the same `VIDEO_DISPATCH_TOKEN` as Make video. `draft_job.py` builds the facts **from the repo's saved state only** (name with "and" for "&", ship, date, nights, port/airport, from price, offers that are live in `adkit`, Nectar points, and a was/now only when the claim is live today exactly as `adcreator.js` `claims()` allows), runs one `claude -p` (model `claude-opus-5-5`, no tools, `--json-schema`) **on Sam's Claude plan** (`CLAUDE_CODE_OAUTH_TOKEN`, as the paused card check), then throws away any option quoting a £ / % / points figure that isn't a price, was/now figure, Nectar figure or offer figure in the facts, or using reduction wording without a live claim; "&" → "and"; ad options always end "Based on two sharing and subject to availability."; email fields cut to their limits (headline 28, second line 70). The page asks every 5 s (usually 1–2 minutes) and shows the options with "Use this" (fills the primary text, or subject/preview/headline/second line/intro). Nothing is used until someone presses it. If the plan token is rejected the page says "Claude couldn't sign in (the plan token needs renewing)": run `claude setup-token` again and paste it into the repo secret `CLAUDE_CODE_OAUTH_TOKEN` |
| `make_video.py`, `.github/workflows/make-video.yml` | **Make video** (Sam, 13 Oct 2026, "GitHub on request"): slideshow MP4s of an Ad creator ad for Meta. The Ad creator's "Make video" button copies the ad's share link and opens Actions → Make video; Sam pastes it into "Ad link" and runs it (about 4 minutes). `make_video.py` opens the tracker page in headless Chromium with stand-in Firebase modules fed by `publish.documents()` (so prices are the latest committed check), opens the ad from the link (`normalise` applies: ended claims → standard, off-sale sailings dropped, uploads → feed image) and takes each card as two layers via `window.__spwVideo.layers(size)` in `adcreator.js` (background: photo / artwork / brand pattern; foreground: everything else, 2x). PIL frames: 6% slow zoom alternating in/out, 0.3 s background crossfade, then the words fade and slide in (40 px, 0.3 s); opening/closing cards get half a sailing card's time (`BRAND`). ffmpeg H.264, crf 18, yuv420p, faststart, 30 fps, no sound (music added in Ads Manager). Default 6 s and 10 s × 1:1, 4:5, 9:16 = 6 files + `summary.md` (prices date, was/now stop-by date, per-card time, warning under 1.5 s) as a 30-day artifact. Nothing committed, nothing sent to Meta. Tested 13 Oct 2026 locally (3 sailings + opening/closing) |
| `functions/index.js`, `video_job.py`, `.github/workflows/video-function.yml` | **Make video without GitHub** (Sam, 13 Oct 2026, option 3; `video-function.yml` also deploys `emailImages`): the Ad creator's Make video button POSTs the ad's code to the Firebase function `makeVideo` (us-central1, `https://us-central1-promotions-planner.cloudfunctions.net/makeVideo`, CORS only for the hosting site). It checks the Google ID token and the planner `allowlist`, limits (20 a day for everyone, 2 waiting per person), records the request in Firestore `pricewatch_videos/<id>` (status queued → running → done/failed; "queued" over 30 min shows as failed) and dispatches `make-video.yml` with `request` = id, using a GitHub token in Secret Manager (`GITHUB_VIDEO_TOKEN`, set at deploy from the repo secret `VIDEO_DISPATCH_TOKEN`: fine-grained, this repo only, Actions read/write). `video_job.py` (in the workflow) marks it running, uploads the MP4s to Storage `pricewatch-videos/<id>/` with download tokens, writes the file list, and deletes requests and files older than 30 days; such runs keep no GitHub artifact. GET on the function lists the last 30 days for the Ad creator's **Videos** block (since 14 Oct 2026, Sam: "Videos of this ad" only shows videos made from the same sailings, matched by the request's `codes` or, for older ones, the codes in the title; the rest sit behind "Videos from other ads (N)") (status, who, when, download per size/length, ▶ plays it in the page; checks every 20 s while one is being made). If the function isn't reachable (not deployed yet) the button falls back to copying the link and opening the GitHub page. `video-function.yml` deploys the function when `functions/**` changes on main (skipped until `VIDEO_DISPATCH_TOKEN` exists). Setup: see "Make video from the tracker page (one-off)" below |
| `site/emailcreator.js`, `functions/index.js` `emailImages` | **Email creator** page (Creative, Sam, 13 Oct 2026): marketing email HTML in the layout of Ambassador's HubSpot emails (Sam's 10 Oct 2026 solo email: Pearl 600 px body, logo + phone, nav links, header picture with its headline (thin spaced capitals, Quicksand 300, as in the Friday round-up emails) and second line as live text on top (centred, responsive, VML background for Outlook; Sam, 13 Oct 2026), intro + button, sailings as 3-across tiles (188 px pictures, 188×160; Sam: bigger) or full width with orange offer badges top right and a dark location caption bottom left, Allium "From £Xpp" buttons, small print). Prices, dates, ships, offers from saved state only; **fare per sailing** (Sam, 13 Oct 2026, as Email cards: Twin / Solo and Cheapest available or a grade on sale, from `state/cabins.json`; button "From £Xpp" / "Balcony from £Xpp" / "Solo pricing from £X" / "Solo balcony from £X", solo links add `?solo=true`, small print says "for one guest travelling solo"; a choice no longer on sale falls back to the cheapest and `normalise()` says so); was/now only from a live claim (button "Now £Ypp", "was £X" struck through, a small-print line with the claim's own figures and date, and "send by" the claim's end date). Offer badges are chosen per sailing (up to 2), or **Offer badges on every sailing** (tick box, Sam, 13 Oct 2026) shows each sailing's first 2 live offers, kept up to date. No promo codes on sailings (Sam: the emails don't show them). Captions are typed, with a suggestion from the photo's file name to check; default photo skips campaign artwork. Intro suggestions reuse `adcopy.js` (small-print sentence and "swipe" wording adapted). Images (logo, header, sailing pictures) are made in the browser at 2x and, on "Make email", POSTed to the `emailImages` function (allowlist check, JPEG only, max 16 × 900 KB, 300 a day) which stores them in `pricewatch-email/<date>/<random>/` with download tokens (deleted after 90 days, tidied on each upload); then Copy HTML / Download .html. Responsive (tiles stack on phones), table-based for Outlook. **Nectar banner and Trustpilot widget** (Sam, 13 Oct 2026): tick boxes, each with a place (under the header picture / after the intro / above the small print). Trustpilot = Trustpilot's own email widget (the code Sam sent: images from emailsignature.trustpilot.com, business unit 620cf18be974268ffb275208, linking to the review page), so the score and review count are always current; no band behind it (Trustpilot's images are transparent, so the email's Pearl shows through; Sam, 13 Oct 2026). Nectar = Sam's banner artwork listed in `site/email/nectar.json` {"as_of", "images": [{file, label}]} (files in `site/email/`); four banners added 13 Oct 2026 from Sam's artwork ("Collect destinations. Collect points.", up to 150,000 points, T&Cs apply: Norway fjords, Caribbean beach, Christmas markets, Porto; 1200×675 JPEG, otherwise unaltered), picked by thumbnail; using one adds "*Nectar points: terms and conditions apply." to the small print; saved as a JPEG with the email's other images. When the artwork changes, replace the files and `as_of`. The page's preview fills the screen height in the sticky right column and scrolls inside itself, keeping its scroll position across refreshes (Sam, 13 Oct 2026: it overlapped its box). **HubSpot left for later** (Sam): no template, the unsubscribe link is typed in or the email says `UNSUBSCRIBE_LINK`; UTMs left to the platform. Draft kept in the browser (`spw-email-draft`). **Saved emails, duplicate, share link** (Sam, 13 Oct 2026, as the Ad creator): named emails in the browser (`spw-email-drafts`: Save / Save a copy / Copy link / New email, and **Saved emails (N)** in the same `saved.js` dialog); ⧉ duplicates a sailing (e.g. once as a tile and once full width); "Copy link" packs the email (no prices) after `#email=`, routed by `index.html` `fromHash` to `emailcreator.js` `openShared` (opens as the viewer's own copy). `normalise()` drops sailings no longer on sale, switches ended was/now prices to "From", removes offer badges no longer live, and says so |
| `site/emailcards.js` | **Email cards** page (Creative, Sam, 13 Oct 2026: "just the sailing cards for emails"; the Email creator is hidden from the menu for everyone except Sam: `index.html` `ONLY` = {email: ["sam.brooker@ambassadorcruiseline.com"]}, checked against the signed-in Google account (case-insensitive); it only hides the menu entry and the page, it isn't a lock). Makes the sailing pictures the team uses in HubSpot emails, matched to theirs (e.g. "Kirkwall, Scotland - Standard (OBC200).png"): **Standard 1200 × 924** (3-across tiles) and **Wide 2400 × 924** (full width), PNG, photo (sailing page photos; default skips campaign artwork) with orange offer badges top right (44 px Quicksand 700 caps, padding 38/52, stacked, up to 2, or "Offer badges on every sailing"; new sailings start with none and unticking that box clears them, Sam 13 Oct 2026) and a dark location caption bottom left (46 px Quicksand 600, right edge at the brand's 20° slant: top set in 35 px on the 96 px bar, as the cards' strips (tan 20° ≈ .364 × height), Sam 13 Oct 2026; typed, with a hint from the photo's file name to check). File names "<caption> - Standard (<offers>).png". **Whole card** (Sam, 13 Oct 2026: "the whole card to pop into HubSpot", "as a png and as html"): Download ticks Whole card (picture + NAME + date / nights and port / ship + Allium "From £Xpp" button on Pearl, as in the emails, one PNG at 4x a 196 px tile or 2x a 568 px full-width block, "<caption> - Standard card (…).png") and/or Picture only. HTML: per card "Copy standard / wide HTML" and "Download HTML" (all cards): table-based blocks with the picture linked to the sailing and live text + button; the picture is saved as a JPEG through the `emailImages` function (allowlist, 90 days) so the HTML can point at it. Per card: preview, and under it proper buttons (Sam, 14 Oct 2026): a row of Download <output> (PNG), then Copy text (NAME, date, "N nights departing X", ship, "From £Xpp: link"), **Copy sailing link** (the page, `?solo=true` for solo fares), **Copy booking link** (`bookingLink`), Copy offer T&Cs and Copy standard/wide HTML. Download zip = all PNGs + `email-text.txt` + `cards.csv` + `offer-terms.txt` when the card has offer badges. **Link to: Sailing page / Booking** per card (Sam, 13 Oct 2026): Booking = the link the sailing page's own cabin "Book" buttons open (site script CabinTypes `handleBookingLink`): `https://book.ambassadorcruiseline.com/?cruiseCode=<code>&cabinType=<inner|outer|balcony|suite>&numberOfAdults=<2, or 1 for solo>`, the cabin type being the chosen grade or, for Cheapest available, the grade that sets that fare's from price; it opens step 1 (Cabin) with the sailing, cabin type and guests chosen (tested 13 Oct 2026 in fresh browser sessions; a browser already part-way through a booking may keep its own choices). Used for the picture and button links in the HTML and in Copy text; the CSV has Link, Sailing page link and Booking link. (The site's CruiseAccessGuard script is also what sends visitors on agent-sold pages to /404/: status "charter" or agents without DIRECT, unless a travel-partner cookie.) **Copy offer T&Cs** per card (and in the card's editor, with which badges have terms) copies the same text (Sam, 13 Oct 2026). **Copy offer T&Cs** in the toolbar (Sam, 14 Oct 2026, replacing "Download offer T&Cs": a copy link, as in Live promotions) copies, for every card with badges, the same text: the T&Cs of each offer badge on the card (badge name → the sailing's live promotion of that name → the terms `terms.py` matched to it; "no terms found" with the general booking terms otherwise; the read time and "check the wording on the website"). **Several cards at once** (Sam, 13 Oct 2026: one at a time for a day, then "add back multiple cards at once"; `MAX` = 50 since 15 Oct 2026 (was 24; Sam: "increase the limit"), and a zip holds at most `ZIP_PICS` = 60 pictures: bigger sets download as "part 1 of N" zips with the text, CSV and T&Cs in the last, numbered list with ↑/↓/✕, click one to edit it, "Offer badges on every sailing" back). **File name** per card (Sam, 13 Oct 2026): typed name replaces the default, keeping " - Standard/Wide [card].png"; the names that will download are listed under it. **Download CSV** (Sam, 13 Oct 2026): every card's details in one row each (code, name, date, nights, departs from, ship, fare, cabin, price, button, link, caption, offer badges, offer T&Cs found, photo, file names, prices date); the zip's `cards.csv` is the same. **Fare and cabin** (Sam, 13 Oct 2026): Twin / Solo and Cheapest available or a grade on sale for that fare, priced from `state/cabins.json` (`twin.<grade>` / `solo.<grade>`, latest segment, not `out`; twin cheapest = the sailing's lead price); button "From £Xpp" / "Balcony from £Xpp" / "Solo pricing from £X" / "Solo balcony from £X", solo links add `?solo=true`, text says "per person, based on two sharing" or "for one guest travelling solo"; a grade no longer on sale falls back to the cheapest with a note. Prices/dates/offers from saved state only. Made in the browser (html-to-image). Draft in the browser (`spw-email-cards`). **Saved card sets** (Sam, 15 Oct 2026: "map out each email send … save functionality similar to the meta ads builder"): Save as… / Save / Save a copy… / New set and **Saved card sets (N)** (the `saved.js` dialog), in the shared list (`saved` function, kind `ecards`; browser-only `spw-email-cards-sets` if it can't be reached); only the cards' choices are saved (no prices); `normalise()` drops sailings no longer on sale and ended offer badges, switches ended was/now back to "From", notes sold-out cabin choices, and lists them as "Needs updating"; France sets kept apart (`market`). CSV, zip and HTML downloads start with the set's name (`fileBase`). **Options column follows the scroll** (Sam, 15 Oct 2026): on desktop (over 860 px) the left column is sticky and scrolls on its own (CSS `#ecards .ac-side` in index.html); its scroll is kept across redraws and picking another card brings its options (`#ec-editor`) into view. **Cruise code** (Sam, 15 Oct 2026, "just as text", on the card itself): a small grey line under the ship, "Cruise code A12702" (France "Code croisière R…"), on the whole-card PNG, in the HTML block and under the page preview (`words().code`); not in Copy text or the picture-only PNG. |
| `site/googleads.js`, `site/gbanners.js` | **Google Ads** page (Creative; Sam, 14 Oct 2026: "the whole Google Ads section": all four campaign types (Search, Performance Max, display, Demand Gen/YouTube), dynamic remarketing feed and ad customiser prices, as downloads only; Performance Max images as both clean photos and card designs). Part 1, images: per sailing (up to 20; draft in the browser, `spw-google`) **Performance Max / Demand Gen** images landscape 1200×628, square 1200×1200, portrait 960×1200 as "photo only" (the sailing's photo, no words: Google's advice; campaign artwork shown whole on its edge colours, and new sailings start on a non-campaign photo) and/or "card design" (`adcards.js` `cardAt`, drawn at 1910×1000 / 1080×1080 / 1080×1350 and scaled); **logos** square (the Ambassador A on Allium, as the Facebook page picture) and landscape 4:1; **display banners** 300×250, 336×280, 300×600, 160×600, 728×90, 970×250, 320×100, 320×50 (`bannerDoc`: box / tower / billboard / strip layouts; photo, logo, name, date · nights · port, orange price block, white button "Book now" / "Find out more" / "View cruise" / "Explore"; the small strips drop photo, button and logo), JPEG quality stepped down until under Google's 150 KB (`BANNER_MAX_KB`). Was/now only from a claim live today (Price select per sailing, "stop using by"). Zip: `performance-max/`, `display/`, `logos/`, `assets.csv` (file, use, size, KB, sailing, price on image, was/now until, landing page), `HOW_TO_UPLOAD.md`. "Add to Google Ads" in a sailing's detail view. Nothing is sent to Google Ads. **Part 2, Ad copy tab** (`site/gcopy.js`, 14 Oct 2026): per sailing (an ad group each) or "for all together", suggestions built from the sailings' facts (no AI; adcopy.js tone of voice) within Google's limits (`LIMITS`): Search RSA 15 headlines × 30, 4 descriptions × 90, paths 2 × 15; Performance Max 15 headlines × 30, 5 long headlines × 90, 5 descriptions × 90 (first ≤ 60), business name "Ambassador Cruise Line"; Demand Gen 5 headlines × 40, 5 descriptions × 90; sitelinks (the sailings' pages + Cruise offers; text 25, lines 35) and callouts (25). Lines over a limit are never offered; inputs have maxlength and a live count. Edits are kept per set in the draft (`st.copy[key]`, "Back to the suggestions"); `stalePrices` warns when saved copy quotes a £ figure that isn't a current price, was/now figure, offer or Nectar figure. Was/now wording only from a live claim. **Download for Google Ads Editor**: zip of `search_ads.csv`, `performance_max_asset_groups.csv`, `demand_gen_ads.csv`, `sitelinks.csv`, `callouts.csv` (campaign names set on the tab; ad group = code + name), `ad_copy.txt`, `HOW_TO_IMPORT.md` (check the first import in Editor's preview). **Draft with Claude** (kind `google` in drafts.js / functions `drafts` / draft_job.py: 2 sets of 10–15 headlines ≤ 30, 3–5 long headlines ≤ 90, 4 descriptions ≤ 90; each line over a limit, quoting a figure not in the facts, or with reduction wording without a claim is dropped; a set needs ≥ 5 headlines and 2 descriptions) for the set chosen in "Draft with Claude for"; "Use this" fills that set's Search and PMax headlines/descriptions and long headlines. **Part 3, Feeds tab** (`site/gfeeds.js`, 14 Oct 2026, download only): **dynamic remarketing feed** = every sailing on sale as a Google Ads "Custom" feed CSV (`FEED_COLUMNS`: ID = cruise code (the site's Google tag must send the same IDs, `dynx_itemid`; not checked), Item title/subtitle/description kept to 25 characters, category no-fly / fly-cruise, Price "549.00 GBP", Formatted price "From £549pp", Image URL = a page photo (no campaign artwork, no logos), Final URL, Contextual keywords). Sale price only with the "Include was/now sale prices" tick box (off by default) and only from a lead claim live today (`claims()`): Price = was, Sale price = now, "Was £X" / "Now £Y", "upload a fresh feed by" the claim's end. **Ad customiser values** for the chosen sailings, one row per ad group named as the Ad copy tab's "For each sailing" ad groups in its Search campaign: zip of `customizer_attributes.csv` (FromPrice, Nights, DepartureDate, DepartsFrom, Ship, Offer; all Text), `customizer_values.csv` (Campaign, Ad group, `Customizer:<name>`; Google's exact bulk template couldn't be checked from here, so HOW_TO_USE.md says to use Preview and Google's own template if asked) and `HOW_TO_USE.md`; plus RSA lines using `{CUSTOMIZER.<name>}` offered only when they fit Google's limits with every ad group's values (`customiserLines`). The from price is the lead price; no was price in customisers |
| `terms.py`, `terms_overrides.json` (optional) | **Promotion T&Cs** (Sam, 13 Oct 2026: "grab the T&Cs for each promotion"). The sailing pages' offers carry no terms (FareSummary `terms_and_conditions_text` is empty for all), so `terms.py` (hourly workflow step, `continue-on-error`) reads the "Terms and Conditions" prose sections on every sitemap page except /cruise/ and /blog/ once a UK day, and again straight away when a live promotion appears that has no terms and wasn't known at the last read (`known_at_fetch`; Sam, 13 Oct 2026) (215 pages, 21 sets of terms on 13 Oct 2026; a heading with no text of its own, or more than 8 pieces, is one document, e.g. the coach page) and matches them to every promotion in state `offers` each check: a promo code in the name/description that the terms mention (COTW15), else a `KEYWORDS` word in the name that the terms' title has (onboard credit, coach, deposit, ...), else (Sam, 13 Oct 2026) a main word of the name (4+ letters, not in `STOP`) in the terms' title, shown in the dialog as "matched by a word in the name: check" (`how` per offer: code / type / name / by hand); `terms_overrides.json` {"<promotion name>": ["<terms title>"]} adds or (with []) removes matches. → `state/terms.json` {fetched_at, pages_checked, docs {id: title, text, pages, first_seen}, offers {offer id: [doc ids]}, general} → Firestore `pricewatch/terms`. Live promotions page: a Terms column ("T&Cs" opens dialog `#tc` with each document's text, the pages it's on and Copy / Copy all; "No T&Cs found" links the general booking terms) and "all N found". On 13 Oct 2026, 8 of 13 live promotions matched (all onboard credit, coach, Cruise of the Week); none found on the site for Lower Solo Supplement, New Lower Fares, Reduced Ocean View fares, 30% off Upper Class seats, Free Bottle of Bubbles. Read-only |
| `coverage.py`, `.github/workflows/coverage.yml` | Weekly (Mondays 09:30 GMT + manual): sitemap vs ad feed. Writes `state/coverage.json` (sailings on sale on the website but not in the feed, with when each was first spotted), shown on the tracker page; opens an issue only for newly missing sailings. First manual check 12 Oct 2026: 415 site pages, 220 in feed, 15 on sale but missing (13 Curaçao S-codes, A22638, A12705, A12824). **Tags** (Sam, 13 Oct 2026): a sailing whose FareSummary `search-data.agents` isn't ["DIRECT"] (sold through an agent: semi-charters, which aren't meant to be on the site or in the feed) gets `charter: true`, a "Sold through agent" tag (Sam, 13 Oct 2026, renamed from "Semi-charter"; the server still returns these pages' HTML with prices, which is what coverage.py reads, but in a browser the site's own script sends visitors to /404/). **Browser check** (Sam, 13 Oct 2026, "only for pages identified as missing from the feed"): `visitor_404` opens just the on-sale-but-missing sailings in headless Chromium (Playwright, installed by coverage.yml) and waits up to 8 s for a redirect to /404/ → `visitor_404: true` and a red "404 for visitors" tag; such sailings also sort last, aren't counted and are never reported as newly missing. All 14 on 13 Oct 2026 (normal sailings checked: not flagged), sorts last, isn't counted in the menu badge and is never reported as newly missing (all 14 on 13 Oct 2026: the 12 Curaçao S-codes, A12705, A12824; 40 feed sailings checked were all DIRECT). Sitemap pages that return 404 (HTTP 404 or canonical /404/) are listed in `not_found` with a red "404" tag (141 on 13 Oct 2026, mostly past 2025–26 sailings still in the sitemap) |
| Feed vs website (in `tracker.py`, `daily.py`, `site/index.html`) | **Ad feed price vs website** (Sam, 13 Oct 2026, after hearing the feed is refreshed daily): each check compares the feed's price (`feed_price_pp`) with the page's cheapest twin cabin (only when the page's prices were read). A difference → per sailing `feed_gap` {feed, page, since, seen, reported} (UTC check times); run lists `feed_gap_new` / `feed_gap_fixed`; fixed ones (matching again, or left the feed) kept 30 days in state `feed_gaps_fixed`. `daily.py` `feed_gap_report`: once a gap has lasted `FEED_GAP_HOURS` = 3 it's reported once → `out/feed_gaps.md` → a "Feed prices don't match the website — DATE" issue (one a day, comments after). Tracker page **Checks → Feed vs website** (count badge): current gaps, largest first, feed-lower ones highlighted (the ads show a price guests can't get), CSV download, fixed in the last 7 days. Recorded only: never part of claims, never changes the feed or any ad account |
| `.github/workflows/feed-check.yml` | Manual only. Fetches the feed and landing pages and runs the safety checks without saving anything. First run 12 Oct 2026 from GitHub's runners: 220 sailings, 0 failed pages, safety check passed, so the booking site does not block GitHub |
| `competitors.py`, `.github/workflows/competitors.yml`, `site/competitors.js`, `state/competitors/`, `runs/competitors/` | Every competing sailing's prices and offers from Fred. Olsen and Planet Cruise, once a day: see "Competitors (15 Oct 2026)" above |
| `competitors_fr.py`, `site/competitors_fr.js`, `state/fr/competitors.json`, `runs/fr/competitors/` | France's competitors: MSC and Costa itineraries from French ports at Havas Voyages, once a day: see "France: competitor prices (16 Oct 2026)" above |
| `site/pagemaker.js` | Landing pages and blog posts (prototype): see "Landing pages and blog posts: PROTOTYPE (16 Oct 2026)" above |
| `seo_cwv.py`, `.github/workflows/cwv.yml`, `site/cwv.js`, `state/seo/cwv.json`, `state/fr/cwv.json` | Core Web Vitals for us and the competitors (CrUX + PageSpeed Insights): see "Core Web Vitals (17 Oct 2026)" above |
| `route_data.py`, `route_video.py`, `route/`, `.github/workflows/route-video.yml`, `site/routevideo.js` | Route video per sailing (map, route, port photos, ship, end card, the template's music; 9:16, 4:5, 1:1): see "Route video per sailing (16 Oct 2026)" above |
| `fr_enrich.py`, `state/fr/`, `runs/fr/` | France (Ambassador Croisières): see "France (14 Oct 2026)" above |
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
- **Schedule.** Sam, 12 Oct 2026: hourly 09:07–17:07 **UK time** all year, plus 06:07 and 22:07 UK time (cron-job.org job
  in Sam's account, its time zone left on UK time at Sam's choice; the GitHub `schedule` crons are UTC and only a backstop).
  Sam was told the trade-off: intraday flip-flops (see below) are now recorded, so sold-out-then-back cabins restart
  their reference period more often and some was/now claims qualify later than with one daily check.
- **Claude review of cards.** Built 12 Oct 2026 as `card_review.py` (see above), on Sam's Claude plan (Pro). Paused
  12 Oct 2026 after 401 "Invalid bearer token"; the cause (14 Oct 2026) was the wrong value in the secret: the browser's
  one-time sign-in code instead of the `sk-ant-oat01-…` token PowerShell prints after it. **Turned on by Sam, 14 Oct
  2026**, first pass over the weekend: nothing before `START` = Sat 17 Oct 06:00 UK, then `BATCH` = 32 per batch at
  least `WINDOW_HOURS` = 4.5 h apart (the weekend's 06:07 / 11:07 / 16:07 / 22:07 checks = 8 batches, 256 places for
  ~223 sailings; simulated: done by Sunday 22:09 even with a usage-limit stop), then remade cards hourly. A usage-limit
  answer stops the batch (`LimitReached`) and the rest wait for the next window. The step now runs unless the repo
  variable `CARD_CHECK` = `off`. Don't move it to a paid API key, change the model or the batching without asking Sam.
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

## Make video from the tracker page (one-off)
Needed once for the Make video button to work without a GitHub account (Sam chose this, 13 Oct 2026):
1. **Blaze plan.** Firebase console → promotions-planner: the plan (bottom left) must be Blaze. It most likely already
   is (the Storage bucket and the £1 budget alert need billing). Functions need it; at this use they stay in the free allowance.
2. **Roles for the deploying service account.** Google Cloud console → promotions-planner → IAM & Admin → IAM → the
   `firebase-adminsdk-…@promotions-planner.iam.gserviceaccount.com` row (the account in `FIREBASE_SERVICE_ACCOUNT`) →
   pencil → add: Cloud Functions Admin, Cloud Run Admin, Service Account User, Artifact Registry Administrator,
   Cloud Build Editor, Secret Manager Admin, Service Usage Admin → Save.
3. **GitHub token.** github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate: name "Price watch video button", expiry 1 year, Repository access: only `sailing-price-watch`,
   Permissions → Actions: Read and write. Copy it straight into this repo: Settings → Secrets and variables → Actions →
   New repository secret `VIDEO_DISPATCH_TOKEN`. Never paste it anywhere else. Renew it before it expires (the
   button then says the token has expired; put the new one in the same secret and re-run **Video function**).
4. Run **Actions → Video function → Run workflow** (it also runs on merge). Its summary says when the function is live.

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
      with `{"ref":"main"}` at minute 7 of 06, 09–17 and 22 **UK time** (Sam's cron-job.org time zone; kept on UK time by Sam, 12 Oct 2026), using a fine-grained token (only this repo,
      Actions: read and write) that **expires 30 Jul 2027**: renew it before then or the checks stop. First test run
      15:31 UTC 12 Oct 2026 worked. If GitHub's schedule starts firing too, some hours get two checks a few minutes
      apart (harmless: the second finds nothing new; the concurrency group runs them one after the other).
