"""
PatchTST Implementation
Paper: "A Time Series is Worth 64 Words: Long-term Forecasting with Transformers" (Nie et al., 2023)
Adapted for financial time series with masked reconstruction pretraining.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from us_futures.config import get_settings


class PretrainingTask(str, Enum):
    """Pretraining task types."""
    MASKED_RECONSTRUCTION = "masked_reconstruction"
    NEXT_STEP_PREDICTION = "next_step_prediction"
    CONTRASTIVE = "contrastive"


@dataclass
class PatchTSTConfig:
    """Configuration for PatchTST model."""
    # Input
    n_vars: int = 100           # Number of input variables (factors)
    seq_len: int = 512          # Sequence length (lookback)
    pred_len: int = 60          # Prediction horizon
    
    # Patching
    patch_len: int = 16         # Patch length
    stride: int = 8             # Stride (overlap)
    
    # Model
    d_model: int = 256          # Model dimension
    n_heads: int = 8            # Number of attention heads
    n_layers: int = 4           # Number of encoder layers
    d_ff: int = 512             # Feedforward dimension
    dropout: float = 0.1        # Dropout rate
    attn_dropout: float = 0.0   # Attention dropout
    
    # Training
    mask_ratio: float = 0.4     # Masking ratio for pretraining
    pretraining_task: PretrainingTask = PretrainingTask.MASKED_RECONSTRUCTION
    
    # Normalization
    norm_type: str = "batch"    # batch, layer, or instance
    
    # Output
    n_classes: Optional[int] = None  # For classification heads
    
    @property
    def n_patches(self) -> int:
        return (self.seq_len - self.patch_len) // self.stride + 1


class PatchEmbedding(nn.Module):
    """Patch embedding with positional encoding."""
    
    def __init__(self, config: PatchTSTConfig):
        super().__init__()
        self.config = config
        self.patch_len = config.patch_len
        self.stride = config.stride
        self.d_model = config.d_model
        
        # Linear projection from patch to d_model
        self.projection = nn.Linear(config.patch_len * config.n_vars, config.d_model)
        
        # Positional encoding
        self.pos_encoding = nn.Parameter(
            torch.randn(1, config.n_patches, config.d_model) * 0.02
        )
        
        self.dropout = nn.Dropout(config.dropout)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch, n_vars, seq_len]
        Returns:
            [batch, n_patches, d_model]
        """
        batch, n_vars, seq_len = x.shape
        
        # Create patches using unfold
        # x: [batch, n_vars, seq_len] -> [batch, n_vars, n_patches, patch_len]
        patches = x.unfold(dimension=-1, size=self.patch_len, step=self.stride)
        n_patches = patches.shape[-2]
        
        # Reshape: [batch, n_vars, n_patches, patch_len] -> [batch, n_patches, n_vars * patch_len]
        patches = patches.permute(0, 2, 1, 3).contiguous()
        patches = patches.view(batch, n_patches, -1)
        
        # Project to d_model
        x = self.projection(patches)  # [batch, n_patches, d_model]
        
        # Add positional encoding
        x = x + self.pos_encoding[:, :n_patches, :]
        
        return self.dropout(x)


class TransformerEncoder(nn.Module):
    """Transformer encoder with pre-norm architecture."""
    
    def __init__(self, config: PatchTSTConfig):
        super().__init__()
        self.config = config
        
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.d_model,
            nhead=config.n_heads,
            dim_feedforward=config.d_ff,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,  # Pre-norm
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, config.n_layers)
        self.norm = nn.LayerNorm(config.d_model)
    
    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Args:
            x: [batch, n_patches, d_model]
            mask: Optional attention mask [batch, n_patches]
        Returns:
            [batch, n_patches, d_model]
        """
        # Transformer encoder expects src_key_padding_mask [batch, n_patches]
        # True = masked (ignored)
        if mask is not None:
            mask = ~mask.bool()  # Invert: True = keep
        
        x = self.encoder(x, src_key_padding_mask=mask)
        return self.norm(x)


class PatchTSTBackbone(nn.Module):
    """
    PatchTST Backbone for time series representation learning.
    """
    
    def __init__(self, config: PatchTSTConfig):
        super().__init__()
        self.config = config
        
        self.patch_embedding = PatchEmbedding(config)
        self.encoder = TransformerEncoder(config)
        
        # Initialize weights
        self.apply(self._init_weights)
    
    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.xavier_uniform_(module.weight)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.LayerNorm):
            nn.init.ones_(module.weight)
            nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Parameter):
            nn.init.normal_(module, std=0.02)
    
    def forward(
        self,
        x: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Args:
            x: [batch, n_vars, seq_len]
            mask: Optional mask [batch, n_patches] (True = masked)
        Returns:
            [batch, n_patches, d_model]
        """
        x = self.patch_embedding(x)
        x = self.encoder(x, mask)
        return x


class ReconstructionHead(nn.Module):
    """Head for masked patch reconstruction."""
    
    def __init__(self, config: PatchTSTConfig):
        super().__init__()
        self.config = config
        
        # Project from d_model back to patch_len * n_vars
        self.head = nn.Sequential(
            nn.Linear(config.d_model, config.d_ff),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.d_ff, config.patch_len * config.n_vars),
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch, n_patches, d_model]
        Returns:
            [batch, n_patches, n_vars * patch_len]
        """
        return self.head(x)


class PredictionHead(nn.Module):
    """Head for next-step prediction or classification."""
    
    def __init__(self, config: PatchTSTConfig, output_dim: int = None):
        super().__init__()
        self.config = config
        
        if output_dim is None:
            output_dim = config.n_vars * config.pred_len
        
        self.head = nn.Sequential(
            nn.Linear(config.d_model * config.n_patches, config.d_ff),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.d_ff, output_dim),
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch, n_patches, d_model]
        Returns:
            [batch, output_dim]
        """
        batch = x.shape[0]
        x = x.view(batch, -1)  # Flatten patches
        return self.head(x)


class PatchTSTForPretraining(nn.Module):
    """PatchTST for masked reconstruction pretraining."""
    
    def __init__(self, config: PatchTSTConfig):
        super().__init__()
        self.config = config
        
        self.backbone = PatchTSTBackbone(config)
        self.reconstruction_head = ReconstructionHead(config)
        
        # For contrastive learning
        if config.pretraining_task == PretrainingTask.CONTRASTIVE:
            self.projection_head = nn.Sequential(
                nn.Linear(config.d_model * config.n_patches, config.d_model),
                nn.ReLU(),
                nn.Linear(config.d_model, config.d_model),
            )
    
    def forward(
        self,
        x: torch.Tensor,
        mask: Optional[torch.Tensor] = None,
    ) -> dict[str, torch.Tensor]:
        """
        Args:
            x: [batch, n_vars, seq_len]
            mask: [batch, n_patches] boolean mask (True = masked)
        Returns:
            Dict with reconstructed patches and optionally embeddings
        """
        # Get backbone embeddings
        embeddings = self.backbone(x, mask)
        
        # Reconstruction
        reconstructed = self.reconstruction_head(embeddings)
        
        output = {"reconstructed": reconstructed, "embeddings": embeddings}
        
        if self.config.pretraining_task == PretrainingTask.CONTRASTIVE:
            batch = embeddings.shape[0]
            flat_emb = embeddings.view(batch, -1)
            output["projected"] = self.projection_head(flat_emb)
        
        return output
    
    def compute_loss(
        self,
        x: torch.Tensor,
        mask: torch.Tensor,
        target: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Compute pretraining loss.
        
        Args:
            x: [batch, n_vars, seq_len] - input (with masked patches zeroed)
            mask: [batch, n_patches] - True for masked patches
            target: [batch, n_vars, seq_len] - original unmasked input
        """
        output = self.forward(x, mask)
        reconstructed = output["reconstructed"]  # [batch, n_patches, n_vars * patch_len]
        
        # Create target patches from original input
        if target is None:
            target = x
        
        # Extract patches from target
        batch, n_vars, seq_len = target.shape
        target_patches = target.unfold(-1, self.config.patch_len, self.config.stride)
        target_patches = target_patches.permute(0, 2, 1, 3).contiguous()
        target_patches = target_patches.view(batch, -1, n_vars * self.config.patch_len)
        
        # Compute loss only on masked patches
        # mask: [batch, n_patches] -> [batch, n_patches, 1]
        mask_expanded = mask.unsqueeze(-1).float()
        
        loss = F.mse_loss(reconstructed * mask_expanded, target_patches * mask_expanded, reduction="sum")
        loss = loss / (mask_expanded.sum() * self.config.n_vars * self.config.patch_len + 1e-8)
        
        return loss


class PatchTSTForFinetuning(nn.Module):
    """PatchTST for downstream tasks (forecasting, classification)."""
    
    def __init__(
        self,
        config: PatchTSTConfig,
        task: str = "forecasting",
        n_classes: Optional[int] = None,
        pretrained_backbone: Optional[PatchTSTBackbone] = None,
    ):
        super().__init__()
        self.config = config
        self.task = task
        
        if pretrained_backbone is not None:
            self.backbone = pretrained_backbone
        else:
            self.backbone = PatchTSTBackbone(config)
        
        if task == "forecasting":
            output_dim = config.n_vars * config.pred_len
            self.head = PredictionHead(config, output_dim)
        elif task == "classification":
            n_classes = n_classes or config.n_classes or 3
            self.head = PredictionHead(config, n_classes)
        else:
            raise ValueError(f"Unknown task: {task}")
    
    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Args:
            x: [batch, n_vars, seq_len]
            mask: Optional attention mask
        Returns:
            [batch, output_dim] or [batch, n_classes]
        """
        embeddings = self.backbone(x, mask)
        return self.head(embeddings)
    
    def freeze_backbone(self):
        """Freeze backbone for linear probing."""
        for param in self.backbone.parameters():
            param.requires_grad = False
    
    def unfreeze_backbone(self):
        """Unfreeze backbone for full fine-tuning."""
        for param in self.backbone.parameters():
            param.requires_grad = True


class TimeSeriesDataset(Dataset):
    """Dataset for time series with sliding windows."""
    
    def __init__(
        self,
        data: torch.Tensor,  # [n_samples, n_vars, seq_len]
        targets: Optional[torch.Tensor] = None,  # [n_samples, n_vars, pred_len] or [n_samples]
        mask_ratio: float = 0.4,
        patch_len: int = 16,
        stride: int = 8,
        seq_len: int = 512,
    ):
        self.data = data
        self.targets = targets
        self.mask_ratio = mask_ratio
        self.patch_len = patch_len
        self.stride = stride
        self.seq_len = seq_len
        
        self.n_patches = (seq_len - patch_len) // stride + 1
    
    def __len__(self) -> int:
        return len(self.data)
    
    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        x = self.data[idx]  # [n_vars, seq_len]
        
        # Create random mask
        n_patches = self.n_patches
        n_masked = int(n_patches * self.mask_ratio)
        mask = torch.zeros(n_patches, dtype=torch.bool)
        mask[:n_masked] = True
        mask = mask[torch.randperm(n_patches)]
        
        # Create masked input by zeroing patches directly in the sequence
        x_masked = x.clone()
        # Get patch indices
        for i in range(n_patches):
            if mask[i]:
                start = i * self.stride
                end = min(start + self.patch_len, self.seq_len)
                x_masked[:, start:end] = 0
        
        item = {
            "input": x_masked,
            "target": x,
            "mask": mask,
        }
        
        if self.targets is not None:
            if self.targets.ndim == 3:
                item["forecast_target"] = self.targets[idx]  # [n_vars, pred_len]
            else:
                item["class_target"] = self.targets[idx]
        
        return item


def create_pretraining_dataloader(
    data: torch.Tensor,
    config: PatchTSTConfig,
    batch_size: int = 32,
    shuffle: bool = True,
    num_workers: int = 0,
) -> DataLoader:
    """Create dataloader for pretraining."""
    dataset = TimeSeriesDataset(
        data=data,
        mask_ratio=config.mask_ratio,
        patch_len=config.patch_len,
        stride=config.stride,
        seq_len=config.seq_len,
    )
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )


def create_finetuning_dataloader(
    data: torch.Tensor,
    targets: torch.Tensor,
    config: PatchTSTConfig,
    batch_size: int = 32,
    shuffle: bool = True,
    num_workers: int = 0,
) -> DataLoader:
    """Create dataloader for fine-tuning."""
    dataset = TimeSeriesDataset(
        data=data,
        targets=targets,
        mask_ratio=0.0,  # No masking for fine-tuning
        patch_len=config.patch_len,
        stride=config.stride,
        seq_len=config.seq_len,
    )
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )


def load_pretrained_backbone(
    checkpoint_path: str,
    config: PatchTSTConfig,
    device: torch.device = None,
) -> PatchTSTBackbone:
    """Load pretrained backbone from checkpoint."""
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    model = PatchTSTForPretraining(config)
    checkpoint = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(checkpoint["model_state_dict"])
    
    return model.backbone