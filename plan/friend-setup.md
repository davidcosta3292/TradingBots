# Jhonatan's Trading Office setup

## What exists today

Your login, `pr.jhonatanqueiroz@gmail.com`, is an office member. **Risk Management** is a planned risk-manager assignment in the office. It has never reported from MetaTrader. It does not watch an account, place trades, or send its own alerts. The FTMO guards currently run inside each **Trader** EA.

## Create a real demo Trader

1. On your Mac, open <https://trading-office-puce.vercel.app/> and sign in with your own Supabase password. You do not need GitHub, the Supabase dashboard, a database password, or CLI commands.
2. Press **+ Add robot**, choose **Trader**, and give it a name such as **Gold Trader**. The token is shown once. Copy it privately; do not paste it into a public chat or GitHub. If you close the page before copying it, ask David to reset that robot's token.
3. Download <https://trading-office-puce.vercel.app/downloads/OfficeRobot-source.zip> and unzip it. This contains the seven `.mq5`/`.mqh` source files, no account credentials.
4. Install FTMO's MetaTrader 5 on your Mac and log in to **your own FTMO demo account**. In MetaTrader choose **File → Open Data Folder**. Copy the unzipped `OfficeRobot` folder to `MQL5/Experts` in that data folder. Open `OfficeRobot.mq5` in MetaEditor and press **F7** to compile; return to MetaTrader and refresh Expert Advisors in the Navigator. See [MetaTrader's Mac installation guide](https://www.metatrader5.com/en/terminal/help/start_advanced/install_mac) and [EA source installation guide](https://www.metatrader5.com/en/terminal/help/algotrading/autotrading).
5. In MetaTrader choose **Tools → Options → Expert Advisors**. Enable algorithmic trading and allow WebRequest for `https://tpmrowyqsayyypkxkvfz.supabase.co`. The same settings can be reached through the terminal menus on Mac.
6. Open the demo account's **XAUUSD** chart and attach OfficeRobot. In **Inputs**, paste *your Trader's* token into `InpRobotToken`; choose a magic number distinct from David's **101** (for example **102**). Keep `InpDemoOnly=true`. The project URL and publishable key are already in the source defaults.
7. Enable **Algo Trading** in MetaTrader. Leave the Mac awake and MetaTrader running. The robot should report to the office and show **PAUSED | office link: ok**. Only then will its Start button become available. Press **Start** from your own login when you are ready for demo trading. A Strategy Tester run cannot test the office WebRequest connection.

The trading strategy is still a placeholder EMA 20/50 cross on M15. A Trader robot is real software: when running, it uses MT5 market data, applies the strategy and FTMO guard limits, can place **demo** trades, reports status to Supabase, and obeys its owner's four office controls. Naming or creating a row in the office alone does none of that. Keep one active Trader EA per FTMO account for now; multiple EAs on the same account need a shared account-level risk budget first.

## Telegram

The current Telegram bot is **@Trader1DBot**. Alerts are sent centrally by Supabase to **one configured chat**. Creating an office robot does not connect a new Telegram chat.

To receive the same alerts as David:

1. Create a private Telegram group with you and David, and add **@Trader1DBot**.
2. Send `/start@Trader1DBot` in the group so the bot receives an update.
3. Ask David to run `tools/telegram-setup.ps1` on his Windows PC and choose the group when it appears. The helper sends a test message and copies the Supabase command to the clipboard; it does **not** save the setting by itself. David can ask Codex to apply that command through the Supabase connector, or run it in the Supabase SQL Editor.
4. Confirm that both of you see the test message and a subsequent robot event. Until the group is configured, alerts still go to the existing private chat. The office shows command confirmations and events to both members independently of Telegram.

## Assignments

The office has **Trader**, **Risk manager**, **Coordinator**, and **Analyst** labels. Only Trader has a connected runtime today. The other labels are reserved for future software. A planned role cannot receive MT5 reports or Start/Pause/Close trading commands. Before a role first connects, its owner can change its assignment; changing it to Trader issues a new one-time token. Once a Trader has reported, its assignment is fixed. Up to six slots per person can be created in the current office. Every Trader needs its own connection token and a unique MT5 magic number.
