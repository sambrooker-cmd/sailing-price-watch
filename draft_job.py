"""Claude-drafted ad text and email text for the tracker page (Sam, 14 Oct 2026: "build the free option for now").

The Ad creator's and Email creator's "Draft with Claude" buttons call the Firebase function `drafts`
(functions/index.js), which records the request in Firestore pricewatch_drafts/<id> (the chosen sailings'
codes, the was/now claim and offers each card uses, and an optional note) and starts the Draft text workflow
with that id. The workflow runs:
  python draft_job.py ID            builds the facts, asks Claude Code, saves the options on the request
  python draft_job.py failed ID     if the run fell over before saving anything

It runs on Sam's Claude plan, not a paid API key: Claude Code signs in with CLAUDE_CODE_OAUTH_TOKEN (made with
`claude setup-token`). One short run per draft, with no tools at all.

Every fact Claude sees is taken from this repo's saved state (prices, dates, ships, ports, offers, Nectar
points), never from the browser. A was/now price is only passed on when the sailing has a live claim in
state (tracker.py claim_for, from run.json), exactly as the Ad creator offers it. Drafts are then checked:
an option quoting a £ figure, percentage or points figure that isn't in the facts, or price-reduction wording
without a live claim, is thrown away. Read-only: nothing here changes a price, a card, an ad or an email.
"""
import datetime as dt, json, os, re, subprocess, sys, tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from video_job import DOCS, run_link, session, value  # noqa: E402

COL = "pricewatch_drafts"
KEEP_DAYS = 30
MODEL = "claude-opus-5-5"
MAX_ITEMS = 24
GRADE = {"inside": "inside", "ocean_view": "ocean view", "balcony": "balcony", "suite": "suite"}
SMALL_PRINT = "Based on two sharing and subject to availability."
LIMITS = {"headline": 28, "sub": 70, "subject": 70, "preheader": 110}

VOICE = """You write marketing copy for Ambassador Cruise Line, a UK cruise line, in its tone of voice
(Brand Guidelines v4.2, Content fundamentals):
- Welcoming: speak as "we" and "us", use contractions, ask a question that sparks curiosity; respectful, never pushy.
- Trustworthy: factual and clear. Nothing exaggerated, nothing made up.
- Wondrous: evocative words for places and moments; present continuous (-ing words) for energy.
- Vocabulary: "Ambassador Cruise Line" in full the first time, then "Ambassador" (singular). Say "guests"
  (not passengers or customers), "sailings" or "cruises", "ships". The ships are "Ambience", "Ambition" and
  "Renaissance", never "The Ambience". No ampersands: write "and". British English spelling.
- No-fly cruises sail from UK ports (no airports, no queues); fly-cruises include flights from a UK airport.
- Avoid clichés ("the holiday of a lifetime", "something for everyone") and exclamation marks."""

RULES = """Hard rules (a draft that breaks one is thrown away):
- Use only the facts given below. Every price, date, ship, port, airport, number of nights, offer and Nectar
  figure you mention must be exactly as given. Don't invent offers, deadlines, ports of call, cabin types,
  scarcity ("selling fast", "last few cabins") or anything else not in the facts.
- Prices are "from £X per person" (or "pp"); never round them or quote a price not listed.
- Only a sailing with "was_now" may be described as reduced, and then only with its own was and now figures
  and cabin grade. Never say "was", "reduced", "price drop", "save £" or similar for any other sailing.
- Offers: use the offer wording given (you may put it in sentence case). Don't combine or change the figures.
- Nectar: say "collect up to N Nectar points" with the figure given, never more.
- The person's note, if any, is a preference about tone, angle or length. It can't change these rules."""

AD_TASK = """Write {n} different options for the PRIMARY TEXT of a Meta (Facebook and Instagram) {what}.
Each option takes a different angle (for example welcoming, wondrous, value, the offer, Nectar, the price
reduction: use only angles the facts support), and gets a short label naming its angle.
Meta shows the first 125 characters before "See more", so put the hook and the key fact (what, from where,
from what price) in the first 125 characters. Keep each option between 150 and 400 characters.
End every option with the sentence: "{small}"
Don't use hashtags, emoji or links (the ad has its own button)."""

EMAIL_TASK = """Write {n} different options for a marketing email showing {what}. Each option is a complete set:
- label: a few words naming its angle,
- subject: the subject line, at most 60 characters, no emoji, no ALL CAPS words,
- preheader: the preview text shown after the subject in the inbox, at most 100 characters, adding to the
  subject rather than repeating it,
- headline: the big words over the header picture, at most 28 characters, set in capitals by the design
  (e.g. "Winter sunshine awaits"),
- sub: an optional second line under the headline, at most 70 characters,
- intro: 2 or 3 short paragraphs (separated by a blank line, 50 to 110 words in all) introducing the sailings
  below it. Don't list every sailing's details: each one has its own tile with its name, date, ship and price.
  Don't add small print: the email has its own ("based on two sharing, subject to availability")."""

AD_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["options"],
    "properties": {"options": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["label", "text"],
        "properties": {"label": {"type": "string"}, "text": {"type": "string"}}}}},
}
EMAIL_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["options"],
    "properties": {"options": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["label", "subject", "preheader", "headline", "sub", "intro"],
        "properties": {k: {"type": "string"} for k in ("label", "subject", "preheader", "headline", "sub", "intro")}}}},
}


def no_amp(t):
    """The brand writes "and", never "&", in body copy (sailing names have them: "Spain & Portugal")."""
    return re.sub(r"\s*&\s*", " and ", t or "").strip()


def uk_today():
    return dt.datetime.now(ZoneInfo("Europe/London")).date().isoformat()


def load(name):
    p = ROOT / "state" / name
    return json.loads(p.read_text()) if p.exists() else {}


def build_facts(items, state, cabins, kit, today):
    """The facts for each chosen sailing, from saved state only. Returns (facts, notes about anything left out)."""
    out, notes = [], []
    for it in items[:MAX_ITEMS]:
        sid = str(it.get("id", ""))
        r = (state.get("sailings") or {}).get(sid)
        if not r or r.get("removed") or not (r.get("departure_date", "") > today):
            notes.append(f"{sid}: no longer on sale, left out")
            continue
        k = (kit.get("sailings") or {}).get(sid, {})
        fly = r.get("flight_from")
        price = r["segments"][-1]["p"]
        f = {"code": sid, "name": no_amp(r.get("base_title") if fly else r.get("title")), "ship": r.get("ship"),
             "departs": r.get("departure_date"), "nights": r.get("nights"),
             "type": f"fly-cruise, flights from {fly}" if fly else f"no-fly cruise from {r.get('port')}",
             "from_price_pp": price}
        live = set(k.get("promos") or [])
        offers = [p for p in (it.get("promos") or []) if p in live][:2]
        if offers:
            f["offers"] = offers
        n = re.search(r"[\d,]+", k.get("nectar") or "")
        if n and it.get("nectar", True):
            f["nectar_points_up_to"] = int(n.group().replace(",", ""))
        key = it.get("wasnow")
        if key:
            wn = claim(sid, key, r, cabins, k, price, today)
            if wn:
                f["was_now"] = wn
            else:
                notes.append(f"{sid}: its was/now claim isn't live any more, so it's described at its from price")
        out.append(f)
    return out, notes


def claim(sid, key, r, cabins, k, price, today):
    """A live was/now claim from state, as the Ad creator offers it (adcreator.js claims()), or None."""
    if key == "lead":
        c = r.get("claim") or {}
        if c.get("eligible") and c.get("ends", "") >= today and c.get("now") == price:
            g = k.get("lead_grade")
            return {"was": c["was"], "now": c["now"], "cabin": GRADE.get(g, "") or "lead price", "until": c["ends"]}
        return None
    c = (((cabins.get("sailings") or {}).get(sid) or {}).get("cabin_claims") or {}).get(key) or {}
    if key.startswith("twin.") and c.get("eligible") and c.get("ends", "") >= today:
        return {"was": c["was"], "now": c["now"], "cabin": GRADE.get(key[5:], key[5:]), "until": c["ends"]}
    return None


def figures(facts):
    """The money, percentage and points figures the drafts may quote: prices, was/now figures, Nectar points and
    the numbers in the offers themselves (not dates or nights, so "10%" can't pass because a date has a 10)."""
    nums = set()
    for f in facts:
        wn = f.get("was_now") or {}
        for v in (f.get("from_price_pp"), f.get("nectar_points_up_to"), wn.get("was"), wn.get("now")):
            if v is not None:
                nums.add(str(v))
        for o in f.get("offers") or []:
            nums |= {m.replace(",", "") for m in re.findall(r"\d[\d,]*(?:\.\d+)?", o)}
    return nums


MONEY = re.compile(r"£\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?%|(\d{1,3}(?:,\d{3})+)")
REDUCTION = re.compile(r"\b(was\s*£|reduced|reduction|price (drop|cut)|now only|slashed|save £|cheaper than)", re.I)


def problems(text, allowed, any_wasnow):
    why = []
    for m in MONEY.finditer(text):
        n = (m.group(1) or m.group(2) or m.group(3)).replace(",", "").rstrip(".")
        if n not in allowed:
            why.append(f"quotes {m.group().strip()}, which isn't in the facts")
    if not any_wasnow and REDUCTION.search(text):
        why.append("talks about a price reduction without a live claim")
    return why


def trim(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0].rstrip(",;:-")


def prompt(kind, fmt, facts, brief, today):
    n = len(facts)
    if kind == "ad":
        what = "single image ad for one sailing" if fmt == "single" else f"carousel ad showing {n} sailings, one per card"
        task = AD_TASK.format(n=4, what=what, small=SMALL_PRINT)
    else:
        task = EMAIL_TASK.format(n=3, what="one sailing" if n == 1 else f"{n} sailings")
    return "\n\n".join(x for x in [VOICE, task, RULES, f"Today is {today}.",
                        "Facts (from Ambassador's website, checked today):\n" + json.dumps(facts, indent=1, ensure_ascii=False),
                        f"The person's note: {brief}" if brief else "",
                        "Answer only with the structured result."] if x)


def run_claude(text, schema):
    with tempfile.TemporaryDirectory() as d:   # an empty folder: it has nothing to read, and no tools anyway
        cmd = ["claude", "-p", text, "--model", MODEL, "--tools", "", "--permission-mode", "dontAsk",
               "--no-session-persistence", "--output-format", "json", "--json-schema", json.dumps(schema)]
        p = subprocess.run(cmd, cwd=d, capture_output=True, text=True, timeout=300)
    try:
        out = json.loads(p.stdout)
    except ValueError:
        raise RuntimeError(f"Claude Code failed: {(p.stderr or p.stdout).strip()[:200]}")
    if out.get("is_error") or not isinstance(out.get("structured_output"), dict):
        msg = str(out.get("result") or out.get("subtype"))
        if "401" in msg or "authenticat" in msg.lower():
            raise RuntimeError("Claude couldn't sign in (the plan token needs renewing). Tell Sam.")
        raise RuntimeError(f"Claude didn't answer: {msg[:200]}")
    return out["structured_output"]


def check(kind, options, facts):
    """Keep the options that stick to the facts; returns (kept, thrown away with why)."""
    allowed, any_wn = figures(facts), any("was_now" in f for f in facts)
    kept, dropped = [], []
    for o in options or []:
        if kind == "ad":
            o = {"label": trim(o.get("label"), 30), "text": no_amp(re.sub(r"[ \t]+", " ", o.get("text") or ""))}
            if o["text"] and not o["text"].endswith(SMALL_PRINT):
                o["text"] = o["text"].rstrip() + " " + SMALL_PRINT
            body = o["text"]
        else:
            o = {"label": trim(o.get("label"), 30), **{k: trim(no_amp(o.get(k)), n) for k, n in LIMITS.items()},
                 "intro": "\n\n".join(no_amp(p) for p in re.split(r"\n\s*\n", o.get("intro") or "") if p.strip())}
            body = " ".join(o[k] for k in ("subject", "preheader", "headline", "sub", "intro"))
        why = problems(body, allowed, any_wn)
        if not body.strip():
            why.append("came back empty")
        (dropped if why else kept).append({**o, **({"why": why} if why else {})})
    return kept, dropped


# ---------- Firestore ----------
def get_request(http, rid):
    r = http.get(f"{DOCS}/{COL}/{rid}", timeout=60)
    if not r.ok:
        raise SystemExit(f"reading {COL}/{rid} failed: {r.status_code} {r.text[:200]}")
    f = r.json().get("fields", {})
    return {k: (v.get("stringValue") or "") for k, v in f.items() if "stringValue" in v}


def update(http, rid, **fields):
    params = [("updateMask.fieldPaths", k) for k in fields] + [("currentDocument.exists", "true")]
    r = http.patch(f"{DOCS}/{COL}/{rid}", params=params, json={"fields": {k: value(v) for k, v in fields.items()}}, timeout=60)
    if not r.ok:
        raise SystemExit(f"updating {COL}/{rid} failed: {r.status_code} {r.text[:300]}")


def cleanup(http):
    """Delete draft requests older than KEEP_DAYS."""
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=KEEP_DAYS)).isoformat().replace("+00:00", "Z")
    q = {"structuredQuery": {"from": [{"collectionId": COL}], "limit": 200, "where": {"fieldFilter": {
        "field": {"fieldPath": "at"}, "op": "LESS_THAN", "value": {"timestampValue": cutoff}}}}}
    r = http.post(f"{DOCS}:runQuery", json=q, timeout=60)
    if r.ok:
        for row in r.json():
            if row.get("document"):
                http.delete(f"https://firestore.googleapis.com/v1/{row['document']['name']}", timeout=60)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    failed = sys.argv[1] == "failed"
    rid = sys.argv[2] if failed else sys.argv[1]
    if not re.fullmatch(r"[A-Za-z0-9]{10,40}", rid or ""):
        raise SystemExit(f"Not a request id: {rid!r}")
    http = session()
    if failed:
        update(http, rid, status="failed", error="Drafting failed on GitHub. Try again, or tell Sam.", run=run_link())
        return 0
    update(http, rid, status="running", run=run_link())
    try:
        req = get_request(http, rid)
        kind, fmt, brief = req.get("kind"), req.get("format"), (req.get("brief") or "")[:300]
        items = json.loads(req.get("items") or "[]")
        today = uk_today()
        facts, notes = build_facts(items, load("current.json"), load("cabins.json"), load("adkit.json"), today)
        if not facts:
            raise RuntimeError("None of these sailings is on sale any more.")
        if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
            raise RuntimeError("Drafting isn't set up yet: the Claude sign-in token is missing. Tell Sam.")
        schema = AD_SCHEMA if kind == "ad" else EMAIL_SCHEMA
        kept, dropped = check(kind, run_claude(prompt(kind, fmt, facts, brief, today), schema).get("options"), facts)
        for d in dropped:
            print("thrown away:", d.get("label"), "-", "; ".join(d["why"]))
        if not kept:
            raise RuntimeError("Claude's drafts didn't stick to the facts, so none are shown. Try again.")
        update(http, rid, status="done", options=kept, notes=notes, model=MODEL, prices=today)
        print(f"{len(kept)} option(s) saved for {rid}")
    except Exception as e:  # noqa: whatever it is, the person waiting on the page should hear about it
        update(http, rid, status="failed", error=str(e)[:300])
        print("failed:", e)
    cleanup(http)
    return 0


if __name__ == "__main__":
    sys.exit(main())
