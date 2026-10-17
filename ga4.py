"""Sailing demand from Google Analytics 4 (Sam, 17 Oct 2026: "build the GA4 functionality and I will join them up
later"): how much interest each sailing's page gets on ambassadorcruiseline.com, as a stand-in for the booking data the
tracker doesn't have.

Once a UK day (hourly workflow step "Sailing demand (GA4)", `continue-on-error`): GA4's Data API, read with the
tracker's Firebase service account (FIREBASE_SERVICE_ACCOUNT, scope analytics.readonly), for the property in the repo
variable GA4_PROPERTY_ID. Only the sailing pages (/cruise/<code>-…/) are read, up to yesterday (today is still filling):
  - views and users per sailing per day for the last DAYS days (the trend, and what happened after a price change)
  - views by channel (Organic Search, Paid Social, Email, …) over the last 28 days
  - "booking clicks": clicks from a sailing page to the booking site (GA4's outbound click event, link domain
    book.ambassadorcruiseline.com), plus any events named in the repo variable GA4_BOOKING_EVENTS (comma-separated),
    per sailing over the last 28 days and the 28 before
  - the site's most common event names (so the right booking events can be chosen once Sam has looked)
Read-only: nothing in GA4 is changed. Without the property ID or access it records what's missing in `problem` and stops.

→ state/ga4/demand.json {read_on, fetched_at, property, problem, start, end, days, booking_events, events_seen,
   sailings: {code: {path, views: [per day, oldest first], users: [per day], ch: {channel: views 28d},
                     clicks: [28d, previous 28d], ev: {event: [28d, previous 28d]}}}}
→ publish.py pricewatch/ga4-demand → tracker page Prices → Sailing demand, and each sailing's detail view.

Setup (Sam, one-off): Google Cloud console → promotions-planner → APIs & Services → Library → "Google Analytics Data
API" → Enable; GA4 → Admin → Property access management → + → the firebase-adminsdk-…@promotions-planner.iam.
gserviceaccount.com address, role Viewer; then the property's numeric ID (Admin → Property details) as repo variable
GA4_PROPERTY_ID.

    python ga4.py [--force]
"""
import argparse, datetime as dt, json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from daily import london_today  # noqa: E402

OUT = ROOT / "state" / "ga4" / "demand.json"
API = "https://analyticsdata.googleapis.com/v1beta"
DAYS = 90
BOOKING_DOMAIN = "book.ambassadorcruiseline.com"
CODE = re.compile(r"^/cruise/([a-z0-9]+)-", re.I)


def session():
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"]), scopes=["https://www.googleapis.com/auth/analytics.readonly"])
    return AuthorizedSession(creds), creds.service_account_email


def report(http, prop, body):
    """All rows of one runReport (paged), as [dimension values…, metric values…]."""
    rows, offset = [], 0
    while True:
        r = http.post(f"{API}/properties/{prop}:runReport", json={**body, "limit": 100000, "offset": offset}, timeout=120)
        if r.status_code == 403 and ("has not been used" in r.text or "SERVICE_DISABLED" in r.text):
            raise RuntimeError("The Google Analytics Data API isn't switched on in the promotions-planner Google Cloud project "
                               "yet (APIs & Services → Library → Google Analytics Data API → Enable).")
        if r.status_code == 403:
            raise RuntimeError("The tracker's service account can't read this GA4 property yet: GA4 → Admin → Property access "
                               "management → add it as a Viewer.")
        r.raise_for_status()
        j = r.json()
        for x in j.get("rows", []):
            rows.append([d["value"] for d in x.get("dimensionValues", [])] + [m["value"] for m in x.get("metricValues", [])])
        offset += 100000
        if offset >= int(j.get("rowCount", 0)):
            return rows


CRUISE = {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": "BEGINS_WITH", "value": "/cruise/"}}}


def code_of(path):
    m = CODE.match(path or "")
    return m.group(1).upper() if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    today = london_today()
    st = json.loads(OUT.read_text()) if OUT.exists() else {}
    if st.get("read_on") == today and not a.force:
        print("GA4: already read today")
        return 0
    if not os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        print("GA4: no FIREBASE_SERVICE_ACCOUNT here; skipped")
        return 0
    prop = (os.environ.get("GA4_PROPERTY_ID") or "").strip().replace("properties/", "")
    events = [e.strip() for e in (os.environ.get("GA4_BOOKING_EVENTS") or "").split(",") if e.strip()]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    end = (dt.date.fromisoformat(today) - dt.timedelta(days=1))
    start = end - dt.timedelta(days=DAYS - 1)
    m28, p28 = [(end - dt.timedelta(days=27)).isoformat(), end.isoformat()], [(end - dt.timedelta(days=55)).isoformat(), (end - dt.timedelta(days=28)).isoformat()]
    try:
        if not prop:
            raise RuntimeError("The GA4 property isn't set yet: add its numeric ID (GA4 → Admin → Property details) as the repo "
                               "variable GA4_PROPERTY_ID.")
        http, who = session()
        days = [(start + dt.timedelta(days=i)).isoformat() for i in range(DAYS)]
        idx = {d.replace("-", ""): i for i, d in enumerate(days)}
        sail = {}
        def rec(path):
            c = code_of(path)
            if not c:
                return None
            return sail.setdefault(c, {"path": path, "views": [0] * DAYS, "users": [0] * DAYS, "ch": {}, "clicks": [0, 0], "ev": {}})
        # 1. views and users per sailing page per day
        for path, date, views, users in report(http, prop, {"dateRanges": [{"startDate": days[0], "endDate": days[-1]}],
                "dimensions": [{"name": "pagePath"}, {"name": "date"}], "metrics": [{"name": "screenPageViews"}, {"name": "activeUsers"}],
                "dimensionFilter": CRUISE}):
            r = rec(path)
            if r is not None and date in idx:
                r["views"][idx[date]] += int(views); r["users"][idx[date]] += int(users)
        # 2. channels, last 28 days
        for path, chan, views in report(http, prop, {"dateRanges": [{"startDate": m28[0], "endDate": m28[1]}],
                "dimensions": [{"name": "pagePath"}, {"name": "sessionDefaultChannelGroup"}], "metrics": [{"name": "screenPageViews"}],
                "dimensionFilter": CRUISE}):
            r = rec(path)
            if r is not None and int(views):
                r["ch"][chan] = r["ch"].get(chan, 0) + int(views)
        # 3. clicks to the booking site (GA4 enhanced measurement's outbound "click" event, by link domain)
        for k, rng in enumerate((m28, p28)):
            for path, dom, n in report(http, prop, {"dateRanges": [{"startDate": rng[0], "endDate": rng[1]}],
                    "dimensions": [{"name": "pagePath"}, {"name": "linkDomain"}], "metrics": [{"name": "eventCount"}],
                    "dimensionFilter": {"andGroup": {"expressions": [CRUISE, {"filter": {"fieldName": "eventName", "stringFilter": {"value": "click"}}},
                                                                     {"filter": {"fieldName": "linkDomain", "stringFilter": {"matchType": "CONTAINS", "value": BOOKING_DOMAIN}}}]}}}):
                r = rec(path)
                if r is not None:
                    r["clicks"][k] += int(n)
        # 4. booking events chosen in GA4_BOOKING_EVENTS, per sailing page
        if events:
            for k, rng in enumerate((m28, p28)):
                for path, ev, n in report(http, prop, {"dateRanges": [{"startDate": rng[0], "endDate": rng[1]}],
                        "dimensions": [{"name": "pagePath"}, {"name": "eventName"}], "metrics": [{"name": "eventCount"}],
                        "dimensionFilter": {"andGroup": {"expressions": [CRUISE, {"filter": {"fieldName": "eventName", "inListFilter": {"values": events}}}]}}}):
                    r = rec(path)
                    if r is not None:
                        r["ev"].setdefault(ev, [0, 0])[k] += int(n)
        # 5. the site's event names, to choose booking events from
        seen = sorted(([e, int(n)] for e, n in report(http, prop, {"dateRanges": [{"startDate": m28[0], "endDate": m28[1]}],
                       "dimensions": [{"name": "eventName"}], "metrics": [{"name": "eventCount"}]})), key=lambda x: -x[1])[:60]
        for r in sail.values():   # drop empty history to keep the document small
            if not any(r["views"]):
                r["views"] = r["users"] = []
        st = {"read_on": today, "fetched_at": now, "property": prop, "problem": "", "start": days[0], "end": days[-1], "days": DAYS,
              "m28": m28, "p28": p28, "booking_domain": BOOKING_DOMAIN, "booking_events": events, "events_seen": seen,
              "sailings": dict(sorted(sail.items()))}
        print(f"GA4 property {prop}: {len(sail)} sailing pages, {days[0]} to {days[-1]}; "
              f"{sum(sum(r['views']) for r in sail.values()):,} views; {sum(r['clicks'][0] for r in sail.values()):,} booking clicks in 28 days")
    except Exception as e:  # noqa: BLE001 - recorded for the page; never stops the price check
        st.update(read_on=today, fetched_at=now, problem=str(e)[:400])
        print("GA4:", str(e)[:400])
    OUT.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
