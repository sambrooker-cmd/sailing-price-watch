// Ad creator (Sam, 12 Oct 2026): pick sailings, put them in order, change the words, image,
// design and strips, see the ad as it would look in a Meta feed, then download one zip with
// the cards in order, the ad text and step-by-step upload instructions.
// Nothing is sent to Meta. Prices, dates and was/now figures always come from the tracker's
// saved data (state/current, state/cabins) and can't be typed in. "Lower fares" offers never
// reach the promotion choices (render_cards.py PRICE_CLAIM, via state/adkit.json).
import {cardDoc, introDoc, endDoc, defaultWords, cropUrl, PR_CABIN, SIZES} from "./adcards.js";
import {suggest} from "./adcopy.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const fmtDate = iso => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"}) : "–";
const GRADE = {inside: "Inside", ocean_view: "Ocean view", balcony: "Balcony", suite: "Suite"};
const CTAS = ["Learn more", "Book now", "See more", "Get offer"];
const LIMITS = {primary: 125, headline: 40, description: 30};   // roughly where Meta cuts text off in the feed
const MAX_CARDS = 10;
const KEY = "spw-ad-draft";          // the ad being worked on (this browser)
const DRAFTS = "spw-ad-drafts";      // named saved ads (this browser): {id: {name, saved_at, ad}}

let S, CAB, KIT, LOGO, TP = null, root, today;
// Opening and closing carousel cards (Sam, 13 Oct 2026: Allium pattern designs, adcards.js introDoc / endDoc).
const SITE = "https://www.ambassadorcruiseline.com/";
const INTRO = {on: true, eyebrow: "", headline: "Where will you sail next?", cta: "Swipe to explore ›", useA: true,
               mHeadline: "Where will you sail next?", mDesc: "", link: SITE};
const END = {on: true, headline: "The warmest welcome at sea", cta: "Book your sailing", url: "ambassadorcruiseline.com", useA: true,
             mHeadline: "Book your sailing", mDesc: "", link: SITE};
let ad = {format: "carousel", size: "1x1", primary: "", cta: "Learn more", cards: [], intro: {...INTRO}, end: {...END}};
let sel = 0, uploads = {}, upN = 0, draftId = null, note = "";

export async function mount(el, ctx){
  root = el; S = ctx.state; CAB = ctx.cabins || {}; KIT = (ctx.adkit && ctx.adkit.sailings) || {};
  today = S.updated;
  LOGO = await (await fetch("logo-white.svg")).text();
  // Trustpilot widget: Trustpilot's own artwork in site/trustpilot/, listed in widget.json
  // {"as_of": "YYYY-MM-DD", "images": [{"file", "label"}]}. Until it exists the tick box is shown but off.
  try { const r = await fetch("trustpilot/widget.json", {cache: "no-store"}); if (r.ok) TP = await r.json(); } catch(e){}
  try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); if (d && Array.isArray(d.cards)) { ad = normalise(d).ad; draftId = d._draft || null; } } catch(e){}
  if (ctx.shared) await openShared(ctx.shared); else draw();
}

// Bring a saved, shared or older ad up to date with today's data, saying what had to change.
// Prices are never stored in an ad: the cards always use the tracker's latest saved prices.
function normalise(d){
  const out = {format: "carousel", size: "1x1", primary: "", cta: "Learn more", ...d}, msgs = [];
  delete out._draft;
  out.intro = {...INTRO, ...(d.intro || {})}; out.end = {...END, ...(d.end || {})};
  const gone = (d.cards || []).filter(c => !sailing(c.id)).map(c => c.id);
  if (gone.length) msgs.push(`${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} no longer on sale, so ${gone.length === 1 ? "it was" : "they were"} left out`);
  let ended = 0, lost = 0;
  out.cards = (d.cards || []).filter(c => sailing(c.id)).map(c => {
    c = {...c};
    if (c.design && c.design.startsWith("wasnow:") && !claims(c.id).some(x => "wasnow:" + x.key === c.design)) { c.design = "standard"; c.words = null; ended++; }
    if (c.photo && c.photo.startsWith("upload:") && !uploads[c.photo]) { c.photo = null; c.uploadLost = true; lost++; }
    if (c.trustpilot && TP && typeof c.trustpilot === "string" && !TP.images.some(x => x.file === c.trustpilot)) c.trustpilot = TP.images[0].file;
    return c;
  });
  if (ended) msgs.push(`${ended} was/now card${ended === 1 ? "" : "s"} switched to standard because the price-reduction claim has ended`);
  if (lost) msgs.push(`${lost} uploaded photo${lost === 1 ? " needs" : "s need"} adding again (uploads stay on the computer they came from)`);
  return {ad: out, msgs};
}
const fresh = () => ({format: "carousel", size: "1x1", primary: "", cta: "Learn more", cards: [], intro: {...INTRO}, end: {...END}});
function load(d, msg){
  const n = normalise(d); ad = n.ad; sel = 0;
  note = [msg, ...n.msgs].filter(Boolean).join(". ") + (n.msgs.length || msg ? "." : "");
  save(); draw();
}

// ---------- saved drafts (this browser) ----------
const drafts = () => { try { return JSON.parse(localStorage.getItem(DRAFTS) || "{}") || {}; } catch(e) { return {}; } };
const storeDrafts = d => { try { localStorage.setItem(DRAFTS, JSON.stringify(d)); return true; } catch(e) { note = "Couldn't save: this browser's storage is full or blocked."; return false; } };
// Uploads are left out of saved drafts and links (too big); normalise() flags them when the ad is opened.
const portable = () => JSON.parse(JSON.stringify({...ad, cards: ad.cards.map(c => ({...c, uploadLost: undefined}))}));
function saveDraft(asNew){
  const all = drafts();
  let id = asNew ? null : draftId;
  let name = id && all[id] ? all[id].name : "";
  if (!id) {
    const first = ad.cards[0] && sailing(ad.cards[0].id);
    name = prompt("Name this ad", first ? `${first.title}${ad.cards.length > 1 ? ` + ${ad.cards.length - 1} more` : ""}` : "New ad");
    if (!name) return;
    id = "d" + Date.now().toString(36);
  }
  all[id] = {name, saved_at: new Date().toISOString(), ad: portable()};
  if (storeDrafts(all)) { draftId = id; note = `Saved "${name}".`; }
  save(); draw();
}

// ---------- shareable link ----------
// The whole ad (no prices, no uploads) squeezed into the link: deflate + base64url, after #ad=
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
// "Make video" (Sam, 13 Oct 2026): the videos are made on GitHub (make_video.py, Actions → Make video)
// from this ad's link, so the page copies the link and opens the workflow for it to be pasted in.
const VIDEO_WORKFLOW = "https://github.com/sambrooker-cmd/sailing-price-watch/actions/workflows/make-video.yml";
async function makeVideo(){
  const url = `${location.origin}${location.pathname}#ad=${await pack({v: 1, ad: portable()})}`;
  let copied = true;   // copy before the new tab takes the focus, or the browser refuses the copy
  try { await navigator.clipboard.writeText(url); } catch(e) { copied = false; prompt("Copy this link", url); }
  window.open(VIDEO_WORKFLOW, "_blank", "noopener");
  const up = ad.cards.some(c => c.photo && c.photo.startsWith("upload:"));
  note = `${copied ? "Ad link copied. " : ""}On GitHub's Make video page (it opens in a new tab): Run workflow, paste the link into "Ad link" and press the green Run workflow. ` +
         `In about 4 minutes the run page has a zip of 6 MP4s (1:1, 4:5 and 9:16; 6 and 10 seconds), without sound. ` + (up ? `Uploaded photos can't go to GitHub, so those cards use the feed image instead.` : "");
  draw();
}
async function copyLink(){
  const url = `${location.origin}${location.pathname}#ad=${await pack({v: 1, ad: portable()})}`;
  try { await navigator.clipboard.writeText(url); note = "Link copied. Anyone on the tracker's allowlist can open it in their own Ad creator; prices on the cards are always the latest."; }
  catch(e) { prompt("Copy this link", url); note = ""; }
  draw();
}
export async function openShared(s){
  try {
    const d = await unpack(s);
    history.replaceState(null, "", location.pathname + location.search);
    draftId = null;
    load(d.ad || d, "Opened a shared ad. It's now your own copy: changes don't affect the sender's");
  } catch(e) { note = "That ad link couldn't be read. It may have been cut short when it was copied."; draw(); }
}

const save = () => { try { localStorage.setItem(KEY, JSON.stringify({...ad, _draft: draftId})); } catch(e){} };
const live = () => Object.entries(S.sailings || {}).filter(([, r]) => !r.removed && r.departure_date > today);
function sailing(id){
  const r = (S.sailings || {})[id];
  if (!r || r.removed || !(r.departure_date > today)) return null;
  const k = KIT[id] || {}, fly = r.flight_from;
  return {id, r, k, fly, title: fly ? r.base_title : r.title, price: r.segments[r.segments.length - 1].p,
          image: k.image || r.image_link, photos: [k.image || r.image_link, ...(k.photos || [])].filter((u, i, a) => u && a.indexOf(u) === i)};
}

// Was/now claims valid today, straight from the tracker's state (tracker.py claim_for).
function claims(id){
  const s = sailing(id); if (!s) return [];
  const out = [], c = s.r.claim;
  if (c && c.eligible && c.ends >= today && c.now === s.price)
    out.push({key: "lead", label: `Lead price${s.k.lead_grade ? " (" + GRADE[s.k.lead_grade].toLowerCase() + ")" : ""}`, was: c.was, now: c.now, ends: c.ends, grade: s.k.lead_grade || null});
  for (const [k, cc] of Object.entries((CAB[id] || {}).cabin_claims || {}))
    if (k.startsWith("twin.") && cc.eligible && cc.ends >= today)
      out.push({key: k, label: GRADE[k.slice(5)] + " cabins", was: cc.was, now: cc.now, ends: cc.ends, grade: k.slice(5)});
  return out;
}

function newCard(id){
  const s = sailing(id);
  return {id, design: "standard", photo: s.image, words: null, promos: (s.k.promos || []).slice(0, s.k.nectar ? 1 : 2),
          nectar: !!s.k.nectar, headline: s.title.slice(0, LIMITS.headline), description: `From ${money(s.price)}pp`, link: s.r.link || ""};
}

// Everything the card design needs, from the saved data plus this card's choices.
// The chosen Trustpilot layout (c.trustpilot is its file name; true from an older draft = the first one).
const tpFile = c => (TP.images.find(x => x.file === c.trustpilot) || TP.images[0]).file;

function cardData(c){
  const s = sailing(c.id), r = s.r, cl = c.design.startsWith("wasnow:") ? claims(c.id).find(x => x.key === c.design.slice(7)) : null;
  const photo = c.photo && c.photo.startsWith("upload:") ? uploads[c.photo] : (c.photo || s.image);
  const campaign = !!s.k.campaign && photo === s.image && !(c.photo || "").startsWith("upload:");
  return {id: c.id, title: s.title, ship: r.ship, port: r.port, fly: s.fly, nights: r.nights, departure_date: r.departure_date,
          price: s.price, promos: c.promos || [], nectar: c.nectar ? s.k.nectar : "", photo, campaign, words: c.words || null,
          trustpilot: c.trustpilot && TP ? `${location.origin}/trustpilot/${tpFile(c)}` : "",
          wasnow: cl ? {was: cl.was, now: cl.now, grade: cl.grade} : null};
}

// The opening card's small line above the headline, when left blank: a fact true of every chosen sailing.
function autoEyebrow(){
  const ss = ad.cards.map(c => sailing(c.id)).filter(Boolean);
  if (!ss.length) return "";
  return ss.every(s => !s.fly) ? "No-fly cruises from UK ports" : ss.every(s => s.fly) ? "Fly-cruises from UK airports" : "Cruises from the UK";
}
const extras = () => ad.format === "carousel" ? (ad.intro.on ? 1 : 0) + (ad.end.on ? 1 : 0) : 0;
const maxSailings = () => MAX_CARDS - extras();
// Everything in the carousel, in order: [opening] + sailing cards + [closing]. Single image ads are just the sailing.
function slides(){
  const out = ad.cards.map((c, i) => ({kind: "sailing", i, c, name: c.id + (c.design.startsWith("wasnow:") ? "_wasnow" : ""),
    title: `${sailing(c.id).title} (${c.id})`, headline: c.headline, description: c.description, link: c.link,
    doc: size => cardDoc(cardData(c), size, LOGO)}));
  if (ad.format !== "carousel") return out;
  if (ad.intro.on) out.unshift({kind: "intro", name: "opening", title: "Opening card", headline: ad.intro.mHeadline, description: ad.intro.mDesc, link: ad.intro.link,
    doc: size => introDoc({...ad.intro, eyebrow: ad.intro.eyebrow || autoEyebrow()}, size, LOGO)});
  if (ad.end.on) out.push({kind: "end", name: "closing", title: "Closing card", headline: ad.end.mHeadline, description: ad.end.mDesc, link: ad.end.link,
    doc: size => endDoc(ad.end, size, LOGO)});
  return out;
}

function brandEditor(){
  if (ad.format !== "carousel") return "";
  const I = ad.intro, E = ad.end;
  return `<div class="ac-block">
    <h3>Opening and closing cards</h3>
    <label class="ac-check"><input type="checkbox" id="in-on"${I.on ? " checked" : ""}> Opening card</label>
    ${I.on ? `<input id="in-eyebrow" value="${esc(I.eyebrow)}" placeholder="${esc(autoEyebrow() || "Small line above the headline")}" aria-label="Small line above the headline">
      <input id="in-headline" value="${esc(I.headline)}" placeholder="Headline" aria-label="Opening headline">
      <input id="in-cta" value="${esc(I.cta)}" placeholder="Call to action (optional)" aria-label="Opening call to action">
      <label class="ac-check"><input type="checkbox" id="in-a"${I.useA ? " checked" : ""}> Use the Ambassador A for the first letter A</label>
      <label class="ac-lab sm" for="in-mh">Under the card on Meta: headline</label><input id="in-mh" value="${esc(I.mHeadline)}">
      <label class="ac-lab sm" for="in-md">Description</label><input id="in-md" value="${esc(I.mDesc)}">
      <label class="ac-lab sm" for="in-link">Link</label><input id="in-link" value="${esc(I.link)}" inputmode="url">` : ""}
    <label class="ac-check" style="margin-top:10px"><input type="checkbox" id="en-on"${E.on ? " checked" : ""}> Closing card</label>
    ${E.on ? `<input id="en-headline" value="${esc(E.headline)}" placeholder="Headline" aria-label="Closing headline">
      <input id="en-cta" value="${esc(E.cta)}" placeholder="Call to action" aria-label="Closing call to action">
      <input id="en-url" value="${esc(E.url)}" placeholder="Web address (optional)" aria-label="Web address on the card">
      <label class="ac-check"><input type="checkbox" id="en-a"${E.useA ? " checked" : ""}> Use the Ambassador A for the first letter A</label>
      <label class="ac-lab sm" for="en-mh">Under the card on Meta: headline</label><input id="en-mh" value="${esc(E.mHeadline)}">
      <label class="ac-lab sm" for="en-md">Description</label><input id="en-md" value="${esc(E.mDesc)}">
      <label class="ac-lab sm" for="en-link">Link</label><input id="en-link" value="${esc(E.link)}" inputmode="url">` : ""}
    <p class="sub">Allium with the brand's 20° pattern, as in the design system. Each counts towards Meta's 10-card limit.</p>
  </div>`;
}

// Nectar line and Trustpilot widget, per card or for every card at once (Sam, 13 Oct 2026).
// Why a strip can't go on this card ("" when it can): standard design only, and only when there's something to show.
function stripBlock(c, k){
  if (c.design !== "standard") return "Not on was/now cards";
  if (k === "nectar" && !sailing(c.id).k.nectar) return "This sailing has no Nectar points";
  if (k === "tp" && !TP) return "Waiting for the Trustpilot image";
  return "";
}
function setStrip(c, k, on){
  if (stripBlock(c, k)) return;
  if (k === "nectar") c.nectar = on;
  else c.trustpilot = on ? (typeof c.trustpilot === "string" && c.trustpilot ? c.trustpilot : TP.images[0].file) : "";
  c.promos = (c.promos || []).slice(0, c.nectar || c.trustpilot ? 1 : 2);   // still at most 1 promotion with either strip
}

function draftsBlock(){
  const all = drafts(), ids = Object.keys(all).sort((a, b) => all[b].saved_at.localeCompare(all[a].saved_at));
  const cur = draftId && all[draftId];
  return `<div class="ac-block">
    <h3>${cur ? esc(cur.name) : "Unsaved ad"}</h3>
    <div class="ac-row">
      <button type="button" class="btn quiet sm" id="dr-save"${ad.cards.length ? "" : " disabled"}>${cur ? "Save" : "Save as…"}</button>
      ${cur ? `<button type="button" class="btn quiet sm" id="dr-saveas">Save a copy…</button>` : ""}
      <button type="button" class="btn quiet sm" id="dr-link"${ad.cards.length ? "" : " disabled"}>Copy link</button>
      <button type="button" class="btn quiet sm" id="dr-new">New ad</button>
    </div>
    ${ids.length ? `<label class="ac-lab sm" for="dr-list">Saved ads in this browser (${ids.length})</label>
      <div class="ac-row"><select id="dr-list">${ids.map(i => `<option value="${i}"${i === draftId ? " selected" : ""}>${esc(all[i].name)} · ${new Date(all[i].saved_at).toLocaleDateString("en-GB", {day: "numeric", month: "short"})}</option>`).join("")}</select>
      <button type="button" class="btn quiet sm" id="dr-open">Open</button><button type="button" class="btn quiet sm" id="dr-ren">Rename</button><button type="button" class="btn quiet sm" id="dr-del">Delete</button></div>` : ""}
    ${note ? `<p class="ac-note" role="status">${esc(note)}</p>` : ""}
  </div>`;
}

// ---------- drawing ----------
function draw(){
  const c = ad.cards[sel];
  root.innerHTML = `
  <div class="ac">
    <div class="ac-side">
      ${draftsBlock()}
      <div class="ac-block">
        <div class="ac-row" role="group" aria-label="Ad format">
          <button type="button" class="ac-seg" data-format="carousel" aria-pressed="${ad.format === "carousel"}">Carousel</button>
          <button type="button" class="ac-seg" data-format="single" aria-pressed="${ad.format === "single"}">Single image</button>
          ${ad.format === "carousel" ? `<label class="ac-inline">Card size <select id="ac-size"><option value="1x1"${ad.size === "1x1" ? " selected" : ""}>1:1</option><option value="4x5"${ad.size === "4x5" ? " selected" : ""}>4:5</option></select></label>` : `<span class="sub">Made in all three sizes: 1:1, 4:5 and 9:16</span>`}
        </div>
        <label class="ac-lab" for="ac-find">Add a sailing</label>
        <input id="ac-find" type="search" placeholder="Search name, port or cruise code" autocomplete="off">
        <div id="ac-results" class="ac-results"></div>
      </div>
      <div class="ac-block">
        <h3>${ad.format === "carousel" ? `Sailings in order (${ad.cards.length} of ${maxSailings()})` : "Sailing"}</h3>
        ${ad.cards.length ? `<div class="ac-row ac-bulk" role="group" aria-label="Strips on every card"><span class="sub">Every card:</span>
          <button type="button" class="ac-chip" data-all="nectar:1">Nectar on</button><button type="button" class="ac-chip" data-all="nectar:0">Nectar off</button>
          <button type="button" class="ac-chip" data-all="tp:1"${TP ? "" : " disabled"}>Trustpilot on</button><button type="button" class="ac-chip" data-all="tp:0"${TP ? "" : " disabled"}>Trustpilot off</button></div>` : ""}
        ${ad.cards.length ? `<ol class="ac-list">${ad.cards.map((x, i) => { const s = sailing(x.id); return `
          <li class="${i === sel ? "on" : ""}" draggable="true" data-i="${i}">
            <button type="button" class="ac-pick" data-i="${i}"><b>${esc(s.title)}</b><span class="sub">${esc(x.id)} · ${fmtDate(s.r.departure_date)}${x.design !== "standard" ? " · was/now" : ""}</span></button>
            <span class="ac-strips">${["nectar", "tp"].map(k => { const why = stripBlock(x, k); const on = k === "nectar" ? !!x.nectar : !!x.trustpilot;
              return `<button type="button" class="ac-chip" data-strip="${k}" data-i="${i}" aria-pressed="${!why && on}"${why ? ` disabled title="${esc(why)}"` : ""}>${k === "nectar" ? "Nectar" : "Trustpilot"}</button>`; }).join("")}</span>
            <span class="ac-ord"><button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="Move down"${i < ad.cards.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-dup="${i}" aria-label="Duplicate" title="Duplicate this card"${ad.cards.length < maxSailings() ? "" : " disabled"}>⧉</button><button type="button" data-del="${i}" aria-label="Remove">✕</button></span>
          </li>`; }).join("")}</ol>` : `<p class="sub">Search above and add ${ad.format === "carousel" ? "2 to 10 sailings" : "a sailing"}.</p>`}
      </div>
      ${brandEditor()}
      ${c ? editor(c) : ""}
      <div class="ac-block">
        <h3>Ad text</h3>
        <label class="ac-lab" for="ac-primary">Primary text <span class="sub" id="cnt-primary"></span></label>
        <textarea id="ac-primary" rows="4" placeholder="The words above the ${ad.format === "carousel" ? "carousel" : "image"}">${esc(ad.primary)}</textarea>
        <label class="ac-lab" for="ac-cta">Button</label>
        <select id="ac-cta">${CTAS.map(x => `<option${x === ad.cta ? " selected" : ""}>${x}</option>`).join("")}</select>
        ${suggestions()}
      </div>
    </div>
    <div class="ac-main">
      <div class="ac-actions">
        <button type="button" class="btn" id="ac-zip"${ready() ? "" : " disabled"}>Download zip</button>
        <button type="button" class="btn quiet" id="ac-video"${ready() ? "" : " disabled"} title="Slideshow videos for Meta, made on GitHub">Make video</button>
        <button type="button" class="btn quiet" id="ac-clear"${ad.cards.length ? "" : " disabled"}>Start again</button>
        <span class="sub" id="ac-status" aria-live="polite">${readyMsg()}</span>
      </div>
      ${preview()}
    </div>
  </div>`;
  note = "";   // a message shows once, on the draw after whatever set it
  wire();
  paintCards();
  counts();
}

// Suggested primary text from the chosen sailings' own facts, in the brand's tone of voice (adcopy.js).
let sugg = [];
function suggestions(){
  if (ad.format === "carousel" ? ad.cards.length < 2 : ad.cards.length !== 1) return "";
  sugg = suggest(ad.cards.map(c => {
    const d = cardData(c), s = sailing(c.id), n = parseInt(((s.k.nectar || "").match(/[\d,]+/) || ["0"])[0].replace(/,/g, ""), 10);
    return {title: d.title, ship: d.ship, port: d.port, fly: d.fly, nights: d.nights, departure_date: d.departure_date, price: d.price,
            promos: s.k.promos || [], nectarPts: n, wasnow: d.wasnow};
  }), ad.format);
  return `<details class="ac-sugg" open><summary>Suggested primary text (${sugg.length})</summary>
    <p class="sub">Built from these sailings' prices, dates, ports, promotions and Nectar points, in Ambassador's tone of voice. The first ${LIMITS.primary} characters (in bold) show before "See more".</p>
    ${sugg.map((o, i) => { const cut = o.text.length <= LIMITS.primary ? o.text.length : o.text.lastIndexOf(" ", LIMITS.primary);
      return `<div class="ac-opt"><span class="ac-tag">${esc(o.label)}</span>
      <p><b>${esc(o.text.slice(0, cut))}</b>${esc(o.text.slice(cut))}</p>
      <button type="button" class="btn quiet" data-use="${i}">Use this</button></div>`; }).join("")}
  </details>`;
}

function ready(){ return ad.format === "carousel" ? ad.cards.length >= 1 && slides().length >= 2 : ad.cards.length === 1; }
function readyMsg(){
  if (ad.format === "carousel" && !ready()) return "A carousel needs at least 2 cards, including at least one sailing.";
  if (ad.format === "single" && ad.cards.length > 1) return "A single image ad uses one sailing: remove the others or switch to Carousel.";
  return `Prices as checked ${fmtDate(today)}.`;
}

function editor(c){
  const s = sailing(c.id), cl = claims(c.id), w = c.words || {};
  const dw = defaultWords(s.title), wasnow = c.design.startsWith("wasnow:");
  return `<div class="ac-block">
    <h3>Card ${sel + 1}: ${esc(s.title)}</h3>
    <label class="ac-lab" for="ac-design">Design</label>
    <select id="ac-design"><option value="standard">Standard</option>${cl.map(x => `<option value="wasnow:${x.key}"${c.design === "wasnow:" + x.key ? " selected" : ""}>Was/now: ${esc(x.label)}, was ${money(x.was)} now ${money(x.now)} (until ${fmtDate(x.ends)})</option>`).join("")}</select>
    ${cl.length ? `<p class="sub">Was/now figures come from the tracker's claim and can only be used until the date shown.</p>` : `<p class="sub">Was/now is only offered when this sailing has a live price-reduction claim.</p>`}
    <span class="ac-lab">Image</span>
    <div class="ac-photos">${s.photos.map(u => `<button type="button" class="ac-ph${(c.photo || s.image) === u ? " on" : ""}" data-photo="${esc(u)}" aria-label="Use this photo"><img src="${esc(cropUrl(u, 160, 160))}" alt="" loading="lazy" crossorigin="anonymous"></button>`).join("")}
      ${Object.keys(uploads).map(k => `<button type="button" class="ac-ph${c.photo === k ? " on" : ""}" data-photo="${k}" aria-label="Use uploaded image"><img src="${uploads[k]}" alt=""></button>`).join("")}
      <label class="ac-up">Upload<input type="file" id="ac-upload" accept="image/jpeg,image/png,image/webp" hidden></label></div>
    <p class="sub">First is the feed image${s.k.campaign ? " (campaign artwork: shown whole)" : ""}; the others are photos from the sailing's page.</p>
    ${c.uploadLost ? `<p class="ac-note">This card used an uploaded photo, which can't travel in a saved ad or link. Upload it again, or pick a photo above.</p>` : ""}
    <span class="ac-lab">Words on the card</span>
    ${wasnow ? `<input id="w-title" value="${esc(w.title ?? s.title)}" aria-label="Sailing name">` : `
      <input id="w-kicker" value="${esc(w.kicker ?? dw.kicker)}" placeholder="Small heading (optional)" aria-label="Small heading">
      <input id="w-headline" value="${esc(w.headline ?? dw.headline)}" placeholder="Headline" aria-label="Headline">
      <input id="w-sub" value="${esc(w.sub ?? dw.sub)}" placeholder="Second line (optional)" aria-label="Second line">`}
    <button type="button" class="linkbtn" id="w-reset">Back to the sailing's own name</button>
    ${wasnow ? "" : `<span class="ac-lab">Strips</span>
      ${s.k.nectar ? `<label class="ac-check"><input type="checkbox" id="ac-nectar"${c.nectar ? " checked" : ""}> ${esc(s.k.nectar)}</label>` : ""}
      <label class="ac-check"><input type="checkbox" id="ac-tp"${c.trustpilot && TP ? " checked" : ""}${TP ? "" : " disabled"}> Trustpilot widget ${TP ? `<span class="sub">(score as of ${fmtDate(TP.as_of)}: check it's still current)</span>` : `<span class="sub">(waiting for the Trustpilot image)</span>`}</label>
      ${c.trustpilot && TP ? `<select id="ac-tp-style" aria-label="Trustpilot layout">${TP.images.map(x => `<option value="${esc(x.file)}"${tpFile(c) === x.file ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select>` : ""}
      ${(s.k.promos || []).map((p, i) => `<label class="ac-check"><input type="checkbox" data-promo="${i}"${(c.promos || []).includes(p) ? " checked" : ""}> ${esc(p)}</label>`).join("") || `<p class="sub">No promotions on this sailing right now.</p>`}
      <p class="sub">Up to ${c.nectar || c.trustpilot ? "1 promotion with the Nectar line or Trustpilot widget" : "2 promotions"}, so the card doesn't get too busy.</p>`}
    <span class="ac-lab">Under the ${ad.format === "carousel" ? "card" : "image"} on Meta</span>
    <label class="ac-lab sm" for="m-headline">Headline <span class="sub" id="cnt-headline"></span></label>
    <input id="m-headline" value="${esc(c.headline)}">
    <label class="ac-lab sm" for="m-desc">Description <span class="sub" id="cnt-description"></span></label>
    <input id="m-desc" value="${esc(c.description)}">
    <label class="ac-lab sm" for="m-link">Link</label>
    <input id="m-link" value="${esc(c.link)}" inputmode="url">
  </div>`;
}

function preview(){
  const more = ad.primary.length > LIMITS.primary;
  const text = esc(more ? ad.primary.slice(0, LIMITS.primary).trimEnd() : ad.primary);
  const head = `<div class="mp-head"><span class="mp-av">A</span><div><b>Ambassador Cruise Line</b><span class="sub">Sponsored · <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"/><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" fill="none" stroke="currentColor"/></svg></span></div></div>
    <p class="mp-text">${text || `<span class="sub">Primary text appears here.</span>`}${more ? `… <span class="sub">See more</span>` : ""}</p>`;
  const foot = c => `<div class="mp-foot"><div><b>${esc(c.headline || "")}</b><span>${esc(c.description || "")}</span></div><span class="mp-cta">${esc(ad.cta)}</span></div>`;
  if (!ad.cards.length) return `<div class="mp"><div class="mp-post">${head}<div class="mp-empty">Add sailings to see the ad.</div></div></div>`;
  if (ad.format === "carousel"){
    const [w, h] = SIZES[ad.size];
    return `<div class="mp"><p class="sub">How it looks in a Facebook or Instagram feed. Swipe or scroll the cards.</p><div class="mp-post">${head}
      <div class="mp-car">${slides().map((x, n) => `<div class="mp-card${x.kind === "sailing" && x.i === sel ? " on" : ""}"${x.kind === "sailing" ? ` data-sel="${x.i}"` : ""}><div class="mp-frame" style="aspect-ratio:${w}/${h}"><iframe data-slide="${n}" data-size="${ad.size}" title="Card ${n + 1}" tabindex="-1"></iframe></div>${foot(x)}</div>`).join("")}</div></div></div>`;
  }
  const c = ad.cards[0];
  return `<div class="mp mp-single"><div><p class="sub">Feed (4:5)</p><div class="mp-post">${head}
      <div class="mp-frame" style="aspect-ratio:1080/1350"><iframe data-card="0" data-size="4x5" title="Feed image" tabindex="-1"></iframe></div>${foot(c)}</div></div>
    <div><p class="sub">Feed (1:1)</p><div class="mp-post">${head}<div class="mp-frame" style="aspect-ratio:1"><iframe data-card="0" data-size="1x1" title="Square image" tabindex="-1"></iframe></div>${foot(c)}</div></div>
    <div><p class="sub">Stories and Reels (9:16)</p><div class="mp-story"><div class="mp-frame" style="aspect-ratio:1080/1920"><iframe data-card="0" data-size="9x16" title="Story image" tabindex="-1"></iframe></div>
      <div class="mp-story-top"><span class="mp-av">A</span> Ambassador Cruise Line <span class="sub">Sponsored</span></div><div class="mp-story-cta">${esc(ad.cta)}</div></div></div></div>`;
}

// Live card previews: each iframe renders the full-size card and is scaled to fit its box.
let paintT = 0;
function paintCards(){
  clearTimeout(paintT);
  const sl = slides();
  paintT = setTimeout(() => root.querySelectorAll("iframe[data-card],iframe[data-slide]").forEach(async f => {
    const x = f.dataset.slide != null ? sl[+f.dataset.slide] : sl.find(y => y.kind === "sailing" && y.i === +f.dataset.card); if (!x) return;
    const [w, h] = SIZES[f.dataset.size], box = f.parentElement;
    f.style.cssText = `width:${w}px;height:${h}px;border:0;transform-origin:0 0;transform:scale(${box.clientWidth / w});pointer-events:none`;
    f.srcdoc = x.doc(f.dataset.size);
    f.onload = () => f.contentWindow.ready && f.contentWindow.ready();
  }), 150);
}
new ResizeObserver(() => root && root.querySelectorAll("iframe[data-card],iframe[data-slide]").forEach(f => {
  const [w] = SIZES[f.dataset.size]; if (f.parentElement) f.style.transform = `scale(${f.parentElement.clientWidth / w})`;
})).observe(document.body);

function counts(){
  const set = (id, n, max) => { const e = root.querySelector("#cnt-" + id); if (e) { e.textContent = `${n}/${max}`; e.classList.toggle("over", n > max); } };
  set("primary", ad.primary.length, LIMITS.primary);
  const c = ad.cards[sel];
  if (c) { set("headline", (c.headline || "").length, LIMITS.headline); set("description", (c.description || "").length, LIMITS.description); }
}

// ---------- events ----------
function wire(){
  const $ = s => root.querySelector(s), c = ad.cards[sel];
  const change = (repaint = true, redraw = false) => { save(); if (redraw) draw(); else { if (repaint) paintCards(); refreshText(); counts(); } };
  root.querySelectorAll("[data-format]").forEach(b => b.addEventListener("click", () => { ad.format = b.dataset.format; change(true, true); }));
  $("#ac-size") && $("#ac-size").addEventListener("change", e => { ad.size = e.target.value; change(true, true); });
  const find = $("#ac-find"), res = $("#ac-results");
  find.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    if (q.length < 2) { res.innerHTML = ""; return; }
    const hits = live().filter(([id, r]) => [id, r.title, r.base_title, r.port, r.flight_from, r.ship].join(" ").toLowerCase().includes(q))
      .sort((a, b) => a[1].departure_date.localeCompare(b[1].departure_date)).slice(0, 8);
    res.innerHTML = hits.length ? hits.map(([id, r]) => `<button type="button" data-add="${esc(id)}"${ad.cards.some(x => x.id === id) ? " disabled" : ""}><b>${esc(r.flight_from ? r.base_title : r.title)}</b><span class="sub">${esc(id)} · ${fmtDate(r.departure_date)} · ${r.flight_from ? "Fly from " + esc(r.flight_from) : esc(r.port)} · ${money(r.segments[r.segments.length - 1].p)}</span></button>`).join("")
      : `<p class="sub">No sailings on sale match.</p>`;
  });
  res.addEventListener("click", e => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    if (ad.format === "single") ad.cards = [];
    if (ad.cards.length >= maxSailings()) return;
    ad.cards.push(newCard(b.dataset.add)); sel = ad.cards.length - 1; change(true, true);
    root.querySelector("#ac-find").focus();
  });
  root.querySelectorAll(".ac-pick").forEach(b => b.addEventListener("click", () => { sel = +b.dataset.i; draw(); }));
  root.querySelectorAll("[data-sel]").forEach(b => b.addEventListener("click", () => { if (sel !== +b.dataset.sel) { sel = +b.dataset.sel; draw(); } }));
  const move = (i, j) => { const [x] = ad.cards.splice(i, 1); ad.cards.splice(j, 0, x); sel = j; change(true, true); };
  root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
  root.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(+b.dataset.down, +b.dataset.down + 1)));
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { ad.cards.splice(+b.dataset.del, 1); sel = Math.max(0, Math.min(sel, ad.cards.length - 1)); change(true, true); }));
  let dragFrom = null;
  root.querySelectorAll(".ac-list li").forEach(li => {
    li.addEventListener("dragstart", () => { dragFrom = +li.dataset.i; li.classList.add("drag"); });
    li.addEventListener("dragover", e => e.preventDefault());
    li.addEventListener("drop", e => { e.preventDefault(); if (dragFrom !== null && dragFrom !== +li.dataset.i) move(dragFrom, +li.dataset.i); dragFrom = null; });
  });
  $("#ac-primary").addEventListener("input", e => { ad.primary = e.target.value; change(false); });
  root.querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => {
    ad.primary = sugg[+b.dataset.use].text; $("#ac-primary").value = ad.primary; change(false);
    $("#ac-primary").focus();
  }));
  $("#ac-cta").addEventListener("change", e => { ad.cta = e.target.value; change(false); });
  $("#ac-clear").addEventListener("click", () => { if (confirm("Remove every card and the ad text?")) { ad = {...ad, primary: "", cards: []}; sel = 0; change(true, true); } });
  $("#ac-zip").addEventListener("click", download);
  $("#ac-video").addEventListener("click", makeVideo);
  root.querySelectorAll("[data-dup]").forEach(b => b.addEventListener("click", () => {
    const i = +b.dataset.dup; if (ad.cards.length >= maxSailings()) return;
    ad.cards.splice(i + 1, 0, JSON.parse(JSON.stringify(ad.cards[i]))); sel = i + 1; change(true, true);
  }));
  const done = () => { note = ""; };
  $("#dr-save") && $("#dr-save").addEventListener("click", () => saveDraft(false));
  $("#dr-saveas") && $("#dr-saveas").addEventListener("click", () => saveDraft(true));
  $("#dr-link") && $("#dr-link").addEventListener("click", copyLink);
  $("#dr-new") && $("#dr-new").addEventListener("click", () => {
    if (ad.cards.length && !draftId && !confirm("Start a new ad? This one isn't saved.")) return;
    draftId = null; ad = fresh(); sel = 0; done(); save(); draw();
  });
  const pick = () => $("#dr-list").value;
  $("#dr-open") && $("#dr-open").addEventListener("click", () => { const d = drafts()[pick()]; if (!d) return; draftId = pick(); load(d.ad, `Opened "${d.name}"`); });
  $("#dr-ren") && $("#dr-ren").addEventListener("click", () => { const all = drafts(), d = all[pick()]; const n = d && prompt("New name", d.name); if (!n) return; d.name = n; storeDrafts(all); draw(); });
  $("#dr-del") && $("#dr-del").addEventListener("click", () => { const all = drafts(), id = pick(); if (!all[id] || !confirm(`Delete "${all[id].name}"?`)) return; delete all[id]; storeDrafts(all); if (draftId === id) draftId = null; note = "Deleted."; draw(); });
  root.querySelectorAll("[data-strip]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation(); const x = ad.cards[+b.dataset.i];
    setStrip(x, b.dataset.strip, b.getAttribute("aria-pressed") !== "true"); change(true, true);
  }));
  root.querySelectorAll("[data-all]").forEach(b => b.addEventListener("click", () => {
    const [k, v] = b.dataset.all.split(":"); ad.cards.forEach(x => setStrip(x, k, v === "1")); change(true, true);
  }));
  const bind = (id, obj, key, redraw) => { const e = $(id); if (!e) return;
    e.addEventListener(e.type === "checkbox" ? "change" : "input", () => { obj[key] = e.type === "checkbox" ? e.checked : e.value; change(true, redraw); }); };
  bind("#in-on", ad.intro, "on", true); bind("#en-on", ad.end, "on", true);
  bind("#in-a", ad.intro, "useA"); bind("#en-a", ad.end, "useA");
  for (const [id, k] of [["#in-eyebrow", "eyebrow"], ["#in-headline", "headline"], ["#in-cta", "cta"], ["#in-mh", "mHeadline"], ["#in-md", "mDesc"], ["#in-link", "link"]]) bind(id, ad.intro, k);
  for (const [id, k] of [["#en-headline", "headline"], ["#en-cta", "cta"], ["#en-url", "url"], ["#en-mh", "mHeadline"], ["#en-md", "mDesc"], ["#en-link", "link"]]) bind(id, ad.end, k);
  // Turning a brand card on can push the carousel over Meta's 10 cards: drop sailings from the end.
  if (ad.cards.length > maxSailings()) { ad.cards.length = maxSailings(); sel = Math.min(sel, ad.cards.length - 1); save(); }
  if (!c) return;
  $("#ac-design").addEventListener("change", e => { c.design = e.target.value; c.words = null; change(true, true); });
  root.querySelectorAll("[data-photo]").forEach(b => b.addEventListener("click", () => { c.photo = b.dataset.photo; delete c.uploadLost; change(true, true); }));
  $("#ac-upload").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { const k = "upload:" + (++upN); uploads[k] = rd.result; c.photo = k; delete c.uploadLost; change(true, true); };
    rd.readAsDataURL(f);
  });
  const words = () => {
    c.words = c.design.startsWith("wasnow:") ? {title: $("#w-title").value} : {kicker: $("#w-kicker").value, headline: $("#w-headline").value || " ", sub: $("#w-sub").value};
    change();
  };
  root.querySelectorAll("#w-title,#w-kicker,#w-headline,#w-sub").forEach(i => i.addEventListener("input", words));
  $("#w-reset").addEventListener("click", () => { c.words = null; change(true, true); });
  const s = sailing(c.id);
  $("#ac-nectar") && $("#ac-nectar").addEventListener("change", e => { c.nectar = e.target.checked; c.promos = (c.promos || []).slice(0, c.nectar || c.trustpilot ? 1 : 2); change(true, true); });
  $("#ac-tp-style") && $("#ac-tp-style").addEventListener("change", e => { c.trustpilot = e.target.value; change(true, true); });
  $("#ac-tp") && $("#ac-tp").addEventListener("change", e => { c.trustpilot = e.target.checked ? TP.images[0].file : ""; c.promos = (c.promos || []).slice(0, c.nectar || c.trustpilot ? 1 : 2); change(true, true); });
  root.querySelectorAll("[data-promo]").forEach(b => b.addEventListener("change", () => {
    const p = s.k.promos[+b.dataset.promo], max = c.nectar || c.trustpilot ? 1 : 2;
    c.promos = (c.promos || []).filter(x => x !== p);
    if (b.checked) { c.promos.push(p); while (c.promos.length > max) c.promos.shift(); }   // the newest pick wins
    c.promos = s.k.promos.filter(x => c.promos.includes(x));                               // shown best first
    change(true, true);
  }));
  $("#m-headline").addEventListener("input", e => { c.headline = e.target.value; change(false); });
  $("#m-desc").addEventListener("input", e => { c.description = e.target.value; change(false); });
  $("#m-link").addEventListener("input", e => { c.link = e.target.value.trim(); change(false); });
}

// Text-only changes update the preview without re-rendering the cards.
function refreshText(){
  const pv = root.querySelector(".ac-main"); if (!pv) return;
  const tmp = document.createElement("div"); tmp.innerHTML = preview();
  pv.querySelectorAll(".mp-text").forEach((e, i) => e.innerHTML = tmp.querySelectorAll(".mp-text")[i].innerHTML);
  pv.querySelectorAll(".mp-foot").forEach((e, i) => { const t = tmp.querySelectorAll(".mp-foot")[i]; if (t) e.innerHTML = t.innerHTML; });
  const cta = pv.querySelector(".mp-story-cta"); if (cta) cta.textContent = ad.cta;
}

// ---------- video layers (used by the GitHub "Make video" job, make_video.py) ----------
// Each slide as two transparent-free PNG layers at 2x: the background (photo, campaign artwork or
// the brand pattern, which slowly zooms) and the foreground (logo, badge, strips, words, which fade in).
// visibility:hidden keeps the layout exactly as on the card.
const LAYER_CSS = {
  bg: "#card > :not(.photo):not(.art):not(.artbg):not(.scrim){visibility:hidden!important}",
  fg: "html,body,#card{background:transparent!important;background-image:none!important}.photo,.art,.artbg,.scrim{visibility:hidden!important}",
};
async function layer(html, size, pass){
  const [w, h] = SIZES[size], f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${w + 50}px;top:0;width:${w}px;height:${h}px;border:0`;
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = html.replace("</head>", `<style>${LAYER_CSS[pass]}</style></head>`); });
    await f.contentWindow.ready();
    return await f.contentWindow.htmlToImage.toPng(f.contentWindow.document.getElementById("card"), {pixelRatio: 2, cacheBust: false});
  } finally { f.remove(); }
}
window.__spwVideo = {
  info: () => ({slides: slides().map(x => ({kind: x.kind, title: x.title})), primary: ad.primary, cta: ad.cta, until: validUntil(), prices: today}),
  layers: async size => { const out = []; for (const x of slides()) { const html = x.doc(size); out.push({kind: x.kind, bg: await layer(html, size, "bg"), fg: await layer(html, size, "fg")}); } return out; },
};

// ---------- download ----------
const loadZip = () => window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, bad) => {
  const sc = document.createElement("script");
  sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  sc.onload = () => ok(window.JSZip); sc.onerror = () => bad(new Error("couldn't load the zip tool"));
  document.head.appendChild(sc);
});

async function renderJpeg(html, size){
  const [w, h] = SIZES[size], f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${w + 50}px;top:0;width:${w}px;height:${h}px;border:0`;
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = html; });
    await f.contentWindow.ready();
    const url = await f.contentWindow.toJpeg();
    return await (await fetch(url)).blob();
  } finally { f.remove(); }
}

async function download(){
  const st = root.querySelector("#ac-status"), btn = root.querySelector("#ac-zip");
  btn.disabled = true;
  try {
    const JSZip = await loadZip(), zip = new JSZip();
    const sizes = ad.format === "carousel" ? [ad.size] : ["1x1", "4x5", "9x16"];
    const files = [], sl = slides();
    let n = 0;
    for (const [i, x] of sl.entries()) for (const size of sizes) {
      st.textContent = `Making card ${++n} of ${sl.length * sizes.length}…`;
      const name = `${String(i + 1).padStart(2, "0")}_${x.name}_${size}.jpg`;
      zip.file(name, await renderJpeg(x.doc(size), size)); files.push([i, name]);
    }
    zip.file("ad_text.txt", adText(files));
    zip.file("cards.csv", csv(files));
    zip.file("HOW_TO_UPLOAD.md", howTo(files));
    st.textContent = "Zipping…";
    const blob = await zip.generateAsync({type: "blob"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ad_${ad.format}_${ad.cards.map(c => c.id).slice(0, 3).join("-")}${ad.cards.length > 3 ? "-etc" : ""}_${today}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    st.textContent = `Downloaded. Prices as checked ${fmtDate(today)}.`;
  } catch (e) {
    st.textContent = `Couldn't make the zip: ${e.message}`;
  } finally { btn.disabled = false; }
}

const validUntil = () => {
  const ends = ad.cards.map(c => c.design.startsWith("wasnow:") && (claims(c.id).find(x => x.key === c.design.slice(7)) || {}).ends).filter(Boolean).sort();
  return ends[0] || null;
};

function adText(files){
  const L = [`Ambassador Cruise Line ${ad.format === "carousel" ? "carousel" : "single image"} ad`, `Prices as checked ${fmtDate(today)}.`, "",
             "PRIMARY TEXT", ad.primary || "(none yet)", "", "CALL TO ACTION BUTTON", ad.cta, ""];
  slides().forEach((x, i) => {
    L.push(`CARD ${i + 1}: ${x.title}`, `Image: ${files.filter(f => f[0] === i).map(f => f[1]).join(", ")}`,
           `Headline: ${x.headline}`, `Description: ${x.description}`, `Website URL: ${x.link}`, "");
  });
  return L.join("\n");
}

function csv(files){
  const cell = v => { let x = v == null ? "" : String(v); if (/^[=+\-@]/.test(x)) x = "'" + x; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const rows = [["Order", "Cruise code", "Sailing", "Departs", "Design", "Price on card", "Was", "Use until", "Headline", "Description", "Link", "Files"]];
  slides().forEach((x, i) => {
    const fl = files.filter(f => f[0] === i).map(f => f[1]).join(" ");
    if (x.kind !== "sailing") { rows.push([i + 1, "", x.title, "", x.kind === "intro" ? "Opening" : "Closing", "", "", "", x.headline, x.description, x.link, fl]); return; }
    const c = x.c, d = cardData(c), s = sailing(c.id), cl = c.design.startsWith("wasnow:") ? claims(c.id).find(y => y.key === c.design.slice(7)) : null;
    rows.push([i + 1, c.id, s.title, s.r.departure_date, cl ? "Was/now" : "Standard", d.wasnow ? d.wasnow.now : d.price, cl ? cl.was : "", cl ? cl.ends : "",
               c.headline, c.description, c.link, fl]);
  });
  return "﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n");
}

function howTo(files){
  const carousel = ad.format === "carousel", until = validUntil();
  return [`# How to upload this ${carousel ? "carousel" : "single image"} ad`, "",
    `Made in the Sailing price watch ad creator. Prices are as checked on ${fmtDate(today)}: check the tracker before`,
    `the ad goes live, and pause it if a price on a card changes.${until ? ` **Was/now cards in this ad must stop running by ${fmtDate(until)}.**` : ""}`, "",
    "Nothing has been sent to Meta. Follow these steps in Meta Ads Manager:", "",
    "1. Open your campaign and ad set, then click **+ Create** (or edit an existing ad).",
    `2. Under **Ad setup**, choose **Create ad** and format **${carousel ? "Carousel" : "Single image or video"}**.`,
    carousel
      ? `3. Under **Carousel cards**, add ${slides().length} cards and fill them in **in this order**:\n` +
        slides().map((x, i) => `   - Card ${i + 1}${x.kind === "sailing" ? "" : ` (${x.title.toLowerCase()})`}: image \`${files.find(f => f[0] === i)[1]}\`, headline "${x.headline}", description "${x.description}", website URL ${x.link}`).join("\n")
      : `3. Under **Media**, click **Add media → Add image** and upload \`${files.find(f => f[1].endsWith("_4x5.jpg"))[1]}\` for Feeds and \`${files.find(f => f[1].endsWith("_9x16.jpg"))[1]}\` for Stories and Reels (use **Select images for placements**). The 1:1 version is for Right column and Marketplace if you use them.`,
    `4. **Primary text**: paste it from \`ad_text.txt\`.`,
    carousel ? "5. Leave **Show the best performing cards first** off if the order matters (it usually does)." : `5. **Headline** "${ad.cards[0].headline}", **Description** "${ad.cards[0].description}", **Website URL** ${ad.cards[0].link}.`,
    `6. **Call to action**: ${ad.cta}.`,
    "7. Check the preview on Facebook and Instagram placements, then publish (or send for approval as usual).", "",
    "Files:", ...files.map(f => `- ${f[1]}`), "- ad_text.txt: every piece of text, ready to paste", "- cards.csv: what is on each card", ""].join("\n");
}
