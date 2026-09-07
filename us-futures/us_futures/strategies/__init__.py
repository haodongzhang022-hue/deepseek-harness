"""
Strategy & Execution Layer
Factor selection, ensemble, signal generation, risk, execution, portfolio.
"""

from us_futures.strategies.factor_selection import (
    FactorSelector,
    select_by_icir,
    compute_factor_turnover,
    compute_ic_series,
)
from us_futures.strategies.ensemble import (
    EnsembleWeighting,
    compute_equal_weights,
    compute_icir_weights,
    compute_shrinkage_weights,
)
from us_futures.strategies.signal import (
    SignalGenerator,
    combine_signals,
)

__all__ = [
    "FactorSelector",
    "select_by_icir",
    "compute_factor_turnover",
    "compute_ic_series",
    "EnsembleWeighting",
    "compute_equal_weights",
    "compute_icir_weights",
    "compute_shrinkage_weights",
    "SignalGenerator",
    "combine_signals",
]
