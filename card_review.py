"""Claude looks over newly made or remade standard cards and lists any that need a person's eye
(Sam, 12 Oct 2026, "option 3").

Runs in the hourly price watch after cards_sync.py:
  python card_review.py

For each sailing whose current cards haven't been checked yet, it downloads the three
JPEGs (1x1, 4x5, 9x16), sends them to Claude with what should be printed on them, and asks
for problems a person would spot: clipped or overlapping text, wrong or missing details,
the sailing name over two lines, a price spilling out of its panel, 9:16 content inside
Meta's overlay zones, or a photo that looks wrong (campaign artwork with its own text
clashing with the card, a badly cropped or broken image).

The result goes into state/cards.json (current["review"], tied to the card fingerprint, so
remade cards are checked again) and, for cards with problems, into out/review.md for the
"Cards to check" issue. It only reads cards: it never changes or deletes one, never touches
prices, and never touches Meta or any ad account. A person always decides.

Costs money on Anthropic's API (roughly 5p a sailing). Does nothing unless the
ANTHROPIC_API_KEY secret is set. At most MAX_PER_RUN sailings per check, so the first
backfill of every card is spread over a few checks and a run can never cost much.
"""
import base64, datetime as dt, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "state" / "cards.json"
MODEL = "claude-opus-5-5"
MAX_PER_RUN = 40
SIZES = ("1x1", "4x5", "9x16")

SCHEMA = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean", "description": "true when nothing needs a person's eye"},
        "issues": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "size": {"type": "string", "enum": ["1x1", "4x5", "9x16", "all"]},
                "severity": {"type": "string", "enum": ["fix", "look"],
                             "description": "fix: wrong or unusable as it stands; look: probably fine, worth a glance"},
                "problem": {"type": "string", "description": "one short plain-English sentence"},
            },
            "required": ["size", "severity", "problem"], "additionalProperties": False}},
    },
    "required": ["ok", "issues"], "additionalProperties": False,
}

GUIDE = """You check social media ad cards for Ambassador Cruise Line before a person uses them.
Each card is a cruise photo with the brand's design on top: a white logo top left; a green badge
top right ("No-fly on <ship> / from <port>" or "Fly-cruise on <ship> / Flights from <airport>");
at the bottom left a stack of angled strips: optional kicker (purple), the sailing name in capitals
(purple), an orange panel with the date and nights then "From £X pp", an optional pale Nectar
strip, and green promotion strips. When the photo is campaign artwork (it has its own text or
graphics), it is shown whole in a band between the badge and the strips, over a blurred copy of
itself.

You get the same card in three sizes: 1x1 (1080x1080), 4x5 (1080x1350) and 9x16 (1080x1920).

Report only real problems a careful person would want to fix or glance at:
- Text clipped, cut off, running off the card or out of its strip/panel, or overlapping other text.
- The sailing name on more than two lines.
- The price not fitting inside the orange panel.
- On 9x16 only: the logo, badge or any strip inside the top 14% or the bottom 20% of the frame
  (Instagram/Facebook cover those areas).
- Printed details that don't match the expected details below (name, ship, port or airport,
  date, nights, price, promotion text, Nectar text), or something expected that is missing.
  Capitals, the date's format, and a name split across a small kicker strip and a larger
  strip are by design. The departure date is printed like "15 Oct 2026".
- The photo looking wrong: broken or blank image, an awkward crop (heads or key subject cut
  off), campaign artwork whose own text is cut off, or artwork text clashing with the card's
  strips or badge.

Don't comment on taste, design choices, colours, fonts, or marketing wording, and don't suggest
improvements. If all three cards are fine, return ok true with no issues."""


def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def expected(sid, c):
    lines = [f"Cruise code: {sid}", f"Sailing name: {c.get('title')}", f"Ship: {c.get('ship')}"]
    lines.append(f"Flights from: {c['flight_from']}" if c.get("flight_from") else f"Sails from: {c.get('port')}")
    lines += [f"Departs: {c.get('departure_date')}", f"Nights: {c.get('nights')}", f"From price: £{c.get('price'):,} pp",
              f"Promotion strips: {' | '.join(c.get('promos') or []) or 'none'}",
              f"Nectar strip: {c.get('nectar') or 'none'}",
              f"Campaign artwork shown whole: {'yes' if c.get('layout') == 'campaign' else 'no'}"]
    return "\n".join(lines)


def todo(man):
    """Sailings whose current cards haven't been checked; campaign artwork first, then newest."""
    out = [(sid, m["current"]) for sid, m in man.get("sailings", {}).items()
           if m.get("current") and (m["current"].get("review") or {}).get("fp") != m["current"].get("fp")]
    camp = [x for x in out if x[1].get("layout") == "campaign"]
    rest = sorted([x for x in out if x[1].get("layout") != "campaign"], key=lambda x: x[1].get("made_at") or "", reverse=True)
    return camp + rest


def fetch(url, http):
    r = http.get(url, timeout=60)
    r.raise_for_status()
    return base64.standard_b64encode(r.content).decode()


def review(client, sid, c, http):
    content = []
    for tag in SIZES:
        f = (c.get("files") or {}).get(tag)
        if not f:
            continue
        content += [{"type": "text", "text": f"Card {tag}:"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": fetch(f["url"], http)}}]
    content.append({"type": "text", "text": "Expected details:\n" + expected(sid, c)})
    resp = client.beta.messages.create(
        model=MODEL, max_tokens=8000, system=GUIDE,
        messages=[{"role": "user", "content": content}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude declined to check these cards")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("Claude's answer was cut off")
    text = next(b.text for b in resp.content if b.type == "text")
    out = json.loads(text)
    out["ok"] = out["ok"] and not out["issues"]
    return out, resp.model


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Card check skipped: no ANTHROPIC_API_KEY secret.")
        return 0
    if not MANIFEST.exists():
        print("No cards yet.")
        return 0
    import anthropic, requests
    man = json.loads(MANIFEST.read_text())
    queue = todo(man)
    batch = queue[:MAX_PER_RUN]
    print(f"Card check: {len(queue)} sailing(s) not checked yet; checking {len(batch)} now.")
    client, http = anthropic.Anthropic(), requests.Session()
    flagged, errors = [], []
    for sid, c in batch:
        try:
            res, model = review(client, sid, c, http)
        except Exception as e:  # noqa: one failure mustn't stop the rest; it's retried next check
            errors.append(f"{sid}: {str(e)[:200]}")
            continue
        c["review"] = {"fp": c.get("fp"), "at": now_utc(), "ok": res["ok"], "issues": res["issues"], "model": model}
        if not res["ok"]:
            flagged.append((sid, c))
        MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1))  # after each, so a crash loses little

    left = len(queue) - len(batch) + len(errors)
    lines = []
    if flagged:
        lines += [f"Claude checked {len(batch) - len(errors)} sailing(s) with new or remade cards; "
                  f"{len(flagged)} need a look before they're used:", ""]
        for sid, c in flagged:
            lines.append(f"- **{sid}** {c.get('title')} ({c.get('reason')})")
            lines += [f"  - {i['size'].replace('x', ':') if i['size'] != 'all' else 'All sizes'}"
                      f"{' (fix)' if i['severity'] == 'fix' else ''}: {i['problem']}" for i in c["review"]["issues"]]
        lines += ["", "Open the sailing on the tracker page's Cards page to see them. Claude can be wrong: "
                  "you decide. Nothing has been changed or sent anywhere."]
    if errors:
        lines += ["", f"Couldn't check {len(errors)} (tried again next check):", *[f"- {e}" for e in errors]]
    if left:
        lines += ["", f"{left} sailing(s) still to check; the next checks carry on."]
    text = "\n".join(lines)
    print(text or f"Checked {len(batch)} sailing(s): all fine.")
    (ROOT / "out").mkdir(exist_ok=True)
    if flagged:
        (ROOT / "out" / "review.md").write_text(text + "\n")
    with open(ROOT / "out" / "summary.md", "a") as f:
        f.write(f"\n## Card check\n\nChecked {len(batch) - len(errors)} sailing(s), {len(flagged)} flagged.\n" +
                (("\n" + text + "\n") if text else ""))
    p = os.environ.get("GITHUB_OUTPUT")
    if p:
        with open(p, "a") as f:
            f.write(f"flagged={len(flagged)}\n")
    return 1 if errors and len(errors) == len(batch) else 0


if __name__ == "__main__":
    sys.exit(main())
