// Suggested primary text in French for the Ad creator's French ads (Sam, 14 Oct 2026, France stage 2), as adcopy.js
// does for the UK: built from the chosen sailings' own facts, with no AI. Warm and factual, "vous" throughout,
// French typography (a narrow no-break space before ? ! : ; and inside « »), prices as "1 029 €". Nothing is made up:
// every figure comes from the tracker (prices, dates, ports, nights, live offers). No was/now for France.
//
// suggest(items, format) -> [{label, text}]
// items: [{title, ship, port, nights, departure_date, price, promos: [...]}]

const NB = " ";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const money = v => Math.round(v).toLocaleString("en-GB").replace(/,/g, NB) + " €";
const day = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d === 1 ? "1er" : d} ${MOIS[m - 1]} ${y}`; };
const mois = iso => { const [y, m] = iso.split("-").map(Number); return `${MOIS[m - 1]} ${y}`; };
const de = w => /^[aeiouéèêh]/i.test(w) ? `d'${w}` : `de ${w}`;
const list = xs => xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}`;
const uniq = xs => [...new Set(xs.filter(Boolean))];
const town = p => String(p || "").split(",")[0].trim();
const q = t => `«${NB}${t}${NB}»`;
const MOTS = ["zéro", "une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix"];
const SMALL_PRINT = "Prix par personne, base deux personnes, sous réserve de disponibilité.";
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
// Card-safe offer lines ("Formule Plus -50%", "Supplément Solo offert · jusqu'au 23 nov."): the name, and its end date
const offre = line => { const [n, ...bits] = String(line).split(" · "); const end = bits.find(b => b.startsWith("jusqu")); return `${q(n)}${end ? ` (${end})` : ""}`; };

function facts(items){
  const ports = uniq(items.map(i => town(i.port))), dates = items.map(i => i.departure_date).filter(Boolean).sort();
  const nights = items.map(i => i.nights).filter(Boolean), promoSets = items.map(i => i.promos || []);
  const [a, b] = [dates[0], dates[dates.length - 1]];
  let when = "";
  if (a) {
    const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
    when = ya === yb && ma === mb ? `en ${mois(a)}` : ya === yb ? `${de(MOIS[ma - 1])} à ${MOIS[mb - 1]} ${yb}` : `${de(mois(a))} à ${mois(b)}`;
  }
  return {ports, when, min: Math.min(...items.map(i => i.price)), ship: items[0].ship,
          nights: [Math.min(...nights), Math.max(...nights)], shared: (promoSets[0] || []).find(p => promoSets.every(s => s.includes(p)))};
}
const nuits = f => f.nights[0] === f.nights[1] ? `${f.nights[0]} nuits` : `de ${f.nights[0]} à ${f.nights[1]} nuits`;
const depart = f => f.ports.length > 3 ? `au départ de ${f.ports.length} ports` : `au départ ${de(list(f.ports))}`;

function carousel(items){
  const f = facts(items), n = items.length, N = MOTS[n] || String(n), out = [];
  const close = f.ports.length === 1 ? `Toutes partent ${de(f.ports[0])}.` : `Départs ${de(list(f.ports))} : il y en a forcément une pour vous.`.replace(" :", `${NB}:`);
  out.push({label: "Accueillant", text:
    `Où naviguerez-vous ensuite${NB}? Nous avons sélectionné pour vous ${N} croisières à bord du ${f.ship}, à partir de ${money(f.min)} par personne, ` +
    `avec des départs ${f.when}. ${close} Faites défiler et trouvez celle qui vous ressemble. ${SMALL_PRINT}`});
  out.push({label: "Évasion", text:
    `Imaginez${NB}: chaque matin, un nouvel horizon, et à bord, un accueil chaleureux qui vous attend. ${cap(N)} croisières à bord du ${f.ship}, ` +
    `${depart(f)}, ${f.when}. À partir de ${money(f.min)} par personne. ${SMALL_PRINT}`});
  out.push({label: "Prix", text:
    `Des croisières à partir de ${money(f.min)} par personne avec Ambassador Croisières. Choisissez parmi ${N} croisières ${nuits(f)}, ` +
    `${depart(f)}, ${f.when}. ${SMALL_PRINT}`});
  if (f.shared) out.push({label: "Offre", text:
    `Profitez de l'offre ${offre(f.shared)} sur ces ${N} croisières. Choisissez votre préférée, ${depart(f)}, à partir de ${money(f.min)} par personne. ${SMALL_PRINT}`});
  return out;
}

function single(items){
  const i = items[0], t = i.title, p = money(i.price), d = day(i.departure_date), from = `${de(town(i.port))}`, out = [];
  out.push({label: "Accueillant", text:
    `Envie de nous rejoindre pour ${q(t)}${NB}? Départ ${from} le ${d}, à bord du ${i.ship}, pour ${i.nights} nuits, à partir de ${p} par personne. ${SMALL_PRINT}`});
  out.push({label: "Évasion", text:
    `Imaginez-vous à bord du ${i.ship} pour ${q(t)}${NB}: ${i.nights} nuits au départ ${from}, le ${d}, et un accueil chaleureux à chaque escale. À partir de ${p} par personne. ${SMALL_PRINT}`});
  out.push({label: "Prix", text:
    `${q(t)}${NB}: ${i.nights} nuits à partir de ${p} par personne, départ ${from} le ${d} avec Ambassador Croisières. ${SMALL_PRINT}`});
  if ((i.promos || [])[0]) out.push({label: "Offre", text:
    `Profitez de l'offre ${offre(i.promos[0])} sur ${q(t)}, départ ${from} le ${d}. À partir de ${p} par personne. ${SMALL_PRINT}`});
  return out;
}

export function suggest(items, format){
  if (!items.length) return [];
  return (format === "single" ? single(items.slice(0, 1)) : carousel(items))
    .map(o => ({...o, text: o.text.replace(/[ \t\n]+/g, " ").replace(/ \./g, ".").trim()}));
}
