// France's Competitors pages (Sam, 16 Oct 2026: "go ahead and build it"), in the France market only:
//   prices  MSC and Costa itineraries from French ports at the agent Havas Voyages (competitors_fr.py): filters, price
//           per night, 7-day change, what changed, CSV
//   vs      Ambassador Croisières against them: typical price per night by area and length, and every itinerary against
//           our cheapest similar sailing
// Havas's pages show one "from" price per itinerary (the cheapest date and cabin) and no departure dates or cabin types,
// so the comparison is by area and length, not by month and cabin as in the UK. Read-only: pricewatch/fr-comp and
// fr-comp-runs beside our own saved French state. The tracker's screens stay in English.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEY = "spw-comp-fr";
const LINES = {msc: "MSC Croisières", costa: "Costa Croisières"};
const AREAS = {med: "French Mediterranean", north: "Northern and Atlantic France", antilles: "French Caribbean"};
// Our own departure ports → the same areas
const OUR_AREA = port => /dunkerque|le havre/i.test(port || "") ? "north" : /marseille|toulon|nice/i.test(port || "") ? "med"
  : /pointe|guadeloupe|martinique|fort-de-france/i.test(port || "") ? "antilles" : null;
const BANDS = [["short", "2–4 nights", n => n <= 4], ["week", "5–8 nights", n => n >= 5 && n <= 8], ["long", "9 nights or more", n => n >= 9]];
let C, R, our, esc, loading = null;
const st = {line: "", area: "", band: "", sort: "pn", vsSort: "gap"};

const eur = v => v == null ? "–" : "€" + Math.round(v).toLocaleString("en-GB");
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const isoDaysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const last = segs => segs && segs.length ? segs[segs.length - 1] : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bandOf = n => (BANDS.find(b => b[2](n || 0)) || [""])[0];
const lineName = k => LINES[k] || k;
const pct = (ours, theirs) => Math.round((ours / theirs - 1) * 100);
const pctCell = d => d == null ? "–" : `<span style="color:${d <= 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}%</span>`;
const diffWords = d => d === 0 ? "same" : `we're ${Math.abs(d)}% ${d < 0 ? "cheaper" : "dearer"}`;
const priceAt = (r, iso) => { let p = null; for (const s of r.prices || []) if (s.from <= iso) p = s.p; return p; };

// Competing itineraries still on sale, with their latest from price
const live = () => Object.entries(C.sailings || {}).filter(([, r]) => !r.gone && last(r.prices))
  .map(([id, r]) => { const p = last(r.prices).p; return {id, r, p, pn: r.nights ? p / r.nights : null}; });
const pick = x => (!st.line || x.r.line === st.line) && (!st.area || x.r.area === st.area) && (!st.band || bandOf(x.r.nights) === st.band);

// Ambassador Croisières' own sailings on sale (our saved state): the from price (cheapest twin cabin) per night
function ourSailings(state){
  const today = new Date().toISOString().slice(0, 10), out = [];
  for (const [id, s] of Object.entries(state.sailings || {})){
    const sg = last(s.segments);
    if (s.removed || !s.departure_date || s.departure_date <= today || !s.nights || !sg || sg.p == null) continue;
    const area = OUR_AREA(s.port);
    if (area) out.push({id, title: s.title, port: s.port, date: s.departure_date, nights: s.nights, area, p: sg.p, pn: sg.p / s.nights});
  }
  return out;
}
// Our cheapest per night in the same area within 3 nights' length (Havas gives no dates, so any departure date)
function ourMatch(r){
  const hits = our.filter(o => o.area === r.area && Math.abs(o.nights - (r.nights || 0)) <= 3);
  return hits.length ? {best: hits.reduce((a, o) => o.pn < a.pn ? o : a), n: hits.length} : null;
}

function controls(extra){
  const all = live();
  const opt = (k, v, l) => `<option value="${esc(v)}"${st[k] === v ? " selected" : ""}>${esc(l)}</option>`;
  return `<div class="controls">
    <select data-k="line" aria-label="Cruise line">${opt("line", "", "MSC and Costa")}${Object.keys(LINES).filter(k => all.some(x => x.r.line === k)).map(k => opt("line", k, LINES[k])).join("")}</select>
    <select data-k="area" aria-label="Departs from">${opt("area", "", "All French departures")}${Object.entries(AREAS).map(([k, l]) => opt("area", k, l)).join("")}</select>
    <select data-k="band" aria-label="Length">${opt("band", "", "Any length")}${BANDS.map(([k, l]) => opt("band", k, l)).join("")}</select>
    ${extra || ""}
  </div>`;
}
function wire(box, rerender){
  box.querySelectorAll("[data-k]").forEach(i => i.addEventListener("change", e => {
    st[i.dataset.k] = e.target.value; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e){}
    rerender();
  }));
}
function csvDownload(name, head, body){
  const q = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,]*(\.\d+)?%?$/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(q).join(",")).join("\r\n")], {type: "text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}
const source = () => `<p class="note" style="margin:0 0 12px">Read once a day from the travel agent <b>Havas Voyages</b> (havas-voyages.fr), which sells
  <b>MSC</b> and <b>Costa</b>: every itinerary that starts and ends at a French port (Marseille, Toulon, Le Havre…) or in the French Caribbean
  (Pointe-à-Pitre, Fort-de-France), as Ambassador Croisières' do. Havas shows one <b>"à partir de" price per person</b> for each itinerary: its cheapest
  date and cabin. Its pages don't show the dates or cabin types, so these can't be compared month by month. What's included can differ
  (Costa, for example, adds an onboard charge of about €11 a night). Last read ${esc(C.fetched_at ? C.fetched_at.slice(0, 16).replace("T", " ") + " UTC" : "–")}.
  The other French agents' terms don't allow this, and MSC's own site blocks it. Recorded only: nothing here changes a price or an ad.</p>`;
const where = r => r.start && r.end && r.start !== r.end ? `${esc(r.start)} → ${esc(r.end)}` : esc(r.start || "");

// ---------- Competitor prices ----------
function renderPrices(box){
  const wk = isoDaysAgo(7), all = live();
  const recent = ((R && R.runs) || []).filter(r => r.date >= wk).flatMap(r => r.changes.map(c => ({...c, date: r.date})));
  const moves = recent.filter(c => c.type === "price_drop" || c.type === "price_rise");
  const list = all.filter(pick).map(x => { const b = priceAt(x.r, wk); return {...x, chg: b != null && b !== x.p ? x.p - b : null}; })
    .sort((a, b) => st.sort === "p" ? a.p - b.p : st.sort === "chg" ? (a.chg ?? 0) - (b.chg ?? 0) : st.sort === "n" ? (a.r.nights || 0) - (b.r.nights || 0) : (a.pn ?? 1e9) - (b.pn ?? 1e9));
  const count = k => all.filter(x => x.r.area === k).length;
  box.innerHTML = source() + `
    <div class="stats" style="margin-bottom:18px">
      <div class="stat"><span class="k">Competing itineraries</span><span class="v">${all.length}</span><span class="s">${Object.keys(LINES).map(k => `${all.filter(x => x.r.line === k).length} ${LINES[k].split(" ")[0]}`).join(" · ")}</span></div>
      <div class="stat"><span class="k">By departure</span><span class="v">${count("med")}</span><span class="s">Mediterranean · ${count("antilles")} Caribbean · ${count("north")} northern France</span></div>
      <div class="stat"><span class="k">Price moves, 7 days</span><span class="v">${moves.length}</span><span class="s">${moves.filter(c => c.type === "price_drop").length} down · ${moves.filter(c => c.type === "price_rise").length} up</span></div>
    </div>
    ${controls(`<select data-k="sort" aria-label="Sort">${[["pn", "Cheapest per night"], ["p", "Cheapest"], ["n", "Shortest"], ["chg", "Biggest drop this week"]].map(([v, l]) => `<option value="${v}"${st.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      <button type="button" class="linkbtn" id="cf-csv">Download CSV</button>`)}
    ${list.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Itinerary</th><th>Departs</th><th class="num">Nights</th><th class="num">From pp</th><th class="num">Per night</th><th class="num">7 days</th></tr></thead><tbody>
      ${list.map(({r, p, pn, chg}) => `<tr>
        <td style="white-space:normal"><a href="${esc(r.link)}" target="_blank" rel="noopener"><b>${esc(r.title || "")}</b></a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")}</div></td>
        <td style="white-space:normal">${where(r)}<div class="sub">${esc(AREAS[r.area] || "")}</div></td>
        <td class="num">${r.nights || "–"}</td><td class="num">${eur(p)}</td><td class="num">${pn ? eur(pn) : "–"}</td>
        <td class="num">${chg == null ? "–" : `<span style="color:${chg < 0 ? "var(--ok, #1a7f26)" : "var(--warn)"}">${chg < 0 ? "−" : "+"}${eur(Math.abs(chg))}</span>`}</td></tr>`).join("")}
    </tbody></table></div><p class="note">${list.length} itinerar${list.length === 1 ? "y" : "ies"}. See <b>Vs Ambassador</b> for how ours compare.</p>`
      : `<div class="empty"><p>${all.length ? "No itineraries match these filters." : "Competitor prices appear after the first daily check that reads them (the first days find the list)."}</p></div>`}
    <h3 style="margin:22px 0 8px;font-size:15px">What changed (last 7 days)</h3>
    ${recent.some(c => c.type !== "new") ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Date</th><th>Itinerary</th><th>Change</th></tr></thead><tbody>
      ${recent.filter(c => c.type !== "new").filter(c => { const r = (C.sailings || {})[c.id]; return !r || ((!st.line || r.line === st.line) && (!st.area || r.area === st.area)); })
        .reverse().slice(0, 200).map(c => { const r = (C.sailings || {})[c.id] || {};
        return `<tr><td>${day(c.date)}</td><td style="white-space:normal"><a href="${esc(r.link || "#")}" target="_blank" rel="noopener">${esc(r.title || c.id)}</a><div class="sub">${esc(lineName(r.line))} · ${esc(r.ship || "")}</div></td><td>${esc(words(c))}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty"><p>Changes appear after the second daily check.</p></div>`}`;
  wire(box, () => renderPrices(box));
  box.querySelector("#cf-csv").addEventListener("click", () => csvDownload(`competitor-prices-france-${C.read_on || ""}.csv`,
    ["Line", "Ship", "Itinerary", "Starts", "Ends", "Area", "Nights", "From pp (€)", "Per night (€)", "Change 7 days (€)", "Ports", "Link", "Read"],
    list.map(({r, p, pn, chg}) => [lineName(r.line), r.ship, r.title, r.start, r.end, AREAS[r.area], r.nights, p, pn && Math.round(pn), chg, (r.ports || []).join(" · "), r.link, r.last_seen])));
}
function words(c){
  if (c.type === "price_drop" || c.type === "price_rise") return `${c.type === "price_drop" ? "Down" : "Up"}: ${eur(c.from)} → ${eur(c.to)}`;
  if (c.type === "gone") return `No longer on sale (${c.why || "gone"})`;
  return c.type;
}

// ---------- Vs Ambassador ----------
function renderVs(box){
  const all = live().filter(x => !st.line || x.r.line === st.line);
  const areas = Object.keys(AREAS).filter(a => !st.area || a === st.area);
  // 1. Typical price per night by area and length: ours against each line (medians)
  const rows = [];
  for (const a of areas) for (const [b, bl, inBand] of BANDS) {
    if (st.band && st.band !== b) continue;
    const mine = our.filter(o => o.area === a && inBand(o.nights)).map(o => o.pn);
    const per = Object.keys(LINES).filter(k => !st.line || k === st.line).map(k => all.filter(x => x.r.line === k && x.r.area === a && inBand(x.r.nights || 0)).map(x => x.pn));
    if (!mine.length && per.every(p => !p.length)) continue;
    rows.push({a, bl, mine: median(mine), nMine: mine.length, per: per.map(p => ({v: median(p), n: p.length}))});
  }
  const lineKeys = Object.keys(LINES).filter(k => !st.line || k === st.line);
  // 2. Every competing itinerary against our cheapest similar sailing
  const matched = all.filter(x => (!st.area || x.r.area === st.area) && (!st.band || bandOf(x.r.nights) === st.band))
    .map(x => ({...x, m: ourMatch(x.r)})).filter(x => x.m && x.pn)
    .map(x => ({...x, d: pct(x.m.best.pn, x.pn)}))
    .sort((a, b) => st.vsSort === "gap" ? b.d - a.d : a.pn - b.pn);
  const cheaper = matched.filter(x => x.d < 0).length;
  box.innerHTML = source() + controls(`<button type="button" class="linkbtn" id="cv-csv">Download CSV</button>`) + `
    <h3 style="margin:6px 0 8px;font-size:15px">Typical price per night</h3>
    <p class="note" style="margin:0 0 8px">Median "from" price per person per night. Ours: Ambassador Croisières' cheapest twin cabin on each sailing on sale,
      from Dunkerque (northern France), Marseille (Mediterranean) and Pointe-à-Pitre (Caribbean). Theirs: Havas Voyages' from price for each itinerary.</p>
    ${rows.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Departs from</th><th>Length</th><th class="num">Ambassador</th>
      ${lineKeys.map(k => `<th class="num">${esc(LINES[k])}</th><th class="num">vs us</th>`).join("")}</tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(AREAS[r.a])}</td><td>${esc(r.bl)}</td>
        <td class="num">${r.mine == null ? "–" : `${eur(r.mine)}<div class="sub">${r.nMine} sailing${r.nMine === 1 ? "" : "s"}</div>`}</td>
        ${r.per.map(p => `<td class="num">${p.v == null ? "–" : `${eur(p.v)}<div class="sub">${p.n} itinerar${p.n === 1 ? "y" : "ies"}</div>`}</td>
          <td class="num">${r.mine != null && p.v != null ? pctCell(pct(r.mine, p.v)) : "–"}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div><p class="note">"vs us" is our price per night against theirs: −20% means we're 20% cheaper.</p>`
      : `<div class="empty"><p>Nothing to compare yet.</p></div>`}
    <h3 style="margin:22px 0 8px;font-size:15px">Each itinerary against our closest</h3>
    <p class="note" style="margin:0 0 8px">Our closest = our cheapest sailing per night from the same area within 3 nights' length, on any date (Havas's pages
      give no dates). ${matched.length ? `We're cheaper per night than ${cheaper} of these ${matched.length}.` : ""}</p>
    <div class="controls"><select data-k="vsSort" aria-label="Sort"><option value="gap"${st.vsSort === "gap" ? " selected" : ""}>Where we're dearest first</option><option value="pn"${st.vsSort === "pn" ? " selected" : ""}>Their cheapest per night first</option></select></div>
    ${matched.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Their itinerary</th><th class="num">Nights</th><th class="num">Per night</th><th>Our closest</th><th class="num">Per night</th><th class="num">vs them</th></tr></thead><tbody>
      ${matched.slice(0, 300).map(x => `<tr>
        <td style="white-space:normal"><a href="${esc(x.r.link)}" target="_blank" rel="noopener"><b>${esc(x.r.title || "")}</b></a><div class="sub">${esc(lineName(x.r.line))} · ${esc(x.r.ship || "")} · ${where(x.r)} · from ${eur(x.p)}</div></td>
        <td class="num">${x.r.nights}</td><td class="num">${eur(x.pn)}</td>
        <td style="white-space:normal"><a href="#${esc(x.m.best.id)}">${esc(x.m.best.title || x.m.best.id)}</a><div class="sub">${esc(x.m.best.port || "")} · ${day(x.m.best.date)} · ${x.m.best.nights} nights · from ${eur(x.m.best.p)}</div></td>
        <td class="num">${eur(x.m.best.pn)}</td><td class="num" title="${esc(diffWords(x.d))}">${pctCell(x.d)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>No itinerary has a similar Ambassador Croisières sailing yet${st.area === "north" ? " (no competitor sails from northern France at Havas)" : ""}.</p></div>`}`;
  wire(box, () => renderVs(box));
  box.querySelector("#cv-csv").addEventListener("click", () => csvDownload(`vs-ambassador-france-${C.read_on || ""}.csv`,
    ["Line", "Ship", "Their itinerary", "Area", "Nights", "Their from pp (€)", "Their per night (€)", "Our closest", "Our code", "Our date", "Our nights", "Our from pp (€)", "Our per night (€)", "Ours vs theirs %", "Link"],
    matched.map(x => [lineName(x.r.line), x.r.ship, x.r.title, AREAS[x.r.area], x.r.nights, x.p, Math.round(x.pn), x.m.best.title, x.m.best.id, x.m.best.date, x.m.best.nights, x.m.best.p, Math.round(x.m.best.pn), x.d, x.r.link])));
}

const PAGES = {prices: renderPrices, vs: renderVs};
export async function mount(box, c, page){
  esc = c.esc;
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e){}
  if (!PAGES[page]) { box.innerHTML = ""; return; }
  if (!C){
    box.innerHTML = `<p class="loading">Loading competitor prices…</p>`;
    loading = loading || Promise.all([c.readJson("fr-comp"), c.readJson("fr-comp-runs").catch(() => ({runs: []}))]);
    try { [C, R] = await loading; }
    catch (e) {
      loading = null;
      box.innerHTML = `<div class="empty"><p>France's competitor prices appear after the first daily check that reads them (the competitor check, early each UK morning).</p></div>`;
      return;
    }
    our = ourSailings(c.state);
  }
  PAGES[page](box);
}
