"""
Local CSV/Parquet Data Provider
Reads market data from local files (CSV, Parquet).
Zero external dependencies - works offline.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import polars as pl
from loguru import logger

from us_futures.config import get_settings, load_symbols_config
from us_futures.data.providers.base import DataProvider
from us_futures.data.schema import Bar, ContractSpec, DataFrequency, Exchange, Sector


class LocalFileProvider(DataProvider):
    """
    Reads bars from local CSV or Parquet files.
    
    Expected directory structure:
    data_root/
        {symbol}/
            {frequency}/
                {contract_or_continuous}.parquet
                # or .csv
    
    CSV/Parquet schema (minimum):
    timestamp, open, high, low, close, volume
    Optional: open_interest, vwap, trade_count, bid, ask, bid_size, ask_size
    """

    def __init__(self, name: str = "local_csv", config: dict[str, Any] | None = None):
        super().__init__(name, config)
        settings = get_settings()
        self.data_root = Path(config.get("data_root", settings.get("project", {}).get("data_root", "./data")))
        self.file_format = config.get("format", "parquet")  # parquet or csv
        self.symbols_config = load_symbols_config()
        self._contract_cache: dict[str, ContractSpec] = {}

    def connect(self) -> bool:
        """Verify data root exists."""
        if not self.data_root.exists():
            logger.warning(f"Data root does not exist: {self.data_root}")
            self.data_root.mkdir(parents=True, exist_ok=True)
        self._connected = True
        logger.info(f"LocalFileProvider connected to {self.data_root}")
        return True

    def disconnect(self) -> None:
        self._connected = False

    def _get_symbol_path(self, symbol: str, frequency: DataFrequency) -> Path:
        # Use full frequency name for directory (e.g., 1min, 5min, 1H, 1D)
        freq_dir = frequency.value
        return self.data_root / symbol.upper() / freq_dir

    def _find_files(self, symbol: str, frequency: DataFrequency, contract: str | None = None) -> list[Path]:
        """Find data files for symbol/frequency/contract."""
        sym_path = self._get_symbol_path(symbol, frequency)
        if not sym_path.exists():
            return []

        if contract:
            # Specific contract file
            for ext in [".parquet", ".csv"]:
                file_path = sym_path / f"{contract}{ext}"
                if file_path.exists():
                    return [file_path]
            # Try continuous symbol format
            for ext in [".parquet", ".csv"]:
                file_path = sym_path / f"{contract}{ext}"
                if file_path.exists():
                    return [file_path]
        else:
            # All files in directory
            files = list(sym_path.glob(f"*.{self.file_format}"))
            if not files:
                files = list(sym_path.glob("*.csv"))
            return sorted(files)

        return []

    def _read_file(self, file_path: Path) -> pl.DataFrame:
        """Read single file to Polars DataFrame."""
        if file_path.suffix == ".parquet":
            return pl.read_parquet(file_path)
        elif file_path.suffix == ".csv":
            return pl.read_csv(file_path, try_parse_dates=True)
        else:
            raise ValueError(f"Unsupported file format: {file_path.suffix}")

    def _standardize_columns(self, df: pl.DataFrame, symbol: str, contract: str, frequency: DataFrequency) -> pl.DataFrame:
        """Ensure DataFrame has all required columns with correct types."""
        # Get contract spec for metadata
        spec = self.get_contract_spec(symbol)

        # Required columns
        required = ["timestamp", "open", "high", "low", "close", "volume"]
        for col in required:
            if col not in df.columns:
                raise ValueError(f"Missing required column: {col}")

        # Parse timestamp
        if df["timestamp"].dtype != pl.Datetime:
            df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us", "UTC")))

        # Ensure UTC
        df = df.with_columns(
            pl.col("timestamp").dt.replace_time_zone("UTC").alias("timestamp")
        )

        # Cast numeric columns
        numeric_cols = ["open", "high", "low", "close", "volume"]
        for col in numeric_cols:
            if col in df.columns:
                df = df.with_columns(pl.col(col).cast(pl.Float64))

        # Add optional columns with defaults
        optional_defaults = {
            "open_interest": None,
            "vwap": None,
            "trade_count": None,
            "bid": None,
            "ask": None,
            "bid_size": None,
            "ask_size": None,
        }
        for col, default in optional_defaults.items():
            if col not in df.columns:
                df = df.with_columns(pl.lit(default).alias(col))

        # Add metadata columns
        df = df.with_columns([
            pl.lit(symbol.upper()).alias("symbol"),
            pl.lit(contract).alias("contract"),
            pl.lit(frequency.value).alias("frequency"),
            pl.lit(self.name).alias("source"),
            pl.lit(datetime.now(timezone.utc)).alias("received_at"),
            pl.lit(True).alias("is_final"),
            pl.lit(spec.exchange.value if spec else Exchange.CME.value).alias("exchange"),
            pl.lit(spec.sector.value if spec else Sector.EQUITY.value).alias("sector"),
            pl.lit(float(spec.tick_size) if spec else 0.25).alias("tick_size"),
            pl.lit(float(spec.tick_value) if spec else 12.5).alias("tick_value"),
            pl.lit(spec.multiplier if spec else 50).alias("multiplier"),
        ])

        # Sort by timestamp
        df = df.sort("timestamp")

        return df

    def fetch_bars(
        self,
        symbol: str,
        contract: str | None,
        frequency: DataFrequency,
        start: datetime,
        end: datetime,
        **kwargs,
    ) -> pl.DataFrame:
        """Fetch bars from local files."""
        files = self._find_files(symbol, frequency, contract)

        if not files:
            logger.warning(f"No data files found for {symbol} {contract or 'any'} {frequency}")
            return pl.DataFrame()

        # Read and combine all files
        dfs = []
        for file_path in files:
            try:
                df = self._read_file(file_path)
                df = self._standardize_columns(df, symbol, contract or file_path.stem, frequency)
                dfs.append(df)
            except Exception as e:
                logger.error(f"Failed to read {file_path}: {e}")
                continue

        if not dfs:
            return pl.DataFrame()

        combined = pl.concat(dfs, how="vertical")

        # Filter by date range
        combined = combined.filter(
            (pl.col("timestamp") >= start) &
            (pl.col("timestamp") <= end)
        )

        # Deduplicate (keep last)
        combined = combined.unique(subset=["symbol", "contract", "timestamp"], keep="last")

        return combined.sort("timestamp")

    def fetch_ticks(
        self,
        symbol: str,
        contract: str | None,
        start: datetime,
        end: datetime,
        **kwargs,
    ) -> pl.DataFrame:
        """Fetch tick data (not typically stored locally)."""
        # Tick data usually not in local CSV - return empty
        logger.warning("Tick data not available from local CSV provider")
        return pl.DataFrame()

    def get_available_contracts(self, symbol: str, start: datetime, end: datetime) -> list[str]:
        """Scan directory for available contracts."""
        # Check all frequencies for contracts
        contracts = set()
        for freq in DataFrequency:
            files = self._find_files(symbol, freq)
            for f in files:
                # Extract contract from filename
                stem = f.stem
                if stem not in ["continuous", "1!", "2!", "3!"]:
                    contracts.add(stem)

        # Also check continuous symbols
        for freq in DataFrequency:
            sym_path = self._get_symbol_path(symbol, freq)
            for pattern in ["1!", "2!", "3!"]:
                for ext in [".parquet", ".csv"]:
                    if (sym_path / f"{pattern}{ext}").exists():
                        contracts.add(pattern)

        return sorted(contracts)

    def get_contract_spec(self, symbol: str) -> ContractSpec | None:
        """Get contract specification from symbols.yaml."""
        if symbol in self._contract_cache:
            return self._contract_cache[symbol]

        symbols_data = self.symbols_config.get("symbols", {})
        if symbol not in symbols_data:
            return None

        s = symbols_data[symbol]
        spec = ContractSpec(
            symbol=symbol,
            name=s["name"],
            exchange=Exchange(s["exchange"]),
            sector=Sector(s["sector"]),
            tick_size=Decimal(str(s["tick_size"])),
            tick_value=Decimal(str(s["tick_value"])),
            multiplier=s["multiplier"],
            margin_initial=s["margin_initial"],
            margin_maintenance=s["margin_maintenance"],
            trading_hours=s["trading_hours"],
            roll_rule=s["roll_rule"],
            roll_offset_days=s["roll_offset_days"],
            expiration_months=s["expiration_months"],
            continuous_symbol=s["continuous_symbol"],
            timezone=s["timezone"],
        )
        self._contract_cache[symbol] = spec
        return spec

    def write_bars(self, df: pl.DataFrame, symbol: str, frequency: DataFrequency, contract: str | None = None) -> int:
        """Write bars to local file (append/upsert)."""
        contract = contract or "continuous"
        sym_path = self._get_symbol_path(symbol, frequency)
        sym_path.mkdir(parents=True, exist_ok=True)

        file_path = sym_path / f"{contract}.{self.file_format}"

        # Standardize
        df = self._standardize_columns(df, symbol, contract, frequency)

        if file_path.exists():
            # Read existing, upsert
            existing = self._read_file(file_path)
            combined = pl.concat([existing, df], how="vertical")
            combined = combined.unique(subset=["symbol", "contract", "timestamp"], keep="last")
            combined = combined.sort("timestamp")
        else:
            combined = df

        if self.file_format == "parquet":
            combined.write_parquet(file_path, compression="zstd")
        else:
            combined.write_csv(file_path)

        logger.info(f"Wrote {combined.height} bars to {file_path}")
        return combined.height


def create_sample_data(
    symbol: str = "ES",
    frequency: DataFrequency = DataFrequency.MIN_1,
    days: int = 10,
    data_root: Path | str = "./data",
    file_format: str = "parquet",
) -> Path:
    """Generate sample OHLCV data for testing."""
    import numpy as np
    from us_futures.config import load_symbols_config

    data_root = Path(data_root)
    
    # Get contract spec for proper tick size and base price
    symbols_config = load_symbols_config()
    sym_config = symbols_config.get("symbols", {}).get(symbol, {})
    tick_size = float(sym_config.get("tick_size", 0.25))
    
    # Base prices per symbol (approximate)
    base_prices = {
        "ES": 4500.0, "NQ": 15000.0, "YM": 35000.0, "RTY": 2000.0,
        "CL": 80.0, "NG": 3.0, "RB": 2.5, "HO": 2.5,
        "GC": 2000.0, "SI": 25.0, "HG": 4.0,
        "ZB": 120.0, "ZN": 110.0, "ZF": 108.0, "ZT": 105.0,
        "6E": 1.1, "6J": 0.009, "6B": 1.3, "6A": 0.65, "6C": 0.75,
        "ZC": 5.0, "ZS": 13.0, "ZW": 6.0,
        "LE": 1.8, "HE": 0.8,
    }
    base_price = base_prices.get(symbol, 100.0)
    
    # Use provider's path logic for consistency
    provider = LocalFileProvider(config={"data_root": str(data_root), "format": file_format})
    provider.connect()
    sym_path = provider._get_symbol_path(symbol, frequency)
    sym_path.mkdir(parents=True, exist_ok=True)

    # Generate timestamps (skip weekends)
    from datetime import timedelta
    end = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days * 2)  # Extra for weekends

    timestamps = []
    current = start
    while current <= end:
        if current.weekday() < 5:  # Mon-Fri
            # RTH: 09:30-16:00 ET = 13:30-20:00 UTC
            for minute in range(390):  # 6.5 hours * 60
                ts = current.replace(hour=13, minute=30) + timedelta(minutes=minute)
                timestamps.append(ts)
        current += timedelta(days=1)

    # Generate realistic price series
    np.random.seed(42)
    n = len(timestamps)
    returns = np.random.normal(0, 0.0005, n)
    prices = base_price * np.exp(np.cumsum(returns))

    # Create OHLCV with tick-aligned prices
    def round_to_tick(price: float) -> float:
        return round(price / tick_size) * tick_size

    data = []
    for i, (ts, close) in enumerate(zip(timestamps, prices)):
        # Generate intraday OHLC from close
        vol_factor = 1 + 0.5 * np.sin(2 * np.pi * (i % 390) / 390)  # U-shaped volume
        close = round_to_tick(close)
        high = round_to_tick(close * (1 + abs(np.random.normal(0, 0.0003))))
        low = round_to_tick(close * (1 - abs(np.random.normal(0, 0.0003))))
        open_ = round_to_tick(prices[i-1] if i > 0 else close)
        volume = int(np.random.lognormal(8, 0.5) * vol_factor)

        data.append({
            "timestamp": ts,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        })

    df = pl.DataFrame(data)

    # Use continuous contract symbol for sample data
    contract = f"{symbol}1!"
    file_path = sym_path / f"{contract}.{file_format}"

    if file_format == "parquet":
        df.write_parquet(file_path, compression="zstd")
    else:
        df.write_csv(file_path)

    logger.info(f"Generated sample data: {file_path} ({df.height} bars)")
    return file_path