"""
Features Package - Feature Engineering Layer
"""

from us_futures.features.microstructure import (
    compute_vwap,
    compute_twap,
    compute_bid_ask_spread,
    compute_mid_price,
    compute_order_flow_imbalance,
    compute_volume_weighted_mid,
    compute_realized_volatility,
    compute_parkinson_vol,
    compute_garman_klass_vol,
    compute_roll_spread_estimator,
    compute_kyle_lambda,
    compute_amihud_illiquidity,
)
from us_futures.features.technical import (
    compute_sma,
    compute_ema,
    compute_rsi,
    compute_macd,
    compute_bollinger_bands,
    compute_atr,
    compute_adx,
    compute_stochastic,
    compute_williams_r,
    compute_cci,
    compute_momentum,
    compute_roc,
    compute_obv,
    compute_vwap_distance,
    compute_zscore,
    compute_rolling_correlation,
    compute_beta,
)
from us_futures.features.regime import (
    detect_regime_hmm,
    detect_regime_threshold,
    detect_vol_regime,
    detect_trend_regime,
    compute_hurst_exponent,
    compute_market_state,
)
from us_futures.features.builder import (
    FactorBuilder,
    FactorRegistry,
    create_factor_pipeline,
)

__all__ = [
    # Microstructure
    "compute_vwap",
    "compute_twap",
    "compute_bid_ask_spread",
    "compute_mid_price",
    "compute_order_flow_imbalance",
    "compute_volume_weighted_mid",
    "compute_realized_volatility",
    "compute_parkinson_vol",
    "compute_garman_klass_vol",
    "compute_roll_spread_estimator",
    "compute_kyle_lambda",
    "compute_amihud_illiquidity",
    # Technical
    "compute_sma",
    "compute_ema",
    "compute_rsi",
    "compute_macd",
    "compute_bollinger_bands",
    "compute_atr",
    "compute_adx",
    "compute_stochastic",
    "compute_williams_r",
    "compute_cci",
    "compute_momentum",
    "compute_roc",
    "compute_obv",
    "compute_vwap_distance",
    "compute_zscore",
    "compute_rolling_correlation",
    "compute_beta",
    # Regime
    "detect_regime_hmm",
    "detect_regime_threshold",
    "detect_vol_regime",
    "detect_trend_regime",
    "compute_hurst_exponent",
    "compute_market_state",
    # Builder
    "FactorBuilder",
    "FactorRegistry",
    "create_factor_pipeline",
]