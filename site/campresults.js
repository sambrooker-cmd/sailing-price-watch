// Creative → Campaign results (Sam, 17 Oct 2026: point 5 of the ideas, "build 5, but also include spend by sailing
// estimated from both sailing carousel card clicks but also estimated spend from page views driven from the ads to each
// sailing"). Pick a saved Campaign builder brief (or any dates): its sailings (the brief's rule or codes, on its first day),
// their page views and booking clicks during the campaign against the same number of days before, compared with similar
// sailings that weren't in it (impact.py's method: same no-fly / fly-cruise, departing within 3 months); and Meta spend by
// sailing from ad_spend.py (pricewatch/meta-spend), two estimates side by side: by carousel card clicks and by page views in
// visits from the ads, with views from the ads, cost per view and per booking click. Interest on the website, not bookings;
// spend by sailing is an estimate. UK only. Read-only.
import {sharedStore} from "./saved.js?v=__BUILD__";
import {sailingsFor} from "./campaign.js?v=__BUILD__";
import {lineChart, dayList, addDays} from "./comptrend.js?v=__BUILD__";

const KEY = "spw-campresults";
const st = {pick: "", from: "", to: "", camps: null, scope: "campaign", shown: 40};
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}"), {shown: 40}); } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({pick: st.pick, from: st.from, to: st.to, camps: st.camps, scope: st.scope})); } catch(e) {} };
let ctx, esc, root, S, KIT, SP, G, store;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const n0 = v => v == null ? "–" : Math.round(v).toLocaleString("en-GB");
const gbp = v => v == null ? "–" : "£" + Math.round(v).toLocaleString("en-GB");
const gbp2 = v => v == null || !isFinite(v) ? "–" : "£" + v.toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pc = v => v == null ? "–" : `<span style="color:${v >= 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 100))}%</span>`;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const ratio = (a, b) => Math.log((a + 1) / (b + 1));
const SPECIAL = {_cards: "Opening and closing cards", _nolink: "Ads with no sailing link", _other: "Other pages of the website", _noviews: "Ads with no visits recorded that day", _unplaced: "Couldn't be placed (no matching visits)"};
const WINDOW_CTRL = 90, MIN_BEFORE = 20, MIN_CLICKS = 10, MIN_CONTROLS = 3;

export async function mount(el, c){
  ctx = c; esc = c.esc; root = el; S = c.state;
  if (SP === undefined) {
    el.innerHTML = `<p class="loading">Loading…</p>`;
    [SP, G, KIT] = await Promise.all([c.readJson("meta-spend").catch(() => null), c.readJson("ga4-demand").catch(() => null), c.getAdkit().catch(() => null)]);
    store = sharedStore({kind: "campaign", localKey: "spw-campaigns-saved", field: "brief", idToken: c.idToken});
    store.load().then(() => draw());
  }
  draw();
}

// ---------- the figures ----------
const metaOn = () => SP && SP.rows && !SP.problem;
const ga4On = () => G && G.sailings && G.start;
const gi = d => Math.round((Date.parse(d) - Date.parse(G.start)) / 864e5);
function sumDays(arr, from, to){   // GA4 per-day array, days inside [from, to] that GA4 covers
  if (!arr || !arr.length || !ga4On()) return null;
  const i = Math.max(0, gi(from)), j = Math.min(arr.length - 1, gi(to));
  if (j < i) return null;
  let s = 0; for (let k = i; k <= j; k++) s += arr[k] || 0; return s;
}
function brief(){ const it = st.pick && store && store.all()[st.pick]; return it ? it.brief : null; }
function windowOf(b){
  const last = (SP && SP.to) || (G && G.end) || S.updated;
  let from = st.from || (b && b.from) || addDays(last, -27), to = st.to || (b && b.to) || last;
  if (to < from) [from, to] = [to, from];
  return {from, to};
}
// The Meta campaigns counted: chosen by hand, else those whose name or ads' names carry the brief's code (or name)
function campsFor(b){
  const all = Object.keys((SP && SP.campaigns) || {});
  if (st.camps) return {ids: st.camps.filter(x => all.includes(x)), auto: false};
  if (!b) return {ids: all, auto: true};
  const keys = [b.code, b.name].map(norm).filter(k => k.length >= 3);
  const hit = all.filter(id => { const c = SP.campaigns[id]; return keys.some(k => norm(c.name).includes(k) || (c.ads || []).some(a => norm(a).includes(k))); });
  return hit.length ? {ids: hit, auto: true} : {ids: all, auto: true, none: true};
}
// Spend by code over the window for the chosen campaigns: {code: {a (by card clicks), b (by page views), v (views from
// these ads), bmiss (days with no page-view figure)}}
function spendBy(from, to, ids){
  const out = {}, want = new Set(ids);
  for (const [code, cs] of Object.entries(SP.rows || {})) {
    for (const [cid, pts] of Object.entries(cs)) {
      if (!want.has(cid)) continue;
      for (const [d, a, b, v] of pts) {
        if (d < from || d > to) continue;
        const r = out[code] || (out[code] = {a: 0, b: 0, v: 0, bmiss: 0});
        r.a += a; if (b == null) r.bmiss++; else r.b += b; r.v += v;
      }
    }
  }
  return {out};
}
function interest(list, from, to){
  if (!ga4On()) return null;
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const bFrom = addDays(from, -n), bTo = addDays(from, -1);
  if (gi(bFrom) < 0 || gi(from) > G.days - 1) return {n, bFrom, bTo, rows: [], outside: true};
  const end = to > G.end ? G.end : to, nAfter = Math.round((Date.parse(end) - Date.parse(from)) / 864e5) + 1;
  const bF2 = addDays(from, -nAfter);   // compare like with like while the campaign is still running
  const ids = new Set(list.map(x => x.id)), SS = S.sailings || {}, GS = G.sailings;
  const rows = list.map(x => {
    const g = GS[x.id] || {}, s = SS[x.id] || {};
    const b = sumDays(g.views, bF2, bTo), a = sumDays(g.views, from, end);
    const cb = sumDays(g.clicks_d, bF2, bTo), ca = sumDays(g.clicks_d, from, end), m = sumDays(g.meta_d, from, end);
    const ctrl = [], ctrlC = [];
    for (const [c2, s2] of Object.entries(SS)) {
      const g2 = GS[c2];
      if (ids.has(c2) || !g2 || !g2.views || !g2.views.length || !!s2.flight_from !== !!s.flight_from || !s2.departure_date || !s.departure_date) continue;
      if (Math.abs(Date.parse(s2.departure_date) - Date.parse(s.departure_date)) / 864e5 > WINDOW_CTRL || s2.departure_date <= end) continue;
      const b2 = sumDays(g2.views, bF2, bTo), a2 = sumDays(g2.views, from, end);
      if (b2 == null || b2 < MIN_BEFORE) continue;
      ctrl.push(ratio(a2, b2));
      const kb = sumDays(g2.clicks_d, bF2, bTo), ka = sumDays(g2.clicks_d, from, end);
      if (kb != null && kb + ka >= MIN_CLICKS) ctrlC.push(ratio(ka, kb));
    }
    const med = median(ctrl), medC = median(ctrlC);
    const flags = [];
    if (b == null || b < MIN_BEFORE) flags.push("thin");
    if (ctrl.length < MIN_CONTROLS) flags.push("few");
    return {x, b, a, cb, ca, m, ctrlN: ctrl.length, ctrl: med == null ? null : Math.exp(med) - 1,
      lift: med == null || b == null ? null : Math.exp(ratio(a, b) - med) - 1,
      liftC: cb != null && cb + ca >= MIN_CLICKS && ctrlC.length >= MIN_CONTROLS ? Math.exp(ratio(ca, cb) - medC) - 1 : null, flags};
  });
  return {n, nAfter, bFrom: bF2, bTo, end, running: to > G.end, rows};
}
function verdict(rows){
  const l = rows.filter(r => !r.flags.length && r.lift != null).map(r => r.lift), m = median(l);
  if (l.length < 5) return {m, n: l.length, t: `<span class="sub">Too few sailings to judge (${l.length} with enough views and similar sailings)</span>`};
  const up = l.filter(v => v > 0).length / l.length;
  const t = m >= 0.1 && up >= 0.6 ? `<b style="color:var(--ok, #1a7f26)">More interest than similar sailings</b>` : m <= -0.1 && up <= 0.4 ? `<b style="color:var(--warn)">Less interest than similar sailings</b>` : `<span>No clear difference from similar sailings</span>`;
  return {m, n: l.length, up, t};
}

// ---------- the page ----------
function draw(){
  const el = root, items = store ? store.all() : {};
  const b = brief();
  if (st.pick && store && !store.loading && !b) st.pick = "";
  const {from, to} = windowOf(b);
  const all = Object.fromEntries(Object.entries(S.sailings || {}).map(([id, s]) => [id, s]));
  const list = b ? sailingsFor(b, S, KIT, from) : [];
  const listIds = new Set(list.map(x => x.id));
  const cs = metaOn() ? campsFor(b) : {ids: []};
  const sp = metaOn() ? spendBy(from, to, cs.ids) : null;
  const inter = b ? interest(list, from, to) : null;
  const v = inter && inter.rows ? verdict(inter.rows) : null;
  const scope = b ? st.scope : "all";
  // spend rows: the campaign's sailings (or every sailing), then the rest together, then what isn't a sailing
  let rows = [], rest = null, specials = [];
  if (sp) {
    const codes = Object.keys(sp.out).filter(c => !c.startsWith("_"));
    const want = scope === "campaign" ? [...new Set([...list.map(x => x.id), ...codes.filter(c => listIds.has(c))])] : codes;
    rows = want.map(id => ({id, s: all[id] || {}, ...(sp.out[id] || {a: 0, b: 0, v: 0, bmiss: 0})}));
    if (scope === "campaign") {
      const others = codes.filter(c => !listIds.has(c));
      if (others.length) rest = others.reduce((r, c) => ({a: r.a + sp.out[c].a, b: r.b + sp.out[c].b, v: r.v + sp.out[c].v, n: r.n + 1}), {a: 0, b: 0, v: 0, n: 0});
    }
    specials = Object.keys(SPECIAL).filter(k => sp.out[k] && (sp.out[k].a || sp.out[k].b)).map(k => ({id: k, ...sp.out[k]}));
    for (const r of rows) {
      const g = ga4On() && G.sailings[r.id];
      r.clicks = g ? sumDays(g.clicks_d, from, to) : null;
    }
    rows.sort((x, y) => (y.b || y.a) - (x.b || x.a) || x.id.localeCompare(y.id));
  }
  const tot = sp ? Object.values(sp.out).reduce((s, r) => s + r.a, 0) : 0;
  const onCamp = sp ? rows.reduce((s, r) => s + r.a, 0) : 0, onCampB = sp ? rows.reduce((s, r) => s + r.b, 0) : 0;
  const viewsCamp = sp ? rows.reduce((s, r) => s + r.v, 0) : 0;
  const bMissDays = sp ? Math.max(0, ...Object.values(sp.out).map(r => r.bmiss)) : 0;
  const clicksIn = inter && inter.rows ? inter.rows.reduce((s, r) => s + (r.ca || 0), 0) : null, clicksBefore = inter && inter.rows ? inter.rows.reduce((s, r) => s + (r.cb || 0), 0) : null;
  const shown = rows.slice(0, st.shown);
  const opts = Object.entries(items).sort((x, y) => String(y[1].saved_at).localeCompare(String(x[1].saved_at)));

  el.innerHTML = `<p class="note" style="margin:0 0 12px">How a campaign did: its sailings' page views and booking clicks while it ran, against the same number of days before and against <b>similar sailings that weren't in it</b>, and the <b>Meta spend on each sailing</b>, estimated two ways. Interest on the website, not bookings.</p>
    <div class="controls">
      <label class="sub">Campaign <select id="cr-pick" aria-label="Campaign"><option value="">Any dates (every Meta ad)</option>
        ${store && store.loading ? `<option disabled>Loading saved campaigns…</option>` : ""}
        ${opts.map(([id, it]) => `<option value="${esc(id)}"${st.pick === id ? " selected" : ""}>${esc(it.name || (it.brief && it.brief.name) || "Untitled")}${it.brief && it.brief.from ? ` (${esc(day(it.brief.from))} to ${esc(day(it.brief.to))})` : ""}</option>`).join("")}</select></label>
      <label class="sub">From <input type="date" id="cr-from" value="${esc(from)}"></label>
      <label class="sub">To <input type="date" id="cr-to" value="${esc(to)}"></label>
      ${st.from || st.to ? `<button type="button" class="linkbtn" id="cr-dates">${b ? "Back to the campaign's dates" : "Back to the last 28 days"}</button>` : ""}
    </div>
    ${b ? `<p class="sub" style="margin:4px 0 0">${esc(b.offer || b.name || "")}${b.code ? ` · code ${esc(b.code)}` : ""} · ${list.length} sailing${list.length === 1 ? "" : "s"} ${b.pick === "codes" ? "from its cruise codes" : "matching its rule"} on ${esc(day(from < S.updated ? from : S.updated))}${!b.from || !b.to ? ` · <span style="color:var(--warn)">the brief has no booking window: dates set here</span>` : ""}</p>` : ""}
    ${!opts.length && store && !store.loading ? `<p class="sub">No saved campaigns yet: save a brief in Creative → Campaign builder to see its results here. Until then, "Any dates" shows Meta spend by sailing for every ad.</p>` : ""}

    <div class="stats" role="group" aria-label="Summary" style="margin-top:12px">
      <div class="stat"><span class="k">Meta spend</span><span class="v">${sp ? gbp(tot) : "–"}</span><span class="s">${sp ? `${cs.ids.length} campaign${cs.ids.length === 1 ? "" : "s"}, ${esc(day(from))} to ${esc(day(to))}` : metaOn() ? "" : "Meta ads not connected"}</span></div>
      <div class="stat"><span class="k">${b && scope === "campaign" ? "On the campaign's sailings" : "On sailings"}</span><span class="v">${sp ? gbp(onCampB || onCamp) : "–"}</span><span class="s">${sp ? `by page views${bMissDays ? " (part)" : ""} · ${gbp(onCamp)} by card clicks` : ""}</span></div>
      <div class="stat"><span class="k">Views from these ads</span><span class="v">${sp ? n0(viewsCamp) : "–"}</span><span class="s">${sp ? `on ${b && scope === "campaign" ? "the campaign's" : "sailing"} pages${viewsCamp ? ` · ${gbp2(onCampB / viewsCamp)} a view` : ""}` : ""}</span></div>
      ${b ? `<div class="stat"><span class="k">Booking clicks</span><span class="v">${clicksIn == null ? "–" : n0(clicksIn)}</span><span class="s">${clicksIn == null ? (ga4On() ? "" : "GA4 not connected") : `on its sailings, ${n0(clicksBefore)} the ${inter.nAfter} days before`}</span></div>
      <div class="stat"><span class="k">Against similar sailings</span><span class="v">${v && v.m != null ? pc(v.m) : "–"}</span><span class="s">${v ? `typical lift in views (${v.n} sailings)` : ga4On() ? "" : "GA4 not connected"}</span></div>` : ""}
    </div>

    ${b ? `<h3 style="margin:18px 0 8px;font-size:15px">Interest in the campaign's sailings</h3>
    ${!ga4On() ? `<div class="empty"><p>${G && G.problem ? esc(G.problem) : "Google Analytics isn't connected yet."}</p><p class="sub">Views and booking clicks come from GA4: see Prices → Sailing demand for the one-off setup. The campaign's sailings are listed below meanwhile.</p></div>`
      : inter.outside ? `<div class="empty"><p>GA4's figures (${esc(day(G.start))} to ${esc(day(G.end))}) don't cover this campaign and the ${inter.n} days before it.</p></div>`
      : `<p style="margin:0 0 8px">${v.t}${inter.running ? ` <span class="sub">· still running: ${inter.nAfter} day${inter.nAfter === 1 ? "" : "s"} so far (GA4 to ${esc(day(G.end))}), against the ${inter.nAfter} days before</span>` : ` <span class="sub">· ${inter.nAfter} days against the ${inter.nAfter} days before</span>`}</p>
      <div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th><th class="num">Views before → during</th><th class="num">Similar sailings</th><th class="num">Lift</th><th class="num">Booking clicks before → during</th><th class="num">Click lift</th><th class="num">Views from Meta ads</th></tr></thead><tbody>
        ${inter.rows.slice().sort((p, q) => (q.lift ?? -9) - (p.lift ?? -9)).map(r => `<tr><td style="white-space:normal"><a href="#${esc(r.x.id)}"><b>${esc(r.x.title)}</b></a><div class="sub">${esc(r.x.id)} · departs ${esc(day(r.x.date))}</div>${r.flags.length ? `<div class="sub" style="color:var(--warn)">${r.flags.map(f => f === "thin" ? `under ${MIN_BEFORE} views before` : "too few similar sailings").join("; ")}: left out of the summary</div>` : ""}</td>
          <td class="num">${n0(r.b)} → ${n0(r.a)}</td><td class="num">${pc(r.ctrl)} <span class="sub">(${r.ctrlN})</span></td><td class="num"><b>${pc(r.lift)}</b></td>
          <td class="num">${r.cb == null ? "–" : `${n0(r.cb)} → ${n0(r.ca)}`}</td><td class="num">${pc(r.liftC)}</td><td class="num">${n0(r.m)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="note">"Similar sailings" are ones not in the campaign, with the same no-fly / fly-cruise, departing within 3 months of each sailing and after the campaign; it shows how much their views moved over the same days, and how many there were. <b>Lift</b> is how much more (or less) the campaign's sailing moved than they did, so seasons and emails that hit every sailing cancel out. "Typical" is the median; a verdict needs at least 5 sailings. Booking clicks are clicks from the sailing's page to the booking site, from every source.</p>`}` : ""}

    <h3 style="margin:22px 0 8px;font-size:15px">Meta spend by sailing (estimated)</h3>
    ${!metaOn() ? `<div class="empty"><p>${SP && SP.problem && SP.problem !== "setup" ? esc(SP.problem) : "Our Meta ad account isn't connected yet."}</p><p class="sub">Spend comes from the hourly read of our Meta ad account (Creative → Meta ads has the one-off setup; it's due with the account restructure). Once connected, the last 90 days are read on the first day, then kept for 400 days.</p>
      ${b && list.length ? `<p class="sub">The campaign's sailings: ${list.slice(0, 60).map(x => `<a href="#${esc(x.id)}">${esc(x.id)}</a>`).join(", ")}${list.length > 60 ? ` and ${list.length - 60} more` : ""}.</p>` : ""}</div>` : `
    <p class="note" style="margin:0 0 8px">Meta doesn't report spend by sailing, so it's shared out each day, ad by ad, two ways: <b>by card clicks</b>, a carousel's spend in proportion to the clicks on each sailing's card (a single image or video ad goes to its sailing); and <b>by page views</b>, in proportion to the page views in visits that came from the ad (GA4, matched by the ad's UTM campaign tag to the ad, its ad set or its campaign). Where they differ, people clicked one card but looked at other sailings. Cost per booking click uses every booking click on the page, not only those from ads.</p>
    ${metaOn() ? `<details${st.camps ? " open" : ""}><summary class="sub">Meta campaigns counted: ${cs.ids.length} of ${Object.keys(SP.campaigns || {}).length}${b && cs.auto && !cs.none ? ` (names or ads carrying "${esc(b.code || b.name)}")` : ""}</summary>
      <div class="controls" style="flex-wrap:wrap">${Object.entries(SP.campaigns || {}).map(([id, c]) => `<label class="sub"><input type="checkbox" data-camp="${esc(id)}"${cs.ids.includes(id) ? " checked" : ""}> ${esc(c.name || id)}</label>`).join("")}
      ${st.camps ? `<button type="button" class="linkbtn" id="cr-auto">Back to the automatic choice</button>` : ""}</div></details>
      ${b && cs.none ? `<p class="sub" style="color:var(--warn)">No Meta campaign's name or ads carry "${esc(b.code || b.name)}", so every campaign is counted: tick the campaign's own above.</p>` : ""}` : ""}
    ${b ? `<div class="controls"><label class="sub"><input type="radio" name="cr-scope" value="campaign"${scope === "campaign" ? " checked" : ""}> The campaign's sailings</label><label class="sub"><input type="radio" name="cr-scope" value="all"${scope === "all" ? " checked" : ""}> Every sailing with spend</label></div>` : ""}
    ${chart(from, to, cs.ids, scope === "campaign" ? listIds : null)}
    <div class="controls"><button type="button" class="linkbtn" id="cr-csv">Download CSV</button><span class="sub">${rows.length} sailing${rows.length === 1 ? "" : "s"}${bMissDays ? ` · ${bMissDays} day${bMissDays === 1 ? "" : "s"} outside GA4's figures have no page-view estimate` : ""}</span></div>
    ${rows.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Sailing</th><th class="num">By card clicks</th><th class="num">By page views</th><th class="num">Views from these ads</th><th class="num">Cost per view</th><th class="num">Booking clicks</th><th class="num">Cost per booking click</th></tr></thead><tbody>
      ${shown.map(r => `<tr><td style="white-space:normal"><a href="#${esc(r.id)}"><b>${esc(r.s.base_title || r.s.title || r.id)}</b></a><div class="sub">${esc(r.id)}${r.s.departure_date ? ` · departs ${esc(day(r.s.departure_date))}` : ""}</div></td>
        <td class="num" style="white-space:nowrap">${bar(r.a, rows)} ${gbp2(r.a)}</td><td class="num" style="white-space:nowrap">${bar(r.b, rows)} ${gbp2(r.b)}</td><td class="num">${n0(r.v)}</td><td class="num">${r.v && r.b ? gbp2(r.b / r.v) : "–"}</td>
        <td class="num">${r.clicks == null ? "–" : n0(r.clicks)}</td><td class="num">${r.clicks && r.b ? gbp2(r.b / r.clicks) : "–"}</td></tr>`).join("")}
      ${rest ? `<tr style="color:var(--muted)"><td>Other sailings (${rest.n}, not in the campaign)</td><td class="num">${gbp2(rest.a)}</td><td class="num">${gbp2(rest.b)}</td><td class="num">${n0(rest.v)}</td><td class="num">${rest.v ? gbp2(rest.b / rest.v) : "–"}</td><td></td><td></td></tr>` : ""}
      ${specials.map(r => `<tr style="color:var(--muted)"><td>${SPECIAL[r.id]}</td><td class="num">${gbp2(r.a)}</td><td class="num">${gbp2(r.b)}</td><td class="num">${r.v ? n0(r.v) : ""}</td><td class="num">${r.v ? gbp2(r.b / r.v) : ""}</td><td></td><td></td></tr>`).join("")}
    </tbody></table></div>${rows.length > st.shown ? `<button type="button" class="linkbtn" id="cr-more">Show more (${rows.length - st.shown})</button>` : ""}`
    : `<div class="empty"><p>No spend on ${b && scope === "campaign" ? "the campaign's sailings" : "sailings"} in these dates and campaigns.</p></div>`}
    ${howNote()}`}`;
  wire(el, b, list, rows, rest, specials, from, to);
}
function bar(v, rows){
  const mx = Math.max(...rows.map(r => Math.max(r.a, r.b)), 1), w = Math.round(Math.max(0, v) / mx * 60);
  return `<span aria-hidden="true" style="display:inline-block;vertical-align:middle;height:8px;width:${w}px;background:var(--c1);opacity:.55;margin-right:4px"></span>`;
}
function chart(from, to, ids, only){
  if (!metaOn()) return "";
  const want = new Set(ids), days = dayList(from, to > (SP.to || to) ? SP.to : to), tot = {}, a = {}, b = {};
  for (const [code, cs] of Object.entries(SP.rows || {})) for (const [cid, pts] of Object.entries(cs)) {
    if (!want.has(cid)) continue;
    for (const [d, x, y] of pts) {
      if (d < from || d > to) continue;
      tot[d] = (tot[d] || 0) + x;
      if (!code.startsWith("_") && (!only || only.has(code))) { a[d] = (a[d] || 0) + x; if (y != null) b[d] = (b[d] || 0) + y; }
    }
  }
  if (!Object.keys(tot).length) return "";
  const lab = only ? "the campaign's sailings" : "sailings";
  const c = lineChart([
    {name: "All spend", color: "var(--c1)", bold: true, pts: days.map(d => [d, tot[d] || 0])},
    {name: `On ${lab}, by card clicks`, color: "var(--c2)", pts: days.map(d => [d, a[d] || 0])},
    {name: `On ${lab}, by page views`, color: "var(--c3)", dash: true, pts: days.filter(d => d in b).map(d => [d, b[d]])},
  ], {fmt: v => "£" + Math.round(v).toLocaleString("en-GB"), zero: true, esc});
  chart.wire = c.wire;
  return `<div style="margin:8px 0 12px">${c.html}</div>`;
}
function howNote(){
  const m = Object.entries(SP.methods || {}), t = m.reduce((s, [, v]) => s + v, 0) || 1;
  const utm = SP.utm || [];
  return `<details style="margin-top:12px"><summary class="sub">How the spend was shared out</summary>
    <p class="note">By card clicks, all days read: ${m.map(([k, v]) => `${esc(k)} ${Math.round(v / t * 100)}%`).join(" · ")}.</p>
    ${utm.length ? `<p class="note">By page views: the UTM campaign tags in visits from Meta ads (GA4) and what they were matched to. Visits whose tag matched nothing are shared by the ads that matched nothing.</p>
      <div class="tablewrap"><table class="ptable"><thead><tr><th>UTM campaign</th><th class="num">Page views</th><th>Matched to</th></tr></thead><tbody>
      ${utm.map(([u, n, mt]) => `<tr><td>${esc(u)}</td><td class="num">${n0(n)}</td><td>${mt ? esc(mt) : `<span class="sub">nothing in the account</span>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="note">No visits from Meta ads in GA4's figures yet, so there's no page-view estimate. Tagging every ad's link with utm_source=facebook, utm_medium=paid_social and utm_campaign={{campaign.name}} (or the ad's name) lets visits be matched to ads.</p>`}
  </details>`;
}
function wire(el, b, list, rows, rest, specials, from, to){
  const re = () => draw();
  const q = s => el.querySelector(s);
  q("#cr-pick").addEventListener("change", e => { st.pick = e.target.value; st.from = st.to = ""; st.camps = null; st.shown = 40; save(); re(); });
  q("#cr-from").addEventListener("change", e => { st.from = e.target.value; if (!st.to) st.to = to; save(); re(); });
  q("#cr-to").addEventListener("change", e => { st.to = e.target.value; if (!st.from) st.from = from; save(); re(); });
  const d = q("#cr-dates"); d && d.addEventListener("click", () => { st.from = st.to = ""; save(); re(); });
  el.querySelectorAll("[data-camp]").forEach(x => x.addEventListener("change", () => { st.camps = [...el.querySelectorAll("[data-camp]:checked")].map(y => y.dataset.camp); save(); re(); }));
  const au = q("#cr-auto"); au && au.addEventListener("click", () => { st.camps = null; save(); re(); });
  el.querySelectorAll('[name="cr-scope"]').forEach(x => x.addEventListener("change", () => { st.scope = x.value; st.shown = 40; save(); re(); }));
  const more = q("#cr-more"); more && more.addEventListener("click", () => { st.shown += 40; re(); });
  if (chart.wire) { chart.wire(el); chart.wire = null; }
  const csv = q("#cr-csv"); csv && csv.addEventListener("click", () => {
    const qv = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,]*(\.\d+)?%?$/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const f2 = v => v == null || !isFinite(v) ? "" : v.toFixed(2);
    const head = ["Cruise code", "Sailing", "Departs", "Spend by card clicks £", "Spend by page views £", "Views from these ads", "Cost per view £", "Booking clicks (all sources)", "Cost per booking click £", "From", "To", "Campaign"];
    const name = b ? (b.name || "") : "Any dates";
    const body = [...rows.map(r => [r.id, r.s.base_title || r.s.title || "", r.s.departure_date || "", f2(r.a), f2(r.b), Math.round(r.v), r.v && r.b ? f2(r.b / r.v) : "", r.clicks ?? "", r.clicks && r.b ? f2(r.b / r.clicks) : "", from, to, name]),
      ...(rest ? [["", `Other sailings (${rest.n})`, "", f2(rest.a), f2(rest.b), Math.round(rest.v), "", "", "", from, to, name]] : []),
      ...specials.map(r => ["", SPECIAL[r.id], "", f2(r.a), f2(r.b), Math.round(r.v), "", "", "", from, to, name])];
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(qv).join(",")).join("\r\n")], {type: "text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `spend-by-sailing-${norm(name) || "all"}-${from}-to-${to}.csv`; a.click();
  });
}
