from __future__ import annotations

import asyncio
import json
import smtplib
import time
import uuid
from urllib.parse import urlencode
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from firebase_admin import firestore
from firebase_admin import auth as firebase_auth
from firebase_admin import messaging as fcm

from .auth import get_current_user, require_admin
from .database import db, log_action
from .settings import settings


router = APIRouter(prefix="/messaging", tags=["Messaging"])


# Best-effort cache to make thread list feel instant in dev.
# Keyed by uid, short TTL to avoid stale UI.
_THREADS_CACHE: Dict[str, Dict[str, Any]] = {}
_THREADS_CACHE_EXPIRES: Dict[str, float] = {}


def _threads_cache_get(uid: str) -> Optional[Dict[str, Any]]:
    exp = float(_THREADS_CACHE_EXPIRES.get(uid) or 0.0)
    if exp and exp > _now():
        return _THREADS_CACHE.get(uid)
    _THREADS_CACHE.pop(uid, None)
    _THREADS_CACHE_EXPIRES.pop(uid, None)
    return None


def _threads_cache_set(uid: str, value: Dict[str, Any], ttl_s: float = 5.0) -> None:
    _THREADS_CACHE[uid] = value
    _THREADS_CACHE_EXPIRES[uid] = _now() + float(ttl_s)


# -----------------------------
# Models
# -----------------------------

class SendMessageRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class CreateDirectThreadRequest(BaseModel):
    driver_id: str


class CreateShipperDirectThreadRequest(BaseModel):
    shipper_id: str


class CreateCarrierDirectThreadRequest(BaseModel):
    carrier_id: str


class CreateLoadTransitThreadRequest(BaseModel):
    load_id: str


class AdminCreateUserDirectThreadRequest(BaseModel):
    target_uid: str


class CreateGroupThreadRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    driver_ids: List[str] = Field(default_factory=list, min_length=1, max_length=50)


class RegisterDeviceTokenRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=4096)
    platform: Optional[str] = None  # web/android/ios


class AdminChannelMessageRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    target_role: str = Field(..., min_length=1, max_length=30)  # carrier/driver/shipper/broker/all
    title: Optional[str] = Field(default=None, max_length=80)


# -----------------------------
# Helpers
# -----------------------------

def _now() -> float:
    return time.time()


def _conversation_read_doc_id(thread_id: str, uid: str) -> str:
    return f"{thread_id}_{uid}"


def _channel_read_doc_id(channel_id: str, uid: str) -> str:
    return f"{channel_id}_{uid}"


def _normalize_uid(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="Missing id")
    return s


def _direct_thread_id(carrier_id: str, driver_id: str) -> str:
    return f"cd_{carrier_id}_{driver_id}"


def _shipper_carrier_thread_id(shipper_id: str, carrier_id: str) -> str:
    return f"sc_{shipper_id}_{carrier_id}"


def _admin_user_thread_id(admin_id: str, user_id: str) -> str:
    # One admin <-> one user per thread.
    return f"au_{admin_id}_{user_id}"


def _load_transit_thread_id(load_id: str) -> str:
    safe = str(load_id or "").strip().replace("/", "_")
    if not safe:
        raise HTTPException(status_code=400, detail="Missing load_id")
    return f"lt_{safe}"


def _get_load_doc(load_id: str) -> Dict[str, Any]:
    snap = db.collection("loads").document(str(load_id)).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Load not found")
    d = snap.to_dict() or {}
    d["id"] = snap.id
    return d


def _load_status(load: Dict[str, Any]) -> str:
    return str(load.get("status") or "").strip().lower()


def _load_assigned_driver_uid(load: Dict[str, Any]) -> str:
    return str(load.get("assigned_driver") or load.get("assigned_driver_id") or load.get("driver_id") or "").strip()


def _load_shipper_uid(load: Dict[str, Any]) -> Optional[str]:
    # Prefer explicit normalized ownership fields.
    if str(load.get("payer_role") or "").strip().lower() == "shipper":
        uid = str(load.get("payer_uid") or "").strip()
        if uid:
            return uid

    # Backward-compat: some docs include creator_role.
    if str(load.get("creator_role") or "").strip().lower() == "shipper":
        uid = str(load.get("created_by") or "").strip()
        if uid:
            return uid

    # Last resort (non-standard field)
    uid = str(load.get("shipper_id") or "").strip()
    return uid or None


def _invalidate_threads_cache(*uids: str) -> None:
    for uid in uids:
        if not uid:
            continue
        _THREADS_CACHE.pop(uid, None)
        _THREADS_CACHE_EXPIRES.pop(uid, None)


def _get_driver_doc(driver_id: str) -> Dict[str, Any]:
    snap = db.collection("drivers").document(driver_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Driver not found")
    return snap.to_dict() or {}


def _get_driver_identity(driver_id: str) -> Dict[str, Any]:
    """Return best-effort driver identity (name/photo) across drivers + users docs."""
    ddoc = _get_driver_doc(driver_id)
    # Many profiles store photo/name on users/{uid}; drivers/{uid} can be operational data only.
    udoc = _get_user_doc(driver_id)

    name = (
        ddoc.get("name")
        or ddoc.get("display_name")
        or udoc.get("display_name")
        or udoc.get("name")
        or udoc.get("email")
        or ddoc.get("email")
        or "Driver"
    )
    photo = (
        ddoc.get("profile_picture_url")
        or ddoc.get("photo_url")
        or ddoc.get("avatar_url")
        or _photo_url_for_user_doc(udoc)
    )
    return {"name": name, "photo_url": photo}


def _driver_carrier_id(driver_id: str) -> Optional[str]:
    d = _get_driver_doc(driver_id)
    return d.get("carrier_id")


def _ensure_carrier_owns_driver(carrier_id: str, driver_id: str) -> None:
    current = _driver_carrier_id(driver_id)
    if not current:
        raise HTTPException(status_code=403, detail="Driver is not hired by any carrier")
    if current != carrier_id:
        raise HTTPException(status_code=403, detail="Driver is hired by another carrier")


def _ensure_driver_has_carrier(driver_id: str) -> str:
    carrier_id = _driver_carrier_id(driver_id)
    if not carrier_id:
        raise HTTPException(status_code=403, detail="Driver is not linked to a carrier")
    return carrier_id


def _get_thread(thread_id: str) -> Dict[str, Any]:
    snap = db.collection("conversations").document(thread_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Thread not found")
    d = snap.to_dict() or {}
    d["id"] = snap.id
    return d


def _assert_member(user_id: str, thread: Dict[str, Any]) -> None:
    members = thread.get("member_uids") or []
    if user_id not in members:
        raise HTTPException(status_code=403, detail="Not a member of this thread")


def _assert_send_allowed(user: Dict[str, Any], thread: Dict[str, Any]) -> None:
    role = user.get("role")
    uid = user.get("uid")

    if thread.get("kind") not in {
        "carrier_driver_direct",
        "carrier_driver_group",
        "shipper_carrier_direct",
        "admin_user_direct",
        "load_transit_chat",
    }:
        raise HTTPException(status_code=400, detail="Unsupported thread type")

    _assert_member(uid, thread)

    # Admin <-> user direct messaging (platform support)
    if thread.get("kind") == "admin_user_direct":
        return

    # Load transit chat: driver <-> shipper, send allowed only while load is in transit.
    if thread.get("kind") == "load_transit_chat":
        if role not in {"driver", "shipper"}:
            raise HTTPException(status_code=403, detail="Messaging not enabled for this role")

        driver_id = str(thread.get("driver_id") or "").strip()
        shipper_id = str(thread.get("shipper_id") or "").strip()
        if role == "driver" and uid != driver_id:
            raise HTTPException(status_code=403, detail="Driver can only message within their load chats")
        if role == "shipper" and uid != shipper_id:
            raise HTTPException(status_code=403, detail="Shipper can only message within their load chats")

        load_id = str(thread.get("load_id") or "").strip()
        if not load_id:
            raise HTTPException(status_code=400, detail="Thread missing load_id")
        load = _get_load_doc(load_id)
        if _load_status(load) != "in_transit":
            raise HTTPException(status_code=403, detail="Chat is read-only after delivery")
        return

    carrier_id = thread.get("carrier_id")
    kind = thread.get("kind")
    if kind in {"carrier_driver_direct", "carrier_driver_group"}:
        if role == "driver":
            # Driver can only chat within threads owned by their carrier
            my_carrier = _ensure_driver_has_carrier(uid)
            if carrier_id != my_carrier:
                raise HTTPException(status_code=403, detail="Driver can only message their carrier")
        elif role == "carrier":
            # Carrier can only message hired drivers
            if carrier_id != uid:
                raise HTTPException(status_code=403, detail="Carrier can only message within their own threads")
        else:
            raise HTTPException(status_code=403, detail="Messaging not enabled for this role")
        return

    if kind == "shipper_carrier_direct":
        shipper_id = thread.get("shipper_id")
        if role == "shipper":
            if shipper_id != uid:
                raise HTTPException(status_code=403, detail="Shipper can only message within their own threads")
        elif role == "carrier":
            if carrier_id != uid:
                raise HTTPException(status_code=403, detail="Carrier can only message within their own threads")
        else:
            raise HTTPException(status_code=403, detail="Messaging not enabled for this role")
        return

    raise HTTPException(status_code=400, detail="Unsupported thread type")


def _get_user_doc(uid: str) -> Dict[str, Any]:
    snap = db.collection("users").document(uid).get()
    return snap.to_dict() or {}


def _display_name_for_user_doc(d: Dict[str, Any]) -> str:
    return (
        d.get("display_name")
        or d.get("name")
        or d.get("company_name")
        or d.get("email")
        or "User"
    )


def _photo_url_for_user_doc(d: Dict[str, Any]) -> Optional[str]:
    return d.get("profile_picture_url") or d.get("photo_url") or d.get("avatar_url")


def _email_for_uid(uid: str) -> Optional[str]:
    udoc = _get_user_doc(uid)
    email = (udoc.get("email") or "").strip()
    if email:
        return email
    # Drivers sometimes store email on drivers/{uid}
    try:
        ddoc = db.collection("drivers").document(uid).get()
        if ddoc.exists:
            d = ddoc.to_dict() or {}
            email2 = (d.get("email") or "").strip()
            if email2:
                return email2
    except Exception:
        pass
    return None


def _role_for_uid(uid: str) -> Optional[str]:
    """Best-effort role resolution for email deep links."""
    try:
        udoc = _get_user_doc(uid)
        role = (udoc.get("role") or "").strip().lower()
        if role:
            return role
    except Exception:
        pass

    # Fallback collections when users/{uid} is missing or incomplete
    try:
        ddoc = db.collection("drivers").document(uid).get()
        if ddoc.exists:
            return "driver"
    except Exception:
        pass

    try:
        sdoc = db.collection("shippers").document(uid).get()
        if sdoc.exists:
            return "shipper"
    except Exception:
        pass

    return None


def _sender_display_name(user: Dict[str, Any]) -> str:
    uid = user.get("uid")
    role = user.get("role")
    if not uid:
        return "User"
    try:
        if role == "driver":
            return _get_driver_identity(uid).get("name") or "Driver"
        udoc = _get_user_doc(uid)
        return _display_name_for_user_doc(udoc)
    except Exception:
        return user.get("display_name") or user.get("name") or user.get("email") or "User"


def _send_email(to_email: str, subject: str, body: str, is_html: bool = False) -> bool:
    """Send an email using SMTP. If SMTP is not configured, logs the email."""
    try:
        if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
            print(f"[DEV] Email would be sent to {to_email}")
            print(f"[DEV] Subject: {subject}")
            print(f"[DEV] Body: {body}")
            return True

        msg = MIMEMultipart()
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to_email
        msg["Subject"] = subject

        msg.attach(MIMEText(body, "html" if is_html else "plain"))

        server = smtplib.SMTP(settings.SMTP_SERVER, settings.SMTP_PORT)
        server.starttls()
        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Error sending email: {e}")
        return False


def _email_html_template(*, sender_name: str, thread_label: str, message_text: str, app_url: str) -> str:
    safe_sender = (sender_name or "Someone").strip() or "Someone"
    safe_thread = (thread_label or "Conversation").strip() or "Conversation"
    preview = (message_text or "").strip()
    if len(preview) > 600:
        preview = preview[:600].rstrip() + "…"

    # Minimal, email-client-friendly styling.
    return f"""
<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  </head>
  <body style=\"margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;\">
    <div style=\"max-width:640px;margin:0 auto;padding:24px;\">
      <div style=\"background:#ffffff;border:1px solid #e6e8f0;border-radius:14px;overflow:hidden;\">
        <div style=\"padding:18px 20px;background:linear-gradient(90deg,#0ea5e9,#6366f1);color:#fff;\">
          <div style=\"font-size:16px;font-weight:700;\">New message in FreightPower</div>
          <div style=\"font-size:13px;opacity:.92;margin-top:4px;\">From {safe_sender}</div>
        </div>
        <div style=\"padding:18px 20px;\">
          <div style=\"font-size:13px;color:#475569;margin-bottom:10px;\">Conversation</div>
          <div style=\"font-size:16px;font-weight:800;color:#0f172a;margin-bottom:14px;\">{safe_thread}</div>

          <div style=\"font-size:13px;color:#475569;margin-bottom:8px;\">Message preview</div>
          <div style=\"white-space:pre-wrap;line-height:1.45;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;color:#0f172a;\">{preview}</div>

          <div style=\"margin-top:18px;\">
            <a href=\"{app_url}\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;font-size:13px;\">Open Messaging</a>
          </div>

          <div style=\"margin-top:14px;font-size:12px;color:#64748b;\">You’re receiving this because you have an unread message. If you already read it, you can ignore this email.</div>
        </div>
      </div>
      <div style=\"text-align:center;font-size:11px;color:#94a3b8;margin-top:14px;\">© FreightPower</div>
    </div>
  </body>
</html>
"""


def _notification_doc_id(message_id: str, recipient_uid: str) -> str:
    return f"{message_id}_{recipient_uid}"


def _messages_notifications_enabled_for_uid(uid: str) -> bool:
    """Return whether this user wants message notifications.

    Defaults to True when unset to preserve legacy behavior.
    """

    try:
        snap = db.collection("users").document(str(uid)).get()
        if not getattr(snap, "exists", False):
            return True
        d = snap.to_dict() or {}
        prefs = d.get("notification_preferences")
        if not isinstance(prefs, dict):
            return True
        if "messages" not in prefs:
            return True
        return bool(prefs.get("messages"))
    except Exception:
        # Best-effort; never break messaging due to a settings read.
        return True


def queue_delayed_message_emails(
    *,
    thread_id: str,
    message_id: str,
    message_created_at: float,
    sender_uid: str,
    sender_role: str,
    sender_name: str,
    thread_label: str,
    message_text: str,
    recipient_uids: List[str],
):
    """Persist notification intents. A scheduler job will deliver later if still unread."""

    if not getattr(settings, "ENABLE_MESSAGE_EMAIL_NOTIFICATIONS", False):
        return

    delay_s = int(getattr(settings, "MESSAGE_EMAIL_DELAY_SECONDS", 300) or 300)
    send_after = float(message_created_at) + float(max(30, delay_s))

    for to_uid in recipient_uids:
        if not to_uid or to_uid == sender_uid:
            continue

        # Respect the driver's Messages toggle (or any role's preference).
        if not _messages_notifications_enabled_for_uid(str(to_uid)):
            continue

        doc_id = _notification_doc_id(message_id, to_uid)
        ref = db.collection("message_email_notifications").document(doc_id)
        payload = {
            "id": doc_id,
            "status": "pending",
            "thread_id": thread_id,
            "message_id": message_id,
            "message_created_at": float(message_created_at),
            "send_after": float(send_after),
            "recipient_uid": to_uid,
            "sender_uid": sender_uid,
            "sender_role": sender_role,
            "sender_name": sender_name,
            "thread_label": thread_label,
            "message_preview": (message_text or "")[:1200],
            "attempts": 0,
            "created_at": _now(),
            "updated_at": _now(),
        }
        # Upsert is fine; doc_id is deterministic (idempotent).
        ref.set(payload, merge=True)


def process_pending_message_email_notifications_job(max_batch: int = 30):
    """Scheduled job: send email if message still unread after delay.

    Runs in APScheduler thread, so keep it synchronous.
    """
    if not getattr(settings, "ENABLE_MESSAGE_EMAIL_NOTIFICATIONS", False):
        return

    now = _now()
    far_future = now + (60 * 60 * 24 * 365 * 10)
    # Query only on the time field to avoid requiring a composite index.
    q = (
        db.collection("message_email_notifications")
        .where("send_after", "<=", float(now))
        .order_by("send_after")
        .limit(int(max_batch or 30))
    )

    try:
        snaps = list(q.stream())
    except Exception as e:
        print(f"Email notification job query error: {e}")
        return

    for snap in snaps:
        ref = snap.reference
        d = snap.to_dict() or {}
        status = (d.get("status") or "").strip().lower()
        if status != "pending":
            continue

        thread_id = d.get("thread_id")
        recipient_uid = d.get("recipient_uid")
        msg_created_at = float(d.get("message_created_at") or 0.0)
        if not thread_id or not recipient_uid or not msg_created_at:
            ref.update({"status": "invalid", "send_after": float(far_future), "updated_at": _now()})
            continue

        # Respect the user's Messages toggle at send-time as well.
        try:
            if not _messages_notifications_enabled_for_uid(str(recipient_uid)):
                ref.update(
                    {
                        "status": "cancelled",
                        "cancelled_at": _now(),
                        "send_after": float(far_future),
                        "updated_at": _now(),
                    }
                )
                continue
        except Exception:
            # If we can't verify prefs, err on the side of not spamming.
            ref.update({"status": "pending", "send_after": float(_now() + 120), "updated_at": _now()})
            continue

        # Check unread status using persistent read receipts.
        try:
            read_doc = db.collection("conversation_reads").document(_conversation_read_doc_id(thread_id, recipient_uid)).get()
            last_read_at = float((read_doc.to_dict() or {}).get("last_read_at") or 0.0) if read_doc.exists else 0.0
            if last_read_at and last_read_at >= msg_created_at:
                ref.update(
                    {
                        "status": "cancelled",
                        "cancelled_at": _now(),
                        "send_after": float(far_future),
                        "updated_at": _now(),
                    }
                )
                continue
        except Exception:
            # If we can't verify read state, don't send.
            ref.update({"status": "pending", "send_after": float(_now() + 60), "updated_at": _now()})
            continue

        # Determine recipient email.
        email = None
        try:
            email = _email_for_uid(recipient_uid)
        except Exception:
            email = None

        if not email:
            ref.update({"status": "no_email", "send_after": float(far_future), "updated_at": _now()})
            continue

        sender_name = d.get("sender_name") or "Someone"
        thread_label = d.get("thread_label") or "Conversation"
        preview = d.get("message_preview") or ""

        subject = f"New message from {sender_name}"

        # Role-aware deep link into dashboard -> Messaging, carrying the thread id.
        base = getattr(settings, "FRONTEND_BASE_URL", "") or ""
        role = _role_for_uid(recipient_uid) or ""
        role_dash = {
            "carrier": "/carrier-dashboard",
            "driver": "/driver-dashboard",
            "shipper": "/shipper-dashboard",
            "admin": "/admin/dashboard",
            "super_admin": "/super-admin/dashboard",
        }.get(role, "/login")

        # fresh=1 forces a re-login even if the browser is already signed in as another role/user.
        qp = urlencode({"nav": "messaging", "thread": thread_id, "fresh": "1"})
        app_url = (base.rstrip("/") + role_dash + ("?" + qp if qp else "")) if base else ""
        html = _email_html_template(sender_name=sender_name, thread_label=thread_label, message_text=preview, app_url=app_url or "")

        attempts = int(d.get("attempts") or 0)
        try:
            ref.update(
                {
                    "status": "sending",
                    "attempts": attempts + 1,
                    "send_after": float(_now() + 600),
                    "updated_at": _now(),
                }
            )
        except Exception:
            # Another worker might have taken it.
            continue

        ok = _send_email(email, subject, html, True)
        if ok:
            ref.update({"status": "sent", "sent_at": _now(), "send_after": float(far_future), "updated_at": _now()})
        else:
            # Put back to pending for a limited number of retries.
            if attempts + 1 >= 3:
                ref.update({"status": "failed", "send_after": float(far_future), "updated_at": _now()})
            else:
                ref.update({"status": "pending", "send_after": float(_now() + 120), "updated_at": _now()})


def _ensure_shipper_carrier_relationship(shipper_id: str, carrier_id: str) -> None:
    q = (
        db.collection("shipper_carrier_relationships")
        .where("shipper_id", "==", shipper_id)
        .where("carrier_id", "==", carrier_id)
        .where("status", "==", "active")
        .limit(1)
    )
    if not list(q.stream()):
        raise HTTPException(status_code=403, detail="Shipper and carrier are not linked")


def _thread_view_for_user(user: Dict[str, Any], thread: Dict[str, Any]) -> Dict[str, Any]:
    """Return a viewer-specific thread payload (name/avatar are the other party)."""
    uid = user.get("uid")
    role = user.get("role")
    t = dict(thread or {})
    kind = t.get("kind")

    if kind == "carrier_driver_direct":
        other_id = None
        driver_ids = t.get("driver_ids") or []
        if role == "carrier":
            other_id = driver_ids[0] if driver_ids else None
            other_role = "driver"
        else:
            other_id = t.get("carrier_id")
            other_role = "carrier"

        if other_id:
            if other_role == "driver":
                ident = _get_driver_identity(other_id)
                t["other_display_name"] = ident.get("name")
                t["other_photo_url"] = ident.get("photo_url")
            else:
                udoc = _get_user_doc(other_id)
                t["other_display_name"] = _display_name_for_user_doc(udoc)
                t["other_photo_url"] = _photo_url_for_user_doc(udoc)

        # Preserve legacy title, but prefer viewer-safe label
        t["display_title"] = t.get("other_display_name") or t.get("title")
        return t

    if kind == "shipper_carrier_direct":
        shipper_id = t.get("shipper_id")
        carrier_id = t.get("carrier_id")
        if uid == shipper_id:
            other_id = carrier_id
            other_role = "carrier"
        else:
            other_id = shipper_id
            other_role = "shipper"

        if other_id:
            udoc = _get_user_doc(other_id)
            t["other_display_name"] = _display_name_for_user_doc(udoc)
            t["other_photo_url"] = _photo_url_for_user_doc(udoc)
        t["display_title"] = t.get("other_display_name") or t.get("title")
        return t

    if kind == "load_transit_chat":
        driver_id = str(t.get("driver_id") or "").strip()
        shipper_id = str(t.get("shipper_id") or "").strip()
        load_id = str(t.get("load_id") or "").strip()

        # Best-effort computed state; used to disable composer UI.
        try:
            load = _get_load_doc(load_id) if load_id else {}
            t["is_read_only"] = _load_status(load) != "in_transit"
        except Exception:
            t["is_read_only"] = False

        if uid == driver_id:
            other_id = shipper_id
            udoc = _get_user_doc(other_id) if other_id else {}
            t["other_display_name"] = _display_name_for_user_doc(udoc) if other_id else None
            t["other_photo_url"] = _photo_url_for_user_doc(udoc) if other_id else None
        elif uid == shipper_id:
            other_id = driver_id
            if other_id:
                ident = _get_driver_identity(other_id)
                t["other_display_name"] = ident.get("name")
                t["other_photo_url"] = ident.get("photo_url")

        t["display_title"] = t.get("other_display_name") or t.get("title") or "Load Chat"
        return t

    # group threads: keep title as-is
    t["display_title"] = t.get("title")
    return t


def _ensure_admin_channel(channel_id: str, target_role: str) -> Dict[str, Any]:
    ref = db.collection("admin_channels").document(channel_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = channel_id
        return d

    now = _now()
    d = {
        "id": channel_id,
        "target_role": target_role,
        "name": f"{target_role.title()} Notifications" if target_role != "all" else "All Users",
        "created_at": now,
        "updated_at": now,
    }
    ref.set(d)
    return d


async def _fs_to_thread(fn, timeout_s: float = 6.0):
    """Run a blocking Firestore call in a thread with a soft timeout.

    This prevents one slow network call from stalling the whole ASGI event loop.
    """
    return await asyncio.wait_for(asyncio.to_thread(fn), timeout=timeout_s)


async def _get_admin_channel_readonly(channel_id: str, target_role: str) -> Dict[str, Any]:
    """Read admin channel metadata without creating/writing documents."""
    ref = db.collection("admin_channels").document(channel_id)
    try:
        snap = await _fs_to_thread(ref.get)
        if snap.exists:
            d = snap.to_dict() or {}
            d["id"] = channel_id
            return d
    except Exception:
        # Fall back to a minimal response below.
        pass

    return {
        "id": channel_id,
        "target_role": target_role,
        "name": f"{target_role.title()} Notifications" if target_role != "all" else "All Users",
        "created_at": 0.0,
        "updated_at": 0.0,
    }


def _send_push(tokens: List[str], title: str, body: str) -> Dict[str, Any]:
    # Web push via FCM requires frontend registration/VAPID; we attempt send and report.
    if not tokens:
        return {"attempted": 0, "success": 0, "failure": 0}

    # FCM limit: 500 tokens per call
    attempted = 0
    success = 0
    failure = 0

    for i in range(0, len(tokens), 500):
        chunk = tokens[i : i + 500]
        attempted += len(chunk)
        message = fcm.MulticastMessage(
            tokens=chunk,
            notification=fcm.Notification(title=title, body=body),
            data={"type": "admin_broadcast"},
        )
        resp = fcm.send_multicast(message)
        success += resp.success_count
        failure += resp.failure_count

    return {"attempted": attempted, "success": success, "failure": failure}


async def _get_user_from_query_token(token: str) -> Dict[str, Any]:
    token = str(token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        decoded = firebase_auth.verify_id_token(token)
        uid = decoded.get("uid")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_doc = db.collection("users").document(uid).get()
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="User profile not found")
        user_data = user_doc.to_dict() or {}
        if not user_data.get("uid"):
            user_data["uid"] = uid
        # Mirror existing auth behavior: enforce verified flag.
        if not user_data.get("is_verified", False):
            raise HTTPException(status_code=403, detail="Account not verified")
        return user_data
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# -----------------------------
# Carrier / Driver messaging
# -----------------------------

@router.get("/threads")
async def list_threads(limit: int = 200, user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    role = user.get("role")
    if role not in {"carrier", "driver", "shipper", "admin", "super_admin"}:
        return {"threads": []}

    limit = max(1, min(int(limit or 200), 500))

    # If Firestore is slow, return a short-lived cached list to keep the UI usable.
    cached = _threads_cache_get(uid)

    # Prefer a server-side order_by for performance. If an index is missing, fall back.
    # Firestore SDK calls are blocking; run them off the event loop with timeouts.
    try:
        q = (
            db.collection("conversations")
            .where("member_uids", "array_contains", uid)
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
        )
        snaps = await _fs_to_thread(lambda: list(q.stream()), timeout_s=10.0)
    except Exception:
        try:
            q = db.collection("conversations").where("member_uids", "array_contains", uid).limit(limit)
            snaps = await _fs_to_thread(lambda: list(q.stream()), timeout_s=10.0)
        except Exception:
            return cached or {"threads": []}

    raw: List[Dict[str, Any]] = []
    for snap in snaps:
        d = snap.to_dict() or {}
        d["id"] = snap.id
        raw.append(d)

    # Batch-load identities to avoid N+1 Firestore reads.
    driver_ids: List[str] = []
    user_ids: List[str] = []
    load_ids: List[str] = []
    for t in raw:
        kind = t.get("kind")
        if kind == "carrier_driver_direct":
            if role == "carrier":
                dids = t.get("driver_ids") or []
                other_id = dids[0] if dids else None
                if other_id:
                    driver_ids.append(other_id)
            else:
                other_id = t.get("carrier_id")
                if other_id:
                    user_ids.append(other_id)
        elif kind == "shipper_carrier_direct":
            shipper_id = t.get("shipper_id")
            carrier_id = t.get("carrier_id")
            other_id = carrier_id if uid == shipper_id else shipper_id
            if other_id:
                user_ids.append(other_id)
        elif kind == "admin_user_direct":
            members = t.get("member_uids") or []
            other_id = None
            for m in members:
                if m and m != uid:
                    other_id = m
                    break
            other_id = other_id or t.get("user_id")
            if other_id:
                user_ids.append(other_id)

        elif kind == "load_transit_chat":
            lid = str(t.get("load_id") or "").strip()
            if lid:
                load_ids.append(lid)

            driver_id = str(t.get("driver_id") or "").strip()
            shipper_id = str(t.get("shipper_id") or "").strip()
            if role == "shipper":
                if driver_id:
                    driver_ids.append(driver_id)
            else:
                if shipper_id:
                    user_ids.append(shipper_id)

    driver_ids = list({x for x in driver_ids if x})
    # Drivers also often store name/photo in users/{uid}
    user_ids = list({x for x in (user_ids + driver_ids) if x})

    driver_docs: Dict[str, Dict[str, Any]] = {}
    user_docs: Dict[str, Dict[str, Any]] = {}
    if driver_ids:
        try:
            driver_refs = [db.collection("drivers").document(did) for did in driver_ids]
            driver_docs = await _fs_to_thread(
                lambda: {s.id: (s.to_dict() or {}) for s in db.get_all(driver_refs) if s.exists},
                timeout_s=10.0,
            )
        except Exception:
            driver_docs = {}
    if user_ids:
        try:
            user_refs = [db.collection("users").document(uid2) for uid2 in user_ids]
            user_docs = await _fs_to_thread(
                lambda: {s.id: (s.to_dict() or {}) for s in db.get_all(user_refs) if s.exists},
                timeout_s=10.0,
            )
        except Exception:
            user_docs = {}

    load_docs: Dict[str, Dict[str, Any]] = {}
    if load_ids:
        load_ids = list({x for x in load_ids if x})
        try:
            load_refs = [db.collection("loads").document(lid) for lid in load_ids]
            load_docs = await _fs_to_thread(
                lambda: {s.id: (s.to_dict() or {}) for s in db.get_all(load_refs) if s.exists},
                timeout_s=10.0,
            )
        except Exception:
            load_docs = {}

    def _identity_for_driver(did: str) -> Dict[str, Any]:
        ddoc = driver_docs.get(did) or {}
        udoc = user_docs.get(did) or {}
        name = (
            ddoc.get("name")
            or ddoc.get("display_name")
            or udoc.get("display_name")
            or udoc.get("name")
            or udoc.get("email")
            or ddoc.get("email")
            or "Driver"
        )
        photo = (
            ddoc.get("profile_picture_url")
            or ddoc.get("photo_url")
            or ddoc.get("avatar_url")
            or _photo_url_for_user_doc(udoc)
        )
        return {"name": name, "photo_url": photo}

    threads: List[Dict[str, Any]] = []
    for t0 in raw:
        t = dict(t0)
        kind = t.get("kind")

        if kind == "carrier_driver_direct":
            dids = t.get("driver_ids") or []
            if role == "carrier":
                other_id = dids[0] if dids else None
                if other_id:
                    ident = _identity_for_driver(other_id)
                    t["other_display_name"] = ident.get("name")
                    t["other_photo_url"] = ident.get("photo_url")
            else:
                other_id = t.get("carrier_id")
                if other_id:
                    udoc = user_docs.get(other_id) or {}
                    t["other_display_name"] = _display_name_for_user_doc(udoc)
                    t["other_photo_url"] = _photo_url_for_user_doc(udoc)

            t["display_title"] = t.get("other_display_name") or t.get("title")
            threads.append(t)
            continue

        if kind == "shipper_carrier_direct":
            shipper_id = t.get("shipper_id")
            carrier_id = t.get("carrier_id")
            other_id = carrier_id if uid == shipper_id else shipper_id
            if other_id:
                udoc = user_docs.get(other_id) or {}
                t["other_display_name"] = _display_name_for_user_doc(udoc)
                t["other_photo_url"] = _photo_url_for_user_doc(udoc)
            t["display_title"] = t.get("other_display_name") or t.get("title")
            threads.append(t)
            continue

        if kind == "admin_user_direct":
            members = t.get("member_uids") or []
            other_id = None
            for m in members:
                if m and m != uid:
                    other_id = m
                    break
            other_id = other_id or t.get("user_id")
            if other_id:
                udoc = user_docs.get(other_id) or {}
                t["other_display_name"] = _display_name_for_user_doc(udoc)
                t["other_photo_url"] = _photo_url_for_user_doc(udoc)
            t["display_title"] = t.get("other_display_name") or t.get("title") or "Conversation"
            threads.append(t)
            continue

        if kind == "load_transit_chat":
            driver_id = str(t.get("driver_id") or "").strip()
            shipper_id = str(t.get("shipper_id") or "").strip()
            load_id = str(t.get("load_id") or "").strip()
            status = str((load_docs.get(load_id) or {}).get("status") or "").strip().lower()
            t["is_read_only"] = status != "in_transit" if status else False

            if uid == shipper_id:
                other_id = driver_id
                if other_id:
                    ident = _identity_for_driver(other_id)
                    t["other_display_name"] = ident.get("name")
                    t["other_photo_url"] = ident.get("photo_url")
            else:
                other_id = shipper_id
                if other_id:
                    udoc = user_docs.get(other_id) or {}
                    t["other_display_name"] = _display_name_for_user_doc(udoc)
                    t["other_photo_url"] = _photo_url_for_user_doc(udoc)

            t["display_title"] = t.get("other_display_name") or t.get("title") or "Load Chat"
            threads.append(t)
            continue

        # Group threads: keep title as-is
        t["display_title"] = t.get("title")
        threads.append(t)

    threads.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
    out = {"threads": threads}
    _threads_cache_set(uid, out, ttl_s=5.0)
    return out


@router.get("/unread/summary")
async def unread_summary(user: Dict[str, Any] = Depends(get_current_user)):
    """Return unread state for messaging threads + admin notification channels.

    This is used for:
    - dashboard nav badge (total_unread)
    - per-chat unread markers (threads[channel_id].has_unread)
    """
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    role = user.get("role")
    if role not in {"carrier", "driver", "shipper", "admin", "super_admin"}:
        return {"total_unread": 0, "threads": {}, "channels": {}}

    # Threads (membership-based). Use an ordered+limited query to avoid scanning huge sets.
    try:
        thread_snaps = list(
            db.collection("conversations")
            .where("member_uids", "array_contains", uid)
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(500)
            .stream()
        )
    except Exception:
        thread_snaps = list(
            db.collection("conversations")
            .where("member_uids", "array_contains", uid)
            .limit(500)
            .stream()
        )
    read_refs = [db.collection("conversation_reads").document(_conversation_read_doc_id(s.id, uid)) for s in thread_snaps]
    read_docs = {d.id: (d.to_dict() or {}) for d in db.get_all(read_refs)} if read_refs else {}

    threads_out: Dict[str, Dict[str, Any]] = {}
    unread_threads = 0
    for snap in thread_snaps:
        t = snap.to_dict() or {}
        thread_id = snap.id

        last_at = float(t.get("last_message_at") or 0.0)
        last_sender = (t.get("last_message") or {}).get("sender_id")
        read_id = _conversation_read_doc_id(thread_id, uid)
        last_read_at = float((read_docs.get(read_id) or {}).get("last_read_at") or 0.0)

        has_unread = bool(last_at and last_at > last_read_at and last_sender and last_sender != uid)
        if has_unread:
            unread_threads += 1
        threads_out[thread_id] = {"has_unread": has_unread, "last_message_at": last_at, "last_read_at": last_read_at}

    # Admin channels (role-based)
    channel_ids = ["all", role]
    channel_read_refs = [db.collection("admin_channel_reads").document(_channel_read_doc_id(cid, uid)) for cid in channel_ids]
    channel_read_docs = {d.id: (d.to_dict() or {}) for d in db.get_all(channel_read_refs)} if channel_read_refs else {}

    channels_out: Dict[str, Dict[str, Any]] = {}
    unread_channels = 0
    for cid in channel_ids:
        # Use cached metadata when present; fall back to querying last message.
        ch = db.collection("admin_channels").document(cid).get()
        chd = ch.to_dict() or {}
        last_at = float(chd.get("last_message_at") or 0.0)
        if not last_at:
            q = (
                db.collection("admin_channels")
                .document(cid)
                .collection("messages")
                .order_by("created_at", direction=firestore.Query.DESCENDING)
                .limit(1)
            )
            for ms in q.stream():
                md = ms.to_dict() or {}
                last_at = float(md.get("created_at") or 0.0)

        read_id = _channel_read_doc_id(cid, uid)
        last_read_at = float((channel_read_docs.get(read_id) or {}).get("last_read_at") or 0.0)
        has_unread = bool(last_at and last_at > last_read_at)
        if has_unread:
            unread_channels += 1
        channels_out[cid] = {"has_unread": has_unread, "last_message_at": last_at, "last_read_at": last_read_at}

    return {
        "total_unread": int(unread_threads + unread_channels),
        "threads": threads_out,
        "channels": channels_out,
    }


@router.post("/threads/{thread_id}/read")
async def mark_thread_read(thread_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    thread = _get_thread(thread_id)
    _assert_member(uid, thread)

    now = _now()
    db.collection("conversation_reads").document(_conversation_read_doc_id(thread_id, uid)).set(
        {
            "thread_id": thread_id,
            "uid": uid,
            "last_read_at": now,
            "updated_at": now,
        },
        merge=True,
    )
    return {"ok": True, "thread_id": thread_id, "last_read_at": now}


@router.get("/carrier/drivers")
async def list_carrier_drivers(user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if user.get("role") != "carrier":
        raise HTTPException(status_code=403, detail="Carrier access required")

    rows: List[Dict[str, Any]] = []
    q = db.collection("drivers").where("carrier_id", "==", uid)
    for snap in q.stream():
        d = snap.to_dict() or {}
        driver_id = snap.id
        d["id"] = driver_id
        try:
            ident = _get_driver_identity(driver_id)
            d.setdefault("name", ident.get("name"))
            d["profile_picture_url"] = ident.get("photo_url")
        except Exception:
            # Keep minimal driver record if profile lookup fails
            pass
        rows.append(d)

    rows.sort(key=lambda x: (x.get("name") or "").lower())
    return {"drivers": rows}


@router.post("/carrier/threads/direct")
async def create_or_get_direct_thread(
    payload: CreateDirectThreadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if user.get("role") != "carrier":
        raise HTTPException(status_code=403, detail="Carrier access required")

    carrier_id = user.get("uid")
    driver_id = _normalize_uid(payload.driver_id)
    _ensure_carrier_owns_driver(carrier_id, driver_id)

    thread_id = _direct_thread_id(carrier_id, driver_id)
    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()

    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = thread_id
        return {"thread": _thread_view_for_user(user, d)}

    now = _now()
    driver_doc = _get_driver_doc(driver_id)
    title = driver_doc.get("name") or "Driver"

    data = {
        "id": thread_id,
        "kind": "carrier_driver_direct",
        "title": title,
        "carrier_id": carrier_id,
        "driver_ids": [driver_id],
        "member_uids": [carrier_id, driver_id],
        "created_by": carrier_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    log_action(carrier_id, "THREAD_CREATED", f"Direct thread created with driver {driver_id}")
    return {"thread": _thread_view_for_user(user, data)}


@router.post("/driver/threads/my-carrier")
async def create_or_get_driver_carrier_thread(user: Dict[str, Any] = Depends(get_current_user)):
    if user.get("role") != "driver":
        raise HTTPException(status_code=403, detail="Driver access required")

    driver_id = user.get("uid")
    carrier_id = _ensure_driver_has_carrier(driver_id)
    thread_id = _direct_thread_id(carrier_id, driver_id)

    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = thread_id
        return {"thread": _thread_view_for_user(user, d)}

    now = _now()
    carrier_doc = db.collection("users").document(carrier_id).get().to_dict() or {}
    title = carrier_doc.get("company_name") or carrier_doc.get("name") or "Carrier"

    data = {
        "id": thread_id,
        "kind": "carrier_driver_direct",
        "title": title,
        "carrier_id": carrier_id,
        "driver_ids": [driver_id],
        "member_uids": [carrier_id, driver_id],
        "created_by": driver_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    log_action(driver_id, "THREAD_CREATED", f"Direct thread created with carrier {carrier_id}")
    return {"thread": _thread_view_for_user(user, data)}


@router.post("/driver/threads/load-transit")
async def create_or_get_load_transit_thread_as_driver(
    payload: CreateLoadTransitThreadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if user.get("role") != "driver":
        raise HTTPException(status_code=403, detail="Driver access required")

    driver_id = user.get("uid")
    load_id = _normalize_uid(payload.load_id)
    load = _get_load_doc(load_id)

    assigned_driver = _load_assigned_driver_uid(load)
    if not assigned_driver or assigned_driver != str(driver_id or "").strip():
        raise HTTPException(status_code=403, detail="Driver is not assigned to this load")

    shipper_id = _load_shipper_uid(load)
    if not shipper_id:
        raise HTTPException(status_code=400, detail="Load has no shipper owner")

    thread_id = _load_transit_thread_id(load_id)
    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = thread_id
        return {"thread": _thread_view_for_user(user, d)}

    if _load_status(load) != "in_transit":
        raise HTTPException(status_code=403, detail="Chat is available only while load is in transit")

    now = _now()
    title = str(load.get("load_number") or load_id).strip() or "Load Chat"
    data = {
        "id": thread_id,
        "kind": "load_transit_chat",
        "title": title,
        "load_id": load_id,
        "driver_id": driver_id,
        "shipper_id": shipper_id,
        "member_uids": [driver_id, shipper_id],
        "created_by": driver_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    _invalidate_threads_cache(driver_id, shipper_id)
    log_action(driver_id, "THREAD_CREATED", f"Load transit thread created for load {load_id}")
    return {"thread": _thread_view_for_user(user, data)}


@router.post("/shipper/threads/load-transit")
async def create_or_get_load_transit_thread_as_shipper(
    payload: CreateLoadTransitThreadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if user.get("role") != "shipper":
        raise HTTPException(status_code=403, detail="Shipper access required")

    shipper_id = user.get("uid")
    load_id = _normalize_uid(payload.load_id)
    load = _get_load_doc(load_id)

    owner_shipper = _load_shipper_uid(load)
    if not owner_shipper or owner_shipper != str(shipper_id or "").strip():
        raise HTTPException(status_code=403, detail="Shipper does not own this load")

    driver_id = _load_assigned_driver_uid(load)
    if not driver_id:
        raise HTTPException(status_code=403, detail="Load has no assigned driver")

    thread_id = _load_transit_thread_id(load_id)
    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = thread_id
        return {"thread": _thread_view_for_user(user, d)}

    if _load_status(load) != "in_transit":
        raise HTTPException(status_code=403, detail="Chat is available only while load is in transit")

    now = _now()
    title = str(load.get("load_number") or load_id).strip() or "Load Chat"
    data = {
        "id": thread_id,
        "kind": "load_transit_chat",
        "title": title,
        "load_id": load_id,
        "driver_id": driver_id,
        "shipper_id": shipper_id,
        "member_uids": [driver_id, shipper_id],
        "created_by": shipper_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    _invalidate_threads_cache(driver_id, shipper_id)
    log_action(shipper_id, "THREAD_CREATED", f"Load transit thread created for load {load_id}")
    return {"thread": _thread_view_for_user(user, data)}


# -----------------------------
# Shipper / Carrier messaging
# -----------------------------


@router.get("/carrier/shippers")
async def list_carrier_shippers(user: Dict[str, Any] = Depends(get_current_user)):
    if user.get("role") != "carrier":
        raise HTTPException(status_code=403, detail="Carrier access required")

    carrier_id = user.get("uid")
    q = (
        db.collection("shipper_carrier_relationships")
        .where("carrier_id", "==", carrier_id)
        .where("status", "==", "active")
    )

    shippers: Dict[str, Dict[str, Any]] = {}
    for snap in q.stream():
        rel = snap.to_dict() or {}
        shipper_id = rel.get("shipper_id")
        if not shipper_id:
            continue
        udoc = _get_user_doc(shipper_id)
        shippers[shipper_id] = {
            "id": shipper_id,
            "name": _display_name_for_user_doc(udoc),
            "profile_picture_url": _photo_url_for_user_doc(udoc),
            "email": udoc.get("email"),
            "company_name": udoc.get("company_name"),
        }

    rows = list(shippers.values())
    rows.sort(key=lambda x: (x.get("name") or "").lower())
    return {"shippers": rows}


@router.get("/shipper/carriers")
async def list_shipper_carriers(user: Dict[str, Any] = Depends(get_current_user)):
    if user.get("role") != "shipper":
        raise HTTPException(status_code=403, detail="Shipper access required")

    shipper_id = user.get("uid")
    q = (
        db.collection("shipper_carrier_relationships")
        .where("shipper_id", "==", shipper_id)
        .where("status", "==", "active")
    )

    carriers: Dict[str, Dict[str, Any]] = {}
    for snap in q.stream():
        rel = snap.to_dict() or {}
        carrier_id = rel.get("carrier_id")
        if not carrier_id:
            continue
        udoc = _get_user_doc(carrier_id)
        carriers[carrier_id] = {
            "id": carrier_id,
            "name": _display_name_for_user_doc(udoc),
            "profile_picture_url": _photo_url_for_user_doc(udoc),
            "email": udoc.get("email"),
            "company_name": udoc.get("company_name"),
        }

    rows = list(carriers.values())
    rows.sort(key=lambda x: (x.get("name") or "").lower())
    return {"carriers": rows}


@router.post("/carrier/threads/shipper-direct")
async def create_or_get_shipper_direct_thread_as_carrier(
    payload: CreateShipperDirectThreadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if user.get("role") != "carrier":
        raise HTTPException(status_code=403, detail="Carrier access required")

    carrier_id = user.get("uid")
    shipper_id = _normalize_uid(payload.shipper_id)
    _ensure_shipper_carrier_relationship(shipper_id, carrier_id)

    thread_id = _shipper_carrier_thread_id(shipper_id, carrier_id)
    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = thread_id
        return {"thread": _thread_view_for_user(user, d)}

    now = _now()
    shipper_doc = _get_user_doc(shipper_id)
    title = _display_name_for_user_doc(shipper_doc)
    data = {
        "id": thread_id,
        "kind": "shipper_carrier_direct",
        "title": title,
        "shipper_id": shipper_id,
        "carrier_id": carrier_id,
        "member_uids": [shipper_id, carrier_id],
        "created_by": carrier_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    log_action(carrier_id, "THREAD_CREATED", f"Direct thread created with shipper {shipper_id}")
    return {"thread": _thread_view_for_user(user, data)}


@router.post("/shipper/threads/direct")
async def create_or_get_carrier_direct_thread_as_shipper(
    payload: CreateCarrierDirectThreadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if user.get("role") != "shipper":
        raise HTTPException(status_code=403, detail="Shipper access required")

    shipper_id = user.get("uid")
    carrier_id = _normalize_uid(payload.carrier_id)
    _ensure_shipper_carrier_relationship(shipper_id, carrier_id)

    thread_id = _shipper_carrier_thread_id(shipper_id, carrier_id)
    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = thread_id
        return {"thread": _thread_view_for_user(user, d)}

    now = _now()
    carrier_doc = _get_user_doc(carrier_id)
    title = _display_name_for_user_doc(carrier_doc)
    data = {
        "id": thread_id,
        "kind": "shipper_carrier_direct",
        "title": title,
        "shipper_id": shipper_id,
        "carrier_id": carrier_id,
        "member_uids": [shipper_id, carrier_id],
        "created_by": shipper_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    log_action(shipper_id, "THREAD_CREATED", f"Direct thread created with carrier {carrier_id}")
    return {"thread": _thread_view_for_user(user, data)}


@router.post("/carrier/threads/group")
async def create_group_thread(
    payload: CreateGroupThreadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if user.get("role") != "carrier":
        raise HTTPException(status_code=403, detail="Carrier access required")

    carrier_id = user.get("uid")
    driver_ids = [_normalize_uid(x) for x in payload.driver_ids]
    # Ensure all drivers belong to this carrier
    for driver_id in driver_ids:
        _ensure_carrier_owns_driver(carrier_id, driver_id)

    thread_id = f"cg_{uuid.uuid4().hex}"
    now = _now()

    data = {
        "id": thread_id,
        "kind": "carrier_driver_group",
        "title": payload.title,
        "carrier_id": carrier_id,
        "driver_ids": driver_ids,
        "member_uids": [carrier_id, *driver_ids],
        "created_by": carrier_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }

    db.collection("conversations").document(thread_id).set(data)
    log_action(carrier_id, "THREAD_CREATED", f"Group thread created with {len(driver_ids)} drivers")
    return {"thread": data}


@router.get("/threads/{thread_id}/messages")
async def list_messages(thread_id: str, limit: int = 50, user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    thread = _get_thread(thread_id)
    _assert_member(uid, thread)

    limit = max(1, min(int(limit or 50), 200))
    q = (
        db.collection("conversations")
        .document(thread_id)
        .collection("messages")
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )

    items: List[Dict[str, Any]] = []
    for snap in q.stream():
        d = snap.to_dict() or {}
        d["id"] = snap.id
        items.append(d)

    items.reverse()
    return {"messages": items, "thread": thread}


@router.post("/threads/{thread_id}/messages")
async def send_message(
    thread_id: str,
    payload: SendMessageRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = user.get("uid")
    thread = _get_thread(thread_id)
    _assert_send_allowed(user, thread)

    now = _now()
    msg = {
        "sender_id": uid,
        "sender_role": user.get("role"),
        "text": payload.text.strip(),
        "created_at": now,
    }

    msg_ref = (
        db.collection("conversations").document(thread_id).collection("messages").document()
    )
    msg_ref.set(msg)

    # update conversation metadata
    db.collection("conversations").document(thread_id).update(
        {
            "updated_at": now,
            "last_message": {
                "text": msg["text"],
                "sender_id": uid,
                "sender_role": msg["sender_role"],
            },
            "last_message_at": now,
        }
    )

    log_action(uid, "MESSAGE_SENT", f"Sent message in thread {thread_id}")

    # Optional delayed email notifications (persistent):
    # Send an email ONLY if the message is still unread after N seconds.
    if getattr(settings, "ENABLE_MESSAGE_EMAIL_NOTIFICATIONS", False):
        try:
            members = thread.get("member_uids") or []
            recipients = [m for m in members if m and m != uid]
            sender_name = _sender_display_name(user)
            thread_label = thread.get("title") or "Conversation"
            await asyncio.to_thread(
                queue_delayed_message_emails,
                thread_id=thread_id,
                message_id=msg_ref.id,
                message_created_at=now,
                sender_uid=uid,
                sender_role=user.get("role"),
                sender_name=sender_name,
                thread_label=thread_label,
                message_text=msg.get("text") or "",
                recipient_uids=recipients,
            )
        except Exception as e:
            # Never fail sending a chat message due to email issues
            print(f"Delayed email notification queue error: {e}")

    return {"ok": True, "message": {**msg, "id": msg_ref.id}}


@router.get("/threads/{thread_id}/stream")
async def stream_messages(thread_id: str, token: str, since: float = 0.0):
    """SSE stream of new messages for a thread.

    Note: EventSource cannot send Authorization headers, so we accept an ID token
    as a query param. Use only over HTTPS in production.
    """

    user = await _get_user_from_query_token(token)
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    thread = _get_thread(thread_id)
    _assert_member(uid, thread)

    async def event_gen():
        cursor = float(since or 0.0)
        # Keep connection alive; client auto-reconnects.
        while True:
            # Heartbeat
            yield ": ping\n\n"

            q = (
                db.collection("conversations")
                .document(thread_id)
                .collection("messages")
                .where("created_at", ">", cursor)
                .order_by("created_at", direction=firestore.Query.ASCENDING)
                .limit(50)
            )

            new_items: List[Dict[str, Any]] = []
            for snap in q.stream():
                d = snap.to_dict() or {}
                d["id"] = snap.id
                new_items.append(d)

            for item in new_items:
                cursor = max(cursor, float(item.get("created_at") or 0.0))
                payload = {"type": "message", "thread_id": thread_id, "message": item}
                yield f"data: {json.dumps(payload)}\n\n"

            await asyncio.sleep(2)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.get("/threads/stream")
async def stream_thread_updates(token: str, since: float = 0.0, limit: int = 200):
    """SSE stream of thread updates for the current user.

    This powers real-time updates in the left sidebar (thread list + unread markers)
    without forcing the client to poll /messaging/threads aggressively.

    Note: EventSource cannot send Authorization headers, so we accept an ID token
    as a query param. Use only over HTTPS in production.
    """

    user = await _get_user_from_query_token(token)
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    role = user.get("role")
    if role not in {"carrier", "driver", "shipper"}:
        raise HTTPException(status_code=403, detail="Messaging not enabled for this role")

    limit = max(1, min(int(limit or 200), 500))
    cursor = float(since or 0.0)

    async def event_gen():
        nonlocal cursor
        last_ping = 0.0
        while True:
            try:
                q = (
                    db.collection("conversations")
                    .where("member_uids", "array_contains", uid)
                    .order_by("updated_at", direction=firestore.Query.DESCENDING)
                    .limit(limit)
                )
                snaps = await _fs_to_thread(lambda: list(q.stream()), timeout_s=10.0)
            except Exception:
                try:
                    q = db.collection("conversations").where("member_uids", "array_contains", uid).limit(limit)
                    snaps = await _fs_to_thread(lambda: list(q.stream()), timeout_s=10.0)
                except Exception:
                    snaps = []

            updated: List[Dict[str, Any]] = []
            max_seen = cursor
            for snap in snaps:
                d = snap.to_dict() or {}
                d["id"] = snap.id
                upd = float(d.get("updated_at") or d.get("last_message_at") or 0.0)
                if upd <= cursor:
                    continue
                max_seen = max(max_seen, upd)
                try:
                    updated.append(_thread_view_for_user(user, d))
                except Exception:
                    # best-effort; skip malformed docs
                    continue

            if updated:
                # Send a single payload containing all updates since cursor.
                payload = {"type": "threads", "threads": updated, "cursor": max_seen}
                cursor = max_seen
                yield f"data: {json.dumps(payload)}\n\n"

            # Heartbeat to keep connections alive.
            now = _now()
            if now - last_ping > 15:
                last_ping = now
                yield "event: ping\ndata: {}\n\n"

            await asyncio.sleep(3)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# -----------------------------
# Admin notification channels
# -----------------------------

@router.get("/notifications/channels")
async def list_notification_channels(user: Dict[str, Any] = Depends(get_current_user)):
    role = user.get("role") or "carrier"
    # Users can see: all + their role
    channel_ids = ["all", role]

    channels: List[Dict[str, Any]] = []
    for cid in channel_ids:
        # Read-only: never create or backfill docs in a read endpoint.
        ch = await _get_admin_channel_readonly(cid, cid)

        # If metadata is missing, fetch the latest message (best-effort) but don't write.
        if not ch.get("last_message_at"):
            try:
                q = (
                    db.collection("admin_channels")
                    .document(cid)
                    .collection("messages")
                    .order_by("created_at", direction=firestore.Query.DESCENDING)
                    .limit(1)
                )
                snaps = await _fs_to_thread(lambda: list(q.stream()))
                last = (snaps[0].to_dict() or {}) if snaps else None
                if last and last.get("created_at"):
                    ch["last_message_at"] = float(last.get("created_at") or 0.0)
                    ch["last_message"] = {
                        "text": last.get("text"),
                        "title": last.get("title"),
                        "sender_role": last.get("sender_role"),
                    }
            except Exception:
                # If Firestore is slow/unavailable, still return a minimal channel list quickly.
                pass
        channels.append(ch)

    return {"channels": channels}


@router.get("/notifications/channels/{channel_id}/messages")
async def list_channel_messages(channel_id: str, limit: int = 50, user: Dict[str, Any] = Depends(get_current_user)):
    role = user.get("role") or "carrier"
    if channel_id not in {"all", role} and user.get("role") not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Not allowed")

    limit = max(1, min(int(limit or 50), 200))
    q = (
        db.collection("admin_channels")
        .document(channel_id)
        .collection("messages")
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )

    items: List[Dict[str, Any]] = []
    for snap in q.stream():
        d = snap.to_dict() or {}
        d["id"] = snap.id
        items.append(d)

    items.reverse()
    return {"messages": items}


@router.post("/notifications/channels/{channel_id}/read")
async def mark_channel_read(channel_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    role = user.get("role") or "carrier"
    if channel_id not in {"all", role} and user.get("role") not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Not allowed")

    now = _now()
    db.collection("admin_channel_reads").document(_channel_read_doc_id(channel_id, uid)).set(
        {
            "channel_id": channel_id,
            "uid": uid,
            "last_read_at": now,
            "updated_at": now,
        },
        merge=True,
    )
    return {"ok": True, "channel_id": channel_id, "last_read_at": now}


@router.post("/admin/threads/direct")
async def admin_create_user_direct_thread(
    payload: AdminCreateUserDirectThreadRequest,
    user: Dict[str, Any] = Depends(require_admin),
):
    """Admin-only: create (or return existing) admin<->user direct thread."""
    admin_id = user.get("uid")
    if not admin_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    target_uid = _normalize_uid(payload.target_uid)
    if target_uid == admin_id:
        raise HTTPException(status_code=400, detail="Cannot create a thread with yourself")

    # Ensure the target exists.
    target_snap = db.collection("users").document(target_uid).get()
    if not target_snap.exists:
        raise HTTPException(status_code=404, detail="Target user not found")

    now = _now()
    thread_id = _admin_user_thread_id(admin_id, target_uid)
    ref = db.collection("conversations").document(thread_id)
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict() or {}
        d["id"] = snap.id
        return {"created": False, "thread": d}

    target_doc = target_snap.to_dict() or {}
    title = _display_name_for_user_doc(target_doc)

    data = {
        "id": thread_id,
        "kind": "admin_user_direct",
        "title": title,
        "admin_id": admin_id,
        "user_id": target_uid,
        "member_uids": [admin_id, target_uid],
        "created_by": admin_id,
        "created_at": now,
        "updated_at": now,
        "last_message": None,
        "last_message_at": None,
    }
    ref.set(data)
    log_action(admin_id, "ADMIN_USER_THREAD_CREATED", f"Created direct thread with {target_uid}")
    return {"created": True, "thread": data}


@router.post("/admin/notifications/send")
async def admin_send_notification(
    payload: AdminChannelMessageRequest,
    user: Dict[str, Any] = Depends(require_admin),
):
    target_role = (payload.target_role or "").strip().lower()
    if target_role not in {"all", "carrier", "driver", "shipper", "broker"}:
        raise HTTPException(status_code=400, detail="Invalid target_role")

    channel_id = target_role
    _ensure_admin_channel(channel_id, target_role)

    now = _now()
    msg = {
        "sender_id": user.get("uid"),
        "sender_role": user.get("role"),
        "text": payload.text.strip(),
        "title": payload.title,
        "created_at": now,
        "one_way": True,
    }

    ref = db.collection("admin_channels").document(channel_id).collection("messages").document()
    ref.set(msg)

    # Update channel updated_at
    db.collection("admin_channels").document(channel_id).set(
        {
            "updated_at": now,
            "last_message_at": now,
            "last_message": {"text": msg["text"], "title": msg.get("title"), "sender_role": msg.get("sender_role")},
        },
        merge=True,
    )

    push_result = {"attempted": 0, "success": 0, "failure": 0}
    if getattr(settings, "ENABLE_FCM", False):
        # Fetch all tokens by role
        token_q = db.collection("device_tokens")
        if target_role != "all":
            token_q = token_q.where("role", "==", target_role)
        tokens = []
        for s in token_q.stream():
            d = s.to_dict() or {}
            t = d.get("token")
            if t:
                tokens.append(t)
        push_result = _send_push(tokens, payload.title or "FreightPower", payload.text.strip())

    log_action(user.get("uid"), "ADMIN_NOTIFICATION_SENT", f"Channel={channel_id}")
    return {"ok": True, "message": {**msg, "id": ref.id}, "push": push_result}


# -----------------------------
# Device tokens
# -----------------------------

@router.post("/devices/register")
async def register_device_token(
    payload: RegisterDeviceTokenRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = payload.token.strip()
    now = _now()

    # Use token as doc id to avoid duplicates
    db.collection("device_tokens").document(token).set(
        {
            "token": token,
            "uid": uid,
            "role": user.get("role"),
            "platform": payload.platform,
            "updated_at": now,
            "created_at": now,
        },
        merge=True,
    )

    return {"ok": True}
