"""
ETL Pipeline Orchestration
Incremental updates, backfill, validation, storage.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import polars as pl
from loguru import logger

from us_futures.config import get_settings
from us_futures.data.providers import DataProvider, get_provider_registry
from us_futures.data.storage import DuckDBStore, get_store
from us_futures.data.validation import DataIntegrityValidator, validate_bars
from us_futures.data.alignment import resample_bars, build_continuous_contract, DataFrequency, AlignmentMethod
from us_futures.data.schema import Bar, DataQualityReport


@dataclass
class PipelineConfig:
    """ETL pipeline configuration."""
    symbols: list[str]
    frequencies: list[DataFrequency] = field(default_factory=lambda: [DataFrequency.MIN_1])
    provider_name: str | None = None
    storage: DuckDBStore | None = None
    validator: DataIntegrityValidator | None = None
    batch_size: int = 10000
    max_workers: int = 4
    create_continuous: bool = True
    resample_higher: bool = True  # Generate 5m, 15m from 1m
    validation_required: bool = True
    stop_on_validation_failure: bool = False


@dataclass
class PipelineResult:
    """Result of pipeline execution."""
    symbol: str
    frequency: DataFrequency
    contract: str | None
    start: datetime
    end: datetime
    bars_fetched: int
    bars_written: int
    validation_report: DataQualityReport | None = None
    errors: list[str] = field(default_factory=list)
    duration_sec: float = 0.0
    success: bool = True


class ETLPipeline:
    """
    Orchestrates the full ETL process:
    1. Fetch from provider
    2. Validate
    3. Resample to higher frequencies
    4. Build continuous contracts
    5. Store in DuckDB
    6. Log quality metrics
    """

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.provider = get_provider_registry().get(config.provider_name) if config.provider_name else None
        self.storage = config.storage or get_store()
        self.validator = config.validator or DataIntegrityValidator()
        self._results: list[PipelineResult] = []

    def run(
        self,
        start: datetime,
        end: datetime,
        symbols: list[str] | None = None,
        contracts: dict[str, str] | None = None,
        force_full_refresh: bool = False,
    ) -> list[PipelineResult]:
        """
        Run full ETL for date range.
        
        Args:
            start: Start datetime (UTC)
            end: End datetime (UTC)
            symbols: Override configured symbols
            contracts: Symbol -> specific contract (None = auto/continuous)
            force_full_refresh: Ignore existing data, re-fetch all
        """
        symbols = symbols or self.config.symbols
        self._results.clear()

        logger.info(f"Starting ETL for {len(symbols)} symbols from {start} to {end}")

        for symbol in symbols:
            try:
                self._process_symbol(symbol, start, end, contracts, force_full_refresh)
            except Exception as e:
                logger.error(f"ETL failed for {symbol}: {e}")
                self._results.append(PipelineResult(
                    symbol=symbol,
                    frequency=DataFrequency.MIN_1,
                    contract=None,
                    start=start,
                    end=end,
                    bars_fetched=0,
                    bars_written=0,
                    errors=[str(e)],
                    success=False,
                ))

        self._log_summary()
        return self._results

    def _process_symbol(
        self,
        symbol: str,
        start: datetime,
        end: datetime,
        contracts: dict[str, str] | None,
        force_full_refresh: bool,
    ) -> None:
        """Process single symbol across all frequencies."""
        contract = contracts.get(symbol) if contracts else None

        # Determine fetch range (incremental if not forced)
        fetch_start = start
        if not force_full_refresh:
            existing = self.storage.get_date_range(symbol, DataFrequency.MIN_1, contract)
            if existing:
                _, max_ts = existing
                if max_ts >= end:
                    logger.info(f"{symbol} data up to date, skipping")
                    return
                fetch_start = max_ts + timedelta(minutes=1)
                logger.info(f"{symbol} incremental update from {fetch_start}")

        # Fetch raw 1min bars
        if not self.provider:
            raise ValueError("No data provider configured")

        raw_bars = self.provider.fetch_bars(
            symbol=symbol,
            contract=contract,
            frequency=DataFrequency.MIN_1,
            start=fetch_start,
            end=end,
        )

        if raw_bars.is_empty():
            logger.warning(f"No data fetched for {symbol} {contract or 'auto'}")
            return

        # Validate raw data
        validation_report = None
        if self.config.validation_required:
            validation_report = validate_bars(raw_bars, symbol, DataFrequency.MIN_1)
            if not validation_report.passed and self.config.stop_on_validation_failure:
                raise ValueError(f"Validation failed for {symbol}: {validation_report.details}")
            self.storage.log_quality_report(validation_report)

        # Write 1min bars
        bars_written = self.storage.write_bars(raw_bars, symbol, DataFrequency.MIN_1, contract)
        
        self._results.append(PipelineResult(
            symbol=symbol,
            frequency=DataFrequency.MIN_1,
            contract=contract,
            start=fetch_start,
            end=end,
            bars_fetched=raw_bars.height,
            bars_written=bars_written,
            validation_report=validation_report,
            success=True,
        ))

        # Build continuous contract if enabled
        if self.config.create_continuous and contract is None:
            continuous = self._build_continuous(symbol, fetch_start, end)
            if continuous is not None:
                self.storage.write_bars(continuous, symbol, DataFrequency.MIN_1, f"{symbol}1!")

        # Resample to higher frequencies
        if self.config.resample_higher:
            self._resample_and_store(symbol, raw_bars, contract, fetch_start, end)

    def _build_continuous(
        self,
        symbol: str,
        start: datetime,
        end: datetime,
    ) -> pl.DataFrame | None:
        """Build continuous contract from all available contracts."""
        # Read all 1min data for symbol
        all_bars = self.storage.read_bars(symbol, DataFrequency.MIN_1, start, end)
        
        if all_bars.is_empty() or "contract" not in all_bars.columns:
            return None

        # Build continuous
        continuous = build_continuous_contract(all_bars, symbol)
        return continuous

    def _resample_and_store(
        self,
        symbol: str,
        raw_bars: pl.DataFrame,
        contract: str | None,
        start: datetime,
        end: datetime,
    ) -> None:
        """Resample 1min bars to higher frequencies and store."""
        # Use continuous if available, else raw
        source_bars = raw_bars
        
        for freq in self.config.frequencies:
            if freq == DataFrequency.MIN_1:
                continue

            try:
                resampled = resample_bars(source_bars, freq, method=AlignmentMethod.OHLC)
                
                # Validate resampled
                val_report = None
                if self.config.validation_required:
                    val_report = validate_bars(resampled, symbol, freq)
                    self.storage.log_quality_report(val_report)

                written = self.storage.write_bars(resampled, symbol, freq, contract)
                
                self._results.append(PipelineResult(
                    symbol=symbol,
                    frequency=freq,
                    contract=contract,
                    start=start,
                    end=end,
                    bars_fetched=resampled.height,
                    bars_written=written,
                    validation_report=val_report,
                    success=True,
                ))

                # Also build continuous for higher freq
                if self.config.create_continuous and contract is None:
                    continuous = build_continuous_contract(resampled, symbol)
                    if continuous is not None:
                        self.storage.write_bars(continuous, symbol, freq, f"{symbol}1!")

            except Exception as e:
                logger.error(f"Resample {symbol} to {freq} failed: {e}")
                self._results.append(PipelineResult(
                    symbol=symbol,
                    frequency=freq,
                    contract=contract,
                    start=start,
                    end=end,
                    bars_fetched=0,
                    bars_written=0,
                    errors=[str(e)],
                    success=False,
                ))

    def _log_summary(self) -> None:
        """Log pipeline execution summary."""
        total_fetched = sum(r.bars_fetched for r in self._results)
        total_written = sum(r.bars_written for r in self._results)
        failed = [r for r in self._results if not r.success]
        
        logger.info(f"ETL complete: {total_fetched} fetched, {total_written} written, {len(failed)} failed")
        
        for r in failed:
            logger.error(f"  FAILED: {r.symbol} {r.frequency} - {r.errors}")

    def get_results(self) -> list[PipelineResult]:
        return self._results.copy()


class IncrementalUpdater:
    """
    Lightweight incremental updater for near-real-time updates.
    Runs on schedule, fetches only new bars.
    """

    def __init__(
        self,
        symbols: list[str],
        provider: DataProvider,
        storage: DuckDBStore,
        validator: DataIntegrityValidator | None = None,
        lookback_minutes: int = 60,  # How far back to check for updates
    ):
        self.symbols = symbols
        self.provider = provider
        self.storage = storage
        self.validator = validator or DataIntegrityValidator()
        self.lookback_minutes = lookback_minutes

    def update(self) -> dict[str, int]:
        """Run incremental update for all symbols."""
        results = {}
        now = datetime.now(timezone.utc)
        lookback_start = now - timedelta(minutes=self.lookback_minutes)

        for symbol in self.symbols:
            try:
                # Get latest timestamp in storage
                latest = self.storage.read_latest_bar(symbol, DataFrequency.MIN_1)
                
                if latest is not None and not latest.is_empty():
                    last_ts = latest["timestamp"][0]
                    # Fetch from last known bar (allow overlap for corrections)
                    fetch_start = last_ts - timedelta(minutes=5)
                else:
                    fetch_start = lookback_start

                # Fetch new bars
                new_bars = self.provider.fetch_bars(
                    symbol=symbol,
                    contract=None,
                    frequency=DataFrequency.MIN_1,
                    start=fetch_start,
                    end=now,
                )

                if new_bars.is_empty():
                    results[symbol] = 0
                    continue

                # Validate
                val_report = validate_bars(new_bars, symbol, DataFrequency.MIN_1)
                self.storage.log_quality_report(val_report)

                # Write (upsert handles deduplication)
                written = self.storage.write_bars(new_bars, symbol, DataFrequency.MIN_1)
                results[symbol] = written

                logger.info(f"Incremental update {symbol}: {written} bars")

            except Exception as e:
                logger.error(f"Incremental update failed for {symbol}: {e}")
                results[symbol] = -1

        return results


def run_backfill(
    symbols: list[str],
    start: datetime,
    end: datetime,
    provider_name: str | None = None,
    db_path: str | Path | None = None,
    frequencies: list[DataFrequency] | None = None,
) -> list[PipelineResult]:
    """Convenience function for historical backfill."""
    config = PipelineConfig(
        symbols=symbols,
        frequencies=frequencies or [DataFrequency.MIN_1, DataFrequency.MIN_5, DataFrequency.MIN_15, DataFrequency.HOUR_1],
        provider_name=provider_name,
        storage=get_store(db_path),
        validation_required=True,
        create_continuous=True,
        resample_higher=True,
    )

    pipeline = ETLPipeline(config)
    return pipeline.run(start, end, force_full_refresh=True)