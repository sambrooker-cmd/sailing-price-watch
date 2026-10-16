"""France: competitors' prices from the agent Havas Voyages (Sam, 16 Oct 2026: "go ahead and build it").

Terms review (16 Oct 2026, see CLAUDE.md "France: competitor prices"): every French cruise agent was checked.
Croisierenet / Croisières.fr allow personal use only, abcroisière / Promovacances (Karavel), Selectour and Carrefour
Voyages forbid extracting from their databases, Croisiland shows no prices, lastminute / E.Leclerc / Directours block
automated visitors, and MSC's own French site blocks too. Havas Voyages has no website terms of use (its legal notice is
company details only; its booking and offer conditions say nothing about using the site) and its robots.txt allows the
cruise pages, so it is read the way Planet Cruise is in the UK. It sells MSC and Costa, the two lines Ambassador
Croisières competes with from Marseille and the French Caribbean (nobody else sails from Dunkerque).

What a Havas cruise page gives (in its HTML): the line ("Costa Croisieres"), title, ship, "Réf", the "À partir de"
price per person (TTC), nights and the day-by-day itinerary with its ports. Departure dates and per-cabin prices load
only in the "Dates et tarifs" booking box (JavaScript through /ajax/, which robots.txt disallows), so they are not
read: one from price per itinerary, with no date and no cabin type.

How it reads, politely (as competitors.py): once a UK day, after the UK competitor check (competitors.yml); public pages
only, robots.txt checked before every request, PAUSE seconds between requests, one at a time, an honest User-Agent.
  * the cruise pages come from the product sitemap (`/c-croisiere/`, ~730), narrowed by the start of their address to
    the ~380 that may depart from France or the French Caribbean (`slug_rank`); each new page is read once to see
    whether it competes (`competes`:
    starts and ends at a French port, so no flight either way; its area is where it starts: the Mediterranean (Marseille,
    Toulon, Nice, Corsica…), northern and Atlantic France (Le Havre, Dunkerque…) or the French Caribbean (Pointe-à-Pitre,
    Fort-de-France)); pages that
    don't are remembered in `tried` and never read again; at most NEW_PER_RUN new pages a run, so the first days find
    the list;
  * competing itineraries are read every day; one whose page has gone (404) or shows no price is marked `gone`, and
    one no longer in a complete sitemap too.

Records state/fr/competitors.json (per itinerary: line, ship, title, ports, area, nights, link, the from price as
segments {p, from}, first/last seen, gone) and runs/fr/competitors/DATE.json (price_drop / price_rise / new / gone).
Read-only and recorded only: never touches an ad account, never used for claims, cards or anything customer-facing.

Usage: python competitors_fr.py [--date YYYY-MM-DD] [--max-pages N] [--force]
Exit codes: 0 ok (or nothing to do), 2 too few pages could be read (nothing saved).
"""
import argparse, datetime as dt, html, http.client, json, re, sys, time, unicodedata, urllib.error, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from competitors import Site, seg_update  # noqa: E402

STATE = ROOT / "state" / "fr" / "competitors.json"
RUNS = ROOT / "runs" / "fr" / "competitors"
HV = "https://www.havas-voyages.fr"
NEW_PER_RUN = 150   # new pages a run (the first days find the list: ~1,400 cruise pages, most of them not from France)
GONE_DAYS = 60      # gone itineraries kept this long
LINES = {"costa": "Costa Croisières", "msc": "MSC Croisières"}
AREAS = {"med": "French Mediterranean", "north": "Northern and Atlantic France", "antilles": "French Caribbean"}
# The start of a cruise page's address names where it departs from (country or region): only French ones are read
FRENCH_SLUG = re.compile(r"^(france|guadeloupe|martinique|antilles|provence|cote-d.?azur|corse|languedoc|occitanie|"
                         r"roussillon|normandie|bretagne|nord|hauts-de-france|pas-de-calais|picardie|aquitaine|"
                         r"nouvelle-aquitaine|gironde|charente|poitou|pays-de-la-loire|vendee|ile-de-france)")
# French ports by area (names without accents, lower case)
PORTS = {
    "med": r"marseille|toulon|la seyne|nice|cannes|villefranche|antibes|saint-tropez|st-tropez|sete|port-vendres|"
           r"ajaccio|bastia|calvi|ile rousse|l'ile-rousse|porto-vecchio|propriano|bonifacio|corse",
    "north": r"le havre|dunkerque|cherbourg|saint-malo|st-malo|brest|honfleur|rouen|calais|boulogne|la rochelle|"
             r"la pallice|bordeaux|le verdon|saint-nazaire|lorient|concarneau|bayonne",
    "antilles": r"pointe-a-pitre|pointe a pitre|guadeloupe|fort-de-france|fort de france|martinique",
}


def plain(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def fix(s):
    """Havas's MSC itineraries are UTF-8 encoded twice ("Pointe-Ã -Pitre"): undo it where it shows."""
    if "Ã" in s or "Â" in s:
        try:
            return s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return s


def text(h):
    return fix(re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip())


def area_of(port):
    p = plain(port)
    for a, rx in PORTS.items():
        if re.search(rf"(^|[^a-z])({rx})([^a-z]|$)", p):
            return a
    return None


def sitemap(site):
    """The product sitemap's cruise pages {id: url}, and whether it was read in full (it is large and the site
    sometimes cuts it off or answers with a maintenance page)."""
    body, full = "", False
    for _ in range(3):
        try:
            body, full = site.get(HV + "/sitemap_produits.xml"), True
        except http.client.IncompleteRead as e:
            body = max(body, e.partial.decode("utf-8", "replace"), key=len)
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise
        if full and "</urlset>" in body:
            break
        full = False
        time.sleep(30)   # a maintenance page or a cut-off answer: give the site a moment
    urls = {}
    for u in re.findall(r"<loc>\s*([^<]*?/c-croisiere/[^<]*?)\s*</loc>", body):
        m = re.search(r"-(\d+)\.html$", u)
        if m:
            urls[m.group(1)] = html.unescape(u).replace("'", "")   # the sitemap's "cote-d'azur-…" answers 400; "cote-dazur-…" works
    return urls, full and "</urlset>" in body


def slug_rank(url):
    """Which cruise pages are worth reading once, most likely first (None = never). Costa's addresses start with the
    departure region and town ("provence-…-marseille-…", "cote-dazur-toulon-…"); MSC's, and a few Costa ones, start with a
    country on the route and "-0-" ("guadeloupe-0-msc-opera-antilles" departs from Fort-de-France), so those are read
    once to see where they really depart."""
    slug = url.rsplit("/c-croisiere/", 1)[-1]
    if FRENCH_SLUG.match(slug):
        return 0
    if re.match(r"[a-z-]+?-0-", slug):
        return 1 if re.search(r"antilles|caraibes|mediterranee", slug) else 2
    return None


def read(page, url):
    """One cruise page → its details, or None if it shows no price."""
    g = lambda rx: (lambda m: text(m.group(1)) if m else "")(re.search(rx, page, re.S))
    price = re.search(r'class="final-price">\s*([\d\s  .]+)', page)
    if not price:
        return None
    p = int(re.sub(r"\D", "", price.group(1)) or 0)
    if not p:
        return None
    nights = re.search(r"(\d+)\s*nuit", g(r'class="package-time">(.*?)</div>\s*</div>'))
    days = [text(re.sub(r"^\s*Jours?\s*[\d\s-]+:\s*", "", fix(html.unescape(d)))) for d in re.findall(r'class="cruise-day-title">(.*?)</div>', page, re.S)]
    ports = [d for d in days if d and not re.match(r"(?i)en mer|navigation|journ[ée]e en mer", d)]
    title, operator = g(r'<h1 class="package-title">(.*?)</h1>'), g(r'class="to-label">(.*?)</div>')
    line = "msc" if re.search(r"(?i)\bmsc\b", operator + " " + title) else "costa" if re.search(r"(?i)costa", operator + " " + title) else plain(operator).split()[0] if operator else "other"
    ship = re.search(r"(?i)\b((?:msc|costa)\s+[a-zà-ÿ]+)", title)
    return {"line": line, "operator": operator, "title": title, "ship": ship.group(1).title() if ship else "",
            "price": p, "nights": int(nights.group(1)) if nights else None,
            "start": ports[0] if ports else "", "end": ports[-1] if ports else "",
            "ports": ports[:20], "region": g(r'class="breadcrumb-product">(.*?)</div>')}


def competes(r):
    """Starts and ends at a French port, so no flight either way (as Ambassador Croisières: round trips from Dunkerque,
    Marseille or Pointe-à-Pitre, and a few between them). Its area is where it starts."""
    a, b = area_of(r["start"]), area_of(r["end"])
    return a if a and b else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--max-pages", type=int, default=600, help="safety cap on pages read in one run")
    ap.add_argument("--force", action="store_true", help="run even if today's check has been done")
    a = ap.parse_args()
    from daily import london_today
    today = a.date or london_today()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    st = json.loads(STATE.read_text()) if STATE.exists() else {"sailings": {}, "tried": {}}
    if st.get("read_on") == today and not a.force:
        print("France competitor prices: already read today.")
        return 0
    site = Site(HV, lang="fr-FR")
    if site.rp is None:
        print("France competitor prices: Havas Voyages' robots.txt couldn't be read, so nothing was read.")
        return 2
    urls, full = sitemap(site)
    print(f"Havas sitemap: {len(urls)} cruise pages ({'complete' if full else 'cut short: no page is marked gone today'})")
    S, tried, changes = st["sailings"], st["tried"], []
    # Today's pages: every competing itinerary still live, then new candidates (from France, never read before)
    track = [i for i, r in S.items() if not r.get("gone")]
    new = sorted((i for i, u in urls.items() if i not in S and i not in tried and slug_rank(u) is not None),
                 key=lambda i: slug_rank(urls[i]))[:NEW_PER_RUN]
    ok = failed = 0
    for i in track + new:
        if site.count >= a.max_pages:
            print(f"Stopped at the {a.max_pages}-page cap")
            break
        url = urls.get(i) or S.get(i, {}).get("link")
        try:
            r = read(site.get(urllib.parse.quote(url, safe=":/?=&%")), url)
        except urllib.error.HTTPError as e:
            if e.code in (404, 410) and i in S:
                S[i]["gone"] = today
                changes.append({"type": "gone", "id": i, "why": f"page {e.code}"})
                ok += 1
            elif e.code in (404, 410):
                tried[i] = today
            else:
                print(f"  {url}: {e.code} {e.reason}")
                failed += 1
            continue
        except PermissionError as e:
            print(f"  {e}")
            continue
        except Exception as e:  # noqa: one page failing doesn't stop the check
            print(f"  {url}: {e}")
            failed += 1
            continue
        ok += 1
        area = competes(r) if r else None
        if i not in S:
            if not area:
                tried[i] = today
                continue
            S[i] = {"first_seen": today, "prices": []}
            changes.append({"type": "new", "id": i, "p": r["price"]})
        rec = S[i]
        if not r:   # no price shown any more
            if not rec.get("gone"):
                rec["gone"] = today
                changes.append({"type": "gone", "id": i, "why": "no price on the page"})
            continue
        before = rec["prices"][-1]["p"] if rec["prices"] else None
        rec.update({k: r[k] for k in ("line", "operator", "title", "ship", "nights", "start", "end", "ports", "region")},
                   area=area or rec.get("area"), link=url, last_seen=today)
        rec.pop("gone", None)
        if seg_update(rec["prices"], r["price"], None, today) and before is not None:
            changes.append({"type": "price_drop" if r["price"] < before else "price_rise", "id": i, "from": before, "to": r["price"]})
    attempted = ok + failed
    if attempted >= 10 and ok < attempted / 2:
        print(f"France competitor prices: only {ok} of {attempted} pages could be read, so nothing was saved.")
        return 2
    if full:   # a complete sitemap no longer listing an itinerary: it has been taken off sale
        for i, r in S.items():
            if not r.get("gone") and i not in urls:
                r["gone"] = today
                changes.append({"type": "gone", "id": i, "why": "no longer listed"})
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=GONE_DAYS)).isoformat()
    st["sailings"] = {i: r for i, r in S.items() if not r.get("gone") or r["gone"] >= cutoff}
    st.update(read_on=today, fetched_at=now, source="Havas Voyages (havas-voyages.fr)", lines=LINES, areas=AREAS,
              pages_read=site.count, sitemap_pages=len(urls), sitemap_complete=full)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1))
    RUNS.mkdir(parents=True, exist_ok=True)
    rp = RUNS / f"{today}.json"
    run = json.loads(rp.read_text()) if rp.exists() else {"date": today, "changes": []}
    run["changes"] += [{**c, "at": now} for c in changes]
    rp.write_text(json.dumps(run, ensure_ascii=False, indent=1))
    live = [r for r in st["sailings"].values() if not r.get("gone")]
    by_area = ", ".join(f"{AREAS[k]} {sum(1 for r in live if r.get('area') == k)}" for k in AREAS)
    print(f"France competitor prices: {len(live)} competing itineraries ({by_area}); "
          f"{len(new)} new pages tried, {site.count} requests, {len(changes)} changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
