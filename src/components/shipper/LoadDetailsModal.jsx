import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';

export default function LoadDetailsModal({ load, onClose }) {
  const { currentUser } = useAuth();
  const [loadDetails, setLoadDetails] = useState(load || null);
  const [loadLoading, setLoadLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  const loadId = String(loadDetails?.load_id || loadDetails?.id || load?.load_id || load?.id || '').trim();

  const refreshLoad = async () => {
    if (!currentUser || !loadId) return;
    setLoadLoading(true);
    setLoadError('');
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/loads/${encodeURIComponent(loadId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        setLoadError('Failed to load details');
        return;
      }
      const data = await res.json();
      setLoadDetails(data?.load || data);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load details');
    } finally {
      setLoadLoading(false);
    }
  };

  const rcDoc = useMemo(() => {
    const doc = (documents || []).find((d) => String(d?.kind || '').toUpperCase() === 'RATE_CONFIRMATION');
    if (doc) return doc;
    const url = String(loadDetails?.rate_confirmation_url || '').trim();
    return url ? { kind: 'RATE_CONFIRMATION', url, filename: 'Rate Confirmation' } : null;
  }, [documents, loadDetails?.rate_confirmation_url]);

  const rcSignature = useMemo(() => {
    const contract = loadDetails?.contract;
    const rc = contract?.rate_confirmation;
    return {
      shipperSignedAt: rc?.shipper_signed_at || null,
      carrierSignedAt: rc?.carrier_signed_at || null,
    };
  }, [loadDetails?.contract]);

  const fetchDocs = async () => {
    if (!currentUser || !loadId) return;
    setDocsLoading(true);
    setDocsError('');
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/loads/${encodeURIComponent(loadId)}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setDocuments([]);
        setDocsError('Failed to load documents');
        return;
      }
      const data = await res.json();
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
    } catch (e) {
      setDocuments([]);
      setDocsError(e?.message || 'Failed to load documents');
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    setLoadDetails(load || null);
  }, [load]);

  useEffect(() => {
    refreshLoad();
    fetchDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, loadId]);

  const onUploadRateConfirmation = async (file) => {
    if (!currentUser || !loadId || !file) return;
    setUploading(true);
    setUploadError('');
    try {
      const token = await currentUser.getIdToken();
      const form = new FormData();
      form.append('file', file);
      form.append('kind', 'RATE_CONFIRMATION');

      const res = await fetch(`${API_URL}/loads/${encodeURIComponent(loadId)}/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        let msg = 'Upload failed';
        try {
          const err = await res.json();
          msg = err?.detail || err?.message || msg;
        } catch {
          // ignore
        }
        setUploadError(msg);
        return;
      }

      await fetchDocs();
      await refreshLoad();
    } catch (e) {
      setUploadError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const shipperSignRateConfirmation = async () => {
    if (!currentUser || !loadId) return;
    setSigning(true);
    setSignError('');
    try {
      const token = await currentUser.getIdToken();
      const signerName = String(currentUser?.displayName || currentUser?.email || '').trim() || undefined;
      const res = await fetch(`${API_URL}/loads/${encodeURIComponent(loadId)}/rate-confirmation/shipper-sign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signer_name: signerName }),
      });
      if (!res.ok) {
        let msg = 'Failed to sign';
        try {
          const err = await res.json();
          msg = err?.detail || err?.message || msg;
        } catch {
          // ignore
        }
        setSignError(msg);
        return;
      }

      await refreshLoad();
      await fetchDocs();
    } catch (e) {
      setSignError(e?.message || 'Failed to sign');
    } finally {
      setSigning(false);
    }
  };

  if (!loadId) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 10000,
      }}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          width: 'min(920px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          border: '1px solid #e5e7eb',
        }}
      >
        <div
          className="modal-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 16,
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>Load Details</div>
            <div className="muted" style={{ marginTop: 2 }}>Load: {loadId}</div>
          </div>
          <button className="btn small ghost-cd" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="modal-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loadError && (
            <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
              {loadError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Info label="Status" value={String(loadDetails?.status || loadDetails?.load_status || 'N/A')} />
            <Info label="Assigned Carrier" value={String(loadDetails?.assigned_carrier_name || 'N/A')} />
            <Info label="Origin" value={String(loadDetails?.origin || loadDetails?.load_origin || 'N/A')} />
            <Info label="Destination" value={String(loadDetails?.destination || loadDetails?.load_destination || 'N/A')} />
            <Info label="Pickup" value={String(loadDetails?.pickup_date || loadDetails?.pickup || 'TBD')} />
            <Info label="Delivery" value={String(loadDetails?.delivery_date || loadDetails?.delivery || 'TBD')} />
          </div>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: '#111827' }}>Rate Confirmation Signatures</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  Shipper signs first; carrier signs to dispatch.
                </div>
              </div>
              <button
                className="btn small-cd"
                type="button"
                onClick={shipperSignRateConfirmation}
                disabled={signing || Boolean(rcSignature?.shipperSignedAt) || loadLoading}
              >
                {rcSignature?.shipperSignedAt ? 'Shipper Signed' : signing ? 'Signing…' : 'Sign RC (Shipper)'}
              </button>
            </div>

            {signError && (
              <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
                {signError}
              </div>
            )}

            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Info label="Shipper Signed" value={rcSignature?.shipperSignedAt ? 'Yes' : 'No'} />
              <Info label="Carrier Signed" value={rcSignature?.carrierSignedAt ? 'Yes' : 'No'} />
            </div>
          </section>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, color: '#111827' }}>Rate Confirmation</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  Upload an RC so the carrier can review and sign.
                </div>
              </div>
              <label className={`btn small-cd ${uploading ? 'disabled' : ''}`} style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                {uploading ? 'Uploading…' : 'Upload RC'}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onUploadRateConfirmation(f);
                  }}
                  disabled={uploading}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {uploadError && (
              <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
                {uploadError}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              {rcDoc?.url ? (
                <a href={rcDoc.url} target="_blank" rel="noreferrer" className="btn small ghost-cd">
                  Open Rate Confirmation
                </a>
              ) : (
                <div className="muted">No rate confirmation document uploaded yet.</div>
              )}
            </div>
          </section>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, color: '#111827' }}>Documents</div>
              <button className="btn small ghost-cd" type="button" onClick={fetchDocs} disabled={docsLoading}>
                {docsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {docsError && (
              <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
                {docsError}
              </div>
            )}

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(documents || []).length === 0 ? (
                <div className="muted">No documents uploaded yet.</div>
              ) : (
                (documents || []).map((d) => {
                  const url = String(d?.url || '').trim();
                  const kind = String(d?.kind || 'OTHER');
                  const filename = String(d?.filename || '').trim();
                  return (
                    <div
                      key={String(d?.doc_id || d?.id || `${kind}-${filename}`)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>{kind}</div>
                        <div className="muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {filename || '—'}
                        </div>
                      </div>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="btn small ghost-cd">
                          Open
                        </a>
                      ) : (
                        <span className="muted">No URL</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div style={{ padding: 10, border: '1px solid #e5e7eb', borderRadius: 10 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontWeight: 600, color: '#111827', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}
