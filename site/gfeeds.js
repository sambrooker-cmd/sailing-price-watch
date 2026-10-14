// Google Ads feeds (Sam, 14 Oct 2026, part 3 of the Google Ads page; download only): the dynamic remarketing feed
// (Google Ads "Custom" business data feed: every sailing on sale) and ad customiser values (one row per ad group, the
// Ad copy tab's "For each sailing" ad groups), built from the tracker's saved state only. A sale price is only ever a
// live was/now claim's own figures (passed in as wasnow), and only when the page asks for them.
//
// feedRow(s) → {ID, "Item title", …}; s: {id, title, ship, port, fly, nights, departure_date, price, link, image, wasnow: {was, now} | null}
// customiserRow(s) → {FromPrice, Nights, DepartureDate, DepartsFrom, Ship, Offer}; s as above plus promos: [card-safe lines]
// customiserLines(rows) → [{kind, text, longest}] lines for a responsive search ad that fit Google's limits for every row

import {noAmp, offerName, shortName, LIMITS} from "./gcopy.js?v=__BUILD__";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const gbp = v => `${Math.round(v)}.00 GBP`;   // Google's feed price format: number, then the ISO currency code
// Words cut at a space so they fit n characters ("" when even the first word doesn't)
const cut = (t, n) => { t = noAmp(t); if (t.length <= n) return t; const s = t.slice(0, n + 1); return s.slice(0, s.lastIndexOf(" ")).replace(/[\s,–:-]+$/, ""); };

// "From Bristol" rather than a half-cut "From Bristol Royal" when the whole port doesn't fit
const from = port => { const t = `From ${noAmp(port)}`; return t.length <= TEXT_MAX ? t : cut(`From ${noAmp(port).split(/[ ,]/)[0]}`, TEXT_MAX); };

// Custom feed columns, in Google's own (English) attribute names
export const FEED_COLUMNS = ["ID", "Item title", "Item subtitle", "Item description", "Item category", "Price", "Sale price",
  "Formatted price", "Formatted sale price", "Image URL", "Final URL", "Contextual keywords"];
export const TEXT_MAX = 25;   // Google's recommended length for the title, subtitle and description

export function feedRow(s){
  const c = s.wasnow;
  return {
    "ID": s.id,
    "Item title": shortName(s.title, TEXT_MAX) || cut(s.title, TEXT_MAX),
    "Item subtitle": `${day(s.departure_date)} · ${s.nights} nights`,
    "Item description": s.fly ? cut(`Fly from ${s.fly}`, TEXT_MAX) : from(s.port),
    "Item category": s.fly ? "Fly-cruise" : "No-fly cruise",
    "Price": gbp(c ? c.was : s.price),
    "Sale price": c ? gbp(c.now) : "",
    "Formatted price": c ? `Was ${money(c.was)}pp` : `From ${money(s.price)}pp`,
    "Formatted sale price": c ? `Now ${money(c.now)}pp` : "",
    "Image URL": s.image || "",
    "Final URL": s.link,
    "Contextual keywords": [noAmp(s.title), s.fly ? `${s.fly} flights` : s.port, s.ship, `${s.nights} night cruise`, "cruise"].filter(Boolean).join(";"),
  };
}

// Ad customiser attributes (all Text, so the words appear exactly as written)
export const ATTRIBUTES = [
  ["FromPrice", "From price per person, e.g. £1,029"],
  ["Nights", "Number of nights, e.g. 7"],
  ["DepartureDate", "Departure date, e.g. 12 Jan 2027"],
  ["DepartsFrom", "UK port, or the airport for fly-cruises, e.g. Heathrow"],
  ["Ship", "Ship name"],
  ["Offer", "The sailing's main offer, when it's short enough for a headline (else blank)"],
];
export function customiserRow(s){
  const offer = (s.promos || []).map(offerName).find(o => o.length <= LIMITS.rsa.headlines[0]) || "";
  return {FromPrice: money(s.price), Nights: String(s.nights), DepartureDate: day(s.departure_date),
          DepartsFrom: s.fly || s.port, Ship: s.ship, Offer: offer};
}

const TEMPLATES = [
  ["Headline", "Cruise from {CUSTOMIZER.FromPrice}pp"],
  ["Headline", "Sailings from {CUSTOMIZER.FromPrice}pp"],
  ["Headline", "{CUSTOMIZER.Nights} nights from {CUSTOMIZER.FromPrice}pp"],
  ["Headline", "Departs {CUSTOMIZER.DepartureDate}"],
  ["Headline", "Departing {CUSTOMIZER.DepartsFrom}"],
  ["Headline", "{CUSTOMIZER.Nights} nights on {CUSTOMIZER.Ship}"],
  ["Headline", "{CUSTOMIZER.Offer}"],
  ["Description", "{CUSTOMIZER.Nights} nights on {CUSTOMIZER.Ship} from {CUSTOMIZER.FromPrice}pp, departing {CUSTOMIZER.DepartureDate}. Based on two sharing."],
  ["Description", "Departing {CUSTOMIZER.DepartsFrom} on {CUSTOMIZER.DepartureDate}. {CUSTOMIZER.Nights} nights from {CUSTOMIZER.FromPrice}pp, based on two sharing."],
];
const fill = (t, row) => t.replace(/\{CUSTOMIZER\.(\w+)\}/g, (_, k) => row[k] || "");
export function customiserLines(rows){
  if (!rows.length) return [];
  return TEMPLATES.map(([kind, text]) => {
    const max = kind === "Headline" ? LIMITS.rsa.headlines[0] : LIMITS.rsa.descriptions[0];
    const used = [...text.matchAll(/\{CUSTOMIZER\.(\w+)\}/g)].map(m => m[1]);
    if (rows.some(r => used.some(k => !r[k]))) return null;   // a value missing for an ad group: the ad couldn't show there
    const longest = Math.max(...rows.map(r => fill(text, r).length));
    return longest <= max ? {kind, text, longest, max, example: fill(text, rows[0])} : null;
  }).filter(Boolean);
}
