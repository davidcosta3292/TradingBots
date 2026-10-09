"""Verify frozen replay causality and accounting without placing orders."""
import contextlib, io, runpy, copy
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
with contextlib.redirect_stdout(io.StringIO()):
    replay = runpy.run_path(str(ROOT / 'tools/recalibrate-replay.py'))
data, evaluate = replay['data'], replay['evaluate']
flags = replay['variants']['combined']
assert len(replay['variants']) == 7
for counts in replay['results'].values():
    assert counts['checks'] == counts['trend_waits'] + counts['pattern_waits'] + counts['signals']
    assert counts['signals'] == counts['size_rejections'] + counts['wins'] + counts['losses'] + counts['time_exits'] + counts['pending']
# Alter all as-yet-unclosed prices/indicator values. Earlier decisions must not change.
for i in range(250, len(data['M15']['bars'])-2, 25):
    t = data['M15']['times'][i]
    before = evaluate(i, flags)
    saved = {}
    for tf, series in data.items():
        start = replay['tindex'](tf,t)+1
        saved[tf] = (start, copy.deepcopy(series['bars'][start:]), series['fast'][start:].copy(), series['slow'][start:].copy(), series['atr'][start:].copy())
        for bar in series['bars'][start:]:
            for key in ('open','high','low','close'): bar[key] += 10000
        for key in ('fast','slow','atr'):
            series[key][start:] = [v+10000 for v in series[key][start:]]
    assert evaluate(i, flags) == before, f'Future data affected decision {i}'
    for tf, (start,bars,fast,slow,atr) in saved.items():
        series=data[tf]; series['bars'][start:]=bars; series['fast'][start:]=fast; series['slow'][start:]=slow; series['atr'][start:]=atr
print('Seven variants: accounting and future-candle isolation passed')
