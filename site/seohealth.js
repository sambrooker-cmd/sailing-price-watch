// SEO → Search performance and Site health (Sam, 17 Oct 2026, picked from the ideas list: "quick wins", "pages losing
// traffic" and a "website health check"). UK only.
//   search  from Search Console (seo_gsc.py, pricewatch/seo-gsc): quick wins (searches we show for on page 1–2 that
//           few people click) and pages losing (or gaining) clicks, last 7 days against the 7 before or 28 against 28
//   health  from the website's own pages (seo_pages.py, pricewatch/seo-pages: title, description, H1s, structured data,
//           canonical, noindex) and the weekly sitemap check (coverage.py, pricewatch/coverage: sitemap pages that 404)
// Read-only: nothing here changes the website or Search Console.

const KEY = "spw-seohealth";
const st = {brand: false, win: "w", kind: "all", issue: "", section: "", qShown: 50};
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}"), {qShown: 50}); } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({brand: st.brand, win: st.win, kind: st.kind, issue: st.issue, section: st.section})); } catch(e) {} };
let ctx, esc, GSC, PAGES, COV;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const n0 = v => v == null ? "–" : Math.round(v).toLocaleString("en-GB");
const pct = v => v == null ? "–" : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const path = u => (u || "").replace(/^https?:\/\/[^/]+/, "") || "/";
const SITE = "https://www.ambassadorcruiseline.com";
function csvDownload(name, head, body){
  const q = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(q).join(",")).join("\r\n")], {type: "text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

export async function mount(el, c, page){
  ctx = c; esc = c.esc;
  if (page === "search") {
    if (GSC === undefined) { el.innerHTML = `<p class="loading">Loading Search Console…</p>`; GSC = await c.readJson("seo-gsc").catch(() => null); }
    return search(el);
  }
  if (PAGES === undefined) {
    el.innerHTML = `<p class="loading">Loading the website's pages…</p>`;
    [PAGES, COV] = await Promise.all([c.readJson("seo-pages").catch(() => null), c.readJson("coverage").catch(() => null)]);
  }
  health(el);
}

// ---------- Search performance ----------
// A rough click rate for each average position (desktop and phone together, all kinds of search): only to size the
// opportunity, never shown as Google's figure
const CURVE = [0, .28, .15, .11, .08, .06, .05, .04, .03, .025, .02];
const expCtr = p => p == null ? 0 : p <= 10 ? CURVE[Math.max(1, Math.round(p))] : p <= 20 ? .01 : .003;
const BRAND = /ambassador|renaissance|ambience|ambition/i;

function setupNote(){
  const p = GSC && GSC.problem;
  return `<div class="empty"><p>${p ? esc(p) : "Search Console isn't connected yet."}</p>
    <p class="sub">One-off setup (on the backlog issue): Google Cloud console → promotions-planner → APIs &amp; Services → Library → <b>Google Search Console API</b> → Enable; then Search Console → the ambassadorcruiseline.com property → Settings → Users and permissions → Add user → the tracker's <code>firebase-adminsdk-…@promotions-planner.iam.gserviceaccount.com</code> address, <b>Restricted</b>. It's read at the next UK day's first check.</p></div>`;
}

function search(el){
  if (!GSC || !(GSC.queries || []).length) { el.innerHTML = setupNote(); return; }
  const pages = GSC.pages || [], days = GSC.days || 90, perMonth = 30 / days;
  // 1. Quick wins: on page 1–2 (average position 4–20) with enough impressions, or top 3 with a click rate well below
  // what that position usually gets (a title or description problem)
  const wins = [];
  for (const [q, c, i, pos, pi] of GSC.queries) {
    if (!st.brand && BRAND.test(q)) continue;
    const ctr = i ? c / i : 0;
    let kind = "", extra = 0;
    if (pos >= 4 && pos <= 20 && i >= 100) { kind = "rank"; extra = i * perMonth * Math.max(0, expCtr(3) - ctr); }
    else if (pos < 4 && i >= 200 && ctr < expCtr(pos) * 0.5) { kind = "ctr"; extra = i * perMonth * (expCtr(pos) - ctr); }
    if (!kind || extra < 3 || (st.kind !== "all" && st.kind !== kind)) continue;
    wins.push({q, c, i, pos, ctr, kind, extra, page: pages[(pi || [])[0]] || ""});
  }
  wins.sort((a, b) => b.extra - a.extra);
  const why = w => w.kind === "rank" ? (w.pos <= 10 ? "lower half of page 1: a better page could reach the top 3" : "page 2: close to page 1") : "top 3 but few clicks: check its title and description";
  const winRows = wins.slice(0, st.qShown).map(w => `<tr><td style="white-space:normal"><b>${esc(w.q)}</b><div class="sub">${esc(why(w))}</div></td>
    <td style="white-space:normal">${w.page ? `<a href="${esc(w.page)}" target="_blank" rel="noopener">${esc(path(w.page))}</a>` : "–"}</td>
    <td class="num">${n0(w.i)}</td><td class="num">${n0(w.c)}</td><td class="num">${pct(w.ctr)}</td><td class="num">${w.pos.toFixed(1)}</td><td class="num"><b>+${n0(w.extra)}</b></td></tr>`).join("");

  // 2. Pages losing (and gaining) clicks
  const S = GSC.page_stats || {}, P = GSC.periods || {}, cur = st.win, prev = "p" + st.win, min = st.win === "w" ? 5 : 15;
  const moves = Object.entries(S).map(([u, v]) => { const a = v[cur] || [0, 0, null], b = v[prev] || [0, 0, null];
    return {u, c: a[0], i: a[1], p: a[2], pc: b[0], pi: b[1], pp: b[2], d: a[0] - b[0]}; }).filter(m => Math.max(m.c, m.pc) >= min);
  const reason = m => {
    const dp = m.p != null && m.pp != null ? m.p - m.pp : 0, di = m.pi ? m.i / m.pi - 1 : 0;
    if (!m.c && !m.i) return "no longer showing in search";
    if (dp >= 1.5) return `ranking fell (position ${m.pp.toFixed(1)} → ${m.p.toFixed(1)})`;
    if (dp <= -1.5) return `ranking rose (position ${m.pp.toFixed(1)} → ${m.p.toFixed(1)})`;
    if (Math.abs(di) >= .2) return `${di < 0 ? "fewer" : "more"} searches (impressions ${di > 0 ? "+" : "−"}${Math.abs(Math.round(di * 100))}%), position about the same`;
    return "click rate changed: same position and searches";
  };
  const lost = moves.filter(m => m.d < 0).sort((a, b) => a.d - b.d).slice(0, 25), won = moves.filter(m => m.d > 0).sort((a, b) => b.d - a.d).slice(0, 10);
  const mvRow = m => `<tr><td style="white-space:normal"><a href="${esc(m.u)}" target="_blank" rel="noopener">${esc(path(m.u))}</a><div class="sub">${esc(reason(m))}</div></td>
    <td class="num">${n0(m.pc)} → <b>${n0(m.c)}</b></td><td class="num" style="color:${m.d < 0 ? "var(--warn)" : "var(--ok, #1a7f26)"}">${m.d > 0 ? "+" : "−"}${n0(Math.abs(m.d))}${m.pc ? ` (${m.d > 0 ? "+" : "−"}${Math.abs(Math.round(m.d / m.pc * 100))}%)` : ""}</td>
    <td class="num">${n0(m.pi)} → ${n0(m.i)}</td><td class="num">${m.pp != null ? m.pp.toFixed(1) : "–"} → ${m.p != null ? m.p.toFixed(1) : "–"}</td></tr>`;
  const mvHead = `<thead><tr><th>Page</th><th class="num">Clicks</th><th class="num">Change</th><th class="num">Impressions</th><th class="num">Position</th></tr></thead>`;
  const span = k => P[k] ? `${day(P[k][0])} – ${day(P[k][1])}` : "";

  el.innerHTML = `<p class="note" style="margin:0 0 12px">From Google Search Console (${esc(GSC.site || "")}), read ${esc(day(GSC.read_on))}: searches over ${day(GSC.start)} – ${day(GSC.end)} (Google's figures lag 2 days). Read-only.</p>
    <h3 style="margin:6px 0 8px;font-size:15px">Quick wins</h3>
    <div class="controls"><select id="sh-kind" aria-label="Kind"><option value="all">Both kinds</option><option value="rank"${st.kind === "rank" ? " selected" : ""}>Position 4–20: move up</option><option value="ctr"${st.kind === "ctr" ? " selected" : ""}>Top 3, few clicks: fix the title</option></select>
      <label class="sub"><input type="checkbox" id="sh-brand"${st.brand ? " checked" : ""}> Include searches for our name and ships</label>
      <button type="button" class="linkbtn" id="sh-csv">Download CSV</button></div>
    ${wins.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Search</th><th>Our page</th><th class="num">Impressions</th><th class="num">Clicks</th><th class="num">Click rate</th><th class="num">Position</th><th class="num">More clicks a month</th></tr></thead><tbody>${winRows}</tbody></table></div>
      ${wins.length > st.qShown ? `<button type="button" class="linkbtn" id="sh-more">Show more (${wins.length - st.qShown})</button>` : ""}
      <p class="note">Over ${days} days. "More clicks a month" is a rough guide: what the search would bring at a typical top-3 click rate (or, for one already in the top 3, at a typical rate for its position), from a general click-rate curve, not Google's figure. Use the page creator's "Use as keyword" to build a page for one.</p>`
      : `<div class="empty"><p>No quick wins with these settings.</p></div>`}
    <h3 style="margin:22px 0 8px;font-size:15px">Pages losing traffic</h3>
    <div class="controls"><div class="seg" role="group" aria-label="Period">${[["w", "Last 7 days vs the 7 before"], ["m", "Last 28 days vs the 28 before"]].map(([k, t]) => `<button type="button" data-win="${k}" aria-pressed="${st.win === k}">${t}</button>`).join("")}</div>
      <span class="sub">${esc(span(cur))} against ${esc(span(prev))}</span></div>
    ${!GSC.page_stats ? `<div class="empty"><p>Page figures arrive with the next daily read.</p></div>`
      : lost.length ? `<div class="tablewrap"><table class="ptable">${mvHead}<tbody>${lost.map(mvRow).join("")}</tbody></table></div>` : `<div class="empty"><p>No page lost clicks.</p></div>`}
    ${won.length ? `<details style="margin-top:10px"><summary class="sub">${won.length} page${won.length === 1 ? "" : "s"} gaining the most</summary><div class="tablewrap"><table class="ptable">${mvHead}<tbody>${won.map(mvRow).join("")}</tbody></table></div></details>` : ""}
    ${GSC.page_stats ? `<p class="note">Pages with at least ${min} clicks in one of the two periods. The reason is a guide: a fall in position points at the page or a competitor; fewer impressions at the same position usually means fewer people searching (season, demand).</p>` : ""}`;
  const re = () => search(el);
  el.querySelector("#sh-kind").addEventListener("change", e => { st.kind = e.target.value; st.qShown = 50; save(); re(); });
  el.querySelector("#sh-brand").addEventListener("change", e => { st.brand = e.target.checked; st.qShown = 50; save(); re(); });
  el.querySelectorAll("[data-win]").forEach(b => b.addEventListener("click", () => { st.win = b.dataset.win; save(); re(); }));
  const more = el.querySelector("#sh-more"); more && more.addEventListener("click", () => { st.qShown += 50; re(); });
  el.querySelector("#sh-csv").addEventListener("click", () => csvDownload(`seo-quick-wins-${GSC.read_on}.csv`,
    ["Search", "Page", "Impressions", "Clicks", "Click rate", "Position", "Kind", "More clicks a month (rough)"],
    wins.map(w => [w.q, w.page, w.i, w.c, (w.ctr * 100).toFixed(1) + "%", w.pos, w.kind === "rank" ? "move up" : "fix title/description", Math.round(w.extra)])));
}

// ---------- Site health ----------
const ISSUES = [
  ["title_dup", "Title used on another page", "fix"], ["title_long", "Title over 60 characters (cut off in Google)", "look"],
  ["title_short", "Title under 30 characters", "look"], ["title_none", "No title", "fix"],
  ["desc_none", "No meta description", "fix"], ["desc_long", "Meta description over 160 characters", "look"],
  ["desc_short", "Meta description under 70 characters", "look"], ["desc_dup", "Meta description used on another page", "look"],
  ["h1_none", "No H1 heading", "fix"], ["h1_many", "More than one H1", "look"], ["noindex", "In the sitemap but set to noindex", "fix"],
  ["canon", "Canonical points to another page", "look"], ["schema", "No structured data", "look"], ["status", "Doesn't load (error)", "fix"],
];
const ISSUE = Object.fromEntries(ISSUES.map(([k, l, s]) => [k, {l, s}]));
const normT = t => (t || "").split("|")[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sectionOf = p => p === "/" ? "home" : p.split("/")[1] || "home";

function audit(){
  const P = (PAGES && PAGES.pages) || {}, byT = {}, byD = {}, out = [];
  for (const [p, v] of Object.entries(P)) if (v.s === 200) {
    if (v.t) (byT[normT(v.t)] = byT[normT(v.t)] || []).push(p);
    if (v.d) (byD[v.d.trim().toLowerCase()] = byD[v.d.trim().toLowerCase()] || []).push(p);
  }
  for (const [p, v] of Object.entries(P)) {
    const is = [];
    if (v.s !== 200) is.push("status");
    else {
      if (!v.t) is.push("title_none"); else {
        if (byT[normT(v.t)].length > 1) is.push("title_dup");
        if (v.t.length > 60) is.push("title_long"); else if (v.t.length < 30) is.push("title_short");
      }
      if (!v.d) is.push("desc_none"); else {
        if (v.d.length > 160) is.push("desc_long"); else if (v.d.length < 70) is.push("desc_short");
        if (byD[v.d.trim().toLowerCase()].length > 1) is.push("desc_dup");
      }
      if ("hn" in v) { if (!v.hn) is.push("h1_none"); else if (v.hn > 1) is.push("h1_many"); } else if (!v.h) is.push("h1_none");
      if (v.n) is.push("noindex");
      if (v.c) is.push("canon");
      if ("hn" in v && !(v.j || []).length) is.push("schema");
    }
    out.push({p, v, is, sec: sectionOf(p)});
  }
  const dups = Object.values(byT).filter(ps => ps.length > 1).sort((a, b) => b.length - a.length);
  return {rows: out, dups};
}

function health(el){
  if (!PAGES || !PAGES.pages) { el.innerHTML = `<div class="empty"><p>The website's pages haven't been read yet: they're read once a UK day.</p></div>`; return; }
  const {rows, dups} = audit(), nf = (COV && COV.not_found) || [];
  const count = k => rows.filter(r => r.is.includes(k)).length;
  const withSchema = rows.filter(r => (r.v.j || []).length).length;
  const tiles = [["404s in the sitemap", nf.length, nf.length ? "poor" : "good"], ["Titles used more than once", dups.length, dups.length ? "poor" : "good"],
    ["Titles cut off in Google", count("title_long"), count("title_long") ? "ni" : "good"], ["Missing meta descriptions", count("desc_none"), count("desc_none") ? "poor" : "good"],
    ["Pages without an H1", count("h1_none"), count("h1_none") ? "poor" : "good"], ["Pages with structured data", `${withSchema} of ${rows.length}`, withSchema ? "good" : "poor"]]
    .map(([l, v, r]) => `<div class="cw-tile ${r}"><span class="cw-l">${esc(l)}</span><b>${esc(String(v))}</b></div>`).join("");
  const secs = [...new Set(rows.map(r => r.sec))].sort();
  // structured data is missing everywhere (its own section above): it only lists a page when picked as the issue
  const shownIs = r => st.issue === "schema" ? r.is : r.is.filter(k => k !== "schema");
  const list = rows.filter(r => shownIs(r).length && (!st.issue || r.is.includes(st.issue)) && (!st.section || r.sec === st.section))
    .sort((a, b) => b.is.filter(k => ISSUE[k].s === "fix").length - a.is.filter(k => ISSUE[k].s === "fix").length || b.is.length - a.is.length || a.p.localeCompare(b.p));
  const shown = list.slice(0, st.qShown);
  const chip = k => `<span class="chip" style="font-weight:500${ISSUE[k].s === "fix" ? ";border-color:var(--warn);color:var(--warn)" : ""}">${esc(ISSUE[k].l)}</span>`;
  const nfRows = nf.slice().sort((a, b) => (a.id || a.url).localeCompare(b.id || b.url));

  el.innerHTML = `<p class="note" style="margin:0 0 12px">${Object.keys(PAGES.pages).length} pages from the website's sitemap (every page except the sailing pages), read ${esc(day(PAGES.read_on))}, each re-read weekly; 404s from the weekly sitemap check (${esc(day(COV && COV.checked))}). Read-only.</p>
    <div class="cw-tiles" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${tiles}</div>

    <h3 style="margin:22px 0 8px;font-size:15px">Structured data</h3>
    <p class="note" style="margin:0">${withSchema ? `${withSchema} of ${rows.length} pages carry structured data.` : `<b>None of the ${rows.length} pages carries structured data</b> (schema.org JSON-LD), and the sailing pages have none either.`} It lets Google show richer results: the FAQs under a result (<i>FAQPage</i> on the FAQ and landing pages), breadcrumbs (<i>BreadcrumbList</i>), the logo and contact details (<i>Organization</i> on the home page), article dates and pictures (<i>BlogPosting</i> on blog posts) and sailings with dates and prices (<i>ItemList</i> / <i>Product</i> on landing and sailing pages). The page creator's "Copy schema" makes it for new pages; adding it to the site's templates in Storyblok/Astro covers every page at once (one for the web developers).</p>

    <h3 style="margin:22px 0 8px;font-size:15px">Pages in the sitemap that return 404 <span class="sub">(${nf.length})</span></h3>
    ${nf.length ? `<p class="note" style="margin:0 0 8px">Mostly past sailings still listed. Search engines waste visits on them and they look like broken links: take them out of the sitemap, or redirect each to a similar sailing on sale.</p>
      <details><summary class="sub">Show all ${nf.length}</summary><div class="tablewrap"><table class="ptable"><thead><tr><th>Page</th><th>First spotted</th></tr></thead><tbody>
      ${nfRows.map(x => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(path(x.url))}</a></td><td>${day(x.first_seen)}</td></tr>`).join("")}</tbody></table></div></details>`
      : `<div class="empty"><p>None.</p></div>`}

    <h3 style="margin:22px 0 8px;font-size:15px">Titles used on more than one page <span class="sub">(${dups.length})</span></h3>
    ${dups.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Title</th><th class="num">Pages</th><th>Pages</th></tr></thead><tbody>
      ${dups.map(ps => `<tr><td style="white-space:normal"><b>${esc(PAGES.pages[ps[0]].t)}</b></td><td class="num">${ps.length}</td><td style="white-space:normal">${ps.slice(0, 6).map(p => `<a href="${SITE}${esc(p)}" target="_blank" rel="noopener">${esc(p)}</a>`).join("<br>")}${ps.length > 6 ? `<div class="sub">and ${ps.length - 6} more</div>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">Google can't tell these pages apart from their titles, and they compete with each other. Give each its own title.</p>` : `<div class="empty"><p>None.</p></div>`}

    <h3 style="margin:22px 0 8px;font-size:15px">Every page with something to fix</h3>
    <div class="controls"><select id="sh-issue" aria-label="Issue"><option value="">Any issue</option>${ISSUES.map(([k, l]) => { const n = count(k); return n ? `<option value="${k}"${st.issue === k ? " selected" : ""}>${esc(l)} (${n})</option>` : ""; }).join("")}</select>
      <select id="sh-sec" aria-label="Section"><option value="">Every section</option>${secs.map(s => `<option value="${esc(s)}"${st.section === s ? " selected" : ""}>/${esc(s === "home" ? "" : s + "/")}</option>`).join("")}</select>
      <button type="button" class="linkbtn" id="sh-hcsv">Download CSV</button><span class="sub">${list.length} page${list.length === 1 ? "" : "s"}</span></div>
    ${shown.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Page</th><th>Title and description</th><th>Issues</th></tr></thead><tbody>
      ${shown.map(r => `<tr><td style="white-space:normal"><a href="${SITE}${esc(r.p)}" target="_blank" rel="noopener">${esc(r.p)}</a>${r.v.c ? `<div class="sub">canonical: ${esc(r.v.c)}</div>` : ""}</td>
        <td style="white-space:normal"><b>${esc(r.v.t || "(no title)")}</b> <span class="sub">${(r.v.t || "").length}</span><div class="sub">${esc(r.v.d || "(no description)")} ${r.v.d ? `<span>${r.v.d.length}</span>` : ""}</div></td>
        <td style="white-space:normal">${shownIs(r).map(chip).join(" ")}</td></tr>`).join("")}</tbody></table></div>
      ${list.length > st.qShown ? `<button type="button" class="linkbtn" id="sh-more">Show more (${list.length - st.qShown})</button>` : ""}
      <p class="note">Red ones are worth fixing first. Lengths are characters (Google cuts titles at about 60 and descriptions at about 155–160).</p>`
      : `<div class="empty"><p>No pages match.</p></div>`}`;
  const re = () => health(el);
  el.querySelector("#sh-issue").addEventListener("change", e => { st.issue = e.target.value; st.qShown = 50; save(); re(); });
  el.querySelector("#sh-sec").addEventListener("change", e => { st.section = e.target.value; st.qShown = 50; save(); re(); });
  const more = el.querySelector("#sh-more"); more && more.addEventListener("click", () => { st.qShown += 50; re(); });
  el.querySelector("#sh-hcsv").addEventListener("click", () => csvDownload(`site-health-${PAGES.read_on}.csv`,
    ["Page", "Title", "Title length", "Description", "Description length", "H1", "H1s", "Structured data", "Canonical elsewhere", "Noindex", "Issues"],
    list.map(r => [SITE + r.p, r.v.t, (r.v.t || "").length, r.v.d, (r.v.d || "").length, r.v.h, r.v.hn ?? "", (r.v.j || []).join("; "), r.v.c || "", r.v.n ? "yes" : "", r.is.map(k => ISSUE[k].l).join("; ")])));
}
