# Trading Office collaboration notes

Read `README.md` for setup and the relevant plan/audit before changing robot behavior. The current stack is MQL5 execution, Supabase coordination and a Three.js office. Each Trader belongs to one member and uses that member's account; other members inspect it. Demo-only operation is the current scope.

## Evidence and state

- Keep connection health, operator state, operational permission, signal readiness, position ownership and size feasibility distinct. A live heartbeat or active state does not mean an entry exists.
- Diagnose missed entries from broker candles, indicator snapshots and individual gates. Changes to strategy definitions need explicit assumptions and losing/rejected examples; no forced daily entries or undocumented risk increases.
- Preserve the owner's intent across chart-timeframe changes. Commands and acknowledgements need idempotent processing and expiry; a retry must not duplicate an order or notification.
- The Fundamental Analyst provides observations. Its prose and external news cannot authorize orders or alter Trader settings.
- Notify the user of Supabase tables/functions being changed. Keep credentials out of research artifacts, skill files, telemetry and source archives.

## Reusable lessons

`research/03-repository-patterns.md` records reviewed sources, installed skills, limitations and proposed improvements. `research/skills-lock.json` pins their provenance. Use relevant skills and references as needed; installation does not require loading the whole collection into every task.

For market/news evidence practices, the maintained project skill is `skills/market-research-evidence/SKILL.md`. Engineering skill workflows remain subordinate to the user's task scope and existing authorization. Add or run implementation tests only when the user requests testing or verification.
