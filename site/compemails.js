// Competitor emails: the email library (Sam, 15 Oct 2026: "a library of competitor emails to be able to view,
// filter, compare etc for the email team"). Every competitor email that reaches the team mailbox (offers_inbox.py),
// kept two years: a thumbnail grid or list with filters (brand, type, destination, period, offers, words), each
// brand's sending pattern (how often, which days, what time, how many with an offer), a viewer showing the email
// itself at desktop or phone width with what Claude (or the rules) found in it, and side-by-side comparison of up
// to 4 emails. Data: pricewatch/comp-inbox (`parts`) and pricewatch/comp-emails-YYYY-MM-1/-2 (publish.py).
//
// The emails are the brands' own HTML, so they're shown in a sandboxed frame: no scripts, nothing it can reach on
// this page, only its pictures, styles and fonts (CSP below, as offers_inbox.py uses for the thumbnails); offers_inbox.py
// has already removed scripts, forms, tracking pixels and switched off the unsubscribe links. Links open the brand's
// site in a new tab. Its pictures load from the brand's servers.
const KEY = "spw-comp-emails";
const KINDS = ["offer", "new itineraries", "last minute", "inspiration", "newsletter", "event", "welcome or account", "other"];
const NAMES = {po: "P&O Cruises", princess: "Princess Cruises", cunard: "Cunard", marella: "Marella Cruises", saga: "Saga",
  fredolsen: "Fred. Olsen", msc: "MSC Cruises", royal: "Royal Caribbean", celebrity: "Celebrity Cruises", ambassador: "Ambassador (ours)"};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CSP = "default-src 'none'; img-src https: http: data: cid:; style-src 'unsafe-inline' https:; font-src https: data:; form-action 'none'";
const MAXCMP = 4, PAGE = 60;
let E = null, meta = null, loading = null, esc, box;
let shown = PAGE, picked = [];
const st = {q: "", line: "", kind: "", dest: "", days: "90", offer: "", sort: "new", view: "grid"};
const htmlCache = new Map();

const brand = l => NAMES[l] || l || "";
const safeUrl = u => /^https:\/\//i.test(u || "");
const LON = new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false});
const parts = iso => Object.fromEntries(LON.formatToParts(new Date(iso)).map(p => [p.type, p.value]));
const when = iso => { const p = parts(iso); return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`; };
const shortDay = iso => { const p = parts(iso); return `${p.day} ${p.month} ${p.year}`; };
const dow = iso => DAYS.indexOf(parts(iso).weekday);
const hourOf = iso => { const p = parts(iso); return +p.hour + p.minute / 60; };
const gbp = n => n == null ? "" : "£" + Math.round(n).toLocaleString("en-GB");
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){} };

function css(){
  if (document.getElementById("ce-css")) return;
  const s = document.createElement("style"); s.id = "ce-css";
  s.textContent = `
.ce-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.ce-card{border:1px solid var(--rule);background:var(--bg);display:flex;flex-direction:column;min-width:0;position:relative}
.ce-card.pick{outline:2px solid var(--allium);outline-offset:-2px}
.ce-card button.open{all:unset;cursor:pointer;display:flex;flex-direction:column;min-width:0}
.ce-card button.open:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.ce-thumb{height:240px;overflow:hidden;background:var(--bg-alt);border-bottom:1px solid var(--rule)}
.ce-thumb img{display:block;width:100%;height:auto}
.ce-meta{padding:9px 11px 4px;display:flex;flex-direction:column;gap:3px;min-width:0}
.ce-meta .b{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.ce-meta .s{font-weight:600;font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ce-meta .p{font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ce-chips{padding:4px 11px 10px;display:flex;flex-wrap:wrap;gap:4px}
.ce-chips .chip{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.chip.k{border-color:var(--rule);background:var(--chip);color:var(--chip-ink)}
.ce-pickbox{position:absolute;top:6px;right:6px;background:var(--bg);border:1px solid var(--rule);padding:3px 7px;font-size:12px;display:flex;gap:5px;align-items:center;cursor:pointer}
.ce-bar{position:sticky;bottom:0;z-index:5;background:var(--palatyn);color:#fff;padding:10px 14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:14px}
.ce-bar .linkbtn{color:#fff}
.ce-bar .go{font:inherit;font-weight:600;font-size:13px;background:var(--amber);color:var(--palatyn);border:0;padding:7px 14px;cursor:pointer}
.ce-heat td.h{text-align:center;font-size:12px;min-width:30px;padding:6px 4px}
dialog.ce{width:min(1240px,calc(100% - 32px));height:calc(100% - 32px);max-height:none;border:1px solid var(--rule);padding:0;background:var(--bg);color:var(--ink)}
dialog.ce[open]{display:flex;flex-direction:column}
dialog.ce::backdrop{background:rgba(20,5,25,.6)}
.ce-head{display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--rule);flex-wrap:wrap}
.ce-head h3{margin:0;font-size:16px;flex:1 1 300px;min-width:0}
.ce-head .sub{color:var(--muted);font-size:13px;font-weight:400}
.ce-btn{font:inherit;font-size:13px;font-weight:600;padding:6px 11px;background:var(--bg);color:var(--ink);border:1px solid var(--rule);cursor:pointer}
.ce-btn[aria-pressed=true]{background:var(--allium);color:#fff;border-color:var(--allium)}
.ce-body{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0}
.ce-frame{overflow:auto;background:var(--bg-alt);display:flex;justify-content:center;padding:14px}
.ce-frame iframe{border:0;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.15);height:100%;min-height:600px;flex:none}
.ce-side{overflow:auto;padding:14px 16px;border-left:1px solid var(--rule);font-size:14px}
.ce-side dl{margin:0;display:grid;grid-template-columns:96px 1fr;gap:6px 10px}
.ce-side dt{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:2px}
.ce-side dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ce-side ul{margin:0;padding-left:18px}
.ce-cmp{flex:1;overflow:auto;padding:14px}
.ce-cmp .cols{display:grid;gap:12px}
.ce-cmp .col{min-width:0}
.ce-cmp .win{height:62vh;overflow:auto;background:var(--bg-alt);border:1px solid var(--rule)}
.ce-cmp .win iframe{border:0;background:#fff;transform-origin:0 0;display:block}
.ce-cmp table td{vertical-align:top;font-size:13px;overflow-wrap:anywhere}
@media (max-width:860px){.ce-body{display:block;overflow:auto}.ce-side{border-left:0;border-top:1px solid var(--rule)}.ce-frame{padding:8px;height:75vh}.ce-frame iframe{min-height:0}}
@media (max-width:560px){dialog.ce{width:100%;height:100%;max-width:100%;margin:0}.ce-frame{padding:0}.ce-frame iframe{max-width:100%}.ce-head{padding:10px 12px;gap:6px}.ce-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ce-thumb{height:180px}.ce-pickbox span{display:none}}`;
  document.head.appendChild(s);
}

// What the frame shows: the email, under a rule letting it load only pictures, styles and fonts; links to new tabs;
// switched-off unsubscribe links greyed out
const srcdoc = h => `<meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank">`
  + `<style>a[data-spw-off]{pointer-events:none;opacity:.45;cursor:not-allowed}</style>` + h;
const frame = (w, label) => `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="${esc(label)}" style="width:${w}px"></iframe>`;
async function emailHtml(e){
  if (htmlCache.has(e.id)) return htmlCache.get(e.id);
  const r = await fetch(e.html);
  if (!r.ok) throw new Error(`the saved copy couldn't be read (${r.status})`);
  const t = await r.text();
  if (htmlCache.size > 16) htmlCache.delete(htmlCache.keys().next().value);
  htmlCache.set(e.id, t);
  return t;
}
async function fill(iframe, e){
  try { iframe.srcdoc = srcdoc(await emailHtml(e)); }
  catch (x) { iframe.srcdoc = `<p style="font:14px sans-serif;padding:20px">${esc(x.message)}. ${safeUrl(e.view) ? "Try the brand's own web version (View in browser)." : ""}</p>`; }
}

export async function mount(el, c){
  box = el; esc = c.esc; css();
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e){}
  if (!E){
    box.innerHTML = `<p class="loading">Loading competitor emails…</p>`;
    loading = loading || c.readJson("comp-inbox").then(async inbox => {
      const docs = await Promise.all((inbox.parts || []).map(p => c.readJson("comp-emails-" + p).catch(() => ({emails: []}))));
      return [inbox, docs.flatMap(d => d.emails || [])];
    }).catch(() => [null, []]);
    [meta, E] = await loading;
    E.sort((a, b) => b.date.localeCompare(a.date));
    if (!meta) { loading = null; E = null; }
  }
  render();
}

function filtered(ignoreLine){
  const since = st.days === "all" ? "" : new Date(Date.now() - +st.days * 864e5).toISOString().slice(0, 19);
  const q = st.q.trim().toLowerCase();
  let l = (E || []).filter(e => e.date >= since && (ignoreLine || !st.line || e.line === st.line)
    && (!st.kind || e.kind === st.kind) && (!st.dest || (e.destinations || []).includes(st.dest))
    && (!st.offer || (st.offer === "yes") === !!e.promotion)
    && (!q || [e.subject, e.preheader, e.headline, e.summary, e.cta, brand(e.line), ...(e.destinations || []), ...(e.offers || []).map(o => o.offer)]
      .join(" ").toLowerCase().includes(q)));
  if (st.sort === "old") l = l.slice().reverse();
  if (st.sort === "brand") l = l.slice().sort((a, b) => brand(a.line).localeCompare(brand(b.line)) || b.date.localeCompare(a.date));
  if (st.sort === "price") l = l.slice().sort((a, b) => (a.from_price ?? 1e9) - (b.from_price ?? 1e9));
  return l;
}

function patterns(list){
  const by = {};
  for (const e of list) (by[e.line] = by[e.line] || []).push(e);
  const span = Math.max(1, (st.days === "all" ? (Date.now() - Date.parse(list.at(-1)?.date || Date.now())) / 864e5 : +st.days) / 7);
  const rows = Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([l, es]) => {
    const days = DAYS.map((_, i) => es.filter(e => dow(e.date) === i).length);
    const hrs = es.map(e => hourOf(e.date)).sort((a, b) => a - b), mid = hrs[Math.floor(hrs.length / 2)];
    const kinds = {}; es.forEach(e => kinds[e.kind || "other"] = (kinds[e.kind || "other"] || 0) + 1);
    const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ${Math.round(n / es.length * 100)}%`).join(", ");
    const max = Math.max(...days);
    const cell = n => `<td class="h" style="background:${n ? `color-mix(in srgb, var(--allium) ${Math.round(12 + 70 * n / max)}%, var(--bg))` : "transparent"};color:${n / max > .55 ? "#fff" : "var(--ink)"}">${n || ""}</td>`;
    return `<tr><td><b>${esc(brand(l))}</b></td><td class="num">${es.length}</td><td class="num">${(es.length / span).toFixed(1)}</td>
      <td class="num">${Math.round(es.filter(e => e.promotion).length / es.length * 100)}%</td>${days.map(cell).join("")}
      <td>${mid == null ? "–" : `${String(Math.floor(mid)).padStart(2, "0")}:${String(Math.round(mid % 1 * 60)).padStart(2, "0")}`}</td>
      <td class="sub">${esc(top)}</td><td>${shortDay(es[0].date)}</td></tr>`;
  });
  return rows.length ? `<details open style="margin:0 0 18px"><summary style="cursor:pointer;font-weight:600">How each brand sends</summary>
    <div class="tablewrap"><table class="ptable ce-heat"><thead><tr><th>Brand</th><th class="num">Emails</th><th class="num">A week</th><th class="num">With an offer</th>
    ${DAYS.map(d => `<th style="text-align:center">${d}</th>`).join("")}<th>Usual time</th><th>Mostly</th><th>Latest</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
    <p class="note" style="margin-top:4px">For the period and filters chosen (every brand, whichever is picked above). Days and times are UK time, when the email reached the mailbox. "Usual time" is the middle send time.</p></details>` : "";
}

function chips(e){
  const o = (e.offers || [])[0];
  return `<span class="chip k">${esc(e.kind || "other")}</span>${e.from_price ? `<span class="chip">from ${gbp(e.from_price)}</span>` : ""}`
    + (o ? `<span class="chip" title="${esc(o.offer)}">${esc(o.offer.length > 40 ? o.offer.slice(0, 38) + "…" : o.offer)}</span>` : "");
}

function render(){
  if (!E) {
    box.innerHTML = `<div class="empty"><p><b>The email library starts once the newsletter inbox is set up.</b> Every competitor email that reaches
      the team mailbox appears here within the hour, with a picture of it, and is kept for two years (CLAUDE.md, "Competitor offers: newsletters and live ads").</p></div>`;
    return;
  }
  const list = filtered(false);
  const dests = [...new Set(E.flatMap(e => e.destinations || []))].sort();
  const lines = [...new Set(E.map(e => e.line))].sort((a, b) => brand(a).localeCompare(brand(b)));
  const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  box.innerHTML = `<p class="note" style="margin:0 0 12px">Every email the competitors send to our team mailbox, as their subscribers get it, kept for two years. Click one to read it at desktop or phone width; tick up to ${MAXCMP} to compare them side by side.
      Type, summary, destinations and prices are picked out by Claude (or simple rules, marked "check"). Mailbox last read ${esc(meta.fetched_at ? when(meta.fetched_at) : "–")}.</p>
    <div class="controls">
      <input type="search" id="ce-q" placeholder="Search subject lines, offers, destinations" value="${esc(st.q)}" aria-label="Search the emails">
      <select id="ce-line" aria-label="Brand">${opt("", st.line, "All brands")}${lines.map(l => opt(l, st.line, brand(l))).join("")}</select>
      <select id="ce-kind" aria-label="Type">${opt("", st.kind, "All types")}${KINDS.map(k => opt(k, st.kind, k[0].toUpperCase() + k.slice(1))).join("")}</select>
      <select id="ce-dest" aria-label="Destination">${opt("", st.dest, "All destinations")}${dests.map(d => opt(d, st.dest, d)).join("")}</select>
      <select id="ce-offer" aria-label="Offers">${opt("", st.offer, "With or without offers")}${opt("yes", st.offer, "With an offer")}${opt("no", st.offer, "No offer")}</select>
      <select id="ce-days" aria-label="Received">${opt("30", st.days, "Last 30 days")}${opt("90", st.days, "Last 90 days")}${opt("365", st.days, "Last 12 months")}${opt("all", st.days, "All (2 years)")}</select>
      <select id="ce-sort" aria-label="Sort">${opt("new", st.sort, "Newest first")}${opt("old", st.sort, "Oldest first")}${opt("brand", st.sort, "By brand")}${opt("price", st.sort, "Lowest price first")}</select>
      <div class="seg" role="group" aria-label="Show as"><button type="button" data-v="grid" aria-pressed="${st.view === "grid"}">Pictures</button><button type="button" data-v="list" aria-pressed="${st.view === "list"}">List</button></div>
      <button type="button" class="linkbtn" id="ce-csv">Download CSV</button>
    </div>
    ${patterns(filtered(true))}
    ${!list.length ? `<div class="empty"><p>${E.length ? "No emails match these filters." : "No competitor emails yet: they appear here within an hour of reaching the mailbox."}</p></div>`
      : st.view === "grid" ? `<div class="ce-grid">${list.slice(0, shown).map(e => `
        <div class="ce-card${picked.includes(e.id) ? " pick" : ""}">
          <button type="button" class="open" data-open="${esc(e.id)}" aria-label="Open ${esc(brand(e.line))}: ${esc(e.subject)}">
            <div class="ce-thumb">${safeUrl(e.thumb) ? `<img loading="lazy" alt="" src="${esc(e.thumb)}">` : ""}</div>
            <div class="ce-meta"><span class="b">${esc(brand(e.line))} · ${shortDay(e.date)}</span><span class="s">${esc(e.subject)}</span><span class="p">${esc(e.preheader || "")}</span></div>
          </button>
          <div class="ce-chips">${chips(e)}</div>
          <label class="ce-pickbox"><input type="checkbox" data-pick="${esc(e.id)}"${picked.includes(e.id) ? " checked" : ""}><span>Compare</span></label>
        </div>`).join("")}</div>`
      : `<div class="tablewrap"><table class="ptable"><thead><tr><th></th><th>Sent</th><th>Brand</th><th>Email</th><th>Type</th><th>Offers</th><th class="num">From</th></tr></thead><tbody>
        ${list.slice(0, shown).map(e => `<tr><td><input type="checkbox" data-pick="${esc(e.id)}" aria-label="Compare"${picked.includes(e.id) ? " checked" : ""}></td>
          <td style="white-space:nowrap">${esc(when(e.date))}</td><td>${esc(brand(e.line))}</td>
          <td style="white-space:normal"><button type="button" class="linkbtn" style="color:var(--allium);text-align:left;font-weight:600" data-open="${esc(e.id)}">${esc(e.subject)}</button><div class="sub">${esc(e.preheader || "")}</div></td>
          <td>${esc(e.kind || "other")}${(e.destinations || []).length ? `<div class="sub">${esc(e.destinations.join(", "))}</div>` : ""}</td>
          <td style="white-space:normal">${(e.offers || []).slice(0, 2).map(o => esc(o.offer)).join("<br>") || "–"}</td><td class="num">${e.from_price ? gbp(e.from_price) : "–"}</td></tr>`).join("")}
        </tbody></table></div>`}
    ${list.length > shown ? `<p class="note">Showing ${shown} of ${list.length}. <button type="button" class="linkbtn" id="ce-more">Show more</button></p>` : list.length ? `<p class="note">${list.length} email${list.length === 1 ? "" : "s"}.</p>` : ""}
    ${picked.length ? `<div class="ce-bar"><b>${picked.length} chosen to compare</b><button type="button" class="go" id="ce-cmp"${picked.length < 2 ? " disabled" : ""}>Compare side by side</button>
      <button type="button" class="linkbtn" id="ce-clear">Clear</button>${picked.length < 2 ? `<span style="font-size:13px">Tick one more.</span>` : ""}</div>` : ""}`;
  wire(list);
}

function wire(list){
  const set = (k, v) => { st[k] = v; shown = PAGE; save(); render(); };
  const q = box.querySelector("#ce-q");
  q.addEventListener("input", () => { st.q = q.value; shown = PAGE; save(); clearTimeout(q._t); q._t = setTimeout(() => { render(); const n = box.querySelector("#ce-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  for (const k of ["line", "kind", "dest", "offer", "days", "sort"]) box.querySelector("#ce-" + k).addEventListener("change", ev => set(k, ev.target.value));
  box.querySelectorAll(".seg [data-v]").forEach(b => b.addEventListener("click", () => set("view", b.dataset.v)));
  box.querySelector("#ce-csv").addEventListener("click", () => csv(list));
  box.querySelector("#ce-more")?.addEventListener("click", () => { shown += PAGE; render(); });
  box.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => view(b.dataset.open, list)));
  box.querySelectorAll("[data-pick]").forEach(c => c.addEventListener("change", () => {
    const id = c.dataset.pick;
    picked = c.checked ? [...picked.filter(x => x !== id), id].slice(-MAXCMP) : picked.filter(x => x !== id);
    render();
  }));
  box.querySelector("#ce-clear")?.addEventListener("click", () => { picked = []; render(); });
  box.querySelector("#ce-cmp")?.addEventListener("click", compare);
}

function dialog(){
  let d = document.getElementById("ce-dlg");
  if (!d) { d = document.createElement("dialog"); d.id = "ce-dlg"; d.className = "ce"; document.body.appendChild(d);
    d.addEventListener("close", () => { d.innerHTML = ""; }); }
  return d;
}

function details(e){
  const links = (e.links || []).filter(l => safeUrl(l[1]));
  return `<dl>
    <dt>Brand</dt><dd>${esc(brand(e.line))}${e.sender ? `<div class="sub">${esc(e.sender)}</div>` : ""}</dd>
    <dt>Sent</dt><dd>${esc(when(e.date))} <span class="sub">UK</span></dd>
    <dt>Subject</dt><dd><b>${esc(e.subject)}</b> <button type="button" class="linkbtn" data-copy="${esc(e.subject)}">Copy</button><div class="sub">${e.subject.length} characters</div></dd>
    <dt>Preview text</dt><dd>${esc(e.preheader || "–")}</dd>
    <dt>Type</dt><dd>${esc(e.kind || "other")}${e.by === "rules" ? ` <span class="sub" title="Read by simple rules, not Claude">(rules: check)</span>` : ""}</dd>
    ${e.summary ? `<dt>About</dt><dd>${esc(e.summary)}</dd>` : ""}
    ${e.headline ? `<dt>Headline</dt><dd>${esc(e.headline)}</dd>` : ""}
    ${e.cta ? `<dt>Main button</dt><dd>${esc(e.cta)}</dd>` : ""}
    <dt>Places</dt><dd>${esc((e.destinations || []).join(", ") || "–")}</dd>
    <dt>From price</dt><dd>${e.from_price ? gbp(e.from_price) + " <span class='sub'>lowest quoted</span>" : "–"}</dd>
    <dt>Offers</dt><dd>${(e.offers || []).length ? `<ul>${e.offers.map(o => `<li>${esc(o.offer)}${o.applies_to ? ` <span class="sub">· ${esc(o.applies_to)}</span>` : ""}${o.ends ? ` <span class="chip">ends ${shortDay(o.ends + "T12:00:00Z")}</span>` : ""}${safeUrl(o.link) ? ` · <a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">Offer page</a>` : ""}</li>`).join("")}</ul>` : "none"}</dd>
    <dt>Size</dt><dd>${e.n_images ?? "–"} pictures · ${e.n_links ?? "–"} links${e.height ? ` · ${Math.round(e.height / 100) * 100} px long` : ""}</dd>
    ${links.length ? `<dt>Links</dt><dd><ul>${links.slice(0, 10).map(([w, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(w || new URL(u).hostname)}</a></li>`).join("")}</ul></dd>` : ""}
  </dl>
  <p class="note">${safeUrl(e.view) ? `<a href="${esc(e.view)}" target="_blank" rel="noopener noreferrer">View in browser</a> (the brand's own copy) · ` : ""}Links open the brand's site and count as a click for them. Unsubscribe links are switched off.</p>`;
}

function view(id, list){
  const i = list.findIndex(e => e.id === id), e = list[i];
  if (!e) return;
  const d = dialog();
  const w = d.dataset.w || "680";
  d.innerHTML = `<div class="ce-head"><h3>${esc(e.subject)} <span class="sub">· ${esc(brand(e.line))}, ${esc(shortDay(e.date))}</span></h3>
      <div class="seg" role="group" aria-label="Width"><button type="button" data-w="680" aria-pressed="${w === "680"}">Desktop</button><button type="button" data-w="390" aria-pressed="${w === "390"}">Phone</button></div>
      <button type="button" class="ce-btn" data-nav="-1"${i <= 0 ? " disabled" : ""} aria-label="Previous email">‹ Previous</button>
      <button type="button" class="ce-btn" data-nav="1"${i >= list.length - 1 ? " disabled" : ""} aria-label="Next email">Next ›</button>
      <label class="ce-btn" style="display:flex;gap:5px;align-items:center"><input type="checkbox" data-pickd${picked.includes(e.id) ? " checked" : ""}> Compare</label>
      <button type="button" class="ce-btn" data-close aria-label="Close">✕</button></div>
    <div class="ce-body"><div class="ce-frame">${frame(w, "Email: " + e.subject)}</div><div class="ce-side">${details(e)}</div></div>`;
  fill(d.querySelector("iframe"), e);
  d.querySelectorAll("[data-w]").forEach(b => b.addEventListener("click", () => { d.dataset.w = b.dataset.w; view(id, list); }));
  d.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => view(list[i + +b.dataset.nav].id, list)));
  d.querySelector("[data-close]").addEventListener("click", () => d.close());
  d.querySelector("[data-pickd]").addEventListener("change", ev => {
    picked = ev.target.checked ? [...picked.filter(x => x !== id), id].slice(-MAXCMP) : picked.filter(x => x !== id);
    render();
  });
  d.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "Copied"; })));
  if (!d.open) d.showModal();
}

function compare(){
  const es = picked.map(id => E.find(e => e.id === id)).filter(Boolean);
  if (es.length < 2) return;
  const d = dialog();
  const w = d.dataset.cw || "680";
  const row = (label, f) => `<tr><th scope="row" style="width:110px">${label}</th>${es.map(e => `<td>${f(e)}</td>`).join("")}</tr>`;
  d.innerHTML = `<div class="ce-head"><h3>Comparing ${es.length} emails</h3>
      <div class="seg" role="group" aria-label="Width"><button type="button" data-w="680" aria-pressed="${w === "680"}">Desktop</button><button type="button" data-w="390" aria-pressed="${w === "390"}">Phone</button></div>
      <button type="button" class="ce-btn" data-close aria-label="Close">✕</button></div>
    <div class="ce-cmp"><div class="cols" style="grid-template-columns:repeat(${es.length},minmax(0,1fr))">${es.map(e => `<div class="col">
        <p style="margin:0 0 6px;font-size:13px"><b>${esc(brand(e.line))}</b> · ${esc(shortDay(e.date))}</p>
        <div class="win">${frame(w, "Email: " + e.subject)}</div></div>`).join("")}</div>
      <div class="tablewrap" style="margin-top:14px"><table class="ptable"><tbody>
        ${row("Sent", e => esc(when(e.date)))}
        ${row("Subject", e => `<b>${esc(e.subject)}</b> <span class="sub">(${e.subject.length})</span>`)}
        ${row("Preview text", e => esc(e.preheader || "–"))}
        ${row("Type", e => esc(e.kind || "other"))}
        ${row("About", e => esc(e.summary || "–"))}
        ${row("Headline", e => esc(e.headline || "–"))}
        ${row("Main button", e => esc(e.cta || "–"))}
        ${row("Offers", e => (e.offers || []).map(o => esc(o.offer) + (o.ends ? ` <span class="chip">ends ${shortDay(o.ends + "T12:00:00Z")}</span>` : "")).join("<br>") || "none")}
        ${row("From price", e => e.from_price ? gbp(e.from_price) : "–")}
        ${row("Places", e => esc((e.destinations || []).join(", ") || "–"))}
        ${row("Size", e => `${e.n_images ?? "–"} pictures · ${e.n_links ?? "–"} links`)}
      </tbody></table></div></div>`;
  // Each email drawn at its real width, shrunk to fit its column
  const fit = () => d.querySelectorAll(".col").forEach((col, k) => {
    const f = col.querySelector("iframe"), s = Math.min(1, col.clientWidth / +w);
    f.style.transform = `scale(${s})`; f.style.height = `${Math.round(col.querySelector(".win").clientHeight / s)}px`;
  });
  d.querySelectorAll("iframe").forEach((f, k) => fill(f, es[k]));
  d.querySelectorAll("[data-w]").forEach(b => b.addEventListener("click", () => { d.dataset.cw = b.dataset.w; compare(); }));
  d.querySelector("[data-close]").addEventListener("click", () => d.close());
  if (!d.open) d.showModal();
  fit();
}

function csv(list){
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s) && !/^-?\d[\d,]*(\.\d+)?%?$/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [["Sent (UK)", "Day", "Brand", "Subject", "Subject length", "Preview text", "Type", "About", "Headline", "Main button",
    "Destinations", "From price £", "Offers", "Offer ends", "Pictures", "Links", "View in browser", "Read by"]]
    .concat(list.map(e => [when(e.date), DAYS[dow(e.date)], brand(e.line), e.subject, e.subject.length, e.preheader, e.kind, e.summary,
      e.headline, e.cta, (e.destinations || []).join("; "), e.from_price ?? "", (e.offers || []).map(o => o.offer).join("; "),
      (e.offers || []).map(o => o.ends).filter(Boolean).join("; "), e.n_images, e.n_links, e.view, e.by]));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n")], {type: "text/csv"}));
  a.download = `competitor-emails-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
