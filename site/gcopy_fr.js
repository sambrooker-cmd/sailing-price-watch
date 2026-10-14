// Google Ads copy in French for Ambassador Croisières (Sam, 14 Oct 2026, France stage 3), as gcopy.js does for the UK:
// built from the sailings' own facts with no AI, within Google's limits (gcopy.js LIMITS), lines over a limit left out.
// "vous", factual, nothing invented; prices as "679 €" with plain spaces (Google Ads text), "Dès 679 €/pers." in
// headlines. No was/now for France. "Sans avion" only for departures from mainland French ports.
//
// copySet(items) → same shape as gcopy.js copySet; items: [{id, title, ship, port, nights, departure_date, price, promos, link}]

import {LIMITS} from "./gcopy.js?v=__BUILD__";
export const BUSINESS = "Ambassador Croisières";
export const SITE = "https://www.ambassadorcroisieres.fr/";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const money = v => Math.round(v).toLocaleString("en-GB").replace(/,/g, " ") + " €";
const day = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d === 1 ? "1er" : d} ${MOIS[m - 1]} ${y}`; };
const mois = iso => { const [y, m] = iso.split("-").map(Number); return `${MOIS[m - 1]} ${y}`; };
const de = w => /^[aeiouéèêh]/i.test(w) ? `d'${w}` : `de ${w}`;
const town = p => String(p || "").split(",")[0].trim();
const list = xs => xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}`;
const uniq = xs => [...new Set(xs.filter(Boolean).map(x => x.replace(/\s+/g, " ").trim()))];
const fit = (xs, n) => uniq(xs).filter(x => x.length <= n);
// Departures from mainland France need no flight: the French market's "no-fly"
const MAINLAND = /dunkerque|marseille|le havre|bordeaux|brest|nice|toulon|saint-malo|cherbourg|rouen|nantes|calais|sète|la rochelle/i;
const offerName = line => String(line).split(" · ")[0].trim();
const span = (a, b) => { if (!a) return ""; const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number);
  return y1 === y2 && m1 === m2 ? `en ${mois(a)}` : y1 === y2 ? `${de(MOIS_C[m1 - 1])} à ${MOIS_C[m2 - 1]} ${y2}` : `${de(`${MOIS_C[m1 - 1]} ${y1}`)} à ${MOIS_C[m2 - 1]} ${y2}`; };
// A short name for headlines: the whole name if it fits, else the part before " et " or a separator
// ("Trésors d'Islande et des îles Féroé" → "Trésors d'Islande"), else whole words that still read as a name
export function shortName(t, n){
  t = String(t || "").replace(/\s*&\s*/g, " et ").trim(); if (t.length <= n) return t;
  for (const sep of [" – ", " - ", ": ", ", ", " et "]) if (t.includes(sep)) { const a = t.split(sep)[0]; if (a.length <= n && a.length >= 6) return a; }
  const w = t.split(" "), out = [];
  for (const x of w) { if ((out.concat(x)).join(" ").length > n) break; out.push(x); }
  while (out.length && /^(de|du|des|d'|et|la|le|les|en|au|aux|à)$/i.test(out[out.length - 1])) out.pop();
  return out.length >= 2 ? out.join(" ") : "";
}
// Display path words: no accents or spaces
const ascii = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const pathOf = (s, n = 15) => ascii(s).replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, n);
const placeWord = t => { const w = ascii(t).split(/[\s'’,:–-]+/).find(x => x.length >= 4 && !/^(croisiere|escapade|tresors|saveurs|rivages|horizons|secrets|traditions|joyaux|meilleur|splendeurs|parfums|odyssee|grande|grand|merveilles|terre|entre)$/i.test(x)); return w || ""; };

function single(i){
  const t = String(i.title).trim(), p = money(i.price), d = day(i.departure_date), tw = town(i.port), mainland = MAINLAND.test(i.port || "");
  const offer = (i.promos || [])[0] && offerName(i.promos[0]), name30 = shortName(t, 30), name40 = shortName(t, 40);
  const headlines = [name30, `Dès ${p}/pers.`, `Croisière de ${i.nights} nuits`, `Départ ${de(tw)}`, `Départ le ${d}`, `À bord du ${i.ship}`,
    BUSINESS, offer, mainland && "Croisière sans avion", `Départ en ${mois(i.departure_date)}`, `${i.nights} nuits dès ${p}`,
    "Réservez votre croisière", "Un accueil chaleureux à bord", "Réservez dès maintenant"];
  const descriptions = [
    `${t} : ${i.nights} nuits à bord du ${i.ship}, départ ${de(tw)} le ${d}. Dès ${p}/pers.`,
    `${t} : ${i.nights} nuits au départ ${de(tw)}. À partir de ${p} par personne.`,
    `${i.nights} nuits à bord du ${i.ship}, départ ${de(tw)} le ${d}. Dès ${p}/pers.`,
    `Croisière de ${i.nights} nuits au départ ${de(tw)}, le ${d}. À partir de ${p} par personne.`,
    mainland && `Sans avion : votre voyage commence dès l'embarquement à ${tw}.`,
    offer && `Profitez de l'offre ${offer} sur cette croisière. Dès ${p}/pers.`,
    `Un accueil chaleureux à bord du ${i.ship}, avec ${BUSINESS}.`,
    "Prix par personne, base deux personnes, sous réserve de disponibilité."];
  const longHeadlines = [`${t} : ${i.nights} nuits au départ ${de(tw)}, dès ${p}/pers.`,
    `Croisière de ${i.nights} nuits à bord du ${i.ship}, départ le ${d}`,
    mainland && `Croisière sans avion au départ ${de(tw)} avec ${BUSINESS}`, offer && `${offer} sur ${t}`, `Découvrez ${t} avec ${BUSINESS}`];
  return {
    rsa: {headlines: fit(headlines, 30).slice(0, 15), descriptions: fit(descriptions, 90).slice(0, 4),
          path1: "Croisieres", path2: pathOf(placeWord(t) || tw)},
    pmax: {headlines: fit(headlines, 30).slice(0, 15), longHeadlines: fit(longHeadlines, 90).slice(0, 5),
           descriptions: [...fit([`${i.nights} nuits au départ ${de(tw)}. Dès ${p}/pers.`, `Dès ${p}/pers. ${i.nights} nuits à bord.`], 60).slice(0, 1), ...fit(descriptions, 90)].slice(0, 5)},
    dg: {headlines: fit([name40, `Croisière de ${i.nights} nuits dès ${p}`, t, `${i.nights} nuits à bord du ${i.ship}`, `Dès ${p}/pers.`, `Départ ${de(tw)}`,
                         "Où naviguerez-vous ensuite ?", "Un accueil chaleureux à bord"], 40).slice(0, 5),
         descriptions: fit(descriptions, 90).slice(0, 5)},
    sitelinks: [{text: shortName(t, 25) || "Cette croisière", d1: `${i.nights} nuits dès ${p}/pers.`, d2: `Départ le ${d}`, url: i.link},
                {text: "Nos offres", d1: "Nos dernières offres", d2: "Sous réserve de disponibilité", url: SITE + "offres"}],
    callouts: fit([`Départ ${de(tw)}`, `Croisière de ${i.nights} nuits`, `À bord du ${i.ship}`, offer, mainland && "Sans avion", "Prix par personne"], LIMITS.callout),
  };
}

function group(items){
  const n = items.length, min = money(Math.min(...items.map(i => i.price)));
  const towns = uniq(items.map(i => town(i.port))), dates = items.map(i => i.departure_date).filter(Boolean).sort();
  const nights = items.map(i => i.nights), nr = Math.min(...nights) === Math.max(...nights) ? `${nights[0]} nuits` : `${Math.min(...nights)} à ${Math.max(...nights)} nuits`;
  const from = towns.length <= 2 ? `au départ ${de(list(towns))}` : `au départ de ${towns.length} ports`;
  const when = span(dates[0], dates[dates.length - 1]), mainland = items.every(i => MAINLAND.test(i.port || ""));
  const sets = items.map(i => i.promos || []), shared = (sets[0] || []).find(p => sets.every(s => s.includes(p))), offer = shared && offerName(shared);
  const headlines = [`Croisières dès ${min}/pers.`, `${n} croisières au choix`, BUSINESS, towns.length <= 2 ? `Départ ${de(list(towns))}` : `${towns.length} ports de départ`, when && `Départs ${when}`,
    `De ${nr} en mer`.replace(/^De (\d+) nuits en mer$/, "$1 nuits en mer"), "À bord du Renaissance", offer, mainland && "Croisières sans avion",
    "Un accueil chaleureux à bord", "Où naviguerez-vous ensuite ?", "Réservez votre croisière", ...items.map(i => shortName(i.title, 30))];
  const descriptions = [
    `Choisissez parmi ${n} croisières ${from}, ${when}. Dès ${min}/pers.`,
    `${n} croisières ${from}, ${when}. À partir de ${min} par personne.`,
    `${n} croisières de ${nr}, ${when}. Dès ${min}/pers., base deux personnes.`,
    `${n} croisières de ${nr}, ${when}. Dès ${min}/pers.`,
    `${n} croisières ${from}. À partir de ${min} par personne.`,
    `Croisières à bord du Renaissance, ${when}. Dès ${min}/pers.`,
    mainland && "Sans avion : votre voyage commence dès l'embarquement.",
    offer && `Profitez de l'offre ${offer} sur ces ${n} croisières. Dès ${min}/pers.`,
    `Un accueil chaleureux à bord du Renaissance, avec ${BUSINESS}.`,
    "Prix par personne, base deux personnes, sous réserve de disponibilité."];
  const longHeadlines = [`Croisières ${from}, ${when}, dès ${min}/pers.`, `Choisissez parmi ${n} croisières de ${nr} avec ${BUSINESS}`,
    mainland && `Croisières sans avion ${from}`, offer && `${offer} sur ${n} croisières ${from}`, "Où naviguerez-vous ensuite ? Un accueil chaleureux vous attend"];
  return {
    rsa: {headlines: fit(headlines, 30).slice(0, 15), descriptions: fit(descriptions, 90).slice(0, 4),
          path1: "Croisieres", path2: dates[0] ? pathOf(`${ascii(MOIS_C[+dates[0].slice(5, 7) - 1]).replace(".", "")}-${dates[0].slice(0, 4)}`) : ""},
    pmax: {headlines: fit(headlines, 30).slice(0, 15), longHeadlines: fit(longHeadlines, 90).slice(0, 5),
           descriptions: [...fit([`Croisières ${from}, dès ${min}/pers.`, `${n} croisières de ${nr}, dès ${min}/pers.`], 60).slice(0, 1), ...fit(descriptions, 90)].slice(0, 5)},
    dg: {headlines: fit([`Croisières dès ${min}/pers.`, `${n} croisières ${from}`, `Croisières ${when}`, "Où naviguerez-vous ensuite ?", "Un accueil chaleureux à bord", offer], 40).slice(0, 5),
         descriptions: fit(descriptions, 90).slice(0, 5)},
    sitelinks: [...items.slice(0, 6).map(i => ({text: shortName(i.title, 25) || i.id, d1: `${i.nights} nuits dès ${money(i.price)}/pers.`, d2: `Départ le ${day(i.departure_date)}`, url: i.link})).filter(s => s.text),
                {text: "Nos offres", d1: "Nos dernières offres", d2: "Sous réserve de disponibilité", url: SITE + "offres"}],
    callouts: fit([mainland && "Croisières sans avion", towns.length === 1 && `Départ ${de(towns[0])}`, nr, offer, "Prix par personne", `${n} croisières au choix`], LIMITS.callout),
  };
}

export function copySet(items){
  if (!items.length) return null;
  return items.length === 1 ? single(items[0]) : group(items);
}

// Euro prices quoted in a line that aren't the current ones (saved copy whose prices have since moved)
export function stalePrices(text, items){
  const ok = new Set(items.map(i => String(Math.round(i.price))));
  items.forEach(i => (i.promos || []).forEach(p => (p.match(/\d[\d\s]*/g) || []).forEach(n => ok.add(n.replace(/\s/g, "")))));
  return [...String(text).matchAll(/(\d[\d   ]*)\s?€/g)].map(m => m[1].replace(/[\s  ]/g, "")).filter(n => !ok.has(n));
}
