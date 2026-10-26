"""Stage 1-2: read any order table, work out which column is which, keep only real orders, report data problems."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pandas as pd

# Column-name hints. Matching ignores case, spaces and punctuation. Override with `mapping=` when they fail.
ALIASES = {
    "date": ["date", "orderdate", "docdate", "postingdate", "month", "period", "created", "createdat"],
    "country": ["country", "countrycode", "market", "location", "region"],
    "product": ["product", "productcode", "productline", "item", "itemgroup", "sku"],
    "qty": ["quantity", "qty", "units", "volume", "orderqty"],
    "record_type": ["recordtype", "doctype", "type", "category", "kind"],
}

COUNTRY_NAMES = {
    "sg": "Singapore", "sgp": "Singapore", "singapore": "Singapore",
    "my": "Malaysia", "mys": "Malaysia", "malaysia": "Malaysia",
    "id": "Indonesia", "idn": "Indonesia", "indonesia": "Indonesia",
    "th": "Thailand", "tha": "Thailand", "thailand": "Thailand",
    "vn": "Vietnam", "vnm": "Vietnam", "vietnam": "Vietnam", "viet nam": "Vietnam",
}

UNKNOWN = "(unknown)"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def classify_record_type(value) -> str:
    """Map free-text record types onto: order / purchase_request / enquiry / mdm_setup / unknown."""
    v = str(value).lower()
    if any(k in v for k in ("enquir", "inquir", "follow")):
        return "enquiry"
    if any(k in v for k in ("mdm", "setup", "set-up", "master")):
        return "mdm_setup"
    if any(k in v for k in ("request", "rfq", "quot", "tender")):
        return "purchase_request"
    if "order" in v or _norm(v) in ("po", "so"):
        return "order"
    return "unknown"


def detect_columns(df: pd.DataFrame, mapping: dict | None = None) -> dict:
    """Return {role: column name}. Name hints first; content checks for date and quantity as a fallback."""
    found = dict(mapping or {})
    normed = {c: _norm(c) for c in df.columns}
    for role, names in ALIASES.items():
        if role in found:
            continue
        for alias in names:  # earlier alias = stronger hint
            hit = [c for c, n in normed.items() if n == alias and c not in found.values()]
            if hit:
                found[role] = hit[0]
                break
    if "date" not in found:
        for c in df.columns:
            if c in found.values():
                continue
            parsed = pd.to_datetime(df[c], errors="coerce", format="mixed") if df[c].dtype == object else None
            if parsed is not None and parsed.notna().mean() > 0.9:
                found["date"] = c
                break
    if "qty" not in found:
        nums = [c for c in df.columns if c not in found.values() and pd.api.types.is_numeric_dtype(df[c])]
        if len(nums) == 1:
            found["qty"] = nums[0]
    return found


@dataclass
class Quality:
    columns: dict = field(default_factory=dict)
    rows_in: int = 0
    rows_used: int = 0
    by_record_type: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)

    def to_text(self) -> str:
        lines = [f"Columns understood: {self.columns}", f"Rows read: {self.rows_in}  |  rows used as demand (orders): {self.rows_used}"]
        lines.append(f"Record types found: {self.by_record_type}")
        lines += [f"WARNING: {w}" for w in self.warnings] or ["No data warnings."]
        return "\n".join(lines)


def load_orders(source, mapping: dict | None = None, demand_types=("order",)) -> tuple[pd.DataFrame, Quality]:
    """Read a CSV path or DataFrame -> tidy table (month, country, product, qty) of real orders, plus a Quality report."""
    df = source.copy() if isinstance(source, pd.DataFrame) else pd.read_csv(source, keep_default_na=False, na_values=[""])
    q = Quality(rows_in=len(df))
    cols = detect_columns(df, mapping)
    q.columns = cols
    missing = [r for r in ("date", "country", "product", "qty") if r not in cols]
    if missing:
        raise ValueError(f"Could not find columns for {missing}. Found {cols}. Pass mapping={{'role': 'column name'}}.")

    out = pd.DataFrame({
        "date": pd.to_datetime(df[cols["date"]], errors="coerce", format="mixed"),
        "country": df[cols["country"]],
        "product": df[cols["product"]].astype(str).str.strip().str.upper(),
        "qty": pd.to_numeric(df[cols["qty"]], errors="coerce"),
    })
    if "record_type" in cols:
        out["record_type"] = df[cols["record_type"]].map(classify_record_type)
    else:
        out["record_type"] = "order"
        q.warnings.append("No record-type column: every row treated as a confirmed order. Enquiries / MDM requests cannot be filtered out.")
    q.by_record_type = out["record_type"].value_counts().to_dict()

    unknown_types = int((out["record_type"] == "unknown").sum())
    if unknown_types:
        q.warnings.append(f"{unknown_types} rows have an unrecognised record type and were excluded.")
    out = out[out["record_type"].isin(demand_types)].copy()
    q.rows_used = len(out)

    bad = out["date"].isna() | out["qty"].isna()
    if bad.any():
        q.warnings.append(f"{int(bad.sum())} order rows dropped: unreadable date or quantity.")
        out = out[~bad]
    if (out["qty"] < 0).any():
        q.warnings.append(f"{int((out['qty'] < 0).sum())} orders have negative quantity (returns/credit notes?); netted off in the monthly totals.")

    c = out["country"].astype("string").str.strip()
    out["country"] = c.str.lower().map(COUNTRY_NAMES).fillna(c.where(c.notna() & (c != ""), UNKNOWN)).astype(str)
    n_unknown = int((out["country"] == UNKNOWN).sum())
    if n_unknown:
        q.warnings.append(f"{n_unknown} order rows have no country; excluded from the country-level forecasts.")
        out = out[out["country"] != UNKNOWN]

    out["month"] = out["date"].dt.to_period("M")
    last = out["date"].max()
    day_level = (out["date"].dt.day != 1).any()  # month-only data (all on the 1st) can't be checked
    if day_level and pd.notna(last) and last.day < last.days_in_month - 3:
        q.warnings.append(f"Last order is dated {last.date()}: the final month may be incomplete and understate demand.")

    countries, products = sorted(out["country"].unique()), sorted(out["product"].unique())
    present = set(zip(out["country"], out["product"]))
    absent = [f"{c}/{p}" for c in countries for p in products if (c, p) not in present]
    if absent:
        q.warnings.append(f"No orders at all for: {', '.join(absent)}. Real gap or a data/mapping problem? Worth checking.")
    return out[["month", "country", "product", "qty"]], q


def build_panel(orders: pd.DataFrame) -> dict:
    """Tidy orders -> {(country, product): monthly Series}. Months with no orders count as 0.
    A series starts at its first order (no fake zeros before a product launched in a country)."""
    months = pd.period_range(orders["month"].min(), orders["month"].max(), freq="M")
    panel = {}
    for (country, product), g in orders.groupby(["country", "product"]):
        s = g.groupby("month")["qty"].sum().reindex(months, fill_value=0.0).astype(float)
        panel[(country, product)] = s.loc[s.ne(0).idxmax():]
    return panel
