// Pre-send compliance check (Sam, 17 Oct 2026, from the build list: "one pass / warn / fail check for anything going
// out"). Every creator (Ad creator, Email creator, Email cards, Google Ads, Pages and blog, Campaign builder) describes
// what it is about to hand over as a "pack": the sailings with the price, was/now and offers each shows, every piece of
// text, and the links. check() compares that with the tracker's saved data only (state, cabins, ad kit, terms):
//   - prices: each price shown is today's (the lead price, or the chosen cabin grade / solo price), the check is recent
//   - was/now: only from a claim live today (tracker.py claim_for, as the creators' claims()), with the claim's own
//     figures, and the use-by date; reduction wording ("was £", "reduced", "price drop", "save £", "£X off" …) only with one
//   - offers: still live on the sailing (or the campaign's own badge, with its terms), and the website's T&Cs found
//   - "Based on two sharing and subject to availability." (or the solo wording) wherever a price is quoted
//   - every £ / % / points figure in the words is a current price, claim, offer or Nectar figure
//   - sailings no longer on sale or departing within 7 days, brand words (v4.3), placeholders, links off our sites
// Result {status: "pass" | "warn" | "fail", rows: [{lvl, t}], useBy}; useBy = the earliest claim end or offer expiry, the
// last day the material can go out as it is. chip() / show() / confirmGo() / reportText() are the shared UI: a status
// button next to each Download, a dialog with the rows, a "download anyway?" question when something fails, and
// checks.txt in the zips. Nothing is blocked outright: people decide. Read-only.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = iso => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };
const num = s => String(s).replace(/[,\s  ]/g, "").replace(/\.+$/, "");   // "£300." at the end of a sentence is 300
const money = (v, fr) => fr ? `${Math.round(v).toLocaleString("fr-FR")} €` : "£" + Math.round(v).toLocaleString("en-GB");
const key = t => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}%£€=+-]+/gu, " ").trim();
const lastSeg = c => c && c.seg && c.seg.length ? c.seg[c.seg.length - 1] : null;
const addDays = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// Reduction wording: only with a live was/now claim (hard rule: was prices only from run.json via the tracker's claims)
const REDUCE = /\bwas\s+(up to\s+)?£|\bwas\s*£|\bnow only\b|\bnow just\b|\breduced\b|\breduction\b|\bprice (drop|cut)s?\b|\bslashed\b|\bsave\s*(up to\s+)?£|\bsavings? of\b|£\s?\d[\d,]*\s*off\b|\blower (fares|prices)\b|\bhalf price\b|\bprix barré|\bau lieu de\b|\bréduction\b/i;
const BRAND = [[/\bThe Renaissance\b/, `"The Renaissance": the ship is "Renaissance"`], [/\bAmbassador Cruises\b/, `"Ambassador Cruises": say "Ambassador Cruise Line"`],
  [/\bACL\b/, `"ACL": say "Ambassador Cruise Line"`], [/\bboats?\b/i, `"boat": say "ship"`], [/\bThe (Ambience|Ambition)\b/, `"The Ambience/Ambition": the ships are named without "The"`]];
const PLACEHOLDER = /UNSUBSCRIBE_LINK|lorem ipsum|\bTBC\b|\bTODO\b|\bXXX\b|C###|T####/;
const OUR_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(ambassadorcruiseline\.com|ambassadorcroisieres\.fr|trustpilot\.com)(\/|$)/i;
const PROOF = ["94"];   // "94% of our guests would recommend Ambassador" (draft_job.py PROOF_FIGURES)

// Claims live today, exactly as the creators' claims() offer them
function liveClaims(id, c){
  const r = (c.S.sailings || {})[id]; if (!r) return [];
  const price = r.segments[r.segments.length - 1].p, out = [], cl = r.claim;
  if (cl && cl.eligible && cl.ends >= c.today && cl.now === price) out.push({key: "lead", was: cl.was, now: cl.now, ends: cl.ends});
  for (const [k, cc] of Object.entries(((c.CAB || {})[id] || {}).cabin_claims || {}))
    if (k.startsWith("twin.") && cc.eligible && cc.ends >= c.today) out.push({key: k, was: cc.was, now: cc.now, ends: cc.ends});
  return out;
}
// Today's price for a fare: the lead (cheapest twin), a cabin grade, or solo (cheapest solo grade)
function prices(id, c){
  const r = (c.S.sailings || {})[id], cab = ((c.CAB || {})[id] || {}).cabins || {}, out = {lead: r.segments[r.segments.length - 1].p};
  for (const [k, v] of Object.entries(cab)) { const s = lastSeg(v); if (s && s.p != null && !s.out) out[k] = s.p; }
  const solos = Object.entries(out).filter(([k]) => k.startsWith("solo.")).map(([, p]) => p);
  if (solos.length) out.solo = Math.min(...solos);
  return out;
}
// The sailing's live promotions (state offers with an open span), for names, expiry and T&Cs
function liveOffers(id, c){
  const r = (c.S.sailings || {})[id] || {}, offers = c.S.offers || {};
  return Object.entries(r.promos || {}).filter(([, sp]) => sp.length && sp[sp.length - 1][1] == null).map(([oid]) => ({oid, ...(offers[oid] || {})}));
}

export function check(pack, c){
  const rows = [], add = (lvl, t) => rows.push({lvl, t}), fr = !!pack.fr || !!c.fr, today = c.today;
  const S = c.S || {}, KIT = c.KIT || {}, T = c.T || null;
  let useBy = null; const until = (d, why) => { if (d && (!useBy || d < useBy.d)) useBy = {d, why}; };
  // 1. the data itself
  const at = S.updated_at ? Date.parse(S.updated_at) : null;
  if (at && Date.now() - at > 26 * 3600e3) add("warn", `The prices are from a check ${Math.round((Date.now() - at) / 3600e3)} hours ago: the hourly checks may have stopped. Look at Check history before this goes out.`);
  const items = pack.items || [];
  if (!items.length && pack.needsSailings) add("fail", "No sailings in it yet.");
  // allowed figures for the words
  const ok = new Set(PROOF), okPts = new Set();
  let priced = false, solo = false, anyClaim = false;
  const priceBad = [], gone = [], soon = [], claimBad = [], offerBad = [], noTerms = [], campaign = [];
  let claimsOk = 0, offersOk = 0, pricesOk = 0;
  for (const it of items) {
    const r = (S.sailings || {})[it.id], label = it.where ? `${it.where} (${it.id})` : it.id;
    if (!r || r.removed || !(r.departure_date > today)) { gone.push(`${label}`); continue; }
    if (r.departure_date <= addDays(today, 7)) soon.push(`${it.id} (${day(r.departure_date)})`);
    const P = prices(it.id, c);
    Object.values(P).forEach(p => ok.add(String(p)));
    // a was/now shown
    if (it.wasnow) {
      anyClaim = true; priced = true;
      const cl = liveClaims(it.id, c).find(x => x.key === it.wasnow.key);
      if (!cl) claimBad.push(`${label} shows a was/now price but the claim isn't live today: switch it to the standard "From" price`);
      else if ((it.wasnow.was != null && it.wasnow.was !== cl.was) || (it.wasnow.now != null && it.wasnow.now !== cl.now)) claimBad.push(`${label} shows was ${money(it.wasnow.was, fr)} / now ${money(it.wasnow.now, fr)}, but the claim is was ${money(cl.was, fr)} / now ${money(cl.now, fr)}`);
      else { claimsOk++; ok.add(String(cl.was)); ok.add(String(cl.now)); until(cl.ends, `the ${it.id} was/now claim ends`); }
    } else if (it.price != null) {
      priced = true;
      const want = it.solo ? (it.grade ? P["solo." + it.grade] : P.solo) : it.grade ? P["twin." + it.grade] : P.lead;
      if (it.solo) solo = true;
      if (want == null) priceBad.push(`${label}: the ${it.solo ? "solo " : ""}${it.grade ? it.grade.replace(/_/g, " ") + " " : ""}fare isn't on sale any more`);
      else if (it.price !== want) priceBad.push(`${label} shows ${money(it.price, fr)}, today's price is ${money(want, fr)}`);
      else pricesOk++;
    }
    // offers shown
    const lo = liveOffers(it.id, c), kitPromos = (KIT[it.id] || {}).promos || [];
    lo.forEach(o => [o.name, o.desc].forEach(t => (String(t || "").match(/\d[\d,.]*/g) || []).forEach(n => ok.add(num(n)))));
    kitPromos.forEach(t => (t.match(/\d[\d,.]*/g) || []).forEach(n => ok.add(num(n))));
    const nec = (KIT[it.id] || {}).nectar; if (nec) (nec.match(/\d[\d,]*/g) || []).forEach(n => { okPts.add(num(n)); ok.add(num(n)); });
    for (const line of it.offers || []) {
      const name = key(String(line).split(" · ")[0]);
      if (pack.campaign && pack.campaign.badge && key(line) === key(pack.campaign.badge)) { campaign.push(it.id); continue; }
      const o = lo.find(x => key(x.name) === name) || (kitPromos.includes(line) ? lo.find(x => name.startsWith(key(x.name)) || key(x.name).startsWith(name)) : null);
      if (!o && !kitPromos.includes(line)) { offerBad.push(`${label}: "${line}" is no longer a live offer on this sailing`); continue; }
      offersOk++;
      if (o && o.expires) until(o.expires.slice(0, 10), `"${o.name}" ends`);
      const docs = o && T && T.offers ? (T.offers[o.oid] || []) : [];
      if (!docs.length) noTerms.push(`${it.id}: ${String(line).split(" · ")[0]}`);
    }
  }
  if (pack.campaign) {
    const cp = pack.campaign;
    [cp.name, cp.badge, cp.offer, cp.terms].forEach(t => (String(t || "").match(/\d[\d,.]*/g) || []).forEach(n => ok.add(num(n))));
    if (campaign.length) {
      if (!cp.terms) add("fail", `The campaign's offer badge "${cp.badge}" is on ${campaign.length} card${campaign.length === 1 ? "" : "s"} but the brief has no T&Cs.`);
      add("warn", `"${cp.badge}" is the campaign's own offer, not on the website yet${cp.from ? `: it must be live from ${day(cp.from)}` : ""}${cp.to ? ` and come off after ${day(cp.to)}` : ""}.`);
      if (cp.to) until(cp.to, "the campaign's booking window closes");
    }
  }
  gone.length && add("fail", `No longer on sale: ${gone.join(", ")}. Take ${gone.length === 1 ? "it" : "them"} out.`);
  priceBad.forEach(t => add("fail", t + "."));
  claimBad.forEach(t => add("fail", t + "."));
  offerBad.forEach(t => add("fail", t + "."));
  soon.length && add("warn", `Departing within 7 days: ${soon.join(", ")}. Was/now claims stop 7 days before departure and there's little time to book.`);
  noTerms.length && add("warn", `No T&Cs found on the website for: ${noTerms.join("; ")}. Link the general booking terms or check with the promotions team.`);
  // 2. the words
  const texts = (pack.texts || []).filter(x => x && x.text && String(x.text).trim());
  const shown = items.map(it => it.wasnow ? it.wasnow.now : it.price).filter(v => v != null);
  const all = texts.map(x => x.text).join("\n");
  const figBad = [];
  for (const x of texts) {
    const t = String(x.text);
    for (const m of t.matchAll(fr ? /(\d{1,3}(?:[\s  .]\d{3})*)\s?€/g : /£\s?(\d+(?:,\d{3})*(?:\.\d+)?)/g)) {
      const n = num(m[1]).replace(/\.00$/, "");
      // "under £1,000" is fine when it's true of every price shown
      const cap = /\b(under|below|less than)\s*$/i.test(t.slice(Math.max(0, m.index - 12), m.index)) && !REDUCE.test(t.slice(Math.max(0, m.index - 30), m.index + 20))
        && (x.prices || shown).length && (x.prices || shown).every(p => p <= +n);
      if (!ok.has(n) && !cap) figBad.push(`${x.where}: ${m[0].trim()}`);
    }
    for (const m of t.matchAll(/(\d[\d,.]*)\s?%/g)) if (!ok.has(num(m[1]))) figBad.push(`${x.where}: ${m[0]}`);
    for (const m of t.matchAll(/(\d[\d,]*)\s+(Nectar\s+)?points/gi)) if (!okPts.has(num(m[1])) && !ok.has(num(m[1]))) figBad.push(`${x.where}: ${m[0]}`);
    if (/£|€/.test(t)) priced = true;
  }
  [...new Set(figBad)].forEach(t => add("fail", `A figure that isn't a current price, claim, offer or Nectar figure: ${t}.`));
  const red = texts.filter(x => REDUCE.test(x.text));
  if (red.length && !anyClaim) red.forEach(x => add("fail", `${x.where} uses price-reduction wording ("${String(x.text).match(REDUCE)[0]}") with no live was/now claim in it. Reductions only come from the tracker's claims.`));
  if (pack.needsTwoSharing !== false && priced && texts.length) {
    const has = fr ? /deux personnes|base deux|voyageant seule/i.test(all) : /two sharing/i.test(all) && (!solo || /solo|travelling alone|one guest/i.test(all));
    if (!has) add(pack.twoSharingLevel || "fail", fr ? `Prices are quoted but "Prix par personne, base deux personnes, sous réserve de disponibilité." isn't there.`
      : `Prices are quoted but "Based on two sharing and subject to availability." isn't there${solo ? " (and the solo price needs \"for one guest travelling solo\")" : ""}.`);
    else if (!fr && !/subject to availability/i.test(all)) add("warn", `"subject to availability" is missing from the small print.`);
  }
  if (!fr) for (const [rx, msg] of BRAND) { const x = texts.find(y => rx.test(y.text)); if (x) add("warn", `${x.where}: ${msg}.`); }
  if (!fr) { const amp = texts.filter(x => x.body && /\s&\s/.test(x.text)); if (amp.length) add("warn", `"&" in body copy (${amp.map(x => x.where).join(", ")}): write "and".`); }
  const ph = texts.find(x => PLACEHOLDER.test(x.text)); if (ph) add("warn", `${ph.where} still has a placeholder ("${String(ph.text).match(PLACEHOLDER)[0]}").`);
  for (const l of (pack.links || [])) {
    if (!l.url) add("warn", `${l.where}: no link set.`);
    else if (!/^(https?:|mailto:|tel:|\{\{)/i.test(l.url) && !/^\/(?!\/)/.test(l.url)) add("fail", `${l.where}: "${l.url}" isn't a web link.`);
    else if (/^https?:/i.test(l.url) && !OUR_HOSTS.test(l.url)) add("warn", `${l.where} links off our websites: ${l.url}`);
  }
  (pack.extra || []).forEach(r => rows.push(r));
  // 3. what passed
  if (pricesOk) add("ok", `${pricesOk} price${pricesOk === 1 ? " matches" : "s match"} today's check (${day(today)}).`);
  if (claimsOk) add("ok", `${claimsOk} was/now price${claimsOk === 1 ? "" : "s"} from a claim live today.`);
  if (offersOk) add("ok", `${offersOk} offer${offersOk === 1 ? "" : "s"} still live on the website${noTerms.length ? "" : ", with T&Cs found"}.`);
  if (texts.length && !figBad.length) add("ok", "Every figure in the words is a current price, claim, offer or Nectar figure.");
  if (useBy) add(useBy.d <= addDays(today, 2) ? "warn" : "ok", `Use by ${day(useBy.d)}: ${useBy.why} then.`);
  const status = rows.some(r => r.lvl === "fail") ? "fail" : rows.some(r => r.lvl === "warn") ? "warn" : "pass";
  rows.sort((a, b) => ({fail: 0, warn: 1, ok: 2})[a.lvl] - ({fail: 0, warn: 1, ok: 2})[b.lvl]);
  return {status, rows, useBy: useBy && useBy.d, label: pack.label || "", at: new Date().toISOString(), today};
}

// ---------- shared UI ----------
const ICON = {fail: "✕", warn: "!", ok: "✓"};
function css(){
  if (document.getElementById("cmp-css")) return;
  const s = document.createElement("style"); s.id = "cmp-css";
  s.textContent = `.cmp-chip{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;padding:6px 10px;border:1px solid currentColor;background:transparent;cursor:pointer}
  .cmp-chip.pass{color:var(--ok,#1a7f26)}.cmp-chip.warn{color:#a15c00}.cmp-chip.fail{color:var(--warn,#b3261e)}
  dialog.cmp{max-width:720px;width:calc(100% - 32px);border:1px solid var(--line,#ddd);padding:0;background:var(--bg,#fff);color:inherit}
  dialog.cmp header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line,#ddd)}
  dialog.cmp h3{margin:0;font-size:16px}dialog.cmp ul{list-style:none;margin:0;padding:12px 18px 18px}dialog.cmp li{display:flex;gap:10px;margin:7px 0;line-height:1.45}
  dialog.cmp li b{flex:none;width:16px}dialog.cmp .fail b{color:var(--warn,#b3261e)}dialog.cmp .warn b{color:#a15c00}dialog.cmp .ok b{color:var(--ok,#1a7f26)}
  dialog.cmp footer{padding:0 18px 16px;font-size:13px;opacity:.8}`;
  document.head.appendChild(s);
}
const counts = res => ({fail: res.rows.filter(r => r.lvl === "fail").length, warn: res.rows.filter(r => r.lvl === "warn").length});
export function chipText(res){
  const n = counts(res);
  return res.status === "fail" ? `✕ ${n.fail} problem${n.fail === 1 ? "" : "s"}${n.warn ? ` · ${n.warn} to check` : ""}` : res.status === "warn" ? `! ${n.warn} to check` : "✓ Ready to go";
}
// A button that opens the details; `id` lets the creator wire it (or use data-cmp with wire())
export function chip(res, id){ css(); return `<button type="button" class="cmp-chip ${res.status}" id="${id}" title="Pre-send check: prices, was/now, offers and T&amp;Cs, small print and figures">${chipText(res)}</button>`; }
export function show(res, esc, title){
  css();
  let d = document.getElementById("cmp-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "cmp-dialog"; d.className = "cmp"; document.body.appendChild(d); d.addEventListener("click", e => { if (e.target === d || e.target.dataset.close != null) d.close(); }); }
  d.innerHTML = `<header><h3>${esc(title || "Check before it goes out")}</h3><button type="button" class="btn quiet sm" data-close>Close</button></header>
    <ul>${res.rows.map(r => `<li class="${r.lvl}"><b>${ICON[r.lvl]}</b><span>${esc(r.t)}</span></li>`).join("") || `<li class="ok"><b>✓</b><span>Nothing to flag.</span></li>`}</ul>
    <footer>Checked against the tracker's latest prices, claims, offers and T&amp;Cs (${esc(day(res.today))}). It doesn't send or change anything; a person still reviews it.</footer>`;
  d.showModal();
}
// Before a download or copy: true to go ahead. Problems ask first; things to check don't stop it.
export function confirmGo(res, what){
  if (res.status !== "fail") return true;
  const fails = res.rows.filter(r => r.lvl === "fail").map(r => "• " + r.t);
  return confirm(`The pre-send check found ${fails.length} problem${fails.length === 1 ? "" : "s"}:\n\n${fails.slice(0, 6).join("\n")}${fails.length > 6 ? `\n…and ${fails.length - 6} more` : ""}\n\n${what || "Download"} anyway?`);
}
export function reportText(res){
  return [`Pre-send check${res.label ? ": " + res.label : ""}`, `Checked ${res.at.slice(0, 16).replace("T", " ")} UTC against the prices of ${day(res.today)}.`,
    `Result: ${res.status === "pass" ? "ready to go" : res.status === "warn" ? "things to check" : "PROBLEMS FOUND"}`, "",
    ...res.rows.map(r => `${ICON[r.lvl]} ${r.t}`), ""].join("\n");
}
