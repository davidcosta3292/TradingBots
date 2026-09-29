# Trading Office

One shared office for both members' robots. Each Trader EA uses its owner's FTMO MetaTrader 5 demo account; its owner can press Start, Pause, Done for today or Close everything. The office also has named planning slots for future risk, coordination, and analysis agents.

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
2. **SQL Editor:** run the files in `supabase/migrations/` in order, `0001` to `0008`.
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
2. Tap the link to your new bot and press **Start**. For alerts in a group with both of us, add the bot to the group and send a message there instead.
3. In PowerShell, in the repo folder, run:
   ```
   powershell -ExecutionPolicy Bypass -File .\tools\telegram-setup.ps1
   ```
   Paste the token when asked. The script finds your chat, sends a test message, and copies one line to your clipboard.
4. Paste that line into the Supabase **SQL Editor** and press **Run**. You should get "Trading Office connected" in Telegram.

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

The office is a static website. Vercel serves only the `office/` folder; Supabase still handles sign-in, commands, and robot reports. MetaTrader and the EA continue running on the Windows PC. Publishing the website does not move or start the trading robot.

1. Import this GitHub repository into Vercel and set **Root Directory** to `office`.
2. Set **Framework Preset** to **Other**. There is no build command or environment variable to add; `office/config.js` contains only the public Supabase project URL and publishable key.
3. The deployed page is **https://trading-office-puce.vercel.app/**. The friend can open it on a Mac without cloning GitHub or installing MetaTrader just to view the office. The demo is at https://trading-office-puce.vercel.app/?demo.
4. For live data, the friend signs in with their own Supabase Auth login. An administrator adds their existing Auth user to `office_members`; a website link alone does not grant database access. Any member can press **+ Add robot**. A **Trader** receives a one-time MetaTrader token and can run the current EA. **Risk manager**, **Coordinator**, and **Analyst** are assignment labels with no runtime yet. Only the owner can press a Trader's controls.

Jhonatan's Mac walkthrough is in [plan/friend-setup.md](plan/friend-setup.md). The Oracle free-VPS assessment is in [research/03-oracle-free-tier-vps.md](research/03-oracle-free-tier-vps.md).

If an emailed Supabase invitation opens a 404 page, set Supabase Auth's **Site URL** and **Redirect URLs** to the deployed HTTPS origin, then send a new invitation. An old invitation can retain its old redirect destination.

The page has two views: **Office**, the 3D office, and **Cards**, the plain list that works best on a phone.

In the office, where a robot is tells you what it's doing:

| Where | What it means |
|---|---|
| At its desk | Working, looking for a setup. Typing when it's in a trade. |
| At the coffee bar | Switched on, but its own rules say "not now": outside its hours, market closed, or news. It carries on by itself. |
| At its desk, scratching its head | Blocked by something that needs you, like Algo Trading switched off in MetaTrader |
| On the sofa | Paused, or done for today |
| Asleep and grey | Offline: MetaTrader isn't reporting |

Robots say what they just did in a speech bubble. The right-hand monitor on each desk takes turns between the FTMO limits and the last 7 days of trades. **Tour** flies the camera from robot to robot, **Legend** explains the places, and **Sound** turns on small sounds for trades and button presses. Each robot's owner can change its colour and gear under **Look in the office** in its card.

### 4. The robot (each of us, on our own PC and FTMO account)

1. **FTMO:** start a Free Trial (2-Step, MetaTrader 5), install FTMO's MetaTrader 5, and log in with the trial's login.
2. **MetaTrader → Tools → Options → Expert Advisors:**
   - tick *Allow algorithmic trading*;
   - tick *Allow WebRequest for listed URL*, and add the Supabase Project URL.
3. **Install the robot:** in PowerShell, in the repo folder, run `.\robot\install.ps1`. It copies and compiles the robot.
4. **Attach it:** open an **XAUUSD** chart and drag **OfficeRobot** onto it from *Navigator → Expert Advisors*. Then, under **Inputs**:
   - `Supabase project URL`, `Supabase publishable key`, and your own robot's token;
   - `Magic number`: **101** for Robot 01, **102** for Robot 02.
5. Switch on **Algo Trading** in the MetaTrader toolbar. The chart shows `PAUSED | office link: ok`, and the robot appears in the office. Press **Start** there. After an update, remove and reattach the EA so its new Inputs load; it starts paused again.

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
- **A robot always starts paused.** That includes after a restart, a MetaTrader restart, or a settings change.
- Keep the PC awake while the robot runs: turn off sleep, and keep MetaTrader open. A locked screen is fine.

## FTMO 2-Step rules the robot enforces

| Rule | FTMO | The robot |
|---|---|---|
| Maximum Daily Loss | 5% of the initial balance, from the balance at 00:00 Prague, counting open trades | Closes its trades and stops for the day at **4%** |
| Maximum Loss | 10% of the initial balance | Closes its trades and stays paused at **8%** |
| Market closing (gap trading) | No new trades 2 hours or less before a close of 2 hours or more | Same, e.g. before the weekend |
| High-impact news | Restricted on funded Standard accounts | Scans the MT5 calendar for the symbol's currencies; warns up to one hour ahead, blocks new entries 15 minutes either side, and blocks entries if the calendar query fails |
| Server requests | Flagged above 2,000 a day | Stops opening trades after 200 |
| Account type | — | Refuses to trade anything but a demo account (setting `Demo only`) |

The current exercise defaults to 0.05% risk per entry, at most 2 entries a day, between 08:00 and 20:00 Prague. The broker-side stop and target remain in place even if MetaTrader disconnects. Exercise mode refuses non-demo accounts, risk above 0.1%, and more than 2 entries a day.

## The strategy

Until we fill in the [strategy card](plan/strategy-card.md), **Demo exercise** is the default. On a closed M1 bar, the robot buys when EMA 5 is above EMA 13, or sells when it is below. It closes its own position after 3 minutes, or sooner at the broker-side stop or target. This is an execution check, not a profitability claim. It will only open after its owner presses Start and every FTMO guard allows the entry. A quiet market, news pause, unavailable calendar, or off-hours can delay it. `InpExerciseMode=false` restores the EMA crossover mode. The strategy lives in `robot/OfficeRobot/Strategy.mqh`, apart from the buttons and FTMO limits.

Telegram already receives confirmed controls and trade events. At 20:00 Prague, on days a Trader reported, it also sends a generic check-in linking to the signed-in office. Detailed balances and P&L stay in the office. The EA's news watch alerts Telegram as a high-impact event approaches and when its entry pause begins or ends. A separate news agent that can talk to Traders is a later build step; see [the news-agent plan](plan/news-agent.md).
