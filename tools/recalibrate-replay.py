"""Ablate signal changes on frozen FTMO candles. No terminal/trade connection.

Outcomes are OHLC approximations, not a broker execution backtest. Ambiguous
same-bar stop/target touches resolve stop-first; recent unfinished trades stay open.
"""
import json,csv,math
from pathlib import Path
from bisect import bisect_right
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
x=json.loads((ROOT/'.local/audit-2026-10-09/candles.json').read_text())
data=x['data']; offset=x['server_offset_seconds']; ny=ZoneInfo('America/New_York'); br=ZoneInfo('America/Sao_Paulo')
def ema(v,n):
    out=[v[0]]; a=2/(n+1)
    for p in v[1:]:out.append(out[-1]+a*(p-out[-1]))
    return out
for tf,s in data.items():
    b=s['bars']; c=[r['close'] for r in b]; periods=(50,200) if tf=='H4' else (20,50)
    s['fast']=ema(c,periods[0]); s['slow']=ema(c,periods[1]); s['times']=[r['time'] for r in b]
    tr=[0]+[max(b[i]['high'],b[i-1]['close'])-min(b[i]['low'],b[i-1]['close']) for i in range(1,len(b))]
    s['atr']=[sum(tr[max(0,i-13):i+1])/14 for i in range(len(b))]
def tindex(tf,t):return bisect_right(data[tf]['times'],t)-2
def trend(tf,t):
    s=data[tf]; i=tindex(tf,t); f=s['fast'][i]; slow=s['slow'][i]; c=s['bars'][i]['close']
    return 1 if f>slow and c>f else -1 if f<slow and c<f else 0
def rebound(t,h1,m15):
    s=data['H4']; i=tindex('H4',t); now=s['bars'][i]; a=s['atr'][i]; f=s['fast'][i]
    d=1 if now['close']>f and f>s['fast'][i-3] else -1 if now['close']<f and f<s['fast'][i-3] else 0
    if not d or h1!=d or m15!=d:return 0,None
    for lag in range(3):
        k=i-lag; bar=s['bars'][k]; prior=s['bars'][k-3:k]
        level=max(p['high'] for p in prior) if d>0 else min(p['low'] for p in prior)
        protected=min(p['low'] for p in prior) if d>0 else max(p['high'] for p in prior)
        broke=(bar['close']>level and bar['low']>protected) if d>0 else (bar['close']<level and bar['high']<protected)
        held=all(p['low']>protected and p['close']>=level-.5*a for p in s['bars'][k:i+1]) if d>0 else all(p['high']<protected and p['close']<=level+.5*a for p in s['bars'][k:i+1])
        if broke and held:return d,{'level':level,'protected':protected,'lag':lag}
    return 0,None
def evaluate(i, flags, traded=False):
    s=data['M15'];t=s['times'][i]; ts={tf:trend(tf,t) for tf in ['D1','H4','H1','M15']}; d=ts['H4']; mode='aligned'; rb=None
    if d==0 and 'trend' in flags:
        d,rb=rebound(t,ts['H1'],ts['M15']); mode='rebound' if d else 'mixed'
    if not d or (mode!='rebound' and ts['D1']!=d and ts['H1']!=d):return None,'trend',rb
    risk=.5 if mode=='rebound' or not(ts['D1']==d and ts['H1']==d) else 1.
    b=list(reversed(s['bars'][i-40:i])); a=s['atr'][i-1]; ar=s['atr'][i-2] if 'reference' in flags else a
    e=s['fast'][i-1]; er=s['fast'][i-2] if 'reference' in flags else e
    rr=b[1]['high']-b[1]['low']; body=abs(b[1]['close']-b[1]['open']); cb=abs(b[0]['close']-b[0]['open'])
    conf=(b[0]['close']>b[0]['open'] and b[0]['close']>b[1]['high'] and b[0]['close']>e) if d>0 else (b[0]['close']<b[0]['open'] and b[0]['close']<b[1]['low'] and b[0]['close']<e)
    reaction=(b[1]['close']>b[1]['open'] and b[1]['close']>=b[1]['low']+.65*rr and (min(b[1]['open'],b[1]['close'])-b[1]['low']>=.1*ar or body>=.35*ar)) if d>0 else (b[1]['close']<b[1]['open'] and b[1]['close']<=b[1]['low']+.35*rr and (b[1]['high']-max(b[1]['open'],b[1]['close'])>=.1*ar or body>=.35*ar))
    full=None
    if ts['M15']==d and rr>0 and body>=rr*.25 and cb>=a*.1:
        for k in range(3,13):
            if 'pivot' in flags:
                level=None
                for j in range(k+3,k+15):
                    v=b[j]['high'] if d>0 else b[j]['low']; neighbors=[b[j+z] for z in [-2,-1,1,2]]
                    if (all(v>p['high'] for p in neighbors) if d>0 else all(v<p['low'] for p in neighbors)):
                        level=v;break
                if level is None:continue
            else:level=max(p['high'] for p in b[k+1:k+7]) if d>0 else min(p['low'] for p in b[k+1:k+7])
            ak=s['atr'][i-1-k] if 'reference' in flags else a
            broke=b[k]['close']>level+.05*ak if d>0 else b[k]['close']<level-.05*ak
            held=all(p['close']>=level-.7*ak for p in b[2:k]) if d>0 else all(p['close']<=level+.7*ak for p in b[2:k])
            if 'zone' in flags:
                zone=((b[1]['low']<=level+.35*ar and b[1]['low']>=level-1.5*ar and b[1]['close']>level) or (b[1]['low']<=er+.35*ar and b[1]['low']>=er-1.5*ar and b[1]['close']>=er-.35*ar)) if d>0 else ((b[1]['high']>=level-.35*ar and b[1]['high']<=level+1.5*ar and b[1]['close']<level) or (b[1]['high']>=er-.35*ar and b[1]['high']<=er+1.5*ar and b[1]['close']<=er+.35*ar))
            else:
                zone=((level-.55*ar<=b[1]['low']<=level+.35*ar and b[1]['close']>level) or (er-.55*ar<=b[1]['low']<=er+.25*ar and b[1]['close']>=er)) if d>0 else ((level-.35*ar<=b[1]['high']<=level+.55*ar and b[1]['close']<level) or (er-.25*ar<=b[1]['high']<=er+.55*ar and b[1]['close']<=er))
            if broke and held and zone and reaction and conf:full=k;break
    hour=datetime.fromtimestamp(t-offset,timezone.utc).astimezone(ny).hour
    cont=False
    if not full and hour>=10 and not traded and rr>0 and cb>=.12*a:
        pull=(b[1]['low']<=er+.55*ar and b[1]['close']>=er-.35*ar) if d>0 else (b[1]['high']>=er-.55*ar and b[1]['close']<=er+.35*ar)
        if 'zone' in flags:pull= pull and (b[1]['low']>=er-1.5*ar if d>0 else b[1]['high']<=er+1.5*ar)
        cont=pull and conf
    if not full and not cont:return None,'pattern',rb
    extreme=min(p['low'] for p in b[:3 if full else 2]) if d>0 else max(p['high'] for p in b[:3 if full else 2])
    raw=extreme-.15*a if d>0 else extreme+.15*a
    stop=min(raw,b[0]['close']-1.2*a) if d>0 else max(raw,b[0]['close']+1.2*a)
    return {'direction':d,'mode':mode,'setup':'full' if full else 'continuation','stop':stop,'risk_factor':risk if full else .5,'atr':a,'bos_k':full},'signal',rb

variants={'baseline':set(),'trend_only':{'trend'},'reference_only':{'reference'},'zone_only':{'zone'},'pivot_only':{'pivot'},'trend_reference':{'trend','reference'},'combined':{'trend','reference','zone','pivot'}}
bars=data['M15']['bars']; capture=datetime.fromisoformat(x['capture_utc']).timestamp(); results={}; examples=[]
for name,flags in variants.items():
    counts={'checks':0,'trend_waits':0,'pattern_waits':0,'signals':0,'size_rejections':0,'wins':0,'losses':0,'time_exits':0,'pending':0,'risk_units':0}; busy=-1; day=None; filled=0; streak=0; cooldown=-1
    for i in range(220,len(bars)-1):
        b=bars[i]; t=b['time']; utc=datetime.fromtimestamp(t-offset,timezone.utc); n=utc.astimezone(ny)
        if t-offset>capture or n.hour<8 or n.hour>=13:continue
        if n.date()!=day:day=n.date();filled=0;streak=0;cooldown=-1
        if i<=busy or filled>=5 or streak>=2 or t<cooldown:continue
        counts['checks']+=1; sig,reason,rb=evaluate(i,flags,filled>0)
        if not sig:counts['trend_waits' if reason=='trend' else 'pattern_waits']+=1;continue
        counts['signals']+=1; d=sig['direction']; spread=b['spread']*.01; entry=b['open']+(spread if d>0 else 0); distance=(entry-sig['stop'])*d; budget=25*sig['risk_factor']; volume=math.floor((budget/(100*distance)+1e-9)/.01)*.01 if distance>0 else 0
        example={'variant':name,'decision_br':utc.astimezone(br).isoformat(),'entry':entry,**sig,'budget':budget,'min_lot_risk':distance,'volume':volume,'result':None,'rebounds':rb}
        if distance<=0 or distance>4*sig['atr'] or volume<.01:
            counts['size_rejections']+=1;example['result']='size rejected'; examples.append(example);continue
        target=entry+d*3*distance; outcome=None; exitprice=None; exit_i=i
        for j in range(i,len(bars)):
            bar=bars[j];complete=bar['time']+900-offset<=capture
            if not complete:break
            # SELL SL/TP are triggered on ask: approximate using bar spread.
            hi=bar['high']+(bar['spread']*.01 if d<0 else 0); lo=bar['low']+(bar['spread']*.01 if d<0 else 0)
            stophit=lo<=sig['stop'] if d>0 else hi>=sig['stop']; tphit=hi>=target if d>0 else lo<=target
            if stophit:outcome='loss';exitprice=sig['stop'];exit_i=j;break
            if tphit:outcome='win';exitprice=target;exit_i=j;break
            if bar['time']+900>=t+21600:outcome='time_exit';exitprice=bar['close']+(bar['spread']*.01 if d<0 else 0);exit_i=j;break
        filled+=1
        if outcome is None:counts['pending']+=1;busy=len(bars);example['result']='pending'
        else:
            r=d*(exitprice-entry)/distance;counts['risk_units']+=r;counts[{'loss':'losses','win':'wins','time_exit':'time_exits'}[outcome]]+=1;busy=exit_i;streak=streak+1 if r<0 else 0
            if r<0:cooldown=bars[exit_i]['time']+900+1800
            example.update(result=outcome,r_multiple=r,exit_br=datetime.fromtimestamp(bars[exit_i]['time']+900-offset,timezone.utc).astimezone(br).isoformat())
        examples.append(example)
    results[name]=counts
out={'capture':x['capture_utc'],'limits':'Signal experiment: no historical news/FTMO daily equity reconstruction, approximate spread, no commissions, conservative stop-first on ambiguous bars, close-based six-hour exit. Not profitability evidence.','variants':results,'examples':examples}
(ROOT/'.local/audit-2026-10-09/ablation.json').write_text(json.dumps(out,indent=2))
with (ROOT/'plan/recalibration-replay-2026-10-09.csv').open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=['variant',*next(iter(results.values())).keys()]);w.writeheader()
    for name,c in results.items():w.writerow({'variant':name,**c})
print(json.dumps({'variants':results,'combined_examples':[e for e in examples if e['variant']=='combined'],'today_rebound_checks':[(r['decision_br'],rebound(data['M15']['times'][next(i for i,b in enumerate(bars) if datetime.fromtimestamp(b['time']-offset,timezone.utc).astimezone(br).strftime('%H:%M')==r['decision_br'] and datetime.fromtimestamp(b['time']-offset,timezone.utc).astimezone(br).date().isoformat()=='2026-10-09')],r['trends']['H1']['trend'],r['trends']['M15']['trend'])) for r in json.loads((ROOT/'.local/audit-2026-10-09/replay.json').read_text())['rows'] if r['eligible_session']]},indent=2))
