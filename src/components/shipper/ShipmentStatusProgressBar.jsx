import React, { useMemo } from 'react';

const normalize = (v) => String(v || '').trim().toLowerCase();

const steps = [
  { key: 'posted', label: 'Posted' },
  { key: 'bidding', label: 'Bidding' },
  { key: 'awarded', label: 'Awarded' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'assigned_driver', label: 'Assigned to Driver' },
  { key: 'at_pickup', label: 'At Pickup' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'arrived_delivery', label: 'Arrived at Delivery' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'pod_submitted', label: 'POD Submitted' },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'payment_settled', label: 'Payment Settled' },
];

const computeStageIndex = (load) => {
  if (!load) return null;

  const status = normalize(load?.status || load?.load_status);
  const workflowStatus = normalize(load?.workflow_status);

  const hasDriver = Boolean(String(load?.assigned_driver_uid || load?.assigned_driver_id || load?.assigned_driver_name || '').trim());
  const pickedUpAt = Number(load?.picked_up_at);
  const deliveredAt = Number(load?.delivered_at || load?.completed_at);
  const podSubmittedAt = Number(load?.pod_submitted_at);
  const invoicedAt = Number(load?.invoiced_at);
  const paymentSettledAt = Number(load?.payment_settled_at);
  const hasEPod = Boolean(String(load?.epod_id || '').trim());

  if (Number.isFinite(paymentSettledAt) && paymentSettledAt > 0) return 12;
  if (workflowStatus === 'payment settled') return 12;

  if (Number.isFinite(invoicedAt) && invoicedAt > 0) return 11;
  if (workflowStatus === 'invoiced') return 11;

  if ((Number.isFinite(podSubmittedAt) && podSubmittedAt > 0) || hasEPod) return 10;
  if (workflowStatus === 'pod submitted') return 10;

  if (Number.isFinite(deliveredAt) && deliveredAt > 0) return 9;
  if (status === 'delivered' || status === 'completed') return 9;

  if (status === 'in_transit' || workflowStatus === 'in transit') return 7;

  if (Number.isFinite(pickedUpAt) && pickedUpAt > 0) return 6;

  if (status === 'dispatched' || workflowStatus === 'dispatched') {
    // If dispatched but not picked up yet, treat it as "At Pickup".
    return hasDriver ? 5 : 3;
  }

  if (hasDriver) return 4;

  if (workflowStatus === 'awarded' || ['covered', 'accepted', 'dispatched', 'in_transit', 'delivered', 'completed'].includes(status)) return 2;
  if (status === 'tendered') return 1;

  return 0;
};

export default function ShipmentStatusProgressBar({
  load,
  loadOptions = null,
  selectedLoadId = null,
  onSelectLoadId = null,
  getLoadLabel = null,
}) {
  const stageIndex = useMemo(() => computeStageIndex(load), [load]);

  if (!load || stageIndex === null) return null;

  const totalStops = steps.length - 1;
  const fillPct = totalStops > 0 ? Math.max(0, Math.min(100, (stageIndex / totalStops) * 100)) : 0;

  return (
    <div className="tv-status-progress-card">
      {/* Optional load switcher (shown when multiple loads are provided) */}
      {Array.isArray(loadOptions) && loadOptions.length > 1 ? (
        <div className="tv-status-progress-header">
          <div className="tv-status-progress-title">Load Progress</div>
          <div className="tv-status-progress-picker">
            <span>Viewing:</span>
            <select
              className="filter"
              value={String(selectedLoadId || load?.load_id || load?.id || '')}
              onChange={(e) => {
                const id = String(e.target.value || '').trim();
                if (!id) return;
                onSelectLoadId && onSelectLoadId(id);
              }}
            >
              {loadOptions.map((l) => {
                const id = String(l?.load_id || l?.id || '').trim();
                if (!id) return null;
                const label = getLoadLabel ? getLoadLabel(l) : id;
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      ) : null}

      <div className="tv-status-progress-scroll">
        <div className="tv-status-progress-inner">
          <div className="tv-status-progress-labels">
            {steps.map((s) => (
              <div key={s.key} className="tv-status-progress-label">{s.label}</div>
            ))}
          </div>

          <div className="tv-status-progress-track">
            <div className="tv-status-progress-fill" style={{ width: `${fillPct}%` }} />

            {steps.map((s, idx) => {
              const pct = totalStops > 0 ? (idx / totalStops) * 100 : 0;
              const completedOrCurrent = idx <= stageIndex;
              const isCurrent = idx === stageIndex;

              return (
                <div
                  key={s.key}
                  className={`tv-status-progress-knob ${completedOrCurrent ? 'is-done' : 'is-todo'} ${isCurrent ? 'is-current' : ''}`}
                  style={{ left: `${pct}%` }}
                  aria-label={s.label}
                  title={s.label}
                >
                  {isCurrent ? <span className="tv-status-progress-check">✓</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
