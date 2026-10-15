// Saved ads and emails (Sam, 13 Oct 2026: the dropdown would get too long). One list for both creators:
// a "Saved (N)" button opens a dialog with a search box, sorting, and one row per saved item with a
// thumbnail, its name, what's in it and when it was saved, and Open / Duplicate / Rename / Delete.
// The creators keep their own storage; this only shows the list and calls back.
//
// Out-of-date warnings (Sam, 14 Oct 2026): each item's `issues` (from the creator's own normalise(): sailings no longer on
// sale, ended was/now claims, ended offers, sold-out cabin choices, uploads to add again) show on its row before it's
// opened, with a "Needs updating" filter. Opening an item fixes what it can and says what changed.
// openSaved({title, noun, items: [{id, name, saved_at, thumb, count, detail, issues}], current,
//            onOpen(id), onCopy(id), onRename(id, name), onDelete(id)})
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const when = iso => new Date(iso).toLocaleString("en-GB", {day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"});
let SORT = "new";
try { SORT = localStorage.getItem("spw-saved-sort") || "new"; } catch(e){}

export function openSaved(o){
  const dlg = document.createElement("dialog");
  dlg.className = "saved";
  dlg.setAttribute("aria-label", o.title);
  document.body.appendChild(dlg);
  let q = "", items = o.items.slice(), who = "all";
  const stale = () => items.filter(x => (x.issues || []).length).length;
  const anyOthers = items.some(x => x.mine === false);
  const close = () => { dlg.close(); dlg.remove(); };
  const rows = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter(x => (who === "all" || (who === "stale" ? (x.issues || []).length : x.mine !== false)) && words.every(w => `${x.name} ${x.detail} ${x.by || ""}`.toLowerCase().includes(w)))
      .sort((a, b) => SORT === "name" ? a.name.localeCompare(b.name) : SORT === "old" ? a.saved_at.localeCompare(b.saved_at) : b.saved_at.localeCompare(a.saved_at));
    if (!items.length) return `<p class="sub">Nothing saved yet. Use "Save as…" to keep this ${o.noun} for later.</p>`;
    if (!list.length) return `<p class="sub">${who === "stale" && !q ? `Every saved ${o.noun} is up to date.` : `No saved ${o.noun}s match${q ? ` "${esc(q)}"` : ""}.`}</p>`;
    return `<ul class="sv-list">${list.map(x => `<li${x.id === o.current ? ' class="on"' : ""}>
      <div class="sv-thumb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}</div>
      <div class="sv-text"><b>${esc(x.name)}</b>${x.id === o.current ? ` <span class="sv-tag">Open now</span>` : ""}
        <span class="sub">${x.count} sailing${x.count === 1 ? "" : "s"} · saved ${esc(when(x.saved_at))}${x.by ? ` by ${esc(x.mine ? "you" : x.by)}` : ""}</span>
        ${x.detail ? `<span class="sub sv-detail">${esc(x.detail)}</span>` : ""}
        ${(x.issues || []).length ? `<span class="sv-warn"><b>Needs updating:</b> ${esc(x.issues.join(" · "))}. Opening it brings it up to date.</span>` : ""}</div>
      <div class="sv-acts">
        <button type="button" class="btn sm" data-sv="open" data-id="${esc(x.id)}">Open</button>
        <button type="button" class="btn quiet sm" data-sv="copy" data-id="${esc(x.id)}">Duplicate</button>
        ${x.mine === false ? "" : `<button type="button" class="btn quiet sm" data-sv="ren" data-id="${esc(x.id)}">Rename</button>
        <button type="button" class="btn quiet sm" data-sv="del" data-id="${esc(x.id)}" aria-label="Delete ${esc(x.name)}">Delete</button>`}
      </div></li>`).join("")}</ul>`;
  };
  dlg.innerHTML = `<div class="sv-head"><h3>${esc(o.title)} <span class="sub">(${items.length})</span></h3>
      <button type="button" class="linkbtn" data-sv="close">Close</button></div>
    <div class="sv-tools">
      <input type="search" placeholder="Search names, sailings and people" aria-label="Search saved ${esc(o.noun)}s">
      ${anyOthers || stale() ? `<select aria-label="Show" data-who><option value="all">${anyOthers ? "Everyone's" : "All"}</option>${anyOthers ? `<option value="mine">Mine</option>` : ""}${stale() ? `<option value="stale">Needs updating (${stale()})</option>` : ""}</select>` : ""}
      <select aria-label="Sort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="name">Name A–Z</option></select>
    </div>
    ${o.note ? `<p class="sub" style="margin:0 0 8px">${esc(o.note)}</p>` : ""}
    <div class="sv-body">${rows()}</div>`;
  const body = dlg.querySelector(".sv-body"), search = dlg.querySelector("input"), sort = dlg.querySelector("select:not([data-who])");
  const whoSel = dlg.querySelector("[data-who]");
  whoSel && whoSel.addEventListener("change", () => { who = whoSel.value; body.innerHTML = rows(); });
  sort.value = SORT;
  search.addEventListener("input", () => { q = search.value.trim(); body.innerHTML = rows(); });
  sort.addEventListener("change", () => { SORT = sort.value; try { localStorage.setItem("spw-saved-sort", SORT); } catch(e){} body.innerHTML = rows(); });
  dlg.addEventListener("click", e => {
    if (e.target === dlg) return close();   // click on the backdrop
    const b = e.target.closest("[data-sv]"); if (!b) return;
    const id = b.dataset.id, x = items.find(i => i.id === id);
    if (b.dataset.sv === "close") return close();
    if (b.dataset.sv === "open") { close(); return o.onOpen(id); }
    if (b.dataset.sv === "copy") { close(); return o.onCopy(id); }
    if (b.dataset.sv === "ren") {
      const n = prompt("New name", x.name); if (!n || !n.trim()) return;
      x.name = n.trim(); o.onRename(id, x.name); body.innerHTML = rows();
    }
    if (b.dataset.sv === "del") {
      if (!confirm(`Delete "${x.name}"? This can't be undone.`)) return;
      items = items.filter(i => i.id !== id); o.onDelete(id);
      dlg.querySelector(".sv-head .sub").textContent = `(${items.length})`; body.innerHTML = rows();
    }
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
  search.focus();
}

// ---------- shared store (Sam, 13 Oct 2026) ----------
// Saved ads and emails live in the tracker's database through the `saved` Firebase function (allowlist checked), so
// they follow people between devices and the whole team sees them. Everyone can open and copy anything; only the
// person who saved an item can save over, rename or delete it. If the function can't be reached, this falls back to
// the browser's own storage (as before) and says so. Items saved in this browser before can be moved across once.
// The data is the ad or email itself: no prices (always the latest) and no uploaded photos.
const SAVED_FN = "https://us-central1-promotions-planner.cloudfunctions.net/saved";
// Speed (15 Oct 2026): the pages no longer wait for this list before drawing. load() runs in the background with a
// time limit (TIMEOUT_MS: the function may need a few seconds to start after a quiet spell), `loading` is true until it
// answers, and save/rename/delete wait for it, so nothing is saved to the browser by mistake while it's still loading.
const TIMEOUT_MS = 12000;
export function sharedStore({kind, localKey, field, idToken}){
  let items = {}, me = "", shared = false, problem = "", loading = false, ready = Promise.resolve();
  const local = () => { try { return JSON.parse(localStorage.getItem(localKey) || "{}") || {}; } catch(e) { return {}; } };
  const setLocal = d => { try { localStorage.setItem(localKey, JSON.stringify(d)); return true; } catch(e) { return false; } };
  async function call(method, body){
    const tok = idToken ? await idToken() : "";
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let r;
    try {
      r = await fetch(method === "GET" ? `${SAVED_FN}?kind=${kind}` : SAVED_FN, {method, signal: ctl.signal,
        headers: {Authorization: `Bearer ${tok}`, ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined});
    } catch (e) { throw new Error(e.name === "AbortError" ? "The saved list took too long to answer" : "The saved list can't be reached"); }
    finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `The saved list answered ${r.status}`), {status: r.status});
    return j;
  }
  const fromServer = x => { let data = null; try { data = JSON.parse(x.data); } catch(e){} return [x.id, {name: x.name, saved_at: x.saved_at, by: x.by, [field]: data}]; };
  return {
    get shared(){ return shared; }, get me(){ return me; }, get problem(){ return problem; }, get loading(){ return loading; },
    all: () => shared ? items : loading ? {} : local(),
    mine: id => !shared || (items[id] && items[id].by === me),
    localOnly: () => shared ? local() : {},   // saved in this browser before the shared list: offered to move across
    load(){   // returns a promise; the store can be used (and drawn as "loading") straight away
      loading = true;
      ready = (async () => {
        try { const j = await call("GET"); me = j.me; items = Object.fromEntries(j.items.map(fromServer).filter(([, v]) => v[field])); shared = true; problem = ""; }
        catch(e) { shared = false; problem = e.status === 401 || e.status === 403 ? e.message : "The shared saved list can't be reached, so saving uses this browser only for now."; }
        finally { loading = false; }
        return this;
      })();
      return ready;
    },
    async save(id, name, data){   // id null = new; returns the id
      await ready;
      if (!shared) { const all = local(); id = id || "d" + Date.now().toString(36); all[id] = {name, saved_at: new Date().toISOString(), [field]: data}; if (!setLocal(all)) throw new Error("This browser's storage is full or blocked."); return id; }
      const j = await call("POST", {op: "save", kind, id: id || undefined, name, data: JSON.stringify(data)});
      items[j.id] = {name, saved_at: j.saved_at, by: (items[j.id] || {}).by || me, [field]: data};
      return j.id;
    },
    async rename(id, name){
      await ready;
      if (!shared) { const all = local(); if (all[id]) { all[id].name = name; setLocal(all); } return; }
      await call("POST", {op: "rename", id, name}); if (items[id]) items[id].name = name;
    },
    async remove(id){
      await ready;
      if (!shared) { const all = local(); delete all[id]; setLocal(all); return; }
      await call("POST", {op: "delete", id}); delete items[id];
    },
    async moveLocal(){   // copy everything saved in this browser to the shared list, then clear it here
      const all = local(); let n = 0;
      for (const d of Object.values(all)) { if (d && d[field]) { await this.save(null, d.name, d[field]); n++; } }
      setLocal({}); return n;
    },
  };
}
