"""
RL Agents - SAC, PPO, CQL Implementations
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.distributions import Normal

from us_futures.models.rl.env import RLConfig, TradingEnv


# ============================================================
# Networks
# ============================================================

class ActorNetwork(nn.Module):
    """SAC Actor network with Gaussian policy."""
    
    def __init__(
        self,
        obs_dim: int,
        action_dim: int,
        hidden_dim: int = 256,
        log_std_min: float = -20,
        log_std_max: float = 2,
    ):
        super().__init__()
        self.log_std_min = log_std_min
        self.log_std_max = log_std_max
        
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
        )
        
        self.mean_layer = nn.Linear(hidden_dim, action_dim)
        self.log_std_layer = nn.Linear(hidden_dim, action_dim)
        
        self.apply(self._init_weights)
    
    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.xavier_uniform_(module.weight)
            nn.init.zeros_(module.bias)
    
    def forward(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.net(obs)
        mean = self.mean_layer(x)
        log_std = self.log_std_layer(x)
        log_std = torch.clamp(log_std, self.log_std_min, self.log_std_max)
        return mean, log_std
    
    def sample(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Sample action and compute log_prob."""
        mean, log_std = self.forward(obs)
        std = log_std.exp()
        normal = Normal(mean, std)
        
        # Reparameterization trick
        x_t = normal.rsample()
        action = torch.tanh(x_t)
        
        # Log prob correction for tanh
        log_prob = normal.log_prob(x_t) - torch.log(1 - action.pow(2) + 1e-6)
        log_prob = log_prob.sum(-1, keepdim=True)
        
        return action, log_prob


class CriticNetwork(nn.Module):
    """Twin Q-networks for SAC."""
    
    def __init__(
        self,
        obs_dim: int,
        action_dim: int,
        hidden_dim: int = 256,
    ):
        super().__init__()
        
        # Q1
        self.q1 = nn.Sequential(
            nn.Linear(obs_dim + action_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )
        
        # Q2
        self.q2 = nn.Sequential(
            nn.Linear(obs_dim + action_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )
        
        self.apply(self._init_weights)
    
    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.xavier_uniform_(module.weight)
            nn.init.zeros_(module.bias)
    
    def forward(self, obs: torch.Tensor, action: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = torch.cat([obs, action], dim=-1)
        return self.q1(x), self.q2(x)


class ValueNetwork(nn.Module):
    """Value network for CQL."""
    
    def __init__(self, obs_dim: int, hidden_dim: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )
        self.apply(self._init_weights)
    
    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.xavier_uniform_(module.weight)
            nn.init.zeros_(module.bias)
    
    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return self.net(obs)


class PPOActor(nn.Module):
    """PPO Actor with discrete or continuous actions."""
    
    def __init__(
        self,
        obs_dim: int,
        action_dim: int,
        hidden_dim: int = 256,
        continuous: bool = True,
    ):
        super().__init__()
        self.continuous = continuous
        
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.Tanh(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.Tanh(),
        )
        
        if continuous:
            self.mean = nn.Linear(hidden_dim, action_dim)
            self.log_std = nn.Parameter(torch.zeros(action_dim))
        else:
            self.action_head = nn.Linear(hidden_dim, action_dim)
        
        self.apply(self._init_weights)
    
    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.orthogonal_(module.weight, gain=0.01)
            nn.init.zeros_(module.bias)
    
    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        x = self.net(obs)
        if self.continuous:
            mean = self.mean(x)
            std = self.log_std.exp().expand_as(mean)
            return mean, std
        else:
            return self.action_head(x)
    
    def get_dist(self, obs: torch.Tensor):
        if self.continuous:
            mean, std = self.forward(obs)
            return Normal(mean, std)
        else:
            logits = self.forward(obs)
            return torch.distributions.Categorical(logits=logits)


class PPOCritic(nn.Module):
    """PPO Value network."""
    
    def __init__(self, obs_dim: int, hidden_dim: int = 256):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim, hidden_dim),
            nn.Tanh(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.Tanh(),
            nn.Linear(hidden_dim, 1),
        )
        self.apply(self._init_weights)
    
    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.orthogonal_(module.weight, gain=1.0)
            nn.init.zeros_(module.bias)
    
    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return self.net(obs)


# ============================================================
# SAC Agent
# ============================================================

class SACAgent:
    """Soft Actor-Critic for continuous control."""
    
    def __init__(self, config: RLConfig, obs_dim: int, action_dim: int):
        self.config = config
        self.device = torch.device(config.device)
        
        # Networks
        self.actor = ActorNetwork(obs_dim, action_dim).to(self.device)
        self.critic = CriticNetwork(obs_dim, action_dim).to(self.device)
        self.critic_target = CriticNetwork(obs_dim, action_dim).to(self.device)
        self.critic_target.load_state_dict(self.critic.state_dict())
        
        # Optimizers
        self.actor_optim = optim.Adam(self.actor.parameters(), lr=config.learning_rate)
        self.critic_optim = optim.Adam(self.critic.parameters(), lr=config.learning_rate)
        
        # Temperature
        self.log_alpha = torch.tensor(np.log(config.alpha), device=self.device, requires_grad=config.auto_alpha)
        if config.auto_alpha:
            self.alpha_optim = optim.Adam([self.log_alpha], lr=config.learning_rate)
            self.target_entropy = -action_dim
        
        self.alpha = config.alpha
        self.gamma = config.gamma
        self.tau = config.tau
        
        # Replay buffer
        self.buffer = ReplayBuffer(config.buffer_size, obs_dim, action_dim, self.device)
    
    @property
    def alpha_val(self) -> float:
        return self.log_alpha.exp().item() if self.config.auto_alpha else self.config.alpha
    
    def select_action(self, obs: np.ndarray, deterministic: bool = False) -> np.ndarray:
        """Select action for given observation."""
        obs_tensor = torch.FloatTensor(obs).unsqueeze(0).to(self.device)
        with torch.no_grad():
            if deterministic:
                mean, _ = self.actor(obs_tensor)
                action = torch.tanh(mean)
            else:
                action, _ = self.actor.sample(obs_tensor)
        return action.cpu().numpy().squeeze()
    
    def update(self, batch_size: int) -> dict[str, float]:
        """Update networks."""
        if len(self.buffer) < batch_size:
            return {}
        
        obs, action, reward, next_obs, done = self.buffer.sample(batch_size)
        
        # Update critic
        with torch.no_grad():
            next_action, next_log_prob = self.actor.sample(next_obs)
            target_q1, target_q2 = self.critic_target(next_obs, next_action)
            target_q = torch.min(target_q1, target_q2) - self.alpha_val * next_log_prob
            target_q = reward + (1 - done) * self.gamma * target_q
        
        current_q1, current_q2 = self.critic(obs, action)
        critic_loss = F.mse_loss(current_q1, target_q) + F.mse_loss(current_q2, target_q)
        
        self.critic_optim.zero_grad()
        critic_loss.backward()
        self.critic_optim.step()
        
        # Update actor
        new_action, log_prob = self.actor.sample(obs)
        q1, q2 = self.critic(obs, new_action)
        q_min = torch.min(q1, q2)
        actor_loss = (self.alpha_val * log_prob - q_min).mean()
        
        self.actor_optim.zero_grad()
        actor_loss.backward()
        self.actor_optim.step()
        
        # Update alpha
        alpha_loss = 0
        if self.config.auto_alpha:
            alpha_loss = -(self.log_alpha * (log_prob + self.target_entropy).detach()).mean()
            self.alpha_optim.zero_grad()
            alpha_loss.backward()
            self.alpha_optim.step()
        
        # Soft update target
        self._soft_update()
        
        return {
            "critic_loss": critic_loss.item(),
            "actor_loss": actor_loss.item(),
            "alpha_loss": alpha_loss.item() if isinstance(alpha_loss, torch.Tensor) else alpha_loss,
            "alpha": self.alpha_val,
        }
    
    def _soft_update(self):
        for param, target_param in zip(self.critic.parameters(), self.critic_target.parameters()):
            target_param.data.copy_(self.tau * param.data + (1 - self.tau) * target_param.data)
    
    def save(self, path: str):
        torch.save({
            "actor": self.actor.state_dict(),
            "critic": self.critic.state_dict(),
            "critic_target": self.critic_target.state_dict(),
            "actor_optim": self.actor_optim.state_dict(),
            "critic_optim": self.critic_optim.state_dict(),
            "log_alpha": self.log_alpha,
        }, path)
    
    def load(self, path: str):
        checkpoint = torch.load(path, map_location=self.device)
        self.actor.load_state_dict(checkpoint["actor"])
        self.critic.load_state_dict(checkpoint["critic"])
        self.critic_target.load_state_dict(checkpoint["critic_target"])
        self.actor_optim.load_state_dict(checkpoint["actor_optim"])
        self.critic_optim.load_state_dict(checkpoint["critic_optim"])
        self.log_alpha = checkpoint["log_alpha"]


# ============================================================
# PPO Agent
# ============================================================

class PPOAgent:
    """Proximal Policy Optimization."""
    
    def __init__(self, config: RLConfig, obs_dim: int, action_dim: int, continuous: bool = True):
        self.config = config
        self.device = torch.device(config.device)
        self.continuous = continuous
        
        # Networks
        self.actor = PPOActor(obs_dim, action_dim, continuous=continuous).to(self.device)
        self.critic = PPOCritic(obs_dim).to(self.device)
        
        self.actor_optim = optim.Adam(self.actor.parameters(), lr=config.learning_rate)
        self.critic_optim = optim.Adam(self.critic.parameters(), lr=config.learning_rate)
        
        self.clip_eps = config.clip_eps
        self.entropy_coef = config.entropy_coef
        self.gae_lambda = config.gae_lambda
        self.gamma = config.gamma
        
        # Storage for rollout
        self.rollout_buffer = RolloutBuffer(obs_dim, action_dim, config.rollout_length, self.device)
    
    def select_action(self, obs: np.ndarray, deterministic: bool = False) -> tuple[np.ndarray, float, float]:
        """Select action and return log_prob and value."""
        obs_tensor = torch.FloatTensor(obs).unsqueeze(0).to(self.device)
        with torch.no_grad():
            dist = self.actor.get_dist(obs_tensor)
            value = self.critic(obs_tensor)
            
            if deterministic:
                if self.continuous:
                    action = torch.tanh(dist.mean)
                else:
                    action = dist.probs.argmax(dim=-1)
            else:
                action = dist.sample()
                if self.continuous:
                    action = torch.tanh(action)
            
            log_prob = dist.log_prob(action)
            if self.continuous:
                log_prob = log_prob.sum(-1)
        
        return action.cpu().numpy().squeeze(), log_prob.item(), value.item()
    
    def store_transition(
        self,
        obs: np.ndarray,
        action: np.ndarray,
        reward: float,
        next_obs: np.ndarray,
        done: bool,
        log_prob: float,
        value: float,
    ):
        self.rollout_buffer.add(obs, action, reward, next_obs, done, log_prob, value)
    
    def update(self) -> dict[str, float]:
        """Update using collected rollout."""
        if len(self.rollout_buffer) < self.config.rollout_length:
            return {}
        
        # Compute advantages using GAE
        self.rollout_buffer.compute_advantages(self.gamma, self.gae_lambda)
        
        # Get all data
        obs, actions, old_log_probs, returns, advantages = self.rollout_buffer.get_all()
        
        # Normalize advantages
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
        
        # PPO epochs
        total_actor_loss = 0
        total_critic_loss = 0
        total_entropy = 0
        
        for _ in range(self.config.ppo_epochs):
            # Actor loss
            dist = self.actor.get_dist(obs)
            new_log_probs = dist.log_prob(actions)
            if self.continuous:
                new_log_probs = new_log_probs.sum(-1)
            
            ratio = (new_log_probs - old_log_probs).exp()
            surr1 = ratio * advantages
            surr2 = torch.clamp(ratio, 1 - self.clip_eps, 1 + self.clip_eps) * advantages
            actor_loss = -torch.min(surr1, surr2).mean()
            
            # Entropy bonus
            entropy = dist.entropy()
            if self.continuous:
                entropy = entropy.sum(-1)
            entropy = entropy.mean()
            
            actor_loss = actor_loss - self.entropy_coef * entropy
            
            # Critic loss
            values = self.critic(obs).squeeze()
            critic_loss = F.mse_loss(values, returns)
            
            # Update
            self.actor_optim.zero_grad()
            actor_loss.backward()
            nn.utils.clip_grad_norm_(self.actor.parameters(), 0.5)
            self.actor_optim.step()
            
            self.critic_optim.zero_grad()
            critic_loss.backward()
            nn.utils.clip_grad_norm_(self.critic.parameters(), 0.5)
            self.critic_optim.step()
            
            total_actor_loss += actor_loss.item()
            total_critic_loss += critic_loss.item()
            total_entropy += entropy.item()
        
        self.rollout_buffer.clear()
        
        n_epochs = self.config.ppo_epochs
        return {
            "actor_loss": total_actor_loss / n_epochs,
            "critic_loss": total_critic_loss / n_epochs,
            "entropy": total_entropy / n_epochs,
        }
    
    def save(self, path: str):
        torch.save({
            "actor": self.actor.state_dict(),
            "critic": self.critic.state_dict(),
            "actor_optim": self.actor_optim.state_dict(),
            "critic_optim": self.critic_optim.state_dict(),
        }, path)
    
    def load(self, path: str):
        checkpoint = torch.load(path, map_location=self.device)
        self.actor.load_state_dict(checkpoint["actor"])
        self.critic.load_state_dict(checkpoint["critic"])
        self.actor_optim.load_state_dict(checkpoint["actor_optim"])
        self.critic_optim.load_state_dict(checkpoint["critic_optim"])


# ============================================================
# CQL Agent (Conservative Q-Learning for Offline RL)
# ============================================================

class CQLAgent:
    """Conservative Q-Learning for offline RL."""
    
    def __init__(self, config: RLConfig, obs_dim: int, action_dim: int):
        self.config = config
        self.device = torch.device(config.device)
        
        # Networks
        self.critic = CriticNetwork(obs_dim, action_dim).to(self.device)
        self.critic_target = CriticNetwork(obs_dim, action_dim).to(self.device)
        self.critic_target.load_state_dict(self.critic.state_dict())
        
        # Policy (for importance sampling)
        self.actor = ActorNetwork(obs_dim, action_dim).to(self.device)
        
        # Value network
        self.value = ValueNetwork(obs_dim).to(self.device)
        
        self.critic_optim = optim.Adam(self.critic.parameters(), lr=config.learning_rate)
        self.actor_optim = optim.Adam(self.actor.parameters(), lr=config.learning_rate)
        self.value_optim = optim.Adam(self.value.parameters(), lr=config.learning_rate)
        
        self.cql_alpha = config.cql_alpha
        self.gamma = config.gamma
        self.tau = config.tau
        
        # Replay buffer (offline dataset)
        self.buffer = ReplayBuffer(config.buffer_size, obs_dim, action_dim, self.device)
    
    def select_action(self, obs: np.ndarray, deterministic: bool = True) -> np.ndarray:
        """Select action using learned policy."""
        obs_tensor = torch.FloatTensor(obs).unsqueeze(0).to(self.device)
        with torch.no_grad():
            if deterministic:
                mean, _ = self.actor(obs_tensor)
                action = torch.tanh(mean)
            else:
                action, _ = self.actor.sample(obs_tensor)
        return action.cpu().numpy().squeeze()
    
    def add_offline_data(self, dataset: list[dict]):
        """Add offline dataset to buffer."""
        for transition in dataset:
            self.buffer.add(
                transition["obs"],
                transition["action"],
                transition["reward"],
                transition["next_obs"],
                transition["done"],
            )
    
    def update(self, batch_size: int) -> dict[str, float]:
        """CQL update."""
        if len(self.buffer) < batch_size:
            return {}
        
        obs, action, reward, next_obs, done = self.buffer.sample(batch_size)
        
        # Current Q values
        current_q1, current_q2 = self.critic(obs, action)
        
        # Target Q
        with torch.no_grad():
            next_action, next_log_prob = self.actor.sample(next_obs)
            target_q1, target_q2 = self.critic_target(next_obs, next_action)
            target_q = torch.min(target_q1, target_q2)
            target_q = reward + (1 - done) * self.gamma * (target_q - self.alpha_val * next_log_prob)
        
        # Critic loss with CQL regularization
        critic_loss = F.mse_loss(current_q1, target_q) + F.mse_loss(current_q2, target_q)
        
        # CQL regularization: push down Q-values for OOD actions
        random_actions = torch.rand_like(action).uniform_(-1, 1)
        policy_actions, _ = self.actor.sample(obs)
        
        q1_random, q2_random = self.critic(obs, random_actions)
        q1_policy, q2_policy = self.critic(obs, policy_actions)
        
        cql_loss = (
            torch.logsumexp(torch.cat([q1_random, q1_policy], dim=1), dim=1).mean() -
            current_q1.mean()
        ) + (
            torch.logsumexp(torch.cat([q2_random, q2_policy], dim=1), dim=1).mean() -
            current_q2.mean()
        )
        
        total_critic_loss = critic_loss + self.cql_alpha * cql_loss
        
        self.critic_optim.zero_grad()
        total_critic_loss.backward()
        self.critic_optim.step()
        
        # Policy improvement (optional, for online fine-tuning)
        policy_actions, log_probs = self.actor.sample(obs)
        q1_pi, q2_pi = self.critic(obs, policy_actions)
        q_pi = torch.min(q1_pi, q2_pi)
        actor_loss = (self.alpha_val * log_probs - q_pi).mean()
        
        self.actor_optim.zero_grad()
        actor_loss.backward()
        self.actor_optim.step()
        
        # Soft update
        self._soft_update()
        
        return {
            "critic_loss": critic_loss.item(),
            "cql_loss": cql_loss.item(),
            "actor_loss": actor_loss.item(),
        }
    
    @property
    def alpha_val(self) -> float:
        return self.config.alpha
    
    def _soft_update(self):
        for param, target_param in zip(self.critic.parameters(), self.critic_target.parameters()):
            target_param.data.copy_(self.tau * param.data + (1 - self.tau) * target_param.data)
    
    def save(self, path: str):
        torch.save({
            "critic": self.critic.state_dict(),
            "critic_target": self.critic_target.state_dict(),
            "actor": self.actor.state_dict(),
            "value": self.value.state_dict(),
            "critic_optim": self.critic_optim.state_dict(),
            "actor_optim": self.actor_optim.state_dict(),
            "value_optim": self.value_optim.state_dict(),
        }, path)
    
    def load(self, path: str):
        checkpoint = torch.load(path, map_location=self.device)
        self.critic.load_state_dict(checkpoint["critic"])
        self.critic_target.load_state_dict(checkpoint["critic_target"])
        self.actor.load_state_dict(checkpoint["actor"])
        self.value.load_state_dict(checkpoint["value"])
        self.critic_optim.load_state_dict(checkpoint["critic_optim"])
        self.actor_optim.load_state_dict(checkpoint["actor_optim"])
        self.value_optim.load_state_dict(checkpoint["value_optim"])


# ============================================================
# Replay Buffer
# ============================================================

class ReplayBuffer:
    """Replay buffer for off-policy RL."""
    
    def __init__(
        self,
        capacity: int,
        obs_dim: int,
        action_dim: int,
        device: torch.device,
    ):
        self.capacity = capacity
        self.device = device
        
        self.obs = torch.zeros(capacity, obs_dim, device=device)
        self.actions = torch.zeros(capacity, action_dim, device=device)
        self.rewards = torch.zeros(capacity, 1, device=device)
        self.next_obs = torch.zeros(capacity, obs_dim, device=device)
        self.dones = torch.zeros(capacity, 1, device=device)
        
        self.ptr = 0
        self.size = 0
    
    def add(
        self,
        obs: np.ndarray,
        action: np.ndarray,
        reward: float,
        next_obs: np.ndarray,
        done: bool,
    ):
        self.obs[self.ptr] = torch.FloatTensor(obs)
        self.actions[self.ptr] = torch.FloatTensor(action)
        self.rewards[self.ptr] = reward
        self.next_obs[self.ptr] = torch.FloatTensor(next_obs)
        self.dones[self.ptr] = float(done)
        
        self.ptr = (self.ptr + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)
    
    def sample(self, batch_size: int) -> tuple:
        idx = torch.randint(0, self.size, (batch_size,), device=self.device)
        return (
            self.obs[idx],
            self.actions[idx],
            self.rewards[idx],
            self.next_obs[idx],
            self.dones[idx],
        )
    
    def __len__(self) -> int:
        return self.size


# ============================================================
# Rollout Buffer (for PPO)
# ============================================================

class RolloutBuffer:
    """Rollout buffer for on-policy RL (PPO)."""
    
    def __init__(
        self,
        obs_dim: int,
        action_dim: int,
        capacity: int,
        device: torch.device,
    ):
        self.capacity = capacity
        self.device = device
        
        self.obs = torch.zeros(capacity, obs_dim, device=device)
        self.actions = torch.zeros(capacity, action_dim, device=device)
        self.rewards = torch.zeros(capacity, device=device)
        self.next_obs = torch.zeros(capacity, obs_dim, device=device)
        self.dones = torch.zeros(capacity, device=device)
        self.log_probs = torch.zeros(capacity, device=device)
        self.values = torch.zeros(capacity, device=device)
        self.advantages = torch.zeros(capacity, device=device)
        self.returns = torch.zeros(capacity, device=device)
        
        self.ptr = 0
        self.size = 0
    
    def add(
        self,
        obs: np.ndarray,
        action: np.ndarray,
        reward: float,
        next_obs: np.ndarray,
        done: bool,
        log_prob: float,
        value: float,
    ):
        self.obs[self.ptr] = torch.FloatTensor(obs)
        self.actions[self.ptr] = torch.FloatTensor(action)
        self.rewards[self.ptr] = reward
        self.next_obs[self.ptr] = torch.FloatTensor(next_obs)
        self.dones[self.ptr] = float(done)
        self.log_probs[self.ptr] = log_prob
        self.values[self.ptr] = value
        
        self.ptr = (self.ptr + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)
    
    def compute_advantages(self, gamma: float, gae_lambda: float):
        """Compute GAE advantages."""
        with torch.no_grad():
            advantages = torch.zeros(self.size, device=self.device)
            last_gae = 0
            
            for t in reversed(range(self.size)):
                if t == self.size - 1:
                    next_value = 0
                else:
                    next_value = self.values[t + 1]
                
                delta = self.rewards[t] + gamma * next_value * (1 - self.dones[t]) - self.values[t]
                last_gae = delta + gamma * gae_lambda * (1 - self.dones[t]) * last_gae
                advantages[t] = last_gae
            
            self.advantages[:self.size] = advantages
            self.returns[:self.size] = advantages + self.values[:self.size]
    
    def get_all(self) -> tuple:
        """Get all data for update."""
        return (
            self.obs[:self.size],
            self.actions[:self.size],
            self.log_probs[:self.size],
            self.returns[:self.size],
            self.advantages[:self.size],
        )
    
    def clear(self):
        self.ptr = 0
        self.size = 0
    
    def __len__(self) -> int:
        return self.size


# ============================================================
# Training Loop Helpers
# ============================================================

def train_sac(
    env: TradingEnv,
    agent: SACAgent,
    config: RLConfig,
    total_steps: int = 1_000_000,
    eval_interval: int = 10_000,
    eval_env: TradingEnv = None,
) -> dict[str, list]:
    """Train SAC agent."""
    metrics = {"train_reward": [], "eval_reward": [], "actor_loss": [], "critic_loss": []}
    
    obs, _ = env.reset()
    episode_reward = 0
    
    for step in range(total_steps):
        # Select action
        action = agent.select_action(obs.flatten())
        
        # Step
        next_obs, reward, terminated, truncated, info = env.step(action)
        done = terminated or truncated
        
        # Store
        agent.buffer.add(obs.flatten(), action, reward, next_obs.flatten(), done)
        
        episode_reward += reward
        obs = next_obs
        
        # Update
        if step > config.batch_size:
            losses = agent.update(config.batch_size)
            if losses:
                metrics["actor_loss"].append(losses["actor_loss"])
                metrics["critic_loss"].append(losses["critic_loss"])
        
        if done:
            metrics["train_reward"].append(episode_reward)
            obs, _ = env.reset()
            episode_reward = 0
        
        # Evaluation
        if eval_env is not None and step % eval_interval == 0:
            eval_reward = evaluate_agent(eval_env, agent)
            metrics["eval_reward"].append(eval_reward)
            print(f"Step {step}: Train Reward={np.mean(metrics['train_reward'][-10:]):.3f}, "
                  f"Eval Reward={eval_reward:.3f}")
    
    return metrics


def train_ppo(
    env: TradingEnv,
    agent: PPOAgent,
    config: RLConfig,
    total_steps: int = 1_000_000,
    eval_interval: int = 10_000,
    eval_env: TradingEnv = None,
) -> dict[str, list]:
    """Train PPO agent."""
    metrics = {"train_reward": [], "eval_reward": [], "actor_loss": [], "critic_loss": []}
    
    obs, _ = env.reset()
    episode_reward = 0
    
    for step in range(total_steps):
        # Select action
        action, log_prob, value = agent.select_action(obs.flatten())
        
        # Step
        next_obs, reward, terminated, truncated, info = env.step(action)
        done = terminated or truncated
        
        # Store
        agent.store_transition(obs.flatten(), action, reward, next_obs.flatten(), done, log_prob, value)
        
        episode_reward += reward
        obs = next_obs
        
        # Update when buffer full
        if len(agent.rollout_buffer) >= config.rollout_length:
            losses = agent.update()
            if losses:
                metrics["actor_loss"].append(losses["actor_loss"])
                metrics["critic_loss"].append(losses["critic_loss"])
        
        if done:
            metrics["train_reward"].append(episode_reward)
            obs, _ = env.reset()
            episode_reward = 0
        
        # Evaluation
        if eval_env is not None and step % eval_interval == 0:
            eval_reward = evaluate_agent(eval_env, agent)
            metrics["eval_reward"].append(eval_reward)
            print(f"Step {step}: Train Reward={np.mean(metrics['train_reward'][-10:]):.3f}, "
                  f"Eval Reward={eval_reward:.3f}")
    
    return metrics


def evaluate_agent(env: TradingEnv, agent: Any, n_episodes: int = 5) -> float:
    """Evaluate agent."""
    total_rewards = []
    
    for _ in range(n_episodes):
        obs, _ = env.reset()
        episode_reward = 0
        done = False
        
        while not done:
            action = agent.select_action(obs.flatten(), deterministic=True)
            obs, reward, terminated, truncated, _ = env.step(action)
            done = terminated or truncated
            episode_reward += reward
        
        total_rewards.append(episode_reward)
    
    return np.mean(total_rewards)