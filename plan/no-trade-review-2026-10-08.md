# Robot 01: no-trade review, 8 Oct 2026

## What we observed

- TradingBots Supabase had no Robot 01 entry or exit deals in the preceding seven days. Its latest report at 18:11 UTC showed version 1.2.3, ACTIVE, zero trades today, H4 and Daily down, M15 up, and an entry-hours block at 14:11 New York.
- The local MT5 expert log showed the EA started at 09:24 São Paulo time, received Start at 09:25, and restored ACTIVE through several chart timeframe changes. It logged no entry order. MetaTrader closed at 15:12 São Paulo time, so the EA then stopped running.
- The old code permitted new entries only during 08:00-09:00, 10:00-11:00 and 12:00-13:00 New York. Excluding the entire 09:00 and 11:00 hours was our interpretation of the discretionary document, not a precise rule supplied by the trader.
- The old signal required a strict H4 EMA trend, M15 EMA alignment, a six-bar structure break, an exact retest candle, a reaction, and a next-candle confirmation. Only the latest signal-check reason was stored, so we cannot reconstruct every missed setup from historical reports.
- The screenshot of three manual XAUUSD closes does not show the chart setup or the app's timezone and appears to show a different account balance. It establishes that the trader found opportunities, but cannot establish that those exact trades passed this EA's rules.

## Demo change in version 1.2.4

- Permit new entries throughout 08:00-13:00 New York, subject to market, calendar, account and FTMO guards.
- Prefer the original full setup. After 10:00 New York, if the EA has not filled a trade that day, allow a separate half-risk M15 EMA pullback continuation in the H4 direction with Daily or H1 support and a closed-candle confirmation. The continuation is an experiment, not the PDF's full five-part setup.
- Count completed M15 checks while ACTIVE and flat. Show trend waits, pattern waits and guarded signals in the office. If no trade fills by 13:00 New York, send a Telegram and office explanation. Counters restart when the EA is restarted.
- Do not force an order to satisfy a daily quota. Every order retains a broker stop, a 3R target, size and stop-distance checks, demo-only mode, the news pause and FTMO loss stops.

## Platform decision

TradingView can send webhook alerts to an external application, but its alerts can occasionally fail to arrive. A TradingView signal bridge would need an authenticated receiving endpoint, an exact Pine Script translation of our rules, deduplication, and the MT5 EA's own final risk check. It would not fix a too-strict signal definition by itself. FTMO describes TradingView-platform accounts separately from MetaTrader 5 logins. Rithmic provides futures market data and execution, including COMEX; it is not the execution connection for this FTMO MT5 XAUUSD account. Keep MT5 as the execution platform for this demo iteration.

Sources: [TradingView webhooks](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/), [FTMO TradingView login](https://ftmo.com/en/faq/how-do-i-log-in-to-tradingview/), [FTMO MT5 login](https://ftmo.com/en/faq/how-do-i-log-in-to-mt5/), [Rithmic exchange connectivity](https://www.rithmic.com/platforms/exchanges).
