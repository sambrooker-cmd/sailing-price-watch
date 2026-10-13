"""Make standard sailing cards (no was/now) for chosen sailings, from a fresh snapshot.

Run by the "Make cards" workflow (Actions → Make cards → Run workflow). The cards are
image files for Sam to check and upload himself: nothing here touches Meta or any ad account.

Usage:
  python make_cards.py SNAPSHOT.json OUTDIR CODES [--sizes 1x1,4x5,9x16]
    CODES: cruise codes separated by spaces or commas (A12630, a12630 both work),
           or "all" for every sailing in the snapshot that hasn't departed.

Writes OUTDIR/<code>_<size>.png, OUTDIR/cards.csv (what is on each card and when its
price was read, so an out-of-date card can be spotted) and OUTDIR/summary.md.
Exit code 1 if a code isn't in the feed or a card failed; the others are still made.
"""
import argparse, csv, datetime, json, re, sys
from pathlib import Path

import render_cards as rc

SIZE_TAGS = {tag: wh for wh, tag in rc.SIZES.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot")
    ap.add_argument("outdir")
    ap.add_argument("codes")
    ap.add_argument("--sizes", default=",".join(SIZE_TAGS))
    a = ap.parse_args()

    snap = json.loads(Path(a.snapshot).read_text())
    by = {s["id"]: s for s in snap["sailings"]}
    today = datetime.date.today().isoformat()
    sizes = []
    for t in re.split(r"[\s,]+", a.sizes.strip()):
        if t not in SIZE_TAGS:
            raise SystemExit(f"Unknown size {t!r}: use {', '.join(SIZE_TAGS)}")
        sizes.append(SIZE_TAGS[t])

    asked = [c.upper() for c in re.split(r"[\s,]+", a.codes.strip()) if c]
    if asked == ["ALL"]:
        asked = sorted(by, key=lambda i: (by[i].get("departure_date") or "9", i))
    problems, ids = [], []
    for c in dict.fromkeys(asked):
        s = by.get(c)
        if not s:
            problems.append(f"{c}: not in today's ad feed")
        elif "page_error" in s:
            problems.append(f"{c}: its booking page didn't load ({s['page_error']})")
        elif s.get("price_source") == "feed":
            problems.append(f"{c}: its booking page's prices couldn't be read")
        elif not s.get("departure_date"):
            problems.append(f"{c}: no departure date on its booking page")
        elif s["departure_date"] <= today:
            problems.append(f"{c}: already departed")
        else:
            ids.append(c)

    out = Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)
    made = []
    for c in ids:  # one at a time, so one bad photo doesn't stop the rest
        try:
            made += rc.render(a.snapshot, out, [c], sizes=tuple(sizes))
        except Exception as e:  # noqa
            problems.append(f"{c}: card failed ({str(e)[:150]})")
            ids = [i for i in ids if i != c]

    read_at = snap.get("date") or today
    if snap.get("fetched_at"):
        read_at = datetime.datetime.fromisoformat(snap["fetched_at"]).strftime("%-d %b %Y %H:%M UTC")
    with open(out / "cards.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Cruise code", "Sailing", "Departs", "Nights", "From price pp", "Promotions on card", "Nectar on card",
                    "Price read", "Files", "Booking link"])
        for c in ids:
            s = by[c]
            w.writerow([c, s.get("base_title") or s["title"], s["departure_date"], s.get("nights"),
                        s["price_pp"], " | ".join(rc.promo_lines(s)), rc.nectar_line(s), read_at,
                        " ".join(f"{c}_{rc.SIZES[wh]}.png" for wh in sizes), s.get("link", "")])

    lines = [f"## Cards made: {len(ids)} sailing{'s' if len(ids) != 1 else ''}, {len(made)} images", "",
             f"Prices and promotions as read {read_at}. A card is only right while its price is: check the "
             "tracker page before using an older one.", ""]
    if ids:
        lines += ["| Code | Sailing | From pp | Promotions on card |", "|---|---|---|---|"]
        for c in ids:
            s = by[c]
            lines.append(f"| {c} | {s.get('base_title') or s['title']} | £{s['price_pp']:,.0f} | "
                         f"{' / '.join(rc.promo_lines(s)) or '–'} |")
    if problems:
        lines += ["", "### Not made", ""] + [f"- {p}" for p in problems]
    (out / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
