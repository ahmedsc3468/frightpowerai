import React, { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../config';
import { auth } from '../../firebase';

export default function LoadDetailsModal({ load, onClose }) {
  const [loadDetails, setLoadDetails] = useState(load || null);
  const [loadLoading, setLoadLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [rcSigHasInk, setRcSigHasInk] = useState(false);
  const rcSigCanvasRef = React.useRef(null);
  const rcSigDrawRef = React.useRef({ drawing: false, lastX: 0, lastY: 0 });

  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [documents, setDocuments] = useState([]);

  const [uploadKind, setUploadKind] = useState('OTHER');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  const loadId = String(loadDetails?.load_id || loadDetails?.id || load?.load_id || load?.id || '').trim();

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

  const refreshLoad = async () => {
    if (!loadId) return;
    const user = auth.currentUser;
    if (!user) return;
    setLoadLoading(true);
    setLoadError('');
    try {
      const token = await user.getIdToken();
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

  const fetchDocs = async () => {
    if (!loadId) return;
    const user = auth.currentUser;
    if (!user) return;
    setDocsLoading(true);
    setDocsError('');
    try {
      const token = await user.getIdToken();
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
  }, [loadId]);

  useEffect(() => {
    if (!loadId) return;
    initRcSigCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId]);

  const onUploadDoc = async (file) => {
    if (!loadId || !file) return;
    const user = auth.currentUser;
    if (!user) return;
    setUploading(true);
    setUploadError('');
    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append('file', file);
      form.append('kind', uploadKind);

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

  const carrierSignRateConfirmation = async () => {
    if (!loadId) return;
    const user = auth.currentUser;
    if (!user) return;
    setSigning(true);
    setSignError('');
    try {
      const token = await user.getIdToken();
      const signerName = String(user?.displayName || user?.email || '').trim() || undefined;

      const canvas = rcSigCanvasRef.current;
      const signatureDataUrl = canvas ? canvas.toDataURL('image/png') : '';
      if (!rcSigHasInk || !signatureDataUrl) {
        setSignError('Signature is required.');
        return;
      }

      const res = await fetch(`${API_URL}/loads/${encodeURIComponent(loadId)}/rate-confirmation/carrier-sign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signer_name: signerName, signature_data_url: signatureDataUrl }),
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

  const initRcSigCanvas = () => {
    const canvas = rcSigCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = 520;
    const cssH = 160;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.clearRect(0, 0, cssW, cssH);
    setRcSigHasInk(false);
  };

  const clearRcSig = () => {
    initRcSigCanvas();
  };

  const rcSigPointerDown = (e) => {
    const canvas = rcSigCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? 0) - rect.top;
    rcSigDrawRef.current = { drawing: true, lastX: x, lastY: y };
  };

  const rcSigPointerMove = (e) => {
    const canvas = rcSigCanvasRef.current;
    if (!canvas) return;
    if (!rcSigDrawRef.current.drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? 0) - rect.top;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(rcSigDrawRef.current.lastX, rcSigDrawRef.current.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    rcSigDrawRef.current.lastX = x;
    rcSigDrawRef.current.lastY = y;
    setRcSigHasInk(true);
  };

  const rcSigPointerUp = () => {
    rcSigDrawRef.current.drawing = false;
  };

  if (!loadId) return null;

  return (
    <div
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
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 16,
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>Load Details</div>
            <div style={{ marginTop: 2, color: '#6b7280', fontSize: 13 }}>Load: {loadId}</div>
          </div>
          <button className="btn small ghost-cd" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loadError && (
            <div style={{ padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>{loadError}</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Info label="Status" value={String(loadDetails?.status || 'N/A')} />
            <Info label="Workflow" value={String(loadDetails?.workflow_status || 'N/A')} />
            <Info label="Assigned Driver" value={String(loadDetails?.assigned_driver_name || (loadDetails?.assigned_driver ? 'Assigned' : 'N/A'))} />
            <Info label="Shipper" value={String(loadDetails?.shipper_company_name || loadDetails?.shipper_name || 'N/A')} />
            <Info label="Origin" value={String(loadDetails?.origin || 'N/A')} />
            <Info label="Destination" value={String(loadDetails?.destination || 'N/A')} />
            <Info label="Pickup" value={String(loadDetails?.pickup_date || 'TBD')} />
            <Info label="Delivery" value={String(loadDetails?.delivery_date || 'TBD')} />
          </div>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, color: '#111827' }}>Rate Confirmation Signatures</div>
                <div style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>Carrier signs after shipper.</div>
              </div>
              <button
                className="btn small-cd"
                type="button"
                onClick={carrierSignRateConfirmation}
                disabled={signing || Boolean(rcSignature?.carrierSignedAt) || loadLoading || !rcSigHasInk}
              >
                {rcSignature?.carrierSignedAt ? 'Carrier Signed' : signing ? 'Signing…' : 'Sign RC (Carrier)'}
              </button>
            </div>

            {signError && (
              <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>{signError}</div>
            )}

            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Info label="Shipper Signed" value={rcSignature?.shipperSignedAt ? 'Yes' : 'No'} />
              <Info label="Carrier Signed" value={rcSignature?.carrierSignedAt ? 'Yes' : 'No'} />
            </div>

            {!rcSignature?.carrierSignedAt && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8 }}>Signature (draw)</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <canvas
                      ref={rcSigCanvasRef}
                      onPointerDown={rcSigPointerDown}
                      onPointerMove={rcSigPointerMove}
                      onPointerUp={rcSigPointerUp}
                      onPointerLeave={rcSigPointerUp}
                      style={{ background: '#ffffff', borderRadius: 10, border: '1px solid #e5e7eb', touchAction: 'none' }}
                    />
                    <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                      {rcSigHasInk ? 'Signature captured.' : 'Draw your signature in the box.'}
                    </div>
                  </div>
                  <button className="btn small ghost-cd" type="button" onClick={clearRcSig}>
                    Clear
                  </button>
                </div>
              </div>
            )}
          </section>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, color: '#111827' }}>Rate Confirmation</div>
                <div style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>Open the RC before signing.</div>
              </div>
              {rcDoc?.url ? (
                <a href={rcDoc.url} target="_blank" rel="noreferrer" className="btn small ghost-cd">
                  Open RC
                </a>
              ) : (
                <span style={{ color: '#6b7280', fontSize: 13 }}>No RC uploaded yet.</span>
              )}
            </div>
          </section>

          <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, color: '#111827' }}>Documents</div>
                <div style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>Load-linked document vault.</div>
              </div>
              <button className="btn small ghost-cd" type="button" onClick={fetchDocs} disabled={docsLoading}>
                {docsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {docsError && (
              <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>{docsError}</div>
            )}

            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <select
                value={uploadKind}
                onChange={(e) => setUploadKind(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: 'white' }}
                disabled={uploading}
              >
                <option value="OTHER">Other</option>
                <option value="BOL">BOL</option>
                <option value="POD">POD</option>
                <option value="RATE_CONFIRMATION">Rate Confirmation</option>
              </select>
              <label className={`btn small-cd ${uploading ? 'disabled' : ''}`} style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                {uploading ? 'Uploading…' : 'Upload'}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) onUploadDoc(f);
                  }}
                  disabled={uploading}
                  style={{ display: 'none' }}
                />
              </label>
              {uploadError && <span style={{ color: '#991b1b', fontSize: 13 }}>{uploadError}</span>}
            </div>

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(documents || []).length === 0 ? (
                <div style={{ color: '#6b7280' }}>No documents uploaded yet.</div>
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
                        <div style={{ fontWeight: 700, color: '#111827' }}>{kind}</div>
                        <div style={{ color: '#6b7280', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {filename || '—'}
                        </div>
                      </div>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="btn small ghost-cd">
                          Open
                        </a>
                      ) : (
                        <span style={{ color: '#6b7280' }}>No URL</span>
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
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 700, color: '#111827', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}
