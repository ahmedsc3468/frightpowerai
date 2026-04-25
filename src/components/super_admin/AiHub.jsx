import React, { useEffect, useMemo, useState } from 'react';
import '../../styles/super_admin/AiHub.css';
import '../../styles/admin/Tasks.css';
import { getIdToken } from 'firebase/auth';
import { auth } from '../../firebase';
import { API_URL } from '../../config';

export default function AiHub(){
  const defaultAgents = [
    {name:'ComplianceBot', module:'Document Vault', status:'Active', updated:'2h ago'},
    {name:'OnboardingAI', module:'Hiring Module', status:'Active', updated:'1h ago'},
    {name:'SupportChat', module:'Support Hub', status:'Training', updated:'6h ago'},
    {name:'InsightsAI', module:'Reports', status:'Active', updated:'30m ago'}
  ];

  const defaultIntegrations = [
    {title:'FMCSA API', subtitle:'Carrier verification', status:'Active'},
    {title:'Geometris ELD', subtitle:'Live GPS data', status:'Active'},
    {title:'Gmail', subtitle:'Message parsing', status:'Warning'},
    {title:'QuickBooks', subtitle:'Invoice sync', status:'Offline'}
  ];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agents] = useState(defaultAgents);
  const [integrations, setIntegrations] = useState(defaultIntegrations);
  const [healthPercent, setHealthPercent] = useState(85);
  const [openTickets, setOpenTickets] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);

  const loadAiHubData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setLoading(true);
      setError('');
      const token = await getIdToken(user);
      const res = await fetch(`${API_URL}/admin/system/diagnose`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load AI health data');

      const data = await res.json();
      setHealthPercent(Number(data?.overall_status_percent || 85));
      setOpenTickets(Number(data?.open_tickets || 0));

      const map = data?.integrations && typeof data.integrations === 'object' ? data.integrations : {};
      const rows = Object.entries(map).map(([name, value]) => {
        const raw = String(value || '').toLowerCase();
        const status = raw === 'up' ? 'Active' : (raw === 'degraded' ? 'Warning' : 'Offline');
        return {
          title: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          subtitle: 'Platform integration',
          status,
        };
      });

      if (rows.length > 0) {
        setIntegrations(rows);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load AI Hub data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAiHubData();
  }, []);

  const activeIntegrations = useMemo(
    () => integrations.filter((i) => String(i.status || '').toLowerCase() === 'active').length,
    [integrations]
  );

  const addAiAgent = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setActionBusy(true);
      const token = await getIdToken(user);
      const payload = {
        name: `Agent ${new Date().toISOString().slice(11, 19)}`,
        module: 'AI Hub',
        status: 'Active',
      };
      const res = await fetch(`${API_URL}/admin/ai/agents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to add AI agent');
      await loadAiHubData();
    } catch (e) {
      setError(e?.message || 'Failed to add AI agent');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="aihub-root">
        <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>FREIGHTPOWER AI — AI HUB</h2></div>
      </header>
      <div className="tasks-actions" style={{marginBottom: '20px'}}>
          <button className="btn small-cd" onClick={addAiAgent} disabled={actionBusy}><i className='fas fa-add'></i>Add AI Agent</button>
          <button className="btn small ghost-cd" onClick={loadAiHubData}><i className='fas fa-heartbeat'></i>Health Check</button>
          <button className="btn ghost-cd small" onClick={loadAiHubData}><i className='fas fa-sync'></i>Sync Integrations</button>
        </div>

      {error ? (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fecaca', background: '#fff1f2' }}>
          <div style={{ fontWeight: 700 }}>AI Hub data unavailable</div>
          <div className="muted">{error}</div>
        </div>
      ) : null}

      <section className="ai-stats-row">
        <div className="ai-stat"> <div><div className="stat-num">{agents.length}</div><div className="stat-label">Configured AI Agents</div></div><div><i className="fas fa-robot"></i></div></div>
        <div className="ai-stat"> <div><div className="stat-num">{loading ? '—' : `${healthPercent}%`}</div><div className="stat-label">Automation Health</div></div><div><i className="fas fa-cogs"></i></div></div>
        <div className="ai-stat"> <div><div className="stat-num">{loading ? '—' : openTickets}</div><div className="stat-label">Open Support Tickets</div></div><div><i className="fas fa-comments"></i></div></div>
        <div className="ai-stat"> <div><div className="stat-num">{loading ? '—' : Math.max(0, integrations.length - activeIntegrations)}</div><div className="stat-label">Issues Detected</div></div><div><i className="fas fa-exclamation-triangle"></i></div></div>
        <div className="ai-stat"> <div><div className="stat-num">{activeIntegrations}</div><div className="stat-label">Connected Integrations</div></div><div><i className="fas fa-link"></i></div></div>
      </section>

      <div className="ai-content">
        <main className="ai-main">
          <div className="ai-table-card">
            <h3 className="heading-sa-ai">AI Agents</h3>
            <div className="ai-table-wrap tasks-table-wrap">
              <table className="tasks-table">
                <thead>
                  <tr><th>Agent Name</th><th>Connected Module</th><th>Status</th><th>Last Updated</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.name}>
                      <td className="sa-agent-name">{a.name}</td>
                      <td>{a.module}</td>
                      <td><span className={`int-status-badge ${a.status.toLowerCase() === 'active' ? 'active' : a.status.toLowerCase() === 'training' ? 'warning' : 'inactive'}`}>{a.status}</span></td>
                      <td>{a.updated}</td>
                      <td><i className="fas fa-ellipsis-h"></i></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="integrations-snap" style={{marginTop: '20px'}}>
            <h4 className="heading-sa-ai">Integrations Snapshot</h4>
            <div className="integrationss-grid">
              {integrations.map(i => (
                <div className="integrationss-card" key={i.title}>
                  <div className="integrationss-title">{i.title}</div>
                  <div className="integrationss-sub muted">{i.subtitle}</div>
                  <div className='badge-display'><div className={` int-status-badge  ${i.status.toLowerCase() === 'active' ? 'active' : i.status.toLowerCase() === 'warning' ? 'warning' : 'inactive'}`}>{i.status}</div></div>
                </div>
              ))}
            </div>
          </div>
        </main>

        <aside className="tasks-right">
            <div className="team-performance">
            <h4 style={{fontWeight: '700', fontSize: '16px'}}>AI Assistant</h4>
            <div>
                <div className="ai-card-content">
                  <div>
                    <div className="ai-line"><strong>Summary <br /></strong> 2 AI agents need retraining (SupportChat, RateBot)</div>
                    <a className="ai-action">Run Quick Fix →</a>
                  </div>
                </div>
            </div>
          </div>
          <div className="team-performance">
            <h4 style={{fontWeight: '700'}}>AI health Meter</h4>
            <div className="tp-row"><div className="tp-label">Live</div><div className="tp-value">{healthPercent}%</div></div>
            <div className="tp-progress"><div className="tp-fill" style={{width:`${healthPercent}%`}}/></div>
            <div className="tp-row"><div className="tp-label">Lag</div><div className="tp-value">{Math.max(0, 100 - healthPercent - 3)}%</div></div>
            <div className="tp-progress"><div className="tp-fill" style={{width:`${Math.max(0, 100 - healthPercent - 3)}%`}}/></div>
            <div className="tp-row"><div className="tp-label">Error</div><div className="tp-value">3%</div></div>
            <div className="tp-progress"><div className="tp-fill" style={{width:'3%'}}/></div>
          </div>
          <div className="team-performance">
            <h4 style={{fontWeight: '700'}}>Recent Alerts</h4>
            <div className="ai-line"><i className="fa-solid fa-circle" style={{fontSize: '8px', marginRight:'10px'}} ></i>Integration delay from FMCSA feed.</div>
            <div className="ai-line" style={{marginTop: '5px'}}><i className="fa-solid fa-circle" style={{fontSize: '8px', marginRight:'10px'}} ></i>SupportChat training timeout.</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
