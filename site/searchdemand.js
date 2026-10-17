// SEO → Search demand (Sam, 17 Oct 2026: "a search demand viewer, with key search terms pre loaded up but with the ability
// to add more and group them accordingly. Ideally from a tool like google keyword planner"). Monthly UK Google searches
// per term from Keyword Planner (search_demand.py, pricewatch/seo-demand), grouped, with seasonality, change on last year,
// competition and bids, beside our own Search Console figures (pricewatch/seo-gsc). Lists of grouped terms: the starting
// list (search_terms.json, read-only here) and the team's own, saved in the shared list (saved.js sharedStore, kind
// "keywords"): anyone can open or copy one, only the person who saved it can change it. New terms are looked up at the
// next daily read. UK only. Read-only towards Google: nothing here touches the Google Ads account.
import {sharedStore} from "./saved.js?v=__BUILD__";
import {lineChart, COLORS} from "./comptrend.js?v=__BUILD__";

const KEY = "spw-search-demand";
let D, G, store, ctx, esc, root;
const st = {list: "default", work: null, dirty: false, open: {}, shown: {}, note: ""};
try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); Object.assign(st, {list: s.list || "default", open: s.open || {}, shown: s.shown || {}}); } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({list: st.list, open: st.open, shown: st.shown})); } catch(e) {} };
const norm = t => String(t || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
const n0 = v => v == null ? "–" : Math.round(v).toLocaleString("en-GB");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monLab = ym => `${MON[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const pct = (a, b) => { if (!b) return null; return Math.round((a / b - 1) * 100); };
const pctCell = p => p == null ? "–" : `<span style="color:${p >= 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%</span>`;
const clone = x => JSON.parse(JSON.stringify(x));

export async function mount(el, c){
  ctx = c; esc = c.esc; root = el;
  if (D === undefined) {
    el.innerHTML = `<p class="loading">Loading search demand…</p>`;
    [D, G] = await Promise.all([c.readJson("seo-demand").catch(() => null), c.readJson("seo-gsc").catch(() => null)]);
    store = sharedStore({kind: "keywords", localKey: "spw-keyword-lists", field: "list", idToken: c.idToken});
    store.load().then(() => { if (st.list !== "default" && !store.all()[st.list]) { st.list = "default"; st.work = null; } draw(); });
  }
  draw();
}

const starting = () => (D && D.default) || {name: "Starting list", groups: []};
const lists = () => ({default: {name: `${starting().name} (starting list)`, list: starting(), mine: false}, ...Object.fromEntries(Object.entries(store && !store.loading ? store.all() : {}).map(([id, x]) => [id, {...x, mine: store.mine(id)}]))});
function current(){
  if (!st.work) { const L = lists()[st.list] || lists().default; st.work = clone(L.list || starting()); st.dirty = false; }
  return st.work;
}
// Search Console figures for a term (90 days: clicks, impressions, average position), matched exactly
let gscMap = null;
const gsc = t => {
  if (!gscMap) { gscMap = {}; for (const [q, c, i, p] of (G && G.queries) || []) gscMap[norm(q)] = [c, i, p]; }
  return gscMap[norm(t)] || null;
};
const T = t => (D && D.terms && D.terms[norm(t)]) || null;
// figures for a set of terms: monthly totals, average, last month, the same month a year before, last 3 months on the year before
function figures(terms){
  const months = (D && D.months) || [], n = months.length, m = new Array(n).fill(0);
  let avg = 0, lo = null, hi = null, got = 0;
  for (const t of terms) { const x = T(t); if (!x) continue; got++; avg += x.avg || 0; (x.m || []).forEach((v, i) => { if (v != null) m[i] += v; });
    if (x.lo) lo = lo == null ? x.lo : Math.min(lo, x.lo); if (x.hi) hi = hi == null ? x.hi : Math.max(hi, x.hi); }
  const s3 = (a, b) => m.slice(a, b).reduce((x, y) => x + y, 0);
  const yoy = n >= 15 ? pct(s3(n - 3, n), s3(n - 15, n - 12)) : null;
  const last12 = m.slice(-12), peak = last12.length ? months.slice(-12)[last12.indexOf(Math.max(...last12))] : null;
  return {m, avg, last: m[n - 1], lastYear: n >= 13 ? m[n - 13] : null, yoy, peak, lo, hi, got};
}
function spark(m){
  if (!m || !m.some(v => v)) return "";
  const W = 96, H = 22, mx = Math.max(...m.map(v => v || 0), 1);
  const pts = m.map((v, i) => `${(i / Math.max(1, m.length - 1) * W).toFixed(1)},${(H - (v || 0) / mx * H).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="Monthly searches"><polyline points="${pts}" fill="none" stroke="var(--heading)" stroke-width="1.5"/></svg>`;
}

function draw(){
  const L = lists(), cur = L[st.list] || L.default, own = st.list !== "default" && cur.mine, w = current();
  const has = D && D.source === "keyword-planner" && Object.keys(D.terms || {}).length;
  const months = (D && D.months) || [];
  const wanted = new Set(((D && D.wanted) || []).map(norm));
  const groups = w.groups || [];
  const gf = groups.map(g => ({g, f: figures(g.terms)}));
  const shownNames = groups.filter(g => st.shown[g.name] !== false).slice(0, 10);
  const ch = has ? lineChart(shownNames.map((g, i) => ({name: g.name, color: COLORS[i % COLORS.length], pts: months.map((m, k) => [m + "-01", figures(g.terms).m[k]])})),
    {fmt: n0, esc, label: "Searches a month by group", zero: true, xlab: d => monLab(d.slice(0, 7))}) : null;
  const allTerms = groups.flatMap(g => g.terms);
  const gTot = t => { const x = gsc(t); return x; };
  const sumGsc = terms => terms.reduce((a, t) => { const x = gTot(t); return x ? [a[0] + x[0], a[1] + x[1]] : a; }, [0, 0]);
  root.innerHTML = `
    <p class="note" style="margin:0 0 12px">${has ? `Google searches in the UK a month, from Keyword Planner (read ${esc(D.read_on)}; ${monLab(months[0])} – ${monLab(months[months.length - 1])}).` : ""}
      Beside each term: our own Google figures for that exact search from Search Console (last 90 days). Read-only: nothing here touches the Google Ads account.</p>
    ${!has ? `<div class="empty" style="text-align:left"><p><b>Keyword Planner isn't connected yet.</b>${D && D.problem ? ` ${esc(D.problem.replace(/^Keyword Planner isn't connected yet: ?/, "").replace(/^\w/, c => c.toUpperCase()))}` : ""} Until it is, the lists work and show our Search Console figures.</p>
      <p class="sub">One-off setup, all read-only: a Google Ads <b>developer token</b> (Google Ads → Tools → API Center; Basic access, which Google approves in a few days), an OAuth client in promotions-planner, and one sign-in with an account that can see the Ads account. Then the repo secrets GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN and GOOGLE_ADS_CUSTOMER_ID (CLAUDE.md, "Search demand").</p></div>` : D.problem ? `<p class="note">Last read: ${esc(D.problem)}</p>` : ""}
    <div class="ac-block" style="margin:12px 0">
      <div class="controls" style="margin:0">
        <select id="sd-list" aria-label="List">${Object.entries(L).map(([id, x]) => `<option value="${esc(id)}"${id === st.list ? " selected" : ""}>${esc(x.name)}${id !== "default" && x.by ? ` · ${esc(x.mine ? "you" : x.by)}` : ""}</option>`).join("")}</select>
        ${own ? `<button type="button" class="btn sm" id="sd-save"${st.dirty ? "" : " disabled"}>Save</button>` : ""}
        <button type="button" class="btn ${own ? "quiet " : ""}sm" id="sd-saveas">Save as…</button>
        ${own ? `<button type="button" class="btn quiet sm" id="sd-ren">Rename</button><button type="button" class="btn quiet sm" id="sd-del">Delete</button>` : ""}
        <button type="button" class="linkbtn" id="sd-csv">Download CSV</button>
        <span class="sub">${store && store.loading ? "Loading saved lists…" : st.dirty ? (own ? "Unsaved changes" : "Changed: Save as… to keep it") : st.list === "default" ? "The starting list: copy it with Save as… to make your own" : !cur.mine ? `Saved by ${esc(cur.by || "someone else")}: Save as… to keep your own changes` : ""}</span>
      </div>
      ${store && store.problem ? `<p class="sub" style="margin:6px 0 0">${esc(store.problem)}</p>` : ""}
      ${st.note ? `<p class="ac-note" style="margin:8px 0 0">${st.note}</p>` : ""}
    </div>
    <h3 style="margin:18px 0 8px;font-size:15px">By group</h3>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Show</th><th>Group</th><th class="num">Terms</th><th class="num">Searches a month</th><th>${has ? `${months.length} months` : ""}</th><th class="num">Last month</th><th class="num">Last 3 months on a year before</th><th>Busiest month</th><th class="num">Top-of-page bid</th><th class="num">Our impressions (90 days)</th></tr></thead><tbody>
      ${gf.map(({g, f}) => { const s = sumGsc(g.terms); return `<tr><td><input type="checkbox" data-show="${esc(g.name)}"${st.shown[g.name] !== false ? " checked" : ""} aria-label="Show ${esc(g.name)} on the chart"></td>
        <td><button type="button" class="linkbtn" style="text-align:left" data-jump="${esc(g.name)}"><b>${esc(g.name)}</b></button></td><td class="num">${g.terms.length}</td>
        <td class="num"><b>${has ? n0(f.avg) : "–"}</b></td><td>${has ? spark(f.m) : ""}</td><td class="num">${has ? n0(f.last) : "–"}</td><td class="num">${has ? pctCell(f.yoy) : "–"}</td>
        <td>${has && f.peak ? monLab(f.peak) : "–"}</td><td class="num">${has && f.hi ? `£${f.lo.toFixed(2)}–£${f.hi.toFixed(2)}` : "–"}</td><td class="num">${s[1] ? n0(s[1]) : "–"}${s[0] ? `<div class="sub">${n0(s[0])} clicks</div>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>
    ${ch ? `<h3 style="margin:18px 0 8px;font-size:15px">Searches a month by group</h3>${ch.html}<p class="note">Tick groups in the table to show them (up to 10). Keyword Planner rounds small numbers and groups close variants ("cruise from uk" and "cruises from uk") under one figure.</p>` : ""}
    <h3 style="margin:22px 0 8px;font-size:15px">Groups and terms</h3>
    ${groups.map((g, gi) => { const ideas = ((D && D.ideas) || {})[norm(g.name)] || [], have = new Set(allTerms.map(norm));
      return `<details class="ac-block" id="sd-g-${gi}" data-open="${esc(g.name)}"${st.open[g.name] ? " open" : ""}><summary><b>${esc(g.name)}</b> <span class="sub">${g.terms.length} term${g.terms.length === 1 ? "" : "s"}${has ? ` · ${n0(figures(g.terms).avg)} searches a month` : ""}</span></summary>
        <div class="controls" style="margin:8px 0"><input data-gname="${gi}" value="${esc(g.name)}" aria-label="Group name" style="max-width:260px">
          <button type="button" class="btn quiet sm" data-gup="${gi}"${gi ? "" : " disabled"}>Move up</button><button type="button" class="btn quiet sm" data-gdel="${gi}">Delete group</button></div>
        <div class="tablewrap"><table class="ptable"><thead><tr><th>Search term</th><th class="num">Searches a month</th><th>${has ? `${months.length} months` : ""}</th><th class="num">Last 3 months on a year before</th><th>Competition</th><th class="num">Top-of-page bid</th><th class="num">Our impressions · clicks · position</th><th>Group</th><th></th></tr></thead><tbody>
        ${g.terms.map((t, ti) => { const x = T(t), q = gsc(t), f = x ? figures([t]) : null;
          return `<tr><td>${esc(t)}${!x && has ? `<div class="sub">${wanted.has(norm(t)) ? "no figures from Keyword Planner" : "looked up at the next daily read"}</div>` : ""}</td>
          <td class="num"><b>${x ? n0(x.avg) : "–"}</b></td><td>${x ? spark(x.m) : ""}</td><td class="num">${f ? pctCell(f.yoy) : "–"}</td><td>${x && x.comp ? esc(x.comp.replace(/^\w/, c => c.toUpperCase())) : "–"}</td>
          <td class="num">${x && x.hi ? `£${x.lo.toFixed(2)}–£${x.hi.toFixed(2)}` : "–"}</td><td class="num">${q ? `${n0(q[1])} · ${n0(q[0])} · ${q[2] != null ? q[2].toFixed(1) : "–"}` : "–"}</td>
          <td><select data-move="${gi}:${ti}" aria-label="Move to group">${groups.map((h, k) => `<option value="${k}"${k === gi ? " selected" : ""}>${esc(h.name)}</option>`).join("")}</select></td>
          <td><button type="button" class="linkbtn" data-rm="${gi}:${ti}" aria-label="Remove ${esc(t)}">✕</button></td></tr>`; }).join("") || `<tr><td colspan="9" class="sub">No terms yet.</td></tr>`}
        </tbody></table></div>
        <div class="controls" style="margin:8px 0 0;align-items:flex-start"><textarea data-addto="${gi}" rows="2" placeholder="Add search terms, one per line" style="min-width:280px;flex:1"></textarea><button type="button" class="btn sm" data-add="${gi}">Add</button></div>
        ${ideas.filter(i => !have.has(i[0])).length ? `<p class="sub" style="margin:8px 0 4px">Related searches from Keyword Planner:</p><div>${ideas.filter(i => !have.has(i[0])).map(([t, a]) => `<button type="button" class="chip" style="cursor:pointer;margin:2px" data-idea="${gi}" data-t="${esc(t)}">+ ${esc(t)} <span class="sub">${n0(a)}</span></button>`).join("")}</div>` : ""}
      </details>`; }).join("")}
    <div class="controls" style="margin-top:10px"><input id="sd-newg" placeholder="New group name" style="max-width:260px"><button type="button" class="btn quiet sm" id="sd-addg">Add group</button></div>`;
  wire(groups);
  if (ch) ch.wire(root);
}

function change(fn){ fn(current()); st.dirty = true; st.note = ""; draw(); }
const addTerms = (g, text) => { const have = new Set(st.work.groups.flatMap(x => x.terms).map(norm)); let n = 0;
  for (const t of String(text).split(/[\n,]/).map(norm).filter(Boolean)) if (!have.has(t)) { g.terms.push(t); have.add(t); n++; } return n; };

function wire(groups){
  const $ = s => root.querySelector(s), all = s => root.querySelectorAll(s);
  $("#sd-list").addEventListener("change", e => {
    if (st.dirty && !confirm("Leave this list without saving your changes?")) { e.target.value = st.list; return; }
    st.list = e.target.value; st.work = null; st.note = ""; save(); draw();
  });
  const saveAs = async () => {
    const name = prompt("Name for this list", st.list === "default" ? "My searches" : `${(lists()[st.list] || {}).name || "List"} (copy)`);
    if (!name) return;
    try { const id = await store.save(null, name.slice(0, 80), {...st.work, name: name.slice(0, 80)}); st.list = id; st.work = null; st.dirty = false; st.note = `Saved as “${esc(name)}”. New terms are looked up at the next daily read.`; save(); }
    catch (e) { st.note = `Couldn't save: ${esc(e.message)}`; }
    draw();
  };
  $("#sd-saveas").addEventListener("click", saveAs);
  $("#sd-save") && $("#sd-save").addEventListener("click", async () => {
    try { await store.save(st.list, lists()[st.list].name, st.work); st.dirty = false; st.note = "Saved. New terms are looked up at the next daily read."; } catch (e) { st.note = `Couldn't save: ${esc(e.message)}`; }
    draw();
  });
  $("#sd-ren") && $("#sd-ren").addEventListener("click", async () => {
    const name = prompt("New name", lists()[st.list].name); if (!name) return;
    try { await store.rename(st.list, name.slice(0, 80)); } catch (e) { st.note = `Couldn't rename: ${esc(e.message)}`; } draw();
  });
  $("#sd-del") && $("#sd-del").addEventListener("click", async () => {
    if (!confirm(`Delete “${lists()[st.list].name}” for everyone?`)) return;
    try { await store.remove(st.list); st.list = "default"; st.work = null; st.dirty = false; save(); } catch (e) { st.note = `Couldn't delete: ${esc(e.message)}`; } draw();
  });
  all("[data-show]").forEach(b => b.addEventListener("change", () => { st.shown[b.dataset.show] = b.checked; save(); draw(); }));
  all("[data-jump]").forEach(b => b.addEventListener("click", () => { const gi = groups.findIndex(g => g.name === b.dataset.jump); st.open[b.dataset.jump] = true; save(); draw(); const el = root.querySelector(`#sd-g-${gi}`); el && el.scrollIntoView({behavior: "smooth", block: "start"}); }));
  all("details[data-open]").forEach(d => d.addEventListener("toggle", () => { st.open[d.dataset.open] = d.open; save(); }));
  all("[data-gname]").forEach(i => i.addEventListener("change", () => change(w => { const g = w.groups[+i.dataset.gname], v = i.value.trim().slice(0, 60); if (v && !w.groups.some(h => h !== g && h.name === v)) { st.open[v] = st.open[g.name]; g.name = v; } })));
  all("[data-gup]").forEach(b => b.addEventListener("click", () => change(w => { const i = +b.dataset.gup; [w.groups[i - 1], w.groups[i]] = [w.groups[i], w.groups[i - 1]]; })));
  all("[data-gdel]").forEach(b => b.addEventListener("click", () => { const g = groups[+b.dataset.gdel]; if (g.terms.length && !confirm(`Delete the group “${g.name}” and its ${g.terms.length} terms?`)) return; change(w => w.groups.splice(+b.dataset.gdel, 1)); }));
  all("[data-rm]").forEach(b => b.addEventListener("click", () => change(w => { const [gi, ti] = b.dataset.rm.split(":").map(Number); w.groups[gi].terms.splice(ti, 1); })));
  all("[data-move]").forEach(s => s.addEventListener("change", () => change(w => { const [gi, ti] = s.dataset.move.split(":").map(Number), to = +s.value; if (to === gi) return; const [t] = w.groups[gi].terms.splice(ti, 1); w.groups[to].terms.push(t); st.open[w.groups[to].name] = true; })));
  all("[data-add]").forEach(b => b.addEventListener("click", () => { const ta = root.querySelector(`[data-addto="${b.dataset.add}"]`); let n = 0;
    change(w => { n = addTerms(w.groups[+b.dataset.add], ta.value); }); st.note = n ? `Added ${n} term${n === 1 ? "" : "s"}. ${(D && D.source) ? "Figures arrive at the next daily read once the list is saved." : ""}` : "Those terms are already in this list."; draw(); }));
  all("[data-idea]").forEach(b => b.addEventListener("click", () => change(w => addTerms(w.groups[+b.dataset.idea], b.dataset.t))));
  $("#sd-addg").addEventListener("click", () => { const v = $("#sd-newg").value.trim().slice(0, 60); if (!v || st.work.groups.some(g => g.name === v)) return; st.open[v] = true; change(w => w.groups.push({name: v, terms: []})); });
  $("#sd-csv").addEventListener("click", () => {
    const qv = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const months = (D && D.months) || [];
    const head = ["Group", "Search term", "Searches a month", "Competition", "Top-of-page bid low £", "Top-of-page bid high £", "Our impressions (90 days)", "Our clicks", "Our average position", ...months];
    const body = st.work.groups.flatMap(g => g.terms.map(t => { const x = T(t) || {}, q = gsc(t) || []; return [g.name, t, x.avg ?? "", x.comp || "", x.lo ?? "", x.hi ?? "", q[1] ?? "", q[0] ?? "", q[2] ?? "", ...(x.m || months.map(() => ""))]; }));
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(qv).join(",")).join("\r\n")], {type: "text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `search-demand-${(lists()[st.list] || {}).name || "list"}.csv`.replace(/[^\w.() -]+/g, "-"); a.click();
  });
}
