"""
Factor Builder & Registry
Pipeline for computing, storing, and managing factor library.
Supports versioning, metadata, and IC evaluation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional
from uuid import uuid4

import numpy as np
import polars as pl
from loguru import logger
from scipy import stats

from us_futures.features.microstructure import add_microstructure_features
from us_futures.features.technical import add_technical_factors
from us_futures.features.regime import add_regime_features


class FactorCategory(str, Enum):
    MICROSTRUCTURE = "microstructure"
    TECHNICAL = "technical"
    REGIME = "regime"
    CROSS_ASSET = "cross_asset"
    FUNDAMENTAL = "fundamental"
    ALTERNATIVE = "alternative"
    CUSTOM = "custom"


@dataclass
class FactorMetadata:
    """Metadata for a single factor."""
    name: str
    category: FactorCategory
    description: str
    formula: str  # Human-readable formula
    lookback: int  # Required lookback window
    frequency: str  # Data frequency (1min, 5min, etc.)
    version: str = "1.0"
    author: str = "system"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tags: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)  # Other factor names required
    parameters: dict[str, Any] = field(default_factory=dict)
    
    # Performance tracking
    ic_mean: float = 0.0
    ic_std: float = 0.0
    icir: float = 0.0
    turnover: float = 0.0
    last_evaluated: Optional[datetime] = None


class FactorRegistry:
    """
    Central registry for all factors.
    Manages metadata, versioning, and evaluation history.
    """
    
    def __init__(self):
        self._factors: dict[str, FactorMetadata] = {}
        self._expressions: dict[str, Callable[[pl.DataFrame], pl.Expr]] = {}
        self._eval_history: dict[str, list[dict]] = {}
    
    def register(
        self,
        name: str,
        category: FactorCategory,
        description: str,
        formula: str,
        lookback: int,
        frequency: str,
        expression: Callable[[pl.DataFrame], pl.Expr],
        version: str = "1.0",
        author: str = "system",
        tags: list[str] = None,
        dependencies: list[str] = None,
        parameters: dict[str, Any] = None,
    ) -> None:
        """Register a new factor."""
        if name in self._factors:
            logger.warning(f"Factor '{name}' already registered, overwriting")
        
        metadata = FactorMetadata(
            name=name,
            category=category,
            description=description,
            formula=formula,
            lookback=lookback,
            frequency=frequency,
            version=version,
            author=author,
            tags=tags or [],
            dependencies=dependencies or [],
            parameters=parameters or {},
        )
        
        self._factors[name] = metadata
        self._expressions[name] = expression
        cat_str = category.value if hasattr(category, 'value') else str(category)
        logger.info(f"Registered factor: {name} ({cat_str})")
    
    def get(self, name: str) -> Optional[FactorMetadata]:
        return self._factors.get(name)
    
    def get_expression(self, name: str) -> Optional[Callable]:
        return self._expressions.get(name)
    
    def list_factors(
        self,
        category: Optional[FactorCategory] = None,
        tags: list[str] = None,
    ) -> list[FactorMetadata]:
        factors = list(self._factors.values())
        if category:
            factors = [f for f in factors if f.category == category]
        if tags:
            factors = [f for f in factors if any(t in f.tags for t in tags)]
        return factors
    
    def update_performance(
        self,
        name: str,
        ic_mean: float,
        ic_std: float,
        turnover: float = 0.0,
    ) -> None:
        """Update factor performance metrics."""
        if name in self._factors:
            f = self._factors[name]
            f.ic_mean = ic_mean
            f.ic_std = ic_std
            f.icir = ic_mean / ic_std if ic_std > 0 else 0.0
            f.turnover = turnover
            f.last_evaluated = datetime.now(timezone.utc)
            
            # Record history
            self._eval_history.setdefault(name, []).append({
                "timestamp": f.last_evaluated,
                "ic_mean": ic_mean,
                "ic_std": ic_std,
                "icir": f.icir,
                "turnover": turnover,
            })
    
    def get_top_factors(
        self,
        n: int = 20,
        min_icir: float = 0.5,
        category: Optional[FactorCategory] = None,
    ) -> list[FactorMetadata]:
        """Get top factors by ICIR."""
        factors = self.list_factors(category=category)
        factors = [f for f in factors if f.icir >= min_icir]
        factors.sort(key=lambda x: x.icir, reverse=True)
        return factors[:n]
    
    def get_all_names(self) -> list[str]:
        return list(self._factors.keys())


class FactorBuilder:
    """
    Builds factor matrix from raw market data.
    Handles feature groups, dependencies, and incremental updates.
    """
    
    def __init__(
        self,
        registry: FactorRegistry = None,
        microstructure_windows: list[int] = [5, 10, 20, 60],
        technical_windows: list[int] = [5, 10, 20, 40, 60, 120],
        compute_regime: bool = True,
    ):
        self.registry = registry or FactorRegistry()
        self.microstructure_windows = microstructure_windows
        self.technical_windows = technical_windows
        self.compute_regime = compute_regime
        
        # Register built-in factors
        self._register_builtins()
    
    def _register_builtins(self) -> None:
        """Register built-in factor groups."""
        # Microstructure factors registered via add_microstructure_features
        pass
    
    def build(
        self,
        df: pl.DataFrame,
        feature_groups: list[str] = None,
    ) -> pl.DataFrame:
        """
        Build all factors for a DataFrame.
        
        Args:
            df: Raw OHLCV DataFrame (must have required columns)
            feature_groups: List of groups to compute 
                           ['microstructure', 'technical', 'regime', 'all']
        
        Returns:
            DataFrame with original + factor columns
        """
        groups = feature_groups or ["all"]
        result = df
        
        if "all" in groups or "microstructure" in groups:
            result = add_microstructure_features(result, self.microstructure_windows)
        
        if "all" in groups or "technical" in groups:
            result = add_technical_factors(result, self.technical_windows)
        
        if "all" in groups or "regime" in groups:
            result = add_regime_features(result)
        
        return result
    
    def build_incremental(
        self,
        df: pl.DataFrame,
        last_n: int = 100,
    ) -> pl.DataFrame:
        """
        Build factors only for the last N rows (for real-time updates).
        Assumes df has enough history for lookback windows.
        """
        # Build on full data, then return last N
        full = self.build(df)
        return full.tail(last_n)


def create_factor_pipeline(
    registry: FactorRegistry = None,
    microstructure_windows: list[int] = [5, 10, 20, 60],
    technical_windows: list[int] = [5, 10, 20, 40, 60, 120],
    compute_regime: bool = True,
) -> FactorBuilder:
    """Factory function for FactorBuilder."""
    return FactorBuilder(
        registry=registry,
        microstructure_windows=microstructure_windows,
        technical_windows=technical_windows,
        compute_regime=compute_regime,
    )


def evaluate_factor_ic(
    factor_values: pl.Series,
    forward_returns: pl.Series,
    min_periods: int = 100,
) -> dict[str, float]:
    """
    Evaluate Information Coefficient (IC) between factor and forward returns.
    
    Returns:
        dict with ic_mean, ic_std, icir, t_stat, p_value
    """
    # Align and drop nulls
    mask = factor_values.is_not_null() & forward_returns.is_not_null()
    f = factor_values.filter(mask)
    r = forward_returns.filter(mask)
    
    if len(f) < min_periods:
        return {"ic_mean": 0, "ic_std": 0, "icir": 0, "t_stat": 0, "p_value": 1, "n": len(f)}
    
    # Convert to numpy for correlation
    f_np = f.to_numpy()
    r_np = r.to_numpy()
    
    # Spearman rank correlation
    from scipy.stats import spearmanr
    ic, _ = spearmanr(f_np, r_np)
    ic = float(ic) if not np.isnan(ic) else 0.0
    
    # T-statistic for significance
    n = len(f_np)
    t_stat = ic * np.sqrt((n - 2) / (1 - ic**2)) if ic**2 < 1 else 0
    p_value = 2 * (1 - stats.t.cdf(abs(t_stat), n - 2))
    
    return {
        "ic_mean": ic,
        "ic_std": 0.0,  # Single period IC
        "icir": ic / 0.01 if ic != 0 else 0,  # Approximate
        "t_stat": float(t_stat),
        "p_value": float(p_value),
        "n": n,
    }


def evaluate_factor_ic_series(
    factor_df: pl.DataFrame,
    returns_df: pl.DataFrame,
    factor_col: str,
    return_col: str = "forward_return",
    window: int = 252,  # Rolling IC window
) -> pl.DataFrame:
    """
    Compute rolling IC for a factor.
    Returns DataFrame with IC time series.
    """
    # This would need custom rolling implementation
    # Placeholder for now
    return pl.DataFrame()


# Global registry instance
_global_registry: FactorRegistry | None = None


def get_factor_registry() -> FactorRegistry:
    global _global_registry
    if _global_registry is None:
        _global_registry = FactorRegistry()
    return _global_registry


def register_builtin_factors(registry: FactorRegistry = None) -> None:
    """Register all built-in factor groups."""
    reg = registry or get_factor_registry()
    
    # Microstructure factors
    micro_factors = [
        ("spread", FactorCategory.MICROSTRUCTURE, "Bid-ask spread", "ask - bid", 1, "1min"),
        ("spread_bps", FactorCategory.MICROSTRUCTURE, "Spread in bps", "spread / mid * 10000", 1, "1min"),
        ("ofi", FactorCategory.MICROSTRUCTURE, "Order flow imbalance", "(bid_sz - ask_sz) / (bid_sz + ask_sz)", 1, "1min"),
        ("vw_mid", FactorCategory.MICROSTRUCTURE, "Volume-weighted mid", "(bid*ask_sz + ask*bid_sz) / total_sz", 1, "1min"),
    ]
    
    for name, cat, desc, formula, lb, freq in micro_factors:
        reg.register(
            name=name,
            category=cat,
            description=desc,
            formula=formula,
            lookback=lb,
            frequency=freq,
            expression=lambda df, n=name: pl.col(n) if n in df.columns else pl.lit(0),
            tags=["microstructure", "liquidity"],
        )
    
    # Technical factors
    tech_factors = [
        ("rsi_14", FactorCategory.TECHNICAL, "RSI 14", "RSI(close, 14)", 14, "1min"),
        ("macd", FactorCategory.TECHNICAL, "MACD", "EMA(12) - EMA(26)", 26, "1min"),
        ("atr_14", FactorCategory.TECHNICAL, "ATR 14", "ATR(high, low, close, 14)", 14, "1min"),
        ("bb_pct_b", FactorCategory.TECHNICAL, "Bollinger %B", "(close - lower) / (upper - lower)", 20, "1min"),
        ("zscore_20", FactorCategory.TECHNICAL, "Z-score 20", "(close - mean) / std", 20, "1min"),
        ("obv", FactorCategory.TECHNICAL, "On-Balance Volume", "cumsum(sign(delta) * vol)", 1, "1min"),
        ("stoch_k", FactorCategory.TECHNICAL, "Stochastic %K", "%K(14)", 14, "1min"),
        ("williams_r", FactorCategory.TECHNICAL, "Williams %R", "%R(14)", 14, "1min"),
        ("cci", FactorCategory.TECHNICAL, "CCI", "CCI(20)", 20, "1min"),
        ("adx", FactorCategory.TECHNICAL, "ADX", "ADX(14)", 14, "1min"),
    ]
    
    for name, cat, desc, formula, lb, freq in tech_factors:
        reg.register(
            name=name,
            category=cat,
            description=desc,
            formula=formula,
            lookback=lb,
            frequency=freq,
            expression=lambda df, n=name: pl.col(n) if n in df.columns else pl.lit(0),
            tags=["technical", "momentum"],
        )
    
    # Regime factors
    regime_factors = [
        ("regime_threshold", FactorCategory.REGIME, "Threshold regime", "Rule-based regime", 60, "1min"),
        ("regime_vol", FactorCategory.REGIME, "Vol regime", "Percentile vol regime", 60, "1min"),
        ("regime_trend", FactorCategory.REGIME, "Trend regime", "MA crossover trend", 50, "1min"),
        ("market_state", FactorCategory.REGIME, "Market state", "Composite state score", 50, "1min"),
        ("hurst", FactorCategory.REGIME, "Hurst exponent", "Hurst(100)", 100, "1min"),
    ]
    
    for name, cat, desc, formula, lb, freq in regime_factors:
        reg.register(
            name=name,
            category=cat,
            description=desc,
            formula=formula,
            lookback=lb,
            frequency=freq,
            expression=lambda df, n=name: pl.col(n) if n in df.columns else pl.lit(0),
            tags=["regime", "state"],
        )
    
    logger.info(f"Registered {len(reg.get_all_names())} built-in factors")


# Initialize with built-ins
register_builtin_factors(get_factor_registry())