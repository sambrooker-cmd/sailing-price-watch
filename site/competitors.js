// Competitors pages (Sam, 15 Oct 2026: "Go ahead with Fred Olsen and Planet Cruise"; then "a separate section in the
// nav, and also show an offers and vs Ambassador section"). Three pages under Competitors in the menu:
//   prices  every sampled sailing (filters, price per night, 7-day change), what changed
//   offers  their offers (brand-wide and per sailing) beside Ambassador's own live promotions
//   vs      Ambassador against them: price per night by line and cabin type, head to head by line, matched
//           sailings, and Ambassador at Planet Cruise against our own website
// Read-only: what competitors.py recorded (pricewatch/comp-current, comp-runs) beside our own saved state.
// Fred. Olsen's prices are its own; the other lines' are Planet Cruise's (an agent: its own discounts and "was" figures).

import {collect, baselines, TYPES, TYPE_LABEL} from "./offerkit.js?v=__BUILD__";

const CABINS = [["inside", "Inside"], ["outside", "Outside"], ["balcony", "Balcony"], ["suite", "Suite"]];
// Our cabin grades → the comparable types
const OURS = {inside: "inside", ocean_view: "outside", balcony: "balcony", suite: "suite"};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "spw-comp";
const LINES = {fredolsen: "Fred. Olsen", po: "P&O Cruises", princess: "Princess Cruises", cunard: "Cunard", marella: "Marella Cruises",
  msc: "MSC Cruises", royal: "Royal Caribbean", celebrity: "Celebrity Cruises", ambassador: "Ambassador (at Planet Cruise)"};
let C, R, I = null, our, ctx, esc, loading = null;
const st = {otype: "", line: "", cabin: "inside", occ: "twin", month: "", seg: "", sort: "date", vsSort: "gap"};
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
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title || r.code || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${esc(r.port || "")}${r.flights ? ` · flights from ${esc(r.flights)}` : ""}${segOf(r) === "fly-caribbean" ? ' <span class="chip">fly-Caribbean</span>' : ""}</div></td>
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
    our = ourSailings(c.state, c.cabins || {});
  }
  PAGES[page](box);
}
