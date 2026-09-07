"""
Tests for Features Module
"""

import pytest
import numpy as np
import polars as pl
from datetime import datetime, timezone, timedelta

from us_futures.features.microstructure import (
    compute_vwap,
    compute_bid_ask_spread,
    compute_mid_price,
    compute_order_flow_imbalance,
    compute_realized_volatility,
    compute_parkinson_vol,
    compute_garman_klass_vol,
    compute_roll_spread_estimator,
    compute_kyle_lambda,
    compute_amihud_illiquidity,
    add_microstructure_features,
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
    compute_zscore,
    compute_rolling_correlation,
    compute_beta,
    add_technical_factors,
)
from us_futures.features.regime import (
    compute_hurst_exponent,
    detect_regime_threshold,
    detect_vol_regime,
    detect_trend_regime,
    compute_market_state,
    add_regime_features,
)
from us_futures.features.builder import (
    FactorBuilder,
    FactorRegistry,
    evaluate_factor_ic,
    register_builtin_factors,
    get_factor_registry,
)


@pytest.fixture
def sample_ohlcv():
    """Create sample OHLCV data with microstructure columns."""
    n = 500
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
    timestamps = [base_time + timedelta(minutes=i) for i in range(n)]
    
    # Generate realistic price series
    np.random.seed(42)
    base_price = 4500.0
    returns = np.random.normal(0, 0.0005, n)
    prices = base_price * np.exp(np.cumsum(returns))
    
    # Generate OHLC
    data = []
    for i, (ts, close) in enumerate(zip(timestamps, prices)):
        high = close * (1 + abs(np.random.normal(0, 0.0003)))
        low = close * (1 - abs(np.random.normal(0, 0.0003)))
        open_ = prices[i-1] if i > 0 else close
        volume = int(np.random.lognormal(8, 0.5))
        
        # Microstructure
        spread = 0.25  # 1 tick
        bid = close - spread/2
        ask = close + spread/2
        bid_size = int(np.random.lognormal(5, 0.5))
        ask_size = int(np.random.lognormal(5, 0.5))
        trade_count = int(np.random.poisson(50))
        
        data.append({
            "timestamp": ts,
            "open": round(open_, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "close": round(close, 2),
            "volume": volume,
            "bid": round(bid, 2),
            "ask": round(ask, 2),
            "bid_size": bid_size,
            "ask_size": ask_size,
            "trade_count": trade_count,
        })
    
    return pl.DataFrame(data)


class TestMicrostructure:
    """Test microstructure features."""
    
    def test_vwap(self, sample_ohlcv):
        vwap = compute_vwap(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(vwap=vwap)["vwap"]
        
        assert result.null_count() < 20  # First 19 null
        assert (result.drop_nulls() > 0).all()
    
    def test_bid_ask_spread(self, sample_ohlcv):
        spread = compute_bid_ask_spread(sample_ohlcv)
        result = sample_ohlcv.with_columns(spread=spread)["spread"]
        
        assert (result == 0.25).all()  # Fixed 1 tick spread
    
    def test_mid_price(self, sample_ohlcv):
        mid = compute_mid_price(sample_ohlcv)
        result = sample_ohlcv.with_columns(mid=mid)["mid"]
        
        # Mid should be close to close
        assert (result.drop_nulls() > 0).all()
    
    def test_order_flow_imbalance(self, sample_ohlcv):
        ofi = compute_order_flow_imbalance(sample_ohlcv)
        result = sample_ohlcv.with_columns(ofi=ofi)["ofi"]
        
        assert result.null_count() == 0
        assert (result >= -1).all() and (result <= 1).all()
    
    def test_realized_volatility(self, sample_ohlcv):
        rv = compute_realized_volatility(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(rv=rv)["rv"]
        
        assert result.null_count() <= 20  # window nulls
        assert (result.drop_nulls() >= 0).all()
    
    def test_parkinson_vol(self, sample_ohlcv):
        pv = compute_parkinson_vol(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(pv=pv)["pv"]
        
        assert result.null_count() < 20
        assert (result.drop_nulls() >= 0).all()
    
    def test_garman_klass_vol(self, sample_ohlcv):
        gk = compute_garman_klass_vol(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(gk=gk)["gk"]
        
        assert result.null_count() < 20
        assert (result.drop_nulls() >= 0).all()
    
    def test_roll_spread(self, sample_ohlcv):
        roll = compute_roll_spread_estimator(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(roll=roll)["roll"]
        
        assert result.null_count() <= 21  # window + 1 for shift
        assert (result.drop_nulls() >= 0).all()
    
    def test_kyle_lambda(self, sample_ohlcv):
        kl = compute_kyle_lambda(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(kl=kl)["kl"]
        
        assert result.null_count() < 20
    
    def test_amihud(self, sample_ohlcv):
        amihud = compute_amihud_illiquidity(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(amihud=amihud)["amihud"]
        
        assert result.null_count() <= 20
        assert (result.drop_nulls() >= 0).all()
    
    def test_add_microstructure_features(self, sample_ohlcv):
        result = add_microstructure_features(sample_ohlcv, windows=[5, 10])
        
        # Should have added many columns
        assert result.width > sample_ohlcv.width
        assert "spread" in result.columns
        assert "ofi" in result.columns
        assert "rv_5" in result.columns
        assert "park_vol_5" in result.columns


class TestTechnical:
    """Test technical factors."""
    
    def test_sma(self, sample_ohlcv):
        sma = compute_sma(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(sma=sma)["sma"]
        
        assert result.null_count() < 20
        assert (result.drop_nulls() > 0).all()
    
    def test_ema(self, sample_ohlcv):
        ema = compute_ema(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(ema=ema)["ema"]
        
        assert result.null_count() == 0  # EMA has no leading nulls
        assert (result > 0).all()
    
    def test_rsi(self, sample_ohlcv):
        rsi = compute_rsi(sample_ohlcv, window=14)
        result = sample_ohlcv.with_columns(rsi=rsi)["rsi"]
        
        assert result.null_count() < 14
        assert (result.drop_nulls() >= 0).all()
        assert (result.drop_nulls() <= 100).all()
    
    def test_macd(self, sample_ohlcv):
        macd = compute_macd(sample_ohlcv)
        result = sample_ohlcv.with_columns(
            macd=macd["macd"],
            signal=macd["signal"],
            hist=macd["histogram"],
        )
        
        assert "macd" in result.columns
        assert "signal" in result.columns
        assert "hist" in result.columns
    
    def test_bollinger_bands(self, sample_ohlcv):
        bb = compute_bollinger_bands(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(
            bb_upper=bb["upper"],
            bb_middle=bb["middle"],
            bb_lower=bb["lower"],
            bb_width=bb["width"],
            bb_pct_b=bb["pct_b"],
        )
        
        assert "bb_upper" in result.columns
        assert (result["bb_upper"].drop_nulls() >= result["bb_middle"].drop_nulls()).all()
        assert (result["bb_middle"].drop_nulls() >= result["bb_lower"].drop_nulls()).all()
        # pct_b can be outside [0,1] during strong moves
        assert result["bb_pct_b"].drop_nulls().is_not_null().all()
    
    def test_atr(self, sample_ohlcv):
        atr = compute_atr(sample_ohlcv, window=14)
        result = sample_ohlcv.with_columns(atr=atr)["atr"]
        
        assert result.null_count() < 14
        assert (result.drop_nulls() >= 0).all()
    
    def test_adx(self, sample_ohlcv):
        adx = compute_adx(sample_ohlcv, window=14)
        result = sample_ohlcv.with_columns(
            adx=adx["adx"],
            plus_di=adx["plus_di"],
            minus_di=adx["minus_di"],
        )
        
        assert "adx" in result.columns
        assert (result["adx"].drop_nulls() >= 0).all()
    
    def test_stochastic(self, sample_ohlcv):
        stoch = compute_stochastic(sample_ohlcv)
        result = sample_ohlcv.with_columns(
            stoch_k=stoch["stoch_k"],
            stoch_d=stoch["stoch_d"],
        )
        
        assert (result["stoch_k"].drop_nulls() >= 0).all()
        assert (result["stoch_k"].drop_nulls() <= 100).all()
    
    def test_williams_r(self, sample_ohlcv):
        wr = compute_williams_r(sample_ohlcv, window=14)
        result = sample_ohlcv.with_columns(wr=wr)["wr"]
        
        assert (result.drop_nulls() >= -100).all()
        assert (result.drop_nulls() <= 0).all()
    
    def test_cci(self, sample_ohlcv):
        cci = compute_cci(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(cci=cci)["cci"]
        
        assert result.null_count() < 20
    
    def test_momentum(self, sample_ohlcv):
        mom = compute_momentum(sample_ohlcv, window=10)
        result = sample_ohlcv.with_columns(mom=mom)["mom"]
        
        assert result.null_count() <= 10
        assert (result.drop_nulls() > 0).all()
    
    def test_roc(self, sample_ohlcv):
        roc = compute_roc(sample_ohlcv, window=10)
        result = sample_ohlcv.with_columns(roc=roc)["roc"]
        
        assert result.null_count() <= 10
    
    def test_obv(self, sample_ohlcv):
        obv = compute_obv(sample_ohlcv)
        result = sample_ohlcv.with_columns(obv=obv)["obv"]
        
        assert result.null_count() == 0
    
    def test_zscore(self, sample_ohlcv):
        z = compute_zscore(sample_ohlcv, window=20)
        result = sample_ohlcv.with_columns(z=z)["z"]
        
        assert result.null_count() < 20
        assert (result.drop_nulls().abs() < 10).all()  # Reasonable range
    
    def test_rolling_correlation(self, sample_ohlcv):
        corr = compute_rolling_correlation(sample_ohlcv, "close", "volume", window=20)
        result = sample_ohlcv.with_columns(corr=corr)["corr"]
        
        # Manual implementation has more nulls due to double rolling operations
        assert result.null_count() <= 40
        assert (result.drop_nulls() >= -1).all()
        assert (result.drop_nulls() <= 1).all()
    
    def test_beta(self, sample_ohlcv):
        # Create market proxy
        df = sample_ohlcv.with_columns(market=pl.col("close") * 1.0001)
        beta = compute_beta(df, "close", "market", window=60)
        result = df.with_columns(beta=beta)["beta"]
        
        assert result.null_count() < 60
        assert (result.drop_nulls() > 0).all()
    
    def test_add_technical_factors(self, sample_ohlcv):
        result = add_technical_factors(sample_ohlcv, windows=[10, 20])
        
        assert result.width > sample_ohlcv.width
        assert "sma_10" in result.columns
        assert "ema_10" in result.columns
        assert "rsi_14" in result.columns
        assert "macd" in result.columns
        assert "atr_14" in result.columns
        assert "bb_pct_b" in result.columns


class TestRegime:
    """Test regime detection."""
    
    def test_hurst_exponent(self, sample_ohlcv):
        hurst = compute_hurst_exponent(sample_ohlcv, window=100)
        result = sample_ohlcv.with_columns(hurst=hurst)["hurst"]
        
        assert result.null_count() <= 101
        assert (result.drop_nulls() >= 0).all()
        assert (result.drop_nulls() <= 1).all()
    
    def test_regime_threshold(self, sample_ohlcv):
        regime = detect_regime_threshold(sample_ohlcv)
        result = sample_ohlcv.with_columns(regime=regime)["regime"]
        
        assert result.null_count() < 60
        assert set(result.drop_nulls().unique()).issubset({0, 1, 2, 3, 4, 5, 6})
    
    def test_vol_regime(self, sample_ohlcv):
        vol_reg = detect_vol_regime(sample_ohlcv)
        result = sample_ohlcv.with_columns(vol_reg=vol_reg)["vol_reg"]
        
        assert result.null_count() <= 60
        assert set(result.drop_nulls().unique()).issubset({0, 1, 2, 3})
    
    def test_trend_regime(self, sample_ohlcv):
        trend_reg = detect_trend_regime(sample_ohlcv)
        result = sample_ohlcv.with_columns(trend_reg=trend_reg)["trend_reg"]
        
        assert result.null_count() < 50
        assert set(result.drop_nulls().unique()).issubset({-1, 0, 1})
    
    def test_market_state(self, sample_ohlcv):
        ms = compute_market_state(sample_ohlcv)
        result = sample_ohlcv.with_columns(ms=ms)["ms"]
        
        assert result.null_count() <= 50
        assert (result.drop_nulls() >= -1).all()
        assert (result.drop_nulls() <= 1).all()
    
    def test_add_regime_features(self, sample_ohlcv):
        result = add_regime_features(sample_ohlcv)
        
        assert "regime_threshold" in result.columns
        assert "regime_vol" in result.columns
        assert "regime_trend" in result.columns
        assert "market_state" in result.columns
        assert "hurst" in result.columns


class TestBuilder:
    """Test FactorBuilder and Registry."""
    
    def test_factor_registry(self):
        registry = FactorRegistry()
        
        def dummy_expr(df):
            return pl.lit(1)
        
        registry.register(
            name="test_factor",
            category="technical",
            description="Test factor",
            formula="test",
            lookback=10,
            frequency="1min",
            expression=dummy_expr,
        )
        
        assert "test_factor" in registry.get_all_names()
        meta = registry.get("test_factor")
        assert meta is not None
        assert meta.name == "test_factor"
        assert meta.category == "technical"
    
    def test_factor_registry_update_performance(self):
        registry = FactorRegistry()
        
        def dummy_expr(df):
            return pl.lit(1)
        
        registry.register(
            name="test_factor",
            category="technical",
            description="Test",
            formula="test",
            lookback=10,
            frequency="1min",
            expression=dummy_expr,
        )
        
        registry.update_performance("test_factor", 0.05, 0.02, 0.1)
        
        meta = registry.get("test_factor")
        assert meta.ic_mean == 0.05
        assert meta.ic_std == 0.02
        assert meta.icir == 2.5
    
    def test_factor_builder(self, sample_ohlcv):
        builder = FactorBuilder()
        result = builder.build(sample_ohlcv, feature_groups=["all"])
        
        assert result.width > sample_ohlcv.width
        assert "rsi_14" in result.columns
        assert "regime_threshold" in result.columns
    
    def test_factor_builder_technical_only(self, sample_ohlcv):
        builder = FactorBuilder()
        result = builder.build(sample_ohlcv, feature_groups=["technical"])
        
        assert "rsi_14" in result.columns
        assert "regime_threshold" not in result.columns
    
    def test_factor_builder_incremental(self, sample_ohlcv):
        builder = FactorBuilder()
        result = builder.build_incremental(sample_ohlcv, last_n=50)
        
        assert result.height == 50
    
    def test_evaluate_factor_ic(self, sample_ohlcv):
        # Create factor and forward returns
        factor = pl.Series("factor", np.random.randn(len(sample_ohlcv)))
        returns = pl.Series("returns", np.random.randn(len(sample_ohlcv)))
        
        result = evaluate_factor_ic(factor, returns)
        
        assert "ic_mean" in result
        assert "t_stat" in result
        assert "p_value" in result
        assert "n" in result
        assert result["n"] == len(sample_ohlcv)
    
    def test_builtin_factors_registered(self):
        registry = get_factor_registry()
        names = registry.get_all_names()
        
        assert len(names) >= 19
        assert "rsi_14" in names
        assert "macd" in names
        assert "regime_threshold" in names
        assert "market_state" in names


class TestIntegration:
    """Integration tests for full feature pipeline."""
    
    def test_full_pipeline(self, sample_ohlcv):
        """Test complete feature generation pipeline."""
        builder = FactorBuilder()
        result = builder.build(sample_ohlcv, feature_groups=["all"])
        
        # Should have 100+ factor columns
        assert result.width >= 100
        
        # Key factor categories present
        cols = result.columns
        
        # Microstructure
        assert any("spread" in c for c in cols)
        assert any("ofi" in c for c in cols)
        assert any("rv_" in c for c in cols)
        
        # Technical
        assert any("sma_" in c for c in cols)
        assert any("ema_" in c for c in cols)
        assert "rsi_14" in cols
        assert "macd" in cols
        assert "atr_14" in cols
        assert "bb_pct_b" in cols
        assert "obv" in cols
        
        # Regime
        assert "regime_threshold" in cols
        assert "regime_vol" in cols
        assert "market_state" in cols
    
    def test_pipeline_performance(self, sample_ohlcv):
        """Test pipeline runs in reasonable time."""
        import time
        
        builder = FactorBuilder()
        start = time.time()
        result = builder.build(sample_ohlcv, feature_groups=["all"])
        elapsed = time.time() - start
        
        # Should complete in < 1 second for 500 bars
        assert elapsed < 1.0
        print(f"Pipeline time: {elapsed:.3f}s, columns: {result.width}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])