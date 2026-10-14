"""France (Ambassador Croisières, ambassadorcroisieres.fr): read every sailing on sale and write a dated
snapshot in the same shape as enrich.py's, so tracker.py can keep its price history (Sam, 14 Oct 2026:
"do all of it for France"; built as if France has no ad feed).

Where things come from:
  sailings     the site's cruise list page (/croisieres, its "totalCount" and links) plus the sitemap
  details      each cruise page's own data (Next.js payload): code, title, dates, nights, ports, offer
               tags, destination photos with captions; and the "À partir de" figure the page shows
  prices       the site's booking API (/api/tiller/cabin-categories, what the page's "Les cabines" block
               asks): per cabin type, the lowest price per person for 2 adults sharing (twin) and for 1
               adult (solo), and how many cabins are left. A type with no cabins left isn't on sale.

The "from" price (price_pp) is the cheapest twin cabin on sale in booking (price_source "page"). When booking
can't be read, price_source is "feed" and tracker.py keeps the last from price (same rule as the UK).
feed_price_pp holds the figure the cruise page itself shows, so tracker.py's feed-gap check becomes
"page vs booking" for France.

No was/now for France (Sam, 14 Oct 2026: "leave the was now pricing for now"). The site's own struck-through
"barred" price is recorded in the snapshot only (site_barred_pp), never in state or on the tracker.

Usage: python3 fr_enrich.py [YYYY-MM-DD]   -> data/fr/snapshot_DATE.json
"""
import datetime, html, json, re, sys, threading, time, urllib.request, concurrent.futures as cf
from pathlib import Path

SITE = "https://www.ambassadorcroisieres.fr"
LIST = SITE + "/croisieres"
SITEMAP = SITE + "/sitemap.xml"
CABIN_API = SITE + "/api/tiller/cabin-categories"
CMS = "https://cms.ambassadorcroisieres.fr/assets/"
ROOT = Path(__file__).parent
DATA = ROOT / "data" / "fr"
UA = {"User-Agent": "Mozilla/5.0 (price monitor; Ambassador digital team)"}
SHIP = "Renaissance"   # the French market's ship (code RN2 in booking)
# Booking's cabin categories → the tracker's cabin keys (by category id, with the French name as a fallback)
CABIN_IDS = {1: "inside", 7: "obstructed", 2: "ocean_view", 6: "promenade", 5: "balcony", 3: "suite", 4: "grand_suite"}
CABIN_NAMES = {"Intérieure": "inside", "Vue Mer Obstruée": "obstructed", "Vue Mer": "ocean_view", "Terrasse Promenade": "promenade",
               "Balcon": "balcony", "Suite": "suite", "Grande Suite Renaissance": "grand_suite"}
CODE = re.compile(r"/croisieres/([^\"?#\s<>\\]*?-(r\d{6}[a-z]*))(?=[\"'?#\s<>/\\]|$)", re.I)   # slugs can hold ' ("rivages-de-l'atlantique")
# Travel notices shown as tags ("Passeport obligatoire", "Taxes lors des escales en Grèce non incluses"): kept as
# notices, not offers
NOTICE = re.compile(r"passeport|\beta\b|visa|taxes?\b|obligatoire", re.I)
BOOKING = threading.Lock()   # booking answers "Internal Server Error" to calls made in parallel: one at a time


def get(url, data=None, timeout=40, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **({"Content-Type": "application/json"} if data else {})},
                                         data=json.dumps(data).encode() if data else None)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:  # noqa
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def flight(page):
    """The page's Next.js payload (self.__next_f.push chunks) as one string."""
    parts = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', page, re.S)
    out = []
    for p in parts:
        try:
            out.append(json.loads('"' + p + '"'))
        except ValueError:
            pass
    return "".join(out)


def cruise_object(text, code):
    """The cruise record (the object holding "cruise_code") from the payload."""
    i = text.find(f'"cruise_code":"{code}"')
    if i < 0:
        m = re.search(r'"cruise_code":"(R\d{6}[A-Z]*)"', text)
        if not m:
            return None
        i = m.start()
    dec, j = json.JSONDecoder(), i
    for _ in range(400):
        j = text.rfind("{", 0, j)
        if j < 0:
            return None
        try:
            o, end = dec.raw_decode(text, j)
        except ValueError:
            continue
        if end > i and isinstance(o, dict) and "cruise_code" in o:
            return o
    return None


def fr(translations, field):
    """The French text of a Directus translations list (any language if there's no French)."""
    ts = translations or []
    t = next((t for t in ts if t.get("languages_code") == "fr"), ts[0] if ts else {})
    return (t or {}).get(field)


def strip(h):
    return html.unescape(re.sub(r"<[^>]+>", "", h or "")).replace("\xa0", " ").strip()


def shown_price(page):
    """The "À partir de" figure the page shows (its schema.org Trip offer)."""
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "Trip":
            try:
                return float((d.get("offers") or {}).get("price"))
            except (TypeError, ValueError):
                return None
    return None


def cabins(code, date):
    """{"twin": {key: price per person}, "solo": {...}}, {key: cabins left (twin)}; None when booking can't be read."""
    out, left = {}, {}
    for occ, adults in (("twin", 2), ("solo", 1)):
        for i in range(3):
            with BOOKING:
                d = json.loads(get(CABIN_API, {"locale": "fr", "cruise_code": code, "departure_date": date,
                                               "no_of_passengers": {"adults": adults, "children": 0, "count": adults}}))
            if d.get("status"):
                break
            time.sleep(2 * (i + 1))
        else:
            raise ValueError(d.get("message") or "booking said no")
        for c in d.get("data") or []:
            key = CABIN_IDS.get(c.get("id")) or CABIN_NAMES.get(fr(c.get("translations"), "category_name"))
            n, p = c.get("cabinsAvailable") or 0, c.get("lowestPerPersonPrice") or 0
            if not key or n <= 0 or p <= 0:
                continue   # sold out (or not offered for this many guests)
            out.setdefault(occ, {})[key] = float(p)
            if occ == "twin":
                left[key] = n
    return out, left


def sailing_urls():
    """Cruise page URLs from the cruise list (with its own total) and the sitemap: {code: url}, list total."""
    urls, total = {}, None
    page = get(LIST)
    m = re.search(r'\\?"totalCount\\?":(\d+)', page)
    total = int(m.group(1)) if m else None
    for m in CODE.finditer(html.unescape(page)):
        urls.setdefault(m.group(2).upper(), SITE + "/croisieres/" + m.group(1))
    try:
        for m in CODE.finditer(get(SITEMAP)):
            urls.setdefault(m.group(2).upper(), SITE + "/croisieres/" + m.group(1))
    except Exception:  # noqa: the list page is enough
        pass
    return urls, total


def read(code, url, today):
    s = {"id": code, "market": "fr", "link": url, "ship": SHIP, "currency": "EUR", "flags": []}
    try:
        page = get(url)
    except Exception as e:  # noqa
        return {**s, "page_error": str(e)[:120]}
    c = cruise_object(flight(page), code)
    if not c:
        return {**s, "page_error": "the cruise's details weren't on its page"}
    title = (fr(c.get("translations"), "title") or "").strip()
    port = (fr((c.get("port") or {}).get("translations"), "port") or "").strip()
    arrival = (fr((c.get("arrival_port") or {}).get("translations"), "port") or "").strip()
    s.update(title=title, base_title=title, flight_from=None, port=port, nights=c.get("duration"),
             departure_date=c.get("departure_date"), arrival_date=c.get("arrival_date"),
             link=SITE + "/croisieres/" + c["slug"] if c.get("slug") else url)
    if arrival and arrival != port:
        s["arrival_port"] = arrival
    if c.get("flight_available"):
        s["flights_available"] = True   # Caribbean: "Vols disponibles" (flights from Paris, booked by phone; not included)
    # Photos: the page's banner pictures, with their captions ("Bastia, Corse, France")
    photos, captions = [], {}
    for mb in c.get("media_background") or []:
        b = mb.get("page_banners_id") or {}
        if b.get("type") == "image" and b.get("banner_image"):
            u = f"{CMS}{b['banner_image']}?width=2000&format=jpg&quality=85"
            photos.append(u)
            cap = strip(fr(b.get("translations"), "title"))
            if cap:
                captions[u] = cap
    if photos:
        s["image_link"], s["photos"], s["photo_captions"] = photos[0], photos, captions
    # Offers: the sailing's tags ("🔥 1 acheté = 1 offert*", "Formule Plus")
    offers, notices = [], []
    for t in c.get("tags") or []:
        tg = t.get("tags_id") or {}
        name = strip(fr(tg.get("translations"), "title"))
        if tg.get("status", "published") != "published" or not name:
            continue
        if NOTICE.search(name):
            notices.append(name)
        else:
            offers.append({"id": f"tag{tg.get('id')}", "name": name, "description": strip(fr(tg.get("translations"), "tooltip_text")),
                           "expires_at": None})
    s["offers"] = offers
    if notices:
        s["notices"] = notices
    shown = shown_price(page)
    if shown:
        s["feed_price_pp"] = shown   # what the page shows; compared with booking ("page vs booking")
    eur = [p for p in c.get("prices") or [] if p.get("currency_code") == "EUR" and p.get("barred_price")]
    if eur:
        s["site_barred_pp"] = float(max(eur, key=lambda p: p.get("date_updated") or "")["barred_price"])  # recorded only
    if c.get("price_unavailable"):
        s["flags"].append("the page says prices are unavailable")
    try:
        cab, left = cabins(code, c.get("departure_date"))
        s["cabins"], s["cabins_left"] = cab, left
    except Exception as e:  # noqa
        s["booking_error"] = str(e)[:120]
    return s


def main(day):
    DATA.mkdir(parents=True, exist_ok=True)
    urls, total = sailing_urls()
    try:   # sailings the tracker already knows: a bad read keeps their last price instead of dropping them
        known = set(json.loads((ROOT / "state" / "fr" / "current.json").read_text()).get("sailings", {}))
    except (OSError, ValueError):
        known = set()
    with cf.ThreadPoolExecutor(4) as ex:   # gentle on the site: about 55 pages and 110 booking calls a check
        rows = list(ex.map(lambda kv: read(kv[0], kv[1], day), sorted(urls.items())))
    sailings, sold_out, skipped = [], [], []
    for s in rows:
        if "page_error" in s:
            if s["id"] in known:   # kept so tracker.py doesn't mark it removed for one bad read; its last price is kept
                s.update(price_source="feed", price_pp=0)
                s["flags"].append("the page couldn't be read: " + s["page_error"])
                sailings.append(s)
            else:
                skipped.append(s["id"])
            continue
        if not s.get("departure_date") or s["departure_date"] <= day:
            continue   # departed (the sitemap keeps old sailings for a while)
        tw = (s.get("cabins") or {}).get("twin") or {}
        if tw:
            s["price_pp"], s["price_source"] = min(tw.values()), "page"
        elif s.get("cabins", {}).get("solo"):
            s["price_pp"], s["price_source"] = min(s["cabins"]["solo"].values()), "solo"
            s["flags"].append("no twin cabins on sale; the from price is a solo price")
        elif "booking_error" not in s:
            sold_out.append(s["id"])   # nothing on sale: treated as off sale, as the UK feed leaves sold-out sailings out
            continue
        else:
            s["price_source"] = "feed"   # tracker.py keeps the last from price
            s["flags"].append("booking prices couldn't be read: " + s["booking_error"])
            if s["id"] not in known:
                if not s.get("feed_price_pp"):
                    skipped.append(s["id"])
                    continue
                s["price_pp"] = s["feed_price_pp"]   # a new sailing: the page's own figure until booking can be read
                s["flags"].append("first price taken from the page, as booking couldn't be read")
            else:
                s["price_pp"] = 0
        if tw and s.get("feed_price_pp") and round(s["feed_price_pp"]) != round(min(tw.values())):
            s["flags"].append(f"the page shows from €{s['feed_price_pp']:,.0f} but booking's cheapest is €{min(tw.values()):,.0f}")
        if not s.get("photos"):
            s["flags"].append("no photos found on the page")
        sailings.append(s)
    snap = {"date": day, "market": "fr", "currency": "EUR",
            "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "list_total": total, "count": len(sailings), "sold_out": sold_out, "not_read": skipped, "sailings": sailings}
    (DATA / f"snapshot_{day}.json").write_text(json.dumps(snap, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{day} (France): {len(sailings)} sailings (list says {total}), "
          f"{sum(1 for s in sailings if s.get('price_source') == 'page')} with booking prices, "
          f"{sum(1 for s in sailings if s['flags'])} flagged, {len(sold_out)} sold out, {len(skipped)} couldn't be read")
    return snap


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat())
