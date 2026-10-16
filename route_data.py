"""Route video data (Sam, 16 Oct 2026): a sailing's ports, flights, photos and a sea route between the ports.

Everything comes from the sailing's own page on ambassadorcruiseline.com (the same pages enrich.py reads every
hour) plus two open datasets:
  - port positions: route/ports.json (checked by hand), else UN/LOCODE (UNECE, via github.com/datasets/un-locode)
  - coastlines: Natural Earth 1:10m land and minor islands (public domain, naturalearthdata.com)
The datasets are downloaded once into CACHE (the workflow keeps that folder between runs).

    python route_data.py A32651            prints what the video would show
"""
import csv, html, io, json, math, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from enrich import UA, _dv  # noqa: E402

ASSETS = ROOT / "route"
CACHE = ROOT / "img_cache" / "route"
LOCODE = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
LAND = ["ne_10m_land.geojson", "ne_10m_minor_islands.geojson"]

# UK airports the fly-cruises leave from (positions from the airports' published reference points)
AIRPORTS = {
    "LHR": ("Heathrow", 51.470, -0.454), "LGW": ("Gatwick", 51.148, -0.190), "MAN": ("Manchester", 53.354, -2.275),
    "BHX": ("Birmingham", 52.454, -1.748), "BRS": ("Bristol", 51.383, -2.719), "STN": ("Stansted", 51.885, 0.235),
    "LTN": ("Luton", 51.875, -0.368), "EMA": ("East Midlands", 52.831, -1.328), "NCL": ("Newcastle", 55.037, -1.692),
    "EDI": ("Edinburgh", 55.950, -3.373), "GLA": ("Glasgow", 55.872, -4.433), "BFS": ("Belfast", 54.658, -6.216),
    "CWL": ("Cardiff", 51.397, -3.343), "ABZ": ("Aberdeen", 57.202, -2.198), "LBA": ("Leeds Bradford", 53.866, -1.661),
    "EXT": ("Exeter", 50.734, -3.414), "SOU": ("Southampton", 50.950, -1.357), "NWI": ("Norwich", 52.676, 1.283),
}


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def cached(name, url):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / name
    if not p.exists() or p.stat().st_size < 1000:
        print(f"downloading {url}")
        p.write_bytes(fetch(url, timeout=300))
    return p


# ---------------------------------------------------------------- the sailing page

def islands(page):
    """{component name: decoded props} for the page's Astro islands."""
    out = {}
    for m in re.finditer(r'<astro-island[^>]*component-url="/_astro/([A-Za-z]+)[^"]*"[^>]*props="([^"]*)"', page):
        try:
            out.setdefault(m.group(1), _dv(json.loads(html.unescape(m.group(2)))))
        except ValueError:
            pass
    return out


def photo(img, w=1920):
    """A Storyblok image as a resized JPEG link (the site's own image service, as enrich.py's photos)."""
    f = (img or {}).get("filename") or ""
    if not f.startswith("http"):
        return None
    f = f.replace("https://a.storyblok.com/", "https://assets.ambassadorcruiseline.com/")
    return f"{f}/m/{w}x0/filters:format(jpeg):quality(85)"


def read_sailing(code_or_link, state=None):
    """The sailing's days (ports with their photos, sea days), flights and basics, from its page."""
    link = code_or_link
    if not link.startswith("http"):
        state = state or json.loads((ROOT / "state" / "current.json").read_text())
        s = state["sailings"].get(code_or_link)
        if not s:
            raise SystemExit(f"{code_or_link} isn't in state/current.json")
        link = s["link"]
    page = fetch(link).decode("utf-8", "replace")
    isl = islands(page)
    sd = (isl.get("FareSummary") or {}).get("search-data") or {}
    days = []
    for it in (isl.get("Itinerary") or {}).get("items") or []:
        doc = it.get("document") or {}
        if (it.get("type") or doc.get("type")) != "port":
            days.append({"day": it.get("day"), "type": "sea"})
            continue
        p = doc.get("port") or {}
        content = ((it.get("port") or {}).get("content")) or {}
        days.append({"day": it.get("day"), "type": "port", "code": p.get("code") or it.get("code"),
                     "name": p.get("name") or it.get("title"), "country": p.get("country"),
                     "arr": doc.get("arrivalTime"), "dep": doc.get("departureTime"), "tender": doc.get("isTender"),
                     "photo": photo(content.get("image")), "photo_alt": (content.get("image") or {}).get("alt") or ""})
    if not days:   # older pages: the itinerary in FareSummary only (no photos)
        for d in sd.get("itinerary") or []:
            p = d.get("port") or {}
            days.append({"type": "port", "code": p.get("code"), "name": p.get("name"), "country": p.get("country"),
                         "arr": d.get("arrivalTime"), "dep": d.get("departureTime")} if d.get("type") == "port"
                        else {"type": "sea"})
    flights = sd.get("flights") or []
    if isinstance(flights, dict):
        flights = [flights]
    airports, out, home = [], False, False
    for f in flights:
        c = (f or {}).get("airportCode")
        if c and c not in airports:
            airports.append(c)
        out = out or bool((f or {}).get("outbound"))
        home = home or bool((f or {}).get("inbound"))
    if airports and not (out or home):   # no flight details on the page: a fly-cruise flies both ways
        out = home = True
    gallery = [{"title": g.get("title") or "", "alt": g.get("alt") or "", "url": photo(g)}
               for g in (isl.get("Gallery") or {}).get("items") or [] if photo(g)]
    return {"code": sd.get("code"), "name": sd.get("name") or "", "ship": (sd.get("ship") or {}).get("name") or "",
            "link": link, "tagline": sd.get("tagline") or "", "fly": bool(sd.get("isFlyCruise")),
            "departure_port": sd.get("departurePort") or "", "airports": airports, "fly_out": out, "fly_home": home,
            "days": days, "gallery": gallery}


# ---------------------------------------------------------------- port positions

def _deg(s):
    """UN/LOCODE "1306N 05937W" → (13.1, -59.617)."""
    m = re.match(r"(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])", s or "")
    if not m:
        return None
    lat = int(m.group(1)) + int(m.group(2)) / 60
    lon = int(m.group(4)) + int(m.group(5)) / 60
    return (-lat if m.group(3) == "S" else lat, -lon if m.group(6) == "W" else lon)


_LOC = None


def locode(code):
    global _LOC
    if _LOC is None:
        _LOC = {}
        text = cached("code-list.csv", LOCODE).read_text(encoding="utf-8", errors="replace")
        for r in csv.DictReader(io.StringIO(text)):
            pos = _deg(r.get("Coordinates"))
            if pos:
                _LOC[(r["Country"] + r["Location"]).upper()] = pos
    return _LOC.get(code[:5].upper())


def port_position(day, known=None):
    """(lat, lon) of a port day: route/ports.json first (hand-checked, by code then by name), then UN/LOCODE."""
    known = known if known is not None else json.loads((ASSETS / "ports.json").read_text())
    for k in (day.get("code"), (day.get("code") or "")[:5], day.get("name")):
        if k and k in known:
            return tuple(known[k][:2])
    return locode(day.get("code") or "") if day.get("code") else None


# ---------------------------------------------------------------- coastlines

def land_polygons(bbox):
    """Natural Earth land rings [(lon, lat), …] that touch bbox (lon0, lat0, lon1, lat1)."""
    x0, y0, x1, y1 = bbox
    rings = []
    for name in LAND:
        g = json.loads(cached(name, NE + name).read_text())
        for f in g["features"]:
            geom = f["geometry"]
            polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
            for poly in polys:
                ring = poly[0]
                xs = [p[0] for p in ring]
                ys = [p[1] for p in ring]
                if max(xs) < x0 or min(xs) > x1 or max(ys) < y0 or min(ys) > y1:
                    continue
                rings.append(ring)
    return rings


# ---------------------------------------------------------------- web mercator

def merc(lat, lon):
    """Longitude/latitude → x, y in "world units" (0..1 across the map, y down)."""
    lat = max(-85.0, min(85.0, lat))
    return (lon + 180) / 360, (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2


def unmerc(x, y):
    lon = x * 360 - 180
    lat = math.degrees(2 * math.atan(math.exp(math.pi * (1 - 2 * y))) - math.pi / 2)
    return lat, lon


# ---------------------------------------------------------------- sea route

def sea_route(points, land_mask, cell_to_world, world_to_cell):
    """A path through water from each point to the next, as world (x, y) lists per leg.

    land_mask: numpy bool grid (rows = y), True = land. A* over the grid's 8 neighbours; land cells cost a lot
    but aren't forbidden (a port deep in a fjord can sit in cells the coastline closes off), then the path is
    pulled tight wherever a straight line stays in water, and smoothed."""
    import heapq
    import numpy as np
    h, w = land_mask.shape
    # distance from land (in cells, up to 6) keeps the route off the coast where there's room
    near = np.zeros_like(land_mask, dtype=np.int16)
    grow = land_mask.copy()
    for d in range(1, 7):
        g = grow.copy()
        g[1:, :] |= grow[:-1, :]
        g[:-1, :] |= grow[1:, :]
        g[:, 1:] |= grow[:, :-1]
        g[:, :-1] |= grow[:, 1:]
        near[(g & ~grow)] = d
        grow = g
    near[~grow] = 7
    cost = np.where(land_mask, 60.0, 1.0 + (7 - near) * 0.35)

    def clear(a, b):
        (r0, c0), (r1, c1) = a, b
        n = max(abs(r1 - r0), abs(c1 - c0), 1)
        for i in range(n + 1):
            r = round(r0 + (r1 - r0) * i / n)
            c = round(c0 + (c1 - c0) * i / n)
            if land_mask[r, c] and not (i < 3 or i > n - 3):
                return False
        return True

    def astar(s, t):
        if s == t:
            return [s]
        openq = [(0.0, s)]
        g = {s: 0.0}
        came = {}
        tr, tc = t
        while openq:
            _, cur = heapq.heappop(openq)
            if cur == t:
                break
            r, c = cur
            for dr, dc, step in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                                 (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
                nr, nc = r + dr, c + dc
                if not (0 <= nr < h and 0 <= nc < w):
                    continue
                ng = g[cur] + step * cost[nr, nc]
                if ng < g.get((nr, nc), 1e18):
                    g[(nr, nc)] = ng
                    came[(nr, nc)] = cur
                    heapq.heappush(openq, (ng + math.hypot(nr - tr, nc - tc), (nr, nc)))
        path = [t]
        while path[-1] != s:
            path.append(came[path[-1]])
        return path[::-1]

    def pull(path):
        out = [path[0]]
        i = 0
        while i < len(path) - 1:
            j = len(path) - 1
            while j > i + 1 and not clear(path[i], path[j]):
                j -= 1
            out.append(path[j])
            i = j
        return out

    legs = []
    cells = [world_to_cell(*p) for p in points]
    for a, b in zip(cells, cells[1:]):
        pts = [cell_to_world(*c) for c in pull(astar(a, b))]
        legs.append(smooth(pts))
    return legs


def smooth(pts, rounds=3):
    """Chaikin corner cutting (ends kept)."""
    for _ in range(rounds):
        if len(pts) < 3:
            return pts
        out = [pts[0]]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        out.append(pts[-1])
        pts = out
    return pts


if __name__ == "__main__":
    s = read_sailing(sys.argv[1])
    known = json.loads((ASSETS / "ports.json").read_text()) if (ASSETS / "ports.json").exists() else {}
    print(s["code"], s["name"], s["ship"], "fly" if s["fly"] else "no-fly", s["airports"])
    for d in s["days"]:
        if d["type"] == "port":
            print(f"  day {d['day']}: {d['name']} ({d['code']}) {port_position(d, known)} photo={'yes' if d.get('photo') else 'no'}")
        else:
            print(f"  day {d['day']}: at sea")
