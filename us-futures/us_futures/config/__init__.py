"""
Configuration Loader
Loads YAML configs with environment variable substitution.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from loguru import logger


@lru_cache(maxsize=4)
def load_yaml_config(path: str | Path) -> dict[str, Any]:
    """Load YAML config with ${ENV_VAR} substitution."""
    path = Path(path)
    if not path.exists():
        logger.warning(f"Config file not found: {path}")
        return {}

    content = path.read_text(encoding="utf-8")
    
    # Simple env var substitution: ${VAR} or ${VAR:-default}
    import re
    def replace_env(match):
        var_expr = match.group(1)
        if ":-" in var_expr:
            var, default = var_expr.split(":-", 1)
            return __import__("os").getenv(var, default)
        return __import__("os").getenv(var_expr, match.group(0))
    
    content = re.sub(r"\$\{([^}]+)\}", replace_env, content)
    
    return yaml.safe_load(content) or {}


@lru_cache(maxsize=1)
def get_settings() -> dict[str, Any]:
    """Load main settings.yaml."""
    config_dir = Path(__file__).parent
    return load_yaml_config(config_dir / "settings.yaml")


@lru_cache(maxsize=1)
def load_symbols_config() -> dict[str, Any]:
    """Load symbols.yaml."""
    config_dir = Path(__file__).parent
    return load_yaml_config(config_dir / "symbols.yaml")


@lru_cache(maxsize=1)
def load_logging_config() -> dict[str, Any]:
    """Load logging.yaml."""
    config_dir = Path(__file__).parent
    return load_yaml_config(config_dir / "logging.yaml")


@lru_cache(maxsize=1)
def load_triggers_config() -> dict[str, Any]:
    """Load triggers.yaml."""
    config_dir = Path(__file__).parent
    return load_yaml_config(config_dir / "triggers.yaml")


def get_symbol_spec(symbol: str) -> dict[str, Any] | None:
    """Get single symbol specification."""
    symbols = load_symbols_config().get("symbols", {})
    return symbols.get(symbol)


def get_all_symbols() -> list[str]:
    """Get list of all configured symbols."""
    symbols = load_symbols_config().get("symbols", {})
    return list(symbols.keys())


def get_core_symbols() -> list[str]:
    """Get core universe symbols."""
    return get_settings().get("universe", {}).get("core", [])


def get_extended_symbols() -> list[str]:
    """Get extended universe symbols."""
    return get_settings().get("universe", {}).get("extended", [])


def reload_configs() -> None:
    """Clear all config caches (for testing/hot-reload)."""
    load_yaml_config.cache_clear()
    get_settings.cache_clear()
    load_symbols_config.cache_clear()
    load_logging_config.cache_clear()
    load_triggers_config.cache_clear()
    logger.info("Config caches cleared")