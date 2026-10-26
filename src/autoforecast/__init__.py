"""Self-checking demand forecaster: reads an order table, checks it, picks a method per series
by back-test, and only trusts a smart model if it clearly beats the rolling-average baseline."""
from .ingest import load_orders, build_panel
from .pipeline import run

__all__ = ["load_orders", "build_panel", "run"]
