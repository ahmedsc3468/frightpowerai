import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/shipper/TrackingVisibility.css';
import HereMap from '../common/HereMap';
import ShipmentStatusProgressBar from './ShipmentStatusProgressBar';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';

export default function TrackingVisibility({ initialLoadId = null }) {
  const { currentUser } = useAuth();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('last7');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [selectedLoadId, setSelectedLoadId] = useState(String(initialLoadId || '').trim() || null);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [trackingItems, setTrackingItems] = useState([]);
  const trackingTimerRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);

  const normalizeStatus = (s) =>
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');

  const isInTransitStatus = (s) => normalizeStatus(s) === 'in_transit';
  const isActiveStatus = (s) => {
    const st = normalizeStatus(s);
    return ['posted', 'tendered', 'covered', 'accepted', 'awarded', 'dispatched', 'in_transit'].includes(st);
  };
  const isInProcessStatus = (s) => {
    const st = normalizeStatus(s);
    return ['tendered', 'covered', 'accepted', 'awarded', 'dispatched', 'in_transit'].includes(st);
  };
  const isDeliveredStatus = (s) => {
    const st = normalizeStatus(s);
    return ['delivered', 'completed'].includes(st);
  };

  const pickDefaultLoadId = (list) => {
    const arr = Array.isArray(list) ? list : [];
    const inTransit = arr.find((l) => isInTransitStatus(l?.status || l?.load_status || l?.workflow_status || l?.workflowStatus));
    const firstActive = arr.find((l) => {
      const st = l?.status || l?.load_status || l?.workflow_status || l?.workflowStatus;
      return isInProcessStatus(st) || isActiveStatus(st);
    });
    const chosen = inTransit || firstActive || arr[0] || null;
    const id = String(chosen?.load_id || chosen?.id || '').trim();
    return id || null;
  };

  const shortLoadNo = (l) => {
    const num = String(l?.load_number || '').trim();
    if (num) return num;
    const id = String(l?.load_id || l?.id || '').trim();
    if (!id) return 'N/A';
    return id.length > 10 ? id.slice(-10) : id;
  };

  const fmtDateOrTbd = (v) => {
    const s = String(v || '').trim();
    return s || 'TBD';
  };

  const fmtRelative = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    const diff = Math.max(0, Date.now() - n * 1000);
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const parseDateToMs = (value) => {
    if (value == null) return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return null;
      // Heuristic: values > 1e12 are already ms
      return value > 1e12 ? value : value * 1000;
    }
    const s = String(value || '').trim();
    if (!s) return null;
    // Numeric strings: treat as epoch seconds/ms.
    if (/^\d+(?:\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n > 1e12 ? n : n * 1000;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  };

  const loadStatusValue = (l) =>
    normalizeStatus(
      l?.status ||
        l?.load_status ||
        l?.workflow_status ||
        l?.workflowStatus ||
        l?.workflow_status_text ||
        ''
    );

  const statusCategoryForStatus = (s) => {
    const st = normalizeStatus(s);
    if (!st) return '';
    if (st === 'draft') return 'draft';
    if (st === 'posted' || st === 'tendered' || st === 'bidding') return 'tendered';
    if (st === 'covered' || st === 'accepted' || st === 'dispatched' || st === 'awarded') return 'assigned';
    if (st === 'in_transit') return 'in_transit';
    if (st === 'delivered') return 'delivered';
    if (st === 'pod_submitted' || st === 'pod') return 'pod';
    if (st === 'invoiced') return 'invoiced';
    if (st === 'payment_settled' || st === 'settled' || st === 'completed') return 'settled';
    if (st === 'cancelled' || st === 'canceled') return 'cancelled';
    return st;
  };

  const loadModeValue = (l) => {
    const raw =
      l?.mode ||
      l?.equipment_type ||
      l?.equipment ||
      l?.transport_mode ||
      l?.shipment_mode ||
      '';
    const s = String(raw || '').trim();
    return s;
  };

  const loadCreatedAtMsForFilter = (l) => {
    // Date-range filter is defined as: loads CREATED in the last X days.
    // Backend generally returns created_at as epoch seconds; support best-effort fallbacks.
    const createdMs = parseDateToMs(l?.created_at ?? l?.createdAt);
    if (createdMs) return createdMs;
    return null;
  };

  const modeKey = (m) => {
    const s = String(m || '').trim().toLowerCase();
    if (!s) return '';
    // Normalize: collapse whitespace, remove non-word separators.
    const compact = s
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, '')
      .trim();

    // Common equipment/mode synonyms.
    if (compact === 'dryvan' || compact === 'dry van') return 'dry_van';
    if (compact === 'reefer' || compact === 'refrigerated') return 'reefer';
    if (compact === 'flatbed' || compact === 'flat bed') return 'flatbed';
    if (compact === 'poweronly' || compact === 'power only') return 'power_only';
    if (compact === 'stepdeck' || compact === 'step deck') return 'step_deck';
    if (compact === 'hotshot' || compact === 'hot shot') return 'hotshot';
    if (compact === 'boxtruck' || compact === 'box truck') return 'box_truck';

    return compact.replace(/\s+/g, '_');
  };

  const modeLabelForKey = (key, rawFallback) => {
    const k = String(key || '').trim();
    if (!k) return '';
    const map = {
      dry_van: 'Dry Van',
      reefer: 'Reefer',
      flatbed: 'Flatbed',
      power_only: 'Power Only',
      step_deck: 'Step Deck',
      hotshot: 'Hotshot',
      box_truck: 'Box Truck',
    };
    if (map[k]) return map[k];
    const fb = String(rawFallback || '').trim();
    if (fb) return fb;
    return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const statusOptions = useMemo(
    () => [
      { key: 'draft', label: 'Draft' },
      { key: 'tendered', label: 'Tendered' },
      { key: 'assigned', label: 'Assigned' },
      { key: 'in_transit', label: 'In Transit' },
      { key: 'delivered', label: 'Delivered' },
      { key: 'pod', label: 'POD' },
      { key: 'invoiced', label: 'Invoiced' },
      { key: 'settled', label: 'Settled' },
      { key: 'cancelled', label: 'Cancelled' },
    ],
    []
  );

  const modeOptions = useMemo(() => {
    const byKey = new Map();
    (loads || []).forEach((l) => {
      const raw = loadModeValue(l);
      const key = modeKey(raw);
      if (!key) return;
      if (!byKey.has(key)) {
        byKey.set(key, modeLabelForKey(key, raw));
      }
    });
    return Array.from(byKey.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [loads]);

  const fetchLoads = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/loads?exclude_drafts=true&page=1&page_size=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setLoads([]);
        setError('Failed to load shipments');
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data?.loads) ? data.loads : [];
      setLoads(list);
    } catch (e) {
      setLoads([]);
      setError(e?.message || 'Failed to load shipments');
    } finally {
      setLoading(false);
    }
  };

  const fetchSelectedLoad = async (loadId) => {
    const id = String(loadId || '').trim();
    if (!currentUser || !id) return;
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/loads/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSelectedLoad(data?.load || data);
    } catch {
      // ignore; keep whatever we had
    }
  };

  useEffect(() => {
    const id = String(initialLoadId || '').trim();
    if (id) {
      setSelectedLoadId(id);
      setSelectedLoad(null);
    }
  }, [initialLoadId]);

  useEffect(() => {
    fetchLoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const fetchTrackingLocations = async () => {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/tracking/loads/locations?active_only=true&limit=300`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      setTrackingItems(items);
    } catch {
      // ignore (best-effort realtime)
    }
  };

  useEffect(() => {
    // Best-effort realtime polling for driver GPS.
    if (!currentUser) return;
    fetchTrackingLocations();
    if (trackingTimerRef.current) {
      clearInterval(trackingTimerRef.current);
    }
    trackingTimerRef.current = setInterval(fetchTrackingLocations, 15000);
    return () => {
      if (trackingTimerRef.current) {
        clearInterval(trackingTimerRef.current);
        trackingTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const inTransitLoads = useMemo(() => {
    return (loads || []).filter((l) => isInTransitStatus(loadStatusValue(l)));
  }, [loads]);

  const filteredLoads = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    const statusWantedRaw = String(statusFilter || 'all').trim();
    const statusWanted = statusWantedRaw === 'all' ? 'all' : normalizeStatus(statusWantedRaw);
    const modeWanted = String(modeFilter || 'all').trim().toLowerCase();
    const now = Date.now();
    const rangeToDays = {
      last24h: 1 / 1, // use explicit ms below
      last3: 3,
      last7: 7,
      last30: 30,
      last90: 90,
      all: null,
    };
    const minMs = (() => {
      if (dateRange === 'last24h') return now - 24 * 60 * 60 * 1000;
      const days = rangeToDays[String(dateRange || 'all')];
      if (!days) return null;
      return now - days * 24 * 60 * 60 * 1000;
    })();

    const base = loads || [];
    return base
      .filter((l) => {
        if (minMs != null) {
          const ms = loadCreatedAtMsForFilter(l);
          if (!ms) return false;
          if (ms < minMs) return false;
        }

        if (statusWanted !== 'all') {
          const primary = statusCategoryForStatus(loadStatusValue(l));
          const wf = statusCategoryForStatus(l?.workflow_status || l?.workflowStatus || l?.workflow_status_text || '');
          if (primary !== statusWanted && wf !== statusWanted) return false;
        }

        if (modeWanted !== 'all') {
          if (modeKey(loadModeValue(l)) !== modeWanted) return false;
        }

        if (!q) return true;

        const meta = l?.metadata && typeof l.metadata === 'object' ? l.metadata : {};
        const fields = [
          l?.load_id,
          l?.id,
          l?.load_number,
          l?.origin,
          l?.destination,
          l?.assigned_carrier_name,
          l?.carrier_name,
          l?.assigned_driver_name,
          l?.driver_name,
          l?.workflow_status,
          l?.workflowStatus,
          meta?.reference,
          meta?.po,
          meta?.po_number,
          meta?.bol,
          meta?.pro,
          l?.reference,
          l?.po,
          l?.po_number,
        ]
          .filter((v) => v != null)
          .map((v) => String(v).toLowerCase());

        return fields.some((f) => f.includes(q));
      })
      .slice();
  }, [loads, dateRange, statusFilter, modeFilter, search]);

  const filteredTrackedLoads = useMemo(() => {
    // Map/progress/selection must stay on trackable loads.
    return (filteredLoads || []).filter((l) => isInTransitStatus(loadStatusValue(l)));
  }, [filteredLoads]);

  const effectiveTrackedSelected = useMemo(() => {
    const wanted = String(selectedLoadId || '').trim();
    if (wanted) {
      return (
        (filteredTrackedLoads || []).find((l) => String(l?.load_id || l?.id || '').trim() === wanted) ||
        null
      );
    }
    return (filteredTrackedLoads || [])[0] || null;
  }, [filteredTrackedLoads, selectedLoadId]);

  const metrics = useMemo(() => {
    const list = loads || [];
    const active = (inTransitLoads || []).length;
    const deliveredToday = list.filter((l) => {
      if (!isDeliveredStatus(l?.status || l?.load_status)) return false;
      const ts = Number(l?.delivered_at || l?.completed_at || l?.workflow_status_updated_at);
      if (!Number.isFinite(ts) || ts <= 0) return false;
      const d = new Date(ts * 1000);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;

    // These require live telematics/exception sources. If we don't have them, compute as 0 (real, derived).
    return {
      active,
      atRisk: 0,
      exceptions: 0,
      etaLt4h: 0,
      deliveredToday,
      lateLoads: 0,
      noPing90: 0,
      incidents: 0,
    };
  }, [loads, inTransitLoads]);

  const effectiveSelected = useMemo(() => {
    const wanted = String(selectedLoadId || '').trim();
    if (wanted) {
      const fromList = (filteredLoads || []).find((l) => String(l?.load_id || l?.id || '').trim() === wanted);
      if (!fromList) return null;
      return selectedLoad || fromList;
    }
    const first = (filteredLoads || [])[0] || null;
    const firstId = String(first?.load_id || first?.id || '').trim();
    const selectedId = String(selectedLoad?.load_id || selectedLoad?.id || '').trim();
    if (firstId && selectedId && firstId === selectedId) return selectedLoad;
    return first;
  }, [filteredLoads, selectedLoadId, selectedLoad]);

  useEffect(() => {
    const id = String(selectedLoadId || '').trim();
    if (!id) return;
    fetchSelectedLoad(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedLoadId]);

  useEffect(() => {
    // Keep selection valid under filtering.
    if (!loads || loads.length === 0) return;
    const wanted = String(selectedLoadId || '').trim();
    const exists = wanted && (filteredLoads || []).some((l) => String(l?.load_id || l?.id || '').trim() === wanted);
    if (exists) return;

    const nextId = pickDefaultLoadId(filteredLoads);
    if (nextId && nextId !== wanted) {
      setSelectedLoadId(nextId);
      setSelectedLoad(null);
      return;
    }

    if (wanted) {
      setSelectedLoadId(null);
      setSelectedLoad(null);
    }
  }, [loads, filteredLoads, selectedLoadId, initialLoadId]);

  const pinSvgDataUri = (fill) => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 64 64">
  <path d="M32 2c-11 0-20 9-20 20 0 15 20 40 20 40s20-25 20-40C52 11 43 2 32 2z" fill="${fill}"/>
  <circle cx="32" cy="22" r="9" fill="#ffffff"/>
</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  };

  const markerColorForStatus = (s) => {
    const st = normalizeStatus(s);
    // Reuse colors already present in TrackingVisibility.css (no new palette).
    if (st === 'in_transit') return '#10b981'; // tv-active
    if (st === 'tendered' || st === 'accepted' || st === 'covered' || st === 'dispatched') return '#0ea5e9';
    if (st === 'delivered' || st === 'completed') return '#94a3b8';
    return '#f59e0b';
  };

  const locationsByLoadId = useMemo(() => {
    const map = new Map();
    (trackingItems || []).forEach((it) => {
      const id = String(it?.load_id || '').trim();
      const lat = Number(it?.gps_lat);
      const lng = Number(it?.gps_lng);
      if (!id) return;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      map.set(id, { ...it, gps_lat: lat, gps_lng: lng });
    });
    return map;
  }, [trackingItems]);

  const mapMarkers = useMemo(() => {
    const markers = [];
    (filteredTrackedLoads || []).forEach((l) => {
      const id = String(l?.load_id || l?.id || '').trim();
      if (!id) return;
      const loc = locationsByLoadId.get(id);
      if (!loc) return;
      const st = loadStatusValue(l);
      const color = markerColorForStatus(st);
      markers.push({
        lat: Number(loc.gps_lat),
        lng: Number(loc.gps_lng),
        label: `Load ${shortLoadNo(l)}`,
        icon: pinSvgDataUri(color),
        load_id: id,
        status: st,
      });
    });
    return markers;
  }, [filteredTrackedLoads, locationsByLoadId]);

  const selectedLocation = useMemo(() => {
    const id = String(selectedLoadId || '').trim();
    if (!id) return null;
    const loc = locationsByLoadId.get(id);
    if (!loc) return null;
    return { lat: Number(loc.gps_lat), lng: Number(loc.gps_lng) };
  }, [locationsByLoadId, selectedLoadId]);

  const selectedTrackingItem = useMemo(() => {
    const id = String(selectedLoadId || '').trim();
    if (!id) return null;
    return locationsByLoadId.get(id) || null;
  }, [locationsByLoadId, selectedLoadId]);

  useEffect(() => {
    if (!mapInstance || !selectedLocation) return;
    try {
      mapInstance.getViewModel().setLookAtData({
        position: { lat: selectedLocation.lat, lng: selectedLocation.lng },
        zoom: 9,
      });
    } catch {
      // ignore
    }
  }, [mapInstance, selectedLocation]);

  const headerBadge = (s) => {
    const st = normalizeStatus(s);
    if (st === 'in_transit') return { cls: 'pending', label: 'In Transit' };
    if (st === 'delivered') return { cls: 'active', label: 'Delivered' };
    if (st === 'completed') return { cls: 'active', label: 'Settled' };
    if (st === 'covered' || st === 'accepted' || st === 'dispatched' || st === 'awarded') return { cls: 'active', label: 'Assigned' };
    if (st === 'posted' || st === 'tendered') return { cls: 'pending', label: 'Tendered' };
    if (st === 'pod_submitted' || st === 'pod') return { cls: 'active', label: 'POD' };
    if (st === 'invoiced') return { cls: 'active', label: 'Invoiced' };
    if (st === 'payment_settled' || st === 'settled') return { cls: 'active', label: 'Settled' };
    return { cls: 'pending', label: st ? st.replace(/_/g, ' ') : 'Active' };
  };

  const loadStatusLabel = headerBadge(loadStatusValue(effectiveSelected));
  const loadRoute = `${String(effectiveSelected?.origin || effectiveSelected?.load_origin || 'N/A')} → ${String(effectiveSelected?.destination || effectiveSelected?.load_destination || 'N/A')}`;
  const etaStrong = fmtDateOrTbd(effectiveSelected?.delivery_date);
  const deliveredAgo = fmtRelative(effectiveSelected?.delivered_at);
  const showLate = false;

  const carrierDisplay = String(
    effectiveSelected?.assigned_carrier_name ||
      effectiveSelected?.carrier_name ||
      selectedTrackingItem?.carrier_name ||
      'N/A'
  );

  const driverDisplay = String(
    effectiveSelected?.assigned_driver_name ||
      effectiveSelected?.driver_name ||
      selectedTrackingItem?.driver_name ||
      'N/A'
  );

  const loadDetailVal = (v) => {
    const s = String(v ?? '').trim();
    return s || '—';
  };

  const pickupStrong = fmtDateOrTbd(effectiveSelected?.pickup_date || effectiveSelected?.pickup);
  const equipmentStrong = loadDetailVal(effectiveSelected?.equipment_type || effectiveSelected?.equipment || '—');
  const weightStrong = effectiveSelected?.weight ? `${effectiveSelected.weight} lbs` : '—';
  const rateStrong = effectiveSelected?.rate ? `$${effectiveSelected.rate}` : (effectiveSelected?.price || '—');

  return (
    <div className="tracking-root">
        <header className="fp-header">
          <div className='sd-carrier-row'>
            <div className="fp-header-titles">
              <h2>Tracking/Visibility</h2>
            </div>
          </div>
        </header>
      <header className="sh-tracking-header">
        <div className="sh-tracking-controls">
          <select
            className="filter"
            value={dateRange}
            onChange={(e) => setDateRange(String(e.target.value || 'all'))}
            aria-label="Date range"
          >
            <option value="last24h">Last 24 Hours</option>
            <option value="last3">Last 3 Days</option>
            <option value="last7">Last 7 Days</option>
            <option value="last30">Last 30 Days</option>
            <option value="last90">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>

          <select
            className="filter"
            value={statusFilter}
            onChange={(e) => {
              const next = String(e.target.value || 'all').trim();
              setStatusFilter(next === 'all' ? 'all' : normalizeStatus(next));
            }}
            aria-label="Status filter"
          >
            <option value="all">All Status</option>
            {statusOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            className="filter"
            value={modeFilter}
            onChange={(e) => setModeFilter(String(e.target.value || 'all'))}
            aria-label="Mode filter"
          >
            <option value="all">All Modes</option>
            {modeOptions.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="shh-search-box">
            <input
              placeholder="Search Load #, PO..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Status badges row (unique classes prefixed with tv-) */}
        <div className="tv-badges-row">
          <div className="int-status-badge active tv-active"><span className="tv-dot"/> Active Loads ({metrics.active})</div>
          <div className="int-status-badge pending tv-risk"><span className="tv-dot"/> At Risk ({metrics.atRisk})</div>
          <div className="int-status-badge revoked tv-exc"><span className="tv-dot"/> Exceptions ({metrics.exceptions})</div>
          <div className="int-status-badge pending tv-risk"><span className="tv-dot"/> ETA &lt; 4h ({metrics.etaLt4h})</div>
          <div className="int-status-badge active tv-active"><span className="tv-dot"/> Delivered Today ({metrics.deliveredToday})</div>
        </div>
      </header>

      <div className="tracking-alerts">
        <div className="tv-alert tv-alert-red"><i className="tv-alert-icon fa-solid fa-triangle-exclamation" aria-hidden></i><span>{metrics.lateLoads} Late Loads</span></div>
        <div className="tv-alert tv-alert-yellow"><i className="tv-alert-icon fa-solid fa-location-dot" aria-hidden></i><span>{metrics.noPing90} No Ping &gt; 90min</span></div>
        <div className="tv-alert tv-alert-pink"><i className="tv-alert-icon fa-solid fa-car-crash" aria-hidden></i><span>{metrics.incidents} Incident Reported</span></div>
      </div>

      {error ? (
        <div style={{ padding: 12, margin: '0 0 12px 0', background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
          {error}
        </div>
      ) : null}

      <div className="tracking-main">
        <div className="map-card">
          {mapMarkers.length > 0 ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 650, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, display: 'inline-block', background: '#10b981' }} /> In Transit
              </div>
            </div>
          ) : null}
          <HereMap
            containerId="shipper-tracking-map"
            center={{ lat: 39.8283, lng: -98.5795 }}
            zoom={4}
            markers={mapMarkers}
            autoFitMarkers={!selectedLocation}
            autoCenterSingleMarker={!selectedLocation}
            singleMarkerZoom={9}
            onMapReady={(m) => setMapInstance(m)}
            onMarkerClick={(m) => {
              const id = String(m?.load_id || '').trim();
              if (!id) return;
              setSelectedLoadId(id);
              setSelectedLoad(null);
            }}
            height="500px"
            width="100%"
          />
        </div>

        <div className="right-panel">
          {!effectiveSelected ? (
            <div className="load-card">
              <div className="load-header">
                <div className="load-header-left">
                  <div className="load-id">Loads</div>
                  <div className="load-route">No loads found for the selected filters</div>
                </div>
              </div>
              <div className="load-body">
                <div className="ai-insight-card">
                  <div className="tr-ai-icon"><i className="fa-regular fa-lightbulb"/></div>
                  <div className="ai-text"><strong>AI Insight:</strong> When a load enters In Transit, it will appear here with live GPS pings.</div>
                </div>
              </div>
            </div>
          ) : (
          <div className="load-card">
            <div className="load-header">
              <div className="load-header-left">
                <div className="load-id">Load #{String(shortLoadNo(effectiveSelected))}</div>
                <div className="load-route">{loadRoute}</div>
              </div>
              <div className="load-header-right">
                <div className={`int-status-badge ${loadStatusLabel.cls}`} style={{display: "inline-block"}}>{loadStatusLabel.label}</div>
                <div className="load-eta">
                  {['delivered', 'completed'].includes(loadStatusValue(effectiveSelected)) ? (
                    <>Delivered: <strong>{deliveredAgo || 'Today'}</strong></>
                  ) : (
                    <>ETA: <strong>{etaStrong}</strong> {showLate ? <span className="load-late">(late)</span> : null}</>
                  )}
                </div>
              </div>
            </div>
            <div className="load-meta-container-align">
                <div className="load-meta">Carrier: <strong>{carrierDisplay}</strong></div>
              <div className="load-meta">Driver: <strong>{driverDisplay}</strong></div>
                </div>

            <div className="load-body">
              <div className="ai-insight-card">
                <div className="tr-ai-icon"><i className="fa-regular fa-lightbulb"/></div>
                <div className="ai-text"><strong>AI Insight:</strong> Tracking signals and exception intelligence will appear here as live pings and events are ingested.</div>
              </div>

              <div className="tv-load-details">
                <div className="tv-load-details-title">Load Details</div>
                <div className="tv-load-details-grid">
                  <div className="tv-load-details-item"><div className="tv-load-details-k">Status</div><div className="tv-load-details-v">{loadDetailVal(loadStatusLabel.label)}</div></div>
                  <div className="tv-load-details-item"><div className="tv-load-details-k">Pickup</div><div className="tv-load-details-v">{pickupStrong}</div></div>
                  <div className="tv-load-details-item"><div className="tv-load-details-k">Delivery</div><div className="tv-load-details-v">{etaStrong}</div></div>
                  <div className="tv-load-details-item"><div className="tv-load-details-k">Equipment</div><div className="tv-load-details-v">{equipmentStrong}</div></div>
                  <div className="tv-load-details-item"><div className="tv-load-details-k">Weight</div><div className="tv-load-details-v">{weightStrong}</div></div>
                  <div className="tv-load-details-item"><div className="tv-load-details-k">Rate</div><div className="tv-load-details-v">{rateStrong}</div></div>
                </div>
              </div>

              <div className="load-actions-col">
                <button className="btn small ghost-cd"><i className="fa-solid fa-comment" style={{marginRight: '20px'}}/> Send Message</button>
                  <button className="btn small ghost-cd"><i className="fa-solid fa-share-nodes" style={{marginRight: '20px'}}/> Share Tracking</button>
                  <button className="btn small ghost-cd"><i className="fa-solid fa-flag" style={{marginRight: '20px'}}/> Report Issue</button>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {effectiveTrackedSelected ? (
        <div className="tv-status-fullwidth">
          <ShipmentStatusProgressBar
            load={effectiveTrackedSelected}
            loadOptions={filteredTrackedLoads}
            selectedLoadId={selectedLoadId}
            onSelectLoadId={(id) => {
              const next = String(id || '').trim();
              if (!next) return;
              if (next === String(selectedLoadId || '').trim()) return;
              setSelectedLoadId(next);
              setSelectedLoad(null);
            }}
            getLoadLabel={(l) => {
              const id = String(l?.load_id || l?.id || '').trim();
              const num = shortLoadNo(l);
              const o = String(l?.origin || l?.load_origin || '').trim();
              const d = String(l?.destination || l?.load_destination || '').trim();
              const route = o && d ? `${o} → ${d}` : '';
              return route ? `Load #${num} (${route})` : (num ? `Load #${num}` : id);
            }}
          />
        </div>
      ) : null}

      <div className="load-table-card">
            <h4>Load Overview</h4>
            <table className="load-table">
              <thead>
                <tr><th>Load #</th><th>Carrier</th><th>Driver</th><th>Status</th><th>ETA</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}>Loading…</td></tr>
                ) : (filteredLoads || []).length === 0 ? (
                  <tr><td colSpan={6}>No loads found</td></tr>
                ) : (
                  (filteredLoads || []).slice(0, 20).map((l) => {
                    const id = String(l?.load_id || l?.id || '').trim();
                    const loc = id ? locationsByLoadId.get(id) : null;
                    const badge = headerBadge(loadStatusValue(l));
                    const eta = fmtDateOrTbd(l?.delivery_date);
                    return (
                      <tr
                        key={id || Math.random()}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!id) return;
                          setSelectedLoadId(id);
                          setSelectedLoad(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          if (!id) return;
                          setSelectedLoadId(id);
                          setSelectedLoad(null);
                        }}
                        style={{ cursor: id ? 'pointer' : 'default' }}
                      >
                        <td>{shortLoadNo(l)}</td>
                        <td>{String(l?.assigned_carrier_name || l?.carrier_name || loc?.carrier_name || '—')}</td>
                        <td>{String(l?.assigned_driver_name || l?.driver_name || loc?.driver_name || '—')}</td>
                        <td>{badge.label}</td>
                        <td>{eta}</td>
                        <td><i className="fa-solid fa-ellipsis-h"></i></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
    </div>
  );
}
