// Render native EA diagnostics. No interpretation here can authorize a trade.
const escapeHTML = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (v, digits=2) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
const time = (epoch) => Number.isFinite(epoch) ? new Date(epoch*1000).toLocaleString('en-GB',{timeZone:'America/New_York',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+' NY' : '—';
const GATES = {trend:'Higher-timeframe direction',m15_alignment:'M15 agreement',candle_shape:'Candle bodies',bos:'Confirmed swing BOS',structure_held:'Structure held',zone:'Retest zone',reaction:'Reaction candle',confirmation:'Close confirmation',continuation_window:'Continuation available',continuation_pullback:'Continuation pullback',continuation:'Continuation setup'};
export function diagnosticsCard(robot, history=[], online=true) {
  const s=robot.status||{}, check=s.strategy_check;
  if (!check?.strategy) return '';
  const d=check.strategy, p=check.sizing||{}, gates=d.gates||{};
  const currency=/^[A-Z]{3}$/.test(s.currency||'') ? s.currency : 'USD';
  const money=(v)=> typeof v==='number' && Number.isFinite(v) ? new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(v) : '—';
  const permission=online && robot.state==='active' && (s.operational_permission ?? s.can_trade)===true;
  const stale=Date.now()-check.at*1000>20*60_000;
  const signal=d.data_ready===false ? 'Waiting for data' : check.signal_ready ? 'Pattern confirmed' : 'Waiting for setup';
  return `<section class="entry-diagnostics" aria-label="Entry diagnostics">
    <div class="readiness"><span class="${permission?'pass':'wait'}"><b>Market permission</b>${permission?'Allowed':'Blocked or paused'}</span>
      <span class="${check.signal_ready&&!stale?'pass':'wait'}"><b>Strategy signal</b>${escapeHTML(signal)}${stale?' · old check':''}</span></div>
    <p class="diagnostic-time">Last M15 decision: ${escapeHTML(time(check.at))} · ${escapeHTML(d.mode)} · ${escapeHTML(check.version)}</p>
    <p class="diagnostic-decision">${escapeHTML(check.decision)}${p.available?' · '+escapeHTML(p.reason):''}</p>
    ${p.available ? `<dl class="size-grid"><div><dt>Stop distance · $/oz</dt><dd>${number(p.stop_distance)}</dd></div>
      <div><dt>Minimum-lot risk</dt><dd>${money(p.minimum_lot_risk)}</dd></div>
      <div><dt>Risk budget</dt><dd>${money(p.risk_budget)}</dd></div><div><dt>Calculated lots</dt><dd>${number(p.calculated_volume,2)}</dd></div>
      <div><dt>Broker minimum lots</dt><dd>${number(p.minimum_volume,2)}</dd></div><div><dt>Size fits budget</dt><dd>${p.feasible?'Yes':'No'}</dd></div></dl>
      <small>Quote at the decision · risk before fees and slippage. Volume is never rounded up beyond the budget.</small>`
      : '<p class="diagnostic-empty">Stop distance and size appear when the entry pattern is confirmed.</p>'}
    <details data-detail="gates-${escapeHTML(robot.id)}"><summary>Why this check passed or waited</summary>
      <ul class="gate-list">${Object.entries(GATES).map(([key,label])=>{const value=gates[key];return `<li><span>${label}</span><b class="${value===true?'pass':value===false?'wait':'unevaluated'}">${value===true?'Passed':value===false?'Not met':'Not evaluated'}</b></li>`}).join('')}</ul>
      <p class="diagnostic-note">The full setup requires its gates together. Continuation is a separate half-risk setup, available after 10:00 NY only while there have been no entries today.</p>
      <div class="indicator-scroll"><table><thead><tr><th>Frame</th><th>Close</th><th>Fast EMA</th><th>Slow EMA</th></tr></thead><tbody>
        ${Object.entries(d.indicators||{}).map(([frame,v])=>`<tr><th>${escapeHTML(frame)}</th><td>${v.ready?number(v.close):'Missing'}</td><td>${v.ready?number(v.fast):'—'}</td><td>${v.ready?number(v.slow):'—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="diagnostic-note">Reaction EMA20 ${number(d.ema_reaction)} · confirmation EMA20 ${number(d.ema_confirmation)}<br>
        Reaction ATR ${number(d.atr_reaction)} · confirmation ATR ${number(d.atr_confirmation)}${d.bos_level?'<br>Swing level '+number(d.bos_level)+' · '+escapeHTML(d.bos_bars_ago)+' bars before confirmation':''}
        ${d.mode==='rebound'?'<br>H4 break '+number(d.rebound_level)+' · protected level '+number(d.protected_level):''}</p>
    </details>
    <details data-detail="checks-${escapeHTML(robot.id)}"><summary>Recent M15 checks (${history.length})</summary>
      ${history.length?`<ol class="check-history">${history.slice(0,8).map(row=>`<li><time>${escapeHTML(time(row.payload?.at))}</time><b>${escapeHTML(row.payload?.decision)}</b><span>${escapeHTML(row.payload?.strategy?.reason)}</span></li>`).join('')}</ol>`:'<p class="diagnostic-empty">History starts when this EA version reports its first M15 check.</p>'}
      <small>Checks are retained for 30 days. Local MetaTrader logs also record each check while the office link is offline.</small>
    </details>
  </section>`;
}
