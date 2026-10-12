"""Copy the latest price data into Firestore for the tracker page.

The page (site/index.html) signs viewers in with Google and reads these
documents; the Firestore rules only let people on the Digital Team Planner
allowlist read them. Each document holds one JSON string, so Firestore never
has to understand the shape of the data:
  pricewatch/current  state/current.json
  pricewatch/cabins   state/cabins.json
  pricewatch/runs     the last RUNS_SHOWN runs/*.json, newest first

Usage:
  FIREBASE_SERVICE_ACCOUNT='<service account JSON>' python publish.py
  python publish.py --dry-run     # build the documents and print their sizes only
"""
import argparse, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = "promotions-planner"
RUNS_SHOWN = 21
MAX_BYTES = 900_000  # Firestore's limit is 1 MiB per document; stop well short of it


def load(p):
    d = json.loads(Path(p).read_text())
    return d.get("data", d)


def documents():
    cur = load(ROOT / "state" / "current.json")
    runs = [load(p) for p in sorted((ROOT / "runs").glob("*.json"), reverse=True)[:RUNS_SHOWN]]
    docs = {
        "current": cur,
        "cabins": load(ROOT / "state" / "cabins.json"),
        "runs": runs,
    }
    out = {}
    for name, data in docs.items():
        s = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(s.encode()) > MAX_BYTES:
            raise SystemExit(f"pricewatch/{name} is {len(s.encode()):,} bytes, too close to Firestore's 1 MiB limit")
        out[name] = {"json": s, "updated": cur.get("updated", "")}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    docs = documents()
    if a.dry_run:
        for name, d in docs.items():
            print(f"pricewatch/{name}: {len(d['json'].encode()):,} bytes (updated {d['updated']})")
        return 0

    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession

    info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not info:
        raise SystemExit("FIREBASE_SERVICE_ACCOUNT is not set (add it under Settings → Secrets and variables → Actions)")
    creds = service_account.Credentials.from_service_account_info(
        json.loads(info), scopes=["https://www.googleapis.com/auth/datastore"])
    session = AuthorizedSession(creds)
    base = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/pricewatch"
    for name, d in docs.items():
        body = {"fields": {k: {"stringValue": v} for k, v in d.items()}}
        r = session.patch(f"{base}/{name}", json=body, timeout=60)
        if not r.ok:
            raise SystemExit(f"writing pricewatch/{name} failed: {r.status_code} {r.text[:300]}")
        print(f"wrote pricewatch/{name}: {len(d['json'].encode()):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
