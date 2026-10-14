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

France (--market fr, 14 Oct 2026; Sam: "build the things not built yet"): the French site's sailing pages
carry no terms either, but its offer pages (/offres/...) end with a "Conditions de l'offre <name>" block, and a
few pages have a footnote "*Offre … valable …". Every sitemap page except the cruise pages is read; the
terms are matched to the French promotions (tags) by name: the promotion's name is the terms' title or the
« name » the text quotes ("type"), else a main word of the name is in the title ("name", to check). Writes
state/fr/terms.json (same shape); general terms: the Conditions particulières page.

Usage: python terms.py [--fetch] [--market fr]
"""
import argparse, concurrent.futures as cf, datetime as dt, hashlib, html, json, re, sys, unicodedata
from pathlib import Path

import enrich
from coverage import sitemap_urls
from daily import london_today
import fr_enrich

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
GENERAL_FR = "https://www.ambassadorcroisieres.fr/information/conditions-particulieres"
STOP_FR = {"offre", "offres", "offert", "offerte", "offerts", "plus", "croisiere", "croisieres", "cabine", "cabines", "prix",
           "avec", "pour", "sans", "dans", "votre", "vous", "selection", "remise", "reduction", "jusqu", "caraibes",
           "mediterranee", "derniere", "nouveau", "nouvelle", "special", "speciale", "ambassador", "conditions"}


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


def _clean(t):
    t = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"(?i)<br\s*/?>|</p>|</li>", "\n", t)))
    return re.sub(r"[ \t\u00a0]+", " ", re.sub(r"\n\s*\n+", "\n", t)).strip(" \n\u200b")


def sections_fr(page, url):
    """[{title, text}] from a French page: "Conditions de l'offre X" blocks, and "*Offre … valable …" footnotes."""
    page = re.sub(r"(?s)<(script|style|noscript)\b.*?</\1>", "", page)
    out = []
    for m in re.finditer(r'(?s)<div class="cardTitle"><h\d[^>]*>(.*?)</h\d></div><div class="[^"]*descriptions[^"]*">'
                         r'(.*?)(?=<div class="rightComponents"|</div></div></div>)', page):
        t = re.match(r"(?i)(?:les\s+)?conditions\s+(?:g[ée]n[ée]rales\s+)?de\s+l['’]offre\s+(.+)", _clean(m.group(1)))
        text = _clean(m.group(2))
        if t and len(text) > 30:
            out.append({"title": t.group(1).strip(" *:"), "text": text})
    # Footnotes: the title is the offer's « name », else the words before "valable", else the line before it
    paras = [x for x in (_clean(x) for x in re.split(r"(?i)</?(?:p|h\d|li|div)\b[^>]*>", page)) if x]
    for i, x in enumerate(paras):
        if not re.match(r"\*?\s*Offre\b[^.]{0,80}\bvalable\b", x) or len(x) <= 30 or any(x[:80] in d["text"] for d in out):
            continue
        q = re.search(r"«\s*([^»]{3,60}?)\s*»", x)
        n = re.match(r"\*?\s*(Offre\s+[^.]{2,40}?)\s+valable", x)
        title = q.group(1) if q else n.group(1) if n else re.sub(r"[*!\s]+$", "", paras[i - 1]) if i else ""
        if title.strip(" *:!"):
            out.append({"title": title.strip(" *:!"), "text": x})
    return out


def doc_id(d):
    key = re.sub(r"^the\s+", "", d["title"].lower()) + "\n" + re.sub(r"\s+", " ", d["text"])
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def fr_pages():
    xml = fr_enrich.get(fr_enrich.SITEMAP)
    return sorted({html.unescape(u).strip() for u in re.findall(r"<loc>([^<]+)</loc>", xml)
                   if "/croisieres/" not in u and not u.rstrip("/").endswith("/croisieres")})


def fetch(old, fr=False):
    pages = fr_pages() if fr else sorted(u for u in sitemap_urls() if "/cruise/" not in u and "/blog/" not in u)
    if len(pages) < 20:
        raise SystemExit(f"the sitemap listed only {len(pages)} pages: terms left as they were")
    def one(u):
        try:
            return u, (sections_fr(fr_enrich.get(u), u) if fr else sections(enrich.get(u), u))
        except Exception:  # noqa
            return u, None
    with cf.ThreadPoolExecutor(4 if fr else 8) as ex:
        found = list(ex.map(one, pages))
    failed = sum(1 for _, secs in found if secs is None)
    if fr and not any(secs for _, secs in found if secs) and old:
        print("terms: no French offer terms found on any page: kept the old ones")
        return None, len(pages)
    found = [(u, secs) for u, secs in found if secs]
    today = london_today()
    docs = {}
    for u, secs in found:
        for d in secs:
            i = doc_id(d)
            e = docs.setdefault(i, {**d, "pages": [], "first_seen": (old.get(i) or {}).get("first_seen", today)})
            e["pages"].append(u)
    # A partial read (pages refused or timing out) mustn't replace good terms with a short list (QA, 13 Oct 2026)
    if failed > len(pages) * 0.2 or (old and len(docs) < len(old) * 0.5):
        print(f"terms: {failed} of {len(pages)} pages failed and {len(docs)} terms found (had {len(old)}): kept the old ones")
        return None, len(pages)
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


def norm(t):
    """Lower case, no accents, emoji, figures or punctuation: "🚢 Larguez les amarres*" → "larguez les amarres"."""
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z]+", " ", t)).strip()


def match_fr(docs, state):
    """{offer id: [doc ids]} for the French promotions (tags), by name."""
    try:
        overrides = json.loads((ROOT / "terms_overrides.json").read_text())
    except FileNotFoundError:
        overrides = {}
    out, how = {}, {}
    for oid, o in (state.get("offers") or {}).items():
        name = (o.get("name") or "").strip()
        if name in overrides:
            want = {t.lower() for t in overrides[name]}
            out[oid], how[oid] = [i for i, d in docs.items() if d["title"].lower() in want], "by hand"
            continue
        n = norm(name)
        hits, by = [i for i, d in docs.items() if n and (norm(d["title"]) == n or
                    any(norm(q) == n for q in re.findall(r"«\s*([^»]+?)\s*»", d["text"])))], "type"
        if not hits:
            words = {w for w in n.split() if len(w) >= 4 and w not in STOP_FR}
            hits, by = [i for i, d in docs.items() if words & set(norm(d["title"]).split())], "name"
        out[oid] = sorted(hits, key=lambda i: docs[i]["title"])
        if hits:
            how[oid] = by
    return out, how


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="read the website even if it was read today")
    ap.add_argument("--market", choices=["uk", "fr"], default="uk")
    a = ap.parse_args()
    fr = a.market == "fr"
    sub = ROOT / "state" / ("fr" if fr else "")
    OUT = sub / "terms.json"
    matcher, general = (match_fr, GENERAL_FR) if fr else (match, GENERAL)
    old = json.loads(OUT.read_text()) if OUT.exists() else {}
    state = json.loads((sub / "current.json").read_text())
    docs, checked, at = old.get("docs") or {}, old.get("pages_checked", 0), old.get("fetched_at")
    known = set(old.get("known_at_fetch") or [])
    live = {oid for r in state["sailings"].values() if not r.get("removed")
            for oid, spans in (r.get("promos") or {}).items() if spans and spans[-1][1] is None}
    offers, how = matcher(docs, state)
    # New since the last read and nothing matched: its terms may have gone up with it, so read again now
    fresh = sorted(o for o in live if not offers.get(o) and o not in known)
    why = "asked" if a.fetch else "first read today" if not at or london_today() != at[:10] else \
          f"new promotion{'s' if len(fresh) > 1 else ''} with no terms: " + ", ".join(state["offers"][o]["name"] for o in fresh) if fresh else ""
    if why:
        print(f"terms: reading the website ({why})")
        new, checked = fetch(docs, fr)
        if new is not None:   # else keep the old terms and their read time, so the next check tries again
            docs = new
            at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            known = set(state.get("offers") or {})
        offers, how = matcher(docs, state)
    OUT.write_text(json.dumps({"fetched_at": at, "pages_checked": checked, "general": general, "docs": docs,
                               "offers": offers, "how": how, "known_at_fetch": sorted(known)}, ensure_ascii=False, indent=1))
    print(f"terms{' (France)' if fr else ''}: {len(docs)} found on {checked} pages (read {at}); "
          f"{sum(1 for o in live if offers.get(o))} of {len(live)} live promotions matched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
