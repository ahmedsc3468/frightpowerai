import React, { useMemo, useState, useEffect } from 'react';
import '../../styles/carrier/MyLoads.css';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';
import AddLoads from '../carrier/AddLoads';
import { useLocation } from 'react-router-dom';
import LoadDetailsModal from './LoadDetailsModal';

// Map backend statuses to columns
const statusToColumn = {
  'draft': 'draft',
  'posted': 'tendered',
  'tendered': 'tendered',
  'covered': 'accepted',
  'accepted': 'accepted',
  'awarded': 'accepted',
  'dispatched': 'accepted',
  'in_transit': 'inTransit',
  'delivered': 'delivered',
  'completed': 'settled',
  'cancelled': 'cancelled'
};

// Modal to display remaining loads in a grid
function LoadsModal({ title, items, onClose, onItemClick }) {
  return (
    <div className="loads-modal-overlay" onClick={onClose}>
      <div className="loads-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="loads-modal-header">
          <h3>{title} Loads</h3>
          <button className="loads-modal-close" onClick={onClose}>
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div className="loads-modal-grid">
          {items.length === 0 ? (
            <div style={{padding: '40px', textAlign: 'center', color: '#9ca3af', gridColumn: '1 / -1'}}>
              No additional loads
            </div>
          ) : (
            items.map((it) => (
              <div
                className="loads-modal-card"
                key={it.id}
                onClick={() => onItemClick && onItemClick(it)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  onItemClick && onItemClick(it);
                }}
                style={{ cursor: onItemClick ? 'pointer' : 'default' }}
              >
                <div className="ml-card-top">
                  <div className="ml-id">{it.id}</div>
                  <div className="ml-tag">{it.status}</div>
                </div>
                <div className="ml-card-body">
                  <div className="ml-route"><span className="ml-dot green" />{it.origin}</div>
                  <div className="ml-route"><span className="ml-dot red" />{it.destination}</div>

                  {it.equipment && (
                    <div className="ml-broker">{it.equipment} • {it.weight ? `${it.weight} lbs` : 'N/A'}</div>
                  )}

                  {it.driver && (
                    <div className="ml-driver-row">
                      <div className="muted">Driver: {it.driver}</div>
                      <div className="ml-price">{it.price}</div>
                    </div>
                  )}

                  {it.invoice && <div className="muted">Invoice: {it.invoice}</div>}

                  {it.pickup && (
                    <div className="ml-pickup-row">
                      <div className="ml-pickup muted">Pickup: {it.pickup}</div>
                      <div className="ml-price">{it.price}</div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Column({ title, items, isLoading, onItemClick, onViewMore }) {
  const key = title ? title.toLowerCase() : '';
  const isTender = key === 'tendered' || key.includes('tender');
  const isAccepted = key === 'accepted' || key.includes('accept') || key.includes('covered') || key.includes('assign');
  const isInTransit = key === 'in transit' || key.includes('transit') || key.includes('in transit');
  const isDelivered = key === 'delivered' || key.includes('deliver');
  const isPod = key === 'pod' || key.includes('pod');
  const isInvoiced = key === 'invoiced' || key.includes('invoice') || key.includes('invoiced');
  const isSettled = key === 'settled' || key.includes('settled');
  const isDraft = key === 'draft' || key.includes('draft');

  // Show only the latest load in the column; remaining are in a modal.
  const displayItem = items.length > 0 ? items[0] : null;
  const remainingCount = Math.max(0, (items?.length || 0) - 1);
  const hasMore = remainingCount > 0;
  
  return (
    <div className={`ml-column ${isTender ? 'tender-column' : ''} ${isAccepted ? 'accepted-column' : ''} ${isInTransit ? 'in-transit-column' : ''} ${isDelivered ? 'delivered-column' : ''} ${isPod ? 'pod-column' : ''} ${isInvoiced ? 'invoiced-column' : ''} ${isSettled ? 'settled-column' : ''} ${isDraft ? 'draft-column' : ''}`}>
      <div className="ml-column-inner">
        <div className="ml-column-header">
          <h4>{title}</h4>
          <span className="ml-count">{items.length}</span>
        </div>
        <div className="ml-column-list">
          {isLoading ? (
            <div style={{padding: '20px', textAlign: 'center', color: '#6b7280'}}>Loading...</div>
          ) : !displayItem ? (
            <div style={{padding: '20px', textAlign: 'center', color: '#9ca3af'}}>No loads</div>
          ) : (
            <>
              <div 
                className={`ml-card ${isTender ? 'tender-card' : ''} ${isAccepted ? 'accepted-card' : ''} ${isInTransit ? 'in-transit-card' : ''} ${isDelivered ? 'delivered-card' : ''} ${isPod ? 'pod-card' : ''} ${isInvoiced ? 'invoiced-card' : ''} ${isSettled ? 'settled-card' : ''} ${isDraft ? 'draft-card' : ''}`} 
                key={displayItem.id} 
                role="article"
                onClick={() => {
                  if (hasMore) {
                    onViewMore && onViewMore();
                    return;
                  }
                  onItemClick && onItemClick(displayItem);
                }}
                style={{cursor: (hasMore && onViewMore) || onItemClick ? 'pointer' : 'default'}}
              >
                <div className="ml-card-top">
                  <div className="ml-id">{displayItem.id}</div>
                  <div className="ml-tag">{displayItem.status}</div>
                </div>
                <div className="ml-card-body">
                  <div className="ml-route"><span className="ml-dot green" />{displayItem.origin}</div>
                  <div className="ml-route"><span className="ml-dot red" />{displayItem.destination}</div>
                  
                  {displayItem.equipment && (
                    <div className="ml-broker">{displayItem.equipment} • {displayItem.weight ? `${displayItem.weight} lbs` : 'N/A'}</div>
                  )}

                  {isAccepted && displayItem.assigned_carrier_name && (
                    <div className="ml-driver-row">
                      <div className="muted">Carrier: {displayItem.assigned_carrier_name}</div>
                      <div className="ml-price">{displayItem.price}</div>
                    </div>
                  )}

                  {!isTender && !isAccepted && displayItem.driver && (
                    <div className="ml-driver-row">
                      <div className="muted">Driver: {displayItem.driver}</div>
                      <div className="ml-price">{displayItem.price}</div>
                    </div>
                  )}

                  {displayItem.invoice && <div className="muted">Invoice: {displayItem.invoice}</div>}

                  {isTender && displayItem.pickup && (
                    <div className="ml-pickup-row">
                      <div className="ml-pickup muted">Pickup: {displayItem.pickup}</div>
                      <div className="ml-price">{displayItem.price}</div>
                    </div>
                  )}
                </div>
              </div>

              {hasMore ? (
                <div
                  className="ml-view-more"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewMore && onViewMore();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    onViewMore && onViewMore();
                  }}
                >
                  +{remainingCount} more
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ShipperMyLoads() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [loads, setLoads] = useState({
    draft: [],
    tendered: [],
    accepted: [],
    inTransit: [],
    delivered: [],
    pod: [],
    invoiced: [],
    settled: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(null); // { key, title }

  // Resume draft load posting
  const [showAddLoads, setShowAddLoads] = useState(false);
  const [editingDraftLoad, setEditingDraftLoad] = useState(null);

  // Load details modal
  const [showLoadDetails, setShowLoadDetails] = useState(false);
  const [detailsLoad, setDetailsLoad] = useState(null);

  // Fetch loads from backend
  useEffect(() => {
    if (currentUser) {
      fetchLoads();
    }
  }, [currentUser]);

  const fetchLoads = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      if (!currentUser) {
        throw new Error('Not authenticated');
      }
      
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads?exclude_drafts=false`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch loads');
      }

      const data = await response.json();
      
      // Group loads by status into columns
      const grouped = {
        draft: [],
        tendered: [],
        accepted: [],
        inTransit: [],
        delivered: [],
        pod: [],
        invoiced: [],
        settled: []
      };

      (data.loads || []).forEach(load => {
        const status = load.status || load.load_status || 'draft';
        const columnKey = statusToColumn[status.toLowerCase()] || 'draft';
        
        if (grouped[columnKey] !== undefined) {
          grouped[columnKey].push({
            id: load.load_id || load.id,
            origin: load.origin || `${load.origin_city || ''}, ${load.origin_state || ''}`.trim() || 'N/A',
            destination: load.destination || `${load.destination_city || ''}, ${load.destination_state || ''}`.trim() || 'N/A',
            status: status,
            equipment: load.equipment_type || 'N/A',
            weight: load.weight,
            price: load.rate ? `$${load.rate}` : 'N/A',
            pickup: load.pickup_date || 'TBD',
            driver: load.assigned_driver_name || load.driver_name,
            invoice: load.invoice_number,
            assigned_carrier_name: load.assigned_carrier_name,
            ...load
          });
        }
      });

      const recency = (l) => {
        const ts = Number(l?.updated_at || l?.workflow_status_updated_at || l?.created_at || l?.posted_at || 0);
        return Number.isFinite(ts) ? ts : 0;
      };

      Object.keys(grouped).forEach((k) => {
        grouped[k] = (grouped[k] || []).slice().sort((a, b) => recency(b) - recency(a));
      });

      setLoads(grouped);
    } catch (err) {
      console.error('Error fetching loads:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenDraft = (draft) => {
    if (!draft) return;
    const loadId = draft.load_id || draft.id;
    setEditingDraftLoad(loadId ? { ...draft, load_id: loadId } : draft);
    setShowAddLoads(true);
  };

  const handleOpenDetails = (load) => {
    if (!load) return;
    setDetailsLoad(load);
    setShowLoadDetails(true);
  };

  const flatLoads = useMemo(() => {
    const out = [];
    for (const arr of Object.values(loads || {})) {
      if (Array.isArray(arr)) out.push(...arr);
    }
    return out;
  }, [loads]);

  // Deep-link support: /shipper-dashboard?nav=my-loads&load_id=FP-...
  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      const wanted = String(qs.get('load_id') || '').trim();
      if (!wanted) return;
      if (isLoading) return;

      const found = flatLoads.find((l) => String(l?.load_id || l?.id || '').trim() === wanted);
      if (found) {
        setDetailsLoad(found);
        setShowLoadDetails(true);
      }
    } catch {
      // ignore
    }
  }, [location.search, isLoading, flatLoads]);

  const columns = [
    { title: 'Draft', key: 'draft', items: loads.draft },
    { title: 'Tendered', key: 'tendered', items: loads.tendered },
    { title: 'Assigned', key: 'accepted', items: loads.accepted },
    { title: 'In Transit', key: 'inTransit', items: loads.inTransit },
    { title: 'Delivered', key: 'delivered', items: loads.delivered },
    { title: 'POD', key: 'pod', items: loads.pod },
    { title: 'Invoiced', key: 'invoiced', items: loads.invoiced },
    { title: 'Settled', key: 'settled', items: loads.settled }
  ];

  return (
    <div className="ml-root">
      <header className="fp-header">
        <div className="fp-header-titles">
          <h2>My Loads</h2>
          <p className="fp-subtitle">Manage and track all your loads</p>
        </div>
      </header>

      {error && (
        <div style={{ padding: '20px', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', margin: '20px' }}>
          Error: {error}
        </div>
      )}

      <div className="ml-board">
        {columns.map(col => (
          <Column
            key={col.key}
            title={col.title}
            items={col.items}
            isLoading={isLoading}
            onItemClick={col.key === 'draft' ? handleOpenDraft : handleOpenDetails}
            onViewMore={() => {
              if (!col.items || col.items.length <= 1) return;
              setModalOpen({ key: col.key, title: col.title });
            }}
          />
        ))}
      </div>

      {modalOpen ? (
        <LoadsModal
          title={modalOpen.title}
          items={(loads?.[modalOpen.key] || []).slice(1)}
          onClose={() => setModalOpen(null)}
          onItemClick={(it) => {
            setModalOpen(null);
            const opener = modalOpen.key === 'draft' ? handleOpenDraft : handleOpenDetails;
            opener && opener(it);
          }}
        />
      ) : null}

      {showAddLoads && (
        <AddLoads
          isShipper={true}
          draftLoad={editingDraftLoad}
          onClose={() => {
            setShowAddLoads(false);
            setEditingDraftLoad(null);
            fetchLoads();
          }}
        />
      )}

      {showLoadDetails && detailsLoad && (
        <LoadDetailsModal
          load={detailsLoad}
          onClose={() => {
            setShowLoadDetails(false);
            setDetailsLoad(null);
          }}
        />
      )}
    </div>
  );
}

