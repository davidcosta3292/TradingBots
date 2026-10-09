"""Render the frozen read-only broker snapshot; does not connect to MT5."""
import sys,json,csv
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.local/market-audit'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as dates
from matplotlib.patches import Rectangle
snapshot=json.loads((ROOT/'.local/audit-2026-10-09/candles.json').read_text())
replay=json.loads((ROOT/'.local/audit-2026-10-09/replay.json').read_text())
tz=ZoneInfo('America/Sao_Paulo'); offset=snapshot['server_offset_seconds']
bars=snapshot['data']['M15']['bars']; alpha=2/21; values=[bars[0]['close']]
for b in bars[1:]: values.append(values[-1]+alpha*(b['close']-values[-1]))
selected=[]
for b,e in zip(bars,values):
    dt=datetime.fromtimestamp(b['time']-offset,timezone.utc).astimezone(tz)
    if dt.date().isoformat()=='2026-10-09' and 7<=dt.hour<12:
        selected.append((b,e,dt))
fig,(ax,gate)=plt.subplots(2,1,figsize=(12,8),gridspec_kw={'height_ratios':[2.2,1]},layout='constrained')
fig.patch.set_facecolor('#10151e')
for a in (ax,gate):
    a.set_facecolor('#18202d'); a.tick_params(colors='#c4cedc'); a.grid(alpha=.15,color='#9ca8bb')
    for s in a.spines.values(): s.set_color('#43516a')
    a.yaxis.label.set_color('#c4cedc'); a.xaxis.label.set_color('#c4cedc')
for b,e,dt in selected:
    x=dates.date2num(dt); width=10/(24*60); c='#4bd6a4' if b['close']>=b['open'] else '#fa8d85'
    ax.vlines(x,b['low'],b['high'],color=c,lw=1.3)
    ax.add_patch(Rectangle((x-width/2,min(b['open'],b['close'])),width,max(.025,abs(b['close']-b['open'])),color=c))
ax.plot([dt for b,e,dt in selected],[e for b,e,dt in selected],color='#e2bd70',lw=1.4,label='M15 EMA20')
def dt(h,m=0): return datetime(2026,10,9,h,m,tzinfo=tz)
ax.axvspan(dt(7),dt(9),color='#6c768a',alpha=.14,label='Before entry session')
ax.axvline(dt(9),color='#c4cedc',ls=':',alpha=.6)
ax.annotate('10:00 decision: short confirmation\nH4 blocked; continuation not enabled',xy=(dt(9,45),4175.33),xytext=(dt(8,45),4160),fontsize=9,color='#faada7',arrowprops={'arrowstyle':'->','color':'#faada7'})
ax.annotate('10:30 decision: long confirmation\nH4 blocked; pullback threshold missed',xy=(dt(10,15),4188.99),xytext=(dt(10),4203),fontsize=9,color='#8ce5c6',arrowprops={'arrowstyle':'->','color':'#8ce5c6'})
ax.set_ylim(4157,4211); ax.set_ylabel('XAUUSD bid ($/oz)')
ax.set_title('FTMO demo candles · 9 October 2026 · São Paulo time',color='white',loc='left',fontsize=15,pad=14)
ax.xaxis.set_major_formatter(dates.DateFormatter('%H:%M',tz=tz))
ax.legend(facecolor='#18202d',labelcolor='#c4cedc',edgecolor='#43516a',loc='upper left')
rows=[r for r in replay['rows'] if r['eligible_session']]
times=[dt(*map(int,r['decision_br'].split(':'))) for r in rows]
for key,label,c in [('slow','H4 EMA200','#e2bd70'),('fast','H4 EMA50','#86aaf3'),('close','Last closed H4 price','#4bd6a4')]:
    gate.step(times,[r['trends']['H4'][key] for r in rows],where='post',label=label,color=c)
gate.set_ylabel('H4 filter values'); gate.set_xlabel('São Paulo time · candle labels show OPEN time; decisions occur after the candle closes')
gate.xaxis.set_major_formatter(dates.DateFormatter('%H:%M',tz=tz))
gate.legend(facecolor='#18202d',labelcolor='#c4cedc',edgecolor='#43516a',loc='upper right',fontsize=8)
gate.text(.01,.94,'Price > EMA50, but EMA50 < EMA200 → MIXED → no entry evaluation',transform=gate.transAxes,color='white',fontsize=10,va='top')
fig.suptitle('Patterns shown are rejected candidates, not valid signals or proven profitable trades.',color='#c4cedc',fontsize=10)
fig.savefig(ROOT/'plan/market-audit-2026-10-09.png',dpi=170)
with (ROOT/'plan/market-audit-2026-10-09-checks.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['decision_sao_paulo','decision_new_york','H4_close','H4_EMA50','H4_EMA200','trend_gate_pass','original_signal','buy_full_pattern_only','sell_full_pattern_only','buy_continuation_pattern_only','sell_continuation_pattern_only'])
    for r in rows:
        h=r['trends']['H4']; w.writerow([r['decision_br'],r['decision_ny'],h['close'],h['fast'],h['slow'],r['gate'],r['signal'],bool(r['patterns']['1']['full']),bool(r['patterns']['-1']['full']),r['patterns']['1']['continuation'],r['patterns']['-1']['continuation']])
print('Saved chart and per-check CSV')
