# Build plan

Started 24 Sep 2026; updated 29 Sep. How we get from [the plan PDF](Trading-Office-Plan.pdf) to a robot trading a demo account that we control from the office.

## Decided

- **The office controls the robots (option B):** Start, Pause, Done for today, Close everything. Nobody places trades from the office.
- **Where it runs:** our own PC during demo. The robot moves to a VPS for the last 1–2 weeks of demo, then goes live on the VPS.
- **FTMO, 2-Step rules, demo only for now** (24 Sep): FTMO Free Trials on MetaTrader 5, to see whether the robot fits the challenge's rules.
- **Two accounts, two robots, one office** (24 Sep): one FTMO account each. Only a robot's owner can press its buttons; the other watches.
- **XAUUSD strategy draft** (29 Sep): replaced the three-minute execution exercise with a measurable 4H-led, 15M entry plan for demo. The rules and limitations are in [forex-strategy-review.md](forex-strategy-review.md).

## Still open

The platform is MetaTrader 5. Before going live, compare the draft's signals with marked examples, measure demo results and FTMO rule adherence, complete the [strategy card](strategy-card.md), decide the demo length and responsibilities, and review the controls for a live release.

## How the four buttons behave

This is the contract between the office and the robot. The robot enforces it; the office only asks.

| Button | The robot… | Its open trades | It comes back when |
|---|---|---|---|
| **Start** | may open new trades, within its rules and trading hours | untouched | — |
| **Pause** | opens no new trades | keep their stop and target, and finish normally | we press Start |
| **Done for today** | opens no new trades | keep their stop and target, and finish normally | automatically, when the next session opens |
| **Close everything** | closes its open trades and cancels its pending orders now, then pauses | closed at market | we press Start |

Seven rules around the buttons:

1. **A button acts on one robot.** It touches only that robot's trades (its magic number), never the whole account.
2. **The robot confirms every command.** It answers either "done" or "refused" with a reason. If no answer arrives within 10 seconds, we get a phone alert.
3. **Commands expire.** A command that isn't picked up within 60 seconds is dropped, so a Start can't fire hours later after a reconnect.
4. **Robots start paused.** After any restart the robot comes up paused and tells us. A power cut at 3 a.m. never leads to trading nobody asked for.
5. **The robot's limits win.** A daily loss limit or end-of-session flatten overrides any button. No button can raise a limit.
6. **Login, confirmation, and a log.** Only our two accounts can press buttons. Close asks twice. Every press is logged with who and when.
7. **Losing the database is fine.** If the robot can't reach the database, it keeps its current state and its own rules, and catches up when the connection is back.

## Milestones

Each milestone ends with something we can see working.

### M0 · Decide and describe (you two, this week)

- Pick the platform and open a demo account.
- Fill in the strategy card.
- Create the free Supabase project and the Telegram alert bot. I'll walk you through both. The accounts and keys are yours: create them yourselves, and put the keys in the local `.env` file, never in chat.

**Done when:** the platform is picked, the card is filled in, and the demo account and both services exist.

### M1 · The buttons, on a test robot (me)

**Status (29 Sep):** Robot 01 previously reported from FTMO demo account 1514746116 and confirmed office controls. OfficeRobot 1.1.0 now has a demo exercise that can open on a closed M1 bar and close after three minutes, plus a fail-closed news watch. It compiled locally with zero errors and was copied into MT5. The terminal was closed when setup began and its saved chart did not load the EA on restart; attaching it and observing a complete demo round trip are still outstanding. Setup steps are in the [README](../README.md).

This is the skeleton everything else hangs on, built before the strategy exists.

- A project repo, and database tables for robots, commands, heartbeats, positions and deals.
- A **demo exercise** on the account: EMA direction chooses the entry on a closed M1 bar, then a timed exit exercises the close path. It uses a 0.05% risk budget, at most two entries per day, and refuses to run on a live account.
- The robot side of the contract above: a heartbeat every 30 seconds, a command check every few seconds, and a confirmation for every command.
- A phone-friendly control page showing each robot's state and the four buttons. It's the plain version of the office panel; the 3D office comes in M4.
- Telegram alerts for: heartbeat lost, command not confirmed, robot restarted.

**Done when:**
- Pause from your phone gets a confirmation from the robot within about 5 seconds.
- Close makes the demo position disappear, and the page shows the robot flat.
- Unplugging the PC's internet sends an alert within 2 minutes.

### M2 · The real robot (me, with you checking the rules)

- Code the strategy card into the same skeleton. The buttons and reporting are already there.
- Backtest it. The platform's backtester can't make web calls, so reporting switches itself off there.
- Check that the backtest finds the example trades listed on the card.

**Done when:** the backtest trades like you do, in good and bad periods.

### M3 · Demo on our PC (weeks)

- The robot trades the demo account from the PC, which is set up to stay on: no sleep, no surprise restarts.
- A 30-minute weekly review comparing demo with the backtest.

**Done when:** the agreed number of weeks track the backtest.

### M4 · The 3D office (while the M3 demo weeks run)

**Status (27 Sep):** version 2 is built on top of version 1.
- **Version 1 (25 Sep):** the robots and desks, the lounge, the offline look, the wall screen, and the four buttons in a side panel.
- **Version 2 (27 Sep):**
  - A coffee bar where a switched-on robot waits when its own rules say "not now" (outside its hours, market closed, news). Before this, the office said "Working" at night.
  - Speech bubbles for what each robot just did, and a trade history chart on each desk and card.
  - A camera tour, and the camera following the selected robot.
  - Optional sounds, and a colour and gear per robot, chosen by its owner.
- **Online now:** the Vercel office works on phones and Macs; only connected Trader EAs are operational.
- **Room refresh (8 Oct):** a furnished café and lounge, padded seating, an espresso machine, warm floor lamps and a city window. The first four desks form two rows. Added camera shortcuts, daylight/evening lighting, a robot selection dock, more robot detail, and quicker camera movement. Monitor textures are only redrawn when their displayed data changes. Narrow screens get closer camera views and a bottom control panel.

Telegram now also reports every button press the robot answers, and every trade it opens or closes, the moment it happens.

- Clicking a robot or its dock entry opens its panel: P&L, positions and the four buttons, using the same commands as M1.

### M5 · AI helpers (read-only)

- The separate [Fundamental Analyst](news-agent.md) now reads public feeds, fills its office card and sends short Telegram news alerts. The Trader EA still watches the MT5 calendar independently; the scheduled Telegram check-in links to the private office without financial figures.
- Ask about any robot, e.g. "why did we lose today?".
- The helpers read the database only. They can't press buttons.

### M6 · VPS, then live

- Move the robot to the VPS for the last 1–2 weeks of demo.
- Go live at the smallest size once the kill rules are written down.

## Where we start

1. **You two:** pick the platform and start the strategy card.
2. **You:** open the demo account, and create the Supabase project and Telegram bot with my guidance.
3. **Me:** once the platform is picked, set up the repo and build M1.
