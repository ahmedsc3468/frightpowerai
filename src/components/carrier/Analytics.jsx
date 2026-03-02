import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import '../../styles/carrier/Analytics.css';
import { useAuth } from '../../contexts/AuthContext';
import { getCarrierLoads } from '../../api/loads';

const Analytics = () => {
  const { currentUser } = useAuth();
  const [timeRange, setTimeRange] = useState('All Time');
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [customRangeError, setCustomRangeError] = useState('');
  const [customStart, setCustomStart] = useState(''); // YYYY-MM-DD
  const [customEnd, setCustomEnd] = useState(''); // YYYY-MM-DD
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const timeRanges = ['All Time', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'This Year', 'Custom Range'];

  const fmtYmd = (d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const parseYmdLocal = (ymd, endOfDay = false) => {
    const s = String(ymd || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return null;
    if (endOfDay) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  };

  const pickFirstNonEmptyString = (...vals) => {
    for (const v of vals) {
      const s = String(v ?? '').trim();
      if (s) return s;
    }
    return '';
  };

  const parseYmdOnly = (text) => {
    const s = String(text ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  // Accepts ISO strings, YYYY-MM-DD, unix seconds/ms (number or numeric string), and Firestore Timestamp-like objects.
  const parseDateFlexible = (value) => {
    if (value == null) return null;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

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

    const s = String(value).trim();
    if (!s) return null;

    if (/^\d+(?:\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return parseDateFlexible(n);
    }

    const ymd = parseYmdOnly(s);
    if (ymd) return ymd;

    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const normalizeStatus = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '_');

  const toNumberFlexible = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const s0 = String(v).trim();
    if (!s0) return null;
    // Strip currency symbols/commas and keep digits, dot, minus.
    const s = s0.replace(/[^0-9.-]/g, '');
    if (!s || s === '-' || s === '.' || s === '-.') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const fmtMoney = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
  };

  const fmtMoney2 = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  };

  // Keep status bucketing aligned with Carrier "My Loads" columns.
  const classifyLoad = (load) => {
    const status = String(load?.status || '').toLowerCase();
    if (status === 'draft') return { column: 'draft', statusFlag: 'draft' };
    if (status === 'completed') return { column: 'settled', statusFlag: 'settled' };
    if (status === 'delivered') return { column: 'delivered', statusFlag: 'delivered' };
    if (status === 'in_transit') return { column: 'inTransit', statusFlag: 'in transit' };
    if (status === 'accepted') return { column: 'accepted', statusFlag: 'accepted' };

    const hasDriver = Boolean(load?.assigned_driver || load?.assigned_driver_id);
    if (hasDriver) {
      const das = String(load?.driver_assignment_status || '').toLowerCase();
      if (das === 'accepted' || status === 'covered') return { column: 'accepted', statusFlag: 'accepted' };
      return { column: 'tendered', statusFlag: 'assigned' };
    }
    return { column: 'tendered', statusFlag: 'unassigned' };
  };

  const timeWindow = useMemo(() => {
    const now = new Date();
    const end = now;
    if (timeRange === 'All Time') return null;
    if (timeRange === 'Last 7 Days') return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end };
    if (timeRange === 'Last 30 Days') return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end };
    if (timeRange === 'Last 90 Days') return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end };
    if (timeRange === 'This Year') return { start: new Date(now.getFullYear(), 0, 1), end };
    if (timeRange === 'Custom Range') {
      const start = parseYmdLocal(customStart, false);
      const endCustom = parseYmdLocal(customEnd, true);
      if (start && endCustom) return { start, end: endCustom };
      return null;
    }
    return null;
  }, [timeRange, customStart, customEnd]);

  const getLoadDate = (l) => {
    const raw = pickFirstNonEmptyString(
      l?.pickup_date,
      l?.pickup_datetime,
      l?.pickupDate,
      l?.created_at,
      l?.createdAt,
      l?.delivery_date,
      l?.delivery_datetime,
      l?.deliveryDate,
    );
    return parseDateFlexible(raw);
  };

  const getRequiredDeliveryDate = (l) => {
    // Prefer explicit required delivery fields if they exist, otherwise fall back to standard delivery fields.
    const datePart = pickFirstNonEmptyString(
      l?.required_delivery_date,
      l?.requiredDeliveryDate,
      l?.delivery_date,
      l?.deliveryDate,
    );
    const timePart = pickFirstNonEmptyString(
      l?.required_delivery_time,
      l?.requiredDeliveryTime,
      l?.delivery_time,
      l?.deliveryTime,
    );

    const raw = pickFirstNonEmptyString(
      // If we have both date and time parts, combine into an ISO-ish string.
      datePart && timePart ? `${datePart}T${timePart}` : '',
      l?.required_delivery_datetime,
      l?.requiredDeliveryDatetime,
      l?.delivery_datetime,
      l?.deliveryDatetime,
      datePart,
    );

    // If shipper provided a date-only value (common), treat it as end-of-day so deliveries on that date are on-time.
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      const d = parseYmdOnly(raw);
      if (!d) return null;
      d.setHours(23, 59, 59, 999);
      return d;
    }
    return parseDateFlexible(raw);
  };

  const getActualDeliveredDate = (l) => {
    const raw = pickFirstNonEmptyString(
      l?.delivered_at,
      l?.deliveredAt,
      l?.actual_delivery_date,
      l?.actualDeliveryDate,
      l?.completed_at,
      l?.completedAt,
      // Keep POD submission as a last-resort fallback if that's the only timestamp recorded.
      l?.pod_submitted_at,
      l?.podSubmittedAt,
    );
    return parseDateFlexible(raw);
  };

  const inWindowLoads = useMemo(() => {
    if (!timeWindow) return Array.isArray(loads) ? loads : [];
    const startTs = timeWindow.start.getTime();
    const endTs = timeWindow.end.getTime();
    return (Array.isArray(loads) ? loads : []).filter((l) => {
      const d = getLoadDate(l);
      if (!d) return true; // if missing dates, include rather than making up exclusions
      const ts = d.getTime();
      return ts >= startTs && ts <= endTs;
    });
  }, [loads, timeWindow]);

  const onTimeChartWindow = useMemo(() => {
    if (timeWindow) return timeWindow;
    if (timeRange !== 'All Time') return null;

    const dated = (Array.isArray(loads) ? loads : [])
      .map((l) => getLoadDate(l))
      .filter((d) => d && !Number.isNaN(d.getTime()));

    if (!dated.length) return null;
    const minTs = Math.min(...dated.map((d) => d.getTime()));
    const maxTs = Math.max(...dated.map((d) => d.getTime()));
    const start = new Date(minTs);
    start.setHours(0, 0, 0, 0);
    const end = new Date(maxTs);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [timeWindow, timeRange, loads]);

  const kpis = useMemo(() => {
    let tendered = 0;
    let accepted = 0;
    let inTransit = 0;
    let delivered = 0;

    let totalRateForRpu = 0;
    let rpuCount = 0;

    let totalRateForRpm = 0;
    let totalMilesForRpm = 0;

    let onTimeKnown = 0;
    let onTimeCount = 0;

    for (const l of Array.isArray(inWindowLoads) ? inWindowLoads : []) {
      const { column } = classifyLoad(l);
      if (column === 'tendered') tendered += 1;
      if (column === 'accepted') accepted += 1;
      if (column === 'inTransit') inTransit += 1;
      if (column === 'delivered') delivered += 1;

      const rate = toNumberFlexible(
        l?.total_rate ?? l?.totalRate ?? l?.linehaul_rate ?? l?.linehaulRate ?? l?.rate ?? l?.agreed_rate,
      );
      const miles = toNumberFlexible(
        l?.estimated_distance ?? l?.distance_miles ?? l?.distanceMiles ?? l?.miles ?? l?.distance,
      );

      const rpmDirect = toNumberFlexible(l?.rate_per_mile ?? l?.ratePerMile ?? l?.rpm);

      // RPU: average revenue per load (any load with a valid rate).
      if (rate != null && rate > 0) {
        totalRateForRpu += rate;
        rpuCount += 1;
      }

      // RPM: prefer direct RPM if provided; otherwise compute from rate/miles.
      if (rpmDirect != null && rpmDirect > 0) {
        // Treat as a single observation.
        totalRateForRpm += rpmDirect;
        totalMilesForRpm += 1;
      } else if (rate != null && rate > 0 && miles != null && miles > 0) {
        totalRateForRpm += rate;
        totalMilesForRpm += miles;
      }

      // On-time: compare actual delivery timestamp to shipper's required delivery date/time.
      const scheduledDelivery = getRequiredDeliveryDate(l);
      const actualDelivery = getActualDeliveredDate(l);
      if (scheduledDelivery && actualDelivery) {
        onTimeKnown += 1;
        if (actualDelivery.getTime() <= scheduledDelivery.getTime()) onTimeCount += 1;
      } else {
        // Fallback to an explicit boolean if the backend provides it.
        const explicit = l?.on_time ?? l?.onTime;
        if (typeof explicit === 'boolean') {
          onTimeKnown += 1;
          if (explicit) onTimeCount += 1;
        }
      }
    }

    const onTimePct = onTimeKnown ? (onTimeCount / onTimeKnown) * 100 : null;
    const avgRpu = rpuCount ? totalRateForRpu / rpuCount : null;
    const avgRpm = totalMilesForRpm ? (totalRateForRpm / totalMilesForRpm) : null;

    return {
      tendered,
      accepted,
      inTransit,
      delivered,
      onTimePct,
      avgRpm,
      avgRpu,
    };
  }, [inWindowLoads]);

  const onTimeSeries = useMemo(() => {
    if (!onTimeChartWindow) {
      return [];
    }
    const start = new Date(onTimeChartWindow.start);
    const end = new Date(onTimeChartWindow.end);

    const spanDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const stepDays = spanDays > 730 ? 30 : spanDays > 210 ? 14 : spanDays > 45 ? 7 : 1;

    const buckets = [];
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    while (cur.getTime() <= end.getTime()) {
      const next = new Date(cur);
      next.setDate(next.getDate() + stepDays);
      buckets.push({ start: new Date(cur), end: next });
      cur.setDate(cur.getDate() + stepDays);
    }

    const series = buckets.map((b) => {
      let delivered = 0;
      let onTimeKnown = 0;
      let onTime = 0;
      for (const l of Array.isArray(loads) ? loads : []) {
        const d = getLoadDate(l);
        if (!d) continue;
        const ts = d.getTime();
        if (ts < b.start.getTime() || ts >= b.end.getTime()) continue;

        const st = normalizeStatus(l?.status || l?.load_status || l?.shipment_status);
        if (st === 'delivered' || st === 'completed') delivered += 1;

        const scheduledDelivery = getRequiredDeliveryDate(l);
        const actualDelivery = getActualDeliveredDate(l);
        if (scheduledDelivery && actualDelivery) {
          onTimeKnown += 1;
          if (actualDelivery.getTime() <= scheduledDelivery.getTime()) onTime += 1;
        } else {
          const explicit = l?.on_time ?? l?.onTime;
          if (typeof explicit === 'boolean') {
            onTimeKnown += 1;
            if (explicit) onTime += 1;
          }
        }
      }

      const label = stepDays >= 30
        ? `${b.start.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}`
        : stepDays >= 7
          ? `${b.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
          : `${b.start.getDate()}`;

      return {
        label,
        delivered,
        onTimePct: onTimeKnown ? Math.round((onTime / onTimeKnown) * 1000) / 10 : null,
      };
    });

    // Keep charts stable even with very few points.
    return series.slice(-60);
  }, [loads, onTimeChartWindow]);

  const timeRangeLabelForFile = useMemo(() => {
    if (timeRange === 'Custom Range' && customStart && customEnd) return `${customStart}_to_${customEnd}`;
    return String(timeRange || 'All Time').replace(/\s+/g, '_');
  }, [timeRange, customStart, customEnd]);

  const downloadBlob = (filename, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  const toCsv = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    const keys = list.length
      ? Array.from(new Set(list.flatMap((r) => Object.keys(r || {}))))
      : [];
    const esc = (v) => {
      const s = String(v ?? '');
      if (/[\n\r",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = keys.join(',');
    const lines = list.map((r) => keys.map((k) => esc(r?.[k])).join(','));
    return [header, ...lines].join('\n');
  };

  let xlsxPromise;
  const getXlsx = async () => {
    if (!xlsxPromise) {
      xlsxPromise = import('xlsx');
    }
    const mod = await xlsxPromise;
    return mod?.default || mod;
  };

  const exportChartCsv = (baseName, rows) => {
    setExportError('');
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(`${baseName}_${timeRangeLabelForFile}.csv`, blob);
  };

  const exportAllXlsx = async () => {
    setExportError('');
    setExporting(true);
    try {
      const XLSX = await getXlsx();

      const summaryRows = [
        { metric: 'Tendered', value: kpis.tendered },
        { metric: 'Accepted', value: kpis.accepted },
        { metric: 'In Transit', value: kpis.inTransit },
        { metric: 'Delivered', value: kpis.delivered },
        { metric: 'On-Time %', value: kpis.onTimePct == null ? '' : Number(kpis.onTimePct.toFixed(1)) },
        { metric: 'Avg. RPM', value: kpis.avgRpm == null ? '' : Number(kpis.avgRpm.toFixed(2)) },
        { metric: 'Avg. RPU', value: kpis.avgRpu == null ? '' : Math.round(kpis.avgRpu) },
      ];

      const loadsRows = (Array.isArray(inWindowLoads) ? inWindowLoads : []).map((l) => {
        const { column } = classifyLoad(l);
        return {
          load_id: l?.load_id || l?.id || '',
          status: l?.status || '',
          bucket: column,
          origin: l?.origin || '',
          destination: l?.destination || '',
          pickup_date: l?.pickup_date || l?.pickup_datetime || '',
          delivery_date: l?.delivery_date || l?.delivery_datetime || '',
          total_rate: l?.total_rate ?? '',
          miles: l?.estimated_distance ?? l?.distance_miles ?? l?.miles ?? '',
        };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loadDistribution), 'Distribution');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loadsByRegion), 'Regions');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(onTimeSeries), 'OnTimeSeries');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loadsRows), 'Loads');

      const filename = `Carrier_Analytics_${timeRangeLabelForFile}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (e) {
      setExportError(String(e?.message || 'Export failed.'));
    } finally {
      setExporting(false);
    }
  };

  const loadsByRegion = useMemo(() => {
    const counts = new Map();
    const takeState = (s) => {
      const str = String(s ?? '').trim();
      if (!str) return '';
      const m = str.match(/\b([A-Z]{2})\b\s*$/);
      return m ? m[1] : '';
    };
    for (const l of Array.isArray(inWindowLoads) ? inWindowLoads : []) {
      const state = takeState(l?.origin) || takeState(l?.pickup_location) || takeState(l?.pickup_address) || '';
      if (!state) continue;
      counts.set(state, (counts.get(state) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [inWindowLoads]);

  const loadDistribution = useMemo(() => {
    const bucket = (load) => {
      const { column } = classifyLoad(load);
      if (column === 'tendered') return 'Tendered';
      if (column === 'accepted') return 'Accepted';
      if (column === 'inTransit') return 'In Transit';
      if (column === 'delivered') return 'Delivered';
      return 'Other';
    };

    const counts = new Map();
    for (const l of Array.isArray(inWindowLoads) ? inWindowLoads : []) {
      const label = bucket(l);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const order = ['Tendered', 'Accepted', 'In Transit', 'Delivered', 'Other'];
    return order
      .filter((k) => counts.get(k))
      .map((k) => ({ name: k, value: counts.get(k) }));
  }, [inWindowLoads]);

  useEffect(() => {
    const run = async () => {
      if (!currentUser) return;
      setLoading(true);
      setError('');
      try {
        const data = await getCarrierLoads({ pageSize: 200, excludeDrafts: false, cacheMs: 15000 });
        setLoads(Array.isArray(data?.loads) ? data.loads : []);
      } catch (e) {
        setError(String(e?.message || 'Failed to load analytics data.'));
        setLoads([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [currentUser]);

  const pieColors = ['#3B57A7', '#7FA4F6', '#22c55e', '#f59e0b', '#9e9e9e'];

  return (
    <div className="analytics-container">
      {/* Header */}
      <div className="analytics-header">
        <div className="header-content">
          <h1>Analytics & Reports</h1>
          <p className="header-subtitle">Track operational performance, financial health, and compliance trends</p>
        </div>
        <div className="header-actions">
          <select 
            value={timeRange} 
            onChange={(e) => {
              const next = e.target.value;
              if (next === 'Custom Range') {
                const fallbackStart = customStart || fmtYmd(timeWindow?.start) || fmtYmd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
                const fallbackEnd = customEnd || fmtYmd(timeWindow?.end) || fmtYmd(new Date());
                setDraftStart(fallbackStart);
                setDraftEnd(fallbackEnd);
                setCustomRangeError('');
                setCustomRangeOpen(true);
                return;
              }
              setCustomRangeOpen(false);
              setCustomRangeError('');
              setTimeRange(next);
            }}
            className="time-range-select" style={{borderRadius: "100px"}}
          >
            {timeRanges.map(range => (
              <option key={range} value={range}>{range}</option>
            ))}
          </select>
          <button className="btn small ghost-cd" onClick={exportAllXlsx} disabled={exporting}>
            <i className="fa-solid fa-download"></i>
            {exporting ? 'Exporting…' : 'Export All'}
          </button>
        </div>
      </div>

      {/* Dashboard Content Only (Tabs Removed) */}
      <div className="dashboard-content">
        {/* Statistics Cards */}
        <div className="cd-analytics-stats-grid">
          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-truck"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">{loading ? '…' : kpis.tendered}</div>
              <div className="cd-analytics-stat-label">Tendered</div>
            </div>
          </div>

          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-check"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">{loading ? '…' : kpis.accepted}</div>
              <div className="cd-analytics-stat-label">Accepted</div>
            </div>
          </div>

          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-location-arrow"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">{loading ? '…' : kpis.inTransit}</div>
              <div className="cd-analytics-stat-label">In Transit</div>
            </div>
          </div>

          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-box"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">{loading ? '…' : kpis.delivered}</div>
              <div className="cd-analytics-stat-label">Delivered</div>
            </div>
          </div>

          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-circle-dot"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">
                {loading ? '…' : (kpis.onTimePct == null ? '—' : `${kpis.onTimePct.toFixed(1)}%`)}
              </div>
              <div className="cd-analytics-stat-label">On-Time %</div>
            </div>
          </div>

          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-dollar-sign"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">{loading ? '…' : (kpis.avgRpm == null ? '—' : fmtMoney2(kpis.avgRpm))}</div>
              <div className="cd-analytics-stat-label">Avg. RPM</div>
            </div>
          </div>

          <div className="cd-analytics-stat-card">
            <div className="cd-analytics-stat-icon">
              <i className="fa-solid fa-calendar"></i>
            </div>
            <div className="cd-analytics-stat-info">
              <div className="cd-analytics-stat-value">{loading ? '…' : (kpis.avgRpu == null ? '—' : fmtMoney(kpis.avgRpu))}</div>
              <div className="cd-analytics-stat-label">Avg. RPU</div>
            </div>
          </div>
        </div>

        {exportError ? (
          <div className="card" style={{ padding: 14 }}>
            <div className="muted">{exportError}</div>
          </div>
        ) : null}

        {error ? (
          <div className="card" style={{ padding: 14 }}>
            <div className="muted">{error}</div>
          </div>
        ) : null}

        {/* Charts Section */}
        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-header">
              <h3>On-Time Performance</h3>
              <button
                className="export-chart-btn"
                onClick={() => exportChartCsv('OnTimePerformance', onTimeSeries)}
                disabled={exporting}
              >
                Export
              </button>
            </div>
            <div className="chart-placeholder" style={{ padding: 16, minHeight: 260 }}>
              {loading ? (
                <p>Loading chart…</p>
              ) : onTimeSeries.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={onTimeSeries} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fpOnTimeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B57A7" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#3B57A7" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fpDeliveredFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="left" domain={[0, 100]} tick={{ fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="delivered"
                      name="Delivered"
                      stroke="#22c55e"
                      strokeWidth={2}
                      fill="url(#fpDeliveredFill)"
                      isAnimationActive
                      animationDuration={700}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="onTimePct"
                      name="On-Time %"
                      stroke="#3B57A7"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive
                      animationDuration={700}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p>No dated load history for this range.</p>
              )}
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3>Loads by Region</h3>
              <button
                className="export-chart-btn"
                onClick={() => exportChartCsv('LoadsByRegion', loadsByRegion)}
                disabled={exporting}
              >
                Export
              </button>
            </div>
            <div className="chart-placeholder" style={{ padding: 16, minHeight: 260 }}>
              {loading ? (
                <p>Loading chart…</p>
              ) : loadsByRegion.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={loadsByRegion} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="region" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Loads" fill="#7FA4F6" radius={[8, 8, 0, 0]} isAnimationActive animationDuration={700} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <>
                  <div className="chart-icon"><i className="fa-solid fa-map"></i></div>
                  <p>No regional data available in this range</p>
                </>
              )}
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <h3>Load Distribution</h3>
              <button
                className="export-chart-btn"
                onClick={() => exportChartCsv('LoadDistribution', loadDistribution)}
                disabled={exporting}
              >
                Export
              </button>
            </div>
            <div className="chart-placeholder" style={{ padding: 16, minHeight: 260 }}>
              {loading ? (
                <p>Loading chart…</p>
              ) : loadDistribution.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Tooltip />
                    <Legend />
                    <Pie
                      data={loadDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                      isAnimationActive
                      animationDuration={700}
                    >
                      {loadDistribution.map((entry, idx) => (
                        <Cell key={`cell-${entry.name}`} fill={pieColors[idx % pieColors.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <>
                  <div className="chart-icon"><i className="fa-solid fa-chart-pie"></i></div>
                  <p>No distribution data available in this range</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {customRangeOpen ? (
        <div className="analytics-modal-overlay" onClick={() => setCustomRangeOpen(false)}>
          <div className="analytics-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="analytics-modal-header">
              <h3>Custom Range</h3>
              <button className="analytics-modal-close" onClick={() => setCustomRangeOpen(false)} aria-label="Close">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="analytics-modal-body">
              <div className="analytics-range-row">
                <label>
                  <div className="analytics-range-label">Start</div>
                  <input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
                </label>
                <label>
                  <div className="analytics-range-label">End</div>
                  <input type="date" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
                </label>
              </div>

              {customRangeError ? <div className="analytics-range-error">{customRangeError}</div> : null}
            </div>

            <div className="analytics-modal-actions">
              <button
                className="btn small ghost-cd"
                onClick={() => {
                  setCustomRangeOpen(false);
                  setCustomRangeError('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn small"
                onClick={() => {
                  const start = parseYmdLocal(draftStart, false);
                  const end = parseYmdLocal(draftEnd, true);
                  if (!start || !end) {
                    setCustomRangeError('Please select both start and end dates.');
                    return;
                  }
                  if (end.getTime() < start.getTime()) {
                    setCustomRangeError('End date must be on or after start date.');
                    return;
                  }
                  setCustomStart(draftStart);
                  setCustomEnd(draftEnd);
                  setCustomRangeError('');
                  setCustomRangeOpen(false);
                  setTimeRange('Custom Range');
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Analytics;