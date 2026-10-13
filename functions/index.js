// "Make video" from the tracker page (Sam, 13 Oct 2026, option 3): anyone on the planner's allowlist can
// make slideshow videos of an Ad creator ad without a GitHub account.
//
// POST /makeVideo {code, title, cards}  → checks the Google sign-in and the allowlist, records the request in
//   Firestore (pricewatch_videos/<id>) and starts the "Make video" GitHub workflow with the ad's code.
//   The workflow (make_video.py, video_job.py) saves the MP4s to Storage and marks the request done.
// GET /makeVideo → the last KEEP_DAYS days of requests, newest first, for the Ad creator's Videos list.
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

initializeApp();
const GH = defineSecret("GITHUB_VIDEO_TOKEN");
const REPO = "sambrooker-cmd/sailing-price-watch";
const WORKFLOW = "make-video.yml";
const COL = "pricewatch_videos";
const DAY_LIMIT = 20;      // videos a day for everyone together (each run is about 4 GitHub minutes)
const PER_PERSON = 2;      // requests one person can have waiting or running at once
const KEEP_DAYS = 30;      // video_job.py deletes older videos; the list shows the same period
const STUCK_MIN = 30;      // a request still "queued" after this never started on GitHub

const iso = t => (t && t.toDate ? t.toDate() : new Date(t)).toISOString();

exports.makeVideo = onRequest({
  region: "us-central1", cors: ["https://acl-price-watch.web.app"], secrets: [GH],
  maxInstances: 2, memory: "256MiB", timeoutSeconds: 30,
}, async (req, res) => {
  const m = (req.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({error: "Sign in to the tracker first."});
  let user;
  try { user = await getAuth().verifyIdToken(m[1]); }
  catch (e) {
    console.error("verifyIdToken", e.code || "", e.message);
    return res.status(401).json({error: "Your sign-in has expired: reload the page."});
  }
  const email = user.email || "";
  const db = getFirestore();
  const allowed = email && user.email_verified &&
    ((await db.doc(`allowlist/${email}`).get()).exists || (await db.doc(`allowlist/${email.toLowerCase()}`).get()).exists);
  if (!allowed) return res.status(403).json({error: "You're not on the tracker's allowlist."});

  const since = new Date(Date.now() - KEEP_DAYS * 864e5);
  if (req.method === "GET") {
    const snap = await db.collection(COL).where("at", ">=", since).orderBy("at", "desc").limit(60).get();
    const stuck = Date.now() - STUCK_MIN * 6e4;
    return res.json({videos: snap.docs.map(d => {
      const v = d.data();
      const late = v.status === "queued" && v.at.toMillis() < stuck;
      return {id: d.id, by: v.by, at: iso(v.at), title: v.title || "", cards: v.cards || 0,
              status: late ? "failed" : v.status, error: late ? "It didn't start on GitHub. Try again." : (v.error || ""),
              files: v.files || [], prices: v.prices || "", until: v.until || "", run: v.run || ""};
    }), limit: DAY_LIMIT});
  }
  if (req.method !== "POST") return res.status(405).json({error: "Not allowed."});

  const b = req.body || {};
  const code = String(b.code || "");
  if (!/^[A-Za-z0-9_-]{20,8000}$/.test(code)) return res.status(400).json({error: "That ad couldn't be read."});
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const today = (await db.collection(COL).where("at", ">=", day).count().get()).data().count;
  if (today >= DAY_LIMIT) return res.status(429).json({error: `Today's ${DAY_LIMIT} videos have been made. Try again tomorrow.`});
  const fresh = Date.now() - STUCK_MIN * 6e4;   // one field per query, so Firestore needs no extra index
  const mine = await db.collection(COL).where("by", "==", email).get();
  if (mine.docs.filter(d => { const v = d.data(); return ["queued", "running"].includes(v.status) && v.at && v.at.toMillis() >= fresh; }).length >= PER_PERSON)
    return res.status(429).json({error: "You already have videos being made. Wait for those to finish."});

  const ref = db.collection(COL).doc();
  await ref.set({by: email, at: FieldValue.serverTimestamp(), status: "queued",
                 title: String(b.title || "").slice(0, 200), cards: Math.min(12, Math.max(0, parseInt(b.cards, 10) || 0))});
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {Authorization: `Bearer ${GH.value().trim()}`, Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pricewatch-make-video"},
    body: JSON.stringify({ref: "main", inputs: {link: code, request: ref.id}}),
  });
  if (!r.ok) {
    const why = r.status === 401 ? "the GitHub token has expired or is wrong" : `GitHub answered ${r.status}`;
    await ref.update({status: "failed", error: `Couldn't start: ${why}.`});
    console.error("dispatch failed", r.status, (await r.text()).slice(0, 300));
    return res.status(502).json({error: `Couldn't start the video on GitHub (${why}).`});
  }
  return res.json({id: ref.id});
});
