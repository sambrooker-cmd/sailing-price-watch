"""Keep a current set of standard sailing cards (no was/now) for every sailing on sale,
in the Digital Team Planner's Firebase Storage bucket, for the tracker page.

Runs inside the hourly price watch, after daily.py has saved the check (Sam, 12 Oct 2026):
  python cards_sync.py plan   # what needs doing; sets GITHUB_OUTPUT todo / work
  python cards_sync.py run    # render, upload, retire and expire; updates state/cards.json

A sailing's cards are remade only when something printed on them changes: price, promotions,
Nectar points, name, date, nights, ship, port, flights or photo (its "fingerprint"), or when
DESIGN changes. New sailings get cards; sailings that leave the feed or depart lose theirs.
Replaced cards stay downloadable for KEEP_DAYS, marked out of date with the reason, then
they are deleted (Sam chose to keep old versions, 12 Oct 2026).

Files go to gs://BUCKET/PREFIX/<code>/<fingerprint>_<size>.jpg, uploaded with the service
account in FIREBASE_SERVICE_ACCOUNT and a Firebase download token. The token links only
reach the tracker page through Firestore (pricewatch/cards), which the planner's allowlist
guards. The bucket is in us-east1, inside Storage's no-cost allowance (Sam checked 12 Oct 2026).
Nothing here touches Meta or any ad account; cards are files for people to check and use.

Was/now cards (Sam, 12 Oct 2026; paused until then): for each claim in this check's
out/run.json (`eligible` lead claims and `cabin_eligible` cabin claims, made by tracker.py:
the was price never comes from anywhere else) whose `since` is today, cards in the
price-reduction style go to .../<code>/wasnow_<fingerprint>_<size>.jpg and into the
manifest under the sailing's "wasnow" (keyed "lead@<since>" or "twin.<grade>@<since>").
They are made once, on the claim's first day (only new claims get cards). When a claim
stops being in run.json (28-day limit, price back up, departing within 7 days, left the
feed) its cards move to "old" with do_not_use and the reason, and are deleted after
KEEP_DAYS like other old cards (Sam chose to keep them 30 days marked "Do not use").
"""
import datetime as dt, glob, hashlib, json, os, sys, uuid
from pathlib import Path
from urllib.parse import quote

import render_cards as rc

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "state" / "cards.json"
BUCKET = "promotions-planner.firebasestorage.app"
PREFIX = "pricewatch-cards"
DESIGN = "2026-10-12"   # change to remake every card after a design change
KEEP_DAYS = 30
JPEG_QUALITY = 92


def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def latest_snapshot():
    snaps = sorted(glob.glob(str(ROOT / "data" / "snapshot_*.json")), key=os.path.getmtime)
    if not snaps:
        raise SystemExit("No snapshot in data/: run daily.py first")
    return snaps[-1], json.loads(Path(snaps[-1]).read_text())


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"design": DESIGN, "sailings": {}}


def on_card(s):
    """Everything printed on a sailing's cards."""
    return {
        "design": DESIGN, "title": s.get("title"), "base_title": s.get("base_title"),
        "ship": s.get("ship"), "port": s.get("port"), "flight_from": s.get("flight_from"),
        "nights": s.get("nights"), "departure_date": s.get("departure_date"),
        "price": round(s["price_pp"]), "promos": rc.promo_lines(s), "nectar": rc.nectar_line(s),
        "photo": rc.OVERRIDES.get(s["id"], s.get("image_link")),
        # only present for campaign artwork, so adding it didn't change every other card's fingerprint
        # "campaign-matched" (13 Oct 2026) remade just these cards when the blurred background was replaced
        **({"layout": "campaign-matched"} if rc.is_campaign(s) else {}),
    }


def fingerprint(s):
    return hashlib.sha256(json.dumps(on_card(s), sort_keys=True).encode()).hexdigest()[:12]


def cardable(s, today):
    # price_source "feed": the page's prices couldn't be read, so keep the cards as they are
    return ("page_error" not in s and s.get("price_source") != "feed" and s.get("departure_date") and s["departure_date"] > today
            and s.get("image_link") and s.get("price_pp"))


def why(old, new):
    """Plain-English reason a card was replaced."""
    if not old:
        return "new"
    out = []
    if old.get("price") != new["price"]:
        out.append(f"price £{old.get('price'):,} → £{new['price']:,}")
    if old.get("promos") != new["promos"]:
        out.append("promotions changed")
    if old.get("nectar") != new["nectar"]:
        out.append("Nectar points changed")
    if old.get("photo") != new["photo"]:
        out.append("photo changed")
    if old.get("layout") != new.get("layout"):
        out.append("campaign artwork on matched colours" if new.get("layout") == "campaign-matched" else "campaign artwork shown whole")
    if old.get("departure_date") != new["departure_date"] or old.get("nights") != new["nights"]:
        out.append("date or length changed")
    if (old.get("title"), old.get("ship"), old.get("port"), old.get("flight_from")) != \
       (new["title"], new["ship"], new["port"], new["flight_from"]):
        out.append("sailing details changed")
    if old.get("design") != new["design"]:
        out.append("card design updated")
    return ", ".join(out) or "updated"


def claim_key(e):
    return f"{e.get('cabin') or 'lead'}@{e['since']}"


def live_claims(run):
    """{(sid, key): claim} for every claim run.json says is valid now."""
    if not run:
        return {}
    return {(e["id"], claim_key(e)): e for e in (run.get("eligible") or []) + (run.get("cabin_eligible") or [])}


def wasnow_fp(s, e):
    on = {"design": DESIGN, "title": s.get("title"), "base_title": s.get("base_title"), "ship": s.get("ship"),
          "port": s.get("port"), "flight_from": s.get("flight_from"), "nights": s.get("nights"),
          "departure_date": s.get("departure_date"), "photo": rc.OVERRIDES.get(s["id"], s.get("image_link")),
          "cabin": e.get("cabin"), "was": e["was"], "now": e["now"], "since": e["since"], "ends": e["ends"]}
    return hashlib.sha256(json.dumps(on, sort_keys=True).encode()).hexdigest()[:12]


def plan_wasnow(snap, man, run, today, state):
    """(to_render [(sid, key, claim)], to_end [(sid, key, reason)])"""
    by = {s["id"]: s for s in snap["sailings"]}
    live = live_claims(run)
    render = [(sid, key, e) for (sid, key), e in sorted(live.items())
              if e["since"] == today and sid in by and cardable(by[sid], today)
              and key not in (man["sailings"].get(sid, {}).get("wasnow") or {})]
    end = []
    for sid, m in man["sailings"].items():
        for key in (m.get("wasnow") or {}):
            if (sid, key) not in live:
                end.append((sid, key, ended_why(sid, key, (state or {}).get("sailings", {}).get(sid))))
    return render, end


def ended_why(sid, key, rec):
    """Plain-English reason a was/now claim stopped, from the saved state."""
    if not rec:
        return "claim ended"
    if rec.get("removed"):
        return "claim ended: sailing left the ad feed"
    cabin, since = key.split("@")
    c = rec.get("claim") if cabin == "lead" else (rec.get("cabin_claims") or {}).get(cabin)
    if not c or c.get("since") != since:
        return "claim ended: the price changed"
    return f"claim ended: {c.get('reason') or 'no longer valid'}"


def plan(snap, man, today, at):
    """(to_render, to_retire, to_expire)"""
    by = {s["id"]: s for s in snap["sailings"]}
    render = [sid for sid, s in by.items() if cardable(s, today)
              and (man["sailings"].get(sid, {}).get("current") or {}).get("fp") != fingerprint(s)]
    retire = []
    for sid, m in man["sailings"].items():
        if not m.get("current"):
            continue
        s = by.get(sid)
        if s is None:
            retire.append((sid, "left the ad feed"))
        elif s.get("departure_date") and s["departure_date"] <= today:
            retire.append((sid, "departed"))
    cutoff = (dt.datetime.fromisoformat(at.replace("Z", "+00:00")) - dt.timedelta(days=KEEP_DAYS)).isoformat()
    expire = [(sid, o) for sid, m in man["sailings"].items() for o in m.get("old") or []
              if o["out_of_date_since"].replace("Z", "+00:00") < cutoff]
    return render, retire, expire


class Store:
    def __init__(self):
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        info = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if not info:
            raise SystemExit("FIREBASE_SERVICE_ACCOUNT is not set")
        creds = service_account.Credentials.from_service_account_info(
            json.loads(info), scopes=["https://www.googleapis.com/auth/devstorage.read_write"])
        self.http = AuthorizedSession(creds)

    def put(self, path, data, filename, content_type="image/jpeg"):
        token = str(uuid.uuid4())
        meta = {"name": path, "contentType": content_type, "cacheControl": "private, max-age=86400",
                "contentDisposition": f'attachment; filename="{filename}"',
                "metadata": {"firebaseStorageDownloadTokens": token}}
        boundary = "pricewatch" + uuid.uuid4().hex
        body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
                f"--{boundary}\r\nContent-Type: {content_type}\r\n\r\n").encode() + data + f"\r\n--{boundary}--".encode()
        r = self.http.post(f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o?uploadType=multipart",
                           data=body, headers={"Content-Type": f"multipart/related; boundary={boundary}"}, timeout=120)
        if not r.ok:
            raise RuntimeError(f"upload {path} failed: {r.status_code} {r.text[:200]}")
        return f"https://firebasestorage.googleapis.com/v0/b/{BUCKET}/o/{quote(path, safe='')}?alt=media&token={token}"

    def delete(self, path):
        r = self.http.delete(f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{quote(path, safe='')}", timeout=60)
        if not (r.ok or r.status_code == 404):
            raise RuntimeError(f"delete {path} failed: {r.status_code} {r.text[:200]}")


def render_all(snap_path, by, ids, claims=()):
    """{sid: {tag: jpeg bytes}}, plus {sid: error}; was/now cards keyed (sid, key).
    One browser for the whole batch."""
    from playwright.sync_api import sync_playwright
    out, errs = {}, {}
    jobs = [(sid, sid, lambda s, w, h: rc.card_html(s, None, w, h)) for sid in ids]
    def wasnow(s, w, h, e, cabin):
        # The card prints the snapshot's price as "now": it must be the claim's own now price.
        now = ((s.get("cabins") or {}).get("twin") or {}).get(cabin) if cabin else s.get("price_pp")
        if now is None or round(now) != round(e["now"]):
            raise RuntimeError(f"price on sale (£{now}) isn't the claim's now price (£{e['now']}); card not made")
        return rc.price_reduction_html(s, e["was"], w, h, cabin)
    for sid, key, e in claims:
        cabin = e["cabin"].split(".", 1)[1] if e.get("cabin") else None
        jobs.append(((sid, key), sid, lambda s, w, h, e=e, cabin=cabin: wasnow(s, w, h, e, cabin)))
    with sync_playwright() as p:
        b = p.chromium.launch()
        pages = {tag: b.new_page(viewport={"width": w, "height": h}) for (w, h), tag in rc.SIZES.items()}
        for job, sid, build in jobs:
            try:
                imgs = {}
                for (w, h), tag in rc.SIZES.items():
                    pg = pages[tag]
                    pg.set_content(build(by[sid], w, h), wait_until="load")
                    pg.evaluate("document.fonts.ready")
                    pg.evaluate("fit()")
                    imgs[tag] = pg.locator("#card").screenshot(type="jpeg", quality=JPEG_QUALITY)
                out[job] = imgs
            except BaseException as e:  # noqa: one bad photo mustn't stop the rest (SystemExit too)
                if isinstance(e, KeyboardInterrupt):
                    raise
                errs[job] = str(e)[:200]
        b.close()
    return out, errs


def write_adkit(snap, today, at):
    """state/adkit.json: what the tracker's Ad creator needs per sailing on sale that the saved
    state doesn't hold (Sam, 12 Oct 2026): every promotion line that may go on a card (best
    first; never a "lower fares" one), the Nectar line, the lead price's cabin grade, whether the
    image is campaign artwork, and the photos on the sailing's page. Prices are not in here:
    the page takes them from the saved state, like everything else."""
    kit = {}
    for s in snap["sailings"]:
        if not cardable(s, today):
            continue
        kit[s["id"]] = {k: v for k, v in {
            "promos": rc.promo_lines(s, limit=0), "nectar": rc.nectar_line(s), "lead_grade": rc.lead_grade(s),
            "campaign": rc.is_campaign(s), "image": rc.OVERRIDES.get(s["id"], s.get("image_link")),
            # plus a photo of the sailing's own ship, hosted with the tracker page (site/ships/, Sam 13 Oct 2026)
            "photos": (s.get("photos") or []) + ([f"/ships/{s['ship'].lower()}.jpg"] if s.get("ship") else [])}.items() if v}
    path = ROOT / "state" / "adkit.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"updated_at": at, "date": today, "sailings": kit}, ensure_ascii=False, separators=(",", ":")))


def gh_output(**kv):
    p = os.environ.get("GITHUB_OUTPUT")
    if p:
        with open(p, "a") as f:
            for k, v in kv.items():
                f.write(f"{k}={v}\n")


def main():
    cmd = (sys.argv[1:] or ["plan"])[0]
    snap_path, snap = latest_snapshot()
    today = snap["date"]
    at = now_utc()
    man = load_manifest()
    if cmd == "plan":
        write_adkit(snap, today, at)
    render, retire, expire = plan(snap, man, today, at)
    run_p, state_p = ROOT / "out" / "run.json", ROOT / "state" / "current.json"
    run = json.loads(run_p.read_text()) if run_p.exists() and json.loads(run_p.read_text()).get("date") == today else None
    state = json.loads(state_p.read_text()) if state_p.exists() else None
    wn_render, wn_end = plan_wasnow(snap, man, run, today, state) if run else ([], [])
    print(f"Cards: {len(render)} sailing(s) to make, {len(retire)} to withdraw, {len(expire)} old version(s) to delete")
    print(f"Was/now cards: {len(wn_render)} new claim(s) to make cards for, {len(wn_end)} ended claim(s) to withdraw")
    if cmd == "plan":
        todo = len(render) + len(wn_render)
        gh_output(todo=todo, work=todo + len(retire) + len(expire) + len(wn_end))
        return 0

    by = {s["id"]: s for s in snap["sailings"]}
    store = Store()
    lines, problems = [], []
    imgs, errs = render_all(snap_path, by, render, wn_render) if render or wn_render else ({}, {})
    problems += [f"{sid if isinstance(sid, str) else ' '.join(sid)}: card failed ({e})" for sid, e in errs.items()]
    wn_lines = []
    for (sid, key, e) in wn_render:
        files = imgs.pop((sid, key), None)
        if not files:
            continue
        fp = wasnow_fp(by[sid], e)
        try:
            urls = {tag: {"url": store.put(f"{PREFIX}/{sid}/wasnow_{fp}_{tag}.jpg", data,
                                           f"{sid}_{(e.get('cabin') or 'lead').replace('twin.', '')}_wasnow_{tag}.jpg"),
                          "path": f"{PREFIX}/{sid}/wasnow_{fp}_{tag}.jpg", "kb": round(len(data) / 1024)}
                    for tag, data in files.items()}
        except Exception as x:  # noqa
            problems.append(f"{sid}: was/now upload failed ({str(x)[:200]})")
            continue
        m = man["sailings"].setdefault(sid, {"old": []})
        m.setdefault("wasnow", {})[key] = {
            "kind": "wasnow", "cabin": e.get("cabin"), "was": e["was"], "now": e["now"], "price": e["now"],
            "since": e["since"], "ends": e["ends"], "title": by[sid].get("title"), "fp": fp, "made_at": at,
            "reason": "new was/now claim", "files": urls}
        grade = rc.CABIN_LABEL.get((e.get("cabin") or "").replace("twin.", ""), "lead price")
        wn_lines.append(f"{sid}: was/now cards made ({grade}: "
                        f"was £{e['was']:,.0f} → now £{e['now']:,.0f}, use until {e['ends']})")
        MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1))
    for sid, key, reason in wn_end:
        m = man["sailings"][sid]
        c = m["wasnow"].pop(key)
        m.setdefault("old", []).insert(0, {**c, "out_of_date_since": at, "reason": reason, "do_not_use": True})
        if not m["wasnow"]:
            del m["wasnow"]
        grade = rc.CABIN_LABEL.get((c.get("cabin") or "").replace("twin.", ""), "lead price")
        wn_lines.append(f"{sid}: was/now cards withdrawn, DO NOT USE ({grade}: was £{c['was']:,.0f} → now £{c['now']:,.0f}; {reason})")
    for sid, files in imgs.items():
        s, oc = by[sid], on_card(by[sid])
        fp = fingerprint(s)
        try:
            urls = {tag: {"url": store.put(f"{PREFIX}/{sid}/{fp}_{tag}.jpg", data, f"{sid}_{tag}.jpg"),
                          "path": f"{PREFIX}/{sid}/{fp}_{tag}.jpg", "kb": round(len(data) / 1024)}
                    for tag, data in files.items()}
        except Exception as e:  # noqa
            problems.append(f"{sid}: upload failed ({str(e)[:200]})")
            continue
        m = man["sailings"].setdefault(sid, {"old": []})
        prev = m.get("current")
        reason = why(prev, oc)
        if prev:
            m["old"].insert(0, {**prev, "out_of_date_since": at, "reason": reason})
        m["current"] = {**oc, "fp": fp, "made_at": at, "reason": reason, "files": urls}
        lines.append(f"{sid}: {reason}")
        MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1))  # after each, so a crash loses little
    for sid, reason in retire:
        m = man["sailings"][sid]
        m["old"].insert(0, {**m.pop("current"), "out_of_date_since": at, "reason": reason})
        lines.append(f"{sid}: withdrawn, {reason}")
    for sid, o in expire:
        try:
            for f in o["files"].values():
                store.delete(f["path"])
        except Exception as e:  # noqa
            problems.append(f"{sid}: couldn't delete an old card ({str(e)[:200]})")
            continue
        man["sailings"][sid]["old"].remove(o)
    for sid in [k for k, v in man["sailings"].items() if not v.get("current") and not v.get("old") and not v.get("wasnow")]:
        del man["sailings"][sid]
    man["design"] = DESIGN
    man["updated_at"] = at
    MANIFEST.parent.mkdir(exist_ok=True)
    MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1))

    summary = [f"## Cards ({at[11:16]} UTC)", ""]
    if lines:
        summary.append(f"Made or withdrew cards for {len(lines)} sailing(s):")
        summary += [f"- {l}" for l in lines[:60]] + ([f"- …and {len(lines) - 60} more"] if len(lines) > 60 else [])
    if wn_lines:
        summary += ["", "Was/now cards:", *[f"- {l}" for l in wn_lines]]
    if expire:
        summary.append(f"Deleted {len(expire)} card version(s) more than {KEEP_DAYS} days out of date.")
    if problems:
        summary += ["", "### Problems", *[f"- {p}" for p in problems]]
    text = "\n".join(summary) + "\n"
    ended = [l for l in wn_lines if "DO NOT USE" in l]
    if ended:
        (ROOT / "out" / "wasnow_ended.md").write_text(
            "These was/now claims have ended, so their cards must not be used any more. If any are live in an ad, "
            "swap them for the standard cards. The tracker keeps them 30 days marked \"Do not use\".\n\n" +
            "\n".join(f"- {l}" for l in ended) + "\n")
        gh_output(wasnow_ended=len(ended))
    if [l for l in wn_lines if "DO NOT USE" not in l] and (ROOT / "out" / "issue.md").exists():
        site = os.environ.get("HOSTING_SITE")
        link = lambda sid: f"[{sid}](https://{site}.web.app/#{sid})" if site else sid
        with open(ROOT / "out" / "issue.md", "a") as f:
            f.write("\n## Was/now cards\n\n" + "\n".join(
                f"- {link(l.split(':', 1)[0])}:{l.split(':', 1)[1]}" for l in wn_lines) +
                "\n\nSee and download them on the tracker page (Cards). Nothing has been sent to Meta or Google.\n")
    print(text)
    (ROOT / "out").mkdir(exist_ok=True)
    with open(ROOT / "out" / "summary.md", "a") as f:
        f.write("\n" + text)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
