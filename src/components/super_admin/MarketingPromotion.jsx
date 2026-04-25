import React from 'react';
import '../../styles/super_admin/MarketingPromotion.css';
import '../../styles/admin/Tasks.css';
import { downloadCsv } from '../../utils/fileDownload';
import { getJson, postJson } from '../../api/http';

export default function MarketingPromotion() {
  const [campaigns, setCampaigns] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [dateRange, setDateRange] = React.useState('');

  const [selectedIds, setSelectedIds] = React.useState([]);
  const [activeCampaignId, setActiveCampaignId] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const loadCampaigns = React.useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const q = search.trim();
      const statusParam = statusFilter === 'all' ? '' : statusFilter;
      const data = await getJson(`/admin/marketing/campaigns?limit=300&status=${encodeURIComponent(statusParam)}&q=${encodeURIComponent(q)}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setCampaigns(items);
      if (!activeCampaignId && items[0]?.id) {
        setActiveCampaignId(items[0].id);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load campaigns');
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [activeCampaignId, search, statusFilter]);

  React.useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const filteredCampaigns = React.useMemo(() => {
    const now = Date.now();
    const maxDays = dateRange ? Number(dateRange) : 0;
    return campaigns.filter((c) => {
      const t = String(c?.type || '').toLowerCase();
      const st = String(c?.status || '').toLowerCase();
      const text = [c?.campaign, c?.channel, c?.audience, c?.goal].map((x) => String(x || '').toLowerCase()).join(' ');
      if (typeFilter && t !== typeFilter.toLowerCase()) return false;
      if (statusFilter && statusFilter !== 'all' && st !== statusFilter.toLowerCase()) return false;
      if (search.trim() && !text.includes(search.trim().toLowerCase())) return false;
      if (maxDays > 0) {
        const ts = Number(c?.updated_at || c?.created_at || 0) * 1000;
        if (!ts) return false;
        const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
        if (ageDays > maxDays) return false;
      }
      return true;
    });
  }, [campaigns, typeFilter, statusFilter, search, dateRange]);

  const activeCampaign = React.useMemo(
    () => filteredCampaigns.find((c) => String(c?.id) === String(activeCampaignId)) || filteredCampaigns[0] || null,
    [filteredCampaigns, activeCampaignId]
  );

  React.useEffect(() => {
    if (activeCampaign?.id) {
      setActiveCampaignId(activeCampaign.id);
      setNotes(String(activeCampaign.notes || ''));
    }
  }, [activeCampaign?.id]);

  const stats = React.useMemo(() => {
    const active = filteredCampaigns.filter((c) => String(c?.status || '').toLowerCase() === 'active').length;
    const drafts = filteredCampaigns.filter((c) => String(c?.status || '').toLowerCase() === 'draft').length;
    const scheduled = filteredCampaigns.filter((c) => String(c?.status || '').toLowerCase() === 'scheduled').length;
    const ended = filteredCampaigns.filter((c) => String(c?.status || '').toLowerCase() === 'ended').length;
    const reach = filteredCampaigns.reduce((sum, c) => {
      const raw = String(c?.performance || '0').toLowerCase().replace(/,/g, '').trim();
      const m = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*k/);
      if (m) return sum + Number(m[1]) * 1000;
      const n = Number(raw.replace(/[^0-9.]/g, '') || 0);
      return sum + n;
    }, 0);
    return { active, drafts, scheduled, ended, reach };
  }, [filteredCampaigns]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    const ids = filteredCampaigns.map((c) => c.id).filter(Boolean);
    setSelectedIds((prev) => (prev.length === ids.length ? [] : ids));
  };

  const createCampaign = async () => {
    try {
      setBusy(true);
      setError('');
      setNotice('');
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await postJson('/admin/marketing/campaigns', {
        campaign: `New Campaign ${stamp}`,
        type: 'Internal',
        channel: 'Banner',
        audience: 'All Users',
        status: 'Draft',
        goal: 'Increase engagement',
      });
      setNotice('New campaign created.');
      await loadCampaigns();
    } catch (e) {
      setError(e?.message || 'Failed to create campaign');
    } finally {
      setBusy(false);
    }
  };

  const runCampaignAction = async (id, action, payload = {}) => {
    await postJson(`/admin/marketing/campaigns/${encodeURIComponent(id)}/action`, { action, ...payload });
  };

  const runBulkAccept = async () => {
    if (selectedIds.length === 0) {
      setNotice('Select at least one campaign to run bulk action.');
      return;
    }
    try {
      setBusy(true);
      setError('');
      await Promise.all(selectedIds.map((id) => runCampaignAction(id, 'accept')));
      setNotice(`Bulk action completed for ${selectedIds.length} campaign(s).`);
      setSelectedIds([]);
      await loadCampaigns();
    } catch (e) {
      setError(e?.message || 'Failed to run bulk action');
    } finally {
      setBusy(false);
    }
  };

  const generateIdea = async () => {
    const id = activeCampaign?.id || selectedIds[0];
    if (!id) {
      setNotice('Select a campaign first to generate an idea.');
      return;
    }
    try {
      setBusy(true);
      const res = await postJson(`/admin/marketing/campaigns/${encodeURIComponent(id)}/action`, { action: 'generate_idea' });
      setNotice(res?.idea ? `AI idea: ${res.idea}` : 'AI idea generated.');
      await loadCampaigns();
    } catch (e) {
      setError(e?.message || 'Failed to generate idea');
    } finally {
      setBusy(false);
    }
  };

  const scheduleCampaign = async () => {
    if (!activeCampaign?.id) {
      setNotice('Select a campaign first.');
      return;
    }
    try {
      setBusy(true);
      await runCampaignAction(activeCampaign.id, 'schedule');
      setNotice('Campaign scheduled.');
      await loadCampaigns();
    } catch (e) {
      setError(e?.message || 'Failed to schedule campaign');
    } finally {
      setBusy(false);
    }
  };

  const acceptCampaign = async () => {
    if (!activeCampaign?.id) {
      setNotice('Select a campaign first.');
      return;
    }
    try {
      setBusy(true);
      await runCampaignAction(activeCampaign.id, 'accept');
      setNotice('Campaign activated.');
      await loadCampaigns();
    } catch (e) {
      setError(e?.message || 'Failed to activate campaign');
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    if (!activeCampaign?.id) {
      setNotice('Select a campaign first.');
      return;
    }
    try {
      setBusy(true);
      await runCampaignAction(activeCampaign.id, 'save_note', { notes });
      setNotice('Notes saved.');
      await loadCampaigns();
    } catch (e) {
      setError(e?.message || 'Failed to save notes');
    } finally {
      setBusy(false);
    }
  };

  const notifyCampaign = async () => {
    if (!activeCampaign?.id) {
      setNotice('Select a campaign first.');
      return;
    }
    try {
      setBusy(true);
      await runCampaignAction(activeCampaign.id, 'notify', {
        title: `Campaign update: ${activeCampaign.campaign || 'Marketing'}`,
        message: notes || 'Campaign details were updated.',
      });
      setNotice('Notification sent.');
    } catch (e) {
      setError(e?.message || 'Failed to notify users');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    const rows = filteredCampaigns.map((c) => ({
      campaign: c?.campaign || '',
      type: c?.type || '',
      channel: c?.channel || '',
      audience: c?.audience || '',
      status: c?.status || '',
      performance: c?.performance || '',
    }));
    downloadCsv('marketing_campaigns', rows, ['campaign', 'type', 'channel', 'audience', 'status', 'performance']);
  };

  return (
    <div className="mp-root">
      <header className="fp-header">
        <div className="fp-header-titles">
          <h2>Marketing & Promotions</h2>
        </div>
      </header>

      {error ? <div className="card" style={{ marginBottom: 12, borderColor: '#fecaca', background: '#fff1f2' }}>{error}</div> : null}
      {notice ? <div className="card" style={{ marginBottom: 12, borderColor: '#bfdbfe', background: '#eff6ff' }}>{notice}</div> : null}

      <div className="action-bar">
        <div className="action-left" style={{ width: '100%' }}>
          <div className="search-wrapper mp-search-wrapper" style={{ width: '100%' }}>
            <i className="fa-solid fa-magnifying-glass" />
            <input
              type="text"
              placeholder="Search"
              style={{ width: '100%' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="action-right fp-filters">
          <select className="sb-carrier-filter-select" aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Type</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>

          <select className="sb-carrier-filter-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="ended">Ended</option>
          </select>

          <select className="sb-carrier-filter-select" aria-label="Date Range" value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="">Date Range</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>

          <button className="btn small ghost-cd" type="button" onClick={loadCampaigns} disabled={loading || busy}>Refresh</button>
        </div>
      </div>

      <section className="mp-stats">
        <div className="mp-stat card"><div className="mp-num">{loading ? '—' : stats.active}</div><div className="mp-label">Active</div></div>
        <div className="mp-stat card"><div className="mp-num">{loading ? '—' : stats.drafts}</div><div className="mp-label">Drafts</div></div>
        <div className="mp-stat card"><div className="mp-num">{loading ? '—' : stats.reach.toLocaleString()}</div><div className="mp-label">Reach</div></div>
        <div className="mp-stat card"><div className="mp-num">{loading ? '—' : stats.scheduled}</div><div className="mp-label">Scheduled</div></div>
        <div className="mp-stat card"><div className="mp-num">{loading ? '—' : stats.ended}</div><div className="mp-label">Ended</div></div>
      </section>

      <div className="mp-actions-inline" style={{ marginBottom: '10px' }}>
        <button className="btn small-cd" onClick={createCampaign} disabled={busy}>+ New Campaign</button>
        <button className="btn small ghost-cd" onClick={runBulkAccept} disabled={busy}>Bulk</button>
        <button className="btn small ghost-cd" onClick={generateIdea} disabled={busy}>AI Suggest</button>
        <button className="btn small ghost-cd" type="button" onClick={handleExport}>Export</button>
      </div>

      <div className="ai-summary" style={{ marginBottom: '20px' }}>
        <div className="ai-summary-left">
          <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
          <div className="aai-text">
            <strong>AI Summary:</strong> {stats.active} active campaigns, {stats.drafts} drafts, {stats.scheduled} scheduled. Use AI Suggest to generate a campaign idea for the selected row.
          </div>
        </div>
        <div className="aai-actions">
          <button className="btn small ghost-cd" onClick={acceptCampaign} disabled={busy}><i className="fa fa-check" aria-hidden="true"></i> Accept</button>
          <button className="btn small ghost-cd" onClick={generateIdea} disabled={busy}>Generate Idea</button>
          <button className="btn small ghost-cd" onClick={scheduleCampaign} disabled={busy}>Schedule</button>
        </div>
      </div>

      <div className="mp-content">
        <main className="mp-main">
          <div className="mp-table-toolbar">
            <div className="left">Active Campaigns</div>
          </div>

          <div className="tasks-main" style={{ marginTop: '20px' }}>
            <div className="tasks-table-wrap">
              <table className="tasks-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}><input type="checkbox" checked={selectedIds.length > 0 && selectedIds.length === filteredCampaigns.length} onChange={toggleAll} /></th>
                    <th>Campaign</th>
                    <th>Type</th>
                    <th>Channel</th>
                    <th>Audience</th>
                    <th>Status</th>
                    <th>Performance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c) => (
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} /></td>
                      <td>{c.campaign}</td>
                      <td>{c.type}</td>
                      <td>{c.channel}</td>
                      <td>{c.audience}</td>
                      <td><span className={`int-status-badge ${String(c.status || '').toLowerCase()}`}>{c.status}</span></td>
                      <td>{c.performance || '-'}</td>
                      <td>
                        <button className="btn small ghost-cd" onClick={() => setActiveCampaignId(c.id)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <aside className="tasks-right">
              <div className="team-performance">
                <div className="field-row"><label>Name:</label><div className="muted">{activeCampaign?.campaign || '-'}</div></div>
                <div className="field-row"><label>Start Date:</label><div className="muted">{activeCampaign?.start_date || '-'}</div></div>
                <div className="field-row"><label>End Date:</label><div className="muted">{activeCampaign?.end_date || '-'}</div></div>
                <div className="field-row"><label>Budget:</label><div className="muted">{activeCampaign?.budget || '-'}</div></div>
                <div className="field-row"><label>Goal:</label><div className="muted">{activeCampaign?.goal || '-'}</div></div>

                <div style={{ marginTop: 12 }}>
                  <textarea className="text-area-mp" rows={4} placeholder="Notes..." style={{ width: '100%' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn small-cd" onClick={saveNotes} disabled={busy}>Save</button>
                  <button className="btn small ghost-cd" onClick={notifyCampaign} disabled={busy}>Notify</button>
                </div>
              </div>
            </aside>
          </div>

          <section className="mp-analytics-cards">
            <div className="analytic-card"><div className="num">{stats.reach.toLocaleString()}</div><div className="label">Estimated Reach</div></div>
            <div className="analytic-card"><div className="num">{stats.active}</div><div className="label">Active Campaigns</div></div>
            <div className="analytic-card"><div className="num">{stats.scheduled}</div><div className="label">Scheduled</div></div>
            <div className="analytic-card"><div className="num">{stats.drafts}</div><div className="label">Drafts</div></div>
          </section>

          <div className="mp-footer-note">Campaign data is now loaded from backend and filtered live with your search settings.</div>
        </main>
      </div>

      <div className="mp-last-line">
        <div className="muted">Last updated: {new Date().toLocaleString()}</div>
        <div className="muted">Showing {filteredCampaigns.length} campaign(s)</div>
      </div>
    </div>
  );
}
