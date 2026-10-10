// Read-only evidence presentation, shared by the latest report and snapshots.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const array = (value) => Array.isArray(value) ? value : [];
const LABELS = {
  usable: 'Usable evidence', partial: 'Partial evidence', limited: 'Limited evidence', unavailable: 'Unavailable',
  fresh: 'Fresh · within 6h', aging: 'Aging · 6–24h', stale: 'Stale', unknown: 'Time unverified',
  scheduled: 'Scheduled', elapsed: 'Event elapsed', current_week: 'Calendar dates available',
  aging_or_stale: 'No headline within 6h', empty: 'No usable items',
};
export function newsLink(item) {
  try {
    const url = new URL(item.url);
    const domains = ['forexfactory.com', 'investing.com', 'bloomberg.com', 'wsj.com'];
    return url.protocol === 'https:' && domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`)) ? url.href : null;
  } catch { return null; }
}
export function nyStamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'unknown';
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' NY';
}
function badge(value) {
  return `<span class="evidence-badge ${esc(value)}">${esc(LABELS[value] || value || 'unknown')}</span>`;
}
export function newsRow(item, calendar = false, historical = false) {
  const url = newsLink(item);
  const title = esc(item.title);
  // Legacy publication dates were not verified; do not relabel them as fresh.
  let freshness = item.freshness || (calendar ? 'scheduled' : 'unknown');
  if (!historical && !calendar && item.published_at && item.timestamp_quality === 'explicit_timezone') {
    const age = Date.now() - Date.parse(item.published_at);
    freshness = age < -300000 ? 'unknown' : age <= 21600000 ? 'fresh' : age <= 86400000 ? 'aging' : 'stale';
  }
  const stamp = calendar ? item.event_at : item.published_at;
  return `<li>
    <div class="news-item-top"><span class="news-meta">${esc(item.source)}${item.importance ? ` · ${esc(item.importance)} impact` : ''}</span>${badge(freshness)}</div>
    ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`}
    <span class="news-meta">${calendar ? 'Scheduled' : 'Published'} ${esc(nyStamp(stamp))}${historical ? ' · quality at scan' : ''}</span>
    ${item.relevance_reason ? `<small class="news-reason">${esc(item.relevance_reason)}</small>` : ''}
    ${!calendar && !stamp && item.timestamp_raw ? `<small class="news-meta">Publisher’s date: ${esc(item.timestamp_raw)} · ${item.timestamp_quality === 'timezone_unknown' ? 'time zone missing' : 'not verified'}</small>` : ''}
    ${item.fetched_at ? `<small class="news-meta">Fetched ${esc(nyStamp(item.fetched_at))}</small>` : ''}
  </li>`;
}
export function evidenceCard(status, historical = false) {
  const r = status.report;
  if (!r || typeof r !== 'object') return '<p class="viewonly">Evidence details will appear after the next server scan.</p>';
  const expired = !r.expires_at || Date.parse(r.expires_at) <= Date.now();
  const evidence = [...array(status.upcoming), ...array(status.headlines)];
  const citation = (key) => {
    const item = evidence.find((row) => row.item_key === key);
    const url = item && newsLink(item);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(item.title)}">${esc(item.source)} ↗</a>` : '';
  };
  return `<section class="analyst-evidence${expired && !historical ? ' expired' : ''}" aria-label="Research evidence">
    <div class="evidence-heading">${badge(r.evidence_quality)}<span class="evidence-validity">${historical ? 'Historical snapshot' : expired ? 'Expired · waiting for a scan' : 'Current snapshot'}</span></div>
    <h3>${esc(r.title)}</h3><p>${esc(r.summary)}</p>
    <div class="analyst-direction"><b>Gold direction: unknown</b><small>${esc(r.interpretation)}</small></div>
    <small class="news-meta">Generated ${esc(nyStamp(r.generated_at))} · expires ${esc(nyStamp(r.expires_at))}</small>
    ${array(r.observations).length ? `<ul class="evidence-observations">${r.observations.map((o) => `<li><b>${esc(o.claim)}</b><small>${esc(o.basis)}</small><div class="evidence-citations">${array(o.evidence_keys).map(citation).filter(Boolean).join(' · ')}</div></li>`).join('')}</ul>` : ''}
    ${array(r.warnings).length ? `<ul class="evidence-warnings">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <details data-detail="reassess-${historical ? esc(r.report_id) : 'current'}"><summary>When to reassess</summary><ul>${array(r.reassess_when).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>
    <small class="news-meta">${esc(r.method)}</small>
  </section>`;
}
export function sourceHealth(status) {
  const feeds = array(status.feeds);
  return `<section class="news-health" aria-label="Source health"><b>${esc(status.healthy_feeds ?? 0)}/${esc(status.total_feeds ?? 5)} feeds responded${status.provider_count ? ` · ${esc(status.provider_count)} providers` : ''}</b>
    <small>Availability and content age are measured separately, at the last scan.</small>
    <div>${feeds.map((f) => `<span class="source-chip ${f.ok ? 'ok' : 'bad'}" title="${esc(f.error || f.feed || '')}">${esc(f.source)} ${f.ok ? '✓' : '!'}</span>`).join('')}</div>
    <details data-detail="source-freshness"><summary>Source freshness and failures</summary>
      <ul class="source-details">${feeds.map((f) => `<li><div class="news-item-top"><b>${esc(f.source)}</b>${badge(f.freshness || 'unknown')}</div>
        <small>${esc(f.feed || f.feed_id || '')}</small>
        <small>${f.ok ? `Fetched ${esc(nyStamp(f.fetched_at))} · ${esc(f.count ?? 0)} items kept` : `Failed attempt ${esc(nyStamp(f.attempted_at))}: ${esc(f.error || 'unknown error')}`}</small>
        ${f.kind === 'calendar' ? `<small>Feed dates ${esc(nyStamp(f.coverage_start))} → ${esc(nyStamp(f.coverage_end))}</small>`
          : `<small>Newest verified publication ${esc(nyStamp(f.newest_published_at))} · ${esc(f.unknown_time_count ?? 0)} unverified times</small>`}
      </li>`).join('')}</ul>
    </details></section>`;
}
export function reportHistory(rows, loading, error) {
  if (loading) return '<p class="viewonly" role="status">Loading saved snapshots…</p>';
  if (error) return `<p class="warn">Could not load history: ${esc(error)}</p>`;
  if (!rows.length) return '<p class="viewonly">No saved evidence snapshots yet.</p>';
  return `<p class="viewonly">Latest ${rows.length} snapshots · kept for 30 days. Each shows the evidence available at that scan.</p>
    <div class="analyst-history">${rows.map((row) => `<details data-detail="history-${esc(row.report_id)}"><summary>${esc(nyStamp(row.generated_at))} · ${esc(LABELS[row.payload?.report?.evidence_quality] || 'unknown')}</summary>
      ${evidenceCard(row.payload || {}, true)}
      <section class="news-section"><h3>Evidence saved with this report</h3><ol>${[...array(row.payload?.upcoming).slice(0, 2), ...array(row.payload?.headlines).slice(0, 3)].map((item) => newsRow(item, item.kind === 'calendar', true)).join('')}</ol></section>
    </details>`).join('')}</div>`;
}
