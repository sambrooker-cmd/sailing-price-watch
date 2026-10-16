// Route video (Sam, 16 Oct 2026: "a route video per sailing, on each of the sailing cards", the A32651 Tropical
// Treasures video as the template). In a sailing's detail view: the words over the ship, which airports' planes
// to show, a Make button, and this sailing's route videos. The video is made on GitHub (route_video.py, Actions →
// Route video) through the Firebase function makeVideo (kind "route"), which checks the allowlist and the daily
// limit; the MP4s go to Storage for 30 days (video_job.py). No prices are in the video.
import {regionOf, photoWords} from "./comptrend.js?v=__BUILD__";

const FN = "https://us-central1-promotions-planner.cloudfunctions.net/makeVideo";
const WORKFLOW = "https://github.com/sambrooker-cmd/sailing-price-watch/actions/workflows/route-video.yml";
const AIRPORT = {Heathrow: "LHR", Gatwick: "LGW", Manchester: "MAN", Birmingham: "BHX", Bristol: "BRS", Stansted: "STN",
  Luton: "LTN", "East Midlands": "EMA", Newcastle: "NCL", Edinburgh: "EDI", Glasgow: "GLA", Belfast: "BFS", Cardiff: "CWL"};
// What the headline calls the destination, by the tracker's regions (route_video.py default_words does the same
// from the itinerary's countries when the workflow is run by hand)
const PLACE = {caribbean: "THE CARIBBEAN", iceland: "ICELAND", norway: "THE FJORDS", baltic: "THE BALTIC",
  british: "THE BRITISH ISLES", iberia: "SPAIN AND PORTUGAL", med: "THE MEDITERRANEAN", near: "EUROPE", long: "THE WORLD"};
const UK_PORTS = /tilbury|london|liverpool|dundee|newcastle|tyne|portsmouth|bristol|portbury|belfast|southampton|hull|rosyth|leith|edinburgh|greenock|glasgow|plymouth|falmouth|dover|harwich|holyhead|cardiff/i;
const SIZE_NAME = {"1x1": "1:1", "4x5": "4:5", "9x16": "9:16"};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const when = iso => new Date(iso).toLocaleString("en-GB", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London"});

export function defaults(id, s, kitRow){
  const region = regionOf(s.base_title || s.title || "", s.port || "", photoWords((kitRow || {}).photos));
  const place = PLACE[region] || "THE WORLD";
  const headline = `${place}, THE WAY ${place === "THE FJORDS" ? "THEY" : "IT"} SHOULD FEEL.`;
  const home = UK_PORTS.test(s.port || "");
  const line = s.flight_from && !home ? "Smaller ship. Direct flight. Everything sorted."
    : `Smaller ship. Sail from ${String(s.port || "the UK").replace(/,.*$/, "")}. Everything sorted.`;
  return {headline, line};
}

// The same sailing from the other airport: A32651 (Heathrow) ↔ A32651M (Manchester)
function twinOf(id, s, sailings){
  if (!s.flight_from) return null;
  for (const [k, o] of Object.entries(sailings || {})) {
    if (k !== id && !o.removed && o.flight_from && o.flight_from !== s.flight_from &&
        o.departure_date === s.departure_date && (o.base_title || o.title) === (s.base_title || s.title)) return [k, o];
  }
  return null;
}

let timer = null;

export async function mount(el, {id, sailing: s, sailings, kitRow, idToken}){
  clearTimeout(timer);
  const d = defaults(id, s, kitRow);
  const twin = twinOf(id, s, sailings);
  const own = AIRPORT[s.flight_from] || "";
  const other = twin ? AIRPORT[twin[1].flight_from] || "" : "";
  const st = {headline: "", line: "", airports: twin && other ? "both" : "own", busy: false, note: "", videos: null, off: false, playing: null};
  const codes = [id, ...(twin ? [twin[0]] : [])];

  async function api(method, body){
    const token = await idToken();
    let r;
    try {
      r = await fetch(FN, {method, body: body ? JSON.stringify(body) : undefined,
        headers: {Authorization: `Bearer ${token}`, ...(body ? {"Content-Type": "application/json"} : {})}});
    } catch(e) { throw Object.assign(new Error("The video service can't be reached."), {served: false}); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `The video service answered ${r.status}.`), {served: !!j.error});
    return j;
  }
  async function load(){
    clearTimeout(timer);
    try { st.videos = ((await api("GET")).videos || []).filter(v => v.kind === "route" && (v.codes || []).some(c => codes.includes(c))); st.off = false; }
    catch(e) { if (!e.served) st.off = true; }
    if (!el.isConnected) return;
    draw();
    if ((st.videos || []).some(v => v.status === "queued" || v.status === "running")) timer = setTimeout(load, 20000);
  }
  const airportCodes = () => !s.flight_from ? [] : st.airports === "both" ? [own, other].filter(Boolean)
    : st.airports === "other" ? [other] : [own];

  async function make(){
    const headline = (st.headline || d.headline).trim(), line = (st.line || d.line).trim();
    if (st.off) {
      window.open(WORKFLOW, "_blank", "noopener");
      st.note = `The video service can't be reached, so GitHub's Route video page has opened: Run workflow, type ${id} as the cruise code` +
        (s.flight_from ? ` and ${airportCodes().join(",")} as the airports` : "") + `, and run it. The videos are on the run page in about 15 minutes.`;
      return draw();
    }
    st.busy = true; draw();
    try {
      await api("POST", {kind: "route", sailing: id, airports: airportCodes(), headline, line,
                         title: `${s.base_title || s.title || id} (${id})`});
      st.note = "Making the route video: about 15 minutes. It appears below (this checks every 20 seconds), and you can carry on meanwhile.";
    } catch(e) {
      st.note = e.message;
      if (!e.served) st.off = true;
    }
    st.busy = false;
    load();
  }

  function row(v){
    const who = esc((v.by || "").split("@")[0].replace(/[._]/g, " "));
    const head = `<div class="ac-vh"><b>${esc(v.headline || v.title || "Route video")}</b><span class="sub">${v.airports && v.airports.length ? `planes from ${esc(v.airports.join(" and "))} · ` : ""}${who} · ${esc(when(v.at))}</span></div>`;
    if (v.status === "queued") return `<li>${head}<span class="ac-vs">Waiting to start…</span></li>`;
    if (v.status === "running") return `<li>${head}<span class="ac-vs">Being made, about 15 minutes…</span></li>`;
    if (v.status !== "done") return `<li>${head}<span class="ac-vs err">${esc(v.error || "Something went wrong.")}</span></li>`;
    return `<li>${head}<div class="ac-vf">${v.files.map(f => `<span>${SIZE_NAME[f.size] || esc(f.size)}: <a href="${esc(f.url)}" download="${esc(f.name)}">${esc(f.length)} s</a><button type="button" class="linkbtn" data-rvplay="${esc(f.url)}" aria-label="Play ${SIZE_NAME[f.size] || esc(f.size)}">▶</button></span>`).join("")}</div>
      ${st.playing && v.files.some(f => f.url === st.playing) ? `<video src="${esc(st.playing)}" controls autoplay playsinline></video>` : ""}</li>`;
  }

  function draw(){
    const air = s.flight_from ? `<label class="rv-f"><span>Planes from</span>
        <select id="rv-air">${twin && other ? `<option value="both"${st.airports === "both" ? " selected" : ""}>${esc(s.flight_from)} and ${esc(twin[1].flight_from)} (as the template)</option>` : ""}
          <option value="own"${st.airports === "own" ? " selected" : ""}>${esc(s.flight_from)} only</option>
          ${twin && other ? `<option value="other"${st.airports === "other" ? " selected" : ""}>${esc(twin[1].flight_from)} only (${esc(twin[0])})</option>` : ""}</select></label>` : "";
    el.innerHTML = `<p class="sub" style="margin:0 0 8px">A video of this sailing's route for social, made from the template: ${s.flight_from ? "the flights, " : ""}the ship sailing port to port on the map, a photo of each port, the ship, and the end card, with the template's music. 9:16, 4:5 and 1:1, up to a minute. No prices, so it can be used while the sailing is on sale.</p>
      <div class="rv-form">
        <label class="rv-f"><span>Words over the ship</span><input id="rv-h" maxlength="90" value="${esc(st.headline)}" placeholder="${esc(d.headline)}"></label>
        <label class="rv-f"><span>Line under them</span><input id="rv-l" maxlength="90" value="${esc(st.line)}" placeholder="${esc(d.line)}"></label>
        ${air}
        <div><button type="button" class="btn sm" id="rv-make"${st.busy ? " disabled" : ""}>${st.busy ? "Starting…" : "Make route video"}</button>
          <span class="rv-hint">Left blank, the grey words are used.</span></div>
      </div>
      ${st.note ? `<p class="note">${esc(st.note)}</p>` : ""}
      ${st.videos && st.videos.length ? `<div class="ac-vids"><h4 style="margin:12px 0 4px">Route videos of this sailing</h4><ul>${st.videos.slice(0, 10).map(row).join("")}</ul>
        <p class="note">Kept for 30 days. Click a length to download, ▶ to watch here.</p></div>` : ""}`;
    el.querySelector("#rv-h").addEventListener("input", e => { st.headline = e.target.value; });
    el.querySelector("#rv-l").addEventListener("input", e => { st.line = e.target.value; });
    const a = el.querySelector("#rv-air");
    a && a.addEventListener("change", e => { st.airports = e.target.value; });
    el.querySelector("#rv-make").addEventListener("click", make);
    el.querySelectorAll("[data-rvplay]").forEach(b => b.addEventListener("click", () => {
      st.playing = st.playing === b.dataset.rvplay ? null : b.dataset.rvplay; draw();
    }));
  }
  draw();
  load();
}
