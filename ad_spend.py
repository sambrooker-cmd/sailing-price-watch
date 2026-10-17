"""Meta ad spend by sailing, estimated two ways (Sam, 17 Oct 2026: "spend by sailing estimated from both sailing carousel
card clicks but also estimated spend from page views driven from the ads to each sailing").

Runs right after `meta_manage.py read` (hourly step "Meta ads (read our account)"); it only uses saved files:
state/meta/spend.json (meta_manage.read_spend: spend per ad per day, link clicks per carousel card per day, each ad's cards
and sailings) and state/ga4/demand.json (ga4.py `meta_views`: views in visits from our Meta ads, per page, day and UTM
campaign). Each ad's spend on each day is shared out:

  a. by card clicks: a carousel's spend in proportion to the link clicks on each card that day (a card's sailing is its
     link /cruise/<code>-…; opening and closing cards → "_cards"). No card clicks that day → the ad's card clicks over
     every day read; none at all → evenly over its sailing cards. A single image or video ad goes to its sailing(s)
     evenly; an ad with no sailing link → "_nolink".
  b. by page views: in proportion to the page views in visits that came from that ad, matched by the visit's UTM campaign
     (GA4 sessionCampaignName) against the ad's id or name, else its ad set's, else its campaign's (case and punctuation
     ignored). Pages that aren't sailings → "_other". An ad with no matching UTM campaign shares the views of the visits
     whose UTM campaign matched nothing ("pooled"); no such visits that day → "_unplaced"; a match with no visits that
     day → "_noviews". Days outside GA4's window (or before GA4 is connected) → no figure (null).

Both are estimates: spend isn't recorded by sailing. Rounded to the penny; totals per day equal the ad's spend.

→ state/meta/spend_by_sailing.json {updated, currency, from, to, ga4: {start, end}, problem, rows: {code: {Meta campaign
   id: [[date, by cards, by views, views from that campaign]]}}, campaigns: {id: {name, ads: [ad names]}}, utm: [[UTM
   campaign, views, matched to]], methods: {how: spend}} → publish.py pricewatch/meta-spend → Creative → Campaign results.

    python ad_spend.py
"""
import datetime as dt, json, re, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEND = ROOT / "state" / "meta" / "spend.json"
GA4 = ROOT / "state" / "ga4" / "demand.json"
ADS = ROOT / "state" / "meta" / "ads.json"
OUT = ROOT / "state" / "meta" / "spend_by_sailing.json"


def norm(t):
    return re.sub(r"[^a-z0-9]+", "", str(t or "").lower())


def by_cards(info, today_clicks, all_clicks):
    """Share of an ad's spend per sailing ("_cards" for opening/closing cards), and how it was worked out."""
    cards = info.get("cards") or []
    if cards:
        def place(counts):
            out = defaultdict(float)
            for k, n in counts.items():
                cid, _, cn = k.partition("|")
                hits = [c for c in cards if cn and norm(c[1]) == norm(cn)]
                if not hits and cid.isdigit() and int(cid) < len(cards):   # some answers give the card's position
                    hits = [cards[int(cid)]]
                for c in hits:
                    out[c[0] or "_cards"] += n / len(hits)
            return out
        for counts, how in ((today_clicks, "card clicks that day"), (all_clicks, "the ad's card clicks over every day")):
            out = place(counts or {})
            tot = sum(out.values())
            if tot:
                return {k: v / tot for k, v in out.items()}, how
        sc = [c[0] for c in cards if c[0]]
        if sc:
            return {c: sc.count(c) / len(sc) for c in set(sc)}, "evenly over its cards (no card clicks)"
    codes = info.get("codes") or []
    if codes:
        return {c: 1 / len(codes) for c in codes}, "its sailing (single image or video)"
    return {"_nolink": 1.0}, "no sailing link"


def share_out(amount, shares):
    """Split an amount by shares, to the penny, keeping the total exact."""
    keys = sorted(shares, key=lambda k: -shares[k])
    tot = sum(shares.values()) or 1
    out, left = {}, round(amount, 2)
    for k in keys[:-1]:
        v = round(amount * shares[k] / tot, 2)
        out[k], left = v, round(left - v, 2)
    out[keys[-1]] = left
    return out


def main():
    if not SPEND.exists():
        ads = json.loads(ADS.read_text()) if ADS.exists() else {}
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({"problem": "setup" if ads.get("problem") == "setup" or not ads else "no spend read yet", "rows": {}}))
        print("Ad spend: no spend read yet")
        return 0
    sp = json.loads(SPEND.read_text())
    g = json.loads(GA4.read_text()) if GA4.exists() else {}
    acct = (json.loads(ADS.read_text()).get("account") or {}) if ADS.exists() else {}
    info, camps, sets = sp.get("ads") or {}, sp.get("campaigns") or {}, sp.get("adsets") or {}
    mv = g.get("meta_views") or {}
    gstart = g.get("start") if mv else None
    # views by day index → UTM campaign → page
    V = defaultdict(lambda: defaultdict(dict))
    tot_utm = defaultdict(int)
    for page, cs in mv.items():
        for utm, pts in cs.items():
            for i, v in pts:
                V[int(i)][utm][page] = V[int(i)][utm].get(page, 0) + v
                tot_utm[utm] += v
    # UTM campaign → the ad, ad set or campaign it names (id or name)
    keys = {"ad": defaultdict(set), "adset": defaultdict(set), "campaign": defaultdict(set)}
    for i, a in info.items():
        for k in (i, a.get("name")):
            if norm(k):
                keys["ad"][norm(k)].add(i)
    for i, n in sets.items():
        for k in (i, n):
            if norm(k):
                keys["adset"][norm(k)].add(i)
    for i, n in camps.items():
        for k in (i, n):
            if norm(k):
                keys["campaign"][norm(k)].add(i)
    match = {}
    for utm in tot_utm:
        for lvl in ("ad", "adset", "campaign"):
            hit = keys[lvl].get(norm(utm))
            if hit:
                match[utm] = (lvl, hit)
                break
    unmatched = [u for u in tot_utm if u not in match]
    # each ad's card clicks over every day (the fallback)
    allc = defaultdict(lambda: defaultdict(int))
    for d, per in (sp.get("cards") or {}).items():
        for ad, cs in per.items():
            for k, n in cs.items():
                allc[ad][k] += n
    rows = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, None, 0.0])))
    methods = defaultdict(float)
    ga4_days = set()   # days GA4's figures cover: a page-view figure (0 when nothing was placed on that sailing)
    for d, per in sorted((sp.get("days") or {}).items()):
        i = (dt.date.fromisoformat(d) - dt.date.fromisoformat(gstart)).days if gstart else None
        inside = i is not None and 0 <= i < (g.get("days") or 0)
        day_v = V.get(i, {}) if inside else {}
        # pooled spend per campaign (ads with no UTM match), to give each campaign its part of the pooled views
        pooled_spend = defaultdict(float)
        for ad, (s, _, _) in per.items():
            a = info.get(ad) or {}
            cid = a.get("campaign") or ""
            # a. card clicks
            sh, how = by_cards(a, (sp.get("cards") or {}).get(d, {}).get(ad), allc.get(ad))
            methods[how] += s
            for code, v in share_out(s, sh).items():
                rows[code][cid][d][0] += v
            if not inside:
                continue
            # b. page views from the ad (matched UTM campaign: the ad itself, else its ad set, else its campaign)
            utms = []
            for lvl, oid in (("ad", ad), ("adset", a.get("adset")), ("campaign", cid)):
                utms = [u for u, (l, ids) in match.items() if l == lvl and oid in ids]
                if utms:
                    break
            if utms:
                pages = defaultdict(float)
                for u in utms:
                    for p, v in day_v.get(u, {}).items():
                        pages[p] += v
                tgt = pages if sum(pages.values()) else {"_noviews": 1}
            else:
                pages = defaultdict(float)
                for u in unmatched:
                    for p, v in day_v.get(u, {}).items():
                        pages[p] += v
                tgt = pages if sum(pages.values()) else {"_unplaced": 1}
                if sum(pages.values()):
                    pooled_spend[cid] += s
            for code, v in share_out(s, tgt).items():
                r = rows[code][cid][d]
                r[1] = (r[1] or 0) + v
        if not inside:
            continue
        ga4_days.add(d)
        # views from each Meta campaign: its matched UTM campaigns' views, plus its part of the pooled views
        for u, (lvl, ids) in match.items():
            owners = set()
            for oid in ids:
                owners.add(oid if lvl == "campaign" else (info.get(oid) or {}).get("campaign") if lvl == "ad" else
                           next(((x.get("campaign")) for x in info.values() if x.get("adset") == oid), None))
            owners.discard(None)
            for cid in owners:
                for p, v in day_v.get(u, {}).items():
                    rows[p][cid][d][2] += v / len(owners)
        tot_pool = sum(pooled_spend.values())
        if tot_pool:
            for u in unmatched:
                for p, v in day_v.get(u, {}).items():
                    for cid, s in pooled_spend.items():
                        rows[p][cid][d][2] += v * s / tot_pool
    out_rows = {}
    for code, cs in sorted(rows.items()):
        for cid, ds in cs.items():
            pts = [[d, round(a, 2), (round(b or 0, 2) if d in ga4_days else None), round(v, 1)] for d, (a, b, v) in sorted(ds.items()) if a or b or v]
            if pts:
                out_rows.setdefault(code, {})[cid] = pts
    names = defaultdict(set)
    for a in info.values():
        names[a.get("campaign") or ""].add(a.get("name") or "")
    doc = {"updated": sp.get("read_on"), "currency": acct.get("currency") or "GBP", "from": sp.get("from"), "to": sp.get("to"),
           "ga4": {"start": g.get("start"), "end": g.get("end")} if mv else None, "problem": "",
           "rows": out_rows, "campaigns": {cid: {"name": camps.get(cid, ""), "ads": sorted(n for n in names[cid] if n)[:200]} for cid in sorted(set(camps) | set(names))},
           "utm": sorted(([u, n, f"{match[u][0]}: " + ", ".join(sorted(camps.get(x) if match[u][0] == "campaign" else sets.get(x) if match[u][0] == "adset" else (info.get(x) or {}).get("name") or x for x in match[u][1]))
                           if u in match else ""] for u, n in tot_utm.items()), key=lambda x: -x[1])[:60],
           "methods": {k: round(v, 2) for k, v in sorted(methods.items(), key=lambda x: -x[1])}}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    tot = sum(x[1] for cs in out_rows.values() for pts in cs.values() for x in pts)
    print(f"Ad spend: £{tot:,.2f} placed on {len([c for c in out_rows if not c.startswith('_')])} sailings by card clicks; "
          f"{len(match)} of {len(tot_utm)} UTM campaigns matched to the account")
    return 0


if __name__ == "__main__":
    sys.exit(main())
