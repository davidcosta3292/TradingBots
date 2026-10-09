"""Mark losing candidates from the frozen candle replay; no terminal connection."""
import sys, json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local/market-audit'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as dates
from matplotlib.patches import Rectangle
snapshot = json.loads((ROOT / '.local/audit-2026-10-09/candles.json').read_text())
audit = json.loads((ROOT / '.local/audit-2026-10-09/ablation.json').read_text())
examples = [e for e in audit['examples'] if e['variant'] == 'combined' and e['result'] == 'loss']
fig, axes = plt.subplots(len(examples), 1, figsize=(12, 10), layout='constrained')
fig.patch.set_facecolor('#10151e')
tz = ZoneInfo('America/Sao_Paulo')
for ax, e in zip(axes, examples):
    start = datetime.fromisoformat(e['decision_br']); end = datetime.fromisoformat(e['exit_br'])
    ax.set_facecolor('#18202d'); ax.tick_params(colors='#c4cedc'); ax.grid(alpha=.15)
    for b in snapshot['data']['M15']['bars']:
        t = datetime.fromtimestamp(b['time'] - snapshot['server_offset_seconds'], timezone.utc).astimezone(tz)
        if not start-timedelta(hours=2) <= t <= end+timedelta(minutes=45): continue
        x = dates.date2num(t); w = 10/1440; c = '#4bd6a4' if b['close'] >= b['open'] else '#fa8d85'
        ax.vlines(x, b['low'], b['high'], color=c)
        ax.add_patch(Rectangle((x-w/2, min(b['open'], b['close'])), w, max(.025, abs(b['close']-b['open'])), color=c))
    ax.axhline(e['entry'], color='#86aaf3', ls='--', label=f"Sell entry {e['entry']:.2f}")
    ax.axhline(e['stop'], color='#fa8d85', ls='--', label=f"Stop {e['stop']:.2f}")
    ax.axvline(start, color='#e2bd70', ls=':')
    ax.set_title(f"{start:%d %b %H:%M} BRT · {e['setup']} · 0.01 lots · stop reached", color='white', loc='left')
    ax.xaxis.set_major_formatter(dates.DateFormatter('%H:%M', tz=tz))
    ax.legend(facecolor='#18202d', labelcolor='white', loc='upper left')
fig.suptitle('Combined demo rules: marked losing candidates\nApproximate OHLC replay, not executed trades or profitability evidence', color='white')
fig.savefig(ROOT / 'plan/recalibration-losing-examples-2026-10-09.png', dpi=160)
print('Saved marked losing examples')
