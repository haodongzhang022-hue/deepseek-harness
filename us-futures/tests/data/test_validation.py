"""
Tests for Data Integrity Validator
"""

import pytest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import polars as pl

from us_futures.data.schema import Bar, DataFrequency, Exchange, Sector
from us_futures.data.validation import DataIntegrityValidator, ValidationRule, ValidationSeverity, validate_bars


def _round_to_tick(price: float, tick_size: float = 0.25) -> Decimal:
    """Round price to nearest tick."""
    return Decimal(str(round(price / tick_size) * tick_size))


@pytest.fixture
def valid_bars():
    """Create valid 1min bars for testing with tick-aligned prices."""
    bars = []
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)  # Monday RTH start
    base_price = Decimal("4500.00")  # Tick-aligned
    
    for i in range(100):
        ts = base_time + timedelta(minutes=i)
        # Use tick-aligned price changes
        change = _round_to_tick(float(base_price) + (i * 0.1) - 5.0, 0.25) - base_price
        price = base_price + change
        
        # Ensure tick alignment
        price = _round_to_tick(float(price))
        high = _round_to_tick(float(price) + 0.25)
        low = _round_to_tick(float(price) - 0.25)
        close = _round_to_tick(float(price) + 0.10)
        
        bars.append(Bar(
            symbol="ES",
            contract="ESM24",
            timestamp=ts,
            frequency=DataFrequency.MIN_1,
            open=price,
            high=high,
            low=low,
            close=close,
            volume=1000 + i * 10,
            open_interest=500000,
            vwap=price,
            trade_count=50,
            bid=_round_to_tick(float(price) - 0.125),
            ask=_round_to_tick(float(price) + 0.125),
            bid_size=100,
            ask_size=100,
            source="test",
            exchange=Exchange.CME,
            sector=Sector.EQUITY,
            tick_size=Decimal("0.25"),
            tick_value=Decimal("12.50"),
            multiplier=50,
        ))
        base_price = price
    
    return bars


@pytest.fixture
def bars_with_gap(valid_bars):
    """Create bars with a gap."""
    return valid_bars[:30] + valid_bars[40:]


@pytest.fixture
def bars_with_price_jump(valid_bars):
    """Create bars with price jump using DataFrame for testing."""
    df = pl.DataFrame([bar.to_polars_dict() for bar in valid_bars])
    # Modify bar 50 to have 10% jump
    idx = 50
    jump_price = float(df["close"][idx]) * 1.10
    df = df.with_columns(
        pl.when(pl.int_range(pl.len()) == idx)
        .then(_round_to_tick(jump_price))
        .otherwise(pl.col("open")).alias("open"),
        pl.when(pl.int_range(pl.len()) == idx)
        .then(_round_to_tick(jump_price + 0.25))
        .otherwise(pl.col("high")).alias("high"),
        pl.when(pl.int_range(pl.len()) == idx)
        .then(_round_to_tick(jump_price - 0.25))
        .otherwise(pl.col("low")).alias("low"),
        pl.when(pl.int_range(pl.len()) == idx)
        .then(_round_to_tick(jump_price))
        .otherwise(pl.col("close")).alias("close"),
    )
    return df


@pytest.fixture
def bars_with_duplicate_ts(valid_bars):
    """Create bars with duplicate timestamp using DataFrame."""
    df = pl.DataFrame([bar.to_polars_dict() for bar in valid_bars])
    # Duplicate row 50
    dup_row = df.row(50, named=True)
    df = pl.concat([df[:51], pl.DataFrame([dup_row]), df[51:]], how="vertical")
    return df


@pytest.fixture
def bars_out_of_order():
    """Create bars with explicitly out-of-order timestamps."""
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
    data = []
    for i in range(10):
        ts = base_time + timedelta(minutes=i)
        data.append({
            "timestamp": ts,
            "open": 4500.00, "high": 4500.25, "low": 4499.75, "close": 4500.10,
            "volume": 1000, "symbol": "ES", "contract": "ESM24", "frequency": "1min",
            "open_interest": None, "vwap": None, "trade_count": None,
            "bid": None, "ask": None, "bid_size": None, "ask_size": None,
            "source": "test", "received_at": datetime.now(timezone.utc),
            "is_final": True, "exchange": "CME", "sector": "equity",
            "tick_size": 0.25, "tick_value": 12.5, "multiplier": 50,
        })
    # Swap timestamps at index 5 and 6 (making 6 come before 5)
    data[5]["timestamp"], data[6]["timestamp"] = data[6]["timestamp"], data[5]["timestamp"]
    return pl.DataFrame(data)


@pytest.fixture
def bars_future_timestamp(valid_bars):
    """Create bars with future timestamp using DataFrame."""
    df = pl.DataFrame([bar.to_polars_dict() for bar in valid_bars])
    future = datetime.now(timezone.utc) + timedelta(days=1)
    df = df.with_columns(
        pl.when(pl.int_range(pl.len()) == 50)
        .then(pl.lit(future))
        .otherwise(pl.col("timestamp")).alias("timestamp")
    )
    return df


@pytest.fixture
def bars_zero_volume_rth():
    """Create zero volume bar during RTH (14:00 CT = 20:00 UTC)."""
    base_time = datetime(2024, 1, 15, 20, 0, tzinfo=timezone.utc)  # 14:00 CT = RTH
    return pl.DataFrame([{
        "timestamp": base_time,
        "open": 4500.00, "high": 4500.25, "low": 4499.75, "close": 4500.10,
        "volume": 0,
        "symbol": "ES",
        "contract": "ESM24",
        "frequency": "1min",
        "open_interest": None,
        "vwap": None,
        "trade_count": None,
        "bid": None, "ask": None, "bid_size": None, "ask_size": None,
        "source": "test",
        "received_at": datetime.now(timezone.utc),
        "is_final": True,
        "exchange": "CME",
        "sector": "equity",
        "tick_size": 0.25,
        "tick_value": 12.5,
        "multiplier": 50,
    }])


@pytest.fixture
def bars_zero_volume_eth():
    """Create zero volume bar outside RTH (22:00 CT = 04:00 UTC next day)."""
    base_time = datetime(2024, 1, 16, 4, 0, tzinfo=timezone.utc)  # 22:00 CT previous day = ETH
    return pl.DataFrame([{
        "timestamp": base_time,
        "open": 4500.00, "high": 4500.25, "low": 4499.75, "close": 4500.10,
        "volume": 0,
        "symbol": "ES",
        "contract": "ESM24",
        "frequency": "1min",
        "open_interest": None,
        "vwap": None,
        "trade_count": None,
        "bid": None, "ask": None, "bid_size": None, "ask_size": None,
        "source": "test",
        "received_at": datetime.now(timezone.utc),
        "is_final": True,
        "exchange": "CME",
        "sector": "equity",
        "tick_size": 0.25,
        "tick_value": 12.5,
        "multiplier": 50,
    }])


class TestDataIntegrityValidator:
    """Test suite for DataIntegrityValidator."""

    def test_valid_bars_pass(self, valid_bars):
        """Valid bars should pass validation."""
        validator = DataIntegrityValidator()
        report = validator.validate(valid_bars, "ES", DataFrequency.MIN_1)
        
        assert report.passed is True
        assert report.total_bars == 100
        assert report.symbol == "ES"
        assert report.frequency == DataFrequency.MIN_1

    def test_gap_detection(self, bars_with_gap):
        """Should detect gaps in data."""
        validator = DataIntegrityValidator(max_gap_minutes=5)
        report = validator.validate(bars_with_gap, "ES", DataFrequency.MIN_1)
        
        gap_issues = [d for d in report.details if d["rule"] == "continuity"]
        assert len(gap_issues) > 0
        assert report.gap_count > 0

    def test_price_jump_detection(self, bars_with_price_jump):
        """Should detect price jumps."""
        validator = DataIntegrityValidator(max_price_jump_pct=0.05)
        report = validator.validate(bars_with_price_jump, "ES", DataFrequency.MIN_1)
        
        jump_issues = [d for d in report.details if d["rule"] == "price_jump"]
        assert len(jump_issues) > 0
        assert report.price_jumps > 0

    def test_duplicate_timestamp_detection(self, bars_with_duplicate_ts):
        """Should detect duplicate timestamps."""
        validator = DataIntegrityValidator()
        report = validator.validate(bars_with_duplicate_ts, "ES", DataFrequency.MIN_1)
        
        dup_issues = [d for d in report.details if d["rule"] == "duplicate_timestamp"]
        assert len(dup_issues) > 0
        assert report.duplicate_timestamps > 0
        assert report.passed is False

    def test_out_of_order_detection(self, bars_out_of_order):
        """Should detect out-of-order timestamps."""
        validator = DataIntegrityValidator()
        report = validator.validate(bars_out_of_order, "ES", DataFrequency.MIN_1)
        
        ooo_issues = [d for d in report.details if d["rule"] == "out_of_order"]
        assert len(ooo_issues) > 0
        assert report.out_of_order > 0
        assert report.passed is False

    def test_future_timestamp_detection(self, bars_future_timestamp):
        """Should detect future timestamps (lookahead)."""
        validator = DataIntegrityValidator()
        report = validator.validate(bars_future_timestamp, "ES", DataFrequency.MIN_1)
        
        lookahead_issues = [d for d in report.details if d["rule"] == "no_lookahead"]
        assert len(lookahead_issues) > 0
        assert report.passed is False

    def test_tick_alignment_validation(self, valid_bars):
        """Valid tick-aligned bars should not trigger tick alignment warnings."""
        validator = DataIntegrityValidator(check_tick_alignment=True)
        report = validator.validate(valid_bars, "ES", DataFrequency.MIN_1)
        
        tick_issues = [d for d in report.details if d["rule"] == "tick_alignment"]
        # Valid bars should have no tick alignment issues
        assert len(tick_issues) == 0

    def test_zero_volume_detection_rth(self, bars_zero_volume_rth):
        """Should flag zero volume bar during RTH."""
        validator = DataIntegrityValidator(zero_volume_allowed=False)
        report = validator.validate(bars_zero_volume_rth, "ES", DataFrequency.MIN_1)
        
        zv_issues = [d for d in report.details if d["rule"] == "zero_volume"]
        assert len(zv_issues) > 0

    def test_zero_volume_allowed_outside_rth(self, bars_zero_volume_eth):
        """Should not flag zero volume bar outside RTH."""
        validator = DataIntegrityValidator(zero_volume_allowed=False)
        report = validator.validate(bars_zero_volume_eth, "ES", DataFrequency.MIN_1)
        
        zv_issues = [d for d in report.details if d["rule"] == "zero_volume"]
        assert len(zv_issues) == 0  # Outside RTH, zero volume OK

    def test_completeness_calculation(self, valid_bars):
        """Test completeness percentage calculation."""
        validator = DataIntegrityValidator()
        report = validator.validate(valid_bars[:50], "ES", DataFrequency.MIN_1)
        
        assert 0 <= report.completeness_pct <= 100

    def test_polars_dataframe_input(self, valid_bars):
        """Test validation with Polars DataFrame input."""
        df = pl.DataFrame([bar.to_polars_dict() for bar in valid_bars])
        
        validator = DataIntegrityValidator()
        report = validator.validate(df, "ES", DataFrequency.MIN_1)
        
        assert report.passed is True
        assert report.total_bars == 100

    def test_empty_data(self):
        """Test validation with empty data."""
        validator = DataIntegrityValidator()
        report = validator.validate([], "ES", DataFrequency.MIN_1)
        
        assert report.passed is False
        assert report.total_bars == 0
        assert any(d["rule"] == "empty_data" for d in report.details)

    def test_convenience_function(self, valid_bars):
        """Test validate_bars convenience function."""
        report = validate_bars(valid_bars, "ES", DataFrequency.MIN_1)
        assert report.passed is True

    def test_severity_levels(self, valid_bars):
        """Test that issues have correct severity levels."""
        validator = DataIntegrityValidator()
        report = validator.validate(valid_bars, "ES", DataFrequency.MIN_1)
        
        for detail in report.details:
            assert detail["severity"] in ["info", "warning", "error", "critical"]


class TestOHLCViolationViaDataFrame:
    """Test OHLC violation detection via DataFrame (bypasses model validation)."""

    def test_ohlc_violation_detection(self):
        """Should detect OHLC violations in DataFrame."""
        base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
        df = pl.DataFrame([{
            "timestamp": base_time + timedelta(minutes=i),
            "open": 4500.00, "high": 4500.25, "low": 4499.75, "close": 4500.10,
            "volume": 1000, "symbol": "ES", "contract": "ESM24", "frequency": "1min",
            "open_interest": None, "vwap": None, "trade_count": None,
            "bid": None, "ask": None, "bid_size": None, "ask_size": None,
            "source": "test", "received_at": datetime.now(timezone.utc),
            "is_final": True, "exchange": "CME", "sector": "equity",
            "tick_size": 0.25, "tick_value": 12.5, "multiplier": 50,
        } for i in range(10)])
        
        # Create OHLC violation: high < close
        df = df.with_columns(
            pl.when(pl.int_range(pl.len()) == 5)
            .then(pl.lit(4499.50))  # high < close (4500.10)
            .otherwise(pl.col("high")).alias("high")
        )
        
        validator = DataIntegrityValidator(check_ohlc=True)
        report = validator.validate(df, "ES", DataFrequency.MIN_1)
        
        ohlc_issues = [d for d in report.details if d["rule"] == "ohlc_consistency"]
        assert len(ohlc_issues) > 0
        assert report.ohlc_violations > 0
        assert report.passed is False


class TestValidationReport:
    """Test DataQualityReport properties."""

    def test_completeness_pct(self, valid_bars):
        validator = DataIntegrityValidator()
        report = validator.validate(valid_bars[:80], "ES", DataFrequency.MIN_1)
        
        assert 0 <= report.completeness_pct <= 100

    def test_report_fields(self, valid_bars):
        validator = DataIntegrityValidator()
        report = validator.validate(valid_bars, "ES", DataFrequency.MIN_1)
        
        assert report.symbol == "ES"
        assert report.frequency == DataFrequency.MIN_1
        assert isinstance(report.start_time, datetime)
        assert isinstance(report.end_time, datetime)
        assert isinstance(report.validated_at, datetime)
        assert isinstance(report.details, list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])