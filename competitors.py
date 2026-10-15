"""Competitor prices and offers (Sam, 15 Oct 2026: "Go ahead with Fred Olsen and Planet Cruise").

Terms review first (15 Oct 2026, see CLAUDE.md "Competitors"): of the 15 names in the competitor analysis,
only Fred. Olsen (no website terms of use; robots.txt allows the cruise pages) and the agents Planet Cruise,
iglu, Cruise.co.uk and Cruise Nation (booking terms only) don't restrict automated reading. P&O, Princess,
Marella, Saga, Cunard, MSC, Bolsover and Cruise1st either forbid it or block automated visitors, and this
never reads their sites. Planet Cruise sells P&O, Princess, Cunard, MSC, Royal Caribbean and Celebrity (and
Ambassador, for a like-for-like agent comparison), so their prices come from there: the AGENT's prices, which
can include its own discounts and "was" figures.

How it reads, politely (the same rules for both sites):
  * once a day, public pages only, nothing robots.txt disallows (checked with urllib.robotparser before
    every request), no booking systems, no logins;
  * every sailing Ambassador competes with (Sam, 15 Oct 2026: "capture all sailings that ambassador would compete
    with so no fly uk sailings and fly caribbean"), not the rest of the catalogue: sailings from a UK port (no-fly),
    and Caribbean sailings sold from the UK with flights (a UK-airport package, a departure from a Caribbean island,
    and every Marella Caribbean holiday), departing at least MIN_DAYS ahead (`competes`). Each page is read once to
    see whether it competes (pages that don't are remembered in `tried` and never read again; at most NEW_PER_RUN new
    pages a line per run, so the first days discover the lists); competing sailings are then read every day.
    Ambassador's own sailings at Planet Cruise stay a sample of CAP (our own prices come from our website);
  * PAUSE seconds between requests to a site, one request at a time, and an honest User-Agent.

What it records (state/competitors/current.json, runs/competitors/DATE.json):
  * per sailing: line, ship, title, port, UK departure, date, nights, link, and per cabin type the
    "from" price per person (twin; Fred. Olsen also solo) as segments {p, was, from}, like our own history;
  * offers: Planet Cruise's per-sailing promotion line and offer tags; Fred. Olsen's fare name per sailing
    and its brand-wide deals (the /cruise-deals pages' headlines), each with first seen / ended;
  * a change list per day (price up/down per cabin, offer added/ended, sailing added/gone).
Read-only and recorded only: it never touches an ad account, never feeds was/now claims, cards or anything
customer-facing. Ambassador's own prices for the comparison come from our saved state on the tracker page.

Runs inside the hourly price watch, once a UK day (the first check of the day; later checks skip it).

Usage: python competitors.py [--date YYYY-MM-DD] [--max-pages N] [--force]
Exit codes: 0 ok, 2 too few pages could be read (nothing saved).
"""
import argparse, datetime as dt, html, json, re, sys, time, urllib.error, urllib.request, urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "state" / "competitors" / "current.json"
RUNS = ROOT / "runs" / "competitors"
UA = "Mozilla/5.0 (compatible; AmbassadorPriceWatch/1.0; Ambassador Cruise Line digital team, competitor price sample)"
PAUSE = 2.0         # seconds between requests to the same site
CAP = {"ambassador": 20}   # a sample only for Ambassador at Planet Cruise; every competing sailing otherwise
NEW_PER_RUN = 80    # new pages a line per run, to find which sailings compete (the first days discover the lists)
MIN_DAYS = 7        # departures at least this many days ahead (as our own tracker)
CABINS = ("inside", "outside", "balcony", "suite")   # the comparable types; others kept as read

PC = "https://www.planetcruise.com"
FO = "https://www.fredolsencruises.com"
# Cruise lines read from Planet Cruise (its sitemap per line). Ambassador is there for the like-for-like comparison.
# Marella isn't in a sitemap there: its sailings are taken from the line's own page on Planet Cruise.
PC_LINES = {
    "po": ("P&O Cruises", "PAO"), "princess": ("Princess Cruises", "PSC"), "cunard": ("Cunard", "CND"),
    "marella": ("Marella Cruises", "/en/marella-cruises"),
    "msc": ("MSC Cruises", "MSC"), "royal": ("Royal Caribbean", "RLC"), "celebrity": ("Celebrity Cruises", "CYC"),
    "ambassador": ("Ambassador (at Planet Cruise)", "AMB"),
}
# Planet Cruise's UK departure port pages: the ships they link to are tried first (Royal Caribbean and Celebrity
# sail from the UK on only a few ships)
PC_UK_PORTS = ("southampton", "dover", "portsmouth", "liverpool", "newcastle")
# Tags that are features or buttons, not offers
NOT_OFFER = re.compile(r"(?i)^(book this deal online|no tips required|tips included|adults only|brand new sailing|"
                       r"drinks package available|no fly cruise|low deposit)$")
LINE_NAMES = {"fredolsen": "Fred. Olsen", **{k: v[0] for k, v in PC_LINES.items()}}
UK_PORTS = re.compile(r"(?i)\b(southampton|dover|portsmouth|liverpool|newcastle|tyne|tilbury|london|bristol|avonmouth|"
                      r"belfast|rosyth|edinburgh|leith|greenock|glasgow|hull|harwich|falmouth|cardiff|holyhead|"
                      r"invergordon|aberdeen|plymouth|poole|swansea|birkenhead|sunderland|kirkwall)\b")
# The Caribbean: a departure port or itinerary with any of these is a Caribbean sailing
CARIB = re.compile(r"(?i)caribbean|antilles|barbados|bridgetown|antigua|st\.? john'?s|st\.? lucia|castries|jamaica|montego|"
                   r"ocho rios|falmouth, jamaica|bahamas|nassau|aruba|cura[cç]ao|bonaire|st\.? kitts|basseterre|grenada|"
                   r"dominica|roseau|martinique|fort-de-france|guadeloupe|pointe-?[aà]-?pitre|st\.? maarten|philipsburg|"
                   r"puerto rico|san juan|cozumel|virgin islands|tortola|st\.? thomas|st\.? croix|trinidad|tobago|"
                   r"cayman|belize|costa maya|roatan|st\.? vincent|kingstown|bequia|turks|grand turk|la romana|samana|"
                   r"punta cana|cartagena|colon, panama|st\.? barts|guadeloupe|cuba|havana|santo domingo|dominican")
# A departure that is really a flight (Planet Cruise lists fly-cruise packages by the UK airport: "London Heathrow",
# "London Gatwick", "London Airports", "Manchester Airport"); the cruise's own start is then in the title
AIR = re.compile(r"(?i)airport|heathrow|gatwick|stansted|luton|flight|manchester|birmingham|east midlands")
MON = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                       "september", "october", "november", "december"])}
MON3 = {m[:3]: i for m, i in MON.items()}


class Site:
    """One host: robots.txt checked before every request, PAUSE between requests."""
    def __init__(self, base):
        self.base, self.last, self.count = base, 0.0, 0
        self.rp = urllib.robotparser.RobotFileParser()
        try:
            self.rp.parse(self._get(base + "/robots.txt").splitlines())
        except Exception:  # noqa: no robots.txt readable = don't read the site at all
            self.rp = None

    def _get(self, url, timeout=60):
        wait = self.last + PAUSE - time.time()
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        self.count += 1
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-GB"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, ConnectionError) as e:
            if isinstance(e, urllib.error.HTTPError):
                raise
            time.sleep(10)   # one retry after a dropped connection
            self.last = time.time()
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")

    def get(self, url):
        if self.rp is None:
            raise PermissionError("robots.txt couldn't be read: not reading this site")
        if not self.rp.can_fetch(UA, url):
            raise PermissionError(f"robots.txt disallows {url}")
        return self._get(url)


def text(h):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def money(s):
    m = re.search(r"£\s*([\d,]+(?:\.\d+)?)", html.unescape(s or ""))
    return round(float(m.group(1).replace(",", ""))) if m else None


def months_ahead(iso, today):
    d, t = dt.date.fromisoformat(iso), dt.date.fromisoformat(today)
    return (d.year - t.year) * 12 + d.month - t.month


# ---------- Planet Cruise ----------
def pc_candidates(site, code):
    """[(url, departure ISO)] from the line's sitemap, or for a path ("/en/marella-cruises") the sailings that
    page links to (the date is in the address: …/06-november-2028/481808)."""
    if code.startswith("/"):
        urls = {PC + u for u in re.findall(r'href="(?:https://www\.planetcruise\.com)?(/en/[a-z0-9-]+/[a-z0-9-]+/\d{2}-[a-z]+-\d{4}/\d+)"', site.get(PC + code))}
    else:
        urls = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", site.get(f"{PC}/en/sitemap-products-{code}.xml"))
    out = []
    for u in sorted(urls):
        m = re.search(r"/(\d{2})-([a-z]+)-(\d{4})/(\d+)$", u)
        if m and m.group(2) in MON:
            out.append((u, f"{m.group(3)}-{MON[m.group(2)]:02d}-{m.group(1)}"))
    return out


def pc_uk_ships(site):
    """Ship page names linked from Planet Cruise's UK departure port pages ("anthem-of-the-seas")."""
    ships = set()
    for port in PC_UK_PORTS:
        try:
            ships |= set(re.findall(r'href="https://www\.planetcruise\.com/en/([a-z0-9-]+)"', site.get(f"{PC}/en/cruises-from-{port}")))
        except Exception:  # noqa
            pass
    return sorted(ships)


def pc_cabin(label):
    l = label.lower()
    return ("inside" if "inside" in l or "interior" in l else "outside" if "outside" in l or "ocean" in l or "sea view" in l
            else "balcony" if "balcony" in l or "veranda" in l else "suite" if "suite" in l or "haven" in l or "grill" in l
            else re.sub(r"[^a-z]+", "_", l).strip("_") or None)


def pc_read(page, url, line=None):
    s = {"url": url, "source": "planetcruise"}
    h1 = re.search(r'<h1 class="itinerary-overview__title">(.*?)</h1>', page, re.S)
    s["title"] = text(h1.group(1)) if h1 else None
    m = re.search(r"Departure:\s*(\d{1,2}) (\w{3})\w* (\d{4})", text(page[:60000]))
    if m and m.group(2).lower() in MON3:
        s["departure_date"] = f"{m.group(3)}-{MON3[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"<p>\s*(\d+) nights\s*</p>", page)
    s["nights"] = int(m.group(1)) if m else None
    m = re.search(r"Ship:\s*<a[^>]*>(.*?)</a>", page, re.S)
    s["ship"] = text(m.group(1)) if m else None
    m = re.search(r'departs-from-message">(.*?)</div>', page, re.S)
    s["port"] = re.sub(r"(?i)^departs from\s*", "", text(m.group(1))) if m else None
    # Sold from the UK: a UK port (no-fly), or UK airports (a fly-cruise package, "London Airports"). Marella's
    # pages give no port line: its holidays are sold from the UK with flights, the port is in the title.
    s["fly"] = bool(s["port"] and AIR.search(s["port"])) or line == "marella"
    # The cruise's own start (and end) for a flight package or a page with no port line: from the title, "… from
    # Valencia with Stay, 4 November 2026" → "Valencia with Stay" (15 Oct 2026: fly-cruises from Valencia had been
    # counted as no-fly because "London Heathrow" matched "London")
    if (s["fly"] or not s["port"]) and s.get("title"):
        m = re.search(r" from (.+?), \d{1,2} \w+ \d{4}\s*$", s["title"]) or re.search(r" from ([^,|]+)", s["title"])
        if s["port"] and s["fly"]:
            s["flights"] = s["port"]
        s["port"] = re.split(r"\s*\|", m.group(1))[0].strip() if m else s["port"]
    s["uk"] = bool(s["port"] and UK_PORTS.search(s["port"]) and not AIR.search(s["port"])) or s["fly"]
    prices = {}
    for row in re.finditer(r'<div class="price-row-dl"[^>]*>(.*?)</a>', page, re.S):
        r = row.group(1)
        lab = re.search(r'<div class="price-label-dt">\s*<p>(.*?)</p>', r, re.S)
        fare = re.search(r'price-description-message">(.*?)</div>', r, re.S)
        val = re.search(r'price-value-dd">(.*)', r, re.S)
        if not lab or not val:
            continue
        was = re.search(r'price-value__wasprice">([^<]*)<', val.group(1))
        now = money(val.group(1).split("price-value__wasprice")[0])
        key = pc_cabin(text(lab.group(1)))
        if key and now and (key not in prices or now < prices[key]["p"]):
            prices[key] = {"p": now, "was": money(was.group(1)) if was else None, "fare": text(fare.group(1)) if fare else None}
    s["prices"] = {"twin": prices}
    itin = re.findall(r"Day \d+(?:-\d+)?:\s*([^<\n|]{2,60})", text(page[:80000]).replace(" Day ", "\nDay "))
    s["carib"] = bool(CARIB.search(" ".join([s.get("title") or "", s.get("port") or ""] + itin)))
    tags = [text(t) for t in re.findall(r'<li class="attribute-tooltip[^"]*"[^>]*>(.*?)</li>', page, re.S)]
    s["tags"] = [t for t in dict.fromkeys(tags) if t]
    promo = re.search(r'<div class="itinerary-promo-message"[^>]*>\s*<span>(.*?)</span>', page, re.S)
    s["promo"] = text(promo.group(1)) if promo else None
    return s


# ---------- Fred. Olsen ----------
FO_TYPES = {"interior": "inside", "ocean": "outside", "balcony": "balcony", "suite": "suite", "terrace": "terrace", "single": "single"}


def fo_candidates(site):
    return sorted({u for u in re.findall(r"<loc>\s*([^<\s]+/cruise/[^<\s]+)\s*</loc>", fo_sitemap(site))})


_FO_SITEMAP = {}


def fo_sitemap(site):
    if "x" not in _FO_SITEMAP:
        _FO_SITEMAP["x"] = site.get(FO + "/sitemap.xml")
    return _FO_SITEMAP["x"]


def fo_read(page, url):
    s = {"url": url, "source": "fredolsencruises"}
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "BoatTrip":
            term = d.get("departureBoatTerminal") or {}
            s.update(title=html.unescape(d.get("name") or ""), departure_date=(d.get("departureTime") or "")[:10] or None,
                     port=term.get("name"), uk=((term.get("address") or {}).get("addressCountry") == "GB"),
                     code=(d.get("offers") or {}).get("sku"))
            # Fred. Olsen's Caribbean sailings leave from a Caribbean island, with flights from the UK
            s["carib"] = bool(CARIB.search(f"{s['title']} {s['port'] or ''}"))
            s["fly"] = not s["uk"] and s["carib"]
            break
    m = re.search(r'fa-moon-stars"></i>\s*<span>(\d+) nights</span>', page)
    s["nights"] = int(m.group(1)) if m else None
    m = re.search(r'fa-ship"></i>\s*<span>(.*?)</span>', page, re.S)
    s["ship"] = text(m.group(1)) if m else None
    prices = {"twin": {}, "solo": {}}
    for m in re.finditer(r'<a id="(\w+)-(standard|solo)-tab" class="([^"]*)"(.*?)</a>', page, re.S):
        typ, occ, cls, body = m.groups()
        p = money(body)
        if "disabled" in cls or not p or typ not in FO_TYPES:
            continue
        prices["twin" if occ == "standard" else "solo"][FO_TYPES[typ]] = {"p": p, "was": None, "fare": None}
    fare = re.search(r'class="fare-type">([^<]*)<', page)
    s["fare"] = text(fare.group(1)).title() if fare else None
    for occ in prices.values():
        for v in occ.values():
            v["fare"] = s["fare"]
    s["prices"] = prices
    extras = re.search(r'<div class="extras-inner">(.*?)</div>', page, re.S)
    s["tags"] = [t for t in [text(extras.group(1)) if extras else ""] if t]
    s["promo"] = None
    return s


def fo_brand_offers(site, today):
    """Fred. Olsen's brand-wide deals: each /cruise-deals page's headline and first line ({title: text})."""
    xml = fo_sitemap(site)
    urls = sorted({u for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
                   if re.search(r"/(cruise-deals(/[^/]+)?|last-minute-cruise-deals|black-friday-cruise-deals)$", u)})
    out = {}
    for u in urls[:12]:
        try:
            p = site.get(u)
        except Exception:  # noqa
            continue
        main = p[p.find("<main"):p.find("</main>")] if "<main" in p else p
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", main, re.S)
        if not h1 or u.rstrip("/").endswith("/cruise-deals"):
            continue
        after = main[h1.end():]
        sub = re.search(r"<(?:h2|h3|p)[^>]*>(.*?)</(?:h2|h3|p)>", after, re.S)
        title, line1 = text(h1.group(1)), text(sub.group(1)) if sub else ""
        if re.search(r"(?i)now closed|currently unavailable|no longer available|has ended", line1):
            continue   # the page is still there but says the deal is over
        if title:
            out[title] = {"text": text(sub.group(1))[:200] if sub else "", "url": u}
    return out


# ---------- sample ----------
def ends(s):
    """(start, end, stay) of a sailing from its port line: "Southampton", "St. Kitts to Southampton",
    "Southampton with New York Stay" → stay "New York"."""
    p = s.get("port") or ""
    stay = " ".join(re.findall(r"(?i)\bwith (.+?) stays?\b", p))
    route = re.sub(r"(?i)\s+with\s+.*$", "", p).strip()
    a, _, b = route.partition(" to ")
    # The title can say more than the port line (15 Oct 2026: "… cruise from Southampton to Barcelona" and "Niagara
    # Falls & New York Stays with Westbound Transatlantic Crossing from Southampton" had a port line of just "Southampton")
    t = re.sub(r"\s*\|.*$", "", re.sub(r",\s*\d{1,2} \w+ \d{4}\s*$", "", s.get("title") or ""))
    m = re.search(r" from (.+?) to (.+?)(?: with |$)", t)
    if m and not b and m.group(1).strip().lower() == a.strip().lower():
        b = m.group(2).strip()
    stay = " ".join([stay] + [re.split(r"(?i)\bwith ", x)[-1] for x in re.findall(r"(?i)(?:^|\bwith )([^,|]+?) stays?\b", t)]).strip()
    return a.strip(), (b or a).strip(), stay


def competes(s):
    """What Ambassador competes with (Sam, 15 Oct 2026, after fly-cruises from Valencia showed up):
    "no-fly" = starts AND ends at a UK port, no flight and no hotel stay abroad (one-way crossings and
    "with New York Stay" packages need a flight home); "fly-caribbean" = a Caribbean sailing that starts in the
    Caribbean, or sails between the UK and the Caribbean (as Ambassador's own Tilbury–Barbados crossings), sold with
    or without flights. Everything else (Mediterranean fly-cruises, Florida, Hawaii, South America…) is left out."""
    a, b, stay = ends(s)
    uk = lambda x: bool(x) and bool(UK_PORTS.search(x)) and not AIR.search(x)
    ukA = uk(a) or (s.get("source") == "fredolsencruises" and s.get("uk") and not s.get("fly") and a == (s.get("port") or ""))
    ukB = uk(b) or (ukA and a == b)
    if not s.get("fly") and ukA and ukB and not (stay and not uk(stay)):
        return "no-fly"
    cA, cB = bool(a and CARIB.search(a)), bool(b and CARIB.search(b))
    if s.get("carib") and ((cA and (cB or ukB)) or (ukA and cB)) and not (stay and not (CARIB.search(stay) or uk(stay))):
        return "fly-caribbean"
    return None


def spread(cands, n):
    """n candidates spread over the months (round robin by month, earliest first)."""
    by = {}
    for u, d in sorted(cands, key=lambda x: x[1]):
        by.setdefault(d[:7], []).append((u, d))
    out, months = [], sorted(by)
    while len(out) < n and any(by.values()):
        for mth in months:
            if by[mth] and len(out) < n:
                out.append(by[mth].pop(0))
    return out


def seg_update(segs, p, was, today):
    if not segs or segs[-1]["p"] != p or segs[-1].get("was") != was:
        segs.append({"p": p, "was": was, "from": today})
        del segs[:-24]   # last 24 changes
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--max-pages", type=int, default=2500, help="safety cap on pages read in one run")
    ap.add_argument("--force", action="store_true", help="run even if today's check has been done")
    a = ap.parse_args()
    from daily import london_today
    today = a.date or london_today()
    at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    st = json.loads(STATE.read_text()) if STATE.exists() else {"since": today, "sample": {}, "tried": {}, "sailings": {}, "brand_offers": {}}
    if st.get("updated") == today and not a.force:
        print(f"Competitors: already checked today ({st.get('updated_at')}).")
        return 0
    changes, problems = [], []
    pc, fo = Site(PC), Site(FO)
    read_ok = read_tried = 0

    def note(**c):
        changes.append({"at": at, **c})

    def record(line, sid, s):
        old = st["sailings"].get(sid)
        r = old or {"line": line, "first_seen": today, "prices": {}, "offers": {}}
        if not old:
            note(kind="new", line=line, id=sid, title=s.get("title"))
        r.update({k: s.get(k) for k in ("url", "source", "title", "ship", "port", "flights", "uk", "fly", "carib", "segment", "departure_date", "nights", "code", "fare") if s.get(k) is not None})
        r["last_seen"], r["checked_at"] = today, at
        r.pop("gone", None)
        for occ, cab in (s.get("prices") or {}).items():
            for c, v in cab.items():
                key = f"{occ}.{c}"
                segs = r["prices"].setdefault(key, [])
                before = segs[-1]["p"] if segs else None
                if seg_update(segs, v["p"], v.get("was"), today) and before is not None and before != v["p"]:
                    note(kind="price_drop" if v["p"] < before else "price_rise", line=line, id=sid, cabin=key, old=before, new=v["p"])
        for key, segs in r["prices"].items():   # a cabin type no longer priced = not on sale (sold out)
            occ, c = key.split(".", 1)
            if segs and segs[-1]["p"] is not None and c not in ((s.get("prices") or {}).get(occ) or {}):
                segs.append({"p": None, "was": None, "from": today})
                note(kind="cabin_off", line=line, id=sid, cabin=key, old=segs[-2]["p"])
        offers = ([s["promo"]] if s.get("promo") else []) + [t for t in s.get("tags") or [] if OFFERISH.search(t) and not NOT_OFFER.match(t)]
        for o in offers:
            spans = r["offers"].setdefault(o[:240], [])
            if not spans or spans[-1][1] is not None:
                spans.append([today, None])
                if old:
                    note(kind="offer_added", line=line, id=sid, offer=o[:240])
        for o, spans in r["offers"].items():
            if spans and spans[-1][1] is None and o not in [x[:240] for x in offers]:
                spans[-1][1] = today
                note(kind="offer_ended", line=line, id=sid, offer=o)
        r["tags"] = s.get("tags") or []
        st["sailings"][sid] = r

    # ---- Planet Cruise lines ----
    if st.get("uk_ships_at", "")[:10] < (dt.date.fromisoformat(today) - dt.timedelta(days=7)).isoformat():
        st["uk_ships"], st["uk_ships_at"] = pc_uk_ships(pc) or st.get("uk_ships", []), today   # weekly
    uk_ships = set(st.get("uk_ships") or [])
    for line, (name, code) in PC_LINES.items():
        sample, tried = st["sample"].setdefault(line, []), set(st["tried"].setdefault(line, []))
        try:
            soon = (dt.date.fromisoformat(today) + dt.timedelta(days=MIN_DAYS)).isoformat()
            cands = [(u, d) for u, d in pc_candidates(pc, code) if d > soon]
        except Exception as e:  # noqa
            problems.append(f"{name}: Planet Cruise's list couldn't be read ({str(e)[:100]})")
            cands = None
        live = {u for u, _ in cands} if cands is not None else set(sample)
        # departed or gone from the list: out of the sample
        for u in list(sample):
            sid = "pc:" + u.rsplit("/", 1)[1]
            r = st["sailings"].get(sid) or {}
            if u not in live or (r.get("departure_date") or "9") <= today:
                sample.remove(u)
                if r and not r.get("gone"):
                    r["gone"] = today
                    note(kind="gone", line=line, id=sid, title=r.get("title"))
        todo = list(sample)
        cap = CAP.get(line)
        if cands is not None and (cap is None or len(sample) < cap):
            pool = [c for c in cands if c[0] not in tried and c[0] not in sample]
            first = [c for c in pool if c[0].split("/")[5] in uk_ships]   # ships that sail from the UK first
            new = spread(first, NEW_PER_RUN)
            new += spread([c for c in pool if c not in first], NEW_PER_RUN - len(new))
            todo += [u for u, _ in new]
        for u in todo:
            if pc.count + fo.count >= a.max_pages:
                break
            sid = "pc:" + u.rsplit("/", 1)[1]
            read_tried += 1
            try:
                s = pc_read(pc.get(u), u, line)
            except Exception as e:  # noqa
                problems.append(f"{name} {u}: {str(e)[:100]}")
                continue
            if not s["prices"]["twin"]:
                if u not in sample:
                    tried.add(u)
                continue
            read_ok += 1
            s["segment"] = competes(s)
            if not s["segment"]:   # doesn't compete with Ambassador (or no longer does): not tracked
                tried.add(u)
                if u in sample:
                    sample.remove(u)
                    st["sailings"].pop(sid, None)
                continue
            if u not in sample:
                tried.add(u)
                if cap is not None and len(sample) >= cap:
                    continue
                sample.append(u)
            record(line, sid, s)
        st["tried"][line] = sorted(tried)[-6000:]

    # ---- Fred. Olsen, directly ----
    line = "fredolsen"
    sample, tried = st["sample"].setdefault(line, []), set(st["tried"].setdefault(line, []))
    try:
        all_urls = fo_candidates(fo)
    except Exception as e:  # noqa
        problems.append(f"Fred. Olsen: its sitemap couldn't be read ({str(e)[:100]})")
        all_urls = None
    live = set(all_urls) if all_urls is not None else set(sample)
    for u in list(sample):
        sid = "fo:" + u.rstrip("/").rsplit("/", 1)[1]
        r = st["sailings"].get(sid) or {}
        if u not in live or (r.get("departure_date") or "9") <= today:
            sample.remove(u)
            if r and not r.get("gone"):
                r["gone"] = today
                note(kind="gone", line=line, id=sid, title=r.get("title"))
    todo = list(sample)
    if all_urls is not None:
        todo += [u for u in all_urls if u not in tried and u not in sample][:NEW_PER_RUN * 3]   # ~180 pages: all on day one
    for u in todo:
        if pc.count + fo.count >= a.max_pages:
            break
        sid = "fo:" + u.rstrip("/").rsplit("/", 1)[1]
        read_tried += 1
        try:
            s = fo_read(fo.get(u), u)
        except Exception as e:  # noqa
            problems.append(f"Fred. Olsen {u}: {str(e)[:100]}")
            continue
        if not s["prices"]["twin"] and not s["prices"]["solo"]:
            if u not in sample:
                tried.add(u)
            continue
        read_ok += 1
        d = s.get("departure_date")
        s["segment"] = competes(s)
        if not s["segment"] or not d or d <= (dt.date.fromisoformat(today) + dt.timedelta(days=MIN_DAYS)).isoformat():
            tried.add(u)
            if u in sample:
                sample.remove(u)
                st["sailings"].pop(sid, None)
            continue
        if u not in sample:
            tried.add(u)
            sample.append(u)
        record(line, sid, s)
    st["tried"][line] = sorted(tried)[-6000:]
    try:
        brand = fo_brand_offers(fo, today)
        bo = st["brand_offers"].setdefault(line, {})
        for t, v in brand.items():
            e = bo.get(t)
            if not e or e.get("ended"):
                bo[t] = {"text": v["text"], "url": v["url"], "first_seen": today, "last_seen": today}
                if st["sailings"]:
                    note(kind="offer_added", line=line, offer=t)
            else:
                e.update(text=v["text"], url=v["url"], last_seen=today)
        for t, e in bo.items():
            if t not in brand and not e.get("ended") and brand:
                e["ended"] = today
                note(kind="offer_ended", line=line, offer=t)
    except Exception as e:  # noqa
        problems.append(f"Fred. Olsen deals: {str(e)[:100]}")

    # Safety: a broken read mustn't record every sailing as gone or every cabin as sold out
    if read_tried and read_ok < read_tried * 0.5:
        print(f"Competitors: only {read_ok} of {read_tried} pages could be read; nothing saved.\n" + "\n".join(problems[:20]))
        return 2
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=60)).isoformat()   # keep the data small: gone over 60 days
    st["sailings"] = {k: r for k, r in st["sailings"].items() if not (r.get("gone") and r["gone"] < cutoff)}
    st["updated"], st["updated_at"], st["lines"] = today, at, LINE_NAMES
    st["pages_read"] = pc.count + fo.count
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))
    RUNS.mkdir(parents=True, exist_ok=True)
    rp = RUNS / f"{today}.json"
    run = json.loads(rp.read_text()) if rp.exists() else {"date": today, "changes": [], "checks": []}
    run["changes"] += changes
    run["checks"].append({"at": at, "pages": pc.count + fo.count, "problems": problems[:30]})
    rp.write_text(json.dumps(run, ensure_ascii=False, indent=1))
    n = {k: sum(1 for r in st["sailings"].values() if r["line"] == k and not r.get("gone")) for k in LINE_NAMES}
    print(f"Competitors {today}: {pc.count} Planet Cruise + {fo.count} Fred. Olsen pages read; " +
          ", ".join(f"{LINE_NAMES[k]} {v}" for k, v in n.items()) + f"; {len(changes)} change(s).")
    for p in problems[:15]:
        print("  problem:", p)
    return 0


OFFERISH = re.compile(r"(?i)£|%|free|save|saving|deposit|onboard|on board|credit|launch|pre.?register|deal|offer|"
                      r"reduc|discount|upgrade|sale|half price")

if __name__ == "__main__":
    sys.exit(main())
