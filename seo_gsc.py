"""Keyword ideas from Google Search Console (Sam, 16 Oct 2026: point 4 of the SEO queue, "Google Search Console" chosen
over Semrush): the searches people already find ambassadorcruiseline.com with, for the page creator's keyword ideas.

Once a UK day (hourly workflow step "Search Console queries", `continue-on-error`): Search Console's Search Analytics API
for the last DAYS days (ending 2 days ago: its data lags), dimensions query + page, read with the tracker's Firebase
service account (FIREBASE_SERVICE_ACCOUNT, scope webmasters.readonly). The account must be added as a (Restricted) user
on the site's Search Console property and the Search Console API switched on in promotions-planner: until then this
records why in `problem` and the page says the connection isn't set up. Read-only: it can't change anything in Search
Console or on the site.

→ state/seo/gsc.json {read_on, fetched_at, site, start, end, days, problem, pages: [url…],
                      queries: [[query, clicks, impressions, position, [page index…]]…] (most impressions first, MAX_QUERIES)}
→ publish.py pricewatch/seo-gsc.

    python seo_gsc.py [--force]
"""
import argparse, datetime as dt, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from daily import london_today  # noqa: E402

OUT = ROOT / "state" / "seo" / "gsc.json"
API = "https://searchconsole.googleapis.com/webmasters/v3"
HOST = "ambassadorcruiseline.com"
DAYS = 90             # long enough for seasonal and long-tail searches
MAX_QUERIES = 8000    # most impressions first; about 500 KB published
ROW_LIMIT = 25000     # the API's most per request


def session():
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not info:
        raise RuntimeError("FIREBASE_SERVICE_ACCOUNT is not set")
    creds = service_account.Credentials.from_service_account_info(
        json.loads(info), scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    return AuthorizedSession(creds), creds.service_account_email


def pick_site(http):
    """The site's property this account can read: a Domain property first, else the www URL-prefix one."""
    r = http.get(f"{API}/sites", timeout=60)
    if r.status_code == 403 and ("has not been used" in r.text or "SERVICE_DISABLED" in r.text):
        raise RuntimeError("The Search Console API isn't switched on in the promotions-planner Google Cloud project yet "
                           "(APIs & Services → Library → Google Search Console API → Enable).")
    r.raise_for_status()
    sites = [s["siteUrl"] for s in r.json().get("siteEntry", []) if s.get("permissionLevel") != "siteUnverifiedUser"]
    ours = [s for s in sites if HOST in s]
    if not ours:
        return None
    return sorted(ours, key=lambda s: (not s.startswith("sc-domain:"), "www." not in s))[0]


def read(http, site, start, end):
    from urllib.parse import quote
    rows, offset = [], 0
    while True:
        body = {"startDate": start, "endDate": end, "dimensions": ["query", "page"], "rowLimit": ROW_LIMIT,
                "startRow": offset, "dataState": "final", "type": "web"}
        r = http.post(f"{API}/sites/{quote(site, safe='')}/searchAnalytics/query", json=body, timeout=120)
        r.raise_for_status()
        got = r.json().get("rows", [])
        rows += got
        if len(got) < ROW_LIMIT or offset > 200_000:
            return rows
        offset += ROW_LIMIT


def fold(rows):
    """query + page rows → one row per query (clicks and impressions added up, position weighted by impressions),
    with the pages it shows, best first."""
    pages, idx, by = [], {}, {}
    for r in rows:
        q, page = r["keys"]
        if page not in idx:
            idx[page] = len(pages)
            pages.append(page)
        x = by.setdefault(q, {"c": 0, "i": 0, "p": 0.0, "pages": {}})
        x["c"] += r.get("clicks", 0)
        x["i"] += r.get("impressions", 0)
        x["p"] += r.get("position", 0) * r.get("impressions", 0)
        x["pages"][idx[page]] = x["pages"].get(idx[page], 0) + r.get("impressions", 0)
    out = sorted(by.items(), key=lambda kv: (-kv[1]["i"], -kv[1]["c"]))[:MAX_QUERIES]
    used = {}
    queries = []
    for q, x in out:
        top = [p for p, _ in sorted(x["pages"].items(), key=lambda kv: -kv[1])[:3]]
        queries.append([q, int(x["c"]), int(x["i"]), round(x["p"] / x["i"], 1) if x["i"] else None,
                        [used.setdefault(p, len(used)) for p in top]])
    kept = [None] * len(used)
    for p, n in used.items():
        kept[n] = pages[p]
    return kept, queries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="read again even if today's read is done")
    a = ap.parse_args()
    today = london_today()
    st = json.loads(OUT.read_text()) if OUT.exists() else {}
    if st.get("read_on") == today and not a.force:
        print("Search Console: already read today")
        return 0
    if not os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        print("Search Console: no FIREBASE_SERVICE_ACCOUNT here; skipped")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    end = (dt.date.fromisoformat(today) - dt.timedelta(days=2)).isoformat()
    start = (dt.date.fromisoformat(end) - dt.timedelta(days=DAYS - 1)).isoformat()
    try:
        http, who = session()
        site = pick_site(http)
        if not site:
            raise RuntimeError(f"The tracker's service account ({who}) can't see the ambassadorcruiseline.com property in "
                               "Search Console yet. In Search Console: Settings → Users and permissions → Add user → that "
                               "address, Restricted permission.")
        pages, queries = fold(read(http, site, start, end))
        st = {"read_on": today, "fetched_at": now, "site": site, "start": start, "end": end, "days": DAYS, "problem": "",
              "pages": pages, "queries": queries}
        print(f"Search Console {site}: {len(queries)} queries on {len(pages)} pages, {start} to {end}")
    except Exception as e:  # noqa: BLE001 - recorded for the page; never stops the price check
        msg = str(e)
        if "403" in msg and "insufficient" in msg.lower():
            msg = "The tracker's service account doesn't have access to the site's Search Console property yet."
        st.update(read_on=today, fetched_at=now, problem=msg[:400])
        print("Search Console:", msg[:400])
    OUT.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
