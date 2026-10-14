// Collapsible sections for the creators' option columns (Sam, 14 Oct 2026: "lots of options and it's not always clear";
// no numbers). Each section has a clear title and, when closed, a one-line summary of what's set in it. Whether a
// section is open is remembered in this browser (localStorage spw-sections); the selected card's own options are
// never folded away. Photo grids show two rows, with "Show all N photos" underneath.
//
// section(id, title, summary, body, openByDefault) → HTML; wire(root, redraw) after each draw;
// photoGrid(key, buttons, selectedIndex, extra) → {grid, more}: the photo buttons to show and the "Show all" link.

const KEY = "spw-sections";
let open = {};
try { open = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch(e) {}
const all = new Set();   // photo grids opened in full (until the page is reloaded)
const ROWS = 10;         // two rows of five

export function section(id, title, summary, body, openByDefault = true){
  const isOpen = id in open ? open[id] : openByDefault;
  return `<details class="ac-block cs" data-sec="${id}"${isOpen ? " open" : ""}>
    <summary><h3>${title}</h3>${summary ? `<span class="cs-sum">${summary}</span>` : ""}</summary>
    <div class="cs-b">${body}</div></details>`;
}

export function photoGrid(key, buttons, selected, extra = ""){
  if (buttons.length <= ROWS || all.has(key))
    return {grid: buttons.join("") + extra, more: buttons.length > ROWS ? `<button type="button" class="linkbtn cs-more" data-photos="${key}">Show fewer photos</button>` : ""};
  // The chosen photo always stays in view, even when it's further down the list
  const shown = selected >= ROWS - 1 ? [...buttons.slice(0, ROWS - 1), buttons[selected]] : buttons.slice(0, ROWS);
  return {grid: shown.join("") + extra, more: `<button type="button" class="linkbtn cs-more" data-photos="${key}">Show all ${buttons.length} photos</button>`};
}

export function wire(root, redraw){
  root.querySelectorAll("details.cs").forEach(d => d.addEventListener("toggle", () => {
    open[d.dataset.sec] = d.open;
    try { localStorage.setItem(KEY, JSON.stringify(open)); } catch(e) {}
    if (!d.open) redraw();   // so the summary shows what was just typed
  }));
  root.querySelectorAll("[data-photos]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.photos;
    if (all.has(k)) all.delete(k); else all.add(k);
    redraw();
  }));
}
