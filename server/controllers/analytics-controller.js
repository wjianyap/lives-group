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
    const f = fc.series.find((s) => s.country === t.country && s.product === t.product);
    const gap = f.nextHalfUnits - f.baselineForecast.reduce((a, b) => a + b, 0);
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
    recs.push({
      kind: "cross-sell",
      title: `Cross-sell ${productName(p)} to existing accounts (≈${usd(v)} a year, conservative)`,
      detail: "Peers in the same segment who buy the same products already buy it. Give the list to regional sales as a quarterly campaign.",
    });
  }
  if (fc.summary.baselineMape && fc.summary.modelMape) {
    recs.push({
      kind: "forecast",
      title: `Replace the 6-month average with the seasonal model (error ${fc.summary.baselineMape}% → ${fc.summary.modelMape}%)`,
      detail: "The model refreshes from SAP B1 order history every month with no spreadsheet work; planners review exceptions only.",
    });
  }
  recs.push({
    kind: "data",
    title: `Keep the customer master clean (${ins.totals.mergedDuplicates} duplicates merged so far)`,
    detail: "Duplicate customers split one account's orders across codes, hiding both growth and drop-off. Run the MDM duplicate scan monthly.",
  });
  res.json(recs);
};
