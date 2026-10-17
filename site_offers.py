"""Ended offers still on our own website (Sam, 17 Oct 2026: idea 2, "build 2").

Once a UK day (hourly workflow step "Old offers on the website", `continue-on-error`), and again at the next check after
a promotion ends, every sitemap page except the sailing pages (/cruise/) and blog posts (/blog/) is read (the pages
terms.py reads: deals, landing pages, the offers page, ...) and its own wording (visible text, leaving out the sailing lists,
which come live from the booking system) is checked for:
  - ended_offer: the name of a promotion that has ended on every sailing (state/current.json `promos` spans all closed)
    and isn't the name of a live one, e.g. "Free Bottle Of Bubbles";
  - ended_code: a promo code from an ended promotion's name or description that no live promotion uses (COTW15);
  - past_date: offer wording with a date that has passed ("Book by 23:59 on 13th October 2026", "offer ends 12 Oct",
    "valid for bookings made between 1 and 30 September 2026"); a date with no year is taken as this year;
  - old_price: "from £X" (or "£Xpp") lower than every sailing on sale on that page now (its /cruise/ links and the cruise
    list's codes), or, on a page listing no sailings, lower than our cheapest sailing on sale.
Each finding says whether it sits in the page's "Terms and Conditions" section ("check": old terms left on the page) or in
the page itself ("fix": guests can see an offer that has gone). Findings are kept with the day first seen; ones no
longer found are kept FIXED_DAYS as fixed. New "fix" findings → out/site_offers.md → "Website still shows ended offers"
issue. Read-only: nothing on the website is changed.

→ state/site_offers.json {read_on, read_at, pages_checked, ended_sig, findings: {key: {path, kind, level, detail, text,
   first_seen, last_seen, fixed}}} → publish.py pricewatch/site-offers → tracker page Checks → Old offers on the website.

    python site_offers.py [--force]
"""
import argparse, concurrent.futures as cf, datetime as dt, html, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from daily import london_today  # noqa: E402

OUT = ROOT / "state" / "site_offers.json"
ISSUE = ROOT / "out" / "site_offers.md"
SITE = "https://www.ambassadorcruiseline.com"
FIXED_DAYS = 30
CODE = re.compile(r"\b[A-Z]{3,}\d{1,4}\b")
CODE_WORD = re.compile(r"\bcode\s+([A-Za-z]{3,}\d{1,4})\b", re.I)
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE = r"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(20\d\d))?"
NUM_DATE = r"(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})"
TRIGGER = (r"book(?:ed)?\s+by|bookings?\s+made\s+by|offer\s+ends?|ends?|ending|must\s+end|valid\s+(?:until|till|to)|until|expires?|"
           r"closes?|deadline|before|no\s+later\s+than")
PAST = re.compile(r"(?i)\b(?:" + TRIGGER + r")\s*(?:[:\-–]\s*)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?"
                  r"(?:(?:23:59|midnight|\d{1,2}(?::\d\d)?\s*(?:am|pm)?)\s+(?:on\s+)?)?(?:" + DATE + "|" + NUM_DATE + ")")
BETWEEN = re.compile(r"(?i)\bbetween\s+(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:[a-z]+\s+)?(?:20\d\d\s+)?)(?:and|to|-|–)\s+(?:" + DATE + "|" + NUM_DATE + ")")
OFFERISH = re.compile(r"(?i)offer|save|saving|off\b|credit|discount|free|deal|promo|code|%|£|deposit|upgrade|book")
# "from £X" for a cruise (not a coach seat, drinks package, excursion, deposit or credit on the same line)
FROM_PRICE = re.compile(r"(?i)\bfrom\s+(?:just\s+|only\s+)?£\s?(\d{1,3}(?:,\d{3})+|\d{3,5})\b(?!\s*(?:off|onboard|credit|deposit|saving))")
NOT_FARE = re.compile(r"(?i)coach|transfer|route|drinks?|package|excursion|tour|table|dining|spa|wi-?fi|internet|deposit|credit|upgrade|seat|flight|parking|insurance|gratuit|per day|a day|per night")
TAG = re.compile(r"""<(?:[^>"']|"[^"]*"|'[^']*')*>""")   # a tag, with '>' allowed inside quoted attributes
SAIL = re.compile(r"/cruise/([a-z]\d{4,}[a-z]{0,3})-", re.I)
CODES_PROP = re.compile(r'cruise-codes="([^"]+)"|cruise-codes=&quot;([^&]+)&quot;|"cruise-codes"\s*:\s*\[?\s*"?([A-Z0-9,\s]+)', re.I)


def norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9£%]+", " ", str(t or "").lower().replace("&", " and "))).strip()


def visible(page):
    """The page's visible text, one line per block."""
    page = re.sub(r"(?is)<(script|style|noscript|template|svg)\b.*?</\1>", " ", page)
    page = re.sub(r"(?is)<!--.*?-->", " ", page)
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d|tr|section|article|td|th|a|span|button)>", "\n", page)
    t = html.unescape(TAG.sub(" ", t))
    return "\n".join(x for x in (re.sub(r"[ \t ​]+", " ", x).strip() for x in t.split("\n")) if x)


def terms_text(page):
    """The text of the page's "Terms and Conditions" sections (as terms.py reads them)."""
    import terms
    return "\n".join(f"{d['title']} {d['text']}" for d in terms.sections(page, ""))


def when(d, mon, y, today):
    try:
        if mon.isdigit():
            y = int(y) + (2000 if len(y) == 2 else 0)
            return dt.date(y, int(mon), int(d))
        m = MONTHS[mon[:3].lower()]
        return dt.date(int(y) if y else today.year, m, int(d))
    except (ValueError, KeyError):
        return None


def uk(iso):
    try:
        d = dt.date.fromisoformat(str(iso)[:10])
        return f"{d.day} {d.strftime('%b')} {d.year}"
    except ValueError:
        return str(iso or "")


def snippet(text, a, b, pad=70):
    s, e = max(0, a - pad), min(len(text), b + pad)
    return ("…" if s else "") + text[s:e].replace("\n", " · ").strip() + ("…" if e < len(text) else "")


def catalogue(st):
    """Ended promotion names and codes (not shared with a live one), the live codes, and the cheapest sailing on sale."""
    S, offers = st.get("sailings") or {}, st.get("offers") or {}
    live, seen = set(), set()
    ended_on = {}
    for s in S.values():
        for oid, spans in (s.get("promos") or {}).items():
            seen.add(oid)
            if spans and spans[-1][1] is None and not s.get("removed"):
                live.add(oid)
            elif spans and spans[-1][1]:
                ended_on[oid] = max(ended_on.get(oid, ""), spans[-1][1])
    codes_of = lambda o: {c.upper() for c in CODE.findall(f"{o.get('name')} {o.get('desc')}")} | {c.upper() for c in CODE_WORD.findall(f"{o.get('name')} {o.get('desc')}")}   # noqa: E731
    live_names = {norm(offers[o].get("name")) for o in live if o in offers}
    live_codes = set().union(*[codes_of(offers[o]) for o in live if o in offers]) if live else set()
    ended = []
    for oid in sorted(seen - live):
        o = offers.get(oid) or {}
        n = norm(o.get("name"))
        if not n:
            continue
        ended.append({"id": oid, "name": o.get("name"), "norm": n if n not in live_names and len(n) >= 10 else "",
                      "codes": sorted(codes_of(o) - live_codes), "ended": ended_on.get(oid) or o.get("last_seen")})
    prices = {c: s["segments"][-1]["p"] for c, s in S.items()
              if not s.get("removed") and s.get("segments") and s["segments"][-1].get("p") and s.get("departure_date", "") > st.get("updated", "")}
    return ended, prices


LIVE_LIST = re.compile(r'(?is)<astro-island\b[^>]*component-url="[^"]*CruiseList[^"]*".*?</astro-island>')


def check_page(path, page, ended, prices, today):
    # The sailing lists (the CruiseList island) come live from the booking system, so their offers and prices are current:
    # only the page's own wording is checked
    text = visible(LIVE_LIST.sub(" ", page))
    tt = norm(terms_text(page))
    low = text.lower()
    out = []
    def add(kind, detail, a, b):
        snip = snippet(text, a, b)
        frag = norm(text[a:b])
        level = "check" if frag and frag in tt else "fix"
        out.append({"path": path, "kind": kind, "level": level, "detail": detail, "text": snip})
    for e in ended:
        if e["norm"]:
            words = [re.escape(w) for w in e["norm"].split()]
            m = re.search(r"(?i)" + r"[^a-z0-9£%]+".join(words), text.replace("&", "and"))
            if m:
                add("ended_offer", f"{e['name']} (ended {uk(e['ended'])})", m.start(), m.end())
        for c in e["codes"]:
            m = re.search(r"(?i)\b" + re.escape(c) + r"\b", text)
            if m:
                add("ended_code", f"code {c} from {e['name']} (ended {uk(e['ended'])})", m.start(), m.end())
    for rx in (PAST, BETWEEN):
        for m in rx.finditer(text):
            g = m.groups()
            d = when(g[0], g[1], g[2], today) if g[0] else when(g[3], g[4], g[5], today)
            if not d or d >= today:
                continue
            line_s, line_e = low.rfind("\n", 0, m.start()) + 1, low.find("\n", m.end())
            line = text[line_s: line_e if line_e > 0 else len(text)]
            if not OFFERISH.search(line):
                continue
            add("past_date", f"date passed: {m.group(0).strip()}", m.start(), m.end())
    codes = {m.group(1).upper() for m in SAIL.finditer(page)}
    for m in CODES_PROP.finditer(page):
        codes |= {c.strip().upper() for c in re.split(r"[,\s]+", next(x for x in m.groups() if x)) if c.strip()}
    on_page = [prices[c] for c in codes if c in prices]
    floor = min(on_page) if on_page else (min(prices.values()) if prices else None)
    if floor:
        for m in FROM_PRICE.finditer(text):
            v = int(m.group(1).replace(",", ""))
            ls, le = text.rfind("\n", 0, m.start()) + 1, text.find("\n", m.end())
            if NOT_FARE.search(text[ls: le if le > 0 else len(text)]):
                continue
            if 99 <= v < floor:
                add("old_price", f"£{v:,} quoted; the lowest {'sailing on this page' if on_page else 'sailing on sale'} is £{floor:,} now", m.start(), m.end())
    # one row per page, kind and detail
    seen, rows = set(), []
    for f in out:
        k = (f["kind"], f["detail"])
        if k not in seen:
            seen.add(k)
            rows.append(f)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    today = london_today()
    st = json.loads((ROOT / "state" / "current.json").read_text())
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    ended, prices = catalogue(st)
    sig = ",".join(sorted(e["id"] for e in ended))
    if old.get("read_on") == today and old.get("ended_sig") == sig and not a.force:
        print("Old offers on the website: already read today")
        return 0
    import enrich
    from coverage import sitemap_urls
    pages = sorted(u for u in sitemap_urls() if "/cruise/" not in u and "/blog/" not in u)
    if len(pages) < 20:
        print(f"Old offers on the website: the sitemap listed only {len(pages)} pages; nothing changed")
        return 0

    def one(u):
        try:
            return u, enrich.get(u)
        except Exception:  # noqa: BLE001
            return u, None
    with cf.ThreadPoolExecutor(6) as ex:
        got = list(ex.map(one, pages))
    failed = sum(1 for _, p in got if p is None)
    if failed > len(pages) * 0.2:
        print(f"Old offers on the website: {failed} of {len(pages)} pages couldn't be read; nothing changed")
        return 0
    d0 = dt.date.fromisoformat(today)
    found = []
    for u, p in got:
        if p:
            path = u.replace(SITE, "") or "/"
            found += check_page(path, p, ended, prices, d0)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    keep = old.get("findings") or {}
    cur = {}
    for f in found:
        k = f"{f['path']}|{f['kind']}|{f['detail']}"
        prev = keep.get(k) or {}
        cur[k] = {**f, "first_seen": prev.get("first_seen") if prev and not prev.get("fixed") else today, "last_seen": today, "fixed": None}
    read_ok = {u.replace(SITE, "") or "/" for u, p in got if p}
    for k, f in keep.items():   # gone today → fixed (a page that couldn't be read this time keeps its findings)
        if k in cur:
            continue
        if f["path"] not in read_ok and not f.get("fixed"):
            cur[k] = f
        elif f.get("fixed") or f["path"] in read_ok:
            fixed = f.get("fixed") or today
            if (d0 - dt.date.fromisoformat(fixed)).days <= FIXED_DAYS:
                cur[k] = {**f, "fixed": fixed}
    new = [f for k, f in cur.items() if not f["fixed"] and f["level"] == "fix" and (k not in keep or keep[k].get("fixed"))]
    OUT.write_text(json.dumps({"read_on": today, "read_at": now, "pages_checked": len(pages), "pages_failed": failed, "ended_sig": sig,
                               "ended": [{"name": e["name"], "ended": e["ended"], "codes": e["codes"]} for e in ended],
                               "findings": dict(sorted(cur.items()))}, ensure_ascii=False, indent=1))
    if new:
        ISSUE.parent.mkdir(exist_ok=True)
        KIND = {"ended_offer": "Ended offer", "ended_code": "Old promo code", "past_date": "Date passed", "old_price": "Price no longer available"}
        ISSUE.write_text("These pages on ambassadorcruiseline.com show offers or prices that have ended (Checks → Old offers on the "
                         "website has the full list):\n\n" + "".join(f"- [{f['path']}]({SITE}{f['path']}) · **{KIND[f['kind']]}**: {f['detail']}\n  > {f['text']}\n"
                                                                     for f in sorted(new, key=lambda x: x["path"])[:60]))
    live = [f for f in cur.values() if not f["fixed"]]
    print(f"Old offers on the website: {len(pages)} pages read ({failed} failed); {sum(1 for f in live if f['level'] == 'fix')} to fix, "
          f"{sum(1 for f in live if f['level'] == 'check')} in terms to check; {len(new)} new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
