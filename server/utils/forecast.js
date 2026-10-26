// Demand forecasting for Products A, B, C per country.
// We compare Lives Group's current practice (rolling 6- and 12-month averages) with Holt-Winters
// exponential smoothing (level + trend + 12-month seasonality) on a hold-out back-test, and pick the better one.

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function movingAverageForecast(series, window, horizon) {
  const avg = mean(series.slice(-window));
  return new Array(horizon).fill(avg);
}

// Additive Holt-Winters. Needs at least one full season plus a few points.
function holtWintersFit(series, { alpha, beta, gamma, season = 12 }) {
  const n = series.length;
  // Initial trend from a centred 12-month moving average (so the seasonal swing is not mistaken for trend),
  // initial seasonal indices from the detrended data
  const half = season / 2;
  const cma = [];
  for (let t = half; t + half < n; t++) {
    let acc = (series[t - half] + series[t + half]) / 2;
    for (let k = t - half + 1; k < t + half; k++) acc += series[k];
    cma.push([t, acc / season]);
  }
  let slope = 0;
  let intercept = mean(series.slice(0, season));
  if (cma.length >= 2) {
    const xm = mean(cma.map((c) => c[0]));
    const ym = mean(cma.map((c) => c[1]));
    let num = 0;
    let den = 0;
    for (const [x, y] of cma) {
      num += (x - xm) * (y - ym);
      den += (x - xm) ** 2;
    }
    slope = den ? num / den : 0;
    intercept = ym - slope * xm;
  }
  const seasonal = new Array(season).fill(0);
  const counts = new Array(season).fill(0);
  for (let t = 0; t < n; t++) {
    seasonal[t % season] += series[t] - (intercept + slope * t);
    counts[t % season]++;
  }
  for (let i = 0; i < season; i++) seasonal[i] /= counts[i] || 1;
  const sMean = mean(seasonal);
  for (let i = 0; i < season; i++) seasonal[i] -= sMean;
  let trend = slope;
  let level = intercept + slope * (season - 1);

  const fitted = [];
  let sse = 0;
  for (let t = season; t < n; t++) {
    const s = seasonal[t % season];
    const yhat = level + trend + s;
    fitted.push(yhat);
    const err = series[t] - yhat;
    sse += err * err;
    const prevLevel = level;
    level = alpha * (series[t] - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[t % season] = gamma * (series[t] - level) + (1 - gamma) * s;
  }
  const forecast = (h) => {
    const out = [];
    for (let i = 1; i <= h; i++) out.push(level + i * trend + seasonal[(n + i - 1) % season]);
    return out;
  };
  const residualSd = Math.sqrt(sse / Math.max(1, n - season));
  return { forecast, sse, residualSd, fitted };
}

// Grid-search the smoothing parameters on in-sample error
function holtWinters(series, horizon, season = 12) {
  let best = null;
  const grid = [0.1, 0.2, 0.3, 0.5, 0.7];
  for (const alpha of grid)
    for (const beta of [0.01, 0.05, 0.1, 0.2])
      for (const gamma of [0.05, 0.1, 0.3, 0.5]) {
        const fit = holtWintersFit(series, { alpha, beta, gamma, season });
        if (!best || fit.sse < best.fit.sse) best = { fit, params: { alpha, beta, gamma } };
      }
  return {
    forecast: best.fit.forecast(horizon).map((v) => Math.max(0, v)),
    residualSd: best.fit.residualSd,
    params: best.params,
  };
}

// Mean absolute percentage error, ignoring zero months
function mape(actual, predicted) {
  let sum = 0;
  let k = 0;
  actual.forEach((a, i) => {
    if (a > 0) {
      sum += Math.abs(a - predicted[i]) / a;
      k++;
    }
  });
  return k ? (sum / k) * 100 : null;
}

/**
 * Back-tests the methods on the last `holdout` months, then forecasts `horizon` months ahead with the winner.
 * @param {number[]} series monthly order quantities, oldest first (24 months recommended)
 */
function compareAndForecast(series, { holdout = 6, horizon = 6 } = {}) {
  const train = series.slice(0, series.length - holdout);
  const test = series.slice(series.length - holdout);
  const canHw = train.length >= 15;

  const methods = {
    ma6: { label: "6-month moving average (current practice)", backtest: movingAverageForecast(train, 6, holdout) },
    ma12: { label: "12-month average", backtest: movingAverageForecast(train, 12, holdout) },
  };
  if (canHw) methods.hw = { label: "Holt-Winters (trend + seasonality)", backtest: holtWinters(train, holdout).forecast };
  for (const m of Object.values(methods)) m.mape = mape(test, m.backtest);

  const ranked = Object.entries(methods)
    .filter(([, m]) => m.mape !== null)
    .sort((a, b) => a[1].mape - b[1].mape);
  const bestKey = ranked.length ? ranked[0][0] : "ma6";

  // Final forecast on the full history
  let forecast;
  let sd;
  if (bestKey === "hw") {
    const hw = holtWinters(series, horizon);
    forecast = hw.forecast;
    sd = hw.residualSd;
  } else {
    const w = bestKey === "ma6" ? 6 : 12;
    forecast = movingAverageForecast(series, w, horizon);
    const recent = series.slice(-w);
    const avg = mean(recent);
    sd = Math.sqrt(mean(recent.map((v) => (v - avg) ** 2)));
  }
  const baseline = movingAverageForecast(series, 6, horizon);
  const band = forecast.map((v, i) => {
    const w = 1.28 * sd * Math.sqrt(i + 1); // ~80% interval
    return [Math.max(0, v - w), v + w];
  });

  const round = (xs) => xs.map((v) => Math.round(v));
  return {
    best: bestKey,
    methods: Object.fromEntries(
      Object.entries(methods).map(([k, m]) => [
        k,
        { label: m.label, mape: m.mape === null ? null : Number(m.mape.toFixed(1)), backtest: round(m.backtest) },
      ]),
    ),
    holdoutActual: test,
    forecast: round(forecast),
    baselineForecast: round(baseline),
    band: band.map(([a, b]) => [Math.round(a), Math.round(b)]),
  };
}

module.exports = { mean, mape, movingAverageForecast, holtWinters, compareAndForecast };
