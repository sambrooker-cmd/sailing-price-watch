// Checks → Old offers on the website (Sam, 17 Oct 2026: idea 2). From site_offers.py (pricewatch/site-offers): the
// website's own wording (deals, landing and information pages; not the sailing lists, which come live from the booking
// system) still naming a promotion that has ended, an old promo code, an offer date that has passed, or a "from £X" below
// every sailing on that page. "Fix" = in the page itself; "Check" = in its Terms and Conditions section. Read-only. UK only.
const KEY = "spw-siteoffers";
const st = {kind: "", terms: true, fixed: false};
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch(e) {} };
let D, esc;
const SITE = "https://www.ambassadorcruiseline.com";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const KIND = {ended_offer: "Ended offer", ended_code: "Old promo code", past_date: "Date passed", old_price: "Price no longer available"};

export async function mount(el, c){
  esc = c.esc;
  if (D === undefined) { el.innerHTML = `<p class="loading">Loading…</p>`; D = await c.readJson("site-offers").catch(() => null); }
  draw(el);
}

function draw(el){
  if (!D || !D.findings) {
    el.innerHTML = `<div class="empty"><p>Appears after the first daily read of the website.</p></div>`;
    return;
  }
  const all = Object.values(D.findings), open = all.filter(f => !f.fixed);
  const list = all.filter(f => (st.fixed ? f.fixed : !f.fixed) && (!st.kind || f.kind === st.kind) && (st.terms || f.level === "fix"))
    .sort((a, b) => (a.level === "fix" ? 0 : 1) - (b.level === "fix" ? 0 : 1) || a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  const fix = open.filter(f => f.level === "fix"), chk = open.filter(f => f.level === "check");
  const week = all.filter(f => f.fixed && (Date.parse(D.read_on) - Date.parse(f.fixed)) / 864e5 <= 7);
  el.innerHTML = `<p class="note" style="margin:0 0 12px">Once a day (and after a promotion ends) the website's deals, landing and information pages are read, and their own wording checked for <b>offers that have ended</b>, <b>old promo codes</b>, <b>offer dates that have passed</b> and <b>"from £X" prices lower than any sailing on that page now</b>. The sailing lists on those pages come live from the booking system, so they aren't checked. <b>Fix</b> = guests can see it on the page; <b>Check</b> = it's in the page's Terms and Conditions (old terms left in place). Nothing on the website is changed.</p>
    <div class="stats" role="group" aria-label="Summary">
      <div class="stat"><span class="k">To fix</span><span class="v"${fix.length ? ' style="color:var(--warn)"' : ""}>${fix.length}</span><span class="s">on ${new Set(fix.map(f => f.path)).size} page${new Set(fix.map(f => f.path)).size === 1 ? "" : "s"}</span></div>
      <div class="stat"><span class="k">In terms to check</span><span class="v">${chk.length}</span><span class="s">old terms on the page</span></div>
      <div class="stat"><span class="k">Fixed</span><span class="v">${week.length}</span><span class="s">in the last 7 days</span></div>
      <div class="stat"><span class="k">Pages read</span><span class="v">${D.pages_checked || 0}</span><span class="s">${esc(day(D.read_at || D.read_on))}${D.pages_failed ? ` · ${D.pages_failed} couldn't be read` : ""}</span></div>
    </div>
    ${(D.ended || []).length ? `<p class="sub" style="margin:8px 0">Ended promotions looked for: ${D.ended.map(e => `${esc(e.name)} <span class="sub">(ended ${esc(day(e.ended))}${e.codes.length ? `, code ${esc(e.codes.join(", "))}` : ""})</span>`).join(" · ")}</p>` : ""}
    <div class="controls">
      <select id="so-kind" aria-label="Kind"><option value="">Every kind</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}"${st.kind === k ? " selected" : ""}>${l}</option>`).join("")}</select>
      <label class="sub"><input type="checkbox" id="so-terms"${st.terms ? " checked" : ""}> Include Terms and Conditions</label>
      <label class="sub"><input type="checkbox" id="so-fixed"${st.fixed ? " checked" : ""}> Show fixed (30 days)</label>
      <button type="button" class="linkbtn" id="so-csv">Download CSV</button><span class="sub">${list.length} finding${list.length === 1 ? "" : "s"}</span>
    </div>
    ${list.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Page</th><th>What</th><th>Wording on the page</th><th></th><th>First seen</th></tr></thead><tbody>
      ${list.map(f => `<tr><td style="white-space:normal"><a href="${esc(SITE + f.path)}" target="_blank" rel="noopener">${esc(f.path)}</a></td>
        <td style="white-space:normal"><b>${KIND[f.kind] || esc(f.kind)}</b><div class="sub">${esc(f.detail)}</div></td>
        <td style="white-space:normal;max-width:420px" class="sub">${esc(f.text)}</td>
        <td>${f.fixed ? `<span class="sub" style="color:var(--ok, #1a7f26)">Fixed ${esc(day(f.fixed))}</span>` : f.level === "fix" ? `<b style="color:var(--warn)">Fix</b>` : `<span class="sub">Check</span>`}</td>
        <td>${esc(day(f.first_seen))}</td></tr>`).join("")}
    </tbody></table></div>`
    : `<div class="empty"><p>${st.fixed ? "Nothing fixed in the last 30 days." : "Nothing found: no ended offers, old codes, passed dates or old prices in the website's own wording."}</p></div>`}`;
  const re = () => draw(el);
  el.querySelector("#so-kind").addEventListener("change", e => { st.kind = e.target.value; save(); re(); });
  el.querySelector("#so-terms").addEventListener("change", e => { st.terms = e.target.checked; save(); re(); });
  el.querySelector("#so-fixed").addEventListener("change", e => { st.fixed = e.target.checked; save(); re(); });
  el.querySelector("#so-csv").addEventListener("click", () => {
    const qv = v => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,]*(\.\d+)?%?$/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const head = ["Page", "Address", "Kind", "Detail", "Wording", "Where", "First seen", "Last seen", "Fixed"];
    const body = list.map(f => [f.path, SITE + f.path, KIND[f.kind] || f.kind, f.detail, f.text, f.level === "fix" ? "Page" : "Terms and Conditions", f.first_seen, f.last_seen, f.fixed || ""]);
    const blob = new Blob(["﻿" + [head, ...body].map(r => r.map(qv).join(",")).join("\r\n")], {type: "text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `old-offers-on-website-${D.read_on || ""}.csv`; a.click();
  });
}
