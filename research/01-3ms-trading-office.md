# The 3Ms "trading office": what it is, where it came from, how it works

Researched 2026-09-23 from the reel [instagram.com/reel/DdjMx7Ku83_](https://www.instagram.com/reel/DdjMx7Ku83_/) by **@henriqtrades** (posted 2026-09-21, caption "Em menos de 24hrs #trading #3ms #xauusd #propfirm").

## Verdict

- **The office is a Claw3D-style 3D agent office, re-skinned for trading robots.** [Claw3D](https://github.com/iamlukethedev/Claw3D) (MIT, ~2.2k stars, 615 forks) is the project that made "watch your AI agents work in a 3D office" popular. 3Ms matches it on:
  - framework: Next.js App Router with React Three Fiber
  - orthographic isometric camera
  - blocky low-poly figures
  - dark pill nametags floating over desks
  - two-monitor desks and a sofa lounge
  - gold-on-black UI
  - a status line of the form "N working · N idle" plus a sound/music control
- **It is not a straight copy.** His characters are simple coloured box robots, not Claw3D's figures. The room has yellow trim, wall LED tickers, world clocks and a logo. All the trading panels are custom and in Portuguese.
- **No public "trading" fork of Claw3D or any other agent office exists.** Searches of GitHub and the web turned up none. The trading integration is his own work, or his developer's. At most the look and feel came from GitHub. Given the stack (below), it was very likely rebuilt with an AI coding tool, with Claw3D as the reference.
- Confidence: **medium**. The office code only loads after login, so the lineage can't be proven byte-for-byte. The visual and structural match is strong, though, and no better candidate turned up.

## What the reel shows

The browser tab is `membros.comunidade3ms.com.br/contas`, titled "Comunidade 3Ms — Área de Membros".

| Element | On screen |
|---|---|
| Header | "A FIRMA 3Ms · SEU ESCRITÓRIO DE TRADERS" ("the 3Ms firm, your office of traders") |
| Day total | "FECHADOS HOJE R$ 4.375,37", with toggles *Fechados / Abertos / Ambos* (closed / open / both) |
| Office status | "MEU ESCRITÓRIO · 1 em operação · 4 em descanso". Robots with a trade open sit at their desk. Idle robots stand in the lounge, over a floor sign reading "EM DESCANSO". |
| Desk labels | `6 MBAL`, `77 Hold`, `12 - Scalper`, `31 MaC −R$ 455,08`, `61 Messi`. The number is almost certainly the EA's **magic number**, followed by a strategy name. |
| Wall screens | Closed P&L ticker per robot, "RESULTADO DO DIA R$ 4.375,37", world clocks, "1 / 5 AGENTES" |
| Toolbar | Música, volume, TV, shield, **Iniciar câmeras** (camera tour), **Resultados**, **Pausar**, settings |
| Click a robot | "ESTAÇÃO 04 · 77 Hold · Conta 400182451 · Em descanso". Also shows equity, closed today, "18 lançamentos" (fills), an intraday realised-P&L curve in BRT, best/worst result, **DD máximo**, "Atualizado 21/09, 09:45", and **Personalizar personagem** (customise character). |

Each robot runs on **its own trading account** (400182451, 480203939, 198820567…).

## Who he is and what he sells

[comunidade3ms.com.br](https://comunidade3ms.com.br) is "Comunidade 3Ms | Trading Automatizado com Robôs", a paid community that sells ready-made robots through WhatsApp:

- **NinjaTrader 8** robots trading NQ/MNQ futures on prop firms: Apex Trader Funding, MyFundedFutures, TakeProfitTrader, LucidTrading
- **MetaTrader 5** robots trading **XAUUSD** on members' own money, in BRL-denominated accounts
- Pitch: "6 anos de estatísticas", a portfolio simulator with Sharpe/Sortino/Calmar, a members area and training. The only listed extra cost is a VPS at about US$12/month.

The office is a feature of the members area. It's the hook: people in the comments ask "quanto?" and "como faço pra ter um desse?".

**Update (same day):** the firms' own rule pages contradict 3Ms's FAQ claim that automation is permitted "as long as it follows current rules". Apex ("No Automation or Algorithm Usage allowed") and Take Profit Trader ("#1: No Trading Bots or Algos") both ban bots outright. MyFundedFutures and Lucid allow them, with conditions. Details and quotes are in [02-full-stack-blueprint.md §8](02-full-stack-blueprint.md#8-prop-firm-rules-from-each-firms-own-page-2026-09-23).

## Tech stack (from what the sites publicly serve)

| Piece | Evidence | Stack |
|---|---|---|
| Marketing site | `assets/index-*.js`, React, shadcn-style button variants | React + Vite + Tailwind |
| Members area | `/_next/static/chunks/…`, `turbopack-*.js`, `?dpl=dpl_…` | **Next.js (App Router, Turbopack) on Vercel** |
| Auth + data | 79 `supabase` references, realtime `…/api/broadcast` client, "Entrar com Google" | **Supabase** (Auth, Postgres, Realtime) |
| 3D office | Only loads after login | Almost certainly **React Three Fiber / three.js**, the same family as Claw3D |

## How the data most likely flows

```
MT5 terminal (VPS)                NinjaTrader 8 (VPS)
  robot EA (magic 77, 12…)          robot strategy on Apex/MFF… account
  + reporter (EA or Python)         + NinjaScript AddOn
     │ WebRequest / MetaTrader5 pkg    │ Account.ExecutionUpdate → HTTP
     ▼                                  ▼
             Supabase (Postgres tables: accounts, robots,
             deals, equity snapshots) ── Realtime ──▶
                     Next.js members area
                     └─ R3F scene: robot state machine
                        position open → walk to desk, "em operação"
                        flat          → lounge, "em descanso"
                        P&L → nametag colour, wall LED, station panel
```

- **Reading the accounts.** Each robot is keyed by magic number. A reporter reads `ACCOUNT_EQUITY`, open positions and today's deals (`HistorySelect` / `HistoryDealsTotal`), filters by magic number and pushes them out. Three ways to do it:
  - an MQL5 EA using `WebRequest()`
  - the Python `MetaTrader5` package (Windows only, needs the terminal running)
  - MetaApi.cloud with an investor password, which scales best when every member connects their own account
- **Batched, not live.** The panel shows "Atualizado 09:45", so updates are periodic snapshots, not a tick stream.
- **NinjaTrader and prop firms.** On the prop firm side you capture data at the NT8 terminal, not from the firm. Prop firms don't give you a P&L API.
- **The toolbar is cosmetic:**
  - *Iniciar câmeras* flies the camera between stations
  - *Personalizar personagem* saves a colour or skin per robot
  - *Música* is a background track

## If we build our own

1. **Base:** fork [Claw3D](https://github.com/iamlukethedev/Claw3D). It's MIT-licensed, so we can build on it, even commercially, and it already supports a direct HTTP "custom runtime provider". Our trading backend would plug in there as the "gateway".
   - Avoid [Agents Office](https://github.com/ajsahni/agents-office): its licence is PolyForm Noncommercial and it bans rebranding or building a paid product on it.
2. **Telemetry:** write a small MT5 reporter, and later an NT8 AddOn, that posts equity, positions and deals per magic number to our own API or Supabase.
3. **Map state to scene:** open position means the robot sits at its desk, flat means it's in the lounge. Closed and floating P&L feed the nametag and wall screens. Drawdown past a limit turns the station red.
4. **Show floating P&L too, not just "fechados".** This is where a trading dashboard can deceive.

## A research caveat on the reel itself

- The headline number is **realised** P&L for one morning ("Fechados hoje"). A robot named "Hold" with a smooth closed-trade curve can still carry open losing positions, which only show under "Abertos".
- One day of closed P&L on XAUUSD, filmed for a sales reel, says nothing about edge. Judge any robot on:
  - its long-run equity curve, including floating P&L
  - max drawdown against equity
  - trade count and duration
  - behaviour on high-volatility days (NFP, CPI, FOMC)

## Sources

- Reel: https://www.instagram.com/reel/DdjMx7Ku83_/
- 3Ms: https://comunidade3ms.com.br · members login: https://membros.comunidade3ms.com.br
- Claw3D: https://github.com/iamlukethedev/Claw3D · https://www.claw3d.ai/
- Same idea, looked at and ruled out:
  - VirtOffice (a Claw3D-style derivative for Hermes): https://github.com/OneByJorah/VirtOffice
  - Agents Office (Sahni.ai, non-commercial licence): https://github.com/ajsahni/agents-office
  - AI Worlds / Octo-three: https://github.com/balagurunilacandane/Octo-three
  - ai-office: https://github.com/Gaurav2693/ai-office
  - OpenClaw Office (2D isometric SVG): https://github.com/WW-AI-Lab/openclaw-office
  - Pixel Agents (2D pixel art, VS Code): https://github.com/pixel-agents-hq/pixel-agents
  - Agents in the Office (pixel NPCs): https://github.com/gukosowa/agents-in-the-office
