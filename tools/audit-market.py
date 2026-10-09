"""Read-only MT5 candle capture and replay of OfficeRobot 1.2.4 signal rules.

No trade API is used. Counterfactual patterns are diagnostics, not trade signals.
"""
import sys, json, math
from pathlib import Path
from datetime import datetime, timezone
from bisect import bisect_right
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.local/market-audit'))
import MetaTrader5 as mt5

OUT = ROOT / '.local/audit-2026-10-09'
OUT.mkdir(parents=True, exist_ok=True)
print('Connecting to MT5', flush=True)
if not mt5.initialize(r'C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe', timeout=10000):
    raise RuntimeError(mt5.last_error())
try:
    print('Connected', flush=True)
    info = mt5.account_info()
    if info is None or info.login != 1514746116:
        raise RuntimeError('Unexpected account; aborting capture')
    tick = mt5.symbol_info_tick('XAUUSD')
    now = datetime.now(timezone.utc)
    offset = round((tick.time-now.timestamp())/900)*900
    symbol = mt5.symbol_info('XAUUSD')
    data = {}
    for name, tf, seconds in [('M15',mt5.TIMEFRAME_M15,900),('H1',mt5.TIMEFRAME_H1,3600),('H4',mt5.TIMEFRAME_H4,14400),('D1',mt5.TIMEFRAME_D1,86400)]:
        print('Reading '+name, flush=True)
        rates = mt5.copy_rates_from_pos('XAUUSD',tf,0,2000 if name=='H4' else 1000)
        print('Read '+name+': '+str(None if rates is None else len(rates)), flush=True)
        if rates is None or len(rates)<500:
            raise RuntimeError((name,mt5.last_error(),None if rates is None else len(rates)))
        bars = [{k:(int(r[k]) if k in ['time','tick_volume','spread','real_volume'] else float(r[k])) for k in rates.dtype.names} for r in rates]
        data[name] = {'seconds':seconds,'bars':bars}
    meta = {'capture_utc':now.isoformat(),'server_offset_seconds':offset,'tick':{'time':tick.time,'bid':tick.bid,'ask':tick.ask},'symbol':{'contract_size':symbol.trade_contract_size,'volume_min':symbol.volume_min,'volume_step':symbol.volume_step,'point':symbol.point},'data':data}
    (OUT/'candles.json').write_text(json.dumps(meta),encoding='utf-8')
finally:
    mt5.shutdown()

def ema(values, period):
    a=2/(period+1); result=[values[0]]
    for v in values[1:]: result.append(result[-1]+a*(v-result[-1]))
    return result

for tf, series in data.items():
    bars=series['bars']; close=[b['close'] for b in bars]
    periods=(50,200) if tf=='H4' else (20,50)
    series['fast']=ema(close,periods[0]); series['slow']=ema(close,periods[1])
    series['times']=[b['time'] for b in bars]
    tr=[0]+[max(bars[i]['high'],bars[i-1]['close'])-min(bars[i]['low'],bars[i-1]['close']) for i in range(1,len(bars))]
    series['atr']=[sum(tr[max(0,i-13):i+1])/14 for i in range(len(bars))]

def trend_at(tf,t):
    s=data[tf]
    # Current bar is the latest open time <= decision; previous is closed.
    i=bisect_right(s['times'],t)-2
    b=s['bars'][i]; f=s['fast'][i]; slow=s['slow'][i]
    trend=1 if f>slow and b['close']>f else -1 if f<slow and b['close']<f else 0
    return {'trend':trend,'close':b['close'],'fast':f,'slow':slow,'bar_time':b['time']}

def patterns(b,e,a,d):
    rr=b[1]['high']-b[1]['low']; rb=abs(b[1]['close']-b[1]['open']); cb=abs(b[0]['close']-b[0]['open'])
    conf=(b[0]['close']>b[0]['open'] and b[0]['close']>b[1]['high'] and b[0]['close']>e) if d>0 else (b[0]['close']<b[0]['open'] and b[0]['close']<b[1]['low'] and b[0]['close']<e)
    pull=(b[1]['low']<=e+.55*a and b[1]['close']>=e-.35*a) if d>0 else (b[1]['high']>=e-.55*a and b[1]['close']<=e+.35*a)
    continuation=rr>0 and cb>=a*.12 and pull and conf
    reaction=(b[1]['close']>b[1]['open'] and b[1]['close']>=b[1]['low']+.65*rr and (min(b[1]['open'],b[1]['close'])-b[1]['low']>=.10*a or rb>=.35*a)) if d>0 else (b[1]['close']<b[1]['open'] and b[1]['close']<=b[1]['low']+.35*rr and (b[1]['high']-max(b[1]['open'],b[1]['close'])>=.10*a or rb>=.35*a))
    candidates=[]; full=None
    for k in range(3,13):
        level=max(x['high'] for x in b[k+1:k+7]) if d>0 else min(x['low'] for x in b[k+1:k+7])
        broke=b[k]['close']>level+.05*a if d>0 else b[k]['close']<level-.05*a
        held=all(x['close']>=level-.70*a for x in b[2:k]) if d>0 else all(x['close']<=level+.70*a for x in b[2:k])
        zone=((level-.55*a<=b[1]['low']<=level+.35*a and b[1]['close']>level) or (e-.55*a<=b[1]['low']<=e+.25*a and b[1]['close']>=e)) if d>0 else ((level-.35*a<=b[1]['high']<=level+.55*a and b[1]['close']<level) or (e-.25*a<=b[1]['high']<=e+.55*a and b[1]['close']<=e))
        if broke and held:
            candidates.append({'k':k,'level':level,'zone':zone,'reaction':reaction,'confirmation':conf})
            if rr>0 and rb>=rr*.25 and cb>=a*.10 and zone and reaction and conf and full is None:
                full={'k':k,'level':level}
    return {'full':full,'continuation':continuation,'confirmation':conf,'pullback':pull,'reaction':reaction,'bos_candidates':candidates}

rows=[]
ny=ZoneInfo('America/New_York'); br=ZoneInfo('America/Sao_Paulo')
for i, current in enumerate(data['M15']['bars']):
    t=current['time']; utc=datetime.fromtimestamp(t-offset,timezone.utc)
    if utc.astimezone(br).strftime('%Y-%m-%d')!='2026-10-09' or utc>now or i<32: continue
    local=utc.astimezone(br); n=utc.astimezone(ny)
    if not 7<=local.hour<15: continue
    trends={tf:trend_at(tf,t) for tf in ['D1','H4','H1','M15']}
    h4=trends['H4']['trend']; gate=h4!=0 and (trends['D1']['trend']==h4 or trends['H1']['trend']==h4)
    b=list(reversed(data['M15']['bars'][i-32:i])); e=data['M15']['fast'][i-1]; a=data['M15']['atr'][i-1]
    p={str(d):patterns(b,e,a,d) for d in [1,-1]}
    signal=None
    if gate:
        q=p[str(h4)]
        if q['full'] and trends['M15']['trend']==h4: signal='full'
        elif n.hour>=10 and q['continuation']: signal='continuation'
    rows.append({'decision_br':local.strftime('%H:%M'),'decision_ny':n.strftime('%H:%M'),'eligible_session':8<=n.hour<13,'trends':trends,'gate':gate,'signal':signal,'ema20':e,'atr':a,'confirmation_bar':b[0],'reaction_bar':b[1],'patterns':p})
(OUT/'replay.json').write_text(json.dumps({'meta':{k:v for k,v in meta.items() if k!='data'},'rows':rows},indent=2),encoding='utf-8')
print(json.dumps({'capture':meta['capture_utc'],'offset':offset,'counts':{k:len(v['bars']) for k,v in data.items()},'rows':[{k:r[k] for k in ['decision_br','decision_ny','eligible_session','gate','signal']}|{'trends':{k:v['trend'] for k,v in r['trends'].items()},'h4':r['trends']['H4'],'buy_full':r['patterns']['1']['full'],'buy_cont':r['patterns']['1']['continuation'],'sell_full':r['patterns']['-1']['full'],'sell_cont':r['patterns']['-1']['continuation']} for r in rows]},indent=2))
