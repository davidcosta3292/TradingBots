# Trading Office

One shared office for both members' robots. Each Trader EA uses its owner's FTMO MetaTrader 5 demo account; its owner can press Start, Pause, Done for today or Close everything. The Fundamental Analyst runs on Supabase and watches news. Risk manager and Coordinator are planning slots.

```
MetaTrader 5 + OfficeRobot  ──robot_sync──►  Supabase  ◄──live──  Control page (browser / phone)
   (each on our own PC)      ◄──commands──   (database)  ──alerts──►  Telegram
Supabase Edge Function     ──news reports─►    ▲
   (5-minute server schedule)
```

| Folder | What's in it |
|---|---|
| `plan/` | The plan PDF, the [build plan](plan/build-plan.md) and the [strategy card](plan/strategy-card.md) |
| `research/` | Research notes behind the plan |
| `supabase/migrations/` | The database. Run once in the Supabase SQL editor. |
| `robot/` | The MetaTrader 5 robot, and a script that installs and compiles it |
| `office/` | The control page |
| `supabase/functions/fundamental-analyst/` | The scheduled, server-side news watcher |

## One-time setup

### 1. Database (one of us, about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com). Pick an EU region (Frankfurt).
2. **SQL Editor:** run migrations `0001` to `0010` in order, then `0012` for owner-controlled deletion. Migration `0011` schedules this project's Analyst function and requires its Vault token first; its URL and public key must be changed for another Supabase project.
3. **Authentication → Sign In / Providers:** turn off *Allow new users to sign up*.
4. **Authentication → Users → Add user:** create a login for each of us. Tick *Auto Confirm User*.
5. **SQL Editor:** let both logins in. An office member can create up to six slots from the hosted page; administrators can also use the helpers below:
   ```sql
   select public.add_member('you@example.com', 'David');
   select public.add_member('friend@example.com', 'Friend');
   select public.create_robot('Robot 01', 'you@example.com');     -- your robot's token
   -- Your friend can press "Create my robot" on the office site instead.
   ```
   Each token is shown only once. If one gets lost, run `select public.reset_robot_token('Robot 01');`
6. **Project Settings → API Keys:** note the *Project URL* and the *publishable* key (`sb_publishable_…`).

### 2. Phone alerts (optional, 5 minutes)

1. In Telegram, search for **@BotFather**, send `/newbot`, and pick a name, then a username ending in `bot`. BotFather replies with a token.
2. Tap the link to your new bot and press **Start**.
3. In PowerShell, in the repo folder, run:
   ```
   powershell -ExecutionPolicy Bypass -File .\tools\telegram-setup.ps1
   ```
   Paste the token when asked. The script finds your chat, sends a test message, and copies one line to your clipboard.
4. Paste that line into the Supabase **SQL Editor** and press **Run**. You should get "Trading Office connected" in Telegram.

To add a group **as well as** the private chat, add the same bot to the group and send `/start@YourBotName` there. Run `tools/telegram-setup.ps1 -Group`, choose the group, and run the copied SQL in the Supabase SQL Editor. The group ID is stored in `office_settings.telegram_group_chat_id`; the private chat remains in `telegram_chat_id`. The TradingBots project already has **TraderMindz** configured and a test message was delivered to both chats.

From then on Telegram tells you, the moment it happens:
- every button press the robot confirms or refuses, and who pressed it;
- every trade a robot opens or closes, with the result;
- a robot starting, stopping, hitting a limit stop, or reporting an error.

Within a minute or two it also tells you when a robot goes offline or comes back, and when a button press wasn't confirmed.

### 3. Control page

1. The office is already configured for this Supabase project in `office/config.js`. For a different project, replace its URL and publishable key. The publishable key is safe to serve to browsers; never put a service-role key, robot token, or Telegram token here.
2. Double-click **`Open Trading Office.cmd`** in the repo folder. It starts a small local server (`office/serve.py`), and opens http://localhost:8765 in your browser. Keep the minimized server window open while you use the page.
3. Sign in. To see it before anything is set up, open http://localhost:8765/?demo.

#### Share the office on Vercel

The office is a static website. Vercel serves only the `office/` folder; Supabase handles sign-in, commands, robot reports, and the scheduled Fundamental Analyst. MetaTrader and the Trader EA still run on each owner's PC. Publishing the website does not move or start a Trader EA.

1. Import this GitHub repository into Vercel and set **Root Directory** to `office`.
2. Set **Framework Preset** to **Other**. There is no build command or environment variable to add; `office/config.js` contains only the public Supabase project URL and publishable key.
3. The deployed page is **https://trading-office-puce.vercel.app/**. The friend can open it on a Mac without cloning GitHub or installing MetaTrader just to view the office. The demo is at https://trading-office-puce.vercel.app/?demo.
4. For live data, the friend signs in with their own Supabase Auth login. An administrator adds their existing Auth user to `office_members`; a website link alone does not grant database access. Any member can press **+ Add robot**. A **Trader** receives a one-time MetaTrader token. A **Fundamental Analyst** receives its own news-watcher token. **Risk manager** and **Coordinator** remain assignment labels. Only the owner can press a Trader's controls.

Jhonatan's Mac walkthrough is in [plan/friend-setup.md](plan/friend-setup.md). The Oracle free-VPS assessment is in [research/03-oracle-free-tier-vps.md](research/03-oracle-free-tier-vps.md).

If an emailed Supabase invitation opens a 404 page, set Supabase Auth's **Site URL** and **Redirect URLs** to the deployed HTTPS origin, then send a new invitation. An old invitation can retain its old redirect destination.

The page has two views: **Office**, the 3D office, and **Cards**, the plain list that works best on a phone.

In the office, where a robot is tells you what it's doing:

| Where | What it means |
|---|---|
| At its desk | Trader working or in a trade, or Fundamental Analyst scanning news. |
| At the coffee bar | Switched on, but its own rules say "not now": outside its hours, market closed, or news. It carries on by itself. |
| At its desk, scratching its head | Blocked by something that needs you, like Algo Trading switched off in MetaTrader |
| On the sofa | Paused, or done for today |
| Asleep and grey | Offline: a Trader or Analyst stopped reporting |

### Fundamental Analyst · economic news

The Fundamental Analyst watches the Forex Factory calendar and public Investing.com, Bloomberg and WSJ/Dow Jones RSS feeds for USD releases and headlines relevant to XAUUSD. It is a separate, read-only program. It does not connect to MetaTrader, trade, or control the Trader EA. Its office card shows upcoming events, linked headlines and source health. Important observations can also reach the same Telegram bot's private chat and group, with a 30-minute alert limit. The Trader EA still uses its own MT5 news guard.

David's **Fundamental Analyst** runs as a Supabase Edge Function called every five minutes by `pg_cron` and `pg_net`. Its token is encrypted in Supabase Vault, never in the Vercel website or GitHub. The old local process has been stopped. The office marks the Analyst offline after 12 minutes without a report and sends the usual Telegram offline alert. Turning off David's PC does not stop this Analyst.

For another Analyst, use **+ Add robot → Fundamental Analyst** in the office and keep its one-time token private. That slot needs its own server schedule and Vault token before it reports; creating a slot alone does not activate a new server job. Read [plan/news-agent.md](plan/news-agent.md) for source behavior and limits.

Robots say what they just did in a speech bubble. The right-hand monitor on each desk takes turns between the FTMO limits and the last 7 days of trades. **Tour** flies the camera from robot to robot, **Legend** explains the places, and **Sound** turns on small sounds for trades and button presses. Each robot's owner can change its colour and gear under **Look in the office** in its card.

An owner can also choose **Delete robot** at the bottom of its card. This erases the robot's office token, commands, trades, events and news history. A connected Trader must first be paused, have no open positions, and be removed from the MetaTrader chart for two minutes. Deleting the scheduled Fundamental Analyst also stops its Supabase cron job and removes the matching Vault token. Other members cannot delete your robots.

### 4. The robot (each of us, on our own PC and FTMO account)

1. **FTMO:** start a Free Trial (2-Step, MetaTrader 5), install FTMO's MetaTrader 5, and log in with the trial's login.
2. **MetaTrader → Tools → Options → Expert Advisors:**
   - tick *Allow algorithmic trading*;
   - tick *Allow WebRequest for listed URL*, and add the Supabase Project URL.
3. **Install the robot:** in PowerShell, in the repo folder, run `.\robot\install.ps1`. It copies and compiles the robot.
4. **Attach it:** open an **XAUUSD** chart and drag **OfficeRobot** onto it from *Navigator → Expert Advisors*. Then, under **Inputs**:
   - `Supabase project URL`, `Supabase publishable key`, and your own robot's token;
   - `Magic number`: **101** for Robot 01, **102** for Robot 02.
5. Switch on **Algo Trading** in the MetaTrader toolbar. The chart shows `PAUSED | office link: ok`, and the robot appears in the office. Press **Start** there. After an update, remove and reattach the EA so its new Inputs load; it starts paused again. With version 1.2.3, changing only the chart timeframe preserves the robot's current Start/Pause/Done state.

**On a Mac:** download [OfficeRobot-source.zip](https://trading-office-puce.vercel.app/downloads/OfficeRobot-source.zip) directly from the office site. Unzip it. In MetaTrader 5 choose **File → Open Data Folder**, then copy the entire `OfficeRobot` folder to `MQL5/Experts`. Open `OfficeRobot.mq5` in MetaEditor and press F7 to compile. Add the Supabase URL to allowed WebRequest URLs, attach the Trader EA to your own FTMO demo chart, set a unique magic number, paste your own token, and turn on Algo Trading. The Windows `install.ps1` script does not run on macOS. After editing robot source, regenerate the download with `tools/package-robot.ps1` before deploying. Keep one active Trader EA per FTMO account until a shared account-level risk budget exists.

## The four buttons

| Button | What the robot does | Open trades | It comes back |
|---|---|---|---|
| **Start** | may open new trades | untouched | — |
| **Pause** | opens no new trades | finish normally (stop, target, or exit signal) | when you press Start |
| **Done for today** | opens no new trades | finish normally | by itself at 00:00 Prague (the start of FTMO's day) |
| **Close everything** | closes its trades now, then pauses | closed at market | when you press Start |

- Only a robot's owner sees its buttons. FTMO allows nobody else to use an account.
- The robot confirms every press. A press it doesn't pick up within 60 seconds expires.
- **A fresh attachment starts paused.** MetaTrader restarts the EA when you change a chart timeframe; version 1.2.3 restores its current state for that specific chart change. A terminal restart, recompile, EA removal, account change or settings change still starts it paused.
- Keep the PC awake while the robot runs: turn off sleep, and keep MetaTrader open. A locked screen is fine.

## FTMO 2-Step rules the robot enforces

| Rule | FTMO | The robot |
|---|---|---|
| Maximum Daily Loss | 5% of the initial balance, from the balance at 00:00 Prague, counting open trades | Closes its trades and stops for the day at **4%** |
| Maximum Loss | 10% of the initial balance | Closes its trades and stays paused at **8%** |
| Market closing (gap trading) | No new trades 2 hours or less before a close of 2 hours or more | Same, e.g. before the weekend |
| High-impact news | Restricted on funded Standard accounts | Scans the MT5 calendar for the symbol's currencies; warns up to one hour ahead, blocks new entries 15 minutes either side, and blocks entries if the calendar query fails |
| Server requests | Flagged above 2,000 a day | Stops opening trades after 200 |
| Account type | — | This v1.2 EA refuses to trade anything but a demo account |

The broker-side stop and target remain in place even if MetaTrader disconnects. The additional six-hour time exit needs MetaTrader running. These controls aim to leave room under FTMO's limits; actual account eligibility and the rule application should still be checked with FTMO.

## The strategy

**XAUUSD plan draft v1** replaces the M1 EMA exercise. On completed candles, the EA reads the 4H direction, checks Daily, 1H and 15M trend alignment, then looks for a 15M structure break, pullback, reaction and confirmation. It submits a structural stop and a 3R broker target; there is no three-minute rule. Full alignment risks up to 0.10% of the initial balance, and one supporting trend risks up to 0.05%, with a 1.0-lot cap. It permits at most five plan entries per Prague day, waits 30 minutes after a losing plan position, and stops for that day after two plan losses in a row. Trades from the retired three-minute exercise do not count toward those plan-specific limits; their P&L still counts toward account-wide FTMO limits. New entries are limited to 08:00-09:00, 10:00-11:00 and 12:00-13:00 New York time, plus existing market/news/FTMO guards. An open trade can reach its stop or target outside those entry windows. It will only open a new trade after its owner presses Start.

The [strategy review](plan/forex-strategy-review.md) gives the exact definitions and differences from the supplied discretionary PDF. This draft is for observing execution in demo; no profitability has been established. After replacing the EA, check that the chart reports version **1.2.3** and the robot is **Paused**, then press Start. The strategy lives in `robot/OfficeRobot/Strategy.mqh`, apart from the buttons and account risk guards.

Telegram already receives confirmed controls and trade events. At 20:00 Prague, on days a Trader reported, it also sends a generic check-in linking to the signed-in office. Detailed balances and P&L stay in the office. The EA's MT5 news guard alerts Telegram as a high-impact event approaches and when its entry pause begins or ends. The separate Fundamental Analyst now watches external headlines and the Forex Factory calendar and posts read-only observations; see [the news-agent plan](plan/news-agent.md).
