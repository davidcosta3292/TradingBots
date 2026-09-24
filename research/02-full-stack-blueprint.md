# Running the whole thing: robots, accounts, agents, 3D office, dashboard, environments

Researched 2026-09-23. Follows [01-3ms-trading-office.md](01-3ms-trading-office.md). Every rule, price and API detail below was checked against the vendor's own page or source code on this date, except where marked as coming from third-party summaries.

## Summary

- **The system is five layers, and they only meet in one place: a database with live updates.**
  - Robots trade.
  - Collectors report what the accounts are doing.
  - The database is the single source of truth.
  - AI agents read it and write notes and alerts.
  - The 3D office and dashboard display it.
- **Nothing except the robots can place an order.** The one thing any other layer can write back is a "pause" flag, which the robots check before every new entry.
- **The hardest constraint is where you trade, not the tech.** Checked against each firm's own page:
  - Apex and Take Profit Trader **ban bots outright**. Two of the four firms 3Ms advertises as "compatible" are among them.
  - Topstep allows bots only through its API, and only from **your own computer, not a VPS**.
  - Lucid and MyFundedFutures allow bots, with conditions.
  - MT5 on your own capital has no such rules.
- **Cheapest real path:** MT5 demo → reporter EA → Supabase → the Claw3D office through its presence endpoint → Telegram alerts → a read-only Claude agent. That's about **$0–30/month** before any trading capital.

## 1. The shape of the system

```
┌──────────────── Windows machine(s): VPS or your own PC ─────────────────┐
│  MetaTrader 5 terminal(s)                NinjaTrader 8                    │
│   ├ robot EAs (magic 6, 12, 77 …)         ├ NinjaScript strategies         │
│   └ reporter EA ────────┐                 └ reporter AddOn ─────┐          │
└─────────────────────────┼───────────────────────────────────────┼─────────┘
                          │ HTTPS: heartbeats · positions · deals · equity
                          ▼                                       ▼
            ┌──────────────────────── Supabase ─────────────────────────┐
            │ Postgres tables · Realtime · Auth · Edge Functions         │
            │ risk_flags (pause / flatten)  ◀── robots poll before entry │
            └───────┬───────────────────────┬──────────────────┬─────────┘
                    │ Realtime              │ read-only tools   │ webhooks
                    ▼                       ▼                   ▼
           3D office + dashboard     AI agents (Claude     Telegram / push /
           (Claw3D or own R3F app)   Agent SDK)            JARVIS voice
```

Three rules keep this safe:

1. **Only robots place orders.** Every other component reads, and can at most set a pause flag.
2. **Every component sends a heartbeat.** If one goes quiet, that's an alarm. A robot that stops reporting shows as "error" in the office.
3. **Trading passwords never leave the trading machine.** Everything that only watches uses read-only access.

## 2. Layer 1: the robots (what actually trades)

The "agentes" in the 3Ms office are ordinary trading robots: deterministic code with no AI in the loop.

| | MetaTrader 5 | NinjaTrader 8 |
|---|---|---|
| Language | MQL5 (C++-like) | NinjaScript (C#) |
| Robot unit | Expert Advisor (EA) on a chart | Strategy on an account and instrument |
| Identity | **Magic number** stamped on every order and deal. That's the "77" in "77 Hold". | Strategy name plus account |
| Accounts | One logged-in account per terminal. Several accounts means several terminal copies, each in its own folder (portable mode). | Many accounts per install, through the connection (Rithmic, Tradovate, CQG) |
| Backtest | Strategy Tester | Strategy Analyzer, Market Replay |
| Simulation | Broker demo account | Sim101 account |
| Runs on | Windows | Windows |

Guardrails belong **inside each robot**, because the dashboard can go down:

- a stop loss on every order
- a maximum position size
- a daily loss cap
- flatten before the session ends, because prop firms forbid holding through the close
- a news filter
- **check the pause flag before every new entry**

## 3. Layer 2: connecting to the accounts (the collectors)

### MetaTrader 5

| Option | How it works | Cost | Good | Watch out |
|---|---|---|---|---|
| **Reporter EA** (MQL5) | A separate EA on its own chart. `OnTradeTransaction` and `OnTimer` send JSON with `WebRequest()`. | Free | Runs in the same terminal. Also works on MetaQuotes' own MQL5 VPS, which migrates WebRequest permissions but blocks DLLs. | The URL must be added to *Options → Expert Advisors → allowed URLs*. `WebRequest` **blocks** until the server answers, so keep it out of the trading EA. It can't run from indicators or in the Strategy Tester. |
| **Python `MetaTrader5` package** | `initialize(path, login, password, server, timeout, portable)` launches or attaches to a terminal. Then `account_info()`, `positions_get()`, `history_deals_get()`. | Free | 32 documented functions. The MT5 AI tools (MCP servers) are built on it. | Needs Windows and a running terminal. One terminal per Python process. |
| **MetaApi cloud** | Register the account (an investor password gives read-only access) and use REST or WebSocket. | **~$14/month** per deployed account at regular reliability, **~$29/month** at high reliability, plus $2.10 per unique account per month. MetaStats adds ~$1.15/month, risk API ~$2.30/month. | No Windows machine needed just to watch. Scales to many member accounts, the way 3Ms would need. | Cost per account, and a third party holds your credentials. |

**Investor password:** MT5's read-only login. Use it for anything that only watches.

### NinjaTrader 8

| Option | How it works | Cost |
|---|---|---|
| **Your own AddOn** (C#) | Subscribe to `Account.All` events: `ExecutionUpdate` (fills), `PositionUpdate`, `OrderUpdate`, `AccountItemUpdate` (P&L and balance values). Post them to Supabase. Emergency stop: `Flatten()` / `CancelAllOrders()`. Lock `Account.All` while iterating it, and unsubscribe on shutdown. | Free |
| **CrossTrade** (commercial) | An NT8 add-on with a REST/WebSocket API for accounts, positions, orders and executions, reachable from anywhere. | Paid; buy instead of build |

### Futures APIs outside NinjaTrader

- **Tradovate API.** Its own page, updated 2026-09-16, says: *"Prop firm and evaluation accounts are not eligible for API access."* It needs your own live account with at least $1,000, plus the **$25/month** add-on, and the add-on includes no market data.
- **ProjectX / TopstepX API.** Costs **$29/month**, or **$14.50** with Topstep's code. Bots are allowed, but orders must come from your personal device. A server may host a **read-only** dashboard that receives your fills, positions and P&L. In Topstep's words: "your server can watch and record, but it cannot trade."

### What to store (Supabase)

```
accounts          id, platform (mt5|nt8|projectx), broker/firm, login, currency, kind (demo|eval|funded|personal)
robots            id, account_id, magic/strategy, name ("77 Hold"), desk_no, style (character colours)
positions         robot_id, symbol, side, volume, entry, sl, tp, floating_pnl, opened_at     ← current state
deals             robot_id, ticket, symbol, side, volume, price, profit, commission, swap, time  ← history
equity_snapshots  account_id, ts, balance, equity, floating                                 ← curves and drawdown
heartbeats        source (terminal or AddOn), robot_id, ts, version, last_error               ← health
risk_flags        robot_id | account_id, paused, flatten_requested, reason, set_by, ts        ← the only write-back
alerts            ts, severity, robot_id, message, acknowledged
agent_notes       ts, robot_id, author (agent), kind (daily|anomaly|research), body
```

- Reporters authenticate with a per-machine key that **can only insert**, enforced by row-level security or an Edge Function.
- The web app reads through Supabase Auth and never sees a broker password.

### Mapping account state to the office

| Condition | Office state | 3Ms equivalent |
|---|---|---|
| No heartbeat for over 2 minutes | `error`: robot slumps, red desk | not shown in the reel |
| Open position | `working`: at the desk | "em operação" |
| Flat, session open | `idle`: lounge | "em descanso" |
| Paused by you or the risk agent, or daily limit hit | `meeting` (repurposed) or a custom state | none |

## 4. Layer 3: the 3D office

Three ways to build it, from least to most work. All three were read from Claw3D's source on GitHub.

### Route A: presence endpoint (a weekend)

Claw3D's "second office" beta polls a URL, using a bearer token if you set one, and draws what it returns as a **read-only** office:

```json
{ "workspaceId": "trading", "timestamp": "2026-09-23T12:00:00Z",
  "agents": [
    { "agentId": "mt5-77", "name": "77 Hold",      "state": "working", "preferredDeskId": "desk-4" },
    { "agentId": "mt5-12", "name": "12 - Scalper", "state": "idle" } ] }
```

- Only four states are accepted: `working`, `idle`, `meeting` and `error`. Anything else becomes `idle`.
- No P&L panels.
- You serve that JSON from one Supabase Edge Function.

### Route B: a trading gateway (1–3 weeks)

- Copy `server/demo-gateway-adapter.js`, a single ~16 KB Node file using the `ws` library. It speaks Claw3D's gateway protocol v3:
  - **Handshake:** the server sends `connect.challenge`, the client sends `connect`, and the server replies `hello-ok` with `protocol: 3`.
  - **Requests:** `agents.list`, `sessions.list`, `chat.send`, `status` and similar.
  - **Events:** `presence`, `chat`, `heartbeat`.
- Robots become full agents in the **main** office.
- Claw3D decides "working" from chat and run activity: a run in progress, or anything within the last ~45 seconds. So the gateway must turn "position opened" into activity events.
- **Payoff:** `chat.send` can go to a Claude agent with read-only tools for that robot. You click a robot in the office and ask "why did you lose today?"

### Route C: your own scene inside your own app (what 3Ms did; 3–6+ weeks)

- **Stack:** Next.js with React Three Fiber and drei.
- **Characters:** built procedurally from boxes. Claw3D's `objects/agents.tsx` builds its people from box and cylinder shapes with simple lighting materials, the same technique behind the 3Ms robots.
- **Scene:** nametags that always face the camera (`Billboard` + `Text`), one desk per robot, a lounge, and wall screens.
- **Panels:** ordinary React, fed by Supabase Realtime.
- **Multi-user** (members each seeing their own robots) needs login plus row-level security. Claw3D doesn't do this by design: it keeps settings in a local JSON file.
- **Licence:** Claw3D is MIT. If you copy its code, keep its copyright notice.

### Running Claw3D itself

```
Node 20+, npm 10+
git clone https://github.com/iamlukethedev/Claw3D && cd Claw3D
npm install && cp .env.example .env
npm run demo-gateway      # mock backend on ws://localhost:18789 (for trying it out)
npm run dev               # http://localhost:3000
```

- To reach it from your phone, set `HOST=0.0.0.0`, set `STUDIO_ACCESS_TOKEN`, and put it behind Tailscale (the same way JARVIS is reached).
- In production, set `UPSTREAM_ALLOWLIST` and `CUSTOM_RUNTIME_ALLOWLIST`.

## 5. Layer 4: AI agents

### What the evidence says

- **Alpha Arena Season 1** (nof1, 18 Oct–3 Nov 2025): each LLM got $10k of real money to trade crypto perpetuals on Hyperliquid, with the same prompts and data.
  - Qwen 3 Max won with **+22.3%**, making about 43 trades, fewer than three a day.
  - Most other models lost money.
  - nof1's founder: "LLMs can't really make money by themselves." The models mistimed trades, sized positions badly and over-traded.
- **FINSABER** (arXiv 2505.07078): tested over two decades and 100+ symbols, the LLM trading agents FinMem and FinAgent **didn't beat buy-and-hold**. Their reported edge was an artefact of short, narrow backtests.

So LLMs stay out of the order path, and they're worth having for everything around it.

| Agent | Triggered by | Reads | Allowed to | Never |
|---|---|---|---|---|
| **Desk analyst** (one per robot) | Trade closed, end of session | That robot's deals, bars, notes | Write a note. Answer chat in the office. | Place or modify orders |
| **Risk officer** | Every event, plus every N minutes | All positions, equity, prop-firm limits | Raise alerts. Propose a pause, and set it after your approval. | Trade, or loosen limits |
| **Researcher** | On demand or weekly | Trade history, backtest reports | Propose parameter changes as a written report | Deploy anything to live |
| **Reporter** | Before and after each session | Everything | Send the Telegram brief or JARVIS voice brief | Anything else |

### How to build the agents

- **Agent framework:** the Claude Agent SDK, which you already use in JARVIS II, with a strict list of allowed tools.
- **Give agents database tools, not broker tools.** Read-only SQL views over the tables above are enough for every job in that table. If you do connect an MT5 AI tool server:
  - `ariadng/metatrader-mcp-server` (MIT, ~810★) exposes **32 tools, including placing and closing trades, with no read-only mode**. Allow only its read tools.
- **Runtime:** one small always-on process that wakes on Supabase Realtime events rather than polling. Cheap, because it only thinks when something happens.
- **If you still want an LLM to make trade decisions,** run it on a demo account and compare it with a dumb baseline. `TauricResearch/TradingAgents` is the reference multi-agent framework.

## 6. Layer 5: dashboard and feedback

**Copy what 3Ms shows:** closed / open / both P&L, and per robot: equity, closed today, number of fills, the intraday curve, max drawdown and "last updated".

**Then add what it hides:**

- **Floating P&L and equity drawdown.** A smooth closed-trade curve can hide a growing open loss.
- **Distance to each prop-firm limit:** trailing drawdown left, daily loss left, consistency percentage.
- **Robot health:** heartbeat age, last error, terminal version.
- **Execution quality:** slippage and trades per day compared with the backtest.
- **Hold-time distribution.** Lucid flags accounts where more than 50% of profit comes from trades held 5 seconds or less.
- **Expectancy, profit factor and win rate** over 30 days and over all time.

**Tools:**

- **Charts:** TradingView Lightweight Charts, Apache-2.0. You must show its NOTICE attribution and a link to tradingview.com.
- **Alerts:** a Telegram bot (free) or JARVIS voice, e.g. "Station 4 closed plus 973."

**The loop:** backtest → demo for N weeks, where results must track the backtest → small live → scale. Write down the kill criteria **before** going live.

## 7. Environments

| Environment | Machine | Robots trade on | Database | What it proves | Move on when |
|---|---|---|---|---|---|
| **Dev** | Your PC | MT5 demo, NT8 Sim101 | Supabase dev project | Code works end to end | Collectors, office and alerts all work on demo |
| **Backtest** | Your PC | MT5 Strategy Tester, NT8 Strategy Analyzer / Market Replay | Historical data | The strategy has an edge on paper | Your metrics hold across years and market regimes |
| **Forward demo** | VPS (or your PC) | Demo / sim accounts | Supabase prod | Live-market behaviour: fills, spreads, disconnects | Weeks of results that track the backtest |
| **Prop evaluation** | Depends on the firm (Topstep: your PC) | Eval accounts (simulated) | prod | Survives the firm's rules | Passed, with no rule flags |
| **Live** | VPS near the venue | Real money | prod | — | Kill criteria decided in advance |

**Machines:**

- MT5 and NT8 need **Windows**. The web app and database can live anywhere; keep them private with Tailscale.
- For CME futures, use a **Chicago VPS**, about 0.5 ms from CME's matching engines in Aurora, IL. For forex, use a VPS near your broker's trade server.
- Prices: a budget Windows VPS is about **$12/month** (3Ms's figure). A Chicago trading VPS is **$30–190/month** (QuantVPS: 2 cores / 4 GB at $29.99 up to 12 cores / 32 GB at $189.99).

**Operations checklist:**

- Terminals auto-start and log in after a reboot (Task Scheduler).
- No automatic Windows Update restarts during trading hours.
- Clock sync.
- A heartbeat every 30 seconds, with an alert after 2 minutes of silence.
- Nightly database backups.
- Logs kept for 90 days.

## 8. Prop-firm rules, from each firm's own page (2026-09-23)

| Firm | Bots | Copying | Where it may run | Their words |
|---|---|---|---|---|
| **Apex** | ❌ | ❌ between traders | Cloud servers are banned only when used to disguise identity or location | "No Automation or Algorithm Usage allowed: Rewards are intended to recognize human traders … not to reward automated systems executing preprogrammed logic." |
| **Take Profit Trader** | ❌ | Has a separate Trade Copier Policy (not reviewed) | — | "#1: No Trading Bots or Algos. Automated trading systems, bots, or algorithmic execution tools are not permitted." |
| **MyFundedFutures** | ✅ your own | ❌ between traders | Not stated | "Traders may make use of automated trading strategies tailored to their own specific settings…" No HFT. No exploiting simulated fills. Live accounts must follow CME rules. |
| **Lucid** | ✅ | ✅ copiers | Not stated | "Automated strategies and in-platform/third party trade copiers are permitted, but traders are responsible for any software errors…" HFT and microscalping are banned. Accounts untraded for 30 days are deleted. |
| **Topstep** | ✅ through the API | — | ❌ VPS, VPN or remote server for orders; a read-only server is OK | "The line is order transmission: your server can watch and record, but it cannot trade." |

- Several third-party guides contradict these pages. For example, they claim Apex allows bots during evaluations. **Trust the firm's own page and re-check before trading**, because these rules change often.
- **What this means for 3Ms:** members running 3Ms robots at Apex or Take Profit Trader risk account closure and forfeited payouts, whatever the sales page says.

## 9. What it costs (personal setup)

| Item | Minimal (MT5, own capital) | Futures prop |
|---|---|---|
| Windows VPS | $12–30/month | $30–100/month (Chicago); none on Topstep, where orders must come from your PC |
| Platform | MT5: free | NT8 free plan: $0 (commission $0.39/micro); $99/month or $1,499 lifetime for cheaper commissions |
| Futures API | — | ProjectX $14.50–29/month if you use Topstep's API |
| Account data | Reporter EA: free (MetaApi: $14–29/month per account) | NT8 AddOn: free |
| Supabase | Free: 500 MB, 200 realtime connections, 2M messages/month. It pauses after a week with no traffic, which constant heartbeats prevent. | Same. Pro is $25/month. |
| Web hosting | Vercel Hobby: free, **personal use only** | Same. Anything sold needs Pro. |
| 3D office | Claw3D: free (MIT) | Same |
| AI agents | Claude API tokens: small if event-driven | Same |
| Alerts | Telegram: free | Same |
| Evaluation fees | — | Per firm |

## 10. Build order

1. **Demo accounts only.** Pick the venue first (section 8). Open an MT5 demo account, and add NT8 Sim101 if you plan to trade futures.
2. **Collectors and database.** Reporter EA or AddOn → Supabase tables → heartbeats → Telegram alert when a heartbeat goes stale. *This alone is useful.*
3. **Dashboard.** A plain Next.js page: per-robot cards, curves, floating P&L, prop-limit gauges.
4. **Office, route A.** Serve the presence JSON and watch robots move between desk and lounge in Claw3D.
5. **Agents, read-only.** Reporter first (pre- and post-session briefs), then the risk officer (alerts only), then desk analysts.
6. **Office, route B or C.** The trading gateway with robot chat, or your own branded scene.
7. **Small live.** Only a robot that has passed backtest and forward demo, with kill criteria written down.

## Sources

**3D office (Claw3D source code, read from GitHub):**
- [README](https://github.com/iamlukethedev/Claw3D) and [ARCHITECTURE.md](https://github.com/iamlukethedev/Claw3D/blob/main/ARCHITECTURE.md)
- [Custom runtime provider spec](https://github.com/iamlukethedev/Claw3D/blob/main/docs/integrations/custom-runtime-provider-spec.md) and [agent state model spec](https://github.com/iamlukethedev/Claw3D/blob/main/docs/agent-state-model-spec.md)
- [Multi-agent beta (presence endpoint)](https://github.com/iamlukethedev/Claw3D/blob/main/docs/multi-agent-beta.md)
- Code: `src/lib/office/presence.ts`, `server/demo-gateway-adapter.js`, `src/features/retro-office/objects/agents.tsx`

**MetaTrader 5:**
- [Python integration](https://www.mql5.com/en/docs/python_metatrader5) and [initialize()](https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py)
- [WebRequest](https://www.mql5.com/en/docs/network/webrequest) and [WebRequest on the MQL5 VPS](https://www.mql5.com/en/forum/379640)
- [MQL5 VPS rules](https://www.mql5.com/en/vps/rules)
- [MetaApi pricing](https://metaapi.cloud/#api-access-pricing)

**NinjaTrader and futures APIs:**
- [NinjaScript Account class](https://docs.ninjatrader.com/ninjascript/account_class)
- [NinjaTrader pricing](https://ninjatrader.com/pricing/)
- [CrossTrade API](https://crosstrade.io/crosstrade-api)
- [Tradovate API access](https://support.tradovate.com/s/article/Tradovate-API-Access?language=en_US)
- [TopstepX API access](https://help.topstep.com/en/articles/11187768-topstepx-api-access)

**Prop-firm rules:**
- [Apex prohibited activities](https://apextraderfunding.com/help-center/getting-started/prohibited-activities/)
- [Take Profit Trader UTP](https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/34431153546397-TakeProfitTrader-Universal-Trading-Policies-UTP)
- [MyFundedFutures fair play](https://help.myfundedfutures.com/en/articles/8444599-fair-play-and-prohibited-trading-practices)
- [Lucid FAQ](https://lucidtrading.com/general-faq/)

**AI agents:**
- [metatrader-mcp-server](https://github.com/ariadng/metatrader-mcp-server)
- [TradingAgents](https://github.com/TauricResearch/TradingAgents)
- [Alpha Arena Season 1 results (iWeaver)](https://www.iweaver.ai/blog/alpha-arena-ai-trading-season-1-results/)
- [FINSABER, arXiv 2505.07078](https://arxiv.org/abs/2505.07078)

**Infrastructure:**
- [Supabase pricing](https://supabase.com/pricing)
- [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines)
- [Lightweight Charts](https://github.com/tradingview/lightweight-charts)
- [QuantVPS NinjaTrader plans](https://www.quantvps.com/ninjatrader-vps)
