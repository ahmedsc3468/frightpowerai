import React from 'react'
import '../../styles/admin/ServiceProviders.css'
import { PulsePanel } from './AdminShared'
import { getJson, postJson } from '../../api/http'

export default function ServiceProviders(){
  const [providers, setProviders] = React.useState([])

  const loadProviders = React.useCallback(async () => {
    try {
      const data = await getJson('/admin/service-providers?limit=100')
      setProviders(Array.isArray(data?.items) ? data.items : [])
    } catch (e) {
      setProviders([])
      alert(e?.message || 'Failed to load service providers')
    }
  }, [])

  React.useEffect(() => {
    loadProviders()
  }, [loadProviders])

  const cards = [
    { variant:'green', label:'Active Providers', value:'26', actionLabel:'View All', iconClass:'fa-check' },
    { variant:'yellow', label:'Pending Verification', value:'4', actionLabel:'Review', iconClass:'fa-clock' },
    { variant:'red', label:'Expired Deals', value:'2', actionLabel:'Return List', iconClass:'fa-triangle-exclamation' },
    { variant:'blue', label:'Marketplace', value:'7', actionLabel:'Open', iconClass:'fa-store' }
  ]

  const doProviderAction = async (id, action) => {
    try {
      await postJson(`/admin/service-providers/${encodeURIComponent(id)}/action`, { action })
      await loadProviders()
    } catch (e) {
      alert(e?.message || `Failed to ${action} provider`)
    }
  }

  return (
    <div className="sp-root">
        <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>Service Providers</h2></div>
      </header> 
      <PulsePanel cards={cards} />
      <div className="sp-overview">Overview</div>
      <div className="sp-providers">
        <div className="sp-providers-grid">
          {(providers || []).map((p) => (
            <div className="provider-card" key={p.id}>
              <div className="pc-top"><div className="pc-icon"><i className='fa-solid fa-tag'></i></div><div className={`int-status-badge ${p?.is_verified ? 'active' : 'pending'}`}>{p?.is_verified ? 'Verified Partner' : 'Pending'}</div></div>
              <h4>{p?.name || 'Provider'}</h4>
              <div className="pc-desc">{p?.category || 'Service Provider'}</div>
              <div className="pc-promo">FreightPower Partner Listing</div>
              <div className="pc-meta">Last update: {p?.updated_at ? 'recently' : 'n/a'}</div>
              <div className="pc-actions">
                <button className="btn ghost-cd small" type="button" onClick={() => doProviderAction(p.id, 'approve')}>Approve</button>
                <button className="btn small-cd" type="button" onClick={() => doProviderAction(p.id, 'promote')}>Promote</button>
              </div>
            </div>
          ))}

          <div className="provider-card add-card">
            <div className="add-inner"> <div className="add-plus">+</div>
            <div className="add-text">Add New Provider</div>
            <div className="add-sub">Register a new service provider or approve self-listing</div>
            <button className="btn small-cd" style={{marginTop:12}} type="button" onClick={loadProviders}>+ Add Provider</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
