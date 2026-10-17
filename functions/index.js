// "Make video" from the tracker page (Sam, 13 Oct 2026, option 3): anyone on the planner's allowlist can
// make slideshow videos of an Ad creator ad without a GitHub account.
//
// POST /makeVideo {code, title, cards}  → checks the Google sign-in and the allowlist, records the request in
//   Firestore (pricewatch_videos/<id>) and starts the "Make video" GitHub workflow with the ad's code.
//   The workflow (make_video.py, video_job.py) saves the MP4s to Storage and marks the request done.
// POST /makeVideo {kind: "route", sailing, airports, headline, line} → the same for a sailing's route video (Sam,
//   16 Oct 2026): starts the "Route video" workflow (route_video.py) instead.
// GET /makeVideo → the last KEEP_DAYS days of requests, newest first, for the Ad creator's Videos list and the
//   Route videos in a sailing's detail view (each request has its kind).
//
// Deployed by .github/workflows/video-function.yml. The GitHub token (Actions: read and write on this repo
// only) is the GITHUB_VIDEO_TOKEN secret in Secret Manager, set from the repo secret VIDEO_DISPATCH_TOKEN.
// Nothing here can read or change prices, cards or anything outside this one workflow.
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
// firebase-admin 14 only has the modular API (admin.auth() / admin.firestore() are gone)
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const crypto = require("crypto");

initializeApp();
const GH = defineSecret("GITHUB_VIDEO_TOKEN");
const REPO = "sambrooker-cmd/sailing-price-watch";
const WORKFLOW = "make-video.yml", ROUTE_WORKFLOW = "route-video.yml";
const COL = "pricewatch_videos";
const DAY_LIMIT = 20;      // videos a day for everyone together (each run is about 4 GitHub minutes)
const PER_PERSON = 2;      // requests one person can have waiting or running at once
const KEEP_DAYS = 30;      // video_job.py deletes older videos; the list shows the same period
const STUCK_MIN = 30;      // a request still "queued" after this never started on GitHub

// Who is asking: a signed-in, verified Google account on the planner's allowlist. Sends the refusal itself.
async function allowedUser(req, res){
  const m = (req.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!m) { res.status(401).json({error: "Sign in to the tracker first."}); return null; }
  let user;
  try { user = await getAuth().verifyIdToken(m[1]); }
  catch (e) {
    console.error("verifyIdToken", e.code || "", e.message);
    res.status(401).json({error: "Your sign-in has expired: reload the page."}); return null;
  }
  const email = user.email || "";
  const db = getFirestore();
  const ok = email && user.email_verified &&
    ((await db.doc(`allowlist/${email}`).get()).exists || (await db.doc(`allowlist/${email.toLowerCase()}`).get()).exists);
  if (!ok) { res.status(403).json({error: "You're not on the tracker's allowlist."}); return null; }
  return email;
}

const iso = t => (t && t.toDate ? t.toDate() : new Date(t)).toISOString();

// Starts a GitHub workflow for a request recorded at `ref`. Returns true, or the message to show; a request that
// couldn't start is marked failed so it doesn't hold a place in the limits (QA, 13 Oct 2026).
async function dispatch(ref, workflow, inputs, what){
  let r;
  try {
    r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {Authorization: `Bearer ${GH.value().trim()}`, Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pricewatch-tracker"},
      body: JSON.stringify({ref: "main", inputs}),
    });
  } catch (e) {
    console.error("dispatch error", workflow, e.message);
    await ref.update({status: "failed", error: "Couldn't reach GitHub. Try again in a minute."});
    return `Couldn't reach GitHub to start the ${what}. Try again in a minute.`;
  }
  if (r.ok) return true;
  const why = r.status === 401 ? "the GitHub token has expired or is wrong" : `GitHub answered ${r.status}`;
  await ref.update({status: "failed", error: `Couldn't start: ${why}.`});
  console.error("dispatch failed", workflow, r.status, (await r.text()).slice(0, 300));
  return `Couldn't start the ${what} on GitHub (${why}).`;
}

exports.makeVideo = onRequest({
  region: "us-central1", cors: ["https://acl-price-watch.web.app"], secrets: [GH],
  maxInstances: 10, memory: "256MiB", timeoutSeconds: 30,
}, async (req, res) => {
  const email = await allowedUser(req, res);
  if (!email) return;
  const db = getFirestore();

  const since = new Date(Date.now() - KEEP_DAYS * 864e5);
  if (req.method === "GET") {
    const snap = await db.collection(COL).where("at", ">=", since).orderBy("at", "desc").limit(60).get();
    const stuck = Date.now() - STUCK_MIN * 6e4;
    return res.json({videos: snap.docs.map(d => {
      const v = d.data();
      const late = v.status === "queued" && v.at.toMillis() < stuck;
      return {id: d.id, by: v.by, at: iso(v.at), title: v.title || "", cards: v.cards || 0,
              status: late ? "failed" : v.status, error: late ? "It didn't start on GitHub. Try again." : (v.error || ""),
              files: v.files || [], prices: v.prices || "", until: v.until || "", run: v.run || "", codes: v.codes || [],
              kind: v.kind || "ad", headline: v.headline || "", airports: v.airports || []};
    }), limit: DAY_LIMIT});
  }
  if (req.method !== "POST") return res.status(405).json({error: "Not allowed."});

  const b = req.body || {};
  const route = b.kind === "route";
  const code = String(b.code || "");
  const sailing = String(b.sailing || "").toUpperCase();
  // the words go to GitHub as workflow inputs: plain text only, short
  const words = v => String(v || "").replace(/[\u0000-\u001f"`$\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  const airports = (Array.isArray(b.airports) ? b.airports : []).map(a => String(a).toUpperCase()).filter(a => /^[A-Z]{3}$/.test(a)).slice(0, 4);
  if (route ? !/^[A-Z0-9]{4,12}$/.test(sailing) : !/^[A-Za-z0-9_-]{20,8000}$/.test(code))
    return res.status(400).json({error: route ? "That sailing couldn't be read." : "That ad couldn't be read."});
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const today = (await db.collection(COL).where("at", ">=", day).count().get()).data().count;
  if (today >= DAY_LIMIT) return res.status(429).json({error: `Today's ${DAY_LIMIT} videos have been made. Try again tomorrow.`});
  const fresh = Date.now() - STUCK_MIN * 6e4;   // one field per query, so Firestore needs no extra index
  const mine = await db.collection(COL).where("by", "==", email).get();
  if (mine.docs.filter(d => { const v = d.data(); return ["queued", "running"].includes(v.status) && v.at && v.at.toMillis() >= fresh; }).length >= PER_PERSON)
    return res.status(429).json({error: "You already have videos being made. Wait for those to finish."});

  const ref = db.collection(COL).doc();
  if (route) {
    const headline = words(b.headline), line = words(b.line);
    await ref.set({by: email, at: FieldValue.serverTimestamp(), status: "queued", kind: "route",
                   title: String(b.title || sailing).slice(0, 200), cards: 0, codes: [sailing], headline, airports});
    const started = await dispatch(ref, ROUTE_WORKFLOW, {sailing, airports: airports.join(","), headline, line, request: ref.id}, "route video");
    if (started !== true) return res.status(502).json({error: started});
    return res.json({id: ref.id});
  }
  await ref.set({by: email, at: FieldValue.serverTimestamp(), status: "queued",
                 title: String(b.title || "").slice(0, 200), cards: Math.min(12, Math.max(0, parseInt(b.cards, 10) || 0)),
                 // the ad's cruise codes, so the Ad creator lists only this ad's videos (Sam, 14 Oct 2026)
                 codes: (Array.isArray(b.codes) ? b.codes : []).map(String).filter(c => /^[A-Za-z0-9]{3,20}$/.test(c)).slice(0, 12)});
  const started = await dispatch(ref, WORKFLOW, {link: code, request: ref.id}, "video");
  if (started !== true) return res.status(502).json({error: started});
  return res.json({id: ref.id});
});

// Email creator (Sam, 13 Oct 2026): stores one email's images (logo, header, sailing pictures, made in the
// browser) in Storage so the email's HTML can point at them. POST {images: [{name, data: base64 JPEG}]}
// → {urls: {name: url}}. Files: pricewatch-email/<YYYY-MM-DD>/<random>/<name>.jpg with a download token,
// public cache; deleted after EMAIL_KEEP_DAYS (emails stay viewable for a while after sending).
const EMAIL_KEEP_DAYS = 90;
const EMAIL_MAX_IMAGES = 16, EMAIL_MAX_BYTES = 900 * 1024, EMAIL_DAY_LIMIT = 300;   // images a day, everyone together

exports.emailImages = onRequest({
  region: "us-central1", cors: ["https://acl-price-watch.web.app"],
  maxInstances: 10, memory: "512MiB", timeoutSeconds: 60,
}, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({error: "Not allowed."});
  const email = await allowedUser(req, res);
  if (!email) return;
  const images = Array.isArray((req.body || {}).images) ? req.body.images : [];
  if (!images.length || images.length > EMAIL_MAX_IMAGES) return res.status(400).json({error: `Send 1 to ${EMAIL_MAX_IMAGES} images.`});
  const files = [];
  for (const im of images) {
    const name = String(im.name || "");
    const data = Buffer.from(String(im.data || ""), "base64");
    if (!/^[a-z0-9_-]{1,60}$/.test(name)) return res.status(400).json({error: "Bad image name."});
    if (data.length < 100 || data.length > EMAIL_MAX_BYTES || data[0] !== 0xff || data[1] !== 0xd8)
      return res.status(400).json({error: `Image ${name} isn't a JPEG under ${EMAIL_MAX_BYTES / 1024} KB.`});
    files.push({name, data});
  }
  const db = getFirestore(), day = new Date().toISOString().slice(0, 10);
  const counter = db.doc(`pricewatch_email/${day}`);
  const used = await db.runTransaction(async t => {
    const n = ((await t.get(counter)).data() || {}).images || 0;
    if (n + files.length > EMAIL_DAY_LIMIT) return -1;
    t.set(counter, {images: n + files.length}, {merge: true});
    return n;
  });
  if (used < 0) return res.status(429).json({error: "Today's email image allowance is used up. Try again tomorrow."});

  const bucket = getStorage().bucket("promotions-planner.firebasestorage.app");
  const folder = `pricewatch-email/${day}/${crypto.randomBytes(6).toString("hex")}`;
  const urls = {};
  await Promise.all(files.map(async f => {
    const path = `${folder}/${f.name}.jpg`, token = crypto.randomUUID();
    await bucket.file(path).save(f.data, {resumable: false, metadata: {contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000", metadata: {firebaseStorageDownloadTokens: token, by: email}}});
    urls[f.name] = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  }));
  console.log("email images", email, folder, files.length);

  // Tidy up: delete emails' images older than EMAIL_KEEP_DAYS (dated folders), a few days at a time.
  try {
    const cutoff = new Date(Date.now() - EMAIL_KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    const [old] = await bucket.getFiles({prefix: "pricewatch-email/", maxResults: 300});
    await Promise.all(old.filter(f => (f.name.split("/")[1] || "9") < cutoff).map(f => f.delete().catch(() => {})));
  } catch (e) { console.error("email cleanup", e.message); }
  return res.json({urls});
});

// Saved ads and emails, shared by everyone on the allowlist (Sam, 13 Oct 2026: they lived in one browser, so they
// didn't follow people between devices and the team couldn't see each other's). Firestore pricewatch_saved/<id>:
// {kind: "ad" | "email", name, by, saved_at, data (the ad or email as JSON; no prices, no uploaded photos)}.
// GET ?kind=ad → {me, items}. POST {op: "save", kind, id?, name, data} → {id, saved_at}; {op: "rename", id, name};
// {op: "delete", id}. Everyone can open and copy anything; only the person who saved an item can save over,
// rename or delete it.
// maxInstances 10 (was 2, 15 Oct 2026): at 256 MiB each copy answers one request at a time, so 2 made a queue
// once a few people used the tracker together. Copies only exist while busy (no cost when idle); the daily limits
// below still cap use.
// ecards: saved sets of Email cards (Sam, 15 Oct 2026: "map out each email send")
// page: saved landing pages and blog posts (pagemaker.js, Sam 16 Oct 2026)
const SAVED = "pricewatch_saved", SAVED_KINDS = ["ad", "email", "ecards", "page", "keywords", "campaign"], SAVED_MAX_BYTES = 300 * 1024, SAVED_MAX = 1000;
exports.saved = onRequest({
  region: "us-central1", cors: ["https://acl-price-watch.web.app"],
  maxInstances: 10, memory: "256MiB", timeoutSeconds: 30,
}, async (req, res) => {
  const email = await allowedUser(req, res);
  if (!email) return;
  const db = getFirestore(), col = db.collection(SAVED);
  if (req.method === "GET") {
    const kind = String(req.query.kind || "");
    if (!SAVED_KINDS.includes(kind)) return res.status(400).json({error: "Unknown kind."});
    const snap = await col.where("kind", "==", kind).get();   // one field: no extra index needed; sorted here
    const items = snap.docs.map(d => { const v = d.data(); return {id: d.id, name: v.name, by: v.by, saved_at: iso(v.saved_at), data: v.data}; })
      .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
    return res.json({me: email, items});
  }
  if (req.method !== "POST") return res.status(405).json({error: "Not allowed."});
  const b = req.body || {}, op = String(b.op || "");
  const name = String(b.name || "").trim().slice(0, 120);
  const mineOr403 = async id => {
    const doc = await col.doc(id).get();
    if (!doc.exists) { res.status(404).json({error: "That item has been deleted."}); return null; }
    if (doc.data().by !== email) { res.status(403).json({error: `Only ${doc.data().by} can change this one. Use "Save a copy" to keep your own.`}); return null; }
    return doc;
  };
  if (op === "save") {
    const kind = String(b.kind || ""), data = String(b.data || "");
    if (!SAVED_KINDS.includes(kind)) return res.status(400).json({error: "Unknown kind."});
    if (!name) return res.status(400).json({error: "Give it a name."});
    if (!data || data.length > SAVED_MAX_BYTES) return res.status(400).json({error: "That's too big to save."});
    try { JSON.parse(data); } catch (e) { return res.status(400).json({error: "That couldn't be read."}); }
    const at = FieldValue.serverTimestamp();
    if (b.id) {
      if (!/^[A-Za-z0-9]{10,40}$/.test(String(b.id))) return res.status(400).json({error: "Bad id."});
      if (!(await mineOr403(String(b.id)))) return;
      await col.doc(String(b.id)).update({name, data, saved_at: at});
      return res.json({id: String(b.id), saved_at: new Date().toISOString()});
    }
    if ((await col.where("kind", "==", kind).count().get()).data().count >= SAVED_MAX)
      return res.status(429).json({error: `There are ${SAVED_MAX} saved already: delete some old ones first.`});
    const ref = col.doc();
    await ref.set({kind, name, by: email, data, saved_at: at, created_at: at});
    return res.json({id: ref.id, saved_at: new Date().toISOString()});
  }
  if (op === "rename" || op === "delete") {
    const id = String(b.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).json({error: "Bad id."});
    if (!(await mineOr403(id))) return;
    if (op === "rename") { if (!name) return res.status(400).json({error: "Give it a name."}); await col.doc(id).update({name}); }
    else await col.doc(id).delete();
    return res.json({ok: true});
  }
  return res.status(400).json({error: "Unknown request."});
});

// "Draft with Claude" in the Ad creator and Email creator (Sam, 14 Oct 2026, the free option: Claude Code on Sam's
// plan in a GitHub run, not a paid API key); Google Ads (kind "google") and the page creator (kind "page", with the
// page's outline in `page`) since. POST {kind: "ad" | "email" | "google" | "page", format, items: [{id, wasnow, promos,
// nectar}], brief, page} → records pricewatch_drafts/<id> and starts the Draft text workflow (draft_job.py), which builds
// the facts from the repo's saved state (never from what the browser sends), asks Claude and saves the options.
// GET ?id= → {status, error, options, notes}: the page asks every few seconds until it's done.
const DRAFTS = "pricewatch_drafts", DRAFT_WORKFLOW = "draft-text.yml";
const DRAFT_DAY_LIMIT = 60;     // drafts a day for everyone together (each is a short run on Sam's plan)
const DRAFT_STUCK_MIN = 10;     // a draft still "queued" after this never started on GitHub
exports.drafts = onRequest({
  region: "us-central1", cors: ["https://acl-price-watch.web.app"], secrets: [GH],
  maxInstances: 10, memory: "256MiB", timeoutSeconds: 30,
}, async (req, res) => {
  const email = await allowedUser(req, res);
  if (!email) return;
  const db = getFirestore(), col = db.collection(DRAFTS);
  if (req.method === "GET") {
    const id = String(req.query.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).json({error: "Bad id."});
    const doc = await col.doc(id).get();
    if (!doc.exists) return res.status(404).json({error: "That draft has gone."});
    const v = doc.data();
    // queued and never started, or running past the workflow's own 15-minute limit (cancelled runs skip the failure step)
    const late = (v.status === "queued" && v.at && v.at.toMillis() < Date.now() - DRAFT_STUCK_MIN * 6e4) ||
                 (v.status === "running" && v.at && v.at.toMillis() < Date.now() - 25 * 6e4);
    return res.json({status: late ? "failed" : v.status, error: late ? "It didn't start on GitHub. Try again." : (v.error || ""),
                     options: v.options || [], notes: v.notes || [], prices: v.prices || ""});
  }
  if (req.method !== "POST") return res.status(405).json({error: "Not allowed."});
  const b = req.body || {}, kind = String(b.kind || "");
  if (!["ad", "email", "google", "page"].includes(kind)) return res.status(400).json({error: "Unknown kind."});
  // Landing pages and blog posts (pagemaker.js, Sam 16 Oct 2026): the page's outline (headings and guidance to fill),
  // cleaned and cut to size; the facts still come from the repo's state, never from here
  const t = (v, n) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  const pg = kind !== "page" ? null : (o => ({kind: o.kind === "blog" ? "blog" : "landing", template: t(o.template, 20), keyword: t(o.keyword, 80),
    h1: t(o.h1, 120), sections: (Array.isArray(o.sections) ? o.sections : []).slice(0, 16).map(x => ({h2: t((x || {}).h2, 120), hint: t((x || {}).hint, 240)})),
    faq: (Array.isArray(o.faq) ? o.faq : []).slice(0, 8).map(q => t(q, 160)).filter(Boolean), wantFaq: !!o.wantFaq}))(b.page || {});
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 24).map(x => ({
    id: String((x || {}).id || "").slice(0, 20), wasnow: x.wasnow ? String(x.wasnow).slice(0, 40) : null,
    promos: (Array.isArray(x.promos) ? x.promos : []).slice(0, 4).map(p => String(p).slice(0, 200)), nectar: x.nectar !== false}))
    .filter(x => /^[A-Za-z0-9]{3,20}$/.test(x.id));
  if (!items.length) return res.status(400).json({error: "Add some sailings first."});
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  if ((await col.where("at", ">=", day).count().get()).data().count >= DRAFT_DAY_LIMIT)
    return res.status(429).json({error: `Today's ${DRAFT_DAY_LIMIT} drafts have been made. Try again tomorrow.`});
  const fresh = Date.now() - DRAFT_STUCK_MIN * 6e4;
  const mine = await col.where("by", "==", email).get();
  if (mine.docs.some(d => { const v = d.data(); return ["queued", "running"].includes(v.status) && v.at && v.at.toMillis() >= fresh; }))
    return res.status(429).json({error: "You already have a draft being written. Wait for that one first."});
  const ref = col.doc();
  await ref.set({by: email, at: FieldValue.serverTimestamp(), status: "queued", kind,
                 format: b.format === "single" ? "single" : "carousel", items: JSON.stringify(items),
                 brief: String(b.brief || "").slice(0, 300), ...(pg ? {page: JSON.stringify(pg)} : {}),
                 market: b.market === "fr" ? "fr" : "uk"});   // France (Sam, 14 Oct 2026): draft_job.py reads state/fr
  const started = await dispatch(ref, DRAFT_WORKFLOW, {request: ref.id}, "draft");
  if (started !== true) return res.status(502).json({error: started});
  return res.json({id: ref.id});
});

// Meta ads (Sam, 17 Oct 2026: the tracker may now change our own Meta ads, after approval in the tracker). The page's
// Approve / Reject buttons and its changes made by hand come here; only approvers may send them (META_APPROVERS,
// comma-separated emails, from the repo variable of that name at deploy; default Sam). An approval or change is recorded
// in Firestore pricewatch_meta/<id> and starts the "Meta ads: apply" workflow (meta-apply.yml → meta_manage.py apply),
// which holds the Meta token: it never comes here or to the browser. A rejection is only recorded.
// GET → the last 30 days of requests (everyone on the allowlist) and whether the caller may approve.
const META_COL = "pricewatch_meta", META_WORKFLOW = "meta-apply.yml", META_DAY_LIMIT = 200;
const approvers = () => String(process.env.META_APPROVERS || "sam.brooker@ambassadorcruiseline.com").toLowerCase().split(/[,\s]+/).filter(Boolean);
exports.metaAction = onRequest({
  region: "us-central1", cors: ["https://acl-price-watch.web.app"], secrets: [GH],
  maxInstances: 10, memory: "256MiB", timeoutSeconds: 30,
}, async (req, res) => {
  const email = await allowedUser(req, res);
  if (!email) return;
  const db = getFirestore(), col = db.collection(META_COL), may = approvers().includes(email.toLowerCase());
  if (req.method === "GET") {
    const since = new Date(Date.now() - 30 * 864e5);
    const snap = await col.where("at", ">=", since).orderBy("at", "desc").limit(300).get();
    return res.json({approver: may, items: snap.docs.map(d => { const v = d.data();
      const late = ["queued", "running"].includes(v.status) && v.at && v.at.toMillis() < Date.now() - STUCK_MIN * 6e4;
      return {id: d.id, op: v.op, proposal: v.proposal || "", ad: v.ad || "", what: v.what || "", by: v.by, at: v.at ? iso(v.at) : null,
              status: late ? "failed" : v.status, result: v.result || "", error: late ? "It didn't finish on GitHub." : (v.error || "")}; })});
  }
  if (req.method !== "POST") return res.status(405).json({error: "Not allowed."});
  if (!may) return res.status(403).json({error: "Only the Meta ads approvers can do this."});
  const b = req.body || {}, op = String(b.op || ""), num = v => /^\d{1,20}$/.test(String(v || ""));
  const what = String(b.what || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
  let payload;
  if (op === "approve" || op === "reject") {
    if (!num(b.ad) || !/^[0-9a-f]{12}$/.test(String(b.proposal || ""))) return res.status(400).json({error: "Bad proposal."});
    payload = {ad: String(b.ad), proposal: String(b.proposal)};
  } else if (op === "publish") {
    // An Ad creator ad (its share code: no prices, the tracker renders it with today's), into an ad set, always paused
    const code = String(b.code || "");
    if (!/^[A-Za-z0-9_-]{20,20000}$/.test(code) || !num(b.adset)) return res.status(400).json({error: "Bad ad."});
    payload = {code, adset: String(b.adset), kind: b.kind === "video" ? "video" : "image", name: String(b.name || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 100)};
  } else if (op === "manual") {
    const m = b.change || {}, kind = String(m.kind || ""), type = String(m.type || "");
    if (!num(m.id) || !["ad", "adset", "campaign"].includes(type) || !["status", "budget", "bid", "end", "targeting"].includes(kind)) return res.status(400).json({error: "Bad change."});
    payload = {id: String(m.id), type, kind};
    if (kind === "status") { if (!["ACTIVE", "PAUSED"].includes(m.status)) return res.status(400).json({error: "Bad status."}); payload.status = m.status; }
    if (kind === "budget") { if (!["daily_budget", "lifetime_budget"].includes(m.field) || !num(m.value)) return res.status(400).json({error: "Bad budget."}); payload.field = m.field; payload.value = String(m.value); }
    if (kind === "bid") { if (!num(m.value)) return res.status(400).json({error: "Bad bid."}); payload.value = String(m.value); }
    if (kind === "targeting") {
      const age = v => v == null || v === "" ? null : Number(v), lo = age(m.age_min), hi = age(m.age_max);
      if ([lo, hi].some(v => v != null && !(Number.isInteger(v) && v >= 18 && v <= 65))) return res.status(400).json({error: "Ages must be 18 to 65."});
      const g = m.genders == null ? null : (Array.isArray(m.genders) ? m.genders : []).map(Number);
      if (g && !["", "1", "2"].includes(g.join(""))) return res.status(400).json({error: "Bad gender choice."});
      const cs = (Array.isArray(m.countries) ? m.countries : []).map(c => String(c).toUpperCase()).slice(0, 25);
      if (!cs.every(c => /^[A-Z]{2}$/.test(c))) return res.status(400).json({error: "Countries are two-letter codes."});
      Object.assign(payload, {age_min: lo, age_max: hi, genders: g, countries: cs});
    }
    if (kind === "end") { if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?([+-]\d{4}|Z)?$/.test(String(m.end_time || ""))) return res.status(400).json({error: "Bad end date."}); payload.end_time = m.end_time; }
  } else return res.status(400).json({error: "Unknown request."});
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  if ((await col.where("at", ">=", day).count().get()).data().count >= META_DAY_LIMIT)
    return res.status(429).json({error: `Today's ${META_DAY_LIMIT} Meta changes have been made. Try again tomorrow.`});
  const ref = col.doc();
  await ref.set({by: email, at: FieldValue.serverTimestamp(), op, status: op === "reject" ? "rejected" : "queued", what,
                 proposal: payload.proposal || "", ad: payload.ad || payload.id || "", payload: JSON.stringify(payload)});
  if (op === "reject") return res.json({id: ref.id});
  const started = await dispatch(ref, META_WORKFLOW, {request: ref.id}, "Meta change");
  if (started !== true) return res.status(502).json({error: started});
  return res.json({id: ref.id});
});
