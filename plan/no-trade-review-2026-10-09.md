# XAUUSD morning audit — 9 October 2026

## Finding

The robot was connected and evaluating candles. Its installed entry definitions rejected every eligible check. There were visible intraday moves and partial entry patterns, but **no entry passed all the installed rules** in the audited session. The evidence points to a restrictive strategy translation, rather than a broker order failure.

The main blocker was our H4 EMA50/EMA200 definition. Broadening trading hours did not remove it. Removing only that gate would also not produce a qualifying original full setup in this sample.

## Evidence and method

- Retrieved XAUUSD candles directly from David's running FTMO demo terminal, account 1514746116, using read-only MetaTrader Python calls. No order API was called.
- Snapshot: **11:50 São Paulo / 10:50 New York**, 14:50:05 UTC. Captured 1,000 M15, 1,000 H1, 2,000 H4 and 1,000 Daily bars for indicator warm-up.
- Broker tick clock was approximately three hours ahead of UTC. Used that observed offset to map candle timestamps to São Paulo and New York.
- Replayed Strategy.mqh at completed M15 decisions. Higher-timeframe values use the previous completed bar, not current or future candles. EMA uses alpha 2/(period+1); ATR uses the 14-bar true-range average matching the locally installed MT5 example. These are reconstructed values, not exported native indicator buffers.
- Strategy.mqh, OfficeRobot.mq5 and Clock.mqh exactly matched installed source files. Running version: 1.2.4.
- Supabase at 11:55 reported **12 checks / 12 trend waits / 0 pattern waits / 0 requests / 0 trades**, matching the 12 replay decisions from 09:00 through 11:45.
- Raw candles and replay are stored under `.local/audit-2026-10-09/`, excluded from Git. The review CSV and chart are alongside this report.

## Timeline (São Paulo)

Start confirmed at **08:31:07**. Entry session: **09:00–14:00 São Paulo**, corresponding to 08:00–13:00 New York. Continuation begins at **11:00 São Paulo**, corresponding to 10:00 New York.

| Decisions | Last closed H4 price | H4 EMA50 | H4 EMA200 | Direction |
| --- | ---: | ---: | ---: | --- |
| 09:00, 09:15, 09:30, 09:45 | 4,187.68 | 4,164.23 | 4,262.99 | Mixed |
| 10:00 through 11:45, every 15 minutes | 4,175.33 | 4,164.67 | 4,262.12 | Mixed |

Daily was down and H1 was up throughout. M15 was mixed initially, up from 10:30 through 11:15, then mixed again.

## Why H4 remained mixed

BUY requires EMA50 above EMA200 **and** closed H4 price above EMA50. SELL requires both comparisons reversed. Today price was above EMA50, while EMA50 remained below EMA200. The code labels this rebound mixed and returns before checking BOS/retest or continuation. Indicator values were available and well away from the thresholds; missing history does not explain the reconstructed rejection.

EMA50/EMA200 plus the closed-price condition was our translation of the discretionary Daily/H4 direction, not a formula supplied by the strategy document. This ordering can remain bearish long after an intraday rally begins.

## Specific candidates

These are partial patterns, not entries that met the complete strategy. Times are decision times: the confirmation candle closes at that time.

### 10:00 short confirmation

The 09:30 reaction had high **4,191.34**, low **4,179.78**, close **4,181.28**. The 09:45 candle closed bearish at **4,175.33**, below the reaction low and M15 EMA20. It passed the simplified SELL continuation candle conditions in isolation.

Actual entry was barred by H4 and continuation timing. The full setup also failed M15 alignment and the retest-zone test. ATR was **5.7807** and EMA20 **4,183.2523**; the reaction high 4,191.34 exceeded the EMA-zone maximum **4,186.4317** and the identified structure-zone maximum **4,185.8694**.

### 10:30 long confirmation

The 10:00 reaction had low **4,174.04**, high **4,181.06**, close **4,181.03**. The 10:15 candle closed bullish at **4,188.99**, above that high and EMA20.

H4 and continuation timing rejected it. Even with those gates removed, its continuation pullback test fails: reaction close must be at least confirmation-time EMA20 minus 0.35 ATR, or **4,181.3952**. Its close missed that bound by **$0.3652 per ounce**.

The code checks the earlier reaction against the EMA *after confirmation*. Reaction-time EMA20 was **4,183.0406**, versus **4,183.6072** after confirmation. Using reaction-time EMA with the same ATR gives a bound **4,180.8286**, which the reaction passes. This is a moving-threshold sensitivity to review, not an approved change or proof the trade should be taken.

No full BOS/retest candle pattern passed in either direction during 09:00–11:45, even when examined without the higher-timeframe gate. Changing only H4 is therefore insufficient for this morning.

### 11:00 rally without close confirmation

The 10:45 candle reached **4,196.42** but closed at **4,190.12**, below the previous high **4,192.37**. A wick crossed the level; the required close did not. The previous candle was bearish, also failing the full BUY reaction test.

## Minimum-size constraint

Broker XAUUSD contract size: **100 ounces/lot**. Minimum volume and step: **0.01 lot**, giving one ounce of exposure. A $16 stop distance therefore risks about $16 before fees.

Continuation risk budget: **0.05% × $25,000 = $12.50**. The 10:30 candidate's structural stop is **4,173.092**. The next bar bid open **4,188.84** is already **$15.748** away; a representative $0.35 spread gives about **$16.098**. Minimum volume would exceed the budget, so sizing would refuse this hypothetical continuation even after the earlier gates changed. Exact historical executable quotes were not captured; the bid-only distance already establishes the conflict.

This is a potential additional blocker, not today's actual rejection reason: the robot never reached sizing. Do not silently round volume up above the risk budget.

## Recommended changes to investigate

1. Calibrate how our trend definition treats rebounds using marked strategy examples. Compare price structure with the EMA proxy; do not automatically allow every mixed reading.
2. Review reaction-time versus confirmation-time EMA, zone tolerance and the fixed six-bar BOS definition.
3. Display stop distance, minimum-lot risk, risk budget and calculated volume.
4. Record indicator values and individual gate results for every M15 check. Separate operational permission (`can_trade`) from signal readiness.
5. Replay proposed changes separately, including losing examples. This audit does not establish profitability or justify forced daily entries.

## Artifacts and limits

- `market-audit-2026-10-09.png`: candles, EMA20 and H4 values. The latest 11:45 candle is partial at capture and is not used as a completed confirmation.
- `market-audit-2026-10-09-checks.csv`: every session decision, with pattern-only counterfactuals.
- `tools/audit-market.py`: read-only capture/replay; `tools/plot-market-audit.py`: frozen-snapshot plotting.

No EA strategy, risk setting, control or Supabase record was changed. No trades were placed. Historical executable quotes, fees, every past guard state and discretionary STRONG/DXY scoring were not replayed. Those limits do not change the finding that every current-rule check failed the trend gate before execution.
