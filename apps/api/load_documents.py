from __future__ import annotations

import hashlib
import time
import uuid
import os
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .auth import get_current_user
from .database import bucket, db, signed_download_url
from .load_ownership import normalize_payer_fields
from .settings import settings

try:
    from .finance.emailer import send_invoice_notification_email
except Exception:  # pragma: no cover
    send_invoice_notification_email = None

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover
    fitz = None


router = APIRouter(tags=["load-documents"])


_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}


def _get_user_email(uid: str) -> Optional[str]:
    try:
        snap = db.collection("users").document(str(uid)).get()
        if not getattr(snap, "exists", False):
            return None
        d = snap.to_dict() or {}
        email = str(d.get("email") or "").strip()
        return email or None
    except Exception:
        return None


def _notify_payer_pod_uploaded(*, load: Dict[str, Any], doc: Dict[str, Any], actor: Dict[str, Any]) -> None:
    """Create an in-app notification (and optional email) for the payer when a POD is uploaded."""

    try:
        if str(doc.get("kind") or "").strip().upper() != "POD":
            return

        payer_uid, payer_role = normalize_payer_fields(load)
        if not payer_uid:
            return

        actor_uid = str(actor.get("uid") or "").strip()
        if actor_uid and actor_uid == payer_uid:
            # Avoid notifying someone about their own upload.
            return

        load_id = str(load.get("load_id") or "").strip()
        load_number = str(load.get("load_number") or "").strip() or load_id
        doc_id = str(doc.get("doc_id") or doc.get("id") or "").strip() or None

        now = _now()
        notification_id = str(uuid.uuid4())
        action_url = f"/shipper-dashboard?nav=my-loads&load_id={load_id}" if load_id else "/shipper-dashboard?nav=my-loads"
        title = f"POD uploaded for Load {load_number}"
        message = f"A POD was uploaded to Load {load_number}. You can now review it in the portal."

        notification_data = {
            "id": notification_id,
            "user_id": payer_uid,
            "notification_type": "pod_uploaded",
            "title": title,
            "message": message,
            "resource_type": "load_document",
            "resource_id": doc_id or load_id,
            "action_url": action_url,
            "is_read": False,
            "created_at": int(now),
            "load_id": load_id,
            "load_number": load.get("load_number"),
            "payer_role": payer_role,
            "doc_id": doc_id,
            "doc_kind": "POD",
        }

        db.collection("notifications").document(notification_id).set(notification_data)

        # Optional email notification (best-effort).
        try:
            if getattr(settings, "ENABLE_POD_UPLOADED_EMAIL_NOTIFICATIONS", False) and send_invoice_notification_email is not None:
                payer_email = _get_user_email(payer_uid)
                if payer_email:
                    link = f"{getattr(settings, 'FRONTEND_BASE_URL', '').rstrip('/')}{action_url}"
                    subj = f"POD uploaded: Load {load_number}"
                    body = f"A POD was uploaded for Load {load_number} in FreightPower.\n\nView: {link}\n"
                    send_invoice_notification_email(to_email=payer_email, subject=subj, body=body)
        except Exception:
            pass
    except Exception:
        # Never fail document upload due to notification issues.
        return


def _now() -> float:
    return float(time.time())


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _content_type_for_filename(filename: str) -> str:
    fn = (filename or "").lower()
    if fn.endswith(".pdf"):
        return "application/pdf"
    if fn.endswith(".jpg") or fn.endswith(".jpeg"):
        return "image/jpeg"
    if fn.endswith(".png"):
        return "image/png"
    return "application/octet-stream"


def _storage_path_for_load_doc(load_id: str, doc_id: str, filename: str) -> str:
    safe_name = (filename or "file").replace("/", "_").replace("\\", "_")
    return f"load_documents/{load_id}/{doc_id}_{safe_name}"


def _load_doc_ref(load_id: str, doc_id: str):
    return db.collection("loads").document(load_id).collection("documents").document(doc_id)


def _load_docs_collection(load_id: str):
    return db.collection("loads").document(load_id).collection("documents")


def _get_load(load_id: str) -> Optional[Dict[str, Any]]:
    try:
        snap = db.collection("loads").document(load_id).get()
        if snap.exists:
            d = snap.to_dict() or {}
            d.setdefault("load_id", load_id)
            return d
    except Exception:
        return None
    return None


def _can_access_load_documents(load: Dict[str, Any], uid: str, role: str) -> bool:
    role = (role or "").strip().lower()
    if role in {"admin", "super_admin"}:
        return True

    if role in {"shipper", "broker"}:
        owner_uid = load.get("created_by") or load.get("payer_uid") or load.get("createdBy")
        if str(owner_uid or "").strip() == str(uid or "").strip():
            return True

        try:
            payer_uid, _payer_role = normalize_payer_fields(load)
            if str(payer_uid or "").strip() == str(uid or "").strip():
                return True
        except Exception:
            pass

    assigned_carrier = str(
        load.get("assigned_carrier")
        or load.get("assigned_carrier_id")
        or load.get("carrier_id")
        or load.get("carrier_uid")
        or ""
    ).strip()
    if role == "carrier" and assigned_carrier and assigned_carrier == uid:
        return True

    assigned_driver = str(
        load.get("assigned_driver")
        or load.get("assigned_driver_id")
        or load.get("driver_id")
        or ""
    ).strip()
    if role == "driver" and assigned_driver and assigned_driver == uid:
        return True

    return False


def list_load_documents(load_id: str) -> List[Dict[str, Any]]:
    try:
        docs = [snap.to_dict() or {} for snap in _load_docs_collection(load_id).stream()]
        for d in docs:
            d.setdefault("load_id", load_id)
        docs.sort(key=lambda x: float(x.get("created_at") or x.get("uploaded_at") or 0.0), reverse=True)
        return docs
    except Exception:
        return []


def _find_existing_by_url(load_id: str, kind: str, url: str) -> Optional[Dict[str, Any]]:
    kind_u = (kind or "OTHER").strip().upper()
    url_s = (url or "").strip()
    if not url_s:
        return None

    for d in list_load_documents(load_id):
        if (str(d.get("kind") or "").strip().upper() == kind_u) and (str(d.get("url") or "").strip() == url_s):
            return d
    return None


def create_load_document_from_url(
    *,
    load: Dict[str, Any],
    kind: str,
    url: str,
    actor: Dict[str, Any],
    filename: Optional[str] = None,
    source: str = "external_url",
    storage_path: Optional[str] = None,
) -> Dict[str, Any]:
    load_id = str(load.get("load_id") or "").strip()
    if not load_id:
        raise ValueError("load_id required")

    existing = _find_existing_by_url(load_id, kind, url)
    if existing:
        return existing

    now = _now()
    doc_id = str(uuid.uuid4())
    record = {
        "doc_id": doc_id,
        "load_id": load_id,
        "load_number": load.get("load_number"),
        "kind": (kind or "OTHER").strip().upper(),
        "filename": filename,
        "content_type": None,
        "size_bytes": None,
        "sha256": None,
        "storage_path": storage_path,
        "url": url,
        "source": source,
        "uploaded_by_uid": actor.get("uid"),
        "uploaded_by_role": actor.get("role"),
        "created_at": now,
        "uploaded_at": now,
        "updated_at": now,
        "metadata": {},
    }

    try:
        _load_doc_ref(load_id, doc_id).set(record, merge=True)
    except Exception:
        # best-effort only
        pass

    _notify_payer_pod_uploaded(load=load, doc=record, actor=actor)

    return record


def upload_load_document_bytes(
    *,
    load: Dict[str, Any],
    kind: str,
    filename: str,
    data: bytes,
    actor: Dict[str, Any],
    source: str = "upload",
) -> Dict[str, Any]:
    load_id = str(load.get("load_id") or "").strip()
    if not load_id:
        raise ValueError("load_id required")

    now = _now()
    doc_id = str(uuid.uuid4())

    content_type = _content_type_for_filename(filename)
    storage_path = _storage_path_for_load_doc(load_id, doc_id, filename)
    url: Optional[str] = None

    try:
        blob = bucket.blob(storage_path)
        blob.upload_from_string(data, content_type=content_type)
        url = signed_download_url(storage_path, filename=filename, disposition="attachment")
    except Exception:
        url = None

    record = {
        "doc_id": doc_id,
        "load_id": load_id,
        "load_number": load.get("load_number"),
        "kind": (kind or "OTHER").strip().upper(),
        "filename": filename,
        "content_type": content_type,
        "size_bytes": len(data) if data is not None else None,
        "sha256": _sha256(data) if data is not None else None,
        "storage_path": storage_path,
        "url": url,
        "source": source,
        "uploaded_by_uid": actor.get("uid"),
        "uploaded_by_role": actor.get("role"),
        "created_at": now,
        "uploaded_at": now,
        "updated_at": now,
        "metadata": {},
    }

    try:
        _load_doc_ref(load_id, doc_id).set(record, merge=True)
    except Exception:
        pass

    _notify_payer_pod_uploaded(load=load, doc=record, actor=actor)

    return record


def generate_rate_confirmation_pdf_bytes(*, load: Dict[str, Any], accepted_offer: Optional[Dict[str, Any]], shipper: Dict[str, Any]) -> bytes:
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not available")

    load_id = str(load.get("load_id") or "").strip()
    load_number = str(load.get("load_number") or "").strip()
    origin = load.get("origin")
    destination = load.get("destination")
    private_details = load.get("private_details") if isinstance(load.get("private_details"), dict) else {}

    def _loc_text(v: Any) -> str:
        if isinstance(v, str):
            return v
        if isinstance(v, dict):
            city = v.get("city") or ""
            state = v.get("state") or ""
            text = v.get("text") or ""
            combo = (", ".join([p for p in [city, state] if p])).strip(", ")
            return combo or text or str(v)
        return str(v or "")

    def _first_str(*vals: Any) -> str:
        for v in vals:
            s = str(v or "").strip()
            if s:
                return s
        return ""

    def _money(v: Any) -> str:
        try:
            if v is None:
                return "—"
            return f"${float(v):,.2f}"
        except Exception:
            return "—"

    def _kv(label: str, value: str) -> str:
        return f"{label}: {value or '—'}"

    shipper_name = _first_str(
        load.get("shipper_company_name"),
        shipper.get("company_name"),
        shipper.get("name"),
        shipper.get("email"),
        shipper.get("uid"),
    )
    shipper_email = _first_str(load.get("shipper_email"), shipper.get("email"))
    shipper_phone = _first_str(load.get("shipper_phone"), private_details.get("shipper_contact_phone"))

    carrier_name = ""
    carrier_id = ""
    carrier_rate = None
    carrier_notes = ""
    if isinstance(accepted_offer, dict):
        carrier_name = _first_str(accepted_offer.get("carrier_name"))
        carrier_id = _first_str(accepted_offer.get("carrier_id"))
        carrier_rate = accepted_offer.get("rate")
        carrier_notes = _first_str(accepted_offer.get("notes"))

    carrier_name = _first_str(load.get("assigned_carrier_name"), carrier_name, load.get("carrier_name"))
    carrier_id = _first_str(load.get("assigned_carrier"), load.get("assigned_carrier_id"), load.get("carrier_id"), carrier_id)
    mc_number = _first_str(load.get("carrier_mc"), load.get("mc_number"), load.get("carrier_mc_number"))
    dot_number = _first_str(load.get("carrier_dot"), load.get("dot_number"), load.get("carrier_dot_number"))

    pickup_date = _first_str(load.get("pickup_date"), load.get("pickupDate"))
    delivery_date = _first_str(load.get("delivery_date"), load.get("deliveryDate"))
    pickup_time = _first_str(load.get("pickup_time"))
    delivery_time = _first_str(load.get("delivery_time"))
    equipment = _first_str(load.get("equipment_type"), load.get("equipmentType"), load.get("equipment"))
    commodity = _first_str(load.get("commodity"), load.get("product"), load.get("freight_description"))
    weight = _first_str(load.get("weight"), load.get("weight_lbs"), load.get("weightLbs"))

    origin_text = _first_str(_loc_text(origin), _loc_text(private_details.get("pickup_exact_address")))
    destination_text = _first_str(_loc_text(destination), _loc_text(private_details.get("receiver_exact_address")))

    refs = load.get("reference_numbers") if isinstance(load.get("reference_numbers"), dict) else {}
    po_number = _first_str(load.get("po_number"), refs.get("po"), refs.get("po_number"))
    ref_number = _first_str(load.get("reference"), refs.get("ref"), refs.get("reference"))

    payment_terms = _first_str(load.get("payment_terms"), load.get("terms"), "Net 14")
    special_instructions = _first_str(load.get("special_instructions"), private_details.get("special_instructions"), private_details.get("receiver_handling_instructions"))

    doc = fitz.open()
    page = doc.new_page(width=612, height=792)  # Letter

    margin = 48
    width = 612 - 2 * margin
    y = 44

    # Header
    page.insert_text((margin, y), "RATE CONFIRMATION", fontsize=18)
    y += 18
    page.insert_text((margin, y), f"Load {load_number or '—'}   •   Load ID {load_id or '—'}", fontsize=10)
    y += 18
    page.draw_line((margin, y), (margin + width, y))
    y += 14

    def section_title(title: str) -> None:
        nonlocal y
        page.insert_text((margin, y), title, fontsize=12)
        y += 12

    def two_col(left_lines: List[str], right_lines: List[str]) -> None:
        nonlocal y
        box_h = max(70, 14 * max(len(left_lines), len(right_lines)) + 14)
        box_y = y
        page.draw_rect(fitz.Rect(margin, box_y, margin + width, box_y + box_h), color=(0.82, 0.82, 0.82), width=1)
        mid_x = margin + width / 2
        page.draw_line((mid_x, box_y), (mid_x, box_y + box_h))

        lx = margin + 10
        rx = mid_x + 10
        ly = box_y + 12
        for line in left_lines:
            page.insert_text((lx, ly), line, fontsize=10)
            ly += 14
        ry = box_y + 12
        for line in right_lines:
            page.insert_text((rx, ry), line, fontsize=10)
            ry += 14

        y = box_y + box_h + 14

    section_title("Parties")
    two_col(
        [
            _kv("Shipper", shipper_name),
            _kv("Email", shipper_email),
            _kv("Phone", shipper_phone),
        ],
        [
            _kv("Carrier", carrier_name or carrier_id),
            _kv("MC", mc_number),
            _kv("DOT", dot_number),
        ],
    )

    section_title("Shipment")
    shipment_left = [
        _kv("Origin", origin_text),
        _kv("Pickup Date", pickup_date),
        _kv("Pickup Time", pickup_time),
    ]
    shipment_right = [
        _kv("Destination", destination_text),
        _kv("Delivery Date", delivery_date),
        _kv("Delivery Time", delivery_time),
    ]
    two_col(shipment_left, shipment_right)

    section_title("Freight Details")
    two_col(
        [
            _kv("Equipment", equipment),
            _kv("Commodity", commodity),
            _kv("Weight", str(weight) if str(weight or "").strip() else "—"),
        ],
        [
            _kv("PO", po_number),
            _kv("Reference", ref_number),
        ],
    )

    section_title("Pricing & Terms")
    total = carrier_rate
    two_col(
        [
            _kv("Agreed Rate", _money(carrier_rate)),
            _kv("Total", _money(total)),
        ],
        [
            _kv("Payment Terms", payment_terms),
            _kv("Carrier Notes", carrier_notes),
        ],
    )

    if special_instructions:
        section_title("Instructions")
        box_h = 72
        box_y = y
        page.draw_rect(fitz.Rect(margin, box_y, margin + width, box_y + box_h), color=(0.82, 0.82, 0.82), width=1)
        page.insert_textbox(
            fitz.Rect(margin + 10, box_y + 10, margin + width - 10, box_y + box_h - 10),
            str(special_instructions),
            fontsize=10,
        )
        y = box_y + box_h + 14

    section_title("Signatures")
    sig_box_h = 110
    sig_box_y = y
    page.draw_rect(fitz.Rect(margin, sig_box_y, margin + width, sig_box_y + sig_box_h), color=(0.82, 0.82, 0.82), width=1)
    page.insert_text((margin + 10, sig_box_y + 14), "Shipper Authorized Signature", fontsize=10)
    page.insert_text((margin + 10, sig_box_y + 62), "Carrier Authorized Signature", fontsize=10)
    page.draw_line((margin + 200, sig_box_y + 30), (margin + width - 10, sig_box_y + 30))
    page.draw_line((margin + 200, sig_box_y + 78), (margin + width - 10, sig_box_y + 78))
    page.insert_text((margin + 10, sig_box_y + sig_box_h - 14), "This Rate Confirmation is binding upon electronic acceptance in FreightPower.", fontsize=9)
    y = sig_box_y + sig_box_h + 10

    out = doc.tobytes()
    doc.close()
    return out


def ensure_rate_confirmation_document(*, load_id: str, shipper: Dict[str, Any], force_regenerate: bool = False) -> Optional[Dict[str, Any]]:
    load = _get_load(load_id)
    if not load:
        return None

    # Don't create duplicates.
    if not force_regenerate:
        for d in list_load_documents(load_id):
            if str(d.get("kind") or "").strip().upper() == "RATE_CONFIRMATION":
                return d

    accepted_offer = None
    offers = load.get("offers")
    if isinstance(offers, list):
        for o in offers:
            if isinstance(o, dict) and str(o.get("status") or "").lower() == "accepted":
                accepted_offer = o
                break

    pdf_bytes = generate_rate_confirmation_pdf_bytes(load=load, accepted_offer=accepted_offer, shipper=shipper)
    filename = f"rate_confirmation_{load.get('load_number') or load_id}.pdf"
    return upload_load_document_bytes(load=load, kind="RATE_CONFIRMATION", filename=filename, data=pdf_bytes, actor=shipper, source="generated")


@router.get("/loads/{load_id}/documents")
async def get_load_documents(load_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    if not _can_access_load_documents(load, user.get("uid"), user.get("role")):
        raise HTTPException(status_code=403, detail="Not authorized to view load documents")

    docs = list_load_documents(load_id)
    # Replace stored URLs with short-lived signed URLs (when storage_path is available).
    try:
        for d in docs:
            sp = str(d.get("storage_path") or "").strip()
            if sp:
                d["url"] = signed_download_url(sp, filename=d.get("filename"), disposition="attachment")
    except Exception:
        pass
    return {"load_id": load_id, "total": len(docs), "documents": docs}


@router.post("/loads/{load_id}/documents/upload")
async def upload_load_document(
    load_id: str,
    file: UploadFile = File(...),
    kind: str = Form("OTHER"),
    user: Dict[str, Any] = Depends(get_current_user),
):
    load = _get_load(load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")

    if not _can_access_load_documents(load, user.get("uid"), user.get("role")):
        raise HTTPException(status_code=403, detail="Not authorized to upload documents for this load")

    kind_upper = str(kind or "OTHER").strip().upper()
    if kind_upper == "BOL" and load.get("bol_locked_at"):
        raise HTTPException(status_code=400, detail="BOL is locked after pickup and cannot be modified")

    filename = file.filename or "file"
    ext = ("." + filename.split(".")[-1].lower()) if "." in filename else ""
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF, JPG, JPEG, and PNG files are supported")

    data = await file.read()
    record = upload_load_document_bytes(load=load, kind=kind_upper, filename=filename, data=data, actor=user, source="upload")

    # For workflow/UI convenience, mirror RC metadata onto the load root.
    try:
        if kind_upper == "RATE_CONFIRMATION" and record and record.get("doc_id"):
            db.collection("loads").document(str(load_id)).set(
                {"rate_confirmation_doc_id": record.get("doc_id"), "rate_confirmation_url": record.get("url")},
                merge=True,
            )
    except Exception:
        pass

    return record
