"""Stage 7: the AI agent. The statistics decide the NUMBERS; the AI model explains them, adds calendar context and drafts actions.
Guardrails: (1) the model only sees a facts bundle, (2) every direction (up/down/flat) is computed in code and the model may not
change it, (3) every number in the model's text must trace back to the bundle, (4) any failure falls back to a plain template,
so the demo never depends on the network."""
from __future__ import annotations

import json
import os
import re

import pandas as pd

MODEL = "claude-opus-5-5"
FLAT_BAND = 3.0  # +/- % change in next-6-month units vs last 6 months that we call "flat"

# General calendar knowledge, NOT derived from the data. Shown to the model as context only and labelled as such.
CALENDAR_CONTEXT = {
    "Singapore": "Chinese New Year 6 Feb 2027 (short working weeks around it); public-sector year-end is 31 Mar.",
    "Malaysia": "Chinese New Year 6 Feb 2027; Ramadan about 8 Feb - 9 Mar 2027, Hari Raya Aidilfitri about 10 Mar 2027 (slower ordering, then restocking).",
    "Indonesia": "Ramadan about 8 Feb - 9 Mar 2027, Idul Fitri about 10 Mar 2027 (long mudik holiday, slower ordering and delivery).",
    "Thailand": "Chinese New Year 6 Feb 2027; Songkran 13-15 Apr 2027 (extended shutdown, restock beforehand).",
    "Vietnam": "Tet (Lunar New Year) 6 Feb 2027, often 1-2 weeks of closures (restock before, slow after).",
}

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "outlook", "actions", "supply_notes", "caveats"],
    "properties": {
        "headline": {"type": "string"},
        "outlook": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["country", "product", "direction", "explanation", "calendar_context"],
            "properties": {
                "country": {"type": "string"}, "product": {"type": "string"},
                "direction": {"type": "string", "enum": ["up", "down", "flat"]},
                "explanation": {"type": "string"}, "calendar_context": {"type": "string"}}}},
        "actions": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["action", "rationale"],
            "properties": {"action": {"type": "string"}, "rationale": {"type": "string"}}}},
        "supply_notes": {"type": "array", "items": {"type": "string"}},
        "caveats": {"type": "array", "items": {"type": "string"}},
    },
}

SYSTEM = f"""You are the commentary layer of a demand-forecasting tool for Lives Group, a Southeast Asian distributor of
diagnostics reagents (Product A), lab consumables (Product B) and medical equipment (Product C).

You receive a JSON facts bundle produced by a statistical forecaster. Your job is to explain it to a commercial manager.

Hard rules:
1. Use ONLY numbers that appear in the bundle. Never compute new figures, never invent any. Quote them as given.
2. Each series has a `direction` already decided in code. Return it unchanged; explain it, never contradict it.
3. `calendar_context` per country is general calendar knowledge, not a finding from the data. If you mention it, say it is
   context ("may explain", "worth checking"), never present it as something the data proves.
4. The data has no inventory, lead-time or supplier information, so you cannot forecast supply. `supply_notes` are
   precautions to check, phrased as questions or conditional steps, never as supply numbers.
5. Series with confidence "low" or the flag low_volume must be described as indicative, with no growth claims.
6. The data is synthetic demo data. Say so once in `caveats`.
7. Plain language for a non-technical reader. Headline under 35 words. 5-8 actions at most, most important first, each
   tied to specific countries/products. Output only the JSON object."""


def build_facts(result, horizon: int = 6) -> dict:
    """Everything the model is allowed to see, with the direction decided here in code."""
    s = result.summary.copy()
    fc = result.forecast
    series = []
    for _, r in s.iterrows():
        f = fc[(fc.country == r.country) & (fc["product"] == r["product"])]
        change = None if r.last_units <= 0 else round(100 * (r.next_units - r.last_units) / r.last_units, 1)
        low = r.confidence == "low" or "low_volume" in r.profile
        direction = "flat" if change is None or abs(change) < FLAT_BAND else ("up" if change > 0 else "down")
        series.append({
            "country": r.country, "product": r["product"], "direction": direction,
            "units_last_6_months": int(r.last_units), "units_forecast_next_6_months": int(r.next_units),
            "units_current_practice_forecast": int(r.current_practice_units), "change_pct": change,
            "months_forecast": f["month"].tolist(), "monthly_forecast": [round(v) for v in f["forecast"]],
            "range_80_total_low": int(f["low_80"].sum()), "range_80_total_high": int(f["high_80"].sum()),
            "method_used": r.method, "confidence": r.confidence, "profile": r.profile,
            "backtest_error_pct": None if pd.isna(r.backtest_wape) else round(100 * r.backtest_wape),
            "indicative_only": bool(low),
        })
    tot_last = int(s.last_units.sum())
    tot_next = int(s.next_units.sum())
    sc = result.scorecard
    return {
        "forecast_horizon_months": horizon,
        "region_units_last_6_months": tot_last, "region_units_forecast_next_6_months": tot_next,
        "region_change_pct": round(100 * (tot_next - tot_last) / tot_last, 1) if tot_last else None,
        "backtest_scorecard_all_series": None if sc.empty else {
            "current_practice_error_pct": round(100 * float(sc.iloc[0]["6-month average (current practice)"]), 1),
            "our_error_pct": round(100 * float(sc.iloc[0]["Self-checking forecaster"]), 1)},
        "series": series,
        "calendar_context_general_knowledge_not_from_data": {c: CALENDAR_CONTEXT.get(c, "") for c in sorted(s.country.unique())},
    }


# ---------- guardrail: every number the model writes must come from the bundle ----------
def _numbers(text: str) -> list[float]:
    return [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\.?\d*", text) if x.strip(".,")]


def allowed_numbers(facts: dict) -> set[float]:
    return set(_numbers(json.dumps(facts))) | {80.0}


def unsupported_numbers(commentary: dict, facts: dict) -> list[float]:
    allowed = allowed_numbers(facts)
    texts = [commentary.get("headline", "")]
    texts += [o["explanation"] + " " + o["calendar_context"] for o in commentary.get("outlook", [])]
    texts += [a["action"] + " " + a["rationale"] for a in commentary.get("actions", [])]
    texts += commentary.get("supply_notes", []) + commentary.get("caveats", [])
    bad = []
    for n in _numbers(" ".join(texts)):
        # small counts (e.g. "3 countries", "6-month"), years and days/months in dates are harmless
        if n <= 31 or 2024 <= n <= 2030 or any(abs(n - a) <= max(0.51, 0.005 * abs(a)) for a in allowed):
            continue
        bad.append(n)
    return bad


def check(commentary: dict, facts: dict) -> list[str]:
    problems = []
    truth = {(s["country"], s["product"]): s["direction"] for s in facts["series"]}
    seen = set()
    for o in commentary.get("outlook", []):
        key = (o["country"], o["product"])
        seen.add(key)
        if truth.get(key) != o["direction"]:
            problems.append(f"direction for {key} changed from {truth.get(key)} to {o['direction']}")
    if seen != set(truth):
        problems.append("outlook does not cover exactly the forecast series")
    bad = unsupported_numbers(commentary, facts)
    if bad:
        problems.append(f"numbers not found in the facts bundle: {bad}")
    return problems


# ---------- offline template: same shape, no AI, always works ----------
def template_commentary(facts: dict) -> dict:
    ups = [s for s in facts["series"] if s["direction"] == "up" and not s["indicative_only"]]
    downs = [s for s in facts["series"] if s["direction"] == "down" and not s["indicative_only"]]
    outlook = []
    for s in facts["series"]:
        if s["indicative_only"]:
            exp = f"Low-volume or low-confidence series ({s['units_last_6_months']} units in the last 6 months). Indicative only: do not act on growth percentages."
        else:
            exp = (f"Forecast {s['units_forecast_next_6_months']} units over the next 6 months vs {s['units_last_6_months']} in the last 6 "
                   f"({s['change_pct']:+}%). Method: {s['method_used']}, confidence {s['confidence']}.")
        outlook.append({"country": s["country"], "product": s["product"], "direction": s["direction"],
                        "explanation": exp, "calendar_context": ""})
    actions = [{"action": f"Review stock cover and reorder timing for {s['country']} Product {s['product']}",
                "rationale": f"Forecast is up {s['change_pct']}% on the last 6 months."} for s in ups[:4]]
    actions += [{"action": f"Check {s['country']} Product {s['product']} for account issues or competitor switching",
                 "rationale": f"Forecast is down {abs(s['change_pct'])}% on the last 6 months."} for s in downs[:3]]
    return {
        "headline": f"Region demand is forecast at {facts['region_units_forecast_next_6_months']} units over the next 6 months vs {facts['region_units_last_6_months']} in the last 6 ({facts['region_change_pct']:+}%).",
        "outlook": outlook, "actions": actions or [{"action": "No series shows a clear change; keep current planning.", "rationale": "All forecasts are within the flat band or low-confidence."}],
        "supply_notes": ["The data has no inventory or supplier information. Where demand is rising, confirm stock cover and supplier lead times before committing."],
        "caveats": ["Synthetic demo data: figures show how the pipeline behaves, not real Lives Group demand.", "Offline template used: no AI commentary generated."],
    }


def _call_ai(facts: dict, feedback: str = "") -> dict:
    import anthropic  # imported here so the rest of the package works without the SDK or a key

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment / .env, never from code
    user = "Facts bundle:\n" + json.dumps(facts, indent=1)
    if feedback:
        user += f"\n\nYour previous answer was rejected: {feedback}\nFix it and answer again."
    resp = client.messages.create(
        model=MODEL, max_tokens=16000, system=SYSTEM,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": user}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("model refused")
    return json.loads(next(b.text for b in resp.content if b.type == "text"))


def facts_hash(facts: dict) -> str:
    import hashlib
    return hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest()[:16]


def _load_pregenerated(path, facts: dict):
    """Commentary written ahead of time by AI (no API key needed). Used only if it was written for exactly
    these numbers and still passes the same checks as a live answer."""
    if not path or not os.path.exists(path):
        return None, "no pre-generated commentary file"
    saved = json.load(open(path))
    if saved.get("facts_hash") != facts_hash(facts):
        return None, "pre-generated commentary is stale (the forecast changed since it was written)"
    problems = check(saved["commentary"], facts)
    if problems:
        return None, f"pre-generated commentary failed checks: {problems}"
    return saved, ""


def generate(result, horizon: int = 6, use_ai: bool = True, pregenerated: str | None = None) -> dict:
    """Return {'source': 'ai'|'ai-pregenerated'|'template', 'commentary': {...}, 'facts': {...}, 'note': str}."""
    facts = build_facts(result, horizon)
    why_not = ""
    if use_ai and not os.environ.get("ANTHROPIC_API_KEY"):
        saved, why_not = _load_pregenerated(pregenerated, facts)
        if saved:
            return {"source": "ai-pregenerated", "model": saved.get("model", "AI"), "generated_on": saved.get("generated_on"),
                    "commentary": saved["commentary"], "facts": facts,
                    "note": "Written by AI ahead of time for these exact numbers; checked: directions and numbers match the forecast."}
    if use_ai and os.environ.get("ANTHROPIC_API_KEY"):
        feedback = ""
        for attempt in range(2):
            try:
                c = _call_ai(facts, feedback)
            except Exception as e:  # network, auth, refusal, bad JSON: fall back rather than break the demo
                return {"source": "template", "commentary": template_commentary(facts), "facts": facts,
                        "note": f"AI call failed ({type(e).__name__}); template used."}
            problems = check(c, facts)
            if not problems:
                return {"source": "ai", "model": MODEL, "commentary": c, "facts": facts, "note": "Checked: directions and numbers match the forecast."}
            feedback = "; ".join(problems)
        return {"source": "template", "commentary": template_commentary(facts), "facts": facts,
                "note": f"AI output failed validation twice ({feedback}); template used."}
    return {"source": "template", "commentary": template_commentary(facts), "facts": facts,
            "note": (f"No ANTHROPIC_API_KEY set and {why_not}; offline template used." if use_ai else "AI disabled; template used.")}
