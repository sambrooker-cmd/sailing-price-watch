// Prices → Sailing demand, and the "Interest on the website" section of each sailing's detail view (Sam, 17 Oct 2026:
// "build the GA4 functionality and I will join them up later"). From ga4.py (pricewatch/ga4-demand): views of each
// sailing's page per day, views by channel and clicks through to the booking site, beside our own prices and
// promotions. Interest on the website is a stand-in for bookings, which the tracker can't see. UK only. Read-only.
import {lineChart, addDays} from "./comptrend.js?v=__BUILD__";

const KEY = "spw-demand";
const st = {q: "", month: "", fly: "", flag: "", sort: "v7", shown: 60};
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}"), {shown: 60}); } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({month: st.month, fly: st.fly, flag: st.flag, sort: st.sort})); } catch(e) {} };
let D, ctx, esc;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const n0 = v => v == null ? "–" : Math.round(v).toLocaleString("en-GB");
const gbp = v => v == null ? "–" : "£" + Math.round(v).toLocaleString("en-GB");
const sum = (a, i, j) => (a || []).slice(i, j).reduce((x, y) => x + y, 0);
const pctTxt = (a, b) => { if (!b) return a ? "new" : "–"; const p = Math.round((a / b - 1) * 100); return p ? `${p > 0 ? "+" : "−"}${Math.abs(p)}%` : "same"; };
const FLAGS = {rising: ["Rising interest", "ok"], falling: ["Interest falling", "warn"], lowclick: ["Interest, few booking clicks", "warn"], quiet: ["Quiet, departs soon", "warn"]};

async function load(c){
  if (D === undefined) D = await c.readJson("ga4-demand").catch(() => null);
  return D;
}
function setupNote(){
  return `<div class="empty"><p>${D && D.problem ? esc(D.problem) : "Google Analytics isn't connected yet."}</p>
    <p class="sub">One-off setup: Google Cloud console → promotions-planner → APIs &amp; Services → Library → <b>Google Analytics Data API</b> → Enable;
    GA4 → Admin → Property access management → add the tracker's <code>firebase-adminsdk-…@promotions-planner.iam.gserviceaccount.com</code> address as a <b>Viewer</b>;
    then the property's numeric ID (Admin → Property details) as the repo variable <b>GA4_PROPERTY_ID</b>. It's read at the next UK day's first check.</p></div>`;
}

// One row per sailing on sale: its interest figures and flags
function rows(){
  const S = ctx.state.sailings || {}, today = ctx.state.updated, out = [];
  const g = D.sailings || {}, n = D.days || 90;
  for (const [id, s] of Object.entries(S)) {
    if (s.removed || (s.departure_date || "") <= today) continue;
    const r = g[id] || {views: [], clicks: [0, 0], ch: {}, ev: {}}, v = r.views || [];
    const v7 = sum(v, n - 7, n), p7 = sum(v, n - 14, n - 7), v28 = sum(v, n - 28, n), p28 = sum(v, n - 56, n - 28);
    const ev = Object.values(r.ev || {}).reduce((a, x) => [a[0] + x[0], a[1] + x[1]], [0, 0]);
    const clicks = (r.clicks || [0, 0])[0] + ev[0];
    const top = Object.entries(r.ch || {}).sort((a, b) => b[1] - a[1])[0];
    const segs = s.segments || [], last = segs[segs.length - 1] || {};
    const moved = segs.filter(x => x.from > addDays(today, -28) && !x.mix && !x.switch && segs.indexOf(x) > 0);
    out.push({id, s, r, v7, p7, v28, p28, clicks, rate: v28 ? clicks / v28 : null, top: top ? top[0] : "", price: last.p,
      moved: moved.length ? moved[moved.length - 1] : null, flags: []});
  }
  // flags: rising / falling week on week; lots of interest but few clicks to book; quiet and departing within 120 days
  const rates = out.filter(x => x.v28 >= 100 && x.rate != null).map(x => x.rate).sort((a, b) => a - b);
  const medRate = rates.length ? rates[rates.length >> 1] : null;
  const views = out.map(x => x.v28).sort((a, b) => a - b), low = views[Math.floor(views.length * 0.2)] ?? 0;
  for (const x of out) {
    if (x.v7 >= 30 && x.v7 >= x.p7 * 1.4) x.flags.push("rising");
    if (x.p7 >= 30 && x.v7 <= x.p7 * 0.6) x.flags.push("falling");
    if (medRate && x.v28 >= 100 && x.rate < medRate * 0.5) x.flags.push("lowclick");
    if (x.s.departure_date <= addDays(ctx.state.updated, 120) && x.v28 <= low) x.flags.push("quiet");
  }
  return out;
}

function spark(v){
  if (!v || !v.some(Boolean)) return "";
  const w = [];   // weekly sums, oldest first
  for (let i = v.length % 7; i < v.length; i += 7) w.push(sum(v, i, i + 7));
  const mx = Math.max(...w, 1), W = 84, H = 20;
  const pts = w.map((y, i) => `${(i / Math.max(1, w.length - 1) * W).toFixed(1)},${(H - y / mx * H).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Weekly views"><polyline points="${pts}" fill="none" stroke="var(--heading)" stroke-width="1.5"/></svg>`;
}

export async function mount(el, c){
  ctx = c; esc = c.esc;
  if (D === undefined) el.innerHTML = `<p class="loading">Loading sailing demand…</p>`;
  await load(c);
  draw(el);
}

function draw(el){
  if (!D || !D.sailings) { el.innerHTML = setupNote(); return; }
  const all = rows(), today = ctx.state.updated;
  const months = [...new Set(all.map(x => x.s.departure_date.slice(0, 7)))].sort();
  const q = st.q.trim().toLowerCase();
  const list = all.filter(x => (!st.month || x.s.departure_date.slice(0, 7) === st.month) && (!st.fly || (st.fly === "fly") === !!x.s.flight_from)
      && (!st.flag || x.flags.includes(st.flag)) && (!q || `${x.id} ${x.s.base_title || x.s.title} ${x.s.port} ${x.s.flight_from || ""} ${x.s.ship}`.toLowerCase().includes(q)))
    .sort({v7: (a, b) => b.v7 - a.v7, change: (a, b) => (b.v7 - b.p7) - (a.v7 - a.p7), rate: (a, b) => (b.rate ?? -1) - (a.rate ?? -1),
           clicks: (a, b) => b.clicks - a.clicks, date: (a, b) => a.s.departure_date.localeCompare(b.s.departure_date)}[st.sort] || (() => 0));
  const T = k => all.reduce((a, x) => a + x[k], 0);
  const ch = {}; for (const x of all) for (const [k, v] of Object.entries(x.r.ch || {})) ch[k] = (ch[k] || 0) + v;
  const chs = Object.entries(ch).sort((a, b) => b[1] - a[1]), chT = chs.reduce((a, x) => a + x[1], 0);
  const clicksT = all.reduce((a, x) => a + x.clicks, 0), prevClicks = all.reduce((a, x) => a + (x.r.clicks || [0, 0])[1] + Object.values(x.r.ev || {}).reduce((s, e) => s + e[1], 0), 0);
  const counts = Object.fromEntries(Object.keys(FLAGS).map(k => [k, all.filter(x => x.flags.includes(k)).length]));
  const tiles = [["Sailing page views, last 7 days", n0(T("v7")), pctTxt(T("v7"), T("p7")) + " on the week before"],
    ["Views, last 28 days", n0(T("v28")), pctTxt(T("v28"), T("p28")) + " on the 28 before"],
    ["Clicks to the booking site, 28 days", n0(clicksT), pctTxt(clicksT, prevClicks) + " on the 28 before"],
    ["Biggest channel, 28 days", chs[0] ? esc(chs[0][0]) : "–", chs[0] ? `${Math.round(chs[0][1] / chT * 100)}% of views` : ""]]
    .map(([l, v, s]) => `<div class="cw-tile"><span class="cw-l">${l}</span><b>${v}</b><span class="sub">${s}</span></div>`).join("");
  const shown = list.slice(0, st.shown);
  el.innerHTML = `<p class="note" style="margin:0 0 12px">From Google Analytics (property ${esc(D.property)}), read ${esc(day(D.read_on))}: views of each sailing's page on ambassadorcruiseline.com up to ${esc(day(D.end))}, and clicks from it to the booking site. Interest on the website, not bookings: a guide to where attention is going. The Manchester version of a fly-cruise (…M) has its own page and its own figures.</p>
    <div class="cw-tiles">${tiles}</div>
    ${chs.length ? `<p class="sub" style="margin:8px 0 0">Views by channel, 28 days: ${chs.slice(0, 6).map(([k, v]) => `${esc(k)} ${Math.round(v / chT * 100)}%`).join(" · ")}</p>` : ""}
    <h3 style="margin:22px 0 8px;font-size:15px">Every sailing on sale</h3>
    <div class="controls">
      <input type="search" id="dm-q" placeholder="Search name, port or code" value="${esc(st.q)}" aria-label="Search">
      <select id="dm-month" aria-label="Departure month"><option value="">Any month</option>${months.map(m => `<option value="${m}"${st.month === m ? " selected" : ""}>${MON[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join("")}</select>
      <select id="dm-fly" aria-label="No-fly or fly"><option value="">No-fly and fly-cruises</option><option value="nofly"${st.fly === "nofly" ? " selected" : ""}>No-fly</option><option value="fly"${st.fly === "fly" ? " selected" : ""}>Fly-cruises</option></select>
      <select id="dm-flag" aria-label="Flag"><option value="">Every sailing</option>${Object.entries(FLAGS).map(([k, [l]]) => `<option value="${k}"${st.flag === k ? " selected" : ""}>${l} (${counts[k]})</option>`).join("")}</select>
      <select id="dm-sort" aria-label="Sort">${[["v7", "Most viewed this week"], ["change", "Biggest rise this week"], ["clicks", "Most booking clicks"], ["rate", "Best click rate"], ["date", "Departure date"]].map(([k, l]) => `<option value="${k}"${st.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      <button type="button" class="linkbtn" id="dm-csv">Download CSV</button>
    </div>
    ${shown.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th><th class="num">From pp</th><th class="num">Views 7 days</th><th class="num">Views 28 days</th><th>13 weeks</th><th class="num">Booking clicks 28 days</th><th class="num">Click rate</th><th>Top channel</th></tr></thead><tbody>
      ${shown.map(x => `<tr><td style="white-space:normal"><a href="#${esc(x.id)}"><b>${esc(x.s.base_title || x.s.title)}</b></a><div class="sub">${esc(x.id)} · ${day(x.s.departure_date)} · ${x.s.nights} nights · ${esc(x.s.flight_from ? x.s.flight_from + " (fly)" : x.s.port)}</div>
          ${x.flags.length ? `<div>${x.flags.map(f => `<span class="chip" style="font-weight:500;${FLAGS[f][1] === "warn" ? "border-color:var(--warn);color:var(--warn)" : "border-color:var(--ok,#1a7f26);color:var(--ok,#1a7f26)"}">${FLAGS[f][0]}</span>`).join(" ")}</div>` : ""}</td>
        <td class="num">${gbp(x.price)}${x.moved ? `<div class="sub">changed ${day(x.moved.from)}</div>` : ""}</td>
        <td class="num"><b>${n0(x.v7)}</b><div class="sub">${pctTxt(x.v7, x.p7)}</div></td><td class="num">${n0(x.v28)}<div class="sub">${pctTxt(x.v28, x.p28)}</div></td>
        <td>${spark(x.r.views)}</td><td class="num">${n0(x.clicks)}</td><td class="num">${x.rate == null ? "–" : (x.rate * 100).toFixed(1) + "%"}</td><td>${esc(x.top)}</td></tr>`).join("")}
      </tbody></table></div>
      ${list.length > st.shown ? `<button type="button" class="linkbtn" id="dm-more">Show more (${list.length - st.shown})</button>` : ""}`
      : `<div class="empty"><p>No sailings match.</p></div>`}
    <p class="note"><b>Rising</b>: 40% more views than the week before (30+ views). <b>Falling</b>: 40% fewer. <b>Interest, few booking clicks</b>: 100+ views in 28 days but under half the usual click rate to the booking site (price, offer or page worth a look). <b>Quiet, departs soon</b>: among the least viewed fifth and departing within 120 days. Click a sailing for its daily views against its price changes.</p>
    <details style="margin-top:12px"><summary class="sub">Which GA4 events count as booking clicks</summary>
      <p class="sub">Counted now: GA4's outbound clicks to <b>${esc(D.booking_domain || "")}</b>${(D.booking_events || []).length ? ` plus ${D.booking_events.map(esc).join(", ")}` : ""}. If the booking site is set up in GA4 as the same site (cross-domain), outbound clicks aren't recorded and this shows nothing: then name the right events in the repo variable <b>GA4_BOOKING_EVENTS</b> (comma-separated). The site's most common events, last 28 days:</p>
      <p class="sub">${(D.events_seen || []).slice(0, 30).map(([e, n]) => `${esc(e)} (${n0(n)})`).join(" · ") || "–"}</p></details>`;
  const re = () => draw(el);
  const q2 = el.querySelector("#dm-q");
  q2.addEventListener("input", () => { st.q = q2.value; clearTimeout(q2._t); q2._t = setTimeout(() => { re(); const n = el.querySelector("#dm-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  for (const [id, k] of [["#dm-month", "month"], ["#dm-fly", "fly"], ["#dm-flag", "flag"], ["#dm-sort", "sort"]])
    el.querySelector(id).addEventListener("change", e => { st[k] = e.target.value; st.shown = 60; save(); re(); });
  const more = el.querySelector("#dm-more"); more && more.addEventListener("click", () => { st.shown += 60; re(); });
  el.querySelector("#dm-csv").addEventListener("click", () => {
    const qv = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const head = ["Cruise code", "Sailing", "Departs", "Nights", "From", "From pp", "Price changed", "Views 7 days", "Views previous 7", "Views 28 days", "Views previous 28", "Booking clicks 28 days", "Click rate", "Top channel", "Flags"];
    const body = list.map(x => [x.id, x.s.base_title || x.s.title, x.s.departure_date, x.s.nights, x.s.flight_from || x.s.port, x.price, x.moved ? x.moved.from : "", x.v7, x.p7, x.v28, x.p28, x.clicks,
      x.rate == null ? "" : (x.rate * 100).toFixed(1) + "%", x.top, x.flags.map(f => FLAGS[f][0]).join("; ")]);
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(qv).join(",")).join("\r\n")], {type: "text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sailing-demand-${today}.csv`; a.click();
  });
}

// Detail view: daily views over 90 days, and what happened to views after each price change or new promotion
export async function mountDetail(el, c, id){
  ctx = c; esc = c.esc;
  await load(c);
  if (!D || !D.sailings) { el.innerHTML = `<p class="sub">${D && D.problem ? esc(D.problem) : "Google Analytics isn't connected yet (Prices → Sailing demand says how)."}</p>`; return; }
  const r = D.sailings[id], s = ctx.state.sailings[id] || {};
  if (!r || !(r.views || []).some(Boolean)) { el.innerHTML = `<p class="sub">No views of this sailing's page in the last ${D.days} days.</p>`; return; }
  const days = r.views.map((_, i) => addDays(D.start, i)), v = r.views;
  const ch = lineChart([{name: "Views a day", color: "var(--heading)", bold: true, pts: days.map((d, i) => [d, v[i]])}], {fmt: n0, esc, label: "Views of this sailing's page a day", zero: true});
  // events in the window: price changes (not a cheaper grade coming on sale) and promotions starting or ending
  const evs = [];
  const segs = s.segments || [];
  segs.forEach((x, i) => { if (i && x.from >= days[0] && !x.mix && !x.switch && segs[i - 1].p != null && x.p != null && x.p !== segs[i - 1].p)
    evs.push({d: x.from, t: `From price ${gbp(segs[i - 1].p)} → ${gbp(x.p)}`}); });
  const offers = ctx.state.offers || {};
  // promotions were first recorded on one day (12 Oct 2026): those already running then didn't "start" that day
  const recStart = Object.values(ctx.state.sailings || {}).flatMap(x => Object.values(x.promos || {}).map(sp => (sp[0] || [])[0])).filter(Boolean).sort()[0];
  for (const [oid, spans] of Object.entries(s.promos || {})) for (const [f, to] of spans) {
    if (f >= days[0] && f > recStart) evs.push({d: f, t: `${(offers[oid] || {}).name || "Promotion"} started`});
    if (to && to >= days[0]) evs.push({d: to, t: `${(offers[oid] || {}).name || "Promotion"} ended`});
  }
  const at = d => days.indexOf(d);
  const around = d => { const i = at(d); if (i < 0) return null; const b = sum(v, Math.max(0, i - 7), i), a = sum(v, i, Math.min(v.length, i + 7)), full = i + 7 <= v.length && i >= 7; return {b, a, full}; };
  const ch28 = Object.entries(r.ch || {}).sort((a, b) => b[1] - a[1]), t28 = ch28.reduce((a, x) => a + x[1], 0);
  el.innerHTML = `${ch.html}
    <p class="sub">${n0(sum(v, v.length - 7, v.length))} views in the last 7 days · ${n0(sum(v, v.length - 28, v.length))} in 28 · ${n0((r.clicks || [0])[0])} clicks to the booking site in 28 days${ch28.length ? ` · ${ch28.slice(0, 4).map(([k, n]) => `${esc(k)} ${Math.round(n / t28 * 100)}%`).join(", ")}` : ""}</p>
    ${evs.length ? `<table class="ptable" style="margin-top:8px"><thead><tr><th>Date</th><th>What changed</th><th class="num">Views 7 days before</th><th class="num">7 days after</th></tr></thead><tbody>
      ${evs.sort((a, b) => a.d.localeCompare(b.d)).map(e => { const x = around(e.d); return `<tr><td>${day(e.d)}</td><td>${esc(e.t)}</td><td class="num">${x ? n0(x.b) : "–"}</td><td class="num">${x ? `${n0(x.a)}${x.full ? ` <span class="sub">(${pctTxt(x.a, x.b)})</span>` : ` <span class="sub">(so far)</span>` }` : "–"}</td></tr>`; }).join("")}</tbody></table>
      <p class="note">Views go up and down for many reasons (emails, ads, season), so a change after a price move is a hint, not proof.</p>` : ""}`;
  ch.wire(el);
}
