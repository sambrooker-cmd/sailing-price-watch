// Page creator: landing pages and blog posts (Sam, 16 Oct 2026: "scope out and prototype landing and blog page
// creation"). PROTOTYPE. The page is built from blocks in the layout the website's own pages use (Storyblok + Astro on
// ambassadorcruiseline.com): landing pages = hero (H1, subtitle) → the CruiseList of sailings (by category or by cruise
// codes) → text sections → FAQs → call to action; blog posts = H1, date, intro, H2 sections with pictures and "Read
// more" links, the sailings, a closing call to action. Starting points fill it from the tracker's own data (sailings
// on sale, from prices, ports, ships, lengths, photos); the words are suggestions to rewrite. Live preview in the
// site's style (desktop / phone), SEO checks, and exports: the fields to copy into Storyblok, an HTML page to share
// for review, and schema.org JSON-LD. Nothing is published anywhere. Draft kept in this browser (spw-pages).
import * as cs from "./sections.js?v=__BUILD__";
import {cropUrl} from "./adcards.js?v=__BUILD__";
import {regionOf, photoWords} from "./comptrend.js?v=__BUILD__";

const SITE = "https://www.ambassadorcruiseline.com";
const KEY = "spw-pages";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = n => "£" + Math.round(n).toLocaleString("en-GB");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDate = d => { const t = new Date(d + "T12:00:00Z"); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
const monthOf = d => d.slice(0, 7);
const monthName = m => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const slugify = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
// "Norwegian Fjords Cruises from London Tilbury" in a sentence: place names keep their capitals
const lc = t => String(t || "").replace(/\b(Cruises|Cruise|No-Fly|Fly-Cruises|From|With|In|The)\b/g, w => w.toLowerCase());
const one = t => { const x = lc(t).replace(/\bcruises\b/, "cruise").replace(/\bfly-cruises\b/, "fly-cruise"); return (/^[AEIOU]/i.test(x) ? "an " : "a ") + x; };
const words = s => (String(s || "").match(/[\p{L}\p{N}’']+/gu) || []).length;

// The tracker's regions, as the website names them
const THEME = {caribbean: "Caribbean", iceland: "Iceland and Arctic", norway: "Norwegian Fjords", baltic: "Baltic and Scandinavia",
  british: "British Isles", iberia: "Spain, Portugal and Canary Islands", med: "Mediterranean", near: "Northern Europe", long: "Long-haul"};
// Internal links the website has (cruise types, deals, ships): offered as "Read more" and call-to-action links
const LINKS = [
  ["All cruises", "/cruise-search/"], ["No-fly cruises", "/no-fly-cruises/"], ["Cruise offers", "/deals/cruise-offers/"],
  ["Cruises of the Week", "/deals/cruises-of-the-week/"], ["Festive market cruises", "/cruise-types/festive-markets/"],
  ["Christmas and New Year cruises", "/cruise-types/christmas-and-new-year-cruises/"], ["Mini cruises", "/cruise-types/mini-cruises/"],
  ["Caribbean no-fly cruises", "/cruise-types/caribbean-no-fly-cruises/"], ["Winter escapes", "/cruise-types/winter-escapes/"],
  ["Themed cruises", "/cruise-types/themed-cruises/"], ["Longer cruises (15 nights+)", "/cruise-types/15-night-longer-cruises/"],
  ["Our ships", "/our-ships/"], ["Before you sail", "/before-you-sail/"], ["Nectar", "/nectar/"], ["Blog", "/blog/"]];

const TEMPLATES = {
  landing: [["theme", "Destination or departure port"], ["offer", "Campaign or offer (for ads)"], ["month", "Sailings in a month or season"]],
  blog: [["reasons", "\"10 reasons to…\" list"], ["guide", "Destination guide"], ["spotlight", "Sailing spotlight"]],
};

let root, ctx, st, today, kitOf;

// ---------- data ----------
function onSale(){
  return Object.entries(ctx.state.sailings || {}).filter(([, s]) => !s.removed && s.departure_date > today)
    .map(([id, s]) => ({id, ...s, price: (s.segments || []).length ? s.segments[s.segments.length - 1].p : null,
      region: regionOf(s.title || "", s.port || "", photoWords((kitOf(id) || {}).photos))}))
    .filter(s => s.price);
}
function matches(f){
  return onSale().filter(s => (!f.region || s.region === f.region) && (!f.port || (s.flight_from ? "Flights from " + s.flight_from : s.port) === f.port) &&
    (!f.fly || (f.fly === "fly") === !!s.flight_from) && (!f.from || monthOf(s.departure_date) >= f.from) && (!f.to || monthOf(s.departure_date) <= f.to) &&
    (!f.ship || s.ship === f.ship)).sort((a, b) => a.departure_date.localeCompare(b.departure_date));
}
function listOf(p){
  const all = onSale(), by = Object.fromEntries(all.map(s => [s.id, s]));
  return p.codes ? p.codes.map(c => by[c]).filter(Boolean) : matches(p.filter);
}
function facts(list){
  const n = list.length, prices = list.map(s => s.price);
  const count = arr => Object.entries(arr.reduce((o, k) => (k && (o[k] = (o[k] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const nights = list.map(s => s.nights).filter(Boolean);
  const years = [...new Set(list.map(s => s.departure_date.slice(0, 4)))].sort();
  return {n, min: prices.length ? Math.min(...prices) : null, ports: count(list.filter(s => !s.flight_from).map(s => s.port)),
    airports: count(list.filter(s => s.flight_from).map(s => s.flight_from)), ships: count(list.map(s => s.ship)),
    nmin: nights.length ? Math.min(...nights) : null, nmax: nights.length ? Math.max(...nights) : null,
    fly: list.some(s => s.flight_from), nofly: list.some(s => !s.flight_from), years,
    yearText: years.length > 2 ? `${years[0]}–${years[years.length - 1].slice(2)}` : years.join("/").replace(/\/20(\d\d)$/, "/$1"),
    first: list[0], cheapest: list.slice().sort((a, b) => a.price - b.price)[0]};
}
const nightsText = f => f.nmin == null ? "" : f.nmin === f.nmax ? `${f.nmin}-night` : `${f.nmin} to ${f.nmax}-night`;
const listText = arr => arr.length <= 1 ? (arr[0] || "") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
const photosOf = list => [...new Set(list.flatMap(s => [(kitOf(s.id) || {}).image, ...((kitOf(s.id) || {}).photos || [])]).filter(u => u && !/\/ships\//.test(u)))];

// ---------- starting points (no AI: built from the facts, to be rewritten) ----------
function themeName(f){
  const parts = [];
  parts.push(f.region ? THEME[f.region] + " Cruises" : f.fly === "fly" ? "Fly-Cruises" : f.fly === "nofly" ? "No-Fly Cruises" : "Cruises");
  if (f.port) parts.push(f.port.startsWith("Flights from ") ? "with " + f.port : "from " + f.port.replace(/,.*$/, ""));
  else if (!f.region && f.fly !== "fly") parts.push("from the UK");
  if (f.from && f.from === f.to) parts.push("in " + monthName(f.from));
  return parts.join(" ");
}
function brandSection(fa){
  return [
    "Our smaller ships carry fewer guests, so there's more space, shorter queues and a crew who soon know your name. " +
      "Every sailing comes with full-board dining, evening entertainment and the warmest welcome at sea.",
    fa.nofly && !fa.fly ? `There are no flights to worry about: you join the ship close to home${fa.ports.length ? ` at ${listText(fa.ports.slice(0, 4))}` : ""} and your holiday starts the moment you step aboard.` :
      fa.fly ? `On our fly-cruises the flights${fa.airports.length ? ` from ${listText(fa.airports)}` : ""} are part of the holiday, so getting there is sorted.` : "",
  ].filter(Boolean).join("\n\n");
}
function faqFor(theme, fa, keyword){
  const out = [];
  if (fa.min) out.push({q: `How much does ${one(theme.replace(/ (from|with|in) .*$/i, ""))} cost?`,
    a: `Our ${lc(theme)} start from ${money(fa.min)} per person, based on two sharing. Prices change with availability: the price on each sailing above is the latest.`});
  if (fa.ports.length || fa.airports.length) out.push({q: `Where do ${lc(theme.replace(/ (from|with) .*$/i, ""))} depart from?`,
    a: [fa.ports.length ? `They sail from ${listText(fa.ports)}.` : "", fa.airports.length ? `Fly-cruises have flights from ${listText(fa.airports)}.` : ""].filter(Boolean).join(" ")});
  if (fa.nmin) out.push({q: `How long are the sailings?`, a: `Between ${fa.nmin} and ${fa.nmax} nights${fa.nmin === fa.nmax ? "" : ", so there's a length for a short break or a longer holiday"}.`.replace(`Between ${fa.nmin} and ${fa.nmin} nights`, `${fa.nmin} nights`)});
  if (fa.ships.length) out.push({q: `Which ships sail these cruises?`, a: `${listText(fa.ships)}: ${fa.ships.length > 1 ? "smaller ships" : "a smaller ship"} with fewer guests and the warmest welcome at sea.`});
  out.push({q: "What's included?", a: "Full-board dining, entertainment every evening and our onboard facilities. Drinks packages, excursions and gratuities can be added."});
  return out;
}
function landing(template, filter, offer){
  const list = matches(filter), fa = facts(list);
  const theme = template === "offer" ? (offer || "Our latest offer") : template === "month" && filter.from ? `Cruises in ${monthName(filter.from)}${filter.to && filter.to !== filter.from ? ` to ${monthName(filter.to)}` : ""}` : themeName(filter);
  const keyword = theme.toLowerCase().replace(/ in \w+ \d{4}.*$/, "");
  const hero = photosOf(list)[0] || "";
  const intro = list.length ? `Choose from ${fa.n} ${theme.startsWith("Cruises") ? "sailings" : lc(theme)}${fa.nmin ? `, ${nightsText(fa)} holidays` : ""}${fa.min ? ` from ${money(fa.min)}pp` : ""}${fa.ships.length ? ` on ${listText(fa.ships)}` : ""}. ` +
    (fa.nofly && !fa.fly && fa.ports.length ? `Sail from ${listText(fa.ports.slice(0, 4))} with no flights needed.` : fa.fly ? "Flights are included, so getting there is sorted." : "") : "";
  return {kind: "landing", template, keyword, offer: offer || "", filter, codes: template === "offer" ? list.slice(0, 12).map(s => s.id) : null,
    slug: (template === "offer" ? "deals/" : "cruise-types/") + slugify(theme), seoTitle: `${theme} ${fa.yearText || ""}`.trim() + " | Ambassador",
    metaDesc: fit(155, [`Explore ${lc(theme)} on our smaller ships`, fa.nmin ? `: ${nightsText(fa)} holidays` : "", fa.min ? ` from ${money(fa.min)}pp` : "", ". ",
      fa.nofly && !fa.fly ? "No flights needed. " : "", "The warmest welcome at sea."]),
    h1: theme, sub: "The warmest welcome at sea - because moments matter", hero, heroAlt: altFor(hero), intro, date: today,
    blocks: [
      {type: "sailings", title: `Our ${theme.startsWith("Cruises") ? "sailings" : lc(theme)}`},
      {type: "text", h2: `Why choose ${theme.startsWith("Cruises") ? "a cruise" : one(theme.replace(/ (from|with|in) .*$/i, ""))} with Ambassador?`, body: brandSection(fa)},
      {type: "text", h2: "Where you'll go", body: "", hint: `Write 100–150 words about the places these sailings visit: ${listText(list.slice(0, 4).map(s => s.base_title || s.title))}.`},
      {type: "faq", title: "Frequently asked questions", items: faqFor(theme, fa, keyword)},
      {type: "cta", text: "See all our cruises", url: SITE + "/cruise-search/"},
    ]};
}
function blog(template, filter){
  const list = matches(filter), fa = facts(list);
  const place = filter.region ? THEME[filter.region] : filter.port ? filter.port.replace(/,.*$/, "") : "a cruise from the UK";
  const kwShown = filter.region ? `${THEME[filter.region]} cruise` : place.startsWith("a ") ? "cruise from the UK" : `cruise from ${place}`;
  const kw = kwShown.toLowerCase();
  const photos = photosOf(list);
  const pic = i => photos[i % Math.max(1, photos.length)] || "";
  const base = {kind: "blog", template, filter, codes: null, date: today, sub: "", hero: pic(0), heroAlt: altFor(pic(0))};
  const tail = [
    {type: "sailings", title: `Find your ${kwShown}`},
    {type: "readmore", title: "Cruise offers", url: SITE + "/deals/cruise-offers/"},
    {type: "cta", text: "Browse all our cruises", url: SITE + "/cruise-search/"},
  ];
  if (template === "guide") {
    const title = `A guide to ${filter.region ? THEME[filter.region] : place} cruises`;
    return {...base, keyword: kw, slug: "blog/" + slugify(title), h1: title, seoTitle: `${title} | Ambassador`,
      metaDesc: fit(155, [`Everything you need to know before ${one(kwShown)}: when to go, what to see and life on board our smaller ships`, fa.min ? `, with sailings from ${money(fa.min)}pp` : "", "."]),
      intro: "", introHint: `Open with 2–3 sentences on why ${place} is worth the trip, using "${kwShown}" naturally.`,
      blocks: [
        {type: "text", h2: `Why choose ${one(kwShown)}?`, body: "", hint: "120–180 words: the scenery, the pace, what makes it special."},
        {type: "image", photo: pic(1), alt: altFor(pic(1)), caption: ""},
        {type: "text", h2: "When is the best time to go?", body: "", hint: `Seasons and what each brings.${list.length ? ` Our sailings run ${monthName(monthOf(list[0].departure_date))} to ${monthName(monthOf(list[list.length - 1].departure_date))}.` : ""}`},
        {type: "text", h2: "What to see and do ashore", body: "", hint: "3–5 highlights, one short paragraph each."},
        {type: "image", photo: pic(2), alt: altFor(pic(2)), caption: ""},
        {type: "text", h2: "Life on board", body: brandSection(fa)},
        {type: "faq", title: "Frequently asked questions", items: faqFor(filter.region ? THEME[filter.region] + " cruises" : "Our cruises", fa, kw)},
        ...tail]};
  }
  if (template === "spotlight") {
    const s = list[0];
    const title = s ? `Sailing spotlight: ${s.base_title || s.title}` : "Sailing spotlight";
    return {...base, keyword: s ? (s.base_title || s.title).toLowerCase() : kw, slug: "blog/" + slugify(title), h1: title, seoTitle: `${title} | Ambassador`,
      metaDesc: s ? fit(155, [`A closer look at ${s.base_title || s.title}: ${s.nights} nights on ${s.ship}`, s.flight_from ? ` with flights from ${s.flight_from}` : ` from ${s.port}`, `, departing ${fmtDate(s.departure_date)}, from ${money(s.price)}pp.`]) : "",
      intro: s ? `${s.nights} nights on ${s.ship}, ${s.flight_from ? "with flights from " + s.flight_from : "sailing from " + s.port}, departing ${fmtDate(s.departure_date)}.` : "",
      codes: s ? [s.id] : [],
      blocks: [
        {type: "text", h2: "The route", body: "", hint: "Day by day or port by port: what guests see and do."},
        {type: "image", photo: pic(1), alt: altFor(pic(1)), caption: ""},
        {type: "text", h2: "Highlights", body: "", hint: "Three moments not to miss."},
        {type: "text", h2: `On board ${s ? s.ship : "the ship"}`, body: brandSection(fa)},
        ...tail]};
  }
  const title = `10 reasons to book ${one(kwShown)}`;
  return {...base, keyword: kw, slug: "blog/" + slugify(title), h1: title, seoTitle: `${title} | Ambassador`,
    metaDesc: fit(155, [`Discover 10 reasons to book ${one(kwShown)}, from the scenery to life on board our smaller ships`, fa.min ? `. Sailings from ${money(fa.min)}pp.` : "."]),
    intro: "", introHint: "2–3 sentences: set the scene and promise the ten reasons.",
    blocks: [...Array.from({length: 10}, (_, i) => [
        {type: "text", h2: "", body: "", hint: `Reason ${i + 1}: a short heading (it becomes an H2) and 80–120 words.`},
        ...(i % 3 === 1 ? [{type: "image", photo: pic(i + 1), alt: altFor(pic(i + 1)), caption: ""}] : [])]).flat(),
      ...tail]};
}
function fit(max, parts){
  let out = "";
  for (const p of parts) if ((out + p).length <= max) out += p;
  return out.replace(/\s+\./g, ".").trim();
}
function altFor(u){
  if (!u) return "";
  const w = String(u).split("/").pop().replace(/\.(jpe?g|png|webp).*$/i, "").replace(/[_-]+/g, " ").split(/\s+/)
    .filter(x => x && !/\d/.test(x) && !/^(shutterstock|istock|adobestock|getty|selected|edited|edit|ed|sur|large|small|amb|xxx|new|to|use|final|copy|web|hero|img|image|photo|rs|dji|v|crop|cropped|min)$/i.test(x))
    .join(" ").trim();
  return w ? w[0].toUpperCase() + w.slice(1) : "";
}

// ---------- rendering (the preview and the HTML export share it) ----------
function md(text){
  const inline = t => esc(t).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, a, u) => `<a href="${u.startsWith("/") ? SITE + u : u}">${a}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  return String(text || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p =>
    /^[-•] /m.test(p) ? `<ul>${p.split("\n").map(l => `<li>${inline(l.replace(/^[-•]\s*/, ""))}</li>`).join("")}</ul>` : `<p>${inline(p)}</p>`).join("");
}
function sailingCard(s){
  const img = (kitOf(s.id) || {}).image;
  return `<a class="sc" href="${esc(s.link || SITE)}"><img src="${esc(img ? cropUrl(img, 640, 400) : "")}" alt="${esc(s.base_title || s.title)}" loading="lazy">
    <span class="sc-b"><span class="sc-meta">${esc(fmtDate(s.departure_date))} · ${s.nights} nights</span>
    <b>${esc(s.base_title || s.title)}</b>
    <span class="sc-meta">${esc(s.ship)} · ${s.flight_from ? "Flights from " + esc(s.flight_from) : "From " + esc(s.port)}</span>
    <span class="sc-price">From <b>${money(s.price)}</b>pp</span></span></a>`;
}
const PAGE_CSS = `
*{box-sizing:border-box}body{margin:0;font-family:Quicksand,Helvetica,Arial,sans-serif;color:#3a3a3a;background:#fff;line-height:1.6;font-size:17px}
.top{background:#fff;border-bottom:1px solid #e4dfda;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
.top .logo{height:34px;width:auto;background:#6b1f7c;padding:6px 10px}.top span{font-size:13px;color:#6b1f7c;font-weight:700}
.hero{position:relative;min-height:340px;display:flex;align-items:flex-end;color:#fff;background:#6b1f7c center/cover no-repeat}
.hero::before{content:"";position:absolute;inset:0;background:linear-gradient(transparent 30%,rgba(56,8,67,.75))}
.hero .in{position:relative;padding:28px 24px;max-width:1100px;margin:0 auto;width:100%}
h1{font-size:40px;line-height:1.15;letter-spacing:.06em;text-transform:uppercase;font-weight:600;margin:0}
.hero p{margin:8px 0 0;font-size:18px}
.wrap{max-width:1100px;margin:0 auto;padding:28px 24px}
.blog .wrap{max-width:780px}
.blog h1{color:#6b1f7c;font-size:36px;margin-top:8px}
.date{color:#777;font-size:14px}
h2{color:#6b1f7c;font-size:26px;line-height:1.25;margin:34px 0 10px;font-weight:600}
.landing h2{text-transform:uppercase;letter-spacing:.05em;font-size:22px}
p{margin:0 0 14px}a{color:#6b1f7c}
.intro{font-size:19px}
figure{margin:22px 0}figure img{width:100%;display:block}figcaption{font-size:14px;color:#777;margin-top:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.sc{display:flex;flex-direction:column;border:1px solid #e4dfda;text-decoration:none;color:inherit;background:#fff}
.sc img{width:100%;aspect-ratio:16/10;object-fit:cover;background:#eee}.sc-b{padding:12px 14px;display:flex;flex-direction:column;gap:3px}
.sc b{color:#6b1f7c;font-size:17px;line-height:1.3}.sc-meta{font-size:14px;color:#666}.sc-price{margin-top:6px;font-size:15px}.sc-price b{font-size:20px}
.more{border-left:4px solid #f39200;padding:6px 12px;margin:20px 0;font-weight:600}.more span{color:#f39200;margin-right:6px}
details{border-bottom:1px solid #e4dfda;padding:12px 0}summary{font-weight:700;cursor:pointer;color:#3a3a3a}details p{margin:8px 0 0}
.cta{display:inline-block;background:#6b1f7c;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;margin:26px 0 6px}
.note{font-size:13px;color:#888;margin-top:30px}
.empty{background:#fff6e6;border:1px dashed #f39200;color:#8a5a00;padding:10px 12px;font-size:14px;margin:0 0 14px}
@media (max-width:600px){h1{font-size:28px}.blog h1{font-size:28px}h2{font-size:21px}.hero{min-height:260px}.wrap{padding:22px 16px}body{font-size:16px}}`;

function pageHtml(p, {forExport = false} = {}){
  const list = listOf(p);
  const blocks = p.blocks.map(b => {
    if (b.type === "text") return `${b.h2 ? `<h2>${esc(b.h2)}</h2>` : forExport ? "" : `<h2 class="empty">Heading to write</h2>`}${b.body ? md(b.body) : forExport ? "" : `<p class="empty">${esc(b.hint || "Text to write")}</p>`}`;
    if (b.type === "image") return b.photo ? `<figure><img src="${esc(cropUrl(b.photo, 1400, 790))}" alt="${esc(b.alt)}" loading="lazy">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>` : "";
    if (b.type === "sailings") return `<h2>${esc(b.title || "Our sailings")}</h2>${list.length ? `<div class="grid">${list.slice(0, 24).map(sailingCard).join("")}</div>` : `<p class="empty">No sailings match.</p>`}`;
    if (b.type === "faq") return (b.items || []).length ? `<h2>${esc(b.title || "Frequently asked questions")}</h2>${b.items.map(f => `<details${forExport ? "" : " open"}><summary>${esc(f.q)}</summary>${md(f.a)}</details>`).join("")}` : "";
    if (b.type === "readmore") return b.url ? `<p class="more"><span>READ MORE:</span><a href="${esc(b.url)}">${esc(b.title || b.url)}</a></p>` : "";
    if (b.type === "cta") return b.url ? `<p><a class="cta" href="${esc(b.url)}">${esc(b.text || "Find out more")}</a></p>` : "";
    return "";
  }).join("");
  const intro = p.intro ? `<div class="intro">${md(p.intro)}</div>` : forExport ? "" : `<p class="empty">${esc(p.introHint || "Intro to write")}</p>`;
  const body = p.kind === "landing"
    ? `<div class="hero" style="${p.hero ? `background-image:url('${esc(cropUrl(p.hero, 1600, 700))}')` : ""}"><div class="in"><h1>${esc(p.h1)}</h1>${p.sub ? `<p>${esc(p.sub)}</p>` : ""}</div></div>
       <div class="wrap">${intro}${blocks}<p class="note">Prices per person based on two sharing, as checked ${esc(fmtDate(ctx.state.updated))}; the website shows the latest.</p></div>`
    : `<div class="wrap"><div class="date">${esc(fmtDate(p.date || today))}</div><h1>${esc(p.h1)}</h1>
       ${p.hero ? `<figure><img src="${esc(cropUrl(p.hero, 1400, 790))}" alt="${esc(p.heroAlt)}"></figure>` : ""}${intro}${blocks}</div>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.seoTitle)}</title><meta name="description" content="${esc(p.metaDesc)}">
<link rel="canonical" href="${esc(SITE + "/" + p.slug + "/")}">
${forExport ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&display=swap" rel="stylesheet">` :
  `<style>@font-face{font-family:Quicksand;src:url(fonts/quicksand-latin-400-normal.woff2) format("woff2");font-weight:400}@font-face{font-family:Quicksand;src:url(fonts/quicksand-latin-600-normal.woff2) format("woff2");font-weight:600}@font-face{font-family:Quicksand;src:url(fonts/quicksand-latin-700-normal.woff2) format("woff2");font-weight:700}</style>`}
<style>${PAGE_CSS}</style>
<script type="application/ld+json">${JSON.stringify(schema(p)).replace(/</g, "\\u003c")}</script></head>
<body class="${p.kind}"><div class="top"><img class="logo" src="${forExport ? "https://acl-price-watch.web.app/" : ""}logo-white.svg" alt="Ambassador Cruise Line"><span>${p.kind === "blog" ? "Blog" : "Cruises"}</span></div>${body}</body></html>`;
}

function schema(p){
  const list = listOf(p), url = SITE + "/" + p.slug + "/";
  const faq = p.blocks.filter(b => b.type === "faq").flatMap(b => b.items || []).filter(f => f.q && f.a);
  const out = [];
  if (p.kind === "blog") out.push({"@context": "https://schema.org", "@type": "BlogPosting", headline: p.h1, description: p.metaDesc, datePublished: p.date || today,
    image: p.hero ? [cropUrl(p.hero, 1200, 675)] : undefined, mainEntityOfPage: url,
    author: {"@type": "Organization", name: "Ambassador Cruise Line", url: SITE},
    publisher: {"@type": "Organization", name: "Ambassador Cruise Line", url: SITE}});
  if (list.length) out.push({"@context": "https://schema.org", "@type": "ItemList", name: (p.blocks.find(b => b.type === "sailings") || {}).title || p.h1,
    itemListElement: list.slice(0, 24).map((s, i) => ({"@type": "ListItem", position: i + 1, item: {"@type": "TouristTrip", name: s.base_title || s.title, url: s.link,
      offers: {"@type": "Offer", price: s.price, priceCurrency: "GBP", availability: "https://schema.org/InStock"}}}))});
  if (faq.length) out.push({"@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(f => ({"@type": "Question", name: f.q, acceptedAnswer: {"@type": "Answer", text: f.a}}))});
  return out.length === 1 ? out[0] : out;
}

// ---------- checks ----------
function textOf(p){
  return [p.intro, ...p.blocks.map(b => b.type === "text" ? `${b.h2}\n${b.body}` : b.type === "faq" ? (b.items || []).map(f => `${f.q} ${f.a}`).join(" ") : b.type === "image" ? b.caption : "")].join("\n");
}
function checks(p){
  const out = [], add = (lvl, t) => out.push([lvl, t]);
  const kw = (p.keyword || "").toLowerCase().trim(), has = s => kw && String(s || "").toLowerCase().includes(kw);
  const kwWords = kw.split(/\s+/).filter(w => w.length > 3);
  const loose = s => kwWords.length && kwWords.every(w => String(s || "").toLowerCase().includes(w.replace(/s$/, "")));
  const tl = (p.seoTitle || "").length, dl = (p.metaDesc || "").length;
  add(tl >= 30 && tl <= 60 ? "ok" : "warn", `SEO title ${tl} characters (30–60 shows in full in Google).`);
  add(dl >= 120 && dl <= 155 ? "ok" : "warn", `Meta description ${dl} characters (aim for 120–155).`);
  if (!kw) add("warn", "No focus keyword: set one so the checks below can run.");
  else {
    add(has(p.seoTitle) || loose(p.seoTitle) ? "ok" : "warn", `Keyword in the SEO title.`);
    add(has(p.metaDesc) || loose(p.metaDesc) ? "ok" : "warn", `Keyword in the meta description.`);
    add(has(p.h1) || loose(p.h1) ? "ok" : "warn", `Keyword in the H1.`);
    add(has(p.intro) || loose(p.intro) ? "ok" : "warn", `Keyword in the first paragraph.`);
    add(p.blocks.some(b => b.type === "text" && (has(b.h2) || loose(b.h2))) ? "ok" : "warn", `Keyword (or its words) in at least one H2.`);
    add(kwWords.every(w => p.slug.includes(w.replace(/s$/, "").slice(0, 5))) ? "ok" : "warn", `Keyword in the address (/${p.slug}/).`);
  }
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(p.slug || "")) add("bad", "The address should be lower case words joined by hyphens.");
  const n = words(textOf(p)), need = p.kind === "blog" ? 800 : 300;
  add(n >= need ? "ok" : "warn", `${n.toLocaleString("en-GB")} words written (${p.kind === "blog" ? "blog posts" : "landing pages"}: aim for ${need}+). About ${Math.max(1, Math.round(n / 230))} minute${Math.round(n / 230) > 1 ? "s" : ""} to read.`);
  const h2s = p.blocks.filter(b => b.type === "text" && b.h2).length;
  const empty = p.blocks.filter(b => b.type === "text" && (!b.h2 || !b.body)).length + (p.intro ? 0 : 1);
  if (empty) add("warn", `${empty} section${empty === 1 ? "" : "s"} still to write (shown in amber in the preview).`);
  add(h2s >= (p.kind === "blog" ? 4 : 2) ? "ok" : "warn", `${h2s} H2 headings.`);
  const imgs = [p.hero && {alt: p.heroAlt}, ...p.blocks.filter(b => b.type === "image" && b.photo)].filter(Boolean);
  add(imgs.every(i => (i.alt || "").trim()) ? "ok" : "bad", `${imgs.filter(i => !(i.alt || "").trim()).length ? "Pictures without alt text: add a short description." : `All ${imgs.length} pictures have alt text.`}`);
  const links = (textOf(p).match(/\]\((https?:\/\/(www\.)?ambassadorcruiseline\.com|\/)/g) || []).length + p.blocks.filter(b => ["readmore", "cta"].includes(b.type) && b.url).length;
  add(links >= 2 ? "ok" : "warn", `${links} internal link${links === 1 ? "" : "s"} (aim for 2+; [words](/no-fly-cruises/) in the text makes one).`);
  const list = listOf(p), prices = new Set(list.map(s => Math.round(s.price)));
  const quoted = [...textOf(p).matchAll(/£\s?([\d,]+)/g)].map(m => +m[1].replace(/,/g, ""));
  const stale = quoted.filter(v => !prices.has(v) && !(p.blocks.some(b => b.type === "faq") && v === Math.min(...prices)));
  add(stale.length ? "bad" : "ok", stale.length ? `Prices in the text that aren't a current from price of these sailings: ${[...new Set(stale)].map(money).join(", ")}.` : "Every price in the text is a current from price.");
  if (/\b(was|reduced|save|saving|now only)\b[^.]{0,30}£/i.test(textOf(p))) add("bad", "Reduction wording next to a price: was/now prices only ever come from a live claim (not on pages yet).");
  add(list.length ? "ok" : (p.blocks.some(b => b.type === "sailings") ? "bad" : "ok"), list.length ? `${list.length} sailing${list.length === 1 ? "" : "s"} on sale listed.` : "No sailings on sale match.");
  return out;
}

// ---------- exports ----------
function storyblokText(p){
  const list = listOf(p), L = [];
  L.push(`PAGE TYPE: ${p.kind === "blog" ? "Blog post" : "Landing page"}`, `ADDRESS: ${SITE}/${p.slug}/`, `SEO TITLE: ${p.seoTitle}`, `META DESCRIPTION: ${p.metaDesc}`, `FOCUS KEYWORD: ${p.keyword}`, "");
  L.push(`H1: ${p.h1}`);
  if (p.sub) L.push(`SUBTITLE: ${p.sub}`);
  if (p.hero) L.push(`HERO IMAGE: ${p.hero}`, `HERO ALT TEXT: ${p.heroAlt}`);
  if (p.kind === "blog") L.push(`DATE: ${fmtDate(p.date || today)}`);
  L.push("", "INTRO:", p.intro || "(to write)");
  for (const b of p.blocks) {
    L.push("");
    if (b.type === "text") L.push(`H2: ${b.h2 || "(to write)"}`, b.body || "(to write)");
    if (b.type === "image") L.push(`IMAGE: ${b.photo}`, `ALT TEXT: ${b.alt}`, b.caption ? `CAPTION: ${b.caption}` : "");
    if (b.type === "sailings") L.push(`CRUISE LIST: "${b.title}"`, p.codes || p.template === "offer" ? `  cruise codes: ${list.map(s => s.id).join(",")}` : `  cruise codes (or the matching category): ${list.map(s => s.id).join(",")}`, "  sort: date ascending");
    if (b.type === "faq") { L.push(`FAQ: ${b.title}`); (b.items || []).forEach(f => L.push(`  Q: ${f.q}`, `  A: ${f.a}`)); }
    if (b.type === "readmore") L.push(`READ MORE: ${b.title} → ${b.url}`);
    if (b.type === "cta") L.push(`BUTTON: ${b.text} → ${b.url}`);
  }
  L.push("", "SCHEMA (JSON-LD, in the page head):", JSON.stringify(schema(p), null, 2));
  return L.filter(x => x !== null).join("\n");
}
function download(name, text, type){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copy(text, btn){
  try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = t, 1500); }
  catch(e) { prompt("Copy this", text); }
}

// ---------- page ----------
function save(){ try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e) {} }
const cur = () => st.pages[st.kind];

function filterUI(f, prefix){
  const all = onSale(), regions = [...new Set(all.map(s => s.region).filter(Boolean))];
  const ports = [...new Set(all.map(s => s.flight_from ? "Flights from " + s.flight_from : s.port))].sort((a, b) => a.startsWith("Flights") - b.startsWith("Flights") || a.localeCompare(b));
  const months = [...new Set(all.map(s => monthOf(s.departure_date)))].sort();
  const ships = [...new Set(all.map(s => s.ship))].sort();
  const sel = (k, label, opts) => `<label class="ac-lab sm" for="${prefix}-${k}">${label}</label><select id="${prefix}-${k}" data-f="${k}"><option value="">Any</option>${opts.map(([v, t]) => `<option value="${esc(v)}"${f[k] === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  return sel("region", "Destination", Object.keys(THEME).filter(k => regions.includes(k)).map(k => [k, THEME[k]])) +
    sel("port", "Departs from", ports.map(p => [p, p])) + sel("fly", "No-fly or fly", [["nofly", "No-fly"], ["fly", "Fly-cruise"]]) +
    sel("from", "Departing from", months.map(m => [m, monthName(m)])) + sel("to", "Departing until", months.map(m => [m, monthName(m)])) + sel("ship", "Ship", ships.map(s => [s, s]));
}

function blockEditor(b, i, n){
  const head = `<div class="pm-bh"><b>${{text: "Section", image: "Picture", sailings: "Sailings", faq: "FAQs", readmore: "Read more link", cta: "Button"}[b.type]}</b>
    <span><button type="button" class="linkbtn" data-mv="${i}" data-d="-1"${i ? "" : " disabled"} aria-label="Move up">↑</button>
    <button type="button" class="linkbtn" data-mv="${i}" data-d="1"${i < n - 1 ? "" : " disabled"} aria-label="Move down">↓</button>
    <button type="button" class="linkbtn" data-del="${i}" aria-label="Remove">✕</button></span></div>`;
  const inp = (k, label, val, ph = "", max = 0) => `<label class="ac-lab sm">${label}${max ? `<span class="${(val || "").length > max ? "over" : ""}">${(val || "").length}/${max}</span>` : ""}</label><input data-b="${i}" data-k="${k}" value="${esc(val)}" placeholder="${esc(ph)}">`;
  let body = "";
  if (b.type === "text") body = inp("h2", "H2 heading", b.h2, b.hint ? "Heading" : "") + `<label class="ac-lab sm">Text</label><textarea data-b="${i}" data-k="body" rows="${Math.min(12, Math.max(4, (b.body || "").split("\n").length + 2))}" placeholder="${esc(b.hint || "")}">${esc(b.body)}</textarea>`;
  if (b.type === "image") body = photoPick(b.photo, `data-bphoto="${i}"`) + inp("alt", "Alt text", b.alt, "Describe the picture") + inp("caption", "Caption (optional)", b.caption);
  if (b.type === "sailings") body = inp("title", "Heading", b.title);
  if (b.type === "faq") body = inp("title", "Heading", b.title) + (b.items || []).map((f, j) => `<div class="pm-faq"><input data-faq="${i}" data-j="${j}" data-k="q" value="${esc(f.q)}" placeholder="Question">
      <textarea data-faq="${i}" data-j="${j}" data-k="a" rows="2" placeholder="Answer">${esc(f.a)}</textarea><button type="button" class="linkbtn" data-faqdel="${i}" data-j="${j}">Remove question</button></div>`).join("") +
      `<button type="button" class="linkbtn" data-faqadd="${i}">+ Add a question</button>`;
  if (b.type === "readmore" || b.type === "cta") body = inp(b.type === "cta" ? "text" : "title", b.type === "cta" ? "Button words" : "Link words", b.type === "cta" ? b.text : b.title) +
    `<label class="ac-lab sm">Goes to</label><select data-b="${i}" data-k="url">${LINKS.map(([t, u]) => `<option value="${SITE + u}"${b.url === SITE + u ? " selected" : ""}>${esc(t)}</option>`).join("")}
      ${b.url && !LINKS.some(([, u]) => SITE + u === b.url) ? `<option selected value="${esc(b.url)}">${esc(b.url)}</option>` : ""}</select>`;
  return `<div class="pm-block">${head}${body}</div>`;
}
function photoPick(curUrl, attr){
  const ph = photosOf(listOf(cur())).slice(0, 18);
  if (!ph.length) return `<p class="sub">No photos: pick sailings first.</p>`;
  return `<div class="pm-photos">${ph.map(u => `<button type="button" ${attr} data-u="${esc(u)}" class="${u === curUrl ? "on" : ""}"><img src="${esc(cropUrl(u, 160, 100))}" alt=""></button>`).join("")}</div>`;
}

function draw(){
  const p = cur();
  const list = p ? listOf(p) : [];
  const ck = p ? checks(p) : [];
  const bad = ck.filter(c => c[0] !== "ok").length;
  const kindTabs = `<div class="seg" role="group" aria-label="Page type">${[["landing", "Landing page"], ["blog", "Blog post"]].map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${st.kind === k}">${t}</button>`).join("")}</div>`;
  const start = cs.section("pm-start", p ? "Start again from" : "Start from", p ? "a starting point (replaces this page)" : "", `
      <label class="ac-lab sm" for="pm-tpl">Starting point</label><select id="pm-tpl">${TEMPLATES[st.kind].map(([k, t]) => `<option value="${k}"${st.tpl[st.kind] === k ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
      ${st.tpl[st.kind] === "offer" ? `<label class="ac-lab sm" for="pm-offer">Offer or campaign name</label><input id="pm-offer" value="${esc(st.offer)}" placeholder="e.g. Cruises of the Week">` : ""}
      ${filterUI(st.f, "pm-f")}
      <p class="sub">${matches(st.f).length} sailings on sale match.${st.tpl[st.kind] === "spotlight" ? " The first one is the spotlight." : ""}</p>
      <button type="button" class="btn sm" id="pm-go">${p ? "Start again" : "Start"}</button>`, !p);
  if (!p) {
    root.innerHTML = `<div class="ac"><div class="ac-side">${kindTabs}${start}</div><div class="ac-main"><div class="ac-block"><p class="sub">Pick a starting point on the left: the page is filled from the tracker's sailings (prices, ports, ships, lengths, photos), in the layout of the website's own ${st.kind === "blog" ? "blog posts" : "landing pages"}. Then rewrite the words, check the SEO list and copy it into Storyblok.</p></div></div></div>`;
    return wire();
  }
  const settings = cs.section("pm-seo", "Address, SEO and top of page", `/${esc(p.slug)}/ · ${esc(p.seoTitle)}`, `
      <label class="ac-lab sm">Focus keyword</label><input data-p="keyword" value="${esc(p.keyword)}" placeholder="e.g. norwegian fjords cruise">
      <label class="ac-lab sm">Address<span>ambassadorcruiseline.com/…/</span></label><input data-p="slug" value="${esc(p.slug)}">
      <label class="ac-lab sm">SEO title<span class="${p.seoTitle.length > 60 ? "over" : ""}">${p.seoTitle.length}/60</span></label><input data-p="seoTitle" value="${esc(p.seoTitle)}">
      <label class="ac-lab sm">Meta description<span class="${p.metaDesc.length > 155 ? "over" : ""}">${p.metaDesc.length}/155</span></label><textarea data-p="metaDesc" rows="3">${esc(p.metaDesc)}</textarea>
      <label class="ac-lab sm">H1</label><input data-p="h1" value="${esc(p.h1)}">
      ${p.kind === "landing" ? `<label class="ac-lab sm">Subtitle</label><input data-p="sub" value="${esc(p.sub)}">` : `<label class="ac-lab sm">Date</label><input type="date" data-p="date" value="${esc(p.date || today)}">`}
      <label class="ac-lab sm">Hero picture</label>${photoPick(p.hero, "data-hero")}
      <label class="ac-lab sm">Hero alt text</label><input data-p="heroAlt" value="${esc(p.heroAlt)}">
      <label class="ac-lab sm">Intro</label><textarea data-p="intro" rows="4" placeholder="${esc(p.introHint || "")}">${esc(p.intro)}</textarea>`, true);
  const sail = cs.section("pm-sail", "Sailings on the page", `${list.length} sailing${list.length === 1 ? "" : "s"}${p.codes ? ", picked by hand" : ", matching the filters"}`, `
      ${p.codes ? `<p class="sub">Picked by hand (the website's cruise list takes these cruise codes). <button type="button" class="linkbtn" id="pm-auto">Use the filters instead</button></p>
        <ol class="pm-list">${list.map(s => `<li><span>${esc(s.base_title || s.title)} <span class="sub">${esc(s.id)} · ${esc(fmtDate(s.departure_date))} · ${money(s.price)}</span></span><button type="button" class="linkbtn" data-rm="${esc(s.id)}" aria-label="Remove">✕</button></li>`).join("")}</ol>
        <label class="ac-lab sm" for="pm-find">Add a sailing</label><input id="pm-find" type="search" placeholder="Search name, port or cruise code" value="${esc(st.find)}"><div class="ac-results">${st.find ? onSale().filter(s => !p.codes.includes(s.id) && [s.id, s.title, s.port, s.flight_from].join(" ").toLowerCase().includes(st.find.toLowerCase())).slice(0, 8).map(s => `<button type="button" data-addcode="${esc(s.id)}"><b>${esc(s.base_title || s.title)}</b><span class="sub">${esc(s.id)} · ${esc(fmtDate(s.departure_date))}</span></button>`).join("") : ""}</div>`
      : `${filterUI(p.filter, "pm-pf")}<p class="sub"><button type="button" class="linkbtn" id="pm-hand">Pick them by hand instead</button></p>`}`, false);
  const blocks = cs.section("pm-blocks", "Sections", `${p.blocks.length} blocks`, `
      ${p.blocks.map((b, i) => blockEditor(b, i, p.blocks.length)).join("")}
      <div class="pm-add"><span class="sub">Add:</span>${[["text", "Section"], ["image", "Picture"], ["sailings", "Sailings"], ["faq", "FAQs"], ["readmore", "Read more"], ["cta", "Button"]].map(([t, l]) => `<button type="button" class="btn quiet sm" data-add="${t}">${l}</button>`).join("")}</div>`, true);
  root.innerHTML = `<div class="ac"><div class="ac-side">${kindTabs}${settings}${sail}${blocks}${start}</div>
    <div class="ac-main">
      <div class="ac-block"><div class="pm-bar"><div class="seg" role="group" aria-label="Preview size">${[["desk", "Desktop"], ["phone", "Phone"]].map(([k, t]) => `<button type="button" data-dev="${k}" aria-pressed="${st.dev === k}">${t}</button>`).join("")}</div>
        <span class="pm-exp"><button type="button" class="btn sm" id="pm-copy">Copy for Storyblok</button><button type="button" class="btn quiet sm" id="pm-html">Download HTML</button><button type="button" class="btn quiet sm" id="pm-schema">Copy schema</button></span></div>
        <div class="pm-frame ${st.dev}"><iframe id="pm-pv" title="Page preview" sandbox="allow-same-origin"></iframe></div>
        <p class="sub">A preview in the website's style, not the website itself. Amber boxes are still to write. Nothing is published: copy the fields into Storyblok (a draft there), or download the HTML to share for review.</p></div>
      <div class="ac-block"><h3>Checks${bad ? ` <span class="sub">· ${bad} to look at</span>` : ""}</h3><ul class="pm-checks">${ck.map(([l, t]) => `<li class="${l}">${esc(t)}</li>`).join("")}</ul></div>
    </div></div>`;
  const fr = root.querySelector("#pm-pv");
  fr.srcdoc = pageHtml(p);
  fr.addEventListener("load", () => { try { fr.style.height = fr.contentDocument.documentElement.scrollHeight + "px"; } catch(e) {} });
  wire();
}

function wire(){
  cs.wire(root, draw);
  const p = cur();
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach(el => el.addEventListener(ev, e => fn(el, e)));
  on("[data-kind]", "click", el => { st.kind = el.dataset.kind; save(); draw(); });
  on("#pm-tpl", "change", el => { st.tpl[st.kind] = el.value; save(); draw(); });
  on("#pm-offer", "input", el => { st.offer = el.value; save(); });
  on("[id^=pm-f-]", "change", el => { st.f[el.dataset.f] = el.value; save(); draw(); });
  on("#pm-go", "click", () => {
    if (p && !confirm("Start again? This page's words will be replaced.")) return;
    st.pages[st.kind] = st.kind === "landing" ? landing(st.tpl.landing, {...st.f}, st.offer) : blog(st.tpl.blog, {...st.f});
    save(); draw();
  });
  if (!p) return;
  const soft = () => { save(); clearTimeout(wire.t); wire.t = setTimeout(draw, 600); };   // redraw after typing stops
  on("[data-p]", "input", el => { p[el.dataset.p] = el.value; soft(); });
  on("[data-b]", "input", el => { p.blocks[+el.dataset.b][el.dataset.k] = el.value; soft(); });
  on("select[data-b]", "change", el => { p.blocks[+el.dataset.b][el.dataset.k] = el.value; save(); draw(); });
  on("[data-faq]", "input", el => { p.blocks[+el.dataset.faq].items[+el.dataset.j][el.dataset.k] = el.value; soft(); });
  on("[data-faqadd]", "click", el => { (p.blocks[+el.dataset.faqadd].items ||= []).push({q: "", a: ""}); save(); draw(); });
  on("[data-faqdel]", "click", el => { p.blocks[+el.dataset.faqdel].items.splice(+el.dataset.j, 1); save(); draw(); });
  on("[data-mv]", "click", el => { const i = +el.dataset.mv, j = i + +el.dataset.d; [p.blocks[i], p.blocks[j]] = [p.blocks[j], p.blocks[i]]; save(); draw(); });
  on("[data-del]", "click", el => { p.blocks.splice(+el.dataset.del, 1); save(); draw(); });
  on("[data-add]", "click", el => {
    const t = el.dataset.add, ph = photosOf(listOf(p));
    p.blocks.push(t === "text" ? {type: t, h2: "", body: ""} : t === "image" ? {type: t, photo: ph[0] || "", alt: altFor(ph[0]), caption: ""} :
      t === "sailings" ? {type: t, title: "Our sailings"} : t === "faq" ? {type: t, title: "Frequently asked questions", items: [{q: "", a: ""}]} :
      t === "readmore" ? {type: t, title: LINKS[1][0], url: SITE + LINKS[1][1]} : {type: t, text: "See all our cruises", url: SITE + "/cruise-search/"});
    save(); draw();
  });
  on("[data-hero]", "click", el => { p.hero = el.dataset.u; p.heroAlt = altFor(el.dataset.u); save(); draw(); });
  on("[data-bphoto]", "click", el => { const b = p.blocks[+el.dataset.bphoto]; b.photo = el.dataset.u; b.alt = altFor(el.dataset.u); save(); draw(); });
  on("[id^=pm-pf-]", "change", el => { p.filter[el.dataset.f] = el.value; save(); draw(); });
  on("#pm-hand", "click", () => { p.codes = listOf(p).slice(0, 24).map(s => s.id); save(); draw(); });
  on("#pm-auto", "click", () => { p.codes = null; save(); draw(); });
  on("[data-rm]", "click", el => { p.codes = p.codes.filter(c => c !== el.dataset.rm); save(); draw(); });
  on("#pm-find", "input", el => { st.find = el.value; clearTimeout(wire.f); wire.f = setTimeout(() => { draw(); const f = root.querySelector("#pm-find"); f && (f.focus(), f.setSelectionRange(f.value.length, f.value.length)); }, 250); });
  on("[data-addcode]", "click", el => { p.codes.push(el.dataset.addcode); st.find = ""; save(); draw(); });
  on("[data-dev]", "click", el => { st.dev = el.dataset.dev; save(); draw(); });
  on("#pm-copy", "click", el => copy(storyblokText(p), el));
  on("#pm-schema", "click", el => copy(JSON.stringify(schema(p), null, 2), el));
  on("#pm-html", "click", () => download(`${p.slug.split("/").pop() || "page"}.html`, pageHtml(p, {forExport: true}), "text/html"));
}

export async function mount(el, c){
  root = el; ctx = c;
  today = c.state.updated || new Date().toISOString().slice(0, 10);
  kitOf = id => (((c.adkit || {}).sailings) || {})[id];
  st = {kind: "landing", tpl: {landing: "theme", blog: "reasons"}, f: {region: "norway", port: "", fly: "", from: "", to: "", ship: ""}, offer: "", pages: {landing: null, blog: null}, dev: "desk", find: ""};
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.pages) st = {...st, ...s, find: ""}; } catch(e) {}
  draw();
}

// for tests
export const _t = {landing, blog, checks, storyblokText, schema, pageHtml, altFor, slugify};
