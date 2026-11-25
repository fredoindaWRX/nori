# Live execution boundary

The local market-intelligence module accepts validated historical bars,
produces probability forecasts, backtests deterministic strategies, and
records calibration outcomes. It has no network client, credential reader, or
order-placement method.

A future live adapter must be separately installed and signed. It must require
an enrolled owner, an explicit account binding, maximum position and daily-loss
limits, an emergency stop, idempotent order identifiers, exchange-side status
reconciliation, and an append-only decision and execution audit. Paper mode is
the default and cannot silently promote itself to live mode.
