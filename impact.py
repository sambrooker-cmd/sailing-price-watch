"""What price moves and offers actually did (Sam, 17 Oct 2026: point 2 of the new ideas, "the team's own evidence").

After each GA4 read (same workflow step as ga4.py, so it runs once a UK day; it only uses saved files): every change to
a sailing on sale is found in our own history, and the interest in that sailing's page in the 7 days before and the 7
days after is compared with the interest in similar sailings that didn't change over the same days. Changes:
  - price_cut / price_rise: the lead (cheapest twin) price at the end of a day against the end of the day before, for the
    same cabin grade only. A cheaper grade coming on sale or the cheapest grade selling out ("mix") is not a price move
    and isn't counted, nor is the 13 Oct 2026 switch from feed to page prices (`switch`) or a sailing coming back (`back`).
  - offer_start / offer_end: a promotion appearing on or leaving the sailing, after promotion recording began (state
    `promos_since`; ones running then didn't "start"), typed like site/offerkit.js (onboard credit, discount, …).
Similar sailings ("control"): same no-fly / fly-cruise, departing within CONTROL_DAYS of it, with no change of their own
from 7 days before to 7 days after, and at least MIN_BEFORE views in the week before. The **lift** is how much more (or
less) the sailing's interest moved than theirs: exp(log(after / before) − median of the controls' log(after / before)) − 1.
The same for booking clicks when there are enough (MIN_CLICKS before and after together).
An event is only scored once its 7 days after are complete inside the GA4 window; it's flagged and left out of the summary
when another change hit the same sailing within 7 days (`mixed`), its week before had under MIN_BEFORE views (`thin`),
or fewer than MIN_CONTROLS similar sailings could be compared (`few_controls`). Scored events are kept for good, so the
evidence grows past GA4's 90-day window. Read-only: only reads state/current.json and state/ga4/demand.json.

→ state/ga4/impact.json {updated, events: {key: {id, d, kind, detail, pct, types, before, after, cb, ca, ctrl_n, ctrl,
   ctrl_c, lift, lift_c, flags}}} → publish.py pricewatch/ga4-impact → tracker page Prices → What moved interest.

    python impact.py
"""
import datetime as dt, json, math, re, statistics, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "state" / "current.json"
GA4 = ROOT / "state" / "ga4" / "demand.json"
OUT = ROOT / "state" / "ga4" / "impact.json"
WINDOW = 7            # days before and after
CONTROL_DAYS = 90     # similar sailings depart within this many days
MIN_BEFORE = 20       # views in the week before, for the sailing and its controls
MIN_CONTROLS = 3
MIN_CLICKS = 10

# Offer types, as site/offerkit.js TYPES (keep in step)
TYPES = [
    ("obc", r"on ?board (credit|spend|spending|money)|\bobc\b|spending money|bar (credit|tab)"),
    ("discount", r"\d+\s?%\s*(off|saving|discount|reduction)|save (up to )?[£$€]?\d|up to \d+\s?% |[£$€]\d[\d,]*\s*off\b|\b(reduced|lower|cheaper)\b[^.]{0,25}\b(fares?|prices?|supplement)|price (drop|cut)|\bsavings?\b|\bsale\b|discount|reduction"),
    ("deposit", r"deposit"),
    ("extras", r"free (drinks?|bubbles|bottle|gratuit|tips|wi-?fi|internet|upgrade|dining|package|excursion)|drinks? package|all[- ]inclusive|inclusive|signature package|\bpackages?\b|upgrade"),
    ("loyalty", r"past (passenger|guest)|loyalty|voyager club|returning guest|previous(ly)? (sailed|guest)"),
    ("people", r"\bsolo\b|single (supplement|cabin|traveller)|\bsingles?\b|child|\bkids?\b|famil"),
    ("travel", r"coach|transfer|door[- ]to[- ]door|flight|upper class|\bparking\b|\brail\b"),
    ("urgency", r"flash|last[- ]minute|late (deal|saver|cruise)|limited time|must end|today only|pre[- ]?register|launch"),
]


def types_of(text):
    ks = [k for k, rx in TYPES if re.search(rx, text, re.I)]
    if re.search(r"flight|upper class|\bseats?\b", text, re.I) and "travel" in ks:
        ks = [k for k in ks if k != "discount"]
    return ks


def day(s, n):
    return (dt.date.fromisoformat(s) + dt.timedelta(days=n)).isoformat()


def closing(segs):
    """The lead price and grade at the end of each day it changed: [(date, p, c, flag)]"""
    out = {}
    for s in segs:
        out[s["from"]] = (s.get("p"), s.get("c"), "switch" if s.get("switch") else "back" if s.get("back") else "")
    return sorted((d, *v) for d, v in out.items())


def events_of(code, s, offers, promos_since):
    ev = []
    days = closing(s.get("segments") or [])
    for (d0, p0, c0, _), (d1, p1, c1, f1) in zip(days, days[1:]):
        if f1 or p0 is None or p1 is None or p0 == p1:
            continue
        if not c0 or not c1 or c0 != c1:   # a different cabin grade sets the price: not a price move
            continue
        pct = (p1 / p0 - 1) * 100
        ev.append({"id": code, "d": d1, "kind": "price_cut" if p1 < p0 else "price_rise", "detail": f"£{p0:,} → £{p1:,} ({c1.replace('_', ' ')})",
                   "pct": round(pct, 1), "types": []})
    for oid, spans in (s.get("promos") or {}).items():
        o = offers.get(oid) or {}
        name = o.get("name") or oid
        ts = types_of(f"{name} {o.get('desc') or ''}")
        for f, to in spans:
            if promos_since and f > promos_since:
                ev.append({"id": code, "d": f, "kind": "offer_start", "detail": name, "pct": None, "types": ts})
            if to:
                ev.append({"id": code, "d": to, "kind": "offer_end", "detail": name, "pct": None, "types": ts})
    return ev


def window_sum(arr, i, j):
    return sum(arr[i:j]) if arr and 0 <= i and j <= len(arr) else None


def main():
    st = json.loads(STATE.read_text())
    g = json.loads(GA4.read_text()) if GA4.exists() else {}
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    kept = old.get("events") or {}
    if not g.get("sailings"):
        print("Impact: no GA4 figures yet")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({"updated": st.get("updated"), "events": kept}, ensure_ascii=False, separators=(",", ":")))
        return 0
    start, n = g["start"], g["days"]
    idx = lambda d: (dt.date.fromisoformat(d) - dt.date.fromisoformat(start)).days   # noqa: E731
    S, offers = st.get("sailings") or {}, st.get("offers") or {}
    G = g["sailings"]
    allev = {c: events_of(c, s, offers, st.get("promos_since")) for c, s in S.items()}
    busy = {c: sorted({e["d"] for e in evs}) for c, evs in allev.items()}

    def quiet(c, d):   # no change of its own from 7 days before to 7 days after
        return not any(day(d, -WINDOW) <= x <= day(d, WINDOW) for x in busy.get(c, []))

    def ratio(a, b):
        return math.log((a + 1) / (b + 1))

    new = 0
    for c, evs in allev.items():
        s, r = S[c], G.get(c) or {}
        v, k = r.get("views") or [], r.get("clicks_d") or []
        for e in evs:
            key = f"{e['id']}|{e['d']}|{e['kind']}|{e['detail']}"
            if key in kept:
                continue
            i = idx(e["d"])
            if i - WINDOW < 0 or i + WINDOW > n or not v:   # not inside the GA4 window, or the week after isn't complete yet
                continue
            before, after = window_sum(v, i - WINDOW, i), window_sum(v, i, i + WINDOW)
            cb, ca = (window_sum(k, i - WINDOW, i), window_sum(k, i, i + WINDOW)) if k else (None, None)
            fly = bool(s.get("flight_from"))
            ctrl, ctrl_c = [], []
            for c2, s2 in S.items():
                r2 = G.get(c2) or {}
                v2 = r2.get("views") or []
                if c2 == c or not v2 or bool(s2.get("flight_from")) != fly or not s2.get("departure_date") or not s.get("departure_date"):
                    continue
                if abs((dt.date.fromisoformat(s2["departure_date"]) - dt.date.fromisoformat(s["departure_date"])).days) > CONTROL_DAYS:
                    continue
                if s2["departure_date"] <= day(e["d"], WINDOW) or not quiet(c2, e["d"]):
                    continue
                b2, a2 = window_sum(v2, i - WINDOW, i), window_sum(v2, i, i + WINDOW)
                if b2 is None or b2 < MIN_BEFORE:
                    continue
                ctrl.append(ratio(a2, b2))
                k2 = r2.get("clicks_d") or []
                if k2:
                    kb, ka = window_sum(k2, i - WINDOW, i), window_sum(k2, i, i + WINDOW)
                    if kb is not None and kb + ka >= MIN_CLICKS:
                        ctrl_c.append(ratio(ka, kb))
            flags = []
            if any(x != e["d"] and abs((dt.date.fromisoformat(x) - dt.date.fromisoformat(e["d"])).days) <= WINDOW for x in busy[c]) \
                    or sum(1 for x in evs if x["d"] == e["d"]) > 1:
                flags.append("mixed")
            if before < MIN_BEFORE:
                flags.append("thin")
            if len(ctrl) < MIN_CONTROLS:
                flags.append("few_controls")
            med = statistics.median(ctrl) if ctrl else None
            lift = math.exp(ratio(after, before) - med) - 1 if med is not None else None
            lift_c = None
            if cb is not None and cb + ca >= MIN_CLICKS and len(ctrl_c) >= MIN_CONTROLS:
                lift_c = math.exp(ratio(ca, cb) - statistics.median(ctrl_c)) - 1
            kept[key] = {**e, "before": before, "after": after, "cb": cb, "ca": ca, "ctrl_n": len(ctrl),
                         "ctrl": round(math.exp(med) - 1, 3) if med is not None else None,
                         "ctrl_c": round(math.exp(statistics.median(ctrl_c)) - 1, 3) if len(ctrl_c) >= MIN_CONTROLS else None,
                         "lift": round(lift, 3) if lift is not None else None, "lift_c": round(lift_c, 3) if lift_c is not None else None,
                         "flags": flags, "scored": g.get("read_on")}
            new += 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": g.get("read_on"), "ga4_end": g.get("end"), "window": WINDOW, "events": dict(sorted(kept.items()))},
                              ensure_ascii=False, separators=(",", ":")))
    clean = [x for x in kept.values() if not x["flags"]]
    print(f"Impact: {new} newly scored, {len(kept)} in all ({len(clean)} without flags)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
