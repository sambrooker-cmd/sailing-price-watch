// Saved ads and emails (Sam, 13 Oct 2026: the dropdown would get too long). One list for both creators:
// a "Saved (N)" button opens a dialog with a search box, sorting, and one row per saved item with a
// thumbnail, its name, what's in it and when it was saved, and Open / Duplicate / Rename / Delete.
// The creators keep their own storage; this only shows the list and calls back.
//
// openSaved({title, noun, items: [{id, name, saved_at, thumb, count, detail}], current,
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
  let q = "", items = o.items.slice();
  const close = () => { dlg.close(); dlg.remove(); };
  const rows = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter(x => words.every(w => `${x.name} ${x.detail}`.toLowerCase().includes(w)))
      .sort((a, b) => SORT === "name" ? a.name.localeCompare(b.name) : SORT === "old" ? a.saved_at.localeCompare(b.saved_at) : b.saved_at.localeCompare(a.saved_at));
    if (!items.length) return `<p class="sub">Nothing saved yet. Use "Save as…" to keep this ${o.noun} for later.</p>`;
    if (!list.length) return `<p class="sub">No saved ${o.noun}s match "${esc(q)}".</p>`;
    return `<ul class="sv-list">${list.map(x => `<li${x.id === o.current ? ' class="on"' : ""}>
      <div class="sv-thumb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ""}</div>
      <div class="sv-text"><b>${esc(x.name)}</b>${x.id === o.current ? ` <span class="sv-tag">Open now</span>` : ""}
        <span class="sub">${x.count} sailing${x.count === 1 ? "" : "s"} · saved ${esc(when(x.saved_at))}</span>
        ${x.detail ? `<span class="sub sv-detail">${esc(x.detail)}</span>` : ""}</div>
      <div class="sv-acts">
        <button type="button" class="btn sm" data-sv="open" data-id="${esc(x.id)}">Open</button>
        <button type="button" class="btn quiet sm" data-sv="copy" data-id="${esc(x.id)}">Duplicate</button>
        <button type="button" class="btn quiet sm" data-sv="ren" data-id="${esc(x.id)}">Rename</button>
        <button type="button" class="btn quiet sm" data-sv="del" data-id="${esc(x.id)}" aria-label="Delete ${esc(x.name)}">Delete</button>
      </div></li>`).join("")}</ul>`;
  };
  dlg.innerHTML = `<div class="sv-head"><h3>${esc(o.title)} <span class="sub">(${items.length})</span></h3>
      <button type="button" class="linkbtn" data-sv="close">Close</button></div>
    <div class="sv-tools">
      <input type="search" placeholder="Search names and sailings" aria-label="Search saved ${esc(o.noun)}s">
      <select aria-label="Sort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="name">Name A–Z</option></select>
    </div>
    <div class="sv-body">${rows()}</div>`;
  const body = dlg.querySelector(".sv-body"), search = dlg.querySelector("input"), sort = dlg.querySelector("select");
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
