import React from 'react'
import '../../styles/admin/ComplianceAudit.css'
import { downloadCsv } from '../../utils/fileDownload'
import { getJson, postJson } from '../../api/http'

export default function ComplianceAudit(){
  const [entities, setEntities] = React.useState([])
  const [summary, setSummary] = React.useState(null)
  const [tickets, setTickets] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')

  const loadEntities = React.useCallback(async () => {
    try {
      const data = await getJson('/admin/compliance/entities?limit=200')
      setEntities(Array.isArray(data?.items) ? data.items : [])
    } catch (e) {
      setEntities([])
      setMessage(e?.message || 'Failed to load compliance entities')
    }
  }, [])

  const loadSummary = React.useCallback(async () => {
    try {
      const data = await getJson('/admin/compliance/summary')
      setSummary(data || null)
    } catch {
      setSummary(null)
    }
  }, [])

  const loadTickets = React.useCallback(async () => {
    try {
      const data = await getJson('/admin/support/tickets?limit=150')
      setTickets(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setTickets([])
    }
  }, [])

  React.useEffect(() => {
    loadEntities()
    loadSummary()
    loadTickets()
  }, [loadEntities, loadSummary, loadTickets])

  const handleExportSummary = () => {
    const rows = (entities || []).map((e) => ({
      entity: e?.name || '',
      id: e?.id || '',
      role: e?.role || '',
      score: e?.score ?? '',
      docs_valid: e?.docs || '',
      expiry: e?.expiry || '',
      status: e?.status || '',
      assigned_to: e?.assigned || '',
    }));

    downloadCsv('admin_compliance_audit_summary', rows, ['entity', 'id', 'role', 'score', 'docs_valid', 'expiry', 'status', 'assigned_to']);
  };

  const runBatchAction = async (action) => {
    try {
      setBusy(true)
      setMessage('')
      const res = await postJson('/admin/users/batch-action', {
        action,
        role: 'all',
        limit: 200,
      })
      setMessage(`${action} completed for ${Number(res?.updated || 0)} account(s).`)
      await loadEntities()
      await loadSummary()
    } catch (e) {
      setMessage(e?.message || `Failed to ${action}`)
    } finally {
      setBusy(false)
    }
  }

  const runEntityAction = async (entityId, action) => {
    try {
      setBusy(true)
      setMessage('')
      await postJson(`/admin/compliance/entities/${encodeURIComponent(entityId)}/action`, { action })
      setMessage(`Entity ${action} completed.`)
      await loadEntities()
      await loadSummary()
    } catch (e) {
      setMessage(e?.message || `Failed to ${action} entity`)
    } finally {
      setBusy(false)
    }
  }

  const runTicketResolve = async (ticketId) => {
    try {
      setBusy(true)
      setMessage('')
      await postJson(`/admin/support/tickets/${encodeURIComponent(ticketId)}/action`, { action: 'resolve' })
      setMessage('Support ticket resolved.')
      await loadTickets()
      await loadSummary()
    } catch (e) {
      setMessage(e?.message || 'Failed to resolve support ticket')
    } finally {
      setBusy(false)
    }
  }

  const topTickets = React.useMemo(() => {
    const rows = [...tickets]
    rows.sort((a, b) => Number(b?.updated_at || 0) - Number(a?.updated_at || 0))
    return rows.slice(0, 12)
  }, [tickets])

  return (
    <div className="ca-root">
      <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>Compliance & Audit</h2></div>
      </header>
      {message ? (
        <div className="card" style={{ marginBottom: 12, borderColor: '#bfdbfe', background: '#eff6ff' }}>{message}</div>
      ) : null}
          <div className="ai-summary" style={{marginTop: '-20px', marginBottom: '-20px'}}>
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Summary:</strong> Platform Compliance {Number(summary?.avg_score || 0)}%. {Number(summary?.expiring_count || 0)} entities expiring soon, {Number(summary?.open_support_tickets || 0)} support tickets open. AI suggests prioritizing high-risk entities first.</div>
              </div>
              <div className="aai-actions">
                <button className="btn small ghost-cd" type="button" onClick={() => runBatchAction('confirm')} disabled={busy}><i className="fa fa-check" aria-hidden="true"></i> Confirm All</button>
                <button className="btn small ghost-cd" type="button" onClick={() => runBatchAction('send_back')} disabled={busy}><i className="fa fa-times" aria-hidden="true"></i> Send Back</button>
                <button className="btn small ghost-cd" type="button" onClick={handleExportSummary}><i className="fa fa-file-export" aria-hidden="true"></i> Export Summary</button>
              </div>
            </div>

      <div className="ca-panel uo-panel">
        <h3 className='comp-aud'>Compliance Entities</h3>
        <div className="uo-table-wrap">
          <table className="uo-table">
            <thead>
              <tr><th>Entity</th><th>Role</th><th>Score</th><th>Docs Valid</th><th>Expiry</th><th>Status</th><th>Assigned To</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {entities.map((e,i)=> (
                <tr key={i}>
                  <td className="user-cells">{e.name}<div className="muted">{e.id}</div></td>
                  <td>{e.role}</td>
                  <td><div className="score-badge">{e.score}</div></td>
                  <td>{e.docs}</td>
                  <td>{e.expiry}</td>
                  <td><span className={`int-status-badge ${String(e.status || '').toLowerCase()}`}>{e.status}</span></td>
                  <td>{e.assigned}</td>
                  <td>
                    <div className="actions" style={{ display: 'flex', gap: 6 }}>
                      <button className="btn small ghost-cd" type="button" onClick={() => runEntityAction(e.id, 'confirm')} disabled={busy}>Confirm</button>
                      <button className="btn small ghost-cd" type="button" onClick={() => runEntityAction(e.id, 'send_back')} disabled={busy}>Send Back</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ca-stats">
          <div className="ca-box"><div className='num-cd'>{Number(summary?.open_support_tickets || 0)}</div><div className='num-desc'>Active Requests</div></div>
          <div className="ca-box"><div className='num-cd'>{Number(summary?.verified_count || 0)}</div><div className='num-desc'>Verified Entities</div></div>
          <div className="ca-box"><div className='num-cd'>{Number(summary?.expiring_count || 0)}</div><div className='num-desc'>Expiring Soon</div></div>
          <div className="ca-box"><div className='num-cd'>{Number(summary?.high_priority_tickets || 0)}</div><div className='num-desc'>High Priority</div></div>
        </div>

      <div className="ca-support uo-panel" style={{marginTop: '0px'}}>
        <h3 className='comp-aud'>Compliance Support Request Center</h3>

        <div className="uo-table-wrap" style={{marginTop:12}}>
          <table className="uo-table">
            <thead><tr><th>Request ID</th><th>From</th><th>Role</th><th>Type</th><th>Priority</th><th>Date</th><th>Status</th><th>Assigned To</th><th>Actions</th></tr></thead>
            <tbody>
              {topTickets.map((t) => (
                <tr key={t.id}>
                  <td className='num-row'>#{String(t.id || '').slice(0, 6)}</td>
                  <td>{t.company || 'FreightPower'}</td>
                  <td>{t.module || 'General'}</td>
                  <td className='num-type'>{t.title || 'Support Request'}</td>
                  <td>{t.priority || 'Medium'}</td>
                  <td className='num-date'>{t.updated || 'Recently'}</td>
                  <td><span className={`int-status-badge ${String(t.status || '').toLowerCase()}`}>{t.status || 'Pending'}</span></td>
                  <td className='num-assigned'>{t.assigned || '-'}</td>
                  <td>
                    <button className="btn small ghost-cd" type="button" onClick={() => runTicketResolve(t.id)} disabled={busy}>Resolve</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
