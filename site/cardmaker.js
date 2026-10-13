// "Make a version" in a sailing's Cards section (Sam, 13 Oct 2026): the same standard card the hourly
// check makes, built in the browser with the Nectar line and the Trustpilot widget switched on or off,
// previewed in all three sizes and downloaded one size at a time. Nothing is saved or sent anywhere.
// Uses the Ad creator's card designs (adcards.js) and data (pricewatch/adkit), so it matches the
// automatic cards. Prices always come from the tracker's saved state.
import {cardDoc, SIZES} from "./adcards.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmtDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
const LABEL = {"1x1": "1:1 feed & carousel", "4x5": "4:5 feed", "9x16": "9:16 Stories & Reels"};
let LOGO = null, TP;

async function assets(){
  if (LOGO === null) LOGO = await (await fetch("logo-white.svg")).text();
  if (TP === undefined) { try { const r = await fetch("trustpilot/widget.json", {cache: "no-store"}); TP = r.ok ? await r.json() : null; } catch(e) { TP = null; } }
}

// The card data, as the Ad creator builds it for a standard card with the feed image.
function data(r, k, sid, o){
  const fly = r.flight_from, strip = o.nectar || o.tp;
  return {id: sid, title: fly ? r.base_title : r.title, ship: r.ship, port: r.port, fly, nights: r.nights,
          departure_date: r.departure_date, price: r.segments[r.segments.length - 1].p,
          promos: (k.promos || []).slice(0, strip ? 1 : 2), nectar: o.nectar ? k.nectar : "",
          photo: k.image || r.image_link, campaign: !!k.campaign, words: null, wasnow: null,
          trustpilot: o.tp && TP ? `${location.origin}/trustpilot/${o.tpFile || TP.images[0].file}` : ""};
}

async function render(doc, w, h){
  const f = document.createElement("iframe");
  f.style.cssText = `position:fixed;left:-${w + 50}px;top:0;width:${w}px;height:${h}px;border:0`;
  document.body.appendChild(f);
  try {
    await new Promise(r => { f.onload = r; f.srcdoc = doc; });
    await f.contentWindow.ready();
    return await f.contentWindow.toJpeg();
  } finally { f.remove(); }
}

// el: an empty element in the detail view. r: the sailing's saved state, k: its ad kit entry.
export async function mount(el, sid, r, k){
  await assets();
  if (!k) { el.innerHTML = `<p class="sub">Versions can be made after the next hourly check.</p>`; return; }
  const def = {nectar: !!k.nectar, tp: false, tpFile: TP ? TP.images[0].file : ""};
  const o = {...def};
  el.innerHTML = `<div class="cardopts"><b>Make a version</b>
    <label class="ac-check"><input type="checkbox" data-co="nectar"${o.nectar ? " checked" : ""}${k.nectar ? "" : " disabled"}> Nectar line ${k.nectar ? `<span class="sub">(${esc(k.nectar)})</span>` : `<span class="sub">(no Nectar points on this sailing)</span>`}</label>
    <label class="ac-check"><input type="checkbox" data-co="tp"${TP ? "" : " disabled"}> Trustpilot widget ${TP ? `<span class="sub">(score as of ${esc(fmtDate(TP.as_of))})</span>` : `<span class="sub">(waiting for the Trustpilot image)</span>`}</label>
    ${TP ? `<select data-co="tpFile" aria-label="Trustpilot layout" hidden>${TP.images.map(x => `<option value="${esc(x.file)}">${esc(x.label)}</option>`).join("")}</select>` : ""}
    <p class="sub">With either strip there's room for 1 promotion. The cards above are the automatic ones; this version is made in your browser and isn't saved.</p>
    <div class="co-out"></div></div>`;
  const out = el.querySelector(".co-out"), sel = el.querySelector('[data-co="tpFile"]');
  const draw = () => {
    if (sel) sel.hidden = !o.tp;
    if (o.nectar === def.nectar && !o.tp) { out.innerHTML = `<p class="sub">Same as the automatic cards above.</p>`; return; }
    out.innerHTML = `<div class="cardset">${Object.keys(SIZES).map(t => `<figure><div class="co-frame" data-size="${t}"><iframe tabindex="-1" title="${esc(LABEL[t])} version"></iframe></div>
      <figcaption>${esc(LABEL[t])}</figcaption><button type="button" class="linkbtn" data-dl="${t}">Download</button></figure>`).join("")}</div>`;
    out.querySelectorAll(".co-frame").forEach(box => {
      const t = box.dataset.size, [w, h] = SIZES[t], f = box.querySelector("iframe");
      box.style.aspectRatio = `${w}/${h}`;
      f.style.cssText = `width:${w}px;height:${h}px;border:0;transform-origin:0 0;transform:scale(${box.clientWidth / w});pointer-events:none`;
      f.onload = () => f.contentWindow.ready && f.contentWindow.ready();
      f.srcdoc = cardDoc(data(r, k, sid, o), t, LOGO);
    });
    out.querySelectorAll("[data-dl]").forEach(b => b.addEventListener("click", async () => {
      const t = b.dataset.dl, [w, h] = SIZES[t], was = b.textContent;
      b.disabled = true; b.textContent = "Making…";
      try {
        const url = await render(cardDoc(data(r, k, sid, o), t, LOGO), w, h);
        const a = document.createElement("a");
        a.href = url; a.download = `${sid}_${t}${o.nectar ? "_nectar" : ""}${o.tp ? "_trustpilot" : ""}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
        b.textContent = was;
      } catch (e) { b.textContent = "Couldn't make it"; }
      finally { b.disabled = false; }
    }));
  };
  el.querySelectorAll("[data-co]").forEach(i => i.addEventListener("change", () => {
    o[i.dataset.co] = i.type === "checkbox" ? i.checked : i.value; draw();
  }));
  draw();
}
