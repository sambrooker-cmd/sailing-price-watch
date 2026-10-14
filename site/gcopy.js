// Google Ads copy (Sam, 14 Oct 2026, part 2 of the Google Ads page): Search (responsive search ads), Performance Max,
// Demand Gen, sitelinks and callouts, built from the chosen sailings' own facts with no AI, in Ambassador's tone of
// voice (as adcopy.js: "Ambassador Cruise Line", guests, sailings, "and" not "&", factual, nothing invented). Every line
// is checked against Google's character limits; anything longer is left out. A was/now price only appears when the
// sailing has a live claim (passed in as wasnow), with the claim's own figures.
//
// copySet(items, {link}) → {rsa: {headlines, descriptions, path1, path2}, pmax: {headlines, longHeadlines, descriptions},
//                           dg: {headlines, descriptions}, sitelinks: [{text, d1, d2, url}], callouts: []}
// items: [{id, title, ship, port, fly, nights, departure_date, price, promos: [...], nectarPts, link, wasnow: {was, now, grade} | null}]

export const LIMITS = {
  rsa: {headlines: [30, 15], descriptions: [90, 4], path: 15},
  pmax: {headlines: [30, 15], longHeadlines: [90, 5], descriptions: [90, 5], shortDescription: 60},
  dg: {headlines: [40, 5], descriptions: [90, 5]},
  sitelink: {text: 25, desc: 35}, callout: 25, business: 25,
};
export const BUSINESS = "Ambassador Cruise Line";
const SITE = "https://www.ambassadorcruiseline.com/";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const noAmp = t => String(t || "").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
const day = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const month = iso => { const [y, m] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
// "Jan to Mar 2027" / "Dec 2026 to Feb 2027" / "March 2027"
const span = (a, b) => { if (!a) return ""; const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number);
  return y1 === y2 && m1 === m2 ? month(a) : y1 === y2 ? `${MON[m1 - 1]} to ${MON[m2 - 1]} ${y2}` : `${MON[m1 - 1]} ${y1} to ${MON[m2 - 1]} ${y2}`; };
const uniq = xs => [...new Set(xs.filter(Boolean).map(x => x.replace(/\s+/g, " ").trim()))];
const fit = (xs, n) => uniq(xs).filter(x => x.length <= n);
const list = xs => xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
// "Up to £400 Onboard Credit · ends 23 Nov" → "Up to £400 onboard credit" (sentence case, keeps £, %, UK, Nectar)
const offerName = line => { const n = noAmp(line).split(" · ")[0]; return n.split(" ").map((w, i) => i === 0 || /^[A-Z0-9£%]{2,}$/.test(w) || /^Nectar/.test(w) ? w : w.toLowerCase()).join(" "); };
const priceOf = i => i.wasnow ? i.wasnow.now : i.price;
// A short name for headlines: the whole name if it fits, else its main part ("Norway's Land of the Northern Lights" → "Northern Lights")
function shortName(t, n){
  t = noAmp(t); if (t.length <= n) return t;
  for (const sep of [" – ", " - ", ": "]) if (t.includes(sep)) { const [a, b] = t.split(sep); if (b.length <= n) return b; if (a.length <= n) return a; }
  for (const kw of [" of the ", " to the ", " of ", " to ", " in ", " and "]) { const i = t.lastIndexOf(kw); if (i > 0 && t.length - i - kw.length <= n) return t.slice(i + kw.length); }
  return "";
}
// The place word for the display path: "Norway's Land of …" → "Norway"
function placeWord(t){
  const stop = /^(a|an|the|and|of|to|in|on|with|winter|summer|spring|autumn|christmas|new|year|festive|weekend|escape|grand|great|sailing|voyage|cruise|break|getaway|discovery|explorer|one|more|dream|gems|land|sunsets|secrets|delights|rhythms|horizons|blue|island)$/i;
  const w = noAmp(t).replace(/['’]s\b/g, "").split(/[\s–:,-]+/).find(x => x.length >= 4 && !stop.test(x));
  return w ? w.slice(0, 15) : "";
}
const pathOf = (s, n = 15) => s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, n);

function facts(items){
  const noFly = items.every(i => !i.fly), fly = items.every(i => i.fly);
  const ports = uniq(items.filter(i => !i.fly).map(i => i.port)), airports = uniq(items.filter(i => i.fly).map(i => i.fly));
  const ships = uniq(items.map(i => i.ship)), dates = items.map(i => i.departure_date).filter(Boolean).sort();
  const promoSets = items.map(i => i.promos || []), shared = (promoSets[0] || []).find(p => promoSets.every(s => s.includes(p)));
  return {noFly, fly, ports, airports, ships, first: dates[0], last: dates[dates.length - 1], min: Math.min(...items.map(priceOf)),
          nights: [Math.min(...items.map(i => i.nights)), Math.max(...items.map(i => i.nights))], shared,
          nectar: Math.max(0, ...items.map(i => i.nectarPts || 0)), wasnow: items.filter(i => i.wasnow)};
}

function single(i){
  const t = noAmp(i.title), p = priceOf(i), where = i.fly ? `with flights from ${i.fly}` : `from ${i.port}`;
  const wn = i.wasnow, offer = (i.promos || [])[0], name30 = shortName(t, 30), name40 = shortName(t, 40);
  const priceLine = wn ? `Now ${money(wn.now)}pp, was ${money(wn.was)}` : `From ${money(p)}pp`;
  const kind = i.fly ? "fly-cruise" : "no-fly cruise";
  const headlines = [name30, priceLine, `${i.nights}-night ${kind}`, i.fly ? `Flights from ${i.fly}` : `Sailing from ${i.port}`,
    `Departs ${day(i.departure_date)}`, `On board ${noAmp(i.ship)}`, BUSINESS, offer && offerName(offer),
    i.nectarPts && `Up to ${i.nectarPts.toLocaleString("en-GB")} Nectar points`, !i.fly && "No airports, no queues",
    "The warmest welcome at sea", `${month(i.departure_date)} departure`, `${i.nights} nights from ${money(p)}pp`, "Book your sailing today",
    !i.fly && "No-fly cruises from the UK", "Affordable quality cruising"];
  const descriptions = [
    `${t}: ${i.nights} nights on board ${noAmp(i.ship)}, ${where} on ${day(i.departure_date)}. ${priceLine}.`,
    `${t}: ${i.nights} nights, ${where}. ${priceLine}.`,
    `${i.nights} nights on board ${noAmp(i.ship)}, ${where} on ${day(i.departure_date)}. ${priceLine}.`,
    `A ${i.nights}-night ${kind} ${where}, departing ${day(i.departure_date)}. ${priceLine}.`,
    !i.fly && `No airports, no queues: your holiday starts the moment you step aboard at ${i.port}.`,
    i.fly && `Fly from ${i.fly} and join ${noAmp(i.ship)} for ${i.nights} nights of discovery.`,
    offer && `Enjoy ${offerName(offer).toLowerCase().replace(/^up/, "up")} on this sailing. ${priceLine}, based on two sharing.`,
    i.nectarPts && `Collect up to ${i.nectarPts.toLocaleString("en-GB")} Nectar points when you book. ${priceLine}.`,
    wn && `Price reduced: now ${money(wn.now)}pp, was ${money(wn.was)}. Based on two sharing, subject to availability.`,
    `Affordable quality and the warmest welcome at sea with ${BUSINESS}.`,
    `Prices per person, based on two sharing and subject to availability. Book your sailing today.`];
  const longHeadlines = [
    `${t}: ${i.nights} nights ${where}, ${priceLine.charAt(0).toLowerCase() + priceLine.slice(1)}`,
    `${i.nights}-night ${kind} on board ${noAmp(i.ship)}, departing ${day(i.departure_date)}`,
    !i.fly && `No airports, no queues: sail from ${i.port} with ${BUSINESS}`,
    offer && `${offerName(offer)} on ${t}`,
    `Discover ${t} with the warmest welcome at sea`];
  return {
    rsa: {headlines: fit(headlines, 30).slice(0, 15), descriptions: fit(descriptions, 90).slice(0, 4),
          path1: i.fly ? "Fly-Cruises" : "No-Fly-Cruises", path2: pathOf(placeWord(t) || month(i.departure_date))},
    pmax: {headlines: fit(headlines, 30).slice(0, 15), longHeadlines: fit(longHeadlines, 90).slice(0, 5),
           descriptions: [...fit([`${i.nights} nights ${where}. ${priceLine}.`, `${priceLine}. ${i.nights} nights on board ${noAmp(i.ship)}.`], 60).slice(0, 1), ...fit(descriptions, 90)].slice(0, 5)},
    dg: {headlines: fit([name40, `${i.nights}-night ${kind}, ${priceLine.toLowerCase()}`, `${t}`, `${i.nights}-night ${kind} on ${noAmp(i.ship)}`,
                         priceLine, i.fly ? `Flights from ${i.fly}` : `No-fly from ${i.port}`, i.fly ? `Fly from ${i.fly}, ${priceLine.toLowerCase()}` : `Sail from ${i.port}, ${priceLine.toLowerCase()}`, "Where will you sail next?", "The warmest welcome at sea"], 40).slice(0, 5),
         descriptions: fit(descriptions, 90).slice(0, 5)},
    sitelinks: [{text: shortName(t, 25) || "This sailing", d1: `${i.nights} nights, ${priceLine.toLowerCase()}`, d2: `Departs ${day(i.departure_date)}`, url: i.link},
                {text: "Cruise offers", d1: "Our latest offers and deals", d2: "Subject to availability", url: SITE + "deals/cruise-offers/"}],
    callouts: fit([i.fly ? `Flights from ${i.fly}` : `No-fly from ${i.port}`, `${i.nights}-night sailing`, `On board ${noAmp(i.ship)}`,
                   offer && offerName(offer), i.nectarPts && "Collect Nectar points", "Prices per person"], 25),
  };
}

function group(items){
  const f = facts(items), n = items.length;
  const kind = f.noFly ? "no-fly cruises" : f.fly ? "fly-cruises" : "cruises", Kind = kind.charAt(0).toUpperCase() + kind.slice(1);
  const from = f.noFly ? (f.ports.length <= 2 ? `from ${list(f.ports)}` : `from ${f.ports.length} UK ports`) : f.fly ? (f.airports.length <= 2 ? `with flights from ${list(f.airports)}` : `with flights from ${f.airports.length} UK airports`) : "from the UK";
  const when = span(f.first, f.last);
  const nights = f.nights[0] === f.nights[1] ? `${f.nights[0]} nights` : `${f.nights[0]} to ${f.nights[1]} nights`;
  const ships = f.ships.length <= 2 ? list(f.ships.map(noAmp)) : "our fleet";
  const offer = f.shared && offerName(f.shared);
  const headlines = [`${Kind} from ${money(f.min)}pp`, `${n} sailings to choose from`, BUSINESS, `Sailing ${from}`.replace("Sailing with", "With"),
    when && `Departing ${when}`, `${nights} at sea`, f.ships.length <= 2 && `On board ${ships}`, offer, f.nectar && `Up to ${f.nectar.toLocaleString("en-GB")} Nectar points`,
    f.noFly && "No airports, no queues", "The warmest welcome at sea", "Where will you sail next?", "Book your sailing today", "Affordable quality cruising",
    f.noFly && "No-fly cruises from the UK", ...items.map(i => shortName(i.title, 30))];
  const descriptions = [
    `Choose from ${n} ${kind} ${from}, departing ${when}. From ${money(f.min)}pp.`,
    `${n} ${kind} ${from}, departing ${when}. From ${money(f.min)}pp.`,
    `${n} sailings of ${nights}, departing ${when}. From ${money(f.min)}pp, based on two sharing.`,
    `${nights} on board ${ships}, ${from}. From ${money(f.min)}pp, based on two sharing.`,
    f.noFly && "No airports, no queues: your holiday starts the moment you step aboard.",
    offer && `Enjoy ${offer.toLowerCase()} on all ${n} of these sailings. From ${money(f.min)}pp.`,
    f.nectar && `Collect up to ${f.nectar.toLocaleString("en-GB")} Nectar points when you book. From ${money(f.min)}pp.`,
    `Affordable quality and the warmest welcome at sea with ${BUSINESS}.`,
    `Prices per person, based on two sharing and subject to availability. Book your sailing today.`];
  const longHeadlines = [`${Kind} ${from}, departing ${when}, from ${money(f.min)}pp`, `Choose from ${n} sailings of ${nights} with ${BUSINESS}`,
    f.noFly && `No airports, no queues: ${kind} ${from}`, offer && `${offer} on ${n} sailings ${from}`, "Where will you sail next? The warmest welcome at sea awaits"];
  return {
    rsa: {headlines: fit(headlines, 30).slice(0, 15), descriptions: fit(descriptions, 90).slice(0, 4),
          path1: f.fly ? "Fly-Cruises" : f.noFly ? "No-Fly-Cruises" : "Cruises", path2: f.first ? pathOf(`${MON[+f.first.slice(5, 7) - 1]}-${f.first.slice(0, 4)}`) : ""},
    pmax: {headlines: fit(headlines, 30).slice(0, 15), longHeadlines: fit(longHeadlines, 90).slice(0, 5),
           descriptions: [...fit([`${Kind} ${from}, from ${money(f.min)}pp.`, `${n} sailings, ${nights}, from ${money(f.min)}pp.`], 60).slice(0, 1), ...fit(descriptions, 90)].slice(0, 5)},
    dg: {headlines: fit([`${Kind} from ${money(f.min)}pp`, `${n} ${kind} ${from}`, `${Kind}, departing ${when}`, "Where will you sail next?", "The warmest welcome at sea", offer], 40).slice(0, 5),
         descriptions: fit(descriptions, 90).slice(0, 5)},
    sitelinks: [...items.slice(0, 6).map(i => ({text: shortName(i.title, 25) || i.id, d1: `${i.nights} nights, from ${money(priceOf(i))}pp`, d2: `Departs ${day(i.departure_date)}`, url: i.link})).filter(s => s.text),
                {text: "Cruise offers", d1: "Our latest offers and deals", d2: "Subject to availability", url: SITE + "deals/cruise-offers/"}],
    callouts: fit([f.noFly ? "No-fly cruises" : f.fly ? "Fly-cruises" : "", f.noFly && f.ports.length === 1 && `Sailing from ${f.ports[0]}`, `${nights}`, offer, f.nectar && "Collect Nectar points", "Prices per person", `${n} sailings to choose from`], 25),
  };
}

export function copySet(items){
  if (!items.length) return null;
  return items.length === 1 ? single(items[0]) : group(items);
}

// Prices quoted in a line that aren't the current ones (a saved, edited set whose prices have since moved)
export function stalePrices(text, items){
  const ok = new Set(items.flatMap(i => [i.price, i.wasnow && i.wasnow.was, i.wasnow && i.wasnow.now]).filter(Boolean).map(v => String(Math.round(v))));
  (items[0] && items[0].promos || []).concat(...items.map(i => i.promos || [])).forEach(p => (p.match(/\d[\d,]*/g) || []).forEach(n => ok.add(n.replace(/,/g, ""))));
  items.forEach(i => i.nectarPts && ok.add(String(i.nectarPts)));
  return [...String(text).matchAll(/£\s?(\d[\d,]*)/g)].map(m => m[1].replace(/,/g, "")).filter(n => !ok.has(n));
}
