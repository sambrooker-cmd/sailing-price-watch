"""Make slideshow videos of an Ad creator ad, for Meta (Sam, 13 Oct 2026).

Run by the "Make video" workflow (Actions → Make video → Run workflow): paste the ad's link from the
Ad creator ("Make video" or "Copy link"). Usage:
  python make_video.py AD_LINK OUTDIR [--lengths 6,10] [--sizes 1x1,4x5,9x16]

How: opens the tracker page's Ad creator in a headless browser with the repo's latest saved data
(the same documents publish.py sends to Firestore, so prices are the latest committed check), opens
the ad from the link exactly as a colleague would, and takes each card as two layers (adcreator.js
window.__spwVideo): the background (photo, campaign artwork or brand pattern) and the foreground
(logo, badge, strips, words). Each card then gets a slow zoom on the background while the foreground
fades and slides in, with a short crossfade between cards. Frames go to ffmpeg as H.264 MP4, 30 fps,
no sound (add music from Meta's sound library in Ads Manager).

Lengths are the whole video (6 s and 10 s by default), shared equally between the cards.
Writes OUTDIR/<name>_<size>_<length>s.mp4 and OUTDIR/summary.md. Nothing is sent to Meta.
"""
import argparse, base64, io, json, mimetypes, re, subprocess, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import publish  # noqa: E402

FPS = 30
SIZES = {"1x1": (1080, 1080), "4x5": (1080, 1350), "9x16": (1080, 1920)}
ZOOM = 0.06          # background grows by 6% over a card
ENTER = 0.3          # seconds for the foreground to fade and slide in
SLIDE_PX = 40        # how far it slides, at 1080 wide
XFADE = 0.3          # crossfade between cards (shorter when cards are very short)
BRAND = 0.5          # opening / closing card time, as a share of a sailing card's

FIREBASE = {  # stand-ins for the Firebase modules: the page reads the documents from window.__docs
    "firebase-app.js": "export const initializeApp = () => ({});",
    "firebase-firestore.js": "export const getFirestore=()=>({});export const doc=(d,c,i)=>c+'/'+i;"
                             "export const getDoc=async p=>{const d=window.__docs[p];return{exists:()=>!!d,data:()=>d};};",
    "firebase-auth.js": "export const getAuth=()=>({});export class GoogleAuthProvider{};"
                        "export const onAuthStateChanged=(a,f)=>{setTimeout(()=>f({email:'video@price-watch'}),0);return()=>{}};"
                        "export const signInWithPopup=async()=>{};export const signOut=async()=>{};",
}


def ad_code(link):
    m = re.search(r"(?:#|^)ad=([A-Za-z0-9_-]+)", link.strip()) or re.fullmatch(r"([A-Za-z0-9_-]{20,})", link.strip())
    if not m:
        raise SystemExit("That doesn't look like an Ad creator link: copy it with \"Make video\" or \"Copy link\".")
    return m.group(1)


def capture(code, sizes):
    """{size: [{kind, bg: Image, fg: Image}]}, plus the ad's info."""
    from playwright.sync_api import sync_playwright
    docs = {"pricewatch/" + k: {"json": v["json"]} for k, v in publish.documents().items()}
    docs["allowlist/video@price-watch"] = {"role": "viewer"}

    def site(route):
        path = route.request.url.split("ad.local/", 1)[1].split("?")[0].split("#")[0] or "index.html"
        f = ROOT / "site" / path
        if not f.is_file():
            return route.fulfill(status=404, body="")
        route.fulfill(status=200, content_type=mimetypes.guess_type(str(f))[0] or "application/octet-stream", body=f.read_bytes())

    out, info = {}, None
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.add_init_script("try{localStorage.setItem('spw-view','ads')}catch(e){};window.__docs = " + json.dumps(docs) + ";")
        pg.route("**/firebasejs/**", lambda r: r.fulfill(status=200, content_type="text/javascript", body=FIREBASE[r.request.url.rsplit('/', 1)[1]]))
        pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        pg.route("http://ad.local/**", site)
        pg.goto(f"http://ad.local/#ad={code}")
        pg.wait_for_function("window.__spwVideo && document.querySelectorAll('.ac-list .ac-pick').length > 0", timeout=60000)
        info = pg.evaluate("window.__spwVideo.info()")
        note = pg.locator(".ac-note").all_inner_texts()
        for size in sizes:
            layers = pg.evaluate("s => window.__spwVideo.layers(s)", size)
            out[size] = [{"kind": x["kind"], "bg": png(x["bg"]), "fg": png(x["fg"])} for x in layers]
        b.close()
    if errors:
        print("Page errors:", errors[:3])
    return out, info, note


def png(data_url):
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))).convert("RGBA")


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def frame(card, u, d, w, h, i, xf):
    """Card i at u seconds into its d-second slot (plus xf seconds of crossfade after it), as an RGB image."""
    bg = card["bg"]
    p = min(1.0, u / (d + xf))
    z = 1 + ZOOM * (p if i % 2 == 0 else 1 - p)   # alternate zoom in / out
    cw, ch = bg.width / z, bg.height / z
    x0, y0 = (bg.width - cw) / 2, (bg.height - ch) / 2
    img = bg.resize((w, h), Image.BILINEAR, box=(x0, y0, x0 + cw, y0 + ch)).convert("RGB")
    a = ease((u - (xf / 2 if i else 0.1)) / ENTER)   # words come in half way through the crossfade
    if a > 0:
        fg = card["fg_small"]
        if a < 1:
            alpha = fg.getchannel("A").point(lambda v: int(v * a))
            fg = fg.copy(); fg.putalpha(alpha)
        img.paste(fg, (int(-SLIDE_PX * (1 - a) * w / 1080), 0), fg)
    return img


def slots(kinds, length):
    """Seconds on screen per card: opening and closing cards get half a sailing card's time."""
    weight = [BRAND if k in ("intro", "end") else 1.0 for k in kinds]
    return [length * x / sum(weight) for x in weight]


def render(cards, size, length, path):
    w, h = SIZES[size]
    for c in cards:
        c["fg_small"] = c["fg"].resize((w, h), Image.LANCZOS)
    n = len(cards); ds = slots([c["kind"] for c in cards], length); total = int(round(length * FPS))
    starts = [sum(ds[:i]) for i in range(n)]
    xf = min(XFADE, min(ds) / 3)
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)], stdin=subprocess.PIPE)
    for k in range(total):
        t = k / FPS
        i = max(j for j in range(n) if starts[j] <= t + 1e-9); u = t - starts[i]
        img = frame(cards[i], u, ds[i], w, h, i, xf)
        if i > 0 and u < xf:   # crossfade from the previous card, which keeps moving
            img = Image.blend(frame(cards[i - 1], ds[i - 1] + u, ds[i - 1], w, h, i - 1, xf), img, u / xf)
        ff.stdin.write(img.tobytes())
    ff.stdin.close()
    if ff.wait():
        raise RuntimeError(f"ffmpeg failed for {path.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("link"); ap.add_argument("outdir")
    ap.add_argument("--lengths", default="6,10"); ap.add_argument("--sizes", default="1x1,4x5,9x16")
    a = ap.parse_args()
    lengths = [float(x) for x in re.split(r"[\s,]+", a.lengths.strip()) if x]
    sizes = [x for x in re.split(r"[\s,]+", a.sizes.strip()) if x]
    for s in sizes:
        if s not in SIZES:
            raise SystemExit(f"Unknown size {s!r}: use {', '.join(SIZES)}")
    out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)
    layers, info, note = capture(ad_code(a.link), sizes)
    n = len(info["slides"])
    kinds = [x["kind"] for x in info["slides"]]
    per = {L: max(slots(kinds, L)) for L in lengths}   # a sailing card's time (or the only kind there is)
    made = []
    for size in sizes:
        for length in lengths:
            name = f"ad_{size}_{length:g}s.mp4"
            render(layers[size], size, length, out / name)
            made.append(name); print("made", name)
    lines = [f"## Slideshow videos: {n} card{'s' if n != 1 else ''}", "",
             f"Prices on the cards as checked {info['prices']} (the latest saved check). Nothing has been sent to Meta.", ""]
    note = [x for x in re.split(r"(?<=\.)\s+", " ".join(note)) if x and not x.startswith(("Opened a shared ad", "It's now your own copy"))]
    if note:   # e.g. sailings no longer on sale, was/now cards switched to standard
        lines += ["When the ad was opened: " + " ".join(note), ""]
    if info.get("until"):
        lines += [f"**This ad has was/now cards: stop running it by {info['until']}.**", ""]
    lines += ["| File | Size | Length | Per sailing card |", "|---|---|---|---|"]
    for f in made:
        size, length = f[3:].rsplit("_", 1)[0], float(f.rsplit("_", 1)[1][:-5])
        lines.append(f"| {f} | {size.replace('x', ':')} | {length:g} s | {per[length]:.1f} s |")
    if any(v < 1.5 for v in per.values()):
        lines += ["", f"Some cards are on screen for under 1.5 seconds. Fewer cards (or the 10 s version) give people time to read the price."]
    lines += ["", "Cards in order: " + ", ".join(x["title"] for x in info["slides"]), "",
              "In Ads Manager: upload the 9:16 video for Stories and Reels and the 4:5 (or 1:1) for feeds, then add music "
              "from Meta's sound library if you want it. Primary text and button: as in the Ad creator."]
    (out / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
