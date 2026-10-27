"""Run the self-checking forecaster on any order file.
Usage (from repo root): python src/run_forecast.py <orders.csv> [--out outputs] [--horizon 6]"""
import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from autoforecast import build_panel, load_orders, run  # noqa: E402
from autoforecast.narrative import generate  # noqa: E402

try:  # optional: load ANTHROPIC_API_KEY from a git-ignored .env
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

ap = argparse.ArgumentParser()
ap.add_argument("orders")
ap.add_argument("--out", default="outputs")
ap.add_argument("--horizon", type=int, default=6)
ap.add_argument("--commentary", default=None, help="pre-generated AI commentary JSON (used when no API key is set)")
ap.add_argument("--no-ai", action="store_true", help="skip the AI commentary (template only)")
args = ap.parse_args()

orders, quality = load_orders(args.orders)
result = run(build_panel(orders), horizon=args.horizon, quality=quality)
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
result.forecast.to_csv(out / "forecast.csv", index=False)
result.summary.to_csv(out / "series_summary.csv", index=False)
result.scorecard.to_csv(out / "scorecard.csv", index=False)
(out / "data_quality.txt").write_text(quality.to_text() + "\n")
insights = generate(result, args.horizon, use_ai=not args.no_ai, pregenerated=args.commentary)
import json
(out / "insights.json").write_text(json.dumps(insights, indent=1))

pd.set_option("display.width", 220)
pd.set_option("display.max_colwidth", 100)
print(quality.to_text(), "\n")
print("Back-test on the last 6 months (error = total miss / total units, lower is better; method chosen WITHOUT seeing them):")
print(result.scorecard.round(3).to_string(index=False), "\n")
print(result.summary[["country", "product", "method", "confidence", "reason"]].to_string(index=False))
print(f"\nAI commentary source: {insights['source']} - {insights['note']}")
print(f"Wrote {out}/forecast.csv, series_summary.csv, scorecard.csv, data_quality.txt, insights.json")
