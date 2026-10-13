"""Price history tracker for the Ambassador sailing feed.

State lives in the tracker artifact's database:
  state/current  — every sailing seen, its metadata and price segments
  state/cabins   — per-cabin price history and claims for each sailing
  runs/<date>    — what changed in each daily run

Usage:
  python3 tracker.py STATE.json SNAPSHOT.json OUT_DIR [CABINS.json]
    STATE.json   current state document (or a missing path on the first run)
    SNAPSHOT.json output of enrich.py for today
  Writes OUT_DIR/state.json, OUT_DIR/cabins.json and OUT_DIR/run.json.
  Cabin prices live in their own document, state/cabins.

  python3 tracker.py --seed-cabins STATE.json SNAPSHOT.json OUT_DIR
    Adds cabin prices (and the cabin type behind each lead price) to an
    existing state without touching lead price history. Used once, to start
    cabin tracking mid-day.

Two price histories per sailing:
  * the lead "from" price (segments), tagged with the cabin type that sets
    it ("c"). Until 13 Oct 2026 this was the ad feed's price; since then it is
    the cheapest twin cabin on the sailing's page (enrich.py price_source).
    The check that switched marks sailings whose price moved with the switch
    ("switch"): not a drop or rise, and a new reference period. When a page
    can't be read the last "from" price is kept, not the feed's. And
  * per-person prices by cabin type from the landing page (cabins), for
    twin and solo occupancy: inside, ocean_view, balcony, suite.

Was/now rule (defaults; agree the numbers with compliance):
  * a drop qualifies only if the previous price was held for at least
    MIN_REFERENCE_DAYS consecutive days on sale before the drop;
  * the claim may run for at most MAX_PROMO_DAYS after the drop, and never
    longer than the reference price was held;
  * a later price rise ends the claim; a further drop restarts the check
    against the price held immediately before it;
  * like for like only: a lead price that falls because a cheaper cabin grade
    came on sale is not a reduction, and a cabin that sold out and came back
    starts a fresh reference period.
Cabin was/now claims are offered for twin (per person sharing) prices only.
"""
import datetime as dt, json, sys
from pathlib import Path

RULES = {"min_reference_days": 28, "max_promo_days": 28, "min_saving_gbp": 10,
         "skip_departing_within_days": 7}
META = ("title", "base_title", "flight_from", "ship", "port", "nights", "departure_date",
        "link", "image_link", "offer", "flags")
CABIN_ORDER = ("inside", "ocean_view", "balcony", "suite")


def days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def lead_cabin(price, cabins):
    """Which twin cabin type sets the feed's lead price (None if unknown)."""
    tw = (cabins or {}).get("twin") or {}
    for c in CABIN_ORDER:
        if tw.get(c) == price:
            return c
    return None


def claim_for(seg, today, rules, departure_date, like_for_like=True):
    """Was/now claim for a list of price segments, or None if no drop."""
    if len(seg) < 2:
        return None
    cur, prev = seg[-1], seg[-2]
    if cur["p"] >= prev["p"]:
        return None
    base = {"was": prev["p"], "now": cur["p"], "since": cur["from"]}
    held = days(prev["from"], cur["from"])
    base["held_days"] = held
    no = lambda why: {"eligible": False, "reason": why, **base}  # noqa
    if cur.get("switch"):
        return no("the from price now comes from the web page, not the ad feed; new reference period")
    if cur.get("back"):
        return no("cabin came back on sale at a lower price; new reference period")
    if like_for_like:
        if not prev.get("c") or not cur.get("c"):
            return no("cabin type behind the lead price is unknown")
        if prev["c"] != cur["c"]:
            return no(f"cheaper cabin grade came on sale ({prev['c']} → {cur['c']}), not a price cut")
    if held < rules["min_reference_days"]:
        return no(f"previous price held {held} days, needs {rules['min_reference_days']}")
    if prev["p"] - cur["p"] < rules["min_saving_gbp"]:
        return no("saving too small")
    limit = min(rules["max_promo_days"], held)
    if days(cur["from"], today) > limit:
        return no(f"claim expired after {limit} days")
    if departure_date and days(today, departure_date) < rules["skip_departing_within_days"]:
        return no("departs too soon")
    return {"eligible": True, **base,
            "ends": (dt.date.fromisoformat(cur["from"]) + dt.timedelta(days=limit)).isoformat()}


def was_now(sailing, today, rules):
    if sailing.get("removed"):
        return None
    return claim_for(sailing["segments"], today, rules, sailing.get("departure_date"))


def update_cabins(rec, cabins, today, run, sid):
    """Fold today's cabin prices into rec["cabins"]; record events in run."""
    store = rec.setdefault("cabins", {})
    seen = set()
    for occ, types in (cabins or {}).items():
        for c, p in types.items():
            key = f"{occ}.{c}"
            seen.add(key)
            p = round(p)
            h = store.get(key)
            if h is None:
                store[key] = {"seg": [{"p": p, "from": today}]}
                continue
            if h.get("out"):
                h.pop("out")
                h["seg"].append({"p": p, "from": today, "back": True})
                run["cabin_back"].append({"id": sid, "cabin": key, "p": p})
                continue
            last = h["seg"][-1]["p"]
            if p != last:
                h["seg"].append({"p": p, "from": today})
                (run["cabin_drops"] if p < last else run["cabin_rises"]).append(
                    {"id": sid, "cabin": key, "from": last, "to": p})
    for key, h in store.items():
        if key not in seen and not h.get("out"):
            h["out"] = today
            run["cabin_sold_out"].append({"id": sid, "cabin": key})
    # Keep each cabin history short: the claim only ever looks at the last
    # two segments, the page shows a few more.
    for h in store.values():
        if len(h["seg"]) > 12:
            h["seg"] = h["seg"][-12:]


def update_promos(rec, live, today, run, sid, catalogue, first):
    """Record which promotions are on the sailing's page today.
    rec["promos"] = {offer_id: [[from, to], ...]}, one spell per run of days the
    offer was shown; `to` is the first day it was gone (None while live).
    Names, descriptions and expiry dates live once in the catalogue."""
    store = rec.setdefault("promos", {})
    seen = set()
    for o in live:
        oid = o["id"]
        seen.add(oid)
        cat = catalogue.setdefault(oid, {"first_seen": today})
        for k, f in (("name", "name"), ("desc", "description"), ("expires", "expires_at")):
            if k not in cat or cat[k] != o.get(f):
                if k != "desc" and k in cat:
                    run["promo_changed"].append({"offer": oid, "name": cat.get("name"), "field": k, "from": cat[k], "to": o.get(f)})
                cat[k] = o.get(f)
        cat["last_seen"] = today
        spells = store.setdefault(oid, [])
        if not spells or spells[-1][1] is not None:
            spells.append([today, None])
            if not first:
                run["promo_added"].append({"id": sid, "offer": oid, "name": o["name"]})
    close_promos(rec, today, run, sid, catalogue, keep=seen)


def close_promos(rec, today, run, sid, catalogue, keep=()):
    for oid, spells in (rec.get("promos") or {}).items():
        if oid not in keep and spells and spells[-1][1] is None:
            spells[-1][1] = today
            run["promo_ended"].append({"id": sid, "offer": oid, "name": (catalogue.get(oid) or {}).get("name")})


def update_nectar(rec, s, today, run, sid, first):
    """Nectar points the sailing page shows (snapshot "nectar_pts": two sharing, cheapest cabin,
    Ambassador fare) as a history rec["nectar"] = [{"n": points, "from": date}], plus the current
    points per cabin grade in rec["nectar_grades"]. Recorded only: never part of was/now claims.
    Points follow the booking value in bands, so most changes come with a price change."""
    rec["nectar_grades"] = {k: v for k, v in s["nectar"].items() if k in ("twin", "solo")}
    n = s.get("nectar_pts")
    if n is None:
        return
    h = rec.setdefault("nectar", [])
    if h and h[-1]["n"] == n:
        return
    if h and not first:
        run["nectar_changes"].append({"id": sid, "from": h[-1]["n"], "to": n})
    h.append({"n": n, "from": today})
    del h[:-24]


def cabin_claims(rec, today, rules):
    out = {}
    if rec.get("removed"):
        return out
    for key, h in (rec.get("cabins") or {}).items():
        if not key.startswith("twin.") or h.get("out"):
            continue
        c = claim_for(h["seg"], today, rules, rec.get("departure_date"), like_for_like=False)
        if c:
            out[key] = c
    return out


def update(state, snap):
    today = snap["date"]
    rules = {**RULES, **state.get("rules", {})}
    sailings = state.get("sailings", {})
    seen = set()
    run = {"date": today, "count": snap["count"], "new": [], "removed": [], "returned": [],
           "drops": [], "rises": [], "eligible": [], "flags": {},
           "cabin_drops": [], "cabin_rises": [], "cabin_sold_out": [], "cabin_back": [],
           "cabin_eligible": [], "promo_added": [], "promo_ended": [], "promo_changed": [],
           "nectar_changes": [], "lead_source_switch": []}
    # The first check reading "from" prices off the pages (13 Oct 2026) doesn't report the
    # difference from the feed's prices as drops or rises.
    switching = "lead_from_page_since" not in state
    page_seen = False
    catalogue = state.get("offers", {})
    # The first run that sees promotions records what is live without
    # reporting every one of them as newly started.
    first_promos = "promos_since" not in state
    promos_seen = False
    first_nectar = "nectar_since" not in state
    nectar_seen = False
    for s in snap["sailings"]:
        sid, p = s["id"], round(s["price_pp"])
        src = s.get("price_source")
        page_seen |= src == "page"
        seen.add(sid)
        cab = s.get("cabins")
        lc = lead_cabin(p, cab)
        rec = sailings.get(sid)
        if rec is None:
            rec = {"first_seen": today, "segments": [{"p": p, "from": today, "c": lc}]}
            run["new"].append(sid)
        else:
            if rec.get("removed"):
                rec.pop("removed", None)
                run["returned"].append(sid)
            last = rec["segments"][-1]
            if src == "feed":
                pass   # page prices unreadable this check: keep the last "from" price, don't use the feed's
            elif switching and src == "page" and p != last["p"]:
                rec["segments"].append({"p": p, "from": today, "c": lc, "switch": True})
                run["lead_source_switch"].append({"id": sid, "from": last["p"], "to": p})
            elif p != last["p"]:
                rec["segments"].append({"p": p, "from": today, "c": lc})
                ev = {"id": sid, "from": last["p"], "to": p}
                if last.get("c") and lc and last["c"] != lc:
                    ev["mix"] = f"{last['c']} → {lc}"
                (run["drops"] if p < last["p"] else run["rises"]).append(ev)
            elif lc and not last.get("c"):
                last["c"] = lc
        rec.update({k: s.get(k) for k in META})
        rec["last_seen"] = today
        if cab is not None and "page_error" not in s:
            update_cabins(rec, cab, today, run, sid)
        # "offers" is missing when the page couldn't be read: leave promotions as they were.
        if s.get("offers") is not None and "page_error" not in s:
            update_promos(rec, s["offers"], today, run, sid, catalogue, first_promos)
            promos_seen = True
        if s.get("nectar") is not None and "page_error" not in s:
            update_nectar(rec, s, today, run, sid, first_nectar)
            nectar_seen = True
        sailings[sid] = rec
        if s.get("flags"):
            run["flags"][sid] = s["flags"]
    for sid, rec in sailings.items():
        if sid not in seen and not rec.get("removed"):
            rec["removed"] = today
            run["removed"].append(sid)
            close_promos(rec, today, run, sid, catalogue)
    for sid, rec in sailings.items():
        claim = was_now(rec, today, rules)
        if claim:
            rec["claim"] = claim
            if claim["eligible"]:
                run["eligible"].append({"id": sid, **claim})
        else:
            rec.pop("claim", None)
        cc = cabin_claims(rec, today, rules)
        if cc:
            rec["cabin_claims"] = cc
            lead = rec.get("claim") or {}
            lead_c = rec["segments"][-1].get("c")
            for key, c in cc.items():
                # The cabin that sets the lead price repeats the lead claim.
                same = lead.get("eligible") and key == f"twin.{lead_c}" and c["now"] == lead.get("now")
                if c["eligible"] and not same:
                    run["cabin_eligible"].append({"id": sid, "cabin": key, **c})
        else:
            rec.pop("cabin_claims", None)
    for d in run["drops"]:
        d["claim"] = sailings[d["id"]].get("claim")
    for d in run["cabin_drops"]:
        d["claim"] = (sailings[d["id"]].get("cabin_claims") or {}).get(d["cabin"])
    # Keep the document well under the 256 KB limit: forget sailings that left
    # the feed more than 60 days ago (they have departed or been withdrawn).
    for sid in [k for k, v in sailings.items() if v.get("removed") and days(v["removed"], today) > 60]:
        del sailings[sid]
    # Forget promotions no sailing has shown for 120 days.
    for oid in [k for k, v in catalogue.items() if v.get("last_seen") and days(v["last_seen"], today) > 120]:
        del catalogue[oid]
    new_state = {"updated": today, "tracking_since": state.get("tracking_since", today),
                 "cabins_since": state.get("cabins_since", today),
                 "rules": rules, "sailings": sailings}
    if promos_seen and first_promos:
        run["promo_tracking_started"] = True
    if page_seen or "lead_from_page_since" in state:
        new_state["lead_from_page_since"] = state.get("lead_from_page_since", today)
    if not run["lead_source_switch"]:
        run.pop("lead_source_switch")
    if nectar_seen or "nectar_since" in state:
        new_state["nectar_since"] = state.get("nectar_since", today)
    if promos_seen or "promos_since" in state:
        new_state["promos_since"] = state.get("promos_since", today)
        new_state["offers"] = catalogue
    return new_state, run


def seed_cabins(state, snap):
    """Start cabin tracking on an existing state without touching lead prices."""
    today = snap["date"]
    by = {s["id"]: s for s in snap["sailings"]}
    for sid, rec in state.get("sailings", {}).items():
        s = by.get(sid)
        if not s or s.get("cabins") is None:
            continue
        rec["cabins"] = {f"{occ}.{c}": {"seg": [{"p": round(p), "from": today}]}
                         for occ, types in s["cabins"].items() for c, p in types.items()}
        for seg in rec["segments"]:
            if not seg.get("c"):
                seg["c"] = lead_cabin(seg["p"], s["cabins"])
    state["cabins_since"] = today
    return state


def split(state):
    """Cabin data lives in its own document (state/cabins) so the main state
    stays well under the 256 KB document limit."""
    cab = {}
    for sid, rec in state.get("sailings", {}).items():
        part = {k: rec.pop(k) for k in ("cabins", "cabin_claims", "nectar_grades") if k in rec}
        if part:
            cab[sid] = part
    return state, {"updated": state.get("updated"), "cabins_since": state.get("cabins_since"), "sailings": cab}


def merge(state, cabdoc):
    for sid, part in ((cabdoc or {}).get("sailings") or {}).items():
        if sid in state.get("sailings", {}):
            state["sailings"][sid].update(part)
    if cabdoc and cabdoc.get("cabins_since"):
        state["cabins_since"] = cabdoc["cabins_since"]
    return state


def load(path):
    if not path or not Path(path).exists():
        return {}
    d = json.loads(Path(path).read_text())
    return d.get("data", d)  # accept a raw ArtifactData read file


def write(o, name, doc):
    (o / name).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    return (o / name).stat().st_size


if __name__ == "__main__":
    # tracker.py [--seed-cabins] STATE.json SNAPSHOT.json OUT_DIR [CABINS.json]
    # writes OUT_DIR/state.json, OUT_DIR/cabins.json (and run.json unless seeding)
    args = sys.argv[1:]
    seed = args[0] == "--seed-cabins"
    if seed:
        args = args[1:]
    sp, snp, out = args[:3]
    cp = args[3] if len(args) > 3 else None
    state = merge(load(sp), load(cp))
    snap = json.loads(Path(snp).read_text())
    o = Path(out)
    o.mkdir(parents=True, exist_ok=True)
    if seed:
        st, cab = split(seed_cabins(state, snap))
        print("seeded cabins; state bytes:", write(o, "state.json", st), "cabins bytes:", write(o, "cabins.json", cab))
        sys.exit()
    st, run = update(state, snap)
    st, cab = split(st)
    a, b = write(o, "state.json", st), write(o, "cabins.json", cab)
    write(o, "run.json", run)
    print(json.dumps({k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in run.items()}))
    print("state bytes:", a, "cabins bytes:", b)
    if max(a, b) > 230_000:
        print("WARNING: a document is close to the 256 KB limit")
