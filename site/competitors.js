// Competitors page (Sam, 15 Oct 2026: "Go ahead with Fred Olsen and Planet Cruise"). Read-only: what
// competitors.py recorded (pricewatch/comp-current, comp-runs) beside Ambassador's own prices from our saved state.
// Fred. Olsen's prices are its own; the other lines' are Planet Cruise's (an agent: they can include its own
// discounts and "was" figures). "Ambassador (at Planet Cruise)" is there so like can be compared with like.

const CABINS = [["inside", "Inside"], ["outside", "Outside"], ["balcony", "Balcony"], ["suite", "Suite"]];
// Our cabin grades → the comparable types
const OURS = {inside: "inside", ocean_view: "outside", balcony: "balcony", suite: "suite"};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "spw-comp";
let el, S, C, R, our, esc, st = {line: "", cabin: "inside", occ: "twin", month: "", nofly: false, sort: "date"};

const gbp = v => v == null ? "–" : "£" + Math.round(v).toLocaleString("en-GB");
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const last = segs => segs && segs.length ? segs[segs.length - 1] : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const liveOffers = r => Object.entries(r.offers || {}).filter(([, sp]) => sp.length && sp[sp.length - 1][1] == null).map(([o]) => o);

function priceOf(r, occ, cab){
  const s = last((r.prices || {})[`${occ}.${cab}`]);
  return s && s.p != null ? s : null;
}
// The price 7 days ago (the segment in force then), for "change over 7 days"
function priceAt(r, occ, cab, iso){
  const segs = (r.prices || {})[`${occ}.${cab}`] || [];
  let p = null; for (const s of segs) if (s.from <= iso) p = s.p; return p;
}

// Ambassador's own sailings (our saved state): per night by comparable cabin type
function ourSailings(state, cabins){
  const today = new Date().toISOString().slice(0, 10), out = [];
  for (const [id, s] of Object.entries(state.sailings || {})){
    if (s.removed || !s.departure_date || s.departure_date <= today || !s.nights) continue;
    const cab = (((cabins.sailings || cabins) || {})[id] || {}).cabins || {}, pr = {twin: {}, solo: {}};   // index.html passes the sailings map
    for (const [k, v] of Object.entries(cab)){
      const [occ, g] = k.split("."), t = OURS[g], sg = last(v.seg);
      if (!t || !sg || sg.p == null || sg.out || !pr[occ]) continue;
      if (pr[occ][t] == null || sg.p < pr[occ][t]) pr[occ][t] = sg.p;
    }
    out.push({id, title: s.title, date: s.departure_date, nights: s.nights, fly: !!s.flight_from, pr});
  }
  return out;
}
// Ambassador's cheapest per night for the same cabin type, same month, similar length (±3 nights), same no-fly/fly
function ourMatch(r, occ, cab){
  const m = (r.departure_date || "").slice(0, 7), fly = !!r.fly;
  const hits = our.filter(o => o.date.slice(0, 7) === m && Math.abs(o.nights - (r.nights || 0)) <= 3 && o.fly === fly && o.pr[occ][cab] != null);
  if (!hits.length) return null;
  const best = hits.reduce((a, o) => o.pr[occ][cab] / o.nights < a.pr[occ][cab] / a.nights ? o : a);
  return {pn: best.pr[occ][cab] / best.nights, n: hits.length, best};
}

function rows(){
  const today = new Date().toISOString().slice(0, 10), wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  return Object.entries(C.sailings || {}).filter(([, r]) => !r.gone && (r.departure_date || "") > today)
    .filter(([, r]) => !st.line || r.line === st.line)
    .filter(([, r]) => !st.month || (r.departure_date || "").slice(0, 7) === st.month)
    .filter(([, r]) => !st.nofly || !r.fly)
    .map(([id, r]) => {
      const p = priceOf(r, st.occ, st.cabin), before = priceAt(r, st.occ, st.cabin, wk);
      return {id, r, p, pn: p && r.nights ? p.p / r.nights : null, chg: p && before != null && before !== p.p ? p.p - before : null,
              ours: p ? ourMatch(r, st.occ, st.cabin) : null};
    })
    .filter(x => x.p)
    .sort((a, b) => st.sort === "pn" ? a.pn - b.pn : st.sort === "chg" ? (a.chg ?? 0) - (b.chg ?? 0) : (a.r.departure_date || "").localeCompare(b.r.departure_date || ""));
}

function render(){
  const lines = C.lines || {};
  const lineName = k => lines[k] || k;
  const all = Object.values(C.sailings || {}).filter(r => !r.gone);
  const runs = (R && R.runs) || [];
  const wk = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const recent = runs.filter(r => r.date >= wk).flatMap(r => r.changes.map(c => ({...c, date: r.date})));
  const moves = recent.filter(c => c.kind === "price_drop" || c.kind === "price_rise");
  const offersLive = new Set(all.flatMap(r => liveOffers(r).map(o => r.line + "|" + o)));
  const months = [...new Set(all.map(r => (r.departure_date || "").slice(0, 7)).filter(Boolean))].sort();
  const list = rows();

  // Per line: median price per night for each cabin type (twin), and Ambassador's own over the same months
  const covered = new Set(all.map(r => (r.departure_date || "").slice(0, 7)));
  const byLine = Object.keys(lines).map(k => {
    const rs = all.filter(r => r.line === k);
    return [lineName(k), rs.length, ...CABINS.map(([c]) => median(rs.map(r => { const p = priceOf(r, "twin", c); return p && r.nights ? p.p / r.nights : null; }).filter(v => v != null)))];
  }).filter(r => r[1]);
  const mine = our.filter(o => covered.has(o.date.slice(0, 7)));
  byLine.unshift(["Ambassador (our website)", mine.length, ...CABINS.map(([c]) => median(mine.map(o => o.pr.twin[c] != null ? o.pr.twin[c] / o.nights : null).filter(v => v != null)))]);

  const brand = Object.entries(C.brand_offers || {}).flatMap(([k, o]) => Object.entries(o).map(([t, e]) => ({line: k, t, ...e})));
  const agentOffers = {};
  for (const r of all) for (const o of liveOffers(r)) { const k = r.line + "|" + o; (agentOffers[k] = agentOffers[k] || {line: r.line, o, n: 0, first: (r.offers[o].slice(-1)[0] || [])[0]}).n++; }

  el.innerHTML = `
    <p class="note" style="margin:0 0 12px">Read once a day from <b>Fred. Olsen's own website</b> and the travel agent <b>Planet Cruise</b>
      (P&amp;O, Princess, Cunard, Marella, MSC, Royal Caribbean, Celebrity, and Ambassador itself for a like-for-like check): a sample of
      sailings sold from the UK, never the whole catalogue. Agent prices can include the agent's own discounts and "was" figures.
      Last read ${esc(C.updated_at ? C.updated_at.slice(0, 16).replace("T", " ") + " UTC" : "–")}. Saga isn't covered (no source whose terms allow it).
      Recorded only: nothing here changes a price, an ad or a claim.</p>
    <div class="stats" style="margin-bottom:18px">
      <div class="stat"><span class="k">Sailings sampled</span><span class="v">${all.length}</span><span class="s">${byLine.length - 1} lines</span></div>
      <div class="stat"><span class="k">Price moves, 7 days</span><span class="v">${moves.length}</span><span class="s">${moves.filter(c => c.kind === "price_drop").length} down · ${moves.filter(c => c.kind === "price_rise").length} up</span></div>
      <div class="stat"><span class="k">Live offers</span><span class="v">${offersLive.size + brand.filter(b => !b.ended).length}</span><span class="s">on sampled sailings, plus brand-wide</span></div>
    </div>

    <h3 style="margin:0 0 8px;font-size:15px">Typical price per night (twin, per person)</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th class="num">Sailings</th>${CABINS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>
      ${byLine.map(r => `<tr${r[0].startsWith("Ambassador (our") ? ' style="font-weight:600"' : ""}><td>${esc(r[0])}</td><td class="num">${r[1]}</td>${r.slice(2).map(v => `<td class="num">${v == null ? "–" : gbp(v)}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="note">The middle price per night of each line's sampled sailings for that cabin type. Ambassador's row is our own website's prices for sailings in the same months.</p>

    <h3 style="margin:22px 0 8px;font-size:15px">Sailings</h3>
    <div class="controls">
      <select id="cp-line" aria-label="Cruise line"><option value="">All lines</option>${Object.keys(lines).filter(k => all.some(r => r.line === k)).map(k => `<option value="${esc(k)}"${st.line === k ? " selected" : ""}>${esc(lineName(k))}</option>`).join("")}</select>
      <select id="cp-cabin" aria-label="Cabin type">${CABINS.map(([c, l]) => `<option value="${c}"${st.cabin === c ? " selected" : ""}>${l}</option>`).join("")}</select>
      <select id="cp-occ" aria-label="Fare"><option value="twin"${st.occ === "twin" ? " selected" : ""}>Two sharing</option><option value="solo"${st.occ === "solo" ? " selected" : ""}>Solo (Fred. Olsen only)</option></select>
      <select id="cp-month" aria-label="Departure month"><option value="">Any month</option>${months.map(m => `<option value="${m}"${st.month === m ? " selected" : ""}>${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join("")}</select>
      <label><input type="checkbox" id="cp-nofly"${st.nofly ? " checked" : ""}> No-fly only</label>
      <select id="cp-sort" aria-label="Sort"><option value="date"${st.sort === "date" ? " selected" : ""}>By departure</option><option value="pn"${st.sort === "pn" ? " selected" : ""}>Cheapest per night</option><option value="chg"${st.sort === "chg" ? " selected" : ""}>Biggest drop this week</option></select>
      <button type="button" class="linkbtn" id="cp-csv">Download CSV</button>
    </div>
    ${list.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th><th>Departs</th><th class="num">Nights</th><th class="num">From pp</th><th class="num">Per night</th><th class="num">7 days</th><th class="num">Ambassador per night</th><th>Offers</th></tr></thead><tbody>
      ${list.map(({r, p, pn, chg, ours}) => `<tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title || r.code || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")} · ${esc(r.port || "")}${r.fly ? ' <span class="chip">fly</span>' : ""}</div></td>
        <td>${day(r.departure_date)}</td><td class="num">${r.nights || "–"}</td>
        <td class="num">${gbp(p.p)}${p.was ? `<div class="sub"><s>${gbp(p.was)}</s></div>` : ""}${p.fare ? `<div class="sub">${esc(p.fare)}</div>` : ""}</td>
        <td class="num">${pn ? gbp(pn) : "–"}</td>
        <td class="num">${chg == null ? "–" : `<span style="color:${chg < 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${chg < 0 ? "−" : "+"}${gbp(Math.abs(chg))}</span>`}</td>
        <td class="num">${ours ? `${gbp(ours.pn)}<div class="sub">${pn ? (d => d === 0 ? "same" : `we're ${Math.abs(d)}% ${d < 0 ? "cheaper" : "dearer"}`)(Math.round((ours.pn / pn - 1) * 100)) : ""}${ours.n > 1 ? ` · ${ours.n} sailings` : ""}</div>` : '<span class="sub">no match</span>'}</td>
        <td>${liveOffers(r).slice(0, 3).map(o => `<span class="chip" title="${esc(o)}" style="white-space:normal">${esc(o.length > 70 ? o.slice(0, 68) + "…" : o)}</span>`).join(" ") || "–"}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note">${list.length} sailing${list.length === 1 ? "" : "s"}. "Ambassador per night": our cheapest ${CABINS.find(c => c[0] === st.cabin)[1].toLowerCase()} per night on a sailing in the same month, within 3 nights' length, and the same no-fly/fly, from our own website.</p>`
      : `<div class="empty"><p>No sampled sailings match. The first days fill the sample (about a dozen new pages a line each day).</p></div>`}

    <h3 style="margin:22px 0 8px;font-size:15px">Offers</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Line</th><th>Offer</th><th class="num">Sailings</th><th>First seen</th></tr></thead><tbody>
      ${brand.filter(b => !b.ended).map(b => `<tr><td>${esc(lineName(b.line))}</td><td><a href="${esc(b.url)}" target="_blank" rel="noopener"><b>${esc(b.t)}</b></a>${b.text ? `<div class="sub">${esc(b.text)}</div>` : ""}</td><td class="num">brand-wide</td><td>${day(b.first_seen)}</td></tr>`).join("")}
      ${Object.values(agentOffers).sort((a, b) => b.n - a.n).map(o => `<tr><td>${esc(lineName(o.line))}</td><td style="white-space:normal">${esc(o.o)}</td><td class="num">${o.n}</td><td>${day(o.first)}</td></tr>`).join("")}
    </tbody></table></div>
    ${brand.some(b => b.ended) ? `<p class="note">Ended: ${brand.filter(b => b.ended).map(b => `${esc(b.t)} (${day(b.ended)})`).join(", ")}</p>` : ""}

    <h3 style="margin:22px 0 8px;font-size:15px">What changed (last 7 days)</h3>
    ${recent.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Line</th><th>Sailing</th><th>Change</th></tr></thead><tbody>
      ${recent.filter(c => c.kind !== "new").slice().reverse().slice(0, 200).map(c => { const r = (C.sailings || {})[c.id] || {};
        return `<tr><td>${day(c.date)}</td><td>${esc(lineName(c.line))}</td><td>${c.id ? `<a href="${esc(r.url || "#")}" target="_blank" rel="noopener">${esc(r.title || c.title || c.id)}</a>` : "Brand-wide"}</td><td>${esc(words(c))}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty"><p>Changes appear after the second daily check.</p></div>`}`;

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} };
  for (const [id, k] of [["cp-line", "line"], ["cp-cabin", "cabin"], ["cp-occ", "occ"], ["cp-month", "month"], ["cp-sort", "sort"]])
    el.querySelector("#" + id).addEventListener("change", e => { st[k] = e.target.value; save(); render(); });
  el.querySelector("#cp-nofly").addEventListener("change", e => { st.nofly = e.target.checked; save(); render(); });
  const csv = el.querySelector("#cp-csv");
  if (csv) csv.addEventListener("click", () => {
    const head = ["Line", "Sailing", "Ship", "Departs from", "Fly", "Departure date", "Nights", "Cabin", "Fare", "Price pp", "Was pp", "Per night", "Change 7 days", "Ambassador per night", "Offers", "Link", "Read"];
    const body = list.map(({r, p, pn, chg, ours}) => [lineName(r.line), r.title, r.ship, r.port, r.fly ? "yes" : "", r.departure_date, r.nights, st.occ + " " + st.cabin, p.fare, p.p, p.was, pn && Math.round(pn), chg, ours && Math.round(ours.pn), liveOffers(r).join("; "), r.url, r.checked_at]);
    const q = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(q).join(",")).join("\r\n")], {type: "text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `competitors-${st.cabin}-${C.updated || ""}.csv`; a.click();
  });
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

export async function mount(root, ctx){
  el = root; esc = ctx.esc;
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e){}
  el.innerHTML = `<p class="loading">Loading competitor prices…</p>`;
  try {
    [C, R] = await Promise.all([ctx.readJson("comp-current"), ctx.readJson("comp-runs").catch(() => ({runs: []}))]);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p>Competitor prices appear after the first daily check that reads them (the first check of a UK day).</p></div>`;
    return;
  }
  C.lines = C.lines || {fredolsen: "Fred. Olsen", po: "P&O Cruises", princess: "Princess Cruises", cunard: "Cunard", marella: "Marella Cruises",
    msc: "MSC Cruises", royal: "Royal Caribbean", celebrity: "Celebrity Cruises", ambassador: "Ambassador (at Planet Cruise)"};
  our = ourSailings(ctx.state, ctx.cabins || {});
  render();
}
