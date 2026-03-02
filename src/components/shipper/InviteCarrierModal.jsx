import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';

export default function InviteCarrierModal({ isOpen, onClose, onInviteSent }) {
  const { currentUser } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loadId, setLoadId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [carriers, setCarriers] = useState([]);
  const [selectedCarrier, setSelectedCarrier] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [inviteMode, setInviteMode] = useState('marketplace'); // 'marketplace' or 'email'

  // Fetch carriers from marketplace
  useEffect(() => {
    if (isOpen && inviteMode === 'marketplace' && currentUser) {
      fetchCarriers();
    }
  }, [isOpen, inviteMode, currentUser]);

  const fetchCarriers = async () => {
    setLoadingCarriers(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/carriers`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCarriers(data.carriers || []);
      }
    } catch (err) {
      console.error('Error fetching carriers:', err);
    } finally {
      setLoadingCarriers(false);
    }
  };

  const filteredCarriers = carriers.filter(carrier => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (carrier.name && carrier.name.toLowerCase().includes(query)) ||
      (carrier.company_name && carrier.company_name.toLowerCase().includes(query)) ||
      (carrier.email && carrier.email.toLowerCase().includes(query)) ||
      (carrier.mc_number && carrier.mc_number.toLowerCase().includes(query)) ||
      (carrier.dot_number && carrier.dot_number.toLowerCase().includes(query))
    );
  });

  const handleSendInvite = async () => {
    if (inviteMode === 'marketplace') {
      if (!selectedCarrier) {
        setError('Please select a carrier from the marketplace');
        return;
      }
    } else {
      if (!email) {
        setError('Carrier email is required');
        return;
      }
    }

    setSending(true);
    setError('');

    try {
      const token = await currentUser.getIdToken();
      const requestBody = {
        load_id: loadId || undefined,
        message: message || undefined
      };

      if (inviteMode === 'marketplace' && selectedCarrier) {
        requestBody.carrier_id = selectedCarrier.id || selectedCarrier.uid;
        requestBody.carrier_email = selectedCarrier.email;
        requestBody.carrier_name = selectedCarrier.name || selectedCarrier.company_name;
      } else {
        requestBody.carrier_email = email;
        requestBody.carrier_name = name || undefined;
      }

      const response = await fetch(`${API_URL}/carriers/invite`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const data = await response.json();
        alert('Invitation sent successfully!');
        
        // Reset form
        setEmail('');
        setName('');
        setMessage('');
        setLoadId('');
        setSelectedCarrier(null);
        setSearchQuery('');
        
        // Notify parent component
        if (onInviteSent) {
          onInviteSent();
        }
        
        onClose();
      } else {
        const errorData = await response.json();
        const errorMessage = errorData.detail || 'Failed to send invitation';
        setError(errorMessage);
        
        // If it's a duplicate error, provide helpful message
        if (errorMessage.includes('already exists') || errorMessage.includes('pending invitation')) {
          setError(`An invitation has already been sent to this carrier. Please wait for them to respond or check your sent invitations.`);
        }
      }
    } catch (err) {
      console.error('Error sending invitation:', err);
      setError('Failed to send invitation. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = async () => {
    if (!currentUser) return;

    const carrierId = inviteMode === 'marketplace'
      ? (selectedCarrier?.id || selectedCarrier?.uid)
      : null;
    const carrierEmail = inviteMode === 'email'
      ? String(email || '').trim()
      : String(selectedCarrier?.email || '').trim();
    const carrierName = inviteMode === 'marketplace'
      ? (selectedCarrier?.name || selectedCarrier?.company_name)
      : name;

    if (inviteMode === 'marketplace' && !carrierId) {
      setError('Please select a carrier from the marketplace to generate a link.');
      return;
    }
    if (inviteMode === 'email' && !carrierEmail) {
      setError('Carrier email is required to generate a link.');
      return;
    }

    setSending(true);
    setError('');

    const requestBody = {
      load_id: loadId || undefined,
      message: message || undefined,
      carrier_id: carrierId || undefined,
      carrier_email: carrierEmail || undefined,
      carrier_name: carrierName || undefined,
    };

    try {
      const token = await currentUser.getIdToken();

      let invitationId = '';
      const resp = await fetch(`${API_URL}/carriers/invite`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (resp.ok) {
        const data = await resp.json();
        invitationId = String(data?.invitation_id || '').trim();
      } else {
        // If a pending invitation already exists, lookup the existing ID so the link can still be copied.
        let detail = '';
        try {
          const j = await resp.json();
          detail = String(j?.detail || '');
        } catch {
          try {
            detail = String(await resp.text());
          } catch {
            detail = '';
          }
        }

        const isDuplicate = resp.status === 400 && /pending invitation already exists/i.test(detail);
        if (!isDuplicate) {
          setError(detail || 'Failed to generate invite link.');
          return;
        }

        const listResp = await fetch(`${API_URL}/carriers/invitations?status=pending`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!listResp.ok) {
          setError('A pending invitation already exists, but could not be fetched to build a link.');
          return;
        }
        const listData = await listResp.json();
        const invites = Array.isArray(listData?.invitations) ? listData.invitations : [];
        const match = invites.find((inv) => {
          if (!inv || String(inv?.status || '').toLowerCase() !== 'pending') return false;
          if (carrierId) return String(inv?.carrier_id || '').trim() === String(carrierId).trim();
          return String(inv?.carrier_email || '').trim().toLowerCase() === String(carrierEmail).toLowerCase();
        });
        invitationId = String(match?.id || '').trim();
      }

      if (!invitationId) {
        setError('Failed to resolve an invitation ID for the invite link.');
        return;
      }

      const inviteLink = `${window.location.origin}/signup?role=carrier&invitation_id=${encodeURIComponent(invitationId)}`;
      await navigator.clipboard.writeText(inviteLink);
      alert('Invite link copied to clipboard!');
    } catch (err) {
      console.error('Error generating invite link:', err);
      setError('Failed to generate invite link. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="ic-modal-backdrop" role="dialog" aria-modal="true">
      <div className="ic-modal">
        <div className="ic-modal-header">
          <h3>Invite Carrier</h3>
          <button className="ic-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ic-modal-body">
          <p className="ic-sub">Send an invite to onboard or assign to a load.</p>

          {error && (
            <div style={{
              padding: '12px',
              marginBottom: '16px',
              background: '#fee2e2',
              borderRadius: '8px',
              color: '#991b1b'
            }}>
              {error}
            </div>
          )}

          {/* Mode Toggle */}
          <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
            <button
              type="button"
              onClick={() => setInviteMode('marketplace')}
              style={{
                flex: 1,
                padding: '8px 16px',
                borderRadius: '6px',
                border: inviteMode === 'marketplace' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                background: inviteMode === 'marketplace' ? '#dbeafe' : 'white',
                color: inviteMode === 'marketplace' ? '#1e40af' : '#64748b',
                cursor: 'pointer',
                fontWeight: inviteMode === 'marketplace' ? '600' : '400'
              }}
            >
              Browse Marketplace
            </button>
            <button
              type="button"
              onClick={() => setInviteMode('email')}
              style={{
                flex: 1,
                padding: '8px 16px',
                borderRadius: '6px',
                border: inviteMode === 'email' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                background: inviteMode === 'email' ? '#dbeafe' : 'white',
                color: inviteMode === 'email' ? '#1e40af' : '#64748b',
                cursor: 'pointer',
                fontWeight: inviteMode === 'email' ? '600' : '400'
              }}
            >
              Invite by Email
            </button>
          </div>

          {inviteMode === 'marketplace' ? (
            <>
              <label className="ic-label">Search Carriers <span className="required">*</span></label>
              <input 
                className="ic-input" 
                type="text" 
                value={searchQuery} 
                onChange={e => setSearchQuery(e.target.value)} 
                placeholder="Search by name, email, MC#, or DOT#" 
                disabled={sending}
              />

              {loadingCarriers ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '20px', marginRight: '8px' }}></i>
                  Loading carriers...
                </div>
              ) : (
                <div style={{ 
                  maxHeight: '180px', 
                  overflowY: 'auto', 
                  border: '1px solid #e2e8f0', 
                  borderRadius: '8px',
                  marginTop: '8px'
                }}>
                  {filteredCarriers.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                      {searchQuery ? 'No carriers found matching your search.' : 'No carriers available in the marketplace.'}
                    </div>
                  ) : (
                    filteredCarriers.map((carrier) => (
                      <div
                        key={carrier.id || carrier.uid}
                        onClick={() => setSelectedCarrier(carrier)}
                        style={{
                          padding: '12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f1f5f9',
                          background: selectedCarrier?.id === carrier.id ? '#eff6ff' : 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px'
                        }}
                      >
                        <div style={{ 
                          width: '32px', 
                          height: '32px', 
                          borderRadius: '50%', 
                          background: selectedCarrier?.id === carrier.id ? '#3b82f6' : '#e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: selectedCarrier?.id === carrier.id ? 'white' : '#64748b',
                          fontWeight: '600',
                          fontSize: '14px'
                        }}>
                          {(carrier.name || carrier.company_name || 'C').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', fontSize: '14px' }}>
                            {carrier.name || carrier.company_name || 'Unknown Carrier'}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {carrier.email} {carrier.mc_number ? `• MC: ${carrier.mc_number}` : ''}
                          </div>
                        </div>
                        {selectedCarrier?.id === carrier.id && (
                          <i className="fa-solid fa-check-circle" style={{ color: '#3b82f6' }}></i>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {selectedCarrier && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  background: '#f0f9ff',
                  borderRadius: '8px',
                  border: '1px solid #bae6fd'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '4px' }}>Selected Carrier:</div>
                  <div>{selectedCarrier.name || selectedCarrier.company_name} - {selectedCarrier.email}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="ic-label">Carrier Email <span className="required">*</span></label>
              <input 
                className="ic-input" 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="carrier@example.com" 
                disabled={sending}
              />

              <label className="ic-label">Carrier Name <span className="muted">(optional)</span></label>
              <input 
                className="ic-input" 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Carrier Company Name" 
                disabled={sending}
              />
            </>
          )}

          <label className="ic-label" style={{ marginTop: '16px' }}>Assign to Load <span className="muted">(optional)</span></label>
          <input 
            className="ic-input" 
            type="text" 
            value={loadId} 
            onChange={e => setLoadId(e.target.value)} 
            placeholder="Load ID (e.g., LOAD-ABC123)" 
            disabled={sending}
          />

          <label className="ic-label">Message <span className="muted">(optional)</span></label>
          <textarea 
            className="ic-input" 
            value={message} 
            onChange={e => setMessage(e.target.value)} 
            placeholder="Add a personal message for the carrier..." 
            rows={3}
            disabled={sending}
            style={{ resize: 'vertical' }}
          />
        </div>

        <div className="ic-modal-footer">
          <button className="btn small ghost-cd" onClick={handleCopyLink} disabled={sending}>
            Copy Invite Link
          </button>
          <div className="ic-actions">
            <button className="btn small ghost-cd" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button 
              className="btn small-cd" 
              onClick={handleSendInvite}
              disabled={sending || (inviteMode === 'marketplace' ? !selectedCarrier : !email)}
            >
              {sending ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

