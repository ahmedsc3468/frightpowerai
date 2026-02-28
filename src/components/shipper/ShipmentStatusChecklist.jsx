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
    // If dispatched but not picked up yet, treat it as "At Pickup" as the current stage.
    return hasDriver ? 5 : 3;
  }

  if (hasDriver) return 4;

  if (workflowStatus === 'awarded' || ['covered', 'accepted', 'dispatched', 'in_transit', 'delivered', 'completed'].includes(status)) return 2;
  if (status === 'tendered') return 1;

  return 0;
};

const stepTime = (load, key) => {
  if (!load) return '';
  if (key === 'picked_up') return fmtRelative(load?.picked_up_at);
  if (key === 'delivered') return fmtRelative(load?.delivered_at || load?.completed_at);
  if (key === 'pod_submitted') return fmtRelative(load?.pod_submitted_at);
  if (key === 'invoiced') return fmtRelative(load?.invoiced_at);
  if (key === 'payment_settled') return fmtRelative(load?.payment_settled_at);
  return '';
};

export default function ShipmentStatusChecklist({ load }) {
  const stageIndex = useMemo(() => computeStageIndex(load), [load]);

  if (!load || stageIndex === null) return null;

  return (
    <div>
      <div style={{ fontWeight: 800, marginTop: 10, marginBottom: 6 }}>Status Details</div>
      <div className="timeline">
        {steps.map((s, idx) => {
          const completed = idx < stageIndex;
          const current = idx === stageIndex;
          const upcoming = idx > stageIndex;

          const time = stepTime(load, s.key);
          const rightTime = time || (completed ? 'Completed' : current ? 'Current' : 'Pending');

          return (
            <div key={s.key} className={`tl-item ${current ? 'current' : upcoming ? 'upcoming' : 'completed'}`}>
              <div className="tl-left">
                <div className="tl-icon">{completed ? '✓' : current ? '•' : String(idx + 1)}</div>
              </div>
              <div className="tl-right">
                <div className="tl-title">{s.label}</div>
              </div>
              <div className="tl-time">{rightTime}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
