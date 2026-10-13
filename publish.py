"""Copy the latest price data into Firestore for the tracker page.

The page (site/index.html) signs viewers in with Google and reads these
documents; the Firestore rules only let people on the Digital Team Planner
allowlist read them. Each document holds one JSON string, so Firestore never
has to understand the shape of the data:
  pricewatch/current  state/current.json
  pricewatch/cabins   state/cabins.json
  pricewatch/runs     recent runs/*.json, newest first: up to MAX_RUNS, as many
                      as fit in RUNS_BYTES (the page's "What changed" view uses them)
  pricewatch/coverage state/coverage.json, if the weekly feed coverage check has run
  pricewatch/cards    state/cards.json (cards_sync.py): each sailing's current cards and the
                      out-of-date ones still kept, with their download links
  pricewatch/trends   change counts per day for every run ever recorded (the Trends page),
                      plus the list of archive documents
  pricewatch/runs-YYYY-MM-1 / -2
                      every run, half a month per document (days 1-15 / 16-end), so the
                      "What changed" view can reach back past the recent runs; the page
                      loads them only when asked for older dates. Unchanged ones aren't rewritten.

Usage:
  FIREBASE_SERVICE_ACCOUNT='<service account JSON>' python publish.py
  python publish.py --dry-run     # build the documents and print their sizes only
"""
import argparse, time, hashlib, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = "promotions-planner"
MAX_RUNS = 90
RUNS_BYTES = 600_000
MAX_BYTES = 900_000  # Firestore's limit is 1 MiB per document; stop well short of it


def load(p):
    d = json.loads(Path(p).read_text())
    return d.get("data", d)


def day_counts(r):
    """How many changes of each kind one day's run recorded (twin cabins only, so a
    solo price moving with the twin one isn't counted twice). Lead drops marked "mix"
    are a cheaper cabin grade coming on sale, not a price cut, so they're counted apart."""
    twin = lambda k: sum(1 for x in r.get(k) or [] if x.get("cabin", "").startswith("twin."))
    drops = r.get("drops") or []
    return {
        "d": r["date"], "count": r.get("count"), "checks": len(r.get("checks") or []) or 1,
        "drops": sum(1 for x in drops if not x.get("mix")), "mix": sum(1 for x in drops if x.get("mix")),
        "rises": len(r.get("rises") or []),
        "cabin_drops": twin("cabin_drops"), "cabin_rises": twin("cabin_rises"),
        "sold_out": twin("cabin_sold_out"), "back": twin("cabin_back"),
        "new": len(r.get("new") or []), "removed": len(r.get("removed") or []),
        "promo_added": len(r.get("promo_added") or []), "promo_ended": len(r.get("promo_ended") or []),
        "nectar": len(r.get("nectar_changes") or []),
    }


def half(date):
    return f"runs-{date[:7]}-{1 if int(date[8:10]) <= 15 else 2}"


def old_shown(old):
    """Out-of-date versions the page shows: every withdrawn was/now card ("do not use") and the newest OLD_SHOWN
    standard ones per sailing. The manifest keeps them all (cards_sync deletes them after 30 days); this only
    keeps pricewatch/cards under Firestore's 1 MiB limit (QA, 13 Oct 2026: it was growing ~60 KB a day)."""
    keep = sorted(old, key=lambda o: o.get("out_of_date_since") or o.get("made_at") or "", reverse=True)
    std = [o for o in keep if not o.get("do_not_use")][:OLD_SHOWN]
    return [o for o in keep if o.get("do_not_use") or o in std]


OLD_SHOWN = 2


def documents():
    cur = load(ROOT / "state" / "current.json")
    every = [load(p) for p in sorted((ROOT / "runs").glob("*.json"), reverse=True)]
    runs, size = [], 0
    for r in every[:MAX_RUNS]:
        size += len(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode())
        if runs and size > RUNS_BYTES:
            break
        runs.append(r)
    archives = {}
    for r in every:
        archives.setdefault(half(r["date"]), []).append(r)
    docs = {
        "current": cur,
        "cabins": load(ROOT / "state" / "cabins.json"),
        "runs": runs,
        "trends": {
            "days": [day_counts(r) for r in reversed(every)],
            "archives": {k: [v[-1]["date"], v[0]["date"]] for k, v in archives.items()},
        },
        **archives,
    }
    if (ROOT / "state" / "cards.json").exists():
        man = load(ROOT / "state" / "cards.json")
        slim = lambda c: {k: c.get(k) for k in ("made_at", "reason", "price", "promos", "nectar", "out_of_date_since", "review",
                                                "kind", "cabin", "was", "now", "since", "ends", "do_not_use")
                          if c.get(k) is not None} | {"files": {t: f["url"] for t, f in c["files"].items()}}
        docs["cards"] = {"updated_at": man.get("updated_at"), "sailings": {
            sid: {"current": slim(m["current"]) if m.get("current") else None, "old": [slim(o) for o in old_shown(m.get("old") or [])],
                  **({"wasnow": {k: slim(c) for k, c in m["wasnow"].items()}} if m.get("wasnow") else {})}
            for sid, m in man.get("sailings", {}).items()}}
    if (ROOT / "state" / "adkit.json").exists():
        docs["adkit"] = load(ROOT / "state" / "adkit.json")
    if (ROOT / "state" / "terms.json").exists():
        docs["terms"] = load(ROOT / "state" / "terms.json")
    if (ROOT / "state" / "coverage.json").exists():
        docs["coverage"] = load(ROOT / "state" / "coverage.json")
    out = {}
    for name, data in docs.items():
        s = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(s.encode()) > MAX_BYTES:
            raise SystemExit(f"pricewatch/{name} is {len(s.encode()):,} bytes, too close to Firestore's 1 MiB limit")
        out[name] = {"json": s, "updated": cur.get("updated", "")}
        if name.startswith("runs-"):
            out[name]["sha"] = hashlib.sha256(s.encode()).hexdigest()
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
        if "sha" in d:  # archive halves: skip the ones Firestore already holds unchanged
            r = session.get(f"{base}/{name}", params={"mask.fieldPaths": "sha"}, timeout=60)
            if r.ok and r.json().get("fields", {}).get("sha", {}).get("stringValue") == d["sha"]:
                continue
            if not r.ok and r.status_code != 404:
                raise SystemExit(f"reading pricewatch/{name} failed: {r.status_code} {r.text[:300]}")
        body = {"fields": {k: {"stringValue": v} for k, v in d.items()}}
        for wait in (2, 4, 8, 16, 32, 0):
            r = session.patch(f"{base}/{name}", json=body, timeout=60)
            # Firestore asks for a pause and a retry when writes come too fast (429 on 12 Oct 2026).
            if r.ok or wait == 0 or not (r.status_code == 429 or r.status_code >= 500):
                break
            print(f"pricewatch/{name}: Firestore busy ({r.status_code}), retrying in {wait}s")
            time.sleep(wait)
        if not r.ok:
            raise SystemExit(f"writing pricewatch/{name} failed: {r.status_code} {r.text[:300]}")
        print(f"wrote pricewatch/{name}: {len(d['json'].encode()):,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
