import React, { useMemo, useState } from 'react';
import { PulsePanel } from './AdminShared';
import useAdminManagementUsers from '../../hooks/useAdminManagementUsers';
import { useUserSettings } from '../../contexts/UserSettingsContext';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { downloadCsv } from '../../utils/fileDownload';
import { postJson } from '../../api/http';

export default function Shippers({ onOpenUser }){
  const { settings } = useUserSettings();
  const { items: shippers, metrics: apiMetrics, loading, error } = useAdminManagementUsers({ role: 'shipper_broker', limit: 250, refreshMs: 5000 });
  const [busyAction, setBusyAction] = useState('');

  const cards = useMemo(() => {
    const list = Array.isArray(shippers) ? shippers : [];
    const verified = list.filter((u) => u?.is_verified === true && u?.is_active !== false && u?.is_locked !== true).length;
    const pending = apiMetrics?.pending ?? list.filter((u) => u?.onboarding_completed === false || u?.is_verified === false).length;
    const flagged = apiMetrics?.flagged ?? list.filter((u) => u?.is_active === false || u?.is_locked === true).length;
    return [
      { variant:'green', label:'Verified Shippers/Brokers', value: loading ? '…' : String(verified), actionLabel:'View', iconClass:'fa-check' },
      { variant:'yellow', label:'Pending Review', value: loading ? '…' : String(pending), actionLabel:'Review', iconClass:'fa-clock' },
      { variant:'red', label:'Flagged / Locked', value: loading ? '…' : String(flagged), actionLabel:'List', iconClass:'fa-triangle-exclamation' },
      { variant:'blue', label:'Total', value: loading ? '…' : String(list.length), actionLabel:'View', iconClass:'fa-users' }
    ];
  }, [shippers, loading, apiMetrics]);

  const tableRows = useMemo(() => {
    const list = Array.isArray(shippers) ? [...shippers] : [];
    list.sort((a, b) => Number(b?.updated_at || b?.created_at || 0) - Number(a?.updated_at || a?.created_at || 0));
    return list.slice(0, 75);
  }, [shippers]);

  const statusBadge = (u) => {
    if (u?.is_locked) return { text: 'Locked', cls: 'revoked' };
    if (u?.is_active === false) return { text: 'Suspended', cls: 'revoked' };
    if (u?.onboarding_completed === false || u?.is_verified === false) return { text: 'Pending', cls: 'pending' };
    return { text: 'Active', cls: 'active' };
  };

  const formatRole = (r) => {
    const role = String(r || '').replace(/_/g, ' ').trim();
    if (!role) return '—';
    return role[0].toUpperCase() + role.slice(1);
  };

  const handleExportSummary = () => {
    const rows = (tableRows || []).map((s) => {
      const name = s?.company_name || s?.display_name || s?.name || s?.email || s?.uid || s?.id;
      const status = statusBadge(s);
      const updated = Number(s?.updated_at || s?.created_at);
      const when = Number.isFinite(updated) && updated > 0 ? formatDateTime(updated, settings) : '—';
      return {
        id: s?.id || s?.uid || '',
        company_or_user: name || '',
        role: formatRole(s?.role),
        email: s?.email || '',
        status: status.text,
        updated: when,
      };
    });

    downloadCsv('admin_shippers_summary', rows, ['id', 'company_or_user', 'role', 'email', 'status', 'updated']);
  };

  const runBatchAction = async (action) => {
    if (busyAction) return;
    setBusyAction(action);
    try {
      const res = await postJson('/admin/users/batch-action', {
        action,
        role: 'shipper_broker',
        limit: 200,
      });
      alert(`${action} completed for ${Number(res?.updated || 0)} shipper/broker account(s).`);
    } catch (e) {
      alert(e?.message || `Failed to ${action} shippers/brokers`);
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div>
      <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>Shippers/Brokers</h2></div>
      </header>
      <PulsePanel cards={cards} />
      <div className="uo-panel">
        <section className="adm-user-overview">
          <div className="uo-header"><h3 style={{fontWeight:700,fontSize:18}}>Shippers / Brokers</h3></div>

          <div className="uo-table-wrap">
            <table className="uo-table carriers-table">
              <thead>
                <tr>
                  <th>Company / User</th>
                  <th>Role</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr><td colSpan={6} style={{ padding: 16 }}>Failed to load shippers/brokers: {String(error?.message || error)}</td></tr>
                ) : loading ? (
                  <tr><td colSpan={6} style={{ padding: 16 }}>Loading shippers/brokers…</td></tr>
                ) : tableRows.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 16 }}>No shippers/brokers found.</td></tr>
                ) : (
                  tableRows.map((s) => {
                    const name = s?.company_name || s?.display_name || s?.name || s?.email || s?.uid || s?.id;
                    const status = statusBadge(s);
                    const updated = Number(s?.updated_at || s?.created_at);
                    const when = Number.isFinite(updated) && updated > 0 ? formatDateTime(updated, settings) : '—';
                    return (
                      <tr key={s.id}>
                        <td className="carrier-name">{name}</td>
                        <td className="carrier-res">{formatRole(s?.role)}</td>
                        <td className="carrier-res">{s?.email || '—'}</td>
                        <td><span className={`int-status-badge ${status.cls}`}>{status.text}</span></td>
                        <td className="carrier-res">{when}</td>
                        <td className="carrier-actions"><button type="button" className="card-action" onClick={() => onOpenUser?.(s?.id)}>View</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="uo-footer"><a className="card-action">Showing latest {Math.min(75, shippers?.length || 0)} accounts</a></div>
        </section>
      </div>

      <div className="ai-summary">
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Summary:</strong> 5 broker issues fixed by sub admins today. 3 waiting approval. 1 flagged for repeated compliance errors.</div>
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
