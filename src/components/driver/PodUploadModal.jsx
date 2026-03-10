import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postJson } from '../../api/http';

const DEFAULT_THEME = {
  surface: '#ffffff',
  surfaceAlt: '#f8fafc',
  border: 'rgb(226, 232, 240)',
  text: '#111827',
  muted: '#6b7280',
  danger: '#dc2626',
};

const SignaturePad = React.memo(function SignaturePad({ value, onChange, disabled, clearText = 'Clear' }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const lastEmittedValueRef = useRef('');

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastEmittedValueRef.current = '';
    onChange?.('');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (value === lastEmittedValueRef.current) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = value;
  }, [value]);

  const getPoint = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const start = (e) => {
    if (disabled) return;
    drawingRef.current = true;
    lastRef.current = getPoint(e);
    e.preventDefault?.();
  };

  const move = (e) => {
    if (disabled) return;
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastRef.current = pt;
    e.preventDefault?.();
  };

  const end = () => {
    if (disabled) return;
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      lastEmittedValueRef.current = dataUrl;
      onChange?.(dataUrl);
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <canvas
        ref={canvasRef}
        width={320}
        height={120}
        style={{
          width: '100%',
          maxWidth: 320,
          height: 120,
          borderRadius: 10,
          border: '1px solid rgb(226, 232, 240)',
          background: '#fff',
          touchAction: 'none',
          opacity: disabled ? 0.6 : 1,
        }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn small ghost-cd" type="button" onClick={clear} disabled={disabled}>
          {clearText}
        </button>
      </div>
    </div>
  );
});

export default function PodUploadModal({
  open,
  load,
  onClose,
  onSuccess,
  tr,
  locale,
  theme = DEFAULT_THEME,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const DEV_BYPASS_GPS_DISTANCE = Boolean(import.meta?.env?.DEV);
  const [devToast, setDevToast] = useState('');

  const [signedAtText, setSignedAtText] = useState('');

  const [receiverName, setReceiverName] = useState('');
  const [receiverSignatureDataUrl, setReceiverSignatureDataUrl] = useState('');

  const [checks, setChecks] = useState({
    gpsOk: false,
    timeOk: false,
    confirmAccurate: false,
    confirmDelivered: false,
  });

  const [gps, setGps] = useState({ lat: null, lng: null, accuracy: null, timestamp: null });
  const [distanceMeters, setDistanceMeters] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState({ lat: null, lng: null, label: '' });

  const [loadSnapshot, setLoadSnapshot] = useState(null);
  const autoGpsAttemptedRef = useRef(false);
  const wasOpenRef = useRef(false);

  const effectiveLoad = loadSnapshot || load;

  const previewFrameRef = useRef(null);
  const lastPreviewHtmlRef = useRef('');

  const getLoadId = (l) => String(l?.load_id || l?.id || l?._id || '').trim();

  const formatLoc = (loc) => {
    if (!loc) return '';
    if (typeof loc === 'string') return loc;
    if (typeof loc === 'object') {
      const city = String(loc.city || '').trim();
      const state = String(loc.state || '').trim();
      const text = String(loc.text || '').trim();
      const label = String(loc.label || '').trim();
      const combined = [city, state].filter(Boolean).join(', ');
      return combined || text || label || '';
    }
    return String(loc);
  };

  const haversineMeters = (lat1, lng1, lat2, lng2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const computeTimeOk = useCallback((l) => {
    const raw = l?.delivery_date;
    if (!raw) return { ok: false, deliveryMs: null };
    const delivery = new Date(raw);
    const deliveryMs = delivery.getTime();
    if (!Number.isFinite(deliveryMs)) return { ok: false, deliveryMs: null };
    const nowMs = Date.now();
    const cutoffMs = deliveryMs + (48 * 60 * 60 * 1000);
    return { ok: nowMs <= cutoffMs, deliveryMs };
  }, []);

  const refreshGps = useCallback(async () => {
    setError('');
    if (!navigator?.geolocation) {
      setError(tr('myCarrier.pod.error.geolocationUnsupported', 'Geolocation is not supported on this device/browser.'));
      return;
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });
      const coords = pos?.coords;
      const lat = coords?.latitude;
      const lng = coords?.longitude;
      const accuracy = coords?.accuracy;
      if (lat == null || lng == null) {
        setError(tr('myCarrier.pod.error.gpsMissing', 'Please capture GPS location before submitting.'));
        return;
      }
      setGps({ lat, lng, accuracy: accuracy ?? null, timestamp: pos?.timestamp ?? Date.now() });
    } catch (e) {
      console.error('POD refreshGps failed', e);
      setError(tr('myCarrier.pod.error.gpsMissing', 'Please capture GPS location before submitting.'));
    }
  }, [tr]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!devToast) return;
    const id = setTimeout(() => setDevToast(''), 3500);
    return () => clearTimeout(id);
  }, [devToast]);

  const previewHtml = useMemo(() => {
    const l = loadSnapshot || {};
    const loadId = getLoadId(l);
    const loadNumber = String(l?.load_number || '').trim() || loadId || '—';
    const origin = formatLoc(l?.origin) || '—';
    const destination = formatLoc(l?.destination) || '—';
    const pickupDate = String(l?.pickup_date || '').trim() || '—';
    const deliveryDate = String(l?.delivery_date || '').trim() || '—';
    const equipment = String(l?.equipment_type || '').trim() || '—';
    const weight = l?.weight != null ? String(l.weight) : '—';
    const rcv = String(receiverName || '').trim() || '—';
    const signedAt = signedAtText || '—';
    const gpsText = (gps?.lat != null && gps?.lng != null)
      ? `${Number(gps.lat).toFixed(6)}, ${Number(gps.lng).toFixed(6)} (±${gps?.accuracy ? Math.round(gps.accuracy) : '—'}m)`
      : '—';
    const distanceText = (distanceMeters != null)
      ? `${distanceMeters.toFixed(1)} ${tr('myCarrier.pod.metersFromDelivery', 'meters from delivery')}` : '—';

    const signatureBlock = receiverSignatureDataUrl
      ? `<div class="sig-row"><div class="sig-label">${tr('myCarrier.pod.label.signatureImage', 'Receiver Signature')}</div><div class="sig-box"><img class="sig-img" src="${receiverSignatureDataUrl}" alt="Signature" /></div></div>`
      : `<div class="sig-row"><div class="sig-label">${tr('myCarrier.pod.label.signatureImage', 'Receiver Signature')}</div><div class="sig-box sig-missing">${tr('myCarrier.pod.signatureImageMissing', 'Signature not captured')}</div></div>`;

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PROOF OF DELIVERY (POD)</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 0; }
      .page { padding: 18px 22px; }
      .title { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
      .sub { margin-top: 4px; font-size: 12px; color: #374151; }
      .hr { height: 1px; background: #e5e7eb; margin: 12px 0; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
      .label { font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.04em; }
      .value { margin-top: 4px; font-size: 13px; font-weight: 600; color: #111827; }
      .value.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-weight: 500; }
      .sig { margin-top: 10px; }
      .sig-row { display: grid; grid-template-columns: 160px 1fr; gap: 10px; align-items: start; margin-top: 10px; }
      .sig-label { font-size: 12px; font-weight: 700; color: #111827; }
      .sig-box { min-height: 52px; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; }
      .sig-missing { color: #b45309; font-size: 12px; }
      .sig-img { max-height: 44px; max-width: 260px; display: block; }
      .footnote { margin-top: 12px; font-size: 10px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="title">PROOF OF DELIVERY (POD)</div>
      <div class="sub">FreightPower — Delivery confirmation for Load ${loadNumber}</div>
      <div class="hr"></div>

      <div class="grid">
        <div class="box">
          <div class="label">Load</div>
          <div class="value">#${loadNumber}</div>
          <div class="sub">Load ID: <span class="value mono">${loadId || '—'}</span></div>
        </div>
        <div class="box">
          <div class="label">Receiver</div>
          <div class="value">${rcv}</div>
          <div class="sub">Signed at: ${signedAt}</div>
        </div>
        <div class="box">
          <div class="label">Origin</div>
          <div class="value">${origin}</div>
          <div class="sub">Pickup Date: ${pickupDate}</div>
        </div>
        <div class="box">
          <div class="label">Destination</div>
          <div class="value">${destination}</div>
          <div class="sub">Delivery Date: ${deliveryDate}</div>
        </div>
        <div class="box">
          <div class="label">Equipment / Weight</div>
          <div class="value">${equipment}</div>
          <div class="sub">Weight: ${weight}</div>
        </div>
        <div class="box">
          <div class="label">GPS Proof</div>
          <div class="value mono">${gpsText}</div>
          <div class="sub">${distanceText}</div>
        </div>
      </div>

      <div class="sig">
        <div class="hr"></div>
        ${signatureBlock}
      </div>

      <div class="footnote">This is a digitally signed commercial document. False statements or misrepresentation may be subject to penalties under applicable law and contract terms.</div>
    </div>
  </body>
</html>`;
  }, [distanceMeters, gps, loadSnapshot, locale, receiverName, receiverSignatureDataUrl, signedAtText, tr]);

  // Write preview HTML into the iframe only when it actually changes.
  useEffect(() => {
    if (!open) return;
    const frame = previewFrameRef.current;
    if (!frame) return;
    if (!previewHtml) return;
    if (lastPreviewHtmlRef.current === previewHtml) return;
    lastPreviewHtmlRef.current = previewHtml;
    try {
      frame.srcdoc = previewHtml;
    } catch {
      // ignore
    }
  }, [open, previewHtml]);

  // Reset only when the modal is opened (do not reset during background refresh while open).
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setError('');
    setDevToast('');
    setSubmitting(false);
    setSignedAtText(new Date().toLocaleString(locale));
    setReceiverName('');
    setReceiverSignatureDataUrl('');
    setChecks({ gpsOk: false, timeOk: false, confirmAccurate: false, confirmDelivered: false });
    setGps({ lat: null, lng: null, accuracy: null, timestamp: null });
    setDistanceMeters(null);
    setDestinationCoords({ lat: null, lng: null, label: '' });

    const openLoad = load || null;
    const openLoadSnapshot = openLoad ? {
      load_id: getLoadId(openLoad),
      load_number: openLoad?.load_number ?? null,
      origin: openLoad?.origin ?? null,
      destination: openLoad?.destination ?? null,
      pickup_date: openLoad?.pickup_date ?? null,
      delivery_date: openLoad?.delivery_date ?? null,
      equipment_type: openLoad?.equipment_type ?? null,
      weight: openLoad?.weight ?? null,
      status: openLoad?.status ?? null,
    } : null;
    setLoadSnapshot(openLoadSnapshot);

    if (openLoadSnapshot) {
      const { ok } = computeTimeOk(openLoadSnapshot);
      setChecks((prev) => ({ ...prev, timeOk: ok }));
    }

    autoGpsAttemptedRef.current = false;

    // Best-effort geocode destination immediately.
    (async () => {
      try {
        const destText = formatLoc(openLoadSnapshot?.destination);
        if (!destText) return;
        const res = await postJson(
          '/maps/geocode',
          { address: destText, limit: 1 },
          { timeoutMs: 20000, requestLabel: 'POST /maps/geocode (pod modal)' }
        );
        const first = res?.results?.[0];
        if (first?.lat != null && first?.lng != null) {
          setDestinationCoords({ lat: first.lat, lng: first.lng, label: first.label || destText });
        }
      } catch {
        // ignore
      }
    })();
  }, [open, computeTimeOk, locale]);

  // Auto-capture GPS once per modal open.
  useEffect(() => {
    if (!open) return;
    if (autoGpsAttemptedRef.current) return;
    autoGpsAttemptedRef.current = true;
    refreshGps();
  }, [open, refreshGps]);

  // Recompute GPS check when coords change.
  useEffect(() => {
    if (!open) return;
    if (gps?.lat == null || gps?.lng == null) return;
    if (destinationCoords?.lat == null || destinationCoords?.lng == null) return;
    const meters = haversineMeters(gps.lat, gps.lng, destinationCoords.lat, destinationCoords.lng);
    setDistanceMeters(meters);
    setChecks((prev) => ({ ...prev, gpsOk: meters <= 10 }));
  }, [open, gps, destinationCoords, DEV_BYPASS_GPS_DISTANCE]);

  const submit = async () => {
    if (!effectiveLoad) return;

    const status = String(effectiveLoad?.status || '').trim().toLowerCase();
    if (status && status !== 'in_transit' && status !== 'picked_up' && status !== 'picked up' && status !== 'pickedup') {
      setError(tr('myCarrier.pod.error.onlyInTransit', 'POD submission is only allowed for an In Transit load. Start the trip first.'));
      return;
    }

    const loadId = getLoadId(effectiveLoad);
    if (!loadId) {
      setError(tr('myCarrier.error.loadIdNotFoundDot', 'Load ID not found.'));
      return;
    }

    const receiver = String(receiverName || '').trim();
    if (!receiver) {
      setError(tr('myCarrier.pod.error.receiverRequired', 'Receiver name is required.'));
      return;
    }

    if (!receiverSignatureDataUrl) {
      setError(tr('myCarrier.pod.error.signatureRequired', 'Receiver signature is required.'));
      return;
    }

    if (!checks.gpsOk) {
      setError(tr('myCarrier.pod.error.gpsCheckFailed', 'GPS check failed. You must be within 10 meters of the delivery location.'));
      if (!DEV_BYPASS_GPS_DISTANCE) return;
    }
    if (!checks.timeOk) {
      setError(tr('myCarrier.pod.error.timeCheckFailed', '48-hour check failed. POD must be submitted within 48 hours of scheduled delivery.'));
      return;
    }
    if (!checks.confirmDelivered || !checks.confirmAccurate) {
      setError(tr('myCarrier.pod.error.confirmStatements', 'Please confirm the POD statements before submitting.'));
      return;
    }

    if (gps?.lat == null || gps?.lng == null) {
      setError(tr('myCarrier.pod.error.gpsMissing', 'Please capture GPS location before submitting.'));
      return;
    }

    setSubmitting(true);

    // DEV-only: allow submission even when distance check fails.
    if (!checks.gpsOk && DEV_BYPASS_GPS_DISTANCE) {
      await new Promise((r) => setTimeout(r, 3000));
      setDevToast(tr('myCarrier.pod.gps.devBypassToast', 'Location check bypassed for development phase.'));
    } else {
      setError('');
    }
    try {
      await postJson(
        `/loads/${loadId}/delivery/complete`,
        {
          latitude: gps.lat,
          longitude: gps.lng,
          receiver_name: receiver,
          receiver_signature_data_url: receiverSignatureDataUrl,
          remarks: null,
        },
        { timeoutMs: 60000, requestLabel: `POST /loads/${loadId}/delivery/complete (pod modal)` }
      );

      onClose?.();
      await onSuccess?.();
    } catch (e) {
      setError(String(e?.message || tr('myCarrier.pod.error.submitFailed', 'Failed to submit POD')));
    } finally {
      setSubmitting(false);
    }
  };

  const loadNumberText = useMemo(() => {
    const l = effectiveLoad;
    const loadId = getLoadId(l);
    return l ? (l.load_number || loadId || '—') : '—';
  }, [effectiveLoad]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: open ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 1300, pointerEvents: open ? 'auto' : 'none' }}
      onClick={() => { if (!submitting) onClose?.(); }}
    >
      <div
        style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 1100, width: '94%', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${theme.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.pod.modal.title', 'Upload Proof of Delivery (POD)')}</h3>
            <div style={{ color: theme.muted, fontSize: 13 }}>
              {tr('myCarrier.labels.loadNumber', 'Load #')} {loadNumberText}
            </div>
          </div>
          <button
            onClick={() => { if (!submitting) onClose?.(); }}
            style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
            type="button"
          >
            {tr('common.close', 'Close')}
          </button>
        </div>

        {error && (
          <div style={{ color: theme.danger, marginBottom: 12 }}>{error}</div>
        )}

        {devToast && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${theme.border}`,
              background: theme.surfaceAlt,
              color: theme.text,
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            {devToast}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
          <div style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, borderRadius: 12, padding: 14 }}>
            <h4 style={{ margin: '0 0 10px', color: theme.text }}>{tr('myCarrier.pod.deliveryChecksTitle', 'Delivery Checks')}</h4>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.receiverName', 'Receiver Name')} *</label>
              <input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder={tr('myCarrier.pod.receiverPlaceholder', 'Receiver / warehouse contact')}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}
                disabled={submitting}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.gps.label', 'GPS (must be within 10m)')}</label>
              <button className="btn small-cd" onClick={refreshGps} disabled={submitting} type="button">
                {tr('myCarrier.pod.gps.refresh', 'Refresh GPS')}
              </button>
              <div style={{ marginTop: 8, fontSize: 12, color: theme.muted }}>
                {gps?.lat != null
                  ? `${tr('myCarrier.pod.gps.latLng', 'Lat/Lng')}: ${Number(gps.lat).toFixed(6)}, ${Number(gps.lng).toFixed(6)} (±${gps?.accuracy ? Math.round(gps.accuracy) : '—'}m)`
                  : tr('myCarrier.pod.gps.locationNotCaptured', 'Location not captured')}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: theme.muted }}>
                {destinationCoords?.lat != null
                  ? `${tr('myCarrier.pod.gps.deliveryCoords', 'Delivery coords')}: ${Number(destinationCoords.lat).toFixed(6)}, ${Number(destinationCoords.lng).toFixed(6)}`
                  : tr('myCarrier.pod.gps.deliveryCoordsUnavailable', 'Delivery coords not available (geocode failed)')}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: checks.gpsOk ? '#059669' : '#b45309' }}>
                {distanceMeters == null
                  ? `${tr('myCarrier.pod.gps.distance', 'Distance')}: —`
                  : `${tr('myCarrier.pod.gps.distance', 'Distance')}: ${distanceMeters.toFixed(1)}m`}
                {checks.gpsOk ? ` (${tr('myCarrier.pod.gps.ok', 'OK')})` : ` (${tr('myCarrier.pod.gps.needsWithin', 'needs ≤ 10m')})`}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.timeRule.label', '48-hour rule')}</label>
              <div style={{ fontSize: 12, color: checks.timeOk ? '#059669' : '#b45309' }}>
                {effectiveLoad?.delivery_date
                  ? `${tr('myCarrier.pod.timeRule.deliveryDate', 'Delivery date')}: ${effectiveLoad.delivery_date}`
                  : tr('myCarrier.pod.timeRule.deliveryDateMissing', 'Delivery date missing')}
                {checks.timeOk
                  ? ` (${tr('myCarrier.pod.timeRule.ok', 'OK')})`
                  : ` (${tr('myCarrier.pod.timeRule.mustBeWithin', 'must be within 48 hours')})`}
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: theme.text }}>
                <input type="checkbox" checked={checks.confirmDelivered} onChange={(e) => setChecks((prev) => ({ ...prev, confirmDelivered: e.target.checked }))} />
                {tr('myCarrier.pod.confirm.deliveredFull', 'I confirm the shipment was delivered in full.')}
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: theme.text }}>
                <input type="checkbox" checked={checks.confirmAccurate} onChange={(e) => setChecks((prev) => ({ ...prev, confirmAccurate: e.target.checked }))} />
                {tr('myCarrier.pod.confirm.accurate', 'I confirm the POD information is accurate.')}
              </label>
            </div>

            <div style={{ marginTop: 14, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
              <h4 style={{ margin: '0 0 10px', color: theme.text }}>{tr('myCarrier.pod.signing.title', 'Signing')}</h4>
              <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                {tr('myCarrier.pod.signing.receiverSignature', 'Receiver Signature')} *
              </label>
              <SignaturePad
                value={receiverSignatureDataUrl}
                onChange={setReceiverSignatureDataUrl}
                disabled={submitting}
                clearText={tr('common.clear', 'Clear')}
              />
            </div>

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => { if (!submitting) onClose?.(); }}
                style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}
                disabled={submitting}
                type="button"
              >
                {tr('common.cancel', 'Cancel')}
              </button>
              <button className="btn small-cd" onClick={submit} disabled={submitting} type="button">
                {submitting ? tr('myCarrier.common.submitting', 'Submitting…') : tr('myCarrier.pod.actions.uploadAndMarkDelivered', 'Upload POD & Mark Delivered')}
              </button>
            </div>
          </div>

          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', background: theme.surface }}>
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, color: theme.text }}>{tr('myCarrier.pod.preview.title', 'POD Preview')}</div>
              <div style={{ color: theme.muted, fontSize: 12 }}>{tr('myCarrier.pod.preview.hint', 'This PDF will be uploaded to the load document vault.')}</div>
            </div>
            <iframe
              ref={previewFrameRef}
              title={tr('myCarrier.pod.preview.iframeTitle', 'POD preview')}
              style={{ width: '100%', height: '70vh', border: 'none', background: '#ffffff' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
