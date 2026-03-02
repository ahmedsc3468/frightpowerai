import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { API_URL } from '../../config';
import { AUTO_REFRESH_MS } from '../../constants/refresh';
import '../../styles/carrier/Calendar.css';
import '../../styles/shipper/RateConfirmationPanel.css';

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toYmd(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function parseYmd(s) {
  const text = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateFlexible(value) {
  if (value == null) return null;

  if (typeof value === 'object') {
    const seconds = value?.seconds ?? value?._seconds;
    const millis = value?.milliseconds ?? value?._milliseconds;
    if (typeof millis === 'number' && Number.isFinite(millis)) {
      const d = new Date(millis);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      const d = new Date(seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return parseDateFlexible(n);
  }

  const ymd = parseYmd(text);
  if (ymd) return ymd;

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDaysYmd(ymd, days) {
  const d = parseYmd(ymd);
  if (!d) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return toYmd(d);
}

function fmtMoney(amount) {
  const v = Number(amount || 0);
  if (!Number.isFinite(v)) return '$0';
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  } catch {
    return `$${Math.round(v)}`;
  }
}

function normalizeReminderMinutes(list) {
  const raw = Array.isArray(list) ? list : [];
  const uniq = new Set();
  for (const x of raw) {
    const m = Number(x);
    if (!Number.isFinite(m)) continue;
    const clamped = Math.max(0, Math.min(7 * 24 * 60, Math.round(m)));
    uniq.add(clamped);
  }
  return Array.from(uniq).sort((a, b) => a - b);
}

function pickFirstNonEmptyString(...vals) {
  for (const v of vals) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

export default function Calendar() {
  const { currentUser } = useAuth();
  const location = useLocation();

  const monthFetchInFlightRef = useRef(false);

  const [currentDate, setCurrentDate] = useState(new Date());

  const [calendarStatus, setCalendarStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [internalEvents, setInternalEvents] = useState([]);
  const [loads, setLoads] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [complianceDocs, setComplianceDocs] = useState([]);

  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncWorking, setSyncWorking] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  const [dayDetails, setDayDetails] = useState(null);

  const [form, setForm] = useState({
    title: '',
    all_day: true,
    start: toYmd(new Date()),
    end: toYmd(new Date()),
    description: '',
    location: '',
    reminder_minutes: 60,
    assign_to_users: false,
    driver_uids: [],
    shipper_uids: [],
  });

  const effectiveProvider = useMemo(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      const fromCb = String(qs.get('calendar_provider') || '').trim();
      if (fromCb) {
        localStorage.setItem('fp_carrier_calendar_provider', fromCb);
        return fromCb;
      }
      return String(localStorage.getItem('fp_carrier_calendar_provider') || '').trim();
    } catch {
      return '';
    }
  }, [location.search]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(day);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  };

  const openDayDetails = (dayNumber) => {
    if (!dayNumber) return;
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNumber);
    const ymd = toYmd(date);
    const dayEvents = getEventsForDay(dayNumber);
    setDayDetails({ ymd, dayNumber, events: dayEvents });
  };

  const navigateMonth = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const monthRange = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return { startYmd: toYmd(start), endYmd: toYmd(end) };
  }, [currentDate]);

  const uniqueDriversFromLoads = useMemo(() => {
    const byId = new Map();
    for (const l of Array.isArray(loads) ? loads : []) {
      const uid = String(l?.assigned_driver_uid || l?.assigned_driver_id || '').trim();
      if (!uid) continue;
      const name = String(l?.assigned_driver_name || l?.driver_name || 'Driver').trim();
      if (!byId.has(uid)) byId.set(uid, { uid, name });
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [loads]);

  const uniqueShippersFromLoads = useMemo(() => {
    const byId = new Map();
    for (const l of Array.isArray(loads) ? loads : []) {
      const uid = String(l?.created_by || l?.shipper_uid || l?.shipper_id || '').trim();
      if (!uid) continue;
      const name = String(l?.shipper_name || l?.created_by_name || l?.shipper?.name || 'Shipper').trim();
      if (!byId.has(uid)) byId.set(uid, { uid, name });
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [loads]);

  const fetchCalendarStatus = async () => {
    if (!currentUser) return;
    setStatusLoading(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/calendar/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setCalendarStatus(data || null);
    } catch {
      // ignore
    } finally {
      setStatusLoading(false);
    }
  };

  const fetchMonthData = async () => {
    if (!currentUser) return;
    if (monthFetchInFlightRef.current) return;
    monthFetchInFlightRef.current = true;
    setDataLoading(true);
    setDataError('');
    try {
      const token = await currentUser.getIdToken();
      const qs = new URLSearchParams();
      qs.set('start', monthRange.startYmd);
      qs.set('end', monthRange.endYmd);

      const [eventsRes, loadsRes, invoicesRes, complianceRes] = await Promise.all([
        fetch(`${API_URL}/calendar/internal/events?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/loads?exclude_drafts=true&page=1&page_size=250`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/invoices?limit=500`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/compliance/status`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const failures = [];
      const maybeAddFailure = (name, res) => {
        if (!res || res.ok) return;
        failures.push(`${name} ${res.status}`);
      };
      maybeAddFailure('Internal events', eventsRes);
      maybeAddFailure('Loads', loadsRes);
      maybeAddFailure('Invoices', invoicesRes);
      maybeAddFailure('Compliance', complianceRes);

      const isAuthFailure = [eventsRes, loadsRes, invoicesRes, complianceRes].some((r) => r && (r.status === 401 || r.status === 403));
      const allFailed = [eventsRes, loadsRes, invoicesRes, complianceRes].every((r) => r && !r.ok);
      if (isAuthFailure) {
        setDataError('Your session is not authorized for calendar data. Please log out and log back in.');
      } else if (allFailed && failures.length) {
        setDataError(`Failed to load calendar data (${failures.join(', ')}).`);
      } else if (failures.length) {
        setDataError(`Some calendar data failed to load (${failures.join(', ')}).`);
      }

      if (eventsRes.ok) {
        const data = await eventsRes.json();
        setInternalEvents(Array.isArray(data?.events) ? data.events : []);
      }
      if (loadsRes.ok) {
        const data = await loadsRes.json();
        setLoads(Array.isArray(data?.loads) ? data.loads : []);
      }
      if (invoicesRes.ok) {
        const data = await invoicesRes.json();
        setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
      }
      if (complianceRes.ok) {
        const data = await complianceRes.json();
        const docs = Array.isArray(data?.documents) ? data.documents : [];
        setComplianceDocs(docs);
      }
    } catch (e) {
      setDataError(String(e?.message || 'Failed to load calendar data'));
    } finally {
      setDataLoading(false);
      monthFetchInFlightRef.current = false;
    }
  };

  useEffect(() => {
    fetchCalendarStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    fetchMonthData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, monthRange.startYmd, monthRange.endYmd]);

  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      const auto = qs.get('calendar_auto_sync') === '1';
      const connected = qs.get('calendar_connected') === '1';
      const provider = String(qs.get('calendar_provider') || '').trim();
      if (auto && connected && provider) {
        syncExternal(provider);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      try {
        await fetchMonthData();
        await fetchCalendarStatus();
      } catch {
        // ignore
      }
    };

    const id = setInterval(tick, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, monthRange.startYmd, monthRange.endYmd]);

  const derivedEvents = useMemo(() => {
    const items = [];

    for (const l of Array.isArray(loads) ? loads : []) {
      const loadId = String(l?.load_id || l?.id || '').trim();
      const loadNum = String(l?.load_number || '').trim();
      const label = loadNum ? `Load #${loadNum}` : (loadId ? `Load ${loadId.slice(-8)}` : 'Load');
      const origin = String(l?.origin || '').trim();
      const destination = String(l?.destination || '').trim();
      const route = origin && destination ? `${origin} → ${destination}` : (origin || destination || '');

      const pickupRaw = pickFirstNonEmptyString(l?.pickup_date, l?.pickup_datetime, l?.pickup_time, l?.pickupDate);
      const deliveryRaw = pickFirstNonEmptyString(l?.delivery_date, l?.delivery_datetime, l?.delivery_time, l?.deliveryDate);

      const pickupDate = pickupRaw ? parseDateFlexible(pickupRaw) : null;
      const deliveryDate = deliveryRaw ? parseDateFlexible(deliveryRaw) : null;

      if (pickupDate && !Number.isNaN(pickupDate.getTime())) {
        const ymd = toYmd(pickupDate);
        items.push({
          id: `load:${loadId || label}:pickup:${ymd}`,
          internal_id: `load:${loadId || label}:pickup`,
          type: 'loads',
          all_day: true,
          start: ymd,
          end: addDaysYmd(ymd, 1),
          title: label,
          subtitle: route ? `Pickup • ${route}` : 'Pickup',
          description: route ? `Pickup for ${label} (${route})` : `Pickup for ${label}`,
        });
      }

      if (deliveryDate && !Number.isNaN(deliveryDate.getTime())) {
        const ymd = toYmd(deliveryDate);
        items.push({
          id: `load:${loadId || label}:delivery:${ymd}`,
          internal_id: `load:${loadId || label}:delivery`,
          type: 'loads',
          all_day: true,
          start: ymd,
          end: addDaysYmd(ymd, 1),
          title: label,
          subtitle: route ? `Delivery • ${route}` : 'Delivery',
          description: route ? `Delivery for ${label} (${route})` : `Delivery for ${label}`,
        });
      }
    }

    for (const inv of Array.isArray(invoices) ? invoices : []) {
      const dueDate = parseDateFlexible(inv?.due_date || inv?.dueDate || inv?.due_at || inv?.dueAt);
      if (!dueDate) continue;
      const ymd = toYmd(dueDate);
      const invoiceId = String(inv?.invoice_id || '').trim();
      const invoiceNum = String(inv?.invoice_number || '').trim();
      const amount = Number(inv?.amount_total || 0);
      const status = String(inv?.status || '').trim();
      const title = invoiceNum ? `Invoice ${invoiceNum}` : (invoiceId ? `Invoice ${invoiceId.slice(-8)}` : 'Invoice');
      items.push({
        id: `invoice:${invoiceId || title}:due:${ymd}`,
        internal_id: `invoice:${invoiceId || title}:due`,
        type: 'finance',
        all_day: true,
        start: ymd,
        end: addDaysYmd(ymd, 1),
        title,
        subtitle: status ? `Due ${fmtMoney(amount)} • ${status}` : `Due ${fmtMoney(amount)}`,
        description: `Invoice due: ${title} (${fmtMoney(amount)})`,
      });
    }

    for (const doc of Array.isArray(complianceDocs) ? complianceDocs : []) {
      const expiryRaw = pickFirstNonEmptyString(
        doc?.expiration_date,
        doc?.expiry_date,
        doc?.extracted_fields?.expiration_date,
        doc?.extracted_fields?.expiry_date,
      );
      const expiryDate = parseDateFlexible(expiryRaw);
      if (!expiryDate) continue;
      const ymd = toYmd(expiryDate);
      const docType = String(doc?.document_type || doc?.type || 'Document').trim();
      const file = String(doc?.file_name || doc?.filename || '').trim();
      const title = docType || file || 'Compliance Doc';
      const docId = String(doc?.id || file || docType || '').trim();
      items.push({
        id: `compliance:${docId}:expiry:${ymd}`,
        internal_id: `compliance:${docId}:expiry`,
        type: 'compliance',
        all_day: true,
        start: ymd,
        end: addDaysYmd(ymd, 1),
        title: title.length > 28 ? `${title.slice(0, 25)}...` : title,
        subtitle: 'Expires',
        description: `Compliance document expires: ${title}`,
      });
    }

    for (const e of Array.isArray(internalEvents) ? internalEvents : []) {
      const start = String(e?.start || '').trim();
      const end = String(e?.end || '').trim();
      const title = String(e?.title || 'Event').trim();
      const evId = String(e?.id || '').trim();
      items.push({
        id: evId || `internal:${start}:${title}`,
        internal_id: `internal:${evId || title}:${start}`,
        type: 'internal',
        all_day: Boolean(e?.all_day !== false),
        start,
        end: end || (start ? addDaysYmd(start, 1) : ''),
        title,
        subtitle: e?.location ? String(e.location) : (Array.isArray(e?.reminders) && e.reminders.length ? `Reminder: ${Math.min(...e.reminders)}m` : ''),
        description: String(e?.description || '').trim(),
        location: String(e?.location || '').trim(),
        reminders: Array.isArray(e?.reminders) ? e.reminders : [],
        assigned_driver_uids: Array.isArray(e?.assigned_driver_uids) ? e.assigned_driver_uids : [],
      });
    }

    const startYmd = monthRange.startYmd;
    const endYmd = monthRange.endYmd;
    return items
      .filter((it) => {
        const s = String(it?.start || '').trim();
        return s && s >= startYmd && s <= endYmd;
      })
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }, [loads, invoices, complianceDocs, internalEvents, monthRange.startYmd, monthRange.endYmd]);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    for (const e of derivedEvents) {
      const key = String(e?.start || '').trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => String(a.type).localeCompare(String(b.type)));
      map.set(k, list);
    }
    return map;
  }, [derivedEvents]);

  const getEventsForDay = (day) => {
    if (!day) return [];
    const dateString = `${currentDate.getFullYear()}-${pad2(currentDate.getMonth() + 1)}-${pad2(day)}`;
    return eventsByDate.get(dateString) || [];
  };

  const cardData = useMemo(() => {
    const normalizeStatus = (s) => String(s || '').trim().toLowerCase();
    const activeStatuses = new Set(['posted', 'tendered', 'covered', 'accepted', 'awarded', 'dispatched', 'in_transit']);

    const monthLoads = (Array.isArray(loads) ? loads : []).filter((l) => {
      const pickupRaw = pickFirstNonEmptyString(l?.pickup_date, l?.pickup_datetime, l?.pickupDate);
      const deliveryRaw = pickFirstNonEmptyString(l?.delivery_date, l?.delivery_datetime, l?.deliveryDate);
      const pickup = pickupRaw ? parseDateFlexible(pickupRaw) : null;
      const delivery = deliveryRaw ? parseDateFlexible(deliveryRaw) : null;
      const month = currentDate.getMonth();
      const year = currentDate.getFullYear();
      const pickupInMonth = pickup && !Number.isNaN(pickup.getTime()) && pickup.getMonth() === month && pickup.getFullYear() === year;
      const deliveryInMonth = delivery && !Number.isNaN(delivery.getTime()) && delivery.getMonth() === month && delivery.getFullYear() === year;
      return pickupInMonth || deliveryInMonth;
    });

    const activeLoads = monthLoads.filter((l) => activeStatuses.has(normalizeStatus(l?.status || l?.load_status)));

    let complianceUpcoming = 0;
    const now = Date.now();
    const horizon = now + 30 * 24 * 60 * 60 * 1000;
    for (const doc of Array.isArray(complianceDocs) ? complianceDocs : []) {
      const expiryRaw = pickFirstNonEmptyString(
        doc?.expiration_date,
        doc?.expiry_date,
        doc?.extracted_fields?.expiration_date,
        doc?.extracted_fields?.expiry_date,
      );
      const d = parseDateFlexible(expiryRaw);
      if (!d) continue;
      const ts = d.getTime();
      if (ts >= now && ts <= horizon) complianceUpcoming += 1;
    }

    let weekRevenue = 0;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    for (const inv of Array.isArray(invoices) ? invoices : []) {
      const s = normalizeStatus(inv?.status);
      if (s !== 'paid' && s !== 'partially_paid') continue;

      const paidAtDate = parseDateFlexible(inv?.paid_at || inv?.paidAt || inv?.paid_date || inv?.paidDate);
      if (!paidAtDate) continue;
      const ts = paidAtDate.getTime();
      if (ts < weekAgo || ts > now) continue;

      const amount = s === 'paid' ? Number(inv?.amount_total || 0) : Number(inv?.amount_paid || 0);
      weekRevenue += Number.isFinite(amount) ? amount : 0;
    }

    const status = calendarStatus || {};
    const googleConnected = Boolean(status?.google?.connected);
    const outlookConnected = Boolean(status?.outlook?.connected);

    let syncLabel = 'Not Connected';
    if (effectiveProvider === 'google' && googleConnected) syncLabel = 'Google Connected';
    else if (effectiveProvider === 'outlook' && outlookConnected) syncLabel = 'Outlook Connected';
    else if (googleConnected && outlookConnected) syncLabel = 'Google + Outlook Connected';
    else if (googleConnected) syncLabel = 'Google Connected';
    else if (outlookConnected) syncLabel = 'Outlook Connected';

    return {
      activeLoadsCount: activeLoads.length,
      complianceUpcoming,
      weekRevenueLabel: fmtMoney(weekRevenue),
      syncLabel,
    };
  }, [loads, invoices, complianceDocs, calendarStatus, currentDate, effectiveProvider]);

  const startCalendarConnect = async (provider) => {
    if (!currentUser) return;
    const prov = String(provider || '').trim();
    if (!prov) return;

    setSyncWorking(true);
    setSyncMsg('');
    try {
      const token = await currentUser.getIdToken();
      const returnTo = `/carrier-dashboard?nav=calendar`;
      const res = await fetch(`${API_URL}/calendar/oauth/${encodeURIComponent(prov)}/start?return_to=${encodeURIComponent(returnTo)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res.ok ? await res.json() : null;
      const authUrl = String(data?.auth_url || '').trim();
      if (!authUrl) {
        setSyncMsg('Calendar OAuth is not configured yet on the backend.');
        return;
      }
      localStorage.setItem('fp_carrier_calendar_provider', prov);
      window.location.assign(authUrl);
    } catch {
      setSyncMsg('Failed to start calendar connection.');
    } finally {
      setSyncWorking(false);
    }
  };

  const syncExternal = async (provider) => {
    if (!currentUser) return;
    const prov = String(provider || effectiveProvider || '').trim();
    if (!prov) {
      setSyncMsg('Select Google or Outlook.');
      return;
    }

    setSyncWorking(true);
    setSyncMsg('');
    try {
      const token = await currentUser.getIdToken();

      const now = new Date();
      const horizon = new Date(now);
      horizon.setDate(horizon.getDate() + 60);
      const startYmd = toYmd(new Date(now.getFullYear(), now.getMonth(), 1));
      const endYmd = toYmd(horizon);

      const events = derivedEvents
        .filter((e) => {
          const s = String(e?.start || '').trim();
          return s && s >= startYmd && s <= endYmd;
        })
        .slice(0, 250)
        .map((e) => {
          const reminders = normalizeReminderMinutes(e?.reminders);
          return {
            internal_id: String(e?.internal_id || e?.id || '').trim() || `fp:${String(e?.type || 'event')}:${String(e?.start || '')}:${String(e?.title || '')}`,
            title: String(e?.title || 'Event').trim(),
            all_day: Boolean(e?.all_day !== false),
            start: String(e?.start || '').trim(),
            end: String(e?.end || '').trim() || addDaysYmd(String(e?.start || '').trim(), 1),
            description: String(e?.description || '').trim(),
            location: String(e?.location || '').trim(),
            reminder_minutes: reminders.length ? reminders[0] : 60,
          };
        });

      const res = await fetch(`${API_URL}/calendar/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: prov, events, reminders_enabled: true }),
      });

      if (!res.ok) {
        const txt = await res.text();
        setSyncMsg(txt || 'Sync failed.');
        return;
      }

      const data = await res.json();
      setSyncMsg(`Synced ${Number(data?.synced || 0)} events to ${prov}.`);
      await fetchCalendarStatus();
    } catch {
      setSyncMsg('Sync failed.');
    } finally {
      setSyncWorking(false);
    }
  };

  const assignEventToUsers = async (eventId, { driverUids, shipperUids }) => {
    if (!currentUser || !eventId) return;
    try {
      const token = await currentUser.getIdToken();
      await fetch(`${API_URL}/calendar/internal/events/${encodeURIComponent(eventId)}/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          driver_uids: Array.isArray(driverUids) ? driverUids : [],
          shipper_uids: Array.isArray(shipperUids) ? shipperUids : [],
          sync_external: true,
        }),
      });
    } catch {
      // ignore
    }
  };

  const createInternalEvent = async () => {
    if (!currentUser) return;
    setAddSaving(true);
    setAddError('');

    const title = String(form.title || '').trim();
    if (!title) {
      setAddError('Title is required.');
      setAddSaving(false);
      return;
    }

    const start = String(form.start || '').trim();
    const endInput = String(form.end || '').trim() || start;
    if (!parseYmd(start) || !parseYmd(endInput)) {
      setAddError('Start and end must be valid dates (YYYY-MM-DD).');
      setAddSaving(false);
      return;
    }

    const end = addDaysYmd(endInput, 1) || addDaysYmd(start, 1);
    const reminders = normalizeReminderMinutes([form.reminder_minutes]);

    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/calendar/internal/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          all_day: Boolean(form.all_day !== false),
          start,
          end,
          description: String(form.description || '').trim(),
          location: String(form.location || '').trim(),
          reminders,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        setAddError(txt || 'Failed to create event.');
        return;
      }

      const data = await res.json();
      const created = data?.event || null;

      await fetchMonthData();

      const shouldAssign =
        Boolean(form.assign_to_users) &&
        ((Array.isArray(form.driver_uids) && form.driver_uids.length > 0) || (Array.isArray(form.shipper_uids) && form.shipper_uids.length > 0));
      if (shouldAssign && created?.id) {
        await assignEventToUsers(String(created.id), { driverUids: form.driver_uids, shipperUids: form.shipper_uids });
      }

      const prov = effectiveProvider;
      if (prov && (calendarStatus?.[prov]?.connected || (prov === 'google' && calendarStatus?.google?.connected) || (prov === 'outlook' && calendarStatus?.outlook?.connected))) {
        await syncExternal(prov);
      }

      setAddOpen(false);
      setForm((prev) => ({
        ...prev,
        title: '',
        description: '',
        location: '',
        reminder_minutes: 60,
        assign_to_users: false,
        driver_uids: [],
        shipper_uids: [],
      }));
    } catch {
      setAddError('Failed to create event.');
    } finally {
      setAddSaving(false);
    }
  };

  const days = getDaysInMonth(currentDate);

  const connectedLabel = useMemo(() => {
    const st = calendarStatus || {};
    const googleConnected = Boolean(st?.google?.connected);
    const outlookConnected = Boolean(st?.outlook?.connected);
    if (statusLoading) return 'Checking…';
    if (effectiveProvider === 'google') return googleConnected ? 'Google Connected' : 'Google Not Connected';
    if (effectiveProvider === 'outlook') return outlookConnected ? 'Outlook Connected' : 'Outlook Not Connected';
    if (googleConnected && outlookConnected) return 'Google + Outlook Connected';
    if (googleConnected) return 'Google Connected';
    if (outlookConnected) return 'Outlook Connected';
    return 'Not Connected';
  }, [calendarStatus, statusLoading, effectiveProvider]);

  const anyExternalConnected = useMemo(() => {
    const st = calendarStatus || {};
    return Boolean(st?.google?.connected) || Boolean(st?.outlook?.connected);
  }, [calendarStatus]);

  const providers = [
    { id: 'google', label: 'Google Calendar' },
    { id: 'outlook', label: 'Outlook Calendar' },
  ];

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <div className="calendar-title-section">
          <h1>Calendar</h1>
        </div>
        <div className="calendar-actions">
          <button className="btn small ghost-cd" onClick={() => setSyncOpen(true)} disabled={Boolean(syncWorking)}>
            <i className="fa-solid fa-arrows-rotate"></i>
            Sync External
          </button>
          <button className="btn small-cd" onClick={() => {
            setAddError('');
            setAddOpen(true);
          }}>
            <i className="fa-solid fa-plus"></i>
            Add Event
          </button>
        </div>
      </div>

      <div className="calendar-nav">
        <div className="month-nav">
          <button className="nav-btn" onClick={() => navigateMonth(-1)}>
            <i className="fa-solid fa-chevron-left"></i>
          </button>
          <h2 className="current-month">{monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}</h2>
          <button className="nav-btn" onClick={() => navigateMonth(1)}>
            <i className="fa-solid fa-chevron-right"></i>
          </button>
        </div>
        <button className="btn small ghost-cd" onClick={goToToday}>Today</button>
      </div>

      <div className="calendar-legend">
        <div className="legend-item"><div className="legend-dot loads"></div><span>Loads</span></div>
        <div className="legend-item"><div className="legend-dot compliance"></div><span>Compliance</span></div>
        <div className="legend-item"><div className="legend-dot finance"></div><span>Finance</span></div>
        <div className="legend-item"><div className="legend-dot internal"></div><span>Internal</span></div>
      </div>

      {dataError ? (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="muted">{dataError}</div>
        </div>
      ) : null}

      <div className="calendar-grid">
        <div className="calendar-header-row">
          {dayNames.map((day) => (
            <div key={day} className="day-header">{day}</div>
          ))}
        </div>
        <div className="calendar-body">
          {days.map((day, index) => {
            const dayEvents = getEventsForDay(day);
            const previewEvents = day ? dayEvents.slice(0, 2) : [];
            const moreCount = day ? Math.max(0, dayEvents.length - previewEvents.length) : 0;
            const types = new Set(dayEvents.map((e) => String(e?.type || '').trim()));
            return (
              <div
                key={index}
                className={`calendar-day ${!day ? 'empty' : ''}`}
                onClick={() => openDayDetails(day)}
                role={day ? 'button' : undefined}
                tabIndex={day ? 0 : -1}
                onKeyDown={(e) => {
                  if (!day) return;
                  if (e.key === 'Enter' || e.key === ' ') openDayDetails(day);
                }}
                aria-label={day ? `View events for ${monthNames[currentDate.getMonth()]} ${day}, ${currentDate.getFullYear()}` : undefined}
              >
                {day ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div className="day-number">{day}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {types.has('loads') ? <div className="legend-dot loads" style={{ width: 8, height: 8 }} /> : null}
                        {types.has('compliance') ? <div className="legend-dot compliance" style={{ width: 8, height: 8 }} /> : null}
                        {types.has('finance') ? <div className="legend-dot finance" style={{ width: 8, height: 8 }} /> : null}
                        {types.has('internal') ? <div className="legend-dot internal" style={{ width: 8, height: 8 }} /> : null}
                      </div>
                    </div>
                    <div className="day-events">
                      {previewEvents.map((event) => (
                        <div key={String(event.id)} className={`event event-${String(event.type || 'internal')}`} title={String(event.title || '')}>
                          <div className="event-title">{String(event.title || '')}</div>
                        </div>
                      ))}
                      {moreCount > 0 ? (
                        <div className="day-more" aria-label={`${moreCount} more events`}>+{moreCount} more</div>
                      ) : null}
                      {Boolean(dataLoading) && dayEvents.length === 0 ? (
                        <div className="muted" style={{ fontSize: 11, paddingTop: 6 }}>Loading…</div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {dayDetails ? (
        <div className="modal-overlay" onClick={() => setDayDetails(null)} role="dialog" aria-modal="true">
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 100%)', maxWidth: 620, maxHeight: '80vh', overflow: 'hidden' }}>
            <div className="modal-header">
              <h2>Events — {dayDetails.ymd}</h2>
              <button type="button" className="modal-close" onClick={() => setDayDetails(null)} aria-label="Close">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 'calc(80vh - 84px)' }}>
              {Array.isArray(dayDetails.events) && dayDetails.events.length ? (
                dayDetails.events.map((event) => (
                  <div key={String(event.id)} className={`event event-${String(event.type || 'internal')}`} style={{ padding: '10px 12px' }}>
                    <div className="event-title">{String(event.title || '')}</div>
                    {event.subtitle ? <div className="event-subtitle">{String(event.subtitle || '')}</div> : null}
                  </div>
                ))
              ) : (
                <div className="muted">No events for this day.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="calendar-stats">
        <div className="cal-stat-card">
          <div className="cal-stat-icon loads"><i className="fa-solid fa-truck"></i></div>
          <div className="cal-stat-info">
            <div className="cal-stat-label">This Month</div>
            <div className="cal-stat-number">{dataLoading ? '…' : cardData.activeLoadsCount}</div>
            <div className="cal-stat-sublabel">Active Loads</div>
          </div>
        </div>

        <div className="cal-stat-card">
          <div className="cal-stat-icon compliance"><i className="fa-solid fa-triangle-exclamation"></i></div>
          <div className="cal-stat-info">
            <div className="cal-stat-label">Upcoming</div>
            <div className="cal-stat-number">{dataLoading ? '…' : cardData.complianceUpcoming}</div>
            <div className="cal-stat-sublabel">Compliance Due</div>
          </div>
        </div>

        <div className="cal-stat-card">
          <div className="cal-stat-icon revenue"><i className="fa-solid fa-dollar-sign"></i></div>
          <div className="cal-stat-info">
            <div className="cal-stat-label">This Week</div>
            <div className="cal-stat-number">{dataLoading ? '…' : cardData.weekRevenueLabel}</div>
            <div className="cal-stat-sublabel">Revenue</div>
          </div>
        </div>

        <div className="cal-stat-card">
          <div className={anyExternalConnected ? 'cal-stat-icon sync' : 'cal-stat-icon sync disconnected'}>
            <i className={anyExternalConnected ? 'fa-solid fa-check' : 'fa-solid fa-xmark'}></i>
          </div>
          <div className="cal-stat-info">
            <div className="cal-stat-label">Sync Status</div>
            <div className={anyExternalConnected ? 'sync-status' : 'sync-status disconnected'}>
              {anyExternalConnected ? connectedLabel : 'No calendar connected'}
            </div>
          </div>
        </div>
      </div>

      {syncOpen ? (
        <div className="modal-overlay" onClick={() => setSyncOpen(false)} role="dialog" aria-modal="true">
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, 100%)', maxWidth: 520 }}>
            <div className="modal-header">
              <h2>Sync External Calendar</h2>
              <button type="button" className="modal-close" onClick={() => setSyncOpen(false)} aria-label="Close">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="muted">Choose a provider to connect or sync.</div>
              {providers.map((p) => {
                const connected = Boolean(calendarStatus?.[p.id]?.connected);
                return (
                  <div key={p.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{p.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{connected ? 'Connected' : 'Not connected'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!connected ? (
                        <button className="btn small-cd" onClick={() => startCalendarConnect(p.id)} disabled={Boolean(syncWorking)}>
                          Connect
                        </button>
                      ) : (
                        <button className="btn small-cd" onClick={() => syncExternal(p.id)} disabled={Boolean(syncWorking)}>
                          Sync
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {syncMsg ? <div className="muted" style={{ marginTop: 6 }}>{syncMsg}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {addOpen ? (
        <div className="modal-overlay" onClick={() => setAddOpen(false)} role="dialog" aria-modal="true">
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(760px, 100%)', maxWidth: 760, maxHeight: '90vh', overflow: 'hidden' }}
          >
            <div className="modal-header">
              <h2>Add Event</h2>
              <button type="button" className="modal-close" onClick={() => setAddOpen(false)} aria-label="Close">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 'calc(90vh - 84px)' }}>
              {addError ? <div className="muted" style={{ color: 'var(--red-600, #dc2626)' }}>{addError}</div> : null}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Title</span>
                <input className="fp_rc-input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Event title" />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Start</span>
                  <input className="fp_rc-input" value={form.start} onChange={(e) => setForm((p) => ({ ...p, start: e.target.value }))} placeholder="YYYY-MM-DD" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="muted" style={{ fontSize: 12 }}>End</span>
                  <input className="fp_rc-input" value={form.end} onChange={(e) => setForm((p) => ({ ...p, end: e.target.value }))} placeholder="YYYY-MM-DD" />
                </label>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" checked={Boolean(form.all_day)} onChange={(e) => setForm((p) => ({ ...p, all_day: e.target.checked }))} />
                <span>All-day</span>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Location</span>
                <input className="fp_rc-input" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="Optional" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Description</span>
                <textarea className="fp_rc-input" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional" style={{ minHeight: 90 }} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Reminder (minutes before)</span>
                <select className="fp_rc-input" value={String(form.reminder_minutes)} onChange={(e) => setForm((p) => ({ ...p, reminder_minutes: Number(e.target.value) }))}>
                  {[0, 15, 30, 60, 120, 1440].map((m) => (
                    <option key={m} value={String(m)}>{m === 0 ? 'No reminder' : `${m} minutes`}</option>
                  ))}
                </select>
              </label>

              <div className="card" style={{ padding: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(form.assign_to_users)}
                    onChange={(e) => setForm((p) => ({ ...p, assign_to_users: e.target.checked, driver_uids: [], shipper_uids: [] }))}
                    disabled={uniqueDriversFromLoads.length === 0 && uniqueShippersFromLoads.length === 0}
                  />
                  <span>Push event to associated users calendars</span>
                </label>
                {uniqueDriversFromLoads.length === 0 && uniqueShippersFromLoads.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>No associated shippers or drivers found on your loads yet.</div>
                ) : null}

                {form.assign_to_users ? (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {uniqueShippersFromLoads.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="muted" style={{ fontSize: 12 }}>Select shippers</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          {uniqueShippersFromLoads.map((s) => {
                            const checked = form.shipper_uids.includes(s.uid);
                            return (
                              <label key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setForm((p) => {
                                      const cur = Array.isArray(p.shipper_uids) ? p.shipper_uids : [];
                                      const set = new Set(cur);
                                      if (next) set.add(s.uid);
                                      else set.delete(s.uid);
                                      return { ...p, shipper_uids: Array.from(set) };
                                    });
                                  }}
                                />
                                <span style={{ fontSize: 13 }}>{s.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {uniqueDriversFromLoads.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="muted" style={{ fontSize: 12 }}>Select drivers</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          {uniqueDriversFromLoads.map((d) => {
                            const checked = form.driver_uids.includes(d.uid);
                            return (
                              <label key={d.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setForm((p) => {
                                      const cur = Array.isArray(p.driver_uids) ? p.driver_uids : [];
                                      const set = new Set(cur);
                                      if (next) set.add(d.uid);
                                      else set.delete(d.uid);
                                      return { ...p, driver_uids: Array.from(set) };
                                    });
                                  }}
                                />
                                <span style={{ fontSize: 13 }}>{d.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button className="btn small ghost-cd" onClick={() => setAddOpen(false)} disabled={Boolean(addSaving)}>Cancel</button>
                <button className="btn small-cd" onClick={createInternalEvent} disabled={Boolean(addSaving)}>
                  {addSaving ? 'Saving…' : 'Save Event'}
                </button>
              </div>

              <div className="muted" style={{ fontSize: 12 }}>
                Reminders and user notifications are sent in-app, and external sync uses your connected provider.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
