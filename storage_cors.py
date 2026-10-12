"""Let the tracker page fetch card images from the planner's Storage bucket, so its
"Download these" button can zip them in the browser (12 Oct 2026).

Browsers only let a page read files from another site when that site allows it (CORS).
This adds one rule to the bucket for the tracker page's own addresses, keeping every rule
already there (the Digital Team Planner may have its own). Read-only GET for the page's
origins only. Does nothing when the rule is already in place, so it is safe to run every time.

Usage: FIREBASE_SERVICE_ACCOUNT=... HOSTING_SITE=acl-price-watch python storage_cors.py
"""
import json, os, sys

BUCKET = "promotions-planner.firebasestorage.app"


def wanted(site):
    return {"origin": [f"https://{site}.web.app", f"https://{site}.firebaseapp.com"],
            "method": ["GET"], "responseHeader": ["Content-Type", "Content-Length"], "maxAgeSeconds": 3600}


def main():
    site = os.environ.get("HOSTING_SITE")
    info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not (site and info):
        raise SystemExit("HOSTING_SITE and FIREBASE_SERVICE_ACCOUNT are needed")
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    creds = service_account.Credentials.from_service_account_info(
        json.loads(info), scopes=["https://www.googleapis.com/auth/devstorage.full_control"])
    http = AuthorizedSession(creds)
    url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}"
    r = http.get(url, params={"fields": "cors"}, timeout=60)
    if not r.ok:
        raise SystemExit(f"reading the bucket's settings failed: {r.status_code} {r.text[:300]}")
    cors = r.json().get("cors") or []
    rule = wanted(site)
    if any(set(rule["origin"]) <= set(c.get("origin") or []) and "GET" in (c.get("method") or []) for c in cors):
        print("Card downloads already allowed for the tracker page.")
        return 0
    r = http.patch(url, params={"fields": "cors"}, json={"cors": cors + [rule]}, timeout=60)
    if not r.ok:
        raise SystemExit(f"updating the bucket's settings failed: {r.status_code} {r.text[:300]}")
    print(f"Allowed the tracker page ({', '.join(rule['origin'])}) to download cards; kept {len(cors)} existing rule(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
