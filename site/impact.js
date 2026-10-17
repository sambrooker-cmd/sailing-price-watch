// Prices → What moved interest (Sam, 17 Oct 2026: point 2 of the new ideas, "what price moves and offers actually did").
// From impact.py (pricewatch/ga4-impact): each price cut or rise and each offer starting or ending, with the interest in
// that sailing's page in the 7 days before and after, against similar sailings that didn't change over the same days.
// Summary by kind of change and an event list. Interest on the website, not bookings. UK only. Read-only.
const KEY = "spw-impact";
const st = {kind: "", flagged: false, q: "", shown: 60};
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}"), {shown: 60}); } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({kind: st.kind, flagged: st.flagged})); } catch(e) {} };
let I, G, ctx, esc;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const n0 = v => v == null ? "–" : Math.round(v).toLocaleString("en-GB");
const pc = v => v == null ? "–" : `<span style="color:${v >= 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%</span>`;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const KIND = {price_cut: "Price cut", price_rise: "Price rise", offer_start: "Offer started", offer_end: "Offer ended"};
const TYPE = {obc: "onboard credit", discount: "discount", deposit: "low deposit", extras: "free extras", loyalty: "past guests", people: "solo, children, family", travel: "transfers and flights", urgency: "flash, late or launch"};
const FLAG = {mixed: "another change within 7 days", thin: "under 20 views the week before", few_controls: "too few similar sailings to compare"};

export async function mount(el, c){
  ctx = c; esc = c.esc;
  if (I === undefined) {
    el.innerHTML = `<p class="loading">Loading…</p>`;
    [I, G] = await Promise.all([c.readJson("ga4-impact").catch(() => null), c.readJson("ga4-demand").catch(() => null)]);
  }
  draw(el);
}

// Rows of the summary: each kind, price changes by size, offers by type
function groups(evs){
  const by = (label, f, sub) => ({label, sub, xs: evs.filter(f)});
  const cut = e => e.kind === "price_cut", start = e => e.kind === "offer_start";
  const types = [...new Set(evs.filter(start).flatMap(e => e.types || []))];
  return [
    by("Price cuts", cut), by("under 5% off", e => cut(e) && e.pct > -5, true), by("5–10% off", e => cut(e) && e.pct <= -5 && e.pct > -10, true), by("over 10% off", e => cut(e) && e.pct <= -10, true),
    by("Price rises", e => e.kind === "price_rise"),
    by("Offers started", start), ...types.map(t => by(TYPE[t] || t, e => start(e) && (e.types || []).includes(t), true)),
    by("Offers ended", e => e.kind === "offer_end"),
  ].filter(g => g.xs.length);
}
function verdict(xs){
  const l = xs.map(e => e.lift).filter(v => v != null), m = median(l);
  if (l.length < 5) return `<span class="sub">Too few so far (${l.length})</span>`;
  const up = l.filter(v => v > 0).length / l.length;
  if (m >= 0.1 && up >= 0.6) return `<b style="color:var(--ok, #1a7f26)">More interest</b>`;
  if (m <= -0.1 && up <= 0.4) return `<b style="color:var(--warn)">Less interest</b>`;
  return `<span>No clear effect</span>`;
}
function dots(xs){
  const W = 220, H = 22, lo = -1, hi = 2, x = v => (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * W;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Each change's lift"><line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H}" stroke="var(--muted)"/>
    ${xs.filter(e => e.lift != null).map((e, i) => `<circle cx="${x(e.lift).toFixed(1)}" cy="${(4 + (i * 7) % (H - 8)).toFixed(1)}" r="3" fill="${e.lift >= 0 ? "var(--c3)" : "var(--c2)"}" opacity=".7"><title>${esc(`${e.id} ${day(e.d)}: ${Math.round(e.lift * 100)}%`)}</title></circle>`).join("")}</svg>`;
}

function draw(el){
  if (!G || !G.sailings) {
    el.innerHTML = `<div class="empty"><p>${G && G.problem ? esc(G.problem) : "Google Analytics isn't connected yet."}</p><p class="sub">This page compares interest before and after each price move and offer, so it needs GA4 first: see Prices → Sailing demand for the one-off setup. Changes since tracking began on 8 Oct 2026 are scored as soon as GA4's figures cover them.</p></div>`;
    return;
  }
  const all = Object.values((I && I.events) || {}).sort((a, b) => b.d.localeCompare(a.d) || a.id.localeCompare(b.id));
  const clean = all.filter(e => !e.flags.length && e.lift != null);
  const S = ctx.state.sailings || {};
  const g = groups(clean);
  const q = st.q.trim().toLowerCase();
  const list = all.filter(e => (!st.kind || e.kind === st.kind) && (st.flagged || !e.flags.length) && (!q || `${e.id} ${e.detail} ${(S[e.id] || {}).base_title || ""}`.toLowerCase().includes(q)));
  const shown = list.slice(0, st.shown);
  el.innerHTML = `<p class="note" style="margin:0 0 12px">For every price cut or rise and every offer that started or ended on a sailing, the views of its page in the 7 days before and the 7 days after (GA4), against <b>similar sailings that didn't change</b> over the same days (same no-fly / fly-cruise, departing within 3 months of it). <b>Lift</b> is how much more (or less) its interest moved than theirs, so seasonal swings, emails and ads that hit every sailing cancel out. Interest on the website, not bookings. A change is scored once its 7 days after are complete; scored changes are kept for good, so this gets more reliable every week.</p>
    ${!all.length ? `<div class="empty"><p>Nothing scored yet: the first results appear once a change has 7 full days of GA4 figures after it.</p></div>` : `
    <h3 style="margin:12px 0 8px;font-size:15px">What each kind of change did</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Change</th><th class="num">Changes scored</th><th class="num">Typical lift in views</th><th class="num">Rose more than similar sailings</th><th class="num">Typical lift in booking clicks</th><th>Each change</th><th>So far</th></tr></thead><tbody>
      ${g.map(x => { const l = x.xs.map(e => e.lift), c = x.xs.map(e => e.lift_c).filter(v => v != null);
        return `<tr${x.sub ? "" : ' style="font-weight:600"'}><td${x.sub ? ' style="padding-left:28px"' : ""}>${esc(x.label)}</td><td class="num">${l.length}</td><td class="num">${pc(median(l))}</td>
          <td class="num">${Math.round(l.filter(v => v > 0).length / l.length * 100)}%</td><td class="num">${c.length ? `${pc(median(c))} <span class="sub">(${c.length})</span>` : "–"}</td><td>${dots(x.xs)}</td><td>${verdict(x.xs)}</td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="note">"Typical" is the median. Dots run from −100% (left) to +200% (right), the line is no difference. "More interest" or "Less interest" needs at least 5 changes, a typical lift of 10% or more, and most changes going the same way. ${all.length - clean.length} change${all.length - clean.length === 1 ? " is" : "s are"} left out of the summary: another change within 7 days, under 20 views the week before, or too few similar sailings (see "Show flagged" below). A cheaper cabin grade coming on sale isn't a price cut and isn't counted.</p>`}
    <h3 style="margin:22px 0 8px;font-size:15px">Every change</h3>
    <div class="controls">
      <input type="search" id="im-q" placeholder="Search sailing, code or offer" value="${esc(st.q)}" aria-label="Search">
      <select id="im-kind" aria-label="Kind"><option value="">Every kind</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${st.kind === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      <label class="sub"><input type="checkbox" id="im-flag"${st.flagged ? " checked" : ""}> Show flagged</label>
      <button type="button" class="linkbtn" id="im-csv">Download CSV</button><span class="sub">${list.length} change${list.length === 1 ? "" : "s"}</span>
    </div>
    ${shown.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Sailing</th><th>What changed</th><th class="num">Views 7 days before → after</th><th class="num">Similar sailings</th><th class="num">Lift</th><th class="num">Booking clicks before → after</th><th class="num">Click lift</th></tr></thead><tbody>
      ${shown.map(e => { const s = S[e.id] || {}; return `<tr><td>${day(e.d)}</td><td style="white-space:normal"><a href="#${esc(e.id)}"><b>${esc(s.base_title || s.title || e.id)}</b></a><div class="sub">${esc(e.id)}${s.departure_date ? ` · departs ${day(s.departure_date)}` : ""}</div></td>
        <td style="white-space:normal">${KIND[e.kind]}: ${esc(e.detail)}${e.pct != null ? ` <span class="sub">(${e.pct > 0 ? "+" : ""}${e.pct}%)</span>` : ""}${e.flags.length ? `<div class="sub" style="color:var(--warn)">${e.flags.map(f => FLAG[f] || f).join("; ")}</div>` : ""}</td>
        <td class="num">${n0(e.before)} → ${n0(e.after)}</td><td class="num">${pc(e.ctrl)} <span class="sub">(${e.ctrl_n})</span></td><td class="num"><b>${pc(e.lift)}</b></td>
        <td class="num">${e.cb == null ? "–" : `${n0(e.cb)} → ${n0(e.ca)}`}</td><td class="num">${pc(e.lift_c)}</td></tr>`; }).join("")}
    </tbody></table></div>${list.length > st.shown ? `<button type="button" class="linkbtn" id="im-more">Show more (${list.length - st.shown})</button>` : ""}`
    : `<div class="empty"><p>No changes match.</p></div>`}
    <p class="note">Views go up and down for many reasons, so one change proves little; the summary across many changes is the evidence. "Similar sailings" shows how much their interest moved over the same two weeks, and how many there were.</p>`;
  const re = () => draw(el);
  const qi = el.querySelector("#im-q");
  qi.addEventListener("input", () => { st.q = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { re(); const n = el.querySelector("#im-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  el.querySelector("#im-kind").addEventListener("change", e => { st.kind = e.target.value; st.shown = 60; save(); re(); });
  el.querySelector("#im-flag").addEventListener("change", e => { st.flagged = e.target.checked; st.shown = 60; save(); re(); });
  const more = el.querySelector("#im-more"); more && more.addEventListener("click", () => { st.shown += 60; re(); });
  el.querySelector("#im-csv").addEventListener("click", () => {
    const qv = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const head = ["Date", "Cruise code", "Sailing", "Change", "Detail", "Price change %", "Offer types", "Views before", "Views after", "Similar sailings", "Similar sailings' change", "Lift", "Booking clicks before", "Booking clicks after", "Similar sailings' click change", "Click lift", "Flags"];
    const body = list.map(e => [e.d, e.id, (S[e.id] || {}).base_title || "", KIND[e.kind], e.detail, e.pct ?? "", (e.types || []).map(t => TYPE[t] || t).join("; "), e.before, e.after, e.ctrl_n,
      e.ctrl == null ? "" : Math.round(e.ctrl * 100) + "%", e.lift == null ? "" : Math.round(e.lift * 100) + "%", e.cb ?? "", e.ca ?? "", e.ctrl_c == null ? "" : Math.round(e.ctrl_c * 100) + "%",
      e.lift_c == null ? "" : Math.round(e.lift_c * 100) + "%", e.flags.map(f => FLAG[f] || f).join("; ")]);
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(qv).join(",")).join("\r\n")], {type: "text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `what-moved-interest-${(I && I.updated) || ""}.csv`; a.click();
  });
}
