// Email cards (Sam, 13 Oct 2026): just the sailing pictures for HubSpot emails, made the way the team's own
// are (e.g. "Kirkwall, Scotland - Standard (OBC200).png" in the Friday round-up): Standard 1200 × 924 for the
// 3-across tiles and Wide 2400 × 924 for full-width sailings, PNG, the sailing's photo with its offer badges
// (orange, top right, stacked) and a location caption (dark, bottom left). Plus the words that go under each
// picture in the email (name, date, nights and port, ship, "From £Xpp", link), so they can be pasted in.
// Prices, dates, ships and offers come from the tracker's saved data; "Lower fares" offers never reach the
// badges (cards_sync adkit). Everything is made in the browser; nothing is saved or sent anywhere.
import {cropUrl} from "./adcards.js?v=__BUILD__";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const shortDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
const KEY = "spw-email-cards";
const MAX = 24;
// Sizes and type measured from the team's HubSpot pictures (13 Oct 2026)
const SIZES = {standard: {label: "Standard", note: "1200 × 924, for 3-across tiles", w: 1200, h: 924, badge: 44, cap: 46},
               wide: {label: "Wide", note: "2400 × 924, for full-width sailings", w: 2400, h: 924, badge: 44, cap: 46}};

let S, KIT, root, today, st = fresh(), sel = 0, note = "";
function fresh(){ return {items: [], allBadges: false, sizes: {standard: true, wide: true}}; }

export async function mount(el, ctx){
  root = el; S = ctx.state; KIT = (ctx.adkit && ctx.adkit.sailings) || {}; today = S.updated;
  try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && Array.isArray(d.items)) st = {...fresh(), ...d}; } catch(e){}
  st.items = st.items.filter(it => sailing(it.id)).map(it => ({...it, badges: (it.badges || []).filter(b => (sailing(it.id).k.promos || []).includes(b))}));
  draw();
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} };

// ---------- data ----------
const live = () => Object.entries(S.sailings || {}).filter(([, r]) => !r.removed && r.departure_date > today);
function sailing(id){
  const r = (S.sailings || {})[id];
  if (!r || r.removed || !(r.departure_date > today)) return null;
  const k = KIT[id] || {}, fly = r.flight_from;
  return {id, r, k, fly, title: fly ? r.base_title : r.title, price: r.segments[r.segments.length - 1].p, link: r.link || "",
          image: k.image || r.image_link, photos: [k.image || r.image_link, ...(k.photos || [])].filter((u, i, a) => u && a.indexOf(u) === i)};
}
const badgeText = line => line.split(" · ")[0];
const badgesOf = it => st.allBadges ? (sailing(it.id).k.promos || []).slice(0, 2) : it.badges;
// A place name from a photo's file name, offered as a caption to check
function captionHint(url){
  const f = decodeURIComponent((url || "").split("/").pop() || "").replace(/\.\w+$/, "");
  const junk = /^(\d+|\d+x\d+|x|shutterstock|istock|getty|adobe|stock|selected|edited|dsc\d*|img\d*|new|to|use|amb|xxx|cotw|final|v\d+|copy|web|hero|header|crop(ped)?|at|sunset|aerial|view|\d+-\d+-\d+)$/i;
  const words = f.split(/[\s_\-]+/).filter(w => w && !junk.test(w) && !/\d/.test(w));
  if (!words.length || words.length > 5) return "";
  return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
const CAMPAIGN = /cotw|dig-|carousel|boom-radio|weekender|back_to_|no-logo|renaissance|ambience|ambition|_ship|ship_/i;
function pickPhoto(s){
  if (!s.k.campaign && !CAMPAIGN.test(s.image)) return s.image;
  return s.photos.find(u => u !== s.image && !CAMPAIGN.test(u) && captionHint(u)) || s.photos.find(u => u !== s.image && !CAMPAIGN.test(u)) || s.image;
}
// The words that go under the picture in the email, as in the team's emails
function words(it){
  const s = sailing(it.id);
  return {title: s.title.toUpperCase(), date: longDate(s.r.departure_date),
          nights: `${s.r.nights} nights departing ${s.fly ? s.fly + " Airport" : s.r.port}`, ship: s.r.ship,
          button: `From ${money(s.price)}pp`, link: s.link};
}
// File name in the team's style: "<Caption> - Standard (<offers>).png", or the cruise code when there's no caption
function fileName(it, size){
  const base = (it.caption.trim() || `${it.id} ${sailing(it.id).title}`).replace(/[\\/:*?"<>|]+/g, "").slice(0, 60);
  const offers = badgesOf(it).map(badgeText);
  return `${base} - ${SIZES[size].label}${offers.length ? ` (${offers.join(", ").replace(/[\\/:*?"<>|]+/g, "").slice(0, 60)})` : ""}.png`;
}

// ---------- pictures, made in the browser ----------
const FONT_CSS = [500, 600, 700].map(w =>
  `@font-face{font-family:'Quicksand';font-weight:${w};src:url(${location.origin}/fonts/quicksand-latin-${w}-normal.woff2) format('woff2')}`).join("");
const RUNTIME = `<script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js"><\/script>
<script>window.ready=async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r;})));};
window.toPng=()=>htmlToImage.toPng(document.getElementById('card'),{pixelRatio:1,cacheBust:false});<\/script>`;
function cardDoc(it, size){
  const z = SIZES[size], s = sailing(it.id);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}*{margin:0;box-sizing:border-box}
    body{width:${z.w}px;height:${z.h}px;overflow:hidden}#card{position:relative;width:${z.w}px;height:${z.h}px;overflow:hidden;font-family:Quicksand,sans-serif;background:#ddd}
    .ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .bs{position:absolute;top:20px;right:0;display:flex;flex-direction:column;align-items:flex-end;gap:14px}
    .b{background:#F68C4E;color:#fff;font-weight:700;text-transform:uppercase;font-size:${z.badge}px;line-height:1;letter-spacing:.01em;padding:38px 52px}
    .c{position:absolute;left:0;bottom:0;background:rgba(27,27,32,.86);color:#fff;font-weight:600;font-size:${z.cap}px;line-height:1;padding:25px 40px}</style>${RUNTIME}</head>
    <body><div id="card"><img class="ph" crossorigin="anonymous" src="${esc(cropUrl(it.photo || s.image, z.w, z.h))}">
    <div class="bs">${badgesOf(it).map(b => `<div class="b">${esc(badgeText(b))}</div>`).join("")}</div>
    ${it.caption.trim() ? `<div class="c">${esc(it.caption.trim())}</div>` : ""}</div></body></html>`;
}
const made = new Map();   // doc → PNG data URL
async function render(it, size){
  const doc = cardDoc(it, size);
  if (made.has(doc)) return made.get(doc);
  const z = SIZES[size], f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${z.w + 50}px;top:0;width:${z.w}px;height:${z.h}px;border:0`;
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = doc; });
    await f.contentWindow.ready();
    const url = await f.contentWindow.toPng();
    made.set(doc, url);
    return url;
  } finally { f.remove(); }
}
const loadZip = () => window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, bad) => {
  const sc = document.createElement("script");
  sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  sc.onload = () => ok(window.JSZip); sc.onerror = () => bad(new Error("couldn't load the zip tool"));
  document.head.appendChild(sc);
});
const download = (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };

// ---------- page ----------
function draw(){
  const it = st.items, cur = it[sel];
  root.innerHTML = `<div class="ac">
    <div class="ac-side">
      <div class="ac-block">
        <label class="ac-lab" for="ec-find">Add a sailing</label>
        <input id="ec-find" type="search" placeholder="Search name, port or cruise code" autocomplete="off">
        <div id="ec-results" class="ac-results"></div>
      </div>
      <div class="ac-block">
        <h3>Sailings (${it.length})</h3>
        ${it.length ? `<ol class="ac-list">${it.map((x, i) => { const s = sailing(x.id); return `<li class="${i === sel ? "on" : ""}">
          <button type="button" class="ac-pick" data-i="${i}"><b><span class="ac-n">${i + 1}</span>${esc(s.title)}</b><span class="sub">${esc(x.id)} · ${shortDate(s.r.departure_date)}${x.caption ? " · " + esc(x.caption) : ""}</span></button>
          <span class="ac-strips"></span>
          <span class="ac-ord"><button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="Move down"${i < it.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-del="${i}" aria-label="Remove">✕</button></span></li>`; }).join("")}</ol>` : `<p class="sub">Search above and add the sailings you need pictures for.</p>`}
        <label class="ac-check"><input type="checkbox" id="ec-all"${st.allBadges ? " checked" : ""}> Offer badges on every sailing <span class="sub">(each sailing's live offers, up to 2)</span></label>
        <span class="ac-lab">Sizes</span>
        ${Object.entries(SIZES).map(([k, z]) => `<label class="ac-check"><input type="checkbox" data-size="${k}"${st.sizes[k] ? " checked" : ""}> ${z.label} <span class="sub">(${z.note})</span></label>`).join("")}
      </div>
      ${cur ? editor(cur) : ""}
    </div>
    <div class="ac-main">
      <div class="ac-actions">
        <button type="button" class="btn" id="ec-zip"${it.length && (st.sizes.standard || st.sizes.wide) ? "" : " disabled"}>Download zip</button>
        <button type="button" class="btn quiet" id="ec-clear"${it.length ? "" : " disabled"}>Start again</button>
        <span class="sub" id="ec-status" aria-live="polite">Prices as checked ${shortDate(today)}.</span>
      </div>
      ${note ? `<p class="ac-note">${note}</p>` : ""}
      <p class="sub">The zip has a PNG per sailing and size, named like the team's (e.g. "Kirkwall, Scotland - Standard (Up to £200 Onboard Credit).png"), plus <b>email-text.txt</b> and <b>cards.csv</b> with the words for under each picture.</p>
      <div class="ec-grid">${it.map((x, i) => {
        const w = words(x);
        return `<figure class="ec-card${i === sel ? " on" : ""}" data-i="${i}">
          <div class="ec-pics">${Object.keys(SIZES).filter(k => st.sizes[k]).map(k => `<div class="ec-pic ec-${k}"><img data-pic="${i}:${k}" alt="${esc(SIZES[k].label)} picture for ${esc(w.title)}"><button type="button" class="linkbtn" data-dl="${i}:${k}">${SIZES[k].label} PNG</button></div>`).join("")}</div>
          <figcaption><b class="ec-t">${esc(w.title)}</b><span>${esc(w.date)}</span><span>${esc(w.nights)}</span><span>${esc(w.ship)}</span>
            <span class="ec-btn">${esc(w.button)}</span><button type="button" class="linkbtn" data-copy="${i}">Copy text</button></figcaption></figure>`;
      }).join("")}</div>
    </div></div>`;
  note = "";
  wire();
  paint();
}
function editor(it){
  const s = sailing(it.id), hint = captionHint(it.photo);
  return `<div class="ac-block">
    <h3>${sel + 1}. ${esc(s.title)}</h3>
    <span class="ac-lab">Photo</span>
    <div class="ac-photos">${s.photos.map(u => `<button type="button" class="ac-ph${(it.photo || s.image) === u ? " on" : ""}" data-photo="${esc(u)}" aria-label="Use this photo"><img src="${esc(cropUrl(u, 160, 160))}" alt="" loading="lazy"></button>`).join("")}</div>
    <label class="ac-lab" for="ec-caption">Location caption <span class="sub">(check it matches the photo)</span></label>
    <input id="ec-caption" value="${esc(it.caption)}" placeholder="e.g. Kirkwall, Scotland" maxlength="40">
    ${hint && hint !== it.caption ? `<button type="button" class="linkbtn" id="ec-hint">Use "${esc(hint)}" (from the photo's file name)</button>` : ""}
    <span class="ac-lab">Offer badges <span class="sub">(up to 2, as on the sailing's page)</span></span>
    ${(s.k.promos || []).map((p, i) => `<label class="ac-check"><input type="checkbox" data-badge="${i}"${badgesOf(it).includes(p) ? " checked" : ""}${st.allBadges ? " disabled" : ""}> ${esc(p)}</label>`).join("") || `<p class="sub">No offers on this sailing right now.</p>`}
    ${st.allBadges && (s.k.promos || []).length ? `<p class="sub">"Offer badges on every sailing" is ticked. Untick it to choose.</p>` : ""}
  </div>`;
}
let pass = 0;
async function paint(){
  const n = ++pass;
  for (const img of root.querySelectorAll("[data-pic]")) {
    const [i, k] = img.dataset.pic.split(":"), it = st.items[+i];
    try { const url = await render(it, k); if (n !== pass) return; img.src = url; } catch(e) { img.alt = "Couldn't make this picture"; }
  }
}
let typing;
function change(redraw){ save(); if (redraw) draw(); else { clearTimeout(typing); typing = setTimeout(draw, 500); } }
const copyText = it => { const w = words(it); return [w.title, w.date, w.nights, w.ship, `${w.button}: ${w.link}`].join("\n"); };
function wire(){
  const $ = q => root.querySelector(q);
  const find = $("#ec-find"), res = $("#ec-results");
  find.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    if (q.length < 2) { res.innerHTML = ""; return; }
    const hits = live().filter(([id, r]) => [id, r.title, r.base_title, r.port, r.flight_from, r.ship].join(" ").toLowerCase().includes(q))
      .sort((a, b) => a[1].departure_date.localeCompare(b[1].departure_date)).slice(0, 8);
    res.innerHTML = hits.length ? hits.map(([id, r]) => `<button type="button" data-add="${esc(id)}"${st.items.some(x => x.id === id) || st.items.length >= MAX ? " disabled" : ""}><b>${esc(r.flight_from ? r.base_title : r.title)}</b><span class="sub">${esc(id)} · ${shortDate(r.departure_date)} · ${r.flight_from ? "Fly from " + esc(r.flight_from) : esc(r.port)} · ${money(r.segments[r.segments.length - 1].p)}</span></button>`).join("")
      : `<p class="sub">No sailings on sale match.</p>`;
  });
  res.addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b || st.items.length >= MAX) return;
    const s = sailing(b.dataset.add), photo = pickPhoto(s);
    st.items.push({id: s.id, photo, caption: "", badges: (s.k.promos || []).slice(0, 1)}); sel = st.items.length - 1;
    change(true); root.querySelector("#ec-find").focus();
  });
  root.querySelectorAll(".ac-pick").forEach(b => b.addEventListener("click", () => { sel = +b.dataset.i; draw(); }));
  root.querySelectorAll(".ec-card").forEach(f => f.addEventListener("click", e => { if (e.target.closest("button")) return; if (sel !== +f.dataset.i) { sel = +f.dataset.i; draw(); } }));
  const move = (i, j) => { const [x] = st.items.splice(i, 1); st.items.splice(j, 0, x); sel = j; change(true); };
  root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
  root.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(+b.dataset.down, +b.dataset.down + 1)));
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { st.items.splice(+b.dataset.del, 1); sel = Math.max(0, Math.min(sel, st.items.length - 1)); change(true); }));
  $("#ec-all").addEventListener("change", e => { st.allBadges = e.target.checked; change(true); });
  root.querySelectorAll("[data-size]").forEach(b => b.addEventListener("change", () => { st.sizes[b.dataset.size] = b.checked; change(true); }));
  const cur = st.items[sel];
  if (cur) {
    root.querySelectorAll("[data-photo]").forEach(b => b.addEventListener("click", () => { cur.photo = b.dataset.photo; change(true); }));
    $("#ec-caption").addEventListener("input", e => { cur.caption = e.target.value; change(false); });
    $("#ec-hint") && $("#ec-hint").addEventListener("click", () => { cur.caption = captionHint(cur.photo); change(true); });
    root.querySelectorAll("[data-badge]").forEach(b => b.addEventListener("change", () => {
      const p = sailing(cur.id).k.promos[+b.dataset.badge];
      cur.badges = b.checked ? [...cur.badges.filter(x => x !== p), p].slice(-2) : cur.badges.filter(x => x !== p);
      change(true);
    }));
  }
  root.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", async () => {
    const [i, k] = b.dataset.dl.split(":"), it = st.items[+i];
    b.disabled = true; try { download(await render(it, k), fileName(it, k)); } finally { b.disabled = false; }
  }));
  root.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", async () => {
    const t = copyText(st.items[+b.dataset.copy]);
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; } catch(e) { prompt("Copy the text", t); }
  }));
  $("#ec-clear").addEventListener("click", () => { if (confirm("Clear these sailings?")) { st = fresh(); sel = 0; change(true); } });
  $("#ec-zip").addEventListener("click", zip);
}
async function zip(){
  const btn = root.querySelector("#ec-zip"), status = root.querySelector("#ec-status");
  btn.disabled = true;
  try {
    const JSZip = await loadZip(), z = new JSZip(), sizes = Object.keys(SIZES).filter(k => st.sizes[k]), used = new Set();
    const rows = [["#", "Cruise code", "Name", "Date", "Nights and departure", "Ship", "Button", "Link", ...sizes.map(k => SIZES[k].label + " picture")]];
    const text = [`Email card text, prices as checked ${shortDate(today)} (per person, based on two sharing, subject to availability)`, ""];
    let n = 0;
    for (const [i, it] of st.items.entries()) {
      const names = [];
      for (const k of sizes) {
        status.textContent = `Making pictures ${++n} of ${st.items.length * sizes.length}…`;
        let name = fileName(it, k); while (used.has(name)) name = name.replace(/\.png$/, " 2.png"); used.add(name);
        z.file(name, (await render(it, k)).split(",")[1], {base64: true}); names.push(name);
      }
      const w = words(it);
      rows.push([i + 1, it.id, w.title, w.date, w.nights, w.ship, w.button, w.link, ...names]);
      text.push(`${i + 1}. ${copyText(it)}`, ...names.map(f => `   Picture: ${f}`), "");
    }
    z.file("email-text.txt", text.join("\n"));
    z.file("cards.csv", "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n"));
    status.textContent = "Zipping…";
    download(URL.createObjectURL(await z.generateAsync({type: "blob"})), `email-cards_${today}.zip`);
    note = `Downloaded ${st.items.length * sizes.length} pictures. Prices as checked ${shortDate(today)}.`;
  } catch(e) { note = esc(`The zip couldn't be made: ${e.message}`); }
  draw();
}
