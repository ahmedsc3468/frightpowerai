from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import get_current_user
from .database import db, log_action
from .load_documents import (
    create_load_document_from_url,
    ensure_rate_confirmation_document,
    list_load_documents,
    upload_load_document_bytes,
)
from .load_workflow_utils import (
    decode_data_url_base64,
    haversine_distance_meters,
    is_rate_con_carrier_signed,
    is_rate_con_shipper_signed,
    notify_previous_carriers_new_load,
    now_ts,
    parse_datetime_best_effort,
    sanitize_load_for_viewer,
    set_contract_rate_con_signature,
)
from .settings import settings


router = APIRouter(tags=["load-workflow"])


class PrivateDetailsUpdate(BaseModel):
    pickup_exact_address: Optional[str] = None
    delivery_exact_address: Optional[str] = None

    receiver_company_name: Optional[str] = None
    receiver_exact_address: Optional[str] = None
    receiver_contact_name: Optional[str] = None
    receiver_contact_phone: Optional[str] = None
    receiver_contact_email: Optional[str] = None
    receiver_handling_instructions: Optional[str] = None

    reference_numbers: Optional[Dict[str, str]] = None
    special_instructions: Optional[str] = None

    # Optional coordinates for delivery validation
    delivery_lat: Optional[float] = None
    delivery_lng: Optional[float] = None

    # Optional coordinates for pickup validation
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None


class RateConSignRequest(BaseModel):
    signer_name: Optional[str] = None
    signature_data_url: Optional[str] = Field(default=None, min_length=20, description="data:image/png;base64,...")


class DeliveryCompleteRequest(BaseModel):
    latitude: float = Field(..., description="Driver current latitude")
    longitude: float = Field(..., description="Driver current longitude")

    receiver_name: str = Field(..., min_length=1, max_length=120)
    receiver_signature_data_url: str = Field(..., min_length=20, description="data:image/png;base64,...")

    remarks: Optional[str] = None
    delivered_at: Optional[float] = None


class PickupCompleteRequest(BaseModel):
    latitude: float = Field(..., description="Driver current latitude")
    longitude: float = Field(..., description="Driver current longitude")

    shipper_name: str = Field(..., min_length=1, max_length=120)
    shipper_signature_data_url: str = Field(..., min_length=20, description="data:image/png;base64,...")

    bol_photo_url: Optional[str] = None
    remarks: Optional[str] = None
    picked_up_at: Optional[float] = None


class InvoiceCreateRequest(BaseModel):
    amount: float = Field(..., gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    notes: Optional[str] = None


def _get_load(load_id: str) -> Optional[Dict[str, Any]]:
    try:
        snap = db.collection("loads").document(str(load_id)).get()
        if getattr(snap, "exists", False):
            d = snap.to_dict() or {}
            d.setdefault("load_id", str(load_id))
            return d
    except Exception:
        return None
    return None


def _require_role(user: Dict[str, Any], roles: set[str]) -> None:
    r = str(user.get("role") or "").strip().lower()
    if r not in roles:
        raise HTTPException(status_code=403, detail="Not authorized")


def _require_shipper_owner(load: Dict[str, Any], user: Dict[str, Any]) -> None:
    uid = str(user.get("uid") or "").strip()
    role = str(user.get("role") or "").strip().lower()
    if role not in {"shipper", "broker", "admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Only shipper/broker can perform this action")
    if role in {"admin", "super_admin"}:
        return

    # Support legacy fields used by older load documents.
    owner_uids = {
        str(load.get("created_by") or "").strip(),
        str(load.get("createdBy") or "").strip(),
        str(load.get("payer_uid") or "").strip(),
        str(load.get("payerUid") or "").strip(),
    }
    owner_uids.discard("")
    if uid not in owner_uids:
        raise HTTPException(status_code=403, detail="You can only modify loads you created")


def _require_assigned_carrier(load: Dict[str, Any], user: Dict[str, Any]) -> None:
    uid = str(user.get("uid") or "").strip()
    role = str(user.get("role") or "").strip().lower()
    if role not in {"carrier", "admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Only carrier can perform this action")
    if role in {"admin", "super_admin"}:
        return
    assigned = str(
        load.get("assigned_carrier")
        or load.get("assigned_carrier_id")
        or load.get("carrier_id")
        or load.get("carrier_uid")
        or ""
    ).strip()
    if not assigned or assigned != uid:
        raise HTTPException(status_code=403, detail="Load is not assigned to your carrier")


def _set_workflow_status(load_id: str, *, new_status: str, actor: Dict[str, Any], notes: str) -> None:
    ts = now_ts()
    patch = {
        "workflow_status": str(new_status),
        "workflow_status_updated_at": ts,
        "updated_at": ts,
    }

    try:
        db.collection("loads").document(str(load_id)).set(patch, merge=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update workflow_status: {e}")

    # Best-effort log
    try:
        entry = {
            "timestamp": ts,
            "actor_uid": actor.get("uid"),
            "actor_role": actor.get("role"),
            "old_workflow_status": None,
            "new_workflow_status": str(new_status),
            "notes": notes,
        }
        db.collection("loads").document(str(load_id)).collection("workflow_status_logs").document().set(entry)
    except Exception:
        pass


@router.patch("/loads/{load_id}/private-details")
async def update_load_private_details(
    load_id: str,
    payload: PrivateDetailsUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    _require_shipper_owner(load, user)

    ts = now_ts()
    private_details = dict(load.get("private_details") or {}) if isinstance(load.get("private_details"), dict) else {}

    if payload.pickup_exact_address is not None:
        private_details["pickup_exact_address"] = payload.pickup_exact_address
    if payload.delivery_exact_address is not None:
        private_details["delivery_exact_address"] = payload.delivery_exact_address

    receiver = dict(private_details.get("receiver") or {}) if isinstance(private_details.get("receiver"), dict) else {}
    if payload.receiver_company_name is not None:
        receiver["company_name"] = payload.receiver_company_name
    if payload.receiver_exact_address is not None:
        receiver["exact_address"] = payload.receiver_exact_address
    if payload.receiver_contact_name is not None:
        receiver["contact_name"] = payload.receiver_contact_name
    if payload.receiver_contact_phone is not None:
        receiver["contact_phone"] = payload.receiver_contact_phone
    if payload.receiver_contact_email is not None:
        receiver["contact_email"] = payload.receiver_contact_email
    if payload.receiver_handling_instructions is not None:
        receiver["handling_instructions"] = payload.receiver_handling_instructions

    if receiver:
        private_details["receiver"] = receiver

    if payload.reference_numbers is not None:
        private_details["reference_numbers"] = payload.reference_numbers
    if payload.special_instructions is not None:
        private_details["special_instructions"] = payload.special_instructions

    if payload.delivery_lat is not None:
        private_details["delivery_lat"] = float(payload.delivery_lat)
    if payload.delivery_lng is not None:
        private_details["delivery_lng"] = float(payload.delivery_lng)

    if payload.pickup_lat is not None:
        private_details["pickup_lat"] = float(payload.pickup_lat)
    if payload.pickup_lng is not None:
        private_details["pickup_lng"] = float(payload.pickup_lng)

    patch = {
        "private_details": private_details,
        "updated_at": ts,
    }

    try:
        db.collection("loads").document(str(load_id)).set(patch, merge=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update private details: {e}")

    log_action(str(user.get("uid")), "LOAD_PRIVATE_DETAILS_UPDATE", f"Updated private details for load {load_id}")

    return {"success": True, "load_id": load_id, "private_details": private_details}


@router.post("/loads/{load_id}/pickup/complete")
async def driver_complete_pickup(
    load_id: str,
    req: PickupCompleteRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = str(user.get("role") or "").strip().lower()
    if role != "driver":
        raise HTTPException(status_code=403, detail="Only drivers can complete pickup")

    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    # Idempotency: if pickup already recorded, return success.
    try:
        if str(load.get("status") or "").strip().lower() in {"in_transit", "delivered", "completed"} and load.get("picked_up_at"):
            return {
                "success": True,
                "load_id": load_id,
                "pickup_event_id": None,
                "workflow_status": str(load.get("workflow_status") or "In Transit"),
                "message": "Pickup already completed",
            }
    except Exception:
        pass

    # Must be assigned to this driver.
    assigned_driver_uid = str(load.get("assigned_driver") or load.get("assigned_driver_id") or load.get("driver_id") or "").strip()
    if assigned_driver_uid != str(user.get("uid") or "").strip():
        raise HTTPException(status_code=403, detail="Load is not assigned to you")

    # Minimal state-machine guard: if this load uses contract workflow, require carrier signature before pickup.
    try:
        contract = load.get("contract")
        if isinstance(contract, dict) and isinstance(contract.get("rate_confirmation"), dict):
            if not is_rate_con_carrier_signed(load):
                raise HTTPException(status_code=400, detail="Carrier must sign rate confirmation before pickup")
    except HTTPException:
        raise
    except Exception:
        pass

    # If workflow_status is present, enforce the expected transition into In Transit.
    try:
        ws = str(load.get("workflow_status") or "").strip()
        if ws and ws not in {"Dispatched", "Awarded"}:
            raise HTTPException(status_code=400, detail=f"Invalid workflow transition from '{ws}' to 'In Transit'")
    except HTTPException:
        raise
    except Exception:
        pass

    picked_up_ts = float(req.picked_up_at) if req.picked_up_at is not None else now_ts()

    private_details = load.get("private_details") if isinstance(load.get("private_details"), dict) else {}
    pickup_lat = private_details.get("pickup_lat")
    pickup_lng = private_details.get("pickup_lng")

    gps_ok = True
    gps_distance_m = None
    if pickup_lat is not None and pickup_lng is not None:
        gps_distance_m = haversine_distance_meters(req.latitude, req.longitude, float(pickup_lat), float(pickup_lng))
        gps_ok = gps_distance_m <= 10.0

    eta_ok = True
    eta_diff_hours = None
    eta_dt = parse_datetime_best_effort(load.get("pickup_date"))
    picked_up_dt = parse_datetime_best_effort(picked_up_ts)
    if eta_dt and picked_up_dt:
        eta_diff_hours = abs((picked_up_dt - eta_dt).total_seconds()) / 3600.0
        eta_ok = eta_diff_hours <= 48.0

    if not gps_ok:
        raise HTTPException(status_code=400, detail=f"GPS check failed: {gps_distance_m:.1f}m from pickup location")
    if not eta_ok:
        raise HTTPException(status_code=400, detail=f"Pickup ETA check failed: pickup time differs by {eta_diff_hours:.1f}h")

    # Ensure there is a BOL document.
    try:
        bol_exists = False
        for d in list_load_documents(load_id):
            if str(d.get("kind") or "").strip().upper() != "BOL":
                continue
            # Accept either a URL (legacy/public) or a storage_path (private/signed).
            if str(d.get("url") or "").strip() or str(d.get("storage_path") or "").strip():
                bol_exists = True
                break
        if not bol_exists:
            raise HTTPException(status_code=400, detail="BOL is required before completing pickup")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to verify BOL document: {e}")

    # Upload shipper/warehouse signature as a document (required).
    try:
        raw, content_type = decode_data_url_base64(req.shipper_signature_data_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid shipper_signature_data_url")

    ext = "png" if "png" in (content_type or "").lower() else "bin"
    filename = f"bol_signature_{load_id}_{int(picked_up_ts)}.{ext}"
    sig_doc = upload_load_document_bytes(load=load, kind="BOL_SIGNATURE", filename=filename, data=raw, actor=user, source="pickup")
    if not sig_doc or not sig_doc.get("doc_id") or (not sig_doc.get("url") and not sig_doc.get("storage_path")):
        raise HTTPException(status_code=500, detail="Failed to store pickup signature document")

    updates = {
        "status": "in_transit",
        "picked_up_at": picked_up_ts,
        "workflow_status": "In Transit",
        "workflow_status_updated_at": picked_up_ts,
        "bol_locked_at": picked_up_ts,
        "bol_locked_by_uid": user.get("uid"),
        "updated_at": now_ts(),
    }

    pickup_event_id = str(uuid.uuid4())
    pickup_event = {
        "pickup_event_id": pickup_event_id,
        "load_id": load_id,
        "timestamp": picked_up_ts,
        "gps": {"lat": req.latitude, "lng": req.longitude},
        "shipper": {"name": req.shipper_name},
        "remarks": req.remarks,
        "driver": {"uid": user.get("uid"), "name": user.get("display_name") or user.get("email")},
        "validation": {
            "gps_distance_m": gps_distance_m,
            "gps_ok": gps_ok,
            "eta_diff_hours": eta_diff_hours,
            "eta_ok": eta_ok,
        },
        "created_at": picked_up_ts,
    }

    try:
        load_ref = db.collection("loads").document(str(load_id))
        load_ref.set(updates, merge=True)
        load_ref.collection("pickup").document(pickup_event_id).set(pickup_event)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save pickup: {e}")

    log_action(str(user.get("uid")), "DRIVER_PICKUP_COMPLETE", f"Load {load_id}: pickup completed and BOL locked")

    return {"success": True, "load_id": load_id, "pickup_event_id": pickup_event_id, "workflow_status": "In Transit"}


@router.post("/loads/{load_id}/rate-confirmation/shipper-sign")
async def shipper_sign_rate_confirmation(
    load_id: str,
    req: RateConSignRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    _require_shipper_owner(load, user)

    # Must be awarded to a carrier first.
    assigned = str(load.get("assigned_carrier") or load.get("assigned_carrier_id") or load.get("carrier_id") or load.get("carrier_uid") or "").strip()
    if not assigned:
        raise HTTPException(status_code=400, detail="Load is not awarded to a carrier yet")

    if not req.signature_data_url:
        raise HTTPException(status_code=400, detail="signature_data_url is required")

    # Ensure an RC document exists. If the only RC is auto-generated, regenerate it so
    # the template stays current. If the shipper uploaded a custom RC, keep it.
    force_regen = True
    try:
        for d in list_load_documents(load_id):
            if str(d.get("kind") or "").strip().upper() != "RATE_CONFIRMATION":
                continue
            src = str(d.get("source") or "").strip().lower()
            url = str(d.get("url") or "").strip()
            if src and src != "generated" and url:
                force_regen = False
                break
    except Exception:
        force_regen = True

    try:
        rc_doc = ensure_rate_confirmation_document(load_id=load_id, shipper=user, force_regenerate=force_regen)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate rate confirmation: {e}")

    if not rc_doc or not rc_doc.get("doc_id") or (not rc_doc.get("url") and not rc_doc.get("storage_path")):
        raise HTTPException(status_code=500, detail="Failed to generate/store rate confirmation document")

    try:
        db.collection("loads").document(str(load_id)).set(
            {"rate_confirmation_doc_id": rc_doc.get("doc_id"), "rate_confirmation_url": rc_doc.get("url")},
            merge=True,
        )
    except Exception:
        # Non-fatal: the RC doc is still in the load vault.
        pass

    try:
        raw, content_type = decode_data_url_base64(req.signature_data_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature_data_url")

    ext = "png" if "png" in (content_type or "").lower() else "bin"
    filename = f"rate_con_signature_shipper_{load_id}_{int(now_ts())}.{ext}"
    signature_doc = upload_load_document_bytes(
        load=load,
        kind="RATE_CONFIRMATION_SIGNATURE_SHIPPER",
        filename=filename,
        data=raw,
        actor=user,
        source="rate_con_sign",
    )
    if not signature_doc or not signature_doc.get("doc_id") or (not signature_doc.get("url") and not signature_doc.get("storage_path")):
        raise HTTPException(status_code=500, detail="Failed to store shipper signature document")

    contract = set_contract_rate_con_signature(
        load=load,
        signer_role=str(user.get("role")),
        signer_uid=str(user.get("uid")),
        signer_name=req.signer_name,
        signature_doc=signature_doc,
    )

    ts = now_ts()
    try:
        db.collection("loads").document(str(load_id)).set({"contract": contract, "updated_at": ts}, merge=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save signature: {e}")

    _set_workflow_status(load_id, new_status="Awarded", actor=user, notes="Shipper signed rate confirmation")

    log_action(str(user.get("uid")), "RATE_CON_SIGN_SHIPPER", f"Load {load_id}: shipper signed rate confirmation")

    return {"success": True, "load_id": load_id, "contract": contract, "rate_confirmation": rc_doc, "shipper_signature": signature_doc}


@router.post("/loads/{load_id}/rate-confirmation/carrier-sign")
async def carrier_sign_rate_confirmation(
    load_id: str,
    req: RateConSignRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    _require_assigned_carrier(load, user)

    if not is_rate_con_shipper_signed(load):
        raise HTTPException(status_code=400, detail="Shipper must sign the rate confirmation first")

    if is_rate_con_carrier_signed(load):
        return {"success": True, "load_id": load_id, "message": "Carrier already signed"}

    if not req.signature_data_url:
        raise HTTPException(status_code=400, detail="signature_data_url is required")

    try:
        raw, content_type = decode_data_url_base64(req.signature_data_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature_data_url")

    ext = "png" if "png" in (content_type or "").lower() else "bin"
    filename = f"rate_con_signature_carrier_{load_id}_{int(now_ts())}.{ext}"
    signature_doc = upload_load_document_bytes(
        load=load,
        kind="RATE_CONFIRMATION_SIGNATURE_CARRIER",
        filename=filename,
        data=raw,
        actor=user,
        source="rate_con_sign",
    )
    if not signature_doc or not signature_doc.get("doc_id") or (not signature_doc.get("url") and not signature_doc.get("storage_path")):
        raise HTTPException(status_code=500, detail="Failed to store carrier signature document")

    contract = set_contract_rate_con_signature(
        load=load,
        signer_role="carrier",
        signer_uid=str(user.get("uid")),
        signer_name=req.signer_name,
        signature_doc=signature_doc,
    )

    ts = now_ts()
    patch = {
        "contract": contract,
        "contract_accepted_at": ts,
        "updated_at": ts,
    }

    # This gate controls private address/receiver visibility in API responses.
    patch["private_details_visible_to_carrier"] = True

    try:
        db.collection("loads").document(str(load_id)).set(patch, merge=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save signature: {e}")

    _set_workflow_status(load_id, new_status="Dispatched", actor=user, notes="Carrier signed rate confirmation")

    log_action(str(user.get("uid")), "RATE_CON_SIGN_CARRIER", f"Load {load_id}: carrier signed rate confirmation")

    return {"success": True, "load_id": load_id, "contract": contract, "carrier_signature": signature_doc}


@router.post("/loads/{load_id}/delivery/complete")
async def driver_complete_delivery(
    load_id: str,
    req: DeliveryCompleteRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = str(user.get("role") or "").strip().lower()
    if role != "driver":
        raise HTTPException(status_code=403, detail="Only drivers can complete delivery")

    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    # Idempotency: if delivery already recorded, return success.
    try:
        if str(load.get("status") or "").strip().lower() in {"delivered", "completed"} and load.get("epod_id"):
            return {
                "success": True,
                "load_id": load_id,
                "epod_id": load.get("epod_id"),
                "workflow_status": str(load.get("workflow_status") or "POD Submitted"),
                "message": "Delivery already completed",
            }
    except Exception:
        pass

    # Must be assigned to this driver.
    assigned_driver_uid = str(load.get("assigned_driver") or load.get("assigned_driver_id") or load.get("driver_id") or "").strip()
    if assigned_driver_uid != str(user.get("uid") or "").strip():
        raise HTTPException(status_code=403, detail="Load is not assigned to you")

    # Minimal state-machine guard: delivery should come after pickup/in-transit.
    try:
        s = str(load.get("status") or "").strip().lower()
        if s and s not in {"in_transit"}:
            raise HTTPException(status_code=400, detail=f"Cannot complete delivery while status is '{s}'")
    except HTTPException:
        raise
    except Exception:
        pass

    # Delivery checks (mock-friendly): enforce only when we have enough info.
    delivered_ts = float(req.delivered_at) if req.delivered_at is not None else now_ts()

    private_details = load.get("private_details") if isinstance(load.get("private_details"), dict) else {}
    delivery_lat = private_details.get("delivery_lat")
    delivery_lng = private_details.get("delivery_lng")

    gps_ok = True
    gps_distance_m = None
    if delivery_lat is not None and delivery_lng is not None:
        gps_distance_m = haversine_distance_meters(req.latitude, req.longitude, float(delivery_lat), float(delivery_lng))
        gps_ok = gps_distance_m <= 10.0

    eta_ok = True
    eta_diff_hours = None
    eta_dt = parse_datetime_best_effort(load.get("delivery_date"))
    delivered_dt = parse_datetime_best_effort(delivered_ts)
    if eta_dt and delivered_dt:
        eta_diff_hours = abs((delivered_dt - eta_dt).total_seconds()) / 3600.0
        eta_ok = eta_diff_hours <= 48.0

    if not gps_ok:
        raise HTTPException(status_code=400, detail=f"GPS check failed: {gps_distance_m:.1f}m from delivery location")
    if not eta_ok:
        raise HTTPException(status_code=400, detail=f"ETA check failed: delivery time differs by {eta_diff_hours:.1f}h")

    # Require a POD document (PDF/image) be uploaded before completing delivery.
    try:
        pod_exists = False
        for d in list_load_documents(load_id):
            if str(d.get("kind") or "").strip().upper() != "POD":
                continue
            # Accept either a URL (legacy/public) or a storage_path (private/signed).
            if str(d.get("url") or "").strip() or str(d.get("storage_path") or "").strip():
                pod_exists = True
                break
        if not pod_exists:
            raise HTTPException(status_code=400, detail="POD is required before completing delivery")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to verify POD document: {e}")

    # Create ePOD record
    epod_id = str(uuid.uuid4())
    epod = {
        "epod_id": epod_id,
        "load_id": load_id,
        "timestamp": delivered_ts,
        "gps": {"lat": req.latitude, "lng": req.longitude},
        "receiver": {"name": req.receiver_name},
        "remarks": req.remarks,
        "driver": {"uid": user.get("uid"), "name": user.get("display_name") or user.get("email")},
        "validation": {
            "gps_distance_m": gps_distance_m,
            "gps_ok": gps_ok,
            "eta_diff_hours": eta_diff_hours,
            "eta_ok": eta_ok,
        },
        "created_at": delivered_ts,
    }

    # Attach the receiver signature into the document vault as a POD artifact (image) (required).
    try:
        raw, content_type = decode_data_url_base64(req.receiver_signature_data_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid receiver_signature_data_url")

    ext = "png" if "png" in (content_type or "").lower() else "bin"
    filename = f"pod_signature_{epod_id}.{ext}"
    record = upload_load_document_bytes(load=load, kind="POD_SIGNATURE", filename=filename, data=raw, actor=user, source="epod")
    if not record or not record.get("doc_id") or (not record.get("url") and not record.get("storage_path")):
        raise HTTPException(status_code=500, detail="Failed to store receiver signature document")
    epod["receiver_signature"] = {
        "doc_id": record.get("doc_id"),
        "url": record.get("url"),
        "content_type": content_type,
    }

    updates = {
        "status": "delivered",
        "delivered_at": delivered_ts,
        "workflow_status": "POD Submitted",
        "pod_submitted_at": delivered_ts,
        "epod_id": epod_id,
        "updated_at": now_ts(),
    }

    try:
        load_ref = db.collection("loads").document(str(load_id))
        load_ref.set(updates, merge=True)
        load_ref.collection("epod").document(epod_id).set(epod)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save delivery: {e}")

    # Create a document record pointing to the ePOD (best-effort).
    try:
        create_load_document_from_url(load=load, kind="POD", url=f"epod:{epod_id}", actor=user, source="epod")
    except Exception:
        pass

    # Notify shipper + carrier (in-app notification)
    try:
        shipper_uid = str(load.get("created_by") or load.get("payer_uid") or load.get("createdBy") or "").strip() or None
        carrier_uid = str(load.get("assigned_carrier") or load.get("assigned_carrier_id") or load.get("carrier_id") or load.get("carrier_uid") or "").strip() or None
        ts_i = int(now_ts())
        for target_uid, ntype in [(shipper_uid, "pod_submitted"), (carrier_uid, "pod_submitted")]:
            if not target_uid:
                continue
            notif_id = str(uuid.uuid4())
            db.collection("notifications").document(notif_id).set(
                {
                    "id": notif_id,
                    "user_id": target_uid,
                    "notification_type": ntype,
                    "title": f"POD submitted for Load {load.get('load_number') or load_id}",
                    "message": "A POD was submitted and is ready for review.",
                    "resource_type": "load",
                    "resource_id": load_id,
                    "action_url": f"/shipper-dashboard?nav=my-loads&load_id={load_id}",
                    "is_read": False,
                    "created_at": ts_i,
                    "load_id": load_id,
                    "epod_id": epod_id,
                }
            )
    except Exception:
        pass

    log_action(str(user.get("uid")), "DRIVER_DELIVERY_COMPLETE", f"Load {load_id}: delivery completed + POD submitted")

    return {"success": True, "load_id": load_id, "epod_id": epod_id, "workflow_status": "POD Submitted"}


@router.post("/loads/{load_id}/invoices")
async def carrier_create_invoice(
    load_id: str,
    req: InvoiceCreateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    _require_assigned_carrier(load, user)

    # Require POD first.
    if str(load.get("workflow_status") or "").strip() not in {"POD Submitted", "Invoiced", "Payment Settled"}:
        raise HTTPException(status_code=400, detail="Invoice can only be generated after POD submission")

    invoice_id = str(uuid.uuid4())
    ts = now_ts()

    invoice = {
        "invoice_id": invoice_id,
        "invoice_number": f"INV{load_id}",
        "load_id": load_id,
        "amount": float(req.amount),
        "currency": str(req.currency).upper(),
        "notes": req.notes,
        "carrier_uid": user.get("uid"),
        "shipper_uid": load.get("created_by"),
        "status": "submitted",
        "created_at": ts,
        "updated_at": ts,
        "epod_id": load.get("epod_id"),
    }

    try:
        db.collection("invoices").document(invoice_id).set(invoice)
        db.collection("loads").document(str(load_id)).set(
            {"invoice_id": invoice_id, "invoiced_at": ts, "workflow_status": "Invoiced", "updated_at": ts},
            merge=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create invoice: {e}")

    # Notify shipper
    try:
        shipper_uid = str(load.get("created_by") or "").strip()
        if shipper_uid:
            notif_id = str(uuid.uuid4())
            db.collection("notifications").document(notif_id).set(
                {
                    "id": notif_id,
                    "user_id": shipper_uid,
                    "notification_type": "invoice_submitted",
                    "title": f"Invoice submitted for Load {load.get('load_number') or load_id}",
                    "message": "A carrier submitted an invoice for your load.",
                    "resource_type": "invoice",
                    "resource_id": invoice_id,
                    "action_url": f"/shipper-dashboard?nav=my-loads&load_id={load_id}",
                    "is_read": False,
                    "created_at": int(ts),
                    "load_id": load_id,
                    "invoice_id": invoice_id,
                }
            )
    except Exception:
        pass

    log_action(str(user.get("uid")), "CARRIER_CREATE_INVOICE", f"Load {load_id}: invoice {invoice_id} created")

    return {"success": True, "load_id": load_id, "invoice_id": invoice_id}


@router.post("/loads/{load_id}/payment/settle")
async def shipper_settle_payment(
    load_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    _require_shipper_owner(load, user)

    invoice_id = str(load.get("invoice_id") or "").strip() or None
    if not invoice_id:
        raise HTTPException(status_code=400, detail="No invoice found for this load")

    ts = now_ts()
    try:
        db.collection("invoices").document(invoice_id).set({"status": "paid", "paid_at": ts, "updated_at": ts}, merge=True)
        db.collection("loads").document(str(load_id)).set(
            {"workflow_status": "Payment Settled", "status": "completed", "payment_settled_at": ts, "updated_at": ts},
            merge=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to settle payment: {e}")

    log_action(str(user.get("uid")), "PAYMENT_SETTLED", f"Load {load_id}: payment settled")

    return {"success": True, "load_id": load_id, "workflow_status": "Payment Settled"}


@router.get("/loads/{load_id}/viewer")
async def get_load_for_viewer(
    load_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Convenience endpoint for clients that want server-side redaction applied."""
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    redacted = sanitize_load_for_viewer(load, viewer_uid=str(user.get("uid")), viewer_role=str(user.get("role")))
    return {"load": redacted}


def workflow_notify_previous_carriers_on_post(*, shipper_uid: str, load: Dict[str, Any]) -> int:
    return notify_previous_carriers_new_load(
        db=db,
        shipper_uid=shipper_uid,
        load=load,
        frontend_base_url=str(getattr(settings, "FRONTEND_BASE_URL", "") or "").rstrip("/") or None,
    )
