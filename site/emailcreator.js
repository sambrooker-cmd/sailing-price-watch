// Email creator (Sam, 13 Oct 2026): pick sailings, choose the header, words, photos and offer badges, and get
// a marketing email in the layout of Ambassador's HubSpot emails (Sam's 10 Oct 2026 solo email): logo and
// phone, links, a header picture with a headline, intro and button, sailings as 3-across tiles or full-width,
// then the small print. Images (logo, header, sailing pictures with badges and captions) are made in the
// browser; "Make email" stores them in Storage through the emailImages function (allowlist checked) and gives
// standard email HTML to copy or download. Nothing is sent to anyone.
// Prices, dates, ships and offers come from the tracker's saved data and can't be typed in. Each sailing's
// "From" price can be twin or solo, cheapest cabin or a chosen grade (Sam, 13 Oct 2026, as Email cards).
// Was/now only from a live claim (tracker.py, twin only), with its own figures, and the email says until
// when it may be sent. "Lower fares" offers never reach the badges (cards_sync adkit).
// HubSpot specifics (template, unsubscribe token, UTM) are left for later (Sam).
import {cropUrl, frMoney, frDate} from "./adcards.js?v=__BUILD__";
import {suggest as suggestUK} from "./adcopy.js?v=__BUILD__";
import {suggest as suggestFR} from "./adcopy_fr.js?v=__BUILD__";
// France (Sam, 14 Oct 2026, stage 3): mount(…, {market: "fr"}) makes Ambassador Croisières emails: French logo, phone
// (0 801 34 22 22), links and small print, euros, French cabin grades and dates, French suggestions; no Nectar,
// Trustpilot or was/now; links to the sailing's page. French emails are kept apart: own browser draft, "market": "fr"
// in the shared saved list, #emailfr= links. The default small print has no company details: check them with Sam.
let FR = false;
import * as claude from "./drafts.js?v=__BUILD__";
import * as cs from "./sections.js?v=__BUILD__";
import {openSaved, sharedStore} from "./saved.js?v=__BUILD__";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => FR ? frMoney(v) : "£" + Math.round(v).toLocaleString("en-GB");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const shortDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
let GRADE = {inside: "Inside", ocean_view: "Ocean view", balcony: "Balcony", suite: "Suite"};
const GRADE_FR = {inside: "Intérieure", obstructed: "Vue mer obstruée", ocean_view: "Vue mer", promenade: "Terrasse promenade", balcony: "Balcon", suite: "Suite", grand_suite: "Grande suite"};
let SITE = "https://www.ambassadorcruiseline.com/";
const SITE_FR = "https://www.ambassadorcroisieres.fr/";
const FN = "https://us-central1-promotions-planner.cloudfunctions.net/emailImages";
let KEY = "spw-email-draft";        // the email being worked on (this browser; "-fr" for France)
let DRAFTS = "spw-email-drafts";  // named saved emails from before the shared list (this browser): {id: {name, saved_at, email}}
let store = null;                    // saved emails, shared by the team (saved.js sharedStore, Sam 13 Oct 2026)
const MAX = 12;
let NAV = [["Find a Cruise", SITE + "search/"], ["Last-Minute Deals", SITE + "deals/late-deals/"], ["Our Ships", SITE + "our-ships/"], ["Order a Brochure", SITE + "brochures/"]];
const NAV_FR = [["Nos croisières", SITE_FR + "croisieres"], ["Nos offres", SITE_FR + "offres"], ["Vie à bord", SITE_FR + "vie-a-bord"], ["Brochure", SITE_FR + "brochure"]];
const LEGAL_FR = "© 2026 Ambassador Croisières. Appel gratuit au 0 801 34 22 22, du lundi au vendredi de 9h à 18h30 et le samedi de 9h30 à 17h.";
let LEGAL = "Calls to 03 numbers cost no more than calls to geographic numbers (01 or 02) and are included in inclusive minutes from landlines and mobiles.\n" +
  "© 2026. Ambassador Cruise Holidays Limited is a company registered in England and Wales. Registered number: 13299365.\n" +
  "Ambassador Cruise Line, Gateway House, Stonehouse Lane, Purfleet, Essex RM19 1NS";
const COL = {allium: "#6B207D", palatyn: "#380843", pearl: "#F1ECE7", amber: "#F68C4E", ink: "#1B1220", muted: "#5E5465"};
// Image sizes, at twice the size they show in the email (sharp on phones and retina screens)
const IMG = {logo: [442, 96], hero: [1200, 630], tile: [376, 320], wide: [1120, 430]};

let S, CAB, KIT, ID, root, today, LOGO_SVG = "";
let em = fresh(), sel = 0, note = "", made = null, previewMode = "desktop", draftId = null;
const baked = new Map();   // image key -> data URL (preview and upload)

function fresh(){
  if (FR) return {subject: "", preheader: "", phone: "0 801 34 22 22", market: "fr",
          hero: {photo: "", headline: "", sub: ""}, intro: "", cta: "Trouvez votre croisière", ctaLink: SITE_FR + "croisieres",
          items: [], terms: SITE_FR + "offres", legal: LEGAL_FR, unsub: "",
          nectar: {on: false, pos: "intro", file: ""}, tp: {on: false, pos: "footer"}, allBadges: false};
  return {subject: "", preheader: "", phone: "0333 920 1164",
          hero: {photo: "", headline: "", sub: ""}, intro: "", cta: "Discover more", ctaLink: SITE,
          items: [], terms: SITE + "deals/cruise-offers/", legal: LEGAL, unsub: "",
          nectar: {on: false, pos: "intro", file: ""}, tp: {on: false, pos: "footer"}, allBadges: false};
}
// Optional strips (Sam, 13 Oct 2026), each placed under the header, after the intro or above the small print.
// Trustpilot: Trustpilot's own email widget (the code Sam sent), whose images Trustpilot keeps up to date,
// so the score and review count are always current. Nectar: Sam's banner artwork, listed in
// site/email/nectar.json {"as_of", "images": [{file, label}]}; until it exists the tick box waits for it.
const PLACES = {header: "Under the header picture", intro: "After the intro", footer: "Above the small print"};
const TP_LINK = "https://www.trustpilot.com/review/ambassadorcruiseline.com?utm_medium=Trustbox&utm_source=EmailNewsletter1";
const TP_IMG = "https://emailsignature.trustpilot.com/newsletter/en-US/1/620cf18be974268ffb275208/";
let NECTAR = null;   // {images: [{file, label, w, h}]} once the artwork is in site/email/
async function loadNectar(){
  try {
    const r = await fetch("email/nectar.json", {cache: "no-store"}); if (!r.ok) return;
    const j = await r.json();
    await Promise.all((j.images || []).map(x => new Promise(ok => {
      const im = new Image(); im.onload = () => { x.w = im.naturalWidth; x.h = im.naturalHeight; ok(); }; im.onerror = ok; im.src = "email/" + x.file;
    })));
    j.images = (j.images || []).filter(x => x.w); if (j.images.length) NECTAR = j;
  } catch(e){}
}

export async function mount(el, ctx){
  FR = ctx.market === "fr";
  if (FR) { KEY = "spw-email-draft-fr"; DRAFTS = "spw-email-drafts-fr"; GRADE = GRADE_FR; SITE = SITE_FR; NAV = NAV_FR; em = fresh(); }
  else await loadNectar();   // Nectar is UK only
  root = el; S = ctx.state; CAB = ctx.cabins || {}; KIT = (ctx.adkit && ctx.adkit.sailings) || {}; ID = ctx.idToken || null;
  today = S.updated;
  const sym = document.getElementById("amb-logo");
  if (FR) LOGO_SVG = await (await fetch("logo-fr.svg")).text();   // the colour Ambassador Croisières logo
  else if (sym) LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sym.getAttribute("viewBox")}" style="--lp:${COL.allium};--lc:#009165">${sym.innerHTML}</svg>`;
  // The saved list loads in the background (it can take a few seconds when its function has been idle): the page
  // draws at once and the saved bar says "Loading saved emails…" until it arrives (15 Oct 2026)
  store = sharedStore({kind: "email", localKey: DRAFTS, field: "email", idToken: ID});
  store.load().then(() => { if (draftId && !store.all()[draftId]) { draftId = null; save(); } draw(); });
  // The email left open in this browser is brought up to date too, and says so (was/now rehearsal, 14 Oct 2026)
  try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && Array.isArray(d.items)) { const n = normalise(d); em = n.em; draftId = d._draft || null;
    if (n.msgs.length) { note = esc(`Since this email was last open: ${n.msgs.join(". ")}.`); save(); } } } catch(e){}
  if (ctx.shared) await openShared(ctx.shared); else draw();
}

// Bring a saved, shared or older email up to date with today's data, saying what had to change.
// Prices are never stored in an email: it always uses the tracker's latest saved prices.
function normalise(d){
  const out = {...fresh(), ...d, hero: {...fresh().hero, ...(d.hero || {})}, nectar: {...fresh().nectar, ...(d.nectar || {})}, tp: {...fresh().tp, ...(d.tp || {})}}, msgs = [];
  delete out._draft;
  const gone = (d.items || []).filter(it => !sailing(it.id)).map(it => it.id);
  if (gone.length) msgs.push(`${[...new Set(gone)].join(", ")} ${gone.length === 1 ? "is" : "are"} no longer on sale, so ${gone.length === 1 ? "it was" : "they were"} left out`);
  let ended = 0, offers = 0, cabins = 0;
  out.items = (d.items || []).filter(it => sailing(it.id)).map(it => {
    it = {layout: "tile", design: "standard", photo: sailing(it.id).image, caption: "", badges: [], ...it};
    if (it.design !== "standard" && !claims(it.id).some(c => "wasnow:" + c.key === it.design)) { it.design = "standard"; ended++; }
    const f = fareOf(it);
    if ((it.fare === "solo" && f.fare !== "solo") || (it.grade && !f.grade)) { cabins++; it.fare = f.fare; it.grade = f.grade; }
    const live = sailing(it.id).k.promos || [], kept = it.badges.filter(b => live.includes(b));
    offers += it.badges.length - kept.length; it.badges = kept;
    return it;
  });
  if (ended) msgs.push(`${ended} was/now price${ended === 1 ? "" : "s"} switched to "From" because the price-reduction claim has ended`);
  if (cabins) msgs.push(`${cabins} cabin choice${cabins === 1 ? " is" : "s are"} no longer on sale, so ${cabins === 1 ? "it uses" : "they use"} the cheapest available`);
  if (offers) msgs.push(`${offers} offer badge${offers === 1 ? " was" : "s were"} removed because the offer has ended or changed`);
  // The same findings in a few words, shown on the item in the Saved list before it's opened (Sam, 14 Oct 2026)
  const issues = [gone.length && `${gone.length} sailing${gone.length === 1 ? "" : "s"} no longer on sale`,
    ended && `was/now claim ended on ${ended} sailing${ended === 1 ? "" : "s"}`, cabins && `${cabins} cabin choice${cabins === 1 ? "" : "s"} sold out`,
    offers && `${offers} offer badge${offers === 1 ? "" : "s"} ended`].filter(Boolean);
  return {em: out, msgs, issues};
}
function load(d, msg){
  const n = normalise(d); em = n.em; sel = 0; made = null;
  note = esc([msg, ...n.msgs].filter(Boolean).join(". ") + (n.msgs.length || msg ? "." : ""));
  save(); draw();
}

// ---------- saved emails (shared list; this browser only if it can't be reached) ----------
const drafts = () => store ? Object.fromEntries(Object.entries(store.all()).filter(([, d]) => ((d.email || {}).market === "fr") === FR)) : {};
const portable = () => JSON.parse(JSON.stringify(FR ? {...em, market: "fr"} : em));
async function saveDraft(asNew){
  const all = drafts();
  let id = asNew || (draftId && !store.mine(draftId)) ? null : draftId;   // someone else's: save your own copy
  let name = id && all[id] ? all[id].name : "";
  if (!id) {
    const first = em.items[0] && sailing(em.items[0].id);
    name = prompt(asNew ? "Name the copy" : "Name this email", em.subject || (first ? `${first.title}${em.items.length > 1 ? ` + ${em.items.length - 1} more` : ""}` : "New email"));
    if (!name) return;
  }
  try { draftId = await store.save(id, name, portable()); note = esc(`Saved "${name}"${store.shared ? "" : " in this browser"}.`); }
  catch(e) { note = esc(`Couldn't save: ${e.message}`); }
  save(); draw();
}
function draftsBlock(){
  if (!store || store.loading) return `<div class="ac-block"><p class="sub" style="margin:0">Loading saved emails…</p></div>`;
  const all = drafts(), ids = Object.keys(all);
  const cur = draftId && all[draftId], mine = cur && store.mine(draftId), oldHere = Object.keys(store ? store.localOnly() : {}).length;
  return `<div class="ac-block">
    <h3>${cur ? esc(cur.name) : "Unsaved email"}</h3>
    ${cur && !mine ? `<p class="sub" style="margin:0 0 6px">Saved by ${esc(cur.by)}. Save a copy to keep your own changes.</p>` : ""}
    <div class="ac-row">
      ${cur && !mine ? "" : `<button type="button" class="btn quiet sm" id="dr-save"${em.items.length ? "" : " disabled"}>${cur ? "Save" : "Save as…"}</button>`}
      ${cur ? `<button type="button" class="btn quiet sm" id="dr-saveas">Save a copy…</button>` : ""}
      <button type="button" class="btn quiet sm" id="dr-link"${em.items.length ? "" : " disabled"}>Copy link</button>
      <button type="button" class="btn quiet sm" id="dr-new">New email</button>
    </div>
    ${ids.length ? `<button type="button" class="btn quiet sm sv-open" id="dr-browse">Saved emails (${ids.length})${(n => n ? ` · ${n} need${n === 1 ? "s" : ""} updating` : "")(ids.filter(id => normalise(all[id].email).issues.length).length)}</button>` : ""}
    ${store && store.problem ? `<p class="ac-note">${esc(store.problem)}</p>` : ""}
    ${oldHere ? `<p class="sub" style="margin:8px 0 0">${oldHere} email${oldHere === 1 ? " is" : "s are"} saved in this browser only. <button type="button" class="linkbtn" id="dr-move">Move ${oldHere === 1 ? "it" : "them"} to the shared list</button></p>` : ""}
  </div>`;
}

// ---------- shareable link: the whole email (no prices) squeezed into the link, after #email= ----------
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function pack(obj){
  const z = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64u(new Uint8Array(await new Response(z).arrayBuffer()));
}
async function unpack(s){
  const z = new Blob([unb64u(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(z).text());
}
async function copyLink(){
  const url = `${location.origin}${location.pathname}#${FR ? "emailfr" : "email"}=${await pack({v: 1, email: portable()})}`;
  try { await navigator.clipboard.writeText(url); note = "Link copied. Anyone on the tracker's allowlist can open it in their own Email creator; prices are always the latest."; }
  catch(e) { prompt("Copy this link", url); note = ""; }
  draw();
}
export async function openShared(s){
  try {
    const d = await unpack(s);
    history.replaceState(null, "", location.pathname + location.search);
    draftId = null;
    load(d.email || d, "Opened a shared email. It's now your own copy: changes don't affect the sender's");
  } catch(e) { note = "That email link couldn't be read. It may have been cut short when it was copied."; draw(); }
}

// ---------- data (the tracker's saved state only) ----------
const live = () => Object.entries(S.sailings || {}).filter(([, r]) => !r.removed && r.departure_date > today);
function sailing(id){
  const r = (S.sailings || {})[id];
  if (!r || r.removed || !(r.departure_date > today)) return null;
  const k = KIT[id] || {}, fly = r.flight_from;
  return {id, r, k, fly, title: fly ? r.base_title : r.title, price: r.segments[r.segments.length - 1].p, link: r.link || SITE,
          image: k.image || r.image_link, photos: [k.image || r.image_link, ...(k.photos || [])].filter((u, i, a) => u && a.indexOf(u) === i)};
}
// Was/now claims valid today (tracker.py claim_for), as in the Ad creator
function claims(id){
  const s = sailing(id); if (!s) return [];
  const out = [], c = s.r.claim;
  if (c && c.eligible && c.ends >= today && c.now === s.price)
    out.push({key: "lead", label: "Lead price", was: c.was, now: c.now, ends: c.ends, since: c.since, grade: s.k.lead_grade || null});
  for (const [k, cc] of Object.entries((CAB[id] || {}).cabin_claims || {}))
    if (k.startsWith("twin.") && cc.eligible && cc.ends >= today)
      out.push({key: k, label: GRADE[k.slice(5)] + " cabins", was: cc.was, now: cc.now, ends: cc.ends, since: cc.since, grade: k.slice(5)});
  return out;
}
const claimOf = it => it.design.startsWith("wasnow:") ? claims(it.id).find(c => "wasnow:" + c.key === it.design) : null;
// Fare and cabin for a "From" price (Sam, 13 Oct 2026, as Email cards): twin or solo, the cheapest cabin or a
// chosen grade, from the tracker's saved per-grade prices (state/cabins.json "twin.<grade>" / "solo.<grade>",
// latest segment, not sold out). The twin "cheapest" is the sailing's own lead price.
function onSale(id, fare){   // {grade: price} on sale now
  const out = {};
  for (const [k, c] of Object.entries((CAB[id] || {}).cabins || {})) {
    const [f, g] = k.split(".");
    if (f === fare && GRADE[g] && !c.out && c.seg && c.seg.length) out[g] = c.seg[c.seg.length - 1].p;
  }
  return out;
}
const linkOf = it => claimOf(it) ? sailing(it.id).link : fareOf(it).link;   // solo fares link with ?solo=true (UK)
function fareOf(it){   // {fare, grade, price, label, link} for what's chosen, falling back to the cheapest
  const s = sailing(it.id), fare = it.fare === "solo" && Object.keys(onSale(it.id, "solo")).length ? "solo" : "twin";
  const grades = onSale(it.id, fare), grade = it.grade && grades[it.grade] != null ? it.grade : "";
  const price = grade ? grades[grade] : fare === "twin" ? s.price : Math.min(...Object.values(grades));
  if (FR) return {fare, grade, price, link: s.link, label: fare === "solo" ? `Solo${grade ? " " + GRADE[grade].toLowerCase() : ""} à partir de ${money(price)}`
                                                                  : `${grade ? GRADE[grade] + " à" : "À"} partir de ${money(price)}/pers.`};
  const label = fare === "solo" ? `Solo ${grade ? GRADE[grade].toLowerCase() + " " : "pricing "}from ${money(price)}`
                                : `${grade ? GRADE[grade] + " from" : "From"} ${money(price)}pp`;
  return {fare, grade, price, label, link: s.link + (fare === "solo" ? (s.link.includes("?") ? "&" : "?") + "solo=true" : "")};
}
// Offer badges on a sailing's picture: its own choice, or with "Offer badges on every sailing" ticked
// (Sam, 13 Oct 2026, as in the Friday round-up emails) its first 2 live offers, kept up to date.
const badgesOf = it => em.allBadges ? (sailing(it.id).k.promos || []).slice(0, 2) : it.badges;
const badgeText = line => line.split(" · ")[0];
// "ends 13 Oct" in an ad kit promotion line → ISO date (this year or next), to warn before it lapses
function promoEnds(line){
  const m = line.match(/ends (\d{1,2}) (\w{3})/); if (!m) return null;
  const mi = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[2]); if (mi < 0) return null;
  let y = +today.slice(0, 4); const iso = (yy) => `${yy}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (iso(y) < today) y++;
  return iso(y);
}
// A place name from a photo's file name, offered as a caption to check (e.g. ".../bridgetown-barbados_....jpg")
function captionHint(url){
  if ((url || "").startsWith("/ships/")) return "";   // the ship photo: no place name to suggest
  if (FR) return Object.assign({}, ...Object.values(KIT).map(k => k.captions || {}))[url] || "";   // France: the page's own caption
  const f = decodeURIComponent((url || "").split("/").pop() || "").replace(/\.\w+$/, "");
  const junk = /^(\d+|\d+x\d+|shutterstock|istock|getty|adobe|stock|selected|edited|dsc\d*|img\d*|new|to|use|amb|xxx|cotw|final|v\d+|copy|web|hero|header|crop(ped)?|at|sunset|aerial|view|\d+-\d+-\d+)$/i;
  const words = f.split(/[\s_\-]+/).filter(w => w && !junk.test(w) && !/\d/.test(w));
  if (!words.length || words.length > 5) return "";
  return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// Default picture for a sailing: a destination photo from its page rather than campaign artwork
// (Cruise of the Week roundels, Boom Radio and similar, as render_cards.py is_campaign), when there is one.
const CAMPAIGN = /cotw|dig-|carousel|boom-radio|weekender|back_to_|no-logo|renaissance|ambience|ambition|_ship|ship_/i;
function pickPhoto(s){
  if (!s.k.campaign && !CAMPAIGN.test(s.image)) return s.image;
  return s.photos.find(u => u !== s.image && !CAMPAIGN.test(u) && captionHint(u)) || s.photos.find(u => u !== s.image && !CAMPAIGN.test(u)) || s.image;
}

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({...em, _draft: draftId})); } catch(e){} };
function newItem(id){
  const s = sailing(id);
  return {id, layout: em.items.filter(x => x.layout === "tile").length % 3 === 0 && em.items.length >= 3 ? "wide" : "tile",
          design: "standard", fare: "twin", grade: "", photo: pickPhoto(s), caption: "", badges: []};
}
const sendBy = () => em.items.map(claimOf).filter(Boolean).map(c => c.ends).sort()[0] || "";

// ---------- images, made in the browser ----------
const FONT_CSS = [500, 600, 700].map(w =>
  `@font-face{font-family:'Quicksand';font-weight:${w};src:url(${location.origin}/fonts/quicksand-latin-${w}-normal.woff2) format('woff2')}`).join("");
const RUNTIME = `<script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js"><\/script>
<script>window.ready=async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r;})));};
window.toJpeg=q=>htmlToImage.toJpeg(document.getElementById('card'),{quality:q,pixelRatio:1,cacheBust:false,backgroundColor:'${COL.pearl}'});<\/script>`;
const dims = (kind, o) => IMG[kind] || [o.w, o.h];
function imageDoc(kind, o){
  const [w, h] = dims(kind, o);
  const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}*{margin:0;box-sizing:border-box}
    body{width:${w}px;height:${h}px;overflow:hidden;background:${COL.pearl}}#card{position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:Quicksand,sans-serif}
    .ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}</style>${RUNTIME}</head><body><div id="card">${body}</div></body></html>`;
  if (kind === "banner") return page(`<img class="ph" src="${location.origin}/email/${esc(o.file)}" style="object-fit:contain">`);
  if (kind === "logo") return page(`<div style="padding:4px 0">${LOGO_SVG.replace("<svg ", `<svg width="${w}" height="${h - 8}" `)}</div>`);
  // Header: the photo (with a soft shade when words go over it). The words themselves are live text in the
  // email, centred and responsive (Sam, 13 Oct 2026), not part of the picture.
  if (kind === "hero") return page(`<img class="ph" crossorigin="anonymous" src="${esc(cropUrl(o.photo, w, h))}">
    ${o.shade ? `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(20,10,25,.5),rgba(20,10,25,.22) 75%)"></div>` : ""}`);
  const f = kind === "tile" ? 1 : 1.25;   // badge and caption text size
  return page(`<img class="ph" crossorigin="anonymous" src="${esc(cropUrl(o.photo, w, h))}">
    <div style="position:absolute;top:${Math.round(h * .035)}px;right:0;display:flex;flex-direction:column;align-items:flex-end;gap:8px">
      ${(o.badges || []).map(b => `<div style="background:${COL.amber};color:#fff;font-weight:700;text-transform:uppercase;font-size:${Math.round(15 * f)}px;letter-spacing:.02em;padding:${Math.round(6 * f)}px ${Math.round(12 * f)}px">${esc(b)}</div>`).join("")}</div>
    ${o.caption ? `<div style="position:absolute;left:0;bottom:0;background:rgba(27,18,32,.86);color:#fff;font-weight:600;font-size:${Math.round(15 * f)}px;line-height:1;padding:${Math.round(6 * f)}px ${Math.round(22 * f)}px ${Math.round(6 * f)}px ${Math.round(12 * f)}px;clip-path:polygon(0 0,calc(100% - ${Math.round(27 * f * .364)}px) 0,100% 100%,0 100%)">${esc(o.caption)}</div>` : ""}`);
}
async function bake(kind, o, quality){
  const key = JSON.stringify([kind, o, quality]);
  if (baked.has(key)) return baked.get(key);
  const [w, h] = dims(kind, o), f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${w + 50}px;top:0;width:${w}px;height:${h}px;border:0`;
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = imageDoc(kind, o); });
    await f.contentWindow.ready();
    const url = await f.contentWindow.toJpeg(quality);
    baked.set(key, url);
    return url;
  } finally { f.remove(); }
}
// Every image the email needs: name → [kind, options]
function nectarArt(){
  if (!em.nectar.on || !NECTAR) return null;
  const x = NECTAR.images.find(i => i.file === em.nectar.file) || NECTAR.images[0];
  const w = Math.min(1200, x.w);
  return {file: x.file, w, h: Math.round(x.h * w / x.w)};
}
function images(){
  const out = {logo: ["logo", {}]};
  const n = nectarArt(); if (n) out.nectar = ["banner", n];
  if (em.hero.photo) out.hero = ["hero", {photo: em.hero.photo, shade: !!(em.hero.headline || em.hero.sub)}];
  em.items.forEach((it, i) => { out[`s${i + 1}_${it.id.toLowerCase()}`] = [it.layout, {photo: it.photo, caption: it.caption, badges: badgesOf(it).map(badgeText)}]; });
  return out;
}

// ---------- the email ----------
const F = "Quicksand,Arial,Helvetica,sans-serif";
// Taviraj, the secondary typeface added in Brand Guidelines v4.3: "mainly alternative body copy for the French market",
// never headings, 11pt (14.67px) minimum. French emails set the intro in it unless em.taviraj is false.
const SERIF = "Taviraj,Georgia,'Times New Roman',serif";
const bodyFont = () => FR && em.taviraj !== false ? SERIF : F;
// Typed links: web, email, phone or an email platform's {{token}} only. Anything else (e.g. "javascript:")
// is left out, here and in the preview (QA, 13 Oct 2026).
const safeUrl = u => { u = String(u || "").trim(); return /^(https?:\/\/|mailto:|tel:|\{\{)/i.test(u) ? u : ""; };
function button(text, href, big){
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>
    <td bgcolor="${COL.allium}" style="background:${COL.allium};border-radius:6px;mso-padding-alt:${big ? "12px 22px" : "10px 16px"}">
    <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:${big ? "12px 22px" : "10px 16px"};font-family:${F};font-size:${big ? 17 : 15}px;color:#ffffff;text-decoration:none;border-radius:6px">${esc(text)}</a></td></tr></table>`;
}
function sailingInfo(it, size){
  const s = sailing(it.id), c = claimOf(it);
  const price = c ? `<p style="margin:0 0 8px;font-family:${F};font-size:14px;color:${COL.ink}">${c.grade && c.key !== "lead" ? esc(GRADE[c.grade]) + " cabins: " : ""}was <s>${money(c.was)}</s></p>` : "";
  return `<p style="margin:14px 0 10px;font-family:${F};font-weight:700;font-size:${size}px;line-height:1.3;color:${COL.allium};text-transform:uppercase">${esc(s.title)}</p>
    <p style="margin:0 0 16px;font-family:${F};font-size:14px;line-height:1.45;color:${COL.ink}">${FR ? `${frDate(s.r.departure_date)}<br>${s.r.nights} nuits au départ de ${esc(String(s.r.port || "").split(",")[0].trim())}` : `${longDate(s.r.departure_date)}<br>${s.r.nights} nights departing ${esc(s.fly ? s.fly + " Airport" : s.r.port)}`}<br>${esc(s.r.ship)}</p>
    ${price}${button(c ? `Now ${money(c.now)}pp` : fareOf(it).label, linkOf(it))}`;
}
// Header picture as the cell's background with the words as live text on top, centred: readable and
// responsive on phones. Outlook on Windows ignores CSS backgrounds, so it gets the same picture in VML.
function heroRow(url){
  const h = em.hero.headline.trim(), sub = em.hero.sub.trim(), shadow = "text-shadow:0 2px 12px rgba(0,0,0,.55)";
  const words = h || sub ? `<div style="padding:0 30px;text-align:center">
      ${h ? `<p class="hero-h" style="margin:0;font-family:${F};font-weight:300;font-size:26px;line-height:1.25;letter-spacing:.14em;text-transform:uppercase;color:#ffffff;${shadow}">${esc(h)}</p>` : ""}
      ${sub ? `<p class="hero-s" style="margin:${h ? 10 : 0}px 0 0;font-family:${F};font-weight:500;font-size:18px;line-height:1.4;color:#ffffff;${shadow}">${esc(sub)}</p>` : ""}</div>` : "&nbsp;";
  return `<tr><td class="hero" background="${url}" bgcolor="${COL.palatyn}" width="600" height="315" valign="middle" align="center"
    style="background:${COL.palatyn} url('${url}') center center / cover no-repeat;height:315px;vertical-align:middle;text-align:center">
<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:450pt;height:236pt"><v:fill type="frame" src="${url}" color="${COL.palatyn}"/><v:textbox inset="0,0,0,0" style="v-text-anchor:middle"><![endif]-->
    ${words}
<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>`;
}
function strips(place, src){
  const out = [];
  if (src.nectar && em.nectar.pos === place)
    out.push(`<tr><td class="pad" align="center" style="padding:${place === "header" ? "20px" : "0"} 20px 28px"><img src="${src.nectar}" width="560" alt="Collect Nectar points when you book" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>`);
  if (em.tp.on && em.tp.pos === place) {
    const a = (file, h, alt) => `<a href="${esc(TP_LINK)}" target="_blank" style="text-decoration:none"><img src="${file}" border="0" height="${h}" alt="${alt}" style="max-height:${h}px;display:inline-block;vertical-align:middle"></a>`;
    out.push(`<tr><td class="pad" align="center" style="padding:${place === "header" ? "20px" : "0"} 20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" style="padding:6px 10px;text-align:center">${a(TP_IMG + "text1@2x.png", 18, "Human score")} &nbsp;&nbsp; ${a(TP_IMG + "stars@2x.png", 20, "Trustpilot Stars")} &nbsp;&nbsp; <span style="display:inline-block">${a(TP_IMG + "text2@2x.png", 18, "number of reviews")} &nbsp;&nbsp; ${a("https://emailsignature.trustpilot.com/brand/n/1/logo.png", 20, "Trustpilot Logo")}</span></td></tr></table></td></tr>`);
  }
  return out.join("\n");
}
function emailHtml(src){
  const rows = [];
  let tiles = [];
  const flush = () => {
    if (!tiles.length) return;
    // Three columns of 196 px across the 600 px email (188 px pictures, Sam: bigger tiles)
    rows.push(`<tr><td class="pad" style="padding:0 6px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${tiles.map(([it, name]) => `<td class="tile" width="196" valign="top" align="center" style="padding:0 4px">
        <a href="${esc(linkOf(it))}" target="_blank"><img src="${src[name]}" width="188" height="160" alt="${esc(sailing(it.id).title)}" style="display:block;width:188px;height:auto;border:0"></a>
        ${sailingInfo(it, 15)}</td>`).join("")}</tr></table></td></tr>`);
    tiles = [];
  };
  em.items.forEach((it, i) => {
    const name = `s${i + 1}_${it.id.toLowerCase()}`;
    if (it.layout === "tile") { tiles.push([it, name]); if (tiles.length === 3) flush(); return; }
    flush();
    rows.push(`<tr><td class="pad wide" align="center" style="padding:0 20px 32px">
      <a href="${esc(linkOf(it))}" target="_blank"><img src="${src[name]}" width="560" alt="${esc(sailing(it.id).title)}" style="display:block;width:100%;max-width:560px;height:auto;border:0"></a>
      ${sailingInfo(it, 16)}</td></tr>`);
  });
  flush();
  const wn = em.items.map(it => [it, claimOf(it)]).filter(x => x[1]);
  const solo = em.items.some(it => !claimOf(it) && fareOf(it).fare === "solo"), twin = em.items.some(it => claimOf(it) || fareOf(it).fare === "twin");
  const basis = [twin ? "per person, based on two sharing" : "", solo ? `${twin ? "solo prices are " : ""}for one guest travelling solo` : ""].filter(Boolean).join("; ");
  const basisFr = [twin ? "par personne, base deux personnes" : "", solo ? `${twin ? "prix solo " : ""}pour une personne voyageant seule` : ""].filter(Boolean).join(" ; ");
  const small = FR ? [`Prix ${basisFr}, relevés le ${frDate(today)}, sous réserve de disponibilité.${safeUrl(em.terms) ? ` Conditions des offres <a href="${esc(safeUrl(em.terms))}" target="_blank" style="color:${COL.allium}">ici</a>.` : ""}`,
    ...em.legal.split(/\n+/).filter(Boolean).map(esc)] : [`Prices are ${basis}, as checked ${shortDate(today)}, and subject to availability.${safeUrl(em.terms) ? ` View full offer T&amp;Cs <a href="${esc(safeUrl(em.terms))}" target="_blank" style="color:${COL.allium}">here</a>.` : ""}`,
    ...(src.nectar ? ["*Nectar points: terms and conditions apply."] : []),
    ...wn.map(([it, c]) => `Was price: ${esc(sailing(it.id).title)}${c.key !== "lead" ? ` (${esc(GRADE[c.grade].toLowerCase())} cabins)` : ""} was on sale at ${money(c.was)} for at least 28 days before it was reduced to ${money(c.now)} on ${shortDate(c.since)}.`),
    ...em.legal.split(/\n+/).filter(Boolean).map(esc)];
  const unsub = safeUrl(em.unsub) || "UNSUBSCRIBE_LINK";
  return `<!DOCTYPE html>
<html lang="${FR ? "fr" : "en"}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting"><title>${esc(em.subject || (FR ? "Ambassador Croisières" : "Ambassador Cruise Line"))}</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300;500;600;700${bodyFont() === SERIF ? "&family=Taviraj:ital@0;1" : ""}&display=swap" rel="stylesheet"><!--<![endif]-->
<style>body{margin:0;padding:0;background:#ffffff}img{border:0;line-height:100%;outline:none;text-decoration:none}a{color:${COL.allium}}
@media only screen and (max-width:620px){.w600{width:100%!important}.pad{padding-left:16px!important;padding-right:16px!important}
.tile{display:block!important;width:100%!important;padding:0 0 28px!important}.tile img{width:100%!important;max-width:376px!important;margin:0 auto}
.hero{height:230px!important}.hero-h{font-size:18px!important;letter-spacing:.1em!important}.hero-s{font-size:15px!important}.logo img{width:170px!important;height:auto!important}.phone{font-size:18px!important}.nav{font-size:13px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(em.preheader)}&#8203;&zwnj;&#8203;&zwnj;&#8203;&zwnj;&#8203;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:16px 0">
<table role="presentation" class="w600" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;background:${COL.pearl}">
<tr><td class="pad" style="padding:22px 30px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td class="logo" valign="middle"><a href="${SITE}" target="_blank"><img src="${src.logo}" width="221" height="48" alt="${FR ? "Ambassador Croisières" : "Ambassador Cruise Line"}" style="display:block;width:221px;height:48px"></a></td>
  <td class="phone" align="right" valign="middle" style="font-family:${F};font-weight:700;font-size:24px;color:${COL.palatyn}"><a href="tel:${esc(em.phone.replace(/\s/g, ""))}" style="color:${COL.palatyn};text-decoration:none">${esc(em.phone)}</a></td>
</tr></table></td></tr>
<tr><td class="nav" align="center" style="padding:0 10px 18px;font-family:${F};font-weight:700;font-size:15px;color:${COL.palatyn}">${NAV.map(([t, u]) => `<a href="${u}" target="_blank" style="color:${COL.palatyn};text-decoration:none">${t}</a>`).join(" | ")}</td></tr>
${src.hero ? heroRow(src.hero) : ""}
${strips("header", src)}
${em.intro ? `<tr><td class="pad" align="center" style="padding:26px 50px 6px;font-family:${bodyFont()};font-size:16px;line-height:1.6;color:${COL.ink}">${em.intro.split(/\n+/).filter(Boolean).map(p => `<p style="margin:0 0 12px">${esc(p)}</p>`).join("")}</td></tr>` : ""}
${em.cta ? `<tr><td align="center" style="padding:8px 0 30px">${button(em.cta, safeUrl(em.ctaLink) || SITE, true)}</td></tr>` : `<tr><td style="padding:12px 0"></td></tr>`}
${strips("intro", src)}
${rows.join("\n")}
${strips("footer", src)}
<tr><td class="pad" style="padding:6px 48px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${COL.palatyn};font-size:0;line-height:0">&nbsp;</td></tr></table>
${small.map(t => `<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:${COL.muted};text-align:center">${t}</p>`).join("")}
<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:center"><a href="${esc(unsub)}" target="_blank" style="color:${COL.muted}">${FR ? "Gérer mes préférences" : "Manage preferences"}</a></p></td></tr>
</table></td></tr></table>
</body></html>`;
}

// ---------- page ----------
function suggestionsFor(){
  if (!em.items.length) return [];
  if (FR) return suggestFR(em.items.map(it => { const s = sailing(it.id);
      return {title: s.title, ship: s.r.ship, port: s.r.port, nights: s.r.nights, departure_date: s.r.departure_date, price: fareOf(it).fare === "twin" ? s.price : s.price, promos: badgesOf(it)}; }),
    em.items.length === 1 ? "single" : "carousel")
    .map(o => ({...o, text: o.text.replace(/\s*Prix par personne, base deux personnes, sous réserve de disponibilité\.$/, "")   // the small print says this
      .replace("Faites défiler et trouvez celle qui vous ressemble.", "Découvrez-les et trouvez celle qui vous ressemble.")}));
  return suggestUK(em.items.map(it => {
    const s = sailing(it.id), c = claimOf(it), n = parseInt(((s.k.nectar || "").match(/[\d,]+/) || ["0"])[0].replace(/,/g, ""), 10);
    return {title: s.title, ship: s.r.ship, port: s.r.port, fly: s.fly, nights: s.r.nights, departure_date: s.r.departure_date, price: s.price,
            promos: badgesOf(it), nectarPts: n, wasnow: c ? {was: c.was, now: c.now, grade: c.grade} : null};
  }), em.items.length === 1 ? "single" : "carousel")
    .map(o => ({...o, text: o.text.replace(/\s*Based on two sharing and subject to availability\.$/, "")   // the small print says this
      .replace("Swipe through and find the one that's calling you.", "Take a look and find the one that's calling you.")   // ad wording → email
      .replace(/Swipe to see all (\w+) sailings/, "Here are all $1 sailings")}));
}
let sugg = [];
const photoButton = (u, cur, attr) => `<button type="button" class="ac-ph${cur === u ? " on" : ""}" ${attr}="${esc(u)}" aria-label="Use this photo"><img src="${esc(cropUrl(u, 160, 160))}" alt="" loading="lazy"></button>`;
function photoPicker(cur, attr, list, key){   // two rows, "Show all N photos" for more (sections.js)
  const g = cs.photoGrid(key, list.map(u => photoButton(u, cur, attr)), list.indexOf(cur));
  return `<div class="ac-photos">${g.grid}</div>${g.more}`;
}
function itemEditor(){
  const it = em.items[sel]; if (!it) return "";
  const s = sailing(it.id), cl = claims(it.id), hint = captionHint(it.photo);
  const ends = badgesOf(it).map(b => [b, promoEnds(b)]).filter(([, d]) => d && d <= addDays(today, 3));
  return `<div class="ac-block">
    ${em.items.length > 1 ? `<div class="ac-tabs" role="tablist" aria-label="Sailing to edit">${em.items.map((x, i) =>
      `<button type="button" role="tab" class="ac-tab" data-tab="${i}" aria-selected="${i === sel}" tabindex="${i === sel ? 0 : -1}" title="${esc(sailing(x.id).title)}"><b>${i + 1}</b><span>${esc(sailing(x.id).title)}</span></button>`).join("")}</div>` : ""}
    <h3>Sailing ${sel + 1}: ${esc(s.title)}</h3>
    <div class="ac-row" role="group" aria-label="Layout"><span class="ac-lab">Layout</span>
      <button type="button" class="ac-seg" data-layout="tile" aria-pressed="${it.layout === "tile"}">Tile (3 across)</button>
      <button type="button" class="ac-seg" data-layout="wide" aria-pressed="${it.layout === "wide"}">Full width</button></div>
    <label class="ac-lab" for="em-design">Price</label>
    <select id="em-design"><option value="standard">${it.design === "standard" ? esc(fareOf(it).label) : `From ${money(s.price)}pp`}</option>${cl.map(c => `<option value="wasnow:${c.key}"${it.design === "wasnow:" + c.key ? " selected" : ""}>Was/now: ${esc(c.label)}, was ${money(c.was)} now ${money(c.now)} (send by ${shortDate(c.ends)})</option>`).join("")}</select>
    ${cl.length ? "" : `<p class="sub">${FR ? "No was/now for France: the email shows the \"from\" price." : "Was/now is only offered when this sailing has a live price-reduction claim."}</p>`}
    ${it.design === "standard" ? fareBlock(it) : ""}
    <span class="ac-lab">Photo</span>${photoPicker(it.photo, "data-photo", s.photos, "em-item")}
    <label class="ac-lab" for="em-caption">Location caption <span class="sub">(optional: check it matches the photo)</span></label>
    <input id="em-caption" value="${esc(it.caption)}" placeholder="e.g. Bridgetown, Barbados" maxlength="40">
    ${hint && hint !== it.caption ? `<button type="button" class="linkbtn" id="em-hint">Use "${esc(hint)}" (${FR ? "the photo's caption on the website" : "from the photo's file name"})</button>` : ""}
    <span class="ac-lab">Offer badges <span class="sub">(up to 2, as on the sailing's page)</span></span>
    ${(s.k.promos || []).map((p, i) => `<label class="ac-check"><input type="checkbox" data-badge="${i}"${badgesOf(it).includes(p) ? " checked" : ""}${em.allBadges ? " disabled" : ""}> ${esc(p)}</label>`).join("") || `<p class="sub">No offers on this sailing right now.</p>`}
    ${em.allBadges && (s.k.promos || []).length ? `<p class="sub">"Offer badges on every sailing" is ticked, so this shows its first ${Math.min(2, s.k.promos.length)}. Untick it to choose.</p>` : ""}
    ${ends.length ? `<p class="ac-note">${ends.map(([b, d]) => `"${esc(badgeText(b))}" ends ${shortDate(d)}`).join("; ")}: check it's still on when the email goes out.</p>` : ""}
  </div>`;
}
function fareBlock(it){
  const f = fareOf(it), solo = onSale(it.id, "solo"), grades = onSale(it.id, f.fare);
  const cheapest = f.fare === "solo" ? Math.min(...Object.values(solo)) : sailing(it.id).price;
  return `<div class="ac-row" role="group" aria-label="Fare"><span class="ac-lab">Fare</span>
      <button type="button" class="ac-seg" data-fare="twin" aria-pressed="${f.fare === "twin"}">Twin (2 sharing)</button>
      <button type="button" class="ac-seg" data-fare="solo" aria-pressed="${f.fare === "solo"}"${Object.keys(solo).length ? "" : " disabled title=\"No solo cabins on sale\""}>Solo</button></div>
    <label class="ac-lab" for="em-grade">Cabin</label>
    <select id="em-grade"><option value="">Cheapest available (${money(cheapest)})</option>
      ${Object.entries(GRADE).filter(([g]) => grades[g] != null).map(([g, n]) => `<option value="${g}"${f.grade === g ? " selected" : ""}>${n} (${money(grades[g])})</option>`).join("")}</select>
    <p class="sub">Button: <b>${esc(f.label)}</b>${f.fare === "solo" ? " · links to the solo fares" : ""}</p>`;
}
const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function draw(){
  const it = em.items, heroPhotos = [...new Set(it.flatMap(x => sailing(x.id).photos))];
  sugg = suggestionsFor();
  const by = sendBy();
  root.innerHTML = `<div class="ac">
    <div class="ac-side">
      ${draftsBlock()}
      ${cs.section("em-sailings", "Sailings in order", it.length ? `${it.length} sailing${it.length === 1 ? "" : "s"}: ${it.filter(x => x.layout !== "wide").length} tile${it.filter(x => x.layout !== "wide").length === 1 ? "" : "s"}, ${it.filter(x => x.layout === "wide").length} full width` : "none added yet", `
        <label class="ac-lab" for="em-find">Add a sailing</label>
        <input id="em-find" type="search" placeholder="Search name, port or cruise code" autocomplete="off">
        <div id="em-results" class="ac-results"></div>
        <p class="sub" style="margin:4px 0 0">${it.length} of ${MAX} sailings</p>
        ${it.length ? `<ol class="ac-list">${it.map((x, i) => { const s = sailing(x.id); return `<li class="${i === sel ? "on" : ""}">
          <button type="button" class="ac-pick" data-i="${i}"><b><span class="ac-n">${i + 1}</span>${esc(s.title)}</b><span class="sub">${esc(x.id)} · ${shortDate(s.r.departure_date)} · ${x.layout === "wide" ? "full width" : "tile"}${x.design !== "standard" ? " · was/now" : ""}</span></button>
          <span class="ac-strips"></span>
          <span class="ac-ord"><button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="Move down"${i < it.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-dup="${i}" aria-label="Duplicate" title="Duplicate this sailing (e.g. full width with another photo)"${it.length < MAX ? "" : " disabled"}>⧉</button><button type="button" data-del="${i}" aria-label="Remove">✕</button></span></li>`; }).join("")}</ol>
          <label class="ac-check"><input type="checkbox" id="em-allbadges"${em.allBadges ? " checked" : ""}> Offer badges on every sailing <span class="sub">(each sailing's live offers, up to 2)</span></label>
          <p class="sub">Tiles go 3 across (on phones they stack); a full-width sailing starts a new row.</p>` : `<p class="sub">Search above and add the sailings for this email.</p>`}`)}
      ${itemEditor()}
      ${cs.section("em-header", "Header", [em.hero.photo ? "Picture chosen" : "No picture", em.hero.headline.trim() ? `"${esc(em.hero.headline.trim())}"` : "no headline"].join(" · "), `
        ${heroPhotos.length ? (() => { const g = cs.photoGrid("em-hero", heroPhotos.map(u => photoButton(u, em.hero.photo, "data-hero")), heroPhotos.indexOf(em.hero.photo)); return `<div class="ac-photos">${g.grid}</div>${g.more}`; })() : `<p class="sub">Add a sailing to choose from its photos.</p>`}
        ${em.hero.photo ? `<button type="button" class="linkbtn" id="em-nohero">No header picture</button>` : ""}
        <input id="em-headline" value="${esc(em.hero.headline)}" placeholder="Headline, e.g. The weekly cruise round-up" maxlength="28" aria-label="Header headline">
        <input id="em-sub" value="${esc(em.hero.sub)}" placeholder="Second line (optional)" maxlength="70" aria-label="Header second line">`)}
      ${cs.section("em-words", "Words", em.subject.trim() ? `Subject: "${esc(em.subject.trim().slice(0, 50))}${em.subject.trim().length > 50 ? "…" : ""}"${em.intro.trim() ? "" : " · no intro yet"}` : "No subject line yet", `
        <label class="ac-lab" for="em-subject">Subject line <span class="sub" id="em-n-subject"></span></label>
        <input id="em-subject" value="${esc(em.subject)}" placeholder="${FR ? `ex. Le soleil d'hiver dès ${it.length ? money(Math.min(...it.map(x => sailing(x.id).price))) : "679 €"}` : `e.g. Winter sunshine from ${it.length ? money(Math.min(...it.map(x => sailing(x.id).price))) : "£399"}pp`}">
        <label class="ac-lab" for="em-pre">Preview text <span class="sub">(shown after the subject in the inbox)</span></label>
        <input id="em-pre" value="${esc(em.preheader)}" placeholder="One line that adds to the subject">
        <label class="ac-lab" for="em-intro">Intro</label>
        <textarea id="em-intro" rows="5" placeholder="A few lines introducing these sailings">${esc(em.intro)}</textarea>
        ${FR ? `<label class="ac-check"><input type="checkbox" id="em-taviraj"${em.taviraj !== false ? " checked" : ""}> Intro in Taviraj <span class="sub">(the brand's secondary typeface, for French body copy)</span></label>` : ""}
        ${sugg.length ? `<details class="ac-sugg"><summary>Suggested intros (${sugg.length})</summary>
          <p class="sub">Built from these sailings' own facts in Ambassador's tone of voice.</p>
          ${sugg.map((o, i) => `<div class="ac-opt"><span class="ac-tag">${esc(o.label)}</span><p>${esc(o.text)}</p><button type="button" class="btn quiet" data-use="${i}">Use this</button></div>`).join("")}</details>` : ""}
        ${claude.block("email", it.length ? "" : "Add at least one sailing to the email first, then Claude can draft the text.")}
        <label class="ac-lab" for="em-cta">Button under the intro <span class="sub">(blank = no button)</span></label>
        <input id="em-cta" value="${esc(em.cta)}">
        <input id="em-ctalink" value="${esc(em.ctaLink)}" aria-label="Button link" placeholder="${SITE}">`)}
      ${FR ? "" : cs.section("em-strips", "Nectar and Trustpilot", [em.nectar.on && NECTAR ? `Nectar banner ${PLACES[em.nectar.pos].toLowerCase()}` : "Nectar banner off", em.tp.on ? `Trustpilot ${PLACES[em.tp.pos].toLowerCase()}` : "Trustpilot off"].join(" · "), `
        <label class="ac-check"><input type="checkbox" id="em-nectar"${em.nectar.on && NECTAR ? " checked" : ""}${NECTAR ? "" : " disabled"}> Nectar banner ${NECTAR ? "" : `<span class="sub">(waiting for the Nectar banner artwork)</span>`}</label>
        ${NECTAR && em.nectar.on ? `${NECTAR.images.length > 1 ? `<div class="ac-photos em-banners" role="group" aria-label="Nectar banner">${NECTAR.images.map((x, i) => `<button type="button" class="ac-ph${x.file === (em.nectar.file || NECTAR.images[0].file) ? " on" : ""}" data-nectar="${esc(x.file)}" title="${esc(x.label)}" aria-label="${esc(x.label)}"><img src="email/${esc(x.file)}" alt=""></button>`).join("")}</div>` : ""}
          <select id="em-nectar-pos" aria-label="Where the Nectar banner goes">${Object.entries(PLACES).map(([k, v]) => `<option value="${k}"${k === em.nectar.pos ? " selected" : ""}>${v}</option>`).join("")}</select>` : ""}
        <label class="ac-check"><input type="checkbox" id="em-tp"${em.tp.on ? " checked" : ""}> Trustpilot widget <span class="sub">(Trustpilot's own, always shows the current score)</span></label>
        ${em.tp.on ? `<select id="em-tp-pos" aria-label="Where the Trustpilot widget goes">${Object.entries(PLACES).map(([k, v]) => `<option value="${k}"${k === em.tp.pos ? " selected" : ""}>${v}</option>`).join("")}</select>` : ""}`, false)}
      ${cs.section("em-small", "Small print", [safeUrl(em.terms) ? "Offer T&amp;Cs link set" : "No offer T&amp;Cs link", safeUrl(em.unsub) ? "unsubscribe link set" : "no unsubscribe link yet"].join(" · "), `
        <label class="ac-lab" for="em-terms">Offer T&amp;Cs link <span class="sub">(blank = leave out)</span></label>
        <input id="em-terms" value="${esc(em.terms)}">
        <label class="ac-lab" for="em-legal">Footer text <span class="sub">(one paragraph per line)</span></label>
        <textarea id="em-legal" rows="5">${esc(em.legal)}</textarea>
        <label class="ac-lab" for="em-unsub">Unsubscribe / preferences link</label>
        <input id="em-unsub" value="${esc(em.unsub)}" placeholder="Your email platform's link (for now the email says UNSUBSCRIBE_LINK)">
        <label class="ac-lab" for="em-phone">Phone number in the header</label>
        <input id="em-phone" value="${esc(em.phone)}">`, false)}
    </div>
    <div class="ac-main em-main">
      <div class="ac-actions">
        <button type="button" class="btn" id="em-make"${it.length ? "" : " disabled"}>Make email</button>
        <button type="button" class="btn quiet" id="em-clear"${it.length || em.subject ? "" : " disabled"}>Start again</button>
        <span class="sub" id="em-status" aria-live="polite">Prices as checked ${shortDate(today)}.</span>
      </div>
      ${by ? `<p class="ac-note"><b>This email has was/now prices: send it by ${shortDate(by)}.</b> After that the reduction can no longer be claimed.</p>` : ""}
      ${note ? `<p class="ac-note">${note}</p>` : ""}
      ${made ? `<div class="ac-block em-made"><h3>Your email is ready</h3>
        <p class="sub">Images are stored for 90 days. Paste the HTML into your email platform, then set the unsubscribe link there before sending.</p>
        <div class="ac-row"><button type="button" class="btn" id="em-copy">Copy HTML</button><button type="button" class="btn quiet" id="em-dl">Download .html</button></div></div>` : ""}
      <div class="ac-row em-modes" role="group" aria-label="Preview size">
        <button type="button" class="ac-seg" data-mode="desktop" aria-pressed="${previewMode === "desktop"}">Desktop</button>
        <button type="button" class="ac-seg" data-mode="mobile" aria-pressed="${previewMode === "mobile"}">Phone</button></div>
      <div class="em-frame"><iframe id="em-preview" title="Email preview" style="width:${previewMode === "mobile" ? 375 : 640}px"></iframe></div>
      <p class="sub em-hint">Scroll inside the preview to see the whole email.</p>
    </div>
  </div>`;
  note = "";
  wire();
  preview();
}
let pv = 0, previewY = 0;
async function preview(){
  const n = ++pv, frame = root.querySelector("#em-preview"); if (!frame) return;
  const list = images(), src = {};
  const grey = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#ddd"/></svg>`);
  for (const k of Object.keys(list)) src[k] = baked.get(JSON.stringify([...list[k], .8])) || grey;
  // The preview fits the screen and scrolls inside itself (Sam, 13 Oct 2026); each refresh keeps the place
  // you'd scrolled to, so editing near the bottom doesn't jump back to the top.
  const show = html => {
    let y = 0; try { y = frame.contentWindow.scrollY || 0; } catch(e){}
    if (y) previewY = y;
    frame.onload = () => { try { frame.contentWindow.scrollTo(0, previewY); frame.contentWindow.addEventListener("scroll", () => { previewY = frame.contentWindow.scrollY; }); } catch(e){} };
    frame.srcdoc = html;
  };
  show(emailHtml(src));
  for (const [k, [kind, o]] of Object.entries(list)) {
    if (src[k] !== grey) continue;
    try { src[k] = await bake(kind, o, .8); } catch(e) { continue; }
    if (n !== pv) return;
    show(emailHtml(src));
  }
}
let typing;
function change(redraw){ made = null; save(); if (redraw) draw(); else { clearTimeout(typing); typing = setTimeout(preview, 400); } }
function wire(){
  const $ = s => root.querySelector(s);
  cs.wire(root, draw);
  const bind = (id, set) => { const el = $(id); el && el.addEventListener("input", () => { set(el.value); change(false); }); };
  bind("#em-subject", v => em.subject = v); bind("#em-pre", v => em.preheader = v);
  bind("#em-headline", v => em.hero.headline = v); bind("#em-sub", v => em.hero.sub = v);
  bind("#em-intro", v => em.intro = v);
  const tv = $("#em-taviraj"); tv && tv.addEventListener("change", () => { em.taviraj = tv.checked; change(true); }); bind("#em-cta", v => em.cta = v); bind("#em-ctalink", v => em.ctaLink = v);
  bind("#em-terms", v => em.terms = v); bind("#em-legal", v => em.legal = v); bind("#em-unsub", v => em.unsub = v); bind("#em-phone", v => em.phone = v);
  bind("#em-caption", v => em.items[sel].caption = v);
  const cnt = () => { const n = $("#em-n-subject"); if (n) n.textContent = em.subject ? `${em.subject.length} characters${em.subject.length > 60 ? ", may be cut short on phones" : ""}` : ""; };
  cnt(); $("#em-subject").addEventListener("input", cnt);
  const find = $("#em-find"), res = $("#em-results");
  find.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    if (q.length < 2) { res.innerHTML = ""; return; }
    const hits = live().filter(([id, r]) => [id, r.title, r.base_title, r.port, r.flight_from, r.ship].join(" ").toLowerCase().includes(q))
      .sort((a, b) => a[1].departure_date.localeCompare(b[1].departure_date)).slice(0, 8);
    res.innerHTML = hits.length ? hits.map(([id, r]) => `<button type="button" data-add="${esc(id)}"${em.items.some(x => x.id === id) || em.items.length >= MAX ? " disabled" : ""}><b>${esc(r.flight_from ? r.base_title : r.title)}</b><span class="sub">${esc(id)} · ${shortDate(r.departure_date)} · ${r.flight_from ? "Fly from " + esc(r.flight_from) : esc(r.port)} · ${money(r.segments[r.segments.length - 1].p)}</span></button>`).join("")
      : `<p class="sub">No sailings on sale match.</p>`;
  });
  res.addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b || em.items.length >= MAX) return;
    em.items.push(newItem(b.dataset.add)); sel = em.items.length - 1;
    if (!em.hero.photo) em.hero.photo = pickPhoto(sailing(b.dataset.add));
    change(true); root.querySelector("#em-find").focus();
  });
  root.querySelectorAll(".ac-pick").forEach(b => b.addEventListener("click", () => { sel = +b.dataset.i; draw(); }));
  const move = (i, j) => { const [x] = em.items.splice(i, 1); em.items.splice(j, 0, x); sel = j; change(true); };
  root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
  root.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(+b.dataset.down, +b.dataset.down + 1)));
  root.querySelectorAll("[data-dup]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.dup; if (em.items.length >= MAX) return;
    em.items.splice(i + 1, 0, JSON.parse(JSON.stringify(em.items[i]))); sel = i + 1; change(true);
  }));
  $("#dr-save") && $("#dr-save").addEventListener("click", () => saveDraft(false));
  $("#dr-saveas") && $("#dr-saveas").addEventListener("click", () => saveDraft(true));
  $("#dr-link") && $("#dr-link").addEventListener("click", copyLink);
  $("#dr-move") && $("#dr-move").addEventListener("click", async () => {
    try { const n = await store.moveLocal(); note = esc(`Moved ${n} saved email${n === 1 ? "" : "s"} to the shared list.`); draftId = null; }
    catch(e) { note = esc(`Couldn't move them: ${e.message}`); }
    save(); draw();
  });
  $("#dr-new") && $("#dr-new").addEventListener("click", () => {
    if (em.items.length && !draftId && !confirm("Start a new email? This one isn't saved.")) return;
    draftId = null; em = fresh(); sel = 0; made = null; note = ""; save(); draw();
  });
  // Saved emails: a searchable list in a dialog (site/saved.js), not a dropdown (Sam, 13 Oct 2026)
  $("#dr-browse") && $("#dr-browse").addEventListener("click", () => {
    const all = drafts();
    openSaved({title: "Saved emails", noun: "email", current: draftId,
      note: store.shared ? "Shared with everyone on the tracker. You can open or copy anyone's; only your own can be changed." : "",
      items: Object.entries(all).map(([id, d]) => {
        const xs = (d.email.items || []), x0 = xs.find(x => sailing(x.id)), first = x0 && sailing(x0.id);   // the first still on sale
        const photo = x0 && x0.photo && !String(x0.photo).startsWith("upload:") && first.photos.includes(x0.photo) ? x0.photo : first && first.image;
        return {id, name: d.name, saved_at: d.saved_at, count: xs.length, thumb: photo ? cropUrl(photo, 120, 90) : "",
                by: d.by || "", mine: store.mine(id), issues: normalise(d.email).issues,
                detail: [...new Set(xs.map(x => (sailing(x.id) || {title: x.id}).title))].join(" · ")};
      }),
      onOpen: id => { const d = drafts()[id]; if (!d) return; draftId = id; load(d.email, `Opened "${d.name}"`); },
      onCopy: async id => {
        const d = drafts()[id]; if (!d) return;
        try { const name = `${d.name} (copy)`; draftId = await store.save(null, name, JSON.parse(JSON.stringify(d.email))); load(d.email, `Made a copy: "${name}"`); }
        catch(e) { note = esc(`Couldn't copy: ${e.message}`); draw(); }
      },
      onRename: async (id, name) => { try { await store.rename(id, name); } catch(e) { alert(`Couldn't rename: ${e.message}`); } draw(); },
      onDelete: async id => { try { await store.remove(id); if (draftId === id) draftId = null; } catch(e) { alert(`Couldn't delete: ${e.message}`); } draw(); },
    });
  });
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { em.items.splice(+b.dataset.del, 1); sel = Math.max(0, Math.min(sel, em.items.length - 1)); change(true); }));
  const tabTo = i => { sel = (i + em.items.length) % em.items.length; draw(); const t = root.querySelector(`[data-tab="${sel}"]`); t && t.focus(); };
  root.querySelectorAll("[data-tab]").forEach(b => {
    b.addEventListener("click", () => { if (sel !== +b.dataset.tab) tabTo(+b.dataset.tab); });
    b.addEventListener("keydown", e => { const k = {ArrowRight: 1, ArrowLeft: -1}[e.key]; if (k) { e.preventDefault(); tabTo(sel + k); } });
  });
  root.querySelectorAll("[data-hero]").forEach(b => b.addEventListener("click", () => { em.hero.photo = b.dataset.hero; change(true); }));
  $("#em-nohero") && $("#em-nohero").addEventListener("click", () => { em.hero.photo = ""; change(true); });
  root.querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => { em.intro = sugg[+b.dataset.use].text; change(true); }));
  // Claude's drafts (drafts.js): subject, preview text, header words and intro together; facts come from saved state
  claude.wire(root, "email", {ID, redraw: draw,
    body: () => ({format: em.items.length === 1 ? "single" : "carousel",
                  ...(FR ? {market: "fr"} : {}), items: em.items.map(it => ({id: it.id, wasnow: claimOf(it) ? it.design.slice(7) : null, promos: badgesOf(it)}))}),
    forWhat: () => em.items.map(it => sailing(it.id).title).join(", "),
    use: o => { Object.assign(em, {subject: o.subject, preheader: o.preheader, intro: o.intro});
                Object.assign(em.hero, {headline: o.headline.slice(0, 28), sub: o.sub.slice(0, 70)}); change(true); }});
  const cur = em.items[sel];
  if (cur) {
    root.querySelectorAll("[data-layout]").forEach(b => b.addEventListener("click", () => { cur.layout = b.dataset.layout; change(true); }));
    $("#em-design").addEventListener("change", e => { cur.design = e.target.value; change(true); });
    root.querySelectorAll("[data-fare]").forEach(b => b.addEventListener("click", () => { cur.fare = b.dataset.fare; cur.grade = ""; change(true); }));
    $("#em-grade") && $("#em-grade").addEventListener("change", e => { cur.grade = e.target.value; change(true); });
    root.querySelectorAll("[data-photo]").forEach(b => b.addEventListener("click", () => { cur.photo = b.dataset.photo; change(true); }));
    $("#em-hint") && $("#em-hint").addEventListener("click", () => { cur.caption = captionHint(cur.photo); change(true); });
    root.querySelectorAll("[data-badge]").forEach(b => b.addEventListener("change", () => {
      const p = sailing(cur.id).k.promos[+b.dataset.badge];
      cur.badges = b.checked ? [...cur.badges.filter(x => x !== p), p].slice(-2) : cur.badges.filter(x => x !== p);
      change(true);
    }));
  }
  root.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { previewMode = b.dataset.mode; draw(); }));
  $("#em-clear").addEventListener("click", () => { if (confirm("Start a new email? This one will be cleared.")) { em = fresh(); sel = 0; draftId = null; change(true); } });
  $("#em-make").addEventListener("click", makeEmail);
  // Off means no badges until chosen per sailing (Sam, 13 Oct 2026)
  $("#em-allbadges") && $("#em-allbadges").addEventListener("change", e => { em.allBadges = e.target.checked; if (!em.allBadges) em.items.forEach(x => { x.badges = []; }); change(true); });
  $("#em-nectar") && $("#em-nectar").addEventListener("change", e => { em.nectar.on = e.target.checked; change(true); });   // (not in France)
  root.querySelectorAll("[data-nectar]").forEach(b => b.addEventListener("click", () => { em.nectar.file = b.dataset.nectar; change(true); }));
  $("#em-nectar-pos") && $("#em-nectar-pos").addEventListener("change", e => { em.nectar.pos = e.target.value; change(true); });
  $("#em-tp") && $("#em-tp").addEventListener("change", e => { em.tp.on = e.target.checked; change(true); });
  $("#em-tp-pos") && $("#em-tp-pos").addEventListener("change", e => { em.tp.pos = e.target.value; change(true); });
  $("#em-copy") && $("#em-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(made); $("#em-copy").textContent = "Copied"; } catch(e) { prompt("Copy the email's HTML", made); }
  });
  $("#em-dl") && $("#em-dl").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([made], {type: "text/html"}));
    a.download = `email_${today}_${(em.subject || "ambassador").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}.html`;
    document.body.appendChild(a); a.click(); a.remove();
  });
}
async function makeEmail(){
  const st = root.querySelector("#em-status"), btn = root.querySelector("#em-make");
  if (!ID) { note = "Sign in again to make the email."; return draw(); }
  btn.disabled = true;
  try {
    const list = images(), names = Object.keys(list), body = [];
    for (const [i, k] of names.entries()) {
      st.textContent = `Making images ${i + 1} of ${names.length}…`;
      const [kind, o] = list[k];
      let url;
      try { url = await bake(kind, o, .86); }
      catch(e) { throw new Error(`Couldn't make the ${k === "logo" ? "logo" : k === "hero" ? "header picture" : "picture for sailing " + k.split("_")[0].slice(1)} (${e.message || e}).`); }
      body.push({name: k, data: url.split(",")[1]});
    }
    st.textContent = "Saving the images…";
    let r;
    try { r = await fetch(FN, {method: "POST", headers: {Authorization: `Bearer ${await ID()}`, "Content-Type": "application/json"}, body: JSON.stringify({images: body})}); }
    catch(e) { throw new Error("The image service can't be reached. If it was only just added, it goes live with the next Video function deploy."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `The image service answered ${r.status}.`);
    made = emailHtml(j.urls);
    note = em.unsub.trim() ? "" : "No unsubscribe link is set: the email says UNSUBSCRIBE_LINK where it goes. Put your platform's link there before sending.";
  } catch(e) {
    console.error(e);
    note = esc(e.message || String(e));
  }
  draw();
}
