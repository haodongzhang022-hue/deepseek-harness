"""
Technical Factors
Classic technical analysis indicators computed vectorized on Polars DataFrames.
All functions return Polars expressions for efficient columnar computation.
"""

from __future__ import annotations

import polars as pl
import numpy as np


def compute_sma(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 20,
) -> pl.Expr:
    """Simple Moving Average."""
    return pl.col(col).rolling_mean(window)


def compute_ema(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 20,
    alpha: Optional[float] = None,
) -> pl.Expr:
    """
    Exponential Moving Average.
    alpha = 2 / (window + 1) by default.
    """
    if alpha is None:
        alpha = 2.0 / (window + 1)
    return pl.col(col).ewm_mean(alpha=alpha, adjust=False)


def compute_rsi(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 14,
) -> pl.Expr:
    """
    Relative Strength Index (Wilder's smoothing).
    RSI = 100 - 100 / (1 + RS), RS = avg_gain / avg_loss
    """
    delta = pl.col(col).diff()
    gain = pl.when(delta > 0).then(delta).otherwise(0)
    loss = pl.when(delta < 0).then(-delta).otherwise(0)
    
    # Wilder's smoothing: EMA with alpha = 1/window
    alpha = 1.0 / window
    avg_gain = gain.ewm_mean(alpha=alpha, adjust=False)
    avg_loss = loss.ewm_mean(alpha=alpha, adjust=False)
    
    rs = pl.when(avg_loss > 0).then(avg_gain / avg_loss).otherwise(pl.lit(float('inf')))
    return 100 - (100 / (1 + rs))


def compute_macd(
    df: pl.DataFrame,
    col: str = "close",
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> dict[str, pl.Expr]:
    """
    MACD (Moving Average Convergence Divergence).
    Returns dict with 'macd', 'signal', 'histogram'.
    """
    ema_fast = pl.col(col).ewm_mean(alpha=2.0/(fast+1), adjust=False)
    ema_slow = pl.col(col).ewm_mean(alpha=2.0/(slow+1), adjust=False)
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm_mean(alpha=2.0/(signal+1), adjust=False)
    histogram = macd_line - signal_line
    
    return {
        "macd": macd_line,
        "signal": signal_line,
        "histogram": histogram,
    }


def compute_bollinger_bands(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 20,
    num_std: float = 2.0,
) -> dict[str, pl.Expr]:
    """
    Bollinger Bands.
    Returns dict with 'upper', 'middle', 'lower', 'width', 'pct_b'.
    """
    middle = pl.col(col).rolling_mean(window)
    std = pl.col(col).rolling_std(window)
    
    upper = middle + num_std * std
    lower = middle - num_std * std
    width = (upper - lower) / middle
    pct_b = (pl.col(col) - lower) / (upper - lower)
    
    return {
        "upper": upper,
        "middle": middle,
        "lower": lower,
        "width": width,
        "pct_b": pct_b,
    }


def compute_atr(
    df: pl.DataFrame,
    high: str = "high",
    low: str = "low",
    close: str = "close",
    window: int = 14,
) -> pl.Expr:
    """
    Average True Range (Wilder's smoothing).
    TR = max(H-L, |H-C_prev|, |L-C_prev|)
    """
    prev_close = pl.col(close).shift(1)
    tr1 = pl.col(high) - pl.col(low)
    tr2 = (pl.col(high) - prev_close).abs()
    tr3 = (pl.col(low) - prev_close).abs()
    
    tr = pl.max_horizontal(tr1, tr2, tr3)
    alpha = 1.0 / window
    return tr.ewm_mean(alpha=alpha, adjust=False)


def compute_adx(
    df: pl.DataFrame,
    high: str = "high",
    low: str = "low",
    close: str = "close",
    window: int = 14,
) -> dict[str, pl.Expr]:
    """
    Average Directional Index (ADX) with +DI and -DI.
    Measures trend strength regardless of direction.
    """
    # True Range
    prev_close = pl.col(close).shift(1)
    tr = pl.max_horizontal(
        pl.col(high) - pl.col(low),
        (pl.col(high) - prev_close).abs(),
        (pl.col(low) - prev_close).abs()
    )
    
    # Directional Movement
    up_move = pl.col(high) - pl.col(high).shift(1)
    down_move = pl.col(low).shift(1) - pl.col(low)
    
    plus_dm = pl.when((up_move > down_move) & (up_move > 0)).then(up_move).otherwise(0)
    minus_dm = pl.when((down_move > up_move) & (down_move > 0)).then(down_move).otherwise(0)
    
    alpha = 1.0 / window
    atr = tr.ewm_mean(alpha=alpha, adjust=False)
    plus_di = 100 * plus_dm.ewm_mean(alpha=alpha, adjust=False) / atr
    minus_di = 100 * minus_dm.ewm_mean(alpha=alpha, adjust=False) / atr
    
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di)
    adx = dx.ewm_mean(alpha=alpha, adjust=False)
    
    return {"adx": adx, "plus_di": plus_di, "minus_di": minus_di}


def compute_stochastic(
    df: pl.DataFrame,
    high: str = "high",
    low: str = "low",
    close: str = "close",
    k_window: int = 14,
    d_window: int = 3,
) -> dict[str, pl.Expr]:
    """
    Stochastic Oscillator.
    Returns %K and %D.
    """
    lowest_low = pl.col(low).rolling_min(k_window)
    highest_high = pl.col(high).rolling_max(k_window)
    
    k = 100 * (pl.col(close) - lowest_low) / (highest_high - lowest_low)
    d = k.rolling_mean(d_window)
    
    return {"stoch_k": k, "stoch_d": d}


def compute_williams_r(
    df: pl.DataFrame,
    high: str = "high",
    low: str = "low",
    close: str = "close",
    window: int = 14,
) -> pl.Expr:
    """
    Williams %R: (Highest High - Close) / (Highest High - Lowest Low) * -100.
    """
    highest_high = pl.col(high).rolling_max(window)
    lowest_low = pl.col(low).rolling_min(window)
    return -100 * (highest_high - pl.col(close)) / (highest_high - lowest_low)


def compute_cci(
    df: pl.DataFrame,
    high: str = "high",
    low: str = "low",
    close: str = "close",
    window: int = 20,
) -> pl.Expr:
    """
    Commodity Channel Index (CCI).
    CCI = (TP - SMA(TP)) / (0.015 * Mean Deviation)
    TP = (H + L + C) / 3
    """
    tp = (pl.col(high) + pl.col(low) + pl.col(close)) / 3
    sma_tp = tp.rolling_mean(window)
    mean_dev = (tp - sma_tp).abs().rolling_mean(window)
    
    return pl.when(mean_dev > 0).then((tp - sma_tp) / (0.015 * mean_dev)).otherwise(pl.lit(0.0))


def compute_momentum(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 10,
) -> pl.Expr:
    """
    Momentum: current price / price N periods ago.
    """
    return pl.col(col) / pl.col(col).shift(window)


def compute_roc(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 10,
) -> pl.Expr:
    """
    Rate of Change: (price - price_N) / price_N.
    """
    return (pl.col(col) - pl.col(col).shift(window)) / pl.col(col).shift(window)


def compute_obv(
    df: pl.DataFrame,
    close: str = "close",
    volume: str = "volume",
) -> pl.Expr:
    """
    On-Balance Volume (OBV).
    Cumulative volume with sign based on price direction.
    """
    price_change = pl.col(close).diff()
    signed_vol = pl.when(price_change > 0).then(pl.col(volume)) \
        .when(price_change < 0).then(-pl.col(volume)) \
        .otherwise(0)
    return signed_vol.cum_sum()


def compute_vwap_distance(
    df: pl.DataFrame,
    price: str = "close",
    vwap_col: str = "vwap",
) -> pl.Expr:
    """
    Distance from VWAP: (price - VWAP) / VWAP.
    """
    return (pl.col(price) - pl.col(vwap_col)) / pl.col(vwap_col)


def compute_zscore(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 20,
) -> pl.Expr:
    """
    Z-score: (value - mean) / std over rolling window.
    """
    mean = pl.col(col).rolling_mean(window)
    std = pl.col(col).rolling_std(window)
    return pl.when(std > 0).then((pl.col(col) - mean) / std).otherwise(pl.lit(0.0))


def compute_rolling_correlation(
    df: pl.DataFrame,
    col1: str,
    col2: str,
    window: int = 20,
) -> pl.Expr:
    """
    Rolling correlation between two columns.
    Manual implementation since Polars doesn't have rolling_corr.
    """
    x = pl.col(col1)
    y = pl.col(col2)
    
    # Standardize
    x_mean = x.rolling_mean(window)
    y_mean = y.rolling_mean(window)
    x_std = x.rolling_std(window)
    y_std = y.rolling_std(window)
    
    x_z = (x - x_mean) / x_std
    y_z = (y - y_mean) / y_std
    
    # Correlation = mean(z_x * z_y)
    return (x_z * y_z).rolling_mean(window)


def compute_beta(
    df: pl.DataFrame,
    asset_col: str,
    market_col: str,
    window: int = 60,
) -> pl.Expr:
    """
    Rolling beta: Cov(asset, market) / Var(market).
    Manual covariance implementation.
    """
    x = pl.col(asset_col)
    y = pl.col(market_col)
    
    xy = (x * y).rolling_mean(window)
    x_mean = x.rolling_mean(window)
    y_mean = y.rolling_mean(window)
    cov = xy - x_mean * y_mean
    
    var_mkt = y.rolling_var(window)
    return pl.when(var_mkt > 0).then(cov / var_mkt).otherwise(pl.lit(1.0))


def compute_hull_ma(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 20,
) -> pl.Expr:
    """
    Hull Moving Average: reduced lag MA.
    HMA = WMA(2*WMA(n/2) - WMA(n)), sqrt(n)
    """
    half_window = max(1, window // 2)
    sqrt_window = max(1, int(np.sqrt(window)))
    
    wma_half = pl.col(col).rolling_apply(lambda x: np.average(x, weights=np.arange(1, len(x)+1)), half_window)
    wma_full = pl.col(col).rolling_apply(lambda x: np.average(x, weights=np.arange(1, len(x)+1)), window)
    
    # This is simplified; proper HMA needs custom implementation
    # Using 2*EMA(half) - EMA(full) as approximation
    ema_half = pl.col(col).ewm_mean(alpha=2.0/(half_window+1), adjust=False)
    ema_full = pl.col(col).ewm_mean(alpha=2.0/(window+1), adjust=False)
    raw_hma = 2 * ema_half - ema_full
    
    return raw_hma.ewm_mean(alpha=2.0/(sqrt_window+1), adjust=False)


def compute_kama(
    df: pl.DataFrame,
    col: str = "close",
    window: int = 10,
    fast: int = 2,
    slow: int = 30,
) -> pl.Expr:
    """
    Kaufman's Adaptive Moving Average (KAMA).
    Adapts to volatility using efficiency ratio.
    """
    change = (pl.col(col) - pl.col(col).shift(window)).abs()
    volatility = pl.col(col).diff().abs().rolling_sum(window)
    
    er = pl.when(volatility > 0).then(change / volatility).otherwise(pl.lit(0.0))
    
    fast_sc = 2.0 / (fast + 1)
    slow_sc = 2.0 / (slow + 1)
    sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2
    
    # Recursive calculation - simplified using ewm with variable alpha
    # True KAMA requires recursive implementation
    return pl.col(col).ewm_mean(alpha=sc, adjust=False)


def compute_supertrend(
    df: pl.DataFrame,
    high: str = "high",
    low: str = "low",
    close: str = "close",
    window: int = 10,
    multiplier: float = 3.0,
) -> dict[str, pl.Expr]:
    """
    Supertrend indicator.
    Returns trend direction (1=up, -1=down) and stop line.
    """
    atr = compute_atr(df, high, low, close, window)
    
    basic_upper = (pl.col(high) + pl.col(low)) / 2 + multiplier * atr
    basic_lower = (pl.col(high) + pl.col(low)) / 2 - multiplier * atr
    
    # Simplified - true supertrend requires recursive logic
    # Using close relative to bands as proxy
    trend = pl.when(pl.col(close) > basic_upper).then(1).otherwise(-1)
    
    return {"supertrend": trend, "upper": basic_upper, "lower": basic_lower}


# Batch computation
def add_technical_factors(
    df: pl.DataFrame,
    windows: list[int] = [5, 10, 20, 40, 60, 120],
) -> pl.DataFrame:
    """
    Add comprehensive technical factors to DataFrame.
    """
    exprs = []
    
    # Trend
    for w in windows:
        exprs.extend([
            compute_sma(df, window=w).alias(f"sma_{w}"),
            compute_ema(df, window=w).alias(f"ema_{w}"),
            compute_momentum(df, window=w).alias(f"momentum_{w}"),
            compute_roc(df, window=w).alias(f"roc_{w}"),
        ])
    
    # Momentum oscillators
    exprs.extend([
        compute_rsi(df, window=14).alias("rsi_14"),
        compute_rsi(df, window=7).alias("rsi_7"),
    ])
    
    macd = compute_macd(df)
    exprs.extend([
        macd["macd"].alias("macd"),
        macd["signal"].alias("macd_signal"),
        macd["histogram"].alias("macd_hist"),
    ])
    
    # Volatility
    for w in [14, 20]:
        exprs.append(compute_atr(df, window=w).alias(f"atr_{w}"))
    
    bb = compute_bollinger_bands(df, window=20)
    exprs.extend([
        bb["upper"].alias("bb_upper"),
        bb["middle"].alias("bb_middle"),
        bb["lower"].alias("bb_lower"),
        bb["width"].alias("bb_width"),
        bb["pct_b"].alias("bb_pct_b"),
    ])
    
    # Volume
    exprs.append(compute_obv(df).alias("obv"))
    
    # Mean reversion
    for w in [20, 60]:
        exprs.append(compute_zscore(df, window=w).alias(f"zscore_{w}"))
    
    # Stochastic
    stoch = compute_stochastic(df)
    exprs.extend([
        stoch["stoch_k"].alias("stoch_k"),
        stoch["stoch_d"].alias("stoch_d"),
    ])
    
    # Williams %R
    exprs.append(compute_williams_r(df, window=14).alias("williams_r"))
    
    # CCI
    exprs.append(compute_cci(df, window=20).alias("cci"))
    
    # ADX
    adx = compute_adx(df, window=14)
    exprs.extend([
        adx["adx"].alias("adx"),
        adx["plus_di"].alias("plus_di"),
        adx["minus_di"].alias("minus_di"),
    ])
    
    return df.with_columns(exprs)