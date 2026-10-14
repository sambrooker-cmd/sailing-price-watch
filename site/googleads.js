// Google Ads page (Creative; Sam, 14 Oct 2026: "the whole Google Ads section of this build"). Part 1: images.
//   Performance Max / Demand Gen images in landscape 1.91:1, square and portrait 4:5, as the sailing's clean photo
//   (Google advises no text on these) and/or in the card design; logos (square A, landscape 4:1); display banners in
//   the standard sizes, each JPEG kept under Google's 150 KB. One zip with folders, a CSV and upload steps.
// Like every other page here it only makes files: nothing is sent to Google Ads or any ad account. Prices, dates and
// offers come from the tracker's saved data; a was/now price only from a claim live today (tracker.py claim_for).
import * as cs from "./sections.js?v=__BUILD__";
import {cropUrl} from "./adcards.js?v=__BUILD__";
import {gImageDoc, bannerDoc, logoDoc, RATIOS, BANNERS, LOGOS, BANNER_MAX_KB} from "./gbanners.js?v=__BUILD__";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const shortDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
const KEY = "spw-google";
const MAX = 20;
const GRADE = {inside: "Inside cabins", ocean_view: "Ocean view cabins", balcony: "Balcony cabins", suite: "Suites"};
const CTAS = ["Book now", "Find out more", "View cruise", "Explore"];
// Campaign artwork carries its own words, which Google advises against on Performance Max images: start on a photo
const CAMPAIGN = /cotw|dig-|carousel|boom-radio|weekender|back_to_|no-logo/i;

let S, KIT, CAB = {}, root, today, LOGO = "", st = fresh(), sel = 0, note = "";
function fresh(){
  return {items: [], cta: "Book now",
          make: {photo: true, card: true, banners: true, logos: true},
          ratios: {landscape: true, square: true, portrait: true},
          banners: Object.fromEntries(Object.keys(BANNERS).map(k => [k, true]))};
}

export async function mount(el, ctx){
  root = el; S = ctx.state; KIT = (ctx.adkit && ctx.adkit.sailings) || {}; today = S.updated;
  CAB = (ctx.cabins && ctx.cabins.sailings) || ctx.cabins || {};
  LOGO = await (await fetch("logo-white.svg")).text();
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && Array.isArray(d.items)) {
      const f = fresh();
      st = {...f, ...d, make: {...f.make, ...d.make}, ratios: {...f.ratios, ...d.ratios}, banners: {...f.banners, ...d.banners}};
    }
  } catch(e){}
  const gone = st.items.filter(it => !sailing(it.id)).length, ended = st.items.filter(it => it.wasnow && sailing(it.id) && !claimOf(it)).length;
  st.items = st.items.filter(it => sailing(it.id)).map(it => claimOf(it) ? it : {...it, wasnow: ""});
  if (gone || ended) note = `Since this page was last open: ${[gone && `${gone} sailing${gone === 1 ? " is" : "s are"} no longer on sale and ${gone === 1 ? "was" : "were"} taken off`, ended && `${ended} was/now price${ended === 1 ? "" : "s"} went back to "From" because the claim ended`].filter(Boolean).join("; ")}.`;
  draw();
  if (ctx.add) addSailing(ctx.add);
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} };

// "Add to Google Ads" from a sailing's detail view
export function addSailing(id){
  const s = sailing(id);
  if (!s) { note = `${id} isn't on sale.`; return draw(); }
  const have = st.items.findIndex(x => x.id === id);
  if (have >= 0) { sel = have; note = `${s.title} is already here.`; return draw(); }
  if (st.items.length >= MAX) { note = `Up to ${MAX} sailings at once.`; return draw(); }
  st.items.push({id, photo: pickPhoto(s), wasnow: ""}); sel = st.items.length - 1;
  note = `Added ${s.title}.`; save(); draw();
}

// ---------- data (the tracker's saved state only) ----------
const live = () => Object.entries(S.sailings || {}).filter(([, r]) => !r.removed && r.departure_date > today);
function sailing(id){
  const r = (S.sailings || {})[id];
  if (!r || r.removed || !(r.departure_date > today)) return null;
  const k = KIT[id] || {}, fly = r.flight_from;
  return {id, r, k, fly, title: fly ? r.base_title : r.title, price: r.segments[r.segments.length - 1].p, link: r.link || "",
          image: k.image || r.image_link, photos: [k.image || r.image_link, ...(k.photos || [])].filter((u, i, a) => u && a.indexOf(u) === i)};
}
const pickPhoto = s => (s.k.campaign || CAMPAIGN.test(s.image)) ? (s.photos.find(u => u !== s.image && !CAMPAIGN.test(u) && !u.startsWith("/ships/")) || s.image) : s.image;
// Was/now claims valid today, as the Ad creator offers them (adcreator.js claims())
function claims(id){
  const s = sailing(id); if (!s) return [];
  const out = [], c = s.r.claim;
  if (c && c.eligible && c.ends >= today && c.now === s.price)
    out.push({key: "lead", label: "Lead price", was: c.was, now: c.now, ends: c.ends, grade: s.k.lead_grade || null});
  for (const [k, cc] of Object.entries((CAB[id] || {}).cabin_claims || {}))
    if (k.startsWith("twin.") && GRADE[k.slice(5)] && cc.eligible && cc.ends >= today)
      out.push({key: k, label: GRADE[k.slice(5)], was: cc.was, now: cc.now, ends: cc.ends, grade: k.slice(5)});
  return out;
}
const claimOf = it => it.wasnow ? claims(it.id).find(c => c.key === it.wasnow) || null : null;
// What the designs need, in the Ad creator's card shape (adcards.js)
function cardData(it){
  const s = sailing(it.id), c = claimOf(it), photo = it.photo || s.image;
  return {id: it.id, title: s.title, ship: s.r.ship, port: s.r.port, fly: s.fly, nights: s.r.nights, departure_date: s.r.departure_date,
          price: s.price, promos: (s.k.promos || []).slice(0, s.k.nectar ? 1 : 2), nectar: s.k.nectar || "", photo,
          campaign: !!s.k.campaign && photo === s.image, words: null, trustpilot: "",
          wasnow: c ? {was: c.was, now: c.now, grade: c.grade} : null};
}
const useBy = () => st.items.map(claimOf).filter(Boolean).map(c => c.ends).sort()[0] || "";

// Everything to make, in order: [{key, folder, file, label, sailing?, doc(), type}]
function outputs(){
  const out = [];
  if (st.make.logos) for (const [k, l] of Object.entries(LOGOS))
    out.push({key: `logo:${k}`, group: "Logos", folder: "logos", file: `ambassador_logo_${k}_${l.w}x${l.h}.png`, label: l.label, w: l.w, h: l.h, type: "png", doc: () => logoDoc(k, LOGO)});
  st.items.forEach(it => {
    const d = cardData(it), tag = it.id + (d.wasnow ? "_wasnow" : "");
    for (const [r, R] of Object.entries(RATIOS)) if (st.ratios[r]) for (const style of ["photo", "card"]) if (st.make[style])
      out.push({key: `${it.id}:${r}:${style}`, sid: it.id, group: "Performance Max and Demand Gen", folder: "performance-max",
                file: `${style === "card" ? tag : it.id}_${r}_${R.w}x${R.h}_${style}.jpg`, label: `${R.label} · ${style === "card" ? "card design" : "photo only"}`,
                w: R.w, h: R.h, type: "jpeg", doc: () => gImageDoc(d, r, style, LOGO), price: style === "card"});
    if (st.make.banners) for (const [b, name] of Object.entries(BANNERS)) if (st.banners[b]) {
      const [w, h] = b.split("x").map(Number);
      out.push({key: `${it.id}:${b}`, sid: it.id, group: "Display banners", folder: "display", file: `${tag}_${b}.jpg`, label: `${b} ${name}`,
                w, h, type: "jpeg", max: BANNER_MAX_KB, doc: () => bannerDoc(d, b, LOGO, st.cta), price: true});
    }
  });
  return out;
}

// ---------- rendering (in the browser, one iframe at a time) ----------
const made = new Map();   // doc → {url, bytes, q}
const MADE_MAX = 120;
async function render(o){
  const html = o.doc(), k = html + "|" + (o.max || "");
  if (made.has(k)) return made.get(k);
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;left:-4000px;top:0;width:2000px;height:1400px;border:0";
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = html; });
    await f.contentWindow.ready();
    let q = .9, url = await f.contentWindow.shot(o.type, q), bytes = Math.round((url.length - url.indexOf(",") - 1) * .75);
    // Display banners must be under Google's 150 KB: lower the JPEG quality step by step until they are
    while (o.max && bytes > o.max * 1024 && q > .4) { q -= .08; url = await f.contentWindow.shot(o.type, q); bytes = Math.round((url.length - url.indexOf(",") - 1) * .75); }
    const res = {url, bytes, q};
    made.set(k, res); while (made.size > MADE_MAX) made.delete(made.keys().next().value);
    return res;
  } finally { f.remove(); }
}

// ---------- page ----------
function draw(){
  const it = st.items, cur = it[sel], outs = outputs(), by = useBy();
  const sum = (o, n) => Object.entries(o).filter(([, v]) => v).length + " of " + n;
  root.innerHTML = `<div class="ac">
    <div class="ac-side">
      ${cs.section("g-sailings", "Sailings", it.length ? `${it.length} sailing${it.length === 1 ? "" : "s"}` : "none added yet", `
        <label class="ac-lab" for="g-find">Add a sailing</label>
        <input id="g-find" type="search" placeholder="Search name, port or cruise code" autocomplete="off">
        <div id="g-results" class="ac-results"></div>
        ${it.length ? `<ol class="ac-list">${it.map((x, i) => { const s = sailing(x.id); return `<li class="${i === sel ? "on" : ""}">
          <button type="button" class="ac-pick" data-i="${i}"><b><span class="ac-n">${i + 1}</span>${esc(s.title)}</b><span class="sub">${esc(x.id)} · ${shortDate(s.r.departure_date)} · ${money(claimOf(x) ? claimOf(x).now : s.price)}pp${claimOf(x) ? " · was/now" : ""}</span></button>
          <span class="ac-strips"></span>
          <span class="ac-ord"><button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="Move down"${i < it.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-del="${i}" aria-label="Remove">✕</button></span></li>`; }).join("")}</ol>`
          : `<p class="sub">Search above and add the sailings you want Google Ads images for.</p>`}`)}
      ${cur ? editor(cur) : ""}
      ${cs.section("g-make", "What to make", [st.make.photo && "photos", st.make.card && "card designs", st.make.banners && `${Object.values(st.banners).filter(Boolean).length} banner sizes`, st.make.logos && "logos"].filter(Boolean).join(" · ") || "nothing ticked", `
        <span class="ac-lab">Performance Max and Demand Gen images</span>
        <label class="ac-check"><input type="checkbox" data-gmake="photo"${st.make.photo ? " checked" : ""}> Photo only <span class="sub">(no words: Google's advice for these images)</span></label>
        <label class="ac-check"><input type="checkbox" data-gmake="card"${st.make.card ? " checked" : ""}> Card design <span class="sub">(name, price and offers, as on Meta; Google may show these less)</span></label>
        ${Object.entries(RATIOS).map(([k, r]) => `<label class="ac-check"><input type="checkbox" data-ratio="${k}"${st.ratios[k] ? " checked" : ""}> ${r.label} <span class="sub">(${r.w} × ${r.h})</span></label>`).join("")}
        <span class="ac-lab">Display banners <span class="sub">(${sum(st.banners, Object.keys(BANNERS).length)} sizes)</span></span>
        <label class="ac-check"><input type="checkbox" data-gmake="banners"${st.make.banners ? " checked" : ""}> Make display banners <span class="sub">(each under ${BANNER_MAX_KB} KB)</span></label>
        <div class="g-sizes">${Object.entries(BANNERS).map(([k, n]) => `<label class="ac-check"><input type="checkbox" data-banner="${k}"${st.banners[k] ? " checked" : ""}${st.make.banners ? "" : " disabled"}> ${k} <span class="sub">${n}</span></label>`).join("")}</div>
        <label class="ac-lab" for="g-cta">Button on the banners</label>
        <select id="g-cta">${CTAS.map(c => `<option${c === st.cta ? " selected" : ""}>${c}</option>`).join("")}</select>
        <span class="ac-lab">Logos</span>
        <label class="ac-check"><input type="checkbox" data-gmake="logos"${st.make.logos ? " checked" : ""}> Square and landscape logos <span class="sub">(once per download)</span></label>`, false)}
    </div>
    <div class="ac-main">
      <div class="ac-actions">
        <button type="button" class="btn" id="g-zip"${outs.length ? "" : " disabled"}>Download zip</button>
        <button type="button" class="btn quiet" id="g-clear"${it.length ? "" : " disabled"}>Start again</button>
        <span class="sub" id="g-status" aria-live="polite">${outs.length} image${outs.length === 1 ? "" : "s"} · prices as checked ${shortDate(today)}.${by ? ` <b>Was/now images: stop using by ${shortDate(by)}.</b>` : ""}</span>
      </div>
      ${note ? `<p class="ac-note">${esc(note)}</p>` : ""}
      <p class="sub">Nothing is sent to Google Ads: download the zip and upload the images in Google Ads (the zip's HOW_TO_UPLOAD.md says where each goes). Images with a price are only right while the price is: make them again before reusing them.</p>
      ${previews(outs)}
    </div></div>`;
  note = "";
  wire();
  paint();
}

function editor(it){
  const s = sailing(it.id), cl = claims(it.id), c = claimOf(it);
  const g = cs.photoGrid("g-item", s.photos.map(u => `<button type="button" class="ac-ph${(it.photo || s.image) === u ? " on" : ""}" data-photo="${esc(u)}" aria-label="Use this photo"><img src="${esc(cropUrl(u, 160, 160))}" alt="" loading="lazy"></button>`), s.photos.indexOf(it.photo || s.image));
  return `<div class="ac-block">
    <h3>${esc(s.title)}</h3>
    <p class="sub" style="margin:0">${esc(it.id)} · ${shortDate(s.r.departure_date)} · ${s.r.nights} nights · ${s.fly ? "fly from " + esc(s.fly) : "from " + esc(s.r.port)}</p>
    ${cl.length ? `<label class="ac-lab" for="g-wasnow">Price</label>
      <select id="g-wasnow"><option value="">From ${money(s.price)}pp</option>${cl.map(x => `<option value="${esc(x.key)}"${c && c.key === x.key ? " selected" : ""}>Was/now: ${esc(x.label)}, was ${money(x.was)} now ${money(x.now)} (until ${shortDate(x.ends)})</option>`).join("")}</select>
      ${c ? `<p class="sub">From the tracker's live price-reduction claim: stop using these images by <b>${shortDate(c.ends)}</b>.</p>` : ""}`
      : `<p class="sub">Price on the images: from ${money(s.price)}pp. (Was/now is only offered when this sailing has a live price-reduction claim.)</p>`}
    <span class="ac-lab">Photo</span>
    <div class="ac-photos">${g.grid}</div>${g.more}
    ${s.k.campaign && (it.photo || s.image) === s.image ? `<p class="ac-note">This is campaign artwork with its own words: fine for banners and card designs, but Google advises against words on Performance Max images.</p>` : ""}
  </div>`;
}

function previews(outs){
  if (!outs.length) return st.items.length ? `<p class="sub">Tick something under "What to make".</p>` : "";
  const groups = [];
  for (const o of outs) {
    const name = o.sid ? `${sailing(o.sid).title} (${o.sid})` : "Logos";
    let g = groups.find(x => x.name === name); if (!g) groups.push(g = {name, sid: o.sid, items: []});
    g.items.push(o);
  }
  return groups.map(g => `<div class="ac-block g-group"><h3>${esc(g.name)}</h3>
    ${[...new Set(g.items.map(o => o.group))].map(grp => `<p class="ac-lab" style="margin:6px 0 0">${grp}</p><div class="g-grid">
      ${g.items.filter(o => o.group === grp).map(o => `<figure class="g-img"><div class="g-frame" style="aspect-ratio:${o.w}/${o.h};max-width:${Math.min(o.w, o.w > o.h * 3 ? 520 : 260)}px"><img data-out="${esc(o.key)}" alt="${esc(o.label)}"></div>
        <figcaption><span>${esc(o.label)}</span> <span class="sub" data-kb="${esc(o.key)}"></span> <button type="button" class="linkbtn" data-dl="${esc(o.key)}">Download</button></figcaption></figure>`).join("")}</div>`).join("")}
  </div>`).join("");
}

let pass = 0;
async function paint(){
  const n = ++pass, outs = outputs();
  for (const img of root.querySelectorAll("[data-out]")) {
    if (n !== pass) return;
    const o = outs.find(x => x.key === img.dataset.out); if (!o) continue;
    try {
      const r = await render(o);
      if (n !== pass) return;
      img.src = r.url;
      const kb = root.querySelector(`[data-kb="${CSS.escape(o.key)}"]`);
      if (kb) kb.textContent = `${Math.round(r.bytes / 1024)} KB` + (o.max && r.bytes > o.max * 1024 ? " (over Google's limit)" : "");
    } catch(e) { img.alt = "Couldn't make this image"; }
  }
}

function wire(){
  const $ = q => root.querySelector(q);
  cs.wire(root, draw);
  const change = (redraw = true) => { save(); if (redraw) draw(); };
  const find = $("#g-find"), res = $("#g-results");
  find.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    if (q.length < 2) { res.innerHTML = ""; return; }
    const hits = live().filter(([id, r]) => [id, r.title, r.base_title, r.port, r.flight_from, r.ship].join(" ").toLowerCase().includes(q))
      .sort((a, b) => a[1].departure_date.localeCompare(b[1].departure_date)).slice(0, 8);
    res.innerHTML = hits.length ? hits.map(([id, r]) => `<button type="button" data-add="${esc(id)}"${st.items.some(x => x.id === id) ? " disabled" : ""}><b>${esc(r.flight_from ? r.base_title : r.title)}</b><span class="sub">${esc(id)} · ${shortDate(r.departure_date)} · ${r.flight_from ? "Fly from " + esc(r.flight_from) : esc(r.port)} · ${money(r.segments[r.segments.length - 1].p)}</span></button>`).join("")
      : `<p class="sub">No sailings on sale match.</p>`;
  });
  res.addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    addSailing(b.dataset.add); root.querySelector("#g-find").focus();
  });
  root.querySelectorAll(".ac-pick").forEach(b => b.addEventListener("click", () => { sel = +b.dataset.i; draw(); }));
  const move = (i, j) => { const [x] = st.items.splice(i, 1); st.items.splice(j, 0, x); sel = j; change(); };
  root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
  root.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(+b.dataset.down, +b.dataset.down + 1)));
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { st.items.splice(+b.dataset.del, 1); sel = Math.max(0, Math.min(sel, st.items.length - 1)); change(); }));
  root.querySelectorAll("[data-gmake]").forEach(b => b.addEventListener("change", () => { st.make[b.dataset.gmake] = b.checked; change(); }));
  root.querySelectorAll("[data-ratio]").forEach(b => b.addEventListener("change", () => { st.ratios[b.dataset.ratio] = b.checked; change(); }));
  root.querySelectorAll("[data-banner]").forEach(b => b.addEventListener("change", () => { st.banners[b.dataset.banner] = b.checked; change(); }));
  $("#g-cta").addEventListener("change", e => { st.cta = e.target.value; change(); });
  const cur = st.items[sel];
  if (cur) {
    root.querySelectorAll("[data-photo]").forEach(b => b.addEventListener("click", () => { cur.photo = b.dataset.photo; change(); }));
    $("#g-wasnow") && $("#g-wasnow").addEventListener("change", e => { cur.wasnow = e.target.value; change(); });
  }
  root.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", async () => {
    const o = outputs().find(x => x.key === b.dataset.dl); if (!o) return;
    b.disabled = true;
    try { const r = await render(o); download(r.url, o.file); } finally { b.disabled = false; }
  }));
  $("#g-clear").addEventListener("click", () => { if (confirm("Clear these sailings?")) { st = {...st, items: []}; sel = 0; change(); } });
  $("#g-zip").addEventListener("click", zip);
}

// ---------- download ----------
const download = (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
const loadZip = () => window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, bad) => {
  const sc = document.createElement("script");
  sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  sc.onload = () => ok(window.JSZip); sc.onerror = () => bad(new Error("couldn't load the zip tool"));
  document.head.appendChild(sc);
});
const csvCell = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
async function zip(){
  const btn = root.querySelector("#g-zip"), status = root.querySelector("#g-status"), outs = outputs();
  btn.disabled = true;
  try {
    const JSZip = await loadZip(), z = new JSZip(), rows = [["File", "Use for", "Size (px)", "KB", "Cruise code", "Sailing", "Price on image", "Was/now: use until", "Landing page"]];
    let n = 0;
    for (const o of outs) {
      status.textContent = `Making image ${++n} of ${outs.length}…`;
      const r = await render(o);
      z.file(`${o.folder}/${o.file}`, r.url.split(",")[1], {base64: true});
      const it = o.sid && st.items.find(x => x.id === o.sid), s = o.sid && sailing(o.sid), c = it && claimOf(it);
      rows.push([`${o.folder}/${o.file}`, `${o.group}: ${o.label}`, `${o.w}x${o.h}`, Math.round(r.bytes / 1024), o.sid || "", s ? s.title : "",
                 o.price && s ? (c ? `was ${money(c.was)} now ${money(c.now)}pp` : `from ${money(s.price)}pp`) : "none", o.price && c ? c.ends : "", s ? s.link : ""]);
    }
    z.file("assets.csv", "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n"));
    z.file("HOW_TO_UPLOAD.md", howTo(outs));
    status.textContent = "Zipping…";
    const blob = await z.generateAsync({type: "blob"});
    download(URL.createObjectURL(blob), `google-ads_${st.items.map(x => x.id).slice(0, 3).join("-")}${st.items.length > 3 ? "-etc" : ""}_${today}.zip`);
    status.textContent = `Downloaded ${outs.length} images. Prices as checked ${shortDate(today)}.`;
  } catch(e) { status.textContent = `The zip couldn't be made: ${e.message}`; }
  finally { btn.disabled = false; }
}
function howTo(outs){
  const has = g => outs.some(o => o.group === g), by = useBy();
  return [`# Google Ads images`, ``,
    `Made on the Sailing price watch tracker. Prices as checked ${shortDate(today)}.` + (by ? ` **Images with a was/now price must stop being used by ${shortDate(by)}.**` : ""),
    `Nothing has been sent to Google Ads. Check each image before uploading; the full list is in assets.csv.`, ``,
    ...(has("Performance Max and Demand Gen") ? [`## Performance Max and Demand Gen (folder performance-max)`, ``,
      `In the campaign's asset group (or Demand Gen ad): Images → Add images → Upload. Add the landscape (1.91:1), square (1:1)`,
      `and portrait (4:5) versions; Google picks the best fit for each placement. Google advises against words, logos or`,
      `buttons on these images: the "photo" files have none; the "card" files carry the price and offers and may be shown less.`,
      `Add the logos (folder logos) under Logos.`, ``] : []),
    ...(has("Display banners") ? [`## Display banners (folder display)`, ``,
      `Display campaign → Ads → + → Upload display ads → choose the files. Each is the exact size Google lists and under 150 KB.`,
      `Use the sailing's page (in assets.csv) as the final URL.`, ``] : []),
    ...(has("Logos") ? [`## Logos (folder logos)`, ``, `Square (1:1) and landscape (4:1) logos for asset groups and responsive display ads.`, ``] : []),
  ].join("\n");
}
