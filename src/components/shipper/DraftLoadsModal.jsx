import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';

export default function DraftLoadsModal({ onClose, onEditDraft }) {
  const { currentUser } = useAuth();
  const [draftLoads, setDraftLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    fetchDraftLoads();
  }, []);

  const fetchDraftLoads = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads?status=draft&exclude_drafts=false`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setDraftLoads(data.loads || []);
      } else {
        setError('Failed to fetch draft loads');
      }
    } catch (err) {
      console.error('Error fetching draft loads:', err);
      setError('Error loading draft loads');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDraft = async (loadId) => {
    if (!confirm('Are you sure you want to delete this draft? This action cannot be undone.')) {
      return;
    }
    
    setDeletingId(loadId);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads/${loadId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        // Remove from list
        setDraftLoads(prev => prev.filter(load => load.load_id !== loadId));
      } else {
        const data = await response.json();
        alert(data.detail || 'Failed to delete draft');
      }
    } catch (err) {
      console.error('Error deleting draft:', err);
      alert('Error deleting draft');
    } finally {
      setDeletingId(null);
    }
  };

  const handleEditDraft = (load) => {
    onEditDraft(load);
    onClose();
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div className="modal-content" style={{
        maxWidth: '900px',
        maxHeight: '80vh',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{
          padding: '24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: '#111827' }}>
              Draft Loads
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#6b7280' }}>
              Manage your saved draft loads
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '0',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px'
            }}
            onMouseEnter={e => e.target.style.background = '#f3f4f6'}
            onMouseLeave={e => e.target.style.background = 'none'}
          >
            ×
          </button>
        </div>

        <div className="modal-body" style={{
          padding: '24px',
          overflowY: 'auto',
          maxHeight: 'calc(80vh - 180px)'
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
              <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '32px', marginBottom: '12px' }}></i>
              <p>Loading draft loads...</p>
            </div>
          ) : error ? (
            <div style={{
              padding: '16px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b'
            }}>
              <i className="fa-solid fa-exclamation-circle" style={{ marginRight: '8px' }}></i>
              {error}
            </div>
          ) : draftLoads.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              color: '#6b7280'
            }}>
              <i className="fa-solid fa-inbox" style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}></i>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600' }}>No draft loads</h3>
              <p style={{ margin: 0, fontSize: '14px' }}>All your draft loads will appear here</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {draftLoads.map(load => (
                <div
                  key={load.load_id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '20px',
                    background: '#fff',
                    transition: 'all 0.2s',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleEditDraft(load)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEditDraft(load)}
                  onMouseEnter={e => {
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                    e.currentTarget.style.borderColor = '#3b82f6';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <span style={{
                          padding: '4px 10px',
                          background: '#fef3c7',
                          color: '#92400e',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Draft
                        </span>
                        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                          ID: {load.load_id?.slice(-8) || 'N/A'}
                        </span>
                      </div>
                      <h3 style={{
                        margin: '0 0 12px 0',
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#111827'
                      }}>
                        <i className="fa-solid fa-location-dot" style={{ color: '#3b82f6', marginRight: '8px' }}></i>
                        {load.origin || 'N/A'} → {load.destination || 'N/A'}
                      </h3>
                      
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '12px',
                        marginBottom: '12px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#6b7280' }}>
                          <i className="fa-solid fa-truck" style={{ width: '16px', color: '#3b82f6' }}></i>
                          <span>{load.equipment_type || 'N/A'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#6b7280' }}>
                          <i className="fa-solid fa-weight-hanging" style={{ width: '16px', color: '#3b82f6' }}></i>
                          <span>{load.weight ? `${load.weight} lbs` : 'N/A'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#6b7280' }}>
                          <i className="fa-solid fa-calendar" style={{ width: '16px', color: '#3b82f6' }}></i>
                          <span>{formatDate(load.pickup_date)}</span>
                        </div>
                        {load.estimated_distance && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#6b7280' }}>
                            <i className="fa-solid fa-route" style={{ width: '16px', color: '#3b82f6' }}></i>
                            <span>{load.estimated_distance} miles</span>
                          </div>
                        )}
                      </div>

                      {load.additional_routes && load.additional_routes.length > 0 && (
                        <div style={{
                          padding: '12px',
                          background: '#f9fafb',
                          borderRadius: '6px',
                          marginTop: '12px'
                        }}>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '8px' }}>
                            Additional Stops ({load.additional_routes.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {load.additional_routes.map((route, idx) => (
                              <div key={idx} style={{ fontSize: '13px', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                  padding: '2px 6px',
                                  background: route.type === 'pickup' ? '#dbeafe' : '#fee2e2',
                                  color: route.type === 'pickup' ? '#1e40af' : '#991b1b',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: '600'
                                }}>
                                  {route.type?.toUpperCase() || 'STOP'}
                                </span>
                                <span>{route.location}</span>
                                {route.date && <span style={{ color: '#9ca3af' }}>• {formatDate(route.date)}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditDraft(load);
                      }}
                      style={{
                        padding: '10px 24px',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.target.style.background = '#2563eb'}
                      onMouseLeave={e => e.target.style.background = '#3b82f6'}
                    >
                      <i className="fa-solid fa-pen-to-square"></i>
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDraft(load.load_id);
                      }}
                      disabled={deletingId === load.load_id}
                      style={{
                        padding: '10px 24px',
                        background: deletingId === load.load_id ? '#9ca3af' : '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: deletingId === load.load_id ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => !e.target.disabled && (e.target.style.background = '#dc2626')}
                      onMouseLeave={e => !e.target.disabled && (e.target.style.background = '#ef4444')}
                    >
                      {deletingId === load.load_id ? (
                        <>
                          <i className="fa-solid fa-spinner fa-spin"></i>
                          Deleting...
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-trash"></i>
                          Delete
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              background: '#f3f4f6',
              color: '#374151',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.target.style.background = '#e5e7eb'}
            onMouseLeave={e => e.target.style.background = '#f3f4f6'}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
