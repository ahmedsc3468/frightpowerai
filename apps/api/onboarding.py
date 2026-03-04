# File: apps/api/onboarding.py
"""Onboarding router for manual onboarding and account creation endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Any, List, Optional
import json
import time
import hashlib
from datetime import datetime, timedelta

from firebase_admin import firestore

from .auth import get_current_user
from .database import db, log_action, record_profile_update
from .fmcsa import FmcsaClient
from .banlist import assert_not_banned
from .models import (
    OnboardingDataRequest, ChatbotAccountCreationRequest, OnboardingStatusResponse
)

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])


def _parse_onboarding_data(user: Dict[str, Any]) -> Dict[str, Any]:
    onboarding_data_str = user.get("onboarding_data")
    if not onboarding_data_str:
        return {}
    if isinstance(onboarding_data_str, dict):
        return onboarding_data_str
    if not isinstance(onboarding_data_str, str):
        return {}
    try:
        parsed = json.loads(onboarding_data_str)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _has_w9_document(onboarding_data: Dict[str, Any]) -> bool:
    try:
        raw_docs = onboarding_data.get("documents")
        if not isinstance(raw_docs, list):
            return False
        for d in raw_docs:
            if not isinstance(d, dict):
                continue

            # Support multiple storage shapes.
            dt = (
                d.get("doc_type")
                or d.get("type")
                or (d.get("extracted_fields", {}) or {}).get("document_type")
            )
            dt_s = str(dt or "").strip().upper()
            if not dt_s:
                continue
            if "W9" in dt_s:
                return True
        return False
    except Exception:
        return False


def _missing_shipper_items(user: Dict[str, Any]) -> Dict[str, List[str]]:
    # Core fields that should block onboarding completion.
    required_fields = [
        "company_name",
        "business_type",
        "tax_id",
        "address",
        "phone",
        "name",
    ]

    # Additional onboarding fields that are helpful but not strictly required to mark onboarding complete.
    optional_fields = [
        "contact_title",
        "website",
    ]

    missing_required_fields: List[str] = []
    for key in required_fields:
        v = user.get(key)
        if v is None:
            missing_required_fields.append(key)
            continue
        if isinstance(v, str) and not v.strip():
            missing_required_fields.append(key)
            continue
        if v == "":
            missing_required_fields.append(key)

    missing_optional_fields: List[str] = []
    for key in optional_fields:
        v = user.get(key)
        if v is None:
            missing_optional_fields.append(key)
            continue
        if isinstance(v, str) and not v.strip():
            missing_optional_fields.append(key)
            continue
        if v == "":
            missing_optional_fields.append(key)

    onboarding_data = _parse_onboarding_data(user)
    missing_documents: List[str] = []
    if not _has_w9_document(onboarding_data):
        missing_documents.append("w9")

    return {
        "missing_required_fields": missing_required_fields,
        "missing_optional_fields": missing_optional_fields,
        "missing_documents": missing_documents,
    }


@router.get("/shipper/missing")
async def get_shipper_missing_items(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Return missing onboarding items for a shipper/broker.

    Used by Shipper Profile to render a dynamic onboarding completion modal.
    """

    role = str(user.get("role") or "").strip().lower()
    if role not in {"shipper", "broker"}:
        raise HTTPException(status_code=403, detail="Only shippers/brokers can access this endpoint")

    missing = _missing_shipper_items(user)
    return {
        "missing_required_fields": missing.get("missing_required_fields", []),
        "missing_optional_fields": missing.get("missing_optional_fields", []),
        "missing_documents": missing.get("missing_documents", []),
        "onboarding_completed": bool(user.get("onboarding_completed", False)),
    }


@router.post("/shipper/complete")
async def complete_shipper_onboarding(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Mark shipper onboarding completed if (and only if) nothing required is missing."""

    role = str(user.get("role") or "").strip().lower()
    if role not in {"shipper", "broker"}:
        raise HTTPException(status_code=403, detail="Only shippers/brokers can access this endpoint")

    missing = _missing_shipper_items(user)
    missing_fields = missing.get("missing_required_fields", [])
    missing_documents = missing.get("missing_documents", [])
    if missing_fields or missing_documents:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Onboarding is not complete",
                "missing_required_fields": missing_fields,
                "missing_optional_fields": missing.get("missing_optional_fields", []),
                "missing_documents": missing_documents,
            },
        )

    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        db.collection("users").document(str(uid)).set(
            {
                "onboarding_completed": True,
                "onboarding_step": "COMPLETED",
                "updated_at": time.time(),
            },
            merge=True,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to complete onboarding: {str(e)}")

    return {"ok": True, "onboarding_completed": True}


def _pref_enabled(*, user: Dict[str, Any], uid: str, key: str, default: bool = True) -> bool:
    """Best-effort read of a user's notification preference.

    Defaults to True when unset to preserve existing behavior.
    """

    try:
        prefs = user.get("notification_preferences")
        if isinstance(prefs, dict) and key in prefs:
            return bool(prefs.get(key))

        snap = db.collection("users").document(str(uid)).get()
        if not getattr(snap, "exists", False):
            return bool(default)
        d = snap.to_dict() or {}
        prefs = d.get("notification_preferences")
        if not isinstance(prefs, dict):
            return bool(default)
        if key not in prefs:
            return bool(default)
        return bool(prefs.get(key))
    except Exception:
        return bool(default)


def _compliance_notif_id(uid: str, item_key: str) -> str:
    raw = f"compliance:{uid}:{item_key}".encode("utf-8")
    return "comp_" + hashlib.sha1(raw).hexdigest()[:28]


def _upsert_compliance_notification(*, uid: str, item_key: str, title: str, message: str, action_url: str, status: str) -> None:
    """Upsert a compliance notification for a specific required-doc key.

    Keeps 'is_read' sticky if the user already opened it.
    """

    try:
        now = int(time.time())
        notif_id = _compliance_notif_id(str(uid), str(item_key))
        ref = db.collection("notifications").document(notif_id)

        is_read = False
        created_at = now
        try:
            snap = ref.get()
            if getattr(snap, "exists", False):
                existing = snap.to_dict() or {}
                is_read = bool(existing.get("is_read", False))
                created_at = int(existing.get("created_at") or now)
        except Exception:
            pass

        payload = {
            "id": notif_id,
            "user_id": str(uid),
            "notification_type": "compliance_alert",
            "title": str(title or "Compliance Alert"),
            "message": str(message or ""),
            "resource_type": "compliance",
            "resource_id": str(item_key),
            "action_url": str(action_url or "/driver-dashboard?nav=hiring"),
            "is_read": bool(is_read),
            "created_at": int(created_at),
            "updated_at": now,
            "category": "compliance",
            "compliance": {
                "key": str(item_key),
                "status": str(status or ""),
            },
        }

        ref.set(payload, merge=True)
    except Exception:
        return


def _clear_compliance_notification(*, uid: str, item_key: str) -> None:
    try:
        notif_id = _compliance_notif_id(str(uid), str(item_key))
        db.collection("notifications").document(notif_id).delete()
    except Exception:
        return


def _normalize_identifier(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Keep digits only for DOT/MC.
    digits = "".join(ch for ch in s if ch.isdigit())
    return digits or s


def _summarize_fmcsa_verification(verification: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "result": verification.get("result"),
        "reasons": verification.get("reasons", []),
        "usdot": verification.get("usdot"),
        "mc_number": verification.get("mc_number"),
        "fetched_at": verification.get("fetched_at"),
    }


def calculate_document_status(expiry_date_str: str) -> str:
    """
    Calculate document status based on expiry date.
    Returns: "Valid", "Expiring Soon", or "Expired"
    """
    try:
        if not expiry_date_str:
            return "Unknown"
        
        # Parse the expiry date (handles formats like "2026-04-03" or "2026-04-03T00:00:00Z")
        if isinstance(expiry_date_str, str):
            if 'T' in expiry_date_str:
                expiry_date = datetime.fromisoformat(expiry_date_str.replace('Z', '+00:00')).date()
            else:
                expiry_date = datetime.strptime(expiry_date_str, "%Y-%m-%d").date()
        else:
            expiry_date = expiry_date_str
        
        today = datetime.now().date()
        days_until_expiry = (expiry_date - today).days
        
        if days_until_expiry < 0:
            return "Expired"
        elif days_until_expiry <= 30:
            return "Expiring Soon"
        else:
            return "Valid"
    except Exception as e:
        print(f"Error calculating document status: {e}")
        return "Unknown"


@router.get("/status", response_model=OnboardingStatusResponse)
async def get_onboarding_status(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Get current user's onboarding status."""
    uid = user['uid']
    
    return OnboardingStatusResponse(
        onboarding_completed=user.get("onboarding_completed", False),
        onboarding_step=user.get("onboarding_step", "WELCOME"),
        onboarding_score=user.get("onboarding_score", 0),
        is_complete=user.get("onboarding_completed", False),
        current_step=user.get("onboarding_step", "WELCOME"),
        progress=user.get("onboarding_score", 0)
    )


@router.get("/coach-status")
async def get_coach_status(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Get AI coach status and recommendations for onboarding."""
    progress = user.get("onboarding_score", 0)
    
    # Determine status color based on progress
    if progress >= 80:
        status_color = "Green"
    elif progress >= 50:
        status_color = "Amber"
    else:
        status_color = "Red"
    
    # Determine FMCSA status
    fmcsa_status = "Verified" if user.get("dot_number") or user.get("mc_number") else "Pending"
    
    # Get next best actions
    next_best_actions = []
    if not user.get("dot_number") and not user.get("mc_number"):
        next_best_actions.append("Complete FMCSA verification")
    if not user.get("onboarding_completed"):
        next_best_actions.append("Complete onboarding form")
    
    if not next_best_actions:
        next_best_actions = ["All onboarding steps complete!"]
    
    return {
        "status_color": status_color,
        "total_score": int(progress),
        "next_best_actions": next_best_actions[:3],
        "fmcsa_status": fmcsa_status,
        "progress": progress,
        "is_complete": user.get("onboarding_completed", False),
        "current_step": user.get("onboarding_step", "WELCOME"),
        "coach_messages": []
    }


@router.get("/data")
async def get_onboarding_data(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Get current user's onboarding profile data including DOT/MC numbers and availability status."""
    # Availability + marketplace views are stored on the driver document.
    # The auth dependency returns the users profile, so we merge in driver fields here
    # to keep the UI state persistent across reloads.
    is_available = user.get("is_available", False)
    marketplace_views_count = user.get("marketplace_views_count", 0)

    try:
        if user.get("role") == "driver":
            driver_id = user.get("uid")
            if driver_id:
                driver_doc = db.collection("drivers").document(driver_id).get()
                if driver_doc.exists:
                    driver_data = driver_doc.to_dict() or {}
                    is_available = driver_data.get("is_available", is_available)
                    marketplace_views_count = driver_data.get(
                        "marketplace_views_count", marketplace_views_count
                    )
    except Exception as e:
        # Non-fatal: fall back to users values
        print(f"Warning: failed to load driver availability from drivers doc: {e}")

    # Parse optional onboarding_data JSON (if present) to surface commonly-used fields.
    onboarding_data: Dict[str, Any] = {}
    onboarding_data_str = user.get("onboarding_data")
    if onboarding_data_str:
        try:
            parsed = json.loads(onboarding_data_str)
            if isinstance(parsed, dict):
                onboarding_data = parsed
        except Exception:
            onboarding_data = {}

    def _coerce_int(v: Any) -> int | None:
        try:
            if v is None or v == "":
                return None
            return int(v)
        except Exception:
            return None

    fleet_size = _coerce_int(onboarding_data.get("fleetSize") or onboarding_data.get("fleet_size"))
    equipment_type = (
        onboarding_data.get("equipmentType")
        or onboarding_data.get("equipment_type")
        or onboarding_data.get("equipment")
    )
    equipment_counts = onboarding_data.get("equipmentCounts") or onboarding_data.get("equipment_counts")
    if not isinstance(equipment_counts, dict):
        equipment_counts = {}

    def _first_non_empty(*keys: str):
        for k in keys:
            v = onboarding_data.get(k)
            if v is None:
                continue
            if isinstance(v, str):
                if v.strip() == "":
                    continue
                return v
            return v
        return None

    # Shipper-specific onboarding fields (persisted via /onboarding/save into onboarding_data JSON)
    shipper_fields: Dict[str, Any] = {}
    for out_key, keys in {
        "businessType": ("businessType", "business_type"),
        "businessName": ("businessName", "business_name"),
        "taxId": ("taxId", "tax_id"),
        "businessAddress": ("businessAddress", "business_address"),
        "businessPhone": ("businessPhone", "business_phone"),
        "businessEmail": ("businessEmail", "business_email"),
        "website": ("website",),
        "contactFullName": ("contactFullName", "contact_full_name"),
        "contactTitle": ("contactTitle", "contact_title"),
        "contactPhone": ("contactPhone", "contact_phone"),
        "contactEmail": ("contactEmail", "contact_email"),
        "freightType": ("freightType", "freight_type"),
        "preferredEquipment": ("preferredEquipment", "preferred_equipment"),
        "avgMonthlyVolume": ("avgMonthlyVolume", "avg_monthly_volume"),
        "regionsOfOperation": ("regionsOfOperation", "regions_of_operation"),
    }.items():
        v = _first_non_empty(*keys)
        if v is not None:
            shipper_fields[out_key] = v

    power_units_count = _coerce_int(
        equipment_counts.get("powerUnits")
        or equipment_counts.get("power_units")
        or onboarding_data.get("powerUnits")
        or onboarding_data.get("power_units")
    )
    reefers_count = _coerce_int(
        equipment_counts.get("reefers")
        or equipment_counts.get("reefer")
        or onboarding_data.get("reefers")
        or onboarding_data.get("reefer_count")
    )
    dry_vans_count = _coerce_int(
        equipment_counts.get("dryVans")
        or equipment_counts.get("dry_vans")
        or equipment_counts.get("dryVan")
        or equipment_counts.get("dry_van")
        or onboarding_data.get("dryVans")
        or onboarding_data.get("dry_vans")
        or onboarding_data.get("dry_van_count")
    )

    # Consent summary (used by DriverDashboard progress widgets).
    consents_summary: Dict[str, bool] = {}
    try:
        from .consents import required_marketplace_consents_for_role, _catalog_by_key, _driver_primary_carrier_id

        role = str(user.get("role") or "").lower()
        uid = str(user.get("uid") or "")
        required = required_marketplace_consents_for_role(role)
        catalog = _catalog_by_key()
        carrier_id = _driver_primary_carrier_id(uid) if role == "driver" else None
        if uid and required:
            for key in required:
                meta = catalog.get(key) or {}
                scope = str(meta.get("scope") or "global").strip().lower()
                if scope == "per_carrier":
                    if not carrier_id:
                        consents_summary[key] = False
                        continue
                    snap = (
                        db.collection("users")
                        .document(uid)
                        .collection("carrier_consents")
                        .document(str(carrier_id))
                        .collection("consents")
                        .document(key)
                        .get()
                    )
                else:
                    snap = db.collection("users").document(uid).collection("consents").document(key).get()
                d = snap.to_dict() if snap.exists else {}
                consents_summary[key] = bool(d.get("signed_at")) and not bool(d.get("revoked_at"))
    except Exception as e:
        print(f"Warning: failed to compute consent summary: {e}")

    return {
        "data": {
            "email": user.get("email"),
            "fullName": user.get("name") or user.get("full_name"),
            "firstName": user.get("first_name"),
            "lastName": user.get("last_name"),
            "companyName": user.get("company_name"),
            "dotNumber": user.get("dot_number"),
            "mcNumber": user.get("mc_number"),
            "phone": user.get("phone"),
            "address": user.get("address"),
            "role": user.get("role", "carrier"),
            "profile_picture_url": user.get("profile_picture_url"),
            "emergency_contact_name": user.get("emergency_contact_name"),
            "emergency_contact_relationship": user.get("emergency_contact_relationship"),
            "emergency_contact_phone": user.get("emergency_contact_phone"),
            "onboarding_completed": user.get("onboarding_completed", False),
            "onboarding_step": user.get("onboarding_step", "WELCOME"),
            "onboarding_score": user.get("onboarding_score", 0),

            # Common carrier onboarding fields (may be absent)
            "fleetSize": fleet_size,
            "equipmentType": equipment_type,
            "equipmentCounts": {
                **({"powerUnits": power_units_count} if power_units_count is not None else {}),
                **({"reefers": reefers_count} if reefers_count is not None else {}),
                **({"dryVans": dry_vans_count} if dry_vans_count is not None else {}),
            } if any(v is not None for v in [power_units_count, reefers_count, dry_vans_count]) else None,

            # Shipper onboarding fields (when present).
            **shipper_fields,
        },
        "consents": consents_summary,
        "is_available": is_available,
        "marketplace_views_count": marketplace_views_count
    }


@router.post("/save")
async def save_onboarding_data(
    payload: OnboardingDataRequest,
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Save onboarding data with APPEND logic instead of OVERRIDE.
    This preserves previously extracted document data AND uploaded documents.
    """
    try:
        uid = user['uid']
        user_ref = db.collection("users").document(uid)
        
        # Fetch existing user data to preserve previously extracted data
        existing_user = user_ref.get().to_dict() if user_ref.get().exists else {}
        existing_onboarding_data = existing_user.get("onboarding_data")
        
        # Parse existing onboarding data if it exists
        if existing_onboarding_data and isinstance(existing_onboarding_data, str):
            try:
                existing_data = json.loads(existing_onboarding_data)
            except:
                existing_data = {}
        else:
            existing_data = {}
        
        # Extract data from new payload
        data = payload.data
        
        # APPEND logic: merge new data with existing data
        # New data fills in gaps but doesn't override previously extracted fields
        # CRITICAL: Preserve the documents array from previous uploads
        merged_data = {
            **existing_data,
            **{k: v for k, v in data.items() if v}  # Only add non-empty values
        }
        
        # IMPORTANT: If existing data had documents array, keep it
        # (Don't let new data overwrite previously uploaded documents)
        if "documents" in existing_data and "documents" not in data:
            merged_data["documents"] = existing_data["documents"]
        
        # Build update dictionary - only update non-extracted fields
        # Preserve extracted DOT/MC/Company if they were from documents
        update_data = {
            "updated_at": time.time(),
            "onboarding_completed": True,
            "onboarding_step": "COMPLETED",
            "role": payload.role,
            "is_verified": True,
            "email_verified": True,
        }
        
        # Only update fields that aren't already extracted from documents
        # If DOT/MC came from documents, they stay locked
        if data.get("companyName") and not existing_user.get("company_name"):
            update_data["company_name"] = data["companyName"]
        elif data.get("companyName"):
            # If already exists (from documents), keep the extracted value
            update_data["company_name"] = existing_user.get("company_name")
        
        if data.get("dotNumber") and not existing_user.get("dot_number"):
            update_data["dot_number"] = data["dotNumber"]
        elif existing_user.get("dot_number"):
            # Keep existing extracted DOT
            update_data["dot_number"] = existing_user.get("dot_number")
        
        if data.get("mcNumber") and not existing_user.get("mc_number"):
            update_data["mc_number"] = data["mcNumber"]
        elif existing_user.get("mc_number"):
            # Keep existing extracted MC
            update_data["mc_number"] = existing_user.get("mc_number")
        
        # These fields can be updated (not extracted from documents)
        if data.get("contactPhone"):
            update_data["phone"] = data["contactPhone"]
        if data.get("ownerName"):
            update_data["full_name"] = data["ownerName"]
        if data.get("firstName"):
            update_data["first_name"] = data["firstName"]
        if data.get("lastName"):
            update_data["last_name"] = data["lastName"]
        
        # Store merged onboarding data as JSON (both extracted and manually entered)
        # This includes documents array from previous uploads
        update_data["onboarding_data"] = json.dumps(merged_data)
        
        # Update user document
        user_ref.update(update_data)

        # Driver-specific persistence: mirror selected vehicle type onto the driver profile.
        # This enables carrier-level aggregation via /drivers/my-drivers.
        if str(payload.role or '').strip().lower() == "driver":
            try:
                raw_vehicle = (
                    merged_data.get("vehicleType")
                    or merged_data.get("vehicle_type")
                    or merged_data.get("vehicle")
                )

                def _norm_vehicle(v: Any) -> str | None:
                    if v is None:
                        return None
                    s = str(v).strip().lower()
                    if not s:
                        return None
                    s = s.replace("-", "_").replace(" ", "_")
                    # common aliases
                    if s in {"powerunit", "power_unit", "tractor", "truck", "semi"}:
                        return "power_unit"
                    if s in {"dry", "dryvan", "dry_van", "van"}:
                        return "dry_van"
                    if s in {"reefer", "refrigerated"}:
                        return "reefer"
                    return s

                vehicle_type = _norm_vehicle(raw_vehicle)
                if vehicle_type:
                    db.collection("drivers").document(uid).set(
                        {"vehicle_type": vehicle_type, "updated_at": time.time()},
                        merge=True,
                    )
            except Exception as e:
                # Non-fatal: onboarding should still succeed.
                print(f"Warning: failed to persist driver vehicle_type: {e}")
        
        log_action(uid, "ONBOARDING_SAVE", f"Manual onboarding completed (appended to existing data) for role: {payload.role}")
        
        return {
            "success": True,
            "message": "Onboarding updated successfully (data and documents preserved)",
            "user_id": uid,
            "redirect_url": f"/{payload.role}-dashboard"
        }
    except Exception as e:
        print(f"Error saving onboarding data: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to save onboarding data: {str(e)}"
        )


@router.post("/create-from-chatbot")
async def create_account_from_chatbot(
    payload: ChatbotAccountCreationRequest,
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Create account directly from chatbot data (quick path from AI Chatbot)."""
    try:
        uid = user['uid']
        user_ref = db.collection("users").document(uid)
        
        # Extract data from chatbot collected_data
        data = payload.collected_data
        
        # Build update dictionary
        update_data = {
            "updated_at": time.time(),
            "onboarding_completed": True,
            "onboarding_step": "COMPLETED",
            "role": payload.role,
            "onboarding_score": int(payload.compliance_score),
            "is_verified": True,  # Mark as verified after onboarding
            "email_verified": True,
        }
        
        # Map chatbot-collected data to user document
        if data.get("dot_number"):
            update_data["dot_number"] = data["dot_number"]
        if data.get("mc_number"):
            update_data["mc_number"] = data["mc_number"]
        if data.get("company_name"):
            update_data["company_name"] = data["company_name"]
        if data.get("full_name"):
            update_data["full_name"] = data["full_name"]
        if data.get("first_name"):
            update_data["first_name"] = data["first_name"]
        if data.get("last_name"):
            update_data["last_name"] = data["last_name"]
        if data.get("phone"):
            update_data["phone"] = data["phone"]
        
        # Store complete chatbot data as JSON (includes documents with their scores)
        # The payload includes documents array with all document info and scores
        chatbot_record = {
            "from_chatbot": True,
            "collected_data": data,
            "document_ids": payload.document_ids,
            "documents": payload.documents if hasattr(payload, 'documents') else [],  # Include full document data
            "compliance_score": payload.compliance_score,
            "missing_fields": payload.missing_fields if hasattr(payload, 'missing_fields') else [],
        }
        update_data["onboarding_data"] = json.dumps(chatbot_record)
        
        # Update user document
        user_ref.update(update_data)
        
        log_action(
            uid, 
            "ONBOARDING_CHATBOT", 
            f"Account created from chatbot with score: {payload.compliance_score}"
        )
        
        return {
            "success": True,
            "message": "Account created successfully from chatbot data",
            "user_id": uid,
            "redirect_url": f"/{payload.role}-dashboard"
        }
    except Exception as e:
        print(f"Error creating account from chatbot: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to create account: {str(e)}"
        )


@router.post("/update-profile")
async def update_profile_with_data(
    data: Dict[str, Any],
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """Update user profile with specific fields during onboarding."""
    try:
        uid = user['uid']
        user_ref = db.collection("users").document(uid)

        before = (user_ref.get().to_dict() or {})
        
        # Build update from provided data
        update_data = {"updated_at": time.time()}
        
        # Map common field names
        field_mapping = {
            "companyName": "company_name",
            "dotNumber": "dot_number",
            "mcNumber": "mc_number",
            "fullName": "full_name",
            "firstName": "first_name",
            "lastName": "last_name",
            "phone": "phone",
            "cdlNumber": "cdl_number",
        }
        
        for frontend_field, db_field in field_mapping.items():
            if frontend_field in data and data[frontend_field]:
                if db_field in {"dot_number", "mc_number"}:
                    update_data[db_field] = _normalize_identifier(data[frontend_field])
                else:
                    update_data[db_field] = data[frontend_field]

        # Ban enforcement when sensitive identifiers are being set.
        assert_not_banned(
            email=before.get("email"),
            phone=update_data.get("phone") or before.get("phone"),
            dot_number=update_data.get("dot_number") or before.get("dot_number"),
            cdl_number=update_data.get("cdl_number") or before.get("cdl_number"),
        )

        fmcsa_summary: Dict[str, Any] | None = None
        # FMCSA verification gate for carriers when DOT/MC is being set/changed.
        if (user.get("role") == "carrier") and (
            "dotNumber" in data or "mcNumber" in data or "dot_number" in update_data or "mc_number" in update_data
        ):
            dot_number = update_data.get("dot_number") or before.get("dot_number")
            mc_number = update_data.get("mc_number") or before.get("mc_number")
            dot_number = _normalize_identifier(dot_number)
            mc_number = _normalize_identifier(mc_number)
            if not dot_number and not mc_number:
                raise HTTPException(status_code=400, detail="Provide at least a DOT or MC number")
            try:
                client = FmcsaClient()
                verification = client.verify(usdot=dot_number, mc_number=mc_number)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"FMCSA verification failed: {str(exc)}")

            if verification.get("result") == "Blocked":
                raise HTTPException(status_code=403, detail="FMCSA verification blocked this carrier")

            fmcsa_summary = _summarize_fmcsa_verification(verification)
            update_data["fmcsa_verification"] = fmcsa_summary
            update_data["fmcsa_verified"] = verification.get("result") == "Verified"
            update_data["fmcsa_last_checked_at"] = time.time()
            # Prefer the resolved DOT from FMCSA if available.
            if verification.get("usdot"):
                update_data["dot_number"] = _normalize_identifier(verification.get("usdot"))
            if verification.get("mc_number"):
                update_data.setdefault("mc_number", _normalize_identifier(verification.get("mc_number")))
        
        # Update user document
        user_ref.update(update_data)

        # Per-user change history
        changed: Dict[str, Any] = {}
        for k, after_v in update_data.items():
            if k == "updated_at":
                continue
            before_v = before.get(k)
            if before_v != after_v:
                changed[k] = {"before": before_v, "after": after_v}
        if changed:
            record_profile_update(
                user_id=uid,
                changes=changed,
                source="onboarding.update-profile",
                actor_id=uid,
                actor_role=user.get("role"),
                fmcsa_verification=fmcsa_summary,
            )
        
        log_action(uid, "PROFILE_UPDATE", f"Updated fields: {list(update_data.keys())}")
        
        return {
            "success": True,
            "message": "Profile updated successfully",
            "updated_fields": list(update_data.keys())
        }
    except Exception as e:
        print(f"Error updating profile: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to update profile: {str(e)}"
        )


@router.post("/update")
async def update_onboarding_data(
    payload: dict,
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Update onboarding data - overwrites specified fields.
    Used by Account Settings to save profile changes.
    """
    try:
        uid = user['uid']
        onboarding_ref = db.collection("onboarding").document(uid)
        
        # Get existing document
        onboarding_doc = onboarding_ref.get()
        
        if not onboarding_doc.exists:
            # Create new document if doesn't exist
            onboarding_ref.set({
                **payload,
                "user_id": uid,
                "created_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP
            })
        else:
            # Update existing document
            update_data = {
                **payload,
                "updated_at": firestore.SERVER_TIMESTAMP
            }
            onboarding_ref.update(update_data)
        
        print(f"✅ Onboarding data updated for user {uid}")
        
        return {
            "success": True,
            "message": "Onboarding data updated successfully"
        }
    except Exception as e:
        print(f"Error updating onboarding data: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to update onboarding data: {str(e)}"
        )


# --- NEW COMPLIANCE ENDPOINTS FOR DASHBOARD ---

@router.get("/compliance/status")
async def get_compliance_status(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get compliance status for dashboard display.
    Returns DOT/MC numbers, compliance score, documents with status.
    """
    try:
        uid = user['uid']
        
        # Get onboarding data from user profile
        onboarding_score = user.get("onboarding_score", 0)
        dot_number = user.get("dot_number", "")
        mc_number = user.get("mc_number", "")
        company_name = user.get("company_name", "")
        
        # Parse documents from onboarding_data if available
        documents = []
        onboarding_data_str = user.get("onboarding_data", "{}")
        
        try:
            onboarding_data = json.loads(onboarding_data_str)
            
            # Extract documents array if present (from chatbot)
            if isinstance(onboarding_data, dict):
                if "documents" in onboarding_data:
                    raw_docs = onboarding_data.get("documents", [])
                    for doc in raw_docs:
                        status = "Unknown"
                        if doc.get("extracted_fields", {}).get("expiry_date"):
                            status = calculate_document_status(
                                doc["extracted_fields"]["expiry_date"]
                            )
                        
                        documents.append({
                            "id": doc.get("doc_id", ""),
                            "filename": doc.get("filename", ""),
                            "score": doc.get("score", 0),
                            "status": status,
                            "extracted_fields": doc.get("extracted_fields", {}),
                            "missing_fields": doc.get("missing", [])
                        })
        except Exception as e:
            print(f"Error parsing onboarding data: {e}")
        
        # Determine status color based on score
        if onboarding_score >= 80:
            status_color = "Green"
        elif onboarding_score >= 50:
            status_color = "Amber"
        else:
            status_color = "Red"
        
        return {
            "compliance_score": int(onboarding_score),
            "dot_number": dot_number,
            "mc_number": mc_number,
            "company_name": company_name,
            "status_color": status_color,
            "documents": documents,
            "score_breakdown": {
                "document_completeness": int(onboarding_score * 0.4),
                "data_accuracy": int(onboarding_score * 0.3),
                "regulatory_compliance": int(onboarding_score * 0.3)
            },
            "issues": [],
            "warnings": [],
            "recommendations": [],
            "role_data": {
                "carrier": {
                    "dot_number": dot_number,
                    "mc_number": mc_number
                },
                "driver": {
                    "license_verified": bool(user.get("cdl_number"))
                },
                "shipper": {
                    "company_verified": bool(company_name)
                }
            }
        }
    except Exception as e:
        print(f"Error fetching compliance status: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch compliance status: {str(e)}"
        )


@router.get("/documents")
async def get_documents(
    user: Dict[str, Any] = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get list of documents with scores and status for document vault.
    """
    try:
        uid = user['uid']
        
        from .database import signed_download_url

        documents = []
        onboarding_data_str = user.get("onboarding_data", "{}")
        
        try:
            onboarding_data = json.loads(onboarding_data_str)
            
            # Extract documents array
            if isinstance(onboarding_data, dict):
                raw_docs = onboarding_data.get("documents", [])
                for doc in raw_docs:
                    status = "Unknown"
                    expiry_date = doc.get("extracted_fields", {}).get("expiry_date")
                    
                    if expiry_date:
                        status = calculate_document_status(expiry_date)
                    
                    doc_type = doc.get("extracted_fields", {}).get("document_type", "Unknown")

                    sp = str(doc.get("storage_path") or "").strip()
                    signed_url = signed_download_url(sp, filename=doc.get("filename"), disposition="attachment") if sp else None
                    
                    documents.append({
                        "id": doc.get("doc_id", ""),
                        "filename": doc.get("filename", ""),
                        "type": doc_type,
                        "score": doc.get("score", 0),
                        "status": status,
                        "expiry_date": expiry_date,
                        "uploaded_at": doc.get("uploaded_at", ""),
                        "download_url": signed_url,
                        "extracted_fields": doc.get("extracted_fields", {}),
                        "missing_fields": doc.get("missing", []),
                        "warnings": []
                    })
        except Exception as e:
            print(f"Error parsing onboarding data: {e}")
        
        return {
            "documents": documents,
            "total_count": len(documents),
            "valid_count": sum(1 for d in documents if d["status"] == "Valid"),
            "expiring_soon_count": sum(1 for d in documents if d["status"] == "Expiring Soon"),
            "expired_count": sum(1 for d in documents if d["status"] == "Expired")
        }
    except Exception as e:
        print(f"Error fetching documents: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch documents: {str(e)}"
        )


@router.get("/driver/required-docs")
async def get_driver_required_docs(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Driver Hiring & Onboarding required docs/status.

    This endpoint provides a persistent record of:
    - what docs are required (stored in Firestore config/driver_required_documents)
    - which docs the current driver uploaded (derived from onboarding_data.documents)
    - which items are missing/expired
    - whether actions are blocked until consent is completed
    """

    uid = user["uid"]
    role = (user.get("role") or "").lower() or "driver"

    default_required = [
        {
            "key": "application",
            "title": "Application for Employment",
            "description": "Personal info, driving history, references",
            "kind": "profile",
        },
        {
            "key": "cdl",
            "title": "Commercial Driver's License",
            "description": "Upload your CDL document",
            "kind": "document",
            "upload_document_type": "cdl",
        },
        {
            "key": "medical_card",
            "title": "DOT Medical Certificate",
            "description": "Required for compliance",
            "kind": "document",
            "upload_document_type": "medical_card",
        },
        {
            "key": "drug_test",
            "title": "Drug Test Results",
            "description": "Pre-employment screening required",
            "kind": "document",
            "upload_document_type": "drug_test",
        },
        {
            "key": "background_check",
            "title": "Background Check",
            "description": "Criminal history verification",
            "kind": "document",
            "upload_document_type": "background_check",
        },
        {
            "key": "consent",
            "title": "Digital Consent Form",
            "description": "Terms & conditions agreement",
            "kind": "consent",
        },
    ]

    # Ensure required-doc definitions exist in DB (persistent record)
    try:
        cfg_ref = db.collection("config").document("driver_required_documents")
        cfg_snap = cfg_ref.get()
        if not getattr(cfg_snap, "exists", False):
            cfg_ref.set({
                "role": "driver",
                "required": default_required,
                "created_at": time.time(),
                "updated_at": time.time(),
            })
            required_defs = default_required
        else:
            cfg = cfg_snap.to_dict() or {}
            required_defs = cfg.get("required") if isinstance(cfg.get("required"), list) else default_required
            if not required_defs:
                required_defs = default_required
                cfg_ref.set({"required": default_required, "updated_at": time.time()}, merge=True)
    except Exception as e:
        print(f"Warning: failed to read/write driver_required_documents config: {e}")
        required_defs = default_required

    onboarding_data_str = user.get("onboarding_data", "{}")
    try:
        onboarding_data = json.loads(onboarding_data_str) if isinstance(onboarding_data_str, str) else (onboarding_data_str or {})
    except Exception:
        onboarding_data = {}

    raw_docs: List[Dict[str, Any]] = []
    if isinstance(onboarding_data, dict):
        docs_val = onboarding_data.get("documents", [])
        if isinstance(docs_val, list):
            raw_docs = [d for d in docs_val if isinstance(d, dict)]

    def _doc_submitted_key(doc: Dict[str, Any]) -> str:
        v = doc.get("submitted_type") or doc.get("submitted_type_key") or doc.get("document_type")
        if not v:
            v = (doc.get("extracted_fields") or {}).get("document_type")
        return str(v or "").strip().lower()

    def _doc_expiry(doc: Dict[str, Any]) -> Optional[str]:
        ef = doc.get("extracted_fields") or {}
        return ef.get("expiry_date") or doc.get("expiry_date")

    def _find_doc_for_key(key: str) -> Optional[Dict[str, Any]]:
        key_l = str(key or "").strip().lower()
        if not key_l:
            return None
        # Prefer submitted_type match.
        for d in raw_docs:
            if _doc_submitted_key(d) == key_l:
                return d
        # Fallback heuristic: match extracted doc type.
        for d in raw_docs:
            t = str((d.get("extracted_fields") or {}).get("document_type") or "").strip().lower()
            if not t:
                continue
            if key_l in t or t in key_l:
                return d
        return None

    # Consent gating for Hiring & Onboarding
    # Requirement: Signing "Data Sharing Consent (Per Carrier)" should satisfy the
    # "Digital Consent Form" card and unlock the rest of the actions on this page.
    consent_gate_key = "data_sharing_consent"
    consent_gate_scope = "per_carrier"
    consent_gate_signed = False
    consent_gate_carrier_id: Optional[str] = None
    consent_gate_checked = False

    # Full marketplace eligibility (may require ALL consents)
    try:
        from .consents import get_user_missing_marketplace_consents
        missing_consents = get_user_missing_marketplace_consents(uid=uid, role=role)
        marketplace_eligible = len(missing_consents) == 0
    except Exception as e:
        print(f"Warning: failed to compute marketplace consents: {e}")
        missing_consents = []
        marketplace_eligible = False

    # Hiring/onboarding gate: only check if driver.
    try:
        if role == "driver":
            # Match the per-carrier storage layout used in apps/api/consents.py
            snap = db.collection("drivers").document(uid).get()
            driver_data = snap.to_dict() if getattr(snap, "exists", False) else {}
            consent_gate_carrier_id = str(driver_data.get("carrier_id") or "").strip() or None
            if consent_gate_scope == "per_carrier":
                if consent_gate_carrier_id:
                    c_snap = (
                        db.collection("users")
                        .document(uid)
                        .collection("carrier_consents")
                        .document(str(consent_gate_carrier_id))
                        .collection("consents")
                        .document(consent_gate_key)
                        .get()
                    )
                    state = c_snap.to_dict() if getattr(c_snap, "exists", False) else {}
                    consent_gate_signed = bool(state.get("signed_at")) and not bool(state.get("revoked_at"))
                else:
                    consent_gate_signed = False
            else:
                c_snap = (
                    db.collection("users")
                    .document(uid)
                    .collection("consents")
                    .document(consent_gate_key)
                    .get()
                )
                state = c_snap.to_dict() if getattr(c_snap, "exists", False) else {}
                consent_gate_signed = bool(state.get("signed_at")) and not bool(state.get("revoked_at"))
        consent_gate_checked = True
    except Exception as e:
        print(f"Warning: failed to compute hiring consent gate: {e}")
        consent_gate_checked = False

    consent_eligible = consent_gate_signed if consent_gate_checked else bool(marketplace_eligible)

    # Application completion: minimal required identity fields
    app_ok = False
    if isinstance(onboarding_data, dict):
        full_name = str(onboarding_data.get("fullName") or onboarding_data.get("full_name") or user.get("full_name") or user.get("name") or "").strip()
        email = str(onboarding_data.get("email") or user.get("email") or "").strip()
        phone = str(onboarding_data.get("phone") or user.get("phone") or "").strip()
        app_ok = bool(full_name and email and phone)

    items: List[Dict[str, Any]] = []
    completed = 0
    missing_keys: List[str] = []

    for req in required_defs:
        if not isinstance(req, dict):
            continue
        key = str(req.get("key") or "").strip().lower()
        if not key:
            continue

        title = req.get("title") or key
        desc = req.get("description") or ""
        kind = req.get("kind") or "document"
        upload_type = req.get("upload_document_type")

        doc = None
        expiry_date = None
        status_text = "Missing"
        action: Dict[str, Any] = {}

        if key == "application":
            if app_ok:
                status_text = "Complete"
                completed += 1
                action = {"type": "info", "label": "View Application"}
            else:
                status_text = "Missing"
                missing_keys.append(key)
                action = {"type": "info", "label": "Complete Application"}
        elif key == "consent":
            if consent_eligible:
                status_text = "Complete"
                completed += 1
                action = {"type": "navigate", "label": "View Consent", "nav": "esign"}
            else:
                status_text = "Missing"
                missing_keys.append(key)
                action = {"type": "navigate", "label": "Sign Consent Form", "nav": "esign"}
        else:
            doc = _find_doc_for_key(key)
            if doc:
                expiry_date = _doc_expiry(doc)
                if expiry_date:
                    try:
                        status_text = calculate_document_status(expiry_date)
                    except Exception:
                        status_text = "Complete"
                else:
                    status_text = "Complete"

                if status_text in {"Valid", "Expiring Soon", "Complete"}:
                    completed += 1
                else:
                    missing_keys.append(key)

                action = {"type": "view", "label": "View Document"}
            else:
                status_text = "Missing"
                missing_keys.append(key)
                action = {"type": "upload", "label": f"Upload {title}", "document_type": upload_type or key}

        actions_enabled = bool(consent_eligible) or key in {"consent", "application"}
        blocked_by_consent = (not consent_eligible and key not in {"consent", "application"})

        items.append({
            "key": key,
            "title": title,
            "description": desc,
            "kind": kind,
            "status": status_text,
            "expiry_date": expiry_date,
            "doc": {
                "doc_id": (doc or {}).get("doc_id"),
                "filename": (doc or {}).get("filename"),
                "download_url": (doc or {}).get("download_url"),
                "uploaded_at": (doc or {}).get("uploaded_at"),
                "submitted_type": (doc or {}).get("submitted_type"),
            } if doc else None,
            "actions_enabled": actions_enabled,
            "blocked_by_consent": blocked_by_consent,
            "action": action,
        })

    total_required = len(items)
    percent = int((completed / total_required) * 100) if total_required else 0

    # If enabled, generate compliance alert notifications that drive the in-app
    # Notifications UI. Best-effort and deduplicated (one per required key).
    try:
        compliance_alerts_on = _pref_enabled(user=user, uid=uid, key="compliance_alerts", default=True)
        if compliance_alerts_on:
            for it in items:
                k = str(it.get("key") or "").strip().lower()
                if not k:
                    continue
                status_text = str(it.get("status") or "").strip()

                if status_text in {"Missing", "Expired", "Expiring Soon"}:
                    title = f"Compliance Alert: {it.get('title') or k}"
                    msg = f"Status: {status_text}. Review and resolve in Hiring & Onboarding."
                    _upsert_compliance_notification(
                        uid=uid,
                        item_key=k,
                        title=title,
                        message=msg,
                        action_url="/driver-dashboard?nav=hiring",
                        status=status_text,
                    )
                else:
                    # If resolved, remove the corresponding active alert.
                    _clear_compliance_notification(uid=uid, item_key=k)
    except Exception as e:
        print(f"Warning: compliance notification generation failed: {e}")

    return {
        "required": items,
        "summary": {
            "total_required": total_required,
            "completed_required": completed,
            "percent": percent,
            "missing_keys": missing_keys,
        },
        "consent": {
            "eligible": bool(consent_eligible),
            "gate": {
                "key": consent_gate_key,
                "scope": consent_gate_scope,
                "carrier_id": consent_gate_carrier_id,
                "signed": bool(consent_gate_signed),
            },
            "marketplace_eligible": bool(marketplace_eligible),
            "missing_consents": missing_consents,
        },
        "driver": {
            "uid": uid,
        },
    }

