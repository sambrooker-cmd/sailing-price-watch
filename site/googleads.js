// Google Ads page (Creative; Sam, 14 Oct 2026: "the whole Google Ads section of this build"). Part 1: images.
//   Performance Max / Demand Gen images in landscape 1.91:1, square and portrait 4:5, as the sailing's clean photo
//   (Google advises no text on these) and/or in the card design; logos (square A, landscape 4:1); display banners in
//   the standard sizes, each JPEG kept under Google's 150 KB. One zip with folders, a CSV and upload steps.
// Like every other page here it only makes files: nothing is sent to Google Ads or any ad account. Prices, dates and
// offers come from the tracker's saved data; a was/now price only from a claim live today (tracker.py claim_for).
import * as cs from "./sections.js?v=__BUILD__";
import {cropUrl} from "./adcards.js?v=__BUILD__";
import {gImageDoc, bannerDoc, logoDoc, RATIOS, BANNERS, LOGOS, BANNER_MAX_KB} from "./gbanners.js?v=__BUILD__";
import {previewHtml, CHANNELS, CSS as PV_CSS} from "./gpreview.js?v=__BUILD__";
import {copySet as copySetUK, stalePrices as staleUK, LIMITS, BUSINESS as BUSINESS_UK} from "./gcopy.js?v=__BUILD__";
import {copySet as copySetFR, stalePrices as staleFR, BUSINESS as BUSINESS_FR, SITE as SITE_FR} from "./gcopy_fr.js?v=__BUILD__";
import {frMoney} from "./adcards.js?v=__BUILD__";
import * as claude from "./drafts.js?v=__BUILD__";
import {feedRow, customiserRow, customiserLines, FEED_COLUMNS, ATTRIBUTES, TEXT_MAX} from "./gfeeds.js?v=__BUILD__";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
// France (Sam, 14 Oct 2026, stage 3): mount(…, {market: "fr"}) makes the same images, copy and feeds for Ambassador
// Croisières, in French and euros (gcopy_fr.js, gbanners/adcards d.fr, gfeeds s.fr), with its own draft in this browser.
let FR = false;
const money = v => FR ? frMoney(v) : "£" + Math.round(v).toLocaleString("en-GB");
const copySet = items => FR ? copySetFR(items) : copySetUK(items);
const stalePrices = (t, items) => FR ? staleFR(t, items) : staleUK(t, items);
let BUSINESS = BUSINESS_UK;
const shortDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
let KEY = "spw-google";
const MAX = 20;
const GRADE = {inside: "Inside cabins", ocean_view: "Ocean view cabins", balcony: "Balcony cabins", suite: "Suites"};
let CTAS = ["Book now", "Find out more", "Discover more", "View cruise"];   // button labels from the messaging matrix (14 Oct 2026), plus View cruise
const CTAS_FR = ["Réserver", "En savoir plus", "Voir la croisière", "Découvrir"];
// Campaign artwork carries its own words, which Google advises against on Performance Max images: start on a photo
const CAMPAIGN = /cotw|dig-|carousel|boom-radio|weekender|back_to_|no-logo/i;

let S, KIT, CAB = {}, ID = null, root, today, LOGO = "", st = fresh(), sel = 0, note = "";
function fresh(){
  return {items: [], cta: CTAS[0], tab: "images", copyMode: "each", copy: {},
          campaigns: FR ? {search: "Search - Croisières FR", pmax: "Performance Max - Croisières FR", dg: "Demand Gen - Croisières FR"}
                        : {search: "Search - Cruises", pmax: "Performance Max - Cruises", dg: "Demand Gen - Cruises"},
          make: {photo: true, card: true, banners: true, logos: true}, feedSale: false,
          ratios: {landscape: true, square: true, portrait: true},
          banners: Object.fromEntries(Object.keys(BANNERS).map(k => [k, true])),
          pv: {channel: "all", device: "phone", n: 0, style: "photo"}};
}

export async function mount(el, ctx){
  root = el; S = ctx.state; KIT = (ctx.adkit && ctx.adkit.sailings) || {}; today = S.updated; ID = ctx.idToken || null;
  CAB = (ctx.cabins && ctx.cabins.sailings) || ctx.cabins || {};
  FR = ctx.market === "fr";
  if (FR) { KEY = "spw-google-fr"; CTAS = CTAS_FR; BUSINESS = BUSINESS_FR; st = fresh(); }
  LOGO = await (await fetch(FR ? "logo-fr-white.svg" : "logo-white.svg")).text();
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && Array.isArray(d.items)) {
      const f = fresh();
      st = {...f, ...d, make: {...f.make, ...d.make}, ratios: {...f.ratios, ...d.ratios}, banners: {...f.banners, ...d.banners}, pv: {...f.pv, ...(d.pv || {})}};
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
  return {id: it.id, fr: FR, title: s.title, ship: s.r.ship, port: s.r.port, fly: s.fly, nights: s.r.nights, departure_date: s.r.departure_date,
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
          <button type="button" class="ac-pick" data-i="${i}"><b><span class="ac-n">${i + 1}</span>${esc(s.title)}</b><span class="sub">${esc(x.id)} · ${shortDate(s.r.departure_date)} · ${money(claimOf(x) ? claimOf(x).now : s.price)}${FR ? "/pers." : "pp"}${claimOf(x) ? " · was/now" : ""}</span></button>
          <span class="ac-strips"></span>
          <span class="ac-ord"><button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="Move down"${i < it.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-del="${i}" aria-label="Remove">✕</button></span></li>`; }).join("")}</ol>`
          : `<p class="sub">Search above and add the sailings you want Google Ads images for.</p>`}`)}
      ${cur && st.tab === "images" ? editor(cur) : ""}
      ${st.tab === "copy" ? copySettings() : ""}
      ${st.tab === "feeds" ? feedSettings() : ""}
      ${st.tab !== "images" ? "" : cs.section("g-make", "What to make", [st.make.photo && "photos", st.make.card && "card designs", st.make.banners && `${Object.values(st.banners).filter(Boolean).length} banner sizes`, st.make.logos && "logos"].filter(Boolean).join(" · ") || "nothing ticked", `
        <span class="ac-lab">Performance Max and Demand Gen images</span>
        <label class="ac-check"><input type="checkbox" data-gmake="photo"${st.make.photo ? " checked" : ""}> Photo only <span class="sub">(no words: Google's advice for these images)</span></label>
        <label class="ac-check"><input type="checkbox" data-gmake="card"${st.make.card ? " checked" : ""}> Card design <span class="sub">(name, price and offers, as on Meta; Google may show these less)</span></label>
        ${Object.entries(RATIOS).map(([k, r]) => `<label class="ac-check"><input type="checkbox" data-ratio="${k}"${st.ratios[k] ? " checked" : ""}> ${r.label} <span class="sub">(${r.w} × ${r.h})</span></label>`).join("")}
        <span class="ac-lab">Display banners <span class="sub">(${sum(st.banners, Object.keys(BANNERS).length)} sizes)</span></span>
        <label class="ac-check"><input type="checkbox" data-gmake="banners"${st.make.banners ? " checked" : ""}> Make display banners <span class="sub">(each under ${BANNER_MAX_KB} KB)</span></label>
        <div class="g-sizes">${Object.entries(BANNERS).map(([k, n]) => `<label class="ac-check"><input type="checkbox" data-banner="${k}"${st.banners[k] ? " checked" : ""}${st.make.banners ? "" : " disabled"}> ${k} <span class="sub">${n}</span></label>`).join("")}</div>
        <label class="ac-lab" for="g-cta">Button on the banners</label>
        <select id="g-cta">${(CTAS.includes(st.cta) ? CTAS : [...CTAS, st.cta]).map(c => `<option${c === st.cta ? " selected" : ""}>${c}</option>`).join("")}</select>
        <span class="ac-lab">Logos</span>
        <label class="ac-check"><input type="checkbox" data-gmake="logos"${st.make.logos ? " checked" : ""}> Square and landscape logos <span class="sub">(once per download)</span></label>`, false)}
    </div>
    <div class="ac-main">
      <div class="ac-tabs g-tabs" role="tablist" aria-label="Google Ads">${[["images", "Images"], ["copy", "Ad copy"], ["feeds", "Feeds"], ["preview", "Preview"]].map(([k, l]) =>
        `<button type="button" role="tab" class="ac-tab" data-gtab="${k}" aria-selected="${st.tab === k}"><span>${l}</span></button>`).join("")}</div>
      ${st.tab === "copy" ? copyMain() : st.tab === "feeds" ? feedsMain() : st.tab === "preview" ? previewMain() : `<div class="ac-actions">
        <button type="button" class="btn" id="g-zip"${outs.length ? "" : " disabled"}>Download zip</button>
        <button type="button" class="btn quiet" id="g-clear"${it.length ? "" : " disabled"}>Start again</button>
        <span class="sub" id="g-status" aria-live="polite">${outs.length} image${outs.length === 1 ? "" : "s"} · prices as checked ${shortDate(today)}.${by ? ` <b>Was/now images: stop using by ${shortDate(by)}.</b>` : ""}</span>
      </div>
      ${note ? `<p class="ac-note">${esc(note)}</p>` : ""}
      <p class="sub">Nothing is sent to Google Ads: download the zip and upload the images in Google Ads (the zip's HOW_TO_UPLOAD.md says where each goes). Images with a price are only right while the price is: make them again before reusing them.</p>
      ${previews(outs)}`}
    </div></div>`;
  note = "";
  wire();
  if (st.tab === "copy") wireCopy(); else if (st.tab === "feeds") wireFeeds(); else if (st.tab === "preview") wirePreview(); else paint();
}

// ---------- Preview tab (Sam, 16 Oct 2026: "a preview viewer for the PMAX assets"; site/gpreview.js) ----------
// The chosen sailing's assets in Google's placements: its Ad copy tab text (edited or suggested) and its images
// (photo only or card design, the logo and the banners), drawn as the Images tab makes them.
function pvSet(it){
  const i = copyItem(it), x = {key: it.id, items: [i], url: i.link};
  return {set: setOf(x), url: urlOf(x)};
}
function pvOutput(name, d){
  if (name === "logo") return {type: "png", doc: () => logoDoc("square", LOGO)};
  if (name.startsWith("b")) return {type: "jpeg", max: BANNER_MAX_KB, doc: () => bannerDoc(d, name.slice(1), LOGO, st.cta)};
  return {type: "jpeg", doc: () => gImageDoc(d, name, st.pv.style, LOGO)};
}
function previewMain(){
  const it = st.items[sel];
  if (!it) return `<p class="sub">Add a sailing (left) to see its Performance Max ad in Google's placements.</p>`;
  if (!document.getElementById("gp-css")) { const t = document.createElement("style"); t.id = "gp-css"; t.textContent = PV_CSS; document.head.appendChild(t); }
  const s = sailing(it.id), {set, url} = pvSet(it), pv = st.pv;
  const chip = (k, l, on, attr) => `<button type="button" class="ac-tab" ${attr}="${k}" aria-selected="${on}"><span>${esc(l)}</span></button>`;
  return `<div class="ac-actions" style="flex-wrap:wrap;gap:8px">
      ${st.items.length > 1 ? `<select id="pv-sailing" aria-label="Sailing">${st.items.map((x, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(sailing(x.id).title)} (${esc(x.id)})</option>`).join("")}</select>` : `<b>${esc(s.title)}</b>`}
      <select id="pv-style" aria-label="Images"><option value="photo"${pv.style === "photo" ? " selected" : ""}>Photo only images</option><option value="card"${pv.style === "card" ? " selected" : ""}>Card design images</option></select>
      <button type="button" class="btn quiet" id="pv-mix">Show another mix</button>
    </div>
    <div class="ac-tabs" role="tablist" aria-label="Where" style="margin-top:8px">${CHANNELS.map(([k, l]) => chip(k, l, pv.channel === k, "data-pvch")).join("")}
      <span style="flex:1"></span>${[["phone", "Phone"], ["desk", "Desktop"]].map(([k, l]) => chip(k, l, pv.device === k, "data-pvdev")).join("")}</div>
    <p class="sub">A close guide, not Google's own preview: Google picks and mixes the headlines, descriptions and images itself (Show another mix steps through combinations) and its layouts change. Text from the Ad copy tab${st.copy[it.id] ? " (your edits)" : ""}, images as the Images tab makes them, button "${esc(st.cta)}".</p>
    ${previewHtml({set, url, business: BUSINESS, cta: st.cta, channel: pv.channel, device: pv.device, n: pv.n, fr: FR, img: name => `<img data-gpv="${name}" alt="">`})}`;
}
let pvPass = 0;
async function wirePreview(){
  const $ = q => root.querySelector(q), save2 = () => { save(); draw(); };
  const ss = $("#pv-sailing"); if (ss) ss.addEventListener("change", () => { sel = +ss.value; draw(); });
  const sty = $("#pv-style"); if (sty) sty.addEventListener("change", () => { st.pv.style = sty.value; save2(); });
  const mix = $("#pv-mix"); if (mix) mix.addEventListener("click", () => { st.pv.n++; save2(); });
  root.querySelectorAll("[data-pvch]").forEach(b => b.addEventListener("click", () => { st.pv.channel = b.dataset.pvch; save2(); }));
  root.querySelectorAll("[data-pvdev]").forEach(b => b.addEventListener("click", () => { st.pv.device = b.dataset.pvdev; save2(); }));
  const it = st.items[sel]; if (!it) return;
  // Each image once, in the order they appear, filling every place it's shown as soon as it's ready
  const d = cardData(it), n = ++pvPass;
  for (const name of [...new Set([...root.querySelectorAll("[data-gpv]")].map(i => i.dataset.gpv))]) {
    let url = "";
    try { url = (await render(pvOutput(name, d))).url; } catch(x) {}
    if (n !== pvPass) return;
    root.querySelectorAll(`[data-gpv="${name}"]`).forEach(img => { if (url) img.src = url; else img.alt = "Couldn't make this image"; });
  }
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
      : FR ? `<p class="sub">Price on the images: from ${money(s.price)}/pers. (no was/now for France).</p>`
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
  root.querySelectorAll("[data-gtab]").forEach(b => b.addEventListener("click", () => { st.tab = b.dataset.gtab; change(); }));
  const move = (i, j) => { const [x] = st.items.splice(i, 1); st.items.splice(j, 0, x); sel = j; change(); };
  root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
  root.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(+b.dataset.down, +b.dataset.down + 1)));
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { st.items.splice(+b.dataset.del, 1); sel = Math.max(0, Math.min(sel, st.items.length - 1)); change(); }));
  root.querySelectorAll("[data-gmake]").forEach(b => b.addEventListener("change", () => { st.make[b.dataset.gmake] = b.checked; change(); }));
  root.querySelectorAll("[data-ratio]").forEach(b => b.addEventListener("change", () => { st.ratios[b.dataset.ratio] = b.checked; change(); }));
  root.querySelectorAll("[data-banner]").forEach(b => b.addEventListener("change", () => { st.banners[b.dataset.banner] = b.checked; change(); }));
  $("#g-cta") && $("#g-cta").addEventListener("change", e => { st.cta = e.target.value; change(); });
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
  $("#g-clear") && $("#g-clear").addEventListener("click", () => { if (confirm("Clear these sailings?")) { st = {...st, items: []}; sel = 0; change(); } });
  $("#g-zip") && $("#g-zip").addEventListener("click", zip);
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
    download(URL.createObjectURL(blob), `google-ads_${FR ? "fr_" : ""}${st.items.map(x => x.id).slice(0, 3).join("-")}${st.items.length > 3 ? "-etc" : ""}_${today}.zip`);
    status.textContent = `Downloaded ${outs.length} images. Prices as checked ${shortDate(today)}.`;
  } catch(e) { status.textContent = `The zip couldn't be made: ${e.message}`; }
  finally { btn.disabled = false; }
}
function howTo(outs){
  const has = g => outs.some(o => o.group === g), by = useBy();
  return [`# Google Ads images${FR ? " (France: Ambassador Croisières)" : ""}`, ``,
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

// ---------- ad copy (part 2) ----------
// Copy is written per sailing (one ad group / asset group each) or for all the chosen sailings together. Suggestions
// come from gcopy.js; any edit keeps that set's own copy in the draft (st.copy[key]) until "Back to suggestions".
const SITE_UK = "https://www.ambassadorcruiseline.com/";
const site = () => FR ? SITE_FR : SITE_UK;
function copyItem(it){
  const d = cardData(it), s = sailing(it.id), n = parseInt(((s.k.nectar || "").match(/[\d,]+/) || ["0"])[0].replace(/,/g, ""), 10);
  return {id: it.id, title: d.title, ship: d.ship, port: d.port, fly: d.fly, nights: d.nights, departure_date: d.departure_date,
          price: d.price, promos: s.k.promos || [], nectarPts: n, link: s.link, wasnow: d.wasnow};
}
function sets(){
  if (!st.items.length) return [];
  if (st.copyMode === "together" && st.items.length > 1) {
    const items = st.items.map(copyItem);
    return [{key: "all:" + st.items.map(x => x.id).join(","), name: `All ${items.length} sailings`, group: `${items.map(i => i.id).join(" ")} together`, items, url: site()}];
  }
  return st.items.map(it => { const i = copyItem(it); return {key: it.id, name: `${i.title} (${i.id})`, group: `${i.id} ${i.title}`.slice(0, 120), items: [i], url: i.link}; });
}
const setOf = x => (st.copy[x.key] && st.copy[x.key].set) || copySet(x.items);
const urlOf = x => (st.copy[x.key] && st.copy[x.key].url) || x.url;
const FIELDS = [
  ["rsa", "Search (responsive search ad)", [["headlines", "Headlines", LIMITS.rsa.headlines], ["descriptions", "Descriptions", LIMITS.rsa.descriptions]]],
  ["pmax", "Performance Max (asset group)", [["headlines", "Headlines", LIMITS.pmax.headlines], ["longHeadlines", "Long headlines", LIMITS.pmax.longHeadlines], ["descriptions", "Descriptions (the first at most 60 characters)", LIMITS.pmax.descriptions]]],
  ["dg", "Demand Gen", [["headlines", "Headlines", LIMITS.dg.headlines], ["descriptions", "Descriptions", LIMITS.dg.descriptions]]],
];
function allText(set){ return [...FIELDS.flatMap(([g, , fs]) => fs.flatMap(([f]) => set[g][f])), set.rsa.path1, set.rsa.path2, ...set.callouts, ...set.sitelinks.flatMap(l => [l.text, l.d1, l.d2])].join(" | "); }

function copySettings(){
  return cs.section("g-copyset", "Copy settings", `${st.copyMode === "together" && st.items.length > 1 ? "all sailings together" : "one set per sailing"}`, `
    <div class="ac-row" role="group" aria-label="Write copy"><span class="ac-lab">Write copy</span>
      <button type="button" class="ac-seg" data-cmode="each" aria-pressed="${st.copyMode !== "together"}">For each sailing</button>
      <button type="button" class="ac-seg" data-cmode="together" aria-pressed="${st.copyMode === "together"}"${st.items.length > 1 ? "" : " disabled"}>For all together</button></div>
    <p class="sub">Each sailing = an ad group (or asset group) per sailing. All together = one set about every chosen sailing.</p>
    <span class="ac-lab">Campaign names for Google Ads Editor</span>
    ${[["search", "Search"], ["pmax", "Performance Max"], ["dg", "Demand Gen"]].map(([k, l]) => `<label class="ac-lab sm" for="g-camp-${k}">${l}</label><input id="g-camp-${k}" data-camp="${k}" value="${esc(st.campaigns[k])}">`).join("")}
    <p class="sub">Use your existing campaigns' exact names so Editor adds the ads to them.</p>`);
}

function lineInputs(key, g, f, [max, count], label, first60){
  const set = setOf(sets().find(x => x.key === key)), xs = f ? set[g][f] : set[g];
  return `<div class="gc-list"><div class="gc-head"><span class="ac-lab">${label} <span class="sub">(${xs.length} of up to ${count}, ${max} characters each)</span></span>
      <button type="button" class="linkbtn" data-ccopy="${esc(key)}|${g}|${f}">Copy all</button></div>
    ${xs.map((v, i) => { const lim = first60 && i === 0 ? LIMITS.pmax.shortDescription : max;
      return `<div class="gc-line"><input data-c="${esc(key)}|${g}|${f}|${i}" value="${esc(v)}" maxlength="${lim}" aria-label="${label} ${i + 1}"><span class="gc-n" data-cn="${esc(key)}|${g}|${f}|${i}">${v.length}/${lim}</span><button type="button" class="gc-x" data-cdel="${esc(key)}|${g}|${f}|${i}" aria-label="Remove">✕</button></div>`; }).join("")}
    ${xs.length < count ? `<button type="button" class="linkbtn" data-cadd="${esc(key)}|${g}|${f}">+ Add a line</button>` : ""}</div>`;
}

function copyMain(){
  const list = sets();
  if (!list.length) return `<p class="sub">Add sailings on the left to get ad copy for them.</p>`;
  return `<div class="ac-actions">
      <button type="button" class="btn" id="g-editor">Download for Google Ads Editor</button>
      <span class="sub" id="g-status" aria-live="polite">Prices as checked ${shortDate(today)}.${useBy() ? ` <b>Copy with a was/now price: stop using by ${shortDate(useBy())}.</b>` : ""}</span>
    </div>
    ${note ? `<p class="ac-note">${esc(note)}</p>` : ""}
    <p class="sub">${FR ? "In French, built from these sailings' own prices, dates, ports and offers, within Google's character limits (have a French speaker read them)." : "Built from these sailings' own prices, dates, ports, offers and Nectar points, within Google's character limits."} Edit any line; edits are kept in this browser. Nothing is sent to Google Ads: download the CSVs and import them with Google Ads Editor (or copy the lines into Google Ads).</p>
    ${list.length > 1 ? `<label class="ac-lab" for="g-draftfor">Draft with Claude for</label><select id="g-draftfor">${list.map(x => `<option value="${esc(x.key)}"${x.key === draftKey(list) ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
    ${claude.block("google", "")}
    ${list.map(x => {
      const set = setOf(x), edited = !!st.copy[x.key], stale = stalePrices(allText(set), x.items);
      return `<div class="ac-block g-set"><h3>${esc(x.name)}</h3>
        ${stale.length ? `<p class="ac-note">This copy mentions ${[...new Set(stale)].map(n => money(Number(n))).join(", ")}, which isn't a current price for these sailings. Change it, or go back to the suggestions.</p>` : ""}
        <div class="gc-row"><label class="ac-lab sm" for="g-url-${esc(x.key)}">Final URL</label><input id="g-url-${esc(x.key)}" data-curl="${esc(x.key)}" value="${esc(urlOf(x))}" inputmode="url">
          ${edited ? `<button type="button" class="linkbtn" data-creset="${esc(x.key)}">Back to the suggestions</button>` : `<span class="sub">Suggestions (not edited)</span>`}</div>
        ${FIELDS.map(([g, title, fs]) => cs.section(`gc-${g}`, title, `${fs.map(([f, l]) => `${set[g][f].length} ${l.toLowerCase().split(" (")[0]}`).join(" · ")}`,
          fs.map(([f, l, lim]) => lineInputs(x.key, g, f, lim, l, g === "pmax" && f === "descriptions")).join("") +
          (g === "rsa" ? `<div class="gc-list"><span class="ac-lab">Display path <span class="sub">(up to 15 characters each, after ${FR ? "ambassadorcroisieres.fr" : "ambassadorcruiseline.com"}/)</span></span>
            <div class="gc-paths">${["path1", "path2"].map(f => `<input data-cp="${esc(x.key)}|${f}" value="${esc(set.rsa[f])}" maxlength="15" aria-label="${f}">`).join(" / ")}</div></div>` : "") +
          (g !== "rsa" ? `<p class="sub">Business name: ${BUSINESS}</p>` : ""), g === "rsa")).join("")}
        ${cs.section("gc-ext", "Sitelinks and callouts", `${set.sitelinks.length} sitelinks · ${set.callouts.length} callouts`, `
          <span class="ac-lab">Sitelinks <span class="sub">(text ${LIMITS.sitelink.text}, description lines ${LIMITS.sitelink.desc} characters)</span></span>
          ${set.sitelinks.map((l, i) => `<div class="gc-site">${[["text", LIMITS.sitelink.text], ["d1", LIMITS.sitelink.desc], ["d2", LIMITS.sitelink.desc]].map(([f, lim]) =>
            `<input data-cs="${esc(x.key)}|${i}|${f}" value="${esc(l[f])}" maxlength="${lim}" aria-label="Sitelink ${i + 1} ${f}">`).join("")}<span class="sub gc-url">${esc(l.url)}</span></div>`).join("")}
          ${lineInputs(x.key, "callouts", null, [LIMITS.callout, 20], "Callouts")}`, false)}
      </div>`; }).join("")}`;
}

// Which set Claude drafts for (the first, unless another is chosen)
let draftFor = "";
const draftKey = list => (list.find(x => x.key === draftFor) || list[0] || {}).key;

// Read and change a set's copy; the first edit stores the set in the draft
function editable(key){
  const x = sets().find(y => y.key === key);
  if (!st.copy[key]) st.copy[key] = {set: JSON.parse(JSON.stringify(copySet(x.items))), url: x.url};
  return st.copy[key];
}
const pick = (set, g, f) => f && f !== "null" ? set[g][f] : set[g];

function wireCopy(){
  const $ = q => root.querySelector(q);
  root.querySelectorAll("[data-cmode]").forEach(b => b.addEventListener("click", () => { st.copyMode = b.dataset.cmode; save(); draw(); }));
  root.querySelectorAll("[data-camp]").forEach(b => b.addEventListener("input", () => { st.campaigns[b.dataset.camp] = b.value; save(); }));
  root.querySelectorAll("[data-c]").forEach(inp => inp.addEventListener("input", () => {
    const [key, g, f, i] = inp.dataset.c.split("|"); pick(editable(key).set, g, f)[+i] = inp.value; save();
    const n = root.querySelector(`[data-cn="${CSS.escape(inp.dataset.c)}"]`); if (n) n.textContent = `${inp.value.length}/${inp.maxLength}`;
  }));
  root.querySelectorAll("[data-cdel]").forEach(b => b.addEventListener("click", () => { const [key, g, f, i] = b.dataset.cdel.split("|"); pick(editable(key).set, g, f).splice(+i, 1); save(); draw(); }));
  root.querySelectorAll("[data-cadd]").forEach(b => b.addEventListener("click", () => {
    const [key, g, f] = b.dataset.cadd.split("|"); pick(editable(key).set, g, f).push(""); save(); draw();
    const all = root.querySelectorAll(`[data-c^="${CSS.escape(key + "|" + g + "|" + f + "|")}"]`); all.length && all[all.length - 1].focus();
  }));
  root.querySelectorAll("[data-cp]").forEach(inp => inp.addEventListener("input", () => { const [key, f] = inp.dataset.cp.split("|"); editable(key).set.rsa[f] = inp.value.replace(/\s+/g, "-"); save(); }));
  root.querySelectorAll("[data-cs]").forEach(inp => inp.addEventListener("input", () => { const [key, i, f] = inp.dataset.cs.split("|"); editable(key).set.sitelinks[+i][f] = inp.value; save(); }));
  root.querySelectorAll("[data-curl]").forEach(inp => inp.addEventListener("input", () => { editable(inp.dataset.curl).url = inp.value.trim(); save(); }));
  root.querySelectorAll("[data-creset]").forEach(b => b.addEventListener("click", () => { delete st.copy[b.dataset.creset]; save(); draw(); }));
  root.querySelectorAll("[data-ccopy]").forEach(b => b.addEventListener("click", async () => {
    const [key, g, f] = b.dataset.ccopy.split("|"), t = pick(setOf(sets().find(x => x.key === key)), g, f).filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy all"; }, 1500); } catch(e) { prompt("Copy these lines", t); }
  }));
  $("#g-editor") && $("#g-editor").addEventListener("click", editorZip);
  $("#g-draftfor") && $("#g-draftfor").addEventListener("change", e => { draftFor = e.target.value; });
  // Claude's drafts (drafts.js / draft_job.py kind "google"): facts from the saved state; "Use this" fills the set's
  // Search and Performance Max headlines and descriptions, and the Performance Max long headlines
  claude.wire(root, "google", {ID, redraw: draw,
    body: () => { const x = sets().find(y => y.key === draftKey(sets()));
      return {format: x.items.length === 1 ? "single" : "carousel", ...(FR ? {market: "fr"} : {}), items: x.items.map(i => ({id: i.id, wasnow: (st.items.find(it => it.id === i.id) || {}).wasnow || null, promos: i.promos}))}; },
    forWhat: () => (sets().find(y => y.key === draftKey(sets())) || {}).name || "",
    use: o => { const key = draftKey(sets()), e = editable(key);
      e.set.rsa.headlines = o.headlines.slice(0, 15); e.set.rsa.descriptions = o.descriptions.slice(0, 4);
      e.set.pmax.headlines = o.headlines.slice(0, 15); e.set.pmax.longHeadlines = o.long_headlines.slice(0, 5);
      const short = e.set.pmax.descriptions[0] && e.set.pmax.descriptions[0].length <= LIMITS.pmax.shortDescription ? [e.set.pmax.descriptions[0]] : [];
      e.set.pmax.descriptions = [...short, ...o.descriptions].slice(0, 5);
      note = "Claude's lines are in the Search and Performance Max sections below: read them before using them.";
      save(); draw(); }});
}

// Google Ads Editor import files (Account → Import → From file). Column names as Editor's own exports use them;
// check the first import in Editor's preview before posting.
async function editorZip(){
  const status = root.querySelector("#g-status"), list = sets();
  try {
    const JSZip = await loadZip(), z = new JSZip(), C = st.campaigns;
    const csv = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
    const pad = (xs, n) => [...xs, ...Array(Math.max(0, n - xs.length)).fill("")].slice(0, n);
    const rsa = [["Campaign", "Ad group", "Ad type", ...Array.from({length: 15}, (_, i) => `Headline ${i + 1}`), ...Array.from({length: 4}, (_, i) => `Description ${i + 1}`), "Path 1", "Path 2", "Final URL"]];
    const pmax = [["Campaign", "Asset group", ...Array.from({length: 15}, (_, i) => `Headline ${i + 1}`), ...Array.from({length: 5}, (_, i) => `Long headline ${i + 1}`), ...Array.from({length: 5}, (_, i) => `Description ${i + 1}`), "Business name", "Final URL"]];
    const dg = [["Campaign", "Ad group", ...Array.from({length: 5}, (_, i) => `Headline ${i + 1}`), ...Array.from({length: 5}, (_, i) => `Description ${i + 1}`), "Business name", "Final URL"]];
    const site = [["Campaign", "Ad group", "Sitelink text", "Description line 1", "Description line 2", "Final URL"]], call = [["Campaign", "Ad group", "Callout text"]];
    const text = [`Google Ads copy, prices as checked ${shortDate(today)}.` + (useBy() ? ` Copy with a was/now price: stop using by ${shortDate(useBy())}.` : ""), ""];
    for (const x of list) {
      const s = setOf(x), url = urlOf(x), clean = xs => xs.map(v => String(v).trim()).filter(Boolean);
      rsa.push([C.search, x.group, "Responsive search ad", ...pad(clean(s.rsa.headlines), 15), ...pad(clean(s.rsa.descriptions), 4), s.rsa.path1, s.rsa.path2, url]);
      pmax.push([C.pmax, x.group, ...pad(clean(s.pmax.headlines), 15), ...pad(clean(s.pmax.longHeadlines), 5), ...pad(clean(s.pmax.descriptions), 5), BUSINESS, url]);
      dg.push([C.dg, x.group, ...pad(clean(s.dg.headlines), 5), ...pad(clean(s.dg.descriptions), 5), BUSINESS, url]);
      s.sitelinks.forEach(l => l.text && site.push([C.search, x.group, l.text, l.d1, l.d2, l.url]));
      clean(s.callouts).forEach(c => call.push([C.search, x.group, c]));
      text.push(`== ${x.name}`, `Final URL: ${url}`, "", "SEARCH HEADLINES", ...clean(s.rsa.headlines), "", "SEARCH DESCRIPTIONS", ...clean(s.rsa.descriptions), "",
        `PATH: /${s.rsa.path1}/${s.rsa.path2}`, "", "PERFORMANCE MAX HEADLINES", ...clean(s.pmax.headlines), "", "LONG HEADLINES", ...clean(s.pmax.longHeadlines), "",
        "PERFORMANCE MAX DESCRIPTIONS", ...clean(s.pmax.descriptions), "", "DEMAND GEN HEADLINES", ...clean(s.dg.headlines), "", "DEMAND GEN DESCRIPTIONS", ...clean(s.dg.descriptions), "",
        "SITELINKS", ...s.sitelinks.map(l => `${l.text} | ${l.d1} | ${l.d2} | ${l.url}`), "", "CALLOUTS", ...clean(s.callouts), "", "");
    }
    z.file("search_ads.csv", csv(rsa)); z.file("performance_max_asset_groups.csv", csv(pmax)); z.file("demand_gen_ads.csv", csv(dg));
    z.file("sitelinks.csv", csv(site)); z.file("callouts.csv", csv(call)); z.file("ad_copy.txt", text.join("\n"));
    z.file("HOW_TO_IMPORT.md", [`# Importing into Google Ads Editor${FR ? " (France: use the Ambassador Croisières account; the copy is in French)" : ""}`, ``,
      `1. Open Google Ads Editor and download the latest changes for the account.`,
      `2. Account → Import → From file, and choose one CSV at a time (search_ads.csv, performance_max_asset_groups.csv, demand_gen_ads.csv, sitelinks.csv, callouts.csv).`,
      `3. Editor shows a preview: check the campaign and ad group names match yours (campaign names are set on the tracker's Ad copy tab), then Finish and review.`,
      `4. Review the new ads in Editor, then Post. Nothing has been sent to Google Ads by the tracker.`, ``,
      `Prices are as checked ${shortDate(today)}: if a price changes, update the ads. Every line is within Google's character limits.`,
      `Performance Max asset groups also need images: use the Images tab's zip.`].join("\n"));
    const blob = await z.generateAsync({type: "blob"});
    download(URL.createObjectURL(blob), `google-ads-copy_${FR ? "fr_" : ""}${st.items.map(x => x.id).slice(0, 3).join("-")}${st.items.length > 3 ? "-etc" : ""}_${today}.zip`);
    status.textContent = `Downloaded the copy for ${list.length} set${list.length === 1 ? "" : "s"}.`;
  } catch(e) { status.textContent = `The download couldn't be made: ${e.message}`; }
}

// ---------- feeds (part 3, download only) ----------
// The remarketing feed lists every sailing on sale; the customiser values are for the chosen sailings, one ad group
// each, named as the Ad copy tab's "For each sailing" ad groups so they land on the same ad groups in Google Ads.
const feedPhoto = s => [pickPhoto(s), ...s.photos].find(u => /^https?:\/\//.test(u) && !CAMPAIGN.test(u) && !/logo/i.test(u)) || (/^https?:/.test(s.image) ? s.image : "");
function feedSailing(id){
  const s = sailing(id), lead = st.feedSale && !FR ? claims(id).find(c => c.key === "lead") : null;
  return {id, fr: FR, title: s.title, ship: s.r.ship, port: s.r.port, fly: s.fly, nights: s.r.nights, departure_date: s.r.departure_date,
          // France: the site's own photo (Google fetches it itself, so the browser-only copies aren't needed)
          price: s.price, link: s.link, image: FR ? s.r.image_link : feedPhoto(s), promos: s.k.promos || [], wasnow: lead ? {was: lead.was, now: lead.now, ends: lead.ends} : null};
}
function feedRows(){
  return live().filter(([, r]) => r.link).sort((a, b) => a[1].departure_date.localeCompare(b[1].departure_date) || a[0].localeCompare(b[0]))
    .map(([id]) => { const f = feedSailing(id); return {f, row: feedRow(f)}; });
}
const saleEnds = rows => rows.map(x => x.f.wasnow && x.f.wasnow.ends).filter(Boolean).sort()[0] || "";
const custRows = () => st.items.map(it => { const f = feedSailing(it.id); return {id: it.id, group: `${it.id} ${f.title}`.slice(0, 120), row: customiserRow(f)}; });

function feedSettings(){
  if (FR) return cs.section("g-feedset", "Feed settings", "from prices only", `
    <p class="sub">No was/now for France: every sailing shows its from price ("Dès 679 €/pers.").</p>
    <span class="ac-lab">Ad customisers</span>
    <p class="sub">Values are made for the sailings added above, one ad group each, named as on the Ad copy tab ("For each sailing"), in the Search campaign "${esc(st.campaigns.search)}" (change it on the Ad copy tab).</p>`);
  return cs.section("g-feedset", "Feed settings", st.feedSale ? "was/now sale prices included" : "from prices only", `
    <label class="ac-check"><input type="checkbox" id="g-feedsale"${st.feedSale ? " checked" : ""}> Include was/now sale prices <span class="sub">(only sailings with a was/now claim live today, with the claim's own figures)</span></label>
    <p class="sub">Without this, every sailing shows its from price. With it, a sailing with a live claim shows "Was £X" and the sale price "Now £Y": upload a fresh feed before the claim ends.</p>
    <span class="ac-lab">Ad customisers</span>
    <p class="sub">Values are made for the sailings added above, one ad group each, named as on the Ad copy tab ("For each sailing"), in the Search campaign "${esc(st.campaigns.search)}" (change it on the Ad copy tab).</p>`);
}

const table = (cols, rows) => `<div class="tablewrap"><table class="ptable g-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

function feedsMain(){
  const rows = feedRows(), ends = saleEnds(rows), sale = rows.filter(x => x.f.wasnow).length, noImg = rows.filter(x => !x.row["Image URL"]).length;
  const cust = custRows(), lines = customiserLines(cust.map(x => x.row), FR);
  return `${note ? `<p class="ac-note">${esc(note)}</p>` : ""}
    <p class="sub">Nothing is sent to Google Ads: download the files and upload them in Google Ads. Prices are as checked ${shortDate(today)}; prices change, so upload a fresh copy regularly (at least weekly, and whenever prices move).</p>
    <div class="ac-block"><h3>Dynamic remarketing feed</h3>
      <p class="sub">${FR ? "France: in French and euros, for the Ambassador Croisières Google Ads account. " : ""}Every sailing on sale (${rows.length}) as a Google Ads "Custom" feed, for dynamic remarketing ads that show people the sailings they looked at. ID = cruise code: the website's Google tag must send the same IDs (dynx_itemid), so check that with whoever looks after the tag before using it. Title, subtitle and description are kept to ${TEXT_MAX} characters, as Google recommends.${sale ? ` <b>${sale} sailing${sale === 1 ? " has a" : "s have"} was/now sale price: upload a fresh feed by ${shortDate(ends)}.</b>` : ""}${noImg ? ` ${noImg} sailing${noImg === 1 ? " has" : "s have"} no usable photo.` : ""}</p>
      <div class="ac-actions"><button type="button" class="btn" id="g-feed"${rows.length ? "" : " disabled"}>Download feed (CSV)</button><span class="sub" id="g-feedst" aria-live="polite"></span></div>
      ${table(FEED_COLUMNS.filter(c => c !== "Contextual keywords" && c !== "Image URL" && c !== "Final URL"), rows.slice(0, 8).map(x => x.row))}
      ${rows.length > 8 ? `<p class="sub">First 8 of ${rows.length} shown; the CSV has them all, with image, page link and keywords.</p>` : ""}
    </div>
    <div class="ac-block"><h3>Ad customiser values</h3>
      ${cust.length ? `<p class="sub">One row per ad group, so one responsive search ad can show each sailing's own price, nights, date, port, ship and offer. When prices change, upload new values instead of rewriting the ads.</p>
      <div class="ac-actions"><button type="button" class="btn" id="g-cust">Download customiser files (zip)</button><span class="sub" id="g-custst" aria-live="polite"></span></div>
      ${table(["Ad group", ...ATTRIBUTES.map(a => a[0])], cust.map(x => ({"Ad group": x.group, ...x.row})))}
      <span class="ac-lab">Lines to use in the ads <span class="sub">(each fits Google's limit with every ad group's values)</span></span>
      ${lines.length ? `<ul class="g-cust">${lines.map((l, i) => `<li><span class="sub">${l.kind}, up to ${l.longest} of ${l.max}</span> <code>${esc(l.text)}</code> <button type="button" class="linkbtn" data-custcopy="${i}">Copy</button><br><span class="sub">e.g. ${esc(l.example)}</span></li>`).join("")}</ul>`
        : `<p class="sub">None of the lines fit every ad group's values.</p>`}`
      : `<p class="sub">Add sailings on the left to make customiser values for their ad groups.</p>`}
    </div>`;
}

function wireFeeds(){
  const $ = q => root.querySelector(q);
  $("#g-feedsale") && $("#g-feedsale").addEventListener("change", e => { st.feedSale = e.target.checked; save(); draw(); });
  $("#g-feed") && $("#g-feed").addEventListener("click", () => {
    const rows = feedRows();
    const csv = "﻿" + [FEED_COLUMNS, ...rows.map(x => FEED_COLUMNS.map(c => x.row[c]))].map(r => r.map(csvCell).join(",")).join("\r\n");
    download(URL.createObjectURL(new Blob([csv], {type: "text/csv"})), `remarketing_feed_${FR ? "fr_" : ""}${today}.csv`);
    const ends = saleEnds(rows);
    $("#g-feedst").textContent = `Downloaded ${rows.length} sailings.${ends ? ` Sale prices: upload a fresh feed by ${shortDate(ends)}.` : ""}`;
  });
  const lines = customiserLines(custRows().map(x => x.row), FR);
  root.querySelectorAll("[data-custcopy]").forEach(b => b.addEventListener("click", async () => {
    const t = lines[+b.dataset.custcopy].text;
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1500); } catch(e) { prompt("Copy this line", t); }
  }));
  $("#g-cust") && $("#g-cust").addEventListener("click", async () => {
    const status = $("#g-custst");
    try {
      const JSZip = await loadZip(), z = new JSZip(), cust = custRows(), csv = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
      z.file("customizer_attributes.csv", csv([["Attribute", "Data type", "What it holds"], ...ATTRIBUTES.map(([n, w]) => [n, "Text", w])]));
      z.file("customizer_values.csv", csv([["Campaign", "Ad group", ...ATTRIBUTES.map(a => `Customizer:${a[0]}`)],
        ...cust.map(x => [st.campaigns.search, x.group, ...ATTRIBUTES.map(a => x.row[a[0]])])]));
      z.file("HOW_TO_USE.md", [`# Ad customisers`, ``, `Made on the Sailing price watch tracker. Prices as checked ${shortDate(today)}. Nothing has been sent to Google Ads.`, ``,
        `1. Once only: Google Ads → Tools → Shared library → Business data → Ad customizer attributes → +, and create each attribute in`,
        `   customizer_attributes.csv as type Text, with exactly that name.`,
        `2. Tools → Bulk actions → Uploads → + → choose customizer_values.csv. Use Preview and check the campaign and ad group names`,
        `   match yours (they follow the Ad copy tab's "For each sailing" ad groups), then Apply. If Google asks for its own template,`,
        `   download it from the same page and copy these columns across.`,
        `3. In each responsive search ad, use the lines below (type { in the headline box and pick Ad customizer, or paste them).`, ``,
        ...customiserLines(cust.map(x => x.row), FR).map(l => `- ${l.kind}: ${l.text}  (e.g. "${l.example}")`), ``,
        `When prices change, upload a new customizer_values.csv (step 2): the ads update without being edited.`,
        `Values with a price are only right while the price is.`].join("\n"));
      const blob = await z.generateAsync({type: "blob"});
      download(URL.createObjectURL(blob), `google-ads-customisers_${FR ? "fr_" : ""}${today}.zip`);
      status.textContent = `Downloaded values for ${cust.length} ad group${cust.length === 1 ? "" : "s"}.`;
    } catch(e) { status.textContent = `The download couldn't be made: ${e.message}`; }
  });
}
