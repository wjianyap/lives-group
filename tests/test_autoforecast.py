"""Behaviour tests: the same unchanged code must adapt to very different data shapes."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from autoforecast import build_panel, load_orders, run  # noqa: E402


def one_series(values, start="2022-01"):
    idx = pd.period_range(start, periods=len(values), freq="M")
    return {("Singapore", "A"): pd.Series(np.asarray(values, float), index=idx)}


def pick(result):
    return result.summary.iloc[0]


def rng():
    return np.random.default_rng(7)


def test_flat_noise_keeps_the_baseline():
    y = 200 + rng().normal(0, 12, 36)
    s = pick(run(one_series(y)))
    assert "average" in s["method"], "no pattern to learn, so the guardrail should keep the average"


def test_strong_trend_is_picked_up_and_beats_the_average():
    y = 100 * 1.03 ** np.arange(30) + rng().normal(0, 3, 30)
    r = run(one_series(y))
    assert pick(r)["method"] == "Damped trend (Holt)"
    sc = r.scorecard.iloc[0]
    assert sc["Self-checking forecaster"] < sc["6-month average (current practice)"]


def test_strong_seasonality_is_picked_up_with_enough_history():
    t = np.arange(48)
    y = 300 + 120 * np.sin(2 * np.pi * t / 12) + rng().normal(0, 8, 48)
    r = run(one_series(y))
    assert pick(r)["method"] in ("Trend + seasonality (Holt-Winters)", "Same month last year")
    sc = r.scorecard.iloc[0]
    assert sc["Self-checking forecaster"] < 0.5 * sc["6-month average (current practice)"]


def test_short_history_is_flagged_unverified_not_guessed():
    s = pick(run(one_series([50, 60, 55, 58, 62, 57, 61, 59])))
    assert s["confidence"] == "low" and s["backtest_wape"] is None
    assert "unverified" in s["reason"]


def test_low_volume_series_never_switches_away_from_the_average():
    y = rng().poisson(4, 30)
    s = pick(run(one_series(y)))
    assert "6-month average" in s["method"] and s["confidence"] == "low"
    assert "low_volume" in s["profile"]


def test_forecast_is_never_negative_and_range_contains_forecast():
    y = np.maximum(0, 100 - 6 * np.arange(30) + rng().normal(0, 3, 30))
    f = run(one_series(y)).forecast
    assert (f["forecast"] >= 0).all() and (f["low_80"] >= 0).all()
    assert ((f["low_80"] <= f["forecast"]) & (f["forecast"] <= f["high_80"])).all()


def test_ingest_understands_other_column_names_and_filters_non_orders():
    rows = []
    for m in pd.period_range("2024-01", periods=14, freq="M"):
        rows += [{"Posting Date": f"{m}-10", "Market": "SG", "Item": "a", "Units": 100, "Doc Type": "Sales Order"},
                 {"Posting Date": f"{m}-11", "Market": "SG", "Item": "a", "Units": 999, "Doc Type": "RFQ"},
                 {"Posting Date": f"{m}-12", "Market": "Viet Nam", "Item": "B", "Units": 50, "Doc Type": "General enquiry"},
                 {"Posting Date": f"{m}-13", "Market": "", "Item": "A", "Units": 7, "Doc Type": "Sales Order"}]
    orders, q = load_orders(pd.DataFrame(rows))
    assert set(orders["country"]) == {"Singapore"} and set(orders["product"]) == {"A"}
    assert orders["qty"].sum() == 1400, "RFQs and enquiries must not count as demand"
    assert any("no country" in w for w in q.warnings)
    panel = build_panel(orders)
    assert list(panel) == [("Singapore", "A")]


def test_ingest_fails_loudly_when_columns_cannot_be_found():
    with pytest.raises(ValueError, match="Could not find columns"):
        load_orders(pd.DataFrame({"foo": [1], "bar": [2]}))


def test_a_product_launched_late_has_no_fake_leading_zeros():
    rows = [{"date": f"{m}-05", "country": "Thailand", "product": "A", "quantity": 10, "record_type": "order"}
            for m in pd.period_range("2024-01", periods=12, freq="M")]
    rows += [{"date": f"{m}-05", "country": "Thailand", "product": "B", "quantity": 10, "record_type": "order"}
             for m in pd.period_range("2024-09", periods=4, freq="M")]
    panel = build_panel(load_orders(pd.DataFrame(rows))[0])
    assert len(panel[("Thailand", "B")]) == 4 and panel[("Thailand", "B")].iloc[0] > 0


# ---------- AI commentary guardrails (no network needed) ----------
def _result_and_facts():
    from autoforecast.narrative import build_facts
    idx = pd.period_range("2024-11", periods=24, freq="M")
    panel = {("Vietnam", "A"): pd.Series(100 * 1.03 ** np.arange(24) + rng().normal(0, 3, 24), index=idx),
             ("Singapore", "B"): pd.Series(200 + rng().normal(0, 5, 24), index=idx)}
    r = run(panel)
    return r, build_facts(r)


def test_offline_template_passes_its_own_checks():
    from autoforecast.narrative import check, template_commentary
    _, facts = _result_and_facts()
    assert check(template_commentary(facts), facts) == []


def test_guardrail_rejects_a_flipped_direction():
    from autoforecast.narrative import check, template_commentary
    _, facts = _result_and_facts()
    c = template_commentary(facts)
    c["outlook"][0]["direction"] = "down" if c["outlook"][0]["direction"] != "down" else "up"
    assert any("direction" in p for p in check(c, facts))


def test_guardrail_rejects_an_invented_number():
    from autoforecast.narrative import check, template_commentary
    _, facts = _result_and_facts()
    c = template_commentary(facts)
    c["headline"] = "Demand will grow by 47318 units next year."
    assert any("not found" in p for p in check(c, facts))


def test_without_api_key_generate_falls_back_to_template(monkeypatch):
    from autoforecast.narrative import generate
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r, _ = _result_and_facts()
    assert generate(r)["source"] == "template"


def test_stale_pregenerated_commentary_is_rejected(tmp_path, monkeypatch):
    from autoforecast.narrative import facts_hash, generate, template_commentary
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r, facts = _result_and_facts()
    f = tmp_path / "c.json"
    f.write_text(json.dumps({"facts_hash": facts_hash(facts), "commentary": template_commentary(facts)}))
    assert generate(r, pregenerated=str(f))["source"] == "ai-pregenerated"
    f.write_text(json.dumps({"facts_hash": "0000", "commentary": template_commentary(facts)}))
    out = generate(r, pregenerated=str(f))
    assert out["source"] == "template" and "stale" in out["note"]
