"""
Market Regime Detection
Identifies market states (trend, mean-reversion, high-vol, low-vol, crisis).
Supports HMM, threshold-based, and statistical methods.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import polars as pl
from scipy import stats

try:
    from hmmlearn import hmm
    HMM_AVAILABLE = True
except ImportError:
    HMM_AVAILABLE = False


def compute_hurst_exponent(
    df: pl.DataFrame,
    price_col: str = "close",
    window: int = 100,
    min_lags: int = 10,
) -> pl.Expr:
    """
    Hurst Exponent via R/S analysis (simplified proxy).
    H > 0.5: persistent (trending)
    H = 0.5: random walk
    H < 0.5: anti-persistent (mean-reverting)
    Uses autocorrelation as proxy since full R/S is complex.
    """
    returns = pl.col(price_col).pct_change()
    ret_lag = returns.shift(1)
    
    # Manual rolling autocorrelation at lag 1
    xy = (returns * ret_lag).rolling_mean(window)
    x_mean = returns.rolling_mean(window)
    y_mean = ret_lag.rolling_mean(window)
    x_std = returns.rolling_std(window)
    y_std = ret_lag.rolling_std(window)
    
    autocorr = (xy - x_mean * y_mean) / (x_std * y_std)
    # Map autocorrelation to Hurst: H ≈ 0.5 + 0.5*autocorr for AR(1)
    hurst = 0.5 + 0.5 * autocorr
    return hurst.clip(0.0, 1.0)


def detect_regime_threshold(
    df: pl.DataFrame,
    price_col: str = "close",
    vol_col: str = "close",
    vol_window: int = 20,
    trend_window: int = 60,
    vol_threshold_high: float = 0.02,  # 2% daily vol
    vol_threshold_low: float = 0.005,  # 0.5% daily vol
    trend_threshold: float = 0.001,    # 0.1% per bar trend
) -> pl.Expr:
    """
    Rule-based regime detection using volatility and trend thresholds.
    
    Returns regime codes:
    0: Low vol, no trend (mean reversion)
    1: Low vol, up trend
    2: Low vol, down trend
    3: High vol, no trend (choppy)
    4: High vol, up trend (trending bull)
    5: High vol, down trend (trending bear)
    6: Crisis (extreme vol)
    """
    # Volatility
    vol = pl.col(vol_col).pct_change().rolling_std(vol_window) * np.sqrt(252 * 390)
    
    # Trend (slope of linear regression)
    trend = compute_linear_trend(df, price_col, trend_window)
    
    # Classify
    is_high_vol = vol > vol_threshold_high
    is_low_vol = vol < vol_threshold_low
    is_crisis = vol > vol_threshold_high * 3
    is_up_trend = trend > trend_threshold
    is_down_trend = trend < -trend_threshold
    
    return pl.when(is_crisis).then(6) \
        .when(is_high_vol & is_up_trend).then(4) \
        .when(is_high_vol & is_down_trend).then(5) \
        .when(is_high_vol).then(3) \
        .when(is_low_vol & is_up_trend).then(1) \
        .when(is_low_vol & is_down_trend).then(2) \
        .otherwise(0)


def compute_linear_trend(
    df: pl.DataFrame,
    price_col: str = "close",
    window: int = 20,
) -> pl.Expr:
    """
    Rolling linear regression slope (trend).
    Slope = Cov(t, price) / Var(t) where t = 0..window-1
    """
    # Time index
    t = pl.arange(0, window, eager=True).cast(pl.Float64)
    t_mean = t.mean()
    t_var = t.var()
    
    # Rolling covariance of time and price
    # Simplified: use price change over window / window
    price_change = pl.col(price_col) - pl.col(price_col).shift(window)
    slope = price_change / window
    
    return slope


def detect_vol_regime(
    df: pl.DataFrame,
    price_col: str = "close",
    window: int = 60,
    n_regimes: int = 3,
) -> pl.Expr:
    """
    Volatility regime via percentile thresholds.
    Regimes: 0=low, 1=normal, 2=high, 3=extreme
    """
    vol = pl.col(price_col).pct_change().rolling_std(window) * np.sqrt(252 * 390)
    
    # Rolling percentiles
    p25 = vol.rolling_quantile(0.25, window_size=window, interpolation="nearest")
    p50 = vol.rolling_quantile(0.50, window_size=window, interpolation="nearest")
    p75 = vol.rolling_quantile(0.75, window_size=window, interpolation="nearest")
    p95 = vol.rolling_quantile(0.95, window_size=window, interpolation="nearest")
    
    return pl.when(vol > p95).then(3) \
        .when(vol > p75).then(2) \
        .when(vol > p25).then(1) \
        .otherwise(0)


def detect_trend_regime(
    df: pl.DataFrame,
    price_col: str = "close",
    fast_window: int = 10,
    slow_window: int = 50,
) -> pl.Expr:
    """
    Trend regime via moving average crossover.
    0: no trend (MAs intertwined)
    1: up trend (fast > slow)
    -1: down trend (fast < slow)
    """
    fast_ma = pl.col(price_col).rolling_mean(fast_window)
    slow_ma = pl.col(price_col).rolling_mean(slow_window)
    
    return pl.when(fast_ma > slow_ma).then(1).when(fast_ma < slow_ma).then(-1).otherwise(0)


def detect_regime_hmm(
    df: pl.DataFrame,
    features: list[str],
    n_states: int = 3,
    window: int = 252,  # ~1 day of 1min bars for training
    covariance_type: str = "diag",
) -> tuple[np.ndarray, np.ndarray]:
    """
    Hidden Markov Model regime detection.
    Requires hmmlearn package.
    
    Args:
        df: DataFrame with feature columns
        features: List of column names to use as observations
        n_states: Number of hidden states
        window: Lookback for training
        covariance_type: HMM covariance type
    
    Returns:
        (states, probabilities) - state sequence and state probabilities
    """
    if not HMM_AVAILABLE:
        raise ImportError("hmmlearn not installed. pip install hmmlearn")
    
    # Prepare data
    X = df.select(features).to_numpy()
    X = X[~np.isnan(X).any(axis=1)]
    
    if len(X) < window:
        raise ValueError(f"Need at least {window} samples, got {len(X)}")
    
    # Use recent window for training
    X_train = X[-window:]
    
    # Standardize
    mean = X_train.mean(axis=0)
    std = X_train.std(axis=0) + 1e-8
    X_train = (X_train - mean) / std
    
    # Fit HMM
    model = hmm.GaussianHMM(
        n_components=n_states,
        covariance_type=covariance_type,
        n_iter=100,
        random_state=42,
    )
    model.fit(X_train)
    
    # Predict on all data
    X_all = (X - mean) / std
    states = model.predict(X_all)
    probs = model.predict_proba(X_all)
    
    return states, probs


def compute_market_state(
    df: pl.DataFrame,
    price_col: str = "close",
    volume_col: str = "volume",
) -> pl.Expr:
    """
    Composite market state score combining multiple signals.
    Range: [-1, 1] where:
    -1: strong bear / crash
    0: neutral / choppy
    1: strong bull / trending
    """
    # Trend component (MA alignment)
    sma_fast = pl.col(price_col).rolling_mean(10)
    sma_slow = pl.col(price_col).rolling_mean(50)
    trend = pl.when(sma_fast > sma_slow).then(1).when(sma_fast < sma_slow).then(-1).otherwise(0)
    
    # Momentum component
    mom = pl.col(price_col).pct_change(20)
    momentum = pl.when(mom > 0).then(1).when(mom < 0).then(-1).otherwise(0)
    
    # Volatility component (inverted: low vol = good for trend)
    vol = pl.col(price_col).pct_change().rolling_std(20)
    vol_rank = vol.rolling_quantile(0.5, window_size=252, interpolation="nearest")  # median vol
    vol_state = pl.when(vol < vol_rank).then(1).otherwise(-1)
    
    # Volume component
    vol_ratio = pl.col(volume_col) / pl.col(volume_col).rolling_mean(20)
    volume = pl.when(vol_ratio > 1.2).then(1).when(vol_ratio < 0.8).then(-1).otherwise(0)
    
    # Combine (equal weight)
    return (trend + momentum + vol_state + volume) / 4


def add_regime_features(
    df: pl.DataFrame,
) -> pl.DataFrame:
    """
    Add all regime detection features.
    """
    exprs = [
        detect_regime_threshold(df).alias("regime_threshold"),
        detect_vol_regime(df).alias("regime_vol"),
        detect_trend_regime(df).alias("regime_trend"),
        compute_market_state(df).alias("market_state"),
        compute_hurst_exponent(df).alias("hurst"),
    ]
    
    return df.with_columns(exprs)


def regime_labels() -> dict[int, str]:
    """Human-readable regime labels for threshold method."""
    return {
        0: "mean_revert_low_vol",
        1: "trend_up_low_vol",
        2: "trend_down_low_vol",
        3: "choppy_high_vol",
        4: "trend_up_high_vol",
        5: "trend_down_high_vol",
        6: "crisis",
    }


def vol_regime_labels() -> dict[int, str]:
    """Labels for volatility regime."""
    return {
        0: "low_vol",
        1: "normal_vol",
        2: "high_vol",
        3: "extreme_vol",
    }


def trend_regime_labels() -> dict[int, str]:
    """Labels for trend regime."""
    return {
        -1: "downtrend",
        0: "no_trend",
        1: "uptrend",
    }