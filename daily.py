"""Daily runner for the Sailing Price Watch — replaces the Claude scheduled task.

Does exactly what the scheduled task's prompt did, deterministically:
  1. enrich.py TODAY            -> data/snapshot_TODAY.json
  2. safety checks              -> abort without writing if the feed looks broken
  3. tracker.py                 -> out/state.json, out/cabins.json, out/run.json
  4. save                       -> state/current.json, state/cabins.json, runs/TODAY.json
  5. cards for NEW claims only  -> cards/TODAY/*.png  (was price only ever from run.json)
  6. summary                    -> out/summary.md, out/issue.md, GITHUB_OUTPUT new_claims=true|false

Usage:
  python daily.py [--date YYYY-MM-DD] [--snapshot PATH] [--no-cards] [--force]

  --snapshot  use an existing snapshot instead of fetching (testing)
  --force     run even if runs/TODAY.json already exists (normally a second run
              on the same day is skipped: it would overwrite the day's change list)

Exit codes: 0 ok / already ran today, 2 safety check failed (nothing written), 1 error.
"""
import argparse, datetime as dt, json, os, shutil, subprocess, sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
PY = sys.executable
CABIN_LABEL = {"inside": "Inside", "ocean_view": "Ocean View", "balcony": "Balconies", "suite": "Suites"}


def london_today():
    return dt.datetime.now(ZoneInfo("Europe/London")).date().isoformat()


def run(*args):
    print("+", " ".join(str(a) for a in args), flush=True)
    r = subprocess.run([PY, *map(str, args)], cwd=ROOT, text=True, capture_output=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    if r.returncode:
        raise SystemExit(f"{Path(str(args[0])).name} failed with exit code {r.returncode}")
    return r.stdout


def load(p):
    p = Path(p)
    if not p.exists():
        return {}
    d = json.loads(p.read_text())
    return d.get("data", d)


def gh_output(**kv):
    f = os.environ.get("GITHUB_OUTPUT")
    if f:
        with open(f, "a") as fh:
            for k, v in kv.items():
                fh.write(f"{k}={v}\n")


def money(v):
    return f"£{v:,.0f}"


def safety_problems(state, snap):
    live = [k for k, v in (state.get("sailings") or {}).items() if not v.get("removed")]
    s = snap["sailings"]
    probs = []
    if live and len(s) < 0.7 * len(live):
        probs.append(f"feed returned {len(s)} sailings vs {len(live)} stored (under 70%)")
    if s and sum(1 for x in s if not x.get("departure_date")) > len(s) / 2:
        probs.append("most sailings have no departure date")
    if s and sum(1 for x in s if "cabins" not in x) > len(s) / 2:
        probs.append("most sailings have no cabin prices")
    if not s:
        probs.append("feed returned no sailings")
    return probs


def summarise(run_doc, snap, today, cards, with_cards=True):
    by = {s["id"]: s for s in snap["sailings"]}
    name = lambda i: f"{(by.get(i) or {}).get('base_title') or i} ({i})"  # noqa
    L = []
    new_lead = [e for e in run_doc["eligible"] if e["since"] == today]
    new_cab = [e for e in run_doc["cabin_eligible"] if e["since"] == today]
    for e in new_lead:
        L.append(f"- **NEW was/now (lead price):** {name(e['id'])}: was {money(e['was'])} → now {money(e['now'])} "
                 f"(save {money(e['was'] - e['now'])}), claim must end {e['ends']}")
    for e in new_cab:
        c = e["cabin"].split(".", 1)[1]
        L.append(f"- **NEW was/now ({CABIN_LABEL.get(c, c)}):** {name(e['id'])}: was {money(e['was'])} → now "
                 f"{money(e['now'])} (save {money(e['was'] - e['now'])}), claim must end {e['ends']}")
    other = []
    mix = [d for d in run_doc["drops"] if d.get("mix")]
    plain = [d for d in run_doc["drops"] if not d.get("mix")]
    if mix:
        other.append("Cheaper cabin grade came on sale (NOT a price cut): " +
                     ", ".join(f"{d['id']} {money(d['from'])}→{money(d['to'])} ({d['mix']})" for d in mix))
    nq = [d for d in plain if not (d.get("claim") or {}).get("eligible")]
    if nq:
        other.append("Drops that don't qualify: " + ", ".join(
            f"{d['id']} {money(d['from'])}→{money(d['to'])} ({(d.get('claim') or {}).get('reason', '')})" for d in nq))
    if run_doc["rises"]:
        other.append("Rises: " + ", ".join(f"{d['id']} {money(d['from'])}→{money(d['to'])}" for d in run_doc["rises"]))
    if run_doc["cabin_drops"]:
        other.append("Cabin drops: " + ", ".join(f"{d['id']} {d['cabin']} {money(d['from'])}→{money(d['to'])}" for d in run_doc["cabin_drops"]))
    if run_doc["cabin_rises"]:
        other.append(f"Cabin rises: {len(run_doc['cabin_rises'])}")
    if run_doc["cabin_sold_out"]:
        other.append("Cabins sold out: " + ", ".join(f"{d['id']} {d['cabin']}" for d in run_doc["cabin_sold_out"]))
    if run_doc["cabin_back"]:
        other.append("Cabins back on sale: " + ", ".join(f"{d['id']} {d['cabin']}" for d in run_doc["cabin_back"]))
    def by_offer(evs):
        g = {}
        for e in evs:
            g.setdefault(e.get("name") or e["offer"], []).append(e["id"])
        return "; ".join(f"{n} on {len(v)} sailing{'s' if len(v) != 1 else ''} ({', '.join(v[:8])}{', …' if len(v) > 8 else ''})"
                         for n, v in sorted(g.items()))
    if run_doc.get("promo_tracking_started"):
        other.append("Started recording promotions today; from tomorrow, offers starting and ending are listed here.")
    if run_doc.get("promo_added"):
        other.append("Promotions started: " + by_offer(run_doc["promo_added"]))
    if run_doc.get("promo_ended"):
        other.append("Promotions ended: " + by_offer(run_doc["promo_ended"]))
    for c in run_doc.get("promo_changed") or []:
        what = {"name": "renamed", "expires": "expiry changed"}.get(c["field"], c["field"] + " changed")
        other.append(f"Promotion {what} ({c.get('name') or c['offer']}): {c['from'] or 'none'} → {c['to'] or 'none'}")
    for k, label in (("new", "New sailings"), ("removed", "Removed sailings"), ("returned", "Returned sailings")):
        if run_doc[k]:
            other.append(f"{label}: " + ", ".join(run_doc[k]))
    head = f"# Price watch {today}: {run_doc['count']} sailings"
    if not L and not other:
        return head + "\n\nNo price changes.\n", False
    body = [head, ""]
    if L:
        body += ["## Newly eligible was/now claims", *L, ""]
        if with_cards:
            body += ["Nothing has been uploaded to Meta or Google. Approve before swapping cards.", ""]
    if other:
        body += ["## Other changes (no action needed)", *[f"- {o}" for o in other], ""]
    if cards:
        repo = os.environ.get("GITHUB_REPOSITORY", "OWNER/REPO")
        ref = os.environ.get("GITHUB_REF_NAME", "main")
        body += ["## Cards", *[f"![{p.name}](https://github.com/{repo}/blob/{ref}/{p.relative_to(ROOT)}?raw=true)"
                               for p in cards], ""]
    return "\n".join(body), bool(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--snapshot")
    ap.add_argument("--no-cards", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    today = a.date or london_today()
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    run_path = ROOT / "runs" / f"{today}.json"
    if run_path.exists() and not a.force:
        print(f"{today}: already recorded (runs/{today}.json exists) — skipping.")
        gh_output(new_claims="false", skipped="true")
        return 0

    # 1. fetch
    if a.snapshot:
        snap_path = Path(a.snapshot).resolve()
    else:
        run(ROOT / "enrich.py", today)
        snap_path = ROOT / "data" / f"snapshot_{today}.json"
    snap = json.loads(snap_path.read_text())

    # 2. safety
    state_p, cab_p = ROOT / "state" / "current.json", ROOT / "state" / "cabins.json"
    probs = safety_problems(load(state_p), snap)
    if probs:
        msg = f"# Price watch {today}: NOT saved\n\nSafety check failed, nothing written:\n" + "\n".join(f"- {p}" for p in probs)
        (out / "summary.md").write_text(msg + "\n")
        (out / "issue.md").write_text(msg + "\n")
        print(msg)
        gh_output(new_claims="false", safety_failed="true")
        return 2

    # 3. tracker
    report = run(ROOT / "tracker.py", state_p, snap_path, out, cab_p)
    run_doc = json.loads((out / "run.json").read_text())

    # 4. save
    (ROOT / "state").mkdir(exist_ok=True)
    (ROOT / "runs").mkdir(exist_ok=True)
    shutil.copyfile(out / "state.json", state_p)
    shutil.copyfile(out / "cabins.json", cab_p)
    run_path.write_text(json.dumps(run_doc, ensure_ascii=False, indent=1))

    # 5. cards — newly eligible claims only; was price comes only from run.json
    cards = []
    if not a.no_cards:
        cdir = ROOT / "cards" / today
        for e in run_doc["eligible"]:
            if e["since"] == today:
                o = run(ROOT / "render_cards.py", snap_path, cdir, e["id"], "--was", e["was"])
                cards += [Path(l.strip()) for l in o.splitlines() if l.strip().endswith(".png")]
        for e in run_doc["cabin_eligible"]:
            if e["since"] == today:
                c = e["cabin"].split(".", 1)[1]
                o = run(ROOT / "render_cards.py", snap_path, cdir, e["id"], "--cabin", c, "--was", e["was"])
                cards += [Path(l.strip()) for l in o.splitlines() if l.strip().endswith(".png")]
        cards = [p if p.is_absolute() else (ROOT / p) for p in cards]

    # 6. summary
    text, new_claims = summarise(run_doc, snap, today, cards, not a.no_cards)
    if "WARNING" in report:
        text += "\n**WARNING:** a state file is close to the old 256 KB document limit (harmless in git, but worth a look).\n"
    (out / "summary.md").write_text(text)
    (out / "issue.md").write_text(text)
    print(text)
    gh_output(new_claims="true" if new_claims else "false", date=today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
