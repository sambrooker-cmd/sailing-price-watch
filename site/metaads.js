// Creative → Meta ads (Sam, 17 Oct 2026: the tracker keeps our own Meta ads in step, after approval). Reads
// pricewatch/meta-ads (meta_manage.py read, hourly): the account's campaigns, ad sets and ads, each ad's sailings (from
// its links) and 7 days of results, the changes proposed (pause ads for sailings off sale or a was/now claim that has
// ended; today's prices in an ad's words) and notes for people. Approve / Reject and changes made by hand (pause or
// switch on, budgets, bids, end dates) go to the `metaAction` function, approvers only, which starts the "Meta ads:
// apply" workflow; the outcome comes back on the request and shows under Recent changes. The Meta token never reaches
// the browser. UK only.
const FN = "https://us-central1-promotions-planner.cloudfunctions.net/metaAction";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = iso => { if (!iso) return "–"; const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const day = iso => { if (!iso) return "–"; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const STATUS = {ACTIVE: "Running", PAUSED: "Paused", ADSET_PAUSED: "Ad set paused", CAMPAIGN_PAUSED: "Campaign paused", IN_PROCESS: "Processing",
  WITH_ISSUES: "With issues", PENDING_REVIEW: "In review", DISAPPROVED: "Rejected by Meta", PREAPPROVED: "Pre-approved"};

let ctx, esc, root, D = null, reqs = [], approver = false, st = {show: "running", q: "", busy: {}, note: ""}, timer = null;
try { Object.assign(st, JSON.parse(localStorage.getItem("spw-metaads") || "{}"), {busy: {}, note: ""}); } catch(e) {}
const save = () => { try { localStorage.setItem("spw-metaads", JSON.stringify({show: st.show})); } catch(e) {} };

export async function mount(el, c){
  ctx = c; esc = c.esc; root = el;
  if (!D) { el.innerHTML = `<p class="loading">Loading…</p>`; D = await c.readJson("meta-ads").catch(() => ({problem: "setup", missing: ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"]})); }
  draw();
  loadReqs();
}

async function api(method, body){
  const r = await fetch(FN, {method, headers: {Authorization: `Bearer ${await ctx.idToken()}`, ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The Meta ads service answered ${r.status}.`);
  return j;
}
async function loadReqs(){
  try { const j = await api("GET"); reqs = j.items || []; approver = !!j.approver; st.reqErr = ""; }
  catch(e) { st.reqErr = /Failed to fetch|NetworkError|Load failed/.test(e.message) ? "The Meta ads service can't be reached yet (it goes live with the next Video function deploy)." : e.message; }
  draw();
  clearTimeout(timer);
  if (reqs.some(r => ["queued", "running"].includes(r.status))) timer = setTimeout(loadReqs, 15000);
}

const money = (minor, cur) => minor == null || minor === "" ? "–" : `${cur === "GBP" ? "£" : cur === "EUR" ? "€" : ""}${(Number(minor) / 100).toLocaleString("en-GB", {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const handled = p => reqs.find(r => r.proposal === p.id && ["queued", "running", "done", "rejected"].includes(r.status));

function draw(){
  if (!D) return;
  if (D.problem === "setup") { root.innerHTML = setupHtml(); return; }
  const cur = (D.account || {}).currency || "GBP", ads = D.ads || [], byId = Object.fromEntries(ads.map(a => [a.id, a]));
  const sets = Object.fromEntries((D.adsets || []).map(s => [s.id, s])), camps = Object.fromEntries((D.campaigns || []).map(c => [c.id, c]));
  const open = (D.proposals || []).filter(p => !handled(p)).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  const running = ads.filter(a => ["ACTIVE", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "PREAPPROVED"].includes(a.status));
  const spend = ads.reduce((n, a) => n + ((a.res || {}).spend || 0), 0), noted = ads.filter(a => (a.notes || []).length && running.includes(a));
  const q = st.q.trim().toLowerCase();
  const list = ads.filter(a => (st.show === "all" || (st.show === "running" ? running.includes(a) : st.show === "notes" ? (a.notes || []).length : !running.includes(a)))
    && (!q || [a.name, ...(a.codes || []), ((camps[a.campaign] || {}).name || ""), ((sets[a.adset] || {}).name || "")].join(" ").toLowerCase().includes(q)));
  const lvl = l => `<b style="color:${l === "urgent" ? "var(--warn,#b3261e)" : "#a15c00"}">${l === "urgent" ? "Urgent" : "Proposed"}</b>`;
  const diff = (o, n) => { const a = o.split(/(\s+)/), b = n.split(/(\s+)/); return b.map((w, i) => w !== a[i] ? `<mark>${esc(w)}</mark>` : esc(w)).join(""); };
  const can = approver ? "" : " disabled title=\"Only the Meta ads approvers can do this\"";
  root.innerHTML = `
    ${D.problem ? `<div class="ac-note" style="border-color:var(--warn,#b3261e)"><b>The ad account couldn't be read at ${esc(when(D.read_at))}:</b> ${esc(D.problem)}. What's below is from the last good read.</div>` : ""}
    ${st.note ? `<p class="ac-note">${st.note}</p>` : ""}
    <div class="stats" role="group" aria-label="Summary">
      <div class="stat"><span class="k">Ads running</span><span class="v">${running.length}</span><span class="s">${ads.length} in the account</span></div>
      <div class="stat"><span class="k">To approve</span><span class="v">${open.length}</span><span class="s">${open.some(p => p.urgent) ? `<b style="color:var(--warn,#b3261e)">${open.filter(p => p.urgent).length} urgent</b>` : "none urgent"}</span></div>
      <div class="stat"><span class="k">Spent, 7 days</span><span class="v">${money(Math.round(spend * 100), cur)}</span><span class="s">every ad in the account</span></div>
      <div class="stat"><span class="k">With notes</span><span class="v">${noted.length}</span><span class="s">running ads for a person to look at</span></div>
    </div>
    <p class="sub">${esc((D.account || {}).name || "Ad account")} · read ${esc(when(D.read_at))} (every hour) · prices as checked ${esc(day(D.today))}.
      ${approver ? "You can approve changes." : "Only the Meta ads approvers can approve or change things; everyone on the tracker can see them."}${st.reqErr ? ` <b>${esc(st.reqErr)}</b>` : ""}</p>

    <h3 style="margin:22px 0 8px">Waiting for approval</h3>
    ${open.length ? open.map(p => { const a = byId[p.ad] || {}, busy = st.busy[p.id];
      return `<div class="ac-block" style="margin:8px 0;display:flex;gap:12px;align-items:flex-start">
        ${a.thumb ? `<img src="${esc(a.thumb)}" alt="" width="64" height="64" style="object-fit:cover;flex:none" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <div style="flex:1;min-width:0">
          <div>${lvl(p.urgent ? "urgent" : "")} · <b>${p.kind === "pause" ? "Pause this ad" : p.kind === "remake" ? `Remake it with today's prices (${p.fmt === "video" ? "new video" : "new pictures"})` : "Put today's prices in its words"}</b></div>
          <div style="margin:2px 0"><b>${esc(a.name || p.ad)}</b> <span class="sub">${esc((camps[a.campaign] || {}).name || "")} › ${esc((sets[a.adset] || {}).name || "")} · ${esc(STATUS[a.status] || a.status || "")} · ${(a.codes || []).map(c => `<a href="#${esc(c)}">${esc(c)}</a>`).join(", ")}</span></div>
          <div>${esc(p.why)}</div>
          ${(p.changes || []).map(c => `<div style="margin:6px 0;font-size:13.5px"><div class="sub"><s>${esc(c.old)}</s></div><div>${diff(c.old, c.new)}</div></div>`).join("")}
          ${p.kind === "remake" ? `<p class="sub" style="margin:4px 0 0">Approving draws the ad again from its Ad creator design with today's prices and offers (ended offers come off, an ended was/now card goes back to the standard design, sailings off sale are left out), uploads it as a new creative and points the ad at it; Meta reviews it again.</p>` : ""}
          ${p.kind === "text" ? `<p class="sub" style="margin:4px 0 0">Approving makes a new creative with these words (pictures and links unchanged) and points the ad at it; Meta reviews it again.</p>` : ""}
          <div class="ac-row" style="margin-top:8px"><button type="button" class="btn sm" data-approve="${esc(p.id)}"${can}${busy ? " disabled" : ""}>${busy === "approve" ? "Sending…" : "Approve"}</button>
            <button type="button" class="btn quiet sm" data-reject="${esc(p.id)}"${can}${busy ? " disabled" : ""}>Reject</button></div>
        </div></div>`; }).join("") : `<p class="sub">Nothing to approve: every running ad matches today's prices, offers and claims (as far as its words and links show).</p>`}

    <h3 style="margin:22px 0 8px">Recent changes</h3>
    ${reqs.length ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Outcome</th></tr></thead><tbody>${reqs.slice(0, 40).map(r =>
      `<tr><td>${esc(when(r.at))}</td><td>${esc(String(r.by || "").split("@")[0])}</td><td style="white-space:normal">${esc(r.what || r.op)}</td>
        <td style="white-space:normal">${r.status === "done" ? `✓ ${esc(r.result)}` : r.status === "failed" ? `<b style="color:var(--warn,#b3261e)">✕ ${esc(r.error || "Failed")}</b>` : r.status === "rejected" ? "Rejected" : `${esc(r.status)}…`}</td></tr>`).join("")}</tbody></table></div>` : `<p class="sub">No changes yet.</p>`}

    <h3 style="margin:22px 0 8px">Our ads</h3>
    <div class="controls"><div class="seg" role="group" aria-label="Show">${[["running", "Running"], ["notes", "With notes"], ["paused", "Not running"], ["all", "All"]].map(([k, l]) => `<button type="button" data-show="${k}" aria-pressed="${st.show === k}">${l}</button>`).join("")}</div>
      <input id="ma-q" value="${esc(st.q)}" placeholder="Search ads, campaigns, cruise codes" aria-label="Search ads"></div>
    <div class="tablewrap"><table class="ptable"><thead><tr><th></th><th>Ad</th><th>Status</th><th>Sailings</th><th class="num">Spend 7d</th><th class="num">Clicks 7d</th><th>Notes</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr><td>${a.thumb ? `<img src="${esc(a.thumb)}" alt="" width="44" height="44" style="object-fit:cover" loading="lazy" referrerpolicy="no-referrer">` : ""}</td>
        <td style="white-space:normal"><b>${esc(a.name)}</b>${a.made ? ` <span class="chip" title="Published from the Ad creator: remade when its prices, offers or claims change">made by the tracker</span>` : ""}<div class="sub">${esc(a.type)} · ${esc((camps[a.campaign] || {}).name || "")} › ${esc((sets[a.adset] || {}).name || "")}</div></td>
        <td>${esc(STATUS[a.status] || a.status)}</td><td style="white-space:normal">${(a.codes || []).map(c => `<a href="#${esc(c)}">${esc(c)}</a>`).join(", ") || "–"}</td>
        <td class="num">${a.res ? money(Math.round(a.res.spend * 100), cur) : "–"}</td><td class="num">${a.res ? a.res.clicks.toLocaleString("en-GB") : "–"}</td>
        <td style="white-space:normal;font-size:13px">${(a.notes || []).map(esc).join("<br>")}</td>
        <td>${a.on === "PAUSED" ? `<button type="button" class="btn quiet sm" data-set="ad|${esc(a.id)}|ACTIVE"${can}>Switch on</button>` : `<button type="button" class="btn quiet sm" data-set="ad|${esc(a.id)}|PAUSED"${can}>Pause</button>`}</td></tr>`).join("") || `<tr><td colspan="8" class="sub">No ads here.</td></tr>`}
    </tbody></table></div>

    <h3 style="margin:22px 0 8px">Campaigns and ad sets</h3>
    <p class="sub">Budgets and bids can at most double or halve in one change, and a daily budget can't go over ${money(D.max_daily, cur)} (repo variable META_MAX_DAILY_BUDGET). Every change asks first.</p>
    <div class="tablewrap"><table class="ptable"><thead><tr><th>Campaign / ad set</th><th>Status</th><th class="num">Daily</th><th class="num">Lifetime</th><th class="num">Bid</th><th>Ends</th><th>Who sees it</th><th></th></tr></thead><tbody>
      ${(D.campaigns || []).map(c => [`<tr><td style="white-space:normal"><b>${esc(c.name)}</b><div class="sub">${esc(c.objective || "")}</div></td><td>${esc(STATUS[c.effective_status] || c.effective_status)}</td>
          <td class="num">${money(c.daily_budget, cur)}</td><td class="num">${money(c.lifetime_budget, cur)}</td><td></td><td></td><td></td>
          <td>${tools("campaign", c, can)}</td></tr>`,
        ...(D.adsets || []).filter(s => s.campaign_id === c.id).map(s => `<tr><td style="white-space:normal;padding-left:18px">${esc(s.name)}</td><td>${esc(STATUS[s.effective_status] || s.effective_status)}</td>
          <td class="num">${money(s.daily_budget, cur)}</td><td class="num">${money(s.lifetime_budget, cur)}</td><td class="num">${money(s.bid_amount, cur)}</td><td>${s.end_time ? esc(day(s.end_time)) : "–"}</td><td style="white-space:normal;font-size:13px">${esc(who(s.targeting))}</td>
          <td>${tools("adset", s, can)}</td></tr>`)].join("")).join("")}
    </tbody></table></div>`;
  wire(byId);
}
function tools(type, o, can){
  const on = o.status !== "PAUSED";
  return `<span class="ac-row" style="gap:4px;flex-wrap:wrap">
    <button type="button" class="btn quiet sm" data-set="${type}|${esc(o.id)}|${on ? "PAUSED" : "ACTIVE"}"${can}>${on ? "Pause" : "Switch on"}</button>
    ${o.daily_budget || o.lifetime_budget ? `<button type="button" class="btn quiet sm" data-budget="${type}|${esc(o.id)}"${can}>Budget</button>` : ""}
    ${type === "adset" && o.bid_amount ? `<button type="button" class="btn quiet sm" data-bid="${esc(o.id)}"${can}>Bid</button>` : ""}
    ${type === "adset" ? `<button type="button" class="btn quiet sm" data-end="${esc(o.id)}"${can}>End date</button><button type="button" class="btn quiet sm" data-tg="${esc(o.id)}"${can}>Targeting</button>` : ""}</span>`;
}
// An ad set's targeting in a few words: ages, gender, countries, and how many other settings it has
function who(t){
  if (!t) return "–";
  const age = `${t.age_min || 18}–${t.age_max || 65}${(t.age_max || 65) >= 65 ? "+" : ""}`;
  const g = (t.genders || []).length === 1 ? (t.genders[0] === 1 ? "men" : "women") : "";
  const more = [t.regions && `${t.regions} regions`, t.cities && `${t.cities} cities`, t.custom && `${t.custom} audiences`, t.interests && `${t.interests} interests`].filter(Boolean);
  return [`${age}${g ? " " + g : ""}`, (t.countries || []).join(", "), ...more].filter(Boolean).join(" · ");
}
function setupHtml(){
  const miss = (D.missing || []).join(" and ");
  return `<div class="ac-block"><h3 style="margin-top:0">Connect the Meta ad account</h3>
    <p>The tracker can read our ads every hour, propose changes when prices, offers or was/now claims move, and make them once an approver presses Approve. It needs (${esc(miss || "the setup")}):</p>
    <ol style="margin:0 0 0 18px;padding:0;line-height:1.6">
      <li>Meta Business Settings → Users → <b>System users</b> → Add (Admin) → <b>Assign assets</b>: the ad account (Manage campaigns) and the Facebook page.</li>
      <li><b>Generate new token</b> for the app, with <b>ads_management</b> and <b>ads_read</b> (add business_management if asked), no expiry. Put it straight into the repo secret <b>META_ADS_TOKEN</b> and nowhere else.</li>
      <li>Repo variable <b>META_AD_ACCOUNT_ID</b>: the ad account's number (without act_), from Ads Manager's account menu.</li>
      <li>Optional: repo variable <b>META_APPROVERS</b> (who may approve, comma-separated emails; default Sam) and <b>META_MAX_DAILY_BUDGET</b> (pounds, default 500). Then run Actions → Video function once.</li>
    </ol>
    <p class="sub">Nothing changes in the ad account without someone pressing Approve (or making a change by hand) on this page.</p></div>`;
}

async function send(body, label){
  st.note = ""; try { await api("POST", body); st.note = esc(label); } catch(e) { st.note = `Couldn't send it: ${esc(e.message)}`; }
  await loadReqs();
}
function wire(byId){
  const $ = s => root.querySelector(s), all = s => root.querySelectorAll(s);
  all("[data-show]").forEach(b => b.addEventListener("click", () => { st.show = b.dataset.show; save(); draw(); }));
  const q = $("#ma-q"); q && q.addEventListener("input", () => { st.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { draw(); const n = $("#ma-q"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); });
  all("[data-approve]").forEach(b => b.addEventListener("click", async () => {
    const p = D.proposals.find(x => x.id === b.dataset.approve), a = byId[p.ad] || {};
    if (!confirm(`${p.kind === "pause" ? "Pause" : p.kind === "remake" ? "Remake" : "Update the words of"} "${a.name || p.ad}" in Meta now?`)) return;
    st.busy[p.id] = "approve"; draw();
    await send({op: "approve", ad: p.ad, proposal: p.id, what: `${p.kind === "pause" ? "Pause" : p.kind === "remake" ? "Remake with today's prices" : "Today's prices in the words of"} "${a.name || p.ad}"`}, "Sent: it's applied in a minute or two (Recent changes shows the outcome).");
    delete st.busy[p.id]; draw();
  }));
  all("[data-reject]").forEach(b => b.addEventListener("click", async () => {
    const p = D.proposals.find(x => x.id === b.dataset.reject), a = byId[p.ad] || {};
    st.busy[p.id] = "reject"; draw();
    await send({op: "reject", ad: p.ad, proposal: p.id, what: `Rejected: ${p.kind === "pause" ? "pause" : "today's prices in the words of"} "${a.name || p.ad}"`}, "Rejected: it won't be proposed again unless something changes.");
    delete st.busy[p.id]; draw();
  }));
  const nameOf = (type, id) => type === "ad" ? (byId[id] || {}).name : ((type === "adset" ? D.adsets : D.campaigns).find(x => x.id === id) || {}).name;
  all("[data-set]").forEach(b => b.addEventListener("click", () => {
    const [type, id, status] = b.dataset.set.split("|"), n = nameOf(type, id) || id;
    if (!confirm(`${status === "PAUSED" ? "Pause" : "Switch on"} the ${type === "adset" ? "ad set" : type} "${n}" in Meta now?`)) return;
    send({op: "manual", change: {kind: "status", type, id, status}, what: `${status === "PAUSED" ? "Pause" : "Switch on"} ${type === "adset" ? "ad set" : type} "${n}"`}, "Sent.");
  }));
  const cur = (D.account || {}).currency || "GBP";
  all("[data-budget]").forEach(b => b.addEventListener("click", () => {
    const [type, id] = b.dataset.budget.split("|"), o = (type === "adset" ? D.adsets : D.campaigns).find(x => x.id === id), field = o.daily_budget ? "daily_budget" : "lifetime_budget";
    const v = prompt(`New ${field === "daily_budget" ? "daily" : "lifetime"} budget for "${o.name}" (now ${money(o[field], cur)}; at most double or half)`, (Number(o[field]) / 100).toFixed(2));
    if (v == null) return; const minor = Math.round(parseFloat(String(v).replace(/[£€,\s]/g, "")) * 100);
    if (!(minor > 0)) return alert("That isn't an amount.");
    if (minor === Number(o[field])) return;
    if (!confirm(`Change "${o.name}" ${field === "daily_budget" ? "daily" : "lifetime"} budget from ${money(o[field], cur)} to ${money(minor, cur)}?`)) return;
    send({op: "manual", change: {kind: "budget", type, id, field, value: String(minor)}, what: `"${o.name}" ${field === "daily_budget" ? "daily" : "lifetime"} budget ${money(o[field], cur)} → ${money(minor, cur)}`}, "Sent.");
  }));
  all("[data-bid]").forEach(b => b.addEventListener("click", () => {
    const o = D.adsets.find(x => x.id === b.dataset.bid);
    const v = prompt(`New bid for "${o.name}" (now ${money(o.bid_amount, cur)}; at most double or half)`, (Number(o.bid_amount) / 100).toFixed(2));
    if (v == null) return; const minor = Math.round(parseFloat(String(v).replace(/[£€,\s]/g, "")) * 100);
    if (minor === Number(o.bid_amount)) return;
    if (!(minor > 0) || !confirm(`Change the bid for "${o.name}" to ${money(minor, cur)}?`)) return;
    send({op: "manual", change: {kind: "bid", type: "adset", id: o.id, value: String(minor)}, what: `"${o.name}" bid ${money(o.bid_amount, cur)} → ${money(minor, cur)}`}, "Sent.");
  }));
  // Targeting (stage 2): ages, gender and countries; regions, cities, audiences and interests are kept as they are
  all("[data-tg]").forEach(b => b.addEventListener("click", () => {
    const o = D.adsets.find(x => x.id === b.dataset.tg), t = o.targeting || {};
    const ages = prompt(`Ages for "${o.name}" (e.g. 55-65; 65 means 65 and over)`, `${t.age_min || 18}-${t.age_max || 65}`); if (ages == null) return;
    const m = ages.match(/^\s*(\d{2})\s*[-–]\s*(\d{2})\s*\+?\s*$/); if (!m || +m[1] < 18 || +m[2] > 65 || +m[1] > +m[2]) return alert("Use two ages between 18 and 65, e.g. 55-65.");
    const gs = prompt("Who: all, men or women", (t.genders || []).length === 1 ? (t.genders[0] === 1 ? "men" : "women") : "all"); if (gs == null) return;
    const genders = /^m/i.test(gs.trim()) ? [1] : /^w/i.test(gs.trim()) ? [2] : [];
    const cs = prompt("Countries (two-letter codes, e.g. GB, IE). Leave as it is to keep the current locations; changing it replaces any regions or cities.", (t.countries || []).join(", ")); if (cs == null) return;
    const countries = cs.toUpperCase().split(/[\s,;]+/).filter(Boolean), same = countries.join(",") === (t.countries || []).join(",");
    if (countries.some(c => !/^[A-Z]{2}$/.test(c))) return alert("Countries are two-letter codes, e.g. GB.");
    const said = `ages ${m[1]}–${m[2]}${+m[2] === 65 ? "+" : ""}, ${genders.length ? (genders[0] === 1 ? "men" : "women") : "everyone"}${same ? "" : `, ${countries.join(", ")}`}`;
    if (!confirm(`Change who "${o.name}" reaches to ${said}?`)) return;
    send({op: "manual", change: {kind: "targeting", type: "adset", id: o.id, age_min: +m[1], age_max: +m[2], genders, countries: same ? [] : countries}, what: `"${o.name}" targeting: ${said}`}, "Sent.");
  }));
  all("[data-end]").forEach(b => b.addEventListener("click", () => {
    const o = D.adsets.find(x => x.id === b.dataset.end);
    const v = prompt(`End date for "${o.name}" (YYYY-MM-DD; it stops at 23:59 GMT that day)`, (o.end_time || "").slice(0, 10));
    if (!v || !/^\d{4}-\d\d-\d\d$/.test(v.trim())) return v && alert("Use YYYY-MM-DD.");
    if (!confirm(`End "${o.name}" at the end of ${day(v.trim())}?`)) return;
    send({op: "manual", change: {kind: "end", type: "adset", id: o.id, end_time: `${v.trim()}T23:59:00+0000`}, what: `"${o.name}" ends ${day(v.trim())}`}, "Sent.");
  }));
}
