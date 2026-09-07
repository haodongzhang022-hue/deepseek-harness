"""
Core Data Models for US Futures Quant System
All models use Pydantic v2 for validation, serialization, and type safety.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic.types import PositiveFloat, PositiveInt


class Exchange(str, Enum):
    """Supported exchanges"""
    CME = "CME"
    CBOT = "CBOT"
    NYMEX = "NYMEX"
    COMEX = "COMEX"
    ICE = "ICE"


class Sector(str, Enum):
    """Market sectors"""
    EQUITY = "equity"
    ENERGY = "energy"
    METAL = "metal"
    TREASURY = "treasury"
    FX = "fx"
    AG = "ag"
    LIVESTOCK = "livestock"


class DataFrequency(str, Enum):
    """Data frequency enum"""
    TICK = "tick"
    SEC_1 = "1sec"
    MIN_1 = "1min"
    MIN_5 = "5min"
    MIN_15 = "15min"
    MIN_30 = "30min"
    HOUR_1 = "1H"
    HOUR_4 = "4H"
    DAY_1 = "1D"
    WEEK_1 = "1W"


class ContractStatus(str, Enum):
    """Contract lifecycle status"""
    ACTIVE = "active"
    EXPIRED = "expired"
    DELISTED = "delisted"
    PENDING = "pending"


class Bar(BaseModel):
    """
    OHLCV Bar - Core market data unit
    Immutable after creation, validated for consistency.
    """
    symbol: str = Field(..., description="Root symbol (e.g., ES, CL)")
    contract: str = Field(..., description="Specific contract (e.g., ESU24)")
    timestamp: datetime = Field(..., description="Bar open timestamp (UTC)")
    frequency: DataFrequency = Field(..., description="Bar frequency")
    open: Decimal = Field(..., description="Open price")
    high: Decimal = Field(..., description="High price")
    low: Decimal = Field(..., description="Low price")
    close: Decimal = Field(..., description="Close price")
    volume: int = Field(..., ge=0, description="Volume in contracts")
    open_interest: Optional[int] = Field(None, description="Open interest (end of bar)")
    vwap: Optional[Decimal] = Field(None, description="Volume-weighted average price")
    trade_count: Optional[int] = Field(None, description="Number of trades")
    bid: Optional[Decimal] = Field(None, description="Bid at bar close")
    ask: Optional[Decimal] = Field(None, description="Ask at bar close")
    bid_size: Optional[int] = Field(None, description="Bid size at close")
    ask_size: Optional[int] = Field(None, description="Ask size at close")

    # Metadata
    source: str = Field(default="unknown", description="Data source identifier")
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="When we received this bar")
    is_final: bool = Field(default=True, description="Whether bar is final (not building)")

    # Exchange tags for omni-meta style tracking
    exchange: Exchange = Field(..., description="Exchange")
    sector: Sector = Field(..., description="Market sector")
    tick_size: Decimal = Field(..., description="Contract tick size")
    tick_value: Decimal = Field(..., description="Dollar value per tick")
    multiplier: int = Field(..., description="Contract multiplier")

    @field_validator("timestamp", mode="before")
    @classmethod
    def _ensure_utc(cls, v: Any) -> datetime:
        if isinstance(v, str):
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _validate_ohlc(self) -> Bar:
        """Ensure OHLC consistency: High >= max(O,C), Low <= min(O,C)"""
        max_oc = max(self.open, self.close)
        min_oc = min(self.open, self.close)
        if self.high < max_oc:
            raise ValueError(f"High ({self.high}) < max(Open, Close) ({max_oc})")
        if self.low > min_oc:
            raise ValueError(f"Low ({self.low}) > min(Open, Close) ({min_oc})")
        if self.high < self.low:
            raise ValueError(f"High ({self.high}) < Low ({self.low})")
        return self

    

    def to_polars_dict(self) -> dict[str, Any]:
        """Convert to dict suitable for Polars DataFrame"""
        return {
            "symbol": self.symbol,
            "contract": self.contract,
            "timestamp": self.timestamp,
            "frequency": self.frequency.value,
            "open": float(self.open),
            "high": float(self.high),
            "low": float(self.low),
            "close": float(self.close),
            "volume": self.volume,
            "open_interest": self.open_interest,
            "vwap": float(self.vwap) if self.vwap else None,
            "trade_count": self.trade_count,
            "bid": float(self.bid) if self.bid else None,
            "ask": float(self.ask) if self.ask else None,
            "bid_size": self.bid_size,
            "ask_size": self.ask_size,
            "source": self.source,
            "received_at": self.received_at,
            "is_final": self.is_final,
            "exchange": self.exchange.value,
            "sector": self.sector.value,
            "tick_size": float(self.tick_size),
            "tick_value": float(self.tick_value),
            "multiplier": self.multiplier,
        }

    @classmethod
    def from_polars_row(cls, row: dict[str, Any]) -> Bar:
        """Create Bar from Polars row dict"""
        return cls(
            symbol=row["symbol"],
            contract=row["contract"],
            timestamp=row["timestamp"],
            frequency=DataFrequency(row["frequency"]),
            open=Decimal(str(row["open"])),
            high=Decimal(str(row["high"])),
            low=Decimal(str(row["low"])),
            close=Decimal(str(row["close"])),
            volume=row["volume"],
            open_interest=row.get("open_interest"),
            vwap=Decimal(str(row["vwap"])) if row.get("vwap") else None,
            trade_count=row.get("trade_count"),
            bid=Decimal(str(row["bid"])) if row.get("bid") else None,
            ask=Decimal(str(row["ask"])) if row.get("ask") else None,
            bid_size=row.get("bid_size"),
            ask_size=row.get("ask_size"),
            source=row.get("source", "unknown"),
            received_at=row.get("received_at", datetime.now(timezone.utc)),
            is_final=row.get("is_final", True),
            exchange=Exchange(row["exchange"]),
            sector=Sector(row["sector"]),
            tick_size=Decimal(str(row["tick_size"])),
            tick_value=Decimal(str(row["tick_value"])),
            multiplier=row["multiplier"],
        )


class Tick(BaseModel):
    """Individual trade/quote tick"""
    symbol: str
    contract: str
    timestamp: datetime  # UTC, microsecond precision
    price: Decimal
    size: int = Field(..., ge=0)
    side: Literal["buy", "sell", "unknown"] = "unknown"
    bid: Optional[Decimal] = None
    ask: Optional[Decimal] = None
    bid_size: Optional[int] = None
    ask_size: Optional[int] = None
    exchange: Exchange
    conditions: list[str] = Field(default_factory=list)  # Trade conditions flags
    source: str = "unknown"
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("timestamp", mode="before")
    @classmethod
    def _ensure_utc(cls, v: Any) -> datetime:
        if isinstance(v, str):
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)


class ContractSpec(BaseModel):
    """Contract specification from symbols.yaml"""
    symbol: str
    name: str
    exchange: Exchange
    sector: Sector
    tick_size: Decimal
    tick_value: Decimal
    multiplier: int
    margin_initial: int
    margin_maintenance: int
    trading_hours: str  # Reference to session in settings
    roll_rule: Literal["volume", "oi", "date", "custom"]
    roll_offset_days: int
    expiration_months: list[int]
    continuous_symbol: str
    timezone: str

    # Computed properties
    @property
    def point_value(self) -> Decimal:
        """Dollar value per 1.0 price point"""
        return self.tick_value / self.tick_size

    @property
    def dollar_per_tick(self) -> Decimal:
        """Alias for tick_value"""
        return self.tick_value


class ContinuousContract(BaseModel):
    """Continuous contract mapping (front month, 2nd month, etc.)"""
    root_symbol: str
    suffix: str  # "1!", "2!", etc.
    contract: str  # Actual contract code (e.g., ESU24)
    start_date: datetime
    end_date: Optional[datetime] = None
    roll_date: Optional[datetime] = None
    roll_reason: Optional[str] = None  # "volume", "oi", "date", "manual"


class DataQualityReport(BaseModel):
    """Data quality validation report"""
    symbol: str
    contract: Optional[str] = None
    frequency: DataFrequency
    start_time: datetime
    end_time: datetime
    total_bars: int
    expected_bars: int
    missing_bars: int
    gap_count: int
    max_gap_minutes: int
    price_jumps: int
    volume_spikes: int
    zero_volume_bars: int
    ohlc_violations: int
    tick_misalignments: int
    duplicate_timestamps: int
    out_of_order: int
    passed: bool
    details: list[dict[str, Any]] = Field(default_factory=list)
    validated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def completeness_pct(self) -> float:
        if self.expected_bars == 0:
            return 0.0
        return (self.total_bars - self.missing_bars) / self.expected_bars * 100


class FactorValue(BaseModel):
    """Computed factor value with metadata"""
    symbol: str
    contract: str
    timestamp: datetime
    factor_name: str
    value: float
    frequency: DataFrequency
    lookback: int
    version: str = "1.0"
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Lineage
    source_factors: list[str] = Field(default_factory=list)
    formula: Optional[str] = None


class ModelPrediction(BaseModel):
    """Model prediction output"""
    symbol: str
    contract: str
    timestamp: datetime  # Prediction made at this time
    horizon: int  # Bars ahead
    frequency: DataFrequency
    model_name: str
    model_version: str
    prediction: float  # Expected return / signal strength
    confidence: Optional[float] = None  # 0-1
    regime: Optional[str] = None
    features_hash: Optional[str] = None  # For reproducibility


class Position(BaseModel):
    """Current position state"""
    symbol: str
    contract: str
    quantity: int  # Positive = long, Negative = short
    avg_entry_price: Decimal
    current_price: Decimal
    unrealized_pnl: Decimal
    realized_pnl: Decimal = Decimal("0")
    margin_used: Decimal
    entry_time: datetime
    last_update: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    stop_loss: Optional[Decimal] = None
    take_profit: Optional[Decimal] = None
    strategy_id: Optional[str] = None


class Order(BaseModel):
    """Order representation"""
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    contract: str
    side: Literal["buy", "sell"]
    quantity: PositiveInt
    order_type: Literal["market", "limit", "stop", "stop_limit"]
    limit_price: Optional[Decimal] = None
    stop_price: Optional[Decimal] = None
    time_in_force: Literal["DAY", "GTC", "IOC", "FOK"] = "DAY"
    status: Literal["pending", "submitted", "partial", "filled", "cancelled", "rejected"] = "pending"
    filled_qty: int = 0
    avg_fill_price: Optional[Decimal] = None
    commission: Decimal = Decimal("0")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    strategy_id: Optional[str] = None
    parent_order_id: Optional[UUID] = None
    tags: dict[str, str] = Field(default_factory=dict)


class Trade(BaseModel):
    """Executed trade (fill)"""
    id: UUID = Field(default_factory=uuid4)
    order_id: UUID
    symbol: str
    contract: str
    side: Literal["buy", "sell"]
    quantity: PositiveInt
    price: Decimal
    commission: Decimal
    timestamp: datetime
    exchange: Exchange
    liquidity: Literal["maker", "taker", "unknown"] = "unknown"
    strategy_id: Optional[str] = None


class PortfolioState(BaseModel):
    """Portfolio snapshot"""
    timestamp: datetime
    equity: Decimal
    cash: Decimal
    margin_used: Decimal
    margin_available: Decimal
    positions: list[Position]
    daily_pnl: Decimal
    total_pnl: Decimal
    leverage: float
    var_99: Optional[Decimal] = None
    es_975: Optional[Decimal] = None
    max_drawdown: float = 0.0
    peak_equity: Decimal


# Type aliases for common collections
Bars = list[Bar]
Ticks = list[Tick]
Factors = list[FactorValue]
Predictions = list[ModelPrediction]
Positions = list[Position]
Orders = list[Order]
Trades = list[Trade]


# Contract spec loader
from us_futures.config import load_symbols_config

def get_contract_spec(symbol: str) -> ContractSpec:
    """Load contract specification from symbols.yaml config."""
    try:
        symbols = load_symbols_config().get("symbols", {})
        spec_dict = symbols.get(symbol)
        
        if spec_dict is None or "tick_size" not in spec_dict:
            raise KeyError(f"Symbol {symbol} not found in config")
        
        # Convert Decimal strings
        from decimal import Decimal
        return ContractSpec(
            symbol=spec_dict.get("symbol", symbol),
            name=spec_dict["name"],
            exchange=Exchange(spec_dict["exchange"]),
            sector=Sector(spec_dict["sector"]),
            tick_size=Decimal(str(spec_dict["tick_size"])),
            tick_value=Decimal(str(spec_dict["tick_value"])),
            multiplier=spec_dict["multiplier"],
            margin_initial=spec_dict["margin_initial"],
            margin_maintenance=spec_dict["margin_maintenance"],
            trading_hours=spec_dict["trading_hours"],
            roll_rule=spec_dict["roll_rule"],
            roll_offset_days=spec_dict["roll_offset_days"],
            expiration_months=spec_dict["expiration_months"],
            continuous_symbol=spec_dict["continuous_symbol"],
            timezone=spec_dict["timezone"],
        )
    except Exception:
        # Return default ES spec on any error
        return ContractSpec(
            symbol="ES",
            name="E-mini S&P 500",
            exchange=Exchange.CME,
            sector=Sector.EQUITY,
            tick_size=Decimal("0.25"),
            tick_value=Decimal("12.50"),
            multiplier=50,
            margin_initial=12000,
            margin_maintenance=10000,
            trading_hours="equity_rth",
            roll_rule="volume",
            roll_offset_days=3,
            expiration_months=[3, 6, 9, 12],
            continuous_symbol="ES1!",
            timezone="America/Chicago",
        )