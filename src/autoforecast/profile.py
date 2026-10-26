"""Stage 3: describe each series so the choice of method (and the explanation) follows the data."""
from __future__ import annotations

import numpy as np


def profile(y: np.ndarray, low_volume_mean: float = 15.0) -> dict:
    y = np.asarray(y, dtype=float)
    n = len(y)
    mean = float(y.mean()) if n else 0.0
    window = y[-12:]
    x = np.arange(len(window))
    slope, intercept = np.polyfit(x, window, 1) if len(window) >= 4 else (0.0, window.mean() if len(window) else 0.0)
    resid = window - (slope * x + intercept)
    ss_tot = float(((window - window.mean()) ** 2).sum())
    r2 = 1 - float((resid ** 2).sum()) / ss_tot if ss_tot > 0 else 0.0
    wmean = float(window.mean()) if len(window) else 0.0
    trend_pct = 100 * slope / wmean if wmean > 0 else 0.0
    cv = float(resid.std() / wmean) if wmean > 0 else 0.0

    seasonal_acf = None  # needs two full years to see a repeating yearly pattern
    if n >= 24:
        t = np.arange(n)
        r = y - np.polyval(np.polyfit(t, y, 1), t)
        a, b = r[12:], r[:-12]
        seasonal_acf = float(np.corrcoef(a, b)[0, 1]) if a.std() > 0 and b.std() > 0 else 0.0

    zero_share = float((y == 0).mean()) if n else 1.0
    flags = []
    if n < 15:
        flags.append("short_history")
    if mean < low_volume_mean or zero_share > 0.25:
        flags.append("low_volume")
    if seasonal_acf is not None and seasonal_acf > 0.5:
        flags.append("seasonal")
    if abs(trend_pct) >= 0.7 and r2 >= 0.3:
        flags.append("trending")
    if cv > 0.25:
        flags.append("volatile")
    return {"n_months": n, "mean_monthly": round(mean, 1), "trend_pct_per_month": round(trend_pct, 2),
            "trend_r2": round(r2, 2), "volatility_cv": round(cv, 2), "seasonal_acf": None if seasonal_acf is None else round(seasonal_acf, 2),
            "zero_share": round(zero_share, 2), "flags": flags}
