"""Render sailing cards from a snapshot, in the style of the Meta carousel
sets (Set 2 / Set 3 sailing cards) built on the Ambassador design system.

Usage:
  python3 render_cards.py SNAPSHOT.json OUTDIR ID [ID ...]
  python3 render_cards.py SNAPSHOT.json OUTDIR ID --was 1649      # was/now variant
  python3 render_cards.py SNAPSHOT.json OUTDIR ID --cabin suite   # suite price (twin, pp)
  python3 render_cards.py SNAPSHOT.json OUTDIR ID --cabin suite --was 1579
    cabins: inside, ocean_view, balcony, suite (the --was price must then be
    that cabin's earlier price, from run.json "cabin_eligible")
  Every call renders all three placements by default:
    1080x1080 (1:1 feed and carousel), 1080x1350 (4:5 feed, Meta's recommended
    feed size since 12 Oct 2026; it replaced 3:4) and 1080x1920 (9:16 Stories/Reels),
    saved as <ID>[...]_1x1.png, _4x5.png and _9x16.png.
  add --size 1080x1080 (or a comma list) to render only some of them.
  The 9:16 card keeps the logo, badge and price clear of Meta's Stories
  overlays (top 14% and bottom 20% of the frame).

Layout (matches the carousel sailing cards):
  * full-bleed destination photo
  * Palatyn scrim at the top with the whiteout logo on it (never in a box)
  * Aloe badge, top right: ship icon + "No-fly on <ship> / from <port>",
    or plane icon + "Fly-cruise on <ship> / flights from <airport>"
  * bottom left, stacked sash-ended strips: Allium kicker line, Allium
    headline, Amber fare block (nights + date | From £X pp, Allium text,
    never black), a Pearl Nectar strip when the sailing earns points (see nectar_line),
    then up to two Aloe promotion strips (see promo_lines)

Was/now cards (--was) use the price-reduction layout instead (since 9 Oct
2026), matching the fly-cruise price reduction carousel
(CAR_EN_PriceReductionCaribbeanFly_C277_T2096):
  * full-bleed photo, white logo top left on a light Palatyn scrim
  * tilted Amber sticker top right with a white inner border:
    "Price reduction" / cabin grade / "Was £X" struck through / "Now £Y pp".
    Lead claims name the cabin grade whose twin price is the lead price.
  * pale rounded panel at the bottom: date | nights, the sailing name in
    Allium, "No-fly from <port> on <ship>" (ship icon) or
    "Flights from <airport> on <ship>" (plane icon), then the footnote
    "Price per person based on two sharing. Subject to availability.
    T&Cs apply." with the cruise code on the right.
Cards without --was are unchanged.
"""
import base64, datetime, html, json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
# Works from the project layout (fonts/, assets/) or a flat kit folder.
FONTS = ROOT / "fonts" if (ROOT / "fonts").exists() else ROOT
LOGO = ((ROOT / "assets" / "logo-white.svg") if (ROOT / "assets").exists() else (ROOT / "logo-white.svg")).read_text()
CACHE = ROOT / "img_cache"
CACHE.mkdir(exist_ok=True)

SHIP_ICON = ('<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" '
             'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14h18l-2.5 5h-13z"/>'
             '<path d="M6 14V9h12v5"/><path d="M10 9V5.5h4V9"/><path d="M2 21.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 '
             '1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"/></svg>')
PLANE_ICON = ('<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" '
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5'
              'C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.3c-.2.5-.1 1 .3 1.3L9 12l-2 '
              '3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>')


def b64(p):
    return base64.b64encode(Path(p).read_bytes()).decode()


FONT_CSS = "\n".join(
    f"@font-face{{font-family:'Quicksand';font-weight:{w};src:url(data:font/woff2;base64,{b64(FONTS / f'quicksand-latin-{w}-normal.woff2')}) format('woff2')}}"
    for w in (400, 500, 600, 700))


def photo(url, sid, w, h):
    # Storyblok image service: focal-point smart crop at the card size.
    dst = CACHE / f"{sid}_{w}x{h}.jpg"
    if not dst.exists():
        src = url + f"/m/{w}x{h}/smart/filters:quality(88):format(jpeg)"
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        dst.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return "data:image/jpeg;base64," + b64(dst)


def edge_colours(path):
    """(top, bottom) CSS colours: the most common colour along an image's top and bottom edges."""
    from collections import Counter
    from PIL import Image
    im = Image.open(path).convert("RGB")
    W, H = im.size

    def mode(rows):
        px = [im.getpixel((x, y)) for y in rows for x in range(0, W, 2)]
        key = lambda c: tuple(v // 24 for v in c)
        top = Counter(map(key, px)).most_common(1)[0][0]
        sel = [c for c in px if key(c) == top]
        return "rgb(%d,%d,%d)" % tuple(sum(c[i] for c in sel) // len(sel) for i in range(3))
    return mode(range(0, min(6, H))), mode(range(max(0, H - 6), H))


def is_light(css):
    r, g, b = map(int, css[4:-1].split(","))
    return 0.299 * r + 0.587 * g + 0.114 * b > 160


def matched_css(top_c):
    """Standard cards with campaign artwork: plain matched colours instead of the blurred copy; the logo
    turns Allium on a light top colour (the whiteout logo needs a dark ground)."""
    css = ".artbg{inset:0;filter:none}.art{box-shadow:none}.scrim{display:none}"
    if is_light(top_c):
        css += ".logo svg path{fill:#6B207D!important}"
    return css


def campaign_css(top_c, top):
    """Was/now cards with campaign artwork: plain matched colours, smaller corner sticker."""
    css = (".artbg{position:absolute;inset:0;filter:none}.art{box-shadow:none}.scrim{display:none}"
           f".sticker{{right:30px;top:{top + 30}px;transform:rotate(7deg) scale(.68);transform-origin:top right}}")
    if is_light(top_c):
        css += ".logo{filter:none!important}.logo svg path{fill:#6B207D!important}"
    return css


def photo_whole(url, sid, w):
    # Storyblok image service: the whole image at the card width, uncropped.
    dst = CACHE / f"{sid}_{w}x0.jpg"
    if not dst.exists():
        src = url + f"/m/{w}x0/filters:quality(88):format(jpeg)"
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        dst.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return "data:image/jpeg;base64," + b64(dst)


# Campaign artwork (themed / chartered sailings, Cruise of the Week): wide images with text
# baked in, which the normal crop cuts through (Sam, 12 Oct 2026, A12639). These cards keep
# the same design but show the artwork whole, between the badge and the strips, on a blurred
# copy of itself. Spotted from the file name or the 2:1 shape; campaign_images.json can add
# or remove cruise codes by hand: {"add": [...], "remove": [...]}.
CAMPAIGN_NAME = re.compile(r"(cotw|dig-\d|carousel|boom-radio|weekender|back_to_|no-logo)", re.I)
CAMPAIGN_SIZE = re.compile(r"/f/\d+/(\d+)x(\d+)/")
_CA = ROOT / "campaign_images.json"
CAMPAIGN_LIST = json.loads(_CA.read_text()) if _CA.exists() else {}


def is_campaign(s):
    sid = s["id"]
    if sid in (CAMPAIGN_LIST.get("remove") or []):
        return False
    if sid in (CAMPAIGN_LIST.get("add") or []):
        return True
    url = OVERRIDES.get(sid) or s.get("image_link") or ""
    if sid in OVERRIDES:
        return False   # a hand-picked swap is a photo
    m = CAMPAIGN_SIZE.search(url)
    wide = bool(m) and int(m.group(1)) >= 1.9 * int(m.group(2))
    return bool(CAMPAIGN_NAME.search(url.rsplit("/", 1)[-1])) or wide


# Per-sailing photo swaps (cruise code -> image URL on Ambassador's asset
# server), for feed images that are duplicated, have text in them, or break
# the photography guidelines.
_OV = ROOT / "image_overrides.json"
OVERRIDES = json.loads(_OV.read_text()) if _OV.exists() else {}


# Promotions on standard cards (Sam, 12 Oct 2026): the main live promotion, plus a
# second one when there is one, from the page's offers (snapshot "offers").
# Order: a percentage saving or code first, then onboard credit (biggest first),
# flight upgrades, coach travel, solo supplements, anything else.
# "Lower fares" / "reduced fares" offers are left off: they claim a price came down,
# which is a was/now (reference pricing) claim, and those only ever come from run.json.
# "Lower solo supplement" too (Sam, 13 Oct 2026): "lower" implies a price comparison the tracker can't back up
PRICE_CLAIM = re.compile(r"\b(lower|reduced|reduction)\b.*\b(fares?|supplements?|prices?)\b", re.I)
MAX_PROMOS = 2


def promo_rank(o):
    n = o["name"].lower()
    if "%" in n or "code" in (o.get("description") or "").lower():
        return (0, 0)
    m = re.search(r"£([\d,]+)\s+onboard credit", n)
    if m:
        return (1, -int(m.group(1).replace(",", "")))
    for i, k in enumerate(("flight", "upper class", "coach", "solo")):
        if k in n:
            return (2 + i, 0)
    return (9, 0)


def promo_lines(s, limit=None):
    """Text for the promotion strips: name, plus the code and closing date when
    the page gives them (a time-limited offer has to show when it ends).
    limit=0 gives every promotion that may go on a card, best first (the ad creator's choices)."""
    offers = s.get("offers")
    if offers is None:  # page's offer list couldn't be read: fall back to the old onboard credit line
        return [s["offer"]] if s.get("offer") else []
    out = []
    # One promotion when the card also has a Nectar strip (Sam, 12 Oct 2026), so it doesn't get too busy.
    if limit is None:
        limit = 1 if nectar_line(s) else MAX_PROMOS
    for o in sorted((o for o in offers if not PRICE_CLAIM.search(o["name"])), key=promo_rank)[:limit or None]:
        name = o["name"].strip()
        if name.isupper():
            name = name.capitalize()
        bits = [name]
        desc = o.get("description") or ""
        code = re.search(r"\bcode\s+([A-Z0-9]{3,})\b", desc, re.I)
        if code and code.group(1).upper() not in name.upper():
            bits.append(f"code {code.group(1).upper()}")
        end = None
        if o.get("expires_at"):
            try:
                end = datetime.date.fromisoformat(o["expires_at"][:10])
            except ValueError:
                pass
        if not end:
            m = re.search(r"book by[^.]*?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})", desc, re.I)
            if m:
                try:
                    end = datetime.datetime.strptime(" ".join(m.groups()), "%d %B %Y").date()
                except ValueError:
                    pass
        if end:
            bits.append(f"ends {end.strftime('%-d %b')}")
        out.append(" · ".join(bits))
    return out


def nectar_line(s):
    """Nectar line for standard cards (Sam, 12 Oct 2026): the figure the sailing page shows
    (snapshot "nectar_pts": two sharing the cheapest cabin, Ambassador fare). That fare costs
    more than the "from" price on the card, so the line says "up to"."""
    n = s.get("nectar_pts")
    return f"Collect up to {n:,} Nectar points" if n else ""


CABIN_LABEL = {"inside": "Inside cabins", "ocean_view": "Ocean view cabins",
               "balcony": "Balcony cabins", "suite": "Suites"}


def money(v):
    return f"£{v:,.0f}"


def nice_date(iso):
    return datetime.date.fromisoformat(iso).strftime("%-d %b %Y")


def split_title(t, max_head=20):
    """Kicker line + headline, the way the carousel cards set them:
    'Christmas & New Year Voyage to' / 'Spain & Portugal',
    'Norway's Land of the' / 'Northern Lights'."""
    t = t.strip()
    for sep in (": ", " - ", " – "):
        if sep in t:
            a, b = t.split(sep, 1)
            return a.strip(), b.strip()
    best = None
    for kw in (" of the ", " to the ", " of ", " to ", " in "):
        i = t.rfind(kw)
        if i > 0:
            head = t[i + len(kw):]
            if len(head) >= 4 and (best is None or len(head) < len(best[1])):
                best = (t[:i + len(kw)].strip(), head.strip())
    if best:
        return best
    if len(t) <= max_head:
        return "", t
    i = t.rfind(" & ")
    if i > 0 and len(t) - i - 3 <= max_head + 6:
        return t[:i + 2].strip(), t[i + 3:].strip()
    words = t.split()
    head = []
    while words and len(" ".join([words[-1]] + head)) <= max_head:
        head.insert(0, words.pop())
    if not head:
        head = [words.pop()]
    return " ".join(words), " ".join(head)


def card_html(s, was=None, w=1080, h=1080, cabin=None, campaign=None):
    if campaign is None:
        campaign = not was and is_campaign(s)
    # Stories/Reels: Meta overlays the profile bar on the top ~14% and the
    # reply bar / CTA on the bottom ~20%, so 9:16 cards push everything in.
    story = h / w >= 1.7
    top = round(h * 0.14) if story else 0
    bottom = round(h * 0.20) + 24 if story else 64
    fly = s.get("flight_from")
    title = s["base_title"] if fly else s["title"]
    kicker, headline = split_title(title)
    sub = ""
    # "Atlantic Loop: Coastal France, Scilly Isles & Irish Charm" — a long
    # second half reads better as a line under a short headline.
    if kicker and len(headline) > 24 and len(kicker) <= 24:
        headline, sub, kicker = kicker, headline, ""
    if fly:
        badge_icon, b1, b2 = PLANE_ICON, f"Fly-cruise on {s['ship']}", f"Flights from {fly}"
    else:
        badge_icon, b1, b2 = SHIP_ICON, f"No-fly on {s['ship']}", f"from {s['port']}"
    nights = f"{s['nights']} nights"
    date = nice_date(s["departure_date"]) if s.get("departure_date") else ""
    now = s["price_pp"]
    cab = ""
    if cabin:
        now = ((s.get("cabins") or {}).get("twin") or {}).get(cabin)
        if not now:
            raise SystemExit(f"{s['id']}: no twin {cabin} price on sale in this snapshot")
        cab = f'<div class="cab">{CABIN_LABEL[cabin]}</div>'
    price = money(now)
    if was:
        fare = f"""
        <div class="fare-col">{cab}
          <div class="was"><span>Was</span> <s>{money(was)}</s> <span class="save">Save {money(was - now)}</span></div>
          <div class="fare-row"><span class="from">Now</span><span class="big">{price}</span><span class="pp">pp</span></div>
        </div>"""
    elif cab:
        fare = f"""
        <div class="fare-col">{cab}
          <div class="fare-row"><span class="from">From</span><span class="big">{price}</span><span class="pp">pp</span></div>
        </div>"""
    else:
        fare = f"""
        <div class="fare-row"><span class="from">From</span><span class="big">{price}</span><span class="pp">pp</span></div>"""
    top_c = bot_c = None
    if campaign:
        # Campaign artwork whole, on plain colours from its own top and bottom edges (Sam, 13 Oct 2026,
        # as on was/now cards; replaced the blurred copy of the artwork).
        art = photo_whole(s["image_link"], s["id"], w)
        top_c, bot_c = edge_colours(CACHE / f"{s['id']}_{w}x0.jpg")
        art_html = f'<div class="artbg" id="artbg"></div><img class="art" id="art" src="{art}" alt="">'
    else:
        art_html = (f'<img class="photo" src="{photo(OVERRIDES.get(s["id"], s["image_link"]), s["id"] + ("_ov" if s["id"] in OVERRIDES else ""), w, h)}" alt="">')
    offer_html = "".join(f'<div class="strip offer"><span class="fit" data-max="27">{html.escape(t)}</span></div>' for t in promo_lines(s))
    nx = nectar_line(s)
    nectar_html = f'<div class="strip nectar"><span class="fit" data-max="27">{html.escape(nx)}</span></div>' if nx else ""
    kicker_html = f'<div class="strip kicker"><span class="fit" data-max="42">{html.escape(kicker)}</span></div>' if kicker else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{FONT_CSS}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:{w}px;height:{h}px;background:#380843}}
#card{{position:relative;width:{w}px;height:{h}px;overflow:hidden;background:#380843;font-family:'Quicksand',Helvetica,Arial,sans-serif;color:#fff}}
.photo{{position:absolute;left:0;top:0;width:{w}px;height:{h}px;object-fit:cover;display:block}}
.scrim{{position:absolute;left:0;right:0;top:0;height:{298 + top}px;
  background:linear-gradient(to bottom,rgba(56,8,67,.75) 0%,rgba(56,8,67,.75) 43%,rgba(56,8,67,0) 100%)}}
.logo{{position:absolute;left:64px;top:{34 + top}px;height:60px}}
.logo svg{{height:60px;width:auto;display:block}}
.badge{{position:absolute;right:0;top:{top}px;display:flex;align-items:center;gap:20px;height:128px;padding:0 64px 0 84px;
  background:#009165;color:#fff;clip-path:polygon(0 0,100% 0,100% 100%,47px 100%)}}
.badge .lines{{display:flex;flex-direction:column;gap:4px;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}}
.stack{{position:absolute;left:0;bottom:{bottom}px;display:flex;flex-direction:column;align-items:flex-start;gap:10px}}
.strip{{display:flex;align-items:center;white-space:nowrap}}
.kicker{{height:80px;padding:0 71px 0 64px;background:#6B207D;clip-path:polygon(0 0,calc(100% - 29px) 0,100% 100%,0 100%);
  font-size:42px;line-height:1;font-weight:500;letter-spacing:.1em;text-transform:uppercase}}
.headline{{height:116px;padding:0 84px 0 64px;background:#6B207D;clip-path:polygon(0 0,calc(100% - 42px) 0,100% 100%,0 100%)}}
.headline h1{{font-size:70px;line-height:1;font-weight:500;letter-spacing:.08em;text-transform:uppercase}}
.fare{{margin-top:14px;display:flex;align-items:center;gap:28px;min-height:150px;padding:0 90px 0 64px;background:#F68C4E;color:#6B207D;
  clip-path:polygon(0 0,calc(100% - 55px) 0,100% 100%,0 100%)}}
.fare.tall{{min-height:184px}}
.when{{display:flex;flex-direction:column;gap:6px;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}}
.rule{{width:3px;height:84px;background:#6B207D}}
.fare-col{{display:flex;flex-direction:column;gap:4px}}
.fare-row{{display:flex;align-items:baseline;gap:10px;white-space:nowrap}}
.fare-row .from{{font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}}
.fare-row .big{{font-size:96px;font-weight:700;line-height:1;letter-spacing:-.01em}}
.fare-row .pp{{font-size:34px;font-weight:700}}
.was{{font-size:28px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}}
.was s{{text-decoration-thickness:3px}}
.was .save{{margin-left:10px}}
.cab{{font-size:28px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}}
.fare.tall2{{min-height:214px}}
.nectar{{height:76px;padding:0 60px 0 64px;background:#F1ECE7;color:#6B207D;clip-path:polygon(0 0,calc(100% - 28px) 0,100% 100%,0 100%);
  font-size:27px;font-weight:700}}
.artbg{{position:absolute;inset:-80px;background-size:cover;background-position:center;filter:blur(36px) brightness(.72) saturate(1.1)}}
.art{{position:absolute;z-index:1;left:0;width:{w}px;height:auto;object-fit:contain;box-shadow:0 10px 30px rgba(0,0,0,.35)}}
.offer{{height:76px;padding:0 60px 0 64px;background:#009165;color:#fff;clip-path:polygon(0 0,calc(100% - 28px) 0,100% 100%,0 100%);
  font-size:27px;font-weight:700}}
{matched_css(top_c) if campaign else ""}
</style></head><body><div id="card">
{art_html}
<div class="scrim"></div>
<div class="logo">{LOGO}</div>
<div class="badge" id="badge">{badge_icon}<div class="lines"><span>{html.escape(b1)}</span><span>{html.escape(b2)}</span></div></div>
<div class="stack">
  {kicker_html}
  <div class="strip headline"><h1 class="fit" data-max="70">{html.escape(headline)}</h1></div>
  {f'<div class="strip kicker"><span class="fit" data-max="40">{html.escape(sub)}</span></div>' if sub else ""}
  <div class="strip fare{' tall2' if (was and cabin) else ' tall' if (was or cabin) else ''}">
    <div class="when"><span>{html.escape(nights)}</span><span>{html.escape(date)}</span></div>
    <div class="rule"></div>
    {fare}
  </div>
  {nectar_html}
  {offer_html}
</div>
</div>
<script>
// Shrink long lines so every strip stays inside the card, as the
// hand-built cards were sized by eye.
function fit(){{
  const W = {w};
  document.querySelectorAll('.fit').forEach(el => {{
    let size = +el.dataset.max; el.style.fontSize = size + 'px';
    const strip = el.closest('.strip');
    while (strip.getBoundingClientRect().right > W - 24 && size > 24) {{ size -= 1; el.style.fontSize = size + 'px'; }}
  }});
  // Keep the hierarchy: the kicker line never outsizes the headline.
  const h1 = document.querySelector('.headline h1');
  const hs = parseFloat(h1.style.fontSize);
  document.querySelectorAll('.kicker .fit').forEach(k => {{
    if (parseFloat(k.style.fontSize) > hs * 0.62) k.style.fontSize = Math.round(hs * 0.62) + 'px';
  }});
  // Badge must clear the logo.
  const badge = document.getElementById('badge'), lines = badge.querySelector('.lines');
  const logoRight = document.querySelector('.logo').getBoundingClientRect().right;
  let bs = 30;
  while (badge.getBoundingClientRect().left < logoRight + 32 && bs > 18) {{ bs -= 1; lines.style.fontSize = bs + 'px'; }}
  // Campaign artwork: shown whole in the space between the badge and the strips.
  const art = document.getElementById('art');
  if (art) {{
    const top = badge.getBoundingClientRect().bottom + 20, bot = document.querySelector('.stack').getBoundingClientRect().top - 20;
    const ratio = art.naturalHeight / art.naturalWidth, room = bot - top;
    let aw = W, ah = W * ratio;
    if (ah > room) {{ ah = room; aw = ah / ratio; }}
    const y = top + (room - ah) / 2;
    art.style.width = aw + 'px'; art.style.height = ah + 'px';
    art.style.left = (W - aw) / 2 + 'px'; art.style.top = y + 'px';
    document.getElementById('artbg').style.background =
      `linear-gradient(to bottom, {top_c} 0, {top_c} ${{y + ah}}px, {bot_c} ${{y + ah}}px, {bot_c} 100%)`;
  }}
}}
</script>
</body></html>"""


PR_CABIN = {"inside": "Inside cabin", "ocean_view": "Ocean view cabin",
            "balcony": "Balcony cabin", "suite": "Suite"}
PR_SHIP = ('<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#6B207D" stroke-width="1.9" '
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14h18l-2.5 5h-13z"/>'
           '<path d="M6 14V9h12v5"/><path d="M10 9V5.5h4V9"/><path d="M2 21.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 '
           '1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"/></svg>')
PR_PLANE = PLANE_ICON.replace('width="58" height="58"', 'width="36" height="36"').replace('#ffffff', '#6B207D').replace('stroke-width="1.6"', 'stroke-width="1.9"')


def lead_grade(s):
    """Cabin grade whose twin price is the sailing's lead price, if any."""
    twin = (s.get("cabins") or {}).get("twin") or {}
    for k in ("inside", "ocean_view", "balcony", "suite"):
        if twin.get(k) and round(twin[k]) == round(s["price_pp"]):
            return k
    return None


def price_reduction_html(s, was, w=1080, h=1080, cabin=None):
    """Was/now card in the price-reduction style (see module docstring)."""
    story = h / w >= 1.7
    top = round(h * 0.14) if story else 0
    bottom = round(h * 0.20) + 30 if story else 40
    tall = h > w
    fly = s.get("flight_from")
    title = s["base_title"] if fly else s["title"]
    if cabin:
        now = ((s.get("cabins") or {}).get("twin") or {}).get(cabin)
        if not now:
            raise SystemExit(f"{s['id']}: no twin {cabin} price on sale in this snapshot")
        grade = cabin
    else:
        now = s["price_pp"]
        grade = lead_grade(s)
    grade_html = f'<div class="st2">{PR_CABIN[grade]}</div>' if grade else ""
    if fly:
        icon, line = PR_PLANE, f"Flights from {fly} on {s['ship']}"
    else:
        icon, line = PR_SHIP, f"No-fly from {s['port']} on {s['ship']}"
    date = datetime.date.fromisoformat(s["departure_date"]).strftime("%-d %B %Y") if s.get("departure_date") else ""
    # Campaign artwork (Sam, 12 Oct 2026): shown whole below a smaller corner sticker, on plain
    # colours matched to the artwork's own top and bottom edges (no blur); the logo turns
    # purple on a light top. Other photos stay full-bleed in the usual style.
    campaign = is_campaign(s)
    top_c = bot_c = None
    if campaign:
        art = photo_whole(s["image_link"], s["id"], w)
        top_c, bot_c = edge_colours(CACHE / f"{s['id']}_{w}x0.jpg")
        photo_html = f'<div class="artbg" id="artbg"></div><img class="art" id="art" src="{art}" alt="">'
    else:
        photo_html = f'<img class="photo" src="{photo(OVERRIDES.get(s["id"], s["image_link"]), s["id"] + ("_ov" if s["id"] in OVERRIDES else ""), w, h)}" alt="">'
    when = " &nbsp;|&nbsp; ".join(x for x in (html.escape(date), f"{s['nights']} nights") if x)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{FONT_CSS}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:{w}px;height:{h}px;background:#380843}}
#card{{position:relative;width:{w}px;height:{h}px;overflow:hidden;background:#380843;font-family:'Quicksand',Helvetica,Arial,sans-serif}}
.photo{{position:absolute;left:0;top:0;width:{w}px;height:{h}px;object-fit:cover;display:block}}
.scrim{{position:absolute;left:0;right:0;top:0;height:{top + 380}px;
  background:linear-gradient(to bottom,rgba(56,8,67,{.55 if top else .42}) 0%,rgba(56,8,67,.18) 55%,rgba(56,8,67,0) 100%)}}
.logo{{position:absolute;left:72px;top:{top + (70 if tall else 55)}px;height:62px;filter:drop-shadow(0 1px 6px rgba(0,0,0,.25))}}
.logo svg{{height:62px;width:auto;display:block}}
.sticker{{position:absolute;right:46px;top:{top + (140 if tall else 125)}px;width:420px;padding:30px 30px 34px;background:#F68C4E;color:#fff;
  border-radius:16px;transform:rotate(7deg);box-shadow:0 10px 28px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.18);text-align:center}}
.sticker::after{{content:"";position:absolute;inset:12px;border:3px solid rgba(255,255,255,.95);border-radius:9px}}
.st1{{font-weight:700;font-size:24px;letter-spacing:.14em;text-transform:uppercase}}
.st2{{font-weight:600;font-size:25px;margin-top:8px}}
.was{{font-weight:700;font-size:28px;margin-top:6px}}
.was s{{text-decoration-thickness:3px}}
.now{{display:flex;justify-content:center;align-items:baseline;gap:12px;margin-top:2px;line-height:1;white-space:nowrap}}
.now .l{{font-weight:600;font-size:32px}}
.now .p{{font-weight:700;font-size:74px;letter-spacing:-.005em}}
.now .pp{{font-weight:700;font-size:26px}}
.panel{{position:absolute;left:43px;right:40px;bottom:{bottom}px;background:rgba(244,239,234,.97);border-radius:24px;padding:44px 46px 30px;
  color:#4a1a5c;box-shadow:0 6px 24px rgba(0,0,0,.18)}}
.dt{{font-weight:700;font-size:22px;letter-spacing:.16em;text-transform:uppercase;color:#6B207D}}
.tt{{font-weight:600;font-size:46px;line-height:1.12;margin-top:12px;color:#4a1a5c;text-wrap:balance}}
.fl{{display:flex;align-items:center;gap:16px;margin-top:20px;font-weight:600;font-size:26px;color:#3b3340}}
.fl svg{{flex:none}}
.ft{{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-top:30px;font-weight:500;font-size:18px;color:#6e6573}}
.ft b{{font-weight:700;color:#3b3340;white-space:nowrap}}
.artbg{{position:absolute;inset:-80px;background-size:cover;background-position:center;filter:blur(36px) brightness(.72) saturate(1.1)}}
.art{{position:absolute;z-index:1;left:0;width:{w}px;height:auto;box-shadow:0 10px 30px rgba(0,0,0,.35)}}
.scrim,.logo,.sticker,.panel{{z-index:2}}
{campaign_css(top_c, top) if campaign else ""}
</style></head><body><div id="card">
{photo_html}
<div class="scrim"></div>
<div class="logo">{LOGO}</div>
<div class="sticker"><div class="st1">Price reduction</div>{grade_html}
  <div class="was">Was <s>{money(was)}</s></div>
  <div class="now"><span class="l">Now</span><span class="p fitp">{money(now)}</span><span class="pp">pp</span></div></div>
<div class="panel"><div class="dt">{when}</div>
  <div class="tt" id="tt">{html.escape(title)}</div>
  <div class="fl">{icon}<span>{html.escape(line)}</span></div>
  <div class="ft"><span>Price per person based on two sharing. Subject to availability. T&amp;Cs apply.</span><b>{html.escape(s['id'])}</b></div></div>
</div>
<script>
// Keep the sailing name to two lines and the price inside the sticker.
function fit(){{
  const tt = document.getElementById('tt');
  let size = 46;
  while (tt.getBoundingClientRect().height > size * 1.12 * 2 + 4 && size > 30) {{ size -= 1; tt.style.fontSize = size + 'px'; }}
  const p = document.querySelector('.fitp'), row = p.parentElement;
  let ps = 74;
  while (row.scrollWidth > row.clientWidth + 1 && ps > 48) {{ ps -= 1; p.style.fontSize = ps + 'px'; }}
  // Campaign artwork: whole, below the logo and the sticker and above the panel, so nothing
  // covers its own text or faces. The artwork's top-edge colour fills the card down to the
  // artwork's bottom edge, its bottom-edge colour below that: two plain colours, no fade.
  const art = document.getElementById('art');
  if (art) {{
    const W = {w}, ratio = art.naturalHeight / art.naturalWidth, r = e => document.querySelector(e).getBoundingClientRect();
    const top = Math.max(r('.logo').bottom, r('.sticker').bottom) + 20, room = r('.panel').top - 20 - top;
    let aw = W, ah = W * ratio;
    if (ah > room) {{ ah = room; aw = ah / ratio; }}
    const y = top + (room - ah) / 2;
    art.style.width = aw + 'px'; art.style.height = ah + 'px'; art.style.left = (W - aw) / 2 + 'px'; art.style.top = y + 'px';
    document.getElementById('artbg').style.background =
      `linear-gradient(to bottom, {top_c} 0, {top_c} ${{y + ah}}px, {bot_c} ${{y + ah}}px, {bot_c} 100%)`;
  }}
}}
</script>
</body></html>"""


SIZES = {(1080, 1080): "1x1", (1080, 1350): "4x5", (1080, 1920): "9x16"}


def render(snapshot, outdir, ids, was=None, sizes=tuple(SIZES), cabin=None):
    snap = json.loads(Path(snapshot).read_text())
    by = {s["id"]: s for s in snap["sailings"]}
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    from playwright.sync_api import sync_playwright  # only needed to render, not for promo_lines etc.
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h in sizes:
            tag = SIZES.get((w, h), f"{w}x{h}")
            pg = b.new_page(viewport={"width": w, "height": h})
            for sid in ids:
                s = by[sid]
                build = price_reduction_html if was else card_html
                pg.set_content(build(s, was, w, h, cabin), wait_until="load")
                pg.evaluate("document.fonts.ready")
                pg.evaluate("fit()")
                dst = out / f"{sid}{'_' + cabin if cabin else ''}{'_wasnow' if was else ''}_{tag}.png"
                pg.locator("#card").screenshot(path=str(dst))
                paths.append(dst)
            pg.close()
        b.close()
    return paths


if __name__ == "__main__":
    args = sys.argv[1:]
    was, sizes, cabin = None, tuple(SIZES), None
    if "--cabin" in args:
        i = args.index("--cabin"); cabin = args[i + 1]; args = args[:i] + args[i + 2:]
        if cabin not in CABIN_LABEL:
            raise SystemExit(f"--cabin must be one of {', '.join(CABIN_LABEL)}")
    if "--was" in args:
        i = args.index("--was"); was = float(args[i + 1]); args = args[:i] + args[i + 2:]
    if "--size" in args:
        i = args.index("--size")
        sizes = tuple(tuple(int(x) for x in v.split("x")) for v in args[i + 1].split(","))
        args = args[:i] + args[i + 2:]
    for pth in render(args[0], args[1], args[2:], was, sizes, cabin):
        print(pth)
