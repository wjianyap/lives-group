# Self-checking demand forecaster

Forecasts monthly purchase-order volume for Products A, B, C across five countries. It reads an order table, checks it,
chooses a method per series by back-test, and only trusts a smarter model where it clearly beats today's rolling average.
All data in this prototype is synthetic: the figures show how the pipeline behaves, not real Lives Group demand.

## Run it

```bash
pip install -r requirements-forecast.txt
python src/build_site_data.py                 # server/data/db/purchase_docs.json (read-only) -> server/data/ai-forecast.json
python src/build_site_data.py --csv orders.csv  # or any order file, no database needed
python src/run_forecast.py orders.csv           # same pipeline, prints tables, writes outputs/
python -m pytest tests -q                       # 14 behaviour tests
```
Credentials live only in git-ignored files (`server/config.env`, `.env`). Never commit them.

## The six stages

| Stage | What it does |
|---|---|
| 1 Read | Finds the date / country / product / quantity / record-type columns by name (override with `mapping=`). Keeps confirmed orders only; enquiries, purchase requests and MDM setup requests are classified and excluded. |
| 2 Check | Warns about unreadable rows, missing countries, absent country-product pairs, negative quantities, a possibly partial last month. |
| 3 Profile | Labels each series: steady, trending, seasonal, volatile, low-volume, short. |
| 4 Compete | Rolling-origin back-test of 6- and 12-month averages, same-month-last-year, damped trend (Holt) and Holt-Winters (only with 24+ months of training). |
| 5 Guardrail | The 6-month average (today's practice) is the reference. Another method must beat it by 10% in past tests, otherwise it is kept. Low-volume series never switch. |
| 6 Explain | Forecast, 80% range, method, confidence and a plain-English reason per series. |

Measure: WAPE = total miss / total units (not MAPE, which explodes on tiny months).
Honest evaluation (walk-forward): at each of the last 4 forecast dates, the method is chosen using only data before that date, then scored on the next 3 months. 15 series x 4 dates = 60 tests; ours was no worse than the 6-month average in 56 of them.

## AI commentary

Statistics produce the numbers. Claude explains them. The direction (up / down / flat, +/-3%) is computed in code and
may not be changed; every number in the commentary must appear in the forecast bundle; calendar events are labelled as
context, not findings; supply is expressed as checks, because the data has no stock or lead-time information.
Failures fall back to a template, so the demo never depends on the network.

- `outputs/commentary_pregenerated.json`: commentary written by Claude ahead of time for these exact numbers (no API key needed).
  If the forecast changes, the saved text is detected as stale and ignored.
- With `ANTHROPIC_API_KEY` in `.env`, `src/autoforecast/narrative.py` calls Claude live (untested against the live API so far).

## Results on the demo database (24 months, 15 series)

| Group | 6-month average (today) | This forecaster |
|---|---|---|
| All series | 12.4% | 11.8% |
| Product A | 12.8% | 12.6% |
| Product B | 12.1% | 11.2% |
| Product C (tiny volumes) | 35.8% | 35.8% |

No series is worse than today's method (15 of 15). The gain is modest and comes mostly from trending series (Vietnam A and B,
Thailand B). The 80% ranges contained the real result 74% of the time (target 80%).

## Limits

- Synthetic data: this is evidence the pipeline works, not a real accuracy claim.
- 4-10 past tests per series is a thin basis for choosing a method; the guardrail exists for that reason.
- Needs monthly history; with under about 15 months a series is marked unverified and uses the plain average.
- No supply forecast: the data has no inventory, lead-time or supplier information.
