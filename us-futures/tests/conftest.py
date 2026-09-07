"""
Pytest configuration and fixtures
"""

import pytest
from datetime import datetime, timezone
from decimal import Decimal

import polars as pl

from us_futures.data.schema import Bar, DataFrequency, Exchange, Sector


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    import asyncio
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def sample_bar():
    """Single sample bar."""
    return Bar(
        symbol="ES",
        contract="ESM24",
        timestamp=datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc),
        frequency=DataFrequency.MIN_1,
        open=Decimal("4500.00"),
        high=Decimal("4500.25"),
        low=Decimal("4499.75"),
        close=Decimal("4500.10"),
        volume=1000,
        exchange=Exchange.CME,
        sector=Sector.EQUITY,
        tick_size=Decimal("0.25"),
        tick_value=Decimal("12.50"),
        multiplier=50,
    )


@pytest.fixture
def sample_bars_1min():
    """100 1-minute bars."""
    bars = []
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
    base_price = Decimal("4500.00")
    
    for i in range(100):
        ts = base_time + __import__('datetime').timedelta(minutes=i)
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
def sample_bars_df(sample_bars_1min):
    """Sample bars as Polars DataFrame."""
    return pl.DataFrame([bar.to_polars_dict() for bar in sample_bars_1min])


@pytest.fixture
def multi_contract_bars():
    """Bars with multiple contracts for continuous testing."""
    bars = []
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
    
    # Contract 1: ESM24 (Mar)
    for i in range(200):
        ts = base_time + __import__('datetime').timedelta(minutes=i)
        bars.append({
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
    
    # Contract 2: ESU24 (Jun) - starts later
    base_time2 = base_time + __import__('datetime').timedelta(days=5)
    for i in range(200):
        ts = base_time2 + __import__('datetime').timedelta(minutes=i)
        bars.append({
            "timestamp": ts,
            "open": 4510.0 + i * 0.01,
            "high": 4510.25 + i * 0.01,
            "low": 4509.75 + i * 0.01,
            "close": 4510.10 + i * 0.01,
            "volume": 1000,
            "symbol": "ES",
            "contract": "ESU24",
            "frequency": "1min",
        })
    
    return pl.DataFrame(bars)


# Pytest markers
def pytest_configure(config):
    config.addinivalue_line("markers", "slow: marks tests as slow")
    config.addinivalue_line("markers", "integration: marks tests as integration tests")
    config.addinivalue_line("markers", "requires_data: marks tests as requiring data files")