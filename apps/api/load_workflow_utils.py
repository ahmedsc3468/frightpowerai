from __future__ import annotations

import base64
import hashlib
import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


def now_ts() -> float:
    return float(time.time())


def _safe_str(v: Any) -> str:
    return str(v or "").strip()


def is_rate_con_carrier_signed(load: Dict[str, Any]) -> bool:
    contract = load.get("contract") if isinstance(load.get("contract"), dict) else {}
    rc = contract.get("rate_confirmation") if isinstance(contract.get("rate_confirmation"), dict) else {}
    return bool(rc.get("carrier_signed_at"))


def is_rate_con_shipper_signed(load: Dict[str, Any]) -> bool:
    contract = load.get("contract") if isinstance(load.get("contract"), dict) else {}
    rc = contract.get("rate_confirmation") if isinstance(contract.get("rate_confirmation"), dict) else {}
    return bool(rc.get("shipper_signed_at"))


def set_contract_rate_con_signature(
    *,
    load: Dict[str, Any],
    signer_role: str,
    signer_uid: str,
    signer_name: Optional[str] = None,
    signature_doc: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    signer_role = _safe_str(signer_role).lower()
    signer_uid = _safe_str(signer_uid)
    signer_name = _safe_str(signer_name) or None

    contract = dict(load.get("contract") or {}) if isinstance(load.get("contract"), dict) else {}
    rc = dict(contract.get("rate_confirmation") or {}) if isinstance(contract.get("rate_confirmation"), dict) else {}

    ts = now_ts()
    if signer_role in {"shipper", "broker"}:
        rc.setdefault("shipper_signed_at", ts)
        rc.setdefault("shipper_signed_by_uid", signer_uid)
        if signer_name:
            rc.setdefault("shipper_signed_by_name", signer_name)
        if isinstance(signature_doc, dict):
            if signature_doc.get("doc_id"):
                rc.setdefault("shipper_signature_doc_id", signature_doc.get("doc_id"))
            if signature_doc.get("url"):
                rc.setdefault("shipper_signature_url", signature_doc.get("url"))
    elif signer_role == "carrier":
        rc.setdefault("carrier_signed_at", ts)
        rc.setdefault("carrier_signed_by_uid", signer_uid)
        if signer_name:
            rc.setdefault("carrier_signed_by_name", signer_name)
        if isinstance(signature_doc, dict):
            if signature_doc.get("doc_id"):
                rc.setdefault("carrier_signature_doc_id", signature_doc.get("doc_id"))
            if signature_doc.get("url"):
                rc.setdefault("carrier_signature_url", signature_doc.get("url"))
    else:
        raise ValueError("invalid signer_role")

    rc["updated_at"] = ts
    contract["rate_confirmation"] = rc
    contract["updated_at"] = ts

    return contract


def haversine_distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Earth radius in meters
    r = 6371000.0
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lng2) - float(lng1))

    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def parse_datetime_best_effort(s: Any) -> Optional[datetime]:
    if not s:
        return None

    if isinstance(s, (int, float)):
        try:
            return datetime.fromtimestamp(float(s), tz=timezone.utc)
        except Exception:
            return None

    text = _safe_str(s)
    if not text:
        return None

    # Try ISO formats first.
    try:
        # Normalize Z
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def sanitize_load_for_viewer(load: Dict[str, Any], *, viewer_uid: str, viewer_role: str) -> Dict[str, Any]:
    """Remove sensitive fields from a load based on role + workflow gates.

    Goal: receiver identity and exact addresses remain hidden until the carrier signs
    the rate confirmation (legal acceptance).
    """

    role = _safe_str(viewer_role).lower()
    uid = _safe_str(viewer_uid)

    # Clone first so we don't mutate the stored dict.
    d = dict(load or {})

    if role in {"admin", "super_admin"}:
        return d

    created_by = _safe_str(d.get("created_by"))
    assigned_carrier = _safe_str(d.get("assigned_carrier") or d.get("assigned_carrier_id") or d.get("carrier_id"))
    assigned_driver = _safe_str(d.get("assigned_driver") or d.get("assigned_driver_id"))

    is_owner_shipper = role in {"shipper", "broker"} and created_by and created_by == uid
    is_assigned_carrier = role == "carrier" and assigned_carrier and assigned_carrier == uid
    is_assigned_driver = role == "driver" and assigned_driver and assigned_driver == uid

    # Private info gate: only visible to shipper owner/admin always; visible to carrier/driver only after RC signed.
    private_ok = is_owner_shipper or is_rate_con_carrier_signed(d)

    # Keep `origin`/`destination` as the public city/state fields.
    # Hide these optional sensitive structures until private_ok.
    if not private_ok and not (role in {"admin", "super_admin"}):
        for k in [
            "private_details",
            "receiver_details",
            "receiver",
            "consignee",
            "pickup_exact_address",
            "delivery_exact_address",
            "pickup_address_private",
            "delivery_address_private",
            "pickup_location_private",
            "delivery_location_private",
        ]:
            if k in d:
                d.pop(k, None)

        # Also redact any nested private_details if present.
        if isinstance(d.get("metadata"), dict):
            md = dict(d.get("metadata") or {})
            md.pop("private_details", None)
            md.pop("receiver_details", None)
            d["metadata"] = md

    # Offers should remain shipper-only even after RC signing.
    if role in {"carrier", "driver"}:
        d.pop("offers", None)

    # If not assigned carrier/driver and it's a marketplace view, strip assigned identities.
    if role == "carrier" and not is_assigned_carrier:
        # Carriers viewing marketplace loads shouldn't see other carrier assignments.
        # (If it is assigned, it's no longer marketplace anyway.)
        for k in ["assigned_carrier", "assigned_carrier_id", "assigned_carrier_name", "carrier_id", "carrier_uid"]:
            d.pop(k, None)

    if role == "driver" and not is_assigned_driver:
        for k in ["assigned_driver", "assigned_driver_id", "assigned_driver_name"]:
            d.pop(k, None)

    # Carriers can still see contract signature state for their own awarded loads.
    if role == "carrier" and not is_assigned_carrier:
        d.pop("contract", None)

    return d


def _notification_id_for_new_load(load_id: str, carrier_uid: str) -> str:
    raw = f"new_load:{_safe_str(load_id)}:{_safe_str(carrier_uid)}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def notify_previous_carriers_new_load(
    *,
    db: Any,
    shipper_uid: str,
    load: Dict[str, Any],
    frontend_base_url: Optional[str] = None,
) -> int:
    """Notify carriers who previously completed loads for this shipper.

    Best-effort; returns number of notifications written.
    """

    shipper_uid = _safe_str(shipper_uid)
    if not shipper_uid:
        return 0

    load_id = _safe_str(load.get("load_id") or load.get("id"))
    load_number = _safe_str(load.get("load_number")) or load_id

    # Find carriers from prior completed/delivered loads.
    carrier_uids: Set[str] = set()

    loads_iter: Iterable[Any]
    try:
        # Real Firestore query when available.
        q = db.collection("loads").where("created_by", "==", shipper_uid)
        loads_iter = q.stream()
    except Exception:
        loads_iter = db.collection("loads").stream()

    for snap in loads_iter:
        try:
            d = snap.to_dict() or {}
            created_by = _safe_str(d.get("created_by"))
            if created_by != shipper_uid:
                continue

            status = _safe_str(d.get("status")).lower()
            if status not in {"delivered", "completed"}:
                continue

            carrier_uid = _safe_str(d.get("assigned_carrier") or d.get("assigned_carrier_id") or d.get("carrier_id"))
            if carrier_uid:
                carrier_uids.add(carrier_uid)
        except Exception:
            continue

    if not carrier_uids:
        return 0

    action_url = f"/carrier-dashboard?nav=marketplace&load_id={load_id}"
    if frontend_base_url:
        action_url = frontend_base_url.rstrip("/") + action_url

    ts = int(now_ts())
    wrote = 0

    for carrier_uid in sorted(carrier_uids):
        try:
            notif_id = _notification_id_for_new_load(load_id, carrier_uid)
            payload = {
                "id": notif_id,
                "user_id": carrier_uid,
                "notification_type": "shipper_new_load",
                "title": f"New load posted: {load_number}",
                "message": "A shipper you previously worked with has posted a new load.",
                "resource_type": "load",
                "resource_id": load_id,
                "action_url": action_url,
                "is_read": False,
                "created_at": ts,
                "load_id": load_id,
                "load_number": load.get("load_number"),
                "shipper_uid": shipper_uid,
            }
            db.collection("notifications").document(notif_id).set(payload, merge=True)
            wrote += 1
        except Exception:
            continue

    return wrote


def decode_data_url_base64(data_url: str) -> Tuple[bytes, str]:
    """Decode a data URL (data:image/png;base64,...) to bytes.

    Returns: (bytes, content_type)
    """
    text = _safe_str(data_url)
    if not text.startswith("data:") or "," not in text:
        raise ValueError("invalid data_url")

    header, b64 = text.split(",", 1)
    content_type = header[5:].split(";")[0] if header.startswith("data:") else "application/octet-stream"
    if ";base64" not in header:
        raise ValueError("data_url must be base64")

    try:
        raw = base64.b64decode(b64.encode("utf-8"), validate=False)
    except Exception as e:
        raise ValueError(f"base64 decode failed: {e}")

    return raw, content_type
