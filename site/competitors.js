// Competitors pages (Sam, 15 Oct 2026: "Go ahead with Fred Olsen and Planet Cruise"; then "a separate section in the
// nav, and also show an offers and vs Ambassador section"). Three pages under Competitors in the menu:
//   prices  every sampled sailing (filters, price per night, 7-day change), what changed
//   offers  their offers (brand-wide and per sailing) beside Ambassador's own live promotions
//   vs      Ambassador against them: price per night by line and cabin type, head to head by line, matched
//           sailings, and Ambassador at Planet Cruise against our own website
// Read-only: what competitors.py recorded (pricewatch/comp-current, comp-runs) beside our own saved state.
// Fred. Olsen's prices are its own; the other lines' are Planet Cruise's (an agent: its own discounts and "was" figures).

const CABINS = [["inside", "Inside"], ["outside", "Outside"], ["balcony", "Balcony"], ["suite", "Suite"]];
// Our cabin grades → the comparable types
const OURS = {inside: "inside", ocean_view: "outside", balcony: "balcony", suite: "suite"};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "spw-comp";
const LINES = {fredolsen: "Fred. Olsen", po: "P&O Cruises", princess: "Princess Cruises", cunard: "Cunard", marella: "Marella Cruises",
  msc: "MSC Cruises", royal: "Royal Caribbean", celebrity: "Celebrity Cruises", ambassador: "Ambassador (at Planet Cruise)"};
let C, R, our, ctx, esc, loading = null;
const st = {line: "", cabin: "inside", occ: "twin", month: "", seg: "", sort: "date", vsSort: "gap"};
let showAll = false;
// No-fly from a UK port, or fly-Caribbean (competitors.py `segment`; older records: the fly flag)
const segOf = r => r.segment || (r.fly ? "fly-caribbean" : "no-fly");
const SEGS = {"no-fly": "No-fly from the UK", "fly-caribbean": "Fly-Caribbean"};

const gbp = v => v == null ? "–" : "£" + Math.round(v).toLocaleString("en-GB");
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
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

// Ambassador's own sailings (our saved state): cheapest per cabin type, two sharing and solo
function ourSailings(state, cabins){
  const today = new Date().toISOString().slice(0, 10), out = [], map = cabins.sailings || cabins || {};   // index.html passes the sailings map
  for (const [id, s] of Object.entries(state.sailings || {})){
    if (s.removed || !s.departure_date || s.departure_date <= today || !s.nights) continue;
    const pr = {twin: {}, solo: {}};
    for (const [k, v] of Object.entries((map[id] || {}).cabins || {})){
      const [occ, g] = k.split("."), t = OURS[g], sg = last(v.seg);
      if (!t || !sg || sg.p == null || sg.out || !pr[occ]) continue;
      if (pr[occ][t] == null || sg.p < pr[occ][t]) pr[occ][t] = sg.p;
    }
    out.push({id, title: s.title, ship: s.ship, port: s.flight_from ? s.flight_from + " (fly)" : s.port, date: s.departure_date, nights: s.nights, fly: !!s.flight_from, pr});
  }
  return out;
}
// Ambassador's cheapest per night for the same cabin type, same month, similar length (±3 nights), same no-fly/fly
function ourMatch(r, occ, cab){
  const m = (r.departure_date || "").slice(0, 7), fly = segOf(r) === "fly-caribbean";
  const hits = our.filter(o => o.date.slice(0, 7) === m && Math.abs(o.nights - (r.nights || 0)) <= 3 && o.fly === fly && o.pr[occ][cab] != null);
  if (!hits.length) return null;
  const best = hits.reduce((a, o) => o.pr[occ][cab] / o.nights < a.pr[occ][cab] / a.nights ? o : a);
  return {pn: best.pr[occ][cab] / best.nights, n: hits.length, best};
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
    <select data-k="seg" aria-label="No-fly or fly-Caribbean"><option value="">No-fly and fly-Caribbean</option>${Object.entries(SEGS).map(([k, l]) => `<option value="${k}"${st.seg === k ? " selected" : ""}>${l}</option>`).join("")}</select>`}
    ${opts.extra || ""}
  </div>`;
}
function wire(box, rerender){
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} };
  box.querySelectorAll("[data-k]").forEach(i => i.addEventListener("change", e => {
    st[i.dataset.k] = i.type === "checkbox" ? e.target.checked : e.target.value; showAll = false; save(); rerender();
  }));
}
const pick = r => (!st.line || r.line === st.line) && (!st.month || (r.departure_date || "").slice(0, 7) === st.month) && (!st.seg || segOf(r) === st.seg);
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
function renderPrices(box){
  const wk = isoDaysAgo(7), all = live().map(([, r]) => r);
  const recent = ((R && R.runs) || []).filter(r => r.date >= wk).flatMap(r => r.changes.map(c => ({...c, date: r.date})));
  const moves = recent.filter(c => c.kind === "price_drop" || c.kind === "price_rise");
  const list = live().filter(([, r]) => pick(r)).map(([id, r]) => {
    const p = priceOf(r, st.occ, st.cabin), before = priceAt(r, st.occ, st.cabin, wk);
    return {id, r, p, pn: p && r.nights ? p.p / r.nights : null, chg: p && before != null && before !== p.p ? p.p - before : null};
  }).filter(x => x.p).sort((a, b) => st.sort === "pn" ? a.pn - b.pn : st.sort === "chg" ? (a.chg ?? 0) - (b.chg ?? 0) : (a.r.departure_date || "").localeCompare(b.r.departure_date || ""));
  const lines = new Set(all.map(r => r.line));
  box.innerHTML = source() + `
    <div class="stats" style="margin-bottom:18px">
      <div class="stat"><span class="k">Competing sailings</span><span class="v">${all.filter(r => r.line !== "ambassador").length}</span><span class="s">${all.filter(r => r.line !== "ambassador" && segOf(r) === "no-fly").length} no-fly · ${all.filter(r => r.line !== "ambassador" && segOf(r) === "fly-caribbean").length} fly-Caribbean · ${[...lines].filter(l => l !== "ambassador").length} lines</span></div>
      <div class="stat"><span class="k">Price moves, 7 days</span><span class="v">${moves.length}</span><span class="s">${moves.filter(c => c.kind === "price_drop").length} down · ${moves.filter(c => c.kind === "price_rise").length} up</span></div>
      <div class="stat"><span class="k">New offers, 7 days</span><span class="v">${recent.filter(c => c.kind === "offer_added").length}</span><span class="s">${recent.filter(c => c.kind === "offer_ended").length} ended</span></div>
    </div>
    ${controls(box, {extra: `<select data-k="sort" aria-label="Sort"><option value="date"${st.sort === "date" ? " selected" : ""}>By departure</option><option value="pn"${st.sort === "pn" ? " selected" : ""}>Cheapest per night</option><option value="chg"${st.sort === "chg" ? " selected" : ""}>Biggest drop this week</option></select>
      <button type="button" class="linkbtn" id="cp-csv">Download CSV</button>`})}
    ${list.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th><th>Departs</th><th class="num">Nights</th><th class="num">From pp</th><th class="num">Per night</th><th class="num">7 days</th><th>Offers</th></tr></thead><tbody>
      ${(showAll ? list : list.slice(0, 300)).map(({r, p, pn, chg}) => `<tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title || r.code || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${esc(r.port || "")}${segOf(r) === "fly-caribbean" ? ' <span class="chip">fly-Caribbean</span>' : ""}</div></td>
        <td>${day(r.departure_date)}</td><td class="num">${r.nights || "–"}</td>
        <td class="num">${gbp(p.p)}${p.was ? `<div class="sub"><s>${gbp(p.was)}</s></div>` : ""}${p.fare ? `<div class="sub">${esc(p.fare)}</div>` : ""}</td>
        <td class="num">${pn ? gbp(pn) : "–"}</td>
        <td class="num">${chg == null ? "–" : `<span style="color:${chg < 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${chg < 0 ? "−" : "+"}${gbp(Math.abs(chg))}</span>`}</td>
        <td>${liveOffers(r).slice(0, 3).map(o => `<span class="chip" title="${esc(o)}" style="white-space:normal">${esc(o.length > 70 ? o.slice(0, 68) + "…" : o)}</span>`).join(" ") || "–"}</td></tr>`).join("")}
    </tbody></table></div><p class="note">${list.length} sailing${list.length === 1 ? "" : "s"} with a ${st.occ === "solo" ? "solo " : ""}${cabinLabel(st.cabin).toLowerCase()} price${!showAll && list.length > 300 ? ` (showing the first 300: <button type="button" class="linkbtn" id="cp-all">Show all</button>)` : ""}. See <b>Vs Ambassador</b> for how ours compare.</p>`
      : `<div class="empty"><p>No sampled sailings match. The first days fill the sample (about a dozen new pages a line each day).</p></div>`}
    <h3 style="margin:22px 0 8px;font-size:15px">What changed (last 7 days)</h3>
    ${recent.some(c => c.kind !== "new") ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Line</th><th>Sailing</th><th>Change</th></tr></thead><tbody>
      ${recent.filter(c => c.kind !== "new" && (!st.line || c.line === st.line)).reverse().slice(0, 200).map(c => { const r = (C.sailings || {})[c.id] || {};
        return `<tr><td>${day(c.date)}</td><td>${esc(lineName(c.line))}</td><td>${c.id ? `<a href="${esc(r.url || "#")}" target="_blank" rel="noopener">${esc(r.title || c.title || c.id)}</a>` : "Brand-wide"}</td><td>${esc(words(c))}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty"><p>Changes appear after the second daily check.</p></div>`}`;
  wire(box, () => renderPrices(box));
  const more = box.querySelector("#cp-all");
  if (more) more.addEventListener("click", () => { showAll = true; renderPrices(box); });
  const csv = box.querySelector("#cp-csv");
  if (csv) csv.addEventListener("click", () => csvDownload(`competitor-prices-${st.occ}-${st.cabin}-${C.updated || ""}.csv`,
    ["Line", "Sailing", "Ship", "Departs from", "No-fly / fly-Caribbean", "Departure date", "Nights", "Cabin", "Fare", "Price pp", "Was pp", "Per night", "Change 7 days", "Offers", "Link", "Read"],
    list.map(({r, p, pn, chg}) => [lineName(r.line), r.title, r.ship, r.port, SEGS[segOf(r)], r.departure_date, r.nights, st.occ + " " + st.cabin, p.fare, p.p, p.was, pn && Math.round(pn), chg, liveOffers(r).join("; "), r.url, r.checked_at])));
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
function renderOffers(box){
  const all = live().map(([, r]) => r).filter(r => !st.line || r.line === st.line);
  const brand = Object.entries(C.brand_offers || {}).filter(([k]) => !st.line || k === st.line).flatMap(([k, o]) => Object.entries(o).map(([t, e]) => ({line: k, t, ...e})));
  const agent = {};
  for (const r of all) for (const o of liveOffers(r)) {
    const k = r.line + "|" + o;
    (agent[k] = agent[k] || {line: r.line, o, n: 0, of: all.filter(x => x.line === r.line).length, first: r.offers[o].slice(-1)[0][0]}).n++;
  }
  const ended = ((R && R.runs) || []).filter(r => r.date >= isoDaysAgo(30)).flatMap(r => r.changes.filter(c => c.kind === "offer_ended" && (!st.line || c.line === st.line)).map(c => ({...c, date: r.date})));
  const endedUniq = [...new Map(ended.map(c => [c.line + "|" + c.offer, c])).values()];
  // Ambassador's own live promotions (our website), as the Live promotions page counts them
  const S = ctx.state, count = {};
  for (const s of Object.values(S.sailings || {})) if (!s.removed)
    for (const [o, sp] of Object.entries(s.promos || {})) if (sp.length && sp[sp.length - 1][1] == null) count[o] = (count[o] || 0) + 1;
  const ours = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([o, n]) => ({name: ((S.offers || {})[o] || {}).name || o, desc: ((S.offers || {})[o] || {}).desc, n}));
  const onSale = Object.values(S.sailings || {}).filter(s => !s.removed).length;
  const groups = {};
  for (const a of Object.values(agent)) (groups[a.line] = groups[a.line] || []).push(a);
  box.innerHTML = source() + controls(box, {cabin: false, month: false}) + `
    <h3 style="margin:6px 0 8px;font-size:15px">Their offers now</h3>
    ${brand.some(b => !b.ended) || Object.keys(agent).length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th>Offer</th><th class="num">On sampled sailings</th><th>First seen</th></tr></thead><tbody>
      ${brand.filter(b => !b.ended).map(b => `<tr><td>${esc(lineName(b.line))}</td><td style="white-space:normal"><a href="${esc(b.url)}" target="_blank" rel="noopener"><b>${esc(b.t)}</b></a>${b.text ? `<div class="sub">${esc(b.text)}</div>` : ""}</td><td class="num">brand-wide</td><td>${day(b.first_seen)}</td></tr>`).join("")}
      ${Object.keys(groups).sort((a, b) => lineName(a).localeCompare(lineName(b))).flatMap(k => groups[k].sort((a, b) => b.n - a.n)).map(o =>
        `<tr><td>${esc(lineName(o.line))}</td><td style="white-space:normal">${esc(o.o)}</td><td class="num">${o.n} of ${o.of}</td><td>${day(o.first)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>No offers recorded yet.</p></div>`}
    <p class="note">Brand-wide offers are Fred. Olsen's own deals pages. The rest are the offers Planet Cruise shows on each sampled sailing (its promotion line and offer tags), which can include the agent's own.</p>
    ${endedUniq.length ? `<h3 style="margin:22px 0 8px;font-size:15px">Ended in the last 30 days</h3><div class="tablewrap"><table class="ptable"><thead><tr><th>Ended</th><th>Line</th><th>Offer</th></tr></thead><tbody>
      ${endedUniq.reverse().map(c => `<tr><td>${day(c.date)}</td><td>${esc(lineName(c.line))}</td><td style="white-space:normal">${esc(c.offer)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${(brand.some(b => b.ended)) ? `<p class="note">Brand-wide offers ended: ${brand.filter(b => b.ended).map(b => `${esc(b.t)} (${day(b.ended)})`).join(", ")}</p>` : ""}
    <h3 style="margin:22px 0 8px;font-size:15px">Ambassador's own offers now (our website)</h3>
    ${ours.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Promotion</th><th class="num">Sailings</th></tr></thead><tbody>
      ${ours.map(o => `<tr><td style="white-space:normal"><b>${esc(o.name)}</b>${o.desc ? `<div class="sub">${esc(o.desc.length > 160 ? o.desc.slice(0, 158) + "…" : o.desc)}</div>` : ""}</td><td class="num">${o.n} of ${onSale}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>No promotions live on our sailings.</p></div>`}`;
  wire(box, () => renderOffers(box));
}

// ---------- Vs Ambassador ----------
function renderVs(box){
  const all = live().map(([, r]) => r);
  const covered = new Set(all.map(r => (r.departure_date || "").slice(0, 7)));
  const occ = st.occ;
  // Typical price per night by line and cabin type, with Ambassador's own (same months) and each line against it
  const lines = Object.keys(C.lines || LINES).filter(k => all.some(r => r.line === k));
  const pnOf = (rs, c) => median(rs.map(r => { const p = priceOf(r, occ, c); return p && r.nights ? p.p / r.nights : null; }).filter(v => v != null));
  const mine = our.filter(o => covered.has(o.date.slice(0, 7)));
  const ourPn = Object.fromEntries(CABINS.map(([c]) => [c, median(mine.map(o => o.pr[occ][c] != null ? o.pr[occ][c] / o.nights : null).filter(v => v != null))]));
  const typical = lines.map(k => { const rs = all.filter(r => r.line === k); return {k, n: rs.length, pn: Object.fromEntries(CABINS.map(([c]) => [c, pnOf(rs, c)]))}; });
  // Matched sailings: each of theirs against our closest (same month, ±3 nights, same no-fly/fly), for the chosen cabin
  const matched = all.filter(r => r.line !== "ambassador" && pick(r)).map(r => {
    const p = priceOf(r, occ, st.cabin), pn = p && r.nights ? p.p / r.nights : null, m = pn ? ourMatch(r, occ, st.cabin) : null;
    return m ? {r, p, pn, m, d: diffPct(m.pn, pn)} : null;
  }).filter(Boolean).sort((a, b) => st.vsSort === "date" ? (a.r.departure_date || "").localeCompare(b.r.departure_date || "") : b.d - a.d);
  const byLine = lines.filter(k => k !== "ambassador").map(k => {
    const ms = all.filter(r => r.line === k && pick(r)).map(r => { const p = priceOf(r, occ, st.cabin), pn = p && r.nights ? p.p / r.nights : null, m = pn ? ourMatch(r, occ, st.cabin) : null; return m ? diffPct(m.pn, pn) : null; }).filter(v => v != null);
    return {k, n: ms.length, cheaper: ms.filter(d => d < 0).length, med: ms.length ? median(ms) : null};
  }).filter(x => x.n);
  // Ambassador at Planet Cruise against our own website: the same sailing (ship and date)
  const agentVsUs = all.filter(r => r.line === "ambassador").map(r => {
    const o = our.find(x => x.date === r.departure_date && (x.ship || "").toLowerCase() === (r.ship || "").toLowerCase());
    if (!o) return null;
    const rows = CABINS.map(([c]) => { const a = priceOf(r, "twin", c), u = o.pr.twin[c]; return a && u != null ? {c, a: a.p, u} : null; }).filter(Boolean);
    return rows.length ? {r, o, rows} : null;
  }).filter(Boolean);

  box.innerHTML = source() + `
    <h3 style="margin:6px 0 8px;font-size:15px">Typical price per night (${occ === "solo" ? "solo" : "two sharing"}, per person)</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th class="num">Sailings</th>${CABINS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      <tr style="font-weight:600"><td>Ambassador (our website)</td><td class="num">${mine.length}</td>${CABINS.map(([c]) => `<td class="num">${gbp(ourPn[c])}</td>`).join("")}</tr>
      ${typical.map(t => `<tr><td>${esc(lineName(t.k))}</td><td class="num">${t.n}</td>${CABINS.map(([c]) => `<td class="num">${t.pn[c] == null ? "–" : `${gbp(t.pn[c])}${ourPn[c] != null ? `<div class="sub">${esc(diffWords(ourPn[c], t.pn[c]))}</div>` : ""}`}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="note">The middle price per night of each line's sampled sailings for that cabin type, and of our own website's sailings in the same months. A rough guide: it doesn't account for itinerary or what's included.</p>

    <h3 style="margin:22px 0 8px;font-size:15px">Head to head: sailing by sailing</h3>
    ${controls(box, {extra: `<select data-k="vsSort" aria-label="Sort"><option value="gap"${st.vsSort === "gap" ? " selected" : ""}>Where we're dearest first</option><option value="date"${st.vsSort === "date" ? " selected" : ""}>By departure</option></select>
      <button type="button" class="linkbtn" id="vs-csv">Download CSV</button>`})}
    ${byLine.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th class="num">Sailings matched</th><th class="num">We're cheaper on</th><th class="num">Typical difference</th></tr></thead><tbody>
      ${byLine.map(x => `<tr><td>${esc(lineName(x.k))}</td><td class="num">${x.n}</td><td class="num">${x.cheaper} of ${x.n}</td><td class="num">${pctCell(x.med == null ? null : Math.round(x.med))}</td></tr>`).join("")}
    </tbody></table></div><p class="note">${esc(cabinLabel(st.cabin))}, ${occ === "solo" ? "solo" : "two sharing"}, per night. Typical difference = the middle of our price against theirs (−12% = we're 12% cheaper).</p>` : ""}
    ${matched.length ? `<div class="tablewrap" style="margin-top:12px"><table class="ptable"><thead><tr><th>Their sailing</th><th class="num">Per night</th><th>Our closest</th><th class="num">Per night</th><th class="num">Ours vs theirs</th></tr></thead><tbody>
      ${matched.slice(0, 150).map(({r, p, pn, m, d}) => `<tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${day(r.departure_date)} · ${r.nights} nights · ${gbp(p.p)}pp</div></td>
        <td class="num">${gbp(pn)}</td>
        <td><a href="#${esc(m.best.id)}"><b>${esc(m.best.title || m.best.id)}</b></a><div class="sub">${esc(m.best.ship || "")} · ${day(m.best.date)} · ${m.best.nights} nights · ${gbp(m.best.pr[occ][st.cabin])}pp${m.n > 1 ? ` · cheapest of ${m.n}` : ""}</div></td>
        <td class="num">${gbp(m.pn)}</td><td class="num">${pctCell(d)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>No matches for these filters: we need one of our sailings in the same month, within 3 nights' length, the same no-fly or fly-Caribbean, with the same cabin type on sale.</p></div>`}

    <h3 style="margin:22px 0 8px;font-size:15px">Ambassador at Planet Cruise vs our website</h3>
    ${agentVsUs.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th>${CABINS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      ${agentVsUs.map(({r, o, rows}) => `<tr><td><a href="#${esc(o.id)}"><b>${esc(o.title || o.id)}</b></a><div class="sub">${esc(r.ship || "")} · ${day(r.departure_date)} · <a href="${esc(r.url)}" target="_blank" rel="noopener">Planet Cruise page</a></div></td>
        ${CABINS.map(([c]) => { const x = rows.find(y => y.c === c); return `<td class="num">${x ? `${gbp(x.a)}<div class="sub">ours ${gbp(x.u)} · ${pctCell(diffPct(x.a, x.u))}</div>` : "–"}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div><p class="note">Planet Cruise's price per person for our own sailings (two sharing) against our website's, same ship and date: below 0% = the agent is cheaper than we are.</p>`
      : `<div class="empty"><p>Appears once the sample has Ambassador sailings from Planet Cruise that match ours.</p></div>`}`;
  wire(box, () => renderVs(box));
  const csv = box.querySelector("#vs-csv");
  if (csv) csv.addEventListener("click", () => csvDownload(`vs-ambassador-${occ}-${st.cabin}-${C.updated || ""}.csv`,
    ["Line", "Their sailing", "Ship", "Departure date", "Nights", "Their price pp", "Their per night", "Our sailing", "Our code", "Our date", "Our nights", "Our price pp", "Our per night", "Ours vs theirs %", "Their link"],
    matched.map(({r, p, pn, m, d}) => [lineName(r.line), r.title, r.ship, r.departure_date, r.nights, p.p, Math.round(pn), m.best.title, m.best.id, m.best.date, m.best.nights, m.best.pr[occ][st.cabin], Math.round(m.pn), d, r.url])));
}

const PAGES = {prices: renderPrices, offers: renderOffers, vs: renderVs};

// mount(box, ctx, page): page = "prices" | "offers" | "vs"; the data is read once and shared by the three pages
export async function mount(box, c, page){
  ctx = c; esc = c.esc;
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e){}
  if (!C){
    box.innerHTML = `<p class="loading">Loading competitor prices…</p>`;
    // comp-current holds the list of per-line parts (comp-po, comp-cunard, …) with the sailings
    loading = loading || Promise.all([c.readJson("comp-current"), c.readJson("comp-runs").catch(() => ({runs: []}))])
      .then(async ([cur, runs]) => {
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
    our = ourSailings(c.state, c.cabins || {});
  }
  PAGES[page](box);
}
