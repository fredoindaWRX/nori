"""Deterministic, offline-first market analysis and paper execution.

This module never connects to an exchange and never places an order. Live
execution is a separate signed adapter boundary.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from statistics import fmean, pstdev
from typing import Iterable


@dataclass(frozen=True)
class MarketBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float

    def validate(self) -> None:
        values = (self.open, self.high, self.low, self.close, self.volume)
        if not all(math.isfinite(value) for value in values):
            raise ValueError("market bar contains a non-finite value")
        if min(self.open, self.high, self.low, self.close) <= 0 or self.volume < 0:
            raise ValueError("prices must be positive and volume cannot be negative")
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("OHLC range is inconsistent")


@dataclass(frozen=True)
class RiskPolicy:
    starting_cash: float = 10_000.0
    max_position_fraction: float = 0.10
    max_drawdown_fraction: float = 0.12
    fee_bps: float = 10.0
    slippage_bps: float = 5.0
    buy_probability: float = 0.60
    sell_probability: float = 0.44

    def validate(self) -> None:
        if self.starting_cash <= 0:
            raise ValueError("starting cash must be positive")
        if not 0 < self.max_position_fraction <= 1:
            raise ValueError("max position fraction must be in (0, 1]")
        if not 0 < self.max_drawdown_fraction < 1:
            raise ValueError("max drawdown fraction must be in (0, 1)")
        if not 0.5 <= self.buy_probability <= 1:
            raise ValueError("buy threshold must be at least 0.5")
        if not 0 <= self.sell_probability < 0.5:
            raise ValueError("sell threshold must be below 0.5")


@dataclass(frozen=True)
class Forecast:
    timestamp: str
    horizon_bars: int
    probability_up: float
    confidence: float
    regime: str
    reasons: tuple[str, ...]
    feature_hash: str


@dataclass(frozen=True)
class PaperResult:
    starting_cash: float
    ending_equity: float
    return_fraction: float
    max_drawdown_fraction: float
    trades: int
    halted_by_drawdown: bool
    forecast_count: int


class MarketIntelligence:
    def __init__(self, short_window: int = 8, long_window: int = 24):
        if short_window < 2 or long_window <= short_window:
            raise ValueError("windows must satisfy 2 <= short < long")
        self.short_window = short_window
        self.long_window = long_window

    @staticmethod
    def _bars(values: Iterable[MarketBar]) -> list[MarketBar]:
        bars = list(values)
        for bar in bars:
            bar.validate()
        for left, right in zip(bars, bars[1:]):
            if right.timestamp <= left.timestamp:
                raise ValueError("bars must have strictly increasing timestamps")
        return bars

    def forecast(self, values: Iterable[MarketBar], horizon_bars: int = 1) -> Forecast:
        bars = self._bars(values)
        if len(bars) < self.long_window + 1:
            raise ValueError(f"at least {self.long_window + 1} bars are required")
        closes = [bar.close for bar in bars]
        returns = [math.log(right / left) for left, right in zip(closes, closes[1:])]
        short_mean = fmean(closes[-self.short_window:])
        long_mean = fmean(closes[-self.long_window:])
        volatility = max(pstdev(returns[-self.long_window:]), 1e-9)
        trend = math.log(short_mean / long_mean) / volatility
        momentum = sum(returns[-self.short_window:]) / (volatility * math.sqrt(self.short_window))
        recent = returns[-min(14, len(returns)):]
        gains = sum(max(value, 0.0) for value in recent)
        losses = sum(max(-value, 0.0) for value in recent)
        rsi = 100.0 if losses == 0 else 100.0 - 100.0 / (1.0 + gains / losses)
        mean_reversion = -(rsi - 50.0) / 50.0
        score = 0.42 * trend + 0.38 * momentum + 0.20 * mean_reversion
        probability = 1.0 / (1.0 + math.exp(-max(-8.0, min(8.0, score))))
        confidence = min(1.0, abs(probability - 0.5) * 2.0)
        if volatility > 0.04:
            regime = "high-volatility"
        elif short_mean > long_mean * 1.005:
            regime = "uptrend"
        elif short_mean < long_mean * 0.995:
            regime = "downtrend"
        else:
            regime = "range"
        features = {
            "short_mean": round(short_mean, 10), "long_mean": round(long_mean, 10),
            "volatility": round(volatility, 10), "trend": round(trend, 10),
            "momentum": round(momentum, 10), "rsi": round(rsi, 10),
        }
        feature_hash = hashlib.sha256(
            json.dumps(features, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        reasons = (
            f"short/long trend score {trend:.3f}",
            f"normalized momentum {momentum:.3f}",
            f"RSI {rsi:.1f}",
            f"regime {regime}",
        )
        return Forecast(
            timestamp=bars[-1].timestamp, horizon_bars=horizon_bars,
            probability_up=round(probability, 6), confidence=round(confidence, 6),
            regime=regime, reasons=reasons, feature_hash=feature_hash,
        )

    def paper_backtest(self, values: Iterable[MarketBar], policy: RiskPolicy) -> PaperResult:
        policy.validate()
        bars = self._bars(values)
        if len(bars) < self.long_window + 2:
            raise ValueError(f"at least {self.long_window + 2} bars are required")
        cash, units, trades = policy.starting_cash, 0.0, 0
        peak, max_drawdown, halted, forecast_count = cash, 0.0, False, 0
        friction = (policy.fee_bps + policy.slippage_bps) / 10_000.0
        for index in range(self.long_window + 1, len(bars)):
            price = bars[index].open
            forecast = self.forecast(bars[:index])
            forecast_count += 1
            equity = cash + units * price
            peak = max(peak, equity)
            max_drawdown = max(max_drawdown, (peak - equity) / peak)
            if max_drawdown >= policy.max_drawdown_fraction:
                halted = True
                if units:
                    cash += units * price * (1.0 - friction)
                    units, trades = 0.0, trades + 1
                break
            if forecast.probability_up >= policy.buy_probability and units == 0:
                budget = min(cash, equity * policy.max_position_fraction)
                units = budget / (price * (1.0 + friction))
                cash -= budget
                trades += 1
            elif forecast.probability_up <= policy.sell_probability and units:
                cash += units * price * (1.0 - friction)
                units, trades = 0.0, trades + 1
        ending = cash + units * bars[-1].close * (1.0 - friction)
        peak = max(peak, ending)
        max_drawdown = max(max_drawdown, (peak - ending) / peak)
        return PaperResult(
            starting_cash=policy.starting_cash, ending_equity=round(ending, 6),
            return_fraction=round(ending / policy.starting_cash - 1.0, 8),
            max_drawdown_fraction=round(max_drawdown, 8), trades=trades,
            halted_by_drawdown=halted, forecast_count=forecast_count,
        )

    @staticmethod
    def record_outcome(path: Path, forecast: Forecast, actual_up: bool) -> dict:
        probability = forecast.probability_up
        outcome = 1.0 if actual_up else 0.0
        record = {
            "schema": "nori.market.learning.v1",
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "forecast": asdict(forecast),
            "actualUp": actual_up,
            "brierScore": round((probability - outcome) ** 2, 8),
        }
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, sort_keys=True) + "\n")
        return record
