# XAUUSD plan: translation to robot rules

Source: the two-page `forex.pdf` supplied on 29 Sep 2026. It describes a discretionary plan and says it was based on 940 real trades. The trade log was not supplied, so that performance claim has not been checked. This file is our interpretation for software; it is not a replacement for the source document.

## What the document actually requires

| Area | Rule in the PDF | Robot translation |
| --- | --- | --- |
| Instrument | Almost exclusively XAUUSD | Require the broker's gold symbol for this strategy mode; do not silently trade another chart. |
| Direction | Follow the larger Daily/4H trend | A measurable trend definition is needed. EMA alignment is listed as an optional STRONG item, so it should not silently become the entire CORE trend rule. |
| Entry gate | All five CORE items: 4H direction, break of structure (BOS), pullback to a relevant zone, visible reaction, 15M confirmation | No order until all five are true on *closed* candles. BOS, zone, reaction, and 15M confirmation need exact definitions and timeframes. |
| Extra confluence | At least three STRONG items and one entry-candle price-action item for a full setup | Score independently defined conditions. The document permits a weaker setup with reduced size or no trade; defaulting to **no trade** is the clearer first version. |
| DXY | Check correlation before entering; confirmation, not a stand-alone signal | Optional only after the broker's DXY symbol and a measurable correlation window are agreed. Missing DXY data must be visible, not silently treated as confirmation. |
| Trade size | At most 1.0 lot | Cap size at 1.0 lot *after* risk-based sizing. The PDF gives no account-risk percentage. |
| Stop and target | Stop set before entry, never moved against the trade; reward/risk at least 2:1, target 3:1, at most 4:1 | The robot already submits an initial stop and target with orders. Exact stop placement and when 2R versus 3R versus 4R applies remain open. |
| Frequency | Aim for no more than five trades a day; a later line says never exceed 8-10, while the pre-entry checklist says stop after more than five | Use **five as the proposed hard cap**, pending owner confirmation. Count filled entries, not rejected order attempts. |
| Losing streak | Wait 20-30 minutes after one loss; stop for the day after two consecutive losses | Propose a 30-minute cooldown and `DONE_TODAY` after two net-losing closed positions. Count position outcomes rather than individual partial-fill deals. |
| Hours | 08:00-13:00 New York; 08:00-10:00 and 12:00-13:00 are called sweet spots; avoid 09:00 and 11:00 | Use actual New York wall time with daylight saving. Exact excluded intervals need confirmation; “avoid 09:00” may mean one hour or only a news moment. The PDF's winter-shift note needs clarification: 08:00 New York local time stays 08:00 locally, while its offset from the broker/Prague clock changes. |
| News | Avoid NFP and other high-impact releases | The current EA checks MT5's high-impact calendar and pauses entries from 15 minutes before to 15 after. The PDF does not set a blackout duration, so this interval is an existing project setting, not a rule from the PDF. |
| Duration | Avoid scalps under 15 minutes; target 1-6 hours | Build signals on 15M and higher bars and consider a six-hour time exit. Do **not** suppress a protective stop or target to force a position to last 15 minutes. |
| Day patterns | Friday was best; Tuesday was weak; Sunday open requires care | Treat these as observations, not automatic position-size boosts or bans, unless supported by the underlying trade log and an explicit rule. |
| Human checklist | Read plan, review trades, rested and calm | Display a pre-session checklist for a person; software cannot verify rest, stress, or conviction. |

## Entry definitions needed before coding the real strategy

The PDF names the five CORE checks, but gives no formulas or marked charts. These choices determine which trades the robot takes:

1. **4H direction:** which swing highs/lows or other measure defines an uptrend or downtrend? How many confirmed candles are required?
2. **BOS:** which timeframe; wick or candle close; which prior swing; minimum break distance; and how long does a BOS remain valid?
3. **Relevant zone and pullback:** how is the zone drawn (broken swing, supply/demand, order block, support/resistance)? How close must price return, and how long can it take?
4. **Visible reaction and 15M confirmation:** which candle pattern qualifies; does the next 15M candle have to close beyond the reaction candle?
5. **STRONG score:** exact tests for liquidity sweep, support/resistance, previous-day high/low, and EMA 50/200; whether overlapping tests can count twice.
6. **Stop, target, and size:** structural stop or ATR stop; which market condition selects 2R, 3R, or 4R; percentage of initial account balance risked per entry, in addition to the one-lot cap.
7. **Time and news:** exact excluded portions of 09:00 and 11:00 New York, and the NFP/high-impact blackout duration.

Three winning and three losing trades marked on charts, with entry, stop, exit and why each CORE/STRONG item passed, would let us compare the robot's signals to the trader's actual decisions. Without that, numerical rules would be a new strategy inspired by this plan, not the same strategy.

## Proposed rollout

1. Keep the current **demo exercise** running unchanged for execution checks. Its M1 EMA bias and three-minute exit contradict this PDF and are not the new strategy.
2. Agree on the definitions above, then implement a separate **XAUUSD plan** mode that is off by default. Reuse the existing office controls, Telegram trade reports, news watch, FTMO limits and demo-only gate.
3. Compare signals against the six marked example trades; inspect entries and exits in the MT5 Strategy Tester and a demo account. Only then replace the exercise on a running chart. Attaching an updated EA restarts it paused.
4. Apply the strategy to Jhonatan's Trader only when his own account and robot are activated. The Risk Management office slot is still a role label, not a connected risk service.
