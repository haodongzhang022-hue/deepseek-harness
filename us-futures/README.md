# US Futures Quantitative Trading System

A clean, modular quantitative trading system focused on US futures (CME, CBOT, NYMEX, COMEX).

## Architecture

```
us-futures/
├── config/                 # YAML configuration files
│   ├── settings.yaml       # Global settings
│   ├── symbols.yaml        # Contract specifications (27 symbols)
│   ├── logging.yaml        # Logging configuration
│   └── triggers.yaml       # Monitoring/risk triggers
├── data/                   # Data layer (P0 - complete)
│   ├── schema.py           # Pydantic models (Bar, Tick, ContractSpec, etc.)
│   ├── validation.py       # DataIntegrityValidator (3 iron laws)
│   ├── providers/          # Data source adapters
│   │   ├── base.py         # Abstract DataProvider interface
│   │   └── local_csv.py    # Local CSV/Parquet provider (zero deps)
│   ├── storage/            # Storage backends
│   │   └── duckdb_store.py # DuckDB columnar storage
│   ├── alignment.py        # Multi-frequency resampling, continuous contracts
│   └── pipeline.py         # ETL orchestration (incremental, backfill)
├── features/               # Feature engineering (P1 - next)
├── models/                 # ML models (P2 - next)
│   ├── dl/                 # Deep learning (PatchTST, etc.)
│   └── rl/                 # Reinforcement learning (SAC, PPO, etc.)
├── backtest/               # Vectorized backtesting
├── execution/              # Paper/live execution, broker adapters
├── monitoring/             # Real-time monitoring, alerting
├── scripts/                # CLI entry points
│   └── download_data.py    # Data download/sample generation
└── tests/                  # Test suite (TDD)
```

## Quick Start

### Install Dependencies

```bash
cd us-futures
uv sync  # or: pip install -e ".[dev]"
```

### Generate Sample Data

```bash
# Generate 30 days of 1min sample data for core symbols
python scripts/download_data.py --generate-sample --symbols ES NQ CL GC --days 30

# List available symbols
python scripts/download_data.py --list-symbols
```

### Run Tests

```bash
# All tests
pytest tests/ -v

# Data layer only
pytest tests/data/ -v

# With coverage
pytest tests/ --cov=us_futures --cov-report=term-missing
```

### Run ETL Pipeline

```python
from us_futures.data import ETLPipeline, PipelineConfig, DataFrequency
from us_futures.data.storage import get_store
from us_futures.data.providers import LocalFileProvider, get_provider_registry
from datetime import datetime, timezone

# Setup
provider = LocalFileProvider(config={"data_root": "./data", "format": "parquet"})
provider.connect()

registry = get_provider_registry()
registry.register(provider, default=True)

store = get_store()
config = PipelineConfig(
    symbols=["ES", "NQ", "CL"],
    frequencies=[DataFrequency.MIN_1, DataFrequency.MIN_5, DataFrequency.MIN_15],
    provider_name="local_csv",
    storage=store,
    create_continuous=True,
    resample_higher=True,
)

pipeline = ETLPipeline(config)

# Run backfill (last 30 days)
end = datetime.now(timezone.utc)
start = end - timedelta(days=30)
results = pipeline.run(start, end, force_full_refresh=True)

for r in results:
    print(f"{r.symbol} {r.frequency}: {r.bars_written} bars, valid={r.success}")
```

## Key Features

### Data Integrity (Iron Laws)
1. **No Lookahead** - Timestamps validated against receipt time
2. **Continuity** - Gap detection with session-aware logic
3. **Anomaly Detection** - Price jumps, volume spikes, OHLC violations

### Multi-Frequency Support
- Raw: 1min (tick-level if available)
- Modeling: 5min, 15min, 1H
- Regime: 4H, 1D
- All derived from raw via `resample_bars()` with proper OHLC aggregation

### Continuous Contracts
- Volume-based roll detection
- Price adjustment at roll (back-adjustment)
- Configurable roll rules per symbol

### Storage
- DuckDB for local development (zero-config, columnar, SQL)
- Partitioned by symbol, year, month
- TimescaleDB/PostgreSQL ready for production

### Monitoring Triggers (30+ rules)
- Data quality: gaps, staleness, anomalies
- Model health: prediction drift, regime confidence, RL policy divergence
- Portfolio risk: daily loss, drawdown, concentration, VaR
- Execution: slippage, fill rate, rejects
- Market regime: transitions, vol regime changes
- System: latency, memory, disk

## Configuration

All configuration via YAML files in `config/`:

- `settings.yaml` - Global params (universe, sessions, validation thresholds, risk limits)
- `symbols.yaml` - 27 contract specs (tick size, margin, expiration months, roll rules)
- `triggers.yaml` - 30+ monitoring rules with actions
- `logging.yaml` - Structured JSON + pretty console logging

Environment variables supported via `${VAR:-default}` syntax.

## Next Steps (Roadmap)

| Phase | Focus | Status |
|-------|-------|--------|
| **P0** | Data layer (ingestion, validation, storage, continuous contracts) | ✅ Done |
| **P1** | Feature engineering (microstructure, technical, regime, factor builder) | 🔄 Next |
| **P2** | DL: PatchTST pre-training → fine-tuning → factor fusion | ⏳ |
| **P3** | RL: High-fidelity sim → CQL offline → SAC/PPO online | ⏳ |
| **P4** | Backtesting: walk-forward, metrics, reporting | ⏳ |
| **P5** | Paper trading → Live (IBKR, Rithmic) | ⏳ |

## Design Principles

1. **Modularity** - Each layer independent, swappable providers/storage
2. **Type Safety** - Pydantic models throughout, validated at boundaries
3. **Observability** - Structured logging, metrics, trigger-based alerting
4. **Reproducibility** - Versioned data, deterministic pipelines, config-as-code
5. **Safety First** - Hard risk rules always enforced, RL within rule boundaries
6. **No Lookahead** - Enforced at data ingestion, validation, and backtest levels

## License

Proprietary - Internal use only.