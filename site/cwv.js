// SEO → Core Web Vitals (Sam, 17 Oct 2026: "a core web vitals checker and competitor analysis tool"). Data from
// seo_cwv.py (pricewatch/seo-cwv), read once a day with Google's free PageSpeed Insights and Chrome UX Report APIs:
// real visitors' figures (75th percentile of the last 28 days of Chrome visits: what Google ranks with) for our site and
// the competitors', ~6 months of weekly history, and a lab test of a set of our pages with what's slowing each down.
import {lineChart} from "./comptrend.js?v=__BUILD__";

const KEY = "spw-cwv";
const LABEL = {lcp: "Loading (LCP)", inp: "Responsiveness (INP)", cls: "Visual stability (CLS)", ttfb: "Server response (TTFB)"};
const WHAT = {lcp: "how long until the main picture or text has shown", inp: "how quickly the page reacts to a tap or click",
  cls: "how much things jump about while loading", ttfb: "how long the server takes to start answering"};
const GOOD = {lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], ttfb: [800, 1800]};
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];
const fmtV = (m, v) => v == null ? "–" : m === "cls" ? Number(v).toFixed(2) : m === "lcp" ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
const rate = (m, v) => v == null ? "" : v <= GOOD[m][0] ? "good" : v > GOOD[m][1] ? "poor" : "ni";
const RATE = {good: "Good", ni: "Needs improvement", poor: "Poor"};
const passes = f => f && ["lcp", "inp", "cls"].every(m => rate(m, f[m]) === "good");
const scoreRate = s => s == null ? "" : s >= 90 ? "good" : s >= 50 ? "ni" : "poor";
let root, ctx, D = null, st = {form: "phone", metric: "lcp", open: {}};
try { st = {...st, ...JSON.parse(localStorage.getItem(KEY) || "{}"), open: {}}; } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({form: st.form, metric: st.metric})); } catch(e) {} };

export async function mount(el, c){
  root = el; ctx = c;
  if (!D) {
    root.innerHTML = `<p class="loading">Loading Core Web Vitals…</p>`;
    try { D = (await c.readJson("seo-cwv")) || {}; } catch(e) { D = {}; }
  }
  draw();
}

function chip(m, v){
  const r = rate(m, v);
  return `<span class="cw-v ${r}">${fmtV(m, v)}</span>`;
}

function draw(){
  const esc = ctx.esc;
  if (!D || !(D.sites || []).length) {
    root.innerHTML = `<div class="empty"><p>${D && D.problem ? esc(D.problem) : "No Core Web Vitals yet."}</p>
      <p class="sub">It needs a free Google API key in the repo secret <b>PAGESPEED_API_KEY</b> (Google Cloud console → promotions-planner → APIs &amp; Services: enable "PageSpeed Insights API" and "Chrome UX Report API", then Credentials → Create credentials → API key, restricted to those two APIs). The check then runs once a day.</p></div>`;
    return;
  }
  const f = st.form, ours = D.sites.find(s => s.name === "Ambassador") || {}, now = ours[f] || {};
  const tiles = ["lcp", "inp", "cls", "ttfb"].map(m => `<div class="cw-tile ${rate(m, now[m])}"><span class="cw-l">${LABEL[m]}</span>
    <b>${fmtV(m, now[m])}</b><span class="cw-r">${RATE[rate(m, now[m])] || "No data"}</span><span class="sub">${WHAT[m]}</span></div>`).join("");
  const comp = D.sites.slice().sort((a, b) => (b.name === "Ambassador") - (a.name === "Ambassador") || (passes(b[f]) - passes(a[f])) || ((a[f] || {}).lcp ?? 1e9) - ((b[f] || {}).lcp ?? 1e9));
  const rank = m => { const vs = D.sites.map(s => (s[f] || {})[m]).filter(v => v != null).sort((a, b) => a - b); const v = now[m]; return v == null ? "" : `${vs.indexOf(v) + 1} of ${vs.length}`; };
  // history chart for the chosen metric
  const series = D.sites.map((s, i) => {
    const h = s[f + "_hist"] || {}, weeks = h.weeks || [], vals = h[st.metric] || [];
    return {name: s.name, bold: s.name === "Ambassador", color: s.name === "Ambassador" ? "var(--heading)" : COLORS[(i - 1) % COLORS.length], dash: i > COLORS.length,
            pts: weeks.map((w, k) => [w, vals[k]]).filter(p => p[1] != null)};
  });
  const ch = lineChart(series, {fmt: v => fmtV(st.metric, v), esc, label: `${LABEL[st.metric]} over time`, empty: "No history from Google yet."});
  const pages = (D.pages || []).slice().sort((a, b) => ((a[f === "phone" ? "mobile" : "desktop"] || {}).score ?? 101) - ((b[f === "phone" ? "mobile" : "desktop"] || {}).score ?? 101));
  const lab = f === "phone" ? "mobile" : "desktop";
  const hist = D.lab_history || {}, days = Object.keys(hist).sort();
  const spark = url => {
    const vs = days.map(d => (hist[d][url] || [])[lab === "mobile" ? 0 : 1]).filter(v => v != null);
    if (vs.length < 2) return "";
    const w = 60, h = 18, pts = vs.map((v, i) => `${(i / (vs.length - 1) * w).toFixed(1)},${(h - v / 100 * h).toFixed(1)}`).join(" ");
    return `<svg class="cw-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="Score over ${vs.length} days"><polyline points="${pts}" fill="none" stroke="var(--heading)" stroke-width="1.5"/></svg>`;
  };
  const path = u => u.replace(/^https?:\/\/[^/]+/, "") || "/";
  root.innerHTML = `
    <div class="cw-bar"><div class="seg" role="group" aria-label="Device">${[["phone", "Phones"], ["desktop", "Desktop"]].map(([k, t]) => `<button type="button" data-form="${k}" aria-pressed="${f === k}">${t}</button>`).join("")}</div>
      <span class="sub">Read ${esc(new Date(D.fetched_at || D.read_on).toLocaleString("en-GB", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"}))} from Google's PageSpeed Insights and Chrome UX Report.</span></div>
    ${D.problem ? `<p class="note">Some figures couldn't be read: ${esc(D.problem)}</p>` : ""}
    <h3>ambassadorcruiseline.com: real visitors <span class="cw-pass ${passes(now) ? "good" : "poor"}">${passes(now) ? "Passes Core Web Vitals" : "Doesn't pass Core Web Vitals"}</span></h3>
    <p class="sub">The 75th percentile of real Chrome visits on ${f === "phone" ? "phones" : "desktops"} over the last 28 days: the figures Google uses in its rankings. To pass, loading, responsiveness and stability all need to be good.</p>
    <div class="cw-tiles">${tiles}</div>

    <h3>Against the competitors</h3>
    <p class="sub">The same real-visitor figures for each site as a whole, from Google's public Chrome UX Report (nothing is read from their sites). Marella's are all of tui.co.uk. Where we rank: loading ${rank("lcp")}, responsiveness ${rank("inp")}, stability ${rank("cls")} (1 = best).</p>
    <div class="tablewrap"><table class="ptable cw-t"><thead><tr><th>Site</th><th class="num">Loading</th><th class="num">Responsiveness</th><th class="num">Stability</th><th class="num">Server</th><th>Passes?</th></tr></thead><tbody>
      ${comp.map(s => { const v = s[f]; return `<tr class="${s.name === "Ambassador" ? "cw-us" : ""}"><td><b>${esc(s.name)}</b><div class="sub">${esc(s.origin.replace(/^https?:\/\//, ""))}</div></td>
        ${v ? ["lcp", "inp", "cls", "ttfb"].map(m => `<td class="num">${chip(m, v[m])}</td>`).join("") + `<td>${passes(v) ? `<span class="cw-pass good">Yes</span>` : `<span class="cw-pass poor">No</span>`}</td>`
          : `<td colspan="5" class="sub">Google doesn't have enough Chrome visits to report this site.</td>`}</tr>`; }).join("")}</tbody></table></div>

    <h3>Over time</h3>
    <div class="cw-bar"><div class="seg" role="group" aria-label="Metric">${["lcp", "inp", "cls", "ttfb"].map(m => `<button type="button" data-metric="${m}" aria-pressed="${st.metric === m}">${LABEL[m].split(" (")[0]}</button>`).join("")}</div>
      <span class="sub">Weekly, each point the 28 days to that date. Lower is better. Good is ${fmtV(st.metric, GOOD[st.metric][0])} or less.</span></div>
    ${ch.html}

    <h3>Our pages: lab test</h3>
    <p class="sub">Google's Lighthouse test of one or two pages of each type, run once a day on a simulated ${f === "phone" ? "mid-range phone on a 4G connection" : "desktop"}. The score is out of 100 (90+ good, under 50 poor); it moves a few points from day to day on its own. "Real visitors" is the page's own Chrome figure when Google has enough visits to it, else the whole site's. Worst first; click a row for what would help.</p>
    <div class="tablewrap"><table class="ptable cw-t"><thead><tr><th>Page</th><th class="num">Score</th><th class="num">Loading</th><th class="num">Blocking</th><th class="num">Stability</th><th class="num">Real visitors (loading)</th><th>Biggest fix</th></tr></thead><tbody>
      ${pages.map((p, i) => { const r = p[lab] || {}; const o = (r.opps || [])[0]; return `<tr class="cw-row" data-row="${i}">
        <td><b>${esc(p.type)}</b> <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(path(p.url))}</a><div class="sub">${esc(p.label || "")}</div></td>
        <td class="num">${r.error ? `<span class="sub" title="${esc(r.error)}">failed</span>` : `<span class="cw-score ${scoreRate(r.score)}">${r.score ?? "–"}</span>${spark(p.url)}`}</td>
        <td class="num">${chip("lcp", r.lcp)}</td><td class="num">${r.tbt != null ? `${Math.round(r.tbt)} ms` : "–"}</td><td class="num">${chip("cls", r.cls)}</td>
        <td class="num">${r.field && r.field.lcp != null ? `${chip("lcp", r.field.lcp)}<div class="sub">${r.field_src === "page" ? "this page" : "whole site"}</div>` : "–"}</td>
        <td>${o ? `${esc(o.t)} <span class="sub">saves ~${(o.ms / 1000).toFixed(1)} s</span>` : `<span class="sub">nothing big</span>`}</td></tr>
        ${st.open[i] ? `<tr class="cw-more"><td colspan="7">${(r.opps || []).length ? `<ul>${r.opps.map(x => `<li>${esc(x.t)}: about ${(x.ms / 1000).toFixed(1)} s</li>`).join("")}</ul>` : "No big savings found."}
          <span class="sub">First paint ${fmtV("lcp", r.fcp)} · speed index ${fmtV("lcp", r.si)} · <a href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(p.url)}" target="_blank" rel="noopener">full report on PageSpeed Insights</a></span></td></tr>` : ""}`; }).join("")}</tbody></table></div>`;
  ch.wire(root);
  root.querySelectorAll("[data-form]").forEach(b => b.addEventListener("click", () => { st.form = b.dataset.form; save(); draw(); }));
  root.querySelectorAll("[data-metric]").forEach(b => b.addEventListener("click", () => { st.metric = b.dataset.metric; save(); draw(); }));
  root.querySelectorAll(".cw-row").forEach(r => r.addEventListener("click", e => { if (e.target.closest("a")) return; const i = r.dataset.row; st.open[i] = !st.open[i]; draw(); }));
}
