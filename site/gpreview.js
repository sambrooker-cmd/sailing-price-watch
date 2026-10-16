// Preview of a sailing's Performance Max assets where Google shows them (Sam, 16 Oct 2026: "build a preview viewer
// for the PMAX assets"): Search, Display (its own responsive ad, and the uploaded banners on a page), YouTube (in-feed
// and Shorts), Discover and Gmail, on a desktop or phone. Like the Ad creator's Facebook/Instagram mock, these are
// close approximations: Google mixes the headlines, descriptions and images itself ("Show another mix" steps through
// combinations), and its layouts change. Built from the Ad copy tab's text for the sailing and the Images tab's images.
//
// previewHtml(o) → HTML. o: {set (gcopy copySet / edited), url, business, cta, channel, device, n (the mix), fr,
//   img(name) → '<img data-gpv="name">' placeholder for: landscape, square, portrait, logo, b300x250, b728x90, b320x50, b300x600}

const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
export const CHANNELS = [["all", "Everywhere"], ["search", "Search"], ["display", "Display"], ["youtube", "YouTube"], ["discover", "Discover"], ["gmail", "Gmail"]];
const pick = (xs, n, k = 0) => xs && xs.length ? xs[(n + k) % xs.length] : "";
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (x) { return "ambassadorcruiseline.com"; } };

export const CSS = `
.gp-wrap{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start}
.gp-place{flex:0 1 auto}
.gp-place>h4{margin:0 0 6px;font-size:13px;color:var(--muted);font-weight:600}
.gp-dev,.gp-dev *{text-align:left;letter-spacing:normal;text-transform:none;font-family:Roboto,Arial,Helvetica,sans-serif;box-sizing:border-box}
.gp-dev.gp-dev h4,.gp-dev.gp-dev p,.gp-dev.gp-dev small,.gp-dev.gp-dev b{margin:0;color:inherit}
.gp-dev{background:#fff;color:#202124;font-family:Roboto,Arial,Helvetica,sans-serif;border:1px solid var(--rule);box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden}
.gp-dev.phone{width:360px;border-radius:18px;border:8px solid #1f1f1f}
.gp-dev.desk{width:620px;border-radius:6px}
.gp-dev img{display:block;max-width:100%}
.gp-ad{font-size:12px;font-weight:700;color:#202124}
.gp-s{padding:14px 16px}
.gp-s .top{display:flex;align-items:center;gap:10px}
.gp-s .fav{width:28px;height:28px;border-radius:50%;overflow:hidden;border:1px solid #dadce0;flex:none}
.gp-s .fav img{width:100%;height:100%;object-fit:cover}
.gp-s .who{font-size:14px;line-height:1.25}.gp-s .who small{display:block;color:#4d5156;font-size:12px}
.gp-s .h{color:#1a0dab;font-size:20px;line-height:1.3;margin:8px 0 4px}
.gp-s .d{color:#4d5156;font-size:14px;line-height:1.55}
.gp-s .row{display:flex;gap:12px}.gp-s .row .th{width:92px;height:92px;flex:none;border-radius:8px;overflow:hidden}.gp-s .th img{width:100%;height:100%;object-fit:cover}
.gp-s .sl{margin-top:10px;border-top:1px solid #ebebeb}
.gp-s .sl div{padding:9px 0;border-bottom:1px solid #ebebeb;color:#1a0dab;font-size:14px}
.gp-s .sl.inline{border:0;display:flex;flex-wrap:wrap;gap:4px 18px}.gp-s .sl.inline div{border:0;padding:0}
.gp-page{padding:12px 14px;background:#fafafa}
.gp-page .ln{height:9px;background:#e3e3e3;border-radius:4px;margin:9px 0}
.gp-page .tt{height:16px;background:#cfcfcf;width:70%;border-radius:4px;margin:4px 0 12px}
.gp-page .cols{display:flex;gap:16px}.gp-page .cols>div:first-child{flex:1}
.gp-page .slot{display:flex;justify-content:center;margin:10px 0}
.gp-native{border:1px solid #e0e0e0;background:#fff;margin:12px 0}
.gp-native .tx{padding:10px 12px}.gp-native .h{font-size:16px;font-weight:700;line-height:1.3}
.gp-native .d{font-size:13px;color:#5f6368;margin-top:4px;line-height:1.4}
.gp-native .ft{display:flex;align-items:center;gap:8px;padding:0 12px 12px;font-size:12px;color:#5f6368}
.gp-native .ft .lg{width:22px;height:22px;border-radius:50%;overflow:hidden}.gp-native .ft .lg img{width:100%;height:100%}
.gp-cta{margin-left:auto;background:#1a73e8;color:#fff;border-radius:18px;padding:7px 14px;font-weight:600;font-size:13px;white-space:nowrap}
.gp-yt{background:#0f0f0f;color:#f1f1f1}
.gp-yt .th{position:relative}.gp-yt .th img{width:100%;aspect-ratio:16/9;object-fit:cover}
.gp-yt .meta{display:flex;gap:10px;padding:10px 12px 14px}.gp-yt .lg{width:36px;height:36px;border-radius:50%;overflow:hidden;flex:none}.gp-yt .lg img{width:100%;height:100%}
.gp-yt .h{font-size:15px;line-height:1.35;font-weight:600;color:#f1f1f1}.gp-yt small{color:#aaa;font-size:12px;display:block;margin-top:3px}
.gp-yt .ad{background:#f1f1f1;color:#0f0f0f;font-weight:700;font-size:11px;padding:1px 4px;border-radius:3px;margin-right:4px}
.gp-yt .cta{text-align:center;display:block;margin:0 12px 14px;background:#3ea6ff;color:#0f0f0f;text-align:center;border-radius:18px;padding:9px;font-weight:600;font-size:14px}
.gp-shorts{position:relative;height:640px;background:#000;color:#fff}
.gp-shorts>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.gp-shorts .ov{position:absolute;left:0;right:0;bottom:0;padding:14px;background:linear-gradient(transparent,rgba(0,0,0,.75))}
.gp-shorts .who{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600}.gp-shorts .lg{width:30px;height:30px;border-radius:50%;overflow:hidden}.gp-shorts .lg img{width:100%;height:100%}
.gp-shorts .h{font-size:14px;margin:8px 0 10px;line-height:1.35}
.gp-shorts .cta{text-align:center;display:block;background:#fff;color:#0f0f0f;text-align:center;border-radius:18px;padding:9px;font-weight:600;font-size:14px}
.gp-disc{background:#fff}
.gp-disc .card{margin:12px;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.gp-disc .card img{width:100%;aspect-ratio:1.91/1;object-fit:cover}
.gp-disc .tx{padding:12px 14px}.gp-disc .h{font-size:17px;line-height:1.3;color:#202124}
.gp-disc .ft{display:flex;align-items:center;gap:8px;padding:0 14px 14px;font-size:12px;color:#5f6368}
.gp-disc .ft .lg{width:18px;height:18px;border-radius:50%;overflow:hidden}.gp-disc .ft .lg img{width:100%;height:100%}
.gp-gm .row{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid #eee}
.gp-gm .row .lg{width:40px;height:40px;border-radius:50%;overflow:hidden;flex:none}.gp-gm .row .lg img{width:100%;height:100%}
.gp-gm .row b{font-size:14px}.gp-gm .row .h{font-size:14px;font-weight:700;margin-top:2px}.gp-gm .row .d{font-size:13px;color:#5f6368;margin-top:2px}
.gp-gm .open{padding:14px}.gp-gm .open img{width:100%;aspect-ratio:1.91/1;object-fit:cover;border-radius:8px;margin:10px 0}
.gp-gm .open .h{font-size:20px;line-height:1.3;color:#202124}.gp-gm .open .d{font-size:14px;color:#3c4043;margin-top:6px;line-height:1.5}
.gp-gm .open .cta{display:inline-block;margin-top:12px;background:#1a73e8;color:#fff;border-radius:4px;padding:9px 18px;font-weight:600;font-size:14px}
.gp-other{color:#9aa0a6}
`;

// One placement inside a device frame
const frame = (title, device, inner, cls = "") => `<div class="gp-place"><h4>${e(title)}</h4><div class="gp-dev ${device === "phone" ? "phone" : "desk"} ${cls}">${inner}</div></div>`;

export function previewHtml(o){
  const {set, n, img, business, device} = o, phone = device === "phone";
  const pm = set.pmax, rs = set.rsa, cta = o.cta, ad = o.fr ? "Sponsorisé" : "Sponsored";
  const h = k => pick(pm.headlines, n, k), lh = k => pick(pm.longHeadlines, n, k), d = k => pick(pm.descriptions, n, k);
  const path = [rs.path1, rs.path2].filter(Boolean).join(" › ");
  const out = [];
  const want = c => o.channel === "all" || o.channel === c;
  // Search: a text ad with an image and sitelinks
  if (want("search")) out.push(frame("Search", device, `<div class="gp-s">
      <div class="top"><div class="fav">${img("logo")}</div><div class="who"><span class="gp-ad">${ad}</span> · ${e(business)}<small>${e(host(o.url))}${path ? " › " + e(path) : ""}</small></div></div>
      <div class="row"><div style="flex:1"><div class="h">${e([pick(rs.headlines, n), pick(rs.headlines, n, 1), pick(rs.headlines, n, 2)].filter(Boolean).join(" | "))}</div>
        <div class="d">${e([pick(rs.descriptions, n), pick(rs.descriptions, n, 1)].filter(Boolean).join(" "))}</div></div>
        <div class="th">${img("square")}</div></div>
      <div class="sl ${phone ? "" : "inline"}">${(set.sitelinks || []).slice(0, 4).map(s => `<div>${e(s.text)}</div>`).join("")}</div></div>`));
  // Display: Google's own responsive ad on a page, and the uploaded banners in their slots
  if (want("display")) {
    out.push(frame("Display: responsive ad (Google builds it from the assets)", device, `<div class="gp-page"><div class="tt"></div><div class="ln"></div><div class="ln" style="width:85%"></div>
      <div class="gp-native">${img("landscape")}<div class="tx"><div class="h">${e(lh())}</div><div class="d">${e(d())}</div></div>
        <div class="ft"><div class="lg">${img("logo")}</div>${e(business)}<span class="gp-cta">${e(cta)}</span></div></div>
      <div class="ln"></div><div class="ln" style="width:60%"></div></div>`));
    out.push(frame("Display: your uploaded banners on a page", device, phone
      ? `<div class="gp-page"><div class="slot">${img("b320x50")}</div><div class="tt"></div><div class="ln"></div><div class="ln"></div><div class="slot">${img("b300x250")}</div><div class="ln"></div><div class="ln" style="width:70%"></div></div>`
      : `<div class="gp-page"><div class="slot">${img("b728x90")}</div><div class="cols"><div><div class="tt"></div>${"<div class=\"ln\"></div>".repeat(9)}<div class="ln" style="width:55%"></div></div><div>${img("b300x250")}</div></div></div>`));
  }
  // YouTube: in-feed, and Shorts (portrait) on a phone
  if (want("youtube")) {
    out.push(frame("YouTube: in-feed", device, `<div class="gp-yt"><div class="th">${img("landscape")}</div>
      <div class="meta"><div class="lg">${img("logo")}</div><div><div class="h">${e(h())}</div><small><span class="ad">Ad</span>${e(business)}</small><small>${e(d(1))}</small></div></div>
      <span class="cta">${e(cta)}</span></div>`, ""));
    out.push(frame("YouTube Shorts", "phone", `<div class="gp-shorts">${img("portrait")}<div class="ov"><div class="who"><div class="lg">${img("logo")}</div>${e(business)} <span style="opacity:.8;font-weight:400">· ${ad}</span></div>
      <div class="h">${e(lh(1))}</div><span class="cta">${e(cta)}</span></div></div>`));
  }
  // Discover feed card
  if (want("discover")) out.push(frame("Discover", "phone", `<div class="gp-disc"><div class="card">${img("landscape")}<div class="tx"><div class="h">${e(lh(2))}</div></div>
      <div class="ft"><div class="lg">${img("logo")}</div>${e(business)} · ${ad}<span class="gp-cta">${e(cta)}</span></div></div>
      <div class="card gp-other" style="padding:14px">Next story…</div></div>`));
  // Gmail: the Promotions row, then the opened ad
  if (want("gmail")) out.push(frame("Gmail: in the Promotions tab, then opened", device, `<div class="gp-gm">
      <div class="row"><div class="lg">${img("logo")}</div><div><b>${e(business)}</b> <span class="gp-ad" style="font-weight:400;color:#5f6368">· ${o.fr ? "Annonce" : "Ad"}</span><div class="h">${e(h(3))}</div><div class="d">${e(d(2))}</div></div></div>
      <div class="row gp-other"><div class="lg" style="background:#eee"></div><div>Another email…</div></div>
      <div class="open"><b>${e(business)}</b>${img("landscape")}<div class="h">${e(lh(3))}</div><div class="d">${e(d(3))}</div><span class="cta">${e(cta)}</span></div></div>`));
  return `<div class="gp-wrap">${out.join("")}</div>`;
}
