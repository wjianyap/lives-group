"""Stage 4: fair tests. A method is tried on many past 'forecast dates' (rolling origins): train on everything
before the date, forecast the next `h` months, compare with what really happened."""
from __future__ import annotations

import numpy as np


def rolling(y, fn, h: int, origins) -> tuple[np.ndarray, np.ndarray]:
    """Return (actual, predicted), each shaped (folds, h). A failed fit gives NaN, so the method is simply not chosen."""
    A, P = [], []
    for t in origins:
        a = y[t:t + h]
        if len(a) < h:
            continue
        try:
            p = fn(y[:t], h)
        except Exception:
            p = np.full(h, np.nan)
        A.append(a)
        P.append(p)
    return np.array(A, dtype=float).reshape(-1, h), np.array(P, dtype=float).reshape(-1, h)


def wape(A: np.ndarray, P: np.ndarray) -> float:
    """Total miss as a share of total units. Unlike MAPE it does not blow up when a month is tiny or zero."""
    total = A.sum()
    return float(np.abs(A - P).sum() / total) if total > 0 and A.size else float("nan")


def interval_offsets(residuals: np.ndarray, h: int, eval_h: int, fallback_sd: float, level: float = 0.8):
    """80% range around a forecast, from the method's own past errors. Pooled errors sit at an average step of
    (eval_h+1)/2 months ahead, so the range widens with sqrt(step) for longer horizons (an approximation)."""
    r = residuals[np.isfinite(residuals)]
    if len(r) >= 30:
        lo, hi = np.quantile(r, [(1 - level) / 2, 1 - (1 - level) / 2])
    else:  # too few past errors for quantiles: use the typical error size (RMSE) with a normal range
        sd = float(np.sqrt(np.mean(r ** 2))) if len(r) >= 3 else fallback_sd
        lo, hi = -1.28 * sd, 1.28 * sd
    steps = np.arange(1, h + 1)
    scale = np.sqrt(steps / ((eval_h + 1) / 2))
    return min(lo, 0.0) * scale, max(hi, 0.0) * scale
