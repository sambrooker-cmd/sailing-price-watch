"""Route video for one sailing (Sam, 16 Oct 2026: "a route video per sailing … using this as the template", the
A32651 Tropical Treasures video): MP4s in 9:16, 4:5 and 1:1 with the template's music.

Scenes, as in the template:
  1. fly-cruises: the UK, planes leave the airport(s) (Heathrow and Manchester both in the "combined" version)
  2. the route map (Pearl sea, Aloe land): the plane lands at the first port, then a purple ship sails a dotted
     route port to port (through water: route_data.sea_route) while the camera follows; port names appear
  3. the whole route
  4. a photo of each port (the sailing page's own port photos), name in spaced capitals over a purple fade
  5. fly-cruises: planes fly home to the UK airport(s)
  6. the ship at sea: Renaissance uses the template's own clip (route/renaissance.mp4, its words removed);
     Ambience and Ambition their ship photo (site/ships) with a slow zoom; a headline and line over the sky
  7. the template's end card (logo, "the warmest welcome at sea", booking line, ABTA/ATOL/Nectar)
Nothing about prices is shown, so a video stays usable while the sailing is on sale.

    python route_video.py A32651 out/ [--airports LHR,MAN] [--headline "…"] [--line "…"] [--sizes 9x16,4x5,1x1]
Writes out/route_<code>_<size>_<seconds>s.mp4, out/info.json and out/summary.md. Never touches Meta or any ad account.
"""
import argparse, datetime as dt, json, math, re, subprocess, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import route_data as rd  # noqa: E402

A = rd.ASSETS
FPS = 30
SIZES = {"9x16": (1080, 1920), "4x5": (1080, 1350), "1x1": (1080, 1080)}
SEA = (241, 234, 229)          # the template's Pearl sea
LAND = (107, 177, 148)         # Aloe land
PURPLE = (107, 31, 124)        # route, ship, planes (Allium)
ORANGE = (243, 146, 0)         # the first port's dot (Amber)
INK = (51, 51, 51)
MUSIC_SECONDS = 63.6

# ---------------------------------------------------------------- small helpers

_fonts = {}


def font(size, weight=500):
    k = (size, weight)
    if k not in _fonts:
        f = ImageFont.truetype(str(A / "Quicksand.ttf"), size)
        f.set_variation_by_axes([weight])
        _fonts[k] = f
    return _fonts[k]


def tracked_width(text, f, track):
    return sum(f.getlength(c) for c in text) + track * max(0, len(text) - 1)


def draw_tracked(d, xy, text, f, fill, track=0.0, anchor="m"):
    """Text with letter spacing (PIL has none). anchor m = centred on x, l = starts at x; y is the top."""
    x, y = xy
    if anchor == "m":
        x -= tracked_width(text, f, track) / 2
    for c in text:
        d.text((x, y), c, font=f, fill=fill)
        x += f.getlength(c) + track


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def get_image(url, cache_name):
    p = rd.CACHE / "photos" / cache_name
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_bytes(rd.fetch(url, timeout=120))
    return Image.open(p).convert("RGB")


def photo_file(stop):
    return re.sub(r"[^A-Za-z0-9]+", "_", stop["photo"])[-80:] + ".jpg"


def cover(img, w, h, zoom=1.0, fx=0.5, fy=0.5):
    """img scaled to cover w×h (times zoom), cropped around (fx, fy)."""
    s = max(w / img.width, h / img.height) * zoom
    cw, ch = w / s, h / s
    x0 = min(max(0, img.width * fx - cw / 2), img.width - cw)
    y0 = min(max(0, img.height * fy - ch / 2), img.height - ch)
    return img.resize((w, h), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))


def sprite_ship(length):
    """The template's purple capsule ship, bow to the right (drawn 4× and scaled down)."""
    k = 4
    L, H = length * k, int(length * 0.3) * k
    im = Image.new("RGBA", (L, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    top, bot = H * 0.08, H * 0.92
    d.rounded_rectangle((int(L * 0.02), int(top), int(L * 0.7), int(bot)), radius=int(H * 0.16), fill=PURPLE + (255,))
    # an ogive bow, pointed as in the template
    half = (bot - top) / 2
    mid = H / 2
    xs = [0.66 + 0.34 * i / 40 for i in range(41)]
    upper = [(L * x, mid - half * (1 - ((x - 0.66) / 0.34) ** 1.8) ** 0.62) for x in xs]
    lower = [(L * x, mid + half * (1 - ((x - 0.66) / 0.34) ** 1.8) ** 0.62) for x in reversed(xs)]
    d.polygon(upper + lower, fill=PURPLE + (255,))
    w = max(2, int(H * 0.06))
    d.line((int(L * 0.16), int(H * 0.2), int(L * 0.16), int(H * 0.8)), fill=(255, 255, 255, 230), width=w)
    d.rounded_rectangle((int(L * 0.24), int(H * 0.32), int(L * 0.7), int(H * 0.68)), radius=int(H * 0.1),
                        outline=(255, 255, 255, 200), width=w)
    return im.resize((L // k, H // k), Image.LANCZOS)


def sprite_plane(size):
    """A plane seen from above, nose to the right."""
    k = 4
    S = size * k
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    f = PURPLE + (255,)
    d.rounded_rectangle((S * 0.08, c - S * 0.055, S * 0.95, c + S * 0.055), radius=int(S * 0.055), fill=f)   # body
    d.polygon([(S * 0.58, c - S * 0.04), (S * 0.36, c - S * 0.46), (S * 0.27, c - S * 0.46), (S * 0.4, c - S * 0.04)], fill=f)
    d.polygon([(S * 0.58, c + S * 0.04), (S * 0.36, c + S * 0.46), (S * 0.27, c + S * 0.46), (S * 0.4, c + S * 0.04)], fill=f)
    d.polygon([(S * 0.2, c - S * 0.03), (S * 0.1, c - S * 0.2), (S * 0.04, c - S * 0.2), (S * 0.1, c - S * 0.03)], fill=f)
    d.polygon([(S * 0.2, c + S * 0.03), (S * 0.1, c + S * 0.2), (S * 0.04, c + S * 0.2), (S * 0.1, c + S * 0.03)], fill=f)
    return im.resize((size, size), Image.LANCZOS)


def sprite_dot(r, fill, ring=None):
    k = 4
    S = int((r * 2 + 4) * k)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    if ring:
        d.ellipse((c - r * k - 3 * k, c - r * k - 3 * k, c + r * k + 3 * k, c + r * k + 3 * k), fill=ring + (255,))
    d.ellipse((c - r * k, c - r * k, c + r * k, c + r * k), fill=fill + (255,))
    return im.resize((S // k, S // k), Image.LANCZOS)


def paste_rot(frame, spr, x, y, angle_deg, alpha=1.0):
    s = spr.rotate(-angle_deg, resample=Image.BICUBIC, expand=True)
    if alpha < 1:
        a = s.getchannel("A").point(lambda v: int(v * alpha))
        s.putalpha(a)
    frame.paste(s, (int(round(x - s.width / 2)), int(round(y - s.height / 2))), s)


def paste_c(frame, spr, x, y):
    frame.paste(spr, (int(round(x - spr.width / 2)), int(round(y - spr.height / 2))), spr)


# ---------------------------------------------------------------- map drawing

class Land:
    """Natural Earth land in world (Web Mercator 0..1) units, drawn fresh for each frame so it stays sharp at
    any zoom (anti-aliased by drawing at 2× and scaling down)."""

    def __init__(self, bbox_lonlat):
        self.rings = []
        for ring in rd.land_polygons(bbox_lonlat):
            a = np.array(ring, dtype=np.float64)
            x = (a[:, 0] + 180) / 360
            lat = np.clip(a[:, 1], -85, 85)
            y = (1 - np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) / np.pi) / 2
            self.rings.append((np.stack([x, y], 1), x.min(), y.min(), x.max(), y.max()))

    def draw(self, rect, w, h, ss=2):
        x0, y0, x1, y1 = rect
        s = w * ss / (x1 - x0)
        mask = Image.new("L", (w * ss, h * ss), 0)
        d = ImageDraw.Draw(mask)
        for pts, a, b, c, e in self.rings:
            if c < x0 or a > x1 or e < y0 or b > y1:
                continue
            if (c - a) * s < 1.5 and (e - b) * s < 1.5:
                continue
            q = np.round((pts - (x0, y0)) * s).astype(np.int64)
            # clamp to a box just outside the frame: the visible part stays the same and the long stretches of
            # coastline off screen collapse to a few points
            m = 8 * ss
            np.clip(q[:, 0], -m, w * ss + m, out=q[:, 0])
            np.clip(q[:, 1], -m, h * ss + m, out=q[:, 1])
            keep = np.ones(len(q), bool)
            keep[1:] = np.any(q[1:] != q[:-1], axis=1)
            q = q[keep]
            if len(q) >= 3:
                d.polygon(list(map(tuple, q.tolist())), fill=255)
        mask = mask.resize((w, h), Image.BILINEAR) if ss != 1 else mask
        frame = Image.new("RGB", (w, h), SEA)
        frame.paste(Image.new("RGB", (w, h), LAND), (0, 0), mask)
        return frame


def fit_rect(bbox, aspect, pad=0.25, min_w=0.0):
    """A world rect with the given width/height aspect containing bbox (x0, y0, x1, y1) plus padding."""
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w = max((x1 - x0) * (1 + pad * 2), min_w)
    h = max((y1 - y0) * (1 + pad * 2), min_w / aspect)
    if w / h > aspect:
        h = w / aspect
    else:
        w = h * aspect
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def lerp_rect(a, b, u):
    """Camera move: centre linear, size geometric (feels like a steady zoom)."""
    ca = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2)
    cb = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    wa, wb = a[2] - a[0], b[2] - b[0]
    ha, hb = a[3] - a[1], b[3] - b[1]
    cx, cy = ca[0] + (cb[0] - ca[0]) * u, ca[1] + (cb[1] - ca[1]) * u
    w, h = wa * (wb / wa) ** u, ha * (hb / ha) ** u
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def bbox_of(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def polyline_length(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def point_at(pts, u):
    """Position and heading (radians, screen-style y down) at fraction u of a polyline."""
    total = polyline_length(pts) or 1e-12
    want = total * min(1.0, max(0.0, u))
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        if want <= seg or b is pts[-1]:
            f = want / seg if seg else 0
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), math.atan2(b[1] - a[1], b[0] - a[0])
        want -= seg
    return pts[-1], 0.0


def resample(pts, step):
    """Points every `step` along a polyline (the dotted line's dots, in world units)."""
    out = [pts[0]]
    carry = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        t = step - carry
        while t <= seg:
            out.append((a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg))
            t += step
        carry = seg - (t - step)
    return out


def great_circle(lat1, lon1, lat2, lon2, n=64):
    p1, l1, p2, l2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dd = 2 * math.asin(math.sqrt(math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((l2 - l1) / 2) ** 2))
    out = []
    for i in range(n + 1):
        f = i / n
        if dd == 0:
            out.append((lat1, lon1))
            continue
        A_ = math.sin((1 - f) * dd) / math.sin(dd)
        B_ = math.sin(f * dd) / math.sin(dd)
        x = A_ * math.cos(p1) * math.cos(l1) + B_ * math.cos(p2) * math.cos(l2)
        y = A_ * math.cos(p1) * math.sin(l1) + B_ * math.cos(p2) * math.sin(l2)
        z = A_ * math.sin(p1) + B_ * math.sin(p2)
        out.append((math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))))
    return out


# ---------------------------------------------------------------- words

CARIB = {"Barbados", "Antigua", "Antigua and Barbuda", "St. Lucia", "Saint Lucia", "Grenada", "Dominica", "Martinique",
         "Guadeloupe", "Aruba", "Bonaire", "Curacao", "Curaçao", "St. Kitts", "St. Kitts and Nevis", "Saint Kitts and Nevis",
         "St. Vincent & the Grenadines", "St. Vincent and the Grenadines", "Trinidad and Tobago", "Tobago",
         "British Virgin Islands", "US Virgin Islands", "Virgin Islands", "St. Maarten", "Sint Maarten", "St. Martin",
         "Saint Martin", "Anguilla", "Montserrat", "Puerto Rico", "Dominican Republic", "Jamaica", "Bahamas",
         "Cayman Islands", "Bermuda", "Turks and Caicos", "St. Barthelemy", "Saint Barthélemy", "Caribbean Netherlands"}
PLACES = [  # (countries, what the headline calls the destination)
    (CARIB, "THE CARIBBEAN"),
    ({"Norway"}, "THE FJORDS"),
    ({"Iceland"}, "ICELAND"),
    ({"Greenland"}, "GREENLAND"),
    ({"Faroe Islands"}, "THE FAROES"),
    ({"Sweden", "Finland", "Estonia", "Latvia", "Lithuania", "Poland", "Denmark"}, "THE BALTIC"),
    ({"Portugal", "Spain", "Canary Islands", "Madeira", "Azores", "Gibraltar", "Morocco"}, "SPAIN AND PORTUGAL"),
    ({"Italy", "Greece", "Croatia", "Malta", "Montenegro", "Cyprus", "Turkey", "Monaco"}, "THE MEDITERRANEAN"),
    ({"Germany", "Netherlands", "Belgium", "France", "Luxembourg"}, "EUROPE"),
    ({"Ireland", "United Kingdom", "Isle of Man", "Guernsey", "Jersey"}, "THE BRITISH ISLES"),
]
UK_COUNTRIES = {"United Kingdom", "UK", "England", "Scotland", "Wales", "Northern Ireland", "Great Britain"}


def destination(s):
    """What the headline calls where the sailing goes: the place most of its ports are (home ports left out)."""
    counts = {}
    ports = [d for d in s["days"] if d["type"] == "port"]
    away = [d for d in ports if (d.get("country") or "") not in UK_COUNTRIES] or ports
    for d in away:
        for countries, name in PLACES:
            if (d.get("country") or "") in countries:
                counts[name] = counts.get(name, 0) + 1
    if counts:
        return max(counts, key=counts.get)
    return (away[0].get("country") or "THE WORLD").upper() if away else "THE WORLD"


def default_words(s):
    place = destination(s)
    they = place in ("THE FJORDS",)
    headline = f"{place}, THE WAY {'THEY' if they else 'IT'} SHOULD FEEL."
    if s.get("fly_out"):
        line = "Smaller ship. Direct flight. Everything sorted."
    else:
        home = next((d["name"] for d in s["days"] if d["type"] == "port"), "")
        home = re.sub(r",.*$", "", home)
        line = f"Smaller ship. Sail from {home}. Everything sorted." if home else "Smaller ship. No flying. Everything sorted."
    return headline, line


def map_label(d):
    """The town as the map shows it: "Kralendijk", "Pointe a Pitre", "Eidfjord", "Bergen"."""
    name = d.get("name") or ""
    head, _, rest = name.partition(",")
    rest = rest.strip()
    m = re.match(r"(?i)for\s+(.+)", rest)
    return m.group(1).strip() if m else head.strip()


def photo_label(d):
    """The photo's caption, in the template's way: the island where the country is the island ("BONAIRE",
    "GUADELOUPE"), else the town ("BERGEN", "HAUGESUND")."""
    name = d.get("name") or ""
    head, _, rest = name.partition(",")
    rest, country = rest.strip(), (d.get("country") or "").strip()
    m = re.match(r"(?i)for\s+(.+)", rest)
    if m:
        out = m.group(1)
    elif rest and country and rest.lower().replace(".", "") == country.lower().replace(".", "") and country in CARIB:
        out = country
    else:
        out = head
    out = re.sub(r"\s*(&|and) the Grenadines", "", out).replace(".", "").strip()
    return out.upper()


# ---------------------------------------------------------------- the plan

class Plan:
    def __init__(self, s, airports, headline, line):
        self.s = s
        known = json.loads((A / "ports.json").read_text())
        stops = []
        for d in s["days"]:
            if d["type"] != "port":
                continue
            pos = rd.port_position(d, known)
            if not pos:
                print(f"  no position for {d['name']} ({d['code']}): left out of the map")
                continue
            if stops and stops[-1]["code"] == d["code"]:
                continue
            stops.append(dict(d, lat=pos[0], lon=pos[1], w=rd.merc(*pos)))
        if len(stops) < 2:
            raise SystemExit("Fewer than two ports with a known position: can't draw a route.")
        self.stops = stops
        # planes only where the sailing really flies (A32650 sails out from Tilbury and flies home)
        self.airports = [a for a in airports if a in rd.AIRPORTS] if (s.get("fly_out") or s.get("fly_home")) else []
        self.fly_out = bool(self.airports) and s.get("fly_out", True)
        self.fly_home = bool(self.airports) and s.get("fly_home", True)
        self.fly = self.fly_out or self.fly_home
        self.headline, self.line = headline, line
        # the sea route
        pts = [p["w"] for p in stops]
        bb = bbox_of(pts)
        pad = max(bb[2] - bb[0], bb[3] - bb[1]) * 0.3 + 0.004
        rbox = (bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad)
        lat0, lon0 = rd.unmerc(rbox[0], rbox[3])
        lat1, lon1 = rd.unmerc(rbox[2], rbox[1])
        box = [lon0 - 30, lat0 - 15, lon1 + 30, lat1 + 15]
        if airports:   # the UK too, for the planes
            box = [min(box[0], -12), min(box[1], 48), max(box[2], 4), max(box[3], 61)]
        land_all = Land(box)
        self.land = land_all
        self.legs = self.route(pts, rbox)
        # photos: each port once, in order (the first port last for fly-cruises, as the template ends on Bridgetown)
        seen, photos = set(), []
        order = stops[1:] + stops[:1] if self.fly_out else stops
        for p in order:
            if p.get("photo") and p["code"] not in seen and (p.get("country") or "") not in UK_COUNTRIES:
                seen.add(p["code"])
                photos.append(p)
        self.photos = []
        for p in photos[:9]:   # a photo that won't download is left out rather than stopping the video
            try:
                get_image(p["photo"], photo_file(p))
                self.photos.append(p)
            except Exception as e:  # noqa: BLE001
                print(f"  photo for {p['name']} couldn't be read ({e}): left out")

    def route(self, pts, rbox):
        """Sea route legs: A* on a land grid made for each leg."""
        legs = []
        for a, b in zip(pts, pts[1:]):
            bb = bbox_of([a, b])
            size = max(bb[2] - bb[0], bb[3] - bb[1])
            pad = size * 0.35 + 0.003
            box = (bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad)
            n = 320
            sx = n / (box[2] - box[0])
            sy = n / (box[3] - box[1])
            sc = min(sx, sy)
            gw, gh = int((box[2] - box[0]) * sc) + 1, int((box[3] - box[1]) * sc) + 1
            img = self.land.draw(box, gw, gh, ss=1)
            mask = np.asarray(img)[:, :, 1] < 200   # land is green 177, sea 234

            def to_cell(x, y, box=box, sc=sc, gw=gw, gh=gh):
                return (min(gh - 1, max(0, int((y - box[1]) * sc))), min(gw - 1, max(0, int((x - box[0]) * sc))))

            def to_world(r, c, box=box, sc=sc):
                return (box[0] + (c + 0.5) / sc, box[1] + (r + 0.5) / sc)

            leg = rd.sea_route([a, b], mask, to_world, to_cell)[0]
            leg = [a] + leg[1:-1] + [b]
            legs.append(leg)
        return legs


# ---------------------------------------------------------------- rendering

class Renderer:
    def __init__(self, plan, size):
        self.p = plan
        self.W, self.H = SIZES[size]
        self.size = size
        self.aspect = self.W / self.H
        u = self.W / 1080
        self.u = u
        self.ship = sprite_ship(int(150 * u))
        self.plane = sprite_plane(int(78 * u))
        self.dot = sprite_dot(4.2 * u, PURPLE)
        self.port_dot = sprite_dot(9 * u, PURPLE, ring=(255, 255, 255))
        self.home_dot = sprite_dot(10 * u, ORANGE, ring=(255, 255, 255))
        self.label_font = font(int(34 * u), 600)
        self.last = None

    # one map frame: land, dotted trail(s), port dots and labels, sprites
    def map_frame(self, rect, trails=(), dots=(), labels=(), sprites=()):
        W, H = self.W, self.H
        fr = self.p.land.draw(rect, W, H)
        s = W / (rect[2] - rect[0])
        sp = lambda q: ((q[0] - rect[0]) * s, (q[1] - rect[1]) * s)   # noqa: E731
        for pts, step_world, alpha in trails:
            if len(pts) < 2:
                continue
            k = max(1, 2 ** round(math.log2(max(1e-9, 17 * self.u / (step_world * s)))) if step_world * s < 12 * self.u else 1)
            dots_w = resample(pts, step_world)[::k]
            spr = self.dot
            if alpha < 1:
                spr = self.dot.copy()
                spr.putalpha(spr.getchannel("A").point(lambda v: int(v * alpha)))
            for q in dots_w:
                x, y = sp(q)
                if -10 < x < W + 10 and -10 < y < H + 10:
                    paste_c(fr, spr, x, y)
        for q, kind in dots:
            x, y = sp(q)
            paste_c(fr, self.home_dot if kind == "home" else self.port_dot, x, y)
        d = ImageDraw.Draw(fr)
        for q, text, alpha in labels:
            if alpha <= 0:
                continue
            x, y = sp(q)
            f = self.label_font
            tw = f.getlength(text)
            gap = 22 * self.u
            right = x + gap + tw < W - 30 * self.u
            tx = x + gap if right else x - gap - tw
            ty = y - f.size * 0.62
            col = tuple(int(SEA[i] + (INK[i] - SEA[i]) * alpha) for i in range(3))
            # a soft Pearl halo keeps the name readable over land
            for ox, oy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
                d.text((tx + ox * self.u, ty + oy * self.u), text, font=f, fill=SEA if alpha > 0.5 else col)
            d.text((tx, ty), text, font=f, fill=col)
        for spr, q, ang, alpha in sprites:
            x, y = sp(q)
            paste_rot(fr, spr, x, y, ang, alpha)
        return fr

    def step_for(self, rect):
        """Dots 17 px apart at this camera's zoom (in world units)."""
        return 17 * self.u * (rect[2] - rect[0]) / self.W

    # ----- scenes; each yields frames
    def uk_rect(self):
        pts = [rd.merc(rd.AIRPORTS[a][1], rd.AIRPORTS[a][2]) for a in self.p.airports]
        bb = bbox_of(pts + [rd.merc(49.0, -10.5), rd.merc(58.8, 3.5)])
        return fit_rect(bb, self.aspect, pad=0.04)

    def flight_paths(self, outbound=True):
        port = self.p.stops[0] if outbound else self.p.stops[-1]
        out = []
        for i, a in enumerate(self.p.airports):
            _, lat, lon = rd.AIRPORTS[a]
            gc = great_circle(lat, lon, port["lat"], port["lon"], 90)
            w = [rd.merc(*q) for q in gc]
            out.append((a, w if outbound else w[::-1]))
        return out

    def scene_flight_out(self, secs):
        rect0 = self.uk_rect()
        n = int(secs * FPS)
        paths = self.flight_paths(True)
        for i in range(n):
            t = i / FPS
            rect = lerp_rect(rect0, fit_rect(bbox_of([(rect0[0], rect0[1]), (rect0[2], rect0[3])]), self.aspect, pad=0.12), ease(t / secs))
            trails, sprites, dots, labels = [], [], [], []
            for j, (a, w) in enumerate(paths):
                # the plane covers the first part of the great circle, leaving the frame
                L = polyline_length(w)
                go = ease_out(max(0, (t - 0.5 - j * 0.25)) / (secs - 0.7)) * min(1.0, (rect[2] - rect[0]) * 1.6 / L)
                part = cut(w, go)
                trails.append((part, self.step_for(rect), 1.0))
                q, ang = point_at(w, go)
                sprites.append((self.plane, q, math.degrees(ang), 1.0))
                dots.append((w[0], "port"))
                labels.append((w[0], rd.AIRPORTS[a][0], 1.0 - ease((t - secs * 0.55) / 0.5)))
            yield self.map_frame(rect, trails, dots, labels, sprites)

    def scene_flight_home(self, secs):
        rect = self.uk_rect()
        n = int(secs * FPS)
        paths = self.flight_paths(False)
        for i in range(n):
            t = i / FPS
            trails, sprites, dots, labels = [], [], [], []
            for j, (a, w) in enumerate(paths):
                L = polyline_length(w)
                start = 1 - min(1.0, (rect[2] - rect[0]) * 1.4 / L)
                go = start + (1 - start) * ease_out(max(0, t - j * 0.25) / (secs * 0.75))
                trails.append((cut_from(w, start, go), self.step_for(rect), 1.0))
                q, ang = point_at(w, go)
                landed = go >= 0.999
                if not landed:
                    sprites.append((self.plane, q, math.degrees(ang), 1.0))
                dots.append((w[-1], "port"))
                labels.append((w[-1], rd.AIRPORTS[a][0], ease((go - 0.9) / 0.1)))
            yield self.map_frame(rect, trails, dots, labels, sprites)

    MIN_W = 5.0 / 360    # the voyage camera shows at least 5° of longitude across …
    MAX_W = 10.0 / 360   # … and at most 10°: long legs are followed rather than shown whole

    def follow_rect(self, q, k, u):
        """Where the voyage camera wants to be: the ship and the port it's heading for (and, just after leaving,
        the one it left), as close as MIN_W/MAX_W allow."""
        p = self.p
        nxt = p.stops[min(k + 1, len(p.stops) - 1)]["w"]
        pts = [q, nxt] + ([p.stops[k]["w"]] if u < 0.25 else [])
        r = fit_rect(bbox_of(pts), self.aspect, pad=0.3, min_w=self.MIN_W)
        if r[2] - r[0] > self.MAX_W:
            cx, cy = q[0] * 0.6 + nxt[0] * 0.4, q[1] * 0.6 + nxt[1] * 0.4
            w = self.MAX_W
            h = w / self.aspect
            r = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        # the ship always stays well inside the frame
        w, h = r[2] - r[0], r[3] - r[1]
        dx = min(0, q[0] - (r[0] + 0.22 * w)) + max(0, q[0] - (r[2] - 0.22 * w))
        dy = min(0, q[1] - (r[1] + 0.22 * h)) + max(0, q[1] - (r[3] - 0.22 * h))
        return (r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy)

    def leg_rect(self, i):
        return self.follow_rect(self.p.stops[i]["w"], i, 0.0)

    def voyage_step(self):
        return 17 * self.u * self.MIN_W * 1.3 / self.W

    def scene_arrival(self, secs):
        """The plane lands at the first port (fly-cruises), on the first leg's view."""
        rect = self.leg_rect(0)
        first = self.p.stops[0]
        n = int(secs * FPS)
        paths = self.flight_paths(True)
        for i in range(n):
            t = i / FPS
            trails, sprites = [], []
            for j, (a, w) in enumerate(paths):
                L = polyline_length(w)
                start = 1 - min(1.0, (rect[2] - rect[0]) * 0.9 / L)
                go = start + (1 - start) * ease_out(max(0, t - j * 0.2) / (secs * 0.7))
                fade = 1 - ease((go - 0.97) / 0.03)
                trails.append((cut_from(w, start, go), self.voyage_step(), 0.5 * fade))
                q, ang = point_at(w, go)
                if fade > 0:
                    sprites.append((self.plane, q, math.degrees(ang), fade))
            landed = ease((t - secs * 0.7) / 0.3)
            dots = [(first["w"], "home")] if landed > 0 else []
            labels = [(first["w"], map_label(first), landed)]
            yield self.map_frame(rect, trails, dots, labels, sprites)

    def voyage_times(self, total):
        lens = [polyline_length(l) for l in self.p.legs]
        wts = [math.log1p(L / (sum(lens) / len(lens))) + 0.6 for L in lens]
        return [total * w / sum(wts) for w in wts]

    def scene_voyage(self, secs, hold=0.0):
        p = self.p
        times = self.voyage_times(secs - hold)
        step = self.voyage_step()
        steps = [step] * len(p.legs)
        cam = self.leg_rect(0)
        tau = 0.6
        n = int(secs * FPS)
        bounds = np.cumsum([hold] + times)
        reached = {0: 0.0}
        for i in range(n):
            t = i / FPS
            k = int(np.searchsorted(bounds, t, side="right")) - 1
            if k < 0 or t < hold:
                k, u = 0, 0.0
            elif k >= len(times):
                k, u = len(times) - 1, 1.0
            else:
                u = (t - bounds[k]) / times[k]
            gu = ease(u)
            q, ang = point_at(p.legs[k], gu)
            a = 1 - math.exp(-1 / FPS / tau)
            cam = lerp_rect(cam, self.follow_rect(q, k, u), a)
            trails = [(leg, steps[j], 1.0) for j, leg in enumerate(p.legs[:k])]
            trails.append((cut(p.legs[k], gu), steps[k], 1.0))
            if gu >= 0.999:
                reached.setdefault(k + 1, t)
            dots = [(p.stops[0]["w"], "home")] + [(p.stops[j]["w"], "port") for j in reached if j > 0]
            labels = []
            for j, at in reached.items():
                life = t - at
                alpha = ease(life / 0.35) * (1 - ease((life - 2.2) / 0.5)) if j else (1 - ease((t - max(hold, 1.6)) / 0.5))
                if j == len(p.stops) - 1 and p.stops[j]["code"] == p.stops[0]["code"]:
                    alpha = ease(life / 0.35)
                labels.append((p.stops[j]["w"], map_label(p.stops[j]), alpha))
            yield self.map_frame(cam, trails, dots, labels, [(self.ship, q, math.degrees(ang), 1.0)])
        self.cam = cam

    def scene_overview(self, secs):
        p = self.p
        allpts = [q for leg in p.legs for q in leg]
        target = fit_rect(bbox_of(allpts), self.aspect, pad=0.12)
        start = getattr(self, "cam", target)
        steps = [self.voyage_step()] * len(p.legs)
        n = int(secs * FPS)
        for i in range(n):
            t = i / FPS
            cam = lerp_rect(start, target, ease(t / (secs * 0.7)))
            trails = [(leg, steps[j], 1.0) for j, leg in enumerate(p.legs)]
            dots = [(p.stops[0]["w"], "home")] + [(s["w"], "port") for s in p.stops[1:]]
            labels = [(p.stops[0]["w"], map_label(p.stops[0]), ease(t / 0.4))]
            yield self.map_frame(cam, trails, dots, labels, [])

    def scene_photo(self, stop, secs):
        W, H = self.W, self.H
        img = get_image(stop["photo"], photo_file(stop))
        top = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        g = np.zeros((H, W, 4), np.uint8)
        fade = int(H * (0.42 if H > W * 1.5 else 0.5))
        al = np.clip(1 - np.arange(H) / fade, 0, 1) ** 1.3 * 235
        g[:, :, :3] = PURPLE
        g[:, :, 3] = al[:, None].astype(np.uint8)
        top = Image.fromarray(g, "RGBA")
        label = photo_label(stop)
        size = int(70 * self.u)
        f = font(size, 500)
        while tracked_width(label, f, size * 0.22) > W * 0.88 and size > 30:
            size -= 2
            f = font(size, 500)
        n = int(secs * FPS)
        y = H * (0.115 if H > W * 1.5 else 0.09)
        for i in range(n):
            t = i / FPS
            fr = cover(img, W, H, zoom=1.0 + 0.07 * t / secs)
            fr.paste(top, (0, 0), top)
            d = ImageDraw.Draw(fr)
            a = ease((t - 0.15) / 0.4)
            col = tuple(int(PURPLE[k] + (255 - PURPLE[k]) * a) for k in range(3))
            draw_tracked(d, (W / 2, y - 20 * self.u * (1 - a)), label, f, col, track=size * 0.22)
            yield fr

    def scene_ship(self, secs):
        W, H = self.W, self.H
        ship = self.p.s["ship"]
        frames = None
        if ship == "Renaissance" and (A / "renaissance.mp4").exists():
            # crop windows that keep the sky (for the words) and the ship; read a frame at a time
            y0 = {1920: 0, 1350: 330, 1080: 450}[H]
            frames = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(A / "renaissance.mp4"), "-vf",
                                       f"crop=1080:{H}:0:{y0}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                      stdout=subprocess.PIPE)
            clip = None
            sky_top = {1920: 230, 1350: 90, 1080: 70}[H]
        else:
            photo = Image.open(ROOT / "site" / "ships" / f"{(ship or 'renaissance').lower()}.jpg").convert("RGB")
            band = int(H * 0.58)
            top_c = np.asarray(photo.crop((0, 0, photo.width, 6))).reshape(-1, 3).mean(0)
            sky_top = int(H * 0.11)
        hf = font(int(64 * self.u), 500)
        lf = font(int(30 * self.u), 600)
        words = self.p.headline.split()
        lines = wrap(words, hf, int(64 * self.u) * 0.2, W * 0.66)
        n = int(secs * FPS)
        for i in range(n):
            t = i / FPS
            if frames is not None:
                buf = frames.stdout.read(W * H * 3)
                if len(buf) == W * H * 3:
                    clip = Image.frombytes("RGB", (W, H), buf)
                fr = clip.copy()   # the clip is 4.5 s: hold its last frame if the scene runs longer
            else:
                fr = Image.new("RGB", (W, H), tuple(int(v) for v in top_c))
                pic = cover(photo, W, band, zoom=1.0 + 0.08 * t / secs)
                fr.paste(pic, (0, H - band))
                g = Image.linear_gradient("L").resize((W, 120)).transpose(Image.FLIP_TOP_BOTTOM)
                fr.paste(Image.new("RGB", (W, 120), tuple(int(v) for v in top_c)), (0, H - band), g)
            d = ImageDraw.Draw(fr)
            y = sky_top
            shown = 0
            for li, ln in enumerate(lines):
                vis = []
                for w_ in ln:
                    a = ease((t - 0.3 - shown * 0.14) / 0.35)
                    vis.append((w_, a))
                    shown += 1
                draw_words(d, W / 2, y, vis, hf, int(64 * self.u) * 0.2, PURPLE, fr)
                y += hf.size * 1.32
            a = ease((t - 0.3 - shown * 0.14 - 0.2) / 0.4)
            if a > 0:
                col = tuple(int(255 * (1 - a) + INK[k] * a) for k in range(3)) if frames is None else \
                    tuple(int(230 * (1 - a) + 30 * a) for _ in range(3))
                d.text((W / 2, y + 10 * self.u), self.p.line, font=lf, fill=col, anchor="ma")
            yield fr
        if frames is not None:
            frames.stdout.close()
            frames.wait()

    def scene_end(self, secs):
        W, H = self.W, self.H
        parts = [Image.open(A / f"end_{k}.png").convert("RGB") for k in ("logo", "tagline", "book", "badges")]
        bar = int(126 * H / 1920) if H == 1920 else int(80 * self.u)
        if H == 1920:
            ys = [314, 664, 1114, 1553]
        else:
            free = H - bar - sum(p.height for p in parts)
            gap = free / 5
            ys, y = [], gap
            for p_ in parts:
                ys.append(int(y))
                y += p_.height + gap
        n = int(secs * FPS)
        for i in range(n):
            t = i / FPS
            fr = Image.new("RGB", (W, H), (255, 255, 255))
            for j, (p_, y) in enumerate(zip(parts, ys)):
                a = ease((t - 0.15 - j * 0.25) / 0.45)
                if a <= 0:
                    continue
                piece = Image.blend(Image.new("RGB", p_.size, (255, 255, 255)), p_, a)
                fr.paste(piece, (0, int(y + 24 * self.u * (1 - a))))
            b = ease_out(t / 0.6)
            ImageDraw.Draw(fr).rectangle((0, H - int(bar * b), W, H), fill=(105, 30, 123))
            yield fr


def wrap(words, f, track, width):
    lines, cur = [], []
    for w in words:
        if cur and tracked_width(" ".join(cur + [w]), f, track) > width:
            lines.append(cur)
            cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def draw_words(d, cx, y, vis, f, track, colour, fr):
    """A centred line whose words fade in one by one."""
    full = " ".join(w for w, _ in vis)
    x = cx - tracked_width(full, f, track) / 2
    bg = None
    for w, a in vis:
        if a > 0:
            if a < 1:
                if bg is None:
                    bg = fr.getpixel((int(min(fr.width - 1, max(0, x))), int(y + f.size * 0.5)))
                col = tuple(int(bg[k] + (colour[k] - bg[k]) * a) for k in range(3))
            else:
                col = colour
            draw_tracked(d, (x, y), w, f, col, track, anchor="l")
        x += tracked_width(w + " ", f, track) + track


def cut(pts, u):
    """The polyline from its start to fraction u."""
    if u <= 0:
        return pts[:1]
    q, _ = point_at(pts, u)
    total = polyline_length(pts) * u
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        if acc + seg >= total:
            break
        out.append(b)
        acc += seg
    out.append(q)
    return out


def cut_from(pts, u0, u1):
    whole = cut(pts, u1)
    if u0 <= 0:
        return whole
    q0, _ = point_at(pts, u0)
    total0 = polyline_length(pts) * u0
    acc, out = 0.0, [q0]
    for a, b in zip(whole, whole[1:]):
        acc += math.dist(a, b)
        if acc > total0:
            out.append(b)
    return out


# ---------------------------------------------------------------- the video

def timeline(plan):
    """Seconds per scene, fitted under the music (about 60 s at most)."""
    fixed = {"flight_out": 3.2 if plan.fly_out else 0, "arrival": 2.0 if plan.fly_out else 0, "overview": 1.8,
             "flight_home": 2.6 if plan.fly_home else 0, "ship": 4.5, "end": 5.0}
    photo = 2.0
    room = 60.0 - sum(fixed.values())
    voyage = max(8.0, min(2.1 * len(plan.legs) + 2, 24.0))
    while voyage + photo * len(plan.photos) > room and photo > 1.6:
        photo -= 0.1
    voyage = max(8.0, min(voyage, room - photo * len(plan.photos)))
    return dict(fixed, voyage=voyage, photo=photo)


def render(plan, size, out):
    r = Renderer(plan, size)
    tl = timeline(plan)
    scenes = []
    if plan.fly_out:
        scenes += [(r.scene_flight_out(tl["flight_out"]), 0), (r.scene_arrival(tl["arrival"]), 0.35)]
    scenes += [(r.scene_voyage(tl["voyage"], hold=0.0 if plan.fly_out else 1.0), 0),
               (r.scene_overview(tl["overview"]), 0)]
    scenes += [(r.scene_photo(p, tl["photo"]), 0.35) for p in plan.photos]
    if plan.fly_home:
        scenes.append((r.scene_flight_home(tl["flight_home"]), 0.35))
    scenes += [(r.scene_ship(tl["ship"]), 0.35), (r.scene_end(tl["end"]), "wipe")]
    W, H = r.W, r.H
    total = sum(v for k, v in tl.items() if k != "photo") + tl["photo"] * len(plan.photos)
    secs = round(total)
    path = out / f"route_{plan.s['code']}_{size}_{secs}s.mp4"
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-i", str(A / "music.m4a"),
                           "-filter_complex", f"[1:a]atrim=0:{total:.2f},afade=t=out:st={max(0, total - 2.5):.2f}:d=2.5[a]",
                           "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                           "-shortest", str(path)], stdin=subprocess.PIPE)
    prev = None
    frames = 0
    for gen, trans in scenes:
        k = 0
        for fr in gen:
            if prev is not None and trans == "wipe" and k < int(0.45 * FPS):
                # the brand's 20° slant sweeping across in white
                u = ease((k + 1) / (0.45 * FPS))
                m = Image.new("L", (W, H), 0)
                edge = W * 1.4 * u - 0.364 * H
                ImageDraw.Draw(m).polygon([(W - edge, 0), (W, 0), (W, H), (W - edge - 0.364 * H, H)], fill=255)
                fr = Image.composite(fr, prev, m)
            elif prev is not None and trans and trans != "wipe" and k < int(trans * FPS):
                fr = Image.blend(prev, fr, ease((k + 1) / (trans * FPS)))
            ff.stdin.write(fr.tobytes())
            frames += 1
            k += 1
            last = fr
        prev = last
    ff.stdin.close()
    if ff.wait():
        raise SystemExit(f"ffmpeg failed for {size}")
    print(f"  {size}: {frames / FPS:.1f} s → {path.name}")
    return path, frames / FPS


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sailing", help="cruise code (in state/current.json) or the sailing page's link")
    ap.add_argument("out", nargs="?", default="route-videos")
    ap.add_argument("--airports", default="", help="airport codes for the planes, e.g. LHR,MAN (default: the sailing's own)")
    ap.add_argument("--headline", default="", help="words over the ship (default: by destination)")
    ap.add_argument("--line", default="", help="the line under them")
    ap.add_argument("--sizes", default="9x16,4x5,1x1")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    s = rd.read_sailing(a.sailing)
    airports = [x.strip().upper() for x in a.airports.split(",") if x.strip()] or (s["airports"] if s["fly"] else [])
    dh, dl = default_words(s)
    headline = (a.headline.strip() or dh).upper()
    line = a.line.strip() or dl
    print(f"{s['code']} {s['name']} ({s['ship']}): {len([d for d in s['days'] if d['type'] == 'port'])} port days, "
          f"airports {airports or 'none (no-fly)'}")
    plan = Plan(s, airports, headline, line)
    print(f"  {len(plan.stops)} stops, {len(plan.photos)} port photos; words: {headline} / {line}")
    files = []
    length = 0
    for size in [x.strip() for x in a.sizes.split(",") if x.strip() in SIZES]:
        path, length = render(plan, size, out)
        files.append(path.name)
    info = {"files": files, "code": s["code"], "title": s["name"], "prices": "", "until": "", "slides": [s["name"]],
            "headline": headline, "line": line, "airports": airports, "made": dt.datetime.now(dt.timezone.utc).isoformat()}
    (out / "info.json").write_text(json.dumps(info, indent=1))
    known = json.loads((A / "ports.json").read_text())
    ports = [d for d in s["days"] if d["type"] == "port"]
    missing = sorted({d["name"] for d in ports if not rd.port_position(d, known)})
    guessed = sorted({d["name"] for d in ports if d["code"] not in known and (d["code"] or "")[:5] not in known
                      and d["name"] not in known and rd.port_position(d, known)})
    (out / "summary.md").write_text(
        f"## Route video: {s['name']} ({s['code']})\n\n"
        f"- Ship: {s['ship']}; {'flights from ' + ', '.join(rd.AIRPORTS[x][0] for x in airports if x in rd.AIRPORTS) if airports else 'no-fly'}\n"
        f"- Route: {' → '.join(map_label(x) for x in plan.stops)}\n"
        f"- Port photos: {', '.join(photo_label(x) for x in plan.photos) or 'none'}\n"
        f"- Words: {headline} / {line}\n"
        f"- Files: {', '.join(files)} ({length:.0f} s, with the template's music)\n"
        + (f"- **Left off the map (no position known; add to route/ports.json):** {', '.join(missing)}\n" if missing else "")
        + (f"- Placed from UN/LOCODE, not yet checked in route/ports.json (look at the map): {', '.join(guessed)}\n" if guessed else ""))
    print((out / "summary.md").read_text())


if __name__ == "__main__":
    main()
