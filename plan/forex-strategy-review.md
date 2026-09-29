# XAUUSD plan: translation to robot rules

Source: the two-page `forex.pdf` supplied on 29 Sep 2026. It describes a discretionary plan and says it was based on 940 real trades. The trade log was not supplied, so that performance claim has not been checked. This file is our interpretation for software; it is not a replacement for the source document.

## What the document actually requires

| Area | Rule in the PDF | Robot translation |
| --- | --- | --- |
| Instrument | Almost exclusively XAUUSD | Require the broker's gold symbol for this strategy mode; do not silently trade another chart. |
| Direction | Follow the larger Daily/4H trend | Draft v1 uses a closed 4H EMA 50/200 trend, checks Daily and 1H EMA 20/50, and requires closed 15M EMA 20/50 alignment. This is our measurable substitute for the discretionary trend reading. |
| Entry gate | All five CORE items: 4H direction, break of structure (BOS), pullback to a relevant zone, visible reaction, 15M confirmation | Draft v1 implements all five with the rules below, using completed 15M candles. |
| Extra confluence | At least three STRONG items and one entry-candle price-action item for a full setup | Draft v1 does **not** claim to implement the PDF's STRONG score. It uses Daily/1H alignment for full or half risk; this is our demo choice. |
| DXY | Check correlation before entering; confirmation, not a stand-alone signal | Optional only after the broker's DXY symbol and a measurable correlation window are agreed. Missing DXY data must be visible, not silently treated as confirmation. |
| Trade size | At most 1.0 lot | Draft v1 risks 0.10% of initial account balance on full alignment or 0.05% with one supporting trend. It caps broker volume at 1.0 lot. The PDF gives no account-risk percentage. |
| Stop and target | Stop set before entry, never moved against the trade; reward/risk at least 2:1, target 3:1, at most 4:1 | Draft v1 places the stop beyond the reaction/confirmation candles with an ATR buffer, at least 1.2 ATR from signal close, rejects an entry if the stop exceeds 4 ATR from execution, and submits a 3R target to the broker. |
| Frequency | Aim for no more than five trades a day; a later line says never exceed 8-10, while the pre-entry checklist says stop after more than five | Draft v1 caps at five filled plan entry deals per Prague day. Earlier three-minute exercise entries are excluded. |
| Losing streak | Wait 20-30 minutes after one loss; stop for the day after two consecutive losses | Draft v1 waits 30 minutes after a net-losing closed plan position and goes `DONE_TODAY` after two consecutive net-losing plan positions in the Prague day. Earlier exercise outcomes are excluded; their P&L still counts toward account limits. |
| Hours | 08:00-13:00 New York; 08:00-10:00 and 12:00-13:00 are called sweet spots; avoid 09:00 and 11:00 | Draft v1 allows new entries 08:00-09:00, 10:00-11:00, and 12:00-13:00 New York wall time. It handles US daylight saving. Excluding the full 09 and 11 hours is our interpretation. |
| News | Avoid NFP and other high-impact releases | The current EA checks MT5's high-impact calendar and pauses entries from 15 minutes before to 15 after. The PDF does not set a blackout duration, so this interval is an existing project setting, not a rule from the PDF. |
| Duration | Avoid scalps under 15 minutes; target 1-6 hours | Draft v1 uses 15M closed-bar entries and closes after six hours if still open. Broker stop/target can close earlier; the EA time exit needs MetaTrader running. |
| Day patterns | Friday was best; Tuesday was weak; Sunday open requires care | Treat these as observations, not automatic position-size boosts or bans, unless supported by the underlying trade log and an explicit rule. |
| Human checklist | Read plan, review trades, rested and calm | Display a pre-session checklist for a person; software cannot verify rest, stress, or conviction. |

## The draft's exact signal

These are choices made for demo observation on 29 Sep 2026, with the owner's permission to use our own definitions. They are **not** verbatim formulas from the PDF.

1. **Trend:** 4H closed candle above EMA 50, with EMA 50 above EMA 200, for a buy; invert for a sell. The closed 15M EMA 20/50 trend must agree, and at least one of Daily or 1H EMA 20/50 must agree. Both supporting trends agreeing gives full risk; one gives half risk.
2. **BOS:** a completed 15M candle 3-12 bars ago closed at least 0.05 ATR beyond the prior six-bar high/low. Intermediate closes cannot cross back more than 0.70 ATR.
3. **Zone:** the next-to-last completed 15M candle touches the broken level within 0.35 ATR (and may cross it by at most 0.55 ATR), or touches EMA 20 within a similar buffer, then closes on the trend side.
4. **Reaction:** that candle has a directional body at least 25% of its range, closes in the favorable 35% of its range, and shows either a rejection wick of at least 0.10 ATR or a body of at least 0.35 ATR.
5. **Confirmation:** the most recent completed 15M candle moves in trend direction, closes beyond the reaction candle's high/low, and remains beyond EMA 20. The robot can enter at the next 15M bar if all account, session, calendar and risk guards allow it.
6. **Exit:** broker stop and 3R target are placed with the order. The EA also tries to close any remaining position after six hours. There is no three-minute exercise timer and no forced 15-minute minimum.

The PDF's STRONG score, DXY check, marked support/resistance and discretionary quality judgment are not implemented. Six marked examples, including losses, would help calibrate this interpretation. Neither the PDF's stated performance nor this draft's profitability has been verified.

## Rollout

Robot 01's previous EMA exercise should remain paused until the compiled v1.2.1 EA has been installed and reattached. The new EA starts paused; David can then press Start in the office for demo operation. Jhonatan's separate Trader remains for later activation. The Risk Management office slot is still a label, not a connected risk service.
