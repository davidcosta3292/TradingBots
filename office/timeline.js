// Display captured evidence only. No inference here can authorize an order.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ny = (v) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', {timeZone:'America/New_York',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' NY' : 'Time unavailable'; };
const num = (v, digits=2) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
const LABELS = {decision:'Strategy check',submission:'MT5 order call',response:'Order response',fill:'Broker fill',order_state:'Broker order history',exit:'Exit deal',telemetry:'Telemetry issue'};
const STATE = {waiting:'Waiting for setup',blocked:'Entry blocked',ready:'Entry eligible',submitted:'Order call started',accepted:'Accepted · fill unconfirmed',rejected:'Order rejected',unknown:'Outcome unknown',filled:'Fill received',order_filled:'Order marked filled · deal unverified',canceled:'Order canceled',expired:'Order expired',closed:'Exit deal received',reversed:'Reversal deal received',invalid:'Telemetry incomplete'};
const tone = (s) => s==='filled' ? 'good' : ['rejected','invalid'].includes(s) ? 'bad' : ['accepted','unknown','ready','submitted','order_filled'].includes(s) ? 'pending' : 'muted';
const stamp = (e) => Date.parse(e.occurred_at)||0;
const phase = (e) => ({decision:0,submission:1,response:2,order_state:3,fill:4,exit:5}[e.kind] ?? 6);

function checkStage(check) {
  if(check?.order_eligible) return 'ready';
  if(check?.position_free===false || check?.signal_ready===true) return 'blocked';
  return 'waiting';
}
function outcome(events,check) {
  if(events.some(e=>e.kind==='exit')) return events.findLast(e=>e.kind==='exit').stage;
  if(events.some(e=>e.kind==='fill')) return 'filled';
  const order=events.findLast(e=>e.kind==='order_state' && ['canceled','expired','rejected'].includes(e.stage));
  if(order) return order.stage;
  const response=events.findLast(e=>e.kind==='response');
  if(response) return response.stage;
  const submission=events.findLast(e=>e.kind==='submission');
  if(submission) return submission.stage;
  if(events.some(e=>e.stage==='order_filled')) return 'order_filled';
  return checkStage(check);
}
function eventDetail(e,currency) {
  const p=e.payload||{}, sizing=p.sizing;
  if(e.kind==='submission') return `${esc(p.side?.toUpperCase()||'')} ${sizing ? num(sizing.calculated_volume,4)+' lots · quote '+num(sizing.entry)+' · stop '+num(sizing.stop)+' · target '+num(sizing.target) : ''}${p.message ? '<br>'+esc(p.message) : ''}<br><small>Started locally; server receipt and execution need separate evidence.</small>`;
  if(e.kind==='response') return `${esc(p.message||'No broker message')}<br>Return code ${esc(p.retcode ?? '—')} · external ${esc(p.retcode_external ?? '—')} · request ${esc(p.request_id ?? '—')}${p.order_ticket && p.order_ticket!=='0' ? '<br>Order '+esc(p.order_ticket) : ''}${p.deal_ticket && p.deal_ticket!=='0' ? ' · reported deal '+esc(p.deal_ticket) : ''}${e.entry_point==='CTrade' ? '<br>Call '+(p.call_ok?'returned true':'returned false')+' · terminal error '+esc(p.terminal_error ?? '—')+' · '+num(typeof p.duration_us==='number'?p.duration_us/1000:null,1)+' ms' : ''}`;
  if(e.kind==='fill' || e.kind==='exit') return `${esc(p.side?.toUpperCase()||'')} ${num(p.volume,4)} lots @ ${num(p.price)}<br>Deal ${esc(p.deal_ticket||'—')} · order ${esc(p.order_ticket||'—')} · position ${esc(p.position_id||'—')}${e.kind==='exit' ? '<br>'+esc(p.reason||'Close reason unavailable')+' · booked P&L '+num(typeof p.profit==='number'?p.profit+(p.commission||0)+(p.swap||0):null)+' '+esc(currency) : ''}${p.recovered ? '<br><small>Recovered from broker history after restart.</small>' : ''}`;
  if(e.kind==='order_state') return `Order ${esc(p.order_ticket||'—')} · ${esc(STATE[e.stage]||e.stage)}`;
  return esc(p.message||'Details unavailable');
}
function eventRow(e,currency) {
  return `<li><i class="timeline-dot ${tone(e.stage)}" aria-hidden="true"></i><div><b>${esc(LABELS[e.kind]||e.kind)} <span class="timeline-state ${tone(e.stage)}">${esc(e.kind==='response' && e.stage==='accepted' ? 'Accepted (response only)' : STATE[e.stage]||e.stage)}</span></b><time>${esc(ny(e.occurred_at))} · ${esc(e.entry_point)}</time><p>${eventDetail(e,currency)}</p></div></li>`;
}
function chain(group,robot,currency) {
  const c=group.check, events=group.events.sort((a,b)=>stamp(a)-stamp(b)||phase(a)-phase(b)||String(a.event_id).localeCompare(String(b.event_id)));
  const state=outcome(events,c), attempts=new Map();
  for(const e of events) { const key=e.attempt_id||'unavailable'; const list=attempts.get(key)||[]; list.push(e); attempts.set(key,list); }
  const decisionTime=c?.checked_at ? new Date(c.checked_at*1000).toISOString() : group.bar;
  const sizing=c?.sizing;
  const isLegacy=c && !c.check_id;
  const knownOrder=events.some(e=>e.kind==='submission' && e.stage==='submitted');
  const response=events.some(e=>e.kind==='response');
  const fill=events.some(e=>e.kind==='fill');
  return `<details class="timeline-check" data-detail="timeline-${esc(robot.id)}-${esc(group.id)}"><summary><span><time>${esc(ny(group.bar))}</time><b>${esc(STATE[state]||state)}</b></span><span class="timeline-state ${tone(state)}">${esc(group.version)}</span></summary>
    <div class="timeline-path" aria-label="Execution evidence"><span class="${c?'known':''}">Check</span><i>›</i><span class="${knownOrder?'known':''}">Order call</span><i>›</i><span class="${response?'known':''}">Response</span><i>›</i><span class="${fill?'known':''}">Fill</span></div>
    <ol class="timeline-steps"><li><i class="timeline-dot muted" aria-hidden="true"></i><div><b>Strategy check</b><time>${esc(ny(decisionTime))} · OnNewBar</time><p>${esc(c?.decision||'Check snapshot unavailable for this linked broker event.')}${c?.strategy?.reason ? '<br>'+esc(c.strategy.reason) : ''}</p>
      ${c ? `<small>Signal ${c.signal_ready?'ready':'not ready'} · permission ${c.operational_permission?'allowed':'blocked'} · position ${c.position_free?'free':'occupied'}</small>` : ''}
      ${sizing?.available ? `<dl class="timeline-sizing"><div><dt>Decision quote</dt><dd>${num(sizing.entry)}</dd></div><div><dt>Stop / target</dt><dd>${num(sizing.stop)} / ${num(sizing.target)}</dd></div><div><dt>Risk budget</dt><dd>${num(sizing.risk_budget)} ${esc(currency)}</dd></div><div><dt>Minimum-lot risk</dt><dd>${num(sizing.minimum_lot_risk)} ${esc(currency)}</dd></div><div><dt>Stop distance</dt><dd>${num(sizing.stop_distance)} $/oz</dd></div><div><dt>Calculated lots</dt><dd>${num(sizing.calculated_volume,4)}</dd></div></dl>` : ''}
      ${c?.blocks?.length ? '<p>'+c.blocks.map(esc).join('<br>')+'</p>' : ''}</div></li></ol>
    ${isLegacy ? '<p class="timeline-note">Older EA check: no execution correlation was captured. No order outcome is inferred.</p>' : ''}
    ${!events.length && !isLegacy ? '<p class="timeline-note">'+(c?.order_eligible ? 'No linked order call has been received. Its outcome is unverified.' : 'No linked order call recorded for this check.')+'</p>' : ''}
    ${[...attempts].map(([id,rows])=>`<div class="timeline-attempt"><small>Attempt ${esc(id==='unavailable'?'unavailable':id.split('/').at(-1))}</small><ol class="timeline-steps">${rows.map(e=>eventRow(e,currency)).join('')}</ol></div>`).join('')}
    ${['accepted','submitted','unknown','order_filled'].includes(state) ? '<p class="timeline-note">A response is not a confirmed fill. Check MT5 deals before taking action; this office does not retry the order.</p>' : ''}
    ${fill ? '<p class="timeline-note">Each fill shows one actual deal, which may be a partial fill. Exit deals may also close only part of a position; open positions are shown separately above.</p>' : ''}
    <small class="timeline-id">Check ${esc(group.id)}</small>
  </details>`;
}
export function decisionTimeline(robot,checks=[],events=[],load={},demo=false) {
  const s=robot.status||{}, groups=new Map();
  const currency=/^[A-Z]{3}$/.test(s.currency||'')?s.currency:'USD';
  const allChecks=[...checks,...events.filter(e=>e.kind==='decision' && e.payload?.check).map(e=>({version:e.version,bar_at:e.bar_at,payload:e.payload.check}))];
  if(s.strategy_check?.at && !allChecks.some(r=>r.payload?.at===s.strategy_check.at && r.version===s.strategy_check.version)) allChecks.push({version:s.strategy_check.version,bar_at:new Date(s.strategy_check.at*1000).toISOString(),payload:s.strategy_check});
  for(const row of allChecks) { const c=row.payload; if(!c?.at) continue; const id=c.check_id||`${row.version}/${c.at}`; groups.set(id,{id,version:row.version,bar:row.bar_at,check:c,events:[]}); }
  const unlinked=[];
  for(const e of events) {
    if(e.kind==='decision') continue;
    if(!e.check_id) { unlinked.push(e); continue; }
    const g=groups.get(e.check_id)||{id:e.check_id,version:e.version,bar:e.bar_at,check:null,events:[]};
    g.events.push(e); groups.set(e.check_id,g);
  }
  const sorted=[...groups.values()].sort((a,b)=>Date.parse(b.bar)-Date.parse(a.bar));
  // Keep recent actual order attempts visible even after many waiting checks.
  const chosen=[...new Set([...sorted.slice(0,4),...sorted.filter(g=>g.events.length).slice(0,4)])].sort((a,b)=>Date.parse(b.bar)-Date.parse(a.bar));
  const health=s.telemetry;
  return `<section class="decision-timeline" aria-label="Trade decision timeline"><header><div><h3>Trade decision timeline</h3><p>Check → order call → response → fill</p></div>${demo?'<span class="timeline-sample">Sample data</span>':''}</header>
    ${health?.error || health?.gaps ? '<p class="warn">'+esc(health.error||'Telemetry gap detected')+' · gaps '+esc(health.gaps ?? 0)+'</p>' : ''}
    ${health?.pending ? '<p class="timeline-note">The last robot report had queued telemetry; the next successful report may add earlier events.</p>' : ''}
    <button type="button" class="timeline-load" data-load-timeline="${esc(robot.id)}"${load.loading?' disabled':''}>${load.loading?'Loading timeline…':load.loaded?'Refresh execution history':'Load execution history'}</button>
    ${load.error ? '<p class="warn">Could not load execution history: '+esc(load.error)+'</p>' : ''}
    ${chosen.length ? chosen.map(g=>chain(g,robot,currency)).join('') : '<p class="timeline-note">Timeline starts after EA 1.3.1 reports its first M15 decision.</p>'}
    ${unlinked.length ? `<details data-detail="unlinked-${esc(robot.id)}"><summary>Unlinked broker or telemetry events (${unlinked.length})</summary><p class="timeline-note">Correlation unavailable. These events are not assigned to a nearby strategy check.</p><ol class="timeline-steps">${unlinked.slice().sort((a,b)=>stamp(b)-stamp(a)).slice(0,8).map(e=>eventRow(e,currency)).join('')}</ol></details>` : ''}
    <p class="timeline-note">New York time · 30-day database retention. Recent checks and up to four recent order attempts are shown. No outcome is inferred from missing telemetry.</p></section>`;
}
