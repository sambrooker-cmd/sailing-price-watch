"""Our own Meta ads, kept in step with the tracker (Sam, 17 Oct 2026: "I plan to automate the updates in Meta Ads",
"I'd like to do it that way as well"; the hard rule was changed by Sam that day: see CLAUDE.md). Stage 1.

Two commands:

  python meta_manage.py read
      Hourly workflow step "Meta ads (read our account)", `continue-on-error`. Reads the ad account (Marketing API,
      read access): the account, campaigns, ad sets (budgets, bids, schedule), ads with their creative's words and
      links, and 7 days of results per ad. Each ad is matched to the sailings its links point at (/cruise/<code>-…),
      then compared with the tracker's saved data to make **proposals**, nothing more:
        - pause:   a running ad whose sailings are all off sale or departed; or one whose words make a price-reduction
                   claim ("was £", "save £", …) with no claim live today (hard rule: was/now only from a live claim,
                   and stopped on its end date) → urgent
        - text:    a running ad whose words quote a £ price that's no longer the linked sailing's price; the new words
                   swap in today's price (a carousel card's own sailing, or "from £N" the cheapest of the ad's
                   sailings) and keep everything else
        - notes:   things a person must do (stage 2 will remake creative): some sailings off sale, the picture may
                   show an older price (a linked sailing's price moved after the ad last changed), words quoting a
                   price that can't be swapped automatically, an ad made from a page post
      → state/meta/ads.json → publish.py pricewatch/meta-ads → tracker page Creative → Meta ads, where an approver
      presses Approve or Reject. A rejected token → out/meta_manage_problem.md → "Meta ads: token needs renewing".

  python meta_manage.py apply <request id>
      The "Meta ads: apply" workflow (meta-apply.yml), started by the Firebase function `metaAction` when an approver
      presses Approve or makes a change by hand. Reads the request (Firestore pricewatch_meta/<id>), reads the account
      again and only then acts:
        - approve: the proposal is worked out afresh from today's account and data; only if it still exists, with the
          same id, is it applied (so nothing stale or made up in the browser can be sent)
        - manual: pause / resume an ad, ad set or campaign; change an ad set's or campaign's daily or lifetime budget
          (at most MAX_STEP × the current one per change, and a daily budget never above META_MAX_DAILY_BUDGET);
          change an ad set's bid or end date
      A text change makes a new creative (a copy of the old one with the new words; Meta reviews it again) and points
      the ad at it. Writes the outcome on the request. Budgets, bids and targeting are only ever changed by hand from
      the page, never proposed.

Stage 2 (17 Oct 2026, built before the account is connected): op `publish` (the Ad creator's "Publish to Meta": its share
code rendered headless with today's prices into images or a 10-second video, a new creative and a PAUSED ad; remembered in
state/meta/published.json), proposal `remake` for tracker-made ads whose printed facts changed (card_facts), and manual
`targeting` (ages, gender, countries) for ad sets. See CLAUDE.md.

Setup (Sam, one-off): Meta Business Settings → Users → System users → Add (Admin or Employee) → Assign assets: the ad
account (Manage campaigns) and the Facebook page → Generate new token for the app, permissions ads_management, ads_read
(and pages_read_engagement, business_management if asked), no expiry → repo secret META_ADS_TOKEN; repo variable
META_AD_ACCOUNT_ID (the number after act_, from Ads Manager's account menu). Optional repo variables
META_API_VERSION (as for the competitor ads) and META_MAX_DAILY_BUDGET (pounds, default 500). The token goes to
graph.facebook.com in a header only: never in a URL, a log or a file.
"""
import datetime as dt, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "state" / "meta" / "ads.json"
PROBLEM = ROOT / "out" / "meta_manage_problem.md"
URGENT = ROOT / "out" / "meta_urgent.md"
PUBLISHED = ROOT / "state" / "meta" / "published.json"   # ads the tracker made: {ad id: {code, kind, size, fp, facts, at, by}}
CTA = {"Learn more": "LEARN_MORE", "Book now": "BOOK_TRAVEL", "See more": "SEE_MORE", "Get offer": "GET_OFFER"}
VIDEO_SIZE, VIDEO_LENGTH = "4x5", 10   # published videos: feed size, 10 seconds (make_video.py)
VERSION = os.environ.get("META_API_VERSION", "").strip()
API = "https://graph.facebook.com/" + (VERSION + "/" if VERSION else "")
MAX_STEP = 2.0                      # a budget can at most double (or halve) in one change
MAX_DAILY = int(float(os.environ.get("META_MAX_DAILY_BUDGET") or 500) * 100)   # minor units
CODE = re.compile(r"/cruise/([a-z]\d{4,}[a-z]{0,3})-", re.I)
REDUCE = re.compile(r"\bwas\s*£|\bnow only\b|\bnow just\b|\breduced\b|\breduction\b|\bprice (drop|cut)s?\b|\bslashed\b|\bsave\s*£|£\s?\d[\d,]*\s*off\b|\blower (fares|prices)\b|\bhalf price\b", re.I)
POUNDS = re.compile(r"£\s?(\d+(?:,\d{3})*)")
RUNNING = {"ACTIVE", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED"}


class TokenProblem(Exception):
    pass


calls = 0


def call(method, path, token, params=None, data=None):
    """One Graph API request; the token travels in the Authorization header only."""
    global calls
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    body = urllib.parse.urlencode({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in data.items()}).encode() if data else None
    for attempt in (1, 2):
        calls += 1
        req = urllib.request.Request(url, data=body, method=method, headers={"Authorization": f"Bearer {token}", "User-Agent": "AmbassadorPriceWatch/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode()).get("error", {})
            except ValueError:
                err = {}
            code, msg = err.get("code"), str(err.get("error_user_msg") or err.get("message") or e.reason)[:300]
            if code == 190 or e.code == 401:
                raise TokenProblem(f"Meta rejected the token: {msg}")
            if code in (10, 200, 294) or "permission" in msg.lower():
                raise TokenProblem(f"Meta refused access to the ad account: {msg}")
            if attempt == 1 and (e.code >= 500 or code in (1, 2, 4, 17, 32, 613, 80004)):
                time.sleep(20)
                continue
            raise RuntimeError(f"Meta answered {e.code}: {msg}")


def every(path, token, params):
    out, after = [], None
    for _ in range(20):
        j = call("GET", path, token, {**params, "limit": 200, **({"after": after} if after else {})})
        out += j.get("data", [])
        after = ((j.get("paging") or {}).get("cursors") or {}).get("after")
        if not after or not (j.get("paging") or {}).get("next"):
            return out
    return out


# ---------- reading the account ----------
AD_FIELDS = ("id,name,status,effective_status,configured_status,adset_id,campaign_id,created_time,updated_time,"
             "creative{id,name,object_type,thumbnail_url,effective_object_story_id,object_story_spec,asset_feed_spec}")


def read_account(token, acct):
    a = call("GET", f"act_{acct}", token, {"fields": "name,currency,timezone_name,account_status"})
    camps = every(f"act_{acct}/campaigns", token, {"fields": "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy",
                                                    "effective_status": json.dumps(["ACTIVE", "PAUSED"])})
    sets = every(f"act_{acct}/adsets", token, {"fields": "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_amount,bid_strategy,start_time,end_time,optimization_goal,targeting",
                                                "effective_status": json.dumps(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"])})
    ads = every(f"act_{acct}/ads", token, {"fields": AD_FIELDS, "effective_status": json.dumps(sorted(RUNNING | {"PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "DISAPPROVED"}))})
    ins = {}
    try:
        for r in every(f"act_{acct}/insights", token, {"level": "ad", "date_preset": "last_7d", "fields": "ad_id,spend,impressions,clicks,ctr"}):
            ins[r["ad_id"]] = {"spend": float(r.get("spend") or 0), "imp": int(r.get("impressions") or 0), "clicks": int(r.get("clicks") or 0)}
    except RuntimeError as e:
        print("Meta ads: results not read:", e)
    return a, camps, sets, ads, ins


def pieces(cr):
    """Every piece of text and link in a creative, with where it sits: [(path, kind, value)]."""
    out = []
    oss, afs = cr.get("object_story_spec") or {}, cr.get("asset_feed_spec") or {}
    ld, vd = oss.get("link_data") or {}, oss.get("video_data") or {}
    for k, kind in (("message", "text"), ("name", "text"), ("description", "text"), ("link", "link"), ("caption", "text")):
        if ld.get(k):
            out.append((("object_story_spec", "link_data", k), kind, ld[k]))
    for i, c in enumerate(ld.get("child_attachments") or []):
        for k, kind in (("name", "text"), ("description", "text"), ("link", "link")):
            if c.get(k):
                out.append((("object_story_spec", "link_data", "child_attachments", i, k), kind, c[k]))
    for k in ("message", "title", "link_description"):
        if vd.get(k):
            out.append((("object_story_spec", "video_data", k), "text", vd[k]))
    v = ((vd.get("call_to_action") or {}).get("value") or {}).get("link")
    if v:
        out.append((("object_story_spec", "video_data", "call_to_action", "value", "link"), "link", v))
    for key in ("bodies", "titles", "descriptions"):
        for i, x in enumerate(afs.get(key) or []):
            if x.get("text"):
                out.append((("asset_feed_spec", key, i, "text"), "text", x["text"]))
    for i, x in enumerate(afs.get("link_urls") or []):
        if x.get("website_url"):
            out.append((("asset_feed_spec", "link_urls", i, "website_url"), "link", x["website_url"]))
    return out


def codes_of(ps):
    return sorted({m.group(1).upper() for _, kind, v in ps if kind == "link" for m in [CODE.search(v)] if m})


def card_code(cr, path):
    """The sailing a carousel card's own text belongs to (its own link)."""
    if len(path) > 3 and path[2] == "child_attachments":
        link = ((cr.get("object_story_spec") or {}).get("link_data") or {}).get("child_attachments", [])[path[3]].get("link", "")
        m = CODE.search(link or "")
        return m.group(1).upper() if m else None
    return None


# ---------- comparing with the tracker ----------
def load_state():
    st = json.loads((ROOT / "state" / "current.json").read_text())
    cab = json.loads((ROOT / "state" / "cabins.json").read_text()).get("sailings", {}) if (ROOT / "state" / "cabins.json").exists() else {}
    kit = json.loads((ROOT / "state" / "adkit.json").read_text()).get("sailings", {}) if (ROOT / "state" / "adkit.json").exists() else {}
    return st, cab, kit


def sailing_facts(code, st, cab, kit, today):
    r = (st.get("sailings") or {}).get(code)
    if not r or r.get("removed") or not (r.get("departure_date", "") > today) or not r.get("segments"):
        return None
    lead = r["segments"][-1]["p"]
    ok = {lead}
    for v in ((cab.get(code) or {}).get("cabins") or {}).values():
        s = (v.get("seg") or [{}])[-1]
        if s.get("p") is not None and not s.get("out"):
            ok.add(s["p"])
    claims = []
    c = r.get("claim") or {}
    if c.get("eligible") and (c.get("ends") or "") >= today and c.get("now") == lead:
        claims.append(c); ok |= {c["was"], c["now"]}
    for k, cc in ((cab.get(code) or {}).get("cabin_claims") or {}).items():
        if k.startswith("twin.") and cc.get("eligible") and (cc.get("ends") or "") >= today:
            claims.append(cc); ok |= {cc["was"], cc["now"]}
    figs = set()
    for t in ((kit.get(code) or {}).get("promos") or []) + [((kit.get(code) or {}).get("nectar") or "")]:
        figs |= {int(n.replace(",", "")) for n in re.findall(r"\d[\d,]*", t) if n.replace(",", "").isdigit()}
    last_move = r["segments"][-1].get("from")
    return {"lead": lead, "ok": ok, "figs": figs, "claims": claims, "moved": last_move, "title": r.get("base_title") or r.get("title")}


def pid(*parts):
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:12]


def set_at(obj, path, val):
    for p in path[:-1]:
        obj = obj[p]
    obj[path[-1]] = val


def proposals_for(ad, facts, today):
    """Proposals and notes for one ad, from its creative and the sailings it links to."""
    cr = ad.get("creative") or {}
    ps, codes = pieces(cr), codes_of(pieces(cr))
    running = ad.get("effective_status") in RUNNING
    out, notes = [], []
    if not codes:
        return out, ["No sailing pages linked: not checked against prices."] if running else []
    live = {c: facts.get(c) for c in codes}
    gone = [c for c, f in live.items() if not f]
    if not running:
        return out, notes
    text = " ".join(v for _, kind, v in ps if kind == "text")
    if len(gone) == len(codes):
        out.append({"id": pid(ad["id"], "pause", "offsale", ",".join(codes)), "ad": ad["id"], "kind": "pause", "urgent": True,
                    "why": f"Every sailing it links to is off sale or has departed ({', '.join(gone)})."})
        return out, notes
    if REDUCE.search(text) and not any(f and f["claims"] for f in live.values()):
        out.append({"id": pid(ad["id"], "pause", "claim", REDUCE.search(text).group(0)), "ad": ad["id"], "kind": "pause", "urgent": True,
                    "why": f"Its words make a price-reduction claim (\"{REDUCE.search(text).group(0).strip()}\") but none of its sailings has a was/now claim live today. Was/now must stop on the claim's end date."})
        return out, notes
    if gone:
        notes.append(f"Some sailings are off sale ({', '.join(gone)}): remake it without them (stage 2) or edit it in Ads Manager.")
    if not cr.get("object_story_spec") and not cr.get("asset_feed_spec"):
        notes.append("Made from a page post: its words can only be changed in Ads Manager.")
        return out, notes
    ok_all = set().union(*[f["ok"] | f["figs"] for f in live.values() if f])
    min_lead = min(f["lead"] for f in live.values() if f)
    changes, stuck = [], []
    for path, kind, v in ps:
        if kind != "text":
            continue
        own = card_code(cr, path)
        new = v
        for m in POUNDS.finditer(v):
            n = int(m.group(1).replace(",", ""))
            if n in ok_all:
                continue
            before = v[max(0, m.start() - 12):m.start()].lower()
            if own and live.get(own):
                want = live[own]["lead"]
            elif re.search(r"\b(from|only)\s*$", before):
                want = min_lead
            elif len([f for f in live.values() if f]) == 1:
                want = next(f for f in live.values() if f)["lead"]
            else:
                stuck.append(m.group(0)); continue
            new = new.replace(m.group(0), "£" + f"{want:,}", 1)
        if new != v:
            changes.append({"path": list(path), "old": v, "new": new})
    if changes:
        out.append({"id": pid(ad["id"], "text", json.dumps(changes, sort_keys=True)), "ad": ad["id"], "kind": "text",
                    "why": "Its words quote a price that's no longer on the website.", "changes": changes})
    if stuck:
        notes.append(f"Its words quote {', '.join(sorted(set(stuck)))}, not a current price, and it isn't clear which sailing is meant: change it in Ads Manager.")
    when = (ad.get("updated_time") or "")[:10]
    moved = [c for c, f in live.items() if f and f["moved"] and when and f["moved"] > when]
    if moved:
        notes.append(f"The price of {', '.join(moved)} changed after this ad last changed ({when}): its pictures may show an older price.")
    return out, notes


# ---------- ads the tracker made (stage 2: publish from the Ad creator, remake with today's prices) ----------
def unpack(code):
    """The Ad creator's share code (deflate-raw JSON, base64url) → the ad."""
    import base64, zlib
    d = json.loads(zlib.decompress(base64.urlsafe_b64decode(code + "=" * (-len(code) % 4)), -15))
    return d.get("ad") or d


def repack(ad):
    import base64, zlib
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return base64.urlsafe_b64encode(c.compress(json.dumps({"v": 1, "ad": ad}).encode()) + c.flush()).decode().rstrip("=")


def card_facts(ad, st, cab, kit, today):
    """What each card of a tracker-made ad prints today: [[code, price shown, was, live promos, nectar]] (gone → None)."""
    out = []
    for c in ad.get("cards") or []:
        cid = c.get("id")
        r = (st.get("sailings") or {}).get(cid)
        if not r or r.get("removed") or not (r.get("departure_date", "") > today) or not r.get("segments"):
            out.append([cid, None, None, [], ""]); continue
        lead, was, now = r["segments"][-1]["p"], None, None
        key = (c.get("design") or "").removeprefix("wasnow:") if (c.get("design") or "").startswith("wasnow:") else None
        if key == "lead":
            cl = r.get("claim") or {}
            if cl.get("eligible") and (cl.get("ends") or "") >= today and cl.get("now") == lead:
                was, now = cl["was"], cl["now"]
        elif key:
            cc = ((cab.get(cid) or {}).get("cabin_claims") or {}).get(key) or {}
            if cc.get("eligible") and (cc.get("ends") or "") >= today:
                was, now = cc["was"], cc["now"]
        k = kit.get(cid) or {}
        promos = [x for x in (c.get("promos") or []) if x in (k.get("promos") or [])]
        out.append([cid, now if now is not None else lead, was, promos, (k.get("nectar") or "") if c.get("nectar") else ""])
    return out


def fp_of(facts):
    return pid(json.dumps(facts, sort_keys=True))


def describe(old, new):
    """Plain words for what changed between two card_facts lists."""
    o, out = {x[0]: x for x in old}, []
    for n in new:
        b = o.get(n[0])
        if not b:
            continue
        if n[1] is None and b[1] is not None:
            out.append(f"{n[0]} is off sale (left out of the remake)")
            continue
        if b[1] != n[1]:
            out.append(f"{n[0]} £{b[1]:,} → £{n[1]:,}" if b[1] and n[1] else f"{n[0]} price changed")
        if b[2] and not n[2]:
            out.append(f"{n[0]}'s was/now claim has ended (its card goes back to the standard design)")
        for x in b[3]:
            if x not in n[3]:
                out.append(f"{n[0]}: \"{x.split(' · ')[0]}\" has ended")
        if b[4] != n[4]:
            out.append(f"{n[0]}: Nectar line now \"{n[4] or 'none'}\"")
    return out


def live_code(ad, kit):
    """The ad as it should be remade: offers that have ended taken off its cards (the Ad creator brings the rest up to date)."""
    ad = json.loads(json.dumps(ad))
    for c in ad.get("cards") or []:
        c["promos"] = [x for x in (c.get("promos") or []) if x in ((kit.get(c.get("id")) or {}).get("promos") or [])]
    return repack(ad)


def remake_proposal(ad_row_id, rec, st, cab, kit, today):
    ad = unpack(rec["code"])
    now = card_facts(ad, st, cab, kit, today)
    if fp_of(now) == rec.get("fp"):
        return None
    if all(x[1] is None for x in now):
        return {"id": pid(ad_row_id, "pause", "offsale-made"), "ad": ad_row_id, "kind": "pause", "urgent": True,
                "why": "Every sailing on it is off sale or has departed."}
    what = describe(rec.get("facts") or [], now) or ["what's printed on its cards has changed"]
    return {"id": pid(ad_row_id, "remake", fp_of(now)), "ad": ad_row_id, "kind": "remake", "urgent": any("was/now" in w for w in what),
            "why": "Made by the tracker; " + "; ".join(what) + ".", "fmt": rec.get("kind", "image")}


def upload_images(cards, token, acct):
    import base64
    hashes = []
    for i, c in enumerate(cards):
        j = call("POST", f"act_{acct}/adimages", token, data={"bytes": base64.b64encode(c["jpeg"]).decode(), "name": f"{i + 1:02d}_{c['name']}.jpg"})
        hashes.append(next(iter((j.get("images") or {}).values()))["hash"])
    return hashes


def upload_video(path, token, acct):
    import requests
    with open(path, "rb") as f:
        r = requests.post(API + f"act_{acct}/advideos", headers={"Authorization": f"Bearer {token}"}, files={"source": (Path(path).name, f, "video/mp4")}, timeout=600)
    if not r.ok:
        raise RuntimeError(f"Meta didn't take the video: {r.status_code} {r.text[:200]}")
    vid = r.json()["id"]
    for _ in range(40):   # Meta processes the upload before an ad can use it
        s = (call("GET", vid, token, {"fields": "status"}).get("status") or {}).get("video_status")
        if s == "ready":
            return vid
        if s == "error":
            raise RuntimeError("Meta couldn't process the video.")
        time.sleep(15)
    raise RuntimeError("Meta was still processing the video after 10 minutes: try again later.")


def page_ids():
    page = os.environ.get("META_PAGE_ID", "").strip() or (json.loads(OUT.read_text()).get("page_id") if OUT.exists() else "")
    if not page:
        raise ValueError("The Facebook page isn't known yet: set the repo variable META_PAGE_ID (or wait until an ad has been read).")
    ig = os.environ.get("META_INSTAGRAM_ID", "").strip()
    return page, ig


def build_creative(code, kind, token, acct, name):
    """Renders the Ad creator ad from its code (today's prices) and makes a Meta creative from it. → (creative id, info, facts)."""
    sys.path.insert(0, str(ROOT))
    import make_video
    ad = unpack(code)
    if ad.get("market") == "fr":
        raise ValueError("French ads aren't published to Meta yet.")
    page, ig = page_ids()
    size = ad.get("size") if ad.get("format") == "carousel" and ad.get("size") in ("1x1", "4x5") else "4x5"
    cards, info, notes = make_video.capture_jpegs(code, size)
    if not cards:
        raise ValueError("The ad has no cards (its sailings may all be off sale).")
    cta = CTA.get(info.get("cta") or ad.get("cta"), "LEARN_MORE")
    first = next((c["link"] for c in cards if c["link"]), "https://www.ambassadorcruiseline.com/")
    msg = info.get("primary") or ad.get("primary") or ""
    base = {"page_id": page, **({"instagram_user_id": ig} if ig else {})}
    if kind == "video":
        import tempfile
        layers, _, _ = make_video.capture(code, [VIDEO_SIZE])
        out = Path(tempfile.mkdtemp()) / "ad.mp4"
        make_video.render(layers[VIDEO_SIZE], VIDEO_SIZE, VIDEO_LENGTH, out)
        vid = upload_video(out, token, acct)
        thumb = upload_images(cards[:1], token, acct)[0]
        spec = {**base, "video_data": {"video_id": vid, "image_hash": thumb, "message": msg, "title": cards[0]["headline"][:40],
                                       "call_to_action": {"type": cta, "value": {"link": first}}}}
    else:
        hashes = upload_images(cards, token, acct)
        if info.get("format") == "carousel" and len(cards) > 1:
            spec = {**base, "link_data": {"message": msg, "link": first, "multi_share_optimized": False, "multi_share_end_card": False,
                    "child_attachments": [{"link": c["link"] or first, "name": c["headline"][:40], "description": c["description"][:30], "image_hash": h,
                                           "call_to_action": {"type": cta, "value": {"link": c["link"] or first}}} for c, h in zip(cards, hashes)],
                    "call_to_action": {"type": cta, "value": {"link": first}}}}
        else:
            c = cards[0]
            spec = {**base, "link_data": {"message": msg, "link": c["link"] or first, "name": c["headline"][:40], "description": c["description"][:30],
                    "image_hash": hashes[0], "call_to_action": {"type": cta, "value": {"link": c["link"] or first}}}}
    cr = call("POST", f"act_{acct}/adcreatives", token, data={"name": name[:100], "object_story_spec": spec})
    return cr["id"], info, notes


def remember(ad_id, rec):
    d = json.loads(PUBLISHED.read_text()) if PUBLISHED.exists() else {}
    d[ad_id] = rec
    PUBLISHED.parent.mkdir(parents=True, exist_ok=True)
    PUBLISHED.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True))


def page_used(ads):
    """The Facebook page our ads run from (the most used), for publishing new ads."""
    from collections import Counter
    n = Counter(((ad.get("creative") or {}).get("object_story_spec") or {}).get("page_id") for ad in ads)
    n.pop(None, None)
    return n.most_common(1)[0][0] if n else ""


def targeting_summary(tg):
    tg = tg or {}
    geo = tg.get("geo_locations") or {}
    return {"age_min": tg.get("age_min"), "age_max": tg.get("age_max"), "genders": tg.get("genders") or [],
            "countries": geo.get("countries") or [], "regions": len(geo.get("regions") or []), "cities": len(geo.get("cities") or []),
            "custom": len(tg.get("custom_audiences") or []), "interests": sum(len(x.get("interests") or []) for x in tg.get("flexible_spec") or [])}


def read():
    token, acct = os.environ.get("META_ADS_TOKEN", "").strip(), os.environ.get("META_AD_ACCOUNT_ID", "").strip().replace("act_", "")
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not token or not acct:
        OUT.write_text(json.dumps({"read_at": now, "problem": "setup", "missing": [k for k, v in (("META_ADS_TOKEN", token), ("META_AD_ACCOUNT_ID", acct)) if not v]}))
        print("Meta ads: not set up yet")
        return 0
    st, cab, kit = load_state()
    today = st.get("updated") or now[:10]
    try:
        a, camps, sets, ads, ins = read_account(token, acct)
    except TokenProblem as e:
        PROBLEM.parent.mkdir(exist_ok=True)
        PROBLEM.write_text(f"The tracker couldn't read the Meta ad account: {e}\n\nMake a new token for the system user (Meta Business "
                           "Settings → Users → System users → Generate new token, permissions ads_management and ads_read) and put it in "
                           "the repo secret META_ADS_TOKEN. Nothing can be approved on the Meta ads page until then.\n")
        old = json.loads(OUT.read_text()) if OUT.exists() else {}
        OUT.write_text(json.dumps({**old, "read_at": now, "problem": str(e)[:300]}, ensure_ascii=False))
        print("Meta ads:", e)
        return 0
    codes = {c for ad in ads for c in codes_of(pieces(ad.get("creative") or {}))}
    facts = {c: sailing_facts(c, st, cab, kit, today) for c in codes}
    props, rows = [], []
    made = json.loads(PUBLISHED.read_text()) if PUBLISHED.exists() else {}
    for ad in ads:
        cr = ad.get("creative") or {}
        if ad["id"] in made:   # made by the tracker: remade from the Ad creator design when what it prints changes
            p, notes = [], []
            if ad.get("effective_status") in RUNNING:
                x = remake_proposal(ad["id"], made[ad["id"]], st, cab, kit, today)
                p = [x] if x else []
        else:
            p, notes = proposals_for(ad, facts, today)
        props += p
        ps = pieces(cr)
        rows.append({"id": ad["id"], "name": ad.get("name"), "status": ad.get("effective_status"), "on": ad.get("configured_status") or ad.get("status"),
                     "adset": ad.get("adset_id"), "campaign": ad.get("campaign_id"), "created": ad.get("created_time"), "updated": ad.get("updated_time"),
                     "type": "carousel" if (cr.get("object_story_spec") or {}).get("link_data", {}).get("child_attachments") else
                             "video" if (cr.get("object_story_spec") or {}).get("video_data") else "dynamic" if cr.get("asset_feed_spec") else
                             "post" if not cr.get("object_story_spec") else "image",
                     "thumb": cr.get("thumbnail_url") or "", "codes": codes_of(ps), "texts": [[".".join(map(str, pth)), v] for pth, kind, v in ps if kind == "text"][:30],
                     "notes": notes, "res": ins.get(ad["id"]), "made": made.get(ad["id"], {}).get("at") if ad["id"] in made else None})
    keep = lambda o, ks: {k: o.get(k) for k in ks}   # noqa: E731
    doc = {"read_at": now, "today": today, "problem": "", "account": {"id": acct, **keep(a, ["name", "currency", "timezone_name", "account_status"])},
           "campaigns": [keep(c, ["id", "name", "status", "effective_status", "objective", "daily_budget", "lifetime_budget", "bid_strategy"]) for c in camps],
           "adsets": [keep(s, ["id", "name", "status", "effective_status", "campaign_id", "daily_budget", "lifetime_budget", "bid_amount", "bid_strategy", "start_time", "end_time", "optimization_goal"]) | {"targeting": targeting_summary(s.get("targeting"))} for s in sets],
           "ads": rows, "proposals": props, "max_daily": MAX_DAILY, "max_step": MAX_STEP,
           "page_id": page_used(ads)}
    # Urgent proposals not seen at the last read → out/meta_urgent.md → "Meta ads: urgent changes to approve" issue
    before = {x["id"] for x in (json.loads(OUT.read_text()).get("proposals") or [])} if OUT.exists() else set()
    fresh = [x for x in props if x.get("urgent") and x["id"] not in before]
    if fresh:
        names = {r["id"]: r["name"] for r in rows}
        URGENT.parent.mkdir(exist_ok=True)
        URGENT.write_text("These Meta ads should be paused. Approve it on the tracker's Meta ads page (Creative → Meta ads):\n\n" +
                          "".join(f"- **{names.get(x['ad'], x['ad'])}**: {x['why']}\n" for x in fresh))
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    if PROBLEM.exists():
        PROBLEM.unlink()
    print(f"Meta ads: {len(ads)} ads, {len(sets)} ad sets, {len(camps)} campaigns; {len(props)} proposals ({sum(1 for x in props if x.get('urgent'))} urgent); {calls} requests")
    return 0


# ---------- applying an approved change ----------
def apply(rid):
    sys.path.insert(0, str(ROOT))
    from video_job import DOCS, session, value
    http, col = session(), "pricewatch_meta"
    r = http.get(f"{DOCS}/{col}/{rid}", timeout=60)
    if not r.ok:
        raise SystemExit(f"reading {col}/{rid} failed: {r.status_code}")
    f = {k: (v.get("stringValue") or "") for k, v in r.json().get("fields", {}).items() if "stringValue" in v}

    def mark(**fields):
        params = [("updateMask.fieldPaths", k) for k in fields] + [("currentDocument.exists", "true")]
        http.patch(f"{DOCS}/{col}/{rid}", params=params, json={"fields": {k: value(v) for k, v in fields.items()}}, timeout=60)

    token, acct = os.environ.get("META_ADS_TOKEN", "").strip(), os.environ.get("META_AD_ACCOUNT_ID", "").strip().replace("act_", "")
    if not token or not acct:
        mark(status="failed", error="Meta isn't set up yet (META_ADS_TOKEN / META_AD_ACCOUNT_ID).")
        return 1
    mark(status="running")
    try:
        msg = do(f.get("op"), {**json.loads(f.get("payload") or "{}"), "by": f.get("by", "")}, token, acct)
        mark(status="done", result=msg, done_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
        print("Meta ads:", msg)
        return 0
    except (RuntimeError, TokenProblem, ValueError, KeyError) as e:
        mark(status="failed", error=str(e)[:400])
        print("Meta ads: failed:", e)
        return 1


def do(op, p, token, acct):
    if op == "approve":
        st, cab, kit = load_state()
        today = st.get("updated")
        ad = call("GET", str(int(p["ad"])), token, {"fields": "account_id," + AD_FIELDS})
        if ad.get("account_id") and str(ad["account_id"]) != acct:
            raise ValueError("That ad isn't in our ad account.")
        made = json.loads(PUBLISHED.read_text()) if PUBLISHED.exists() else {}
        if ad["id"] in made:
            x = remake_proposal(ad["id"], made[ad["id"]], st, cab, kit, today)
            props = [x] if x else []
        else:
            codes = codes_of(pieces(ad.get("creative") or {}))
            facts = {c: sailing_facts(c, st, cab, kit, today) for c in codes}
            props, _ = proposals_for(ad, facts, today)
        prop = next((x for x in props if x["id"] == p.get("proposal")), None)
        if not prop:
            raise ValueError("This change is no longer needed or has changed since it was proposed: wait for the next hourly read and look again.")
        if prop["kind"] == "pause":
            call("POST", ad["id"], token, data={"status": "PAUSED"})
            return f"Paused \"{ad.get('name')}\". {prop['why']}"
        if prop["kind"] == "text":
            cr = ad["creative"]
            spec = {k: cr[k] for k in ("object_story_spec", "asset_feed_spec") if cr.get(k)}
            for c in prop["changes"]:
                set_at(spec, [int(x) if isinstance(x, int) or str(x).isdigit() else x for x in c["path"]], c["new"])
            new = call("POST", f"act_{acct}/adcreatives", token, data={"name": f"{cr.get('name') or ad.get('name')} · prices {today}"[:100], **spec})
            call("POST", ad["id"], token, data={"creative": {"creative_id": new["id"]}})
            return f"\"{ad.get('name')}\" now uses a new creative with today's prices ({'; '.join(c['old'][:40] + ' → ' + c['new'][:40] for c in prop['changes'][:3])}). Meta reviews it again."
        if prop["kind"] == "remake":
            rec = made[ad["id"]]
            code = live_code(unpack(rec["code"]), kit)
            cid, info, notes = build_creative(code, rec.get("kind", "image"), token, acct, f"{ad.get('name')} · {today}")
            call("POST", ad["id"], token, data={"creative": {"creative_id": cid}})
            facts_now = card_facts(unpack(code), st, cab, kit, today)
            remember(ad["id"], {**rec, "code": code, "fp": fp_of(facts_now), "facts": facts_now, "at": today, "remade": (rec.get("remade") or 0) + 1})
            return f"\"{ad.get('name')}\" remade with today's prices ({prop['why'].removeprefix('Made by the tracker; ').rstrip('.')}). Meta reviews it again."
        raise ValueError("Unknown proposal.")
    if op == "publish":
        st, cab, kit = load_state()
        today = st.get("updated")
        aset = call("GET", str(int(p["adset"])), token, {"fields": "account_id,name"})
        if str(aset.get("account_id") or "") != acct:
            raise ValueError("That ad set isn't in our ad account.")
        kind = "video" if p.get("kind") == "video" else "image"
        code = live_code(unpack(p["code"]), kit)
        name = (p.get("name") or "Ad from the tracker")[:100]
        cid, info, notes = build_creative(code, kind, token, acct, name)
        new = call("POST", f"act_{acct}/ads", token, data={"name": name, "adset_id": str(int(p["adset"])), "creative": {"creative_id": cid}, "status": "PAUSED"})
        facts_now = card_facts(unpack(code), st, cab, kit, today)
        remember(new["id"], {"code": code, "kind": kind, "fp": fp_of(facts_now), "facts": facts_now, "at": today, "by": p.get("by", ""), "name": name})
        extra = " ".join(x for x in re.split(r"(?<=\.)\s+", " ".join(notes)) if x and not x.startswith(("Opened a shared ad", "It's now your own copy", "The shared saved list")))[:200]
        return (f"Created \"{name}\" in \"{aset.get('name')}\", paused: switch it on in Ads Manager or on the Meta ads page once you've checked it."
                + (f" When the ad was opened: {extra}" if extra else "") + (f" Has was/now cards: stop it by {info['until']}." if info.get("until") else ""))
    if op != "manual":
        raise ValueError("Unknown request.")
    kind, oid, typ = p.get("kind"), str(int(p["id"])), p.get("type")
    fields = {"ad": "account_id,name,status", "adset": "account_id,name,status,daily_budget,lifetime_budget,bid_amount",
              "campaign": "account_id,name,status,daily_budget,lifetime_budget"}.get(typ)
    if not fields or (kind in ("bid", "end", "targeting") and typ != "adset") or (kind == "budget" and typ == "ad"):
        raise ValueError("That change doesn't apply to this.")
    obj = call("GET", oid, token, {"fields": fields})
    if str(obj.get("account_id") or "") not in ("", acct):
        raise ValueError("That isn't in our ad account.")
    name = obj.get("name") or oid
    if kind == "status":
        s = p.get("status")
        if s not in ("ACTIVE", "PAUSED"):
            raise ValueError("Bad status.")
        call("POST", oid, token, data={"status": s})
        return f"{'Switched on' if s == 'ACTIVE' else 'Paused'} \"{name}\"."
    if kind == "budget":
        field = "daily_budget" if p.get("field") == "daily_budget" else "lifetime_budget"
        new, cur = int(p["value"]), int(obj.get(field) or 0)
        if new < 100:
            raise ValueError("A budget can't be under 1.00.")
        if cur and (new > cur * MAX_STEP or new < cur / MAX_STEP):
            raise ValueError(f"A budget can change by at most {MAX_STEP:g}× in one go (it's {cur / 100:.2f} now).")
        if field == "daily_budget" and new > MAX_DAILY:
            raise ValueError(f"A daily budget can't be over {MAX_DAILY / 100:.0f} (repo variable META_MAX_DAILY_BUDGET).")
        call("POST", oid, token, data={field: new})
        return f"\"{name}\" {field.replace('_', ' ')}: {cur / 100:.2f} → {new / 100:.2f}."
    if kind == "bid":
        new, cur = int(p["value"]), int(obj.get("bid_amount") or 0)
        if new < 1 or (cur and (new > cur * MAX_STEP or new < cur / MAX_STEP)):
            raise ValueError(f"A bid can change by at most {MAX_STEP:g}× in one go.")
        call("POST", oid, token, data={"bid_amount": new})
        return f"\"{name}\" bid: {cur / 100:.2f} → {new / 100:.2f}."
    if kind == "end":
        end = str(p.get("end_time") or "")
        if not re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d", end):
            raise ValueError("Bad end date.")
        call("POST", oid, token, data={"end_time": end})
        return f"\"{name}\" now ends {end[:16].replace('T', ' ')}."
    if kind == "targeting":
        tg = call("GET", oid, token, {"fields": "targeting"}).get("targeting") or {}
        lo, hi = int(p.get("age_min") or tg.get("age_min") or 18), int(p.get("age_max") or tg.get("age_max") or 65)
        if not (18 <= lo <= hi <= 65):
            raise ValueError("Ages must be between 18 and 65 (65 means 65 and over).")
        tg = {**tg, "age_min": lo, "age_max": hi}
        g = p.get("genders")
        if g is not None:
            if g not in ([], [1], [2]):
                raise ValueError("Bad gender choice.")
            if g: tg["genders"] = g
            else: tg.pop("genders", None)
        cs = p.get("countries")
        if cs:
            if not all(re.fullmatch(r"[A-Z]{2}", c) for c in cs) or len(cs) > 25:
                raise ValueError("Countries are two-letter codes, e.g. GB, IE.")
            tg["geo_locations"] = {"countries": cs, "location_types": (tg.get("geo_locations") or {}).get("location_types") or ["home", "recent"]}
        call("POST", oid, token, data={"targeting": tg})
        return f"\"{name}\" targeting: ages {lo}–{hi}{'+' if hi == 65 else ''}" + (f", {'men' if g == [1] else 'women' if g == [2] else 'everyone'}" if g is not None else "") + (f", {', '.join(cs)}" if cs else "") + "."
    raise ValueError("Unknown change.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "apply":
        sys.exit(apply(sys.argv[2]))
    sys.exit(read())
