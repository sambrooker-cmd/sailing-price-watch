// Competitors pages (Sam, 15 Oct 2026: "Go ahead with Fred Olsen and Planet Cruise"; then "a separate section in the
// nav, and also show an offers and vs Ambassador section"). Three pages under Competitors in the menu:
//   prices  every sampled sailing (filters, price per night, 7-day change), what changed
//   offers  their offers (brand-wide and per sailing) beside Ambassador's own live promotions
//   vs      Ambassador against them: price per night by line and cabin type, head to head by line, matched
//           sailings, and Ambassador at Planet Cruise against our own website
// Read-only: what competitors.py recorded (pricewatch/comp-current, comp-runs) beside our own saved state.
// Fred. Olsen's prices are its own; the other lines' are Planet Cruise's (an agent: its own discounts and "was" figures).

import {collect, baselines, TYPES, TYPE_LABEL} from "./offerkit.js?v=__BUILD__";
import {regionOf, photoWords, REGIONS, REGION_LABEL, priceOn, dayList, addDays, mondayOf, chainIndex, movesOf, lineChart, COLORS} from "./comptrend.js?v=__BUILD__";

const CABINS = [["inside", "Inside"], ["outside", "Outside"], ["balcony", "Balcony"], ["suite", "Suite"]];
// Our cabin grades → the comparable types
const OURS = {inside: "inside", ocean_view: "outside", balcony: "balcony", suite: "suite"};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "spw-comp";
const LINES = {fredolsen: "Fred. Olsen", po: "P&O Cruises", princess: "Princess Cruises", cunard: "Cunard", marella: "Marella Cruises",
  msc: "MSC Cruises", royal: "Royal Caribbean", celebrity: "Celebrity Cruises", ambassador: "Ambassador (at Planet Cruise)"};
let C, R, I = null, our, ctx, esc, loading = null;
const st = {region: "", like: true, otype: "", line: "", cabin: "inside", occ: "twin", month: "", seg: "", sort: "date", vsSort: "gap"};
let showAll = false;
// No-fly from a UK port, or fly-Caribbean (competitors.py `segment`; older records: the fly flag)
const segOf = r => r.segment || (r.fly ? "fly-caribbean" : "no-fly");
const SEGS = {"no-fly": "No-fly from the UK", "fly-caribbean": "Fly-Caribbean"};

const gbp = v => v == null ? "–" : "£" + Math.round(v).toLocaleString("en-GB");
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const iso = d => d.toISOString().slice(0, 10);
const isoDaysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const last = segs => segs && segs.length ? segs[segs.length - 1] : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const liveOffers = r => Object.entries(r.offers || {}).filter(([, sp]) => sp.length && sp[sp.length - 1][1] == null).map(([o]) => o);
const lineName = k => (C && C.lines || LINES)[k] || k;
const cabinLabel = c => (CABINS.find(x => x[0] === c) || [, c])[1];
// "we're 12% cheaper" / "dearer" (ours against theirs, per night)
const diffWords = (ours, theirs) => { const d = Math.round((ours / theirs - 1) * 100); return d === 0 ? "same" : `we're ${Math.abs(d)}% ${d < 0 ? "cheaper" : "dearer"}`; };
const diffPct = (ours, theirs) => Math.round((ours / theirs - 1) * 100);
const pctCell = d => d == null ? "–" : `<span style="color:${d <= 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}%</span>`;

function priceOf(r, occ, cab){ const s = last((r.prices || {})[`${occ}.${cab}`]); return s && s.p != null ? s : null; }
function priceAt(r, occ, cab, iso){ let p = null; for (const s of (r.prices || {})[`${occ}.${cab}`] || []) if (s.from <= iso) p = s.p; return p; }
const live = () => { const t = new Date().toISOString().slice(0, 10); return Object.entries(C.sailings || {}).filter(([, r]) => !r.gone && (r.departure_date || "") > t); };

// Ambassador's own sailings (our saved state): cheapest per cabin type now (pr), each type's price history (sg: the
// comparable grade's segments), and where it goes (region: title plus page photo names, from the ad kit)
function ourSailings(state, cabins, kit){
  const today = new Date().toISOString().slice(0, 10), out = [], map = cabins.sailings || cabins || {};   // index.html passes the sailings map
  const ks = (kit && kit.sailings) || {};
  for (const [id, s] of Object.entries(state.sailings || {})){
    if (s.removed || !s.departure_date || s.departure_date <= today || !s.nights) continue;
    const pr = {twin: {}, solo: {}}, sg = {twin: {}, solo: {}};
    for (const [k, v] of Object.entries((map[id] || {}).cabins || {})){
      const [occ, g] = k.split("."), t = OURS[g], cur = last(v.seg);
      if (!t || !pr[occ]) continue;
      sg[occ][t] = v.seg;
      if (!cur || cur.p == null || cur.out) continue;
      if (pr[occ][t] == null || cur.p < pr[occ][t]) pr[occ][t] = cur.p;
    }
    out.push({id, title: s.title, ship: s.ship, port: s.flight_from ? s.flight_from + " (fly)" : s.port, date: s.departure_date, nights: s.nights,
              fly: !!s.flight_from, pr, sg, region: regionOf(s.title, photoWords((ks[id] || {}).photos))});
  }
  return out;
}
const regionR = r => r._region ?? (r._region = regionOf(r.title));
// Our sailings that compare with theirs: same month, within 3 nights' length, same no-fly / fly-Caribbean and, when
// "match destination too" is on (default), the same destination region
function candidates(r){
  const m = (r.departure_date || "").slice(0, 7), fly = segOf(r) === "fly-caribbean", g = regionR(r);
  return our.filter(o => o.date.slice(0, 7) === m && Math.abs(o.nights - (r.nights || 0)) <= 3 && o.fly === fly && (!st.like || (g && o.region === g)));
}
// Ambassador's cheapest per night among those, for a cabin type, now or (with d) on day d
function ourMatch(r, occ, cab, d){
  let best = null, bp = null, n = 0;
  for (const o of candidates(r)) {
    const p = d ? priceOn(o.sg[occ][cab], d) : o.pr[occ][cab];
    if (p == null) continue;
    n++;
    if (bp == null || p / o.nights < bp) { bp = p / o.nights; best = o; }
  }
  return best ? {pn: bp, n, best, p: bp * best.nights} : null;
}

// Shared controls (line, cabin, two sharing / solo, month, no-fly); `extra` adds page-specific ones
function controls(box, opts){
  const all = live().map(([, r]) => r);
  const months = [...new Set(all.map(r => (r.departure_date || "").slice(0, 7)).filter(Boolean))].sort();
  const linesHere = Object.keys(C.lines || LINES).filter(k => all.some(r => r.line === k) && (!opts.noAmbAgent || k !== "ambassador"));
  return `<div class="controls">
    <select data-k="line" aria-label="Cruise line"><option value="">All lines</option>${linesHere.map(k => `<option value="${esc(k)}"${st.line === k ? " selected" : ""}>${esc(lineName(k))}</option>`).join("")}</select>
    ${opts.cabin === false ? "" : `<select data-k="cabin" aria-label="Cabin type">${CABINS.map(([c, l]) => `<option value="${c}"${st.cabin === c ? " selected" : ""}>${l}</option>`).join("")}</select>
    <select data-k="occ" aria-label="Fare"><option value="twin"${st.occ === "twin" ? " selected" : ""}>Two sharing</option><option value="solo"${st.occ === "solo" ? " selected" : ""}>Solo (Fred. Olsen only)</option></select>`}
    ${opts.month === false ? "" : `<select data-k="month" aria-label="Departure month"><option value="">Any month</option>${months.map(m => `<option value="${m}"${st.month === m ? " selected" : ""}>${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join("")}</select>
    <select data-k="seg" aria-label="No-fly or fly-Caribbean"><option value="">No-fly and fly-Caribbean</option>${Object.entries(SEGS).map(([k, l]) => `<option value="${k}"${st.seg === k ? " selected" : ""}>${l}</option>`).join("")}</select>
    <select data-k="region" aria-label="Destination"><option value="">Any destination</option>${REGIONS.map(([k, l]) => `<option value="${k}"${st.region === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`}
    ${opts.extra || ""}
  </div>`;
}
function wire(box, rerender){
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} };
  box.querySelectorAll("[data-k]").forEach(i => i.addEventListener("change", e => {
    st[i.dataset.k] = i.type === "checkbox" ? e.target.checked : e.target.value; showAll = false; save(); rerender();
  }));
}
const pick = r => (!st.line || r.line === st.line) && (!st.month || (r.departure_date || "").slice(0, 7) === st.month) && (!st.seg || segOf(r) === st.seg) && (!st.region || regionR(r) === st.region);
// Ours, by the same filters (no line filter: they're ours)
const pickOurs = o => (!st.month || o.date.slice(0, 7) === st.month) && (!st.seg || (st.seg === "fly-caribbean") === o.fly) && (!st.region || o.region === st.region);
function csvDownload(name, head, body){
  const q = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(q).join(",")).join("\r\n")], {type: "text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}
const source = () => `<p class="note" style="margin:0 0 12px">Read once a day from <b>Fred. Olsen's own website</b> and the travel agent <b>Planet Cruise</b>
  (P&amp;O, Princess, Cunard, Marella, MSC, Royal Caribbean, Celebrity): every sailing Ambassador competes with, that is from a UK port
  (no-fly) or a Caribbean sailing sold from the UK with flights, read every day (plus a sample of Ambassador's own sailings there). Agent prices can include the agent's own discounts and "was" figures. Last read
  ${esc(C.updated_at ? C.updated_at.slice(0, 16).replace("T", " ") + " UTC" : "–")}. Saga isn't covered. Recorded only: nothing here changes a price, an ad or a claim.</p>`;

// ---------- Competitor prices ----------
// Sam, 16 Oct 2026 (trends): price trend by line (a chain-linked index, so it shows real price changes, not sailings
// coming and going), price moves per week with the biggest cuts, a grid by departure month coloured against ours, and
// each sailing's own price history (click "History") beside our closest sailing's.
const today0 = () => new Date().toISOString().slice(0, 10);
const keyOf = () => `${st.occ}.${st.cabin}`;
const trendDays = () => {
  const t = today0(), first = Object.values(C.sailings || {}).flatMap(r => Object.values(r.prices || {}).map(s => (s[0] || {}).from)).filter(Boolean).sort()[0] || t;
  const ds = dayList(first, t);
  return ds.length > 42 ? ds.filter((d, i) => i === ds.length - 1 || new Date(d + "T12:00:00Z").getUTCDay() === 0) : ds;   // weekly beyond 6 weeks
};
const pct1 = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const linesWith = items => Object.keys(C.lines || LINES).filter(k => k !== "ambassador" && items.filter(x => x.line === k).length >= 3);

function trendBlock(){
  const days = trendDays(), k = keyOf();
  const theirs = live().map(([, r]) => r).filter(r => pick(r) && (r.prices || {})[k]);
  const series = linesWith(theirs).map((ln, i) => ({name: lineName(ln), color: COLORS[i % COLORS.length], dash: i >= COLORS.length,
    pts: chainIndex(theirs.filter(r => r.line === ln).map(r => ({segs: r.prices[k], dep: r.departure_date})), days), ln}));
  const mine = our.filter(pickOurs).filter(o => o.sg[st.occ][st.cabin]);
  if (mine.length >= 3) series.unshift({name: "Ambassador", color: "var(--heading)", bold: true, ln: "ours",
    pts: chainIndex(mine.map(o => ({segs: o.sg[st.occ][st.cabin], dep: o.date})), days)});
  const ch = lineChart(series, {fmt: v => v.toFixed(1), esc, label: "Price index by line", empty: "Appears after a second day of prices."});
  // Typical price per night today and the change since the first day, per line
  const t = today0();
  const rows = series.map(s => {
    const xs = s.ln === "ours" ? mine.map(o => { const p = o.pr[st.occ][st.cabin]; return p ? p / o.nights : null; })
      : theirs.filter(r => r.line === s.ln).map(r => { const p = priceOf(r, st.occ, st.cabin); return p && r.nights ? p.p / r.nights : null; });
    const v = xs.filter(x => x != null), lastIdx = s.pts.length ? s.pts[s.pts.length - 1][1] : 100;
    return `<tr${s.ln === "ours" ? ' style="font-weight:600"' : ""}><td><i class="key" style="border-color:${s.color}"></i> ${esc(s.name)}</td><td class="num">${v.length}</td><td class="num">${gbp(median(v))}</td><td class="num">${pctCell(Math.round((lastIdx - 100) * 10) / 10)}</td></tr>`;
  }).join("");
  return {html: `<h3 style="margin:18px 0 6px;font-size:15px">Price trend by line</h3>
    <p class="note" style="margin:0 0 8px">${esc(cabinLabel(st.cabin))}, ${st.occ === "solo" ? "solo" : "two sharing"}. An index: the first day is 100 and each day moves by the average price change of the sailings priced on both days, so sailings being found or sailing away don't move it. ${days.length > 42 ? "Weekly." : "Daily."} Recording began ${day(days[0])}.</p>
    ${ch.html}
    <div class="tablewrap" style="margin-top:8px"><table class="ptable"><thead><tr><th>Line</th><th class="num">Sailings</th><th class="num">Typical per night now</th><th class="num">Change since ${day(days[0])}</th></tr></thead><tbody>${rows}</tbody></table></div>`, wire: ch.wire};
}

function movesBlock(){
  const k = keyOf(), t = today0(), wk = isoDaysAgo(7);
  const theirs = live().map(([, r]) => r).filter(r => pick(r) && (r.prices || {})[k]);
  const ms = movesOf(theirs.map(r => ({segs: r.prices[k], r, line: r.line})));
  const mine = our.filter(pickOurs).filter(o => o.sg[st.occ][st.cabin]);
  const om = movesOf(mine.map(o => ({segs: o.sg[st.occ][st.cabin], o, line: "ours"})));
  const all = [...om, ...ms];
  const weeks = [...new Set(all.map(m => mondayOf(m.d)))].sort().reverse().slice(0, 6);
  if (!weeks.length) return `<h3 style="margin:22px 0 6px;font-size:15px">Price moves per week</h3><div class="empty"><p>No price changes recorded yet for ${esc(cabinLabel(st.cabin).toLowerCase())} cabins.</p></div>`;
  const rowsFor = ["ours", ...linesWith(theirs)];
  const cell = (ln, w) => {
    const xs = all.filter(m => m.x.line === ln && mondayOf(m.d) === w);
    if (!xs.length) return `<td class="num sub">–</td>`;
    const down = xs.filter(m => m.pct < 0).length, up = xs.length - down, avg = xs.reduce((a, m) => a + m.pct, 0) / xs.length;
    return `<td class="num">${down ? `<span style="color:var(--ok, #1a7f26)">↓${down}</span>` : ""} ${up ? `<span style="color:var(--warn)">↑${up}</span>` : ""}<div class="sub">avg ${pct1(avg)}</div></td>`;
  };
  const cuts = ms.filter(m => m.d >= wk && m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 10);
  return `<h3 style="margin:22px 0 6px;font-size:15px">Price moves per week</h3>
    <p class="note" style="margin:0 0 8px">How many sailings' ${esc(cabinLabel(st.cabin).toLowerCase())} price went down (↓) or up (↑) each week, and the average change of those that moved. A run of cuts can mean a sale has started.</p>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th>${weeks.map(w => `<th class="num">w/c ${day(w).replace(/ \d{4}$/, "")}</th>`).join("")}</tr></thead><tbody>
      ${rowsFor.map(ln => `<tr${ln === "ours" ? ' style="font-weight:600"' : ""}><td>${ln === "ours" ? "Ambassador" : esc(lineName(ln))}</td>${weeks.map(w => cell(ln, w)).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${cuts.length ? `<h4 style="margin:14px 0 6px;font-size:13px">Biggest cuts in the last 7 days</h4><div class="tablewrap"><table class="ptable"><tbody>
      ${cuts.map(m => `<tr><td>${day(m.d)}</td><td style="white-space:normal"><a href="${esc(m.x.r.url)}" target="_blank" rel="noopener">${esc(m.x.r.title || "")}</a><div class="sub">${esc(lineName(m.x.r.line))} · ${day(m.x.r.departure_date)} · ${m.x.r.nights} nights</div></td>
        <td class="num">${gbp(m.old)} → ${gbp(m.new)}</td><td class="num">${pctCell(Math.round(m.pct))}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

function monthBlock(){
  const k = keyOf(), t = today0();
  const theirs = live().map(([, r]) => r).filter(r => pick(r) && priceOf(r, st.occ, st.cabin) && r.nights);
  const months = [...new Set(theirs.map(r => r.departure_date.slice(0, 7)))].sort().slice(0, 18);
  if (!months.length) return "";
  const mine = our.filter(o => (!st.seg || (st.seg === "fly-caribbean") === o.fly) && (!st.region || o.region === st.region) && o.pr[st.occ][st.cabin]);
  const oursIn = m => median(mine.filter(o => o.date.slice(0, 7) === m).map(o => o.pr[st.occ][st.cabin] / o.nights));
  const lines = linesWith(theirs);
  const cell = (ln, m) => {
    const v = median(theirs.filter(r => r.line === ln && r.departure_date.slice(0, 7) === m).map(r => priceOf(r, st.occ, st.cabin).p / r.nights));
    if (v == null) return `<td class="num sub">–</td>`;
    const o = oursIn(m), d = o != null ? diffPct(o, v) : null;
    const bg = d == null ? "" : d <= -5 ? "background:var(--good-bg)" : d >= 5 ? "background:var(--bad-bg)" : "";
    return `<td class="num" style="${bg}" title="${d == null ? "" : esc(diffWords(o, v))}">${gbp(v)}</td>`;
  };
  return `<h3 style="margin:22px 0 6px;font-size:15px">By departure month</h3>
    <p class="note" style="margin:0 0 8px">Typical ${esc(cabinLabel(st.cabin).toLowerCase())} price per night by departure month. Green: we're at least 5% cheaper than that line that month; red: at least 5% dearer.</p>
    <div class="tablewrap"><table class="ptable" style="min-width:${180 + months.length * 72}px"><thead><tr><th>Line</th>${months.map(m => `<th class="num">${MON[+m.slice(5) - 1]} ${m.slice(2, 4)}</th>`).join("")}</tr></thead><tbody>
      <tr style="font-weight:600"><td>Ambassador</td>${months.map(m => `<td class="num">${gbp(oursIn(m))}</td>`).join("")}</tr>
      ${lines.map(ln => `<tr><td>${esc(lineName(ln))}</td>${months.map(m => cell(ln, m)).join("")}</tr>`).join("")}
    </tbody></table></div>`;
}

// One sailing's price history by cabin type, beside our closest sailing's (dashed), its "was" figures and offers
function historyRow(id){
  const r = C.sailings[id], t = today0(), series = [], k0 = st.occ;
  CABINS.forEach(([c, l], i) => {
    const segs = (r.prices || {})[`${k0}.${c}`];
    if (segs && segs.some(s => s.p != null)) series.push({name: l, color: COLORS[i], pts: segs.filter(s => s.p != null).map(s => [s.from, s.p])});
  });
  const m = ourMatch(r, k0, st.cabin);
  if (m) CABINS.forEach(([c, l], i) => {
    const segs = m.best.sg[k0][c];
    if (segs && segs.some(s => s.p != null)) series.push({name: `Ours: ${l}`, color: COLORS[i], dash: true, pts: segs.filter(s => s.p != null && s.from >= (series[0] ? series[0].pts[0][0] : "")).map(s => [s.from, s.p])});
  });
  const ch = lineChart(series, {step: true, end: t, fmt: v => gbp(v), esc, label: "Price history"});
  const was = CABINS.map(([c, l]) => { const p = priceOf(r, k0, c); return p && p.was ? `${l}: was ${gbp(p.was)}, now ${gbp(p.p)}` : ""; }).filter(Boolean);
  const offers = Object.entries(r.offers || {}).map(([o, sp]) => `${esc(o)} <span class="sub">(${sp.map(([f, to]) => `${day(f)} – ${to ? day(to) : "now"}`).join(", ")})</span>`);
  return {html: `<tr class="hist"><td colspan="7" style="background:var(--bg-alt)">
    <p class="note" style="margin:0 0 6px">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${day(r.departure_date)} · ${r.nights} nights · ${st.occ === "solo" ? "solo" : "two sharing"} prices per person.
      ${m ? `Dashed: our closest, <a href="#${esc(m.best.id)}">${esc(m.best.title || m.best.id)}</a> (${day(m.best.date)}, ${m.best.nights} nights).` : "No similar Ambassador sailing to compare."}</p>
    ${ch.html}
    ${was.length ? `<p class="sub" style="margin:6px 0 0">Planet Cruise's "was" figures: ${esc(was.join(" · "))}</p>` : ""}
    ${offers.length ? `<p class="sub" style="margin:6px 0 0">Offers: ${offers.join(" · ")}</p>` : ""}</td></tr>`, wire: ch.wire};
}

function renderPrices(box){
  const wk = isoDaysAgo(7), all = live().map(([, r]) => r);
  const recent = ((R && R.runs) || []).filter(r => r.date >= wk).flatMap(r => r.changes.map(c => ({...c, date: r.date})));
  const moves = recent.filter(c => c.kind === "price_drop" || c.kind === "price_rise");
  const list = live().filter(([, r]) => pick(r)).map(([id, r]) => {
    const p = priceOf(r, st.occ, st.cabin), before = priceAt(r, st.occ, st.cabin, wk);
    return {id, r, p, pn: p && r.nights ? p.p / r.nights : null, chg: p && before != null && before !== p.p ? p.p - before : null};
  }).filter(x => x.p).sort((a, b) => st.sort === "pn" ? a.pn - b.pn : st.sort === "chg" ? (a.chg ?? 0) - (b.chg ?? 0) : (a.r.departure_date || "").localeCompare(b.r.departure_date || ""));
  const lines = new Set(all.map(r => r.line));
  const trend = trendBlock();
  box.innerHTML = source() + `
    <div class="stats" style="margin-bottom:18px">
      <div class="stat"><span class="k">Competing sailings</span><span class="v">${all.filter(r => r.line !== "ambassador").length}</span><span class="s">${all.filter(r => r.line !== "ambassador" && segOf(r) === "no-fly").length} no-fly · ${all.filter(r => r.line !== "ambassador" && segOf(r) === "fly-caribbean").length} fly-Caribbean · ${[...lines].filter(l => l !== "ambassador").length} lines</span></div>
      <div class="stat"><span class="k">Price moves, 7 days</span><span class="v">${moves.length}</span><span class="s">${moves.filter(c => c.kind === "price_drop").length} down · ${moves.filter(c => c.kind === "price_rise").length} up</span></div>
      <div class="stat"><span class="k">New offers, 7 days</span><span class="v">${recent.filter(c => c.kind === "offer_added").length}</span><span class="s">${recent.filter(c => c.kind === "offer_ended").length} ended</span></div>
    </div>
    ${controls(box, {extra: `<select data-k="sort" aria-label="Sort"><option value="date"${st.sort === "date" ? " selected" : ""}>By departure</option><option value="pn"${st.sort === "pn" ? " selected" : ""}>Cheapest per night</option><option value="chg"${st.sort === "chg" ? " selected" : ""}>Biggest drop this week</option></select>
      <button type="button" class="linkbtn" id="cp-csv">Download CSV</button>`})}
    ${trend.html}
    ${movesBlock()}
    ${monthBlock()}
    <h3 style="margin:22px 0 6px;font-size:15px">Every sailing</h3>
    ${list.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th><th>Departs</th><th class="num">Nights</th><th class="num">From pp</th><th class="num">Per night</th><th class="num">7 days</th><th>Offers</th></tr></thead><tbody>
      ${(showAll ? list : list.slice(0, 300)).map(({id, r, p, pn, chg}) => `<tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title || r.code || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${esc(r.port || "")}${r.flights ? ` · flights from ${esc(r.flights)}` : ""}${segOf(r) === "fly-caribbean" ? ' <span class="chip">fly-Caribbean</span>' : ""}${regionR(r) ? ` · ${esc(REGION_LABEL[regionR(r)])}` : ""}</div>
          <button type="button" class="linkbtn" data-hist="${esc(id)}" style="font-size:12px">Price history</button></td>
        <td>${day(r.departure_date)}</td><td class="num">${r.nights || "–"}</td>
        <td class="num">${gbp(p.p)}${p.was ? `<div class="sub"><s>${gbp(p.was)}</s></div>` : ""}${p.fare ? `<div class="sub">${esc(p.fare)}</div>` : ""}</td>
        <td class="num">${pn ? gbp(pn) : "–"}</td>
        <td class="num">${chg == null ? "–" : `<span style="color:${chg < 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${chg < 0 ? "−" : "+"}${gbp(Math.abs(chg))}</span>`}</td>
        <td>${liveOffers(r).slice(0, 3).map(o => `<span class="chip" title="${esc(o)}" style="white-space:normal">${esc(o.length > 70 ? o.slice(0, 68) + "…" : o)}</span>`).join(" ") || "–"}</td></tr>`).join("")}
    </tbody></table></div><p class="note">${list.length} sailing${list.length === 1 ? "" : "s"} with a ${st.occ === "solo" ? "solo " : ""}${cabinLabel(st.cabin).toLowerCase()} price${!showAll && list.length > 300 ? ` (showing the first 300: <button type="button" class="linkbtn" id="cp-all">Show all</button>)` : ""}. See <b>Vs Ambassador</b> for how ours compare.</p>`
      : `<div class="empty"><p>No sailings match these filters.</p></div>`}
    <h3 style="margin:22px 0 8px;font-size:15px">What changed (last 7 days)</h3>
    ${recent.some(c => c.kind !== "new") ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Line</th><th>Sailing</th><th>Change</th></tr></thead><tbody>
      ${recent.filter(c => c.kind !== "new" && (!st.line || c.line === st.line)).reverse().slice(0, 200).map(c => { const r = (C.sailings || {})[c.id] || {};
        return `<tr><td>${day(c.date)}</td><td>${esc(lineName(c.line))}</td><td>${c.id ? `<a href="${esc(r.url || "#")}" target="_blank" rel="noopener">${esc(r.title || c.title || c.id)}</a>` : "Brand-wide"}</td><td>${esc(words(c))}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty"><p>Changes appear after the second daily check.</p></div>`}`;
  trend.wire(box);
  wire(box, () => renderPrices(box));
  box.querySelectorAll("[data-hist]").forEach(b => b.addEventListener("click", () => {
    const tr = b.closest("tr"), open = tr.nextElementSibling && tr.nextElementSibling.classList.contains("hist");
    box.querySelectorAll("tr.hist").forEach(x => x.remove());
    if (open) return;
    const h = historyRow(b.dataset.hist);
    tr.insertAdjacentHTML("afterend", h.html); h.wire(tr.nextElementSibling);
  }));
  const more = box.querySelector("#cp-all");
  if (more) more.addEventListener("click", () => { showAll = true; renderPrices(box); });
  const csv = box.querySelector("#cp-csv");
  if (csv) csv.addEventListener("click", () => csvDownload(`competitor-prices-${st.occ}-${st.cabin}-${C.updated || ""}.csv`,
    ["Line", "Sailing", "Ship", "Departs from", "No-fly / fly-Caribbean", "Destination", "Departure date", "Nights", "Cabin", "Fare", "Price pp", "Was pp", "Per night", "Change 7 days", "Offers", "Link", "Read"],
    list.map(({r, p, pn, chg}) => [lineName(r.line), r.title, r.ship, r.port, SEGS[segOf(r)], REGION_LABEL[regionR(r)] || "", r.departure_date, r.nights, st.occ + " " + st.cabin, p.fare, p.p, p.was, pn && Math.round(pn), chg, liveOffers(r).join("; "), r.url, r.checked_at])));
}

function words(c){
  const cab = c.cabin ? c.cabin.replace("twin.", "").replace("solo.", "solo ") : "";
  if (c.kind === "price_drop" || c.kind === "price_rise") return `${cab} ${c.kind === "price_drop" ? "down" : "up"}: £${c.old} → £${c.new}`;
  if (c.kind === "cabin_off") return `${cab} no longer priced (was £${c.old})`;
  if (c.kind === "offer_added") return `New offer: ${c.offer}`;
  if (c.kind === "offer_ended") return `Offer ended: ${c.offer}`;
  if (c.kind === "gone") return "Left the sample (departed or no longer listed)";
  return c.kind;
}

// ---------- Competitor offers ----------
// Every brand Ambassador competes with, for the live-ads links and the newsletter inbox (Saga included: its ads and
// emails can be seen even though its website isn't read). Google's Ads Transparency Center by the brand's own domain;
// Meta's Ad Library by name (pick the brand's own page in its results).
const BRANDS = [["po", "P&O Cruises", "pocruises.com"], ["princess", "Princess Cruises", "princess.com"], ["cunard", "Cunard", "cunard.com"],
  ["marella", "Marella Cruises", "tui.co.uk"], ["saga", "Saga", "saga.co.uk"], ["fredolsen", "Fred. Olsen", "fredolsencruises.com"],
  ["msc", "MSC Cruises", "msccruises.co.uk"], ["royal", "Royal Caribbean", "royalcaribbean.com"], ["celebrity", "Celebrity Cruises", "celebritycruises.com"]];
const metaLib = name => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&media_type=all&search_type=keyword_unordered&q=${encodeURIComponent(name)}`;
const googleAds = domain => `https://adstransparency.google.com/?region=GB&domain=${encodeURIComponent(domain)}`;
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const brandName = k => (BRANDS.find(b => b[0] === k) || [, lineName(k)])[1];
let inboxDays = 30;

// Competitor offers (Sam, 16 Oct 2026: "needs improvement"; picked all four): who's offering what (a grid of brands
// against offer types, Ambassador first), what's new and ended this week, every live offer cleaned up (site/offerkit.js:
// merged, typed, valued, expired and out-of-date ones caught, our onboard credit tiers as one row), a timeline of when
// each ran, and the newsletters themselves.
const SRC = {email: "newsletter", deals: "deals page", agent: "Planet Cruise", ours: "our website"};
const brandRows = items => ["ambassador", ...BRANDS.map(b => b[0])].filter(k => items.some(x => x.brand === k));
const brandLabel = k => k === "ambassador" ? "Ambassador" : brandName(k);
const fmtValue = x => Object.values(x.value || {}).map(v => v.text).join(" · ");
// Our onboard credit tiers ("Up to £100 … £800 Onboard Credit", by cabin grade) as one row
function groupOurs(items){
  const tiers = items.filter(x => x.brand === "ambassador" && x.types.length === 1 && x.types[0] === "obc" && x.value.obc);
  if (tiers.length < 2) return items;
  const live = tiers.filter(x => x.live), vals = live.map(x => x.value.obc.n).sort((a, b) => a - b);
  const g = {...tiers[0], text: "Onboard credit, by cabin grade", desc: live.map(x => x.text).join(" · "), live: live.length > 0,
    n: live.reduce((a, x) => a + x.n, 0), first: tiers.map(x => x.first).sort()[0], last: live.length ? null : tiers.map(x => x.last).sort().pop(),
    ends: live.map(x => x.ends).filter(Boolean).sort()[0] || null,
    value: vals.length ? {obc: {text: `up to £${vals[0].toLocaleString("en-GB")} – £${vals[vals.length - 1].toLocaleString("en-GB")}`, n: vals[vals.length - 1]}} : {}};
  return [g, ...items.filter(x => !tiers.includes(x))];
}
const reach = x => x.of ? `on ${x.n} of ${x.of} sailing${x.of === 1 ? "" : "s"}` : x.sources.includes("deals") ? "brand-wide (deals page)" : x.sources.includes("email") ? "in their newsletter" : "";

function renderOffers(box){
  const today = new Date().toISOString().slice(0, 10), wk = isoDaysAgo(7), month = isoDaysAgo(30);
  const onSale = Object.values(ctx.state.sailings || {}).filter(s => !s.removed).length;
  const all = groupOurs(collect({C, I, S: ctx.state, today, onSale}));
  const base = baselines(all);
  const pickB = x => !st.line || x.brand === st.line || (st.line === "ambassador" && x.brand === "ambassador");
  const pickT = x => !st.otype || x.types.includes(st.otype);
  const live = all.filter(x => x.live && !x.stale);

  // 1. Who's offering what: brands × offer types (Ambassador first), the headline value and the widest reach
  const rows = brandRows(live);
  const cell = (b, t) => {
    const xs = live.filter(x => x.brand === b && x.types.includes(t));
    if (!xs.length) return `<td class="num sub">–</td>`;
    const vals = xs.map(x => x.value[t]).filter(Boolean).sort((p, q) => t === "deposit" ? p.n - q.n : q.n - p.n);
    const head = vals[0] ? vals[0].text : xs.length === 1 ? (xs[0].text.length > 28 ? xs[0].text.slice(0, 26) + "…" : xs[0].text) : `${xs.length} offers`;
    const top = xs.reduce((a, x) => x.of && x.n / x.of > (a.of ? a.n / a.of : -1) ? x : a, xs[0]);
    return `<td class="num"><button type="button" class="linkbtn" data-cell="${esc(b)}|${t}" title="${esc(xs.map(x => "• " + x.text).join("\n"))}" style="text-align:right">${esc(head)}</button>
      <div class="sub">${top.of ? `${Math.round(top.n / top.of * 100)}% of sailings` : esc(SRC[top.sources[0]] || "")}${xs.length > 1 ? ` · ${xs.length} offers` : ""}</div></td>`;
  };
  const grid = rows.length ? `<div class="tablewrap"><table class="ptable" style="min-width:980px"><thead><tr><th>Brand</th>${TYPES.map(([k, l]) => `<th class="num">${esc(l)}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(b => `<tr${b === "ambassador" ? ' style="font-weight:600;background:var(--bg-alt)"' : ""}><td>${esc(brandLabel(b))}</td>${TYPES.map(([t]) => cell(b, t)).join("")}</tr>`).join("")}
    </tbody></table></div><p class="note">The best figure each brand offers of that kind (the biggest credit or saving, the smallest deposit) and how widely: the share of its sailings we read that carry it. Click a figure to see those offers below. Planet Cruise's lines are the agent's, which can include its own deals.</p>`
    : `<div class="empty"><p>No live offers recorded yet.</p></div>`;

  // 2. New and ended in the last 7 days (offers already running when recording began aren't "new")
  // New: first seen after recording began for that brand; for Planet Cruise, only when it appeared on a sailing we were
  // already reading (sailings found that day bring offers that were already running)
  const isNew = x => x.live && x.first >= wk && (x.sources.includes("agent") ? x.fresh && x.fresh >= wk : x.sources.some(s => x.first > (base[s + "|" + x.brand] || "")));
  const newOn = x => x.sources.includes("agent") ? x.fresh : x.first;
  const fresh = all.filter(x => isNew(x) && pickB(x)).sort((a, b) => newOn(b).localeCompare(newOn(a)));
  const gone = all.filter(x => !x.live && x.last && x.last >= wk && pickB(x)).sort((a, b) => b.last.localeCompare(a.last));
  const line = (x, d, w) => `<tr><td>${day(d)}</td><td>${esc(brandLabel(x.brand))}</td><td style="white-space:normal"><b>${esc(x.text)}</b>${x.expired ? ` <span class="sub">(its own wording says it ended)</span>` : ""}<div class="sub">${esc(x.types.map(t => TYPE_LABEL[t]).join(" · "))} · ${esc(x.sources.map(s => SRC[s]).join(", "))}</div></td><td><span class="chip"${w === "ended" ? ' style="border-color:var(--muted)"' : ""}>${w}</span></td></tr>`;
  const week = fresh.length || gone.length ? `<div class="tablewrap"><table class="ptable"><tbody>${fresh.map(x => line(x, newOn(x), "new")).join("")}${gone.map(x => line(x, x.last, "ended")).join("")}</tbody></table></div>`
    : `<div class="empty"><p>Nothing started or ended in the last 7 days${st.line ? " for this brand" : ""}.</p></div>`;

  // 3. Every live offer, cleaned up (filters: brand, type); ended ones in the last 30 days folded underneath
  const listed = live.filter(x => pickB(x) && pickT(x)).sort((a, b) => (a.brand === "ambassador" ? -1 : b.brand === "ambassador" ? 1 : brandLabel(a.brand).localeCompare(brandLabel(b.brand))) || (b.of ? b.n / b.of : 0) - (a.of ? a.n / a.of : 0));
  const old = all.filter(x => pickB(x) && pickT(x) && (x.stale || (!x.live && x.last && x.last >= month)));
  const offerRow = x => `<tr><td>${esc(brandLabel(x.brand))}</td>
    <td style="white-space:normal"><b>${esc(x.text)}</b>${x.desc && x.desc !== x.text ? `<div class="sub">${esc(x.desc.length > 170 ? x.desc.slice(0, 168) + "…" : x.desc)}</div>` : ""}
      ${x.stale ? `<div class="sub" style="color:var(--warn)">This page quotes ${day(x.stale)}: probably an old offer still online</div>` : ""}
      <div style="margin-top:3px">${x.types.map(t => `<span class="chip" style="font-weight:500">${esc(TYPE_LABEL[t])}</span>`).join(" ")}</div></td>
    <td class="num">${esc(fmtValue(x)) || "–"}</td>
    <td>${esc(reach(x))}<div class="sub">${esc(x.sources.map(s => SRC[s]).join(", "))}</div></td>
    <td>${day(x.first)}${x.ends ? `<div class="sub">${x.ends < today ? "ended" : "ends"} ${day(x.ends)}</div>` : ""}${!x.live && x.last ? `<div class="sub">ended ${day(x.last)}</div>` : ""}</td>
    <td>${x.emails && x.emails[0] && safeUrl(x.emails[0].view) ? `<a href="${esc(x.emails[0].view)}" target="_blank" rel="noopener noreferrer">Email</a>` : ""}${safeUrl(x.links[0]) && x.brand !== "ambassador" ? ` <a href="${esc(x.links[0])}" target="_blank" rel="noopener noreferrer">${x.sources.includes("agent") ? "A sailing" : "Page"}</a>` : ""}</td></tr>`;
  const head = `<thead><tr><th>Brand</th><th>Offer</th><th class="num">Value</th><th>Where</th><th>Since</th><th></th></tr></thead>`;

  // 4. Timeline: when each offer ran, per brand (bars from first seen to ended, or today)
  const start = [isoDaysAgo(30), ...all.map(x => x.first).filter(Boolean)].sort()[0];
  const span = Math.max(1, (Date.parse(today) - Date.parse(start)) / 864e5);
  const pos = d => Math.max(0, Math.min(100, (Date.parse(d) - Date.parse(start)) / 864e5 / span * 100));
  const ticks = []; for (let d = new Date(start + "T12:00:00Z"); iso(d) <= today; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12))) if (iso(d) > start) ticks.push(iso(d));
  const tl = brandRows(all.filter(pickB)).map(b => {
    const xs = all.filter(x => x.brand === b && x.first && pickT(x)).sort((p, q) => p.first.localeCompare(q.first)).slice(0, 15);
    return xs.length ? `<details style="margin:6px 0"${st.line || b === "ambassador" ? " open" : ""}><summary style="font-size:13px;font-weight:600">${esc(brandLabel(b))} <span class="sub">· ${xs.length} offer${xs.length === 1 ? "" : "s"}</span></summary>${xs.map(x => {
      const l = pos(x.first), r = pos(x.live ? today : x.last || today);
      return `<div style="display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:10px;align-items:center;margin:2px 0;font-size:12px">
        <span title="${esc(x.text)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.text)}</span>
        <span style="position:relative;height:12px;background:var(--bg-alt)"><span title="${esc(`${day(x.first)} – ${x.live ? "now" : day(x.last)}`)}" style="position:absolute;top:2px;bottom:2px;left:${l}%;width:${Math.max(1, r - l)}%;background:${x.live ? "var(--c1)" : "var(--muted)"}"></span></span></div>`;
    }).join("")}</details>` : "";
  }).join("");
  const axis = `<div style="display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:10px;font-size:11px;color:var(--muted)"><span></span><span style="position:relative;height:14px">
    <span style="position:absolute;left:0">${day(start)}</span>${ticks.map(d => `<span style="position:absolute;left:${pos(d)}%;transform:translateX(-50%)">${MON[+d.slice(5, 7) - 1]}</span>`).join("")}<span style="position:absolute;right:0">today</span></span></div>`;

  // 5. The newsletters themselves (each email, its offers, its web version)
  const emails = ((I && I.emails) || []).filter(e => pickB({brand: e.line}) && e.date.slice(0, 10) >= isoDaysAgo(inboxDays));
  const mails = !I ? `<div class="empty"><p><b>The newsletter inbox isn't set up yet.</b> Once a team mailbox is signed up to the competitors' emails and its details are added to GitHub (CLAUDE.md, "Competitor newsletters"), their offers appear here.</p></div>`
    : `<div class="controls"><select id="ib-days" aria-label="Received"><option value="30"${inboxDays === 30 ? " selected" : ""}>Last 30 days</option><option value="90"${inboxDays === 90 ? " selected" : ""}>Last 90 days</option></select>
        <span class="sub">Mailbox last read ${esc(I.fetched_at ? I.fetched_at.slice(0, 16).replace("T", " ") + " UTC" : "–")} · every email, with pictures, is in <b>Competitor emails</b></span></div>
      ${emails.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sent</th><th>Brand</th><th>Email</th><th>Offers in it</th></tr></thead><tbody>
        ${emails.map(e => `<tr><td>${day(e.date.slice(0, 10))}</td><td>${esc(brandName(e.line))}</td>
          <td style="white-space:normal">${safeUrl(e.view) ? `<a href="${esc(e.view)}" target="_blank" rel="noopener noreferrer">${esc(e.subject)}</a>` : esc(e.subject)}${e.by === "rules" ? ` <span class="sub">(found by rules: check)</span>` : ""}</td>
          <td style="white-space:normal">${e.promotion && (e.offers || []).length ? (e.offers || []).map(o => esc(o.offer)).join("<br>") : `<span class="sub">${esc(e.kind || "no offer")}</span>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><p>No emails in this period${st.line ? " from this brand" : ""}.</p></div>`}`;

  box.innerHTML = `
    <div class="controls">
      <select id="of-line" aria-label="Brand"><option value="">All brands</option><option value="ambassador"${st.line === "ambassador" ? " selected" : ""}>Ambassador</option>${BRANDS.map(([k, n]) => `<option value="${k}"${st.line === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <select id="of-type" aria-label="Offer type"><option value="">Every kind of offer</option>${TYPES.map(([k, l]) => `<option value="${k}"${st.otype === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <button type="button" class="linkbtn" id="of-csv">Download CSV</button>
    </div>
    <p class="note" style="margin:0 0 6px">From their newsletters, Fred. Olsen's deals pages, the offer lines on every competing sailing at Planet Cruise, and our own website. Recording began ${day(Object.values(base).sort()[0])} (Planet Cruise's lines from 14–16 Oct). Their live ads are on <b>Competitor ads</b>.</p>
    <h3 style="margin:14px 0 8px;font-size:15px">Who's offering what</h3>${grid}
    <h3 style="margin:22px 0 8px;font-size:15px">New and ended in the last 7 days</h3>${week}
    <h3 id="of-list" style="margin:22px 0 8px;font-size:15px">Every live offer${st.otype ? `: ${esc(TYPE_LABEL[st.otype].toLowerCase())}` : ""}</h3>
    ${listed.length ? `<div class="tablewrap"><table class="ptable">${head}<tbody>${listed.map(offerRow).join("")}</tbody></table></div>` : `<div class="empty"><p>No live offers match.</p></div>`}
    ${old.length ? `<details style="margin-top:10px"><summary class="sub">${old.length} ended in the last 30 days, or probably out of date</summary><div class="tablewrap"><table class="ptable">${head}<tbody>${old.map(offerRow).join("")}</tbody></table></div></details>` : ""}
    <h3 style="margin:22px 0 8px;font-size:15px">When each offer ran</h3>
    ${tl ? axis + tl + `<p class="note">From the day each offer was first seen to the day it ended (coloured bars are still running; grey ones have ended). Offers already running when recording began start on that day.</p>` : `<div class="empty"><p>Nothing to show yet.</p></div>`}
    <h3 style="margin:22px 0 8px;font-size:15px">Their newsletters</h3>${mails}`;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(x){} };
  box.querySelector("#of-line").addEventListener("change", e => { st.line = e.target.value; save(); renderOffers(box); });
  box.querySelector("#of-type").addEventListener("change", e => { st.otype = e.target.value; save(); renderOffers(box); });
  box.querySelectorAll("[data-cell]").forEach(b => b.addEventListener("click", () => {
    [st.line, st.otype] = b.dataset.cell.split("|"); save(); renderOffers(box);
    box.querySelector("#of-list").scrollIntoView({behavior: "smooth", block: "start"});
  }));
  const dsel = box.querySelector("#ib-days");
  if (dsel) dsel.addEventListener("change", e => { inboxDays = +e.target.value; renderOffers(box); });
  box.querySelector("#of-csv").addEventListener("click", () => csvDownload(`competitor-offers-${today}.csv`,
    ["Brand", "Offer", "Detail", "Types", "Value", "Live", "Sailings with it", "Sailings read", "Seen in", "First seen", "Ended", "Ends (its own date)", "Out of date", "Link"],
    [...listed, ...old].map(x => [brandLabel(x.brand), x.text, x.desc, x.types.map(t => TYPE_LABEL[t]).join("; "), fmtValue(x), x.live ? "yes" : "no", x.of ? x.n : "", x.of || "",
      x.sources.map(s => SRC[s]).join("; "), x.first, x.live ? "" : x.last, x.ends, x.stale ? `quotes ${x.stale}` : "", x.links[0] || ""])));
}

// ---------- Vs Ambassador ----------
// Sam, 16 Oct 2026: where we're losing (at the top), the gap over time, like-for-like by destination ("match destination
// too", on by default), and solo prices against Fred. Olsen's.
function losingBlock(){
  const t = today0(), wk = isoDaysAgo(7), occ = st.occ;
  // 1. Groups of line × month × cabin × no-fly/fly where we're dearest (median gap, at least 2 sailings)
  const groups = {};
  for (const [, r] of live()) {
    if (r.line === "ambassador" || !pick(r) || !r.nights) continue;
    for (const [c] of CABINS) {
      const p = priceOf(r, occ, c); if (!p) continue;
      const m = ourMatch(r, occ, c); if (!m) continue;
      const k = [r.line, r.departure_date.slice(0, 7), c, segOf(r)].join("|");
      (groups[k] = groups[k] || []).push(diffPct(m.pn, p.p / r.nights));
    }
  }
  const dear = Object.entries(groups).filter(([, v]) => v.length >= 2).map(([k, v]) => ({k: k.split("|"), d: Math.round(median(v)), n: v.length}))
    .filter(x => x.d >= 10).sort((a, b) => b.d - a.d).slice(0, 8);
  // 2. Their cuts in the last 7 days that took them below our closest sailing
  const under = [];
  for (const [, r] of live()) {
    if (r.line === "ambassador" || !pick(r) || !r.nights) continue;
    for (const [c, l] of CABINS) {
      const segs = (r.prices || {})[`${occ}.${c}`] || [];
      for (let i = segs.length - 1; i >= 1 && segs[i].from >= wk; i--) {
        const a = segs[i - 1].p, b = segs[i].p;
        if (!a || !b || b >= a) continue;
        const m = ourMatch(r, occ, c, segs[i].from);
        if (m && a / r.nights >= m.pn && b / r.nights < m.pn) under.push({r, c: l, a, b, d: segs[i].from, m});
        break;
      }
    }
  }
  under.sort((x, y) => (x.b / x.r.nights - x.m.pn) - (y.b / y.r.nights - y.m.pn));
  return `<h3 style="margin:6px 0 8px;font-size:15px">Where we're losing</h3>
    ${dear.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th>Departures</th><th>Cabin</th><th class="num">Sailings</th><th class="num">Ours vs theirs</th></tr></thead><tbody>
      ${dear.map(x => `<tr><td>${esc(lineName(x.k[0]))}</td><td>${MON[+x.k[1].slice(5) - 1]} ${x.k[1].slice(0, 4)} · ${esc(SEGS[x.k[3]])}</td><td>${esc(cabinLabel(x.k[2]))}</td><td class="num">${x.n}</td><td class="num">${pctCell(x.d)}</td></tr>`).join("")}
    </tbody></table></div><p class="note">Where our closest sailings are typically 10% or more dearer per night (${occ === "solo" ? "solo" : "two sharing"}; at least 2 of their sailings).</p>`
      : `<div class="empty"><p>Nowhere is our price per night typically 10% or more above a line's for these filters.</p></div>`}
    <h4 style="margin:14px 0 6px;font-size:13px">Just cut below us (last 7 days)</h4>
    ${under.length ? `<div class="tablewrap"><table class="ptable"><tbody>${under.slice(0, 10).map(x => `<tr><td>${day(x.d)}</td>
        <td style="white-space:normal"><a href="${esc(x.r.url)}" target="_blank" rel="noopener"><b>${esc(x.r.title || "")}</b></a><div class="sub">${esc(lineName(x.r.line))} · ${esc(x.c)} · ${gbp(x.a)} → ${gbp(x.b)} (${gbp(x.b / x.r.nights)} a night)</div></td>
        <td style="white-space:normal">Our closest <a href="#${esc(x.m.best.id)}">${esc(x.m.best.title || x.m.best.id)}</a><div class="sub">${gbp(x.m.pn)} a night</div></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><p>No competitor price cut in the last 7 days took a sailing below our closest one.</p></div>`}`;
}

function gapBlock(){
  const days = trendDays(), occ = st.occ, cab = st.cabin, k = `${occ}.${cab}`;
  const theirs = live().map(([, r]) => r).filter(r => r.line !== "ambassador" && pick(r) && (r.prices || {})[k] && r.nights);
  const cand = new Map(theirs.map(r => [r, candidates(r).filter(o => o.sg[occ][cab])]));
  const series = linesWith(theirs).map((ln, i) => ({name: lineName(ln), color: COLORS[i % COLORS.length], dash: i >= COLORS.length,
    pts: days.map(d => {
      const gaps = [];
      for (const r of theirs) {
        if (r.line !== ln || r.departure_date <= d) continue;
        const p = priceOn(r.prices[k], d); if (!p) continue;
        let best = null;
        for (const o of cand.get(r)) { const q = priceOn(o.sg[occ][cab], d); if (q != null && (best == null || q / o.nights < best)) best = q / o.nights; }
        if (best != null) gaps.push((best / (p / r.nights) - 1) * 100);
      }
      return gaps.length ? [d, median(gaps)] : null;
    }).filter(Boolean)}));
  const ch = lineChart(series, {zero: true, fmt: v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`, esc, label: "Our price against each line's over time", empty: "Appears once there are matched sailings on more than one day."});
  return {html: `<h3 style="margin:22px 0 6px;font-size:15px">The gap over time</h3>
    <p class="note" style="margin:0 0 8px">Ours against theirs per night, day by day (${esc(cabinLabel(cab).toLowerCase())}, ${occ === "solo" ? "solo" : "two sharing"}): the typical difference between each of their sailings and our closest. Below the line we're cheaper, above it dearer. The first days can jump while their sailings were still being found (14–16 Oct 2026).</p>${ch.html}`, wire: ch.wire};
}

function soloBlock(){
  const fo = live().map(([, r]) => r).filter(r => r.line === "fredolsen" && r.nights && (!st.month || r.departure_date.slice(0, 7) === st.month) && (!st.region || regionR(r) === st.region));
  const months = [...new Set(fo.filter(r => CABINS.some(([c]) => priceOf(r, "solo", c))).map(r => r.departure_date.slice(0, 7)))].sort().slice(0, 18);
  if (!months.length) return "";
  const mine = our.filter(o => !o.fly && (!st.region || o.region === st.region));
  const cell = (m, c) => {
    const t = median(fo.filter(r => r.departure_date.slice(0, 7) === m).map(r => { const p = priceOf(r, "solo", c); return p ? p.p / r.nights : null; }).filter(v => v != null));
    const o = median(mine.filter(x => x.date.slice(0, 7) === m && x.pr.solo[c]).map(x => x.pr.solo[c] / x.nights));
    if (t == null && o == null) return `<td class="num sub">–</td>`;
    return `<td class="num">${gbp(o)} <span class="sub">vs</span> ${gbp(t)}${o != null && t != null ? `<div>${pctCell(diffPct(o, t))}</div>` : ""}</td>`;
  };
  return `<h3 style="margin:22px 0 6px;font-size:15px">Solo: us against Fred. Olsen</h3>
    <p class="note" style="margin:0 0 8px">Typical solo price per night by departure month: ours vs Fred. Olsen's (the only competitor whose solo prices are read). For sailing by sailing, choose "Solo" above.</p>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Departures</th>${CABINS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      ${months.map(m => `<tr><td>${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</td>${CABINS.map(([c]) => cell(m, c)).join("")}</tr>`).join("")}
    </tbody></table></div>`;
}

function renderVs(box){
  const all = live().map(([, r]) => r);
  const covered = new Set(all.map(r => (r.departure_date || "").slice(0, 7)));
  const occ = st.occ;
  // Typical price per night by line and cabin type, with Ambassador's own (same months) and each line against it
  const lines = Object.keys(C.lines || LINES).filter(k => all.some(r => r.line === k && pick(r)));
  const pnOf = (rs, c) => median(rs.map(r => { const p = priceOf(r, occ, c); return p && r.nights ? p.p / r.nights : null; }).filter(v => v != null));
  const mine = our.filter(o => covered.has(o.date.slice(0, 7)) && pickOurs(o));
  const ourPn = Object.fromEntries(CABINS.map(([c]) => [c, median(mine.map(o => o.pr[occ][c] != null ? o.pr[occ][c] / o.nights : null).filter(v => v != null))]));
  const typical = lines.map(k => { const rs = all.filter(r => r.line === k && pick(r)); return {k, n: rs.length, pn: Object.fromEntries(CABINS.map(([c]) => [c, pnOf(rs, c)]))}; }).filter(t => t.n);
  // Matched sailings: each of theirs against our closest, for the chosen cabin
  const theirs = all.filter(r => r.line !== "ambassador" && pick(r));
  const noRegion = st.like ? theirs.filter(r => !regionR(r)).length : 0;
  const matched = theirs.map(r => {
    const p = priceOf(r, occ, st.cabin), pn = p && r.nights ? p.p / r.nights : null, m = pn ? ourMatch(r, occ, st.cabin) : null;
    return m ? {r, p, pn, m, d: diffPct(m.pn, pn)} : null;
  }).filter(Boolean).sort((a, b) => st.vsSort === "date" ? (a.r.departure_date || "").localeCompare(b.r.departure_date || "") : b.d - a.d);
  const byLine = lines.filter(k => k !== "ambassador").map(k => {
    const ms = matched.filter(x => x.r.line === k).map(x => x.d);
    return {k, n: ms.length, cheaper: ms.filter(d => d < 0).length, med: ms.length ? median(ms) : null};
  }).filter(x => x.n);
  // Ambassador at Planet Cruise against our own website: the same sailing (ship and date)
  const agentVsUs = all.filter(r => r.line === "ambassador").map(r => {
    const o = our.find(x => x.date === r.departure_date && (x.ship || "").toLowerCase() === (r.ship || "").toLowerCase());
    if (!o) return null;
    const rows = CABINS.map(([c]) => { const a = priceOf(r, "twin", c), u = o.pr.twin[c]; return a && u != null ? {c, a: a.p, u} : null; }).filter(Boolean);
    return rows.length ? {r, o, rows} : null;
  }).filter(Boolean);
  const gap = gapBlock();
  box.innerHTML = source() + controls(box, {extra: `<label class="sub" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-k="like"${st.like ? " checked" : ""}> Match destination too</label>
      <select data-k="vsSort" aria-label="Sort"><option value="gap"${st.vsSort === "gap" ? " selected" : ""}>Where we're dearest first</option><option value="date"${st.vsSort === "date" ? " selected" : ""}>By departure</option></select>
      <button type="button" class="linkbtn" id="vs-csv">Download CSV</button>`}) + `
    <p class="note" style="margin:0 0 12px">Our closest = our cheapest sailing per night in the same month, within 3 nights' length, no-fly against no-fly and fly-Caribbean against our fly-cruises${st.like ? ", <b>going to the same part of the world</b> (Norway, the Baltic, the British Isles, Spain and Portugal…; read from the sailings' names, and our page photos' place names)" : ""}.
      ${st.like && noRegion ? `${noRegion} of their sailings have names that don't say where they go ("Northern Europe cruise") and are left out of the matching.` : ""}</p>
    ${losingBlock()}
    ${gap.html}
    <h3 style="margin:22px 0 8px;font-size:15px">Typical price per night (${occ === "solo" ? "solo" : "two sharing"}, per person)</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th class="num">Sailings</th>${CABINS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      <tr style="font-weight:600"><td>Ambassador (our website)</td><td class="num">${mine.length}</td>${CABINS.map(([c]) => `<td class="num">${gbp(ourPn[c])}</td>`).join("")}</tr>
      ${typical.map(t => `<tr><td>${esc(lineName(t.k))}</td><td class="num">${t.n}</td>${CABINS.map(([c]) => `<td class="num">${t.pn[c] == null ? "–" : `${gbp(t.pn[c])}${ourPn[c] != null ? `<div class="sub">${esc(diffWords(ourPn[c], t.pn[c]))}</div>` : ""}`}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="note">The middle price per night of each line's sailings for that cabin type, and of our own website's sailings in the same months (and destination, if one is chosen). A rough guide: it doesn't account for itinerary or what's included.</p>

    <h3 style="margin:22px 0 8px;font-size:15px">Head to head: sailing by sailing</h3>
    ${byLine.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th class="num">Sailings matched</th><th class="num">We're cheaper on</th><th class="num">Typical difference</th></tr></thead><tbody>
      ${byLine.map(x => `<tr><td>${esc(lineName(x.k))}</td><td class="num">${x.n}</td><td class="num">${x.cheaper} of ${x.n}</td><td class="num">${pctCell(x.med == null ? null : Math.round(x.med))}</td></tr>`).join("")}
    </tbody></table></div><p class="note">${esc(cabinLabel(st.cabin))}, ${occ === "solo" ? "solo" : "two sharing"}, per night. Typical difference = the middle of our price against theirs (−12% = we're 12% cheaper).</p>` : ""}
    ${matched.length ? `<div class="tablewrap" style="margin-top:12px"><table class="ptable"><thead><tr><th>Their sailing</th><th class="num">Per night</th><th>Our closest</th><th class="num">Per night</th><th class="num">Ours vs theirs</th></tr></thead><tbody>
      ${matched.slice(0, 150).map(({r, p, pn, m, d}) => `<tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${day(r.departure_date)} · ${r.nights} nights · ${gbp(p.p)}pp${regionR(r) ? ` · ${esc(REGION_LABEL[regionR(r)])}` : ""}</div></td>
        <td class="num">${gbp(pn)}</td>
        <td><a href="#${esc(m.best.id)}"><b>${esc(m.best.title || m.best.id)}</b></a><div class="sub">${esc(m.best.ship || "")} · ${day(m.best.date)} · ${m.best.nights} nights · ${gbp(m.best.pr[occ][st.cabin])}pp${m.n > 1 ? ` · cheapest of ${m.n}` : ""}</div></td>
        <td class="num">${gbp(m.pn)}</td><td class="num">${pctCell(d)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>No matches for these filters: we need one of our sailings in the same month, within 3 nights' length, the same no-fly or fly-Caribbean${st.like ? " and destination" : ""}, with the same cabin type on sale.</p></div>`}

    ${soloBlock()}

    <h3 style="margin:22px 0 8px;font-size:15px">Ambassador at Planet Cruise vs our website</h3>
    ${agentVsUs.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th>${CABINS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      ${agentVsUs.map(({r, o, rows}) => `<tr><td><a href="#${esc(o.id)}"><b>${esc(o.title || o.id)}</b></a><div class="sub">${esc(r.ship || "")} · ${day(r.departure_date)} · <a href="${esc(r.url)}" target="_blank" rel="noopener">Planet Cruise page</a></div></td>
        ${CABINS.map(([c]) => { const x = rows.find(y => y.c === c); return `<td class="num">${x ? `${gbp(x.a)}<div class="sub">ours ${gbp(x.u)} · ${pctCell(diffPct(x.a, x.u))}</div>` : "–"}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div><p class="note">Planet Cruise's price per person for our own sailings (two sharing) against our website's, same ship and date: below 0% = the agent is cheaper than we are.</p>`
      : `<div class="empty"><p>Appears once the sample has Ambassador sailings from Planet Cruise that match ours.</p></div>`}`;
  gap.wire(box);
  wire(box, () => renderVs(box));
  const csv = box.querySelector("#vs-csv");
  if (csv) csv.addEventListener("click", () => csvDownload(`vs-ambassador-${occ}-${st.cabin}-${C.updated || ""}.csv`,
    ["Line", "Their sailing", "Ship", "Destination", "Departure date", "Nights", "Their price pp", "Their per night", "Our sailing", "Our code", "Our date", "Our nights", "Our price pp", "Our per night", "Ours vs theirs %", "Their link"],
    matched.map(({r, p, pn, m, d}) => [lineName(r.line), r.title, r.ship, REGION_LABEL[regionR(r)] || "", r.departure_date, r.nights, p.p, Math.round(pn), m.best.title, m.best.id, m.best.date, m.best.nights, m.best.pr[occ][st.cabin], Math.round(m.pn), d, r.url])));
}

// Competitor ads (Sam, 15 Oct 2026: "give the competitor live ads section its own view in the nav"): each brand's
// live Facebook and Instagram ads in the UK from Meta's Ad Library API (meta_ads.py, once a day, once the token is
// added), grouped where the wording is the same, with links to Meta's and Google's libraries per brand. The ads'
// pictures aren't copied: "View ad" opens each in Meta's own library.
let M, mLoading = null, adShown = 40;
const adSt = {q: "", when: "", live: "live"};
const adLink = id => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
const daysSince = d => d ? Math.max(0, Math.round((Date.now() - Date.parse(d + "T12:00:00Z")) / 864e5)) : null;
function renderAds(box){
  if (M === undefined) {
    box.innerHTML = `<p class="loading">Loading competitor ads…</p>`;
    mLoading = mLoading || ctx.readJson("comp-meta").then(async m => {
      const parts = await Promise.all((m.parts || []).map(p => ctx.readJson(p).catch(() => ({ads: []}))));
      return {...m, ads: parts.flatMap((x, i) => (x.ads || []).map(a => ({...a, brand: m.parts[i].slice(10)})))};
    }).catch(() => null);
    mLoading.then(m => { M = m; renderAds(box); });
    return;
  }
  const pickLine = k => !st.line || k === st.line;
  const week = isoDaysAgo(7), month = isoDaysAgo(30);
  const live = a => !a.ended;
  const ads = M ? M.ads : [];
  const words = adSt.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = ads.filter(a => pickLine(a.brand) && (adSt.live === "live" ? live(a) : !live(a) && a.ended >= month)
    && (!adSt.when || (a.start || a.first_seen) >= (adSt.when === "7" ? week : month))
    && words.every(w => [a.page, ...(a.body || []), ...(a.title || []), ...(a.desc || [])].join(" ").toLowerCase().includes(w)));
  // Same wording = one group (brands run many versions of an ad: sizes, pictures, audiences)
  const groups = {};
  for (const a of list) {
    const k = [a.brand, (a.body || [])[0] || "", (a.title || [])[0] || ""].join("|");
    (groups[k] = groups[k] || []).push(a);
  }
  const G = Object.values(groups).map(g => ({ads: g.sort((x, y) => (x.start || "").localeCompare(y.start || "")), first: g[0]}))
    .sort((x, y) => (y.ads.at(-1).start || "").localeCompare(x.ads.at(-1).start || ""));
  const brandRow = ([k, n, d]) => {
    const mine = ads.filter(a => a.brand === k), on = mine.filter(live);
    const longest = Math.max(0, ...on.map(a => daysSince(a.start) || 0));
    return `<tr><td><b>${esc(n)}</b>${M && M.pages && (M.pages[k] || []).length ? `<div class="sub">${esc(M.pages[k].join(", "))}</div>` : ""}</td>
      ${M ? `<td class="num">${on.length}</td><td class="num">${on.filter(a => (a.start || a.first_seen) >= week).length}</td>
      <td class="num">${mine.filter(a => a.ended && a.ended >= week).length}</td><td class="num">${on.length ? longest + " days" : "–"}</td>` : ""}
      <td><a href="${esc(metaLib(n))}" target="_blank" rel="noopener noreferrer">Meta Ad Library</a></td>
      <td><a href="${esc(googleAds(d))}" target="_blank" rel="noopener noreferrer">Google</a> <span class="sub">${esc(d)}</span></td></tr>`;
  };
  const card = g => {
    const a = g.first, n = g.ads.length, since = g.ads[0].start || g.ads[0].first_seen, plats = [...new Set(g.ads.flatMap(x => x.platforms || []))];
    return `<div class="ma-card">
      <div class="ma-top"><b>${esc(brandName(a.brand))}</b>${a.page && a.page !== brandName(a.brand) ? ` <span class="sub">· ${esc(a.page)}</span>` : ""}
        <span class="sub">${live(a) ? `running ${daysSince(since)} day${daysSince(since) === 1 ? "" : "s"}, since ${day(since)}` : `ended ${day(a.ended)}`}</span></div>
      ${(a.title || [])[0] ? `<p class="ma-h">${esc(a.title[0])}</p>` : ""}
      ${(a.body || [])[0] ? `<p class="ma-b">${esc(a.body[0])}</p>` : ""}
      ${(a.desc || [])[0] ? `<p class="sub">${esc(a.desc[0])}</p>` : ""}
      <div class="ma-foot"><span class="sub">${n > 1 ? `${n} versions · ` : ""}${esc(plats.map(p => p[0].toUpperCase() + p.slice(1).replace(/_/g, " ")).join(", "))}</span>
        <span>${g.ads.slice(0, 3).map((x, i) => `<a href="${esc(adLink(x.id))}" target="_blank" rel="noopener noreferrer">View ad${n > 1 ? ` ${i + 1}` : ""}</a>`).join(" · ")}${n > 3 ? ` <span class="sub">+${n - 3}</span>` : ""}</span></div>
    </div>`;
  };
  if (!document.getElementById("ma-css")) {
    const c = document.createElement("style"); c.id = "ma-css";
    c.textContent = `.ma-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
      .ma-card{border:1px solid var(--rule);padding:12px 14px;display:flex;flex-direction:column;gap:6px;min-width:0}
      .ma-top{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;justify-content:space-between}
      .ma-h{margin:0;font-weight:600}
      .ma-b{margin:0;font-size:14px;white-space:pre-line;display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
      .ma-b.open{-webkit-line-clamp:unset;display:block}
      .ma-foot a{color:var(--allium)}
      .ma-foot{display:flex;flex-wrap:wrap;gap:4px 10px;justify-content:space-between;margin-top:auto;padding-top:6px;border-top:1px solid var(--rule);font-size:13px}`;
    document.head.appendChild(c);
  }
  const opt = (v, cur, l) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`;
  box.innerHTML = `
    <p class="note" style="margin:0 0 12px">${M ? `Their live Facebook and Instagram ads in the UK, from Meta's Ad Library (read ${esc(M.read_on ? day(M.read_on) : "–")}). Ads with the same wording are grouped; "View ad" opens each in Meta's library, with its picture or video.`
      : `Their ads in Meta's and Google's own public libraries, for the UK. Facebook and Instagram ads appear here too once the Meta Ad Library token is added (CLAUDE.md, "Competitor ads").`}</p>
    <div class="controls">
      <select id="ad-line" aria-label="Brand"><option value="">All brands</option>${BRANDS.map(([k, n]) => `<option value="${k}"${st.line === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
      ${M ? `<input type="search" id="ad-q" placeholder="Search the ads' words" value="${esc(adSt.q)}" aria-label="Search the ads">
      <select id="ad-live" aria-label="Live or ended">${opt("live", adSt.live, "Running now")}${opt("ended", adSt.live, "Ended in the last 30 days")}</select>
      <select id="ad-when" aria-label="Started">${opt("", adSt.when, "Started any time")}${opt("7", adSt.when, "Started in the last 7 days")}${opt("30", adSt.when, "Started in the last 30 days")}</select>
      <button type="button" class="linkbtn" id="ad-csv">Download CSV</button>` : ""}
    </div>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Brand</th>${M ? `<th class="num">Live UK ads</th><th class="num">New, 7 days</th><th class="num">Ended, 7 days</th><th class="num">Longest running</th>` : ""}<th>Facebook and Instagram</th><th>Google (Search, YouTube, display)</th></tr></thead><tbody>
      ${BRANDS.filter(([k]) => pickLine(k)).map(brandRow).join("")}
    </tbody></table></div>
    <p class="note">The library links open each brand already searched: on Meta pick the brand's own page in its results; Marella's Google ads are under TUI's domain.
      ${M && (M.problems || []).length ? `<br><b>Last read:</b> ${esc(M.problems.join("; "))}` : ""}</p>
    ${M ? `<h3 style="margin:20px 0 8px;font-size:15px">${adSt.live === "live" ? "Running now" : "Ended in the last 30 days"} <span class="sub">(${list.length} ad${list.length === 1 ? "" : "s"}, ${G.length} different)</span></h3>
      ${G.length ? `<div class="ma-grid">${G.slice(0, adShown).map(card).join("")}</div>
        ${G.length > adShown ? `<p class="note">Showing ${adShown} of ${G.length}. <button type="button" class="linkbtn" id="ad-more">Show more</button></p>` : ""}`
      : `<div class="empty"><p>No ads match.</p></div>`}` : ""}`;
  const rerender = () => renderAds(box);
  box.querySelector("#ad-line").addEventListener("change", e => { st.line = e.target.value; adShown = 40; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(x){} rerender(); });
  const q = box.querySelector("#ad-q");
  q && q.addEventListener("input", () => { adSt.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { rerender(); const n = box.querySelector("#ad-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  box.querySelector("#ad-live") && box.querySelector("#ad-live").addEventListener("change", e => { adSt.live = e.target.value; adShown = 40; rerender(); });
  box.querySelector("#ad-when") && box.querySelector("#ad-when").addEventListener("change", e => { adSt.when = e.target.value; adShown = 40; rerender(); });
  box.querySelector("#ad-more") && box.querySelector("#ad-more").addEventListener("click", () => { adShown += 40; rerender(); });
  box.querySelectorAll(".ma-b").forEach(b => b.addEventListener("click", () => b.classList.toggle("open")));
  box.querySelector("#ad-csv") && box.querySelector("#ad-csv").addEventListener("click", () =>
    csvDownload(`competitor-ads-${new Date().toISOString().slice(0, 10)}.csv`, ["Brand", "Page", "Started", "Ended", "Days running", "Headline", "Text", "Description", "Platforms", "View ad"],
      list.map(a => [brandName(a.brand), a.page, a.start, a.ended || "", a.ended ? "" : daysSince(a.start), (a.title || [])[0] || "", (a.body || [])[0] || "", (a.desc || [])[0] || "", (a.platforms || []).join("; "), adLink(a.id)])));
}

const PAGES = {prices: renderPrices, offers: renderOffers, vs: renderVs, ads: renderAds};

// mount(box, ctx, page): page = "prices" | "offers" | "vs" | "ads"; the data is read once and shared by the pages
export async function mount(box, c, page){
  ctx = c; esc = c.esc;
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e){}
  if (page === "ads") return renderAds(box);   // links only: needs none of the price data
  if (!C){
    box.innerHTML = `<p class="loading">Loading competitor prices…</p>`;
    // comp-current holds the list of per-line parts (comp-po, comp-cunard, …) with the sailings
    loading = loading || Promise.all([c.readJson("comp-current"), c.readJson("comp-runs").catch(() => ({runs: []})),
                                      c.readJson("comp-inbox").catch(() => null)])   // the newsletter inbox (offers_inbox.py), once set up
      .then(async ([cur, runs, inbox]) => {
        I = inbox;
        if (cur.parts) {
          const parts = await Promise.all(cur.parts.map(p => c.readJson(p).catch(() => ({sailings: {}}))));
          cur.sailings = Object.assign({}, ...parts.map(x => x.sailings || {}));
        }
        return [cur, runs];
      });
    try { [C, R] = await loading; }
    catch (e) {
      loading = null;
      box.innerHTML = `<div class="empty"><p>Competitor prices appear after the first daily check that reads them (the first check of a UK day).</p></div>`;
      return;
    }
    C.lines = C.lines || LINES;
    our = ourSailings(c.state, c.cabins || {}, c.getAdkit ? await c.getAdkit() : null);
  }
  PAGES[page](box);
}
