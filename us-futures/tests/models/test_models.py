"""
Tests for Models Package
"""

import pytest
import numpy as np
import torch
import polars as pl
from datetime import datetime, timezone, timedelta

from us_futures.models.dl.patchtst import (
    PatchTSTConfig,
    PatchTSTBackbone,
    PatchTSTForPretraining,
    PatchTSTForFinetuning,
    create_pretraining_dataloader,
    create_finetuning_dataloader,
)
from us_futures.models.rl.env import (
    TradingEnv,
    RLConfig,
    create_rl_env,
)
from us_futures.models.rl.agents import (
    SACAgent,
    PPOAgent,
    CQLAgent,
    ReplayBuffer,
    RolloutBuffer,
)
from us_futures.data.schema import ContractSpec, get_contract_spec


@pytest.fixture
def sample_data():
    """Create sample OHLCV data with factors."""
    n = 1000
    base_time = datetime(2024, 1, 15, 13, 30, tzinfo=timezone.utc)
    timestamps = [base_time + timedelta(minutes=i) for i in range(n)]
    
    np.random.seed(42)
    base_price = 4500.0
    returns = np.random.normal(0, 0.0005, n)
    prices = base_price * np.exp(np.cumsum(returns))
    
    data = []
    for i, (ts, close) in enumerate(zip(timestamps, prices)):
        high = close * (1 + abs(np.random.normal(0, 0.0003)))
        low = close * (1 - abs(np.random.normal(0, 0.0003)))
        open_ = prices[i-1] if i > 0 else close
        volume = int(np.random.lognormal(8, 0.5))
        
        data.append({
            "timestamp": ts,
            "open": round(open_, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "close": round(close, 2),
            "volume": volume,
        })
    
    df = pl.DataFrame(data)
    
    # Create factors
    factors = df.select(["timestamp"])
    for j in range(50):
        factor_vals = np.random.randn(n)
        factors = factors.with_columns(pl.Series(f"factor_{j}", factor_vals))
    
    return df, factors


class TestPatchTST:
    """Test PatchTST models."""
    
    def test_config(self):
        config = PatchTSTConfig(
            n_vars=50,
            seq_len=256,
            pred_len=30,
            patch_len=16,
            stride=8,
            d_model=128,
            n_heads=4,
            n_layers=2,
        )
        
        assert config.n_patches == (256 - 16) // 8 + 1
        assert config.n_patches == 31
    
    def test_backbone(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
        )
        
        model = PatchTSTBackbone(config)
        
        # Input: [batch, n_vars, seq_len]
        x = torch.randn(4, 10, 128)
        out = model(x)
        
        assert out.shape == (4, config.n_patches, 64)
    
    def test_backbone_with_mask(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
        )
        
        model = PatchTSTBackbone(config)
        
        x = torch.randn(4, 10, 128)
        mask = torch.zeros(4, config.n_patches, dtype=torch.bool)
        mask[:, :5] = True  # Mask first 5 patches
        
        out = model(x, mask)
        
        assert out.shape == (4, config.n_patches, 64)
    
    def test_pretraining_model(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
            mask_ratio=0.4,
        )
        
        model = PatchTSTForPretraining(config)
        
        x = torch.randn(4, 10, 128)
        mask = torch.zeros(4, config.n_patches, dtype=torch.bool)
        mask[:, :5] = True
        
        output = model(x, mask)
        
        assert "reconstructed" in output
        assert "embeddings" in output
        assert output["reconstructed"].shape == (4, config.n_patches, 10 * 16)
    
    def test_pretraining_loss(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
        )
        
        model = PatchTSTForPretraining(config)
        
        x = torch.randn(4, 10, 128)
        mask = torch.zeros(4, config.n_patches, dtype=torch.bool)
        mask[:, :5] = True
        target = torch.randn(4, 10, 128)
        
        loss = model.compute_loss(x, mask, target)
        
        assert loss.item() >= 0
    
    def test_finetuning_forecasting(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            pred_len=20,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
        )
        
        model = PatchTSTForFinetuning(config, task="forecasting")
        
        x = torch.randn(4, 10, 128)
        out = model(x)
        
        assert out.shape == (4, 10 * 20)  # n_vars * pred_len
    
    def test_finetuning_classification(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
            n_classes=3,
        )
        
        model = PatchTSTForFinetuning(config, task="classification")
        
        x = torch.randn(4, 10, 128)
        out = model(x)
        
        assert out.shape == (4, 3)
    
    def test_freeze_unfreeze(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
            d_model=64,
            n_heads=2,
            n_layers=2,
        )
        
        model = PatchTSTForFinetuning(config, task="forecasting")
        
        # Freeze
        model.freeze_backbone()
        for param in model.backbone.parameters():
            assert not param.requires_grad
        
        # Unfreeze
        model.unfreeze_backbone()
        for param in model.backbone.parameters():
            assert param.requires_grad
    
    def test_dataloaders(self):
        config = PatchTSTConfig(
            n_vars=10,
            seq_len=128,
            patch_len=16,
            stride=8,
        )
        
        data = torch.randn(100, 10, 128)
        
        # Pretraining
        loader = create_pretraining_dataloader(data, config, batch_size=16)
        batch = next(iter(loader))
        
        assert "input" in batch
        assert "target" in batch
        assert "mask" in batch
        assert batch["input"].shape == (16, 10, 128)
        assert batch["mask"].shape == (16, config.n_patches)
        
        # Fine-tuning
        targets = torch.randn(100, 10, 20)
        loader = create_finetuning_dataloader(data, targets, config, batch_size=16)
        batch = next(iter(loader))
        
        assert "input" in batch
        assert "forecast_target" in batch


class TestRLConfig:
    """Test RL configuration."""
    
    def test_default_config(self):
        config = RLConfig()
        
        assert config.symbol == "ES"
        assert config.initial_capital == 1_000_000
        assert config.max_position == 10
        assert config.transaction_cost_bps == 1.0
    
    def test_custom_config(self):
        config = RLConfig(
            symbol="NQ",
            initial_capital=500_000,
            max_position=5,
            reward_type="risk_adjusted",
        )
        
        assert config.symbol == "NQ"
        assert config.initial_capital == 500_000
        assert config.max_position == 5
        assert config.reward_type == "risk_adjusted"


class TestTradingEnv:
    """Test Trading Environment."""
    
    def test_env_reset(self, sample_data):
        data, factors = sample_data
        config = RLConfig(lookback=64, n_factors=20)
        
        env = TradingEnv(data, factors, config, mode="eval")
        obs, info = env.reset()
        
        assert obs.shape == (64, 20)
        assert info["step"] == 64
        assert info["equity"] == 1_000_000
    
    def test_env_step(self, sample_data):
        data, factors = sample_data
        config = RLConfig(lookback=64, n_factors=20)
        
        env = TradingEnv(data, factors, config, mode="eval")
        env.reset()
        
        # Take a long position
        action = np.array([0.5])  # 50% of max position
        obs, reward, terminated, truncated, info = env.step(action)
        
        assert obs.shape == (64, 20)
        assert isinstance(reward, float)
        assert info["position"] == 5.0  # 0.5 * 10
        assert info["trades"] == 1
    
    def test_env_short_position(self, sample_data):
        data, factors = sample_data
        config = RLConfig(lookback=64, n_factors=20)
        
        env = TradingEnv(data, factors, config, mode="eval")
        env.reset()
        
        # Take a short position
        action = np.array([-0.5])
        obs, reward, terminated, truncated, info = env.step(action)
        
        assert info["position"] == -5.0
    
    def test_env_termination(self, sample_data):
        data, factors = sample_data
        config = RLConfig(lookback=64, n_factors=20)
        
        env = TradingEnv(data, factors, config, mode="eval")
        env.reset()
        
        # Step to end
        for _ in range(len(data) - 64):
            action = np.array([0.0])
            obs, reward, terminated, truncated, info = env.step(action)
        
        assert terminated
    
    def test_env_metrics(self, sample_data):
        data, factors = sample_data
        config = RLConfig(lookback=64, n_factors=20)
        
        env = TradingEnv(data, factors, config)
        env.reset()
        
        # Take some steps
        for _ in range(10):
            env.step(np.array([0.1]))
        
        metrics = env.get_metrics()
        
        assert "total_return" in metrics
        assert "sharpe" in metrics
        assert "max_drawdown" in metrics
        assert "trades" in metrics


class TestSACAgent:
    """Test SAC Agent."""
    
    def test_sac_init(self):
        config = RLConfig()
        agent = SACAgent(config, obs_dim=1280, action_dim=1)  # 64 * 20
        
        assert agent.actor is not None
        assert agent.critic is not None
        assert agent.critic_target is not None
    
    def test_sac_select_action(self):
        config = RLConfig()
        agent = SACAgent(config, obs_dim=1280, action_dim=1)
        
        obs = np.random.randn(1280).astype(np.float32)
        action = agent.select_action(obs)
        
        assert action.shape == ()
        assert -1 <= action <= 1
    
    def test_sac_deterministic(self):
        config = RLConfig()
        agent = SACAgent(config, obs_dim=1280, action_dim=1)
        
        obs = np.random.randn(1280).astype(np.float32)
        action1 = agent.select_action(obs, deterministic=True)
        action2 = agent.select_action(obs, deterministic=True)
        
        # Deterministic should be consistent
        np.testing.assert_allclose(action1, action2, rtol=1e-5)
    
    def test_sac_update(self):
        config = RLConfig(batch_size=16)
        agent = SACAgent(config, obs_dim=10, action_dim=1)
        
        # Add some data
        for _ in range(100):
            agent.buffer.add(
                np.random.randn(10).astype(np.float32),
                np.random.randn(1).astype(np.float32),
                np.random.randn(),
                np.random.randn(10).astype(np.float32),
                False,
            )
        
        losses = agent.update(32)
        
        assert "critic_loss" in losses
        assert "actor_loss" in losses
        assert "alpha" in losses
    
    def test_sac_save_load(self, tmp_path):
        config = RLConfig()
        agent = SACAgent(config, obs_dim=10, action_dim=1)
        
        path = tmp_path / "sac_checkpoint.pt"
        agent.save(path)
        
        # Create new agent and load
        agent2 = SACAgent(config, obs_dim=10, action_dim=1)
        agent2.load(path)
        
        # Check parameters match
        for p1, p2 in zip(agent.actor.parameters(), agent2.actor.parameters()):
            torch.testing.assert_close(p1, p2)


class TestPPOAgent:
    """Test PPO Agent."""
    
    def test_ppo_init(self):
        config = RLConfig()
        agent = PPOAgent(config, obs_dim=1280, action_dim=1)
        
        assert agent.actor is not None
        assert agent.critic is not None
    
    def test_ppo_select_action(self):
        config = RLConfig()
        agent = PPOAgent(config, obs_dim=10, action_dim=1)
        
        obs = np.random.randn(10).astype(np.float32)
        action, log_prob, value = agent.select_action(obs)
        
        assert action.shape == ()
        assert -1 <= action <= 1
        assert isinstance(log_prob, float)
        assert isinstance(value, float)
    
    def test_ppo_update(self):
        config = RLConfig(rollout_length=32, ppo_epochs=2)
        agent = PPOAgent(config, obs_dim=10, action_dim=1)
        
        # Fill buffer
        for _ in range(32):
            agent.store_transition(
                np.random.randn(10).astype(np.float32),
                np.random.randn(1).astype(np.float32),
                np.random.randn(),
                np.random.randn(10).astype(np.float32),
                False,
                -0.5,
                0.0,
            )
        
        losses = agent.update()
        
        assert "actor_loss" in losses
        assert "critic_loss" in losses
        assert "entropy" in losses


class TestCQLAgent:
    """Test CQL Agent."""
    
    def test_cql_init(self):
        config = RLConfig()
        agent = CQLAgent(config, obs_dim=1280, action_dim=1)
        
        assert agent.critic is not None
        assert agent.actor is not None
        assert agent.value is not None
    
    def test_cql_add_offline_data(self):
        config = RLConfig()
        agent = CQLAgent(config, obs_dim=10, action_dim=1)
        
        dataset = [
            {
                "obs": np.random.randn(10).astype(np.float32),
                "action": np.random.randn(1).astype(np.float32),
                "reward": np.random.randn(),
                "next_obs": np.random.randn(10).astype(np.float32),
                "done": False,
            }
            for _ in range(100)
        ]
        
        agent.add_offline_data(dataset)
        assert len(agent.buffer) == 100
    
    def test_cql_update(self):
        config = RLConfig(batch_size=16)
        agent = CQLAgent(config, obs_dim=10, action_dim=1)
        
        # Add offline data
        for _ in range(100):
            agent.buffer.add(
                np.random.randn(10).astype(np.float32),
                np.random.randn(1).astype(np.float32),
                np.random.randn(),
                np.random.randn(10).astype(np.float32),
                False,
            )
        
        losses = agent.update(32)
        
        assert "critic_loss" in losses
        assert "cql_loss" in losses
        assert "actor_loss" in losses


class TestBuffers:
    """Test replay and rollout buffers."""
    
    def test_replay_buffer(self):
        buffer = ReplayBuffer(1000, 10, 1, torch.device("cpu"))
        
        for i in range(1500):  # Exceed capacity
            buffer.add(
                np.random.randn(10).astype(np.float32),
                np.random.randn(1).astype(np.float32),
                np.random.randn(),
                np.random.randn(10).astype(np.float32),
                False,
            )
        
        assert len(buffer) == 1000
        
        obs, actions, rewards, next_obs, dones = buffer.sample(32)
        
        assert obs.shape == (32, 10)
        assert actions.shape == (32, 1)
        assert rewards.shape == (32, 1)
    
    def test_rollout_buffer(self):
        buffer = RolloutBuffer(10, 1, 100, torch.device("cpu"))
        
        for _ in range(50):
            buffer.add(
                np.random.randn(10).astype(np.float32),
                np.random.randn(1).astype(np.float32),
                1.0,
                np.random.randn(10).astype(np.float32),
                False,
                -0.5,
                0.0,
            )
        
        buffer.compute_advantages(0.99, 0.95)
        
        obs, actions, log_probs, returns, advantages = buffer.get_all()
        
        assert obs.shape == (50, 10)
        assert advantages.shape == (50,)
        assert returns.shape == (50,)
    
    def test_rollout_buffer_clear(self):
        buffer = RolloutBuffer(10, 1, 100, torch.device("cpu"))
        
        for _ in range(50):
            buffer.add(
                np.random.randn(10).astype(np.float32),
                np.random.randn(1).astype(np.float32),
                1.0,
                np.random.randn(10).astype(np.float32),
                False,
                -0.5,
                0.0,
            )
        
        buffer.clear()
        assert len(buffer) == 0


class TestIntegration:
    """Integration tests."""
    
    def test_env_with_sac(self, sample_data):
        """Test SAC agent interacting with environment."""
        data, factors = sample_data
        config = RLConfig(lookback=32, n_factors=10, batch_size=8)
        
        env = TradingEnv(data, factors, config, mode="eval")
        agent = SACAgent(config, obs_dim=32*10, action_dim=1)
        
        obs, _ = env.reset()
        
        # Run a few steps
        for _ in range(20):
            action = agent.select_action(obs.flatten())
            # Ensure action is array
            if np.isscalar(action):
                action = np.array([action])
            next_obs, reward, terminated, truncated, _ = env.step(action)
            
            agent.buffer.add(obs.flatten(), action, reward, next_obs.flatten(), terminated or truncated)
            obs = next_obs
            
            if terminated or truncated:
                break
        
        # Update
        if len(agent.buffer) >= 8:
            losses = agent.update(8)
            assert "critic_loss" in losses
    
    def test_env_with_ppo(self, sample_data):
        """Test PPO agent interacting with environment."""
        data, factors = sample_data
        config = RLConfig(lookback=32, n_factors=10, rollout_length=16)
        
        env = TradingEnv(data, factors, config, mode="eval")
        agent = PPOAgent(config, obs_dim=32*10, action_dim=1)
        
        obs, _ = env.reset()
        
        for _ in range(16):
            action, log_prob, value = agent.select_action(obs.flatten())
            # Ensure action is array
            if np.isscalar(action):
                action = np.array([action])
            next_obs, reward, terminated, truncated, _ = env.step(action)
            
            agent.store_transition(obs.flatten(), action, reward, next_obs.flatten(), 
                                 terminated or truncated, log_prob, value)
            obs = next_obs
            
            if terminated or truncated:
                break
        
        losses = agent.update()
        assert "actor_loss" in losses


if __name__ == "__main__":
    pytest.main([__file__, "-v"])