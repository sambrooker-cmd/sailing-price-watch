"""Search demand from Google Keyword Planner (Sam, 17 Oct 2026: "a search demand viewer, with key search terms pre loaded
up but with the ability to add more and group them accordingly. Ideally from a tool like google keyword planner").

Once a UK day (hourly workflow step "Search demand (Keyword Planner)", `continue-on-error`): every term in the starting
list (search_terms.json) and in the team's saved lists (Firestore pricewatch_saved, kind "keywords", made on the tracker's
SEO → Search demand page) is looked up in Keyword Planner through the Google Ads API: UK, English, Google Search, monthly
searches for the last MONTHS months, average monthly searches, competition and the top-of-page bid range. Each group
also gets up to IDEAS_PER_GROUP related searches ("ideas") to add. **Read-only**: Keyword Planner's historical metrics
and ideas only; nothing in the Google Ads account (campaigns, bids, budgets, plans) is created or changed.

Needs (Sam, one-off; until then it records what's missing in `problem` and the page shows Search Console figures only):
  repo secrets GOOGLE_ADS_DEVELOPER_TOKEN (Google Ads → Tools → API Center, Basic access), GOOGLE_ADS_CLIENT_ID,
  GOOGLE_ADS_CLIENT_SECRET (an OAuth client, type Desktop, in promotions-planner), GOOGLE_ADS_REFRESH_TOKEN (from signing
  in once with a Google account that can see the Ads account, scope adwords) and GOOGLE_ADS_CUSTOMER_ID (the Ads account's
  10-digit ID); repo variable GOOGLE_ADS_LOGIN_CUSTOMER_ID only when access comes through a manager account, and
  GOOGLE_ADS_API_VERSION to move to a newer API version (default API_VERSION).

→ state/seo/search_demand.json {read_on, fetched_at, problem, source, months: ["YYYY-MM"…], default (the starting
   list), terms: {term: {avg, comp, ci, lo, hi, m: [searches per month, oldest first]}}, ideas: {group name: [[term, avg, comp]…]}}
→ publish.py pricewatch/seo-demand → tracker page SEO → Search demand (site/searchdemand.js).

    python search_demand.py [--force]
"""
import argparse, datetime as dt, json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from daily import london_today  # noqa: E402

OUT = ROOT / "state" / "seo" / "search_demand.json"
TERMS = ROOT / "search_terms.json"
PROJECT = "promotions-planner"
API_VERSION = "v25"
MONTHS = 24
IDEAS_PER_GROUP = 15
UK, ENGLISH = "geoTargetConstants/2826", "languageConstants/1000"
MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
MAX_TERMS = 5000


def norm(t):
    return re.sub(r"\s+", " ", str(t or "").strip().lower())[:80]


def saved_lists():
    """The team's lists from the tracker page (Firestore pricewatch_saved, kind keywords)."""
    info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not info:
        return []
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    creds = service_account.Credentials.from_service_account_info(json.loads(info), scopes=["https://www.googleapis.com/auth/datastore"])
    http = AuthorizedSession(creds)
    q = {"structuredQuery": {"from": [{"collectionId": "pricewatch_saved"}],
                             "where": {"fieldFilter": {"field": {"fieldPath": "kind"}, "op": "EQUAL", "value": {"stringValue": "keywords"}}}}}
    r = http.post(f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents:runQuery", json=q, timeout=60)
    r.raise_for_status()
    out = []
    for row in r.json():
        f = (row.get("document") or {}).get("fields") or {}
        try:
            out.append(json.loads(f.get("data", {}).get("stringValue") or "null") or {})
        except ValueError:
            pass
    return out


def ads_session():
    need = ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"]
    missing = [k for k in need if not (os.environ.get(k) or "").strip()]
    if missing:
        raise RuntimeError("Keyword Planner isn't connected yet: the repo secrets " + ", ".join(missing) + " are missing.")
    import requests
    tok = requests.post("https://oauth2.googleapis.com/token", data={
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"].strip(), "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"].strip(),
        "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"].strip(), "grant_type": "refresh_token"}, timeout=60)
    if not tok.ok:
        raise RuntimeError(f"Google refused the Keyword Planner sign-in ({tok.status_code}): the refresh token may have expired "
                           "or been revoked; make a new one and update GOOGLE_ADS_REFRESH_TOKEN.")
    h = {"Authorization": f"Bearer {tok.json()['access_token']}", "developer-token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"].strip(),
         "Content-Type": "application/json"}
    login = re.sub(r"\D", "", os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or "")
    if login:
        h["login-customer-id"] = login
    cid = re.sub(r"\D", "", os.environ["GOOGLE_ADS_CUSTOMER_ID"])
    ver = (os.environ.get("GOOGLE_ADS_API_VERSION") or API_VERSION).strip()
    base = f"https://googleads.googleapis.com/{ver}/customers/{cid}"
    s = requests.Session(); s.headers.update(h)

    def call(method, body):
        r = s.post(f"{base}:{method}", json=body, timeout=180)
        if r.status_code == 404 and "version" in r.text.lower():
            raise RuntimeError(f"Google Ads API {ver} isn't available any more: set the repo variable GOOGLE_ADS_API_VERSION to a current one.")
        if not r.ok:
            raise RuntimeError(f"Keyword Planner answered {r.status_code}: {r.text[:300]}")
        return r.json()
    return call


def ym(d):
    return {"year": d.year, "month": MONTH_NAMES[d.month - 1]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    today = london_today()
    st = json.loads(OUT.read_text()) if OUT.exists() else {}
    if st.get("read_on") == today and not a.force:
        print("Search demand: already read today")
        return 0
    default = json.loads(TERMS.read_text())
    default.pop("_about", None)
    lists, problems = [default], []
    try:
        lists += saved_lists()
    except Exception as e:  # noqa: BLE001
        problems.append(f"the team's saved lists couldn't be read ({str(e)[:120]})")
    groups = {}   # group name → its terms, across every list (ideas are per group name)
    for li in lists:
        for g in li.get("groups") or []:
            groups.setdefault(norm(g.get("name")), set()).update(norm(t) for t in g.get("terms") or [] if norm(t))
    terms = sorted({t for ts in groups.values() for t in ts})[:MAX_TERMS]
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    first = dt.date.fromisoformat(today).replace(day=1)
    end = (first - dt.timedelta(days=1)).replace(day=1)            # last complete month
    start = end
    for _ in range(MONTHS - 1):
        start = (start - dt.timedelta(days=1)).replace(day=1)
    months = []
    d = start
    while d <= end:
        months.append(d.strftime("%Y-%m")); d = (d + dt.timedelta(days=32)).replace(day=1)
    out = {"read_on": today, "fetched_at": now, "problem": "", "source": "", "months": months, "default": default,
           "terms": (st.get("terms") or {}), "ideas": (st.get("ideas") or {})}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    try:
        call = ads_session()
        got, want = {}, set(terms)
        for i in range(0, len(terms), 1000):
            j = call("generateKeywordHistoricalMetrics", {"keywords": terms[i:i + 1000], "geoTargetConstants": [UK], "language": ENGLISH,
                     "keywordPlanNetwork": "GOOGLE_SEARCH", "historicalMetricsOptions": {"yearMonthRange": {"start": ym(start), "end": ym(end)},
                                                                                        "includeAverageCpc": True}})
            for r in j.get("results", []):
                k = r.get("keywordMetrics") or {}
                by = {f"{v['year']}-{MONTH_NAMES.index(v['month']) + 1:02}": int(v.get("monthlySearches", 0) or 0) for v in k.get("monthlySearchVolumes", [])}
                rec = {"avg": int(k.get("avgMonthlySearches", 0) or 0), "comp": (k.get("competition") or "").lower(), "ci": k.get("competitionIndex"),
                       "lo": round(int(k.get("lowTopOfPageBidMicros", 0) or 0) / 1e6, 2), "hi": round(int(k.get("highTopOfPageBidMicros", 0) or 0) / 1e6, 2),
                       "m": [by.get(m) for m in months]}
                for t in [r.get("text")] + (r.get("closeVariants") or []):   # Google folds close variants into one answer
                    if norm(t) in want or norm(t) == norm(r.get("text")):
                        got[norm(t)] = rec
        ideas = {}
        for gname, ts in sorted(groups.items()):
            if not ts:
                continue
            j = call("generateKeywordIdeas", {"geoTargetConstants": [UK], "language": ENGLISH, "keywordPlanNetwork": "GOOGLE_SEARCH",
                                              "keywordSeed": {"keywords": sorted(ts)[:10]}, "pageSize": 100})
            have = set(terms)
            cands = [(norm(r.get("text")), int((r.get("keywordIdeaMetrics") or {}).get("avgMonthlySearches", 0) or 0),
                      ((r.get("keywordIdeaMetrics") or {}).get("competition") or "").lower()) for r in j.get("results", [])]
            ideas[gname] = [list(c) for c in sorted((c for c in cands if c[0] and c[0] not in have and c[1] >= 20), key=lambda c: -c[1])[:IDEAS_PER_GROUP]]
        out.update(terms=got, ideas=ideas, source="keyword-planner")
        print(f"Search demand: {len(got)} of {len(terms)} terms from Keyword Planner, {months[0]} to {months[-1]}; ideas for {len(ideas)} groups")
    except Exception as e:  # noqa: BLE001 - recorded for the page; never stops the price check
        problems.insert(0, str(e)[:400])
        print("Search demand:", str(e)[:400])
    out["problem"] = "; ".join(problems)
    out["wanted"] = terms
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
