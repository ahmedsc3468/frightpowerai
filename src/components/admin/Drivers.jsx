import React, { useMemo, useState } from 'react'
import '../../styles/admin/UsersRoles.css'
import { PulsePanel } from './AdminShared'
import useAdminManagementUsers from '../../hooks/useAdminManagementUsers'
import { downloadCsv } from '../../utils/fileDownload'
import { postJson } from '../../api/http'

export default function Drivers({ onOpenUser }){
  const { items: drivers, metrics: apiMetrics, loading, error } = useAdminManagementUsers({ role: 'driver', limit: 300, refreshMs: 5000 });
  const [busyAction, setBusyAction] = useState('');

  const cards = useMemo(() => {
    const list = Array.isArray(drivers) ? drivers : [];
    const verified = list.filter((u) => u?.is_verified === true && u?.is_active !== false && u?.is_locked !== true).length;
    const pending = apiMetrics?.pending ?? list.filter((u) => u?.onboarding_completed === false || u?.is_verified === false).length;
    const issues = apiMetrics?.flagged ?? list.filter((u) => u?.is_active === false || u?.is_locked === true).length;
    return [
      { variant:'green', label:'Verified Drivers', value: loading ? '…' : String(verified), actionLabel:'View', iconClass:'fa-check' },
      { variant:'yellow', label:'Pending Verification', value: loading ? '…' : String(pending), actionLabel:'Review', iconClass:'fa-clock' },
      { variant:'red', label:'Flagged / Locked', value: loading ? '…' : String(issues), actionLabel:'Review', iconClass:'fa-triangle-exclamation' },
      { variant:'blue', label:'Total Drivers', value: loading ? '…' : String(list.length), actionLabel:'View', iconClass:'fa-users' }
    ];
  }, [drivers, loading, apiMetrics]);

  const tableRows = useMemo(() => {
    const list = Array.isArray(drivers) ? [...drivers] : [];
    list.sort((a, b) => Number(b?.updated_at || b?.created_at || 0) - Number(a?.updated_at || a?.created_at || 0));
    return list.slice(0, 75);
  }, [drivers]);

  const statusBadge = (u) => {
    if (u?.is_locked) return { text: 'Locked', cls: 'revoked' };
    if (u?.is_active === false) return { text: 'Suspended', cls: 'revoked' };
    if (u?.onboarding_completed === false || u?.is_verified === false) return { text: 'Pending', cls: 'pending' };
    return { text: 'Active', cls: 'active' };
  };

  const handleExportSummary = () => {
    const rows = (tableRows || []).map((d) => {
      const status = statusBadge(d);
      const name = d?.display_name || d?.name || d?.full_name || d?.email || d?.uid || d?.id;
      const region = d?.state || d?.region || d?.home_state || '—';
      const managedBy = d?.managed_by_name || d?.managed_by || d?.sub_admin_name || '—';
      const type = d?.employment_type || (d?.is_verified ? 'Verified' : 'Pre-Hire');
      const updated = d?.updated_at || d?.created_at || '';
      return {
        id: d?.id || d?.uid || '',
        driver: name || '',
        type,
        region,
        managed_by: managedBy,
        status: status.text,
        updated,
      };
    });

    downloadCsv('admin_drivers_summary', rows, ['id', 'driver', 'type', 'region', 'managed_by', 'status', 'updated']);
  };

  const runBatchAction = async (action) => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      const res = await postJson('/admin/users/batch-action', {
        action,
        role: 'driver',
        limit: 200,
      });
      alert(`${action} completed for ${Number(res?.updated || 0)} driver(s).`);
    } catch (e) {
      alert(e?.message || `Failed to ${action} drivers`);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div>
        <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>Drivers</h2></div>
      </header>
      <PulsePanel cards={cards} />
        <div className="uo-panel">
      <section className="adm-user-overview">
        <div className="uo-header"><h3 style={{fontWeight:700,fontSize:18}}>Drivers Oversight</h3></div>

        <div className="uo-table-wrap">
          <table className="uo-table carriers-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Type</th>
                <th>Region</th>
                <th>Managed By</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={6} style={{ padding: 16 }}>Failed to load drivers: {String(error?.message || error)}</td></tr>
              ) : loading ? (
                <tr><td colSpan={6} style={{ padding: 16 }}>Loading drivers…</td></tr>
              ) : tableRows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 16 }}>No drivers found.</td></tr>
              ) : (
                tableRows.map((d) => {
                  const name = d?.display_name || d?.name || d?.full_name || d?.email || d?.uid || d?.id;
                  const region = d?.state || d?.region || d?.home_state || '—';
                  const managedBy = d?.managed_by_name || d?.managed_by || d?.sub_admin_name || '—';
                  const status = statusBadge(d);
                  const type = d?.employment_type || (d?.is_verified ? 'Verified' : 'Pre-Hire');
                  return (
                    <tr key={d.id}>
                      <td className="user-cell"><img src={d?.photo_url || 'https://www.gravatar.com/avatar/?d=mp'} alt="avatar"/> {name}</td>
                      <td>{type}</td>
                      <td>{region}</td>
                      <td>{managedBy}</td>
                      <td><span className={`int-status-badge ${status.cls}`}>{status.text}</span></td>
                      <td className="carrier-actions"><button type="button" className="card-action" onClick={() => onOpenUser?.(d?.id)}>View</button></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="uo-footer"><a className="card-action">Showing latest {Math.min(75, drivers?.length || 0)} drivers</a></div>
      </section>
    </div>
    <div className="ai-summary">
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Summary:</strong> 24 drivers verified this week. 5 pending Marketplace approval. 2 flagged for expiring MVR checks.</div>
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
