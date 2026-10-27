const analytics = require("../services/analytics");
const { COUNTRIES, PRODUCTS } = require("../config/constants");

const countryName = (c) => COUNTRIES.find((x) => x.code === c)?.name || c;
const productName = (p) => PRODUCTS.find((x) => x.code === p)?.name || p;
const usd = (v) => `US$${Math.round(v / 1000).toLocaleString("en-US")}k`;

exports.regional = async (req, res) => res.json(await analytics.regional({ months: req.query.months }));
exports.forecasts = async (req, res) => res.json(await analytics.forecasts());
exports.insights = async (req, res) => res.json(await analytics.insights());
exports.pipeline = async (req, res) => res.json(await analytics.pipeline());

// Plain-language actions built from the numbers, for the business view
exports.recommendations = async (req, res) => {
  const [regional, fc, ins] = await Promise.all([analytics.regional({}), analytics.forecasts(), analytics.insights()]);
  const recs = [];
  // equipment (C) volumes are small and lumpy, so growth calls are made on reagents and consumables
  const cells = regional.matrix.filter((r) => r.growthYoY !== null && r.product !== "C");
  const top = [...cells].sort((a, b) => b.growthYoY - a.growthYoY).slice(0, 2);
  const bottom = [...cells].sort((a, b) => a.growthYoY - b.growthYoY).slice(0, 2);

  for (const t of top) {
    // use the same forecast the page shows (Python pipeline); fall back to the older JS forecast only if that file is missing
    const a = readAiForecast()?.series.find((s) => s.country === t.country && s.product === t.product);
    const old = fc.series.find((s) => s.country === t.country && s.product === t.product);
    const f = a ? { nextHalfUnits: a.unitsNext6, baseline: a.unitsCurrentPractice } : { nextHalfUnits: old.nextHalfUnits, baseline: old.baselineForecast.reduce((x, y) => x + y, 0) };
    const gap = f.nextHalfUnits - f.baseline;
    recs.push({
      kind: "grow",
      title: `Back the growth in ${countryName(t.country)} – ${productName(t.product)} (+${t.growthYoY}% year-on-year)`,
      detail:
        `Forecast for the next 6 months is ${f.nextHalfUnits.toLocaleString()} units. Secure supplier allocation and stock now` +
        (gap > 0 ? `; planning on the 6-month average alone would under-order by ${gap.toLocaleString()} units.` : "."),
    });
  }
  for (const b of bottom.filter((x) => x.growthYoY < 0)) {
    recs.push({
      kind: "fix",
      title: `Investigate the decline in ${countryName(b.country)} – ${productName(b.product)} (${b.growthYoY}% year-on-year)`,
      detail: "Check the at-risk customer list below for this market, and whether competitor pricing or stock-outs explain it before cutting forecasts.",
    });
  }
  if (ins.churn.length) {
    recs.push({
      kind: "retain",
      title: `Call the ${Math.min(5, ins.churn.length)} customers most at risk (${usd(ins.churn.slice(0, 5).reduce((s, c) => s + c.annualValueAtRisk, 0))} annual value)`,
      detail: `Led by ${ins.churn[0].name} (${countryName(ins.churn[0].country)}), whose orders dropped ${ins.churn[0].dropPct}%.`,
    });
  }
  if (ins.crossSell.length) {
    const byProduct = {};
    for (const c of ins.crossSell) byProduct[c.suggest] = (byProduct[c.suggest] || 0) + c.estAnnualValue;
    const [p, v] = Object.entries(byProduct).sort((a, b) => b[1] - a[1])[0];
    const total = Object.values(byProduct).reduce((a, b) => a + b, 0);
    recs.push({
      kind: "cross-sell",
      title: `Cross-sell ${productName(p)} to existing accounts (≈${usd(v)} a year of the ${usd(total)} total across products, conservative)`,
      detail: "Peers in the same segment who buy the same products already buy it. Give the list to regional sales as a quarterly campaign.",
    });
  }
  const ai = readAiForecast();
  const all = ai?.scorecard?.find((r) => r.group === "All series");
  if (all) {
    recs.push({
      kind: "forecast",
      title: `Use the self-checking forecast instead of the plain 6-month average (back-test error ${all.currentPracticePct}% → ${all.oursPct}%)`,
      detail:
        "The gain is modest on this synthetic data. The value is the safeguard: a smarter model is only used where it beats the average in past tests, and every series is labelled with its method and confidence.",
    });
  }
  recs.push({
    kind: "data",
    title: `Keep the customer master clean (${ins.totals.mergedDuplicates} duplicates merged so far)`,
    detail: "Duplicate customers split one account's orders across codes, hiding both growth and drop-off. Run the MDM duplicate scan monthly.",
  });
  res.json(recs);
};

// Forecast + AI commentary produced by the Python pipeline (src/build_site_data.py): orders -> back-tested forecast -> checked commentary.
const fs = require("fs");
const path = require("path");
const AI_FILE = path.join(__dirname, "..", "data", "ai-forecast.json");
const readAiForecast = () => {
  try {
    return JSON.parse(fs.readFileSync(AI_FILE, "utf8"));
  } catch {
    return null;
  }
};
exports.aiForecast = async (req, res) => {
  const data = readAiForecast();
  if (!data) return res.status(404).json({ message: "No forecast file yet. Run: python src/build_site_data.py" });
  res.json(data);
};
exports.readAiForecast = readAiForecast;
