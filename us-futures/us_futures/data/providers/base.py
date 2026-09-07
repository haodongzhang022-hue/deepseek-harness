"""
Data Provider Abstraction Layer
Base interface for all data sources (CSV, API, DB, etc.)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, AsyncIterator, Iterator, Optional

import polars as pl
from loguru import logger

from us_futures.config import get_settings
from us_futures.data.schema import Bar, DataFrequency, ContractSpec, Tick


class DataProvider(ABC):
    """Abstract base class for data providers."""

    def __init__(self, name: str, config: dict[str, Any] | None = None):
        self.name = name
        self.config = config or {}
        self._connected = False

    @abstractmethod
    def connect(self) -> bool:
        """Establish connection to data source."""
        ...

    @abstractmethod
    def disconnect(self) -> None:
        """Close connection."""
        ...

    @property
    def is_connected(self) -> bool:
        return self._connected

    @abstractmethod
    def fetch_bars(
        self,
        symbol: str,
        contract: str | None,
        frequency: DataFrequency,
        start: datetime,
        end: datetime,
        **kwargs,
    ) -> pl.DataFrame:
        """Fetch OHLCV bars as Polars DataFrame."""
        ...

    @abstractmethod
    def fetch_ticks(
        self,
        symbol: str,
        contract: str | None,
        start: datetime,
        end: datetime,
        **kwargs,
    ) -> pl.DataFrame:
        """Fetch tick data as Polars DataFrame."""
        ...

    @abstractmethod
    def get_available_contracts(self, symbol: str, start: datetime, end: datetime) -> list[str]:
        """List available contracts for symbol in date range."""
        ...

    @abstractmethod
    def get_contract_spec(self, symbol: str) -> ContractSpec | None:
        """Get contract specification."""
        ...

    def stream_bars(
        self,
        symbol: str,
        contract: str | None,
        frequency: DataFrequency,
        start: datetime,
        **kwargs,
    ) -> Iterator[pl.DataFrame]:
        """Stream bars in chunks (for large date ranges)."""
        # Default implementation: single fetch
        yield self.fetch_bars(symbol, contract, frequency, start, datetime.now(timezone.utc), **kwargs)

    def health_check(self) -> dict[str, Any]:
        """Health check endpoint."""
        return {
            "provider": self.name,
            "connected": self._connected,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


class BarWriter(ABC):
    """Abstract base for writing bar data."""

    @abstractmethod
    def write_bars(self, bars: pl.DataFrame, symbol: str, frequency: DataFrequency) -> int:
        """Write bars, return count written."""
        ...

    @abstractmethod
    def append_bars(self, bars: pl.DataFrame, symbol: str, frequency: DataFrequency) -> int:
        """Append bars (upsert by timestamp)."""
        ...

    @abstractmethod
    def delete_bars(self, symbol: str, frequency: DataFrequency, start: datetime, end: datetime) -> int:
        """Delete bars in range."""
        ...


class TickWriter(ABC):
    """Abstract base for writing tick data."""

    @abstractmethod
    def write_ticks(self, ticks: pl.DataFrame, symbol: str, contract: str) -> int:
        ...


class DataProviderRegistry:
    """Registry for managing multiple data providers."""

    def __init__(self):
        self._providers: dict[str, DataProvider] = {}
        self._default: str | None = None

    def register(self, provider: DataProvider, default: bool = False) -> None:
        self._providers[provider.name] = provider
        if default or self._default is None:
            self._default = provider.name
        logger.info(f"Registered data provider: {provider.name} (default={default})")

    def get(self, name: str | None = None) -> DataProvider:
        name = name or self._default
        if name not in self._providers:
            raise ValueError(f"Provider '{name}' not registered. Available: {list(self._providers.keys())}")
        return self._providers[name]

    def list_providers(self) -> list[str]:
        return list(self._providers.keys())

    def connect_all(self) -> dict[str, bool]:
        results = {}
        for name, provider in self._providers.items():
            try:
                results[name] = provider.connect()
            except Exception as e:
                logger.error(f"Failed to connect {name}: {e}")
                results[name] = False
        return results

    def disconnect_all(self) -> None:
        for provider in self._providers.values():
            try:
                provider.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting {provider.name}: {e}")


# Global registry instance
_provider_registry: DataProviderRegistry | None = None


def get_provider_registry() -> DataProviderRegistry:
    global _provider_registry
    if _provider_registry is None:
        _provider_registry = DataProviderRegistry()
    return _provider_registry


def get_provider(name: str | None = None) -> DataProvider:
    return get_provider_registry().get(name)