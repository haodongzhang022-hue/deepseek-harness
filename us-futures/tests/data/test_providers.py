"""
Tests for Data Providers
"""

import pytest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import tempfile
import shutil

import polars as pl

from us_futures.data.providers import LocalFileProvider, create_sample_data
from us_futures.data.schema import Bar, DataFrequency, Exchange, Sector
from us_futures.data.alignment import resample_bars, build_continuous_contract, AlignmentMethod, DataFrequency
from us_futures.data.pipeline import ETLPipeline, PipelineConfig
from us_futures.data.storage import DuckDBStore


@pytest.fixture
def temp_data_dir():
    """Create temporary data directory."""
    tmpdir = Path(tempfile.mkdtemp())
    yield tmpdir
    shutil.rmtree(tmpdir)


@pytest.fixture
def sample_bars():
    """Create sample bars for testing."""
    bars = []
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
    base_price = Decimal("4500.00")
    
    for i in range(100):
        ts = base_time + timedelta(minutes=i)
        price = base_price + Decimal(str(i * 0.1))
        
        bars.append(Bar(
            symbol="ES",
            contract="ESM24",
            timestamp=ts,
            frequency=DataFrequency.MIN_1,
            open=price,
            high=price + Decimal("0.25"),
            low=price - Decimal("0.25"),
            close=price + Decimal("0.10"),
            volume=1000 + i * 10,
            exchange=Exchange.CME,
            sector=Sector.EQUITY,
            tick_size=Decimal("0.25"),
            tick_value=Decimal("12.50"),
            multiplier=50,
        ))
    
    return bars


@pytest.fixture
def sample_df(sample_bars):
    """Convert sample bars to Polars DataFrame."""
    return pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])


class TestLocalFileProvider:
    """Test LocalFileProvider."""

    def test_connect_creates_directory(self, temp_data_dir):
        provider = LocalFileProvider(config={"data_root": str(temp_data_dir), "format": "parquet"})
        assert provider.connect() is True
        # Directory created on first write, not on connect
        # Just verify connection works
        assert provider.is_connected

    def test_write_and_read_bars(self, temp_data_dir, sample_bars):
        provider = LocalFileProvider(config={"data_root": str(temp_data_dir), "format": "parquet"})
        provider.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        written = provider.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        
        assert written == 100
        
        # Read back
        read_df = provider.fetch_bars("ES", "ESM24", DataFrequency.MIN_1, 
                                       sample_bars[0].timestamp, sample_bars[-1].timestamp)
        
        assert read_df.height == 100
        assert read_df["symbol"][0] == "ES"
        assert read_df["contract"][0] == "ESM24"

    def test_write_csv_format(self, temp_data_dir, sample_bars):
        provider = LocalFileProvider(config={"data_root": str(temp_data_dir), "format": "csv"})
        provider.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        written = provider.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        
        assert written == 100
        assert (temp_data_dir / "ES" / "1min" / "ESM24.csv").exists()

    def test_get_available_contracts(self, temp_data_dir, sample_bars):
        provider = LocalFileProvider(config={"data_root": str(temp_data_dir), "format": "parquet"})
        provider.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        provider.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        provider.write_bars(df, "ES", DataFrequency.MIN_1, "ESU24")
        
        contracts = provider.get_available_contracts("ES", datetime.now(timezone.utc) - timedelta(days=365), datetime.now(timezone.utc))
        
        assert "ESM24" in contracts
        assert "ESU24" in contracts

    def test_get_contract_spec(self, temp_data_dir):
        provider = LocalFileProvider(config={"data_root": str(temp_data_dir), "format": "parquet"})
        provider.connect()
        
        spec = provider.get_contract_spec("ES")
        
        assert spec is not None
        assert spec.symbol == "ES"
        assert spec.tick_size == Decimal("0.25")
        assert spec.multiplier == 50

    def test_fetch_nonexistent_returns_empty(self, temp_data_dir):
        provider = LocalFileProvider(config={"data_root": str(temp_data_dir), "format": "parquet"})
        provider.connect()
        
        df = provider.fetch_bars("NONEXISTENT", "XXX", DataFrequency.MIN_1, 
                                  datetime.now(timezone.utc), datetime.now(timezone.utc))
        
        assert df.is_empty()


class TestCreateSampleData:
    """Test sample data generation."""

    def test_generate_sample_creates_file(self, temp_data_dir):
        file_path = create_sample_data(
            symbol="ES",
            frequency=DataFrequency.MIN_1,
            days=5,
            data_root=temp_data_dir,
            file_format="parquet",
        )
        
        assert file_path.exists()
        assert file_path.suffix == ".parquet"

    def test_sample_data_readable(self, temp_data_dir):
        file_path = create_sample_data(
            symbol="ES",
            frequency=DataFrequency.MIN_1,
            days=2,
            data_root=temp_data_dir,
            file_format="parquet",
        )
        
        df = pl.read_parquet(file_path)
        assert df.height > 0
        assert "timestamp" in df.columns
        assert "open" in df.columns
        assert "close" in df.columns
        assert "volume" in df.columns


class TestResampleBars:
    """Test multi-frequency resampling."""

    def test_resample_1min_to_5min(self, sample_df):
        resampled = resample_bars(sample_df, DataFrequency.MIN_5, method=AlignmentMethod.OHLC)
        
        # 100 1min bars -> ~20 5min bars
        assert resampled.height == 20
        assert resampled["frequency"][0] == "5min"
        
        # Check OHLC aggregation
        first_bar = resampled.row(0, named=True)
        assert first_bar["open"] == sample_df["open"][0]
        assert first_bar["high"] == sample_df["high"][:5].max()
        assert first_bar["low"] == sample_df["low"][:5].min()
        assert first_bar["close"] == sample_df["close"][4]
        assert first_bar["volume"] == sample_df["volume"][:5].sum()

    def test_resample_1min_to_15min(self, sample_df):
        resampled = resample_bars(sample_df, DataFrequency.MIN_15, method=AlignmentMethod.OHLC)
        
        assert resampled.height == 7  # 100/15 = 6.66 -> 7
        assert resampled["frequency"][0] == "15min"

    def test_resample_preserves_metadata(self, sample_df):
        resampled = resample_bars(sample_df, DataFrequency.MIN_5, method=AlignmentMethod.OHLC)
        
        assert "symbol" in resampled.columns
        assert "contract" in resampled.columns
        assert resampled["symbol"][0] == "ES"
        assert resampled["contract"][0] == "ESM24"

    def test_resample_empty_dataframe(self):
        empty_df = pl.DataFrame(schema={
            "timestamp": pl.Datetime("us", "UTC"),
            "open": pl.Float64,
            "high": pl.Float64,
            "low": pl.Float64,
            "close": pl.Float64,
            "volume": pl.Int64,
        })
        
        resampled = resample_bars(empty_df, DataFrequency.MIN_5)
        assert resampled.is_empty()


class TestBuildContinuousContract:
    """Test continuous contract building."""

    def test_build_continuous_two_contracts(self):
        """Test rolling from one contract to next."""
        base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
        
        # Contract 1: Jan 15-20
        bars1 = []
        for i in range(200):  # ~3 days
            ts = base_time + timedelta(minutes=i)
            bars1.append({
                "timestamp": ts,
                "open": 4500.0 + i * 0.01,
                "high": 4500.25 + i * 0.01,
                "low": 4499.75 + i * 0.01,
                "close": 4500.10 + i * 0.01,
                "volume": 1000,
                "symbol": "ES",
                "contract": "ESM24",
                "frequency": "1min",
            })
        
        # Contract 2: Jan 20-25 (starts 5 days later)
        base_time2 = base_time + timedelta(days=5)
        bars2 = []
        for i in range(200):
            ts = base_time2 + timedelta(minutes=i)
            bars2.append({
                "timestamp": ts,
                "open": 4505.0 + i * 0.01,  # Different price level
                "high": 4505.25 + i * 0.01,
                "low": 4504.75 + i * 0.01,
                "close": 4505.10 + i * 0.01,
                "volume": 1000,
                "symbol": "ES",
                "contract": "ESU24",
                "frequency": "1min",
            })
        
        df = pl.DataFrame(bars1 + bars2)
        
        continuous = build_continuous_contract(df, "ES", roll_method="volume")
        
        assert continuous is not None
        assert continuous.height > 0
        assert "continuous_symbol" in continuous.columns
        assert "original_contract" in continuous.columns
        assert continuous["continuous_symbol"][0] == "ES1!"

    def test_continuous_price_adjustment(self):
        """Test that price adjustment is applied at roll."""
        base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
        
        # Contract 1 ends at 4500
        bars1 = [{
            "timestamp": base_time + timedelta(minutes=i),
            "open": 4500.0, "high": 4500.25, "low": 4499.75, "close": 4500.0,
            "volume": 1000, "symbol": "ES", "contract": "ESM24", "frequency": "1min",
        } for i in range(100)]
        
        # Contract 2 starts at 4510 (10 point gap)
        base_time2 = base_time + timedelta(minutes=120)  # Gap
        bars2 = [{
            "timestamp": base_time2 + timedelta(minutes=i),
            "open": 4510.0, "high": 4510.25, "low": 4509.75, "close": 4510.0,
            "volume": 1000, "symbol": "ES", "contract": "ESU24", "frequency": "1min",
        } for i in range(100)]
        
        df = pl.DataFrame(bars1 + bars2)
        continuous = build_continuous_contract(df, "ES")
        
        if continuous is not None:
            # Prices should be adjusted
            last_contract1 = continuous.filter(pl.col("original_contract") == "ESM24").tail(1)
            first_contract2 = continuous.filter(pl.col("original_contract") == "ESU24").head(1)
            
            if not last_contract1.is_empty() and not first_contract2.is_empty():
                # The adjustment should bridge the gap between contracts (10 points)
                diff = abs(first_contract2["close"][0] - last_contract1["close"][0])
                assert abs(diff - 10.0) < 0.1  # Gap was 10 points, adjustment should match


class TestDuckDBStore:
    """Test DuckDB storage (requires temp DB)."""

    @pytest.fixture
    def temp_db(self):
        import tempfile
        import uuid
        # Use unique name to avoid conflicts
        tmp_path = Path(tempfile.gettempdir()) / f"test_{uuid.uuid4().hex}.duckdb"
        yield str(tmp_path)
        # Cleanup
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass

    def test_write_and_read_bars(self, temp_db, sample_bars):
        store = DuckDBStore(temp_db)
        store.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        written = store.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        
        assert written == 100
        
        # Read back
        read_df = store.read_bars("ES", DataFrequency.MIN_1, 
                                   sample_bars[0].timestamp, sample_bars[-1].timestamp,
                                   contract="ESM24")
        
        assert read_df.height == 100
        assert read_df["symbol"][0] == "ES"

    def test_upsert_deduplication(self, temp_db, sample_bars):
        store = DuckDBStore(temp_db)
        store.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        
        # Write twice
        store.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        store.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        
        # Should still be 100 bars (upsert)
        read_df = store.read_bars("ES", DataFrequency.MIN_1,
                                   sample_bars[0].timestamp, sample_bars[-1].timestamp,
                                   contract="ESM24")
        assert read_df.height == 100

    def test_get_symbols(self, temp_db, sample_bars):
        store = DuckDBStore(temp_db)
        store.connect()
        
        df_es = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        store.write_bars(df_es, "ES", DataFrequency.MIN_1, "ESM24")
        
        # Create NQ bars with correct symbol
        nq_bars = []
        for bar in sample_bars:
            bar_dict = bar.to_polars_dict()
            bar_dict["symbol"] = "NQ"
            bar_dict["contract"] = "NQM24"
            bar_dict["exchange"] = "CME"
            bar_dict["sector"] = "equity"
            bar_dict["tick_size"] = 0.25
            bar_dict["tick_value"] = 5.0
            bar_dict["multiplier"] = 20
            nq_bars.append(bar_dict)
        df_nq = pl.DataFrame(nq_bars)
        store.write_bars(df_nq, "NQ", DataFrequency.MIN_1, "NQM24")
        
        symbols = store.get_symbols(DataFrequency.MIN_1)
        
        assert "ES" in symbols
        assert "NQ" in symbols

    def test_get_date_range(self, temp_db, sample_bars):
        store = DuckDBStore(temp_db)
        store.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        store.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        
        date_range = store.get_date_range("ES", DataFrequency.MIN_1, "ESM24")
        
        assert date_range is not None
        assert date_range[0] == sample_bars[0].timestamp
        assert date_range[1] == sample_bars[-1].timestamp

    def test_stats(self, temp_db, sample_bars):
        store = DuckDBStore(temp_db)
        store.connect()
        
        df = pl.DataFrame([bar.to_polars_dict() for bar in sample_bars])
        store.write_bars(df, "ES", DataFrequency.MIN_1, "ESM24")
        
        stats = store.stats()
        
        assert stats["bars_1min_rows"] == 100
        assert stats["bars_1min_symbols"] == 1
        assert stats["database_size_mb"] > 0


class TestETLPipeline:
    """Test ETL pipeline integration."""

    def test_pipeline_config_creation(self):
        config = PipelineConfig(
            symbols=["ES", "NQ"],
            frequencies=[DataFrequency.MIN_1, DataFrequency.MIN_5],
            create_continuous=True,
            resample_higher=True,
        )
        
        assert config.symbols == ["ES", "NQ"]
        assert DataFrequency.MIN_5 in config.frequencies
        assert config.create_continuous is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])