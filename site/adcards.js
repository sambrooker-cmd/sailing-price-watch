// Card designs for the Ad creator, built in the browser (Sam, 12 Oct 2026).
// A port of render_cards.py card_html (standard) and price_reduction_html (was/now), so cards
// made here match the ones the hourly check makes. If you change a design in render_cards.py,
// change it here too (check_adcards.py compares the two).
//
// cardDoc(d, w, h, logoSvg) returns a full HTML page for an <iframe srcdoc>. Inside it:
//   await window.ready()  waits for fonts and images, then lays the card out (fit());
//   await window.toJpeg() returns the finished card as a JPEG data URL (html-to-image).
// d: {id, title, kicker, headline, ship, port, fly, nights, departure_date, price, promos[], nectar,
//     photo, campaign, wasnow: {was, now, grade} | null}
// Prices (price, was, now) always come from the tracker's saved data, never typed in.

const ORIGIN = location.origin;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const niceDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS_LONG[m - 1]} ${y}`; };
// France (Sam, 14 Oct 2026; d.fr): French words, euros (1 029 €) and French dates, as render_cards.py fr_money / fr_date
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const frMoney = v => Math.round(v).toLocaleString("en-GB").replace(/,/g, "\u202f") + "\u00a0€";
export const frDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d === 1 ? "1er" : d} ${MOIS[m - 1]} ${y}`; };

const SHIP_ICON = '<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14h18l-2.5 5h-13z"/><path d="M6 14V9h12v5"/><path d="M10 9V5.5h4V9"/><path d="M2 21.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"/></svg>';
const PLANE_ICON = '<svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.3c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>';
const PR_SHIP = SHIP_ICON.replace('width="58" height="58"', 'width="36" height="36"').replace("#ffffff", "#6B207D").replace('stroke-width="1.6"', 'stroke-width="1.9"');
const PR_PLANE = PLANE_ICON.replace('width="58" height="58"', 'width="36" height="36"').replace("#ffffff", "#6B207D").replace('stroke-width="1.6"', 'stroke-width="1.9"');
export const PR_CABIN = {inside: "Inside cabin", ocean_view: "Ocean view cabin", balcony: "Balcony cabin", suite: "Suite"};

const FONT_CSS = [400, 500, 600, 700].map(w =>
  `@font-face{font-family:'Quicksand';font-weight:${w};src:url(${ORIGIN}/fonts/quicksand-latin-${w}-normal.woff2) format('woff2')}`).join("\n");

// Storyblok image service, as render_cards.py photo() / photo_whole(). Uploaded images (data URLs) and France's photos
// (copies in the tracker's Storage, cards_sync.py) as they are: the card's CSS crops them.
const isAsset = u => /^https:\/\/assets\.ambassadorcruiseline\.com\//.test(u || "");
export const cropUrl = (u, w, h) => isAsset(u) ? `${u}/m/${w}x${h}/smart/filters:quality(88):format(jpeg)` : u;
export const wholeUrl = (u, w) => isAsset(u) ? `${u}/m/${w}x0/filters:quality(88):format(jpeg)` : u;

// Kicker line + headline, as render_cards.py split_title.
export function splitTitle(t, maxHead = 20){
  t = t.trim();
  for (const sep of [": ", " - ", " – "]) if (t.includes(sep)){ const i = t.indexOf(sep); return [t.slice(0, i).trim(), t.slice(i + sep.length).trim()]; }
  let best = null;
  for (const kw of [" of the ", " to the ", " of ", " to ", " in "]){
    const i = t.lastIndexOf(kw);
    if (i > 0){ const head = t.slice(i + kw.length); if (head.length >= 4 && (!best || head.length < best[1].length)) best = [t.slice(0, i + kw.length).trim(), head.trim()]; }
  }
  if (best) return best;
  if (t.length <= maxHead) return ["", t];
  const i = t.lastIndexOf(" & ");
  if (i > 0 && t.length - i - 3 <= maxHead + 6) return [t.slice(0, i + 2).trim(), t.slice(i + 3).trim()];
  const words = t.split(/\s+/), head = [];
  while (words.length && [words[words.length - 1], ...head].join(" ").length <= maxHead) head.unshift(words.pop());
  if (!head.length) head.push(words.pop());
  return [words.join(" "), head.join(" ")];
}

// Default words for a standard card, as card_html works them out.
export function defaultWords(title){
  let [kicker, headline] = splitTitle(title), sub = "";
  if (kicker && headline.length > 24 && kicker.length <= 24) [headline, sub, kicker] = [kicker, headline, ""];
  return {kicker, headline, sub};
}

const RUNTIME = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js"><\/script>
<script>
window.ready = async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
  if (window.prep) await window.prep();
  fit();
};
window.toJpeg = () => htmlToImage.toJpeg(document.getElementById('card'), {quality: .92, pixelRatio: 1, cacheBust: false});
<\/script>`;

// Campaign artwork background: the most common colour along the artwork's top and bottom edges
// (render_cards.py edge_colours), split straight at the artwork's bottom; Allium logo on a light top.
const EDGES = `
let topC = null, botC = null;
window.prep = () => {
  const art = document.getElementById('art'); if (!art) return;
  const c = document.createElement('canvas'), W = c.width = art.naturalWidth, H = c.height = art.naturalHeight, x = c.getContext('2d');
  x.drawImage(art, 0, 0);
  const mode = (y0, y1) => {
    const n = {}, d = x.getImageData(0, y0, W, y1 - y0).data;
    for (let i = 0; i < d.length; i += 8) { const k = (d[i] / 24 | 0) + ',' + (d[i + 1] / 24 | 0) + ',' + (d[i + 2] / 24 | 0); (n[k] = n[k] || [0, 0, 0, 0]); n[k][0]++; n[k][1] += d[i]; n[k][2] += d[i + 1]; n[k][3] += d[i + 2]; }
    const b = Object.values(n).sort((a, b) => b[0] - a[0])[0];
    return [b[1] / b[0] | 0, b[2] / b[0] | 0, b[3] / b[0] | 0];
  };
  topC = mode(0, Math.min(6, H)); botC = mode(Math.max(0, H - 6), H);
  if (0.299 * topC[0] + 0.587 * topC[1] + 0.114 * topC[2] > 160) {
    document.querySelector('.logo').style.filter = 'none';
    document.querySelectorAll('.logo svg path').forEach(p => p.style.fill = '#6B207D');
  }
};
function paintEdges(split){
  const bg = document.getElementById('artbg'); if (!bg || !topC) return;
  const rgb = c => 'rgb(' + c.join(',') + ')';
  bg.style.background = 'linear-gradient(to bottom, ' + rgb(topC) + ' 0, ' + rgb(topC) + ' ' + split + 'px, ' + rgb(botC) + ' ' + split + 'px, ' + rgb(botC) + ' 100%)';
}`;

function standard(d, w, h, LOGO){
  const story = h / w >= 1.7, top = story ? Math.round(h * 0.14) : 0, bottom = story ? Math.round(h * 0.20) + 24 : 64;
  const fly = d.fly, words = {...defaultWords(d.title), ...(d.words || {})};
  const [badgeIcon, b1, b2] = d.fr ? [SHIP_ICON, `À bord du ${d.ship}`, `Départ de ${String(d.port || "").split(",")[0].trim()}`]
    : fly ? [PLANE_ICON, `Fly-cruise on ${d.ship}`, `Flights from ${fly}`] : [SHIP_ICON, `No-fly on ${d.ship}`, `from ${d.port}`];
  const date = d.departure_date ? (d.fr ? frDate(d.departure_date) : niceDate(d.departure_date)) : "";
  const fare = d.fr ? `<div class="fare-row"><span class="from">À partir de</span><span class="big">${frMoney(d.price)}</span><span class="pp">/pers.</span></div>`
    : `<div class="fare-row"><span class="from">From</span><span class="big">${money(d.price)}</span><span class="pp">pp</span></div>`;
  // Campaign artwork whole, on plain colours from its own top and bottom edges (render_cards.py matched_css, 13 Oct 2026).
  const art = d.campaign
    ? `<div class="artbg" id="artbg"></div><img class="art" id="art" crossorigin="anonymous" src="${esc(wholeUrl(d.photo, w))}" alt="">`
    : `<img class="photo" crossorigin="anonymous" src="${esc(cropUrl(d.photo, w, h))}" alt="">`;
  const offers = (d.promos || []).map(t => `<div class="strip offer"><span class="fit" data-max="27">${esc(t)}</span></div>`).join("");
  const nectar = d.nectar ? `<div class="strip nectar"><span class="fit" data-max="27">${esc(d.nectar)}</span></div>` : "";
  // Trustpilot widget (Sam, 13 Oct 2026): Trustpilot's own artwork, in a Pearl strip under the Nectar line.
  const trust = d.trustpilot ? `<div class="strip nectar tp" id="tp"><img src="${esc(d.trustpilot)}" alt="Trustpilot rating"></div>` : "";
  const kicker = words.kicker ? `<div class="strip kicker"><span class="fit" data-max="42">${esc(words.kicker)}</span></div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${FONT_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;background:#380843;overflow:hidden}
#card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#380843;font-family:'Quicksand',Helvetica,Arial,sans-serif;color:#fff}
.photo{position:absolute;left:0;top:0;width:${w}px;height:${h}px;object-fit:cover;display:block}
.scrim{position:absolute;left:0;right:0;top:0;height:${298 + top}px;background:linear-gradient(to bottom,rgba(56,8,67,.75) 0%,rgba(56,8,67,.75) 43%,rgba(56,8,67,0) 100%)}
.logo{position:absolute;left:64px;top:${34 + top}px;height:60px}
.logo svg{height:60px;width:auto;display:block}
.badge{position:absolute;right:0;top:${top}px;display:flex;align-items:center;gap:20px;height:128px;padding:0 64px 0 84px;background:#009165;color:#fff;clip-path:polygon(0 0,100% 0,100% 100%,47px 100%)}
.badge .lines{display:flex;flex-direction:column;gap:4px;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.stack{position:absolute;left:0;bottom:${bottom}px;display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.strip{display:flex;align-items:center;white-space:nowrap}
.kicker{height:80px;padding:0 71px 0 64px;background:#6B207D;clip-path:polygon(0 0,calc(100% - 29px) 0,100% 100%,0 100%);font-size:42px;line-height:1;font-weight:500;letter-spacing:.1em;text-transform:uppercase}
.headline{height:116px;padding:0 84px 0 64px;background:#6B207D;clip-path:polygon(0 0,calc(100% - 42px) 0,100% 100%,0 100%)}
.headline h1{font-size:70px;line-height:1;font-weight:500;letter-spacing:.08em;text-transform:uppercase}
.fare{margin-top:14px;display:flex;align-items:center;gap:28px;min-height:150px;padding:0 90px 0 64px;background:#F68C4E;color:#6B207D;clip-path:polygon(0 0,calc(100% - 55px) 0,100% 100%,0 100%)}
.when{display:flex;flex-direction:column;gap:6px;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.rule{width:3px;height:84px;background:#6B207D}
.fare-row{display:flex;align-items:baseline;gap:10px;white-space:nowrap}
.fare-row .from{font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.fare-row .big{font-size:96px;font-weight:700;line-height:1;letter-spacing:-.01em}
.fare-row .pp{font-size:34px;font-weight:700}
.nectar.tp{height:96px}
.tp img{height:64px;width:auto;display:block}
.nectar{height:76px;padding:0 60px 0 64px;background:#F1ECE7;color:#6B207D;clip-path:polygon(0 0,calc(100% - 28px) 0,100% 100%,0 100%);font-size:27px;font-weight:700}
.artbg{position:absolute;inset:-80px;background-size:cover;background-position:center;filter:blur(36px) brightness(.72) saturate(1.1)}
.art{position:absolute;z-index:1;left:0;width:${w}px;height:auto;object-fit:contain;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.offer{height:76px;padding:0 60px 0 64px;background:#009165;color:#fff;clip-path:polygon(0 0,calc(100% - 28px) 0,100% 100%,0 100%);font-size:27px;font-weight:700}
${d.campaign ? ".artbg{inset:0;filter:none}.art{box-shadow:none}.scrim{display:none}" : ""}
</style></head><body><div id="card">
${art}
<div class="scrim"></div>
<div class="logo">${LOGO}</div>
<div class="badge" id="badge">${badgeIcon}<div class="lines"><span>${esc(b1)}</span><span>${esc(b2)}</span></div></div>
<div class="stack">
  ${kicker}
  <div class="strip headline"><h1 class="fit" data-max="70">${esc(words.headline)}</h1></div>
  ${words.sub ? `<div class="strip kicker"><span class="fit" data-max="40">${esc(words.sub)}</span></div>` : ""}
  <div class="strip fare"><div class="when"><span>${esc(d.nights + (d.fr ? " nuits" : " nights"))}</span><span>${esc(date)}</span></div><div class="rule"></div>${fare}</div>
  ${nectar}
  ${trust}
  ${offers}
</div>
</div>
<script>
${EDGES}
function fit(){
  const W = ${w};
  document.querySelectorAll('.fit').forEach(el => {
    let size = +el.dataset.max; el.style.fontSize = size + 'px';
    const strip = el.closest('.strip');
    while (strip.getBoundingClientRect().right > W - 24 && size > 24) { size -= 1; el.style.fontSize = size + 'px'; }
  });
  const tp = document.querySelector('#tp img');
  if (tp) { let th = 64; while (tp.closest('.strip').getBoundingClientRect().right > W - 24 && th > 30) { th -= 1; tp.style.height = th + 'px'; } }
  const h1 = document.querySelector('.headline h1'), hs = parseFloat(h1.style.fontSize);
  document.querySelectorAll('.kicker .fit').forEach(k => { if (parseFloat(k.style.fontSize) > hs * 0.62) k.style.fontSize = Math.round(hs * 0.62) + 'px'; });
  const badge = document.getElementById('badge'), lines = badge.querySelector('.lines');
  const logoRight = document.querySelector('.logo').getBoundingClientRect().right;
  let bs = 30;
  while (badge.getBoundingClientRect().left < logoRight + 32 && bs > 18) { bs -= 1; lines.style.fontSize = bs + 'px'; }
  const art = document.getElementById('art');
  if (art) {
    const top = badge.getBoundingClientRect().bottom + 20, bot = document.querySelector('.stack').getBoundingClientRect().top - 20;
    const ratio = art.naturalHeight / art.naturalWidth, room = bot - top;
    let aw = W, ah = W * ratio;
    if (ah > room) { ah = room; aw = ah / ratio; }
    const y = top + (room - ah) / 2;
    art.style.width = aw + 'px'; art.style.height = ah + 'px';
    art.style.left = (W - aw) / 2 + 'px'; art.style.top = y + 'px';
    paintEdges(y + ah);
  }
}
</script>${RUNTIME}
</body></html>`;
}

function wasNow(d, w, h, LOGO){
  const story = h / w >= 1.7, top = story ? Math.round(h * 0.14) : 0, bottom = story ? Math.round(h * 0.20) + 30 : 40, tall = h > w;
  const fly = d.fly, {was, now, grade} = d.wasnow;
  const gradeHtml = grade ? `<div class="st2">${PR_CABIN[grade]}</div>` : "";
  const [icon, line] = fly ? [PR_PLANE, `Flights from ${fly} on ${d.ship}`] : [PR_SHIP, `No-fly from ${d.port} on ${d.ship}`];
  const when = [d.departure_date ? esc(longDate(d.departure_date)) : "", `${d.nights} nights`].filter(Boolean).join(" &nbsp;|&nbsp; ");
  const title = (d.words && d.words.title) || d.title;
  const photo = d.campaign
    ? `<div class="artbg" id="artbg"></div><img class="art" id="art" crossorigin="anonymous" src="${esc(wholeUrl(d.photo, w))}" alt="">`
    : `<img class="photo" crossorigin="anonymous" src="${esc(cropUrl(d.photo, w, h))}" alt="">`;
  const campaignCss = d.campaign ? `.artbg{position:absolute;inset:0;filter:none}.art{box-shadow:none}.scrim{display:none}
.sticker{right:30px;top:${top + 30}px;transform:rotate(7deg) scale(.68);transform-origin:top right}` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${FONT_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;background:#380843;overflow:hidden}
#card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#380843;font-family:'Quicksand',Helvetica,Arial,sans-serif}
.photo{position:absolute;left:0;top:0;width:${w}px;height:${h}px;object-fit:cover;display:block}
.scrim{position:absolute;left:0;right:0;top:0;height:${top + 380}px;background:linear-gradient(to bottom,rgba(56,8,67,${top ? .55 : .42}) 0%,rgba(56,8,67,.18) 55%,rgba(56,8,67,0) 100%)}
.logo{position:absolute;left:72px;top:${top + (tall ? 70 : 55)}px;height:62px;filter:drop-shadow(0 1px 6px rgba(0,0,0,.25))}
.logo svg{height:62px;width:auto;display:block}
.sticker{position:absolute;right:46px;top:${top + (tall ? 140 : 125)}px;width:420px;padding:30px 30px 34px;background:#F68C4E;color:#fff;border-radius:16px;transform:rotate(7deg);box-shadow:0 10px 28px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.18);text-align:center}
.sticker::after{content:"";position:absolute;inset:12px;border:3px solid rgba(255,255,255,.95);border-radius:9px}
.st1{font-weight:700;font-size:24px;letter-spacing:.14em;text-transform:uppercase}
.st2{font-weight:600;font-size:25px;margin-top:8px}
.was{font-weight:700;font-size:28px;margin-top:6px}
.was s{text-decoration-thickness:3px}
.now{display:flex;justify-content:center;align-items:baseline;gap:12px;margin-top:2px;line-height:1;white-space:nowrap}
.now .l{font-weight:600;font-size:32px}
.now .p{font-weight:700;font-size:74px;letter-spacing:-.005em}
.now .pp{font-weight:700;font-size:26px}
.panel{position:absolute;left:43px;right:40px;bottom:${bottom}px;background:rgba(244,239,234,.97);border-radius:24px;padding:44px 46px 30px;color:#4a1a5c;box-shadow:0 6px 24px rgba(0,0,0,.18)}
.dt{font-weight:700;font-size:22px;letter-spacing:.16em;text-transform:uppercase;color:#6B207D}
.tt{font-weight:600;font-size:46px;line-height:1.12;margin-top:12px;color:#4a1a5c;text-wrap:balance}
.fl{display:flex;align-items:center;gap:16px;margin-top:20px;font-weight:600;font-size:26px;color:#3b3340}
.fl svg{flex:none}
.ft{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-top:30px;font-weight:500;font-size:18px;color:#6e6573}
.ft b{font-weight:700;color:#3b3340;white-space:nowrap}
.artbg{position:absolute;inset:-80px;background-size:cover;background-position:center;filter:blur(36px) brightness(.72) saturate(1.1)}
.art{position:absolute;z-index:1;left:0;width:${w}px;height:auto;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.scrim,.logo,.sticker,.panel{z-index:2}
${campaignCss}
</style></head><body><div id="card">
${photo}
<div class="scrim"></div>
<div class="logo">${LOGO}</div>
<div class="sticker"><div class="st1">Price reduction</div>${gradeHtml}
  <div class="was">Was <s>${money(was)}</s></div>
  <div class="now"><span class="l">Now</span><span class="p fitp">${money(now)}</span><span class="pp">pp</span></div></div>
<div class="panel"><div class="dt">${when}</div>
  <div class="tt" id="tt">${esc(title)}</div>
  <div class="fl">${icon}<span>${esc(line)}</span></div>
  <div class="ft"><span>Price per person based on two sharing. Subject to availability. T&amp;Cs apply.</span><b>${esc(d.id)}</b></div></div>
</div>
<script>
// Campaign artwork: plain colours from the artwork's own top and bottom edges (render_cards.py edge_colours).
let topC = null, botC = null;
window.prep = () => {
  const art = document.getElementById('art'); if (!art) return;
  const c = document.createElement('canvas'), W = c.width = art.naturalWidth, H = c.height = art.naturalHeight, x = c.getContext('2d');
  x.drawImage(art, 0, 0);
  const mode = (y0, y1) => {
    const n = {}, d = x.getImageData(0, y0, W, y1 - y0).data;
    for (let i = 0; i < d.length; i += 8) { const k = (d[i] / 24 | 0) + ',' + (d[i + 1] / 24 | 0) + ',' + (d[i + 2] / 24 | 0); (n[k] = n[k] || [0, 0, 0, 0]); n[k][0]++; n[k][1] += d[i]; n[k][2] += d[i + 1]; n[k][3] += d[i + 2]; }
    const b = Object.values(n).sort((a, b) => b[0] - a[0])[0];
    return [b[1] / b[0] | 0, b[2] / b[0] | 0, b[3] / b[0] | 0];
  };
  topC = mode(0, Math.min(6, H)); botC = mode(Math.max(0, H - 6), H);
  if (0.299 * topC[0] + 0.587 * topC[1] + 0.114 * topC[2] > 160) {
    document.querySelector('.logo').style.filter = 'none';
    document.querySelectorAll('.logo svg path').forEach(p => p.style.fill = '#6B207D');
  }
};
function fit(){
  const tt = document.getElementById('tt');
  let size = 46; tt.style.fontSize = size + 'px';
  while (tt.getBoundingClientRect().height > size * 1.12 * 2 + 4 && size > 30) { size -= 1; tt.style.fontSize = size + 'px'; }
  const p = document.querySelector('.fitp'), row = p.parentElement;
  let ps = 74; p.style.fontSize = ps + 'px';
  while (row.scrollWidth > row.clientWidth + 1 && ps > 48) { ps -= 1; p.style.fontSize = ps + 'px'; }
  const art = document.getElementById('art');
  if (art) {
    const W = ${w}, ratio = art.naturalHeight / art.naturalWidth, r = e => document.querySelector(e).getBoundingClientRect();
    const top = Math.max(r('.logo').bottom, r('.sticker').bottom) + 20, room = r('.panel').top - 20 - top;
    let aw = W, ah = W * ratio;
    if (ah > room) { ah = room; aw = ah / ratio; }
    const y = top + (room - ah) / 2, rgb = c => 'rgb(' + c.join(',') + ')';
    art.style.width = aw + 'px'; art.style.height = ah + 'px'; art.style.left = (W - aw) / 2 + 'px'; art.style.top = y + 'px';
    document.getElementById('artbg').style.background =
      'linear-gradient(to bottom, ' + rgb(topC) + ' 0, ' + rgb(topC) + ' ' + (y + ah) + 'px, ' + rgb(botC) + ' ' + (y + ah) + 'px, ' + rgb(botC) + ' 100%)';
  }
}
</script>${RUNTIME}
</body></html>`;
}

export const SIZES = {"1x1": [1080, 1080], "4x5": [1080, 1350], "9x16": [1080, 1920]};
export function cardDoc(d, size, logoSvg){
  const [w, h] = SIZES[size];
  return d.wasnow ? wasNow(d, w, h, logoSvg) : standard(d, w, h, logoSvg);
}
// The same designs at any size (Google Ads images, gbanners.js): w × h is the design size, scaled when saved.
export const cardAt = (d, w, h, logoSvg) => d.wasnow ? wasNow(d, w, h, logoSvg) : standard(d, w, h, logoSvg);

// Opening and closing cards for carousels (Sam, 13 Oct 2026: "Intro 2" and "End 1"), from the
// Ambassador design system: solid Allium with the 20° background pattern (#753685 hatch), whiteout
// logo, a Display Headline (caps, Regular, tracking 180) with the Ambassador A in place of its first
// letter A (Aloe on Allium), and an Aloe tagline container (white caps, ends cut at 20°).
// o: {eyebrow, headline, cta, useA} for the opening card; {headline, cta, url, useA} for the closing one.
const A_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='239.81 127.97 145.95 221.12'%3E%3Cpath d='M384.77 338.29C366.95 336.18 363.8 331.65 353.93 305.11 332.91 247.95 310.02 185.12 289.35 128.97L275.02 170 304.28 254.79 245.76 254.79 240.81 269.12 308.95 269.12C316.28 289.45 322.94 307.44 327.27 320.43 331.13 332 329.14 335.38 313.89 337.86L310.36 348.09 381.14 348.09C382.34 344.83 383.55 341.56 384.77 338.29Z'/%3E%3C/svg%3E")`;
// The headline's first letter A becomes the Ambassador A (once per card, as the guidelines allow).
function withA(text, useA){
  const i = useA === false ? -1 : String(text || "").search(/a/i);
  return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<span class="a" role="img" aria-label="A"></span>${esc(text.slice(i + 1))}`;
}
function brandCard(w, h, LOGO, body, maxHead, centred){
  const story = h / w >= 1.7, top = story ? Math.round(h * 0.14) : 0, bottom = story ? Math.round(h * 0.20) : 0;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${FONT_CSS}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;background:#6B207D;overflow:hidden}
#card{position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:'Quicksand',Helvetica,Arial,sans-serif;color:#fff;
  background-color:#6B207D;background-image:repeating-linear-gradient(70deg,#753685 0 2px,transparent 2px 14px)}
.logo{position:absolute;left:72px;top:${top + 64}px;height:64px}
.logo svg{height:64px;width:auto;display:block}
.body{position:absolute;left:72px;right:72px;top:${centred ? top + 64 : top + 160}px;bottom:${bottom + 64}px;display:flex;flex-direction:column;justify-content:center;
  ${centred ? "align-items:center;text-align:center;" : "align-items:flex-start;"}gap:48px}
.eyebrow{font-weight:500;font-size:28px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:-20px}
.disp{font-weight:400;letter-spacing:.18em;text-transform:uppercase;line-height:1.15;font-size:${maxHead}px;overflow-wrap:break-word}
.a{display:inline-block;width:.7em;height:1.064em;vertical-align:-.065em;margin:0 .14em;background:#009165;
  -webkit-mask:${A_MASK} center/contain no-repeat;mask:${A_MASK} center/contain no-repeat}
.tag{display:inline-block;padding:.55em calc(1.082em - .18em) .55em 1.082em;font-weight:500;font-size:34px;line-height:1;white-space:nowrap;
  letter-spacing:.18em;text-transform:uppercase;color:#fff;background:#009165;clip-path:polygon(0 0,calc(100% - .764em) 0,100% 100%,.764em 100%)}
.url{font-size:30px;font-weight:600;letter-spacing:.04em}
.biglogo svg{height:110px;width:auto;display:block}
</style></head><body><div id="card">${body}</div>
<script>
// Shrink the headline until the whole block fits, and the tagline until it fits the width.
function fit(){
  const b = document.querySelector('.body'), d = document.querySelector('.disp'), t = document.querySelector('.tag');
  let s = ${maxHead}; d.style.fontSize = s + 'px';
  while ((b.scrollHeight > b.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1) && s > 40) { s -= 2; d.style.fontSize = s + 'px'; }
  if (t) { let ts = 34; while (t.getBoundingClientRect().width > ${w} - 144 && ts > 20) { ts -= 1; t.style.fontSize = ts + 'px'; } }
}
</script>${RUNTIME}
</body></html>`;
}
export function introDoc(o, size, LOGO){
  const [w, h] = SIZES[size];
  return brandCard(w, h, LOGO, `<div class="logo">${LOGO}</div><div class="body">
    ${o.eyebrow ? `<p class="eyebrow">${esc(o.eyebrow)}</p>` : ""}
    <h1 class="disp">${withA(o.headline, o.useA)}</h1>
    ${o.cta ? `<span class="tag">${esc(o.cta)}</span>` : ""}</div>`, 92, false);
}
export function endDoc(o, size, LOGO){
  const [w, h] = SIZES[size];
  return brandCard(w, h, LOGO, `<div class="body">
    <div class="biglogo">${LOGO}</div>
    <h1 class="disp">${withA(o.headline, o.useA)}</h1>
    ${o.cta ? `<span class="tag">${esc(o.cta)}</span>` : ""}
    ${o.url ? `<p class="url">${esc(o.url)}</p>` : ""}</div>`, 62, true);
}
