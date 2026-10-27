"""Stages 4-6: compete, guard, explain."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .backtest import interval_offsets, rolling, wape
from .ingest import Quality
from .models import BY_NAME, METHODS
from .profile import profile

MIN_TRAIN = 12   # shortest history a back-test fold may train on
MIN_FOLDS = 4    # fewer past tests than this and we do not trust a comparison


@dataclass
class Result:
    forecast: pd.DataFrame
    summary: pd.DataFrame
    scorecard: pd.DataFrame
    eval_rows: pd.DataFrame
    quality: Quality | None = None


def _plan(n_avail: int, h: int, eligible: list):
    """Pick which methods can be compared on the SAME past dates. Seasonal Holt-Winters needs 2 years of training."""
    for tier in (eligible, [m for m in eligible if m.name != "holt_winters"]):
        if not tier:
            continue
        start = max(MIN_TRAIN, max(m.min_history for m in tier))
        origins = list(range(start, n_avail - h + 1))
        if len(origins) >= MIN_FOLDS:
            return tier, origins
    return [], []


def _select(y: np.ndarray, h: int, eligible: list, margin: float) -> dict:
    """Choose a method using only `y`. The guardrail: a challenger must beat the best baseline by `margin`."""
    tier, origins = _plan(len(y), h, eligible)
    if not tier:
        return {"chosen": "ma6", "verified": False, "scores": {}, "residuals": np.array([]), "n_folds": 0, "why": "too_short"}
    scores, resid = {}, {}
    for m in tier:
        A, P = rolling(y, m.fn, h, origins)
        scores[m.name] = wape(A, P)
        resid[m.name] = (A - P).ravel()
    # The reference is today's practice (6-month average). Every other method, the 12-month average included,
    # must beat it by `margin`; otherwise we keep it. This stops us chasing noise between near-identical methods.
    ref = "ma6" if np.isfinite(scores.get("ma6", np.nan)) else min((k for k in scores if np.isfinite(scores[k])), key=scores.get, default="ma6")
    others = {k: v for k, v in scores.items() if k != ref and np.isfinite(v)}
    chosen, why = ref, "baseline_best"
    if others:
        best = min(others, key=others.get)
        if not np.isfinite(scores.get(ref, np.nan)) or others[best] < scores[ref] * (1 - margin):
            chosen, why = best, "challenger_won"
        else:
            why = "guardrail"
    return {"chosen": chosen, "verified": True, "scores": scores, "residuals": np.concatenate(list(resid.values())),
            "n_folds": len(origins), "why": why, "best_base": ref}


def _eligible(y: np.ndarray, flags: list, usable_len: int) -> list:
    if "low_volume" in flags:  # too little signal to justify switching away from today's practice
        return [BY_NAME["ma6"]] if usable_len >= BY_NAME["ma6"].min_history else []
    return [m for m in METHODS if usable_len >= m.min_history]


def _confidence(flags, sel) -> str:
    w = sel["scores"].get(sel["chosen"], np.nan)
    if not sel["verified"] or "short_history" in flags or "low_volume" in flags or not np.isfinite(w) or w > 0.30:
        return "low"
    return "high" if w <= 0.12 else "medium"


def _reason(flags, prof, sel) -> str:
    chosen = BY_NAME[sel["chosen"]].label
    if not sel["verified"]:
        return f"Only {prof['n_months']} months of history: too short to test methods, so the plain average is used and the forecast is unverified."
    w = sel["scores"][sel["chosen"]]
    if "low_volume" in flags:
        return f"Low volume (~{prof['mean_monthly']:.0f} units/month): too noisy for a model; {chosen} used. Treat as indicative, growth % is unreliable."
    if sel["why"] == "challenger_won":
        bb = sel["scores"][sel["best_base"]]
        return f"{chosen} cut back-test error from {bb:.0%} to {w:.0%} vs the 6-month average ({sel['n_folds']} past tests), clearing the guardrail."
    if sel["why"] == "guardrail":
        return f"No model beat the average by the required margin over {sel['n_folds']} past tests, so {chosen} was kept ({w:.0%} error)."
    return f"{chosen} was the best of the methods tried ({w:.0%} error over {sel['n_folds']} past tests)."


def run(panel: dict, horizon: int = 6, eval_horizon: int = 3, holdout: int = 6, margin: float = 0.10,
        quality: Quality | None = None) -> Result:
    """panel = {(country, product): monthly pd.Series}. Returns forecasts, a per-series summary, and an honest scorecard.

    Two passes: (1) EVALUATION picks methods using only data before the last `holdout` months, then scores that choice
    on those months. (2) PRODUCTION picks with all data and forecasts `horizon` months ahead."""
    fc_rows, sum_rows, eval_rows = [], [], []
    for (country, product), s in sorted(panel.items()):
        y = s.to_numpy(dtype=float)
        n = len(y)
        prof = profile(y)
        flags = prof["flags"]

        # --- 1. evaluation pass: walk forward. At each past date from n-holdout on, choose a method using only data
        # before that date, forecast, and score against what really happened. Choosing afresh at every date means one
        # lucky or unlucky window cannot decide the result. ---
        n_sel = n - holdout
        origins_r = list(range(n_sel, n - eval_horizon + 1)) if n_sel >= 1 else []
        acc = {"abs_auto": 0.0, "actual": 0.0, "abs_ma6": 0.0, "abs_ma12": 0.0, "hit": 0.0, "cells": 0, "wins": 0, "windows": 0, "verified": False, "picked": []}
        for t in origins_r:
            a = y[t:t + eval_horizon]
            sel_t = _select(y[:t], eval_horizon, _eligible(y, flags, t), margin)
            try:
                p_auto = BY_NAME[sel_t["chosen"]].fn(y[:t], eval_horizon)
                p6, p12 = BY_NAME["ma6"].fn(y[:t], eval_horizon), BY_NAME["ma12"].fn(y[:t], eval_horizon)
            except Exception:
                continue  # history too short to forecast at this date: leave the date out
            lo, hi = interval_offsets(sel_t["residuals"], eval_horizon, eval_horizon, float(np.std(y[:t][-6:])))
            acc["abs_auto"] += np.abs(a - p_auto).sum()
            acc["abs_ma6"] += np.abs(a - p6).sum()
            acc["abs_ma12"] += np.abs(a - p12).sum()
            acc["actual"] += a.sum()
            acc["hit"] += ((a >= p_auto + lo) & (a <= p_auto + hi)).sum()
            acc["cells"] += len(a)
            acc["windows"] += 1
            acc["wins"] += int(np.abs(a - p_auto).sum() <= np.abs(a - p6).sum() * 1.0001)
            acc["verified"] = acc["verified"] or sel_t["verified"]
            acc["picked"].append(sel_t["chosen"])
        if acc["windows"]:  # nothing scored (history too short): leave out of the scorecard
            eval_rows.append({"country": country, "product": product, "verified": acc["verified"],
                              "chosen": max(set(acc["picked"]), key=acc["picked"].count),
                              "abs_ma6": acc["abs_ma6"], "abs_ma12": acc["abs_ma12"], "abs_auto": acc["abs_auto"],
                              "actual": acc["actual"], "covered": acc["hit"] / acc["cells"],
                              "windows": acc["windows"], "wins": acc["wins"]})

        # --- 2. production pass: choose with everything, forecast ahead ---
        sel = _select(y, eval_horizon, _eligible(y, flags, n), margin)
        fc = BY_NAME[sel["chosen"]].fn(y, horizon)
        lo, hi = interval_offsets(sel["residuals"], horizon, eval_horizon, float(np.std(y[-6:])) if n >= 2 else 0.0)
        future = pd.period_range(s.index[-1] + 1, periods=horizon, freq="M")
        for i, m in enumerate(future):
            fc_rows.append({"country": country, "product": product, "month": str(m), "forecast": round(float(fc[i]), 1),
                            "low_80": round(float(max(fc[i] + lo[i], 0)), 1), "high_80": round(float(fc[i] + hi[i]), 1)})
        base6 = BY_NAME["ma6"].fn(y, horizon)
        sum_rows.append({
            "country": country, "product": product, "months_of_history": n, "profile": ", ".join(flags) or "steady",
            "method": BY_NAME[sel["chosen"]].label, "confidence": _confidence(flags, sel),
            "backtest_wape": round(sel["scores"].get(sel["chosen"], np.nan), 3) if sel["verified"] else None,
            "next_units": round(float(fc.sum())), "current_practice_units": round(float(base6.sum())),
            "last_units": round(float(y[-horizon:].sum())), "reason": _reason(flags, prof, sel),
            **{k: prof[k] for k in ("mean_monthly", "trend_pct_per_month", "volatility_cv")},
        })

    ev = pd.DataFrame(eval_rows)
    return Result(pd.DataFrame(fc_rows), pd.DataFrame(sum_rows), _scorecard(ev), ev, quality)


def _scorecard(ev: pd.DataFrame) -> pd.DataFrame:
    """Volume-weighted error on the held-out months, for the current practice vs ours, overall and per product."""
    if ev.empty:
        return pd.DataFrame()
    cols = {"abs_ma6": "6-month average (current practice)", "abs_ma12": "12-month average (current practice)", "abs_auto": "Self-checking forecaster"}
    rows = []
    for label, g in [("All series", ev)] + [(f"Product {p}", ev[ev["product"] == p]) for p in sorted(ev["product"].unique())]:
        r = {"group": label, "series": len(g)}
        for c, name in cols.items():
            both = g.dropna(subset=[c, "actual"])
            r[name] = both[c].sum() / both["actual"].sum() if both["actual"].sum() > 0 else np.nan
        r["series where ours is no worse than 6-month avg"] = f"{int((g['abs_auto'] <= g['abs_ma6'] * 1.0001).sum())}/{len(g)}"
        r["past dates where ours was no worse"] = f"{int(g['wins'].sum())}/{int(g['windows'].sum())}" if "wins" in g else None
        r["80% range covered the actuals"] = g["covered"].mean() if "covered" in g else np.nan
        rows.append(r)
    return pd.DataFrame(rows)
