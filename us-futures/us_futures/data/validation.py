"""
Data Integrity Validator - Core validation engine for market data.
Enforces three iron laws: no lookahead, continuity, anomaly detection.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import Any

import polars as pl
from loguru import logger

from us_futures.config import get_settings
from us_futures.data.schema import Bar, DataFrequency, DataQualityReport


class ValidationSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class ValidationRule(str, Enum):
    NO_LOOKAHEAD = "no_lookahead"
    CONTINUITY = "continuity"
    OHLC_CONSISTENCY = "ohlc_consistency"
    TICK_ALIGNMENT = "tick_alignment"
    PRICE_JUMP = "price_jump"
    VOLUME_SPIKE = "volume_spike"
    ZERO_VOLUME = "zero_volume"
    DUPLICATE_TIMESTAMP = "duplicate_timestamp"
    OUT_OF_ORDER = "out_of_order"
    MISSING_SESSION = "missing_session"


@dataclass
class ValidationIssue:
    rule: ValidationRule
    severity: ValidationSeverity
    message: str
    timestamp: datetime | None = None
    bar_index: int | None = None
    expected: Any = None
    actual: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)


class DataIntegrityValidator:
    """
    Validates market data integrity with configurable thresholds.
    
    Three Iron Laws:
    1. No Lookahead - Data timestamps must not be in the future relative to receipt
    2. Continuity - No unexplained gaps in trading hours
    3. Anomaly Detection - Price jumps, volume spikes, OHLC violations
    """

    def __init__(
        self,
        max_gap_minutes: int | None = None,
        max_price_jump_pct: float | None = None,
        max_volume_spike_z: float | None = None,
        min_daily_bars: int | None = None,
        check_ohlc: bool = True,
        check_tick_alignment: bool = True,
        zero_volume_allowed: bool = False,
        trading_sessions: dict | None = None,
    ):
        settings = get_settings()
        val_config = settings.get("validation", {})

        self.max_gap_minutes = max_gap_minutes or val_config.get("max_gap_minutes", 30)
        self.max_price_jump_pct = max_price_jump_pct or val_config.get("max_price_jump_pct", 0.05)
        self.max_volume_spike_z = max_volume_spike_z or val_config.get("max_volume_spike_z", 10.0)
        self.min_daily_bars = min_daily_bars or val_config.get("min_daily_bars", 350)
        self.check_ohlc = check_ohlc if check_ohlc is not None else val_config.get("ohlc_consistency", True)
        self.check_tick_alignment = check_tick_alignment if check_tick_alignment is not None else val_config.get("tick_consistency", True)
        self.zero_volume_allowed = zero_volume_allowed if zero_volume_allowed is not None else val_config.get("zero_volume_allowed", False)
        self.trading_sessions = trading_sessions or settings.get("trading_sessions", {})

        self._issues: list[ValidationIssue] = []

    def validate(self, bars: list[Bar] | pl.DataFrame, symbol: str, frequency: DataFrequency) -> DataQualityReport:
        """Run full validation suite on bars."""
        self._issues.clear()

        # Convert to Polars for efficient processing
        if isinstance(bars, list):
            df = pl.DataFrame([bar.to_polars_dict() for bar in bars])
        else:
            df = bars

        if df.is_empty():
            return self._empty_report(symbol, frequency)

        # Check out-of-order BEFORE sorting (uses original row order)
        self._check_order(df)

        # Ensure sorted by timestamp for all other checks
        df = df.sort("timestamp")

        # Run all validation rules
        self._check_no_lookahead(df)
        self._check_continuity(df, symbol, frequency)
        self._check_ohlc_consistency(df)
        self._check_tick_alignment(df)
        self._check_price_jumps(df)
        self._check_volume_spikes(df)
        self._check_zero_volume(df)
        self._check_duplicates(df)

        # Build report
        return self._build_report(df, symbol, frequency)

    def _check_no_lookahead(self, df: pl.DataFrame) -> None:
        """Ensure no bar has timestamp > received_at (lookahead bias)."""
        now = datetime.now(timezone.utc)
        lookahead = df.filter(pl.col("timestamp") > pl.col("received_at"))
        for row in lookahead.iter_rows(named=True):
            self._issues.append(ValidationIssue(
                rule=ValidationRule.NO_LOOKAHEAD,
                severity=ValidationSeverity.CRITICAL,
                message=f"Bar timestamp {row['timestamp']} is after received_at {row['received_at']} (lookahead bias)",
                timestamp=row["timestamp"],
                bar_index=row.get("__index"),
                metadata={"received_at": row["received_at"]},
            ))

        # Also check against wall clock
        future_bars = df.filter(pl.col("timestamp") > now)
        for row in future_bars.iter_rows(named=True):
            self._issues.append(ValidationIssue(
                rule=ValidationRule.NO_LOOKAHEAD,
                severity=ValidationSeverity.ERROR,
                message=f"Bar timestamp {row['timestamp']} is in the future (wall clock)",
                timestamp=row["timestamp"],
                bar_index=row.get("__index"),
            ))

    def _check_continuity(self, df: pl.DataFrame, symbol: str, frequency: DataFrequency) -> None:
        """Check for gaps in trading hours."""
        if df.is_empty():
            return

        freq_minutes = self._frequency_to_minutes(frequency)
        timestamps = df["timestamp"].to_list()

        # Get trading session config
        session = self.trading_sessions.get("cme_globex", {})
        break_start_str = session.get("break_start", "15:00")
        break_end_str = session.get("break_end", "17:00")
        tz_name = session.get("timezone", "America/Chicago")

        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)

        gaps = []
        max_gap = timedelta(0)

        for i in range(1, len(timestamps)):
            prev = timestamps[i - 1]
            curr = timestamps[i]
            delta = curr - prev

            expected_delta = timedelta(minutes=freq_minutes)

            # Allow for session break (15:00-17:00 CT)
            if self._is_in_session_break(prev, curr, break_start_str, break_end_str, tz):
                expected_delta = timedelta(minutes=freq_minutes) + timedelta(hours=2)

            if delta > expected_delta * 1.5:  # 50% tolerance
                gap_minutes = int(delta.total_seconds() / 60)
                gaps.append((i, prev, curr, gap_minutes))
                if delta > max_gap:
                    max_gap = delta

        for idx, prev, curr, gap_min in gaps:
            severity = ValidationSeverity.WARNING if gap_min <= self.max_gap_minutes else ValidationSeverity.ERROR
            self._issues.append(ValidationIssue(
                rule=ValidationRule.CONTINUITY,
                severity=severity,
                message=f"Gap of {gap_min} minutes between {prev} and {curr}",
                timestamp=curr,
                bar_index=idx,
                expected=f"{freq_minutes} min",
                actual=f"{gap_min} min",
            ))

    def _is_in_session_break(self, prev: datetime, curr: datetime, break_start: str, break_end: str, tz: ZoneInfo) -> bool:
        """Check if gap spans the daily maintenance window."""
        prev_local = prev.astimezone(tz)
        curr_local = curr.astimezone(tz)

        # Parse break times
        bh, bm = map(int, break_start.split(":"))
        eh, em = map(int, break_end.split(":"))

        break_start_dt = prev_local.replace(hour=bh, minute=bm, second=0, microsecond=0)
        break_end_dt = prev_local.replace(hour=eh, minute=em, second=0, microsecond=0)

        # If break crosses midnight, adjust
        if break_end_dt <= break_start_dt:
            break_end_dt += timedelta(days=1)

        # Check if gap covers the break period
        return prev_local < break_start_dt and curr_local > break_end_dt

    def _check_ohlc_consistency(self, df: pl.DataFrame) -> None:
        """Validate OHLC relationships."""
        if not self.check_ohlc:
            return

        violations = df.filter(
            (pl.col("high") < pl.max_horizontal("open", "close")) |
            (pl.col("low") > pl.min_horizontal("open", "close")) |
            (pl.col("high") < pl.col("low"))
        )

        for row in violations.iter_rows(named=True):
            self._issues.append(ValidationIssue(
                rule=ValidationRule.OHLC_CONSISTENCY,
                severity=ValidationSeverity.ERROR,
                message=f"OHLC violation: O={row['open']} H={row['high']} L={row['low']} C={row['close']}",
                timestamp=row["timestamp"],
                bar_index=row.get("__index"),
            ))

    def _check_tick_alignment(self, df: pl.DataFrame) -> None:
        """Check prices align with tick size."""
        if not self.check_tick_alignment:
            return

        price_cols = ["open", "high", "low", "close", "bid", "ask", "vwap"]
        for col in price_cols:
            if col not in df.columns:
                continue

            # Check alignment: (price / tick_size) should be integer
            misaligned = df.filter(
                pl.col(col).is_not_null() &
                ((pl.col(col) * 10000) % (pl.col("tick_size") * 10000) != 0)
            )

            for row in misaligned.iter_rows(named=True):
                self._issues.append(ValidationIssue(
                    rule=ValidationRule.TICK_ALIGNMENT,
                    severity=ValidationSeverity.WARNING,
                    message=f"{col}={row[col]} not aligned with tick_size={row['tick_size']}",
                    timestamp=row["timestamp"],
                    bar_index=row.get("__index"),
                    expected=f"multiple of {row['tick_size']}",
                    actual=str(row[col]),
                ))

    def _check_price_jumps(self, df: pl.DataFrame) -> None:
        """Detect anomalous price jumps between consecutive bars."""
        if df.height < 2:
            return

        # Calculate bar-to-bar returns
        df_with_ret = df.with_columns([
            (pl.col("close") / pl.col("close").shift(1) - 1).alias("ret"),
            (pl.col("high") / pl.col("low") - 1).alias("range_pct"),
        ])

        jumps = df_with_ret.filter(
            (pl.col("ret").abs() > self.max_price_jump_pct) |
            (pl.col("range_pct") > self.max_price_jump_pct * 2)
        )

        for row in jumps.iter_rows(named=True):
            self._issues.append(ValidationIssue(
                rule=ValidationRule.PRICE_JUMP,
                severity=ValidationSeverity.WARNING,
                message=f"Price jump: ret={row['ret']:.4%}, range={row['range_pct']:.4%}",
                timestamp=row["timestamp"],
                bar_index=row.get("__index"),
                expected=f"<{self.max_price_jump_pct:.1%}",
                actual=f"ret={row['ret']:.2%}",
            ))

    def _check_volume_spikes(self, df: pl.DataFrame) -> None:
        """Detect volume anomalies using z-score."""
        if df.height < 20:
            return

        vol_mean = df["volume"].mean()
        vol_std = df["volume"].std()

        if vol_std == 0:
            return

        df_with_z = df.with_columns([
            ((pl.col("volume") - vol_mean) / vol_std).alias("vol_zscore")
        ])

        spikes = df_with_z.filter(pl.col("vol_zscore").abs() > self.max_volume_spike_z)

        for row in spikes.iter_rows(named=True):
            self._issues.append(ValidationIssue(
                rule=ValidationRule.VOLUME_SPIKE,
                severity=ValidationSeverity.WARNING,
                message=f"Volume spike: z-score={row['vol_zscore']:.1f}",
                timestamp=row["timestamp"],
                bar_index=row.get("__index"),
                expected=f"z<{self.max_volume_spike_z}",
                actual=f"z={row['vol_zscore']:.1f}",
            ))

    def _check_zero_volume(self, df: pl.DataFrame) -> None:
        """Flag zero-volume bars during regular trading hours."""
        if self.zero_volume_allowed:
            return

        # Only check RTH (08:30-15:00 CT)
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("America/Chicago")

        zero_vol = df.filter(pl.col("volume") == 0)
        for row in zero_vol.iter_rows(named=True):
            local = row["timestamp"].astimezone(tz)
            if 8 <= local.hour < 15 or (local.hour == 8 and local.minute >= 30):
                self._issues.append(ValidationIssue(
                    rule=ValidationRule.ZERO_VOLUME,
                    severity=ValidationSeverity.WARNING,
                    message="Zero volume bar during RTH",
                    timestamp=row["timestamp"],
                    bar_index=row.get("__index"),
                ))

    def _check_duplicates(self, df: pl.DataFrame) -> None:
        """Check for duplicate timestamps."""
        dup_mask = df["timestamp"].is_duplicated()
        duplicates = df.filter(dup_mask)

        for row in duplicates.iter_rows(named=True):
            self._issues.append(ValidationIssue(
                rule=ValidationRule.DUPLICATE_TIMESTAMP,
                severity=ValidationSeverity.ERROR,
                message="Duplicate timestamp found",
                timestamp=row["timestamp"],
                bar_index=row.get("__index"),
            ))

    def _check_order(self, df: pl.DataFrame) -> None:
        """Check for out-of-order timestamps."""
        timestamps = df["timestamp"].to_list()
        for i in range(1, len(timestamps)):
            if timestamps[i] < timestamps[i - 1]:
                self._issues.append(ValidationIssue(
                    rule=ValidationRule.OUT_OF_ORDER,
                    severity=ValidationSeverity.ERROR,
                    message=f"Timestamp out of order: {timestamps[i]} < {timestamps[i-1]}",
                    timestamp=timestamps[i],
                    bar_index=i,
                ))

    def _frequency_to_minutes(self, freq: DataFrequency) -> int:
        mapping = {
            DataFrequency.TICK: 0,
            DataFrequency.SEC_1: 1/60,
            DataFrequency.MIN_1: 1,
            DataFrequency.MIN_5: 5,
            DataFrequency.MIN_15: 15,
            DataFrequency.MIN_30: 30,
            DataFrequency.HOUR_1: 60,
            DataFrequency.HOUR_4: 240,
            DataFrequency.DAY_1: 1440,
            DataFrequency.WEEK_1: 10080,
        }
        return int(mapping.get(freq, 1))

    def _build_report(self, df: pl.DataFrame, symbol: str, frequency: DataFrequency) -> DataQualityReport:
        """Build quality report from validation results."""
        errors = [i for i in self._issues if i.severity in (ValidationSeverity.ERROR, ValidationSeverity.CRITICAL)]
        warnings = [i for i in self._issues if i.severity == ValidationSeverity.WARNING]

        # Expected bars calculation (rough)
        start = df["timestamp"].min()
        end = df["timestamp"].max()
        freq_min = self._frequency_to_minutes(frequency)
        expected = int((end - start).total_seconds() / 60 / freq_min) + 1 if freq_min > 0 else df.height

        report = DataQualityReport(
            symbol=symbol,
            frequency=frequency,
            start_time=start,
            end_time=end,
            total_bars=df.height,
            expected_bars=expected,
            missing_bars=max(0, expected - df.height),
            gap_count=len([i for i in self._issues if i.rule == ValidationRule.CONTINUITY]),
            max_gap_minutes=int(max((i.actual for i in self._issues if i.rule == ValidationRule.CONTINUITY and isinstance(i.actual, (int, float))), default=0)),
            price_jumps=len([i for i in self._issues if i.rule == ValidationRule.PRICE_JUMP]),
            volume_spikes=len([i for i in self._issues if i.rule == ValidationRule.VOLUME_SPIKE]),
            zero_volume_bars=len([i for i in self._issues if i.rule == ValidationRule.ZERO_VOLUME]),
            ohlc_violations=len([i for i in self._issues if i.rule == ValidationRule.OHLC_CONSISTENCY]),
            tick_misalignments=len([i for i in self._issues if i.rule == ValidationRule.TICK_ALIGNMENT]),
            duplicate_timestamps=len([i for i in self._issues if i.rule == ValidationRule.DUPLICATE_TIMESTAMP]),
            out_of_order=len([i for i in self._issues if i.rule == ValidationRule.OUT_OF_ORDER]),
            passed=len(errors) == 0,
            details=[{
                "rule": i.rule.value,
                "severity": i.severity.value,
                "message": i.message,
                "timestamp": i.timestamp.isoformat() if i.timestamp else None,
                "bar_index": i.bar_index,
                "expected": str(i.expected) if i.expected else None,
                "actual": str(i.actual) if i.actual else None,
                "metadata": i.metadata,
            } for i in self._issues],
        )

        if not report.passed:
            logger.warning(f"Validation FAILED for {symbol} {frequency}: {len(errors)} errors, {len(warnings)} warnings")
        else:
            logger.info(f"Validation PASSED for {symbol} {frequency}: {df.height} bars, completeness={report.completeness_pct:.1f}%")

        return report

    def _empty_report(self, symbol: str, frequency: DataFrequency) -> DataQualityReport:
        return DataQualityReport(
            symbol=symbol,
            frequency=frequency,
            start_time=datetime.now(timezone.utc),
            end_time=datetime.now(timezone.utc),
            total_bars=0,
            expected_bars=0,
            missing_bars=0,
            gap_count=0,
            max_gap_minutes=0,
            price_jumps=0,
            volume_spikes=0,
            zero_volume_bars=0,
            ohlc_violations=0,
            tick_misalignments=0,
            duplicate_timestamps=0,
            out_of_order=0,
            passed=False,
            details=[{"rule": "empty_data", "severity": "critical", "message": "No data to validate"}],
        )

    def get_issues(self) -> list[ValidationIssue]:
        return self._issues.copy()


def validate_bars(bars: list[Bar] | pl.DataFrame, symbol: str, frequency: DataFrequency, **kwargs) -> DataQualityReport:
    """Convenience function for quick validation."""
    validator = DataIntegrityValidator(**kwargs)
    return validator.validate(bars, symbol, frequency)