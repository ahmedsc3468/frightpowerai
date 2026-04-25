import React from 'react'
import '../../styles/admin/AdminMarketplace.css'
import { getJson, postJson } from '../../api/http'

export default function AdminMarketplace(){
  const [items, setItems] = React.useState([])

  const loadListings = React.useCallback(async () => {
    try {
      const data = await getJson('/admin/marketplace/listings?limit=120')
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch (e) {
      setItems([])
      alert(e?.message || 'Failed to load marketplace listings')
    }
  }, [])

  React.useEffect(() => {
    loadListings()
  }, [loadListings])

  const runAction = async (id, action) => {
    try {
      if (action === 'message') {
        alert('Use Admin Messaging to contact this listing.')
        return
      }
      await postJson(`/admin/marketplace/listings/${encodeURIComponent(id)}/action`, { action })
      await loadListings()
    } catch (e) {
      alert(e?.message || `Failed to ${action} listing`)
    }
  }

  return (
    <div className="admin-marketplace-root">
      {/* Header Section */}
      <div className="drivers-header">
        <div className="drivers-header-content">
          <h1>Marketplace</h1>
        </div>
        <div className="drivers-actions">
          <button className="btn small-cd" type="button" onClick={loadListings}>
            <i className="fas fa-plus"></i>
            New Listing
          </button>
          <button className="btn small ghost-cd" type="button" onClick={loadListings}>
            <i className="fas fa-check-double"></i>
            Bulk Approve
          </button>
        </div>
      </div>

      <section className="mp-stats">
        <div className="mp-stat card"><div className="mp-num">2,847</div><div className="mp-label">Total Listings</div></div>
        <div className="mp-stat card"><div className="mp-num">1,932</div><div className="mp-label">Verified Listings</div></div>
        <div className="mp-stat card"><div className="mp-num">47</div><div className="mp-label">Pending Approvals</div></div>
        <div className="mp-stat card"><div className="mp-num">23</div><div className="mp-label">Active Promotions</div></div>
        <div className="mp-stat card"><div className="mp-num">$847K</div><div className="mp-label">Monthly Revenue</div></div>
      </section>

      <div className="filter-row controls" style={{marginBottom: '20px'}}>
          <select className="select" aria-label="Tenant">
            <option>Role</option>
            <option>Alpha Freight</option>
            <option>Midwest Trans</option>
          </select>
          <select className="select" aria-label="Status">
            <option>All Status</option>
            <option>Active</option>
            <option>At Risk / Delayed</option>
          </select>
          <select className="select" aria-label="Region">
            <option>Verified</option>
            <option>Yes</option>
            <option>No</option>
          </select>
        </div>

      <section className="mp-grid">
        {(items || []).map((item) => (
        <div className="mp-card" key={item.id}>
          <div className="mp-card-row">
            <div className="mp-left">
              <img className="mp-avatar" src="https://randomuser.me/api/portraits/men/44.jpg" alt="swift" />
              <div className="mp-meta">
                <div className="mp-card-title">{item?.name || 'Listing'}</div>
                <div className="mp-role"><span className="int-status-badge blue">{String(item?.role || 'provider').replace(/_/g, ' ')}</span></div>
              </div>
            </div>
            <div className="mp-right">
              <div className="mp-rating"><strong>{Number(item?.rating || 0).toFixed(1)}</strong> <span className="muted">(reviews)</span></div>
              <div className="mp-offer">{item?.offer || 'No Offer'}</div>
            </div>
          </div>
          <div className="mp-tags"><span>Admin</span><span>Marketplace</span><span>Listing</span></div>
          <div className="mp-compliance-row">
            <div className="mp-compliance-bar"><div className={`mp-compliance-fill ${item?.is_verified ? 'valid' : 'expiring'}`} style={{width: item?.is_verified ? '90%' : '62%'}}/></div>
            <div className={`mp-compliance-label ${item?.is_verified ? 'green' : 'yellow'}`}>{item?.is_verified ? 'Valid' : 'Pending'}</div>
          </div>
          <div className="mp-card-footer">
            <div className="mp-status"><span className={`int-status-badge ${item?.status === 'Suspended' ? 'revoked' : 'active'}`}>{item?.status || 'Active'}</span><span className="int-status-badge featured">{item?.is_featured ? 'Featured' : 'Standard'}</span></div>
            <div className="mp-actions"><button className="btn small-cd" type="button" onClick={() => runAction(item.id, 'approve')}>Approve</button><button className="btn ghost-cd small" type="button" onClick={() => runAction(item.id, 'feature')}>Feature</button></div>
          </div>
        </div>
        ))}
      </section>
    </div>
  )
}
