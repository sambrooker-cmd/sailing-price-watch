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
  pricewatch/fr-current, fr-cabins, fr-runs, fr-trends, fr-runs-YYYY-MM-1 / -2
                      the same for France (state/fr, runs/fr; Sam, 14 Oct 2026), once its first check has run
  pricewatch/terms, coverage, cards, adkit (and fr-terms, fr-coverage, fr-cards, fr-adkit)
  pricewatch/comp-current, comp-<line>, comp-runs   competitor prices and offers (competitors.py), once it has run
  pricewatch/fr-comp, fr-comp-runs   France: MSC and Costa itineraries from French ports at Havas Voyages (competitors_fr.py)
  pricewatch/comp-meta, comp-meta-<brand>  competitors' live Facebook/Instagram ads in the UK (meta_ads.py)
  pricewatch/comp-inbox  competitor newsletters' offers (offers_inbox.py), once the mailbox is set up
  pricewatch/seo-demand  monthly UK searches for the search demand viewer's terms, from Keyword Planner (search_demand.py)
  pricewatch/meta-spend  Meta ad spend by sailing per day, estimated from carousel card clicks and from ad-driven page views (ad_spend.py)
  pricewatch/meta-ads  our own Meta ad account: campaigns, ad sets, ads and the changes proposed for approval (meta_manage.py)
  pricewatch/ga4-impact  interest before and after each price move and offer, against similar sailings (impact.py)
  pricewatch/ga4-demand  sailing page views, channels and booking clicks from GA4 (ga4.py)
  pricewatch/seo-pages  the website's own pages (title, description, H1) for the duplicate check (seo_pages.py)
  pricewatch/seo-cwv  Core Web Vitals: our pages' lab tests, real-visitor figures for us and the competitors (seo_cwv.py; fr-cwv for France)
  pricewatch/seo-gsc  the searches people find the site with, from Google Search Console (seo_gsc.py)
  pricewatch/comp-emails-YYYY-MM-1 / -2  the email library: that half month's competitor emails (links to their copies in Storage)

Usage:
  FIREBASE_SERVICE_ACCOUNT='<service account JSON>' python publish.py
  python publish.py --dry-run     # build the documents and print their sizes only
"""
import argparse, datetime, time, hashlib, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = "promotions-planner"
MAX_RUNS = 90
RUNS_BYTES = 600_000
MAX_BYTES = 900_000
# What the email library page shows of each competitor email (offers_inbox.py)
LIBRARY_FIELDS = ("id", "line", "brand", "sender", "subject", "preheader", "date", "view", "promotion", "offers", "by",
                  "kind", "summary", "headline", "cta", "destinations", "from_price", "n_links", "n_images", "kb",
                  "html", "thumb", "height")  # Firestore's limit is 1 MiB per document; stop well short of it


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


def history(state_dir, runs_dir, prefix=""):
    """current, cabins, recent runs, trends and the half-month run archives of one market."""
    cur = load(state_dir / "current.json")
    every = [load(p) for p in sorted(runs_dir.glob("*.json"), reverse=True)]
    runs, size = [], 0
    for r in every[:MAX_RUNS]:
        size += len(json.dumps(r, ensure_ascii=False, separators=(",", ":")).encode())
        if runs and size > RUNS_BYTES:
            break
        runs.append(r)
    archives = {}
    for r in every:
        archives.setdefault(half(r["date"]), []).append(r)
    return {
        prefix + "current": cur,
        prefix + "cabins": load(state_dir / "cabins.json"),
        prefix + "runs": runs,
        prefix + "trends": {
            "days": [day_counts(r) for r in reversed(every)],
            "archives": {prefix + k: [v[-1]["date"], v[0]["date"]] for k, v in archives.items()},
        },
        **{prefix + k: v for k, v in archives.items()},
    }


def cards_doc(man):
    slim = lambda c: {k: c.get(k) for k in ("made_at", "reason", "price", "promos", "nectar", "out_of_date_since", "review",
                                            "kind", "cabin", "was", "now", "since", "ends", "do_not_use")
                      if c.get(k) is not None} | {"files": {t: f["url"] for t, f in c["files"].items()}}
    return {"updated_at": man.get("updated_at"), "sailings": {
        sid: {"current": slim(m["current"]) if m.get("current") else None, "old": [slim(o) for o in old_shown(m.get("old") or [])],
              **({"wasnow": {k: slim(c) for k, c in m["wasnow"].items()}} if m.get("wasnow") else {})}
        for sid, m in man.get("sailings", {}).items()}}


def documents():
    docs = history(ROOT / "state", ROOT / "runs")
    cur = docs["current"]
    if (ROOT / "state" / "fr" / "current.json").exists():   # France (fr_enrich.py), once its first check has run
        docs.update(history(ROOT / "state" / "fr", ROOT / "runs" / "fr", "fr-"))
    for sub, prefix in (("", ""), ("fr", "fr-")):   # UK, then France (cards_sync.py --market fr)
        if (ROOT / "state" / sub / "cards.json").exists():
            docs[prefix + "cards"] = cards_doc(load(ROOT / "state" / sub / "cards.json"))
        if (ROOT / "state" / sub / "adkit.json").exists():
            docs[prefix + "adkit"] = load(ROOT / "state" / sub / "adkit.json")
        for name in ("terms", "coverage"):   # France: terms.py --market fr, coverage.py --market fr
            if (ROOT / "state" / sub / f"{name}.json").exists():
                docs[prefix + name] = load(ROOT / "state" / sub / f"{name}.json")
    # Keyword ideas for the page creator from Google Search Console (seo_gsc.py, 16 Oct 2026)
    if (ROOT / "state" / "seo" / "gsc.json").exists():
        docs["seo-gsc"] = load(ROOT / "state" / "seo" / "gsc.json")
    # Core Web Vitals for us and the competitors (seo_cwv.py, 17 Oct 2026)
    if (ROOT / "state" / "seo" / "cwv.json").exists():
        docs["seo-cwv"] = load(ROOT / "state" / "seo" / "cwv.json")
    if (ROOT / "state" / "fr" / "cwv.json").exists():   # France: ambassadorcroisieres.fr and its competitors
        docs["fr-cwv"] = load(ROOT / "state" / "fr" / "cwv.json")
    # Search demand from Keyword Planner (search_demand.py, 17 Oct 2026)
    if (ROOT / "state" / "seo" / "search_demand.json").exists():
        docs["seo-demand"] = load(ROOT / "state" / "seo" / "search_demand.json")
    # Sailing demand from GA4 (ga4.py, 17 Oct 2026)
    if (ROOT / "state" / "ga4" / "demand.json").exists():
        docs["ga4-demand"] = {k: v for k, v in load(ROOT / "state" / "ga4" / "demand.json").items() if k != "meta_views"}   # meta_views: ad_spend.py only
    if (ROOT / "state" / "ga4" / "impact.json").exists():   # what price moves and offers did (impact.py)
        docs["ga4-impact"] = load(ROOT / "state" / "ga4" / "impact.json")
    if (ROOT / "state" / "meta" / "ads.json").exists():   # our own Meta ads and the changes proposed for them (meta_manage.py)
        docs["meta-ads"] = load(ROOT / "state" / "meta" / "ads.json")
    if (ROOT / "state" / "meta" / "spend_by_sailing.json").exists():   # Meta spend placed on sailings, two ways (ad_spend.py)
        docs["meta-spend"] = load(ROOT / "state" / "meta" / "spend_by_sailing.json")
    # The website's own pages for the page creator's duplicate check (seo_pages.py, 16 Oct 2026)
    if (ROOT / "state" / "seo" / "pages.json").exists():
        docs["seo-pages"] = load(ROOT / "state" / "seo" / "pages.json")
    # Competitors (competitors.py, 15 Oct 2026): the sampled sailings and offers, and the last 60 days' changes.
    # Not the sample bookkeeping (pages tried), which the page doesn't need.
    comp = ROOT / "state" / "competitors" / "current.json"
    if comp.exists():
        # One document per cruise line (every competing sailing: ~1,000, too many for one 1 MiB document) plus
        # comp-current with the rest and the list of parts
        c = load(comp)
        by = {}
        for sid, r in (c.get("sailings") or {}).items():
            by.setdefault(r.get("line") or "other", {})[sid] = r
        for line, sailings in by.items():
            docs[f"comp-{line}"] = {"sailings": sailings}
        docs["comp-current"] = {**{k: v for k, v in c.items() if k not in ("tried", "uk_ships", "uk_ships_at", "sample", "sailings")},
                                "parts": sorted(f"comp-{line}" for line in by)}
        runs, size = [], 0
        for f in sorted((ROOT / "runs" / "competitors").glob("*.json"), reverse=True)[:60]:
            r = load(f)
            r = {"date": r.get("date"), "changes": r.get("changes", [])}
            size += len(json.dumps(r))
            if size > 400_000:
                break
            runs.append(r)
        docs["comp-runs"] = {"runs": runs}
    # France's competitors (competitors_fr.py, 16 Oct 2026): MSC and Costa itineraries from French ports at Havas Voyages
    # (~150 itineraries: one document; split() looks after it if it grows), and the last 60 days' changes
    frc = ROOT / "state" / "fr" / "competitors.json"
    if frc.exists():
        c = load(frc)
        docs["fr-comp"] = {k: v for k, v in c.items() if k != "tried"}
        runs, size = [], 0
        for f in sorted((ROOT / "runs" / "fr" / "competitors").glob("*.json"), reverse=True)[:60]:
            r = load(f)
            r = {"date": r.get("date"), "changes": r.get("changes", [])}
            size += len(json.dumps(r))
            if size > 300_000:
                break
            runs.append(r)
        docs["fr-comp-runs"] = {"runs": runs}
    # Competitors' live Facebook/Instagram ads in the UK (meta_ads.py): a summary, and one document of ads per brand
    meta = ROOT / "state" / "competitors" / "meta_ads.json"
    if meta.exists():
        m = load(meta)
        by = {}
        for aid, r in (m.get("ads") or {}).items():
            by.setdefault(r["brand"], []).append({"id": aid, **{k: r.get(k) for k in ("page", "start", "stop", "created", "first_seen",
                                                  "last_seen", "ended", "body", "title", "desc", "caption", "platforms")}})
        for brand, ads in by.items():
            ads.sort(key=lambda a: (a.get("ended") or "", a.get("start") or ""), reverse=True)
            doc = {"ads": ads}
            while len(json.dumps(doc, ensure_ascii=False).encode()) > 800_000 and ads:   # keep well inside Firestore's limit
                for a in ads:
                    a["body"] = [b[:200] for b in (a.get("body") or [])][:1]
                if len(json.dumps(doc, ensure_ascii=False).encode()) > 800_000:
                    del ads[-max(1, len(ads) // 10):]
            docs[f"comp-meta-{brand}"] = doc
        docs["comp-meta"] = {k: m.get(k) for k in ("read_on", "fetched_at", "counts", "problems")} | {
            "pages": {k: list((v.get("ids") or {}).values()) for k, v in (m.get("pages") or {}).items()},
            "parts": sorted(f"comp-meta-{b}" for b in by)}
    # Competitor newsletters (offers_inbox.py): each email's brand, subject, date, links and offers, not its text
    inbox = ROOT / "state" / "competitors" / "inbox.json"
    if inbox.exists():
        i = load(inbox)
        em = sorted((i.get("emails") or {}).values(), key=lambda e: e["date"], reverse=True)
        recent = [e for e in em if e["date"] >= (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=90)).isoformat()[:19]]
        # The email library (Competitors → Competitor emails): one document per half month (as the runs archive),
        # rewritten only when it changes
        lib = {}
        for e in em:
            if e.get("html"):
                lib.setdefault(f"{e['date'][:7]}-{1 if int(e['date'][8:10]) <= 15 else 2}", []).append({k: e.get(k) for k in LIBRARY_FIELDS} | {"links": (e.get("links") or [])[:10]})
        for month, es in lib.items():
            docs[f"comp-emails-{month}"] = {"part": month, "emails": es}
        docs["comp-inbox"] = {"fetched_at": i.get("fetched_at"), "parts": sorted(lib, reverse=True), "emails": [
            {k: e.get(k) for k in ("line", "brand", "subject", "preheader", "date", "view", "promotion", "offers", "by")}
            | {"links": (e.get("links") or [])[:6]} for e in recent][:400]}
    docs = {k: v for name, data in docs.items() for k, v in split(name, data).items()}
    out = {}
    for name, data in docs.items():
        s = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(s.encode()) > MAX_BYTES:
            raise SystemExit(f"pricewatch/{name} is {len(s.encode()):,} bytes, too close to Firestore's 1 MiB limit")
        out[name] = {"json": s, "updated": (data.get("updated") if name in ("fr-current", "fr-cabins") else None) or cur.get("updated", "")}
        if name.startswith(("runs-", "fr-runs-", "comp-emails-")) or "~" in name:
            out[name]["sha"] = hashlib.sha256(s.encode()).hexdigest()
    return out


SPLIT_AT = 600_000   # documents bigger than this are split (15 Oct 2026: current.json grows ~7 KB a day)


def split(name, data):
    """{name: data} or, for a document over SPLIT_AT, the document with its biggest dict or list moved into parts
    "<name>~1", "<name>~2", … ({"_split": [part names]} in its place). index.html readJson puts it back together,
    so every page reads it as before, however long the history grows (Firestore's limit is 1 MiB a document)."""
    size = lambda x: len(json.dumps(x, ensure_ascii=False, separators=(",", ":")).encode())
    if not isinstance(data, dict) or size(data) <= SPLIT_AT:
        return {name: data}
    key = max((k for k, v in data.items() if isinstance(v, (dict, list)) and v), key=lambda k: size(data[k]), default=None)
    if key is None:
        return {name: data}
    items = list(data[key].items()) if isinstance(data[key], dict) else list(data[key])
    parts, cur, n = [], [], 0
    for it in items:
        b = size(it)
        if cur and n + b > SPLIT_AT * 0.8:
            parts.append(cur); cur, n = [], 0
        cur.append(it); n += b
    if cur:
        parts.append(cur)
    names = [f"{name}~{i + 1}" for i in range(len(parts))]
    out = {name: {**data, key: {"_split": names}}}
    for nm, chunk in zip(names, parts):
        out[nm] = {"part": dict(chunk) if isinstance(data[key], dict) else chunk}
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
