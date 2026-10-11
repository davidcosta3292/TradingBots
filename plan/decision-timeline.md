# Trader decision timeline — 11 October 2026

## Questions this answers

1. Did an M15 setup pass the strategy gates, operational permission, position ownership and sizing checks?
2. Was an MT5 order call made for that exact check, and what did its return code say?
3. Did the broker record an actual entry or exit deal, with which price, volume and tickets?
4. Is evidence missing because reporting failed, restarted or lost correlation?

EA runtime 1.3.1 observes strategy revision 1.3.0. Entry definitions, all inputs, news/FTMO guards, demo-only restrictions and risk limits remain unchanged. There is no trade quota, automatic order retry, or new Analyst authority.

## Evidence chain

| Record | What it establishes | What it does not establish |
|---|---|---|
| Decision | Closed-bar strategy snapshot, each gate, operational permission, occupancy and original sizing | A submitted order or execution |
| Submission | Refreshed sizing and start of the CTrade call, or a preflight block | Server receipt or a fill |
| Response | Copied MqlTradeRequest/MqlTradeResult, return and external codes, request/order/deal tickets, terminal error and call duration | An actual fill solely because the call returned true |
| Broker order history | A canceled, expired, rejected or marked-filled order | A deal solely because the order is marked filled |
| Fill / exit | An actual matching broker deal, its price, volume, position and booked amounts | That a partial deal filled or closed the whole position |

Checks identify the robot, runtime version and UTC M15 decision bar. The bar timestamp is the start of the next bar after the evaluated candle; checked_at records when evaluation ran. Orders receive a compact `TO|version|bar|nonce` comment and attempt ID. Order/request tickets map exactly to attempts while the EA is running. Broker comments and historical entry orders may recover that link after restart. Exit deals link to an original entry only when all position entries belong to this robot and agree on the attempt.

Callback arrival order is not guaranteed. The UI uses occurrence time; same-second events are arranged by phase for readability. Report ingestion time is stored separately. The timeline keeps four recent checks plus up to four recent checks with order events; history loading fetches at most 150 execution records and 20 associated decision snapshots per robot. The in-browser cache is bounded to 300 records per robot. Older or unlinked records are labeled honestly, without assigning them to the nearest check.

## Persistence and access

- `decision_events` has an immutable `(robot_id,event_id)` key. Replays are deduplicated.
- `capture_decision_events` is a security-invoker reporting trigger on `robots.status.timeline_batch`. It also backfills the existing `strategy_checks` table. It runs through the existing token-authenticated robot_sync; robot_sync itself is unchanged.
- Only signed-in office members can read the new table. Browsers cannot insert/update it. It is published to Realtime.
- Reports accept at most 20 timeline records per batch, with bounded fields and payloads. Invalid telemetry produces a sanitized `telemetry / invalid` record rather than blocking the heartbeat or an operator acknowledgement. Invalid input is not echoed into logs.
- Cron prunes this new table after 30 days based on recording time. No earlier news or deal archive is changed.
- Journals contain allowlisted evidence, not token/password fields. The token is used only to hash the filename identity with broker/account/symbol/magic. Journal and checkpoint live in the terminal's Files/OfficeTimeline directory, outside Git and source downloads.
- File writes are flushed. The acknowledgement offset advances only after a successful full report and a saved checkpoint. An ambiguous network result resends identical telemetry IDs, never an order. Checkpoint failure causes safe duplicate reporting.
- Disk failures degrade to a 200-record memory queue, with visible error/gap counters. This fallback can lose unreported data on restart. A damaged final line is skipped and counted as a gap. Successfully written older journal records remain available on reattach.
- Local append-only files grow with use and have no automatic pruning in this release. A fresh machine has no old local queue. Startup recovery checks the last week of this robot's broker deals, only recovering those with the new correlation metadata. It cannot recreate missing preflight checks or broker responses.

The scheduled Fundamental Analyst does not write this table or authorize trades. Existing Telegram behavior is unchanged: actual trade deals and normal errors/commands are announced; M15 waits do not flood the group.

## When evidence is incomplete

1. **Accepted / unknown without a fill:** inspect MT5 Trade and History for the exact ticket. Never resubmit based only on an office timeout. Timeout, connection and generic processing errors stay unknown.
2. **Telemetry warning:** inspect the EA Experts log and Files/OfficeTimeline directory. Restore disk access, then reattach with the same token/account/symbol/magic. Retained events replay; a fresh attachment is paused.
3. **No link:** inspect the broker's entry order/deal comment. A stripped comment and lost ticket mapping cannot be reconstructed from timestamps. Unlinked evidence remains separate.
4. **Signal ready but entry blocked:** inspect permission, occupancy and sizing independently. This release does not bypass a guard or raise a budget to make a trade.

## Delivery evidence and limits

Native EA compilation: 0 errors, 0 warnings. Frontend syntax checked. The demo artifact was inspected at desktop size and a 390 px phone viewport without horizontal timeline overflow. Database metadata confirms member RLS, no anonymous read/client write, Realtime publication, ingestion trigger and active retention job. No implementation tests, Strategy Tester runs, forced orders, fake database deals or Telegram exercise messages were used.

The real broker-to-office chain still needs observation after David activates EA 1.3.1 and a natural demo setup occurs. Compilation and schema inspection do not establish execution parity or profitability. Supabase advisers show the existing token-RPC/private-table/password warnings; the new unused-index INFO notices are expected before timeline traffic ([linter reference](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)).

## Activation

Windows installation: robot/install.ps1. Canonical Navigator folder: OfficeRobot → OfficeRobot. Reattach, retain the existing token and unique magic number, enable Algo Trading, then Start from the office. On a Mac, use the updated OfficeRobot-source.zip from the hosted office and compile the source in MetaEditor. There is no token rotation in this update.
