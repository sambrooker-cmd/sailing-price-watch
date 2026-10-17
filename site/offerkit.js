// Competitor offers, gathered and cleaned (Sam, 16 Oct 2026: "the competitor offers tab needs improvement"; picked a
// comparison grid, what's new / ended, cleaned-up offer lines and an offer timeline). One list of offers from every
// source, each with the brand, its type(s), its headline value, where it was seen, how many sailings carry it, when it
// was first seen and when it ended:
//   email   offers Claude (or the rules) found in their newsletters (offers_inbox.py)
//   deals   Fred. Olsen's own /cruise-deals pages (competitors.py brand_offers)
//   agent   Planet Cruise's offer lines on the sailings we read (competitors.py, per sailing [[from, to]])
//   ours    Ambassador's own promotions (our state: offers + each sailing's promos)
// Pure functions: competitors.js draws the page from collect().

export const TYPES = [
  ["obc", "Onboard credit", /on ?board (credit|spend|spending|money)|\bobc\b|spending money|bar (credit|tab)/i],
  ["discount", "Discounts", /\d+\s?%\s*(off|saving|discount|reduction)|save (up to )?[£$€]?\d|up to \d+\s?% |[£$€]\d[\d,]*\s*off\b|\b(reduced|lower|cheaper)\b[^.]{0,25}\b(fares?|prices?|supplement)|price (drop|cut)|\bsavings?\b|\bsale\b|discount|reduction/i],
  ["deposit", "Low deposit", /deposit/i],
  ["extras", "Free extras", /free (drinks?|bubbles|bottle|gratuit|tips|wi-?fi|internet|upgrade|dining|package|excursion)|drinks? package|all[- ]inclusive|inclusive|signature package|\bpackages?\b|upgrade/i],
  ["loyalty", "Past guests", /past (passenger|guest)|loyalty|voyager club|returning guest|previous(ly)? (sailed|guest)/i],
  ["people", "Solo, children, family", /\bsolo\b|single (supplement|cabin|traveller)|\bsingles?\b|child|\bkids?\b|famil/i],
  ["travel", "Transfers and flights", /coach|transfer|door[- ]to[- ]door|flight|upper class|\bparking\b|\brail\b/i],
  ["urgency", "Flash, late and launch deals", /flash|last[- ]minute|late (deal|saver|cruise)|limited time|must end|today only|pre[- ]?register|launch/i],
];
export const TYPE_LABEL = Object.fromEntries(TYPES.map(([k, l]) => [k, l]));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s + "T12:00:00Z") + n * 864e5));

// "*Free Onboard Spend*" → "Free Onboard Spend"
export const clean = t => String(t || "").replace(/\s+/g, " ").replace(/^[\s*!•·-]+|[\s*]+$/g, "").trim();
export const keyOf = t => clean(t).toLowerCase().replace(/[^a-z0-9£$€%]+/g, " ").trim();
// Lines that aren't offers although they mention one (a fare's description, the agent's booking button)
const NOT_OFFER = /select price fare to enjoy|book this deal online/i;
// A saving on flights or flight seats ("30% off Upper Class seats", "flight deals… save £250") is a travel offer, not a
// fare discount
const FLIGHT_SAVING = /flight|upper class|\bseats?\b/i;
export function typesOf(t){
  if (NOT_OFFER.test(t)) return [];
  const ks = TYPES.filter(([, , rx]) => rx.test(t)).map(([k]) => k);
  return FLIGHT_SAVING.test(t) && ks.includes("travel") ? ks.filter(k => k !== "discount") : ks;
}

// The headline figure for a type: the biggest credit or saving, the smallest deposit
export function valueOf(t, type){
  const money = [...String(t).matchAll(/([£$€])\s?(\d[\d,]*)/g)].map(m => ({c: m[1], v: +m[2].replace(/,/g, "")}));
  const pct = [...String(t).matchAll(/(\d{1,2})\s?%/g)].map(m => +m[1]);
  if (type === "deposit") { const m = money.sort((a, b) => a.v - b.v)[0]; return m ? {text: `${m.c}${m.v.toLocaleString("en-GB")}`, n: m.v} : null; }
  if (type === "obc") { const m = money.sort((a, b) => b.v - a.v)[0]; return m ? {text: `${/up to/i.test(t) ? "up to " : ""}${m.c}${m.v.toLocaleString("en-GB")}`, n: m.v} : null; }
  if (type === "discount") {
    if (pct.length) { const v = Math.max(...pct); return {text: `${/up to/i.test(t) ? "up to " : ""}${v}%`, n: v}; }
    // a £ saving ("save up to £750", "£250 off"), not a deposit ("£1pp deposit") or a price ("from £149pp")
    const saves = [...String(t).matchAll(/(?:save|saving|savings)\s+(?:of\s+)?(?:up to\s+)?([£$€])\s?(\d[\d,]*)|([£$€])\s?(\d[\d,]*)(?:pp)?\s+(?:off|saving|cabin savings)/gi)]
      .map(m => ({c: m[1] || m[3], v: +(m[2] || m[4]).replace(/,/g, "")})).sort((a, b) => b.v - a.v);
    return saves[0] ? {text: `${/up to/i.test(t) ? "up to " : ""}${saves[0].c}${saves[0].v.toLocaleString("en-GB")} off`, n: saves[0].v} : null;
  }
  return null;
}

// An end date written in the offer itself ("Must end Mon 12th Oct", "Book by 23:59 on 20th October 2026", "ends 30
// November"): a year is assumed when missing (the nearest one around today)
export function endsIn(t, today){
  const m = String(t).match(/(?:must end|ends?|until|book by|valid (?:to|until)|expires?|offer closes)\b[^.]{0,30}?\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2].toLowerCase()), y0 = +today.slice(0, 4);
  let y = m[3] ? +m[3] : y0, d = `${y}-${String(mon + 1).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  if (!m[3] && d > addDays(today, 200)) d = `${y - 1}${d.slice(4)}`;
  if (!m[3] && d < addDays(today, -165)) d = `${y + 1}${d.slice(4)}`;
  return d;
}
// A page quoting a "price correct at time of send 05/02/26" (dd/mm/yy) more than 60 days ago: probably an old offer
export function staleSince(t, today){
  const dates = [...String(t).matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)].map(m => `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  const old = dates.filter(d => d < addDays(today, -60)).sort().pop();
  return old || null;
}

// Every offer from every source, merged by brand and wording
export function collect({C, I, S, today, onSale}){
  const out = new Map();
  const add = (brand, src, text, o) => {
    text = clean(text);
    if (!text) return;
    const types = typesOf(text + " " + (o.desc || ""));
    if (!types.length && src !== "ours") return;   // not an offer: a fare description, a ship or destination line, "Book this deal online"
    const k = brand + "|" + keyOf(text);
    const x = out.get(k) || {brand, text, desc: o.desc || "", types, sources: new Set(), first: o.first, last: null, live: false, n: 0, of: o.of || 0, links: [], ends: null, emails: []};
    x.sources.add(src);
    if (o.first && (!x.first || o.first < x.first)) x.first = o.first;
    if (o.live) x.live = true;
    if (o.end && (!x.last || o.end > x.last)) x.last = o.end;
    x.n += o.n || 0; x.of = Math.max(x.of, o.of || 0);
    if (o.link && !x.links.includes(o.link)) x.links.push(o.link);
    if (o.ends) x.ends = x.ends && x.ends > o.ends ? x.ends : o.ends;
    if (o.email) x.emails.push(o.email);
    if (o.stale) x.stale = o.stale;
    if (o.fresh) x.fresh = o.fresh;
    out.set(k, x);
  };
  // Planet Cruise: per line and wording, over every sailing (live ones count towards "on N of M sailings")
  const liveByLine = {};
  for (const r of Object.values((C && C.sailings) || {})) if (!r.gone && r.line !== "ambassador" && (r.departure_date || "") > today) liveByLine[r.line] = (liveByLine[r.line] || 0) + 1;
  const agent = {};
  for (const r of Object.values((C && C.sailings) || {})) {
    if (r.line === "ambassador") continue;   // our own sailings at the agent: our offers come from our website
    for (const [t, spans] of Object.entries(r.offers || {})) {
      if (!spans || !spans.length) continue;
      const k = r.line + "|" + keyOf(t), a = agent[k] || (agent[k] = {line: r.line, t, first: null, end: null, n: 0, live: false, url: r.url, fresh: null});
      for (const [f, to] of spans) {
        if (!a.first || f < a.first) a.first = f;
        if (to && (!a.end || to > a.end)) a.end = to;
        // Appeared on a sailing we were already reading: genuinely new (not just a sailing found that day)
        if (r.first_seen && f > r.first_seen && (!a.fresh || f < a.fresh)) a.fresh = f;
      }
      if (spans[spans.length - 1][1] == null && !r.gone && (r.departure_date || "") > today) { a.live = true; a.n++; }
    }
  }
  for (const a of Object.values(agent)) add(a.line, "agent", a.t, {first: a.first, fresh: a.fresh, live: a.live, end: a.live ? null : a.end, n: a.n, of: liveByLine[a.line] || 0, link: a.url, ends: endsIn(a.t, today)});
  // Fred. Olsen's deals pages: the page title is the offer, its first lines the detail
  for (const [line, offers] of Object.entries((C && C.brand_offers) || {}))
    for (const [t, e] of Object.entries(offers))
      add(line, "deals", t, {desc: e.text || "", first: e.first_seen, live: !e.ended, end: e.ended || null, link: e.url, ends: endsIn(e.text || "", today), stale: staleSince(e.text || "", today)});
  // Newsletters: each offer Claude (or the rules) found, from the day the email arrived; its own end date if given
  for (const e of Object.values((I && I.emails) || {})) {
    if (!e.promotion) continue;
    for (const o of e.offers || []) {
      const ends = o.ends || endsIn(o.offer, today), sent = (e.date || "").slice(0, 10);
      add(e.line, "email", o.offer, {first: sent, live: !ends || ends >= today, end: ends && ends < today ? ends : null, link: o.link || e.view || "", ends,
        email: {subject: e.subject, date: sent, view: e.view || "", by: e.by}});
    }
  }
  // Ours: each promotion on our website, with how many sailings on sale carry it now
  const live = {}, first = {}, end = {};
  for (const s of Object.values((S && S.sailings) || {})) for (const [id, spans] of Object.entries(s.promos || {})) {
    for (const [f, to] of spans) { if (!first[id] || f < first[id]) first[id] = f; if (to && (!end[id] || to > end[id])) end[id] = to; }
    if (!s.removed && spans.length && spans[spans.length - 1][1] == null) live[id] = (live[id] || 0) + 1;
  }
  for (const [id, o] of Object.entries((S && S.offers) || {}))
    add("ambassador", "ours", o.name || id, {desc: o.desc || "", first: first[id] || o.first_seen, live: !!live[id], end: live[id] ? null : end[id] || o.last_seen, n: live[id] || 0, of: onSale,
      ends: (o.expires || "").slice(0, 10) || endsIn(`${o.name || ""} ${o.desc || ""}`, today)});
  // Done: an offer whose own wording says it has ended counts as ended that day
  return [...out.values()].map(x => {
    const expired = x.live && x.ends && x.ends < today;
    return {...x, sources: [...x.sources], live: x.live && !expired, last: expired ? x.ends : x.last, expired,
      value: Object.fromEntries(x.types.map(t => [t, valueOf(x.text + " " + x.desc, t)]).filter(([, v]) => v))};
  });
}

// Our promotions with an end date (the website's own expiry) and, for each, which of its sailings still on sale after
// that date keep no other offer of the same kind ("bare": nothing live today replaces it there; a promotion added
// later can't be foreseen). Sailings departing before the end date don't need replacing.
export function ourEndings({S, today}){
  const offers = (S && S.offers) || {}, sail = (S && S.sailings) || {}, liveOn = {}, byId = {};
  for (const [code, s] of Object.entries(sail)) {
    if (s.removed || (s.departure_date || "") <= today) continue;
    for (const [id, sp] of Object.entries(s.promos || {})) if (sp.length && sp[sp.length - 1][1] == null) {
      (liveOn[code] || (liveOn[code] = [])).push(id); (byId[id] || (byId[id] = [])).push(code);
    }
  }
  // the website's expiry, else a date in the wording ("Book by 23:59 on 20th October 2026")
  const ends = id => { const o = offers[id] || {}; return (o.expires || "").slice(0, 10) || endsIn(`${o.name || ""} ${o.desc || ""}`, today); };
  const types = id => typesOf(`${(offers[id] || {}).name || ""} ${(offers[id] || {}).desc || ""}`);
  const out = [];
  for (const [id, codes] of Object.entries(byId)) {
    const e = ends(id);
    if (!e || e < today) continue;
    const ts = types(id), after = codes.filter(c => sail[c].departure_date > e);
    const bare = after.filter(c => !liveOn[c].some(j => j !== id && types(j).some(t => ts.includes(t)) && (!ends(j) || ends(j) > e)));
    out.push({id, name: clean((offers[id] || {}).name || id), desc: (offers[id] || {}).desc || "", ends: e, types: ts, codes, after, bare});
  }
  return out.sort((a, b) => a.ends.localeCompare(b.ends) || b.codes.length - a.codes.length);
}

// The kinds of offer on one of their sailings (the agent's lines on it, except those in `skip`: lines the agent also
// shows on our own sailings, such as its £1 deposit, are its deals, not the line's)
export function sailingTypes(r, skip){
  const out = {};
  for (const [t, sp] of Object.entries(r.offers || {})) {
    if (!sp || !sp.length || sp[sp.length - 1][1] != null || (skip && skip.has(keyOf(t)))) continue;
    for (const k of typesOf(clean(t))) (out[k] || (out[k] = [])).push(clean(t));
  }
  return out;
}

// When recording began for each brand in each source ("agent|msc"): offers already running then aren't "new" (Planet
// Cruise's lines were found over several days, one brand after another)
export function baselines(items){
  const b = {};
  for (const x of items) for (const s of x.sources) { const k = s + "|" + x.brand; if (x.first && (!b[k] || x.first < b[k])) b[k] = x.first; }
  return b;
}
