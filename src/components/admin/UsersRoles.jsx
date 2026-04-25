import React, { useMemo } from 'react';
import '../../styles/admin/UsersRoles.css';
import useAdminManagementUsers from '../../hooks/useAdminManagementUsers';
import { useUserSettings } from '../../contexts/UserSettingsContext';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { downloadCsv } from '../../utils/fileDownload';

function PulseCard({variant, label, value, actionLabel, iconClass}){
  return (
    <div className="pulse-card dark-card">
      <div className="card-top">
        <div className={`pulse-icon ${variant}`}><i className={`fa ${iconClass}`} aria-hidden="true" /></div>
        <a className="card-action">{actionLabel || 'View'}</a>
      </div>
      <div className="card-body">
        <div className="pulse-title">{label}</div>
        <div className="pulse-value">{value}</div>
      </div>
    </div>
  )
}

export default function UsersRoles({ onOpenUser }){
  const { settings } = useUserSettings();
  const { items: users, metrics: apiMetrics, loading, error } = useAdminManagementUsers({ role: 'all', limit: 250, refreshMs: 5000 });

  const metrics = useMemo(() => {
    if (apiMetrics) {
      return {
        activeUsers: apiMetrics.active ?? 0,
        pendingApprovals: apiMetrics.pending ?? 0,
        flaggedOrSuspended: apiMetrics.flagged ?? 0,
      };
    }
    const list = Array.isArray(users) ? users : [];
    const activeUsers = list.filter((u) => u?.is_active !== false && u?.is_locked !== true).length;
    const pendingApprovals = list.filter((u) => u?.onboarding_completed === false || u?.is_verified === false).length;
    const flaggedOrSuspended = list.filter((u) => u?.is_active === false || u?.is_locked === true).length;
    return { activeUsers, pendingApprovals, flaggedOrSuspended };
  }, [users, apiMetrics]);

  const tableRows = useMemo(() => {
    const list = Array.isArray(users) ? [...users] : [];
    list.sort((a, b) => Number(b?.updated_at || b?.last_login_at || b?.created_at || 0) - Number(a?.updated_at || a?.last_login_at || a?.created_at || 0));
    return list.slice(0, 50);
  }, [users]);

  const formatRole = (r) => {
    const role = String(r || '').replace(/_/g, ' ').trim();
    if (!role) return '—';
    return role.split(' ').map((w) => w ? (w[0].toUpperCase() + w.slice(1)) : w).join(' ');
  };

  const formatStatus = (u) => {
    if (u?.is_locked) return { text: 'Locked', cls: 'revoked' };
    if (u?.is_active === false) return { text: 'Suspended', cls: 'revoked' };
    if (u?.onboarding_completed === false || u?.is_verified === false) return { text: 'Pending', cls: 'pending' };
    return { text: 'Active', cls: 'active' };
  };

  const formatWhen = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '—';
    try {
      return formatDateTime(n, settings);
    } catch (_) {
      return '—';
    }
  };

  const handleExportSummary = () => {
    const rows = (tableRows || []).map((u) => {
      const status = formatStatus(u);
      const displayName = u?.display_name || u?.name || u?.company_name || u?.email || u?.uid || u?.id;
      const manager = u?.managed_by_name || u?.managed_by || u?.sub_admin_name || '—';
      return {
        id: u?.id || u?.uid || '',
        name: displayName || '',
        email: u?.email || '',
        role: formatRole(u?.role),
        managed_by: manager,
        status: status.text,
        last_activity: formatWhen(u?.last_login_at || u?.updated_at || u?.created_at),
      };
    });

    downloadCsv('admin_users_summary', rows, ['id', 'name', 'email', 'role', 'managed_by', 'status', 'last_activity']);
  };

  return (
    <div className="adm-users-root">
      <section className="adm-system-pulse">
        <header className="fp-header adm-analytics-header">
          <div className="fp-header-titles">
            <h2>Users</h2>
          </div>
        </header>

        <div className="pulse-panel">
          <div className="pulse-cards">
            <PulseCard variant="green" label="Active Users" value={loading ? '…' : String(metrics.activeUsers)} actionLabel="View" iconClass="fa-user-check" />
            <PulseCard variant="yellow" label="Pending Approvals" value={loading ? '…' : String(metrics.pendingApprovals)} actionLabel="Review" iconClass="fa-clock" />
            <PulseCard variant="red" label="Flagged / Suspended" value={loading ? '…' : String(metrics.flaggedOrSuspended)} actionLabel="Review" iconClass="fa-triangle-exclamation" />
            <PulseCard variant="blue" label="Total Users" value={loading ? '…' : String(users?.length || 0)} actionLabel="View" iconClass="fa-users" />
          </div>
        </div>

        <div className="uo-panel">
          <section className="adm-user-overview">
            <div className="uo-header"><h3 style={{fontWeight: '700', fontSize: '18px'}}>User Overview</h3></div>

            <div className="uo-table-wrap">
              <table className="uo-table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Managed By</th><th>Status</th><th>Last Activity</th><th>Action</th></tr>
              </thead>
              <tbody>
                {error ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 16 }}>
                      Failed to load users: {String(error?.message || error)}
                    </td>
                  </tr>
                ) : loading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 16 }}>Loading users…</td>
                  </tr>
                ) : tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 16 }}>No users found.</td>
                  </tr>
                ) : (
                  tableRows.map((u) => {
                    const status = formatStatus(u);
                    const displayName = u?.display_name || u?.name || u?.company_name || u?.email || u?.uid || u?.id;
                    const manager = u?.managed_by_name || u?.managed_by || u?.sub_admin_name || '—';
                    const photo = u?.photo_url || 'https://www.gravatar.com/avatar/?d=mp';
                    return (
                      <tr key={u.id}>
                        <td className="user-cell"><img src={photo} alt="avatar"/> {displayName}</td>
                        <td>{formatRole(u?.role)}</td>
                        <td>{manager}</td>
                        <td><span className={`int-status-badge ${status.cls}`}>{status.text}</span></td>
                        <td>{formatWhen(u?.last_login_at || u?.updated_at || u?.created_at)}</td>
                        <td><button type="button" className="card-action" onClick={() => onOpenUser?.(u?.id)}>View</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              </table>
            </div>

            <div className="uo-footer"><a className="card-action">Showing latest {Math.min(50, users?.length || 0)} users</a></div>
          </section>
        </div>
      </section>
      {/* AI summary banner */}
            <div className="ai-summary">
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Summary:</strong> Sub-Admins resolved 14 requests today. 3 users pending &gt; 24h. 1 suspended account requires compliance review.</div>
              </div>
              <div className="aai-actions">
                <button className="btn small ghost-cd"><i className="fa fa-bolt" aria-hidden="true"></i> View Issues</button>
                <button className="btn small ghost-cd" type="button" onClick={handleExportSummary}><i className="fa fa-file-export" aria-hidden="true"></i> Export Summary</button>
              </div>
            </div>
    </div>
  )
}
