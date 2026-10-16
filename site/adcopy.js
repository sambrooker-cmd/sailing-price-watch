// Suggested primary text for the Ad creator (Sam, 12 Oct 2026), built from the chosen sailings'
// own facts, with no AI, in Ambassador's tone of voice (Design system "Ambassador Cruise Line",
// Content fundamentals, from Brand Guidelines v4.3, and its messaging matrix of 14 Oct 2026):
//   * Welcoming: "we"/"us", contractions, a question that sparks curiosity; respectful, never pushy.
//   * Trustworthy: factual and clear; nothing exaggerated or made up. Every figure here comes from
//     the tracker (prices, dates, ports, ships, promotions, Nectar points, live was/now claims).
//   * Wondrous: evocative words for places and moments, present continuous (-ing) for energy.
//   * Vocabulary: "Ambassador Cruise Line" in full first, then "Ambassador" (singular); "guests",
//     "sailings"/"cruises", "ships"; "Ambience" / "Ambition", never "The Ambience"; no ampersands
//     in body copy (sailing names are rewritten with "and").
//   * Messaging matrix: creative headlines open "Welcome to…", picked by theme (no-fly cruises and regional
//     ports: "Welcome to hassle-free holidaying"; fly cruises: "Welcome to fly-cruising without the fuss"; a mix:
//     "Welcome to holidaying your way"), and every theme carries "affordable quality", "no-fly" and/or "the
//     warmest welcome at sea - because moments matter" (BRAND_LINE).
// Was/now wording appears only for a card using a live claim, with the claim's own figures.
//
// suggest(items, format) -> [{label, text}]
// items: [{title, ship, port, fly, nights, departure_date, price, promos: [...], nectarPts, wasnow: {was, now, grade} | null}]

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const money = v => "£" + Math.round(v).toLocaleString("en-GB");
const noAmp = t => String(t || "").replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
const month = iso => { const [y, m] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const day = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const list = xs => xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const uniq = xs => [...new Set(xs.filter(Boolean))];
const GRADE = {inside: "inside cabins", ocean_view: "ocean view cabins", balcony: "balcony cabins", suite: "suites"};
const SMALL_PRINT = "Based on two sharing and subject to availability.";
const BRAND_LINE = "the warmest welcome at sea - because moments matter";
// The messaging matrix's headline for the sailings' theme
const welcome = f => f.noFly ? "Welcome to hassle-free holidaying." : f.fly ? "Welcome to fly-cruising without the fuss." : "Welcome to holidaying your way.";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = n => WORDS[n] || String(n);

// "Up to £200 Onboard Credit · code ABC · ends 31 Oct" -> "up to £200 onboard credit with code ABC (offer ends 31 Oct)"
function promoPhrase(line){
  const [name, ...bits] = noAmp(line).split(" · ");
  const code = bits.find(b => b.startsWith("code ")), ends = bits.find(b => b.startsWith("ends "));
  // Sentence case after "Enjoy": "Free Bottle Of Bubbles" -> "free bottle of bubbles"; keeps UK, £200, 10%, Nectar.
  const n = name.split(" ").map(w => /^[A-Z0-9£%]{2,}$/.test(w) || /^Nectar/.test(w) ? w : w.toLowerCase()).join(" ");
  return `${n}${code ? ` with ${code}` : ""}${ends ? ` (offer ${ends})` : ""}`;
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

function facts(items){
  const noFly = items.every(i => !i.fly), fly = items.every(i => i.fly);
  const ports = uniq(items.filter(i => !i.fly).map(i => i.port)), airports = uniq(items.filter(i => i.fly).map(i => i.fly));
  const ships = uniq(items.map(i => noAmp(i.ship)));
  const dates = items.map(i => i.departure_date).filter(Boolean).sort();
  const prices = items.map(i => i.wasnow ? i.wasnow.now : i.price);
  const min = Math.min(...prices), nights = items.map(i => i.nights).filter(Boolean);
  const promoSets = items.map(i => i.promos || []);
  const shared = (promoSets[0] || []).find(p => promoSets.every(s => s.includes(p)));
  const nectar = Math.max(0, ...items.map(i => i.nectarPts || 0));
  const from = noFly ? (ports.length > 3 ? `${ports.length} UK ports` : list(ports))
    : fly ? `with flights from ${airports.length > 3 ? `${airports.length} UK airports` : list(airports)}`
    : `from UK ports, or with flights from ${list(airports.slice(0, 2))}`;
  return {noFly, fly, ports, airports, ships, from,
    shipPhrase: ships.length === 1 ? ships[0] : ships.length === 2 ? `${ships[0]} and ${ships[1]}` : "our fleet",
    first: dates[0], last: dates[dates.length - 1], min, nights: [Math.min(...nights), Math.max(...nights)], shared, nectar,
    wasnow: items.filter(i => i.wasnow)};
}

const when = f => f.first && f.last && month(f.first) !== month(f.last) ? `between ${month(f.first)} and ${month(f.last)}` : f.first ? `in ${month(f.first)}` : "";
const nightsRange = f => f.nights[0] === f.nights[1] ? `${f.nights[0]} nights` : `${f.nights[0]} to ${f.nights[1]} nights`;
const fromPhrase = f => f.noFly ? `from ${f.from}` : f.from;
const wasNowLines = f => f.wasnow.slice(0, 2).map(i =>
  `${noAmp(i.title)}${i.wasnow.grade ? ` (${GRADE[i.wasnow.grade]})` : ""} is now ${money(i.wasnow.now)} per person, was ${money(i.wasnow.was)}.`).join(" ");

// "They all sail from London Tilbury." / "There are departures from Hull, Liverpool and Tilbury, so there's one close to home."
const close = f => {
  const places = f.noFly ? f.ports : f.fly ? f.airports : [...f.ports, ...f.airports];
  if (places.length === 1) return f.fly ? `They all fly from ${places[0]}.` : `They all sail from ${places[0]}.`;
  return `There are ${f.fly ? "flights" : "departures"} from ${f.noFly || f.fly ? f.from.replace(/^with flights from /, "") : list(places)}, so there's one close to home.`;
};

function carousel(items){
  const f = facts(items), n = items.length, N = num(n), out = [];
  const kind = f.noFly ? "no-fly cruises" : f.fly ? "fly-cruises" : "cruises";
  const ports = f.noFly ? `with departures from ${f.from}` : f.from;
  out.push({label: "Welcoming", text:
    `Where will you sail next? We've picked ${N} ${kind} for you, from ${money(f.min)} per person, setting sail ${when(f)}. ` +
    `${close(f)} Swipe through and find the one that's calling you. ${SMALL_PRINT}`});
  out.push({label: "Welcome to…", text: f.noFly
    ? `${welcome(f)} Forget the fuss of flying: ${N} affordable quality sailings on ${f.shipPhrase} are setting sail ${when(f)} ${ports}, from ${money(f.min)} per person. Enjoy ${BRAND_LINE}. ${SMALL_PRINT}`
    : `${welcome(f)} ${cap(N)} affordable quality sailings on ${f.shipPhrase}, setting sail ${when(f)}, ${ports}, from ${money(f.min)} per person. Enjoy ${BRAND_LINE}. ${SMALL_PRINT}`});
  out.push({label: "Wondrous", text: f.noFly
    ? `Picture yourself waking up to a new horizon, with the warmest welcome at sea waiting on board. ${cap(N)} sailings on ${f.shipPhrase} are setting sail ${when(f)} ${ports}: no airports, no queues, just your holiday beginning the moment you step aboard. From ${money(f.min)} per person. ${SMALL_PRINT}`
    : `Picture yourself waking up to a new horizon, with the warmest welcome at sea waiting on board. ${cap(N)} sailings on ${f.shipPhrase} are setting sail ${when(f)}, ${ports}. From ${money(f.min)} per person. ${SMALL_PRINT}`});
  out.push({label: "Value", text:
    `${cap(kind)} from ${money(f.min)} per person, with Ambassador Cruise Line. Choose from ${N} sailings of ${nightsRange(f)}, departing ${when(f)}, ${ports}. Affordable quality and ${BRAND_LINE}. ${SMALL_PRINT}`});
  if (f.shared) out.push({label: "Offer", text:
    `Enjoy ${promoPhrase(f.shared)} on all ${N} of these sailings. Choose your favourite, ${ports}, from ${money(f.min)} per person. ${SMALL_PRINT}`});
  if (f.nectar) out.push({label: "Nectar", text:
    `Collect up to ${f.nectar.toLocaleString("en-GB")} Nectar points when you book one of these ${N} sailings with Ambassador Cruise Line. Setting sail ${when(f)}, ${ports}, from ${money(f.min)} per person. ${SMALL_PRINT}`});
  if (f.wasnow.length) out.push({label: "Price reduction", text:
    `${wasNowLines(f)} Swipe to see all ${N} sailings, ${ports}. ${SMALL_PRINT}`});
  return out;
}

function single(items){
  const i = items[0], f = facts(items), t = noAmp(i.title), out = [];
  const where = i.fly ? `with flights from ${i.fly}` : `from ${i.port}`, price = i.wasnow ? i.wasnow.now : i.price;
  out.push({label: "Welcoming", text:
    `Fancy joining us on ${t}? We're setting sail ${where} on ${day(i.departure_date)} on board ${noAmp(i.ship)}, for ${i.nights} nights, with prices from ${money(price)} per person. ${SMALL_PRINT}`});
  out.push({label: "Welcome to…", text: i.fly
    ? `${welcome(f)} Join us on ${t}, an affordable quality fly-cruise on board ${noAmp(i.ship)} with flights from ${i.fly} on ${day(i.departure_date)}, from ${money(price)} per person. Enjoy ${BRAND_LINE}. ${SMALL_PRINT}`
    : `${welcome(f)} Forget the fuss of flying and join us on ${t}, setting sail from ${i.port} on ${day(i.departure_date)} on board ${noAmp(i.ship)}, from ${money(price)} per person. Enjoy ${BRAND_LINE}. ${SMALL_PRINT}`});
  out.push({label: "Wondrous", text: i.fly
    ? `Picture yourself discovering new horizons on ${t}: ${i.nights} nights on board ${noAmp(i.ship)}, with flights from ${i.fly} on ${day(i.departure_date)}. From ${money(price)} per person. ${SMALL_PRINT}`
    : `Picture yourself discovering new horizons on ${t}: ${i.nights} nights on board ${noAmp(i.ship)}, setting sail from ${i.port} on ${day(i.departure_date)}. No airports, no queues, just the warmest welcome at sea. From ${money(price)} per person. ${SMALL_PRINT}`});
  out.push({label: "Value", text:
    `${t}: ${i.nights} nights from ${money(price)} per person, sailing ${where} on ${day(i.departure_date)} with Ambassador Cruise Line. Affordable quality and ${BRAND_LINE}. ${SMALL_PRINT}`});
  if ((i.promos || [])[0]) out.push({label: "Offer", text:
    `Enjoy ${promoPhrase(i.promos[0])} on ${t}, sailing ${where} on ${day(i.departure_date)}. From ${money(price)} per person. ${SMALL_PRINT}`});
  if (i.nectarPts) out.push({label: "Nectar", text:
    `Collect up to ${i.nectarPts.toLocaleString("en-GB")} Nectar points when you book ${t} with Ambassador Cruise Line, sailing ${where} on ${day(i.departure_date)}. From ${money(price)} per person. ${SMALL_PRINT}`});
  if (i.wasnow) out.push({label: "Price reduction", text: `${wasNowLines(f)} Sailing ${where} on ${day(i.departure_date)}. ${SMALL_PRINT}`});
  return out;
}

export function suggest(items, format){
  if (!items.length) return [];
  return (format === "single" ? single(items.slice(0, 1)) : carousel(items))
    .map(o => ({...o, text: o.text.replace(/\s+/g, " ").replace(/ \./g, ".").trim()}));
}
