"""Status and storage for videos asked for from the tracker page's Make video button (Sam, 13 Oct 2026).

The Firebase function (functions/index.js) records each request in Firestore pricewatch_videos/<id> and starts
the Make video workflow (or, for a sailing's route video, the Route video workflow) with that id. The workflow calls:
  python video_job.py running ID          when it starts (adds the run's link)
  python video_job.py done ID OUTDIR      uploads OUTDIR/*.mp4 to Storage, lists them on the request
  python video_job.py failed ID           if anything went wrong
Each "done" also deletes videos older than KEEP_DAYS (Storage files and their request), so Storage stays small.
Files: gs://promotions-planner.firebasestorage.app/pricewatch-videos/<id>/<file>.mp4 with a Firebase download
token; the links reach people only through the function, which checks the allowlist.
"""
import datetime as dt, json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from cards_sync import Store  # noqa: E402

PROJECT = "promotions-planner"
COL = "pricewatch_videos"
PREFIX = "pricewatch-videos"
KEEP_DAYS = 30
DOCS = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"


def session():
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not info:
        raise SystemExit("FIREBASE_SERVICE_ACCOUNT is not set")
    creds = service_account.Credentials.from_service_account_info(json.loads(info), scopes=[
        "https://www.googleapis.com/auth/datastore", "https://www.googleapis.com/auth/devstorage.read_write"])
    return AuthorizedSession(creds)


def value(v):
    """A Python value as a Firestore REST value."""
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [value(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: value(x) for k, x in v.items()}}}
    raise TypeError(type(v))


def update(http, rid, **fields):
    """Change some fields of pricewatch_videos/<rid>; the request must already exist (made by the function)."""
    params = [("updateMask.fieldPaths", k) for k in fields] + [("currentDocument.exists", "true")]
    r = http.patch(f"{DOCS}/{COL}/{rid}", params=params, json={"fields": {k: value(v) for k, v in fields.items()}}, timeout=60)
    if not r.ok:
        raise SystemExit(f"updating {COL}/{rid} failed: {r.status_code} {r.text[:300]}")


def run_link():
    s, repo, run = (os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
    return f"{s}/{repo}/actions/runs/{run}" if run else ""


def cleanup(http, store):
    """Delete requests (and their files) older than KEEP_DAYS."""
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=KEEP_DAYS)).isoformat().replace("+00:00", "Z")
    q = {"structuredQuery": {"from": [{"collectionId": COL}], "limit": 100, "where": {"fieldFilter": {
        "field": {"fieldPath": "at"}, "op": "LESS_THAN", "value": {"timestampValue": cutoff}}}}}
    r = http.post(f"{DOCS}:runQuery", json=q, timeout=60)
    if not r.ok:
        print(f"cleanup: query failed {r.status_code} {r.text[:200]}")
        return
    gone = 0
    for row in r.json():
        doc = row.get("document")
        if not doc:
            continue
        files = doc["fields"].get("files", {}).get("arrayValue", {}).get("values", [])
        for f in files:
            path = f["mapValue"]["fields"].get("path", {}).get("stringValue")
            if path:
                store.delete(path)
        d = http.delete(f"https://firestore.googleapis.com/v1/{doc['name']}", timeout=60)
        gone += d.ok
    if gone:
        print(f"cleanup: deleted {gone} video request(s) older than {KEEP_DAYS} days")


def done(http, rid, outdir):
    out = Path(outdir)
    info = json.loads((out / "info.json").read_text())
    store = Store.__new__(Store)
    store.http = http
    files = []
    for name in info["files"]:
        # ad_9x16_6s.mp4 (make_video.py) or route_A32651_9x16_58s.mp4 (route_video.py)
        m = re.search(r"_(\d+x\d+)_([\d.]+)s\.mp4$", name)
        path = f"{PREFIX}/{rid}/{name}"
        url = store.put(path, (out / name).read_bytes(), name, content_type="video/mp4")
        files.append({"name": name, "size": m.group(1), "length": m.group(2), "url": url, "path": path,
                      "bytes": (out / name).stat().st_size})
        print("uploaded", path)
    update(http, rid, status="done", files=files, prices=info["prices"], until=info["until"],
           title=", ".join(t for t in info["slides"] if t not in ("Opening card", "Closing card"))[:200],
           cards=len(info["slides"]), run=run_link())
    cleanup(http, store)


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd, rid = sys.argv[1], sys.argv[2]
    if not re.fullmatch(r"[A-Za-z0-9]{10,40}", rid):
        raise SystemExit(f"Not a request id: {rid!r}")
    http = session()
    if cmd == "running":
        update(http, rid, status="running", run=run_link())
    elif cmd == "done":
        done(http, rid, sys.argv[3])
    elif cmd == "failed":
        update(http, rid, status="failed", error="Making the videos failed on GitHub. Try again, or tell Sam.", run=run_link())
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
