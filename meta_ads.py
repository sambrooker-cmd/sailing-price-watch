"""Competitors' live Facebook and Instagram ads in the UK, from Meta's Ad Library API (Sam, 15 Oct 2026: "is there
any way to grab them from ad libraries rather than just showing the links?"; Meta's official API, with Sam's own
developer app and token, after he read Meta's terms).

What the API gives for ads shown in the UK (all kinds of ads in the UK and EU, kept a year after they stop): the page,
the ad's words (body, headline, link description), when it started (and stopped), the platforms it runs on and a
library id. Not the pictures or videos: the page links to each ad in Meta's own library instead ("View ad"), and
nothing is downloaded from the library's pages (that would be collecting from the website, which Meta's terms forbid).

Once a UK day (in the hourly workflow, like terms.py; `--force` to run again):
  * finds each brand's Facebook page(s) by a name search (`BRANDS`: the page name must match, e.g. "P&O Cruises"),
    remembered for a week; `meta_pages.json` {"<brand key>": ["<page id>", …]} (optional) fixes them by hand;
  * reads every ACTIVE ad those pages have shown in the UK (ad_reached_countries GB), 100 a request, at most
    `MAX_CALLS` requests a run (Meta allows about 200 an hour);
  * keeps each ad: first/last seen, start/stop, words (cut short), platforms; an ad no longer active is marked
    `ended` (the day it was first missed); ads ended more than KEEP_DAYS ago are dropped.
→ state/competitors/meta_ads.json → publish.py pricewatch/comp-meta (summary) + comp-meta-<brand> (the ads).

The token: repo secret META_AD_LIBRARY_TOKEN (a long-lived user token from the Graph API Explorer, extended in the
Access Token Debugger; about 60 days). It is only ever sent to graph.facebook.com in the request, never logged or
saved; Meta's ad_snapshot_url carries the token, so it is never requested or stored (the "View ad" link is built from
the ad id). A rejected token → out/meta_ads_problem.md → "Competitor ads: Meta token needs renewing" issue.
Skipped (exit 0) until the secret exists. Read-only: never touches an ad account.
"""
import datetime as dt, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "state" / "competitors" / "meta_ads.json"
PROBLEM = ROOT / "out" / "meta_ads_problem.md"
OVERRIDES = ROOT / "meta_pages.json"
VERSION = os.environ.get("META_API_VERSION", "").strip()   # empty: the app's own default version
API = "https://graph.facebook.com/" + (VERSION + "/" if VERSION else "")
MAX_CALLS = 120       # requests a run (Meta: about 200 an hour per token)
KEEP_DAYS = 120       # ended ads kept this long
PAGES_DAYS = 7        # page ids looked up again after this
TEXT = 600            # characters kept of an ad's main text
# Brand → (search words, page names that are the brand's own)
BRANDS = {   # page names must match in full (optionally "… UK"), so fan pages and agents' pages are left out
    "po": ("P&O Cruises", r"^P&O Cruises( UK)?$"),
    "princess": ("Princess Cruises", r"^Princess Cruises( UK)?$"),
    "cunard": ("Cunard", r"^Cunard( Line)?( UK)?$"),
    "marella": ("Marella Cruises", r"^Marella Cruises( UK)?$"),
    "saga": ("Saga Cruises", r"^Saga( Holidays| Cruises| Travel)?( UK)?$"),
    "fredolsen": ("Fred. Olsen Cruise Lines", r"^Fred\.? ?Olsen Cruise Lines?( UK)?$"),
    "msc": ("MSC Cruises", r"^MSC Cruises( UK| UK & Ireland)?$"),
    "royal": ("Royal Caribbean", r"^Royal Caribbean( International)?( UK| UK & Ireland)?$"),
    "celebrity": ("Celebrity Cruises", r"^Celebrity Cruises( UK| UK & Ireland)?$"),
}
FIELDS = ("id,page_id,page_name,ad_creation_time,ad_delivery_start_time,ad_delivery_stop_time,ad_creative_bodies,"
          "ad_creative_link_titles,ad_creative_link_descriptions,ad_creative_link_captions,publisher_platforms,languages")


class TokenProblem(Exception):
    pass


calls = 0


def get(path, params, token):
    """One API request (GET); the token goes in the request only. Retries once on a busy answer."""
    global calls
    if calls >= MAX_CALLS:
        raise RuntimeError("request limit for this run reached")
    q = urllib.parse.urlencode({**params, "access_token": token})
    for attempt in (1, 2):
        calls += 1
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path + "?" + q, headers={"User-Agent": "AmbassadorPriceWatch/1.0"}),
                                        timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read().decode()).get("error", {})
            except ValueError:
                err = {}
            code, msg = err.get("code"), str(err.get("message") or e.reason)[:300]
            if code == 190 or e.code == 401:
                raise TokenProblem(f"Meta rejected the token: {msg}")
            if code in (10, 200, 2332002, 2332004) or "identity" in msg.lower() or "permission" in msg.lower():
                raise TokenProblem(f"Meta refused access to the Ad Library API: {msg}")
            if attempt == 1 and (e.code >= 500 or code in (1, 2, 4, 17, 32, 613)):
                time.sleep(20)
                continue
            raise RuntimeError(f"Meta answered {e.code}: {msg}")


def pages_of(key, token):
    """The brand's own Facebook page ids, found from its ads shown in the UK."""
    words, pat = BRANDS[key]
    found, after = {}, None
    for _ in range(3):
        params = {"search_terms": words, "ad_reached_countries": '["GB"]', "ad_active_status": "ALL", "ad_type": "ALL",
                  "fields": "page_id,page_name", "limit": 100}
        if after:
            params["after"] = after
        j = get("ads_archive", params, token)
        for a in j.get("data") or []:
            if a.get("page_id") and re.search(pat, a.get("page_name") or "", re.I):
                found[a["page_id"]] = a["page_name"]
        after = ((j.get("paging") or {}).get("cursors") or {}).get("after")
        if not after or not (j.get("paging") or {}).get("next"):
            break
    return found


def ads_of(page_ids, token):
    out, after = [], None
    while True:
        params = {"search_page_ids": json.dumps(page_ids[:10]), "ad_reached_countries": '["GB"]', "ad_active_status": "ACTIVE",
                  "ad_type": "ALL", "fields": FIELDS, "limit": 100}
        if after:
            params["after"] = after
        j = get("ads_archive", params, token)
        out += j.get("data") or []
        after = ((j.get("paging") or {}).get("cursors") or {}).get("after")
        if not after or not (j.get("paging") or {}).get("next"):
            return out


def clip(xs, n):
    return [re.sub(r"\s+", " ", str(x)).strip()[:n] for x in (xs or []) if str(x).strip()][:3]


def main():
    force = "--force" in sys.argv
    token = (os.environ.get("META_AD_LIBRARY_TOKEN") or "").strip()
    if not token:
        print("Competitor ads (Meta): no META_AD_LIBRARY_TOKEN secret yet, skipped.")
        return 0
    from daily import london_today
    today = london_today()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    st = json.loads(OUT.read_text()) if OUT.exists() else {"pages": {}, "ads": {}}
    if st.get("read_on") == today and not force:
        print("Competitor ads (Meta): already read today.")
        return 0
    fixed = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    PROBLEM.parent.mkdir(exist_ok=True)
    seen, problems, counts = set(), [], {}
    try:
        for key in BRANDS:
            pg = st["pages"].get(key) or {}
            if fixed.get(key):
                pg = {"ids": {i: pg.get("ids", {}).get(i, "") for i in fixed[key]}, "at": today, "by": "hand"}
            elif not pg.get("ids") or pg.get("at", "") < (dt.date.fromisoformat(today) - dt.timedelta(days=PAGES_DAYS)).isoformat():
                try:
                    found = pages_of(key, token)
                    if found:
                        pg = {"ids": found, "at": today, "by": "search"}
                    else:   # nothing matched this time: keep the pages we had, and don't count its ads as ended (QA, 17 Oct 2026)
                        problems.append(f"{BRANDS[key][0]}: no page matching its name was found this time; the pages found before are kept")
                except RuntimeError as e:
                    problems.append(f"{BRANDS[key][0]}: its page couldn't be found ({e})")
            st["pages"][key] = pg
            ids = list((pg.get("ids") or {}).keys())
            if not ids:
                counts[key] = 0
                continue
            try:
                ads = ads_of(ids, token)
            except RuntimeError as e:
                problems.append(f"{BRANDS[key][0]}: {e}")
                continue
            counts[key] = len(ads)
            for a in ads:
                aid = str(a.get("id") or "")
                if not aid:
                    continue
                seen.add(aid)
                r = st["ads"].get(aid) or {"brand": key, "first_seen": today}
                r.update(brand=key, page=a.get("page_name"), page_id=a.get("page_id"), last_seen=today,
                         start=(a.get("ad_delivery_start_time") or "")[:10] or None, stop=(a.get("ad_delivery_stop_time") or "")[:10] or None,
                         created=(a.get("ad_creation_time") or "")[:10] or None,
                         body=clip(a.get("ad_creative_bodies"), TEXT), title=clip(a.get("ad_creative_link_titles"), 200),
                         desc=clip(a.get("ad_creative_link_descriptions"), 300), caption=clip(a.get("ad_creative_link_captions"), 100),
                         platforms=[str(p).lower() for p in (a.get("publisher_platforms") or [])][:6],
                         languages=(a.get("languages") or [])[:3])
                r.pop("ended", None)
                st["ads"][aid] = r
    except TokenProblem as e:
        PROBLEM.write_text(f"The competitor ads step couldn't read Meta's Ad Library API: {e}\n\n"
                           "To fix: open Meta's Graph API Explorer (developers.facebook.com → Tools), pick the app, Generate Access Token, "
                           "then extend it in the Access Token Debugger (Extend Access Token) and paste the long token into the repo "
                           "secret META_AD_LIBRARY_TOKEN (Settings → Secrets and variables → Actions). If Meta asks you to confirm your "
                           "identity, do that at facebook.com/ID first. Competitor prices and offers are unaffected.\n")
        print(f"Competitor ads (Meta): {e}")
        return 0
    # Ads that were active and aren't now have ended (only for brands read in full this run)
    read = {k for k, n in counts.items() if not any(p.startswith(BRANDS[k][0] + ":") for p in problems)}
    for aid, r in st["ads"].items():
        if r["brand"] in read and aid not in seen and not r.get("ended"):
            r["ended"] = today
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=KEEP_DAYS)).isoformat()
    st["ads"] = {k: r for k, r in st["ads"].items() if not r.get("ended") or r["ended"] >= cutoff}
    st.update(read_on=today, fetched_at=now, counts=counts, problems=problems, calls=calls)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(st, ensure_ascii=False, indent=1))
    if PROBLEM.exists():
        PROBLEM.unlink()
    print(f"Competitor ads (Meta): {sum(counts.values())} active UK ads ({', '.join(f'{BRANDS[k][0]} {n}' for k, n in counts.items())}); "
          f"{calls} requests" + (f"; problems: {'; '.join(problems)}" if problems else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
