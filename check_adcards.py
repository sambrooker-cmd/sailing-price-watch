"""Check that the Ad creator's browser cards (site/adcards.js) still match render_cards.py.

Usage: python check_adcards.py data/snapshot_DATE.json [OUTDIR]
Renders a no-fly photo card, a campaign card and two was/now cards (test was prices: visual
check only, nothing saved anywhere but OUTDIR) both ways in all sizes and prints how many
pixels differ. Around 1% is JPEG and anti-aliasing noise; much more means the two have drifted.
"""
import json, sys, threading, http.server, functools, socketserver
from pathlib import Path
import render_cards as rc
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops, ImageStat
SNAP, OUT = sys.argv[1], Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/tmp/adcards_check")
OUT.mkdir(parents=True, exist_ok=True)
snap = json.load(open(SNAP)); by = {s["id"]: s for s in snap["sailings"]}
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True; srv = socketserver.TCPServer(("127.0.0.1", 8766), functools.partial(Q, directory=str(Path(__file__).resolve().parent / "site"))); threading.Thread(target=srv.serve_forever, daemon=True).start()
live = [s for s in snap["sailings"] if "page_error" not in s and s.get("image_link") and s.get("price_pp")]
photo = next(s for s in live if not rc.is_campaign(s)); camp = next((s for s in live if rc.is_campaign(s)), photo)
CASES = [(photo["id"], None), (camp["id"], None), (camp["id"], camp["price_pp"] + 100), (photo["id"], photo["price_pp"] + 300)]
def dfor(s, was):
    fly = s.get("flight_from")
    d = {"id": s["id"], "title": s["base_title"] if fly else s["title"], "ship": s["ship"], "port": s["port"], "fly": fly,
         "nights": s["nights"], "departure_date": s["departure_date"], "price": s["price_pp"], "promos": rc.promo_lines(s),
         "nectar": rc.nectar_line(s), "photo": rc.OVERRIDES.get(s["id"], s["image_link"]), "campaign": rc.is_campaign(s), "wasnow": None}
    if was: d["wasnow"] = {"was": was, "now": s["price_pp"], "grade": rc.lead_grade(s)}
    return d
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    for sid, was in CASES:
        s = by[sid]
        for (w, h), tag in rc.SIZES.items():
            pg = b.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.set_content((rc.price_reduction_html if was else rc.card_html)(s, was, w, h), wait_until="load"); pg.evaluate("document.fonts.ready"); pg.evaluate("fit()")
            pg.locator("#card").screenshot(path=f"{OUT}/par_py.png"); pg.close()
            pg = b.new_page(viewport={"width": 1200, "height": 2000}); pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.route("http://127.0.0.1:8766/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<html><body style='margin:0'></body></html>"))
            pg.goto("http://127.0.0.1:8766/__blank")
            jpg = pg.evaluate("""async ([d, tag]) => {
              const m = await import('/adcards.js'); const logo = await (await fetch('/logo-white.svg')).text();
              const f = document.createElement('iframe'); const [w, h] = m.SIZES[tag];
              f.style.cssText = `width:${w}px;height:${h}px;border:0;display:block`; document.body.innerHTML = ''; document.body.style.margin = 0; document.body.appendChild(f);
              await new Promise(r => { f.onload = r; f.srcdoc = m.cardDoc(d, tag, logo); });
              await f.contentWindow.ready(); return await f.contentWindow.toJpeg(); }""", [dfor(s, was), tag])
            import base64; open(f"{OUT}/par_js.jpg", "wb").write(base64.b64decode(jpg.split(",")[1])); pg.close()
            a = Image.open(f"{OUT}/par_py.png").convert("RGB"); c = Image.open(f"{OUT}/par_js.jpg").convert("RGB")
            diff = ImageChops.difference(a, c); st = ImageStat.Stat(diff.convert("L"))
            bad = sum(1 for v in diff.convert("L").getdata() if v > 40) / (w * h)
            print(sid, "wasnow" if was else "std", tag, "mean diff %.2f" % st.mean[0], "pixels off %.2f%%" % (100 * bad))
            if bad > 0.03: c.save(f"{OUT}/par_{sid}_{tag}_{'w' if was else 's'}_js.jpg"); a.save(f"{OUT}/par_{sid}_{tag}_{'w' if was else 's'}_py.png")
    print("errors:", errs[:5]); b.close()
srv.shutdown()
