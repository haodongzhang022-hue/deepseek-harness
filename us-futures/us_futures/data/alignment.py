"""
Multi-Frequency Alignment & Contract Rolling
Resample bars, stitch continuous contracts, handle timezone.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

import numpy as np
import polars as pl
from loguru import logger

from us_futures.config import get_settings, load_symbols_config
from us_futures.data.schema import Bar, DataFrequency


class RollMethod(str, Enum):
    VOLUME = "volume"      # Switch when next contract volume > current
    OPEN_INTEREST = "oi"   # Switch when next contract OI > current
    DATE = "date"          # Switch N days before expiration
    CUSTOM = "custom"      # User-defined roll dates


class AlignmentMethod(str, Enum):
    FIRST = "first"           # First tick of period
    LAST = "last"             # Last tick of period
    VWAP = "vwap"             # Volume-weighted average
    OHLC = "ohlc"             # Proper OHLC aggregation


def resample_bars(
    df: pl.DataFrame,
    target_freq: DataFrequency,
    method: AlignmentMethod = AlignmentMethod.OHLC,
    timezone: str = "America/Chicago",
) -> pl.DataFrame:
    """
    Resample bars to target frequency.
    
    Args:
        df: Polars DataFrame with columns [timestamp, open, high, low, close, volume, ...]
        target_freq: Target frequency
        method: Aggregation method
        timezone: Timezone for session alignment
    
    Returns:
        Resampled DataFrame
    """
    if df.is_empty():
        return df

    # Ensure timestamp is datetime and sorted
    df = df.sort("timestamp")
    
    # Convert target frequency to polars duration string
    freq_map = {
        DataFrequency.MIN_1: "1m",
        DataFrequency.MIN_5: "5m",
        DataFrequency.MIN_15: "15m",
        DataFrequency.MIN_30: "30m",
        DataFrequency.HOUR_1: "1h",
        DataFrequency.HOUR_4: "4h",
        DataFrequency.DAY_1: "1d",
    }
    freq_str = freq_map.get(target_freq)
    if not freq_str:
        raise ValueError(f"Unsupported target frequency: {target_freq}")

    # Group by dynamic windows
    if method == AlignmentMethod.OHLC:
        # Proper OHLC aggregation (group_by_dynamic already includes timestamp)
        agg_exprs = [
            pl.col("open").first().alias("open"),
            pl.col("high").max().alias("high"),
            pl.col("low").min().alias("low"),
            pl.col("close").last().alias("close"),
            pl.col("volume").sum().alias("volume"),
        ]
        
        # Optional columns
        optional_cols = ["open_interest", "vwap", "trade_count", "bid", "ask", "bid_size", "ask_size"]
        for col in optional_cols:
            if col in df.columns:
                if col in ["open_interest", "bid", "ask", "bid_size", "ask_size"]:
                    agg_exprs.append(pl.col(col).last().alias(col))
                elif col == "vwap":
                    # Recalculate VWAP
                    agg_exprs.append(
                        ((pl.col("close") * pl.col("volume")).sum() / pl.col("volume").sum()).alias("vwap")
                    )
                elif col == "trade_count":
                    agg_exprs.append(pl.col(col).sum().alias(col))

        # Add metadata columns (take first)
        meta_cols = ["symbol", "contract", "frequency", "source", "exchange", "sector", "tick_size", "tick_value", "multiplier", "received_at", "is_final"]
        for col in meta_cols:
            if col in df.columns:
                agg_exprs.append(pl.col(col).first().alias(col))

        result = df.group_by_dynamic("timestamp", every=freq_str, closed="left").agg(agg_exprs)
        
    elif method == AlignmentMethod.VWAP:
        # VWAP-based resampling
        result = df.group_by_dynamic("timestamp", every=freq_str, closed="left").agg([
            pl.col("timestamp").first().alias("timestamp"),
            ((pl.col("close") * pl.col("volume")).sum() / pl.col("volume").sum()).alias("vwap"),
            pl.col("volume").sum().alias("volume"),
            pl.col("open").first().alias("open"),
            pl.col("high").max().alias("high"),
            pl.col("low").min().alias("low"),
            pl.col("close").last().alias("close"),
        ])
        
        # Add metadata
        for col in ["symbol", "contract", "frequency", "source", "exchange", "sector", "tick_size", "tick_value", "multiplier"]:
            if col in df.columns:
                result = result.with_columns(pl.lit(df[col][0]).alias(col))
                
    elif method == AlignmentMethod.LAST:
        result = df.group_by_dynamic("timestamp", every=freq_str, closed="left").last()
    elif method == AlignmentMethod.FIRST:
        result = df.group_by_dynamic("timestamp", every=freq_str, closed="left").first()
    else:
        raise ValueError(f"Unknown alignment method: {method}")

    # Update frequency column
    result = result.with_columns(pl.lit(target_freq.value).alias("frequency"))
    
    return result.sort("timestamp")


def build_continuous_contract(
    df: pl.DataFrame,
    symbol: str,
    roll_method: RollMethod = RollMethod.VOLUME,
    roll_offset_days: int = 7,
    contracts: list[dict[str, Any]] | None = None,
) -> pl.DataFrame:
    """
    Stitch individual contracts into continuous series.
    
    Args:
        df: DataFrame with contract column
        symbol: Root symbol
        roll_method: How to determine roll dates
        roll_offset_days: Days before expiry to start roll
        contracts: List of contract specs with expiration dates
    
    Returns:
        Continuous contract DataFrame with adjusted prices
    """
    if df.is_empty() or "contract" not in df.columns:
        return df

    # Get contract specs from config if not provided
    if contracts is None:
        symbols_config = load_symbols_config()
        sym_config = symbols_config.get("symbols", {}).get(symbol, {})
        exp_months = sym_config.get("expiration_months", [3, 6, 9, 12])
        # Build contract list from data
        contracts = []
        for contract in df["contract"].unique().to_list():
            contracts.append({"contract": contract})
    
    # For now, use simple volume-based roll
    # In production, this would use actual expiration dates
    contracts_df = df.group_by("contract").agg([
        pl.col("timestamp").min().alias("first_date"),
        pl.col("timestamp").max().alias("last_date"),
        pl.col("volume").sum().alias("total_volume"),
        pl.col("open_interest").last().alias("last_oi") if "open_interest" in df.columns else pl.lit(0).alias("last_oi"),
    ]).sort("first_date")

    # Determine roll points
    roll_dates = []
    for i in range(len(contracts_df) - 1):
        curr = contracts_df.row(i, named=True)
        nxt = contracts_df.row(i + 1, named=True)
        
        if roll_method == RollMethod.VOLUME:
            # Find first date where next contract volume exceeds current
            cross_df = df.filter(
                (pl.col("contract") == curr["contract"]) | (pl.col("contract") == nxt["contract"])
            ).group_by(["timestamp", "contract"]).agg(pl.col("volume").sum())
            
            # Pivot to compare
            pivot = cross_df.pivot(values="volume", index="timestamp", on="contract")
            if curr["contract"] in pivot.columns and nxt["contract"] in pivot.columns:
                cross = pivot.filter(pl.col(nxt["contract"]) > pl.col(curr["contract"]))
                if not cross.is_empty():
                    roll_dates.append((curr["contract"], nxt["contract"], cross["timestamp"].min()))
        
        elif roll_method == RollMethod.DATE:
            # Roll offset_days before expiration (would need actual expiry dates)
            # Approximate: roll at 75% of contract life
            life = curr["last_date"] - curr["first_date"]
            roll_date = curr["last_date"] - timedelta(days=roll_offset_days)
            roll_dates.append((curr["contract"], nxt["contract"], roll_date))

    # Fallback: if no rolls detected, use midpoint between contracts
    if not roll_dates and len(contracts_df) > 1:
        for i in range(len(contracts_df) - 1):
            curr = contracts_df.row(i, named=True)
            nxt = contracts_df.row(i + 1, named=True)
            # Midpoint between last date of current and first date of next
            midpoint = curr["last_date"] + (nxt["first_date"] - curr["last_date"]) / 2
            roll_dates.append((curr["contract"], nxt["contract"], midpoint))
        logger.info(f"Using fallback midpoint roll for {symbol}: {len(roll_dates)} rolls")

    # Build continuous series with price adjustment
    if not roll_dates:
        logger.warning(f"No roll dates determined for {symbol}, returning original")
        return df

    # Apply roll adjustments (price difference at roll)
    continuous_parts = []
    prev_adjustment = 0.0
    
    # Get all metadata columns to preserve
    price_cols = ["open", "high", "low", "close"]
    metadata_cols = [c for c in df.columns if c not in price_cols + ["contract", "original_contract", "continuous_symbol"]]
    
    for i, (from_contract, to_contract, roll_ts) in enumerate(roll_dates):
        # Get data for this contract up to roll (preserve ALL columns)
        contract_data = df.filter(
            (pl.col("contract") == from_contract) & 
            (pl.col("timestamp") < roll_ts)
        )
        
        # Calculate price adjustment at roll
        last_bar = df.filter(
            (pl.col("contract") == from_contract) & 
            (pl.col("timestamp") < roll_ts)
        ).sort("timestamp").tail(1)
        
        first_bar_next = df.filter(
            (pl.col("contract") == to_contract) & 
            (pl.col("timestamp") >= roll_ts)
        ).sort("timestamp").head(1)
        
        if not last_bar.is_empty() and not first_bar_next.is_empty():
            price_diff = float(first_bar_next["close"][0]) - float(last_bar["close"][0])
            prev_adjustment += price_diff
        
        # Apply cumulative adjustment while preserving all columns
        contract_data = contract_data.with_columns(
            (pl.col("open") + prev_adjustment).alias("open"),
            (pl.col("high") + prev_adjustment).alias("high"),
            (pl.col("low") + prev_adjustment).alias("low"),
            (pl.col("close") + prev_adjustment).alias("close"),
            pl.lit(f"{symbol}1!").alias("continuous_symbol"),
            pl.lit(from_contract).alias("original_contract"),
        )
        continuous_parts.append(contract_data)

    # Add final contract (no roll after)
    last_contract = roll_dates[-1][1]
    final_data = df.filter(pl.col("contract") == last_contract).with_columns(
        (pl.col("open") + prev_adjustment).alias("open"),
        (pl.col("high") + prev_adjustment).alias("high"),
        (pl.col("low") + prev_adjustment).alias("low"),
        (pl.col("close") + prev_adjustment).alias("close"),
        pl.lit(f"{symbol}1!").alias("continuous_symbol"),
        pl.lit(last_contract).alias("original_contract"),
    )
    continuous_parts.append(final_data)

    if continuous_parts:
        result = pl.concat(continuous_parts, how="vertical").sort("timestamp")
        logger.info(f"Built continuous contract for {symbol}: {len(roll_dates)} rolls, adjustment={prev_adjustment:.2f}")
        return result

    return df


def align_multi_frequency(
    dfs: dict[DataFrequency, pl.DataFrame],
    base_freq: DataFrequency = DataFrequency.MIN_15,
    forward_fill: bool = True,
) -> pl.DataFrame:
    """
    Align multiple frequency DataFrames to base frequency.
    
    Args:
        dfs: Dict of frequency -> DataFrame
        base_freq: Target frequency for alignment
        forward_fill: Forward fill higher-frequency data
    
    Returns:
        Aligned DataFrame with multi-frequency columns
    """
    if base_freq not in dfs:
        raise ValueError(f"Base frequency {base_freq} not in provided data")

    base_df = dfs[base_freq].clone()
    
    for freq, df in dfs.items():
        if freq == base_freq:
            continue
            
        if df.is_empty():
            continue
            
        # Resample to base frequency
        resampled = resample_bars(df, base_freq, method=AlignmentMethod.LAST)
        
        # Rename columns to avoid collision (except timestamp)
        rename_map = {}
        for col in resampled.columns:
            if col not in ["timestamp", "symbol", "contract"]:
                rename_map[col] = f"{col}_{freq.value}"
        
        resampled = resampled.rename(rename_map)
        
        # Join on timestamp (asof join for forward fill)
        if forward_fill:
            base_df = base_df.join_asof(resampled, on="timestamp", strategy="backward")
        else:
            base_df = base_df.join(resampled, on="timestamp", how="left")

    return base_df


def convert_timezone(
    df: pl.DataFrame,
    from_tz: str = "UTC",
    to_tz: str = "America/Chicago",
    timestamp_col: str = "timestamp",
) -> pl.DataFrame:
    """Convert timestamp column timezone."""
    if df.is_empty():
        return df
    
    return df.with_columns(
        pl.col(timestamp_col)
        .dt.replace_time_zone(from_tz)
        .dt.convert_time_zone(to_tz)
        .alias(timestamp_col)
    )


def filter_trading_hours(
    df: pl.DataFrame,
    session_start: str = "08:30",
    session_end: str = "15:00",
    timezone: str = "America/Chicago",
    timestamp_col: str = "timestamp",
) -> pl.DataFrame:
    """Filter bars to regular trading hours only."""
    if df.is_empty():
        return df

    sh, sm = map(int, session_start.split(":"))
    eh, em = map(int, session_end.split(":"))

    return df.filter(
        pl.col(timestamp_col).dt.convert_time_zone(timezone).dt.hour() >= sh
    ).filter(
        pl.col(timestamp_col).dt.convert_time_zone(timezone).dt.hour() < eh
    ).filter(
        ~((pl.col(timestamp_col).dt.convert_time_zone(timezone).dt.hour() == sh) & 
          (pl.col(timestamp_col).dt.convert_time_zone(timezone).dt.minute() < sm))
    ).filter(
        ~((pl.col(timestamp_col).dt.convert_time_zone(timezone).dt.hour() == eh) & 
          (pl.col(timestamp_col).dt.convert_time_zone(timezone).dt.minute() >= em))
    )


def get_session_bars(
    df: pl.DataFrame,
    session: str = "rth",  # rth, globex, all
    timezone: str = "America/Chicago",
) -> pl.DataFrame:
    """Extract bars for specific trading session."""
    sessions = {
        "rth": ("08:30", "15:00"),
        "globex": ("17:00", "16:00"),  # Next day
        "eth": ("17:00", "08:30"),      # Extended hours
    }
    
    if session == "all":
        return df
    
    if session not in sessions:
        raise ValueError(f"Unknown session: {session}")
    
    start, end = sessions[session]
    return filter_trading_hours(df, start, end, timezone)