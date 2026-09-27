# Oracle Always Free as a future host for Trading Office

Checked 27 September 2026 against Oracle, MetaTrader, and FTMO documentation. The shared video, [“Como ter um servidor VPS grátis pra sempre sem gambiarra”](https://www.youtube.com/watch?v=bk5sWon4tnE), presents the free-VPS idea. Its captions/transcript were not available in the browser, so the limits below come from the providers' own documentation.

## What is genuinely free

Oracle's [Always Free resource list](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) currently includes up to two AMD E2.1.Micro VMs (1 GB RAM each), and 1,500 A1 Arm OCPU-hours plus 9,000 GB-hours monthly (equivalent to 2 OCPUs and 12 GB RAM continuously for an Always Free tenancy). The combined free block-volume allowance is 200 GB, including boot volumes. Free instances must be in the tenancy's home region. Shape availability is not guaranteed: Oracle documents “out of host capacity” errors. Oracle may reclaim idle free VMs after a seven-day low-utilization period. The initial $300/30-day trial credits are separate from Always Free.

## Fit for our stack

- **Website:** Already hosted on Vercel. Moving it to Oracle adds operational work with little benefit.
- **Database, realtime, Telegram:** Already on Supabase. A small Oracle VM could later run a separate Python risk/analysis service, but there is no need for one yet.
- **MT5 trading EA:** The free AMD micro's 1 GB RAM is a poor fit for a graphical MetaTrader plus Wine. Oracle's larger A1 free VM is Arm, while MetaTrader's [official Linux method](https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux) uses Wine to run its Windows application. Running the x86 MT5 binary on Arm would require another emulation layer and is not the supported/simple path. Oracle's free images listed for these shapes are Linux, not a free Windows MT5 VPS.
- **FTMO policy:** FTMO says [VPS/VPN use is generally allowed](https://ftmo.com/faq/can-i-travel-or-use-vpn-vps/), while cautioning against a United States location for MetaTrader access. Choose the region accordingly if ever hosting MT5 there.

## Decision

Keep both MT5 Trader EAs on each owner's computer during demo testing. Oracle Always Free is viable to experiment with **non-trading monitoring or analysis services**, with backups and an offline alert, but I would not make it the only host for a funded or time-critical MT5 EA. When we need 24/7 trading, compare a supported x86 Windows VPS (or MetaTrader virtual hosting) after the strategy and demo operation are stable.
