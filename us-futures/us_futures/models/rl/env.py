"""
Trading Environment for RL
Gymnasium-compatible environment for futures trading.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import gymnasium as gym
import numpy as np
import polars as pl
import torch
from gymnasium import spaces

from us_futures.config import get_settings
from us_futures.data.schema import ContractSpec, get_contract_spec


@dataclass
class RLConfig:
    """Configuration for RL environment and training."""
    # Data
    symbol: str = "ES"
    n_factors: int = 100
    lookback: int = 512
    pred_horizon: int = 60
    
    # Environment
    initial_capital: float = 1_000_000
    max_position: int = 10
    transaction_cost_bps: float = 1.0  # Per side
    slippage_bps: float = 0.5
    
    # Reward
    reward_type: str = "sharpe"  # sharpe, returns, risk_adjusted
    risk_free_rate: float = 0.02
    
    # Training
    device: str = "cuda" if torch.cuda.is_available() else "cpu"
    batch_size: int = 256
    learning_rate: float = 3e-4
    gamma: float = 0.99
    tau: float = 0.005
    buffer_size: int = 100000
    rollout_length: int = 2048
    ppo_epochs: int = 10
    
    # SAC
    alpha: float = 0.2
    auto_alpha: bool = True
    
    # PPO
    clip_eps: float = 0.2
    entropy_coef: float = 0.01
    gae_lambda: float = 0.95
    
    # CQL
    cql_alpha: float = 1.0
    cql_n_actions: int = 10


class TradingEnv(gym.Env):
    """
    Gymnasium-compatible trading environment.
    
    Observation: [lookback, n_factors] - Factor matrix
    Action: Continuous [-1, 1] for position sizing, or discrete {0, 1, 2} for flat/long/short
    Reward: PnL with risk adjustment
    """
    
    metadata = {"render_modes": ["human", "rgb_array"], "render_fps": 4}
    
    def __init__(
        self,
        data: pl.DataFrame,
        factors: pl.DataFrame,
        config: RLConfig = None,
        contract_spec: ContractSpec = None,
        mode: str = "train",
    ):
        super().__init__()
        
        self.config = config or RLConfig()
        self.mode = mode
        
        # Data
        self.data = data.sort("timestamp")
        self.factors = factors.sort("timestamp")
        self.contract_spec = contract_spec or get_contract_spec(self.config.symbol)
        
        # Validate alignment
        assert len(self.data) == len(self.factors), "Data and factors must have same length"
        
        # State
        self.current_step = 0
        self.position = 0.0
        self.cash = self.config.initial_capital
        self.equity = self.config.initial_capital
        self.peak_equity = self.config.initial_capital
        
        # History for metrics
        self.equity_curve = [self.config.initial_capital]
        self.position_history = [0.0]
        self.returns_history = []
        
        # Action space: continuous position [-1, 1] scaled to max_position
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(1,), dtype=np.float32
        )
        
        # Observation space: [lookback, n_factors]
        n_factors = min(self.config.n_factors, self.factors.width)
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf,
            shape=(self.config.lookback, n_factors),
            dtype=np.float32
        )
        
        # Precompute factor columns (exclude non-numeric)
        self.factor_cols = [c for c in self.factors.columns if c != "timestamp"]
        self.factor_cols = self.factor_cols[:n_factors]
        
        # Episode stats
        self.trades = 0
        self.total_commission = 0.0
        
    def reset(self, seed: Optional[int] = None, options: Optional[dict] = None) -> tuple[np.ndarray, dict]:
        """Reset environment to initial state."""
        super().reset(seed=seed)
        
        if self.mode == "train":
            # Random start within valid range
            max_start = len(self.data) - self.config.lookback - self.config.pred_horizon
            self.current_step = np.random.randint(self.config.lookback, max_start)
        else:
            # Fixed start for evaluation
            self.current_step = self.config.lookback
        
        self.position = 0.0
        self.cash = self.config.initial_capital
        self.equity = self.config.initial_capital
        self.peak_equity = self.config.initial_capital
        
        self.equity_curve = [self.config.initial_capital]
        self.position_history = [0.0]
        self.returns_history = []
        self.trades = 0
        self.total_commission = 0.0
        
        obs = self._get_observation()
        info = self._get_info()
        
        return obs, info
    
    def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]:
        """Execute one step."""
        # Clip action
        action = np.clip(action, -1.0, 1.0)
        # Handle scalar action
        if action.ndim == 0:
            action = action.reshape(1)
        target_position = float(action[0]) * self.config.max_position
        
        # Get current price (extract scalar from Polars)
        current_price = float(self.data[self.current_step, "close"])
        
        # Calculate trade
        position_change = target_position - self.position
        trade_value = abs(position_change) * current_price * self.contract_spec.multiplier
        
        # Transaction costs
        commission = trade_value * (self.config.transaction_cost_bps / 10000)
        slippage = trade_value * (self.config.slippage_bps / 10000)
        total_cost = commission + slippage
        
        self.total_commission += total_cost
        self.cash -= total_cost
        
        if position_change != 0:
            self.trades += 1
        
        # Update position
        self.position = target_position
        
        # Step forward
        self.current_step += 1
        
        # Calculate PnL
        if self.current_step < len(self.data):
            next_price = float(self.data[self.current_step, "close"])
            price_change = next_price - current_price
            
            # PnL from position
            pnl = self.position * price_change * self.contract_spec.multiplier
            self.cash += pnl
            self.equity = self.cash + self.position * next_price * self.contract_spec.multiplier
            
            # Track returns
            ret = (self.equity - self.equity_curve[-1]) / self.equity_curve[-1]
            self.returns_history.append(ret)
        else:
            next_price = current_price
            pnl = 0.0
        
        self.equity_curve.append(self.equity)
        self.position_history.append(self.position)
        self.peak_equity = max(self.peak_equity, self.equity)
        
        # Reward
        reward = self._compute_reward(pnl)
        
        # Done conditions
        terminated = self.current_step >= len(self.data) - 1
        truncated = False
        
        # Episode metrics
        drawdown = (self.peak_equity - self.equity) / self.peak_equity
        
        obs = self._get_observation()
        info = self._get_info()
        info.update({
            "pnl": pnl,
            "equity": self.equity,
            "position": self.position,
            "drawdown": drawdown,
            "trades": self.trades,
            "total_commission": self.total_commission,
        })
        
        return obs, reward, terminated, truncated, info
    
    def _get_observation(self) -> np.ndarray:
        """Get current observation window."""
        start = self.current_step - self.config.lookback
        end = self.current_step
        
        if start < 0:
            # Pad with zeros if not enough history
            pad_len = -start
            factor_data = self.factors[self.factor_cols].head(end).to_numpy()
            padding = np.zeros((pad_len, factor_data.shape[1]), dtype=np.float32)
            obs = np.vstack([padding, factor_data])
        else:
            obs = self.factors[self.factor_cols].slice(start, self.config.lookback).to_numpy()
        
        return obs.astype(np.float32)
    
    def _compute_reward(self, pnl: float) -> float:
        """Compute reward based on configuration."""
        if self.config.reward_type == "returns":
            ret = pnl / self.equity_curve[-2] if self.equity_curve[-2] > 0 else 0
            return float(ret)
        
        elif self.config.reward_type == "sharpe":
            if len(self.returns_history) < 20:
                return float(pnl / 10000)  # Scaled PnL
            
            recent_returns = np.array(self.returns_history[-20:])
            mean_ret = recent_returns.mean()
            std_ret = recent_returns.std() + 1e-8
            sharpe = mean_ret / std_ret * np.sqrt(252 * 390)  # Annualized
            return float(sharpe * 0.01)  # Scale
        
        elif self.config.reward_type == "risk_adjusted":
            # PnL penalized by drawdown
            drawdown = (self.peak_equity - self.equity) / self.peak_equity
            return float(pnl / 10000 * (1 - drawdown))
        
        else:
            return float(pnl / 10000)
    
    def _get_info(self) -> dict:
        """Get info dict."""
        return {
            "step": self.current_step,
            "equity": self.equity,
            "position": self.position,
            "cash": self.cash,
        }
    
    def render(self, mode: str = "human") -> Optional[np.ndarray]:
        """Render environment (placeholder)."""
        if mode == "human":
            print(f"Step: {self.current_step}, Equity: {self.equity:.2f}, Position: {self.position:.2f}")
        return None
    
    def close(self):
        pass
    
    def get_metrics(self) -> dict[str, float]:
        """Get episode performance metrics."""
        equity = np.array(self.equity_curve)
        returns = np.array(self.returns_history)
        
        if len(returns) < 2:
            return {}
        
        total_return = (equity[-1] - equity[0]) / equity[0]
        sharpe = returns.mean() / (returns.std() + 1e-8) * np.sqrt(252 * 390)
        max_dd = (equity.max() - equity.min()) / equity.max()
        
        return {
            "total_return": total_return,
            "sharpe": sharpe,
            "max_drawdown": max_dd,
            "trades": self.trades,
            "total_commission": self.total_commission,
            "final_equity": equity[-1],
        }


def create_rl_env(
    data: pl.DataFrame,
    factors: pl.DataFrame,
    config: RLConfig = None,
    mode: str = "train",
) -> TradingEnv:
    """Factory function to create RL environment."""
    return TradingEnv(data, factors, config, mode=mode)