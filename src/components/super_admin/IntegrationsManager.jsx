import React, { useEffect, useMemo, useState } from 'react';
import '../../styles/super_admin/IntegrationsManager.css';
import '../../styles/admin/Tasks.css';
import { getIdToken } from 'firebase/auth';
import { auth } from '../../firebase';
import { API_URL } from '../../config';

export default function IntegrationsManager(){
  const defaultIntegrations = [
    {name:'FMCSA API', type:'Compliance', module:'Carriers', status:'Active', last:'1h ago'},
    {name:'Geometris ELD', type:'Telematics', module:'Drivers', status:'Active', last:'2h ago'},
    {name:'QuickBooks', type:'Accounting', module:'Billing', status:'Warning', last:'3h ago'},
    {name:'Gmail', type:'Messaging', module:'Communication', status:'Offline', last:'Oct 15'},
    {name:'Google Maps', type:'Tracking', module:'Fleet View', status:'Active', last:'25m ago'},
    {name:'SMS Gateway', type:'Notifications', module:'Messaging', status:'Active', last:'15m ago'}
  ];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [healthPercent, setHealthPercent] = useState(96);
  const [integrations, setIntegrations] = useState(defaultIntegrations);
  const [actionBusy, setActionBusy] = useState(false);

  const loadIntegrationData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setLoading(true);
      setError('');
      const token = await getIdToken(user);

      const [diagnoseRes, calendarRes] = await Promise.all([
        fetch(`${API_URL}/admin/system/diagnose`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/calendar/status`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      let liveRows = [];

      if (diagnoseRes.ok) {
        const d = await diagnoseRes.json();
        const integrationMap = d?.integrations && typeof d.integrations === 'object' ? d.integrations : {};
        setHealthPercent(Number(d?.overall_status_percent || 96));

        Object.entries(integrationMap).forEach(([key, value]) => {
          const raw = String(value || '').toLowerCase();
          const status = raw === 'up' ? 'Active' : (raw === 'degraded' ? 'Warning' : 'Offline');
          liveRows.push({
            name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            type: 'System',
            module: 'Platform',
            status,
            last: 'Now',
          });
        });
      }

      if (calendarRes.ok) {
        const c = await calendarRes.json();
        const toStatus = (connected) => (connected ? 'Active' : 'Offline');
        liveRows.push(
          {
            name: 'Google Calendar',
            type: 'Calendar',
            module: 'Scheduling',
            status: toStatus(Boolean(c?.google?.connected)),
            last: c?.google?.updated_at ? 'Recently' : 'N/A',
          },
          {
            name: 'Outlook Calendar',
            type: 'Calendar',
            module: 'Scheduling',
            status: toStatus(Boolean(c?.outlook?.connected)),
            last: c?.outlook?.updated_at ? 'Recently' : 'N/A',
          }
        );
      }

      if (liveRows.length > 0) {
        setIntegrations(liveRows);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load integration status');
      setIntegrations(defaultIntegrations);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrationData();
  }, []);

  const totals = useMemo(() => {
    const total = integrations.length;
    const active = integrations.filter((i) => String(i.status || '').toLowerCase() === 'active').length;
    const warnings = integrations.filter((i) => String(i.status || '').toLowerCase() === 'warning').length;
    const offline = integrations.filter((i) => String(i.status || '').toLowerCase() === 'offline').length;
    return { total, active, warnings, offline };
  }, [integrations]);

  const registerIntegration = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setActionBusy(true);
      const token = await getIdToken(user);
      const payload = {
        name: `Custom Integration ${new Date().toISOString().slice(0, 19)}`,
        type: 'Custom',
        module: 'Platform',
      };
      const res = await fetch(`${API_URL}/admin/integrations/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to add integration');
      setNotice('Integration registered.');
      await loadIntegrationData();
    } catch (e) {
      setError(e?.message || 'Failed to add integration');
    } finally {
      setActionBusy(false);
    }
  };

  const viewLogs = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setActionBusy(true);
      const token = await getIdToken(user);
      const res = await fetch(`${API_URL}/admin/integrations/logs?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load integration logs');
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length === 0) {
        window.alert('No integration logs found yet.');
        return;
      }
      const lines = items.slice(0, 5).map((it) => `- ${it.message || it.action || 'Log entry'}`);
      window.alert(`Recent Integration Logs\n\n${lines.join('\n')}`);
    } catch (e) {
      setError(e?.message || 'Failed to view integration logs');
    } finally {
      setActionBusy(false);
    }
  };

  const runAiFix = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setActionBusy(true);
      setError('');
      setNotice('');
      const token = await getIdToken(user);
      const res = await fetch(`${API_URL}/admin/integrations/auto-fix`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to run AI fix');
      const data = await res.json();
      setNotice(`AI fix completed. Updated ${Number(data?.fixed_count || 0)} integration(s).`);
      await loadIntegrationData();
    } catch (e) {
      setError(e?.message || 'Failed to run AI fix');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="int-root">
      <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>Integration Manager</h2></div>
      </header>

      <section className="int-stats-row">
        <div className="int-stat"><div className="int-num">{loading ? '—' : totals.total}</div><div className="int-label">Total Integrations</div></div>
        <div className="int-stat"><div className="int-num">{loading ? '—' : totals.active}</div><div className="int-label">Active Connections</div></div>
        <div className="int-stat"><div className="int-num">{loading ? '—' : totals.warnings}</div><div className="int-label">Warnings</div></div>
        <div className="int-stat"><div className="int-num">{loading ? '—' : totals.offline}</div><div className="int-label">Offline</div></div>
        <div className="int-stat"><div className="int-num">{loading ? '—' : `${healthPercent}%`}</div><div className="int-label">System Health</div></div>
      </section>

      {error ? (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fecaca', background: '#fff1f2' }}>
          <div style={{ fontWeight: 700 }}>Integration status unavailable</div>
          <div className="muted">{error}</div>
        </div>
      ) : null}
      {notice ? (
        <div className="card" style={{ marginBottom: 16, borderColor: '#bfdbfe', background: '#eff6ff' }}>
          <div className="muted">{notice}</div>
        </div>
      ) : null}

      <div className="int-card">
        <div className="int-card-row">
          <h3 className="heading-sa-ai">Integration Management</h3>
        </div>

        <div className="int-table-wrap tasks-table-wrap">
          <table className="tasks-table">
            <thead>
              <tr><th>Integration</th><th>Type</th><th>Connected Module</th><th>Status</th><th>Last Sync</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {integrations.map(i => (
                <tr key={i.name}>
                  <td className="sa-agent-name">{i.name}</td>
                  <td>{i.type}</td>
                  <td>{i.module}</td>
                  <td><span className={`int-status-badge ${i.status.toLowerCase()}`}>{i.status}</span></td>
                  <td>{i.last}</td>
                  <td><i className="fas fa-ellipsis-h"></i></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ai-summary">
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"> System Health <strong>{healthPercent}%</strong> <br />AI Insight: Platform integration diagnostics are now live from backend status.</div>
              </div>
              <div className="aai-actions">
                <button className="btn small ghost-cd" onClick={loadIntegrationData}><i className="fa fa-check" aria-hidden="true"></i> Run System Health Check</button>
              </div>
            </div>

        <div className="int-footer-actions">
          <button className="btn small-cd" onClick={registerIntegration} disabled={actionBusy}><i className="fas fa-plus"></i> Add Integration</button>
          <button className="btn ghost-cd small" onClick={loadIntegrationData}><i className="fas fa-sync"></i> Sync All</button>
          <button className="btn small ghost-cd" onClick={viewLogs} disabled={actionBusy}><i className="fas fa-file"></i> View Logs</button>
          <button className="btn small ghost-cd" onClick={runAiFix} disabled={actionBusy}><i className="fas fa-brain"></i> Run AI Fix</button>
        </div>
      </div>
    </div>
  )
}
