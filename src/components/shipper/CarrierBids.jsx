import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';
import '../../styles/shipper/CarrierBids.css';

export default function CarrierBids() {
  const { currentUser } = useAuth();
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all'); // all, pending, accepted, rejected

  useEffect(() => {
    if (currentUser) {
      fetchBids();
    }
  }, [currentUser]);

  const fetchBids = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/shipper/bids`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setBids(data.bids || []);
      } else {
        console.error('Failed to fetch bids');
        setBids([]);
      }
    } catch (error) {
      console.error('Error fetching bids:', error);
      setBids([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'N/A';
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    const hours = Math.floor(diff / 3600);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const minutes = Math.floor(diff / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6' }}></i>
        <p style={{ marginTop: '10px', color: '#64748b' }}>Loading bids...</p>
      </div>
    );
  }

  return (
    <div className="carrier-bids-container">
      <header className="fp-header">
        <div className="fp-header-titles">
          <h2>Carrier Bids</h2>
          <p className="fp-subtitle">Review and manage bids from carriers on your loads</p>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="bids-filters">
        <button
          className={`filter-tab ${filterStatus === 'all' ? 'active' : ''}`}
          onClick={() => setFilterStatus('all')}
        >
          All Bids ({bids.filter(b => filterStatus === 'all' || b.status === filterStatus).length})
        </button>
        <button
          className={`filter-tab ${filterStatus === 'pending' ? 'active' : ''}`}
          onClick={() => setFilterStatus('pending')}
        >
          Pending ({bids.filter(b => b.status === 'pending').length})
        </button>
        <button
          className={`filter-tab ${filterStatus === 'accepted' ? 'active' : ''}`}
          onClick={() => setFilterStatus('accepted')}
        >
          Accepted ({bids.filter(b => b.status === 'accepted').length})
        </button>
        <button
          className={`filter-tab ${filterStatus === 'rejected' ? 'active' : ''}`}
          onClick={() => setFilterStatus('rejected')}
        >
          Rejected ({bids.filter(b => b.status === 'rejected').length})
        </button>
      </div>

      {/* Bids List */}
      <section className="bids-section">
        {(() => {
          const filteredBids = filterStatus === 'all' 
            ? bids 
            : bids.filter(bid => bid.status === filterStatus);
          return filteredBids.length === 0 ? (
          <div className="no-bids">
            <i className="fa-solid fa-inbox" style={{ fontSize: '3rem', color: '#cbd5e1', marginBottom: '20px' }}></i>
            <h3>No bids found</h3>
            <p className="muted">When carriers bid on your loads, they will appear here.</p>
          </div>
          ) : (
            <div className="bids-list">
              {filteredBids.map((bid) => (
              <div key={bid.offer_id} className={`bid-card ${bid.status}`}>
                <div className="bid-header">
                  <div className="bid-route">
                    <div className="route-cities">
                      <span className="origin">{bid.load_origin}</span>
                      <i className="fa-solid fa-arrow-right route-arrow" />
                      <span className="destination">{bid.load_destination}</span>
                    </div>
                    <div className="load-id">Load: {bid.load_id}</div>
                  </div>
                  <div className={`bid-status-badge status-${bid.status}`}>
                    {bid.status.charAt(0).toUpperCase() + bid.status.slice(1)}
                  </div>
                </div>

                <div className="bid-body">
                  <div className="bid-carrier-info">
                    <div className="carrier-name">
                      <i className="fa-solid fa-truck" style={{ marginRight: '8px', color: '#3b82f6' }}></i>
                      <strong>{bid.carrier_name}</strong>
                    </div>
                    <div className="carrier-id muted">ID: {bid.carrier_id.substring(0, 8)}...</div>
                  </div>

                  <div className="bid-details">
                    <div className="bid-rate">
                      <div className="rate-label">Bid Amount</div>
                      <div className="rate-value">${bid.rate.toLocaleString()}</div>
                    </div>
                    {bid.eta && (
                      <div className="bid-eta">
                        <div className="eta-label">Estimated Delivery</div>
                        <div className="eta-value">{bid.eta}</div>
                      </div>
                    )}
                    <div className="bid-time">
                      <div className="time-label">Submitted</div>
                      <div className="time-value">{formatTimeAgo(bid.submitted_at)}</div>
                      <div className="time-full muted">{formatDate(bid.submitted_at)}</div>
                    </div>
                  </div>

                  {bid.notes && (
                    <div className="bid-notes">
                      <div className="notes-label">Notes:</div>
                      <div className="notes-content">{bid.notes}</div>
                    </div>
                  )}

                  <div className="bid-actions">
                    {bid.status === 'pending' && (
                      <>
                        <button className="btn small-cd" onClick={() => handleAcceptBid(bid)}>
                          Accept Bid
                        </button>
                        <button className="btn small ghost-cd" onClick={() => handleRejectBid(bid)}>
                          Reject
                        </button>
                      </>
                    )}
                    <button className="btn small ghost-cd" onClick={() => viewLoadDetails(bid.load_id)}>
                      View Load Details
                    </button>
                  </div>
                </div>
              </div>
              ))}
            </div>
          );
        })()}
      </section>
    </div>
  );

  // Note: There is no standalone /loads/:id route in the app.
  // Deep-link into the dashboard instead.
  function viewLoadDetails(loadId) {
    const id = String(loadId || '').trim();
    if (!id) return;
    window.location.href = `/shipper-dashboard?nav=my-loads&load_id=${encodeURIComponent(id)}`;
  }

  async function handleAcceptBid(bid) {
    if (!currentUser) return;
    
    if (!confirm(`Accept bid of $${bid.rate} from ${bid.carrier_name}?`)) {
      return;
    }

    try {
      const token = await currentUser.getIdToken();
      
      // Log the request for debugging
      const requestBody = {
        offer_id: bid.offer_id,
        carrier_id: bid.carrier_id,
        carrier_name: bid.carrier_name
      };
      console.log('Accepting bid - Request body:', requestBody);
      console.log('Bid object:', bid);
      
      const response = await fetch(`${API_URL}/loads/${bid.load_id}/accept-carrier`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log('Response status:', response.status, response.statusText);

      if (response.ok) {
        alert('Bid accepted successfully! The load has been assigned to the carrier.');
        fetchBids(); // Refresh bids to show updated status
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || JSON.stringify(errorData);
          console.error('Accept bid error response:', errorData);
        } catch (parseError) {
          const text = await response.text();
          errorMessage = text || `HTTP ${response.status}: ${response.statusText}`;
          console.error('Failed to parse error response:', parseError, 'Raw response:', text);
        }
        alert(`Failed to accept bid: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Error accepting bid:', error);
      alert(`Failed to accept bid: ${error.message || 'Please try again.'}`);
    }
  }

  async function handleRejectBid(bid) {
    if (!currentUser) return;
    
    if (!confirm(`Reject bid from ${bid.carrier_name}?`)) {
      return;
    }

    try {
      const token = await currentUser.getIdToken();
      
      // Log the request for debugging
      const requestBody = {
        offer_id: bid.offer_id,
        carrier_id: bid.carrier_id,
        reason: `Shipper rejected bid from ${bid.carrier_name}`
      };
      console.log('Rejecting bid - Request body:', requestBody);
      console.log('Bid object:', bid);
      
      const response = await fetch(`${API_URL}/loads/${bid.load_id}/reject-offer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Response status:', response.status, response.statusText);

      if (response.ok) {
        alert('Bid rejected successfully');
        fetchBids(); // Refresh bids to show updated status
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || JSON.stringify(errorData);
          console.error('Reject bid error response:', errorData);
        } catch (parseError) {
          const text = await response.text();
          errorMessage = text || `HTTP ${response.status}: ${response.statusText}`;
          console.error('Failed to parse error response:', parseError, 'Raw response:', text);
        }
        alert(`Failed to reject bid: ${errorMessage}`);
      }
    } catch (error) {
      console.error('Error rejecting bid:', error);
      alert(`Failed to reject bid: ${error.message || 'Please try again.'}`);
    }
  }
}

