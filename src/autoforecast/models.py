"""Candidate forecasting methods. Each takes (history, horizon) -> array of `horizon` values >= 0."""
from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Callable

import numpy as np
from statsmodels.tsa.holtwinters import ExponentialSmoothing


def _clip(x) -> np.ndarray:
    return np.clip(np.asarray(x, dtype=float), 0, None)


def moving_average(window: int) -> Callable:
    def fn(y, h):
        return _clip(np.full(h, np.mean(y[-window:])))
    return fn


def seasonal_naive(y, h, period: int = 12):
    last = np.asarray(y[-period:], dtype=float)
    return _clip([last[i % period] for i in range(h)])


def _ets(y, h, seasonal: bool):
    kw = dict(trend="add", damped_trend=True)
    if seasonal:
        kw.update(seasonal="add", seasonal_periods=12, initialization_method="heuristic")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = ExponentialSmoothing(np.asarray(y, dtype=float), **kw).fit()
        return _clip(fit.forecast(h))


@dataclass(frozen=True)
class Method:
    name: str
    label: str
    fn: Callable
    min_history: int
    kind: str  # "baseline" = what Lives Group does today; "challenger" = needs to earn its place
    needs_volume: bool = False  # True = too noisy to try on low-volume series


METHODS = [
    Method("ma6", "6-month average (current practice)", moving_average(6), 6, "baseline"),
    Method("ma12", "12-month average (current practice)", moving_average(12), 12, "baseline"),
    Method("seasonal_naive", "Same month last year", seasonal_naive, 12, "challenger", True),
    Method("holt_damped", "Damped trend (Holt)", lambda y, h: _ets(y, h, False), 12, "challenger", True),
    Method("holt_winters", "Trend + seasonality (Holt-Winters)", lambda y, h: _ets(y, h, True), 24, "challenger", True),
]
BY_NAME = {m.name: m for m in METHODS}
