# Trading Office

Two demo robots, each on its own FTMO MetaTrader 5 account, both in one office where we can watch them and press Start, Pause, Done for today or Close everything.

```
MetaTrader 5 + OfficeRobot  ──robot_sync──►  Supabase  ◄──live──  Control page (browser / phone)
   (each on our own PC)      ◄──commands──   (database)  ──alerts──►  Telegram
```

| Folder | What's in it |
|---|---|
| `plan/` | The plan PDF, the [build plan](plan/build-plan.md) and the [strategy card](plan/strategy-card.md) |
| `research/` | Research notes behind the plan |
| `supabase/migrations/` | The database. Run once in the Supabase SQL editor. |
| `robot/` | The MetaTrader 5 robot, and a script that installs and compiles it |
| `office/` | The control page |

## One-time setup

### 1. Database (one of us, about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com). Pick an EU region (Frankfurt).
2. **SQL Editor:** run the files in `supabase/migrations/` in order: `0001`, `0002`, then `0003`.
3. **Authentication → Sign In / Providers:** turn off *Allow new users to sign up*.
4. **Authentication → Users → Add user:** create a login for each of us. Tick *Auto Confirm User*.
5. **SQL Editor:** let both logins in, and create one robot each:
   ```sql
   select public.add_member('you@example.com', 'David');
   select public.add_member('friend@example.com', 'Friend');
   select public.create_robot('Robot 01', 'you@example.com');     -- your robot's token
   select public.create_robot('Robot 02', 'friend@example.com');  -- give this one to your friend
   ```
   Each token is shown only once. If one gets lost, run `select public.reset_robot_token('Robot 01');`
6. **Project Settings → API Keys:** note the *Project URL* and the *publishable* key (`sb_publishable_…`).

### 2. Phone alerts (optional, 5 minutes)

1. In Telegram, search for **@BotFather**, send `/newbot`, and pick a name, then a username ending in `bot`. BotFather replies with a token.
2. Tap the link to your new bot and press **Start**. For alerts in a group with both of us, add the bot to the group and send a message there instead.
3. In PowerShell, in the repo folder, run:
   ```
   powershell -ExecutionPolicy Bypass -File .\tools\telegram-setup.ps1
   ```
   Paste the token when asked. The script finds your chat, sends a test message, and copies one line to your clipboard.
4. Paste that line into the Supabase **SQL Editor** and press **Run**. You should get "Trading Office connected" in Telegram.

### 3. Control page

1. Copy `office/config.example.js` to `office/config.js`, and fill in the Project URL and publishable key.
2. Double-click **`Open Trading Office.cmd`** in the repo folder. It starts a small local server (`office/serve.py`), and opens http://localhost:8765 in your browser. Keep the minimized server window open while you use the page.
3. Sign in. To see it before anything is set up, open http://localhost:8765/?demo.

The page has two views: **Office**, the 3D office, and **Cards**, the plain list that works best on a phone.

### 4. The robot (each of us, on our own PC and FTMO account)

1. **FTMO:** start a Free Trial (2-Step, MetaTrader 5), install FTMO's MetaTrader 5, and log in with the trial's login.
2. **MetaTrader → Tools → Options → Expert Advisors:**
   - tick *Allow algorithmic trading*;
   - tick *Allow WebRequest for listed URL*, and add the Supabase Project URL.
3. **Install the robot:** in PowerShell, in the repo folder, run `.\robot\install.ps1`. It copies and compiles the robot.
4. **Attach it:** open an **XAUUSD** chart and drag **OfficeRobot** onto it from *Navigator → Expert Advisors*. Then, under **Inputs**:
   - `Supabase project URL`, `Supabase publishable key`, and your own robot's token;
   - `Magic number`: **101** for Robot 01, **102** for Robot 02.
5. Switch on **Algo Trading** in the MetaTrader toolbar. The chart shows `PAUSED | office link: ok`, and the robot appears in the office. Press **Start** there.

## The four buttons

| Button | What the robot does | Open trades | It comes back |
|---|---|---|---|
| **Start** | may open new trades | untouched | — |
| **Pause** | opens no new trades | finish normally (stop, target, or exit signal) | when you press Start |
| **Done for today** | opens no new trades | finish normally | by itself at 00:00 Prague (the start of FTMO's day) |
| **Close everything** | closes its trades now, then pauses | closed at market | when you press Start |

- Only a robot's owner sees its buttons. FTMO allows nobody else to use an account.
- The robot confirms every press. A press it doesn't pick up within 60 seconds expires.
- **A robot always starts paused.** That includes after a restart, a MetaTrader restart, or a settings change.
- Keep the PC awake while the robot runs: turn off sleep, and keep MetaTrader open. A locked screen is fine.

## FTMO 2-Step rules the robot enforces

| Rule | FTMO | The robot |
|---|---|---|
| Maximum Daily Loss | 5% of the initial balance, from the balance at 00:00 Prague, counting open trades | Closes its trades and stops for the day at **4%** |
| Maximum Loss | 10% of the initial balance | Closes its trades and stays paused at **8%** |
| Market closing (gap trading) | No new trades 2 hours or less before a close of 2 hours or more | Same, e.g. before the weekend |
| High-impact news | Restricted on funded Standard accounts | No new trades 15 minutes either side of high-impact news for the symbol's currencies |
| Server requests | Flagged above 2,000 a day | Stops opening trades after 200 |
| Account type | — | Refuses to trade anything but a demo account (setting `Demo only`) |

Risk per trade is 0.5% of the initial balance, with at most 4 trades a day between 08:00 and 20:00 Prague. All of these can be changed in the robot's inputs.

## The strategy

Until we fill in the [strategy card](plan/strategy-card.md), the robot trades a common placeholder: an EMA 20/50 crossover on M15, with the stop at 1.5 × ATR and the target at 2 × the stop. The strategy lives in `robot/OfficeRobot/Strategy.mqh`, apart from everything else, so replacing it doesn't touch the buttons or the FTMO rules.
