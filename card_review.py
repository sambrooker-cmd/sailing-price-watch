"""Claude looks over newly made or remade standard cards and lists any that need a person's eye
(Sam, 12 Oct 2026, "option 3").

Runs in the hourly price watch after cards_sync.py:
  python card_review.py

For each sailing whose current cards haven't been checked yet, it downloads the three
JPEGs (1x1, 4x5, 9x16) and asks Claude Code to look at them against what should be printed
on them, for problems a person would spot: clipped or overlapping text, wrong or missing
details, the sailing name over two lines, a price spilling out of its panel, 9:16 content
inside Meta's overlay zones, or a photo that looks wrong (campaign artwork with its own text
clashing with the card, a badly cropped or broken image). One short Claude Code run per
sailing, allowed only to read that sailing's three images.

It runs on Sam's Claude plan, not a paid API key (Sam, 12 Oct 2026): Claude Code signs in
with CLAUDE_CODE_OAUTH_TOKEN (made with `claude setup-token`) and uses the plan's usage.
To spare that usage, the first check of every card was split over four of the plan's
5-hour usage windows (Sam): while more than SMALL sailings are waiting, a check takes at
most BATCH of them and then waits WINDOW_HOURS before taking the next batch. After that,
the few cards remade each day are checked at the next hourly check.

The result goes into state/cards.json (current["review"], tied to the card fingerprint, so
remade cards are checked again) and, for cards with problems, into out/review.md for the
"Cards to check" issue. It only reads cards: it never changes or deletes one, never touches
prices, and never touches Meta or any ad account. A person always decides.
"""
import datetime as dt, json, math, os, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "state" / "cards.json"
MODEL = "claude-opus-5-5"
BATCH = 56          # ~220 sailings to check at first → 4 batches (Sam: over 4 usage windows)
SMALL = 15          # with this many or fewer waiting, check them all straight away
WINDOW_HOURS = 5    # the plan's usage window
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
graphics), it is shown whole in a band between the badge and the strips, on two plain colours taken
from the artwork's own top and bottom edges (no blur).

Was/now (price reduction) cards use a different design: a full-bleed photo, the logo top left, a
tilted orange "Price reduction" sticker top right with the cabin grade, "Was £X" struck through and
"Now £Y pp", and a pale panel at the bottom with date | nights, the sailing name, the port or
airport and ship, and a small-print line with the cruise code. On these, the was and now prices
must be exactly the expected ones, and the price must fit inside the sticker.

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


def hours_between(a, b):
    p = lambda x: dt.datetime.fromisoformat(x.replace("Z", "+00:00"))
    return (p(b) - p(a)).total_seconds() / 3600


def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def expected(sid, c, s=None):
    if c.get("kind") == "wasnow":
        s = s or {}
        grade = (c.get("cabin") or "").replace("twin.", "").replace("_", " ")
        return "\n".join([
            "Card type: was/now (price reduction)", f"Cruise code: {sid}", f"Sailing name: {c.get('title')}",
            f"Ship: {s.get('ship')}", f"Flights from: {s['flight_from']}" if s.get("flight_from") else f"Sails from: {s.get('port')}",
            f"Departs: {s.get('departure_date')}", f"Nights: {s.get('nights')}",
            f"Cabin grade on the sticker: {grade or 'the grade of the lead price'}",
            f"Was price: £{c['was']:,.0f}", f"Now price: £{c['now']:,.0f} pp"])
    lines = [f"Cruise code: {sid}", f"Sailing name: {c.get('title')}", f"Ship: {c.get('ship')}"]
    lines.append(f"Flights from: {c['flight_from']}" if c.get("flight_from") else f"Sails from: {c.get('port')}")
    lines += [f"Departs: {c.get('departure_date')}", f"Nights: {c.get('nights')}", f"From price: £{c.get('price'):,} pp",
              f"Promotion strips: {' | '.join(c.get('promos') or []) or 'none'}",
              f"Nectar strip: {c.get('nectar') or 'none'}",
              f"Campaign artwork shown whole: {'yes' if (c.get('layout') or '').startswith('campaign') else 'no'}"]
    return "\n".join(lines)


def todo(man):
    """Cards not checked yet: was/now cards first, then campaign artwork, then newest."""
    unchecked = lambda c: (c.get("review") or {}).get("fp") != c.get("fp")
    wasnow = [(sid, c) for sid, m in man.get("sailings", {}).items() for c in (m.get("wasnow") or {}).values() if unchecked(c)]
    out = [(sid, m["current"]) for sid, m in man.get("sailings", {}).items()
           if m.get("current") and unchecked(m["current"])]
    camp = [x for x in out if (x[1].get("layout") or "").startswith("campaign")]
    rest = sorted([x for x in out if not (x[1].get("layout") or "").startswith("campaign")], key=lambda x: x[1].get("made_at") or "", reverse=True)
    return wasnow + camp + rest


class SignInFailed(RuntimeError):
    pass


def run_claude(prompt, cwd):
    """One Claude Code run that may only read files; returns its structured answer."""
    cmd = ["claude", "-p", prompt, "--model", MODEL, "--tools", "Read", "--allowedTools", "Read",
           "--permission-mode", "dontAsk", "--no-session-persistence", "--output-format", "json",
           "--json-schema", json.dumps(SCHEMA)]
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)
    try:
        out = json.loads(p.stdout)
    except ValueError:
        raise RuntimeError(f"Claude Code failed: {(p.stderr or p.stdout).strip()[:200]}")
    if out.get("is_error") or not isinstance(out.get("structured_output"), dict):
        msg = str(out.get("result") or out.get("subtype"))
        if "401" in msg or "authenticat" in msg.lower():
            raise SignInFailed(msg[:200])
        raise RuntimeError(f"Claude Code didn't answer: {str(out.get('result') or out.get('subtype'))[:200]}")
    return out["structured_output"]


def review(sid, c, http, s=None):
    with tempfile.TemporaryDirectory() as d:
        names = []
        for tag in SIZES:
            f = (c.get("files") or {}).get(tag)
            if not f:
                continue
            r = http.get(f["url"], timeout=60)
            r.raise_for_status()
            Path(d, f"card_{tag}.jpg").write_bytes(r.content)
            names.append(f"card_{tag}.jpg ({tag})")
        prompt = (GUIDE + "\n\nLook at each of these images with the Read tool: " + ", ".join(names) +
                  ".\n\nExpected details:\n" + expected(sid, c, s) +
                  "\n\nAnswer only with the structured result.")
        out = run_claude(prompt, d)
    out["ok"] = bool(out.get("ok")) and not out.get("issues")
    return out


def main():
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        print("Card check skipped: no CLAUDE_CODE_OAUTH_TOKEN secret.")
        return 0
    if not MANIFEST.exists():
        print("No cards yet.")
        return 0
    import requests
    man = json.loads(MANIFEST.read_text())
    queue = todo(man)
    at = now_utc()
    if len(queue) > SMALL:
        last = man.get("review_batch_at")
        if last and hours_between(last, at) < WINDOW_HOURS:
            print(f"Card check: {len(queue)} sailing(s) waiting; the next batch starts after "
                  f"{WINDOW_HOURS} hours from the last one ({last[11:16]} UTC), to spread the plan's usage.")
            return 0
        batch = queue[:BATCH]
        man["review_batch_at"] = at
        print(f"Card check: {len(queue)} sailing(s) waiting; checking a batch of {len(batch)} "
              f"(about {math.ceil(len(queue) / BATCH)} batch(es) left, one per {WINDOW_HOURS} hours).")
    else:
        batch = queue
        print(f"Card check: checking {len(batch)} sailing(s).")
    if not batch:
        return 0
    http = requests.Session()
    st = ROOT / "state" / "current.json"
    sailings = json.loads(st.read_text()).get("sailings", {}) if st.exists() else {}
    flagged, errors, signin = [], [], None
    for sid, c in batch:
        try:
            res = review(sid, c, http, sailings.get(sid))
        except SignInFailed as e:   # every other sailing would fail the same way: stop and say so
            signin = str(e)
            errors.append(f"{sid}: {signin}")
            break
        except Exception as e:  # noqa: one failure mustn't stop the rest; it's retried next check
            errors.append(f"{sid}: {str(e)[:200]}")
            continue
        c["review"] = {"fp": c.get("fp"), "at": now_utc(), "ok": res["ok"], "issues": res["issues"], "model": MODEL}
        if not res["ok"]:
            flagged.append((sid, c))
        MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1))  # after each, so a crash loses little

    if (signin or (batch and len(errors) == len(batch))) and man.get("review_batch_at") == at:
        man.pop("review_batch_at")  # nothing got checked, so don't hold the next batch back
    MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=1))
    if signin:
        (ROOT / "out").mkdir(exist_ok=True)
        (ROOT / "out" / "review_signin.md").write_text(
            "The card check couldn't sign in to Claude, so no cards were checked. Prices and cards are fine.\n\n"
            f"Claude said: `{signin}`\n\n"
            "To fix it: on your computer run `claude setup-token` again, copy the whole token (it starts `sk-ant-`), "
            "and paste it over the old one in GitHub → Settings → Secrets and variables → Actions → "
            "`CLAUDE_CODE_OAUTH_TOKEN`. The next check tries again by itself.\n")
        p = os.environ.get("GITHUB_OUTPUT")
        if p:
            with open(p, "a") as f:
                f.write("signin_failed=true\n")
        print(f"Card check stopped: Claude Code couldn't sign in ({signin}).")
        return 1
    left = len(queue) - len(batch) + len(errors)
    lines = []
    if flagged:
        lines += [f"Claude checked {len(batch) - len(errors)} sailing(s) with new or remade cards; "
                  f"{len(flagged)} need a look before they're used:", ""]
        for sid, c in flagged:
            lines.append(f"- **{sid}** {c.get('title')} ({'WAS/NOW cards' if c.get('kind') == 'wasnow' else c.get('reason')})")
            lines += [f"  - {i['size'].replace('x', ':') if i['size'] != 'all' else 'All sizes'}"
                      f"{' (fix)' if i['severity'] == 'fix' else ''}: {i['problem']}" for i in c["review"]["issues"]]
        lines += ["", "Open the sailing on the tracker page's Cards page to see them. Claude can be wrong: "
                  "you decide. Nothing has been changed or sent anywhere."]
    if errors:
        lines += ["", f"Couldn't check {len(errors)} (tried again next check):", *[f"- {e}" for e in errors]]
    if left:
        lines += ["", f"{left} sailing(s) still to check; later checks carry on."]
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
