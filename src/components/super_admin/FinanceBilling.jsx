import React, { useEffect, useMemo, useState } from 'react'
import '../../styles/super_admin/FinanceBilling.css'
import '../../styles/admin/Tasks.css'
import { getIdToken } from 'firebase/auth'
import { auth } from '../../firebase'
import { API_URL } from '../../config'


export default function FinanceBilling(){
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [eligibleLoads, setEligibleLoads] = useState([])
  const [healthLogs, setHealthLogs] = useState([])
  const [showHealthLogs, setShowHealthLogs] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  const loadFinanceData = async () => {
    try {
      const user = auth.currentUser
      if (!user) return
      setLoading(true)
      setError('')
      const token = await getIdToken(user)

      const [summaryRes, forecastRes, loadsRes] = await Promise.all([
        fetch(`${API_URL}/finance/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/finance/forecast?range_days=30`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/finance/eligible-loads?limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (summaryRes.ok) {
        const data = await summaryRes.json()
        setSummary(data || null)
      }

      if (forecastRes.ok) {
        const data = await forecastRes.json()
        setForecast(data || null)
      }

      if (loadsRes.ok) {
        const data = await loadsRes.json()
        const loads = Array.isArray(data?.loads) ? data.loads : []
        setEligibleLoads(loads)
      }
    } catch (e) {
      setError(e?.message || 'Failed to load finance data')
      setEligibleLoads([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFinanceData()
  }, [])

  const tableRows = useMemo(() => {
    return eligibleLoads.map((l) => ({
      name: l?.load_number || l?.load_id || 'Load',
      id: l?.load_id || 'N/A',
      role: l?.creator_role || 'Load',
      integrations: l?.payment_terms || 'Finance',
      last_sync: l?.delivery_date || l?.pickup_date || 'N/A',
      status: l?.status || 'Open',
      amount: '$0.00',
      issue: l?.has_pod ? 'Ready' : 'Missing POD',
    }))
  }, [eligibleLoads])

  const currency = (n) => {
    const value = Number(n || 0)
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }

  const viewHealthLog = async () => {
    try {
      const user = auth.currentUser
      if (!user) return
      setActionBusy(true)
      const token = await getIdToken(user)
      const res = await fetch(`${API_URL}/admin/system/health-log?limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load health log')
      const data = await res.json()
      const items = Array.isArray(data?.items) ? data.items : []
      setHealthLogs(items)
      setShowHealthLogs(true)
    } catch (e) {
      setError(e?.message || 'Failed to load health log')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <div className="sb-finance-root">
      <div className="drivers-header">
        <div className="drivers-header-content">
          <h1>Finance</h1>
        </div>
        <div className="drivers-actions">
          <button className="btn small-cd" onClick={loadFinanceData}>
            <i className="fas fa-plus"></i>
            Refresh Data
          </button>
          <button className="btn small ghost-cd" onClick={loadFinanceData}>
            <i className="fas fa-check-double"></i>
            Recompute
          </button>
        </div>
      </div>

      <div className="ai-summary" style={{marginBottom: '20px'}}>
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text"><strong>AI Financial Health Summary:</strong> Outstanding {currency(summary?.outstanding_amount)}. Overdue {currency(summary?.overdue_amount)}. Forecast direct payments {currency(forecast?.expected_direct_payments)} in the next 30 days.</div>
              </div>
              <div className="aai-actions">
                <button className="btn small ghost-cd" onClick={loadFinanceData}><i className="fa fa-check" aria-hidden="true"></i> Re-scan Now</button>
                <button className="btn small-cd" onClick={viewHealthLog} disabled={actionBusy}><i className="fa fa-times" aria-hidden="true"></i> View Health Log</button>
              </div>
            </div>

      {showHealthLogs ? (
        <div className="ca-panel uo-panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className='comp-aud'>System Health Log</h3>
            <button className="btn small ghost-cd" onClick={() => setShowHealthLogs(false)}>Close</button>
          </div>
          <div className="uo-table-wrap">
            <table className="uo-table">
              <thead>
                <tr><th>Timestamp</th><th>Health</th><th>Open Tickets</th><th>Message</th></tr>
              </thead>
              <tbody>
                {healthLogs.map((h) => (
                  <tr key={String(h?.id || Math.random())}>
                    <td>{h?.created_at ? new Date(Number(h.created_at) * 1000).toLocaleString() : '-'}</td>
                    <td>{Number(h?.overall_status_percent || 0)}%</td>
                    <td>{Number(h?.open_tickets || 0)}</td>
                    <td>{h?.message || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="card" style={{ marginBottom: 16, borderColor: '#fecaca', background: '#fff1f2' }}>
          <div style={{ fontWeight: 700 }}>Finance data unavailable</div>
          <div className="muted">{error}</div>
        </div>
      ) : null}
      

      <section className="fb-stats">
        <div className="fb-stat card"><div><div className="fb-num">{loading ? '—' : currency(summary?.outstanding_amount)}</div><div className="fb-label">Outstanding Amount</div></div><div><i className="fa fa-money-bill-wave" aria-hidden="true"></i></div></div>
        <div className="fb-stat card"><div><div className="fb-num">{loading ? '—' : (summary?.open_invoice_count ?? '—')}</div><div className="fb-label">Open Invoices</div></div><div><i className="fa fa-file-invoice" aria-hidden="true"></i></div></div>
        <div className="fb-stat card"><div><div className="fb-num">{loading ? '—' : currency(summary?.factoring_outstanding_amount)}</div><div className="fb-label">Factoring Outstanding</div></div><div><i className="fa fa-link" aria-hidden="true"></i></div></div>
        <div className="fb-stat card"><div><div className="fb-num">{loading ? '—' : currency(summary?.overdue_amount)}</div><div className="fb-label">Overdue Amount</div></div><div><i className="fa fa-exclamation-triangle" aria-hidden="true"></i></div></div>
        <div className="fb-stat card"><div><div className="fb-num">{loading ? '—' : currency(forecast?.expected_direct_payments)}</div><div className="fb-label">Expected Direct (30d)</div></div><div><i className="fa fa-robot" aria-hidden="true"></i></div></div>
        <div className="fb-stat card"><div><div className="fb-num">{loading ? '—' : currency(forecast?.expected_factoring_advances)}</div><div className="fb-label">Expected Factoring (30d)</div></div><div><i className="fa fa-circle-question" aria-hidden="true"></i></div></div>
      </section>

      <div className="ca-panel uo-panel">
        <h3 className='comp-aud'>Transaction Management</h3>
        <div className="uo-table-wrap">
          <table className="uo-table">
            <thead>
              <tr><th>Entity</th><th>Role</th><th>Integration</th><th>Last Sync</th><th>Status</th><th>Amount</th><th>Issue</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {tableRows.map((e,i)=> (
                <tr key={i}>
                  <td className="user-cells">{e.name}<div className="muted">{e.id}</div></td>
                  <td>{e.role}</td>
                  <td><div className="score-badge">{e.integrations}</div></td>
                  <td style={{fontSize: '14px'}}>{e.last_sync}</td>
                  <td><span className={`int-status-badge ${String(e.status || '').toLowerCase()}`}>{e.status}</span></td>
                  <td style={{fontSize: '14px'}}>{e.amount}</td>
                  <td style={{fontSize: '14px'}}>{e.issue}</td>
                  <td><div className="actions"><i className="fa-solid fa-ellipsis-h"/></div></td>
                </tr>
              ))}
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 16 }}>No eligible finance rows found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
