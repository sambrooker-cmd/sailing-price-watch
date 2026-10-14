// "Draft with Claude" for the Ad creator and the Email creator (Sam, 14 Oct 2026, the free option).
// The page asks the Firebase function `drafts` (functions/index.js), which starts a short GitHub run of Claude Code
// on Sam's Claude plan (draft_job.py). The run builds the facts from the tracker's saved state, never from this
// page, and throws away any draft quoting a figure that isn't in them. This page asks every few seconds until the
// options are ready (usually 1 to 2 minutes). Nothing is used until someone presses "Use this".
//
// block(kind, notReady) → HTML (notReady: why it can't draft yet, said when the button is pressed, or ""); wire(root, kind, {ID, body: () => request, use: option => void, redraw: () => void}).
// kind "ad": options {label, text}; kind "email": options {label, subject, preheader, headline, sub, intro}.

const FN = "https://us-central1-promotions-planner.cloudfunctions.net/drafts";
const POLL_MS = 5000, GIVE_UP_MS = 6 * 60e3;
const st = {ad: {}, email: {}};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const ukDate = iso => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"}) : "";
const mins = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

async function call(ID, method, body, query){
  if (!ID) throw new Error("Sign in first.");
  let r;
  try {
    r = await fetch(FN + (query || ""), {method, body: body ? JSON.stringify(body) : undefined,
      headers: {Authorization: `Bearer ${await ID()}`, ...(body ? {"Content-Type": "application/json"} : {})}});
  } catch(e) { throw new Error("Drafting can't be reached right now (it may not be switched on yet)."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Drafting answered ${r.status}.`);
  return j;
}

function status(s){
  if (s.busy) return `Claude is writing… ${mins(Date.now() - s.started)} <span class="sub">(usually 1 to 2 minutes; you can carry on meanwhile)</span>`;
  return esc(s.msg || "");
}

function option(kind, o, i){
  if (kind === "ad") {
    const cut = o.text.length <= 125 ? o.text.length : o.text.lastIndexOf(" ", 125);
    return `<div class="ac-opt"><span class="ac-tag">${esc(o.label)}</span>
      <p><b>${esc(o.text.slice(0, cut))}</b>${esc(o.text.slice(cut))}</p>
      <button type="button" class="btn quiet" data-cuse="${i}">Use this</button></div>`;
  }
  return `<div class="ac-opt"><span class="ac-tag">${esc(o.label)}</span>
    <p><b>Subject:</b> ${esc(o.subject)}<br><b>Preview text:</b> ${esc(o.preheader)}<br>
    <b>Header:</b> ${esc(o.headline)}${o.sub ? ` / ${esc(o.sub)}` : ""}</p>
    ${o.intro.split(/\n\n+/).map(p => `<p>${esc(p)}</p>`).join("")}
    <button type="button" class="btn quiet" data-cuse="${i}">Use this</button></div>`;
}

export function block(kind, notReady){
  const s = st[kind], what = kind === "ad" ? "primary text" : "subject line, preview text, header words and intro";
  return `<div class="ac-sugg ac-claude" id="cl-${kind}">
    <p class="ac-lab" style="margin:0">Draft with Claude</p>
    <p class="sub">Claude writes new ${what} options from these sailings' prices, dates, offers and Nectar points, in Ambassador's tone of voice. Read them before using them: Claude can get things wrong.</p>
    <input id="cl-brief-${kind}" maxlength="300" value="${esc(s.brief || "")}" placeholder="Anything to steer it? (optional) e.g. lead on the Christmas markets, keep it short">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
      <button type="button" class="btn quiet" id="cl-go-${kind}"${s.busy ? " disabled" : ""} data-why="${esc(notReady || "")}">${s.options ? "Draft again" : "Draft with Claude"}</button>
      <span class="sub" id="cl-st-${kind}" aria-live="polite">${status(s)}</span>
    </div>
    ${s.options ? `${s.forWhat ? `<p class="sub" style="margin:8px 0 0">For: ${esc(s.forWhat)}${s.prices ? ` · prices as checked ${esc(ukDate(s.prices))}` : ""}</p>` : ""}
      ${(s.notes || []).map(n => `<p class="sub" style="margin:4px 0 0">${esc(n)}</p>`).join("")}
      ${s.options.map((o, i) => option(kind, o, i)).join("")}` : ""}
  </div>`;
}

export function wire(root, kind, {ID, body, use, redraw, forWhat}){
  const s = st[kind], box = root.querySelector(`#cl-${kind}`);
  if (!box) return;
  const brief = box.querySelector(`#cl-brief-${kind}`);
  brief.addEventListener("input", () => { s.brief = brief.value; });
  box.querySelectorAll("[data-cuse]").forEach(b => b.addEventListener("click", () => use(s.options[+b.dataset.cuse])));
  box.querySelector(`#cl-go-${kind}`).addEventListener("click", async () => {
    const why = box.querySelector(`#cl-go-${kind}`).dataset.why;
    if (why) { box.querySelector(`#cl-st-${kind}`).textContent = why; return; }   // QA, 14 Oct 2026: it did nothing
    Object.assign(s, {busy: true, started: Date.now(), msg: "", redraw});
    redraw();
    try {
      const {id} = await call(ID, "POST", {...body(), kind, brief: s.brief || ""});
      s.forWhat = forWhat();
      poll(ID, kind, id);
    } catch(e) { Object.assign(s, {busy: false, msg: e.message}); s.redraw(); }
  });
}

async function poll(ID, kind, id){
  const s = st[kind];
  const el = document.getElementById(`cl-st-${kind}`);   // tick the timer without redrawing the page
  if (el) el.innerHTML = status(s);
  let j;
  try { j = await call(ID, "GET", null, `?id=${encodeURIComponent(id)}`); }
  catch(e) { j = {status: "waiting"}; }   // a missed check is fine: ask again
  if (j.status === "done") {
    Object.assign(s, {busy: false, options: j.options, notes: j.notes, prices: j.prices,
                      msg: `${j.options.length} option${j.options.length === 1 ? "" : "s"} below.`});
    return s.redraw();
  }
  if (j.status === "failed") { Object.assign(s, {busy: false, msg: j.error || "Something went wrong. Try again."}); return s.redraw(); }
  if (Date.now() - s.started > GIVE_UP_MS) {
    Object.assign(s, {busy: false, msg: "This is taking much longer than usual. Try again, or tell Sam."});
    return s.redraw();
  }
  setTimeout(() => poll(ID, kind, id), POLL_MS);
}
