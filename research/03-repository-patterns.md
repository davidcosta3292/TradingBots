# Repository lessons for Trading Office and future projects

Reviewed 9 October 2026. The review inspected README files, selected skill instructions and implementation files at the commits below. It did not execute the upstream applications or establish their trading performance.

## What each repository contributes

| Source | Reviewed commit | Useful here | Useful later |
|---|---|---|---|
| [pstack](https://github.com/backnotprop/pstack) | `3a604672c46cd8187d2b19980eae0a34f9f91138` | Explicit robot state; retry-safe commands; evidence behind replay and performance claims | Domain models, reproducible measurements and diagnosis of root causes |
| [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis) | `ce364e457aab288863a5707e7b3df79786ad07f2` | Structured analyst reports, source provenance, data quality, delivery diagnostics | Scheduled research, provider adapters, report history and dashboards |
| [Addy's agent-skills](https://github.com/addyosmani/agent-skills) | `1401c8b8030e023baeebb31781a6653fe8e93026` | Systematic debugging, structured telemetry and measured office performance | Engineering workflows across frontend and backend projects |
| [SwiftUI-Agent-Skill](https://github.com/twostraws/SwiftUI-Agent-Skill) | `f9800713b24580bc444931949aad4519128605e8` | General lessons about stable view identity, narrow updates, accessible controls and motion | Native iOS/macOS projects; SwiftUI itself is not our Three.js implementation |

All four repositories use MIT licenses at these snapshots. Installed upstream skills include the original license. Research data-provider access, news copyright and API costs have separate terms; the repository license does not grant those services.

## Selected skills made available globally

Installed under `C:/Users/david/.codex/skills`, available on the next turn. The machine-readable manifest is [skills-lock.json](skills-lock.json).

### pstack — six focused skills

- `principle-model-the-domain`: represent lifecycle and ownership explicitly.
- `principle-make-operations-idempotent`: handle repeat commands and interrupted work.
- `principle-fix-root-causes`: instrument the failing layer before guessing at changes.
- `principle-explain-the-number`: identify what a reported number actually measures.
- `principle-prove-it-works`: inspect the actual artifact and runtime value.
- `benchmark-checklist`: retain conditions, repetition and error counts alongside speed claims.

The measurement skills' sibling references are installed together. Their unsupported upstream invocation flag is preserved as provenance metadata; normal Codex skill selection remains enabled. No autonomous multi-model orchestrator, approval bypass or automatic shipping mode was enabled. Reference: [pstack skill directory](https://github.com/backnotprop/pstack/tree/3a604672c46cd8187d2b19980eae0a34f9f91138/skills).

### Addy — three focused skills

- `debugging-and-error-recovery`: preserve evidence, reproduce, localize and reduce failures.
- `observability-and-instrumentation`: stable event names, correlation and entry-point attribution, useful alerts.
- `performance-optimization`: profile a real bottleneck, change one thing and keep gains that exceed noise.

Two shared root-level checklists were bundled inside their installed skill folders and paths repaired. Per-skill installation alone would leave those links unresolved. Other process requirements remain subject to user scope and our host instructions, including permission for implementation tests. Reference: [engineering skills](https://github.com/addyosmani/agent-skills/tree/1401c8b8030e023baeebb31781a6653fe8e93026/skills).

### SwiftUI — one complete skill

`swiftui-pro` includes its API, data flow, navigation, layout, accessibility and performance references. A duplicate nested plugin entry was moved into a reference file to avoid duplicate skill discovery. Apple's [SDK/toolchain support](https://developer.apple.com/xcode/system-requirements) was checked; platform-specific advice still depends on the actual project's SDK and deployment target. A Mac with a browser does not make the Trading Office frontend a SwiftUI app.

### Market research — one project-authored synthesis

`market-research-evidence` captures source timing, freshness, provenance, invalidation conditions, durable notification state and replay limitations. Its maintained source is [SKILL.md](../skills/market-research-evidence/SKILL.md). The stock repository has a root skill, but it imports that application's services and configuration; installing just that file would not provide a working service. We therefore extracted reusable evidence practices without installing its runtime.

## Specific lessons from the stock-analysis implementation

### A report should retain evidence and reassessment conditions

The structured artifact separates a thesis, its evidence, quality and conditions that would require reassessment. Provider observation time is distinct from fetch time; missing timing remains unknown. The reviewed adapter builds some artifacts dynamically from historical reports rather than freezing all evidence at generation. For our implementation, immutable snapshots are a proposed improvement. Reference: [research artifact contract](https://github.com/ZhuLinsen/daily_stock_analysis/blob/ce364e457aab288863a5707e7b3df79786ad07f2/docs/research-artifact.md) and [adapter](https://github.com/ZhuLinsen/daily_stock_analysis/blob/ce364e457aab288863a5707e7b3df79786ad07f2/src/services/research_artifact_service.py).

### Provider fallbacks need visible provenance

The provider base records fields such as provider timestamp, fetch time and fallback source. This is useful when a primary feed fails: a replacement's successful response is not sufficient evidence that the data is timely or equivalent. We should retain original error and instrument coverage, rather than silently reporting a healthy complete scan. Reference: [provider base](https://github.com/ZhuLinsen/daily_stock_analysis/blob/ce364e457aab288863a5707e7b3df79786ad07f2/data_provider/base.py).

### Notification noise control is distinct from delivery

The notification code separates severity, deduplication, cooldowns and quiet hours. Its noise state is explicitly process-local. Copying that storage design into independent Supabase invocations would lose coordination between runs. Our adaptation should use durable database state and distinguish queued, attempted, delivered, retrying and failed. Quiet hours should not suppress urgent execution/risk failures. Reference: [noise control](https://github.com/ZhuLinsen/daily_stock_analysis/blob/ce364e457aab288863a5707e7b3df79786ad07f2/src/notification_noise.py) and [Telegram sender](https://github.com/ZhuLinsen/daily_stock_analysis/blob/ce364e457aab288863a5707e7b3df79786ad07f2/src/notification_sender/telegram_sender.py).

### A model score has limited meaning

The research contract converts sentiment into a confidence field. That is an output convention, not evidence of calibrated trade probability. For our Analyst, source confidence and model interpretation should be labeled separately. A report may be neutral or unknown; it must not manufacture a directional conclusion or become an order instruction. Reference: [research artifact contract](https://github.com/ZhuLinsen/daily_stock_analysis/blob/ce364e457aab288863a5707e7b3df79786ad07f2/docs/research-artifact.md).

## Proposed Trading Office improvements

These are prioritized proposals, not changes deployed by this research task.

| Priority | Improvement | What already exists | Concrete next work and acceptance evidence |
|---|---|---|---|
| 1 | Explain the full decision chain | Version 1.3.0 records M15 gates and sizing | Use a stable `(robot, bar, version)` check ID through candidate, command, broker submission and fill. Show which stage waited; reconcile native EA behavior with candle replay when verification is requested. |
| 2 | Fundamental Analyst evidence cards | Scheduled RSS/calendar scan, timeouts, source health, title keyword relevance | Add published/event/observed/fetched timestamps, explicit unknown/stale states, provider provenance and source-specific failures. Show citations and reassessment conditions for interpreted reports. |
| 3 | Telegram delivery visibility | Database alerts and trade/command notifications | Add an outbox with idempotency key, attempts, bounded retries and confirmed response metadata. Display delivery failures separately from robot offline status. |
| 4 | Strategy definition as a versioned contract | Strategy card, code definitions and replay artifacts | Store rule version and configuration hash; keep human-marked positive, negative and ambiguous examples. Compare structure and EMA readings before changing gates. |
| 5 | Measured office performance | Camera controls, mobile layout and lazy scene loading | Capture input latency, frame-time distribution, draw calls and update counts on representative phones. Profile scene vs DOM/realtime work, then change one bottleneck. No percentage speed claims without measurements. |
| 6 | Accessible and stable interaction | Robot dock, cards and labeled controls | Audit keyboard/focus, non-color status labels, text scaling and reduced motion. Preserve camera, selection and open disclosures during updates. |

The news watcher currently filters headlines by keywords; it does not read full articles or perform verified causal macroeconomic analysis. Better source cards can be implemented before adding paid search or LLM calls. Any later model integration requires a provider/cost decision and grounded output validation.

## Where to start

The first useful engineering slice is source freshness and provenance for the existing Fundamental Analyst, paired with a decision-chain view for Trader diagnostics. Both improve what the office can explain. They do not require a new trading platform, an upstream stock strategy, or a new VPS. Keep the deterministic EA responsible for execution and FTMO guards.

New project guidance is in [AGENTS.md](../AGENTS.md). The source snapshots remain in ignored `.local/repo-learning-2026-10-09/`; the production office excludes `research/`, `skills/` and `tools/` from upload.
