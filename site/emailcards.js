// Email cards (Sam, 13 Oct 2026): just the sailing pictures for HubSpot emails, made the way the team's own
// are (e.g. "Kirkwall, Scotland - Standard (OBC200).png" in the Friday round-up): Standard 1200 × 924 for the
// 3-across tiles and Wide 2400 × 924 for full-width sailings, PNG, the sailing's photo with its offer badges
// (orange, top right, stacked) and a location caption (dark, bottom left). Plus the words that go under each
// picture in the email (name, date, nights and port, ship, "From £Xpp", link), so they can be pasted in.
// Prices, dates, ships and offers come from the tracker's saved data; "Lower fares" offers never reach the
// badges (cards_sync adkit). Everything is made in the browser; nothing is sent anywhere. Sets of cards can be saved
// by name to the team's shared list (Sam, 15 Oct 2026), as in the Ad creator.
import * as cs from "./sections.js?v=__BUILD__";
import {cropUrl, frMoney, frDate} from "./adcards.js?v=__BUILD__";
import {openSaved, sharedStore} from "./saved.js?v=__BUILD__";
// France (Sam, 14 Oct 2026, stage 3): mount(…, {market: "fr"}) makes the same cards in French and euros for Ambassador
// Croisières ("À partir de 679 €/pers.", "7 nuits au départ de Marseille", French cabin grades), links to the sailing's page
// (the French booking site has no deep link), captions suggested from the page's own photo captions. Own draft.
let FR = false;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = v => FR ? frMoney(v) : "£" + Math.round(v).toLocaleString("en-GB");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const shortDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
let KEY = "spw-email-cards";
const MAX = 50;   // several cards at once again (Sam, 13 Oct 2026, after a day of one at a time); 24 → 50 (Sam, 15 Oct 2026)
const ZIP_PICS = 60;   // pictures a zip: more are split into parts, so the browser never holds hundreds of large PNGs at once
// Sizes and type measured from the team's HubSpot pictures (13 Oct 2026)
const SIZES = {standard: {label: "Standard", note: "1200 × 924, for 3-across tiles", w: 1200, h: 924, badge: 44, cap: 46},
               wide: {label: "Wide", note: "2400 × 924, for full-width sailings", w: 2400, h: 924, badge: 44, cap: 46}};

let ID = null, S, KIT, CAB = {}, T = null, root, today, st = fresh(), sel = 0, note = "";
// Saved card sets (Sam, 15 Oct 2026: "map out each email send … save functionality similar to the meta ads builder"):
// named sets in the team's shared saved list (saved.js sharedStore, kind "ecards"), as the Ad creator and Email creator
let store = null, draftId = null;
const DRAFTS = "spw-email-cards-sets";   // this browser only, if the shared list can't be reached
// Download names start with the saved set's name, so each email send's CSV and zip are easy to tell apart
const fileBase = () => { const d = draftId && drafts()[draftId]; const n = d ? d.name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return `${n ? n + "_" : ""}email-cards_${FR ? "fr_" : ""}${today}`; };
function fresh(){ return {items: [], allBadges: false, sizes: {standard: true, wide: true}, kinds: {card: true, pic: false}}; }
// What to make (Sam, 13 Oct 2026: "the whole card to pop into HubSpot"): the whole card (picture, words and
// price button, as in the emails, one PNG) and/or the picture on its own. Outputs are "<size>" or "<size>-card".
const KINDS = {card: {label: "Whole card", note: "picture, words and price button in one PNG"}, pic: {label: "Picture only", note: "for building the card in HubSpot"}};
const outputs = () => Object.keys(SIZES).filter(k => st.sizes[k]).flatMap(k => [...(st.kinds.card ? [k + "-card"] : []), ...(st.kinds.pic ? [k] : [])]);
const outLabel = o => SIZES[o.split("-")[0]].label + (o.endsWith("-card") ? " card" : " picture");

export async function mount(el, ctx){
  root = el; ID = ctx.idToken || null; S = ctx.state; KIT = (ctx.adkit && ctx.adkit.sailings) || {}; today = S.updated;
  FR = ctx.market === "fr";
  if (FR) { KEY = "spw-email-cards-fr"; GRADES = GRADES_FR; }
  CAB = (ctx.cabins && ctx.cabins.sailings) || ctx.cabins || {};   // index.html passes the sailings map
  T = ctx.terms || null;   // promotion T&Cs read from the website (terms.py)
  // The saved list loads in the background (it can take a few seconds when its function has been idle): the page
  // draws at once and the saved bar says "Loading saved card sets…" until it arrives (15 Oct 2026)
  store = sharedStore({kind: "ecards", localKey: DRAFTS, field: "cards", idToken: ID});
  store.load().then(() => { if (draftId && !store.all()[draftId]) { draftId = null; save(); } draw(); });
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && Array.isArray(d.items)) {
      const n = normalise(d); st = n.st; draftId = d._draft || null;
      if (n.msgs.length) { note = esc(`Since these cards were last open: ${n.msgs.join("; ")}.`); save(); }
    }
  } catch(e){}
  draw();
  if (ctx.add) addSailing(ctx.add);
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({...st, _draft: draftId})); } catch(e){} };

// Brings saved or draft cards up to date: sailings no longer on sale dropped, ended offer badges removed, ended was/now
// prices back to "From", sold-out cabin choices noted (the card already falls back to the cheapest). `issues` are the
// short forms the Saved list shows before a set is opened.
function normalise(d){
  const out = {...fresh(), ...d, kinds: {...fresh().kinds, ...(d.kinds || {})}, sizes: {...fresh().sizes, ...(d.sizes || {})}};
  delete out._draft; delete out.market;
  const items = Array.isArray(d.items) ? d.items : [], gone = items.filter(it => !sailing(it.id));
  let badges = 0, wasnow = 0, cabins = 0;
  out.items = items.filter(it => sailing(it.id)).slice(0, MAX).map(it => {
    const promos = [...campaignBadges(d), ...(sailing(it.id).k.promos || [])], keep = (it.badges || []).filter(b => promos.includes(b));
    badges += (it.badges || []).length - keep.length;
    const x = {...it, badges: keep};
    if (x.wasnow && !claimOf(x)) { x.wasnow = ""; wasnow++; }
    if (x.grade && !x.wasnow && onSale(x.id, x.fare === "solo" ? "solo" : "twin")[x.grade] == null) cabins++;
    return x;
  });
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const msgs = [gone.length && `${n(gone.length, "sailing", "sailings")} no longer on sale removed`,
    badges && `${n(badges, "offer badge", "offer badges")} for ended offers removed`,
    wasnow && `${n(wasnow, "was/now price", "was/now prices")} back to "From" (the claim has ended)`,
    cabins && `${n(cabins, "cabin choice", "cabin choices")} sold out, so the card uses the cheapest`].filter(Boolean);
  const issues = [gone.length && `${n(gone.length, "sailing", "sailings")} no longer on sale`, badges && `${n(badges, "offer", "offers")} ended`,
    wasnow && "was/now ended", cabins && `${n(cabins, "cabin choice", "cabin choices")} sold out`].filter(Boolean);
  return {st: out, msgs, issues};
}
function load(d, msg){
  const n = normalise(d); st = n.st; sel = 0;
  note = esc([msg, ...n.msgs].filter(Boolean).join(". ") + ".");
  save(); draw();
}

// ---------- saved card sets (shared list; this browser only if it can't be reached) ----------
const drafts = () => store ? Object.fromEntries(Object.entries(store.all()).filter(([, d]) => d.cards && ((d.cards.market === "fr") === FR))) : {};
const portable = () => { const c = JSON.parse(JSON.stringify(st)); return FR ? {...c, market: "fr"} : c; };
async function saveDraft(asNew){
  const all = drafts();
  const id = asNew || (draftId && !store.mine(draftId)) ? null : draftId;   // someone else's: save your own copy
  let name = id && all[id] ? all[id].name : "";
  if (!id) {
    const first = st.items[0] && sailing(st.items[0].id);
    name = prompt(asNew ? "Name the copy" : "Name this set of cards (e.g. the email send it's for)",
      asNew && draftId && all[draftId] ? `${all[draftId].name} (copy)` : first ? `${first.title}${st.items.length > 1 ? ` + ${st.items.length - 1} more` : ""}` : "Email send");
    if (!name || !name.trim()) return;
    name = name.trim();
  }
  try { draftId = await store.save(id, name, portable()); note = esc(`Saved "${name}"${store.shared ? "" : " in this browser"}.`); }
  catch(e) { note = esc(`Couldn't save: ${e.message}`); }
  save(); draw();
}
function draftsBlock(){
  if (!store || store.loading) return `<div class="ac-block"><p class="sub" style="margin:0">Loading saved card sets…</p></div>`;
  const all = drafts(), ids = Object.keys(all);
  const cur = draftId && all[draftId], mine = cur && store.mine(draftId), oldHere = Object.keys(store ? store.localOnly() : {}).length;
  const stale = ids.filter(id => normalise(all[id].cards).issues.length).length;
  return `<div class="ac-block">
    <h3>${cur ? esc(cur.name) : "Unsaved set of cards"}</h3>
    ${cur && !mine ? `<p class="sub" style="margin:0 0 6px">Saved by ${esc(cur.by)}. Save a copy to keep your own changes.</p>` : ""}
    <div class="ac-row">
      ${cur && !mine ? "" : `<button type="button" class="btn quiet sm" id="sv-save"${st.items.length ? "" : " disabled"}>${cur ? "Save" : "Save as…"}</button>`}
      ${cur ? `<button type="button" class="btn quiet sm" id="sv-saveas">Save a copy…</button>` : ""}
      <button type="button" class="btn quiet sm" id="sv-new">New set</button>
    </div>
    ${ids.length ? `<button type="button" class="btn quiet sm sv-open" id="sv-browse">Saved card sets (${ids.length})${stale ? ` · ${stale} need${stale === 1 ? "s" : ""} updating` : ""}</button>` : ""}
    ${store && store.problem ? `<p class="ac-note">${esc(store.problem)}</p>` : ""}
    ${oldHere ? `<p class="sub" style="margin:8px 0 0">${oldHere} set${oldHere === 1 ? " is" : "s are"} saved in this browser only. <button type="button" class="linkbtn" id="sv-move">Move ${oldHere === 1 ? "it" : "them"} to the shared list</button></p>` : ""}
  </div>`;
}
function wireDrafts(){
  const $ = q => root.querySelector(q);
  $("#sv-save") && $("#sv-save").addEventListener("click", () => saveDraft(false));
  $("#sv-saveas") && $("#sv-saveas").addEventListener("click", () => saveDraft(true));
  $("#sv-new") && $("#sv-new").addEventListener("click", () => {
    if (st.items.length && !draftId && !confirm("Start a new set? These cards aren't saved.")) return;
    draftId = null; st = fresh(); sel = 0; note = ""; save(); draw();
  });
  $("#sv-move") && $("#sv-move").addEventListener("click", async () => {
    try { const n = await store.moveLocal(); note = esc(`Moved ${n} saved set${n === 1 ? "" : "s"} to the shared list.`); draftId = null; }
    catch(e) { note = esc(`Couldn't move them: ${e.message}`); }
    save(); draw();
  });
  $("#sv-browse") && $("#sv-browse").addEventListener("click", () => {
    const all = drafts();
    openSaved({title: "Saved card sets", noun: "set of cards", current: draftId,
      note: store.shared ? "Shared with everyone on the tracker. You can open or copy anyone's; only your own can be changed." : "",
      items: Object.entries(all).map(([id, d]) => {
        const xs = d.cards.items || [], x0 = xs.find(x => sailing(x.id)), first = x0 && sailing(x0.id);
        const photo = x0 && x0.photo && first.photos.includes(x0.photo) ? x0.photo : first && first.image;
        return {id, name: d.name, saved_at: d.saved_at, count: xs.length, thumb: photo ? cropUrl(photo, 120, 90) : "",
                by: d.by || "", mine: store.mine(id), issues: normalise(d.cards).issues,
                detail: [...new Set(xs.map(x => (sailing(x.id) || {title: x.id}).title))].join(" · ")};
      }),
      onOpen: id => { const d = drafts()[id]; if (!d) return; draftId = id; load(d.cards, `Opened "${d.name}"`); },
      onCopy: async id => {
        const d = drafts()[id]; if (!d) return;
        try { const name = `${d.name} (copy)`; draftId = await store.save(null, name, JSON.parse(JSON.stringify(d.cards))); load(d.cards, `Made a copy: "${name}"`); }
        catch(e) { note = esc(`Couldn't copy: ${e.message}`); draw(); }
      },
      onRename: async (id, name) => { try { await store.rename(id, name); } catch(e) { alert(`Couldn't rename: ${e.message}`); } draw(); },
      onDelete: async id => { try { await store.remove(id); if (draftId === id) { draftId = null; save(); } } catch(e) { alert(`Couldn't delete: ${e.message}`); } draw(); },
    });
  });
}
// "Make email card" from a sailing's detail view (Sam, 13 Oct 2026)
export function addSailing(id){
  const s = sailing(id);
  if (!s) { note = `${id} isn't on sale.`; return draw(); }
  const have = st.items.findIndex(x => x.id === id);
  if (have >= 0) { sel = have; note = `${s.title} is already here.`; return draw(); }
  if (st.items.length >= MAX) { note = `Up to ${MAX} sailings at once.`; return draw(); }
  st.items.push({id, photo: pickPhoto(s), caption: "", name: "", badges: [], fare: "twin", grade: ""}); sel = st.items.length - 1;
  note = `Added ${s.title}.`; save(); draw();
}

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
// T&Cs for the offer badges on a card (Sam, 13 Oct 2026: "download promo T&Cs for any promotions featured on
// the email card"). A badge line starts with the promotion's name (render_cards.py promo_lines); its terms
// are the ones terms.py matched to that promotion on the website.
function badgeTerms(it){
  const r = sailing(it.id).r, offers = S.offers || {};
  const live = Object.entries(r.promos || {}).filter(([, sp]) => sp.length && sp[sp.length - 1][1] == null).map(([o]) => o);
  return badgesOf(it).map(b => {
    if (campaignBadges(st).includes(b)) return {badge: b, docs: st.campaign.terms ? [{title: `${st.campaign.name || "Campaign"} offer terms (from the campaign brief)`, text: st.campaign.terms, pages: []}] : []};
    // Names compared without emoji, asterisks or case (France's tags: "🚢 Larguez les amarres" on the site, "Larguez les amarres" on cards)
    const key = t => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}%£€=+-]+/gu, " ").trim();
    const name = key(badgeText(b));
    const oid = live.find(o => key(offers[o] && offers[o].name) === name);
    const docs = oid && T && T.offers ? (T.offers[oid] || []).map(i => T.docs[i]).filter(Boolean) : [];
    return {badge: badgeText(b), docs, byName: !!(oid && T && T.how && T.how[oid] === "name")};
  });
}
// Everything about the cards, one row each (Sam, 13 Oct 2026): also cards.csv in the zip.
function csvText(){
  const sizes = outputs();
  const rows = [["#", "Cruise code", "Name", "Departure date", "Nights", "Departs from", "Ship", "Fare", "Cabin", FR ? "Price €" : "Price £",
    "Button", FR ? "Was €" : "Was £", "Was/now use until", "Link", "Sailing page link", "Booking link", "Location caption", "Offer badges", "Offer T&Cs on the website", "Photo", ...sizes.map(o => outLabel(o) + " file"), "Prices as checked"]];
  st.items.forEach((it, i) => {
    const s = sailing(it.id), f = fareOf(it), w = words(it), tc = badgeTerms(it);
    rows.push([i + 1, it.id, s.title, s.r.departure_date, s.r.nights, s.fly ? s.fly + " Airport" : s.r.port, s.r.ship,
      f.fare === "solo" ? "Solo" : "Twin", f.grade ? GRADES[f.grade] : "Cheapest available", f.price ?? "", w.button, f.claim ? f.claim.was : "", w.until, w.link, w.pageLink, w.bookingLink,
      it.caption, badgesOf(it).join("; "), tc.map(x => `${x.badge}: ${x.docs.length ? x.docs.map(d => d.title).join(", ") : "none found"}`).join("; "),
      it.photo || s.image, ...sizes.map(o => fileName(it, o)), today]);
  });
  return "\ufeff" + rows.map(r => r.map(v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; }).join(",")).join("\r\n");
}
function termsText(it){
  const w = words(it), list = badgeTerms(it);
  const head = [`Offer T&Cs for the email card: ${w.title} (${it.id}), ${w.date}`,
    T ? `Read from ${FR ? "ambassadorcroisieres.fr" : "ambassadorcruiseline.com"} ${T.fetched_at.slice(0, 16).replace("T", " ")} UTC. Check the wording on the website before using it.` : "", ""];
  return [...head, ...list.flatMap(x => [x.badge.toUpperCase(), "",
    ...(x.docs.length ? x.docs.flatMap(d => [(/^[a-z:,.£]/.test(d.text) ? `${d.title} ${d.text.replace(/^:\s*/, "")}` : `${d.title}\n${d.text}`),
                                           `(From ${d.pages[0]}${d.pages.length > 1 ? ` and ${d.pages.length - 1} more page${d.pages.length > 2 ? "s" : ""}` : ""})`, ""])
      : [`No terms for this promotion were found on the website. General booking terms: ${(T && T.general) || (FR ? "https://www.ambassadorcroisieres.fr/information/conditions-particulieres" : "https://www.ambassadorcruiseline.com/information/terms-conditions/")}`, ""]),
    ...(x.byName ? ["(Matched by a word in the promotion's name: check these are the right terms.)", ""] : [])])].join("\n");
}
const badgesOf = it => st.allBadges ? badgeOptions(it.id).slice(0, 2) : it.badges;
// A set made by the Campaign builder (site/campaign.js, 17 Oct 2026) carries its campaign's offer as a badge that may not
// be on the website yet (the campaign hasn't started): st.campaign {name, badge, terms, from, to}. It's offered first on
// every sailing and kept when the set is opened.
const campaignBadges = d => d && d.campaign && d.campaign.badge ? [d.campaign.badge] : [];
const badgeOptions = id => [...campaignBadges(st), ...(sailing(id).k.promos || []).filter(p => !campaignBadges(st).includes(p))];
// A place name from a photo's file name, offered as a caption to check
function captionHint(url, id){
  if ((url || "").startsWith("/ships/")) return "";   // the ship photo: no place name to suggest
  if (FR) { const caps = id ? (KIT[id] || {}).captions || {} : Object.assign({}, ...Object.values(KIT).map(k => k.captions || {})); return caps[url] || ""; }   // the page's own caption
  const f = decodeURIComponent((url || "").split("/").pop() || "").replace(/\.\w+$/, "");
  const junk = /^(\d+|\d+x\d+|x|shutterstock|istock|getty|adobe|stock|selected|edited|dsc\d*|img\d*|new|to|use|amb|xxx|cotw|final|v\d+|copy|web|hero|header|crop(ped)?|at|sunset|aerial|view|\d+-\d+-\d+)$/i;
  const words = f.split(/[\s_\-]+/).filter(w => w && !junk.test(w) && !/\d/.test(w));
  if (!words.length || words.length > 5) return "";
  return words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
const CAMPAIGN = /cotw|dig-|carousel|boom-radio|weekender|back_to_|no-logo|renaissance|ambience|ambition|_ship|ship_/i;
function pickPhoto(s){
  if (!s.k.campaign && !CAMPAIGN.test(s.image)) return s.image;
  return s.photos.find(u => u !== s.image && !CAMPAIGN.test(u) && captionHint(u, s.id)) || s.photos.find(u => u !== s.image && !CAMPAIGN.test(u)) || s.image;
}
// Fare and cabin (Sam, 13 Oct 2026): twin or solo, the cheapest cabin or a chosen grade. Prices are the
// tracker's saved per-grade prices (state/cabins.json "twin.<grade>" / "solo.<grade>", latest segment, not
// sold out); the twin "cheapest" is the sailing's own lead price. Never typed in.
let GRADES = {inside: "Inside", ocean_view: "Ocean view", balcony: "Balcony", suite: "Suite"};
const GRADES_FR = {inside: "Intérieure", obstructed: "Vue mer obstruée", ocean_view: "Vue mer", promenade: "Terrasse promenade", balcony: "Balcon", suite: "Suite", grand_suite: "Grande suite"};
function onSale(id, fare){   // {grade: price} on sale now
  const out = {};
  for (const [k, c] of Object.entries((CAB[id] || {}).cabins || {})) {
    const [f, g] = k.split(".");
    if (f === fare && GRADES[g] && !c.out && c.seg && c.seg.length) out[g] = c.seg[c.seg.length - 1].p;
  }
  return out;
}
// Was/now (Sam, 14 Oct 2026: option A of the mock-ups, chosen per card, never automatic): only a claim that is live
// today in the tracker's state (tracker.py claim_for, as the Ad creator and Email creator), with its own figures.
// The card then shows "was £X" struck through above a "Now £Ypp" button, twin, and goes back to "From" once it ends.
function claims(id){
  const s = sailing(id); if (!s) return [];
  const out = [], c = s.r.claim;
  if (c && c.eligible && c.ends >= today && c.now === s.price)
    out.push({key: "lead", label: "Lead price", was: c.was, now: c.now, ends: c.ends, grade: s.k.lead_grade || null});
  for (const [k, cc] of Object.entries((CAB[id] || {}).cabin_claims || {}))
    if (k.startsWith("twin.") && GRADES[k.slice(5)] && cc.eligible && cc.ends >= today)
      out.push({key: k, label: GRADES[k.slice(5)] + " cabins", was: cc.was, now: cc.now, ends: cc.ends, grade: k.slice(5)});
  return out;
}
const claimOf = it => it.wasnow ? claims(it.id).find(c => c.key === it.wasnow) || null : null;
function fareOf(it){   // {fare, grade, price, label, basis} for what's chosen, falling back if it's no longer on sale
  const c = claimOf(it);
  if (c) return {fare: "twin", grade: c.key === "lead" ? "" : c.grade, price: c.now, label: `Now ${money(c.now)}pp`, basis: "per person, based on two sharing", claim: c};
  // Solo with no solo cabin on sale falls back to twin, so a card never shows a twin price as "solo" (QA, 13 Oct 2026)
  const s = sailing(it.id), fare = it.fare === "solo" && Object.keys(onSale(it.id, "solo")).length ? "solo" : "twin", grades = onSale(it.id, fare);
  let grade = it.grade && grades[it.grade] != null ? it.grade : "", price;
  if (grade) price = grades[grade];
  else if (fare === "twin") price = s.price;
  else { const best = Object.entries(grades).sort((a, b) => a[1] - b[1])[0]; if (best) { price = best[1]; } }
  const basis = FR ? (fare === "solo" ? "pour une personne voyageant seule" : "par personne, base deux personnes")
    : fare === "solo" ? "for one guest travelling solo" : "per person, based on two sharing";
  if (price == null) return {fare, grade, price: null, label: "", basis};
  if (FR) return {fare, grade, price, basis, label: fare === "solo" ? `Solo${grade ? " " + GRADES[grade].toLowerCase() : ""} à partir de ${money(price)}`
                                                    : `${grade ? GRADES[grade] + " à" : "À"} partir de ${money(price)}/pers.`};
  const label = fare === "solo" ? `Solo ${grade ? GRADES[grade].toLowerCase() + " " : "pricing "}from ${money(price)}`
                                : `${grade ? GRADES[grade] + " from" : "From"} ${money(price)}pp`;
  return {fare, grade, price, label, basis};
}
// The words that go under the picture in the email, as in the team's emails
const pageLink = it => { const s = sailing(it.id), f = fareOf(it); return s.link + (f.fare === "solo" && !FR ? (s.link.includes("?") ? "&" : "?") + "solo=true" : ""); };
// Booking flow link (Sam, 13 Oct 2026): the one the sailing page's cabin "Book" buttons open (the site's CabinTypes
// handleBookingLink): book.ambassadorcruiseline.com with the cruise code, the cabin type (inner / outer / balcony /
// suite) and 2 adults, or 1 for a solo fare. It opens step 1 (Cabin) with these chosen. "Cheapest available" uses
// the grade that sets the from price for that fare. Tested 13 Oct 2026 in fresh browser sessions.
const BOOK_TYPE = {inside: "inner", ocean_view: "outer", balcony: "balcony", suite: "suite"};
function bookingLink(it){
  if (FR) return pageLink(it);   // the French booking site has no link that opens a sailing's cabins: the page does
  const f = fareOf(it), grades = onSale(it.id, f.fare);
  const grade = f.grade || Object.keys(GRADES).find(g => grades[g] != null && grades[g] === f.price) || Object.keys(GRADES).find(g => grades[g] != null) || "inside";
  return `https://book.ambassadorcruiseline.com/?cruiseCode=${encodeURIComponent(it.id)}&cabinType=${BOOK_TYPE[grade]}&numberOfAdults=${f.fare === "solo" ? 1 : 2}`;
}
function words(it){
  const s = sailing(it.id), f = fareOf(it);
  return {title: s.title.toUpperCase(), date: FR ? frDate(s.r.departure_date) : longDate(s.r.departure_date),
          // Cruise code under the ship (Sam, 15 Oct 2026: "add the cruise code to the email cards… just as text"; on the card itself)
          code: FR ? `Code croisière ${it.id}` : `Cruise code ${it.id}`,
          nights: FR ? `${s.r.nights} nuits au départ de ${String(s.r.port || "").split(",")[0].trim()}` : `${s.r.nights} nights departing ${s.fly ? s.fly + " Airport" : s.r.port}`, ship: s.r.ship,
          button: f.label || (FR ? `À partir de ${money(s.price)}/pers.` : `From ${money(s.price)}pp`), link: it.linkTo === "booking" ? bookingLink(it) : pageLink(it),
          pageLink: pageLink(it), bookingLink: bookingLink(it), basis: f.basis,
          was: f.claim ? `${f.claim.key !== "lead" ? f.claim.label + ": " : ""}was ${money(f.claim.was)}` : "", until: f.claim ? f.claim.ends : ""};
}
// File name in the team's style: "<Caption> - Standard (<offers>).png", or the cruise code when there's no caption
// A file name typed on the card (Sam, 13 Oct 2026) replaces all of that, keeping only the size and kind.
const cleanName = t => t.replace(/[\\/:*?"<>|]+/g, "").replace(/\.png$/i, "").trim().slice(0, 100);
function fileName(it, out){
  const size = out.split("-")[0], card = out.endsWith("-card");
  if (cleanName(it.name || "")) return `${cleanName(it.name)} - ${SIZES[size].label}${card ? " card" : ""}.png`;
  const base = (it.caption.trim() || `${it.id} ${sailing(it.id).title}`).replace(/[\\/:*?"<>|]+/g, "").slice(0, 60);
  const f = fareOf(it), fare = f.fare === "solo" || f.grade ? [`${f.grade ? GRADES[f.grade] + " " : ""}${f.fare}`.trim()] : [];
  const tags = [...(claimOf(it) ? ["Was-now"] : []), ...fare, ...badgesOf(it).map(badgeText)];
  return `${base} - ${SIZES[size].label}${card ? " card" : ""}${tags.length ? ` (${tags.join(", ").replace(/[\\/:*?"<>|]+/g, "").slice(0, 70)})` : ""}.png`;
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
    .c{position:absolute;left:0;bottom:0;background:rgba(27,27,32,.86);color:#fff;font-weight:600;font-size:${z.cap}px;line-height:1;padding:25px 75px 25px 40px;
      clip-path:polygon(0 0,calc(100% - 35px) 0,100% 100%,0 100%)}   /* right edge at the brand's 20° slant: 96 px tall × tan 20° ≈ 35 px (Sam, 13 Oct 2026) */</style>${RUNTIME}</head>
    <body><div id="card"><img class="ph" crossorigin="anonymous" src="${esc(cropUrl(it.photo || s.image, z.w, z.h))}">
    <div class="bs">${badgesOf(it).map(b => `<div class="b">${esc(badgeText(b))}</div>`).join("")}</div>
    ${it.caption.trim() ? `<div class="c">${esc(it.caption.trim())}</div>` : ""}</div></body></html>`;
}
const made = new Map();   // doc → PNG data URL
// Keep only the most recent pictures: every caption edit makes new ones, and wide PNGs are several MB (QA, 13 Oct 2026)
const MADE_MAX = 60;
const remember = (doc, url) => { made.delete(doc); made.set(doc, url); while (made.size > MADE_MAX) made.delete(made.keys().next().value); };
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
    remember(doc, url);
    return url;
  } finally { f.remove(); }
}
// "Balcony cabins: was <s>£1,899</s>" above the button on a was/now card
const wasLine = (w, cls, style) => w.was ? `<p${cls ? ` class="${cls}"` : ""} style="${style}">${esc(w.was).replace(/(£[\d,]+)$/, "<s>$1</s>")}</p>` : "";
// The whole card, laid out as in the team's emails (picture, NAME in Allium capitals, date, nights and port,
// ship, Allium "From £Xpp" button) on the email's Pearl background, drawn at the email's size and saved
// sharper (4x for a tile, 2x for full width), so it can be dropped into HubSpot as one image.
const CARD = {standard: {w: 188, title: 15, scale: 4}, wide: {w: 560, title: 16, scale: 2}};
async function renderCard(it, size){
  const pic = await render(it, size), c = CARD[size], w = words(it);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}*{margin:0;box-sizing:border-box}
    body{width:${c.w + 8}px;background:#F1ECE7}#card{width:${c.w + 8}px;padding:0 4px 18px;background:#F1ECE7;font-family:Quicksand,sans-serif;text-align:center;color:#1B1220}
    img{display:block;width:${c.w}px;height:auto}
    .t{margin:14px 0 10px;font-weight:700;font-size:${c.title}px;line-height:1.3;color:#6B207D;text-transform:uppercase}
    .d{margin:0 0 16px;font-size:14px;line-height:1.45}
    .k{font-size:12px;color:#5E5465}
    .b{display:inline-block;background:#6B207D;color:#fff;font-size:15px;padding:10px 16px;border-radius:6px}</style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js"><\/script>
    <script>window.ready=async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r;})));};
    window.toPng=()=>htmlToImage.toPng(document.getElementById('card'),{pixelRatio:${c.scale},cacheBust:false,backgroundColor:'#F1ECE7'});<\/script></head>
    <body><div id="card"><img src="${pic}" alt=""><p class="t">${esc(w.title)}</p>
    <p class="d">${esc(w.date)}<br>${esc(w.nights)}<br>${esc(w.ship)}<br><span class="k">${esc(w.code)}</span></p>${wasLine(w, "d", "margin:0 0 8px")}<span class="b">${esc(w.button)}</span></div></body></html>`;
  if (made.has(doc)) return made.get(doc);
  const f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${c.w + 100}px;top:0;width:${c.w + 8}px;height:900px;border:0`;
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = doc; });
    await f.contentWindow.ready();
    const url = await f.contentWindow.toPng();
    remember(doc, url);
    return url;
  } finally { f.remove(); }
}
const make = (it, out) => out.endsWith("-card") ? renderCard(it, out.split("-")[0]) : render(it, out);

// ---------- HTML version (Sam, 13 Oct 2026: "offer it as a png and as html") ----------
// The same card as a table-based HTML block for HubSpot (paste into a Custom HTML or rich-text source view):
// the picture, linked to the sailing, then the words and an Allium "From £Xpp" button as live text and links.
// Emails can only show pictures that are online, so the picture is saved as a JPEG through the emailImages
// function (allowlist checked, kept 90 days, as the Email creator) and the HTML points at it.
const FN = "https://us-central1-promotions-planner.cloudfunctions.net/emailImages";
const hosted = new Map();   // picture doc → online URL
const F = "Quicksand,Arial,Helvetica,sans-serif";
async function toJpeg(pngUrl, q){
  const im = new Image(); im.src = pngUrl; await im.decode();
  const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext("2d").drawImage(im, 0, 0);
  return c.toDataURL("image/jpeg", q);
}
async function host(list){   // [{it, size}] → same order of URLs
  const todo = list.filter(x => !hosted.has(cardDoc(x.it, x.size)));
  for (let i = 0; i < todo.length; i += 12) {
    const batch = todo.slice(i, i + 12), images = [];
    for (const [j, x] of batch.entries()) {
      let jpg = await toJpeg(await render(x.it, x.size), .86);
      if (jpg.length * .75 > 880 * 1024) jpg = await toJpeg(await render(x.it, x.size), .72);
      images.push({name: `c${j + 1}_${x.size}`, data: jpg.split(",")[1]});
    }
    if (!ID) throw new Error("Sign in again to make the HTML.");
    let r;
    try { r = await fetch(FN, {method: "POST", headers: {Authorization: `Bearer ${await ID()}`, "Content-Type": "application/json"}, body: JSON.stringify({images})}); }
    catch(e) { throw new Error("The picture service can't be reached, so the HTML can't point at the pictures. The PNG downloads still work."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `The picture service answered ${r.status}.`);
    batch.forEach((x, k) => hosted.set(cardDoc(x.it, x.size), j.urls[images[k].name]));
  }
  return list.map(x => hosted.get(cardDoc(x.it, x.size)));
}
function cardHtml(it, size, url){
  const w = words(it), wide = size === "wide", pw = wide ? 560 : 188;
  return `<!-- ${w.title}: ${SIZES[size].label} card, prices as checked ${shortDate(today)} -->
<table role="presentation" width="${pw + 8}" cellpadding="0" cellspacing="0" border="0" align="center" style="width:${pw + 8}px;margin:0 auto"><tr>
<td align="center" valign="top" style="padding:0 4px 24px;text-align:center">
<a href="${esc(w.link)}" target="_blank"><img src="${esc(url)}" width="${pw}" alt="${esc(sailing(it.id).title)}" style="display:block;width:${pw}px;max-width:100%;height:auto;border:0"></a>
<p style="margin:14px 0 10px;font-family:${F};font-weight:700;font-size:${wide ? 16 : 15}px;line-height:1.3;color:#6B207D;text-transform:uppercase">${esc(sailing(it.id).title)}</p>
<p style="margin:0 0 16px;font-family:${F};font-size:14px;line-height:1.45;color:#1B1220">${esc(w.date)}<br>${esc(w.nights)}<br>${esc(w.ship)}<br><span style="font-size:12px;color:#5E5465">${esc(w.code)}</span></p>
${wasLine(w, "", `margin:0 0 8px;font-family:${F};font-size:14px;color:#1B1220`)}<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td bgcolor="#6B207D" style="background:#6B207D;border-radius:6px">
<a href="${esc(w.link)}" target="_blank" style="display:inline-block;padding:10px 16px;font-family:${F};font-size:15px;color:#ffffff;text-decoration:none;border-radius:6px">${esc(w.button)}</a></td></tr></table>
</td></tr></table>`;
}
async function htmlFor(list){   // [{it, size}] → HTML blocks
  const urls = await host(list);
  return list.map((x, i) => cardHtml(x.it, x.size, urls[i]));
}
const htmlSizes = () => Object.keys(SIZES).filter(k => st.sizes[k]);

const loadZip = () => window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, bad) => {
  const sc = document.createElement("script");
  sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  sc.onload = () => ok(window.JSZip); sc.onerror = () => bad(new Error("couldn't load the zip tool"));
  document.head.appendChild(sc);
});
const download = (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };

// ---------- page ----------
// The options column stays on screen while the cards scroll past (Sam, 15 Oct 2026; CSS in index.html, desktop
// only) and scrolls on its own: its position is kept when the page redraws, and picking another card brings that
// card's options into view.
let drawnSel = -1;
function draw(){
  const it = st.items, cur = it[sel];
  const oldSide = root.querySelector(".ac-side"), keep = oldSide ? oldSide.scrollTop : 0, picked = drawnSel !== -1 && drawnSel !== sel;
  drawnSel = sel;
  root.innerHTML = `<div class="ac">
    <div class="ac-side">
      ${draftsBlock()}
      ${cs.section("ec-sailings", "Sailings", it.length ? `${it.length} sailing${it.length === 1 ? "" : "s"}${it.some(x => claimOf(x)) ? " · was/now on some" : ""}` : "none added yet", `
        <label class="ac-lab" for="ec-find">Add a sailing</label>
        <input id="ec-find" type="search" placeholder="Search name, port or cruise code" autocomplete="off">
        <div id="ec-results" class="ac-results"></div>
        ${it.length ? `<ol class="ac-list">${it.map((x, i) => { const s = sailing(x.id); return `<li class="${i === sel ? "on" : ""}">
          <button type="button" class="ac-pick" data-i="${i}"><b><span class="ac-n">${i + 1}</span>${esc(s.title)}</b><span class="sub">${esc(x.id)} · ${shortDate(s.r.departure_date)}${x.caption ? " · " + esc(x.caption) : ""}${claimOf(x) ? " · was/now" : ""}</span></button>
          <span class="ac-strips"></span>
          <span class="ac-ord"><button type="button" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-down="${i}" aria-label="Move down"${i < it.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-del="${i}" aria-label="Remove">✕</button></span></li>`; }).join("")}</ol>` : `<p class="sub">Search above and add the sailings you need cards for. Click one to edit it.</p>`}
        <label class="ac-check"><input type="checkbox" id="ec-all"${st.allBadges ? " checked" : ""}> Offer badges on every sailing <span class="sub">(each sailing's live offers, up to 2)</span></label>`)}
      ${cs.section("ec-out", "Sizes and downloads", [Object.entries(SIZES).filter(([k]) => st.sizes[k]).map(([, z]) => z.label).join(" and ") || "no size ticked",
        Object.entries(KINDS).filter(([k]) => st.kinds[k]).map(([, x]) => x.label.toLowerCase()).join(" and ") || "nothing to download"].join(" · "), `
        <span class="ac-lab">Sizes</span>
        ${Object.entries(SIZES).map(([k, z]) => `<label class="ac-check"><input type="checkbox" data-size="${k}"${st.sizes[k] ? " checked" : ""}> ${z.label} <span class="sub">(${z.note})</span></label>`).join("")}
        <span class="ac-lab">Download</span>
        ${Object.entries(KINDS).map(([k, x]) => `<label class="ac-check"><input type="checkbox" data-kind="${k}"${st.kinds[k] ? " checked" : ""}> ${x.label} <span class="sub">(${x.note})</span></label>`).join("")}`, false)}
      ${cur ? editor(cur) : ""}
    </div>
    <div class="ac-main">
      <div class="ac-actions">
        <button type="button" class="btn" id="ec-zip"${it.length && outputs().length ? "" : " disabled"}>Download zip</button>
        <button type="button" class="btn quiet" id="ec-html"${it.length && htmlSizes().length ? "" : " disabled"} title="One HTML file with every card, pictures saved online">Download HTML</button>
        <button type="button" class="btn quiet" id="ec-csv"${it.length ? "" : " disabled"} title="Every card's details in a spreadsheet">Download CSV</button>
        ${it.some(x => badgesOf(x).length) ? `<button type="button" class="linkbtn" id="ec-terms" title="The website's T&amp;Cs for every offer badge on these cards">Copy offer T&amp;Cs</button>` : ""}
        <button type="button" class="btn quiet" id="ec-clear"${it.length ? "" : " disabled"}>Start again</button>
        <span class="sub" id="ec-status" aria-live="polite">Prices as checked ${shortDate(today)}.${useBy() ? ` <b>Was/now cards: use by ${shortDate(useBy())}.</b>` : ""}</span>
      </div>
      ${note ? `<p class="ac-note">${note}</p>` : ""}
      <p class="sub">The zip has a PNG per sailing for each size and download you've ticked, named like the team's (e.g. "Kirkwall, Scotland - Standard card (Up to £200 Onboard Credit).png"), plus <b>email-text.txt</b> and <b>cards.csv</b> with the words and links. In HubSpot, link a whole card to the sailing's page (the link is in the text file).</p>
      <div class="ec-grid">${it.map((x, i) => {
        const w = words(x);
        return `<figure class="ec-card${i === sel ? " on" : ""}" data-i="${i}">
          <div class="ec-pics">${outputs().map(o => `<div class="ec-pic ec-${o.split("-")[0]}${o.endsWith("-card") ? " ec-whole" : ""}"><img data-pic="${i}:${o}" alt="${esc(outLabel(o))} for ${esc(w.title)}"></div>`).join("")}</div>
          ${st.kinds.card ? "" : `<figcaption><b class="ec-t">${esc(w.title)}</b><span>${esc(w.date)}</span><span>${esc(w.nights)}</span><span>${esc(w.ship)}</span><span class="sub">${esc(w.code)}</span>
            <span class="ec-btn">${esc(w.button)}</span></figcaption>`}
          <div class="ec-acts">
            <div>${outputs().map(o => `<button type="button" class="btn sm" data-dl="${i}:${o}">Download ${esc(outLabel(o).toLowerCase())}</button>`).join("")}</div>
            <div><button type="button" class="btn quiet sm" data-copy="${i}">Copy text</button><button type="button" class="btn quiet sm" data-copylink="${i}:page">Copy sailing link</button>${FR ? "" : `<button type="button" class="btn quiet sm" data-copylink="${i}:booking">Copy booking link</button>`}${badgesOf(x).length ? `<button type="button" class="btn quiet sm" data-copyterms="${i}">Copy offer T&amp;Cs</button>` : ""}${htmlSizes().map(k => `<button type="button" class="btn quiet sm" data-html="${i}:${k}">Copy ${SIZES[k].label.toLowerCase()} HTML</button>`).join("")}</div>
          </div></figure>`;
      }).join("")}</div>
    </div></div>`;
  note = "";
  const side = root.querySelector(".ac-side"), ed = root.querySelector("#ec-editor");
  if (side) {
    side.scrollTop = keep;
    // a different card picked: show its options (only scrolls the column when it scrolls on its own, i.e. on desktop)
    if (picked && ed && side.scrollHeight > side.clientHeight) side.scrollTop += ed.getBoundingClientRect().top - side.getBoundingClientRect().top - 8;
  }
  wire();
  paint();
}
function fareBlock(it){
  const f = fareOf(it), twin = onSale(it.id, "twin"), solo = onSale(it.id, "solo"), grades = f.fare === "solo" ? solo : twin;
  const cheapest = f.fare === "solo" ? Math.min(...Object.values(solo)) : sailing(it.id).price;
  return `<div class="ac-row" role="group" aria-label="Fare"><span class="ac-lab">Fare</span>
      <button type="button" class="ac-seg" data-fare="twin" aria-pressed="${f.fare === "twin"}">Twin (2 sharing)</button>
      <button type="button" class="ac-seg" data-fare="solo" aria-pressed="${f.fare === "solo"}"${Object.keys(solo).length ? "" : " disabled title=\"No solo cabins on sale\""}>Solo</button></div>
    <label class="ac-lab" for="ec-grade">Cabin</label>
    <select id="ec-grade"><option value="">Cheapest available${Object.keys(grades).length || f.fare === "twin" ? ` (${money(cheapest)})` : ""}</option>
      ${Object.entries(GRADES).filter(([g]) => grades[g] != null).map(([g, n]) => `<option value="${g}"${f.grade === g ? " selected" : ""}>${n} (${money(grades[g])})</option>`).join("")}</select>
    ${it.fare === "solo" && f.fare !== "solo" ? `<p class="ac-note">No solo cabins are on sale now, so the card uses twin prices.</p>` : ""}
    ${it.grade && !f.grade ? `<p class="ac-note">${esc(GRADES[it.grade] || it.grade)} cabins aren't on sale for this fare now, so the card uses the cheapest.</p>` : ""}
    <p class="sub">Button: <b>${esc(f.label || "no price on sale")}</b> · prices ${esc(f.basis)}, as checked ${shortDate(today)}.</p>`;
}
const useBy = () => st.items.map(claimOf).filter(Boolean).map(c => c.ends).sort()[0] || "";
function priceBlock(it){
  const cl = claims(it.id), c = claimOf(it);
  if (!cl.length) return fareBlock(it);
  return `<label class="ac-lab" for="ec-wasnow">Price</label>
    <select id="ec-wasnow"><option value="">From price (choose the fare and cabin below)</option>${cl.map(x => `<option value="${esc(x.key)}"${c && c.key === x.key ? " selected" : ""}>Was/now: ${esc(x.label)}, was ${money(x.was)} now ${money(x.now)} (use by ${shortDate(x.ends)})</option>`).join("")}</select>
    ${c ? `<p class="sub">Twin, from the tracker's live price-reduction claim. <b>Use this card by ${shortDate(c.ends)}</b>; if the claim ends sooner, the card goes back to its "From" price.</p>` : fareBlock(it)}`;
}
function editor(it){
  const s = sailing(it.id), hint = captionHint(it.photo, it.id);
  return `<div class="ac-block" id="ec-editor">
    <h3>${esc(s.title)}</h3>
    ${priceBlock(it)}
    ${FR ? `<p class="sub">Links go to the sailing's page on ambassadorcroisieres.fr.</p>` : `<div class="ac-row" role="group" aria-label="Link to"><span class="ac-lab">Link to</span>
      <button type="button" class="ac-seg" data-linkto="page" aria-pressed="${it.linkTo !== "booking"}">Sailing page</button>
      <button type="button" class="ac-seg" data-linkto="booking" aria-pressed="${it.linkTo === "booking"}">Booking</button></div>
    <p class="sub">${it.linkTo === "booking" ? "Opens the booking flow at the cabin step with this cabin type and " + (fareOf(it).fare === "solo" ? "1 guest" : "2 guests") + " already chosen." : "Opens the sailing's page on the website."}</p>`}
    <span class="ac-lab">Photo</span>
    ${(() => { const g = cs.photoGrid("ec-item", s.photos.map(u => `<button type="button" class="ac-ph${(it.photo || s.image) === u ? " on" : ""}" data-photo="${esc(u)}" aria-label="Use this photo"><img src="${esc(cropUrl(u, 160, 160))}" alt="" loading="lazy"></button>`), s.photos.indexOf(it.photo || s.image)); return `<div class="ac-photos">${g.grid}</div>${g.more}`; })()}
    <label class="ac-lab" for="ec-caption">Location caption <span class="sub">(check it matches the photo)</span></label>
    <input id="ec-caption" value="${esc(it.caption)}" placeholder="e.g. Kirkwall, Scotland" maxlength="40">
    ${hint && hint !== it.caption ? `<button type="button" class="linkbtn" id="ec-hint">Use "${esc(hint)}" (${FR ? "the photo's caption on the website" : "from the photo's file name"})</button>` : ""}
    <span class="ac-lab">Offer badges <span class="sub">(up to 2, as on the sailing's page)</span></span>
    ${badgeOptions(it.id).map((p, i) => `<label class="ac-check"><input type="checkbox" data-badge="${i}"${badgesOf(it).includes(p) ? " checked" : ""}${st.allBadges ? " disabled" : ""}> ${esc(p)}${campaignBadges(st).includes(p) ? ` <span class="sub">(${esc(st.campaign.name || "campaign")} offer${st.campaign.from ? `, ${shortDate(st.campaign.from)} to ${shortDate(st.campaign.to)}` : ""})</span>` : ""}</label>`).join("") || `<p class="sub">No offers on this sailing right now.</p>`}
    ${st.allBadges && badgeOptions(it.id).length ? `<p class="sub">"Offer badges on every sailing" is ticked. Untick it to choose.</p>` : ""}
    ${badgesOf(it).length ? `<button type="button" class="btn quiet sm" data-copyterms="${sel}">Copy offer T&amp;Cs</button> <span class="sub">${badgeTerms(it).map(x => `${esc(x.badge)}: ${x.docs.length ? "terms found" : "none on the website"}`).join(" · ")}</span>` : ""}
    <label class="ac-lab" for="ec-name">File name <span class="sub">(optional: blank uses the caption and offers)</span></label>
    <input id="ec-name" value="${esc(it.name || "")}" placeholder="${esc(fileName({...it, name: ""}, outputs()[0] || "standard").replace(/ - (Standard|Wide).*$/, ""))}" maxlength="100">
    <p class="sub" id="ec-names">${outputs().map(o => esc(fileName(it, o))).join("<br>") || "Tick a size and a download under Sizes and downloads."}</p>
  </div>`;
}
let pass = 0;
async function paint(){
  const n = ++pass;
  for (const img of root.querySelectorAll("[data-pic]")) {
    const [i, k] = img.dataset.pic.split(":"), it = st.items[+i];
    try { const url = await make(it, k); if (n !== pass) return; img.src = url; } catch(e) { img.alt = "Couldn't make this picture"; }
  }
}
let typing;
function change(redraw){ save(); if (redraw) draw(); else { clearTimeout(typing); typing = setTimeout(draw, 500); } }
const copyText = it => { const w = words(it); return [w.title, w.date, w.nights, w.ship, ...(w.was ? [w.was[0].toUpperCase() + w.was.slice(1)] : []), `${w.button}: ${w.link}`,
  FR ? `(Prix ${w.basis}, relevés le ${frDate(today)}, sous réserve de disponibilité.)`
     : `(Price ${w.basis}, as checked ${shortDate(today)}, subject to availability.${w.until ? ` Was/now price: use by ${shortDate(w.until)}.` : ""})`].join("\n"); };
function wire(){
  const $ = q => root.querySelector(q);
  cs.wire(root, draw);
  const find = $("#ec-find"), res = $("#ec-results");
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
    const s = sailing(b.dataset.add), photo = pickPhoto(s);
    if (st.items.length >= MAX) { note = `Up to ${MAX} sailings at once.`; return draw(); }
    st.items.push({id: s.id, photo, caption: "", name: "", badges: [], fare: "twin", grade: ""}); sel = st.items.length - 1;
    change(true); root.querySelector("#ec-find").focus();
  });
  root.querySelectorAll(".ac-pick").forEach(b => b.addEventListener("click", () => { sel = +b.dataset.i; draw(); }));
  root.querySelectorAll(".ec-card").forEach(f => f.addEventListener("click", e => { if (e.target.closest("button")) return; if (sel !== +f.dataset.i) { sel = +f.dataset.i; draw(); } }));
  const move = (i, j) => { const [x] = st.items.splice(i, 1); st.items.splice(j, 0, x); sel = j; change(true); };
  root.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(+b.dataset.up, +b.dataset.up - 1)));
  root.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(+b.dataset.down, +b.dataset.down + 1)));
  root.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { st.items.splice(+b.dataset.del, 1); sel = Math.max(0, Math.min(sel, st.items.length - 1)); change(true); }));
  // Off means no badges until chosen per sailing (Sam, 13 Oct 2026: the toggle didn't turn them off)
  $("#ec-all") && $("#ec-all").addEventListener("change", e => { st.allBadges = e.target.checked; if (!st.allBadges) st.items.forEach(x => { x.badges = []; }); change(true); });
  root.querySelectorAll("[data-size]").forEach(b => b.addEventListener("change", () => { st.sizes[b.dataset.size] = b.checked; change(true); }));
  root.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("change", () => { st.kinds[b.dataset.kind] = b.checked; change(true); }));
  const cur = st.items[sel];
  if (cur) {
    root.querySelectorAll("[data-photo]").forEach(b => b.addEventListener("click", () => { cur.photo = b.dataset.photo; change(true); }));
    root.querySelectorAll("[data-fare]").forEach(b => b.addEventListener("click", () => { cur.fare = b.dataset.fare; cur.grade = ""; change(true); }));
    root.querySelectorAll("[data-linkto]").forEach(b => b.addEventListener("click", () => { cur.linkTo = b.dataset.linkto; change(true); }));
    $("#ec-grade") && $("#ec-grade").addEventListener("change", e => { cur.grade = e.target.value; change(true); });
    $("#ec-wasnow") && $("#ec-wasnow").addEventListener("change", e => { cur.wasnow = e.target.value; change(true); });
    $("#ec-caption").addEventListener("input", e => { cur.caption = e.target.value; change(false); });
    $("#ec-name").addEventListener("input", e => { cur.name = e.target.value; save(); $("#ec-names").innerHTML = outputs().map(o => esc(fileName(cur, o))).join("<br>"); });
    $("#ec-hint") && $("#ec-hint").addEventListener("click", () => { cur.caption = captionHint(cur.photo, cur.id); change(true); });
    root.querySelectorAll("[data-badge]").forEach(b => b.addEventListener("change", () => {
      const p = badgeOptions(cur.id)[+b.dataset.badge];
      cur.badges = b.checked ? [...cur.badges.filter(x => x !== p), p].slice(-2) : cur.badges.filter(x => x !== p);
      change(true);
    }));
  }
  root.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", async () => {
    const [i, k] = b.dataset.dl.split(":"), it = st.items[+i];
    b.disabled = true; try { download(await make(it, k), fileName(it, k)); } finally { b.disabled = false; }
  }));
  // Copy buttons say "Copied" for a moment, then go back (Sam, 14 Oct 2026: proper buttons, plus the two links)
  const copied = async (b, t, what) => {
    const was = b.textContent;
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; setTimeout(() => { b.textContent = was; }, 1500); } catch(e) { prompt(what, t); }
  };
  root.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => copied(b, copyText(st.items[+b.dataset.copy]), "Copy the text")));
  root.querySelectorAll("[data-copylink]").forEach(b => b.addEventListener("click", () => {
    const [i, k] = b.dataset.copylink.split(":"), it = st.items[+i];
    copied(b, k === "booking" ? bookingLink(it) : pageLink(it), k === "booking" ? "Copy the booking link" : "Copy the sailing link");
  }));
  // Copy the T&Cs of the offers on a card (Sam, 13 Oct 2026), the same text as Download offer T&Cs
  root.querySelectorAll("[data-copyterms]").forEach(b => b.addEventListener("click", async () => {
    copied(b, termsText(st.items[+b.dataset.copyterms]), "Copy the offer T&Cs");
  }));
  $("#ec-clear").addEventListener("click", () => { if (confirm("Clear these sailings?")) { st = fresh(); sel = 0; draftId = null; change(true); } });
  wireDrafts();
  $("#ec-zip").addEventListener("click", zip);
  $("#ec-csv").addEventListener("click", () => download(URL.createObjectURL(new Blob([csvText()], {type: "text/csv;charset=utf-8"})), `${fileBase()}.csv`));
  // Copy, not download (Sam, 14 Oct 2026: "a copy text link, like in the promotions view")
  $("#ec-terms") && $("#ec-terms").addEventListener("click", async e => {
    const b = e.currentTarget, t = st.items.filter(x => badgesOf(x).length).map(termsText).join("\n\n");
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy offer T&Cs"; }, 1500); }
    catch(err) { prompt("Copy the offer T&Cs", t); }
  });
  root.querySelectorAll("[data-html]").forEach(b => b.addEventListener("click", async () => {
    const [i, k] = b.dataset.html.split(":"), was = b.textContent;
    b.disabled = true; b.textContent = "Making…";
    try {
      const [h] = await htmlFor([{it: st.items[+i], size: k}]);
      try { await navigator.clipboard.writeText(h); b.textContent = "HTML copied"; } catch(e) { prompt("Copy the card's HTML", h); b.textContent = was; }
    } catch(e) { b.textContent = was; note = esc(e.message); draw(); }
    finally { b.disabled = false; }
  }));
  $("#ec-html").addEventListener("click", async () => {
    const btn = $("#ec-html"), status = $("#ec-status"); btn.disabled = true;
    try {
      const list = st.items.flatMap(it => htmlSizes().map(size => ({it, size})));
      status.textContent = `Saving ${list.length} picture${list.length === 1 ? "" : "s"} online…`;
      const blocks = await htmlFor(list);
      const page = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Email cards ${today}</title></head>
<body style="margin:0;background:#F1ECE7">
<!-- Email cards from the price tracker, prices as checked ${shortDate(today)}, subject to availability (${esc(st.items.map(x => words(x).basis).filter((v, i, a) => a.indexOf(v) === i).join("; "))}).
     Copy one card's block (from its comment to the end of its table) into HubSpot. Pictures are kept online for 90 days. -->
<div style="max-width:600px;margin:0 auto;padding:20px 0">
${blocks.join("\n\n")}
</div></body></html>`;
      download(URL.createObjectURL(new Blob([page], {type: "text/html"})), `${fileBase()}.html`);
      note = `Downloaded the HTML for ${list.length} card${list.length === 1 ? "" : "s"}. Open it in a browser to check, then copy each card's block into HubSpot.`;
    } catch(e) { note = esc(e.message); }
    draw();
  });
}
async function zip(){
  const btn = root.querySelector("#ec-zip"), status = root.querySelector("#ec-status");
  btn.disabled = true;
  try {
    const JSZip = await loadZip(), sizes = outputs(), used = new Set(), total = st.items.length * sizes.length;
    const parts = Math.ceil(total / ZIP_PICS), base = fileBase();
    const text = [`Email card text, prices as checked ${shortDate(today)}, subject to availability`, ""];
    let z = new JSZip(), n = 0, inZip = 0, part = 1;
    // A big set downloads as several zips ("part 1 of 3"…), each with up to ZIP_PICS pictures; the text, CSV and
    // T&Cs go in the last one
    const flush = async () => {
      status.textContent = parts > 1 ? `Zipping part ${part} of ${parts}…` : "Zipping…";
      const url = URL.createObjectURL(await z.generateAsync({type: "blob"}));
      download(url, parts > 1 ? `${base}_part-${part}-of-${parts}.zip` : `${base}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 60000);   // free each part once it has downloaded
      z = new JSZip(); inZip = 0; part++;
    };
    for (const [i, it] of st.items.entries()) {
      const names = [];
      for (const k of sizes) {
        status.textContent = `Making pictures ${++n} of ${total}…`;
        let name = fileName(it, k); while (used.has(name)) name = name.replace(/\.png$/, " 2.png"); used.add(name);
        z.file(name, (await make(it, k)).split(",")[1], {base64: true}); names.push(name);
        if (++inZip >= ZIP_PICS && n < total) await flush();
      }
      text.push(`${i + 1}. ${copyText(it)}`, ...names.map(f => `   Picture: ${f}`), "");
    }
    z.file("email-text.txt", text.join("\n"));
    const withBadges = st.items.filter(x => badgesOf(x).length);
    if (withBadges.length) z.file("offer-terms.txt", withBadges.map(termsText).join("\n\n"));
    z.file("cards.csv", csvText());
    await flush();
    note = `Downloaded ${total} pictures${parts > 1 ? ` in ${parts} zips (up to ${ZIP_PICS} pictures each; the text, CSV and T&Cs are in the last)` : ""}. Prices as checked ${shortDate(today)}.`;
  } catch(e) { note = esc(`The zip couldn't be made: ${e.message}`); }
  draw();
}
