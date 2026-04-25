import React, { useMemo, useState } from 'react';
import { PulsePanel } from './AdminShared';
import useAdminManagementUsers from '../../hooks/useAdminManagementUsers';
import { useUserSettings } from '../../contexts/UserSettingsContext';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { downloadCsv } from '../../utils/fileDownload';
import { postJson } from '../../api/http';

export default function Carriers({ onOpenUser }){
  const { settings } = useUserSettings();
  const { items: carriers, metrics: apiMetrics, loading, error } = useAdminManagementUsers({ role: 'carrier', limit: 250, refreshMs: 5000 });
  const [busyAction, setBusyAction] = useState('');

  const cards = useMemo(() => {
    const list = Array.isArray(carriers) ? carriers : [];
    const active = apiMetrics?.active ?? list.filter((u) => u?.is_active !== false && u?.is_locked !== true).length;
    const pending = apiMetrics?.pending ?? list.filter((u) => u?.onboarding_completed === false || u?.is_verified === false).length;
    const flagged = apiMetrics?.flagged ?? list.filter((u) => u?.is_active === false || u?.is_locked === true).length;
    return [
      { variant:'green', label:'Active Carriers', value: loading ? '…' : String(active), actionLabel:'View', iconClass:'fa-truck' },
      { variant:'yellow', label:'Pending Approvals', value: loading ? '…' : String(pending), actionLabel:'Review', iconClass:'fa-clock' },
      { variant:'red', label:'Flagged', value: loading ? '…' : String(flagged), actionLabel:'Review', iconClass:'fa-triangle-exclamation' },
      { variant:'blue', label:'Total Carriers', value: loading ? '…' : String(list.length), actionLabel:'View', iconClass:'fa-users' }
    ];
  }, [carriers, loading, apiMetrics]);

  const tableRows = useMemo(() => {
    const list = Array.isArray(carriers) ? [...carriers] : [];
    list.sort((a, b) => Number(b?.updated_at || b?.created_at || 0) - Number(a?.updated_at || a?.created_at || 0));
    return list.slice(0, 75);
  }, [carriers]);

  const statusBadge = (u) => {
    if (u?.is_locked) return { text: 'Locked', cls: 'revoked' };
    if (u?.is_active === false) return { text: 'Suspended', cls: 'revoked' };
    if (u?.onboarding_completed === false || u?.is_verified === false) return { text: 'Pending', cls: 'pending' };
    return { text: 'Active', cls: 'active' };
  };

  const handleExportSummary = () => {
    const rows = (tableRows || []).map((c) => {
      const name = c?.company_name || c?.display_name || c?.name || c?.email || c?.uid || c?.id;
      const mc = c?.mc_number ? `MC ${c.mc_number}` : '';
      const dot = c?.dot_number ? `DOT ${c.dot_number}` : '';
      const ids = [mc, dot].filter(Boolean).join(' / ') || '—';
      const status = statusBadge(c);
      const updated = Number(c?.updated_at || c?.created_at);
      const when = Number.isFinite(updated) && updated > 0 ? formatDateTime(updated, settings) : '—';
      return {
        id: c?.id || c?.uid || '',
        carrier: name || '',
        mc_dot: ids,
        email: c?.email || '',
        status: status.text,
        updated: when,
      };
    });

    downloadCsv('admin_carriers_summary', rows, ['id', 'carrier', 'mc_dot', 'email', 'status', 'updated']);
  };

  const runBatchAction = async (action) => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      const res = await postJson('/admin/users/batch-action', {
        action,
        role: 'carrier',
        limit: 200,
      });
      alert(`${action} completed for ${Number(res?.updated || 0)} carrier(s).`);
    } catch (e) {
      alert(e?.message || `Failed to ${action} carriers`);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div>
      <header className="fp-header adm-analytics-header">
          <div className="fp-header-titles">
            <h2>Carriers</h2>
          </div>
        </header>
      <PulsePanel cards={cards} />
      <div className="uo-panel">
        <section className="adm-user-overview">
          <div className="uo-header"><h3 style={{fontWeight:700,fontSize:18}}>Carriers</h3></div>

          <div className="uo-table-wrap">
            <table className="uo-table carriers-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>MC / DOT</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr><td colSpan={6} style={{ padding: 16 }}>Failed to load carriers: {String(error?.message || error)}</td></tr>
                ) : loading ? (
                  <tr><td colSpan={6} style={{ padding: 16 }}>Loading carriers…</td></tr>
                ) : tableRows.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 16 }}>No carriers found.</td></tr>
                ) : (
                  tableRows.map((c) => {
                    const name = c?.company_name || c?.display_name || c?.name || c?.email || c?.uid || c?.id;
                    const mc = c?.mc_number ? `MC ${c.mc_number}` : '';
                    const dot = c?.dot_number ? `DOT ${c.dot_number}` : '';
                    const ids = [mc, dot].filter(Boolean).join(' / ') || '—';
                    const status = statusBadge(c);
                    const updated = Number(c?.updated_at || c?.created_at);
                    const when = Number.isFinite(updated) && updated > 0 ? formatDateTime(updated, settings) : '—';
                    return (
                      <tr key={c.id}>
                        <td className="carrier-name">{name}</td>
                        <td className="carrier-mc">{ids}</td>
                        <td className="carrier-res">{c?.email || '—'}</td>
                        <td><span className={`int-status-badge ${status.cls}`}>{status.text}</span></td>
                        <td className="carrier-res">{when}</td>
                        <td className="carrier-actions"><button type="button" className="card-action" onClick={() => onOpenUser?.(c?.id)}>View</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="uo-footer"><a className="card-action">Showing latest {Math.min(75, carriers?.length || 0)} carriers</a></div>
        </section>
      </div>
      <div className="ai-summary">
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Summary:</strong> 14 carriers verified by sub admins. 1 auto flagged for missing insurance</div>
              </div>
              <div className="aai-actions">
                <button className="btn small ghost-cd" type="button" onClick={() => runBatchAction('confirm')} disabled={!!busyAction}><i className="fa fa-check" aria-hidden="true"></i> Confirm All</button>
                <button className="btn small ghost-cd" type="button" onClick={() => runBatchAction('send_back')} disabled={!!busyAction}><i className="fa fa-times" aria-hidden="true"></i> Send Back</button>
                <button className="btn small ghost-cd" type="button" onClick={handleExportSummary}><i className="fa fa-file-export" aria-hidden="true"></i> Export Summary</button>
              </div>
            </div>
      
    </div>
  )
}
