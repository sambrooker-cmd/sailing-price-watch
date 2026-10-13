"""Promotion terms and conditions from the website (Sam, 13 Oct 2026).

The sailing pages' promotions carry no terms of their own (FareSummary terms_and_conditions_text is
empty for every offer), so this reads the "Terms and Conditions" sections on the rest of the website
(every sitemap page except /cruise/ and /blog/: deals, landing pages, the coach page...) and matches
them to the live promotions in state/current.json:
  * a promo code in the promotion's name or description (e.g. COTW15) that the terms mention;
  * a keyword in the promotion's name that the terms' title has (KEYWORDS: onboard credit, coach,
    deposit, ...);
  * else a main word of the promotion's name (not a STOP word, 4+ letters) in the terms' title
    (Sam, 13 Oct 2026, so new kinds of promotion find their terms; marked "by name" to check);
  * terms_overrides.json {"<promotion name>": ["<terms title>", ...]} to add or (with []) remove matches.
Promotions with no match are listed as such; the page then points to the general booking terms.
How each was matched is in "how" (code / type / name / by hand).

Writes state/terms.json:
  {"fetched_at", "pages_checked", "docs": {id: {title, text, pages, first_seen}},
   "offers": {offer id: [doc ids]}, "general": url}
The website is read once a UK day (or with --fetch), and again at once when a live promotion appears
that has no terms and wasn't known at the last read (Sam, 13 Oct 2026: a promotion and its terms
going live mid-morning get them that hour, not the next day). Matching runs every check. Read-only: it never changes anything on the website.

Usage: python terms.py [--fetch]
"""
import argparse, concurrent.futures as cf, datetime as dt, hashlib, html, json, re, sys
from pathlib import Path

import enrich
from coverage import sitemap_urls
from daily import london_today

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "state" / "terms.json"
GENERAL = "https://www.ambassadorcruiseline.com/information/terms-conditions/"
# keyword in a promotion's name → the same words in the terms' title
KEYWORDS = ("onboard credit", "coach", "deposit", "solo", "upper class", "bubbles", "nectar")
CODE = re.compile(r"\b[A-Z]{3,}\d{1,4}\b")
# Words too common in promotion names to say which terms they mean
STOP = {"free", "save", "saving", "savings", "off", "new", "lower", "reduced", "offer", "offers", "cruise", "cruises",
        "week", "the", "and", "with", "per", "cabin", "cabins", "fare", "fares", "extra", "special", "ambassador",
        "terms", "conditions", "price", "prices", "only", "from", "your", "book", "booking", "early", "limited",
        "time", "deal", "deals", "sale", "view", "ocean", "inside", "balcony", "suite", "guest", "guests"}


def sections(page, url):
    """[{title, text}] from a page's "Terms and Conditions" prose sections."""
    out = []
    t = re.search(r"<title>([^<]*)</title>", page)
    page_title = html.unescape(t.group(1)).split("|")[0].strip() if t else url
    for m in re.finditer(r'<div class="prose[^"]*">(.*?)</div>', page, re.S):
        body = m.group(1)
        if not re.search(r"(?i)terms\s*(and|&amp;|&)\s*conditions", re.sub(r"<[^>]+>", "", body)[:300]):
            continue
        parts = re.split(r"<b>(.*?)</b>", body, flags=re.S)
        blocks = []
        for i in range(1, len(parts), 2):
            title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", parts[i]))).strip(" *:​")
            text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"(?i)<br\s*/?>|</p>", "\n", parts[i + 1])))
            text = re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip(" \n​")
            if re.fullmatch(r"(?i)\*?terms\s*(and|&)\s*conditions:?", title):
                continue
            blocks.append([title, text])
        if not blocks:
            continue
        # A heading with no text of its own (the coach page), or many short pieces (a numbered list),
        # is one document, not separate terms.
        if not blocks[0][1] or len(blocks) > 8:
            head = blocks[0][0] if not blocks[0][1] else page_title
            rest = blocks[1:] if not blocks[0][1] else blocks
            out.append({"title": head, "text": "\n".join(f"{a} {b}".strip() for a, b in rest)})
        else:
            out += [{"title": a, "text": b} for a, b in blocks if b and len(b) > 30]
    return out


def doc_id(d):
    key = re.sub(r"^the\s+", "", d["title"].lower()) + "\n" + re.sub(r"\s+", " ", d["text"])
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def fetch(old):
    pages = sorted(u for u in sitemap_urls() if "/cruise/" not in u and "/blog/" not in u)
    if len(pages) < 20:
        raise SystemExit(f"the sitemap listed only {len(pages)} pages: terms left as they were")
    def one(u):
        try:
            return u, sections(enrich.get(u), u)
        except Exception:  # noqa
            return u, []
    with cf.ThreadPoolExecutor(8) as ex:
        found = list(ex.map(one, pages))
    today = london_today()
    docs = {}
    for u, secs in found:
        for d in secs:
            i = doc_id(d)
            e = docs.setdefault(i, {**d, "pages": [], "first_seen": (old.get(i) or {}).get("first_seen", today)})
            e["pages"].append(u)
    return docs, len(pages)


def match(docs, state):
    """{offer id: [doc ids]} for every promotion in the state's catalogue."""
    try:
        overrides = json.loads((ROOT / "terms_overrides.json").read_text())
    except FileNotFoundError:
        overrides = {}
    out, how = {}, {}
    for oid, o in (state.get("offers") or {}).items():
        name, desc = (o.get("name") or "").strip(), o.get("desc") or ""
        if name in overrides:
            want = {t.lower() for t in overrides[name]}
            out[oid], how[oid] = [i for i, d in docs.items() if d["title"].lower() in want], "by hand"
            continue
        codes = set(CODE.findall(f"{name} {desc}"))
        hits, by = [i for i, d in docs.items() if any(re.search(rf"\b{c}\b", d["text"] + " " + d["title"]) for c in codes)], "code"
        if not hits:
            words = [k for k in KEYWORDS if k in name.lower()]
            hits, by = [i for i, d in docs.items() if any(k in d["title"].lower() for k in words)], "type"
        if not hits:
            words = {w for w in re.findall(r"[a-z]+", name.lower()) if len(w) >= 4 and w not in STOP}
            hits, by = [i for i, d in docs.items() if words & set(re.findall(r"[a-z]+", d["title"].lower()))], "name"
        out[oid] = sorted(hits, key=lambda i: docs[i]["title"])
        if hits:
            how[oid] = by
    return out, how


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="read the website even if it was read today")
    a = ap.parse_args()
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    state = json.loads((ROOT / "state" / "current.json").read_text())
    docs, checked, at = old.get("docs") or {}, old.get("pages_checked", 0), old.get("fetched_at")
    known = set(old.get("known_at_fetch") or [])
    live = {oid for r in state["sailings"].values() if not r.get("removed")
            for oid, spans in (r.get("promos") or {}).items() if spans and spans[-1][1] is None}
    offers, how = match(docs, state)
    # New since the last read and nothing matched: its terms may have gone up with it, so read again now
    fresh = sorted(o for o in live if not offers.get(o) and o not in known)
    why = "asked" if a.fetch else "first read today" if not at or london_today() != at[:10] else \
          f"new promotion{'s' if len(fresh) > 1 else ''} with no terms: " + ", ".join(state["offers"][o]["name"] for o in fresh) if fresh else ""
    if why:
        print(f"terms: reading the website ({why})")
        docs, checked = fetch(docs)
        at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        known = set(state.get("offers") or {})
        offers, how = match(docs, state)
    OUT.write_text(json.dumps({"fetched_at": at, "pages_checked": checked, "general": GENERAL, "docs": docs,
                               "offers": offers, "how": how, "known_at_fetch": sorted(known)}, ensure_ascii=False, indent=1))
    print(f"terms: {len(docs)} found on {checked} pages (read {at}); "
          f"{sum(1 for o in live if offers.get(o))} of {len(live)} live promotions matched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
