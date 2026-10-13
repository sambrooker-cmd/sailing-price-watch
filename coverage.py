"""Weekly check: sailings on sale on the website but missing from the ad feed.

Reads the site's sitemap for every /cruise/ page, compares it with the feed,
and opens each page that isn't in the feed to see whether it's actually on
sale (prices shown, not departed). Writes state/coverage.json, keeping when
each missing sailing was first noticed, and out/coverage.md for the issue.

Usage: python coverage.py [--date YYYY-MM-DD]
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


def check(code, url, today):
    try:
        page = enrich.get(url + "/")
    except Exception as e:  # noqa
        return {"id": code, "url": url, "status": "error", "error": str(e)[:100]}
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
        out.update({"title": page_title(page), "departure_date": dep,
                    "from_pp": min(tw.values()) if tw else None, "solo_only": not tw,
                    "offers": [o["name"] for o in (f.get("offers") or [])]})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    a = ap.parse_args()
    today = a.date or london_today()
    at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
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
    first_seen = {s["id"]: s.get("first_seen") for s in prev.get("on_sale_missing") or []}
    on_sale = []
    for r in res:
        if r["status"] == "on_sale":
            on_sale.append({**{k: v for k, v in r.items() if k != "status"}, "first_seen": first_seen.get(r["id"]) or today})
    on_sale.sort(key=lambda s: (s.get("departure_date") or "9", s["id"]))
    counts = {}
    for r in res:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    doc = {"checked": today, "checked_at": at, "site_pages": len(pages), "feed": len(feed_ids),
           "feed_not_on_site": sorted(feed_ids - set(pages)), "counts": counts, "on_sale_missing": on_sale}
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1))

    new = [s for s in on_sale if s["id"] not in first_seen]
    lines = [f"# Feed coverage check {today}",
             "",
             f"The website lists {len(pages)} sailing pages; the ad feed has {len(feed_ids)}. "
             f"{len(on_sale)} sailing{'s are' if len(on_sale) != 1 else ' is'} on sale on the website but not in the feed"
             + (f", {len(new)} of them new since the last check." if prev else "."), ""]
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
