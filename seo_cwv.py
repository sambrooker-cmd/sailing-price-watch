"""Core Web Vitals for ambassadorcruiseline.com and the competitors (Sam, 17 Oct 2026: "a core web vitals checker and
competitor analysis tool"; content coverage left out).

Once a day (own workflow .github/workflows/cwv.yml, started by the hourly price watch's first check of a UK day, like
the competitor check), with Google's free APIs and the repo secret PAGESPEED_API_KEY (one key for both):
  - **Our pages** (PAGES plus a sailing page per ship and the three blog posts with most Search Console clicks): PageSpeed Insights for phone
    and desktop: the lab test (performance score, LCP, TBT, CLS, FCP, and the top fixes with the time they'd save)
    and the page's real-visitor figures if Google has enough visits (else the whole site's).
  - **Real-visitor figures from the Chrome UX Report** (the data Google ranks with: 75th percentile LCP, INP, CLS,
    plus TTFB), phone and desktop, for our site and every competitor's (COMPETITORS), with ~6 months of weekly history
    (CrUX History API). This is Google's own public dataset: nothing is read from the competitors' websites.
  - **Lab scores over time** for our pages (`lab_history`, kept LAB_DAYS days).
  - **An alert** when one of our site's phone metrics drops out of "good" (or into "poor") since the last read:
    out/cwv_alert.md → the workflow opens a "Core Web Vitals got worse" issue.
Thresholds are Google's: LCP good ≤ 2.5 s / poor > 4 s; INP ≤ 200 / > 500 ms; CLS ≤ 0.1 / > 0.25; TTFB ≤ 800 / > 1800 ms.

→ state/seo/cwv.json → publish.py pricewatch/seo-cwv → tracker page SEO → Core Web Vitals (site/cwv.js).
Read-only: nothing on either site is changed. Without the key it records why and stops (exit 0).

    python seo_cwv.py [--force] [--no-lab]
"""
import argparse, concurrent.futures as cf, datetime as dt, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from daily import london_today  # noqa: E402

OUT = ROOT / "state" / "seo" / "cwv.json"
ALERT = ROOT / "out" / "cwv_alert.md"
SITE = "https://www.ambassadorcruiseline.com"
PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
CRUX = "https://chromeuxreport.googleapis.com/v1/records:queryRecord"
CRUX_HIST = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord"
LAB_DAYS = 180
WORKERS = 4

# Our pages by type (one or two of each template; sailings and blog posts are added from state)
PAGES = [
    ("/", "Home"), ("/no-fly-cruises/", "Landing"), ("/cruise-types/festive-markets/", "Landing"),
    ("/cruise-types/caribbean-no-fly-cruises/", "Landing"), ("/destinations/fjordland-cruises/", "Destination"),
    ("/deals/cruise-offers/", "Deals"), ("/deals/cruises-of-the-week/", "Deals"), ("/cruise-search/", "Search"),
    ("/our-ships/", "Ships"), ("/blog/", "Blog index"),
]
# Competitors' sites (origins) for the Chrome UX Report. Marella has no site of its own (tui.co.uk, all of TUI).
COMPETITORS = [
    ("Ambassador", SITE), ("P&O Cruises", "https://www.pocruises.com"), ("Princess", "https://www.princess.com"),
    ("Cunard", "https://www.cunard.com"), ("Marella (TUI)", "https://www.tui.co.uk"), ("Saga", "https://www.saga.co.uk"),
    ("Fred. Olsen", "https://www.fredolsencruises.com"), ("MSC", "https://www.msccruises.co.uk"),
    ("Royal Caribbean", "https://www.royalcaribbean.com"), ("Celebrity", "https://www.celebritycruises.com"),
    ("Planet Cruise", "https://www.planetcruise.co.uk"),
]
METRICS = ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift", "experimental_time_to_first_byte"]
SHORT = {"largest_contentful_paint": "lcp", "interaction_to_next_paint": "inp", "cumulative_layout_shift": "cls",
         "experimental_time_to_first_byte": "ttfb"}
GOOD = {"lcp": (2500, 4000), "inp": (200, 500), "cls": (0.1, 0.25), "ttfb": (800, 1800)}


def rating(metric, v):
    if v is None:
        return None
    good, poor = GOOD[metric]
    return "good" if v <= good else "poor" if v > poor else "ni"


def call(url, body=None, tries=3):
    for i in range(tries):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"} if body is not None else {})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:400]
            if e.code == 404:   # CrUX: not enough visits for Google to report
                return None
            if e.code in (429, 500, 502, 503) and i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise RuntimeError(f"{e.code}: {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            if i < tries - 1:
                time.sleep(5)
                continue
            raise RuntimeError(str(e))


# ---------- Chrome UX Report (real visitors) ----------
def crux_now(key, origin=None, url=None, form="PHONE"):
    body = {"formFactor": form, "metrics": METRICS, **({"origin": origin} if origin else {"url": url})}
    d = call(f"{CRUX}?key={key}", body)
    if not d:
        return None
    out = {}
    for m, v in (d.get("record", {}).get("metrics") or {}).items():
        if m in SHORT:
            p = (v.get("percentiles") or {}).get("p75")
            out[SHORT[m]] = float(p) if p is not None else None
    return out or None


def crux_history(key, origin, form="PHONE"):
    d = call(f"{CRUX_HIST}?key={key}", {"origin": origin, "formFactor": form, "metrics": METRICS})
    if not d:
        return None
    rec = d.get("record", {})
    weeks = [dt.date(p["lastDate"]["year"], p["lastDate"]["month"], p["lastDate"]["day"]).isoformat()
             for p in rec.get("collectionPeriods", [])]
    out = {"weeks": weeks}
    for m, v in (rec.get("metrics") or {}).items():
        if m in SHORT:
            ps = ((v.get("percentilesTimeseries") or {}).get("p75s")) or []
            out[SHORT[m]] = [float(x) if x is not None else None for x in ps]
    return out


# ---------- PageSpeed Insights (lab test of our pages) ----------
def psi(key, url, strategy):
    q = urllib.parse.urlencode({"url": url, "strategy": strategy, "category": "performance", "key": key})
    d = call(f"{PSI}?{q}")
    lh = d.get("lighthouseResult") or {}
    au = lh.get("audits") or {}
    num = lambda a: (au.get(a) or {}).get("numericValue")   # noqa: E731
    opps = []
    for a in au.values():
        det = a.get("details") or {}
        save = det.get("overallSavingsMs")
        if det.get("type") == "opportunity" and save and save >= 100:
            opps.append({"t": a.get("title"), "ms": round(save)})
    opps.sort(key=lambda o: -o["ms"])
    # The page's own real-visitor figures when Google has enough visits to it, else the whole site's
    field, src = {}, ""
    le, ole = d.get("loadingExperience") or {}, d.get("originLoadingExperience") or {}
    for exp, s_ in ((le, "page") if not le.get("origin_fallback") else ({}, ""), (ole, "site")):
        f = {}
        for name, short, scale in (("LARGEST_CONTENTFUL_PAINT_MS", "lcp", 1), ("INTERACTION_TO_NEXT_PAINT", "inp", 1),
                                   ("CUMULATIVE_LAYOUT_SHIFT_SCORE", "cls", 100), ("EXPERIMENTAL_TIME_TO_FIRST_BYTE", "ttfb", 1)):
            m = (exp.get("metrics") or {}).get(name) or {}
            if m.get("percentile") is not None:
                f[short] = m["percentile"] / scale
        if f:
            field, src = f, s_
            break
    score = ((lh.get("categories") or {}).get("performance") or {}).get("score")
    return {"score": round(score * 100) if score is not None else None,
            "lcp": num("largest-contentful-paint"), "tbt": num("total-blocking-time"), "cls": num("cumulative-layout-shift"),
            "fcp": num("first-contentful-paint"), "si": num("speed-index"), "opps": opps[:5],
            "field": field, "field_src": src}


def our_pages():
    """PAGES plus one sailing page per ship (on sale, departing soonest) and three blog posts (most clicks in Search Console)."""
    pages = [(SITE + p, t, p) for p, t in PAGES]
    try:
        st = json.loads((ROOT / "state" / "current.json").read_text())["sailings"]
        today = london_today()
        by_ship = {}
        for code, s in sorted(st.items(), key=lambda kv: kv[1].get("departure_date", "")):
            if not s.get("removed") and s.get("departure_date", "") > today and s.get("link") and s.get("ship") not in by_ship:
                by_ship[s["ship"]] = (s["link"], "Sailing", f"{s.get('base_title') or s.get('title')} ({code}, {s['ship']})")
        pages += list(by_ship.values())
    except (OSError, KeyError, ValueError):
        pass
    try:
        site = json.loads((ROOT / "state" / "seo" / "pages.json").read_text())["pages"]
        blogs = [p for p in site if p.startswith("/blog/") and p != "/blog/" and site[p].get("s") == 200]
        clicks = {}
        try:   # the blog posts people actually find (Search Console clicks, when it's connected)
            g = json.loads((ROOT / "state" / "seo" / "gsc.json").read_text())
            for _q, c, _i, _pos, idx in g.get("queries") or []:
                for i in idx[:1]:
                    path = "/" + g["pages"][i].split("://", 1)[-1].split("/", 1)[-1]
                    clicks[path] = clicks.get(path, 0) + c
        except (OSError, KeyError, ValueError, IndexError):
            pass
        blogs.sort(key=lambda p: -clicks.get(p, 0))
        for p in blogs[:3]:
            pages.append((SITE + p, "Blog post", site[p].get("h") or p))
    except (OSError, KeyError, ValueError):
        pass
    return pages


def alert_text(prev, cur):
    """Our site's phone metrics that dropped a rating since the last read."""
    order = {"good": 0, "ni": 1, "poor": 2}
    lines = []
    for m in ("lcp", "inp", "cls"):
        a, b = rating(m, (prev or {}).get(m)), rating(m, (cur or {}).get(m))
        if a and b and order[b] > order[a]:
            fmt = (lambda v: f"{v / 1000:.1f} s") if m == "lcp" else (lambda v: f"{v:.2f}") if m == "cls" else (lambda v: f"{v:.0f} ms")
            lines.append(f"- **{m.upper()}** went from {a.replace('ni', 'needs improvement')} ({fmt(prev[m])}) to "
                         f"**{b.replace('ni', 'needs improvement')}** ({fmt(cur[m])}), 75th percentile of real phone visits.")
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-lab", action="store_true", help="real-visitor figures only (quick)")
    a = ap.parse_args()
    today = london_today()
    st = json.loads(OUT.read_text()) if OUT.exists() else {}
    if st.get("read_on") == today and not a.force:
        print("Core Web Vitals: already read today")
        return 0
    key = (os.environ.get("PAGESPEED_API_KEY") or "").strip()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not key:
        st.update(problem="The PageSpeed/Chrome UX Report API key isn't set up yet (repo secret PAGESPEED_API_KEY).")
        OUT.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))
        print("Core Web Vitals:", st["problem"])
        return 0
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    problems = []

    # Real visitors: every site, phone and desktop, now and the last ~6 months
    sites = []
    for name, origin in COMPETITORS:
        row = {"name": name, "origin": origin}
        for form, k in (("PHONE", "phone"), ("DESKTOP", "desktop")):
            try:
                row[k] = crux_now(key, origin=origin, form=form)
                row[k + "_hist"] = crux_history(key, origin, form)
            except RuntimeError as e:
                problems.append(f"{name} {k}: {e}")
                if "API key" in str(e) or "403" in str(e)[:4]:
                    raise SystemExit(f"Core Web Vitals: the API key was refused: {e}")
        sites.append(row)
        print(f"  {name}: phone {row.get('phone')}")

    # Our pages: the lab test (and the page's own real-visitor figures)
    pages = []
    if not a.no_lab:
        jobs = our_pages()
        def one(job):
            url, kind, label = job
            out = {"url": url, "type": kind, "label": label}
            for strat in ("mobile", "desktop"):
                try:
                    out[strat] = psi(key, url, strat)
                except RuntimeError as e:
                    out[strat] = {"error": str(e)[:200]}
            return out
        with cf.ThreadPoolExecutor(WORKERS) as ex:
            pages = list(ex.map(one, jobs))
        for p in pages:
            print(f"  {p['type']}: {p['label']}  mobile {p['mobile'].get('score')}  desktop {p['desktop'].get('score')}")
    else:
        pages = st.get("pages") or []

    # Lab score history (per page, phone and desktop), LAB_DAYS kept
    hist = st.get("lab_history") or {}
    if not a.no_lab:
        hist[today] = {p["url"]: [p["mobile"].get("score"), p["desktop"].get("score")] for p in pages}
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=LAB_DAYS)).isoformat()
    hist = {d: v for d, v in sorted(hist.items()) if d >= cutoff}

    ours_prev = next((s.get("phone") for s in st.get("sites") or [] if s.get("origin") == SITE), None)
    ours_now = next((s.get("phone") for s in sites if s.get("origin") == SITE), None)
    lines = alert_text(ours_prev, ours_now)
    if lines:
        ALERT.parent.mkdir(exist_ok=True)
        ALERT.write_text("Real visitors' Core Web Vitals on ambassadorcruiseline.com (Google's Chrome UX Report, phones, "
                         "28 days to yesterday) have got worse since the last read:\n\n" + "\n".join(lines) +
                         "\n\nGoogle uses these figures in its rankings. See the tracker page: SEO → Core Web Vitals, for "
                         "which pages are slowest and what would help.\n")
        print("\n".join(lines))
    st = {"read_on": today, "fetched_at": now, "problem": "; ".join(problems)[:600], "thresholds": GOOD,
          "sites": sites, "pages": pages, "lab_history": hist}
    OUT.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))
    print(f"Core Web Vitals: {len(sites)} sites, {len(pages)} pages" + (f"; problems: {st['problem']}" if problems else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
