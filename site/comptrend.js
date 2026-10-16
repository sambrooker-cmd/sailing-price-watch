// Competitor price trends (Sam, 16 Oct 2026: "we can do better at displaying trends over time… as well as vs
// ambassador"; picked all eight: price trend by line, price moves per week, a sailing's price history, by departure
// month; gap over time, where we're losing, like-for-like by destination, solo). Pure helpers for competitors.js:
// destination regions, prices on a given day, a chain-linked price index, price moves, and an SVG line chart in the
// style of the tracker's own sailing chart.

// ---------- Destinations ----------
// Where a sailing goes, from its words: their title (Planet Cruise, Fred. Olsen), our title plus our page photos'
// file names ("st-john-s-antigua", "brugges_festive_3"). Most matches wins; a tie goes to the earlier region.
const W = s => new RegExp(`\\b(${s})\\b`, "g");
export const REGIONS = [
  ["caribbean", "Caribbean", W("caribbean|antilles|antigua|barbados|bridgetown|st lucia|saint lucia|castries|guadeloupe|pointe a pitre|martinique|fort de france|curacao|willemstad|williamstad|aruba|oranjestad|bonaire|kralendijk|dominica|roseau|tortola|road town|virgin islands|st maarten|sint maarten|saint martin|philipsburg|st kitts|basseterre|grenada|st vincent|kingstown|jamaica|montego|ocho rios|bahamas|nassau|cozumel|la romana|dominican|puerto rico|san juan|tobago|trinidad|belize|costa maya|cayman|bermuda")],
  ["iceland", "Iceland and the Arctic", W("iceland|icelandic|reykjavik|akureyri|isafjordur|seydisfjordur|svalbard|spitsbergen|longyearbyen|greenland|nuuk|faroe|faroes|torshavn|jan mayen|arctic")],
  ["norway", "Norway", W("norway|norwegian|fjords?|fjordlands?|bergen|alesund|geiranger|flam|olden|stavanger|tromso|lofoten|leknes|honningsvag|north cape|northern lights|haugesund|molde|trondheim|kristiansand|eidfjord|skjolden|hellesylt|andalsnes|maloy|narvik|alta|hammerfest|oslo")],
  ["baltic", "Baltic and Scandinavia", W("baltic|copenhagen|stockholm|tallinn|helsinki|riga|gdansk|gdynia|klaipeda|warnemunde|rostock|kiel|visby|sweden|swedish|denmark|danish|finland|estonia|latvia|lithuania|poland|st petersburg|skagen|aarhus|gothenburg|goteborg|nordic|scandinavia|scandinavian")],
  ["british", "British Isles", W("british isles|britain|scotland|scottish|ireland|irish|celtic|dublin|belfast|cork|cobh|waterford|galway|killybegs|kirkwall|orkney|shetland|lerwick|stornoway|hebrides|invergordon|inverness|greenock|glasgow|edinburgh|leith|rosyth|holyhead|isle of man|guernsey|st peter port|jersey|scilly|tresco|channel islands|wales|welsh|fishguard|portree|skye|tobermory|oban|ullapool")],
  ["iberia", "Spain, Portugal and Atlantic islands", W("western europe|southern cruise|spain|spanish|portugal|portuguese|iberia|iberian|lisbon|porto|leixoes|oporto|vigo|coruna|ferrol|santander|bilbao|gijon|cadiz|seville|sevilla|morocco|moroccan|casablanca|tangier|agadir|canary|canaries|tenerife|santa cruz|lanzarote|arrecife|gran canaria|las palmas|la palma|fuerteventura|la gomera|madeira|funchal|azores|ponta delgada|horta|cape verde|atlantic islands|bordeaux|le verdon|la rochelle|brest|lorient|biscay")],
  ["med", "Mediterranean", W("mediterranean|gibraltar|malaga|barcelona|palma|mallorca|majorca|ibiza|menorca|valencia|cartagena|almeria|alicante|motril|italy|italian|rome|civitavecchia|naples|sicily|messina|palermo|malta|valletta|greece|greek|athens|piraeus|crete|santorini|mykonos|corfu|croatia|dubrovnik|split|venice|monaco|monte carlo|nice|villefranche|marseille|corsica|ajaccio|sardinia|cagliari|cyprus|turkey|istanbul|kusadasi|adriatic|aegean|riviera|genoa|livorno|florence|la spezia|toulon|cannes")],
  ["near", "Holland, Belgium, Germany and France", W("amsterdam|ijmuiden|rotterdam|zeebrugge|bruges|brugge|brugges|antwerp|ghent|hamburg|bremerhaven|honfleur|le havre|normandy|cherbourg|rouen|christmas markets?|holland|belgium|belgian|dutch|netherlands|germany|german|paris|dunkirk|calais|short break|mini cruise|weekend")],
  ["long", "Long-haul and world", W("transatlantic|new york|world cruise|around the world|south america|amazon|panama|canada|quebec|boston|halifax|nova scotia|africa|cape town|asia|australia|antarctica|hawaii|alaska|rio|buenos aires|brazil|crossing")],
];
export const REGION_LABEL = Object.fromEntries(REGIONS.map(([k, l]) => [k, l]));
const plain = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-.,'’]+/g, " ").replace(/\d+x\d+/g, " ");
export function regionOf(...texts){
  const t = plain(texts.join(" "));
  let best = "", n = 0;
  for (const [k, , rx] of REGIONS) { const m = (t.match(rx) || []).length; if (m > n) { best = k; n = m; } }
  return best;
}
// Our page photos' file names, as words ("…/st-john-s-antigua_2000x1333.png" → "st john s antigua")
export const photoWords = urls => (urls || []).map(u => String(u).split("/").pop().replace(/\.(jpe?g|png|webp)$/i, "")).join(" ");

// ---------- Prices over time ----------
export const iso = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(Date.parse(s + "T12:00:00Z") + n * 864e5));
export function dayList(from, to){ const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
export const mondayOf = d => { const t = new Date(d + "T12:00:00Z"); return addDays(d, -((t.getUTCDay() + 6) % 7)); };
// The price in force on day d (segments [{p, from}], newest last), or null before the first / when not on sale
export function priceOn(segs, d){
  let p = null;
  for (const s of segs || []) { if (s.from > d) break; p = s.p == null ? null : s.p; }
  return p;
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export { median };

// A chain-linked index (first day = 100): each day moves by the average change of the sailings priced on both that day
// and the day before, so sailings joining or leaving (new ones found, departed ones) don't move it: only real price
// changes do. items: [{segs, dep}] (dep = departure date: a sailing stops counting once it has sailed)
export function chainIndex(items, days){
  const out = [];
  let idx = 100;
  days.forEach((d, i) => {
    if (i) {
      const prev = days[i - 1], logs = [];
      for (const x of items) {
        if (x.dep && x.dep <= d) continue;
        const a = priceOn(x.segs, prev), b = priceOn(x.segs, d);
        if (a && b) logs.push(Math.log(b / a));
      }
      if (logs.length) idx *= Math.exp(logs.reduce((s, v) => s + v, 0) / logs.length);
    }
    out.push([d, idx]);
  });
  return out;
}
// Price changes after the first reading of each sailing (the first reading isn't a change): [{d, old, new, pct, x}]
export function movesOf(items){
  const out = [];
  for (const x of items) {
    const segs = x.segs || [];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1].p, b = segs[i].p;
      if (a && b && a !== b) out.push({d: segs[i].from, old: a, new: b, pct: (b / a - 1) * 100, x});
    }
  }
  return out;
}

// ---------- A line chart (SVG), in the tracker's chart style ----------
// series: [{name, color, pts: [[day, value]], dash, bold}]; opts: {fmt, zero (draw the 0 line), step (segments), end}
let chartN = 0;
export function lineChart(series, opts = {}){
  const fmt = opts.fmt || (v => String(Math.round(v))), esc = opts.esc || (s => s);
  series = series.filter(s => s.pts.length);
  if (!series.length) return {html: `<div class="empty"><p>${opts.empty || "Not enough history yet."}</p></div>`, wire: () => {}};
  const days = [...new Set(series.flatMap(s => s.pts.map(p => p[0])))].sort();
  const start = days[0], end0 = opts.end || days[days.length - 1], end = end0 > start ? end0 : addDays(start, 1);   // one day: still a visible line
  const span = Math.max(1, (Date.parse(end) - Date.parse(start)) / 864e5);
  const vs = series.flatMap(s => s.pts.map(p => p[1])).concat(opts.zero ? [0] : []);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const Wd = Math.max(320, Math.min(880, (typeof window !== "undefined" ? window.innerWidth : 1000) - 80)), narrow = Wd < 600;
  const H = narrow ? 220 : 260, L = narrow ? 52 : 64, R = narrow ? 96 : 130, T = 12, B = 30;
  const x = d => L + (Date.parse(d) - Date.parse(start)) / 864e5 / span * (Wd - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const svg = [];
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) / 4 * i, yy = y(v);
    svg.push(`<line x1="${L}" x2="${Wd - R}" y1="${yy}" y2="${yy}" stroke="var(--rule)" stroke-width="1"/>`);
    svg.push(`<text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="12" fill="var(--muted)">${esc(fmt(v))}</text>`);
  }
  if (opts.zero) svg.push(`<line x1="${L}" x2="${Wd - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1.5"/>`);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const lab = d => `${+d.slice(8)} ${MON[+d.slice(5, 7) - 1]}`;
  const ticks = span <= 1 ? [start] : span < 4 ? [start, end] : [start, addDays(start, Math.round(span / 2)), end];
  ticks.forEach((d, i) => svg.push(`<text x="${x(d)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}" font-size="12" fill="var(--muted)">${lab(d)}</text>`));
  const ends = [];
  for (const s of series) {
    let path = "";
    s.pts.forEach(([d, v], i) => {
      if (opts.step) { const stop = i < s.pts.length - 1 ? s.pts[i + 1][0] : end; path += (i ? `V${y(v)}` : `M${x(d)},${y(v)}`) + `H${x(stop)}`; }
      else path += `${i ? "L" : "M"}${x(d)},${y(v)}`;
    });
    if (!opts.step && s.pts.length === 1) svg.push(`<circle cx="${x(s.pts[0][0])}" cy="${y(s.pts[0][1])}" r="3.5" fill="${s.color}"/>`);
    svg.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.bold ? 3 : 2}" ${s.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`);
    ends.push({y: y(s.pts[s.pts.length - 1][1]), s});
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  ends.forEach(e => svg.push(`<line x1="${Wd - R + 8}" x2="${Wd - R + 20}" y1="${e.y}" y2="${e.y}" stroke="${e.s.color}" stroke-width="2" ${e.s.dash ? 'stroke-dasharray="4 3"' : ""}/>`,
    `<text x="${Wd - R + 24}" y="${e.y + 4}" font-size="12" fill="var(--muted)">${esc(e.s.name.length > 16 ? e.s.name.slice(0, 15) + "…" : e.s.name)}</text>`));
  const id = "cc" + (++chartN);
  svg.push(`<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`);
  svg.push(`<rect class="hit" x="${L}" y="${T}" width="${Wd - L - R}" height="${H - T - B}" fill="transparent"/>`);
  const legend = series.map(s => `<span><i class="key${s.dash ? " dash" : ""}" style="border-color:${s.color}"></i>${esc(s.name)}</span>`).join("");
  const html = `<div class="legend">${legend}</div><div class="chartbox" id="${id}"><svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(opts.label || "Chart")}">${svg.join("")}</svg><div class="ctip" hidden></div></div>`;
  // Hover: the values on the nearest day
  const wire = root => {
    const box = root.querySelector("#" + id); if (!box) return;
    const el = box.querySelector("svg"), tip = box.querySelector(".ctip"), xh = el.querySelector(".xh");
    const at = (s, d) => { let v = null; for (const [pd, pv] of s.pts) { if (pd > d) break; v = pv; } return opts.step ? v : (s.pts.find(p => p[0] === d) || [, null])[1]; };
    el.addEventListener("mousemove", e => {
      const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * Wd;
      if (px < L || px > Wd - R) { tip.hidden = true; xh.setAttribute("visibility", "hidden"); return; }
      const d = days.reduce((a, b) => Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a, days[0]);
      xh.setAttribute("x1", x(d)); xh.setAttribute("x2", x(d)); xh.setAttribute("visibility", "visible");
      const rows = series.map(s => [s, at(s, d)]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
      tip.innerHTML = `<div class="d">${lab(d)}</div>` + rows.map(([s, v]) => `<div class="r"><span><i class="key${s.dash ? " dash" : ""}" style="border-color:${s.color}"></i>${esc(s.name)}</span><b>${esc(fmt(v))}</b></div>`).join("");
      tip.hidden = false;
      const left = x(d) / Wd * r.width;
      tip.style.left = (left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12) + "px"; tip.style.top = "8px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
  };
  return {html, wire};
}
export const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];
