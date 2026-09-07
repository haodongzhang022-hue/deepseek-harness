"""
DuckDB Storage Layer
High-performance columnar storage for market data with partitioning.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import duckdb
import polars as pl
from loguru import logger

from us_futures.config import get_settings
from us_futures.data.schema import Bar, DataFrequency


class DuckDBStore:
    """
    DuckDB-based storage for market data.
    
    Schema:
    - bars_1min, bars_5min, bars_15min, bars_1h, bars_1d tables
    - Partitioned by symbol, year, month
    - Indexed on (symbol, timestamp)
    """

    # Table schemas by frequency
    TABLE_SCHEMAS = {
        DataFrequency.MIN_1: "bars_1min",
        DataFrequency.MIN_5: "bars_5min",
        DataFrequency.MIN_15: "bars_15min",
        DataFrequency.MIN_30: "bars_30min",
        DataFrequency.HOUR_1: "bars_1h",
        DataFrequency.HOUR_4: "bars_4h",
        DataFrequency.DAY_1: "bars_1d",
    }

    def __init__(self, db_path: str | Path | None = None, read_only: bool = False):
        settings = get_settings()
        storage_config = settings.get("storage", {}).get("duckdb", {})

        self.db_path = Path(db_path or storage_config.get("path", "./data/us_futures.duckdb"))
        self.read_only = read_only
        self.compression = storage_config.get("compression", "zstd")
        self._conn: duckdb.DuckDBPyConnection | None = None
        self._initialized = False

    def connect(self) -> duckdb.DuckDBPyConnection:
        """Get or create connection."""
        if self._conn is None:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = duckdb.connect(str(self.db_path), read_only=self.read_only)
            self._conn.execute("PRAGMA threads=4")
            self._conn.execute(f"PRAGMA enable_progress_bar=false")
            if not self.read_only:
                self._initialize_schema()
        return self._conn

    def close(self) -> None:
        """Close connection."""
        if self._conn:
            self._conn.close()
            self._conn = None
            self._initialized = False

    def __enter__(self) -> DuckDBStore:
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    @contextmanager
    def transaction(self):
        """Transaction context manager."""
        conn = self.connect()
        try:
            conn.begin()
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def _initialize_schema(self) -> None:
        """Create tables and indexes if not exist."""
        if self._initialized:
            return

        conn = self.connect()

        # Create sequence for unique IDs
        conn.execute("CREATE SEQUENCE IF NOT EXISTS bar_id_seq START 1")

        for freq, table in self.TABLE_SCHEMAS.items():
            # Main bars table
            conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    id UBIGINT PRIMARY KEY DEFAULT nextval('bar_id_seq'),
                    symbol VARCHAR NOT NULL,
                    contract VARCHAR NOT NULL,
                    timestamp TIMESTAMPTZ NOT NULL,
                    frequency VARCHAR NOT NULL,
                    open DOUBLE NOT NULL,
                    high DOUBLE NOT NULL,
                    low DOUBLE NOT NULL,
                    close DOUBLE NOT NULL,
                    volume UBIGINT NOT NULL,
                    open_interest UBIGINT,
                    vwap DOUBLE,
                    trade_count UBIGINT,
                    bid DOUBLE,
                    ask DOUBLE,
                    bid_size UBIGINT,
                    ask_size UBIGINT,
                    source VARCHAR DEFAULT 'unknown',
                    received_at TIMESTAMPTZ DEFAULT now(),
                    is_final BOOLEAN DEFAULT true,
                    exchange VARCHAR,
                    sector VARCHAR,
                    tick_size DOUBLE,
                    tick_value DOUBLE,
                    multiplier UBIGINT,
                    created_at TIMESTAMPTZ DEFAULT now(),
                    UNIQUE(symbol, contract, timestamp)
                )
            """)

            # Indexes
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_symbol_ts ON {table} (symbol, timestamp)")
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_contract_ts ON {table} (contract, timestamp)")
            conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_symbol_contract ON {table} (symbol, contract)")

            # Partition by year/month (DuckDB doesn't have native partitioning, use views)
            conn.execute(f"""
                CREATE VIEW IF NOT EXISTS v_{table}_by_month AS
                SELECT *, 
                    year(timestamp) as year,
                    month(timestamp) as month
                FROM {table}
            """)

        # Contracts table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS contracts (
                symbol VARCHAR NOT NULL,
                contract VARCHAR NOT NULL,
                exchange VARCHAR,
                sector VARCHAR,
                tick_size DOUBLE,
                tick_value DOUBLE,
                multiplier UBIGINT,
                margin_initial UBIGINT,
                margin_maintenance UBIGINT,
                expiration_date DATE,
                first_trade_date DATE,
                last_trade_date DATE,
                is_continuous BOOLEAN DEFAULT false,
                PRIMARY KEY (symbol, contract)
            )
        """)

        # Data quality logs
        conn.execute("""
            CREATE TABLE IF NOT EXISTS data_quality_log (
                id UBIGINT PRIMARY KEY DEFAULT nextval('bar_id_seq'),
                symbol VARCHAR NOT NULL,
                contract VARCHAR,
                frequency VARCHAR NOT NULL,
                start_time TIMESTAMPTZ,
                end_time TIMESTAMPTZ,
                total_bars UBIGINT,
                expected_bars UBIGINT,
                missing_bars UBIGINT,
                gap_count UBIGINT,
                max_gap_minutes UBIGINT,
                price_jumps UBIGINT,
                volume_spikes UBIGINT,
                zero_volume_bars UBIGINT,
                ohlc_violations UBIGINT,
                tick_misalignments UBIGINT,
                duplicate_timestamps UBIGINT,
                out_of_order UBIGINT,
                passed BOOLEAN,
                details JSON,
                validated_at TIMESTAMPTZ DEFAULT now()
            )
        """)

        conn.execute("CREATE INDEX IF NOT EXISTS idx_dq_symbol_time ON data_quality_log (symbol, validated_at)")

        self._initialized = True
        logger.info(f"DuckDB schema initialized at {self.db_path}")

    def _get_table(self, frequency: DataFrequency) -> str:
        table = self.TABLE_SCHEMAS.get(frequency)
        if not table:
            raise ValueError(f"Unsupported frequency: {frequency}")
        return table

    def write_bars(self, bars: pl.DataFrame, symbol: str, frequency: DataFrequency, contract: str | None = None) -> int:
        """Insert or upsert bars."""
        if bars.is_empty():
            return 0

        table = self._get_table(frequency)
        conn = self.connect()

        # Ensure contract column
        if "contract" not in bars.columns:
            bars = bars.with_columns(pl.lit(contract or "unknown").alias("contract"))

        # Prepare data for insertion
        cols = [
            "symbol", "contract", "timestamp", "frequency",
            "open", "high", "low", "close", "volume",
            "open_interest", "vwap", "trade_count",
            "bid", "ask", "bid_size", "ask_size",
            "source", "received_at", "is_final",
            "exchange", "sector", "tick_size", "tick_value", "multiplier"
        ]

        # Select only existing columns
        existing_cols = [c for c in cols if c in bars.columns]
        data = bars.select(existing_cols)

        # Convert to list of tuples for bulk insert
        rows = data.rows()

        # Upsert using INSERT OR REPLACE (on conflict symbol+contract+timestamp)
        placeholders = ", ".join(["?"] * len(existing_cols))
        conflict_cols = "symbol, contract, timestamp"
        update_cols = ", ".join([f"{c}=excluded.{c}" for c in existing_cols if c not in conflict_cols.split(", ")])

        query = f"""
            INSERT INTO {table} ({", ".join(existing_cols)})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_cols}) DO UPDATE SET {update_cols}
        """

        conn.executemany(query, rows)
        count = len(rows)
        logger.info(f"Upserted {count} bars into {table} for {symbol}")
        return count

    def append_bars(self, bars: pl.DataFrame, symbol: str, frequency: DataFrequency) -> int:
        """Alias for write_bars (upsert semantics)."""
        return self.write_bars(bars, symbol, frequency)

    def read_bars(
        self,
        symbol: str,
        frequency: DataFrequency,
        start: datetime,
        end: datetime,
        contract: str | None = None,
        columns: list[str] | None = None,
        limit: int | None = None,
    ) -> pl.DataFrame:
        """Read bars with filters."""
        table = self._get_table(frequency)
        conn = self.connect()

        cols = columns or "*"
        query = f"SELECT {cols} FROM {table} WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?"
        params = [symbol, start, end]

        if contract:
            query += " AND contract = ?"
            params.append(contract)

        query += " ORDER BY timestamp"
        if limit:
            query += f" LIMIT {limit}"

        return pl.from_arrow(conn.execute(query, params).arrow())

    def read_latest_bar(self, symbol: str, frequency: DataFrequency, contract: str | None = None) -> pl.DataFrame | None:
        """Get most recent bar."""
        table = self._get_table(frequency)
        conn = self.connect()

        query = f"""
            SELECT * FROM {table} 
            WHERE symbol = ? {'AND contract = ?' if contract else ''}
            ORDER BY timestamp DESC LIMIT 1
        """
        params = [symbol] + ([contract] if contract else [])

        result = conn.execute(query, params).fetchone()
        if result:
            return pl.DataFrame([result], schema=conn.description)
        return None

    def delete_bars(
        self,
        symbol: str,
        frequency: DataFrequency,
        start: datetime,
        end: datetime,
        contract: str | None = None,
    ) -> int:
        """Delete bars in range."""
        table = self._get_table(frequency)
        conn = self.connect()

        query = f"DELETE FROM {table} WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?"
        params = [symbol, start, end]

        if contract:
            query += " AND contract = ?"
            params.append(contract)

        result = conn.execute(query, params)
        count = result.rowcount if hasattr(result, 'rowcount') else 0
        logger.info(f"Deleted {count} bars from {table} for {symbol}")
        return count

    def get_symbols(self, frequency: DataFrequency | None = None) -> list[str]:
        """Get list of available symbols."""
        conn = self.connect()

        if frequency:
            table = self._get_table(frequency)
            query = f"SELECT DISTINCT symbol FROM {table} ORDER BY symbol"
        else:
            # Union across all tables
            queries = [f"SELECT DISTINCT symbol FROM {t}" for t in self.TABLE_SCHEMAS.values()]
            query = " UNION ".join(queries) + " ORDER BY symbol"

        return [row[0] for row in conn.execute(query).fetchall()]

    def get_contracts(self, symbol: str, frequency: DataFrequency | None = None) -> list[str]:
        """Get available contracts for symbol."""
        conn = self.connect()

        if frequency:
            table = self._get_table(frequency)
            query = f"SELECT DISTINCT contract FROM {table} WHERE symbol = ? ORDER BY contract"
            return [row[0] for row in conn.execute(query, [symbol]).fetchall()]
        else:
            queries = [
                f"SELECT DISTINCT contract FROM {t} WHERE symbol = ?"
                for t in self.TABLE_SCHEMAS.values()
            ]
            query = " UNION ".join(queries) + " ORDER BY contract"
            return [row[0] for row in conn.execute(query, [symbol]).fetchall()]

    def get_date_range(self, symbol: str, frequency: DataFrequency, contract: str | None = None) -> tuple[datetime, datetime] | None:
        """Get min/max timestamp for symbol."""
        table = self._get_table(frequency)
        conn = self.connect()

        query = f"SELECT min(timestamp), max(timestamp) FROM {table} WHERE symbol = ?"
        params = [symbol]
        if contract:
            query += " AND contract = ?"
            params.append(contract)

        result = conn.execute(query, params).fetchone()
        if result and result[0]:
            return (result[0], result[1])
        return None

    def log_quality_report(self, report) -> None:
        """Persist data quality report."""
        import json
        conn = self.connect()

        conn.execute("""
            INSERT INTO data_quality_log (
                symbol, contract, frequency, start_time, end_time,
                total_bars, expected_bars, missing_bars, gap_count,
                max_gap_minutes, price_jumps, volume_spikes,
                zero_volume_bars, ohlc_violations, tick_misalignments,
                duplicate_timestamps, out_of_order, passed, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            report.symbol,
            report.contract,
            report.frequency.value,
            report.start_time,
            report.end_time,
            report.total_bars,
            report.expected_bars,
            report.missing_bars,
            report.gap_count,
            report.max_gap_minutes,
            report.price_jumps,
            report.volume_spikes,
            report.zero_volume_bars,
            report.ohlc_violations,
            report.tick_misalignments,
            report.duplicate_timestamps,
            report.out_of_order,
            report.passed,
            json.dumps(report.details, default=str),
        ])

    def get_quality_history(self, symbol: str, days: int = 30) -> pl.DataFrame:
        """Retrieve quality history."""
        conn = self.connect()
        cutoff = datetime.now(timezone.utc) - __import__('datetime').timedelta(days=days)

        return pl.from_arrow(conn.execute("""
            SELECT * FROM data_quality_log 
            WHERE symbol = ? AND validated_at >= ?
            ORDER BY validated_at DESC
        """, [symbol, cutoff]).arrow())

    def vacuum(self) -> None:
        """Reclaim space and optimize."""
        if self.read_only:
            return
        conn = self.connect()
        conn.execute("VACUUM")
        conn.execute("ANALYZE")
        logger.info("DuckDB vacuum completed")

    def backup(self, backup_path: str | Path) -> None:
        """Create backup."""
        backup_path = Path(backup_path)
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        conn = self.connect()
        conn.execute(f"EXPORT DATABASE '{backup_path}' (FORMAT PARQUET, COMPRESSION '{self.compression}')")
        logger.info(f"Database backed up to {backup_path}")

    def stats(self) -> dict[str, Any]:
        """Get storage statistics."""
        conn = self.connect()
        stats = {"database_size_mb": self.db_path.stat().st_size / 1024 / 1024 if self.db_path.exists() else 0}

        for freq, table in self.TABLE_SCHEMAS.items():
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                symbols = conn.execute(f"SELECT COUNT(DISTINCT symbol) FROM {table}").fetchone()[0]
                stats[f"{table}_rows"] = count
                stats[f"{table}_symbols"] = symbols
            except Exception:
                stats[f"{table}_rows"] = 0
                stats[f"{table}_symbols"] = 0

        return stats


def get_store(db_path: str | Path | None = None, read_only: bool = False) -> DuckDBStore:
    """Factory function for DuckDBStore."""
    return DuckDBStore(db_path, read_only)