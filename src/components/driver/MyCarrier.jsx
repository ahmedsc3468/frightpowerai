import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/driver/MyCarrier.css';
import { useAuth } from '../../contexts/AuthContext';
import { useUserSettings } from '../../contexts/UserSettingsContext';
import { API_URL } from '../../config';
import { t } from '../../i18n/translate';

export default function MyCarrier() {
  const { currentUser } = useAuth();
  const { settings: userSettings } = useUserSettings();
  const language = userSettings?.language || 'English';
  const locale = useMemo(() => {
    if (language === 'Spanish') return 'es';
    if (language === 'Arabic') return 'ar';
    return 'en';
  }, [language]);
  const tr = useCallback((key, fallback) => t(language, key, fallback), [language]);
  const calendarProvider = String(userSettings?.calendar_sync || 'Google Calendar');
  const [activeTab, setActiveTab] = useState('Active');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [carrier, setCarrier] = useState(null);
  const [carrierLoading, setCarrierLoading] = useState(true);

  const [loadsLoading, setLoadsLoading] = useState(false);
  const [loadsError, setLoadsError] = useState('');
  const [loads, setLoads] = useState([]);

  const [showDocsModal, setShowDocsModal] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');
  const [docs, setDocs] = useState([]);
  const [docsLoad, setDocsLoad] = useState(null);

  const [showPodModal, setShowPodModal] = useState(false);
  const [podSubmitting, setPodSubmitting] = useState(false);
  const [podError, setPodError] = useState('');
  const [podLoad, setPodLoad] = useState(null);
  const [podReceiverName, setPodReceiverName] = useState('');
  const [podSignerName, setPodSignerName] = useState('');
  const [podSignMethod, setPodSignMethod] = useState('typed'); // draw | typed | image
  const [podSignatureImageUrl, setPodSignatureImageUrl] = useState('');
  const [podHasSignature, setPodHasSignature] = useState(false);
  const [podSignatureDataUrl, setPodSignatureDataUrl] = useState('');
  const [podChecks, setPodChecks] = useState({
    gpsOk: false,
    timeOk: false,
    confirmAccurate: false,
    confirmDelivered: false,
  });
  const [podGps, setPodGps] = useState({ lat: null, lng: null, accuracy: null, timestamp: null });
  const [podDistanceMeters, setPodDistanceMeters] = useState(null);
  const [podDestinationCoords, setPodDestinationCoords] = useState({ lat: null, lng: null, label: '' });

  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pickupSubmitting, setPickupSubmitting] = useState(false);
  const [pickupError, setPickupError] = useState('');
  const [pickupLoad, setPickupLoad] = useState(null);
  const [pickupShipperName, setPickupShipperName] = useState('');
  const [pickupRemarks, setPickupRemarks] = useState('');
  const [pickupBolFile, setPickupBolFile] = useState(null);
  const [pickupGps, setPickupGps] = useState({ lat: null, lng: null, accuracy: null, timestamp: null });
  const [pickupHasSignature, setPickupHasSignature] = useState(false);

  const podIframeRef = useRef(null);
  const podCanvasRef = useRef(null);
  const podDrawRef = useRef({ drawing: false, lastX: 0, lastY: 0 });
  const pickupCanvasRef = useRef(null);
  const pickupDrawRef = useRef({ drawing: false, lastX: 0, lastY: 0 });

  // Compliance + consents
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState('');
  const [compliance, setCompliance] = useState(null);
  const [consentEligibility, setConsentEligibility] = useState({ eligible: false, missing_consents: [] });
  const [requiredDocs, setRequiredDocs] = useState(null);
  const [requiredDocsLoading, setRequiredDocsLoading] = useState(false);
  const [requiredDocsError, setRequiredDocsError] = useState('');

  // Messaging (Communication Hub)
  const [messagingLoading, setMessagingLoading] = useState(false);
  const [messagingError, setMessagingError] = useState('');
  const [messagingThreads, setMessagingThreads] = useState([]);
  const [commThread, setCommThread] = useState(null);

  // Quick actions
  const [showUploadDocsModal, setShowUploadDocsModal] = useState(false);
  const [uploadDocType, setUploadDocType] = useState('other');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleMonth, setScheduleMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [driverDocs, setDriverDocs] = useState([]);
  const [selectedScheduleDay, setSelectedScheduleDay] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });

  const [showPerformanceModal, setShowPerformanceModal] = useState(false);

  useEffect(() => {
    const detectDark = () => {
      const dashboardRoot = document.querySelector('.dd-driver-dashboard');
      if (dashboardRoot) return dashboardRoot.classList.contains('dark-root');
      return (
        document.body.classList.contains('dark-root') ||
        document.documentElement.classList.contains('dark-root')
      );
    };
    const update = () => setIsDarkMode(detectDark());
    update();

    const dashboardRoot = document.querySelector('.dd-driver-dashboard');
    if (!dashboardRoot) return;
    const observer = new MutationObserver(() => update());
    observer.observe(dashboardRoot, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const theme = useMemo(() => {
    return {
      text: isDarkMode ? '#f1f5f9' : '#1e293b',
      muted: isDarkMode ? '#94a3b8' : '#64748b',
      border: isDarkMode ? '#353535' : '#e2e8f0',
      surface: isDarkMode ? '#2c2c2c' : '#ffffff',
      surfaceAlt: isDarkMode ? '#1f2937' : '#f8fafc',
      danger: '#dc2626'
    };
  }, [isDarkMode]);

  const getAuthToken = async () => {
    if (!currentUser) throw new Error(tr('myCarrier.error.notAuthenticated', 'Not authenticated'));
    return await currentUser.getIdToken();
  };

  const getLoadId = (load) => String(load?.load_id || load?.id || load?._id || '').trim();

  const normalizeStatus = (s) => String(s || '').trim().toLowerCase();

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
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const parseDateOnly = (s) => {
    const v = String(s || '').trim();
    if (!v) return null;
    // Accept YYYY-MM-DD, or ISO strings.
    const d = new Date(v.includes('T') ? v : `${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };

  const sameDay = (a, b) => {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  };

  const fmtWhen = (tsSecondsOrMs) => {
    const n = Number(tsSecondsOrMs || 0);
    if (!n) return '';
    const ms = n > 10_000_000_000 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return tr('myCarrier.time.justNow', 'just now');
    if (diffMin < 60) return `${diffMin} ${tr('myCarrier.time.minAgo', 'min ago')}`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ${tr('myCarrier.time.hrAgo', 'hr ago')}`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay} ${diffDay === 1 ? tr('myCarrier.time.dayAgo', 'day ago') : tr('myCarrier.time.daysAgo', 'days ago')}`;
  };

  const fetchCompliance = async () => {
    if (!currentUser) return;
    setComplianceLoading(true);
    setComplianceError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/compliance/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || tr('myCarrier.error.loadCompliance', 'Failed to load compliance'));
      setCompliance(data);
    } catch (e) {
      console.error('Compliance error:', e);
      setComplianceError(e?.message || tr('myCarrier.error.loadCompliance', 'Failed to load compliance'));
      setCompliance(null);
    } finally {
      setComplianceLoading(false);
    }
  };

  const fetchRequiredDocs = async () => {
    if (!currentUser) return;
    setRequiredDocsLoading(true);
    setRequiredDocsError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/onboarding/driver/required-docs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || tr('myCarrier.error.loadRequiredDocs', 'Failed to load required documents'));
      setRequiredDocs(data);

      // Keep consent status consistent with the required-docs gate (data_sharing_consent).
      setConsentEligibility({
        eligible: Boolean(data?.consent?.eligible),
        missing_consents: Array.isArray(data?.consent?.missing_consents) ? data.consent.missing_consents : [],
      });
    } catch (e) {
      console.error('Required docs error:', e);
      setRequiredDocsError(e?.message || tr('myCarrier.error.loadRequiredDocs', 'Failed to load required documents'));
      setRequiredDocs(null);
    } finally {
      setRequiredDocsLoading(false);
    }
  };

  const fetchMessagingThreads = async (carrierId) => {
    if (!currentUser) return;
    setMessagingLoading(true);
    setMessagingError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/messaging/threads?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || tr('myCarrier.error.loadThreads', 'Failed to load threads'));
      const list = Array.isArray(data?.threads) ? data.threads : [];
      setMessagingThreads(list);
      const preferred = carrierId
        ? list.find(t => String(t?.kind || '') === 'carrier_driver_direct' && String(t?.carrier_id || '') === String(carrierId))
        : null;
      setCommThread(preferred || list.find(t => String(t?.kind || '') === 'carrier_driver_direct') || list[0] || null);
    } catch (e) {
      console.error('Messaging threads error:', e);
      setMessagingError(e?.message || tr('myCarrier.error.loadMessages', 'Failed to load messages'));
      setMessagingThreads([]);
      setCommThread(null);
    } finally {
      setMessagingLoading(false);
    }
  };

  const openMessaging = (threadId) => {
    try {
      const base = '/driver-dashboard?nav=messaging';
      const url = threadId ? `${base}&thread=${encodeURIComponent(threadId)}` : base;
      window.location.href = url;
    } catch {
      // ignore
    }
  };

  const fetchDriverDocuments = async () => {
    if (!currentUser) return [];
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/documents`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || tr('myCarrier.error.loadDocuments', 'Failed to load documents'));
      const list = Array.isArray(data?.documents) ? data.documents : (Array.isArray(data) ? data : []);
      setDriverDocs(list);
      return list;
    } catch (e) {
      return [];
    }
  };

  const submitQuickUpload = async () => {
    if (!uploadFile) {
      setUploadError(tr('myCarrier.upload.error.selectFile', 'Please select a file'));
      return;
    }
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(uploadFile.type)) {
      setUploadError(tr('myCarrier.upload.error.invalidType', 'Only PDF, JPG, and PNG files are allowed'));
      return;
    }
    if (uploadFile.size > 25 * 1024 * 1024) {
      setUploadError(tr('myCarrier.upload.error.fileTooLarge', 'File size must be less than 25MB'));
      return;
    }

    setUploadSubmitting(true);
    setUploadError('');
    try {
      const token = await getAuthToken();
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('document_type', uploadDocType);
      const res = await fetch(`${API_URL}/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || tr('myCarrier.upload.error.uploadFailed', 'Upload failed'));

      setShowUploadDocsModal(false);
      setUploadFile(null);
      setUploadDocType('other');
      // Refresh compliance + schedule docs best-effort.
      fetchCompliance().catch(() => {});
      fetchDriverDocuments().catch(() => {});
      alert(tr('myCarrier.upload.success', 'Document uploaded successfully.'));
    } catch (e) {
      setUploadError(e?.message || tr('myCarrier.upload.error.uploadFailed', 'Upload failed'));
    } finally {
      setUploadSubmitting(false);
    }
  };

  // Fetch carrier information
  useEffect(() => {
    const fetchCarrier = async () => {
      if (!currentUser) {
        setCarrierLoading(false);
        return;
      }

      setCarrierLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_URL}/drivers/my-carrier`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setCarrier(data.carrier);
        }
      } catch (error) {
        console.error('Error fetching carrier:', error);
        setCarrier(null);
      } finally {
        setCarrierLoading(false);
      }
    };

    fetchCarrier();
  }, [currentUser]);

  const fetchLoads = async () => {
    if (!currentUser) return;
    setLoadsLoading(true);
    setLoadsError('');
    try {
      const token = await getAuthToken();
      const response = await fetch(`${API_URL}/loads`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.detail || tr('myCarrier.error.loadAssignments', 'Failed to load assignments'));
      }
      const list = Array.isArray(data?.loads) ? data.loads : [];
      setLoads(list);
    } catch (e) {
      console.error('Error fetching loads:', e);
      setLoadsError(e?.message || tr('myCarrier.error.loadAssignments', 'Failed to load assignments'));
      setLoads([]);
    } finally {
      setLoadsLoading(false);
    }
  };

  useEffect(() => {
    fetchLoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    fetchCompliance();
    fetchRequiredDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    const onDocsUpdated = () => {
      fetchCompliance();
      fetchRequiredDocs();
    };
    const onConsentUpdated = () => fetchRequiredDocs();
    window.addEventListener('fp:documents-updated', onDocsUpdated);
    window.addEventListener('fp:consent-updated', onConsentUpdated);
    return () => {
      window.removeEventListener('fp:documents-updated', onDocsUpdated);
      window.removeEventListener('fp:consent-updated', onConsentUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    // Once carrier info exists, fetch messaging threads and pick the carrier thread.
    if (!currentUser) return;
    fetchMessagingThreads(carrier?.id || carrier?.uid || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, carrier?.id, carrier?.uid]);

  const categorized = useMemo(() => {
    const list = Array.isArray(loads) ? loads : [];
    const active = list.filter(l => ['covered', 'assigned', 'in_transit'].includes(normalizeStatus(l.status)));
    const completed = list.filter(l => ['delivered', 'completed'].includes(normalizeStatus(l.status)));
    const archived = list.filter(l => ['cancelled', 'archived'].includes(normalizeStatus(l.status)));
    const inTransit = active.find(l => normalizeStatus(l.status) === 'in_transit') || null;
    return { list, active, completed, archived, inTransit };
  }, [loads]);

  const activeLoad = categorized.inTransit;

  const complianceSyncDocs = useMemo(() => {
    const req = Array.isArray(requiredDocs?.required) ? requiredDocs.required : [];
    // Only show doc-kind items for compliance sync.
    return req.filter((x) => String(x?.kind || '').toLowerCase() === 'document');
  }, [requiredDocs]);

  const complianceSyncProgress = useMemo(() => {
    const list = complianceSyncDocs;
    const total = list.length;
    const completed = list.filter((x) => {
      const s = String(x?.status || '').trim();
      return s && s !== 'Missing' && s !== 'Expired';
    }).length;
    return {
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      missingCount: total > 0 ? Math.max(0, total - completed) : 0,
    };
  }, [complianceSyncDocs]);

  const scheduleEvents = useMemo(() => {
    const events = [];
    // Load pickup/delivery
    for (const l of (Array.isArray(loads) ? loads : [])) {
      const loadId = getLoadId(l);
      const loadNumber = String(l?.load_number || '').trim() || loadId || '—';
      const pickup = parseDateOnly(l?.pickup_date);
      const delivery = parseDateOnly(l?.delivery_date);
      if (pickup) {
        events.push({
          kind: 'pickup',
          date: pickup,
          title: `${tr('myCarrier.schedule.pickupTitlePrefix', 'Pickup: Load')} ${loadNumber}`,
          meta: { load_id: loadId, status: normalizeStatus(l?.status) }
        });
      }
      if (delivery) {
        events.push({
          kind: 'delivery',
          date: delivery,
          title: `${tr('myCarrier.schedule.deliveryTitlePrefix', 'Delivery: Load')} ${loadNumber}`,
          meta: { load_id: loadId, status: normalizeStatus(l?.status) }
        });
      }
    }

    // Document expiry dates
    for (const d of (Array.isArray(driverDocs) ? driverDocs : [])) {
      const exp = parseDateOnly(d?.expiry_date || d?.extracted_fields?.expiry_date);
      if (!exp) continue;
      const tDoc = String(d?.type || d?.document_type || tr('documentVault.documentFallback', 'Document'))
        .replace(/_/g, ' ')
        .toUpperCase();
      events.push({
        kind: 'expiry',
        date: exp,
        title: `${tDoc} ${tr('myCarrier.schedule.expires', 'expires')}`,
        meta: { doc_id: String(d?.id || d?.doc_id || '') }
      });
    }

    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    return events;
  }, [loads, driverDocs]);

  const exportScheduleIcs = useCallback(() => {
    try {
      const monthStart = scheduleMonth;
      const year = monthStart.getFullYear();
      const month = monthStart.getMonth();
      const events = (Array.isArray(scheduleEvents) ? scheduleEvents : []).filter(
        (e) => e?.date && e.date.getFullYear() === year && e.date.getMonth() === month
      );

      const pad2 = (n) => String(n).padStart(2, '0');
      const fmtDate = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
      const fmtStamp = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
      const esc = (s) => String(s || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');

      const now = new Date();
      const dtstamp = fmtStamp(now);
      const calLines = [];
      calLines.push('BEGIN:VCALENDAR');
      calLines.push('VERSION:2.0');
      calLines.push('PRODID:-//FreightPower//Driver Schedule//EN');
      calLines.push('CALSCALE:GREGORIAN');
      calLines.push('METHOD:PUBLISH');

      for (const e of events) {
        const start = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate());
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        const uidBase = `${String(e?.kind || 'event')}:${String(e?.meta?.load_id || e?.meta?.doc_id || '')}:${fmtDate(start)}`;
        const uid = `${uidBase || Math.random().toString(16).slice(2)}@freightpower`;
        const desc = e?.meta?.load_id
          ? `${tr('myCarrier.schedule.ics.loadLabel', 'Load')}: ${String(e.meta.load_id)}\n${tr('myCarrier.schedule.ics.statusLabel', 'Status')}: ${String(e?.meta?.status || '')}`
          : (e?.meta?.doc_id ? `${tr('myCarrier.schedule.ics.documentLabel', 'Document')}: ${String(e.meta.doc_id)}` : '');

        calLines.push('BEGIN:VEVENT');
        calLines.push(`UID:${esc(uid)}`);
        calLines.push(`DTSTAMP:${dtstamp}`);
        calLines.push(`DTSTART;VALUE=DATE:${fmtDate(start)}`);
        calLines.push(`DTEND;VALUE=DATE:${fmtDate(end)}`);
        calLines.push(`SUMMARY:${esc(e?.title || tr('myCarrier.schedule.ics.defaultEventSummary', 'FreightPower Event'))}`);
        if (desc) calLines.push(`DESCRIPTION:${esc(desc)}`);
        calLines.push('END:VEVENT');
      }

      calLines.push('END:VCALENDAR');

      const blob = new Blob([calLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `freightpower-schedule-${year}-${pad2(month + 1)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert(tr('myCarrier.schedule.error.exportFailed', 'Failed to export calendar file.'));
    }
  }, [scheduleMonth, scheduleEvents]);

  const openSchedule = async () => {
    setShowScheduleModal(true);
    setScheduleLoading(true);
    setScheduleError('');
    try {
      await fetchDriverDocuments();
      // keep month anchored to today when opening
      const now = new Date();
      setScheduleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
      setSelectedScheduleDay(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    } catch (e) {
      setScheduleError(tr('myCarrier.schedule.error.loadDataFailed', 'Failed to load schedule data'));
    } finally {
      setScheduleLoading(false);
    }
  };

  const visibleAssignments = useMemo(() => {
    if (activeTab === 'Completed') return categorized.completed;
    if (activeTab === 'Archived') return categorized.archived;
    return categorized.active;
  }, [activeTab, categorized]);

  const openDocsForLoad = async (load) => {
    const loadId = getLoadId(load);
    if (!loadId) {
      alert(tr('myCarrier.error.loadIdNotFound', 'Load ID not found'));
      return;
    }
    setDocsLoad(load);
    setDocs([]);
    setDocsError('');
    setShowDocsModal(true);
    setDocsLoading(true);
    try {
      const token = await getAuthToken();
      const response = await fetch(`${API_URL}/loads/${loadId}/documents`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || tr('myCarrier.error.loadDocuments', 'Failed to load documents'));
      const list = Array.isArray(data?.documents) ? data.documents : [];
      setDocs(list);
    } catch (e) {
      console.error('Docs fetch error:', e);
      setDocsError(e?.message || tr('myCarrier.error.loadDocuments', 'Failed to load documents'));
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  const refreshPickupGps = async () => {
    setPickupError('');
    if (!navigator?.geolocation) {
      setPickupError(tr('myCarrier.pickup.error.geoNotSupported', 'Geolocation is not supported in this browser.'));
      return;
    }
    await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          const accuracy = pos?.coords?.accuracy;
          const ts = pos?.timestamp || Date.now();
          setPickupGps({ lat, lng, accuracy, timestamp: ts });
          resolve(true);
        },
        (err) => {
          setPickupError(err?.message || tr('myCarrier.pickup.error.getLocationFailed', 'Could not get current location.'));
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  const openPickupForLoad = async (load) => {
    setPickupError('');
    setPickupSubmitting(false);
    setPickupLoad(load);
    setPickupBolFile(null);
    setPickupGps({ lat: null, lng: null, accuracy: null, timestamp: null });
    setPickupHasSignature(false);
    setPickupRemarks('');
    const defaultName = String(load?.shipper_company_name || load?.shipper_name || '').trim();
    setPickupShipperName(defaultName);
    setShowPickupModal(true);
  };

  const clearPickupSignature = () => {
    const canvas = pickupCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPickupHasSignature(false);
  };

  useEffect(() => {
    if (!showPickupModal) return;
    const canvas = pickupCanvasRef.current;
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
  }, [showPickupModal]);

  const pickupPointerDown = (e) => {
    const canvas = pickupCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? 0) - rect.top;
    pickupDrawRef.current = { drawing: true, lastX: x, lastY: y };
  };

  const pickupPointerMove = (e) => {
    const canvas = pickupCanvasRef.current;
    if (!canvas) return;
    if (!pickupDrawRef.current.drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? 0) - rect.top;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pickupDrawRef.current.lastX, pickupDrawRef.current.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    pickupDrawRef.current.lastX = x;
    pickupDrawRef.current.lastY = y;
    setPickupHasSignature(true);
  };

  const pickupPointerUp = () => {
    pickupDrawRef.current.drawing = false;
  };

  const submitPickup = async () => {
    if (!pickupLoad) return;
    const loadId = getLoadId(pickupLoad);
    if (!loadId) {
      setPickupError(tr('myCarrier.error.loadIdNotFoundDot', 'Load ID not found.'));
      return;
    }

    if (!pickupBolFile) {
      setPickupError(tr('myCarrier.pickup.error.bolRequired', 'BOL is required before completing pickup.'));
      return;
    }

    const shipperName = String(pickupShipperName || '').trim();
    if (!shipperName) {
      setPickupError(tr('myCarrier.pickup.error.shipperNameRequired', 'Shipper/warehouse name is required.'));
      return;
    }

    if (pickupGps?.lat == null || pickupGps?.lng == null) {
      setPickupError(tr('myCarrier.pickup.error.gpsRequired', 'GPS location is required to complete pickup.'));
      return;
    }

    if (!pickupHasSignature) {
      setPickupError(tr('myCarrier.pickup.error.signatureRequired', 'Pickup signature is required.'));
      return;
    }

    setPickupSubmitting(true);
    setPickupError('');
    try {
      const token = await getAuthToken();

      // Upload BOL (required by workflow).
      const form = new FormData();
      form.append('file', pickupBolFile);
      form.append('kind', 'BOL');
      const uploadRes = await fetch(`${API_URL}/loads/${loadId}/documents/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form,
      });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadData?.detail || tr('myCarrier.pickup.error.bolUploadFailed', 'Failed to upload BOL'));

      const canvas = pickupCanvasRef.current;
      const signatureDataUrl = canvas ? canvas.toDataURL('image/png') : '';
      if (!signatureDataUrl) {
        throw new Error(tr('myCarrier.pickup.error.signatureRequired', 'Pickup signature is required.'));
      }

      const res = await fetch(`${API_URL}/loads/${loadId}/pickup/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude: pickupGps.lat,
          longitude: pickupGps.lng,
          shipper_name: shipperName,
          shipper_signature_data_url: signatureDataUrl,
          remarks: String(pickupRemarks || '').trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || tr('myCarrier.pickup.error.completeFailed', 'Failed to complete pickup'));

      setShowPickupModal(false);
      await fetchLoads();
      alert(tr('myCarrier.pickup.success', 'Pickup completed. Trip started.'));
    } catch (e) {
      console.error('Pickup error:', e);
      setPickupError(e?.message || tr('myCarrier.pickup.error.completeFailed', 'Failed to complete pickup'));
    } finally {
      setPickupSubmitting(false);
    }
  };

  const startTrip = async (load) => {
    await openPickupForLoad(load);
  };

  const openPodForLoad = async (load) => {
    setPodError('');
    setPodSubmitting(false);
    setPodLoad(load);
    setPodReceiverName('');
    setPodSignMethod('draw');
    setPodSignatureImageUrl('');
    setPodHasSignature(false);
    setPodSignatureDataUrl('');
    setPodChecks({ gpsOk: false, timeOk: false, confirmAccurate: false, confirmDelivered: false });
    setPodGps({ lat: null, lng: null, accuracy: null, timestamp: null });
    setPodDistanceMeters(null);
    setPodDestinationCoords({ lat: null, lng: null, label: '' });

    const defaultName = String(currentUser?.displayName || currentUser?.email || '').trim();
    setPodSignerName(defaultName);
    setShowPodModal(true);

    // Best-effort: geocode destination immediately.
    try {
      const destinationText = formatLoc(load?.destination);
      if (!destinationText) return;
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/maps/geocode`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address: destinationText, limit: 1 })
      });
      const data = await res.json().catch(() => ({}));
      const first = data?.results?.[0];
      if (first?.lat != null && first?.lng != null) {
        setPodDestinationCoords({ lat: first.lat, lng: first.lng, label: first.label || destinationText });
      }
    } catch (e) {
      // ignore; user can still try to proceed but GPS check will fail.
    }
  };

  const computePodTimeOk = (load) => {
    const deliveryDate = String(load?.delivery_date || '').trim();
    if (!deliveryDate) return { ok: false, reason: 'Missing delivery date' };
    // Accept either ISO or YYYY-MM-DD.
    const deliveryTime = String(load?.delivery_time || '').trim();
    const dtStr = deliveryTime ? `${deliveryDate}T${deliveryTime}` : deliveryDate;
    const dt = new Date(dtStr);
    if (Number.isNaN(dt.getTime())) return { ok: false, reason: 'Invalid delivery date' };
    const now = new Date();
    const diffMs = now.getTime() - dt.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return { ok: diffHours <= 48, diffHours };
  };

  const refreshPodGps = async () => {
    setPodError('');
    if (!navigator?.geolocation) {
      setPodError(tr('myCarrier.pod.error.geoNotSupported', 'Geolocation is not supported in this browser.'));
      return;
    }
    await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          const accuracy = pos?.coords?.accuracy;
          const ts = pos?.timestamp || Date.now();
          setPodGps({ lat, lng, accuracy, timestamp: ts });
          resolve(true);
        },
        (err) => {
          setPodError(err?.message || tr('myCarrier.pod.error.getLocationFailed', 'Could not get current location.'));
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  };

  useEffect(() => {
    // Recompute GPS distance + check when coords change.
    if (podGps?.lat == null || podGps?.lng == null) return;
    if (podDestinationCoords?.lat == null || podDestinationCoords?.lng == null) return;
    const meters = haversineMeters(podGps.lat, podGps.lng, podDestinationCoords.lat, podDestinationCoords.lng);
    setPodDistanceMeters(meters);
    const gpsOk = meters <= 10;
    setPodChecks(prev => ({ ...prev, gpsOk }));
  }, [podGps, podDestinationCoords]);

  useEffect(() => {
    if (!podLoad) return;
    const { ok } = computePodTimeOk(podLoad);
    setPodChecks(prev => ({ ...prev, timeOk: ok }));
  }, [podLoad]);

  useEffect(() => {
    return () => {
      try {
        if (podSignatureImageUrl) URL.revokeObjectURL(podSignatureImageUrl);
      } catch {
        // ignore
      }
    };
  }, [podSignatureImageUrl]);

  useEffect(() => {
    if (!showPodModal) return;
    try {
      requestAnimationFrame(() => initPodSignatureCanvas());
    } catch {
      initPodSignatureCanvas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPodModal]);

  const loadSignatureImage = async () => {
    setPodError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/consents/signature-image/raw`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || tr('myCarrier.pod.error.signatureNotFound', 'Signature image not found. Upload one in Consent & E‑Signature.'));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPodSignatureImageUrl(url);
    } catch (e) {
      console.error('Load signature image error:', e);
      setPodError(e?.message || tr('myCarrier.pod.error.signatureLoadFailed', 'Could not load signature image.'));
    }
  };

  const initPodSignatureCanvas = () => {
    const canvas = podCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = 300;
    const cssH = 140;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = theme.text;
    ctx.clearRect(0, 0, cssW, cssH);
    setPodHasSignature(false);
    setPodSignatureDataUrl('');
  };

  const clearPodSignature = () => {
    initPodSignatureCanvas();
  };

  const podSigPointerDown = (e) => {
    const canvas = podCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? 0) - rect.top;
    podDrawRef.current = { drawing: true, lastX: x, lastY: y };
  };

  const podSigPointerMove = (e) => {
    const canvas = podCanvasRef.current;
    if (!canvas) return;
    if (!podDrawRef.current.drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const y = (e.clientY ?? 0) - rect.top;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(podDrawRef.current.lastX, podDrawRef.current.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    podDrawRef.current.lastX = x;
    podDrawRef.current.lastY = y;
    setPodHasSignature(true);
  };

  const podSigPointerUp = () => {
    podDrawRef.current.drawing = false;
    const canvas = podCanvasRef.current;
    if (!canvas) return;
    try {
      setPodSignatureDataUrl(canvas.toDataURL('image/png'));
    } catch {
      // ignore
    }
  };

  const buildPodHtml = () => {
    const load = podLoad || {};
    const loadId = getLoadId(load);
    const loadNumber = String(load?.load_number || '').trim() || loadId || '—';
    const origin = formatLoc(load?.origin) || '—';
    const destination = formatLoc(load?.destination) || '—';
    const pickupDate = String(load?.pickup_date || '').trim() || '—';
    const deliveryDate = String(load?.delivery_date || '').trim() || '—';
    const equipment = String(load?.equipment_type || '').trim() || '—';
    const weight = load?.weight != null ? String(load.weight) : '—';
    const receiverName = String(podReceiverName || '').trim() || '—';
    const signedName = String(podSignerName || '').trim() || '—';
    const signedAt = new Date().toLocaleString(locale);
    const gpsText = (podGps?.lat != null && podGps?.lng != null)
      ? `${Number(podGps.lat).toFixed(6)}, ${Number(podGps.lng).toFixed(6)} (±${podGps?.accuracy ? Math.round(podGps.accuracy) : '—'}m)`
      : '—';
    const distanceText = (podDistanceMeters != null)
      ? `${podDistanceMeters.toFixed(1)} ${tr('myCarrier.pod.metersFromDelivery', 'meters from delivery')}` : '—';

    const podTitle = tr('myCarrier.pod.title', 'PROOF OF DELIVERY (POD)');
    const podSubtitlePrefix = tr('myCarrier.pod.subtitlePrefix', 'FreightPower — Delivery confirmation for Load');
    const podLabelLoad = tr('myCarrier.pod.label.load', 'Load');
    const podLabelLoadId = tr('myCarrier.pod.label.loadId', 'Load ID:');
    const podLabelReceiver = tr('myCarrier.pod.label.receiver', 'Receiver');
    const podLabelSignedAt = tr('myCarrier.pod.label.signedAt', 'Signed at:');
    const podLabelOrigin = tr('myCarrier.pod.label.origin', 'Origin');
    const podLabelPickupDate = tr('myCarrier.pod.label.pickupDate', 'Pickup Date:');
    const podLabelDestination = tr('myCarrier.pod.label.destination', 'Destination');
    const podLabelDeliveryDate = tr('myCarrier.pod.label.deliveryDate', 'Delivery Date:');
    const podLabelEquipmentWeight = tr('myCarrier.pod.label.equipmentWeight', 'Equipment / Weight');
    const podLabelWeight = tr('myCarrier.pod.label.weight', 'Weight:');
    const podLabelGpsProof = tr('myCarrier.pod.label.gpsProof', 'GPS Proof');
    const podLabelSignerName = tr('myCarrier.pod.label.signerName', 'Signer Name');
    const podLabelSignatureImage = tr('myCarrier.pod.label.signatureImage', 'Signature (image)');
    const podLabelSignatureTyped = tr('myCarrier.pod.label.signatureTyped', 'Signature (typed)');
    const podLabelSignatureDrawn = tr('myCarrier.pod.label.signatureDrawn', 'Signature (drawn)');
    const podSignatureAlt = tr('myCarrier.pod.label.signatureAlt', 'Signature');
    const podSignatureImageMissing = tr('myCarrier.pod.signatureImageMissing', 'Signature image not available');
    const podSignatureDrawnMissing = tr('myCarrier.pod.signatureDrawnMissing', 'Drawn signature not captured');
    const podFootnote = tr(
      'myCarrier.pod.footnote',
      'This is a digitally signed commercial document. False statements or misrepresentation may be subject to penalties under applicable law and contract terms.'
    );

    const signatureBlock = podSignMethod === 'draw'
      ? (podSignatureDataUrl
          ? `<div class="sig-row"><div class="sig-label">${podLabelSignatureDrawn}</div><div class="sig-box"><img class="sig-img" src="${podSignatureDataUrl}" alt="${podSignatureAlt}" /></div></div>`
          : `<div class="sig-row"><div class="sig-label">${podLabelSignatureDrawn}</div><div class="sig-box sig-missing">${podSignatureDrawnMissing}</div></div>`)
      : (podSignMethod === 'image'
          ? (podSignatureImageUrl
              ? `<div class="sig-row"><div class="sig-label">${podLabelSignatureImage}</div><div class="sig-box"><img class="sig-img" src="${podSignatureImageUrl}" alt="${podSignatureAlt}" /></div></div>`
              : `<div class="sig-row"><div class="sig-label">${podLabelSignatureImage}</div><div class="sig-box sig-missing">${podSignatureImageMissing}</div></div>`)
          : `<div class="sig-row"><div class="sig-label">${podLabelSignatureTyped}</div><div class="sig-box"><div class="sig-typed">${signedName}</div></div></div>`);

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${podTitle}</title>
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
      .sig-typed { font-family: "Times New Roman", serif; font-size: 22px; }
      .sig-img { max-height: 44px; max-width: 260px; display: block; }
      .footnote { margin-top: 12px; font-size: 10px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="title">${podTitle}</div>
      <div class="sub">${podSubtitlePrefix} ${loadNumber}</div>
      <div class="hr"></div>

      <div class="grid">
        <div class="box">
          <div class="label">${podLabelLoad}</div>
          <div class="value">#${loadNumber}</div>
          <div class="sub">${podLabelLoadId} <span class="value mono">${loadId || '—'}</span></div>
        </div>
        <div class="box">
          <div class="label">${podLabelReceiver}</div>
          <div class="value">${receiverName}</div>
          <div class="sub">${podLabelSignedAt} ${signedAt}</div>
        </div>
        <div class="box">
          <div class="label">${podLabelOrigin}</div>
          <div class="value">${origin}</div>
          <div class="sub">${podLabelPickupDate} ${pickupDate}</div>
        </div>
        <div class="box">
          <div class="label">${podLabelDestination}</div>
          <div class="value">${destination}</div>
          <div class="sub">${podLabelDeliveryDate} ${deliveryDate}</div>
        </div>
        <div class="box">
          <div class="label">${podLabelEquipmentWeight}</div>
          <div class="value">${equipment}</div>
          <div class="sub">${podLabelWeight} ${weight}</div>
        </div>
        <div class="box">
          <div class="label">${podLabelGpsProof}</div>
          <div class="value mono">${gpsText}</div>
          <div class="sub">${distanceText}</div>
        </div>
      </div>

      <div class="sig">
        <div class="hr"></div>
        ${signatureBlock}
        <div class="sig-row">
          <div class="sig-label">${podLabelSignerName}</div>
          <div class="sig-box"><div class="value">${signedName}</div></div>
        </div>
      </div>

      <div class="footnote">${podFootnote}</div>
    </div>
  </body>
</html>`;
  };

  const buildPodPdfFromIframe = async () => {
    const body = podIframeRef.current?.contentDocument?.body;
    if (!body) throw new Error(tr('myCarrier.pod.error.previewNotReady', 'POD preview is not ready yet.'));
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    await doc.html(body, { x: 24, y: 24, width: 560, windowWidth: 900 });
    return doc;
  };

  const submitPod = async () => {
    if (!podLoad) return;
    const status = normalizeStatus(podLoad.status);
    if (status !== 'in_transit') {
      setPodError(tr('myCarrier.pod.error.onlyInTransit', 'POD upload is only allowed for an In Transit load. Start the trip first.'));
      return;
    }

    const loadId = getLoadId(podLoad);
    if (!loadId) {
      setPodError(tr('myCarrier.error.loadIdNotFoundDot', 'Load ID not found.'));
      return;
    }

    const receiver = String(podReceiverName || '').trim();
    if (!receiver) {
      setPodError(tr('myCarrier.pod.error.receiverRequired', 'Receiver name is required.'));
      return;
    }

    const signer = String(podSignerName || '').trim();
    if (!signer) {
      setPodError(tr('myCarrier.pod.error.signerRequired', 'Signer name is required.'));
      return;
    }

    if (podSignMethod === 'draw' && !podHasSignature) {
      setPodError(tr('myCarrier.pod.error.signatureRequired', 'Signature is required.'));
      return;
    }
    if (podSignMethod === 'image' && !podSignatureImageUrl) {
      setPodError(tr('myCarrier.pod.error.signatureNotLoaded', 'Signature image not loaded. Click “Load Signature Image”, or switch to Typed/Draw.'));
      return;
    }

    if (!podChecks.gpsOk) {
      setPodError(tr('myCarrier.pod.error.gpsCheckFailed', 'GPS check failed. You must be within 10 meters of the delivery location.'));
      return;
    }
    if (!podChecks.timeOk) {
      setPodError(tr('myCarrier.pod.error.timeCheckFailed', '48-hour check failed. POD must be uploaded within 48 hours of scheduled delivery.'));
      return;
    }
    if (!podChecks.confirmDelivered || !podChecks.confirmAccurate) {
      setPodError(tr('myCarrier.pod.error.confirmStatements', 'Please confirm the POD statements before submitting.'));
      return;
    }

    setPodSubmitting(true);
    setPodError('');
    try {
      const token = await getAuthToken();

      if (podGps?.lat == null || podGps?.lng == null) {
        throw new Error(tr('myCarrier.pod.error.gpsRequired', 'GPS location is required. Click “Get Current Location”.'));
      }

      const blobToDataUrl = (blob) => {
        return new Promise((resolve, reject) => {
          try {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Failed to read signature image'));
            reader.readAsDataURL(blob);
          } catch (e) {
            reject(e);
          }
        });
      };

      const typedSignatureToDataUrl = (text) => {
        const c = document.createElement('canvas');
        const w = 520;
        const h = 160;
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#111827';
        ctx.font = '48px "Times New Roman", serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(text || '').slice(0, 60), 18, h / 2);
        return c.toDataURL('image/png');
      };

      let receiverSignatureDataUrl = '';
      if (podSignMethod === 'draw') {
        const canvas = podCanvasRef.current;
        receiverSignatureDataUrl = canvas ? canvas.toDataURL('image/png') : String(podSignatureDataUrl || '');
      } else if (podSignMethod === 'image') {
        const sigBlob = await fetch(podSignatureImageUrl).then(r => r.blob());
        receiverSignatureDataUrl = await blobToDataUrl(sigBlob);
      } else {
        receiverSignatureDataUrl = typedSignatureToDataUrl(signer);
      }

      if (!receiverSignatureDataUrl || receiverSignatureDataUrl.length < 20) {
        throw new Error(tr('myCarrier.pod.error.signatureRequired', 'Signature is required.'));
      }

      const doc = await buildPodPdfFromIframe();
      const blob = doc.output('blob');
      const filenameSafe = String(podLoad?.load_number || loadId).replace(/[^a-z0-9._-]/gi, '_');
      const file = new File([blob], `pod_${filenameSafe}.pdf`, { type: 'application/pdf' });
      const form = new FormData();
      form.append('file', file);
      form.append('kind', 'POD');

      const uploadRes = await fetch(`${API_URL}/loads/${loadId}/documents/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadData?.detail || tr('myCarrier.pod.error.uploadFailed', 'Failed to upload POD'));

      const deliveryRes = await fetch(`${API_URL}/loads/${loadId}/delivery/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          latitude: podGps.lat,
          longitude: podGps.lng,
          receiver_name: receiver,
          receiver_signature_data_url: receiverSignatureDataUrl,
          remarks: `POD uploaded (receiver: ${receiver}, signer: ${signer}, sign_method: ${podSignMethod})`,
          delivered_at: Date.now() / 1000,
        })
      });
      const deliveryData = await deliveryRes.json().catch(() => ({}));
      if (!deliveryRes.ok) throw new Error(deliveryData?.detail || tr('myCarrier.pod.error.markDeliveredFailed', 'Failed to complete delivery'));

      setShowPodModal(false);
      await fetchLoads();
      alert(tr('myCarrier.pod.success.uploadedAndDelivered', 'POD uploaded and delivery completed.'));
    } catch (e) {
      console.error('Submit POD error:', e);
      setPodError(e?.message || tr('myCarrier.pod.error.submitFailed', 'Failed to submit POD'));
    } finally {
      setPodSubmitting(false);
    }
  };

  return (
    <>
      <section className={`dd-grid${isDarkMode ? ' dark' : ''}`}>
          {/* Carrier Info Card */}
          {carrierLoading ? (
            <div className="card mc-carrier-card">
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '24px', marginRight: '10px' }}></i>
                {tr('myCarrier.carrier.loading', 'Loading carrier information...')}
              </div>
            </div>
          ) : !carrier ? (
            <div className="card mc-carrier-card">
              <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                <i className="fa-solid fa-building" style={{ fontSize: '48px', marginBottom: '20px', opacity: 0.5 }}></i>
                <h3 style={{ marginBottom: '12px' }}>{tr('myCarrier.carrier.noneTitle', 'No Carrier Assigned')}</h3>
                <p>{tr('myCarrier.carrier.noneBody', 'You are not currently hired by any carrier. Once a carrier hires you from the marketplace, their information will appear here.')}</p>
              </div>
            </div>
          ) : (
          <div className="card mc-carrier-card">
            <div className="mc-carrier-header">
              <div className="mc-carrier-logo">
                {(() => {
                  const name = carrier.name || carrier.company_name || '';
                  const logoFallback = tr('myCarrier.carrier.logoFallback', 'CA');
                  if (name) {
                    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    return initials || logoFallback;
                  }
                  return logoFallback;
                })()}
              </div>
              <div className="mc-carrier-info">
                <div className="mc-carrier-name">
                  <h3>{carrier.name || carrier.company_name || tr('myCarrier.carrier.unknown', 'Unknown Carrier')}</h3>
                  <span className="int-status-badge active">
                    {carrier.status === 'active'
                      ? tr('myCarrier.carrier.activeCarrier', 'Active Carrier')
                      : tr('myCarrier.carrier.verifiedCarrier', 'Verified Carrier')}
                  </span>
                </div>
                <div className="mc-carrier-details">
                  {carrier.dot_number && (
                    <span className="mc-detail">{tr('myCarrier.carrier.dotLabel', 'DOT')}: {carrier.dot_number}</span>
                  )}
                  {carrier.mc_number && (
                    <span className="mc-detail">{tr('myCarrier.carrier.mcLabel', 'MC')}: {carrier.mc_number}</span>
                  )}
                  {carrier.service_areas && carrier.service_areas.length > 0 && (
                    <span className="mc-detail">{carrier.service_areas[0]}</span>
                  )}
                  {carrier.email && (
                    <span className="mc-detail">{carrier.email}</span>
                  )}
                </div>
              </div>
              <div className="mc-carrier-status">
                <span className="int-status-badge active">{tr('common.active', 'Active')}</span>
                {Number(carrier.rating) > 0 && (
                  <div className="mc-rating">
                    <i className="fa-solid fa-star"></i>
                    <span>{carrier.rating} {tr('myCarrier.carrier.ratingLabel', 'Rating')}</span>
                  </div>
                )}
                {Number(carrier.total_loads) > 0 && (
                  <div className="mc-rating" style={{ marginTop: '8px' }}>
                    <span>{carrier.total_loads} {tr('myCarrier.carrier.loadsLabel', 'Loads')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

            {/* AI Assistant Alert */}
          <div className="mc-ai-alert-card" style={{marginTop: '10px', marginBottom: '10px'}}>
            <div className="mc-ai-alert">
              <div className="mc-ai-content" >
                <h4 style={{fontWeight: '700', color: 'white'}}>{tr('myCarrier.ai.title', 'AI Assistant')}</h4>
                <p style={{color: "white"}}>{tr('myCarrier.ai.cdlExpiryHint', 'Your CDL expires in 45 days. Upload renewal to maintain compliance.')}</p>
              </div>
              <button className="btn small ghost-cd dd-btn">{tr('myCarrier.ai.uploadNow', 'Upload Now')}</button>
            </div>
          </div>



          {/* Two Column Layout */}
          <div className="mc-two-column-layout">
            {/* Left Column */}
            <div className="mc-left-column">
              {/* Active Load Card */}
              <div className="card mc-active-load-card">
                <div className="mc-load-header">
                  <div className="mc-load-title">
                    <span className="mc-load-badge">{tr('myCarrier.activeLoad.badgePrefix', 'Active Load #')}{activeLoad ? (activeLoad.load_number || getLoadId(activeLoad) || '—') : '—'}</span>
                    <span className="int-status-badge active">{activeLoad ? (normalizeStatus(activeLoad.status) === 'in_transit' ? tr('myCarrier.status.inTransit', 'In Transit') : tr('common.active', 'Active')) : tr('myCarrier.activeLoad.none', 'No Active Load')}</span>
                  </div>
                  <div className="mc-load-actions">
                    <button className="btn small mc-view-route-btn" disabled={!activeLoad}>
                      {tr('myCarrier.activeLoad.viewRoute', 'View Route')}
                    </button>
                    <button className="btn small mc-message-dispatch-btn" disabled={!activeLoad} onClick={() => openMessaging(commThread?.id || null)}>
                      {tr('myCarrier.activeLoad.messageDispatch', 'Message Dispatch')}
                    </button>
                  </div>
                </div>

                <div className="mc-load-details">
                  <div className="mc-load-locations">
                    <div className="mc-location pickup">
                      <h5>{tr('myCarrier.labels.pickup', 'Pickup')}</h5>
                      <p>{activeLoad ? (formatLoc(activeLoad.origin) || '—') : '—'}</p>
                      <p>{activeLoad?.pickup_date ? `${tr('myCarrier.labels.pickupDate', 'Pickup Date:')} ${activeLoad.pickup_date}` : `${tr('myCarrier.labels.pickupDate', 'Pickup Date:')} —`}</p>
                      {activeLoad?.pickup_confirmed_at ? (
                        <p className="mc-status-text">
                          <i className="fa-solid fa-check"></i>
                          {tr('myCarrier.pickup.confirmed', 'Pickup Confirmed')}
                        </p>
                      ) : (
                        <p className="mc-status-text" style={{ opacity: 0.85 }}>
                          <i className="fa-solid fa-circle-info"></i>
                          {tr('myCarrier.pickup.notConfirmed', 'Pickup not confirmed')}
                        </p>
                      )}
                    </div>
                    <div className="mc-location delivery">
                      <h5>{tr('myCarrier.labels.delivery', 'Delivery')}</h5>
                      <p>{activeLoad ? (formatLoc(activeLoad.destination) || '—') : '—'}</p>
                      <p>{activeLoad?.delivery_date ? `${tr('myCarrier.labels.deliveryDate', 'Delivery Date:')} ${activeLoad.delivery_date}` : `${tr('myCarrier.labels.deliveryDate', 'Delivery Date:')} —`}</p>
                      <p>{activeLoad ? `${tr('common.status', 'Status')}: ${String(activeLoad.status || '—')}` : `${tr('common.status', 'Status')}: —`}</p>
                    </div>
                  </div>

                  <div className="mc-progress-section">
                    <div className="mc-progress-header">
                      <span style={{fontWeight: '650'}}>{tr('myCarrier.tripProgress.title', 'Trip Progress')}</span>
                      <span style={{fontWeight: '650'}}>{activeLoad ? (activeLoad.status === 'in_transit' ? tr('common.inProgress', 'In Progress') : '—') : '—'}</span>
                    </div>
                    <div className="mc-progress-bar">
                      <div className="mc-progress-fill" style={{width: activeLoad ? (activeLoad.status === 'in_transit' ? '50%' : '0%') : '0%'}}></div>
                    </div>
                  </div>

                  <div className="mc-load-buttons">
                    <button className="btn small ghost-cd" disabled={!activeLoad} onClick={() => activeLoad && openDocsForLoad(activeLoad)}>
                      <i className="fa-solid fa-file-text"></i>
                      {tr('myCarrier.docs.viewDocs', 'View Docs')}
                    </button>
                    <button className="btn small ghost-cd" disabled={!activeLoad} onClick={() => activeLoad && openPodForLoad(activeLoad)}>
                      <i className="fa-solid fa-upload"></i>
                      {tr('myCarrier.pod.upload', 'Upload POD')}
                    </button>
                  </div>

                  {!activeLoad && (
                    <div style={{ marginTop: 10, color: theme.muted, fontSize: 13 }}>
                      {tr('myCarrier.activeLoad.noneHint', 'No active load found. Start a trip from Assignments.')}
                    </div>
                  )}
                </div>
              </div>

              {/* Assignments Section */}
              <div className="card mc-assignments-card">
                <div className="mc-assignments-header">
                  <h3>{tr('myCarrier.assignments.title', 'Assignments')}</h3>
                  <div className="mc-assignment-tabs">
                    <button 
                      className={`mc-tab ${activeTab === 'Active' ? 'active' : ''}`}
                      onClick={() => setActiveTab('Active')}
                    >
                      {tr('common.active', 'Active')}
                    </button>
                    <button 
                      className={`mc-tab ${activeTab === 'Completed' ? 'active' : ''}`}
                      onClick={() => setActiveTab('Completed')}
                    >
                      {tr('myCarrier.assignments.tab.completed', 'Completed')}
                    </button>
                    <button 
                      className={`mc-tab ${activeTab === 'Archived' ? 'active' : ''}`}
                      onClick={() => setActiveTab('Archived')}
                    >
                      {tr('myCarrier.assignments.tab.archived', 'Archived')}
                    </button>
                  </div>
                </div>

                <div className="mc-assignment-list">
                  {loadsError && (
                    <div style={{ padding: 16, color: theme.danger }}>{loadsError}</div>
                  )}
                  {loadsLoading ? (
                    <div style={{ padding: 20, color: theme.muted }}>
                      <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 10 }}></i>
                      {tr('myCarrier.assignments.loading', 'Loading assignments…')}
                    </div>
                  ) : (visibleAssignments.length === 0 ? (
                    <div style={{ padding: 20, color: theme.muted }}>
                      {tr('myCarrier.assignments.empty', 'No loads in this tab.')}
                    </div>
                  ) : (
                    visibleAssignments.map((l) => {
                      const st = normalizeStatus(l.status);
                      const loadId = getLoadId(l);
                      const loadNumber = l.load_number || loadId || '—';
                      const origin = formatLoc(l.origin) || '—';
                      const destination = formatLoc(l.destination) || '—';
                      const miles = l.estimated_distance || l.distance_miles;
                      const rate = l.rate || l.price || l.total_cost;

                      const statusClass = st === 'delivered' || st === 'completed'
                        ? 'active'
                        : st === 'in_transit' || st === 'covered' || st === 'assigned'
                          ? 'active'
                          : 'pending';
                      const statusLabel = st ? st.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

                      const primaryKind = (st === 'covered' || st === 'assigned')
                        ? 'start_trip'
                        : (st === 'in_transit')
                          ? 'upload_pod'
                          : 'view_docs';

                      const primaryAction = () => {
                        if (primaryKind === 'start_trip') return (
                          <button className="btn small-cd" onClick={() => startTrip(l)}>{tr('myCarrier.actions.startTrip', 'Start Trip')}</button>
                        );
                        if (primaryKind === 'upload_pod') return (
                          <button className="btn small-cd" onClick={() => openPodForLoad(l)}>{tr('myCarrier.pod.upload', 'Upload POD')}</button>
                        );
                        return (
                          <button className="btn small-cd" onClick={() => openDocsForLoad(l)}>{tr('myCarrier.docs.viewDocs', 'View Docs')}</button>
                        );
                      };

                      return (
                        <div key={loadId || loadNumber} className="mc-assignment-item">
                          <div className="mc-assignment-info">
                            <h4>{tr('myCarrier.assignments.loadPrefix', 'Load #')}{loadNumber}</h4>
                            <span className={`int-status-badge ${statusClass}`}>{statusLabel}</span>
                            <div className="mc-assignment-route">
                              <p>{tr('myCarrier.labels.from', 'From:')} {origin}</p>
                            </div>
                            <div className="mc-assignment-route">
                              <p>{tr('myCarrier.labels.to', 'To:')} {destination}</p>
                            </div>
                            <div className="mc-assignment-details">
                              <span>
                                {miles != null ? `${miles} ${tr('myCarrier.units.miles', 'miles')}` : '—'}
                                {rate != null ? ` • $${rate}` : ''}
                              </span>
                            </div>
                          </div>
                          <div className="mc-assignment-schedule">
                            <p>{tr('myCarrier.labels.pickup', 'Pickup')}: {l.pickup_date || '—'}</p>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              {primaryKind !== 'view_docs' && (
                                <button className="btn small ghost-cd" onClick={() => openDocsForLoad(l)}>
                                  {tr('myCarrier.docs.viewDocs', 'View Docs')}
                                </button>
                              )}
                              {primaryAction()}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="mc-right-column">
              {/* Compliance Sync */}
              <div className="card mc-compliance-card">
                <div className="card-header">
                  <h3>{tr('myCarrier.compliance.title', 'Compliance Sync')}</h3>
                </div>
                <div className="mc-compliance-list">
                  {(requiredDocsLoading ? Array.from({ length: Math.max(3, complianceSyncDocs.length || 0) }) : complianceSyncDocs).map(
                    (doc, idx) => {
                      const title = requiredDocsLoading
                        ? tr('myCarrier.common.loading', 'Loading…')
                        : String(doc?.title || doc?.label || doc?.key || tr('documentVault.documentFallback', 'Document'));
                      const status = requiredDocsLoading ? '' : String(doc?.status || '');
                      const ok = status && status !== 'Missing' && status !== 'Expired';
                      return (
                        <div className="mc-compliance-item" key={requiredDocsLoading ? `loading-${idx}` : String(doc?.key || idx)}>
                          <span>{title}</span>
                          <div className="mc-status-icon">
                            {requiredDocsLoading ? (
                              <i className="fa-solid fa-spinner fa-spin"></i>
                            ) : ok ? (
                              <i className="fa-solid fa-check"></i>
                            ) : (
                              <i className="fa-solid fa-exclamation-triangle"></i>
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
                {(requiredDocsError || complianceError) && (
                  <div style={{ marginTop: 10, fontSize: 12, color: theme.danger }}>
                    {requiredDocsError || complianceError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <span className={`int-status-badge ${complianceSyncProgress.missingCount === 0 && complianceSyncProgress.total > 0 ? 'active' : 'warning'}`}>
                    {tr('myCarrier.compliance.requiredDocsProgressLabel', 'Required Docs')}:{' '}
                    {complianceSyncProgress.completed}/{complianceSyncProgress.total} ({complianceSyncProgress.percent}%)
                  </span>
                  <span className={`int-status-badge ${Number(compliance?.compliance_score || 0) >= 80 ? 'active' : 'warning'}`}>
                    {tr('myCarrier.compliance.complianceScore', 'Compliance Score')}: {Number(compliance?.compliance_score || 0)}%
                  </span>
                  <span className={`int-status-badge ${consentEligibility?.eligible ? 'active' : 'warning'}`}>
                    {consentEligibility?.eligible
                      ? tr('myCarrier.compliance.consentsUpToDate', 'Consents up to date')
                      : tr('myCarrier.compliance.consentActionRequired', 'Consent action required')}
                  </span>
                </div>
                <p className={`int-status-badge ${consentEligibility?.eligible ? 'active' : 'warning'}`} style={{ marginTop: 10 }}>
                  {consentEligibility?.eligible
                    ? tr('myCarrier.compliance.consentShareOk', 'Driver has consented to share information with this carrier.')
                    : tr('myCarrier.compliance.consentShareMissing', 'Driver has not completed required consents for sharing/marketplace access.')}
                </p>
              </div>

              {/* Communication Hub */}
              <div className="card mc-communication-card">
                <div className="card-header">
                  <h3>{tr('myCarrier.communication.title', 'Communication Hub')}</h3>
                </div>
                <div className="mc-contact-info">
                  <div className="mc-dispatcher">
                    <img
                      src={commThread?.other_photo_url || 'https://randomuser.me/api/portraits/women/32.jpg'}
                      alt={commThread?.display_title || commThread?.other_display_name || tr('myCarrier.communication.dispatchFallback', 'Dispatch')}
                      className="mc-dispatcher-avatar"
                    />
                    <div className="mc-dispatcher-info">
                      <h4>{commThread?.display_title || commThread?.other_display_name || tr('myCarrier.communication.dispatchFallback', 'Dispatch')}</h4>
                      <span>{commThread ? tr('myCarrier.communication.messaging', 'Messaging') : tr('myCarrier.communication.dispatcher', 'Dispatcher')}</span>
                    </div>
                  </div>

                  {messagingError && (
                    <div style={{ marginTop: 10, fontSize: 12, color: theme.danger }}>{messagingError}</div>
                  )}

                  {commThread?.last_message?.text ? (
                    <div className="mc-recent-activity">
                      <h4>{tr('myCarrier.communication.recentActivity', 'Recent Activity')}</h4>
                      <span className="mc-activity-time">{fmtWhen(commThread?.last_message_at || commThread?.updated_at)}</span>
                      <p>"{String(commThread.last_message.text)}"</p>
                    </div>
                  ) : null}

                  <div className="mc-communication-actions">
                    <button className="btn small-cd" onClick={() => openMessaging(commThread?.id || null)} disabled={messagingLoading}>
                      <i className="fa-solid fa-message"></i>
                      {tr('common.message', 'Message')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="card mc-quick-actions-card">
                <div className="card-header">
                  <h3>{tr('myCarrier.quickActions.title', 'Quick Actions')}</h3>
                </div>
                <div className="mc-quick-actions">
                  <button className="btn small-cd" onClick={() => { setUploadError(''); setUploadFile(null); setUploadDocType('other'); setShowUploadDocsModal(true); }}>
                    <i className="fa-solid fa-upload"></i>
                    <span>{tr('myCarrier.quickActions.uploadDocuments', 'Upload Documents')}</span>
                  </button>
                  <button className="btn small-cd" onClick={openSchedule}>
                    <i className="fa-solid fa-calendar"></i>
                    <span>{tr('myCarrier.quickActions.viewSchedule', 'View Schedule')}</span>
                  </button>
                  <button className="btn small-cd" onClick={() => setShowPerformanceModal(true)}>
                    <i className="fa-solid fa-chart-line"></i>
                    <span>{tr('myCarrier.quickActions.performanceReport', 'Performance Report')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Upload Documents Modal */}
          {showUploadDocsModal && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1150 }}
              onClick={() => setShowUploadDocsModal(false)}
            >
              <div
                style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 560, width: '92%', border: `1px solid ${theme.border}` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.upload.modal.title', 'Upload Document')}</h3>
                  <button
                    onClick={() => setShowUploadDocsModal(false)}
                    style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                  >
                    {tr('common.close', 'Close')}
                  </button>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 650, color: theme.text }}>{tr('myCarrier.upload.modal.documentType', 'Document Type')} *</label>
                  <select
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}
                  >
                    <option value="cdl">{tr('myCarrier.upload.docType.cdl', 'CDL License')}</option>
                    <option value="medical_card">{tr('myCarrier.upload.docType.medicalCard', 'DOT Medical Card')}</option>
                    <option value="mvr">{tr('myCarrier.upload.docType.mvr', 'Motor Vehicle Record (MVR)')}</option>
                    <option value="w9">{tr('myCarrier.upload.docType.w9', 'W-9 Tax Form')}</option>
                    <option value="drug_test">{tr('myCarrier.upload.docType.drugTest', 'Drug Test Results')}</option>
                    <option value="background_check">{tr('myCarrier.upload.docType.backgroundCheck', 'Background Check')}</option>
                    <option value="consent">{tr('myCarrier.upload.docType.consent', 'Consent Form')}</option>
                    <option value="other">{tr('myCarrier.upload.docType.other', 'Other')}</option>
                  </select>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 650, color: theme.text }}>{tr('myCarrier.upload.modal.selectFile', 'Select File')} *</label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    style={{ width: '100%' }}
                  />
                  {uploadFile && (
                    <div style={{ marginTop: 8, fontSize: 12, color: theme.muted }}>
                      {tr('myCarrier.upload.modal.selectedPrefix', 'Selected')}: {uploadFile.name}
                    </div>
                  )}
                </div>

                {uploadError && (
                  <div style={{ color: theme.danger, marginBottom: 12 }}>{uploadError}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    onClick={() => setShowUploadDocsModal(false)}
                    style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}
                    disabled={uploadSubmitting}
                  >
                    {tr('common.cancel', 'Cancel')}
                  </button>
                  <button
                    className="btn small-cd"
                    onClick={submitQuickUpload}
                    disabled={uploadSubmitting || !uploadFile}
                  >
                    {uploadSubmitting ? tr('common.uploading', 'Uploading…') : tr('common.upload', 'Upload')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Schedule Calendar Modal */}
          {showScheduleModal && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1160 }}
              onClick={() => setShowScheduleModal(false)}
            >
              <div
                style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 1100, width: '94%', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${theme.border}` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div>
                    <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.schedule.title', 'Schedule')}</h3>
                    <div style={{ fontSize: 12, color: theme.muted }}>{tr('myCarrier.schedule.subtitle', 'Pickups, deliveries, and document expirations')}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn small ghost-cd"
                      onClick={exportScheduleIcs}
                      disabled={Boolean(scheduleLoading)}
                      title={`${tr('myCarrier.schedule.ics.exportForPrefix', 'Export for')} ${calendarProvider}`}
                    >
                      {tr('myCarrier.schedule.ics.exportButton', 'Export Calendar (.ics)')}
                    </button>
                    <button
                      onClick={() => setShowScheduleModal(false)}
                      style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                    >
                      {tr('common.close', 'Close')}
                    </button>
                  </div>
                </div>

                {scheduleError && <div style={{ color: theme.danger, marginBottom: 12 }}>{scheduleError}</div>}
                {scheduleLoading ? (
                  <div style={{ padding: 16, color: theme.muted }}>
                    <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 10 }}></i>
                    {tr('myCarrier.schedule.loading', 'Loading schedule…')}
                  </div>
                ) : (
                  (() => {
                    const monthStart = scheduleMonth;
                    const year = monthStart.getFullYear();
                    const month = monthStart.getMonth();
                    const firstDow = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const cells = [];
                    for (let i = 0; i < firstDow; i++) cells.push(null);
                    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

                    const eventsInMonth = scheduleEvents.filter(e => e.date.getFullYear() === year && e.date.getMonth() === month);
                    const eventsForDay = scheduleEvents.filter(e => sameDay(e.date, selectedScheduleDay));

                    const dayCount = (day) => eventsInMonth.filter(e => sameDay(e.date, day)).length;

                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
                        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
                          <div style={{ padding: 12, background: theme.surfaceAlt, borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <button
                                onClick={() => {
                                  const prev = new Date(year, month - 1, 1);
                                  setScheduleMonth(prev);
                                  setSelectedScheduleDay(new Date(prev.getFullYear(), prev.getMonth(), 1));
                                }}
                                style={{ border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }}
                                aria-label={tr('myCarrier.schedule.aria.previousMonth', 'Previous month')}
                              >
                                <i className="fa-solid fa-chevron-left"></i>
                              </button>
                              <div style={{ fontWeight: 800, color: theme.text, minWidth: 180, textAlign: 'center' }}>
                                {monthStart.toLocaleString(locale, { month: 'long', year: 'numeric' })}
                              </div>
                              <button
                                onClick={() => {
                                  const next = new Date(year, month + 1, 1);
                                  setScheduleMonth(next);
                                  setSelectedScheduleDay(new Date(next.getFullYear(), next.getMonth(), 1));
                                }}
                                style={{ border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }}
                                aria-label={tr('myCarrier.schedule.aria.nextMonth', 'Next month')}
                              >
                                <i className="fa-solid fa-chevron-right"></i>
                              </button>
                            </div>
                            <span className="int-status-badge active">{eventsInMonth.length} {tr('myCarrier.schedule.events', 'events')}</span>
                          </div>
                          <div style={{ padding: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6, fontSize: 12, color: theme.muted }}>
                              {[
                                tr('myCarrier.schedule.dow.sun', 'Sun'),
                                tr('myCarrier.schedule.dow.mon', 'Mon'),
                                tr('myCarrier.schedule.dow.tue', 'Tue'),
                                tr('myCarrier.schedule.dow.wed', 'Wed'),
                                tr('myCarrier.schedule.dow.thu', 'Thu'),
                                tr('myCarrier.schedule.dow.fri', 'Fri'),
                                tr('myCarrier.schedule.dow.sat', 'Sat')
                              ].map(x => (<div key={x} style={{ textAlign: 'center' }}>{x}</div>))}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                              {cells.map((day, idx) => {
                                if (!day) return <div key={idx} style={{ height: 46 }} />;
                                const count = dayCount(day);
                                const selected = sameDay(day, selectedScheduleDay);
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => setSelectedScheduleDay(day)}
                                    style={{
                                      height: 46,
                                      borderRadius: 10,
                                      border: `1px solid ${theme.border}`,
                                      background: selected ? theme.surfaceAlt : theme.surface,
                                      color: theme.text,
                                      cursor: 'pointer',
                                      position: 'relative',
                                      fontWeight: 750
                                    }}
                                  >
                                    {day.getDate()}
                                    {count > 0 && (
                                      <span style={{ position: 'absolute', top: 6, right: 6 }} className="int-status-badge active">{count}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
                          <div style={{ padding: 12, background: theme.surfaceAlt, borderBottom: `1px solid ${theme.border}` }}>
                            <div style={{ fontWeight: 800, color: theme.text }}>
                              {selectedScheduleDay.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                            <div style={{ fontSize: 12, color: theme.muted }}>{tr('myCarrier.schedule.eventsForSelectedDay', 'Events for selected day')}</div>
                          </div>
                          <div style={{ padding: 12 }}>
                            {eventsForDay.length === 0 ? (
                              <div style={{ color: theme.muted, padding: 10 }}>{tr('myCarrier.schedule.noEventsForDay', 'No events for this day.')}</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {eventsForDay.map((e, i) => (
                                  <div key={i} style={{ padding: 12, borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.surface }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                                      <div style={{ fontWeight: 800, color: theme.text }}>{e.title}</div>
                                      <span className={`int-status-badge ${e.kind === 'expiry' ? 'warning' : 'active'}`}>{e.kind.toUpperCase()}</span>
                                    </div>
                                    {e.meta?.load_id && (
                                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                                        <button className="btn small ghost-cd" onClick={() => openDocsForLoad(loads.find(x => getLoadId(x) === e.meta.load_id) || { load_id: e.meta.load_id })}>
                                          {tr('myCarrier.schedule.viewLoadDocs', 'View Load Docs')}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
                              <div style={{ fontWeight: 800, color: theme.text, marginBottom: 8 }}>{tr('myCarrier.schedule.upcomingTitle', 'Upcoming (next 45 days)')}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {scheduleEvents
                                  .filter(e => (e.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 45)
                                  .slice(0, 12)
                                  .map((e, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 10, background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                                      <div style={{ color: theme.text, fontWeight: 700 }}>{e.title}</div>
                                      <div style={{ color: theme.muted, fontSize: 12 }}>{e.date.toLocaleDateString(locale)}</div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          )}

          {/* Performance Report Modal */}
          {showPerformanceModal && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1170 }}
              onClick={() => setShowPerformanceModal(false)}
            >
              <div
                style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 1100, width: '94%', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${theme.border}` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div>
                    <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.performance.title', 'Performance Report')}</h3>
                    <div style={{ fontSize: 12, color: theme.muted }}>{tr('myCarrier.performance.subtitle', 'Operational insights based on your assignments')}</div>
                  </div>
                  <button
                    onClick={() => setShowPerformanceModal(false)}
                    style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                  >
                    {tr('common.close', 'Close')}
                  </button>
                </div>

                {(() => {
                  const total = categorized.list.length;
                  const active = categorized.active.length;
                  const completed = categorized.completed.length;
                  const archived = categorized.archived.length;
                  const delivered = categorized.completed.filter(l => ['delivered', 'completed'].includes(normalizeStatus(l.status))).length;
                  const successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
                  const complianceScore = Number(compliance?.compliance_score || 0);
                  const hasConsent = !!consentEligibility?.eligible;
                  const latestMsg = commThread?.last_message?.text ? String(commThread.last_message.text) : '';

                  const metricCard = (title, value, sub) => (
                    <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.surfaceAlt }}>
                      <div style={{ fontSize: 12, color: theme.muted, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
                      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 900, color: theme.text }}>{value}</div>
                      {sub ? <div style={{ marginTop: 6, fontSize: 12, color: theme.muted }}>{sub}</div> : null}
                    </div>
                  );

                  return (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                        {metricCard(
                          tr('myCarrier.performance.metrics.totalAssignments', 'Total Assignments'),
                          total,
                          tr('myCarrier.performance.metrics.totalAssignmentsSub', 'All-time loads currently visible to you')
                        )}
                        {metricCard(
                          tr('myCarrier.performance.metrics.activeLoads', 'Active Loads'),
                          active,
                          tr('myCarrier.performance.metrics.activeLoadsSub', 'Covered/Assigned/In Transit')
                        )}
                        {metricCard(
                          tr('myCarrier.performance.metrics.completedLoads', 'Completed Loads'),
                          completed,
                          tr('myCarrier.performance.metrics.completedLoadsSub', 'Delivered/Completed')
                        )}
                        {metricCard(
                          tr('myCarrier.performance.metrics.completionRate', 'Completion Rate'),
                          `${successRate}%`,
                          total
                            ? `${delivered} ${tr('myCarrier.performance.metrics.completedSuffix', 'completed')}`
                            : tr('myCarrier.performance.metrics.noAssignmentsYet', 'No assignments yet')
                        )}
                      </div>

                      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
                        <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.surface }}>
                          <div style={{ fontWeight: 900, color: theme.text, marginBottom: 10 }}>{tr('myCarrier.performance.qualityTitle', 'Quality & Compliance')}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <span className={`int-status-badge ${complianceScore >= 80 ? 'active' : 'warning'}`}>{tr('myCarrier.compliance.complianceScore', 'Compliance Score')}: {complianceScore}%</span>
                            <span className={`int-status-badge ${hasConsent ? 'active' : 'warning'}`}>{hasConsent ? tr('myCarrier.performance.consentsOk', 'Consents: OK') : tr('myCarrier.performance.consentsActionNeeded', 'Consents: Action needed')}</span>
                            <span className={`int-status-badge ${archived === 0 ? 'active' : 'warning'}`}>{tr('myCarrier.performance.archivedLabel', 'Archived')}: {archived}</span>
                          </div>
                          <div style={{ marginTop: 12, color: theme.muted, fontSize: 13 }}>
                            {tr('myCarrier.performance.ratingsHint', 'Ratings and reviews will appear here once shippers/carriers submit feedback for completed loads.')}
                          </div>
                        </div>

                        <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.surface }}>
                          <div style={{ fontWeight: 900, color: theme.text, marginBottom: 10 }}>{tr('myCarrier.performance.recentMessagingTitle', 'Recent Messaging')}</div>
                          {latestMsg ? (
                            <div style={{ color: theme.text, fontSize: 14, lineHeight: 1.4 }}>
                              “{latestMsg}”
                              <div style={{ marginTop: 8, color: theme.muted, fontSize: 12 }}>{fmtWhen(commThread?.last_message_at || commThread?.updated_at)}</div>
                              <div style={{ marginTop: 10 }}>
                                <button className="btn small-cd" onClick={() => openMessaging(commThread?.id || null)}>{tr('myCarrier.communication.openMessaging', 'Open Messaging')}</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ color: theme.muted, fontSize: 13 }}>
                              {tr('myCarrier.performance.noRecentMessages', 'No recent messages to display.')}
                              <div style={{ marginTop: 10 }}>
                                <button className="btn small-cd" onClick={() => openMessaging(null)}>{tr('myCarrier.communication.openMessaging', 'Open Messaging')}</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* View Docs Modal */}
          {showDocsModal && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}
              onClick={() => setShowDocsModal(false)}
            >
              <div
                style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 860, width: '92%', maxHeight: '82vh', overflow: 'auto', border: `1px solid ${theme.border}` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.docs.loadDocumentsTitle', 'Load Documents')}</h3>
                    <div style={{ color: theme.muted, fontSize: 13 }}>
                      {tr('myCarrier.labels.loadNumber', 'Load #')} {docsLoad ? (docsLoad.load_number || getLoadId(docsLoad) || '—') : '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDocsModal(false)}
                    style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                  >
                    {tr('common.close', 'Close')}
                  </button>
                </div>

                {docsError && (
                  <div style={{ color: theme.danger, marginBottom: 12 }}>{docsError}</div>
                )}

                {docsLoading ? (
                  <div style={{ color: theme.muted, padding: 16 }}>
                    <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 10 }}></i>
                    {tr('myCarrier.docs.loading', 'Loading documents…')}
                  </div>
                ) : (
                  <>
                    {docs.length === 0 ? (
                      <div style={{ color: theme.muted, padding: 16 }}>{tr('myCarrier.docs.empty', 'No documents uploaded for this load yet.')}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {docs
                          .slice()
                          .sort((a, b) => Number(b?.created_at || b?.uploaded_at || 0) - Number(a?.created_at || a?.uploaded_at || 0))
                          .map((d) => {
                            const id = d?.doc_id || d?.id || d?.storage_path || d?.url || Math.random();
                            const kind = String(d?.kind || 'OTHER').toUpperCase();
                            const url = d?.url || d?.download_url;
                            const uploadedBy = String(d?.uploaded_by_role || '').toLowerCase();
                            const isShipperProvided = uploadedBy === 'shipper' || uploadedBy === 'broker';
                            return (
                              <div key={id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 10, background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                                <button
                                  className="btn small-cd"
                                  onClick={() => {
                                    if (url) window.open(url, '_blank');
                                    else alert(tr('myCarrier.docs.error.urlNotAvailable', 'Document URL not available'));
                                  }}
                                >
                                  {tr('common.view', 'View')}
                                </button>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 700, color: theme.text }}>{kind.replace(/_/g, ' ')}</div>
                                  <div style={{ fontSize: 13, color: theme.muted }}>
                                    {d?.filename || d?.file_name || d?.original_filename || tr('documentVault.documentFallback', 'Document')}
                                    {isShipperProvided ? ` • ${tr('myCarrier.docs.shipperUploaded', 'Shipper uploaded')}` : ''}
                                  </div>
                                </div>
                                <span className={`int-status-badge ${kind === 'POD' ? 'active' : 'pending'}`}>{kind}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Complete Pickup Modal (BOL + signature) */}
          {showPickupModal && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1250 }}
              onClick={() => setShowPickupModal(false)}
            >
              <div
                style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 980, width: '94%', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${theme.border}` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.pickup.modal.title', 'Complete Pickup')}</h3>
                    <div style={{ color: theme.muted, fontSize: 13 }}>
                      {tr('myCarrier.labels.loadNumber', 'Load #')} {pickupLoad ? (pickupLoad.load_number || getLoadId(pickupLoad) || '—') : '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowPickupModal(false)}
                    style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                  >
                    {tr('common.close', 'Close')}
                  </button>
                </div>

                {pickupError && (
                  <div style={{ color: theme.danger, marginBottom: 12 }}>{pickupError}</div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
                  <div style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                          {tr('myCarrier.pickup.shipperName', 'Shipper / Warehouse Name')} *
                        </label>
                        <input
                          value={pickupShipperName}
                          onChange={(e) => setPickupShipperName(e.target.value)}
                          placeholder={tr('myCarrier.pickup.shipperPlaceholder', 'Name on pickup receipt')}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                          {tr('myCarrier.pickup.bol', 'Bill of Lading (BOL)')} *
                        </label>
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          onChange={(e) => setPickupBolFile(e.target.files?.[0] || null)}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}
                          disabled={pickupSubmitting}
                        />
                        <div style={{ marginTop: 6, color: theme.muted, fontSize: 12 }}>
                          {pickupBolFile ? `${tr('myCarrier.pickup.selected', 'Selected')}: ${pickupBolFile.name}` : tr('myCarrier.pickup.bolHint', 'Upload the signed BOL at pickup before starting the trip.')}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                        {tr('myCarrier.pickup.gps.label', 'GPS')}
                      </label>
                      <button className="btn small-cd" onClick={refreshPickupGps} disabled={pickupSubmitting}>
                        {tr('myCarrier.pickup.gps.getCurrentLocation', 'Get Current Location')}
                      </button>
                      <div style={{ marginTop: 8, fontSize: 12, color: theme.muted }}>
                        {pickupGps?.lat != null
                          ? `${tr('myCarrier.pickup.gps.latLng', 'Lat/Lng')}: ${Number(pickupGps.lat).toFixed(6)}, ${Number(pickupGps.lng).toFixed(6)} (±${pickupGps?.accuracy ? Math.round(pickupGps.accuracy) : '—'}m)`
                          : tr('myCarrier.pickup.gps.locationNotCaptured', 'Location not captured')}
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                        {tr('myCarrier.pickup.signature', 'Pickup Signature')} *
                      </label>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div>
                          <canvas
                            ref={pickupCanvasRef}
                            onPointerDown={pickupPointerDown}
                            onPointerMove={pickupPointerMove}
                            onPointerUp={pickupPointerUp}
                            onPointerLeave={pickupPointerUp}
                            style={{ background: '#ffffff', borderRadius: 10, border: `1px solid ${theme.border}`, touchAction: 'none' }}
                          />
                          <div style={{ marginTop: 6, fontSize: 12, color: pickupHasSignature ? '#059669' : theme.muted }}>
                            {pickupHasSignature ? tr('myCarrier.pickup.signature.captured', 'Signature captured.') : tr('myCarrier.pickup.signature.drawHint', 'Have the shipper sign in the box.')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <button
                            type="button"
                            onClick={clearPickupSignature}
                            style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}
                            disabled={pickupSubmitting}
                          >
                            {tr('myCarrier.pickup.signature.clear', 'Clear Signature')}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                        {tr('myCarrier.pickup.remarks', 'Remarks (optional)')}
                      </label>
                      <textarea
                        value={pickupRemarks}
                        onChange={(e) => setPickupRemarks(e.target.value)}
                        placeholder={tr('myCarrier.pickup.remarksPlaceholder', 'Notes about pickup condition, exceptions, etc.')}
                        rows={3}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}
                        disabled={pickupSubmitting}
                      />
                    </div>

                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button
                        onClick={() => setShowPickupModal(false)}
                        style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}
                        disabled={pickupSubmitting}
                      >
                        {tr('common.cancel', 'Cancel')}
                      </button>
                      <button className="btn small-cd" onClick={submitPickup} disabled={pickupSubmitting}>
                        {pickupSubmitting ? tr('myCarrier.common.submitting', 'Submitting…') : tr('myCarrier.pickup.actions.complete', 'Complete Pickup & Start Trip')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Upload POD Modal */}
          {showPodModal && (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}
              onClick={() => setShowPodModal(false)}
            >
              <div
                style={{ background: theme.surface, borderRadius: 12, padding: 22, maxWidth: 1100, width: '94%', maxHeight: '86vh', overflow: 'auto', border: `1px solid ${theme.border}` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, color: theme.text }}>{tr('myCarrier.pod.modal.title', 'Upload Proof of Delivery (POD)')}</h3>
                    <div style={{ color: theme.muted, fontSize: 13 }}>
                      {tr('myCarrier.labels.loadNumber', 'Load #')} {podLoad ? (podLoad.load_number || getLoadId(podLoad) || '—') : '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowPodModal(false)}
                    style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                  >
                    {tr('common.close', 'Close')}
                  </button>
                </div>

                {podError && (
                  <div style={{ color: theme.danger, marginBottom: 12 }}>{podError}</div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
                  <div style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt, borderRadius: 12, padding: 14 }}>
                    <h4 style={{ margin: '0 0 10px', color: theme.text }}>{tr('myCarrier.pod.deliveryChecksTitle', 'Delivery Checks')}</h4>

                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.receiverName', 'Receiver Name')} *</label>
                      <input
                        value={podReceiverName}
                        onChange={(e) => setPodReceiverName(e.target.value)}
                        placeholder={tr('myCarrier.pod.receiverPlaceholder', 'Receiver / warehouse contact')}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}
                      />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.gps.label', 'GPS (must be within 10m)')}</label>
                      <button className="btn small-cd" onClick={refreshPodGps} disabled={podSubmitting}>
                        {tr('myCarrier.pod.gps.getCurrentLocation', 'Get Current Location')}
                      </button>
                      <div style={{ marginTop: 8, fontSize: 12, color: theme.muted }}>
                        {podGps?.lat != null
                          ? `${tr('myCarrier.pod.gps.latLng', 'Lat/Lng')}: ${Number(podGps.lat).toFixed(6)}, ${Number(podGps.lng).toFixed(6)} (±${podGps?.accuracy ? Math.round(podGps.accuracy) : '—'}m)`
                          : tr('myCarrier.pod.gps.locationNotCaptured', 'Location not captured')}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: theme.muted }}>
                        {podDestinationCoords?.lat != null
                          ? `${tr('myCarrier.pod.gps.deliveryCoords', 'Delivery coords')}: ${Number(podDestinationCoords.lat).toFixed(6)}, ${Number(podDestinationCoords.lng).toFixed(6)}`
                          : tr('myCarrier.pod.gps.deliveryCoordsUnavailable', 'Delivery coords not available (geocode failed)')}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: podChecks.gpsOk ? '#059669' : '#b45309' }}>
                        {podDistanceMeters == null
                          ? `${tr('myCarrier.pod.gps.distance', 'Distance')}: —`
                          : `${tr('myCarrier.pod.gps.distance', 'Distance')}: ${podDistanceMeters.toFixed(1)}m`}
                        {podChecks.gpsOk ? ` (${tr('myCarrier.pod.gps.ok', 'OK')})` : ` (${tr('myCarrier.pod.gps.needsWithin', 'needs ≤ 10m')})`}
                      </div>
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.timeRule.label', '48-hour rule')}</label>
                      <div style={{ fontSize: 12, color: podChecks.timeOk ? '#059669' : '#b45309' }}>
                        {podLoad?.delivery_date
                          ? `${tr('myCarrier.pod.timeRule.deliveryDate', 'Delivery date')}: ${podLoad.delivery_date}`
                          : tr('myCarrier.pod.timeRule.deliveryDateMissing', 'Delivery date missing')}
                        {podChecks.timeOk
                          ? ` (${tr('myCarrier.pod.timeRule.ok', 'OK')})`
                          : ` (${tr('myCarrier.pod.timeRule.mustBeWithin', 'must be within 48 hours')})`}
                      </div>
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: theme.text }}>
                        <input type="checkbox" checked={podChecks.confirmDelivered} onChange={(e) => setPodChecks(prev => ({ ...prev, confirmDelivered: e.target.checked }))} />
                        {tr('myCarrier.pod.confirm.deliveredFull', 'I confirm the shipment was delivered in full.')}
                      </label>
                      <label style={{ display: 'flex', gap: 10, alignItems: 'center', color: theme.text }}>
                        <input type="checkbox" checked={podChecks.confirmAccurate} onChange={(e) => setPodChecks(prev => ({ ...prev, confirmAccurate: e.target.checked }))} />
                        {tr('myCarrier.pod.confirm.accurate', 'I confirm the POD information is accurate.')}
                      </label>
                    </div>

                    <div style={{ marginTop: 14, borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
                      <h4 style={{ margin: '0 0 10px', color: theme.text }}>{tr('myCarrier.pod.signing.title', 'Signing')}</h4>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                        <button
                          className={`btn small ${podSignMethod === 'draw' ? 'small-cd' : 'ghost-cd'}`}
                          onClick={() => setPodSignMethod('draw')}
                          type="button"
                        >
                          {tr('myCarrier.pod.signing.draw', 'Draw')}
                        </button>
                        <button
                          className={`btn small ${podSignMethod === 'typed' ? 'small-cd' : 'ghost-cd'}`}
                          onClick={() => setPodSignMethod('typed')}
                          type="button"
                        >
                          {tr('myCarrier.pod.signing.typed', 'Typed')}
                        </button>
                        <button
                          className={`btn small ${podSignMethod === 'image' ? 'small-cd' : 'ghost-cd'}`}
                          onClick={() => setPodSignMethod('image')}
                          type="button"
                        >
                          {tr('myCarrier.pod.signing.signatureImage', 'Signature Image')}
                        </button>
                        {podSignMethod === 'image' && (
                          <button className="btn small ghost-cd" onClick={loadSignatureImage} type="button">
                            {tr('myCarrier.pod.signing.loadSignatureImage', 'Load Signature Image')}
                          </button>
                        )}
                      </div>

                      {podSignMethod === 'draw' && (
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>
                            {tr('myCarrier.pod.signing.drawLabel', 'Signature (draw)')} *
                          </label>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <div>
                              <canvas
                                ref={podCanvasRef}
                                onPointerDown={podSigPointerDown}
                                onPointerMove={podSigPointerMove}
                                onPointerUp={podSigPointerUp}
                                onPointerLeave={podSigPointerUp}
                                style={{ background: theme.surface, borderRadius: 10, border: `1px solid ${theme.border}`, touchAction: 'none' }}
                              />
                              <div style={{ marginTop: 6, fontSize: 12, color: podHasSignature ? '#059669' : theme.muted }}>
                                {podHasSignature
                                  ? tr('myCarrier.pod.signing.drawCaptured', 'Signature captured.')
                                  : tr('myCarrier.pod.signing.drawHint', 'Draw the receiver signature in the box.')}
                              </div>
                            </div>
                            <button
                              onClick={clearPodSignature}
                              style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}
                              type="button"
                              disabled={podSubmitting}
                            >
                              {tr('myCarrier.pod.signing.clear', 'Clear')}
                            </button>
                          </div>
                        </div>
                      )}

                      <label style={{ display: 'block', fontWeight: 650, color: theme.text, marginBottom: 6 }}>{tr('myCarrier.pod.signing.signerName', 'Signer Name')} *</label>
                      <input
                        value={podSignerName}
                        onChange={(e) => setPodSignerName(e.target.value)}
                        placeholder={tr('myCarrier.pod.signing.signerPlaceholder', 'Name on file')}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}
                      />
                      {podSignMethod === 'image' && (
                        <div style={{ marginTop: 8, fontSize: 12, color: podSignatureImageUrl ? '#059669' : theme.muted }}>
                          {podSignatureImageUrl
                            ? tr('myCarrier.pod.signing.signatureLoaded', 'Signature image loaded.')
                            : tr('myCarrier.pod.signing.signatureNotLoaded', 'Signature image not loaded.')}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button
                        onClick={() => setShowPodModal(false)}
                        style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer' }}
                        disabled={podSubmitting}
                      >
                        {tr('common.cancel', 'Cancel')}
                      </button>
                      <button
                        className="btn small-cd"
                        onClick={submitPod}
                        disabled={podSubmitting}
                      >
                        {podSubmitting ? tr('myCarrier.common.submitting', 'Submitting…') : tr('myCarrier.pod.actions.uploadAndMarkDelivered', 'Upload POD & Mark Delivered')}
                      </button>
                    </div>
                  </div>

                  <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', background: theme.surface }}>
                    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 700, color: theme.text }}>{tr('myCarrier.pod.preview.title', 'POD Preview')}</div>
                      <div style={{ color: theme.muted, fontSize: 12 }}>{tr('myCarrier.pod.preview.hint', 'This PDF will be uploaded to the load document vault.')}</div>
                    </div>
                    <iframe
                      ref={podIframeRef}
                      title={tr('myCarrier.pod.preview.iframeTitle', 'POD preview')}
                      style={{ width: '100%', height: '70vh', border: 'none', background: '#ffffff' }}
                      srcDoc={buildPodHtml()}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </>
    );
}