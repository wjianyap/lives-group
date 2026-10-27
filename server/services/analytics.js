// Regional business view: purchase-order volumes and growth for Products A, B, C across the five countries,
// demand forecasts, and customer-level opportunities (drop-off risk, cross-sell).
const PurchaseDoc = require("../models/purchase-doc-model");
const MasterRecord = require("../models/master-record-model");
const Request = require("../models/request-model");
const { COUNTRIES, PRODUCTS } = require("../config/constants");
const { compareAndForecast } = require("../utils/forecast");
const duplicates = require("./duplicates");

// Months "YYYY-MM", oldest first, ending at `end`
function monthRange(end, count) {
  const [y, m] = end.split("-").map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Results are cached for a few minutes: order history changes monthly, not per click.
// Merging customers clears the cache (see clearCache) so the regional view updates straight away.
const cache = new Map();
const TTL = 5 * 60 * 1000;
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}
exports.clearCache = () => cache.clear();

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (now, before) => (before > 0 ? Number((((now - before) / before) * 100).toFixed(1)) : null);

async function latestMonth() {
  const last = await PurchaseDoc.findOne({ docType: "order" }).sort({ month: -1 }).lean();
  return last?.month || new Date().toISOString().slice(0, 7);
}

// Duplicate customer records are folded into their surviving record, giving one clean customer view
async function canonicalMap() {
  const recs = await MasterRecord.find({ domainKey: "customer" }).lean();
  const map = {};
  for (const r of recs) map[r.code] = r.mergedInto || r.code;
  return { map, recs };
}

// order quantity series per country x product (and value), for `months`
async function orderSeries(months) {
  const docs = await PurchaseDoc.find({ docType: "order", month: { $in: months } }).lean();
  const idx = {};
  for (const d of docs) {
    const r = (idx[`${d.country}|${d.product}|${d.month}`] ||= { qty: 0, value: 0 });
    r.qty += d.qty || 0;
    r.value += d.valueUsd || 0;
  }
  const get = (c, p, field) => months.map((m) => idx[`${c}|${p}|${m}`]?.[field] || 0);
  return { get };
}

exports.regional = ({ months } = {}) => cached(`regional:${months || 12}`, () => regional({ months }));
async function regional({ months: windowMonths = 12 } = {}) {
  const end = await latestMonth();
  const w = Math.min(12, Math.max(6, Number(windowMonths) || 12));
  const all = monthRange(end, w * 2); // window + the same length before it (for year-on-year)
  const window = all.slice(w);
  const half = Math.floor(w / 2);
  const s = await orderSeries(all);

  const matrix = [];
  for (const c of COUNTRIES) {
    for (const p of PRODUCTS) {
      const qty = s.get(c.code, p.code, "qty");
      const value = s.get(c.code, p.code, "value");
      const cur = qty.slice(w);
      const prev = qty.slice(0, w);
      const recent = sum(cur.slice(w - half)); // last `half` months
      const recentLy = sum(prev.slice(w - half)); // the same months a year earlier
      matrix.push({
        country: c.code,
        product: p.code,
        units: sum(cur),
        unitsPrior: sum(prev),
        valueUsd: Math.round(sum(value.slice(w))),
        recent,
        recentLy,
        growthYoY: pct(sum(cur), sum(prev)),
        growthRecent: pct(recent, recentLy),
        monthly: cur,
        monthlyPrior: prev,
      });
    }
  }

  const total = (rows) => {
    const units = sum(rows.map((r) => r.units));
    return {
      units,
      valueUsd: sum(rows.map((r) => r.valueUsd)),
      growthYoY: pct(units, sum(rows.map((r) => r.unitsPrior))),
      growthRecent: pct(sum(rows.map((r) => r.recent)), sum(rows.map((r) => r.recentLy))),
      monthly: window.map((_, i) => sum(rows.map((r) => r.monthly[i]))),
      monthlyPrior: window.map((_, i) => sum(rows.map((r) => r.monthlyPrior[i]))),
    };
  };
  const byCountry = Object.fromEntries(COUNTRIES.map((c) => [c.code, total(matrix.filter((r) => r.country === c.code))]));
  const byProduct = Object.fromEntries(PRODUCTS.map((p) => [p.code, total(matrix.filter((r) => r.product === p.code))]));

  return {
    period: { from: window[0], to: window.at(-1), months: window },
    measure: {
      volume: "Units on confirmed customer purchase orders (docType = order). RFQs, enquiries and MDM setup requests are excluded.",
      growth: `Year-on-year: units ordered ${window[0]} – ${window.at(-1)} vs the ${w} months before (${all[0]} – ${all[w - 1]}). Comparing the same calendar months removes seasonality (Lunar New Year, year-end equipment budgets).`,
      momentum: `Recent momentum: the last ${half} months (${window[w - half]} – ${window.at(-1)}) vs the same ${half} months a year earlier.`,
    },
    countries: COUNTRIES,
    products: PRODUCTS,
    matrix,
    byCountry,
    byProduct,
    regionTotal: total(matrix),
  };
}

// Forecast every country x product with the back-test comparison
exports.forecasts = () => cached("forecasts", () => forecasts());
async function forecasts({ horizon = 6 } = {}) {
  const end = await latestMonth();
  const months = monthRange(end, 24);
  const s = await orderSeries(months);
  const future = Array.from({ length: horizon }, (_, i) => addMonths(end, i + 1));

  const series = [];
  let errBase = 0;
  let errBest = 0;
  let weight = 0;
  for (const c of COUNTRIES) {
    for (const p of PRODUCTS) {
      const history = s.get(c.code, p.code, "qty");
      const result = compareAndForecast(history, { holdout: 6, horizon });
      const vol = sum(history.slice(-6));
      const best = result.methods[result.best];
      if (result.methods.ma6.mape !== null && best.mape !== null) {
        errBase += result.methods.ma6.mape * vol;
        errBest += best.mape * vol;
        weight += vol;
      }
      series.push({
        country: c.code,
        product: p.code,
        history,
        ...result,
        nextHalfUnits: sum(result.forecast),
        lastHalfUnits: vol,
        outlookPct: pct(sum(result.forecast), vol),
      });
    }
  }
  return {
    months,
    future,
    holdoutMonths: months.slice(-6),
    series,
    summary: {
      baselineMape: weight ? Number((errBase / weight).toFixed(1)) : null,
      modelMape: weight ? Number((errBest / weight).toFixed(1)) : null,
      note: "Volume-weighted error on a 6-month hold-out (trained on months 1-18, tested on 19-24). Lower is better.",
    },
  };
}

// Customer drop-off risk and cross-sell opportunities, using the de-duplicated customer view
exports.insights = () => cached("insights", insights);
async function insights() {
  const end = await latestMonth();
  const months = monthRange(end, 12);
  const { map, recs } = await canonicalMap();
  const byCode = Object.fromEntries(recs.map((r) => [r.code, r]));

  const docs = await PurchaseDoc.find({ docType: "order", month: { $in: months } }).lean();
  const cust = {};
  for (const d of docs) {
    const code = map[d.customerCode] || d.customerCode;
    const c = (cust[code] ||= { code, monthlyQty: new Array(12).fill(0), monthlyValue: new Array(12).fill(0), products: {} });
    const i = months.indexOf(d.month);
    // drop-off is judged on recurring reagents + consumables; equipment (C) is a lumpy capital purchase
    if (d.product !== "C") {
      c.monthlyQty[i] += d.qty;
      c.monthlyValue[i] += d.valueUsd;
    }
    c.products[d.product] = (c.products[d.product] || 0) + d.valueUsd;
  }
  const info = (code) => byCode[code] || { name: code };
  // customers that still have an unmerged near-duplicate: their numbers are split across two codes
  const dupPairs = await duplicates.scanMasterData("customer");
  const dupOf = {};
  for (const p of dupPairs) {
    dupOf[p.a.code] = p.b;
    dupOf[p.b.code] = p.a;
  }

  // Drop-off: last 3 months well below the 6 months before them, or gone quiet
  const churn = [];
  for (const c of Object.values(cust)) {
    const prior = sum(c.monthlyValue.slice(3, 9)) / 6;
    const recent = sum(c.monthlyValue.slice(9)) / 3;
    const quietMonths = [...c.monthlyQty].reverse().findIndex((q) => q > 0);
    if (prior <= 0) continue;
    const drop = 1 - recent / prior;
    if (drop >= 0.4 || quietMonths >= 2) {
      const r = info(c.code);
      churn.push({
        code: c.code,
        name: r.name,
        country: r.country,
        segment: r.segment,
        dropPct: Math.round(drop * 100),
        monthsSinceLastOrder: quietMonths < 0 ? 12 : quietMonths,
        annualValueAtRisk: Math.round((prior - recent) * 12),
        products: Object.keys(c.products).sort(),
        possibleDuplicateOf: dupOf[c.code] || null,
        action: quietMonths >= 2 ? "Account manager call this week; check for competitor switch or stock issue" : "Review pricing / service issues; offer reagent rental or bundle",
      });
    }
  }
  churn.sort((a, b) => b.annualValueAtRisk - a.annualValueAtRisk);

  // Cross-sell: peers in the same segment who buy the same products also buy X
  const customers = Object.values(cust).map((c) => ({ ...c, info: info(c.code), set: new Set(Object.keys(c.products)) }));
  const crossSell = [];
  for (const c of customers) {
    for (const p of PRODUCTS.map((x) => x.code)) {
      if (c.set.has(p)) continue;
      const peers = customers.filter((o) => o !== c && o.info.segment === c.info.segment && [...c.set].every((q) => o.set.has(q)));
      if (peers.length < 3) continue;
      const buyers = peers.filter((o) => o.set.has(p));
      const adoption = buyers.length / peers.length;
      if (adoption < 0.5) continue;
      const values = buyers.map((o) => o.products[p]).sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      crossSell.push({
        code: c.code,
        name: c.info.name,
        country: c.info.country,
        segment: c.info.segment,
        has: [...c.set].sort(),
        suggest: p,
        peerAdoptionPct: Math.round(adoption * 100),
        peers: peers.length,
        estAnnualValue: Math.round(median * 0.5), // conservative: half of what a typical peer spends
        possibleDuplicateOf: dupOf[c.code] || null,
      });
    }
  }
  crossSell.sort((a, b) => b.estAnnualValue - a.estAnnualValue);
  // keep the list varied: at most 6 suggestions per product
  const perProduct = {};
  const crossSellTop = crossSell.filter((x) => (perProduct[x.suggest] = (perProduct[x.suggest] || 0) + 1) <= 6);

  const duplicateCustomers = recs.filter((r) => r.mergedInto).length;
  return {
    period: { from: months[0], to: months.at(-1) },
    churn: churn.slice(0, 15),
    crossSell: crossSellTop,
    totals: {
      churnValueAtRisk: sum(churn.map((c) => c.annualValueAtRisk)),
      crossSellValue: sum(crossSellTop.map((c) => c.estAnnualValue)),
      activeCustomers: customers.length,
      rawCustomerRecords: recs.length,
      mergedDuplicates: duplicateCustomers,
    },
  };
}

// Keeps demand separate from noise: orders vs RFQs vs enquiries vs MDM setup requests, per country
exports.pipeline = async function () {
  const end = await latestMonth();
  const months = monthRange(end, 12);
  const docs = await PurchaseDoc.find({ month: { $in: months } }).lean();
  const requests = await Request.find({ status: { $ne: "draft" } }).lean();
  const isOpen = (r) => ["pending", "changes_requested", "approved"].includes(r.status);

  return COUNTRIES.map((c) => {
    const get = (t) => {
      const mine = docs.filter((d) => d.country === c.code && d.docType === t);
      return { count: mine.length, value: sum(mine.map((d) => d.valueUsd || 0)) };
    };
    const mdmFor = (open) => requests.filter((r) => r.country === c.code && isOpen(r) === open).length;
    const openCustomerSetups = requests.filter((r) => r.country === c.code && isOpen(r) && r.domainKey === "customer").length;
    return {
      country: c.code,
      orders: { count: get("order").count, valueUsd: Math.round(get("order").value) },
      purchaseRequests: { count: get("purchase_request").count, valueUsd: Math.round(get("purchase_request").value) },
      enquiries: { count: get("enquiry").count },
      mdmOpen: mdmFor(true),
      mdmDone: mdmFor(false),
      openCustomerSetups,
    };
  });
};

exports.monthRange = monthRange;
