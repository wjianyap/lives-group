// Fuzzy matching used to stop duplicate customers, vendors and items BEFORE they reach an approver.
// "National Univ. Hospital (S) Pte Ltd" and "National University Hospital" should be caught as the same thing.

// Legal suffixes and filler words that do not tell two organisations apart
const STOP_WORDS = new Set([
  "pte", "ltd", "limited", "private", "sdn", "bhd", "berhad", "pt", "tbk", "co", "company", "inc", "corp",
  "corporation", "llc", "plc", "jsc", "the", "and", "of", "s", "public", "group",
]);

// Words almost every healthcare name contains; sharing them says little, so they count for less
const GENERIC_WORDS = new Set([
  "hospital", "medical", "center", "clinic", "laboratory", "health", "healthcare", "general", "diagnostic",
  "service", "scientific", "university", "national", "international", "specialist", "institute", "pharma",
  "technology", "supply", "trading", "rumah", "sakit", "benh", "vien", "department", "solution",
]);
const weight = (t) => (GENERIC_WORDS.has(t) ? 0.3 : 1);

// Common abbreviations in Southeast-Asian healthcare names
const ABBREVIATIONS = {
  hosp: "hospital", hsp: "hospital", univ: "university", uni: "university", natl: "national", nat: "national",
  intl: "international", med: "medical", ctr: "center", centre: "center", cntr: "center", lab: "laboratory",
  labs: "laboratory", laboratories: "laboratory", gen: "general", dept: "department", diag: "diagnostics",
  diagnostic: "diagnostics", st: "saint", mt: "mount", rs: "rumah sakit", bv: "benh vien", sci: "scientific",
  tech: "technology", technologies: "technology", svcs: "services", svc: "services", mfg: "manufacturing",
  kl: "kuala lumpur", jb: "johor bahru", hcmc: "ho chi minh", hcm: "ho chi minh", bkk: "bangkok", jkt: "jakarta",
};

// Light plural stemming so "Supplies" == "Supply" and "Diagnostics" == "Diagnostic"
function stem(t) {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function normalize(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (Bệnh viện -> benh vien)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] || t)
    .join(" ")
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t))
    .map(stem)
    .join(" ");
}

// Identifiers (tax no., part no.) only compare letters and digits: "201-234-567X" == "201234567x"
function normalizeId(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function jaroWinkler(a, b) {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array(a.length).fill(false);
  const bMatch = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// Weighted share of words in common, with credit for near-identical words ("hospita" vs "hospital")
function tokenSimilarity(a, b) {
  const ta = [...new Set(a.split(" ").filter(Boolean))];
  const tb = [...new Set(b.split(" ").filter(Boolean))];
  if (!ta.length || !tb.length) return 0;
  let hits = 0;
  for (const x of ta) {
    let best = 0;
    for (const y of tb) {
      const sim = x === y ? 1 : x.length > 3 && jaroWinkler(x, y) >= 0.93 ? 0.9 : 0;
      best = Math.max(best, sim * Math.min(weight(x), weight(y)));
    }
    hits += best;
  }
  const wa = ta.reduce((s, t) => s + weight(t), 0);
  const wb = tb.reduce((s, t) => s + weight(t), 0);
  const dice = (2 * hits) / (wa + wb);
  // One name fully inside the other ("Gleneagles Hospital" in "Gleneagles Hospital Kuala Lumpur"): worth a review
  const containment = ta.length >= 2 && tb.length >= 2 && Math.min(wa, wb) >= 1 ? hits / Math.min(wa, wb) : 0;
  return Math.max(dice, containment >= 0.99 ? 0.82 : 0);
}

// "NUH" vs "National University Hospital"
function isAcronym(short, long) {
  const words = long.split(" ");
  return short.length >= 3 && !short.includes(" ") && words.length >= 3 && words.map((w) => w[0]).join("") === short;
}

function nameScore(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb || na.replace(/ /g, "") === nb.replace(/ /g, "")) return 1;
  if (isAcronym(na, nb) || isAcronym(nb, na)) return 0.85;
  return tokenSimilarity(na, nb);
}

/**
 * Compares a candidate record against existing ones.
 * @param {object} input   { name, identifier, email, phone }
 * @param {Array}  pool    [{ name, identifier, email, phone, ...anything }]
 * @returns matches sorted by score, each with readable reasons
 */
function findMatches(input, pool, { possible = 0.8, likely = 0.92 } = {}) {
  const out = [];
  const inId = normalizeId(input.identifier);
  const inEmailDomain = (input.email || "").toLowerCase().split("@")[1];
  const inPhone = String(input.phone || "").replace(/\D/g, "").slice(-8);

  for (const rec of pool) {
    const reasons = [];
    let score = 0;

    const ns = input.name ? nameScore(input.name, rec.name) : 0;
    if (ns >= 0.75) reasons.push(`Name ${Math.round(ns * 100)}% similar to "${rec.name}"`);
    score = ns;

    if (inId && inId.length >= 4 && normalizeId(rec.identifier) === inId) {
      reasons.push("Same registration / part number");
      score = Math.max(score, 0.99);
    }
    const recEmail = (rec.email || "").toLowerCase();
    const genericMail = /gmail|yahoo|hotmail|outlook/.test(inEmailDomain || "");
    if (inEmailDomain && !genericMail && recEmail.endsWith("@" + inEmailDomain)) {
      reasons.push(`Same email domain (@${inEmailDomain})`);
      score = Math.min(1, score + 0.08);
    }
    if (inPhone.length === 8 && String(rec.phone || "").replace(/\D/g, "").slice(-8) === inPhone) {
      reasons.push("Same phone number");
      score = Math.min(1, score + 0.1);
    }

    if (score >= possible) {
      out.push({ ...rec, score: Number(score.toFixed(3)), level: score >= likely ? "likely" : "possible", reasons });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

module.exports = { normalize, normalizeId, jaroWinkler, nameScore, findMatches };
