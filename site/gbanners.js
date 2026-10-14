// Google Ads images (Sam, 14 Oct 2026: "the whole Google Ads section"), built in the browser like the Ad creator's cards.
//   gImageDoc(d, ratio, style, LOGO) → Performance Max / Demand Gen image: "photo" = the sailing's photo only (Google
//     advises no text, logos or buttons on these), "card" = the Meta card design (adcards.js) drawn at its own size and
//     scaled to Google's pixels. Ratios: landscape 1200×628, square 1200×1200, portrait 960×1200.
//   bannerDoc(d, size, LOGO, cta) → a fixed-size display banner (300×250 … 970×250) in the brand's colours.
//   logoDoc(kind, LOGO) → square (white A on Allium, as the Facebook page picture) or landscape 4:1 logos.
// Every page has window.ready() and window.shot(type, quality) → data URL at Google's exact pixel size.
// d is the Ad creator's card data (cardData): prices, and a was/now only from a claim live today (never typed in).
import {cardAt, cropUrl, wholeUrl} from "./adcards.js?v=__BUILD__";

const ORIGIN = location.origin;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
// France (d.fr, Sam 14 Oct 2026): euros, French dates and words, as adcards.js
import {frMoney, frDate} from "./adcards.js?v=__BUILD__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const FONT_CSS = [400, 500, 600, 700].map(w =>
  `@font-face{font-family:'Quicksand';font-weight:${w};src:url(${ORIGIN}/fonts/quicksand-latin-${w}-normal.woff2) format('woff2')}`).join("\n");

export const RATIOS = {
  landscape: {w: 1200, h: 628, label: "Landscape 1.91:1", design: [1910, 1000]},
  square: {w: 1200, h: 1200, label: "Square 1:1", design: [1080, 1080]},
  portrait: {w: 960, h: 1200, label: "Portrait 4:5", design: [1080, 1350]},
};
export const BANNERS = {
  "300x250": "Medium rectangle", "336x280": "Large rectangle", "300x600": "Half page", "160x600": "Wide skyscraper",
  "728x90": "Leaderboard", "970x250": "Billboard", "320x100": "Large mobile banner", "320x50": "Mobile banner",
};
export const LOGOS = {square: {w: 1200, h: 1200, label: "Square logo 1:1"}, landscape: {w: 1200, h: 300, label: "Landscape logo 4:1"}};
export const BANNER_MAX_KB = 150;   // Google's limit for uploaded image ads

// Runtime added to every page: wait for fonts and pictures, lay out, then save at the output size.
const runtime = (outW, designW) => `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js"><\/script>
<script>
window.ready = async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  if (window.prep) await window.prep();
  if (window.fit) fit();
};
window.shot = (type, q) => htmlToImage[type === "png" ? "toPng" : "toJpeg"](document.getElementById('card'),
  {quality: q || .9, pixelRatio: ${outW} / ${designW}, cacheBust: false, backgroundColor: '#6B207D'});
<\/script>`;

// ---------- Performance Max / Demand Gen ----------
export function gImageDoc(d, ratio, style, LOGO){
  const r = RATIOS[ratio];
  if (style === "card") {
    const [dw, dh] = r.design;
    // The card page brings its own runtime; add shot() at Google's size alongside it.
    return cardAt(d, dw, dh, LOGO).replace("</body>", `<script>window.shot = (type, q) => htmlToImage[type === "png" ? "toPng" : "toJpeg"](document.getElementById('card'), {quality: q || .9, pixelRatio: ${r.w} / ${dw}, cacheBust: false});<\/script></body>`);
  }
  // Clean photo: the sailing's own picture cropped to the ratio, nothing on top. Campaign artwork (with its own text)
  // is shown whole on its edge colours, as the cards do, so its words aren't cut off.
  const art = d.campaign
    ? `<div id="bg" style="position:absolute;inset:0"></div><img id="art" crossorigin="anonymous" src="${esc(wholeUrl(d.photo, r.w))}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain">`
    : `<img crossorigin="anonymous" src="${esc(cropUrl(d.photo, r.w, r.h))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body,#card{width:${r.w}px;height:${r.h}px;overflow:hidden;background:#380843}#card{position:relative}</style></head>
<body><div id="card">${art}</div>
<script>window.prep = () => { const a = document.getElementById('art'); if (!a) return;
  const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = a.naturalWidth; c.height = a.naturalHeight; x.drawImage(a, 0, 0);
  const px = (y) => { const p = x.getImageData(0, y, 1, 1).data; return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')'; };
  document.getElementById('bg').style.background = 'linear-gradient(' + px(1) + ' 50%,' + px(c.height - 2) + ' 50%)'; };<\/script>
${runtime(r.w, r.w)}</body></html>`;
}

// ---------- logos ----------
export function logoDoc(kind, LOGO){
  const l = LOGOS[kind];
  // The Ambassador A on its own (the logo's first shape), as on Ambassador's Facebook page picture
  const A = LOGO.replace(/viewBox="[^"]*"/, 'viewBox="234 234 66 99"').replace(/(<path[^>]*\/>)[\s\S]*<\/svg>/, "$1</svg>");
  const body = kind === "square"
    ? `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%"><div style="height:62%">${A.replace("<svg", '<svg style="height:100%;width:auto;display:block"')}</div></div>`
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0 90px"><div style="width:100%">${LOGO.replace("<svg", '<svg style="width:100%;height:auto;display:block"')}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body,#card{width:${l.w}px;height:${l.h}px;overflow:hidden;background:#6B207D}</style></head>
<body><div id="card">${body}</div>${runtime(l.w, l.w)}</body></html>`;
}

// ---------- display banners ----------
// Three layouts by shape: box (rectangles), tower (skyscrapers), strip (leaderboards and mobile banners).
export function bannerDoc(d, size, LOGO, cta){
  const [w, h] = size.split("x").map(Number), ratio = w / h;
  const kind = ratio >= 2.5 ? (h >= 200 ? "bill" : "strip") : ratio < 0.7 ? "tower" : "box";
  const tiny = h <= 60, small = Math.min(w, h) < 200;
  const wn = d.wasnow;
  const price = wn
    ? `<div class="price wn"><span class="was">Was <s>${money(wn.was)}</s></span><span class="now"><small>Now</small> ${money(wn.now)}<small>pp</small></span></div>`
    : d.fr ? `<div class="price"><small>À partir de</small> <b>${frMoney(d.price)}</b><small>/pers.</small></div>`
    : `<div class="price"><small>From</small> <b>${money(d.price)}</b><small>pp</small></div>`;
  const when = [d.departure_date ? (d.fr ? frDate(d.departure_date) : niceDate(d.departure_date)) : "", `${d.nights} ${d.fr ? "nuits" : "nights"}`].filter(Boolean).join(" · ");
  const where = d.fr ? `Départ de ${String(d.port || "").split(",")[0].trim()}` : d.fly ? `Fly from ${d.fly}` : `No-fly from ${d.port}`;
  const button = cta && !tiny ? `<span class="cta">${esc(cta)}</span>` : "";
  const logo = `<div class="logo">${LOGO}</div>`;
  const pic = (pw, ph) => d.campaign
    ? `<div class="ph" style="background:#380843"><img crossorigin="anonymous" src="${esc(wholeUrl(d.photo, Math.round(pw * 2)))}" style="object-fit:contain"></div>`
    : `<div class="ph"><img crossorigin="anonymous" src="${esc(cropUrl(d.photo, Math.round(pw * 2), Math.round(ph * 2)))}"></div>`;
  const base = `${FONT_CSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:#6B207D}
#card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#6B207D;color:#fff;font-family:'Quicksand',Helvetica,Arial,sans-serif;display:flex}
.ph{position:relative;overflow:hidden;flex:none}.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.logo svg{display:block;height:100%;width:auto}
.name{font-weight:700;text-transform:uppercase;letter-spacing:.04em;line-height:1.12;overflow-wrap:anywhere}
.meta{font-weight:600;opacity:.92;line-height:1.25}
.price{background:#F68C4E;color:#6B207D;font-weight:700;white-space:nowrap;display:inline-flex;align-items:baseline;gap:.25em;line-height:1;clip-path:polygon(0 0,calc(100% - .5em) 0,100% 100%,0 100%);padding:.35em .9em .35em .5em}
.price b{font-size:1.6em}.price small{font-size:.8em}
.price.wn{flex-direction:column;align-items:flex-start;gap:.15em}
.price .was{font-size:.75em}.price .was s{text-decoration-thickness:2px}.price .now{font-size:1.25em}.price .now small{font-size:.6em}
.cta{display:inline-block;background:#fff;color:#6B207D;font-weight:700;white-space:nowrap;border-radius:4px;padding:.45em .9em;line-height:1}`;
  let css = "", body = "";
  if (kind === "box") {
    const ph = Math.round(h * 0.5);
    css = `#card{flex-direction:column}.ph{width:${w}px;height:${ph}px}
.scrim{position:absolute;left:0;right:0;top:0;height:46px;background:linear-gradient(rgba(56,8,67,.7),rgba(56,8,67,0))}
.logo{position:absolute;left:10px;top:9px;height:${Math.round(w * 0.055)}px}
.panel{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:8px 12px 10px;gap:4px;min-height:0}
.name{font-size:${Math.round(w * 0.055)}px}.meta{font-size:${Math.round(w * 0.04)}px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:${Math.round(w * 0.045)}px}`;
    body = `${pic(w, ph)}<div class="scrim"></div>${logo}<div class="panel"><div><p class="name fit2" data-max="${Math.round(w * 0.055)}">${esc(d.title)}</p><p class="meta">${esc(when)} · ${esc(where)}</p></div><div class="row">${price}${button}</div></div>`;
  } else if (kind === "tower") {
    const ph = Math.round(h * 0.42), f = w / 160;
    css = `#card{flex-direction:column}.ph{width:${w}px;height:${ph}px}
.logo{height:${Math.round(14 * f)}px;margin:${Math.round(14 * f)}px auto 0}
.panel{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;justify-content:space-between;padding:${Math.round(10 * f)}px ${Math.round(10 * f)}px ${Math.round(16 * f)}px;min-height:0}
.name{font-size:${Math.round(15 * f)}px}.meta{font-size:${Math.round(11 * f)}px;margin-top:${Math.round(6 * f)}px}
.price{font-size:${Math.round(13 * f)}px}.cta{font-size:${Math.round(12 * f)}px}`;
    body = `${pic(w, ph)}<div class="panel"><div><p class="name fit2" data-max="${Math.round(15 * f)}" data-lines="3">${esc(d.title)}</p><p class="meta">${esc(when)}<br>${esc(where)}</p></div>${price}${button}${logo}</div>`;
  } else if (kind === "bill") {
    // billboard (970×250): photo on the left, then logo, name, details, price and button stacked
    const pw = Math.round(w * 0.4);
    css = `.ph{width:${pw}px;height:${h}px}
.panel{flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:18px 28px;min-width:0}
.logo{height:22px;margin-bottom:4px}.name{font-size:30px}.meta{font-size:17px}
.row{display:flex;align-items:center;gap:18px;font-size:22px;margin-top:4px}`;
    body = `${pic(pw, h)}<div class="panel">${logo}<p class="name fit2" data-max="30" data-lines="2">${esc(d.title)}</p><p class="meta">${esc(when)} · ${esc(where)}</p><div class="row">${price}${button}</div></div>`;
  } else {
    // strip (728×90, 320×100, 320×50): [photo] [name / details] [price] [button] [logo]; the small ones leave out
    // the photo, button and logo, which wouldn't leave room for the words
    const wide = w >= 600, showLogo = w >= 700, fs = tiny ? 13 : wide ? 17 : 16;
    css = `#card{align-items:center;gap:${tiny ? 8 : 12}px;padding-right:${tiny ? 8 : 12}px}${wide ? `.ph{width:${Math.round(h * 1.3)}px;height:${h}px}` : "#card{padding-left:10px}"}
.text{flex:1;min-width:0}.name{font-size:${fs}px}.meta{font-size:${tiny ? 11 : 12}px;margin-top:3px}
.price{font-size:${tiny ? 11 : 13}px}.cta{font-size:13px}
.logo{height:${Math.round(Math.min(h * 0.2, 20))}px;flex:none}${tiny ? ".meta{display:none}" : ""}`;
    body = `${wide ? pic(Math.round(h * 1.3), h) : ""}<div class="text"><p class="name fit2" data-max="${fs}" data-lines="${tiny ? 1 : 2}">${esc(d.title)}</p><p class="meta">${esc(when)}${tiny ? "" : ` · ${esc(where)}`}</p></div>${price}${wide ? button : ""}${showLogo ? logo : ""}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${base}\n${css}</style></head>
<body><div id="card">${body}</div>
<script>
// Shrink the sailing name until it fits its lines, then everything until nothing spills out of the banner.
function fit(){
  document.querySelectorAll('.fit2').forEach(el => {
    let s = +el.dataset.max; const lines = +(el.dataset.lines || 2);
    const lh = () => parseFloat(getComputedStyle(el).lineHeight) || s * 1.12;
    el.style.fontSize = s + 'px';
    while ((el.scrollHeight > lh() * lines + 1 || el.scrollWidth > el.clientWidth + 1) && s > 8) { s -= .5; el.style.fontSize = s + 'px'; }
  });
  const card = document.getElementById('card'); let k = 1;
  const over = () => [...card.querySelectorAll('.panel,.text,.price,.cta,.row')].some(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
    || [...card.children].some(e => { const r = e.getBoundingClientRect(); return r.right > ${w} + .5 || r.bottom > ${h} + .5; });
  while (over() && k > .6) { k -= .04; card.style.fontSize = ''; card.querySelectorAll('.meta,.price,.cta').forEach(e => { e.style.fontSize = (parseFloat(getComputedStyle(e).fontSize) * .96) + 'px'; }); }
}
</script>${runtime(w, w)}</body></html>`;
}
