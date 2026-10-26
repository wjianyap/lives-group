"""Orders (MongoDB, read-only) -> self-checking forecaster -> AI commentary -> server/data/ai-forecast.json,
the file the website's Regional view reads.

Usage (from repo root):
    python src/build_site_data.py                      # reads MongoDB using DB=... from server/config.env
    python src/build_site_data.py --csv orders.csv     # or any order file, no database needed
"""
import argparse
import datetime
import json
import os
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
from autoforecast import build_panel, load_orders, run  # noqa: E402
from autoforecast.narrative import generate  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--csv", help="read this file instead of MongoDB")
ap.add_argument("--out", default=str(ROOT / "server" / "data" / "ai-forecast.json"))
ap.add_argument("--commentary", default=str(ROOT / "outputs" / "commentary_pregenerated.json"))
ap.add_argument("--horizon", type=int, default=6)
args = ap.parse_args()

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")                    # ANTHROPIC_API_KEY (optional), git-ignored
    load_dotenv(ROOT / "server" / "config.env")   # DB connection string used by the website's server
except ImportError:
    pass


def read_mongo() -> pd.DataFrame:
    import certifi  # macOS Python often lacks trusted CA certificates; certifi supplies them (verification stays ON)
    from pymongo import MongoClient
    client = MongoClient(os.environ["DB"], serverSelectionTimeoutMS=10000, tlsCAFile=certifi.where())
    col = client[os.environ.get("DB_NAME", "lives_mdm")]["purchase_docs"]
    rows = list(col.find({}, {"_id": 0, "docType": 1, "country": 1, "product": 1, "month": 1, "qty": 1}))
    return pd.DataFrame(rows).rename(columns={"docType": "record_type"})


raw = pd.read_csv(args.csv, keep_default_na=False, na_values=[""]) if args.csv else read_mongo()
source = f"file: {Path(args.csv).name}" if args.csv else "MongoDB (purchase_docs)"
orders, quality = load_orders(raw)
panel = build_panel(orders)
result = run(panel, horizon=args.horizon, quality=quality)
insights = generate(result, args.horizon, pregenerated=args.commentary)

code = {"Singapore": "SG", "Malaysia": "MY", "Indonesia": "ID", "Thailand": "TH", "Vietnam": "VN"}
fc = result.forecast
series = []
for _, r in result.summary.iterrows():
    s = panel[(r.country, r["product"])]
    f = fc[(fc.country == r.country) & (fc["product"] == r["product"])]
    series.append({
        "country": code.get(r.country, r.country), "countryName": r.country, "product": r["product"],
        "historyMonths": [str(m) for m in s.index], "history": [float(v) for v in s.to_numpy()],
        "forecastMonths": f["month"].tolist(), "forecast": f["forecast"].tolist(),
        "baseline": [round(float(s.tail(6).mean()), 1)] * len(f),  # today's method: the 6-month average, held flat
        "low80": f["low_80"].tolist(), "high80": f["high_80"].tolist(),
        "method": r.method, "confidence": r.confidence, "profile": r.profile, "reason": r.reason,
        "backtestErrorPct": None if pd.isna(r.backtest_wape) else round(100 * float(r.backtest_wape), 1),
        "unitsLast6": int(r.last_units), "unitsNext6": int(r.next_units), "unitsCurrentPractice": int(r.current_practice_units),
        "changePct": None if r.last_units <= 0 else round(100 * (r.next_units - r.last_units) / r.last_units, 1),
        "indicativeOnly": bool(r.confidence == "low" or "low_volume" in r.profile),
    })

sc = result.scorecard
scorecard = [] if sc.empty else [{
    "group": r["group"], "series": int(r["series"]),
    "currentPracticePct": round(100 * float(r["6-month average (current practice)"]), 1),
    "avg12Pct": round(100 * float(r["12-month average (current practice)"]), 1),
    "oursPct": round(100 * float(r["Self-checking forecaster"]), 1),
    "noWorse": r["series where ours is no worse than 6-month avg"],
    "rangeCoveragePct": None if pd.isna(r["80% range covered the actuals"]) else round(100 * float(r["80% range covered the actuals"])),
} for _, r in sc.iterrows()]

bundle = {
    "meta": {"generatedAt": datetime.datetime.now().isoformat(timespec="seconds"), "source": source, "horizonMonths": args.horizon,
             "historyThrough": str(max(s.index[-1] for s in panel.values())), "monthsOfHistory": max(len(s) for s in panel.values()),
             "backtestMonths": 6},
    "quality": {"columns": quality.columns, "rowsRead": quality.rows_in, "ordersUsed": quality.rows_used,
                "byRecordType": quality.by_record_type, "warnings": quality.warnings},
    "scorecard": scorecard,
    "series": series,
    "commentary": {k: insights.get(k) for k in ("source", "model", "generated_on", "note")} | {"content": insights["commentary"]},
}
out = Path(args.out)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(bundle, indent=1))
print(f"Source: {source}\nOrders used: {quality.rows_used} of {quality.rows_in} rows  {quality.by_record_type}")
print(f"Commentary: {insights['source']}  |  series: {len(series)}  |  wrote {out} ({out.stat().st_size // 1024} KB)")
