from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import get_current_user
from .database import db, log_action
from .load_documents import list_load_documents


router = APIRouter(tags=["load-record"])


def _normalize_role(role: Any) -> str:
    r = str(role or "").strip().lower().replace(" ", "_")
    if r == "superadmin":
        return "super_admin"
    return r


def _require_super_admin(user: Dict[str, Any]) -> None:
    role = _normalize_role(user.get("role"))
    if role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin only")


def _require_admin(user: Dict[str, Any]) -> None:
    role = _normalize_role(user.get("role"))
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admins only")


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


def _get_user_profile(uid: str) -> Dict[str, Any]:
    try:
        snap = db.collection("users").document(str(uid)).get()
        if getattr(snap, "exists", False):
            return snap.to_dict() or {}
    except Exception:
        return {}
    return {}


def _admin_load_record_access(uid: str) -> Dict[str, Any]:
    prof = _get_user_profile(uid)
    access = prof.get("load_record_access")
    return access if isinstance(access, dict) else {}


def _require_load_record_access(user: Dict[str, Any]) -> None:
    role = _normalize_role(user.get("role"))
    if role == "super_admin":
        return
    if role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    uid = str(user.get("uid") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="Missing uid")

    access = _admin_load_record_access(uid)
    if access.get("approved") is not True:
        raise HTTPException(status_code=403, detail="Admin access requires super admin approval")


class SuperAdminDecision(BaseModel):
    decision_note: Optional[str] = Field(default=None, max_length=800)


@router.get("/admin/load-record-access")
async def admin_get_load_record_access(user: Dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    uid = str(user.get("uid") or "").strip()
    if not uid:
        raise HTTPException(status_code=401, detail="Missing uid")
    return {"uid": uid, "load_record_access": _admin_load_record_access(uid)}


@router.post("/super-admin/admins/{admin_uid}/load-record-access/approve")
async def super_admin_approve_admin_load_record_access(
    admin_uid: str,
    payload: SuperAdminDecision = Body(default=SuperAdminDecision()),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _require_super_admin(user)

    target_uid = str(admin_uid or "").strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="Missing admin uid")

    # Ensure target is an admin.
    prof = _get_user_profile(target_uid)
    if _normalize_role(prof.get("role")) != "admin":
        raise HTTPException(status_code=400, detail="Target user is not an admin")

    now = float(time.time())
    patch = {
        "load_record_access": {
            "approved": True,
            "approved_at": now,
            "approved_by_uid": user.get("uid"),
            "approved_by_email": user.get("email"),
            "decision_note": payload.decision_note,
        },
        "updated_at": now,
    }

    try:
        db.collection("users").document(target_uid).set(patch, merge=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to approve: {e}")

    log_action(str(user.get("uid")), "ADMIN_LOAD_RECORD_ACCESS_APPROVE", f"Approved load record access for admin {target_uid}")
    return {"success": True, "admin_uid": target_uid, "load_record_access": patch["load_record_access"]}


@router.post("/super-admin/admins/{admin_uid}/load-record-access/revoke")
async def super_admin_revoke_admin_load_record_access(
    admin_uid: str,
    payload: SuperAdminDecision = Body(default=SuperAdminDecision()),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _require_super_admin(user)

    target_uid = str(admin_uid or "").strip()
    if not target_uid:
        raise HTTPException(status_code=400, detail="Missing admin uid")

    now = float(time.time())
    patch = {
        "load_record_access": {
            "approved": False,
            "revoked_at": now,
            "revoked_by_uid": user.get("uid"),
            "revoked_by_email": user.get("email"),
            "decision_note": payload.decision_note,
        },
        "updated_at": now,
    }

    try:
        db.collection("users").document(target_uid).set(patch, merge=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to revoke: {e}")

    log_action(str(user.get("uid")), "ADMIN_LOAD_RECORD_ACCESS_REVOKE", f"Revoked load record access for admin {target_uid}")
    return {"success": True, "admin_uid": target_uid, "load_record_access": patch["load_record_access"]}


def _stream_subcollection(load_id: str, name: str, *, limit: int = 500) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        coll = db.collection("loads").document(str(load_id)).collection(str(name))
        for snap in coll.stream():
            d = snap.to_dict() or {}
            d.setdefault("id", getattr(snap, "id", None))
            out.append(d)
            if len(out) >= limit:
                break
    except Exception:
        return []

    def _ts(v: Any) -> float:
        try:
            return float(v or 0.0)
        except Exception:
            return 0.0

    out.sort(key=lambda x: _ts(x.get("timestamp") or x.get("created_at") or x.get("updated_at")), reverse=False)
    return out


@router.get("/loads/{load_id}/record")
async def get_load_record(load_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    _require_load_record_access(user)

    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    documents = list_load_documents(str(load_id))
    status_logs = _stream_subcollection(load_id, "status_logs")
    workflow_status_logs = _stream_subcollection(load_id, "workflow_status_logs")
    pickup_events = _stream_subcollection(load_id, "pickup")
    epod_events = _stream_subcollection(load_id, "epod")

    invoice = None
    try:
        invoice_id = str(load.get("invoice_id") or "").strip()
        if invoice_id:
            inv_snap = db.collection("invoices").document(invoice_id).get()
            if getattr(inv_snap, "exists", False):
                invoice = inv_snap.to_dict() or {}
                invoice.setdefault("invoice_id", invoice_id)
    except Exception:
        invoice = None

    def _event(ts: Any, etype: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            tsv = float(ts or 0.0)
        except Exception:
            tsv = 0.0
        return {"timestamp": tsv, "type": etype, **payload}

    timeline: List[Dict[str, Any]] = []

    # Load birth (best-effort).
    birth_ts = load.get("created_at") or load.get("posted_at") or load.get("createdAt") or load.get("created")
    if birth_ts:
        timeline.append(_event(birth_ts, "load_created", {"load_id": str(load_id), "created_by": load.get("created_by"), "creator_role": load.get("creator_role")}))

    # Documents.
    for d in documents or []:
        timeline.append(
            _event(
                d.get("created_at") or d.get("uploaded_at"),
                "document_uploaded",
                {
                    "doc_id": d.get("doc_id") or d.get("id"),
                    "kind": d.get("kind"),
                    "filename": d.get("filename"),
                    "url": d.get("url"),
                    "storage_path": d.get("storage_path"),
                    "uploaded_by_uid": d.get("uploaded_by_uid"),
                    "uploaded_by_role": d.get("uploaded_by_role"),
                    "source": d.get("source"),
                },
            )
        )

    # Status logs.
    for s in status_logs or []:
        timeline.append(
            _event(
                s.get("timestamp"),
                "status_change",
                {
                    "old_status": s.get("old_status"),
                    "new_status": s.get("new_status"),
                    "actor_uid": s.get("actor_uid"),
                    "actor_role": s.get("actor_role"),
                    "notes": s.get("notes"),
                    "metadata": s.get("metadata"),
                },
            )
        )

    # Workflow status logs.
    for w in workflow_status_logs or []:
        timeline.append(
            _event(
                w.get("timestamp"),
                "workflow_status_change",
                {
                    "old_workflow_status": w.get("old_workflow_status"),
                    "new_workflow_status": w.get("new_workflow_status"),
                    "actor_uid": w.get("actor_uid"),
                    "actor_role": w.get("actor_role"),
                    "notes": w.get("notes"),
                },
            )
        )

    for p in pickup_events or []:
        timeline.append(_event(p.get("timestamp") or p.get("created_at"), "pickup_completed", {"pickup_event": p}))

    for e in epod_events or []:
        timeline.append(_event(e.get("timestamp") or e.get("created_at"), "delivery_completed", {"epod": e}))

    if invoice and invoice.get("created_at"):
        timeline.append(_event(invoice.get("created_at"), "invoice_created", {"invoice_id": invoice.get("invoice_id"), "status": invoice.get("status")}))

    timeline = [t for t in timeline if float(t.get("timestamp") or 0.0) > 0]
    timeline.sort(key=lambda x: float(x.get("timestamp") or 0.0), reverse=False)

    return {
        "load_id": str(load_id),
        "load": load,
        "documents": documents,
        "status_logs": status_logs,
        "workflow_status_logs": workflow_status_logs,
        "pickup_events": pickup_events,
        "epod_events": epod_events,
        "invoice": invoice,
        "timeline": timeline,
    }
