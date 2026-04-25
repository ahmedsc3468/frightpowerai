import React from 'react';
import '../../styles/admin/HiringOnboarding.css';
import '../../styles/admin/Tasks.css';
import AdminShared, { PulsePanel } from './AdminShared';
import { getJson, postJson } from '../../api/http';

export default function HiringOnboarding(){
  const stats = [
    { label: 'External Onboardings', value: 32 , icon: 'fa-solid fa-building'},
    { label: 'Internal Hires', value: 6 , icon: 'fa-solid fa-users'},
    { label: 'Missing Documents', value: 14 , icon: 'fa-solid fa-file'},
    { label: 'Pending Signatures', value: 9 , icon: 'fa-solid fa-signature'},
    { label: 'Avg Completion', value: '2.3' , icon: 'fa-solid fa-clock'},
    { label: 'Unread Messages', value: 7 , icon: 'fa-solid fa-envelope'}
  ];

  const [rows, setRows] = React.useState([]);

  const [tab, setTab] = React.useState('all');

  const loadRows = React.useCallback(async () => {
    try {
      const data = await getJson('/admin/hiring/onboardings?limit=200');
      const items = Array.isArray(data?.items) ? data.items : [];
      setRows(items.map((r) => ({
        ...r,
        missing: Number(r?.missing || 0) > 0 ? `${Number(r.missing)} missing` : '0',
      })));
    } catch (e) {
      setRows([]);
      alert(e?.message || 'Failed to load onboarding records');
    }
  }, []);

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  const doAction = async (id, action) => {
    try {
      const payload = action === 'assign' ? { action, assigned: 'Operations' } : { action };
      await postJson(`/admin/hiring/onboardings/${encodeURIComponent(id)}/action`, payload);
      await loadRows();
    } catch (e) {
      alert(e?.message || `Failed to ${action}`);
    }
  };

  return (
    <div className="admin-hiring-root fp-dashboard-root">
      <div className="ai-summary">
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Summary:</strong> 15 onboardings in progress — 3 missing signatures, 2 inactive, 10 near completion <br /> <span style={{marginTop: '10px', fontWeight: '600'}}>Document Vault • Messaging Center • Compliance Tracker</span> </div>
              </div>
              <button className="btn small-cd" type="button" onClick={loadRows}><i className="fa fa-add" aria-hidden="true"></i> New Onboarding</button>
            </div>

      <section className="sstat-row" style={{marginTop: '20px'}}>
        {stats.map((s, i) => (
          <div className="sstat-card card" key={i}>
            <div>
            <div className="sstat-label">{s.label}</div>
            <div className="sstat-value">{s.value}</div>
            </div>
            <div>
                <i className={s.icon}></i>
            </div>
          </div>
        ))}
      </section>

      <div className="tasks-main" style={{marginTop: '12px'}}>
        <div className="tasks-table-wrap">
          <div className="tabs" style={{marginBottom: '10px', marginLeft: '20px'}}>
            <button className={`tab ${tab==='all' ? 'active' : ''}`} onClick={() => setTab('all')}>All</button>
            <button className={`tab ${tab==='carriers' ? 'active' : ''}`} onClick={() => setTab('carriers')}>Carriers</button>
            <button className={`tab ${tab==='drivers' ? 'active' : ''}`} onClick={() => setTab('drivers')}>Drivers</button>
            <button className={`tab ${tab==='internal' ? 'active' : ''}`} onClick={() => setTab('internal')}>Internal</button>
          </div>

          <div className="uo-table-wrap">
            <table className="tasks-table onboarding-tasks-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name / Company</th>
                  <th>Role</th>
                  <th>Assigned To</th>
                  <th>Missing Docs</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter(r => {
                  if(tab === 'all') return true;
                  if(tab === 'carriers') return r.type === 'Carrier';
                  if(tab === 'drivers') return r.type === 'Driver';
                  if(tab === 'internal') return r.type === 'Internal';
                  return true;
                }).map((r, i) => (
                  <tr key={i} className="task-row">
                    <td><span className={`type-badge`}>{r.type}</span></td>
                    <td className="task-title">
                      <div style={{fontWeight:700}}>{r.name}</div>
                      <div style={{fontSize:12, color:'#9aa4b2'}}>DOT: 3847562</div>
                    </td>
                    <td>{r.role}</td>
                    <td>{r.assigned}</td>
                    <td><span className="hi">{r.missing}</span></td>
                    <td><span className={`int-status-badge ${r.status === 'Active' ? 'in-progress' : r.status === 'Pending' ? 'revoked' : 'resolved'}`}>{r.status}</span></td>
                    <td>
                      <div className="progress" style={{width:100, height:8, background:'rgba(163, 163, 163, 1)', borderRadius:8}}>
                        <div className="progress-fill" style={{width:`${r.progress}%`, height:8, borderRadius:8}} />
                      </div>
                    </td>
                    <td>Oct {10 + i}</td>
                    <td><div className="task-actions"><button className="card-action" type="button" onClick={() => doAction(r.id, 'assign')}>Assign</button> <button className="card-action" type="button" onClick={() => doAction(r.id, 'complete')}>Complete</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="tasks-right">
          <div className="team-performance">
            <h4 style={{fontWeight: '700', fontSize: '16px'}}>AI Assistant</h4>
            <div>
                <div className="ai-card-content">
                  <div>
                    <div className="ai-line">Suggestion: Auto-assign new driver applications to Koshin</div>
                    <a className="ai-action">Apply rule →</a>
                  </div>
                </div>
                <div className="ai-card-content" style={{marginTop: '10px'}}>
                  <div>
                    <div className="ai-line">Suggestion: Auto-assign new driver applications to Koshin</div>
                    <a className="ai-action">Apply rule →</a>
                  </div>
                </div>
                <div className="ai-card-content" style={{marginTop: '10px'}}>
                  <div>
                    <div className="ai-line">Suggestion: Auto-assign new driver applications to Koshin</div>
                    <a className="ai-action">Apply rule →</a>
                  </div>
                </div>
            </div>
          </div>
          <div className="card recent-messages" style={{marginTop:18, border: '1px solid transparent'}}>
                <div className="card-row"><h3>Recent Messages</h3></div>
                <ul className="recent-list">
                  <li className="msg-item"><img className="msg-avatar" src="https://randomuser.me/api/portraits/women/65.jpg" alt="sarah" /><div className="msg-body"><div className="msg-head"><strong>Sarah Johnson</strong> <span className="muted">New carrier registration approved</span></div><div className="muted">15 min ago</div></div></li>
                  <li className="msg-item"><img className="msg-avatar" src="https://randomuser.me/api/portraits/men/32.jpg" alt="mike" /><div className="msg-body"><div className="msg-head"><strong>Mike Davis</strong> <span className="muted">Document verification needed</span></div><div className="muted">1 hour ago</div></div></li>
                </ul>
                <div style={{marginTop:12}}><a className="view-all">View All Messages</a></div>
              </div>
        </aside>
      </div>

      <div className="ai-summary">
              <div className="ai-summary-left">
              </div>
              <div className="aai-actions">
                <button className="btn small ghost-cd" type="button" onClick={loadRows}><i className="fa fa-brain" aria-hidden="true"></i> AI Summary</button>
                <button className="btn small ghost-cd" type="button" onClick={() => rows[0]?.id && doAction(rows[0].id, 'assign')}><i className="fa fa-users" aria-hidden="true"></i> Bulk Assign</button>
                <button className="btn small ghost-cd" type="button" onClick={() => rows[0]?.id && doAction(rows[0].id, 'sync')}><i className="fa fa-sync" aria-hidden="true"></i> Sync Vault</button>
              </div>
            </div>

    </div>
  );
}
