#!/usr/bin/env python
"""
Historical Data Download / Sample Data Generation
Usage:
    python scripts/download_data.py --symbols ES NQ CL --days 30 --format parquet
    python scripts/download_data.py --generate-sample --symbols ES NQ --days 10
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from loguru import logger

from us_futures.config import get_settings, load_symbols_config, reload_configs
from us_futures.data.providers import LocalFileProvider, create_sample_data
from us_futures.data.schema import DataFrequency


def setup_logging():
    """Configure logging for script."""
    logger.remove()
    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
        level="INFO",
    )


def generate_sample_data(symbols: list[str], days: int, freq: DataFrequency, format: str, data_root: Path):
    """Generate synthetic sample data for testing."""
    logger.info(f"Generating sample data for {symbols} ({days} days, {freq.value}, {format})")
    
    provider = LocalFileProvider(config={"data_root": str(data_root), "format": format})
    provider.connect()
    
    for symbol in symbols:
        try:
            file_path = create_sample_data(
                symbol=symbol,
                frequency=freq,
                days=days,
                data_root=data_root,
                file_format=format,
            )
            logger.success(f"Created {file_path}")
        except Exception as e:
            logger.error(f"Failed to generate {symbol}: {e}")


def download_from_provider(
    symbols: list[str],
    start: datetime,
    end: datetime,
    freq: DataFrequency,
    provider_name: str,
    data_root: Path,
    format: str,
):
    """Download from configured provider (Polygon, CME, etc.)."""
    # This would be implemented when real API credentials are available
    logger.warning("Live provider download not yet implemented. Use --generate-sample for now.")
    logger.info("To implement: add provider classes in data/providers/ (PolygonProvider, CMEProvider, etc.)")


def main():
    parser = argparse.ArgumentParser(description="Download or generate historical futures data")
    parser.add_argument("--symbols", nargs="+", default=["ES", "NQ", "CL", "GC"], help="Symbols to process")
    parser.add_argument("--days", type=int, default=30, help="Days of history (for sample generation)")
    parser.add_argument("--start", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--freq", type=str, default="1min", choices=["1min", "5min", "15min", "1H", "1D"], help="Frequency")
    parser.add_argument("--format", type=str, default="parquet", choices=["parquet", "csv"], help="File format")
    parser.add_argument("--provider", type=str, default="local_csv", help="Data provider name")
    parser.add_argument("--data-root", type=str, default="./data", help="Data root directory")
    parser.add_argument("--generate-sample", action="store_true", help="Generate synthetic sample data")
    parser.add_argument("--list-symbols", action="store_true", help="List available symbols from config")
    
    args = parser.parse_args()
    setup_logging()
    reload_configs()

    settings = get_settings()
    symbols_config = load_symbols_config()

    if args.list_symbols:
        all_symbols = list(symbols_config.get("symbols", {}).keys())
        core = settings.get("universe", {}).get("core", [])
        extended = settings.get("universe", {}).get("extended", [])
        print("Core symbols:", " ".join(core))
        print("Extended symbols:", " ".join(extended))
        print("All configured:", " ".join(all_symbols))
        return

    # Parse frequency
    freq_map = {
        "1min": DataFrequency.MIN_1,
        "5min": DataFrequency.MIN_5,
        "15min": DataFrequency.MIN_15,
        "1H": DataFrequency.HOUR_1,
        "1D": DataFrequency.DAY_1,
    }
    freq = freq_map.get(args.freq, DataFrequency.MIN_1)

    data_root = Path(args.data_root)
    data_root.mkdir(parents=True, exist_ok=True)

    if args.generate_sample:
        generate_sample_data(args.symbols, args.days, freq, args.format, data_root)
    else:
        # Parse dates
        if args.start:
            start = datetime.fromisoformat(args.start).replace(tzinfo=timezone.utc)
        else:
            start = datetime.now(timezone.utc) - timedelta(days=args.days)
        
        if args.end:
            end = datetime.fromisoformat(args.end).replace(tzinfo=timezone.utc)
        else:
            end = datetime.now(timezone.utc)

        download_from_provider(args.symbols, start, end, freq, args.provider, data_root, args.format)

    logger.info("Done")


if __name__ == "__main__":
    main()