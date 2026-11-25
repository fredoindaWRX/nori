# NORI Market Intelligence roadmap

Status: Phase 0 deterministic local forecast, paper-backtest, risk-policy, and
calibration-ledger primitives are implemented in
`shared/markets/market_intelligence.py`. No live exchange adapter is bundled.

## Benchmarks

NORI will benchmark against these current open-source foundations without
copying their branding or presenting their results as guarantees:

- Freqtrade/FreqAI: realistic historical crypto backtesting, rolling model
  retraining, dry-run wallets, fees, and strategy protections.
  <https://docs.freqtrade.io/en/stable/backtesting/>
- Hummingbot: modular centralized/decentralized exchange connectors,
  controller/executor strategy separation, order tracking, and multi-bot
  deployment. <https://hummingbot.org/docs/>
- Microsoft Qlib: loosely coupled data, training, workflow, and quantitative
  research infrastructure.
  <https://github.com/microsoft/qlib/blob/main/docs/introduction/introduction.rst>
- FinRL-X: AI-native modular research that can combine rule-based, reinforcement
  learning, and sentiment components without changing execution semantics.
  <https://github.com/AI4Finance-Foundation/FinRL>

## NORI-owned advantage

NORI's target is a single local intelligence and accountability layer across
research, business operations, markets, sports, and the owner's other systems:

1. Every forecast carries its feature snapshot hash, probability, confidence,
   regime, reasons, horizon, model version, and data lineage.
2. Walk-forward evaluation prevents future data from leaking into training.
   Results include fees, spread, slippage, latency, rejected orders, delisted
   assets, and unavailable liquidity.
3. A calibration ledger scores forecasts after the outcome. Models compete
   against simple baselines and only advance through the learning candidate
   gate when they improve out-of-sample risk-adjusted results.
4. Regime routing lets The Architect select trend, range, volatility, news, or
   no-trade specialists. Disagreement between Knights lowers position size.
5. Portfolio policy controls exposure by asset, venue, correlation, drawdown,
   daily loss, and total risk. The Sentinel can halt execution independently.
6. Paper mode and shadow mode are permanent product modes. Neither can silently
   enable live execution.
7. A live connector is a separately installed signed adapter. Owner enrollment,
   account binding, explicit strategy selection, hard limits, idempotent orders,
   reconciliation, emergency stop, and append-only audit are mandatory.
8. The same engine supports sports and boxing probabilities through separate
   lawful data adapters, calibration datasets, age/location checks, and
   operator-defined spending limits.

## Delivery phases

| Phase | Deliverable | Advancement evidence |
|---|---|---|
| 0 | Deterministic indicators, probability forecast, paper portfolio, risk policy, calibration ledger | Unit tests and reproducible fixture hash |
| 1 | Signed historical-data bundles, crypto bar/order-book adapters, data-quality reports | Deterministic replay with missing/corrupt-data tests |
| 2 | Walk-forward laboratory, baseline comparison, feature registry, model cards | Unseen-period results including all modeled costs |
| 3 | Multi-strategy portfolio and regime router controlled by The Architect | Shadow run with forecast calibration and bounded drawdown |
| 4 | Exchange sandbox connectors and reconciliation ledger | Testnet orders, partial fills, disconnects, retries, and emergency-stop proof |
| 5 | Owner-enabled live adapter | Independent security review, jurisdiction checks, explicit limits, and staged capital |
| 6 | Sports/boxing research and simulation adapters | Source lineage, calibrated probabilities, lawful use, paper record |

NORI does not claim to predict markets with certainty or guarantee income.
Its measurable advantage is faster local analysis, stronger evidence, strict
risk containment, continuous calibration, and a complete explanation of every
decision.
