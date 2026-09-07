"""
Microstructure Features
High-frequency features from 1min/tick data: VWAP, spreads, order flow, volatility estimators.
All functions accept Polars DataFrame and return Polars expression/Series.
"""

from __future__ import annotations

from typing import Optional

import polars as pl
import numpy as np


def compute_vwap(
    df: pl.DataFrame,
    price_col: str = "close",
    volume_col: str = "volume",
    window: Optional[int] = None,
) -> pl.Expr:
    """
    Volume-Weighted Average Price.
    
    If window is None: cumulative VWAP from start.
    If window is int: rolling VWAP over window bars.
    """
    if window is None:
        return (pl.col(price_col) * pl.col(volume_col)).cum_sum() / pl.col(volume_col).cum_sum()
    else:
        return (
            (pl.col(price_col) * pl.col(volume_col)).rolling_sum(window)
            / pl.col(volume_col).rolling_sum(window)
        )


def compute_twap(
    df: pl.DataFrame,
    price_col: str = "close",
    window: Optional[int] = None,
) -> pl.Expr:
    """
    Time-Weighted Average Price (simple rolling mean).
    """
    if window is None:
        return pl.col(price_col).cum_mean()
    else:
        return pl.col(price_col).rolling_mean(window)


def compute_bid_ask_spread(
    df: pl.DataFrame,
    bid_col: str = "bid",
    ask_col: str = "ask",
    price_col: str = "close",
) -> pl.Expr:
    """
    Bid-ask spread in price units and basis points.
    Returns: spread = ask - bid
    """
    # Use close as fallback if bid/ask not available
    bid = pl.when(pl.col(bid_col).is_not_null()).then(pl.col(bid_col)).otherwise(pl.col(price_col))
    ask = pl.when(pl.col(ask_col).is_not_null()).then(pl.col(ask_col)).otherwise(pl.col(price_col))
    return ask - bid


def compute_bid_ask_spread_bps(
    df: pl.DataFrame,
    bid_col: str = "bid",
    ask_col: str = "ask",
    mid_col: str = "close",
) -> pl.Expr:
    """
    Bid-ask spread in basis points relative to mid price.
    """
    spread = compute_bid_ask_spread(df, bid_col, ask_col)
    mid = pl.when(pl.col(bid_col).is_not_null() & pl.col(ask_col).is_not_null()) \
        .then((pl.col(bid_col) + pl.col(ask_col)) / 2) \
        .otherwise(pl.col(mid_col))
    return (spread / mid) * 10000


def compute_mid_price(
    df: pl.DataFrame,
    bid_col: str = "bid",
    ask_col: str = "ask",
    price_col: str = "close",
) -> pl.Expr:
    """
    Mid price = (bid + ask) / 2.
    Falls back to close if bid/ask not available.
    """
    return pl.when(pl.col(bid_col).is_not_null() & pl.col(ask_col).is_not_null()) \
        .then((pl.col(bid_col) + pl.col(ask_col)) / 2) \
        .otherwise(pl.col(price_col))


def compute_order_flow_imbalance(
    df: pl.DataFrame,
    bid_size_col: str = "bid_size",
    ask_size_col: str = "ask_size",
) -> pl.Expr:
    """
    Order Flow Imbalance (OFI) = (bid_size - ask_size) / (bid_size + ask_size).
    Range: [-1, 1], positive = buying pressure.
    """
    bid_size = pl.col(bid_size_col)
    ask_size = pl.col(ask_size_col)
    total = bid_size + ask_size
    return pl.when(total > 0).then((bid_size - ask_size) / total).otherwise(pl.lit(0.0))


def compute_volume_weighted_mid(
    df: pl.DataFrame,
    bid_col: str = "bid",
    ask_col: str = "ask",
    bid_size_col: str = "bid_size",
    ask_size_col: str = "ask_size",
) -> pl.Expr:
    """
    Volume-weighted mid price = (bid * ask_size + ask * bid_size) / (bid_size + ask_size).
    More accurate than simple mid when book is asymmetric.
    """
    bid = pl.col(bid_col)
    ask = pl.col(ask_col)
    bid_size = pl.col(bid_size_col)
    ask_size = pl.col(ask_size_col)
    total_size = bid_size + ask_size
    
    return pl.when(total_size > 0) \
        .then((bid * ask_size + ask * bid_size) / total_size) \
        .otherwise((bid + ask) / 2)


def compute_realized_volatility(
    df: pl.DataFrame,
    price_col: str = "close",
    window: int = 20,
    annualize: bool = True,
    trading_periods: int = 252 * 390,  # 1min bars per year
) -> pl.Expr:
    """
    Realized volatility from close-to-close returns.
    Annualized by default assuming 1min bars.
    """
    ret = pl.col(price_col).pct_change()
    vol = ret.rolling_std(window)
    
    if annualize:
        return vol * np.sqrt(trading_periods / window)
    return vol


def compute_parkinson_vol(
    df: pl.DataFrame,
    high_col: str = "high",
    low_col: str = "low",
    window: int = 20,
    annualize: bool = True,
    trading_periods: int = 252 * 390,
) -> pl.Expr:
    """
    Parkinson (1980) volatility estimator using high-low range.
    More efficient than close-to-close (uses 4x more info).
    Formula: sqrt(1/(4*log(2)) * sum(log(H/L)^2) / N)
    """
    k = 1.0 / (4.0 * np.log(2.0))
    log_hl = (pl.col(high_col) / pl.col(low_col)).log()
    vol = (k * (log_hl ** 2).rolling_mean(window)).sqrt()
    
    if annualize:
        return vol * np.sqrt(trading_periods / window)
    return vol


def compute_garman_klass_vol(
    df: pl.DataFrame,
    open_col: str = "open",
    high_col: str = "high",
    low_col: str = "low",
    close_col: str = "close",
    window: int = 20,
    annualize: bool = True,
    trading_periods: int = 252 * 390,
) -> pl.Expr:
    """
    Garman-Klass (1980) volatility estimator using OHLC.
    Even more efficient than Parkinson (7x close-to-close).
    """
    log_hl = (pl.col(high_col) / pl.col(low_col)).log()
    log_co = (pl.col(close_col) / pl.col(open_col)).log()
    
    term1 = 0.5 * (log_hl ** 2)
    term2 = (2 * np.log(2) - 1) * (log_co ** 2)
    
    vol = (term1 - term2).rolling_mean(window).sqrt()
    
    if annualize:
        return vol * np.sqrt(trading_periods / window)
    return vol


def compute_roll_spread_estimator(
    df: pl.DataFrame,
    price_col: str = "close",
    window: int = 20,
) -> pl.Expr:
    """
    Roll (1984) implied spread estimator from serial covariance.
    spread = 2 * sqrt(-Cov(r_t, r_{t-1})) where r is return.
    Assumes spread is constant and trades bounce between bid/ask.
    Uses manual rolling covariance since Polars doesn't have rolling_cov.
    """
    ret = pl.col(price_col).pct_change()
    ret_lag = ret.shift(1)
    
    # Manual rolling covariance: Cov(X,Y) = E[XY] - E[X]E[Y]
    xy = (ret * ret_lag).rolling_mean(window)
    x_mean = ret.rolling_mean(window)
    y_mean = ret_lag.rolling_mean(window)
    cov = xy - x_mean * y_mean
    
    return 2 * (-cov).clip(lower_bound=0).sqrt()


def compute_kyle_lambda(
    df: pl.DataFrame,
    price_col: str = "close",
    volume_col: str = "volume",
    window: int = 20,
) -> pl.Expr:
    """
    Kyle's Lambda: price impact coefficient.
    Regresses price change on signed volume: r_t = lambda * signed_vol_t + epsilon.
    Higher lambda = less liquid.
    """
    # Signed volume: positive for buyer-initiated, negative for seller-initiated
    # Approximation: use price change direction
    ret = pl.col(price_col).pct_change()
    signed_vol = pl.when(ret > 0).then(pl.col(volume_col)).otherwise(-pl.col(volume_col))
    
    # Rolling covariance / variance using manual formula
    xy = (ret * signed_vol).rolling_mean(window)
    x_mean = ret.rolling_mean(window)
    y_mean = signed_vol.rolling_mean(window)
    cov = xy - x_mean * y_mean
    
    var_vol = signed_vol.rolling_var(window)
    
    return pl.when(var_vol > 0).then(cov / var_vol).otherwise(pl.lit(0.0))


def compute_kyle_lambda(
    df: pl.DataFrame,
    price_col: str = "close",
    volume_col: str = "volume",
    window: int = 20,
) -> pl.Expr:
    """
    Kyle's Lambda: price impact coefficient.
    Regresses price change on signed volume: r_t = lambda * signed_vol_t + epsilon.
    Higher lambda = less liquid.
    """
    # Signed volume: positive for buyer-initiated, negative for seller-initiated
    # Approximation: use price change direction
    ret = pl.col(price_col).pct_change()
    signed_vol = pl.when(ret > 0).then(pl.col(volume_col)).otherwise(-pl.col(volume_col))
    
    # Rolling covariance / variance using manual formula
    xy = (ret * signed_vol).rolling_mean(window)
    x_mean = ret.rolling_mean(window)
    y_mean = signed_vol.rolling_mean(window)
    cov = xy - x_mean * y_mean
    
    var_vol = signed_vol.rolling_var(window)
    
    return pl.when(var_vol > 0).then(cov / var_vol).otherwise(pl.lit(0.0))


def compute_amihud_illiquidity(
    df: pl.DataFrame,
    price_col: str = "close",
    volume_col: str = "volume",
    window: int = 20,
) -> pl.Expr:
    """
    Amihud (2002) illiquidity ratio: avg(|return| / dollar_volume).
    Higher = more illiquid.
    """
    ret = pl.col(price_col).pct_change().abs()
    dollar_vol = pl.col(price_col) * pl.col(volume_col)
    
    # Avoid division by zero
    illiq = pl.when(dollar_vol > 0).then(ret / dollar_vol).otherwise(pl.lit(0.0))
    return illiq.rolling_mean(window)


def compute_trade_intensity(
    df: pl.DataFrame,
    trade_count_col: str = "trade_count",
    window: int = 20,
) -> pl.Expr:
    """
    Trade intensity: trades per bar (proxy for activity).
    """
    return pl.col(trade_count_col).rolling_mean(window)


def compute_volume_rate(
    df: pl.DataFrame,
    volume_col: str = "volume",
    window: int = 20,
) -> pl.Expr:
    """
    Volume rate of change: (vol_t - vol_{t-1}) / vol_{t-1}.
    """
    vol = pl.col(volume_col)
    return (vol - vol.shift(1)) / vol.shift(1)


def compute_relative_volume(
    df: pl.DataFrame,
    volume_col: str = "volume",
    window: int = 20,
    lookback_window: int = 252,  # 1 day of 1min bars for daily avg
) -> pl.Expr:
    """
    Relative volume: current volume / average volume over lookback.
    > 1 means above average activity.
    """
    vol = pl.col(volume_col)
    avg_vol = vol.rolling_mean(lookback_window)
    return pl.when(avg_vol > 0).then(vol / avg_vol).otherwise(pl.lit(1.0))


def compute_vwap_deviation(
    df: pl.DataFrame,
    price_col: str = "close",
    volume_col: str = "volume",
    window: int = 20,
) -> pl.Expr:
    """
    Price deviation from VWAP: (price - VWAP) / VWAP.
    Positive = price above VWAP (bullish), negative = below (bearish).
    """
    vwap = compute_vwap(df, price_col, volume_col, window)
    return (pl.col(price_col) - vwap) / vwap


def compute_tick_rule(
    df: pl.DataFrame,
    price_col: str = "close",
) -> pl.Expr:
    """
    Tick rule for trade signing (Lee & Ready 1991).
    +1 if uptick, -1 if downtick, 0 if zero tick.
    Used to infer buy/sell from trade data.
    """
    price = pl.col(price_col)
    prev_price = price.shift(1)
    return pl.when(price > prev_price).then(1).when(price < prev_price).then(-1).otherwise(0)


# Batch computation for efficiency
def add_microstructure_features(
    df: pl.DataFrame,
    windows: list[int] = [5, 10, 20, 60],
) -> pl.DataFrame:
    """
    Add all microstructure features to DataFrame in one pass.
    
    Args:
        df: DataFrame with OHLCV + bid/ask/size columns
        windows: List of lookback windows
    
    Returns:
        DataFrame with additional microstructure columns
    """
    exprs = []
    
    # Spread features
    if "bid" in df.columns and "ask" in df.columns:
        exprs.extend([
            compute_bid_ask_spread(df).alias("spread"),
            compute_bid_ask_spread_bps(df).alias("spread_bps"),
            compute_mid_price(df).alias("mid_price"),
        ])
        
        if "bid_size" in df.columns and "ask_size" in df.columns:
            exprs.extend([
                compute_order_flow_imbalance(df).alias("ofi"),
                compute_volume_weighted_mid(df).alias("vw_mid"),
            ])
    
    # Volatility estimators
    for w in windows:
        exprs.extend([
            compute_realized_volatility(df, window=w).alias(f"rv_{w}"),
            compute_parkinson_vol(df, window=w).alias(f"park_vol_{w}"),
            compute_garman_klass_vol(df, window=w).alias(f"gk_vol_{w}"),
            compute_roll_spread_estimator(df, window=w).alias(f"roll_spread_{w}"),
            compute_kyle_lambda(df, window=w).alias(f"kyle_lambda_{w}"),
            compute_amihud_illiquidity(df, window=w).alias(f"amihud_{w}"),
        ])
    
    # Volume features
    for w in [5, 20]:
        if "trade_count" in df.columns:
            exprs.append(compute_trade_intensity(df, window=w).alias(f"trade_intensity_{w}"))
        exprs.extend([
            compute_volume_rate(df, window=w).alias(f"vol_rate_{w}"),
            compute_relative_volume(df, window=w).alias(f"rel_vol_{w}"),
        ])
    
    # VWAP deviation
    for w in [20, 60]:
        if "bid" in df.columns and "ask" in df.columns:
            exprs.append(compute_vwap_deviation(df, window=w).alias(f"vwap_dev_{w}"))
    
    # Tick rule
    exprs.append(compute_tick_rule(df).alias("tick_rule"))
    
    return df.with_columns(exprs)