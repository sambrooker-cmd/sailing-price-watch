"""The website's own pages, for the page creator's duplicate check (Sam, 16 Oct 2026: point 5 of the SEO queue).

Once a UK day (hourly workflow step "Website pages for the duplicate check", `continue-on-error`): every page in
ambassadorcruiseline.com's sitemap except the sailing pages (/cruise/…: their titles are the sailings' names) is
listed, and its title, meta description and H1 are read: new pages straight away, others again after REREAD_DAYS, at
most PER_RUN pages a day, one at a time with a short pause. Pages that drop out of the sitemap are dropped. Read-only.

→ state/seo/pages.json {read_on, sitemap_pages, pages: {"/path/": {t: title, d: description, h: H1, r: read on, s: status,
   hn: number of H1s, j: [structured data types], c: canonical address when it isn't the page's own, n: 1 if noindex}}}
  (hn/j/c/n since 17 Oct 2026, for the tracker's SEO → Site health page)
→ publish.py pricewatch/seo-pages. The page creator (site/pagemaker.js) warns when a new page's address, SEO title
or H1 matches or nearly matches one of these, and lists the pages that already aim at the same keyword.

    python seo_pages.py [--force] [--all]
"""
import argparse, datetime as dt, html, json, re, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from coverage import SITE, sitemap_urls  # noqa: E402
from daily import london_today  # noqa: E402
from enrich import UA  # noqa: E402

OUT = ROOT / "state" / "seo" / "pages.json"
REREAD_DAYS = 7
PER_RUN = 150
PAUSE = 0.5


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def schema_types(page):
    """@type of every JSON-LD block (nested @graph included)"""
    out = []
    def walk(x):
        if isinstance(x, list):
            for y in x:
                walk(y)
        elif isinstance(x, dict):
            t = x.get("@type")
            for v in (t if isinstance(t, list) else [t] if t else []):
                if isinstance(v, str) and v not in out:
                    out.append(v)
            walk(x.get("@graph"))
    for m in re.finditer(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S):
        try:
            walk(json.loads(m.group(1)))
        except ValueError:
            out.append("(unreadable)")
    return out


def extras(page, url):
    """H1 count, structured data types, a canonical pointing elsewhere, noindex"""
    out = {"hn": len(re.findall(r"<h1[\s>]", page))}
    j = schema_types(page)
    if j:
        out["j"] = j
    c = re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]*)"', page) or re.search(r'<link[^>]+href="([^"]*)"[^>]+rel="canonical"', page)
    if c and c.group(1).rstrip("/") != url.rstrip("/"):
        out["c"] = html.unescape(c.group(1))
    if re.search(r'<meta[^>]+name="robots"[^>]+content="[^"]*noindex', page, re.I):
        out["n"] = 1
    return out


def read_page(url):
    """(status, title, description, H1, extras) of one page."""
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            page = r.read().decode("utf-8", "replace")
            final = r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, "", "", "", {}
    if final.rstrip("/").endswith("/404"):
        return 404, "", "", "", {}
    t = re.search(r"<title[^>]*>(.*?)</title>", page, re.S)
    d = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', page) or \
        re.search(r'<meta[^>]+content="([^"]*)"[^>]+name="description"', page)
    h = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    return 200, text(t.group(1)) if t else "", html.unescape(d.group(1)).strip() if d else "", text(h.group(1)) if h else "", extras(page, final)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="run again even if today's read is done")
    ap.add_argument("--all", action="store_true", help="read every page now (no PER_RUN limit)")
    a = ap.parse_args()
    today = london_today()
    st = json.loads(OUT.read_text()) if OUT.exists() else {}
    if st.get("read_on") == today and not a.force:
        print("Website pages: already read today")
        return 0
    urls = sorted(u for u in sitemap_urls() if u.startswith(SITE) and "/cruise/" not in u)
    if len(urls) < 50:   # a sitemap that didn't load properly: keep what we have
        print(f"Website pages: the sitemap gave only {len(urls)} pages; nothing changed")
        return 0
    paths = {"/" + u[len(SITE):].strip("/") + ("/" if u[len(SITE):].strip("/") else ""): u for u in urls}
    pages = {p: v for p, v in (st.get("pages") or {}).items() if p in paths}   # dropped from the sitemap: dropped here
    stale = (dt.date.fromisoformat(today) - dt.timedelta(days=REREAD_DAYS)).isoformat()
    old = sorted((p for p in paths if p in pages and pages[p].get("r", "") <= stale), key=lambda p: pages[p].get("r", ""))
    missing = sorted(p for p in paths if p in pages and "hn" not in pages[p])   # read before 17 Oct 2026's extras
    todo = list(dict.fromkeys([p for p in paths if p not in pages] + old + missing + (sorted(paths) if a.all else [])))
    done = 0
    for p in todo[:None if a.all else PER_RUN]:
        try:
            s, t, d, h, x = read_page(paths[p])
            pages[p] = {"t": t, "d": d, "h": h, "r": today, "s": s, **x}
        except Exception as e:  # noqa: BLE001 - one page failing doesn't stop the rest
            print(f"  {p}: {e}")
        done += 1
        time.sleep(PAUSE)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"read_on": today, "sitemap_pages": len(paths), "pages": dict(sorted(pages.items()))},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"Website pages: {len(paths)} in the sitemap (not sailings), {done} read today, {len(todo) - done} still to read")
    return 0


if __name__ == "__main__":
    sys.exit(main())
