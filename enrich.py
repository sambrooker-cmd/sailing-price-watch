"""Fetch the Ambassador ad feed, enrich each sailing from its landing page,
and write a dated snapshot (JSON) plus a combined history file.

Usage: python3 enrich.py [YYYY-MM-DD]
"""
import csv, html, io, json, re, sys, datetime, urllib.request, concurrent.futures as cf
from pathlib import Path

FEED = "https://booking.ambassadorcruiseline.com/api/cruises/ad-feeds/google"
ROOT = Path(__file__).parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
SHIPS = {"A1": "Ambience", "A2": "Ambition", "A3": "Renaissance"}
UA = {"User-Agent": "Mozilla/5.0 (feed-ads monitor)"}


def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def money(v):
    return f"£{v:,.0f}"


def parse_desc(d):
    # "London Tilbury - 14 nights - Embark on ..."
    m = re.match(r"\s*(.+?)\s+-\s+(\d+)\s+nights?\s+-\s+(.*)$", d, re.S)
    if not m:
        return None, None, d.strip()
    return m.group(1).strip(), int(m.group(2)), m.group(3).strip()


CABIN_KEYS = {"inner": "inside", "outer": "ocean_view", "balcony": "balcony", "suite": "suite"}


def _dv(x):
    # Astro island props encode values as [0, value] and arrays as [1, [...]].
    if isinstance(x, list) and len(x) == 2 and x[0] in (0, 1):
        return [_dv(i) for i in x[1]] if x[0] == 1 else _dv(x[1])
    if isinstance(x, dict):
        return {k: _dv(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_dv(i) for i in x]
    return x


def cabin_fares(page):
    """Per-person prices by cabin type from the page's CabinTypes component.
    Returns {"twin": {"inside": 719, "suite": 1579, ...}, "solo": {...}}.
    A cabin type missing from the page is not on sale (usually sold out).
    Returns None when the component isn't on the page at all."""
    m = re.search(r'<astro-island[^>]*component-url="[^"]*CabinTypes[^"]*"[^>]*props="([^"]*)"', page)
    if not m:
        return None
    try:
        props = {k: _dv(v) for k, v in json.loads(html.unescape(m.group(1))).items()}
    except Exception:  # noqa
        return None
    fd = props.get("fare-data") or {}
    out = {}
    for occ in ("twin", "solo"):
        for typ, v in ((fd.get(occ) or {}).get("byType") or {}).items():
            p = ((v or {}).get("standard") or {}).get("price")
            if typ in CABIN_KEYS and isinstance(p, (int, float)) and p > 0:
                out.setdefault(occ, {})[CABIN_KEYS[typ]] = p
    return out


def offers(page):
    """Promotions shown on the sailing page, from its FareSummary component:
    [{"id", "name", "description", "expires_at"}]. [] when the component is
    there with no offers; None when it can't be read (so nothing is recorded
    as having ended just because a page didn't parse)."""
    m = re.search(r'<astro-island[^>]*component-url="[^"]*FareSummary[^"]*"[^>]*props="([^"]*)"', page)
    if not m:
        return None
    try:
        props = {k: _dv(v) for k, v in json.loads(html.unescape(m.group(1))).items()}
    except Exception:  # noqa
        return None
    out = []
    for o in props.get("offers") or []:
        if not isinstance(o, dict) or not (o.get("id") and o.get("name")):
            continue
        out.append({"id": o["id"], "name": o["name"].strip(),
                    "description": (o.get("description") or "").strip(),
                    "expires_at": o.get("expires_at") or None})
    return out


def nectar(page):
    """Nectar points from the FareSummary component's search data (nectar_points), for two
    guests sharing (twin) and one (solo), per cabin grade and fare:
    {"eligible": bool, "twin": {"inside": {"standard": 30000, "ambassador": 50000}, ...}, "solo": {...}}.
    Points come from the booking value in bands, so they follow the price.
    None when it can't be read."""
    m = re.search(r'<astro-island[^>]*component-url="[^"]*FareSummary[^"]*"[^>]*props="([^"]*)"', page)
    if not m:
        return None
    try:
        sd = _dv(json.loads(html.unescape(m.group(1)))).get("search-data") or {}
    except Exception:  # noqa
        return None
    np_ = sd.get("nectar_points")
    if not isinstance(np_, dict):
        return None
    out = {"eligible": bool(sd.get("isNectarEligible"))}
    for occ, guests in (("twin", "2"), ("solo", "1")):
        for typ, v in ((np_.get(occ) or {}).get("byType") or {}).items():
            if typ not in CABIN_KEYS or not isinstance(v, dict):
                continue
            pts = {fare: (v.get(fare) or {}).get(guests) for fare in ("standard", "ambassador")}
            pts = {k: int(x) for k, x in pts.items() if isinstance(x, (int, float)) and x > 0}
            if pts:
                out.setdefault(occ, {})[CABIN_KEYS[typ]] = pts
    return out


def nectar_headline(s):
    """The figure the sailing page shows: two guests sharing the cheapest cabin grade on sale,
    Ambassador fare (the site's useMaxNectarPoints: twin, lead-in, ambassador, 2 guests).
    0 when the sailing isn't Nectar eligible; None when unknown."""
    nx = s.get("nectar")
    if not nx:
        return None
    if not nx.get("eligible"):
        return 0
    twin = (s.get("cabins") or {}).get("twin") or {}
    if not twin:
        return None
    grade = min(twin, key=twin.get)
    return ((nx.get("twin") or {}).get(grade) or {}).get("ambassador")


PHOTO = re.compile(r"https://assets\.ambassadorcruiseline\.com/f/\d+/(\d+)x(\d+)/[0-9a-f]+/[^\"'&?\s)]+?\.(?:jpe?g|png|webp)", re.I)


def photos(page, most=12):
    """Large landscape photos on a sailing's page (destinations, the ship), for the ad creator
    to offer instead of the feed image (Sam, 12 Oct 2026). Small images (ship thumbnails,
    entertainers' portraits) are skipped."""
    out = []
    for m in PHOTO.finditer(page):
        w, h = int(m.group(1)), int(m.group(2))
        if w >= 1200 and h >= 700 and w / h <= 2.2 and m.group(0) not in out:
            out.append(m.group(0))
    return out[:most]


def page_fields(url):
    out = {}
    try:
        s = get(url)
    except Exception as e:  # noqa
        return {"page_error": str(e)[:120]}
    cf_ = cabin_fares(s)
    if cf_ is not None:
        out["cabins"] = cf_
    of = offers(s)
    if of is not None:
        out["offers"] = of
    nx = nectar(s)
    if nx is not None:
        out["nectar"] = nx
    ph = photos(s)
    if ph:
        out["photos"] = ph
    t = re.sub(r"<[^>]+>", "|", s)
    t = re.sub(r"\|[\s|]*", "|", t).replace("&amp;", "&")
    for key, label in [("date_text", "Date:"), ("duration_text", "Duration:"),
                       ("departure_page", "Departure:"), ("ship_page", "Ship:")]:
        m = re.search(re.escape(label) + r"\s*\|([^|]{1,60})\|", t)
        if m:
            out[key] = m.group(1).strip()
    # Sailing-specific offer block (skip the nav-menu deal links)
    body = t.split("Cruise Code:", 1)[-1]
    m = re.search(r"\|(Up to £[\d,]+ Onboard Credit)\|", body)
    if m:
        out["offer"] = m.group(1)
    if "date_text" in out:
        try:
            out["departure_date"] = datetime.datetime.strptime(out["date_text"], "%d %B %Y").date().isoformat()
        except ValueError:
            pass
    return out


def main(day):
    raw = get(FEED)
    (DATA / f"feed_{day}.csv").write_text(raw, encoding="utf-8")
    rows = list(csv.DictReader(io.StringIO(raw)))
    with cf.ThreadPoolExecutor(8) as ex:
        pages = list(ex.map(lambda r: page_fields(r["link"]), rows))
    sailings = []
    for r, p in zip(rows, pages):
        port, nights, blurb = parse_desc(r["description"])
        amt, cur = (r["price"].split() + ["GBP"])[:2]
        sid = r["id"]
        fly = "(Heathrow Airport)" in r["title"] or "(Manchester Airport)" in r["title"]
        s = {
            "id": sid,
            "title": r["title"],
            "base_title": re.sub(r"\s*\((Heathrow|Manchester) Airport\)", "", r["title"]).strip(),
            "flight_from": ("Heathrow" if "Heathrow" in r["title"] else "Manchester") if fly else None,
            "ship": SHIPS.get(sid[:2].upper()),
            "port": port, "nights": nights, "blurb": blurb,
            "price_pp": float(amt), "currency": cur, "feed_price_pp": float(amt),
            "link": r["link"], "image_link": r["image_link"],
            "availability": r["availability"],
            **p,
        }
        # The "from" price is the cheapest twin cabin on the sailing's own page, read every check (Sam,
        # 13 Oct 2026: the feed can lag the website). price_source says where price_pp came from:
        #   page   cheapest twin cabin on the page
        #   solo   page read, but no twin cabin on sale: the feed's price (a solo price), as before
        #   feed   the page's prices couldn't be read: the feed's price; tracker.py keeps the last
        #          "from" price instead, and cards_sync.py leaves the cards as they are
        tw = (s.get("cabins") or {}).get("twin") or {}
        if tw and "page_error" not in s:
            s["price_pp"], s["price_source"] = float(min(tw.values())), "page"
        else:
            s["price_source"] = "solo" if s.get("cabins") and "page_error" not in s else "feed"
        if s.get("nectar"):
            s["nectar_pts"] = nectar_headline(s)
        flags = []
        if s.get("ship_page") and s["ship"] and s["ship_page"] != s["ship"]:
            flags.append(f"ship mismatch: code says {s['ship']}, page says {s['ship_page']}")
        if s.get("departure_page") and port and s["departure_page"] != port and not fly:
            flags.append(f"port mismatch: feed '{port}', page '{s['departure_page']}'")
        # Transatlantic fly-cruises sail out of Tilbury and fly home, so a UK
        # port on a fly-cruise is legitimate — no flag.
        if not s.get("departure_date"):
            flags.append("no departure date found")
        if "cabins" not in s and "page_error" not in s:
            flags.append("no cabin prices found on the landing page")
        elif not tw and (s.get("cabins") or {}).get("solo"):
            flags.append("no twin cabins on sale; the feed price is a solo price")
        elif tw and min(tw.values()) != s["feed_price_pp"]:
            flags.append(f"feed price {money(s['feed_price_pp'])} differs from cheapest cabin on the page "
                         f"{money(min(tw.values()))} (the page price is used)")
        if re.search(r"(cotw|dig-\d|carousel|boom-radio|back_to_90s)", r["image_link"], re.I):
            flags.append("feed image looks like campaign art (may contain text)")
        s["flags"] = flags
        sailings.append(s)
    snap = {"date": day, "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "count": len(sailings), "sailings": sailings}
    (DATA / f"snapshot_{day}.json").write_text(json.dumps(snap, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{day}: {len(sailings)} sailings, "
          f"{sum(1 for s in sailings if s.get('departure_date'))} with dates, "
          f"{sum(1 for s in sailings if s['flags'])} flagged")
    return snap


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat())
