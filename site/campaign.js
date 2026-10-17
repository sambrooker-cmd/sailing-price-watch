// Creative → Campaign builder (Sam, 17 Oct 2026: "if someone provides a brief then it spits out a whole plan from all
// channels with creative and all sorts, a bit like the artifact I made today for black friday ads but it would then also do
// emails, landing pages, assets etc"). A brief in (offer, booking window, T&Cs, landing page, the sailings by codes or by a
// rule, channels), one campaign plan out, in the shape of Sam's "Black Friday Drinks Ads" / "Black Friday Ad Mock-ups"
// pages: checks before launch, sailings grouped into themes, Meta carousels (opener, sailings, closer) with phase openers,
// single images and ad names, Google Ads ad groups with an Editor CSV, the email send plan with each send's cards, a landing
// page outline, social assets and a day-by-day calendar. "Create drafts" puts it into the existing creators' shared saved
// lists (Ad creator carousels, Email cards sets with the campaign's offer badge, a page creator landing page), and the whole
// plan downloads as a page to share. Prices are the tracker's latest; the wording is a starting point to edit. Briefs are kept
// in the shared saved list (kind "campaign"). Nothing is sent, uploaded or published: people review and launch. UK only.
import {sharedStore} from "./saved.js?v=__BUILD__";
import {regionOf, REGION_LABEL, photoWords, addDays} from "./comptrend.js?v=__BUILD__";
import {LIMITS as GL, noAmp} from "./gcopy.js?v=__BUILD__";
import * as cmp from "./compliance.js?v=__BUILD__";

const KEY = "spw-campaign";
const SITE = "https://www.ambassadorcruiseline.com";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const dayLong = iso => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };
const dayShort = iso => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]}`; };
const wd = iso => WD[new Date(iso + "T12:00:00Z").getUTCDay()];
const gbp = v => v == null ? "–" : "£" + Math.round(v).toLocaleString("en-GB");
const cut = (t, n) => { t = String(t || "").trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/[\s,.;:–-]+\S*$/, "") + "…"; };
const fits = (t, n) => t && t.length <= n;
const camel = t => noAmp(t).replace(/['’]/g, "").replace(/[^A-Za-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join("");
const listText = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const nightsText = (a, b) => a === b ? `${a} nights` : `${a} to ${b} nights`;
const shortTitle = t => noAmp(t).replace(/\s*[-–:].*$/, "").trim() || noAmp(t);

let ctx, esc, root, store, S, KIT, PAGES, today;
const blank = () => ({name: "", code: "", offer: "", badge: "", detail: "", headline: "", from: "", to: "", terms: "", landing: "",
  pick: "rule", codes: "", rule: {from: "", to: "", fly: "", port: "", region: "", ship: "", nmin: "", nmax: "", pmax: ""}, fares: "",
  channels: {meta: true, google: true, email: true, page: true, social: true}, off: {}, tone: ""});
let st = {brief: blank(), saved: null, note: "", made: null};
try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.brief) st = {...st, brief: {...blank(), ...s.brief, rule: {...blank().rule, ...(s.brief.rule || {})}, channels: {...blank().channels, ...(s.brief.channels || {})}}, saved: s.saved || null}; } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({brief: st.brief, saved: st.saved})); } catch(e) {} };

export async function mount(el, c){
  ctx = c; esc = c.esc; root = el; S = c.state; today = S.updated;
  if (!KIT) {
    el.innerHTML = `<p class="loading">Loading…</p>`;
    [KIT, PAGES] = await Promise.all([c.getAdkit().catch(() => null), c.readJson("seo-pages").catch(() => null)]);
    store = sharedStore({kind: "campaign", localKey: "spw-campaigns-saved", field: "brief", idToken: c.idToken});
    store.load().then(() => draw());
  }
  draw();
}

// ---------- the sailings ----------
function onSale(){
  const ks = (KIT && KIT.sailings) || {};
  return Object.entries(S.sailings || {}).filter(([, s]) => !s.removed && s.departure_date > today && (s.segments || []).length).map(([id, s]) => {
    const k = ks[id] || {}, seg = s.segments[s.segments.length - 1];
    const title = noAmp(s.base_title || s.title);
    return {id, s, k, title, short: shortTitle(s.base_title || s.title), price: seg.p, nights: s.nights, date: s.departure_date, ship: s.ship,
      fly: s.flight_from || "", port: s.port || "", region: regionOf(s.base_title || s.title, photoWords(k.photos)), link: s.link || "",
      photo: (k.photos || []).find(u => !/cotw|dig-|carousel|boom-radio|weekender|back_to_|no-logo/i.test(u)) || k.image || ""};
  });
}
const parseCodes = t => [...new Set((String(t).toUpperCase().match(/\b[A-Z]\d{4,}[A-Z]{0,3}\b/g) || []))];
function picked(all){
  const b = st.brief;
  if (b.pick === "codes") { const want = parseCodes(b.codes), by = Object.fromEntries(all.map(x => [x.id, x])); return want.map(c => by[c]).filter(Boolean); }
  const r = b.rule;
  return all.filter(x => (!r.from || x.date.slice(0, 7) >= r.from) && (!r.to || x.date.slice(0, 7) <= r.to) && (!r.fly || (r.fly === "fly") === !!x.fly)
    && (!r.port || (x.fly ? "Flights from " + x.fly : x.port) === r.port) && (!r.region || x.region === r.region) && (!r.ship || x.ship === r.ship)
    && (!r.nmin || x.nights >= +r.nmin) && (!r.nmax || x.nights <= +r.nmax) && (!r.pmax || x.price <= +r.pmax));
}
// Themes, as the Black Friday carousels: one per destination region, regional departures, short breaks under £1,000.
// A sailing can sit in more than one. Groups need 2+ sailings; carousels take the 8 lowest priced (Meta allows 10 cards
// with the opener and closer).
const TERM = {norway: "Norwegian Fjords", iceland: "Iceland", iberia: "Spain and Portugal", med: "Mediterranean", british: "British Isles", near: "European", baltic: "Baltic", caribbean: "Caribbean", long: "Long-Haul"};
const HOOK = {norway: "Norway's fjords", iceland: "Iceland and the Northern Lights", iberia: "Spain, Portugal and the Atlantic islands", med: "The Mediterranean",
  british: "The British Isles", near: "Holland, Belgium, Germany and France", baltic: "The Baltic and Scandinavia", caribbean: "The Caribbean", long: "Long-haul voyages"};
function groups(list){
  const out = [];
  // noun: "book a selected … sailing"; term: Google headlines ("… Cruises", "… Cruise Offers")
  for (const [k] of Object.entries(REGION_LABEL)) { const xs = list.filter(x => x.region === k); if (xs.length >= 2) { const l = HOOK[k] || REGION_LABEL[k]; out.push({key: camel(l), label: l, noun: `${l.replace(/^The /, "")} sailing`, term: TERM[k] || l.replace(/^The /, ""), region: k, xs}); } }
  const regional = list.filter(x => !x.fly && x.port && !/tilbury/i.test(x.port));
  if (regional.length >= 2) out.push({key: "Regional", label: "Regional departures", noun: "sailing from a port near you", term: "Regional UK Port", xs: regional});
  const short = list.filter(x => x.nights <= 9 && x.price < 1000);
  if (short.length >= 2) out.push({key: "Under1000", label: "Short breaks under £1,000", noun: "short break", term: "Short Break", xs: short});
  const other = list.filter(x => !out.some(g => g.xs.includes(x)));
  if (other.length) out.push({key: "More", label: "More sailings", noun: "sailing", term: "UK", xs: other});
  for (const g of out) { g.xs = g.xs.slice().sort((a, b) => a.price - b.price); g.on = st.brief.off[g.key] !== true; }
  return out;
}

// ---------- the plan ----------
function phases(){
  const b = st.brief; if (!b.from || !b.to || b.to < b.from) return [];
  const len = (Date.parse(b.to) - Date.parse(b.from)) / 864e5 + 1, out = [{d: b.from, key: "new", label: "New offer"}];
  if (len >= 5) out.push({d: addDays(b.to, -2), key: "soon", label: "Offer ending soon"});
  if (len >= 3) out.push({d: addDays(b.to, -1), key: "last", label: "Last chance"});
  if (len >= 2) out.push({d: b.to, key: "tonight", label: "Offer ends tonight"});
  return out;
}
function sends(gs){
  const b = st.brief; if (!b.from || !b.to) return [];
  const len = (Date.parse(b.to) - Date.parse(b.from)) / 864e5 + 1;
  const live = gs.filter(g => g.on);
  const pickN = (n, skip) => { const out = [], used = new Set(skip || []); for (let r = 0; out.length < n && r < 10; r++) for (const g of live) { const x = g.xs.filter(y => !used.has(y.id))[0]; if (x && out.length < n) { out.push(x); used.add(x.id); } } return out; };
  const launch = pickN(9);
  const out = [{d: b.from, key: "launch", label: "Launch", xs: launch}];
  if (len >= 6) out.push({d: addDays(b.from, Math.floor(len / 2)), key: "reminder", label: "Reminder", xs: pickN(6, launch.map(x => x.id))});
  if (len >= 4) out.push({d: addDays(b.to, -2), key: "soon", label: "Ending soon", xs: live.flatMap(g => g.xs).sort((a, x) => a.price - x.price).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, 6)});
  out.push({d: b.to, key: "last", label: "Last chance", xs: launch.slice(0, 3)});
  return out;
}
const minOf = xs => Math.min(...xs.map(x => x.price));
const ports = xs => [...new Set(xs.map(x => x.fly ? x.fly : x.port.replace(/^London /, "London ")))];
function primary(g){
  const b = st.brief, xs = g.xs, nmin = Math.min(...xs.map(x => x.nights)), nmax = Math.max(...xs.map(x => x.nights));
  const fly = xs.every(x => x.fly), from = fly ? `with flights from ${listText(ports(xs).slice(0, 3))}` : `from ${listText(ports(xs).slice(0, 3))}`;
  return [`${g.label}${b.headline ? `: ${b.headline.replace(/[.!]$/, "")}` : ""}. This ${b.name || "season"}, book a selected ${g.noun} and ${b.detail || `enjoy ${b.offer || "our offer"}`}.`,
    `${nightsText(nmin, nmax)} ${from}, from ${gbp(minOf(xs))}pp.`,
    `Book ${dayLong(b.from || today)} to ${dayLong(b.to || today)}. Based on two sharing and subject to availability.`].join("\n\n");
}
function cardLine(x){ return {hl: cut(`${x.short}, ${x.nights} nights`, 40), desc: `${dayShort(x.date)} ${x.date.slice(0, 4)} · from ${gbp(x.price)}pp`, link: x.link.replace(SITE, "")}; }
function adName(kind, key, extra){ const c = st.brief.code || camel(st.brief.name || "Campaign"); return `${kind}_EN_${c}_${key}${extra ? "_" + extra : ""}_C###_T####`; }
function googleSet(g){
  const b = st.brief, xs = g.xs, min = minOf(xs), nofly = xs.every(x => !x.fly);
  const H = GL.rsa.headlines[0], D = GL.rsa.descriptions[0];
  const hl = [b.headline, b.offer, `${g.term} Cruises`, `${g.term} Cruise Offers`, `From ${gbp(min)}pp`, b.to ? `Book By ${dayShort(b.to)}` : "",
    nofly ? "No-Fly Cruises From The UK" : "Flights Included", "Smaller Ships, Bigger Welcome", "Ambassador Cruise Line", "The Warmest Welcome At Sea",
    `${Math.min(...xs.map(x => x.nights))} To ${Math.max(...xs.map(x => x.nights))} Night Cruises`, b.name ? `${b.name} Cruise Deals` : "", "Book Your Sailing Today", "Because Moments Matter",
    ...xs.slice(0, 4).map(x => x.short)].map(noAmp).filter(t => fits(t, H)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 15);
  const ds = [`${b.offer ? b.offer + " on" : "Book"} selected ${g.noun.replace(/(sailing|break)\b/, "$1s")}. Book ${dayShort(b.from || today)} to ${dayShort(b.to || today)}.`,
    `${nightsText(Math.min(...xs.map(x => x.nights)), Math.max(...xs.map(x => x.nights)))} from ${gbp(min)}pp, based on two sharing. Subject to availability.`,
    nofly ? `Sail from ${listText(ports(xs).slice(0, 3))} with no flights needed, on our smaller ships.` : "Flights included, so getting there is sorted. Smaller ships, the warmest welcome.",
    "The warmest welcome at sea - because moments matter. T&Cs apply."].map(noAmp).map(t => fits(t, D) ? t : cut(t, D));
  return {group: `${b.code || camel(b.name || "Campaign")} - ${g.label}`, hl, ds, url: SITE + (b.landing || "/"), paths: [camel(g.term).slice(0, 15), camel(b.name || "Offers").slice(0, 15)],
    sitelinks: xs.slice(0, 4).map(x => ({t: cut(x.short, GL.sitelink.text), d1: cut(`${x.nights} nights, ${dayShort(x.date)}`, GL.sitelink.desc), d2: cut(`From ${gbp(x.price)}pp`, GL.sitelink.desc), url: x.link})),
    callouts: [b.badge && cut(b.badge.replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase()), GL.callout), "Smaller Ships", nofly ? "No Flights Needed" : "Flights Included", "Full-Board Dining", `Book By ${dayShort(b.to || today)}`].filter(t => fits(t, GL.callout))};
}
function landingPage(list, gs){
  const b = st.brief, min = list.length ? minOf(list) : null;
  const h1 = b.headline || b.offer || b.name || "Our latest offer";
  const intro = `${b.detail ? b.detail.replace(/^[a-z]/, c => c.toUpperCase()).replace(/\.?$/, ".") : ""} Book between ${dayLong(b.from || today)} and ${dayLong(b.to || today)}${list.length ? ` on ${list.length} selected sailings from ${gbp(min)}pp` : ""}.`.trim();
  const faq = [
    {q: `When can I book the ${b.name || "offer"}?`, a: `Book between ${dayLong(b.from || today)} and ${dayLong(b.to || today)} ${(b.to || "").slice(0, 4)}.`},
    {q: "Which sailings are included?", a: `${list.length} selected sailings, listed on this page. Prices are per person, based on two sharing, and subject to availability.`},
    {q: "What's included in the offer?", a: b.detail ? b.detail.replace(/^[a-z]/, c => c.toUpperCase()).replace(/\.?$/, ".") : "See the terms below."},
    {q: "Where can I read the full terms?", a: b.terms ? cut(b.terms, 400) : "The full terms and conditions are below."},
  ];
  return {kind: "landing", template: "offer", keyword: (b.name || b.offer || "cruise offers").toLowerCase(), offer: b.offer || "", filter: {}, codes: list.map(x => x.id),
    slug: (b.landing || "/deals/" + (b.name || "offer").toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^\/|\/$/g, ""),
    seoTitle: cut(`${b.name ? b.name + ": " : ""}${b.offer || "Cruise offers"}`, 46) + " | Ambassador",
    metaDesc: cut(`${b.offer || "Our latest offer"} on selected sailings when you book ${dayShort(b.from || today)} to ${dayShort(b.to || today)}. Smaller ships, the warmest welcome at sea.`, 155),
    h1, sub: "The warmest welcome at sea - because moments matter", hero: (list[0] || {}).photo || "", heroAlt: "", intro, date: today,
    blocks: [
      {type: "text", h2: "How the offer works", body: [b.detail ? b.detail.replace(/^[a-z]/, c => c.toUpperCase()).replace(/\.?$/, ".") : "", `Book between ${dayLong(b.from || today)} and ${dayLong(b.to || today)}. Terms and conditions apply.`].filter(Boolean).join("\n\n")},
      {type: "sailings", title: "The sailings in this offer"},
      ...gs.filter(g => g.on).slice(0, 4).map(g => ({type: "text", h2: g.label, body: "", hint: `Write 60–100 words on ${g.label.toLowerCase()}: ${listText(g.xs.slice(0, 3).map(x => x.short))}.`})),
      {type: "faq", title: "Frequently asked questions", items: faq},
      {type: "cta", text: "See all our cruises", url: SITE + "/cruise-search/"},
    ]};
}

// ---------- checks before launch ----------
function checks(all, list, gs){
  const b = st.brief, out = [];
  const add = (lvl, t) => out.push([lvl, t]);
  if (!b.name) add("bad", "The campaign has no name.");
  if (!b.offer) add("bad", "The offer isn't described.");
  if (!b.from || !b.to) add("bad", "The booking window needs a start and an end date.");
  else {
    if (b.to < b.from) add("bad", "The booking window ends before it starts.");
    if (b.from < today) add("warn", `The booking window started on ${day(b.from)}, before today.`);
  }
  if (!b.terms) add("bad", "No terms and conditions yet: a shortened offer line shouldn't run without a link to the full terms.");
  if (!b.landing) add("warn", "No landing page given: ads and emails will point at the home page.");
  else if (PAGES && PAGES.pages) {
    const p = "/" + b.landing.replace(SITE, "").replace(/^\/|\/$/g, "") + "/", pg = PAGES.pages[p === "//" ? "/" : p];
    if (!pg) add("warn", `${p} isn't a page on the website yet (it's not in the sitemap the tracker read on ${day(PAGES.read_on)}). It needs to exist, or redirect to the offer, before ${day(b.from)}.`);
    else if (pg.s !== 200) add("bad", `${p} returns ${pg.s} on the website.`);
    else add("ok", `${p} is on the website ("${pg.t}"): check it shows this offer before ${day(b.from)}.`);
  }
  const words = [b.offer, b.detail, b.headline, b.terms].join(" ");
  if (/per day/i.test(words) && /per night/i.test(words)) add("warn", `The brief says both "per day" and "per night": pick one before the copy goes out.`);
  if (b.badge && b.badge.length > 28) add("warn", `The offer badge "${b.badge}" is ${b.badge.length} characters: cards and email badges fit about 28.`);
  if (/\b(was|now only|reduced|save £|£\d[\d,]* off|price drop|cheaper)\b/i.test([b.offer, b.headline, b.badge].join(" "))) add("warn", "The offer wording reads like a price reduction: was/now claims follow the reference-pricing rules (28 days held first) and only come from the tracker's live claims.");
  if (b.pick === "codes") {
    const want = parseCodes(b.codes), have = new Set(all.map(x => x.id)), missing = want.filter(c => !have.has(c));
    if (missing.length) add("bad", `Not on sale now, so left out: ${missing.join(", ")}.`);
  }
  if (!list.length) add("bad", "No sailings match the brief.");
  const soon = list.filter(x => b.to && x.date <= addDays(b.to, 7));
  if (soon.length) add("warn", `Departing within a week of the booking window closing: ${soon.map(x => x.id).join(", ")}.`);
  // fares sheet against the live price
  const sheet = {}; for (const m of String(b.fares).matchAll(/\b([A-Z]\d{4,}[A-Z]{0,3})\b[^\d£\n]*£?\s*([\d,]{2,})/gi)) sheet[m[1].toUpperCase()] = +m[2].replace(/,/g, "");
  const diff = list.filter(x => sheet[x.id] != null && sheet[x.id] !== x.price);
  if (Object.keys(sheet).length) {
    if (diff.length) add("warn", `${diff.length} fare${diff.length === 1 ? "" : "s"} on the fares sheet ${diff.length === 1 ? "differs" : "differ"} from the website now: ${diff.map(x => `${x.id} (sheet ${gbp(sheet[x.id])}, website ${gbp(x.price)})`).join("; ")}. The plan uses the website's prices.`);
    else add("ok", `The fares sheet matches the website for all ${Object.keys(sheet).length} sailings on it.`);
    const notIn = Object.keys(sheet).filter(c => !list.some(x => x.id === c));
    if (notIn.length) add("warn", `On the fares sheet but not in the plan: ${notIn.join(", ")}.`);
  }
  const claims = list.filter(x => x.s.claim && x.s.claim.eligible && x.s.claim.ends >= today);
  if (claims.length) add("ok", `${claims.length} sailing${claims.length === 1 ? " has" : "s have"} a live was/now claim (${claims.map(x => x.id).join(", ")}): was/now cards come only from those claims and stop on each claim's end date, which can be before this campaign.`);
  const others = list.filter(x => (x.k.promos || []).length);
  if (others.length) add("ok", `${others.length} of the sailings already carry other offers on the website (e.g. ${others[0].id}: ${others[0].k.promos[0]}): decide whether they show alongside this one.`);
  const offGroups = gs.filter(g => !g.on).length;
  if (offGroups) add("ok", `${offGroups} theme${offGroups === 1 ? " is" : "s are"} switched off.`);
  return out;
}

// The shared pre-send check (site/compliance.js, 17 Oct 2026) over everything the plan writes: each sailing at today's
// price with the campaign badge, the Meta primary text, the Google lines and the landing page's words
function shared(list, on, gg, lp){
  if (!list.length) return [];
  const b = st.brief, C = b.channels, texts = [];
  if (C.meta) on.forEach(g => texts.push({where: `${g.label} carousel text`, text: primary(g), body: true, prices: g.xs.map(x => x.price)}));
  if (C.google) gg.forEach((g, i) => texts.push({where: `Google Ads (${g.group})`, text: [...g.hl, ...g.ds].join(" | "), prices: (on[i] || {xs: []}).xs.map(x => x.price)}));
  if (C.page) texts.push({where: "Landing page", text: [lp.seoTitle, lp.metaDesc, lp.h1, lp.intro, ...lp.blocks.map(x => [x.body, ...(x.items || []).map(f => f.q + " " + f.a)].join(" "))].join(" ")});
  const r = cmp.check({label: b.name || "Campaign", items: list.map(x => ({id: x.id, price: x.price, offers: b.badge ? [b.badge] : []})), texts,
    campaign: b.badge ? {name: b.name, badge: b.badge, offer: b.offer, terms: b.terms, from: b.from, to: b.to} : null, twoSharingLevel: "warn"},
    {S, CAB: ctx.cabins || {}, KIT: (KIT && KIT.sailings) || {}, T: ctx.terms || null, today});
  // the brief's own checks already cover the window, T&Cs and codes; keep the rest, in the plan's levels
  return r.rows.filter(x => !/the brief has no T&Cs/.test(x.t)).map(x => [x.lvl === "fail" ? "bad" : x.lvl, x.t]);
}

// ---------- drawing ----------
function draw(){
  const b = st.brief, all = onSale(), list = picked(all), gs = groups(list), on = gs.filter(g => g.on);
  const ph = phases(), sd = sends(gs), gg = on.map(googleSet), lp = landingPage(list, gs), ck = [...checks(all, list, gs), ...shared(list, on, gg, lp)];
  const months = [...new Set(all.map(x => x.date.slice(0, 7)))].sort(), portsAll = [...new Set(all.map(x => x.fly ? "Flights from " + x.fly : x.port))].sort();
  const ships = [...new Set(all.map(x => x.ship))].sort();
  const savedAll = store && !store.loading ? store.all() : {};
  const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const field = (k, label, ph, extra) => `<label class="ac-lab" for="cb-${k}">${label}</label><input id="cb-${k}" data-b="${k}" value="${esc(b[k])}" placeholder="${esc(ph || "")}"${extra || ""}>`;
  root.innerHTML = `<div class="ac">
    <div class="ac-side">
      <div class="ac-block">
        <h3>${st.saved && savedAll[st.saved] ? esc(savedAll[st.saved].name) : "Unsaved brief"}</h3>
        <div class="ac-row">
          <button type="button" class="btn quiet sm" id="cb-save">${st.saved && savedAll[st.saved] && store.mine(st.saved) ? "Save" : "Save as…"}</button>
          <button type="button" class="btn quiet sm" id="cb-new">New brief</button>
          ${Object.keys(savedAll).length ? `<select id="cb-open" aria-label="Open a saved brief"><option value="">Open a saved brief…</option>${Object.entries(savedAll).map(([id, x]) => `<option value="${esc(id)}">${esc(x.name)}${x.by ? ` · ${esc(store.mine(id) ? "you" : x.by)}` : ""}</option>`).join("")}</select>` : ""}
        </div>
        ${store && store.loading ? `<p class="sub">Loading saved briefs…</p>` : ""}
      </div>
      <div class="ac-block"><h3>The brief</h3>
        ${field("name", "Campaign name", "e.g. Black Friday 2026")}
        ${field("code", "Code for ad names", camel(b.name || "") || "e.g. BlackFriday2026", ' maxlength="30"')}
        ${field("offer", "The offer", "e.g. Free Classic Drinks Package")}
        ${field("detail", "What guests get (one sentence)", "e.g. your Classic Drinks Package is on us, for up to two guests per cabin")}
        ${field("headline", "Campaign line", "e.g. Welcome to a round on us")}
        ${field("badge", "Offer badge on cards and emails", "e.g. FREE DRINKS PACKAGE", ' maxlength="40"')}
        <div class="controls" style="margin:6px 0 0">${field("from", "Book from", "", ' type="date"')}${field("to", "Book until", "", ' type="date"')}</div>
        ${field("landing", "Landing page", "e.g. /black-friday/")}
        <label class="ac-lab" for="cb-terms">Terms and conditions</label><textarea id="cb-terms" data-b="terms" rows="3" placeholder="Paste the T&amp;Cs, or a link to them">${esc(b.terms)}</textarea>
        <label class="ac-lab" for="cb-tone">Notes for the copy <span class="sub">(optional)</span></label><textarea id="cb-tone" data-b="tone" rows="2" placeholder="e.g. playful drinks puns, lead on the fjords">${esc(b.tone)}</textarea>
      </div>
      <div class="ac-block"><h3>Sailings</h3>
        <div class="seg" role="group" aria-label="How to choose sailings"><button type="button" data-pick="rule" aria-pressed="${b.pick === "rule"}">By a rule</button><button type="button" data-pick="codes" aria-pressed="${b.pick === "codes"}">By cruise codes</button></div>
        ${b.pick === "codes" ? `<label class="ac-lab" for="cb-codes">Cruise codes <span class="sub">(any order, any separators)</span></label><textarea id="cb-codes" data-b="codes" rows="4" placeholder="A12702, A22704, A22708PO…">${esc(b.codes)}</textarea>`
          : `<div class="controls" style="margin:6px 0">
            <select data-r="from" aria-label="Departing from">${opt("", b.rule.from, "Departing from any month")}${months.map(m => opt(m, b.rule.from, `From ${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}`)).join("")}</select>
            <select data-r="to" aria-label="Departing until">${opt("", b.rule.to, "Until any month")}${months.map(m => opt(m, b.rule.to, `Until ${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}`)).join("")}</select>
            <select data-r="fly" aria-label="No-fly or fly">${opt("", b.rule.fly, "No-fly and fly-cruises")}${opt("nofly", b.rule.fly, "No-fly only")}${opt("fly", b.rule.fly, "Fly-cruises only")}</select>
            <select data-r="region" aria-label="Destination">${opt("", b.rule.region, "Any destination")}${Object.entries(REGION_LABEL).map(([k, l]) => opt(k, b.rule.region, l)).join("")}</select>
            <select data-r="port" aria-label="Port or airport">${opt("", b.rule.port, "Any port or airport")}${portsAll.map(p => opt(p, b.rule.port, p)).join("")}</select>
            <select data-r="ship" aria-label="Ship">${opt("", b.rule.ship, "Any ship")}${ships.map(p => opt(p, b.rule.ship, p)).join("")}</select>
            <input data-r="nmin" type="number" min="1" placeholder="Nights from" value="${esc(b.rule.nmin)}" aria-label="Nights from" style="max-width:120px">
            <input data-r="nmax" type="number" min="1" placeholder="Nights to" value="${esc(b.rule.nmax)}" aria-label="Nights to" style="max-width:120px">
            <input data-r="pmax" type="number" min="1" placeholder="Max £pp" value="${esc(b.rule.pmax)}" aria-label="Highest price per person" style="max-width:120px"></div>`}
        <p class="sub">${list.length} sailing${list.length === 1 ? "" : "s"} on sale match.</p>
        <label class="ac-lab" for="cb-fares">Fares sheet <span class="sub">(optional: paste "A12702 £1,149" lines to check against the website)</span></label><textarea id="cb-fares" data-b="fares" rows="3">${esc(b.fares)}</textarea>
      </div>
      <div class="ac-block"><h3>Channels</h3>
        ${[["meta", "Meta (Facebook and Instagram)"], ["google", "Google Ads"], ["email", "Email"], ["page", "Landing page"], ["social", "Social and video"]].map(([k, l]) => `<label class="ac-check"><input type="checkbox" data-ch="${k}"${b.channels[k] ? " checked" : ""}> ${l}</label>`).join("")}
      </div>
    </div>
    <div class="ac-main" id="cb-plan">${plan(list, gs, on, ph, sd, ck, gg, lp)}</div>
  </div>`;
  wire(list, gs, on, sd, gg, lp);
}

function plan(list, gs, on, ph, sd, ck, gg, lp){
  const b = st.brief, C = b.channels;
  if (!b.name && !b.offer && !list.length) return `<div class="empty"><p>Fill in the brief on the left: the offer, the booking window, the landing page and which sailings. The plan builds itself here as you type, from the tracker's latest prices and photos.</p></div>`;
  const lvl = {bad: ["✕", "var(--warn)"], warn: ["!", "#a15c00"], ok: ["✓", "var(--ok, #1a7f26)"]};
  const sec = (id, title, body) => `<h3 id="cb-${id}" style="margin:24px 0 8px;font-size:16px">${title}</h3>${body}`;
  const sailRows = xs => xs.map(x => `<tr><td><a href="#${esc(x.id)}">${esc(x.id)}</a></td><td style="white-space:normal">${esc(x.title)}</td><td>${day(x.date)}</td><td class="num">${x.nights}</td><td>${esc(x.fly ? x.fly + " (fly)" : x.port)}</td><td class="num">${gbp(x.price)}</td></tr>`).join("");
  const head = `<thead><tr><th>Code</th><th>Sailing</th><th>Departs</th><th class="num">Nights</th><th>From</th><th class="num">From pp</th></tr></thead>`;
  const carousel = g => { const xs = g.xs.slice(0, 8), cards = [
      {n: 0, card: "Opener", hl: b.headline || b.offer || "", desc: `Book ${dayShort(b.from || today)} to ${dayShort(b.to || today)}`, link: b.landing || "/"},
      ...xs.map((x, i) => ({n: i + 1, card: x.id, ...cardLine(x)})),
      {n: xs.length + 1, card: "Closer", hl: b.headline || "The warmest welcome at sea", desc: cut(`Book by ${dayShort(b.to || today)}`, 40), link: b.landing || "/"}];
    return `<div class="ac-block" style="margin:10px 0"><div class="sub" style="text-transform:uppercase;letter-spacing:.1em">Carousel · ${cards.length} cards</div><h4 style="margin:4px 0">${esc(g.label)}</h4><code>${esc(adName("CAR", g.key))}</code>
      <div style="display:flex;gap:8px;overflow-x:auto;margin:8px 0">${xs.map(x => x.photo ? `<img src="${esc(x.photo)}" alt="${esc(x.short)}" style="width:120px;height:120px;object-fit:cover;flex:none" loading="lazy">` : "").join("")}</div>
      <p style="white-space:pre-line;margin:6px 0">${esc(primary(g))}</p>
      <div class="tablewrap"><table class="ptable"><thead><tr><th>#</th><th>Card</th><th>Headline</th><th>Description</th><th>Link</th></tr></thead><tbody>${cards.map(c => `<tr><td>${c.n}</td><td>${esc(c.card)}</td><td>${esc(c.hl)}</td><td>${esc(c.desc)}</td><td>${esc(c.link)}</td></tr>`).join("")}</tbody></table></div>
      ${g.xs.length > 8 ? `<p class="sub">The 8 lowest priced of ${g.xs.length}; the rest run as single images.</p>` : ""}
      <button type="button" class="linkbtn" data-openad="${esc(g.key)}">Open this carousel in the Ad creator</button></div>`; };
  const calendar = () => {
    if (!b.from || !b.to) return `<p class="sub">Add the booking window to see the calendar.</p>`;
    const rows = [];
    const at = (d, what) => rows.push([d, what]);
    at(addDays(b.from, -7), "Brief signed off; drafts created and reviewed (Ad creator, Email cards, page creator)");
    if (C.page) at(addDays(b.from, -3), `Landing page ${esc(b.landing || "")} built in Storyblok and checked; T&Cs live`);
    if (C.meta) at(addDays(b.from, -2), "Meta ads uploaded and in review (allow 24 hours)");
    for (const p of ph) at(p.d, `${C.meta ? `Carousel openers: <b>${esc(p.label)}</b>` : esc(p.label)}${p.key === "tonight" && C.meta ? `; "last orders" single image runs today only` : ""}`);
    if (C.email) for (const s of sd) at(s.d, `Email: <b>${esc(s.label)}</b> (${s.xs.length} sailings)`);
    if (C.google) at(b.from, "Google Ads ad groups live, customiser prices updated");
    if (C.social) at(b.from, "Organic social: launch post, route videos and stories");
    at(addDays(b.to, 1), "Everything off: ads paused, landing page redirected, offer badges removed");
    const by = {}; for (const [d, w] of rows) (by[d] = by[d] || []).push(w);
    return `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>What happens</th></tr></thead><tbody>${Object.keys(by).sort().map(d => `<tr><td>${wd(d)} ${day(d)}</td><td style="white-space:normal">${by[d].join("<br>")}</td></tr>`).join("")}</tbody></table></div>`;
  };
  const subj = s => {
    const o = b.offer || "our offer";
    return {launch: [b.headline ? `${b.headline}: ${o}` : `${o} is here`, `${o}, from today until ${dayShort(b.to || today)}`],
      reminder: [`Still time: ${o}`, `Have you seen our ${b.name || "offer"} sailings?`], soon: [`Ending soon: ${o}`, `Just a few days left for ${o.toLowerCase()}`],
      last: [`Last chance: ${o} ends tonight`, `Tonight's the night: ${o.toLowerCase()} ends at midnight`]}[s.key].map(t => cut(t.replace(/\s+/g, " ").trim(), 60));
  };
  return `
    <div class="ac-actions"><button type="button" class="btn" id="cb-make"${list.length ? "" : " disabled"}>Create drafts in the creators</button><button type="button" class="btn quiet" id="cb-dl"${list.length ? "" : " disabled"}>Download the plan</button>
      <span class="sub">${list.length} sailings · ${on.length} theme${on.length === 1 ? "" : "s"}${b.from && b.to ? ` · book ${day(b.from)} to ${day(b.to)}` : ""} · prices as checked ${day(today)}</span></div>
    ${st.note ? `<p class="ac-note">${st.note}</p>` : ""}
    ${st.made ? `<div class="ac-block"><b>Drafts created</b><ul style="margin:6px 0 0 18px;padding:0">${st.made.map(m => `<li>${esc(m)}</li>`).join("")}</ul><p class="sub" style="margin:6px 0 0">Open them from each creator's Saved list. Nothing has been sent or uploaded.</p></div>` : ""}
    ${sec("checks", "Check before launch", `<ul style="list-style:none;padding:0;margin:0">${ck.map(([l, t]) => `<li style="margin:4px 0"><b style="color:${lvl[l][1]};display:inline-block;width:18px">${lvl[l][0]}</b>${esc(t)}</li>`).join("") || `<li class="sub">Nothing to flag.</li>`}</ul>`)}
    ${sec("themes", "Sailings by theme", `<p class="sub">Grouped by destination, regional departures and short breaks, as the Black Friday carousels. A sailing can be in more than one. Untick a theme to leave it out.</p>
      ${gs.map(g => `<div class="ac-block" style="margin:6px 0;display:flex;gap:10px;align-items:flex-start"><input type="checkbox" data-grp="${esc(g.key)}"${g.on ? " checked" : ""} aria-label="Include ${esc(g.label)}" style="margin-top:4px;flex:none">
        <details style="flex:1;min-width:0"><summary style="cursor:pointer"><b>${esc(g.label)}</b> <span class="sub">${g.xs.length} sailings · from ${gbp(minOf(g.xs))}pp</span></summary>
        <div class="tablewrap"><table class="ptable">${head}<tbody>${sailRows(g.xs)}</tbody></table></div></details></div>`).join("")}`)}
    ${C.meta ? sec("meta", "Meta: carousels, singles and videos", `${ph.length ? `<p><b>Opener for each phase:</b> ${ph.map(p => `${esc(p.label)} (${dayShort(p.d)})`).join(" · ")}. Swap the opener card on each date; the sailing cards stay.</p>` : ""}
      ${on.map(carousel).join("")}
      <div class="ac-block" style="margin:10px 0"><h4 style="margin:0 0 6px">Single images</h4><p class="sub">One per sailing, 1:1 and 9:16, named <code>${esc(adName("IMG", "<cruise code>"))}</code>. ${list.length} sailings. The cards are the tracker's own designs with the offer badge; make them in the Ad creator ("Single image") or download them from the Cards page.</p>
        <p class="sub">Offer-only singles to make from the campaign artwork: the offer itself; "${esc(b.headline || b.offer || "")}"${b.to ? `; "Last orders" for ${day(b.to)} only` : ""}.</p></div>
      ${C.social ? `<div class="ac-block" style="margin:10px 0"><h4 style="margin:0 0 6px">Videos</h4><p class="sub">A 15-second slideshow for each carousel from the Ad creator's <b>Make video</b> (9:16 and 1:1), named <code>${esc(adName("VID", "<theme>", "9x16"))}</code>.</p></div>` : ""}`) : ""}
    ${C.google ? sec("google", "Google Ads", `${gg.map(g => `<div class="ac-block" style="margin:10px 0"><h4 style="margin:0 0 6px">${esc(g.group)}</h4>
        <p class="sub" style="margin:0 0 4px">Headlines (${g.hl.length}, 30 max)</p><p style="margin:0">${g.hl.map(esc).join(" · ")}</p>
        <p class="sub" style="margin:8px 0 4px">Descriptions</p><ul style="margin:0 0 0 18px;padding:0">${g.ds.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
        <p class="sub" style="margin:8px 0 0">Final URL ${esc(g.url)} · paths /${esc(g.paths.join("/"))} · sitelinks: ${g.sitelinks.map(s => esc(s.t)).join(", ")} · callouts: ${g.callouts.map(esc).join(", ")}</p></div>`).join("")}
      <button type="button" class="linkbtn" id="cb-gcsv">Download for Google Ads Editor (search ads, sitelinks, callouts)</button>
      <p class="sub">Performance Max and display images: add these sailings on the Google Ads page.</p>`) : ""}
    ${C.email ? sec("email", "Email sends", `<div class="tablewrap"><table class="ptable"><thead><tr><th>Send</th><th>Subject lines</th><th>Preview text</th><th>Sailings</th></tr></thead><tbody>
      ${sd.map(s => `<tr><td><b>${esc(s.label)}</b><div class="sub">${wd(s.d)} ${day(s.d)}</div></td><td style="white-space:normal">${subj(s).map(esc).join("<br>")}</td>
        <td style="white-space:normal">${esc(cut(`${b.detail ? b.detail.replace(/^[a-z]/, c => c.toUpperCase()) : b.offer}. Book by ${dayShort(b.to || today)}.`, 90))}</td><td style="white-space:normal">${s.xs.map(x => esc(x.id)).join(", ")}</td></tr>`).join("")}</tbody></table></div>
      <p class="sub">"Create drafts" makes an Email cards set for each send (the campaign's offer badge on every card, its T&amp;Cs in "Copy offer T&amp;Cs").</p>`) : ""}
    ${C.page ? sec("page", "Landing page", `<div class="ac-block" style="margin:10px 0"><p style="margin:0"><b>${esc(lp.h1)}</b></p><p class="sub" style="margin:2px 0 8px">${esc(SITE + "/" + lp.slug + "/")}</p>
      <p style="margin:0 0 6px">${esc(lp.intro)}</p><p class="sub" style="margin:0">SEO title: ${esc(lp.seoTitle)} (${lp.seoTitle.length}) · Description: ${esc(lp.metaDesc)} (${lp.metaDesc.length})</p>
      <p class="sub" style="margin:6px 0 0">Sections: ${lp.blocks.map(x => esc(x.h2 || x.title || x.text || x.type)).join(" · ")}. Sailings list: ${lp.codes.length} cruise codes for Storyblok's CruiseList.</p></div>`) : ""}
    ${C.social ? sec("social", "Social and video", `<ul style="margin:0 0 0 18px;padding:0">${on.map(g => `<li>${esc(g.label)}: route video for <a href="#${esc(g.xs[0].id)}">${esc(g.xs[0].short)}</a> (${esc(g.xs[0].id)}), from its detail view</li>`).join("")}
      <li>Stories: the phase openers in 9:16${ph.length ? ` (${ph.map(p => esc(p.label)).join(", ")})` : ""}</li><li>Launch post: the campaign line and the landing page</li></ul>`) : ""}
    ${sec("calendar", "Calendar", calendar())}`;
}

// ---------- drafts in the creators ----------
function adDraft(g){
  const b = st.brief, xs = g.xs.slice(0, 8);
  return {format: "carousel", size: "1x1", primary: primary(g), cta: "Book now", campaign: {name: b.name, badge: b.badge, terms: b.terms, from: b.from, to: b.to},
    cards: xs.map(x => { const c = cardLine(x); return {id: x.id, design: "standard", photo: x.photo || null, words: null, promos: b.badge ? [b.badge] : [], nectar: false, headline: c.hl, description: c.desc, link: x.link}; }),
    intro: {on: true, eyebrow: b.name || "", headline: b.headline || b.offer || "", cta: "Swipe to explore ›", useA: true, mHeadline: cut(b.headline || b.offer || "", 40), mDesc: cut(`Book ${dayShort(b.from || today)} to ${dayShort(b.to || today)}`, 30), link: SITE + (b.landing || "/")},
    end: {on: true, headline: b.headline || "The warmest welcome at sea - because moments matter", cta: `Book by ${dayShort(b.to || today)}`, url: "ambassadorcruiseline.com", useA: true, mHeadline: "Book your sailing today", mDesc: "", link: SITE + (b.landing || "/")}};
}
function cardsDraft(s){
  const b = st.brief;
  return {items: s.xs.map(x => ({id: x.id, photo: x.photo || "", caption: "", name: "", badges: b.badge ? [b.badge] : [], fare: "twin", grade: ""})), allBadges: false,
    sizes: {standard: true, wide: true}, kinds: {card: true, pic: false}, campaign: {name: b.name, badge: b.badge, terms: b.terms, from: b.from, to: b.to}};
}
async function makeDrafts(list, gs, sd, lp){
  const b = st.brief, made = [], C = b.channels, name = b.name || "Campaign";
  const mk = (kind, field) => sharedStore({kind, localKey: {ad: "spw-ad-drafts", ecards: "spw-email-cards-sets", page: "spw-pages-saved"}[kind], field, idToken: ctx.idToken});
  try {
    if (C.meta) { const s = mk("ad", "ad"); await s.load(); for (const g of gs.filter(x => x.on)) { await s.save(null, `${name} · ${g.label} carousel`, adDraft(g)); made.push(`Ad creator: ${name} · ${g.label} carousel`); } }
    if (C.email) { const s = mk("ecards", "cards"); await s.load(); for (const x of sd) { await s.save(null, `${name} · ${x.label} email (${dayShort(x.d)})`, cardsDraft(x)); made.push(`Email cards: ${name} · ${x.label} email (${dayShort(x.d)})`); } }
    if (C.page) { const s = mk("page", "page"); await s.load(); await s.save(null, `${name} · landing page`, lp); made.push(`Pages and blog: ${name} · landing page`); }
    st.made = made; st.note = "";
  } catch (e) { st.note = `Couldn't create every draft: ${esc(e.message)}${made.length ? ` (${made.length} made)` : ""}.`; st.made = made.length ? made : null; }
  draw();
}

// the same packing as the Ad creator's share links (#ad=…), so a carousel opens straight in the Ad creator
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function pack(obj){ const z = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("deflate-raw")); return b64u(new Uint8Array(await new Response(z).arrayBuffer())); }

function csvFile(name, rows){
  const q = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], {type: "text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

function wire(list, gs, on, sd, gg, lp){
  const $ = s => root.querySelector(s), all = s => root.querySelectorAll(s), b = st.brief;
  const redraw = () => { save(); const f = document.activeElement, id = f && f.id, pos = f && f.selectionStart; draw(); if (id) { const n = root.querySelector("#" + id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch(e) {} } } };
  all("[data-b]").forEach(i => i.addEventListener("input", () => { b[i.dataset.b] = i.value; clearTimeout(i._t); i._t = setTimeout(redraw, 400); }));
  all("[data-r]").forEach(i => i.addEventListener("change", () => { b.rule[i.dataset.r] = i.value; redraw(); }));
  all("[data-pick]").forEach(x => x.addEventListener("click", () => { b.pick = x.dataset.pick; redraw(); }));
  all("[data-ch]").forEach(x => x.addEventListener("change", () => { b.channels[x.dataset.ch] = x.checked; redraw(); }));
  all("[data-grp]").forEach(x => x.addEventListener("change", () => { b.off[x.dataset.grp] = !x.checked; redraw(); }));
  $("#cb-new").addEventListener("click", () => { if (!confirm("Start a new brief? Save this one first if you want to keep it.")) return; st = {brief: blank(), saved: null, note: "", made: null}; redraw(); });
  $("#cb-save").addEventListener("click", async () => {
    const all0 = store.all(), id0 = st.saved && all0[st.saved] && store.mine(st.saved) ? st.saved : null;
    const name = id0 ? all0[id0].name : prompt("Name this brief", b.name || "Campaign brief"); if (!name) return;
    try { st.saved = await store.save(id0, name.slice(0, 80), b); st.note = `Saved "${esc(name)}"${store.shared ? "" : " in this browser"}.`; } catch (e) { st.note = `Couldn't save: ${esc(e.message)}`; }
    redraw();
  });
  $("#cb-open") && $("#cb-open").addEventListener("change", e => { const x = store.all()[e.target.value]; if (!x) return; st.brief = {...blank(), ...x.brief}; st.saved = store.mine(e.target.value) ? e.target.value : null; st.made = null; st.note = `Opened "${esc(x.name)}"${store.mine(e.target.value) ? "" : `, saved by ${esc(x.by || "someone else")}: Save as… keeps your own copy`}.`; redraw(); });
  $("#cb-make") && $("#cb-make").addEventListener("click", async e => { e.target.disabled = true; e.target.textContent = "Creating drafts…"; await makeDrafts(list, gs, sd, lp); });
  all("[data-openad]").forEach(x => x.addEventListener("click", async () => { const g = gs.find(y => y.key === x.dataset.openad); if (!g) return; location.hash = "ad=" + await pack(adDraft(g)); }));
  $("#cb-gcsv") && $("#cb-gcsv").addEventListener("click", () => {
    const camp = `${b.name || "Campaign"} - Search`;
    csvFile(`${camel(b.name || "campaign")}_search_ads.csv`, [["Campaign", "Ad group", "Ad type", ...Array.from({length: 15}, (_, i) => `Headline ${i + 1}`), ...Array.from({length: 4}, (_, i) => `Description ${i + 1}`), "Path 1", "Path 2", "Final URL"],
      ...gg.map(g => [camp, g.group, "Responsive search ad", ...Array.from({length: 15}, (_, i) => g.hl[i] || ""), ...Array.from({length: 4}, (_, i) => g.ds[i] || ""), g.paths[0], g.paths[1], g.url])]);
    csvFile(`${camel(b.name || "campaign")}_sitelinks.csv`, [["Campaign", "Ad group", "Sitelink text", "Description line 1", "Description line 2", "Final URL"], ...gg.flatMap(g => g.sitelinks.map(s => [camp, g.group, s.t, s.d1, s.d2, s.url]))]);
    csvFile(`${camel(b.name || "campaign")}_callouts.csv`, [["Campaign", "Ad group", "Callout text"], ...gg.flatMap(g => g.callouts.map(c => [camp, g.group, c]))]);
  });
  $("#cb-dl") && $("#cb-dl").addEventListener("click", () => {
    const body = $("#cb-plan").cloneNode(true); body.querySelectorAll(".ac-actions, button, input[type=checkbox]").forEach(n => n.remove());
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.name || "Campaign")} plan</title>
      <style>body{font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1220;background:#F6F3F7;margin:0;padding:32px 20px}main{max-width:1100px;margin:0 auto}
      h1{font:600 32px Quicksand,Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6B207D;margin:0 0 6px}h3{color:#6B207D;border-top:1px solid #e3dbe7;padding-top:18px}
      .ac-block{background:#fff;border:1px solid #e3dbe7;padding:12px 14px}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:6px 8px 6px 0;border-bottom:1px solid #e3dbe7;vertical-align:top}
      th{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:#5E5465}.sub{color:#5E5465;font-size:13px}code{font-size:12px;color:#5E5465}a{color:#6B207D}.tablewrap{overflow-x:auto}</style></head>
      <body><main><h1>${esc(b.name || "Campaign")}</h1><p class="sub">${esc(b.offer || "")}${b.from ? ` · book ${day(b.from)} to ${day(b.to)}` : ""} · prices as checked ${day(today)} · made in the Sailing Price Watch campaign builder</p>${body.innerHTML.replace(/href="#/g, `href="${location.origin}/#`)}</main></body></html>`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], {type: "text/html"})); a.download = `${camel(b.name || "campaign")}_plan.html`; a.click();
  });
}
