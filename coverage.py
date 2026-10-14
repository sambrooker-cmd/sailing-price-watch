"""Weekly check: sailings on sale on the website but missing from the ad feed.

Reads the site's sitemap for every /cruise/ page, compares it with the feed,
and opens each page that isn't in the feed to see whether it's actually on
sale (prices shown, not departed). Writes state/coverage.json, keeping when
each missing sailing was first noticed, and out/coverage.md for the issue.

France (--market fr, 14 Oct 2026; Sam: "build the things not built yet"): France has no ad feed, so its
check compares the site's own two lists of sailings: the cruise list visitors browse (/croisieres) and the
sitemap search engines read. Sailings on the list but not in the sitemap (search engines may not find their
pages), sailings on sale with a sitemap page but not on the list (visitors browsing can't find them), and
sitemap pages that are 404, departed or sold out. Prices and titles come from state/fr (the hourly check
reads every sailing on either list). Writes state/fr/coverage.json and out/fr/coverage.md.

Usage: python coverage.py [--date YYYY-MM-DD] [--market fr]
Exit codes: 0 ok, 2 the sitemap or feed couldn't be read properly (nothing written).
"""
import argparse, concurrent.futures as cf, csv, datetime as dt, html, io, json, os, re, sys
from pathlib import Path

import enrich
from daily import gh_output, london_today, money

ROOT = Path(__file__).resolve().parent
SITE = "https://www.ambassadorcruiseline.com"


def sitemap_pages():
    pages = {}
    for u in sitemap_urls():
        if "/cruise/" in u:
            u = u.rstrip("/")
            pages[u.rsplit("/cruise/", 1)[1].split("-", 1)[0].upper()] = u
    return pages


def sitemap_urls():
    """Every page in the site's sitemap (also used by terms.py)."""
    robots = ""
    try:
        robots = enrich.get(SITE + "/robots.txt")
    except Exception:  # noqa
        pass
    todo = re.findall(r"(?im)^sitemap:\s*(\S+)", robots) or [SITE + "/sitemap-index.xml", SITE + "/sitemap.xml"]
    seen, urls = set(), set()
    while todo:
        m = todo.pop()
        if m in seen:
            continue
        seen.add(m)
        try:
            locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", enrich.get(m))
        except Exception:  # noqa
            continue
        todo += [l for l in locs if l.endswith(".xml")]
        urls |= {l for l in locs if not l.endswith(".xml")}
    return urls


def page_title(page):
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', page) or re.search(r"<title>([^<]*)</title>", page)
    return html.unescape(m.group(1)).split("|")[0].strip() if m else ""


def agents(page):
    """Who a sailing is sold through (FareSummary search-data "agents"): ["DIRECT"] for Ambassador's own
    sailings; agent ids for semi-charters, which aren't meant to be in the ad feed (Sam, 13 Oct 2026). The site's
    own script sends visitors on those pages to /404/ (checked in a browser, all 14 on 13 Oct 2026), but the
    server still returns the page with its prices, so this reads them without a browser."""
    m = re.search(r'<astro-island[^>]*component-url="[^"]*FareSummary[^"]*"[^>]*props="([^"]*)"', page)
    if not m:
        return None
    try:
        return (enrich._dv(json.loads(html.unescape(m.group(1)))).get("search-data") or {}).get("agents")
    except Exception:  # noqa
        return None


def visitor_404(urls):
    """{url: True/False/None}: does a visitor's browser end up on the website's 404 page? (Sam, 13 Oct 2026: the
    agent-sold pages load fine without a browser but the site's own script sends visitors to /404/.) Run only for
    the sailings the first pass found on sale but missing from the feed, not every page. None = couldn't tell."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("browser check skipped: Playwright isn't installed")
        return {}
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        for u in urls:
            try:
                pg.goto(u, wait_until="networkidle", timeout=45000)
                # the redirect happens after the page loads, sometimes a few seconds later: wait up to 8 s for it
                for _ in range(16):
                    if "/404" in pg.url.split("ambassadorcruiseline.com", 1)[-1]:
                        break
                    pg.wait_for_timeout(500)
                out[u] = "/404" in pg.url.split("ambassadorcruiseline.com", 1)[-1]
            except Exception as e:  # noqa
                print(f"browser check: {u}: {str(e)[:100]}")
                out[u] = None
        b.close()
    return out


def check(code, url, today):
    try:
        page = enrich.get(url + "/")
    except Exception as e:  # noqa
        # A sitemap page that doesn't exist is listed as a 404 (Sam, 13 Oct 2026)
        if getattr(e, "code", None) == 404:
            return {"id": code, "url": url + "/", "status": "not_found"}
        return {"id": code, "url": url, "status": "error", "error": str(e)[:100]}
    if re.search(r'<link rel="canonical" href="[^"]*/404/?"', page):
        return {"id": code, "url": url + "/", "status": "not_found"}
    f = enrich.page_fields(url + "/")
    tw = (f.get("cabins") or {}).get("twin") or {}
    solo = (f.get("cabins") or {}).get("solo") or {}
    dep = f.get("departure_date")
    if "page_error" in f:
        status = "error"
    elif dep and dep < today:
        status = "departed"
    elif tw or solo:
        status = "on_sale"
    elif "cabins" in f:
        status = "sold_out"
    else:
        status = "no_prices"
    out = {"id": code, "url": url + "/", "status": status}
    if status == "on_sale":
        ag = agents(page)
        out.update({"title": page_title(page), "departure_date": dep,
                    "charter": bool(ag) and "DIRECT" not in ag,
                    "from_pp": min(tw.values()) if tw else None, "solo_only": not tw,
                    "offers": [o["name"] for o in (f.get("offers") or [])]})
    return out


def fr_status(url, today):
    """A French sitemap page that isn't on the cruise list and isn't in state: not_found / departed / sold_out / error."""
    import fr_enrich
    try:
        page = fr_enrich.get(url, tries=2)
    except Exception as e:  # noqa
        return "not_found" if getattr(e, "code", None) == 404 else "error"
    c = fr_enrich.cruise_object(fr_enrich.flight(page), "")
    if not c:
        return "not_found" if re.search(r"(?i)<title>[^<]*404", page) else "error"
    if (c.get("departure_date") or "9") < today:
        return "departed"
    try:
        cab, _ = fr_enrich.cabins(c["cruise_code"], c.get("departure_date"))
    except Exception:  # noqa
        return "error"
    return "on_sale" if cab.get("twin") or cab.get("solo") else "sold_out"


def main_fr(today, at):
    import fr_enrich
    out_dir = ROOT / "out" / "fr"
    out_dir.mkdir(parents=True, exist_ok=True)
    page = fr_enrich.get(fr_enrich.LIST)
    m = re.search(r'\\?"totalCount\\?":(\d+)', page)
    total = int(m.group(1)) if m else None
    listed = {m.group(2).upper(): fr_enrich.SITE + "/croisieres/" + m.group(1) for m in fr_enrich.CODE.finditer(html.unescape(page))}
    mapped = {m.group(2).upper(): fr_enrich.SITE + "/croisieres/" + m.group(1) for m in fr_enrich.CODE.finditer(fr_enrich.get(fr_enrich.SITEMAP))}
    if not listed or (total and len(listed) < total * 0.7):
        msg = f"# France coverage check {today}: NOT saved\n\nThe cruise list gave {len(listed)} sailings (it says {total}), which looks wrong, so nothing was written.\n"
        (out_dir / "coverage.md").write_text(msg)
        print(msg)
        return 2
    state = json.loads((ROOT / "state" / "fr" / "current.json").read_text())
    live = {k: r for k, r in state["sailings"].items() if not r.get("removed")}
    path = ROOT / "state" / "fr" / "coverage.json"
    prev = json.loads(path.read_text()) if path.exists() else {}
    first_seen = {s["id"]: s.get("first_seen") for k in ("not_in_sitemap", "not_in_list", "not_found") for s in prev.get(k) or []}

    def row(code, url):
        r = live.get(code) or {}
        seg = (r.get("segments") or [{}])[-1]
        return {"id": code, "url": r.get("link") or url, "title": r.get("title"), "departure_date": r.get("departure_date"),
                "from_pp": seg.get("p"), "on_sale": code in live, "first_seen": first_seen.get(code) or today}
    key = lambda s: (s.get("departure_date") or "9", s["id"])
    not_in_sitemap = sorted((row(c, u) for c, u in listed.items() if c not in mapped), key=key)
    only_map = {c: u for c, u in mapped.items() if c not in listed}
    not_in_list = sorted((row(c, u) for c, u in only_map.items() if c in live), key=key)
    counts = {"on_sale": len(not_in_list)}
    not_found = []
    for c, u in sorted(only_map.items()):
        if c in live:
            continue
        st = fr_status(u, today)
        counts[st] = counts.get(st, 0) + 1
        if st == "not_found":
            not_found.append({"id": c, "url": u, "first_seen": first_seen.get(c) or today})
        elif st == "on_sale":   # on sale but not in state yet (the hourly check will pick it up)
            not_in_list.append({"id": c, "url": u, "on_sale": True, "first_seen": first_seen.get(c) or today})
    doc = {"market": "fr", "checked": today, "checked_at": at, "list_total": total, "listed": len(listed),
           "sitemap": len(mapped), "on_sale": len(live), "counts": counts, "not_in_sitemap": not_in_sitemap,
           "not_in_list": not_in_list, "not_found": not_found}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))

    before = {s["id"] for k in ("not_in_sitemap", "not_in_list") for s in prev.get(k) or []}
    new = [s for s in not_in_sitemap + not_in_list if s["id"] not in before]
    lines = [f"# France coverage check {today}", "",
             f"The cruise list on ambassadorcroisieres.fr shows {len(listed)} sailings (it says {total}); the sitemap has "
             f"{len(mapped)} cruise pages. {len(not_in_sitemap)} on the list {'are' if len(not_in_sitemap) != 1 else 'is'} missing "
             f"from the sitemap (search engines may not find {'them' if len(not_in_sitemap) != 1 else 'it'}), and "
             f"{len(not_in_list)} on sale with a sitemap page {'are' if len(not_in_list) != 1 else 'is'} missing from the list."
             + (f" {len(not_found)} sitemap page{'s' if len(not_found) != 1 else ''} return{'' if len(not_found) != 1 else 's'} 404." if not_found else ""), ""]
    if new:
        lines += ["## New since the last check"]
        for s in new:
            where = "not in the sitemap" if s in not_in_sitemap else "not on the cruise list"
            price = f", from {money(s['from_pp'])}/pers." if s.get("from_pp") else ""
            lines.append(f"- **{s.get('title') or s['id']}** ({s['id']}), departs {s.get('departure_date') or '?'}{price}: {where}. {s['url']}")
        lines.append("")
    text = "\n".join(lines)
    (out_dir / "coverage.md").write_text(text)
    print(text)
    gh_output(new_missing="true" if new else "false", date=today)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--market", choices=["uk", "fr"], default="uk")
    a = ap.parse_args()
    today = a.date or london_today()
    at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if a.market == "fr":
        import daily
        daily.MARKET = "fr"   # money() in euros
        return main_fr(today, at)
    out_dir = ROOT / "out"
    out_dir.mkdir(exist_ok=True)

    feed = list(csv.DictReader(io.StringIO(enrich.get(enrich.FEED))))
    feed_ids = {r["id"].upper() for r in feed}
    pages = sitemap_pages()
    if not feed or len(pages) < len(feed_ids) * 0.8:
        msg = f"# Feed coverage check {today}: NOT saved\n\nThe sitemap listed {len(pages)} sailing pages against {len(feed_ids)} in the feed, which looks wrong, so nothing was written.\n"
        (out_dir / "coverage.md").write_text(msg)
        print(msg)
        return 2

    missing = {c: u for c, u in pages.items() if c not in feed_ids}
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda kv: check(kv[0], kv[1], today), sorted(missing.items())))

    path = ROOT / "state" / "coverage.json"
    prev = json.loads(path.read_text()) if path.exists() else {}
    first_seen = {s["id"]: s.get("first_seen") for s in (prev.get("on_sale_missing") or []) + (prev.get("not_found") or [])}
    on_sale = []
    for r in res:
        if r["status"] == "on_sale":
            on_sale.append({**{k: v for k, v in r.items() if k != "status"}, "first_seen": first_seen.get(r["id"]) or today})
    seen404 = visitor_404([s["url"] for s in on_sale])
    for s in on_sale:
        if seen404.get(s["url"]) is not None:
            s["visitor_404"] = seen404[s["url"]]
    on_sale.sort(key=lambda s: (s.get("departure_date") or "9", s["id"]))
    not_found = sorted(({"id": r["id"], "url": r["url"], "first_seen": first_seen.get(r["id"]) or today}
                        for r in res if r["status"] == "not_found"), key=lambda s: s["id"])
    counts = {}
    for r in res:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    doc = {"checked": today, "checked_at": at, "site_pages": len(pages), "feed": len(feed_ids),
           "feed_not_on_site": sorted(feed_ids - set(pages)), "counts": counts, "on_sale_missing": on_sale,
           "not_found": not_found}
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))

    # Semi-charters aren't meant to be in the feed, so they're never reported as newly missing
    # and nor are pages that send visitors to the 404 page
    was_missing = {s["id"] for s in prev.get("on_sale_missing") or []}   # not 404s: a page coming back on sale is new
    new = [s for s in on_sale if s["id"] not in was_missing and not s.get("charter") and not s.get("visitor_404")]
    charters = sum(1 for s in on_sale if s.get("charter"))
    hidden = sum(1 for s in on_sale if s.get("visitor_404"))
    lines = [f"# Feed coverage check {today}",
             "",
             f"The website lists {len(pages)} sailing pages; the ad feed has {len(feed_ids)}. "
             f"{len(on_sale)} sailing{'s are' if len(on_sale) != 1 else ' is'} on sale on the website but not in the feed"
             + (f", {len(new)} of them new since the last check." if prev else ".")
             + (f" {charters} of them {'are' if charters != 1 else 'is'} sold through an agent, not direct (not meant to be in the feed)." if charters else "")
             + (f" In a browser, {hidden} of them send{'s' if hidden == 1 else ''} visitors to the 404 page." if hidden else "")
             + (f" {len(not_found)} sitemap page{'s' if len(not_found) != 1 else ''} return{'' if len(not_found) != 1 else 's'} 404." if not_found else ""), ""]
    if new:
        lines += ["## Newly missing from the feed"]
        for s in new:
            price = (money(s["from_pp"]) + "pp") if s.get("from_pp") else "solo prices only"
            lines.append(f"- **{s.get('title') or s['id']}** ({s['id']}), departs {s.get('departure_date') or '?'}, from {price}: {s['url']}")
        lines.append("")
    if doc["feed_not_on_site"]:
        lines += [f"In the feed but not in the website's sitemap: {', '.join(doc['feed_not_on_site'])}", ""]
    text = "\n".join(lines)
    (out_dir / "coverage.md").write_text(text)
    print(text)
    gh_output(new_missing="true" if new else "false", date=today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
