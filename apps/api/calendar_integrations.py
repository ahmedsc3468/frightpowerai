from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlencode, urlparse
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import json
import secrets
import time

import httpx

from .auth import get_current_user
from .database import db, log_action
from .settings import settings


router = APIRouter(prefix="/calendar", tags=["Calendar"])

Provider = Literal["google", "outlook"]


class CalendarEvent(BaseModel):
    internal_id: str = Field(..., description="Stable FreightPower event id used for idempotent sync")
    title: str

    # Either all-day date (YYYY-MM-DD) or date-time ISO string.
    all_day: bool = True
    start: str
    end: str

    description: Optional[str] = None
    location: Optional[str] = None

    # Optional per-event reminder override (minutes before start). If omitted, provider default is used.
    reminder_minutes: Optional[int] = None


class CalendarSyncRequest(BaseModel):
    provider: Provider
    events: List[CalendarEvent] = Field(default_factory=list)
    reminders_enabled: bool = True


class CalendarDisconnectRequest(BaseModel):
    provider: Provider


def _now_ts() -> float:
    return float(time.time())


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - (len(s) % 4)) % 4)
    return base64.urlsafe_b64decode((s or "") + pad)


def _state_secret() -> str:
    # This secret is used to sign OAuth state. If not provided, fall back to an
    # ephemeral per-process secret (dev-only; callbacks will break after restart).
    secret = str(getattr(settings, "CALENDAR_OAUTH_STATE_SECRET", "") or "").strip()
    if secret:
        return secret

    # Stable-ish fallback: do NOT rely on this for production security.
    fallback = str(getattr(settings, "ADMIN_BOOTSTRAP_TOKEN", "") or "").strip()
    if fallback:
        return fallback

    # Last resort (dev). This is intentionally not persisted.
    if not hasattr(_state_secret, "_ephemeral"):
        setattr(_state_secret, "_ephemeral", secrets.token_urlsafe(32))
    return getattr(_state_secret, "_ephemeral")


def _encode_state(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(_state_secret().encode("utf-8"), body, hashlib.sha256).digest()
    return f"{_b64url(body)}.{_b64url(sig)}"


def _decode_state(state: str) -> Dict[str, Any]:
    try:
        body_b64, sig_b64 = (state or "").split(".", 1)
        body = _b64url_decode(body_b64)
        sig = _b64url_decode(sig_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state")

    expected = hmac.new(_state_secret().encode("utf-8"), body, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=400, detail="Invalid state signature")

    try:
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("state payload not dict")
        return payload
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state payload")


def _safe_return_to(value: Optional[str]) -> str:
    # Prevent open redirects. Only allow relative paths like /driver-dashboard?... .
    v = (value or "/driver-dashboard?nav=settings").strip()
    if not v.startswith("/"):
        return "/driver-dashboard?nav=settings"
    parsed = urlparse(v)
    if parsed.scheme or parsed.netloc:
        return "/driver-dashboard?nav=settings"
    return v


def _provider_config(provider: Provider) -> Dict[str, str]:
    if provider == "google":
        return {
            "client_id": str(getattr(settings, "GOOGLE_CALENDAR_CLIENT_ID", "") or "").strip(),
            "client_secret": str(getattr(settings, "GOOGLE_CALENDAR_CLIENT_SECRET", "") or "").strip(),
            "redirect_uri": str(getattr(settings, "GOOGLE_CALENDAR_REDIRECT_URI", "") or "").strip(),
        }
    return {
        "client_id": str(getattr(settings, "MICROSOFT_CLIENT_ID", "") or "").strip(),
        "client_secret": str(getattr(settings, "MICROSOFT_CLIENT_SECRET", "") or "").strip(),
        "redirect_uri": str(getattr(settings, "MICROSOFT_REDIRECT_URI", "") or "").strip(),
        "tenant": str(getattr(settings, "MICROSOFT_TENANT", "common") or "common").strip() or "common",
    }


def _assert_provider_configured(provider: Provider) -> None:
    cfg = _provider_config(provider)
    if not cfg.get("client_id") or not cfg.get("client_secret") or not cfg.get("redirect_uri"):
        raise HTTPException(
            status_code=501,
            detail=(
                f"{provider} calendar OAuth is not configured yet. "
                f"Set the {provider.upper()} OAuth env vars on the backend."
            ),
        )


def _integration_doc(uid: str):
    return db.collection("users").document(uid).collection("integrations").document("calendar")


def _event_link_doc(uid: str, provider: Provider, internal_id: str):
    digest = hashlib.sha256(f"{provider}:{internal_id}".encode("utf-8")).hexdigest()[:32]
    doc_id = f"{provider}__{digest}"
    return db.collection("users").document(uid).collection("calendar_event_links").document(doc_id)


async def _get_provider_tokens(uid: str, provider: Provider) -> Dict[str, Any]:
    snap = _integration_doc(uid).get()
    if not snap.exists:
        return {}
    d = snap.to_dict() or {}
    providers = d.get("providers") or {}
    p = providers.get(provider) or {}
    return p if isinstance(p, dict) else {}


async def _set_provider_tokens(uid: str, provider: Provider, tokens: Dict[str, Any]) -> None:
    now = _now_ts()
    _integration_doc(uid).set(
        {
            "providers": {provider: {**tokens, "updated_at": now}},
            "updated_at": now,
        },
        merge=True,
    )


async def _refresh_google_access_token(uid: str) -> str:
    tokens = await _get_provider_tokens(uid, "google")
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Google Calendar is not connected")

    expires_at = float(tokens.get("expires_at") or 0)
    access_token = str(tokens.get("access_token") or "").strip()
    if access_token and expires_at > (_now_ts() + 60):
        return access_token

    cfg = _provider_config("google")
    _assert_provider_configured("google")

    data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post("https://oauth2.googleapis.com/token", data=data)
        body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        if res.status_code >= 400:
            raise HTTPException(status_code=401, detail=body.get("error_description") or "Failed to refresh Google token")

    new_access = str(body.get("access_token") or "").strip()
    expires_in = float(body.get("expires_in") or 3600)
    if not new_access:
        raise HTTPException(status_code=401, detail="Failed to refresh Google token")

    await _set_provider_tokens(
        uid,
        "google",
        {
            **tokens,
            "access_token": new_access,
            "expires_at": _now_ts() + expires_in,
            "token_type": body.get("token_type") or tokens.get("token_type") or "Bearer",
        },
    )
    return new_access


async def _refresh_outlook_access_token(uid: str) -> str:
    tokens = await _get_provider_tokens(uid, "outlook")
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Outlook calendar is not connected")

    expires_at = float(tokens.get("expires_at") or 0)
    access_token = str(tokens.get("access_token") or "").strip()
    if access_token and expires_at > (_now_ts() + 60):
        return access_token

    cfg = _provider_config("outlook")
    _assert_provider_configured("outlook")
    tenant = cfg.get("tenant") or "common"

    data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "refresh_token": refresh_token,
        "redirect_uri": cfg["redirect_uri"],
        "grant_type": "refresh_token",
        "scope": "offline_access https://graph.microsoft.com/Calendars.ReadWrite",
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", data=data)
        body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        if res.status_code >= 400:
            msg = body.get("error_description") or body.get("error") or "Failed to refresh Outlook token"
            raise HTTPException(status_code=401, detail=msg)

    new_access = str(body.get("access_token") or "").strip()
    expires_in = float(body.get("expires_in") or 3600)
    new_refresh = str(body.get("refresh_token") or "").strip() or refresh_token
    if not new_access:
        raise HTTPException(status_code=401, detail="Failed to refresh Outlook token")

    await _set_provider_tokens(
        uid,
        "outlook",
        {
            **tokens,
            "access_token": new_access,
            "refresh_token": new_refresh,
            "expires_at": _now_ts() + expires_in,
            "token_type": body.get("token_type") or tokens.get("token_type") or "Bearer",
        },
    )
    return new_access


def _google_event_payload(e: CalendarEvent, reminders_enabled: bool) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "summary": e.title,
    }
    if e.description:
        payload["description"] = e.description
    if e.location:
        payload["location"] = e.location

    if e.all_day:
        payload["start"] = {"date": e.start}
        payload["end"] = {"date": e.end}
    else:
        payload["start"] = {"dateTime": e.start}
        payload["end"] = {"dateTime": e.end}

    if reminders_enabled:
        minutes = 60
        try:
            if e.reminder_minutes is not None:
                minutes = int(e.reminder_minutes)
        except Exception:
            minutes = 60
        minutes = max(0, min(7 * 24 * 60, minutes))
        payload["reminders"] = {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": minutes}],
        }
    else:
        payload["reminders"] = {"useDefault": False, "overrides": []}

    return payload


def _outlook_event_payload(e: CalendarEvent, reminders_enabled: bool) -> Dict[str, Any]:
    # Graph wants dateTime+timeZone.
    def _dt(s: str) -> Dict[str, str]:
        return {"dateTime": s, "timeZone": "UTC"}

    minutes = 60
    try:
        if e.reminder_minutes is not None:
            minutes = int(e.reminder_minutes)
    except Exception:
        minutes = 60
    minutes = max(0, min(7 * 24 * 60, minutes))

    payload: Dict[str, Any] = {
        "subject": e.title,
        "isReminderOn": bool(reminders_enabled),
        "reminderMinutesBeforeStart": minutes,
    }
    if e.description:
        payload["body"] = {"contentType": "Text", "content": e.description}
    if e.location:
        payload["location"] = {"displayName": e.location}

    if e.all_day:
        payload["isAllDay"] = True
        payload["start"] = _dt(f"{e.start}T00:00:00")
        payload["end"] = _dt(f"{e.end}T00:00:00")
    else:
        payload["isAllDay"] = False
        payload["start"] = _dt(e.start)
        payload["end"] = _dt(e.end)

    return payload


@router.get("/oauth/{provider}/start")
async def oauth_start(
    provider: Provider,
    return_to: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    _assert_provider_configured(provider)
    cfg = _provider_config(provider)

    safe_return = _safe_return_to(return_to)
    state = _encode_state(
        {
            "v": 1,
            "uid": uid,
            "provider": provider,
            "nonce": secrets.token_urlsafe(16),
            "iat": int(_now_ts()),
            "return_to": safe_return,
        }
    )

    if provider == "google":
        params = {
            "client_id": cfg["client_id"],
            "redirect_uri": cfg["redirect_uri"],
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/calendar.events",
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
        auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    else:
        tenant = cfg.get("tenant") or "common"
        params = {
            "client_id": cfg["client_id"],
            "redirect_uri": cfg["redirect_uri"],
            "response_type": "code",
            "response_mode": "query",
            "scope": "offline_access https://graph.microsoft.com/Calendars.ReadWrite",
            "state": state,
        }
        auth_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?" + urlencode(params)

    return {"auth_url": auth_url}


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: Provider, code: str, state: str):
    payload = _decode_state(state)
    if payload.get("provider") != provider:
        raise HTTPException(status_code=400, detail="State/provider mismatch")
    uid = str(payload.get("uid") or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Invalid state")

    iat = int(payload.get("iat") or 0)
    if iat <= 0 or (int(_now_ts()) - iat) > (10 * 60):
        raise HTTPException(status_code=400, detail="OAuth state expired")

    _assert_provider_configured(provider)
    cfg = _provider_config(provider)
    now = _now_ts()

    if provider == "google":
        data = {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "redirect_uri": cfg["redirect_uri"],
            "code": code,
            "grant_type": "authorization_code",
        }
        token_url = "https://oauth2.googleapis.com/token"
    else:
        tenant = cfg.get("tenant") or "common"
        data = {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "redirect_uri": cfg["redirect_uri"],
            "code": code,
            "grant_type": "authorization_code",
            "scope": "offline_access https://graph.microsoft.com/Calendars.ReadWrite",
        }
        token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"

    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(token_url, data=data)
        body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        if res.status_code >= 400:
            msg = body.get("error_description") or body.get("error") or "OAuth token exchange failed"
            raise HTTPException(status_code=400, detail=msg)

    access_token = str(body.get("access_token") or "").strip()
    refresh_token = str(body.get("refresh_token") or "").strip()
    expires_in = float(body.get("expires_in") or 3600)
    scope = body.get("scope")

    existing = await _get_provider_tokens(uid, provider)
    merged_refresh = refresh_token or str(existing.get("refresh_token") or "").strip()

    await _set_provider_tokens(
        uid,
        provider,
        {
            "connected": True,
            "connected_at": existing.get("connected_at") or now,
            "access_token": access_token,
            "refresh_token": merged_refresh,
            "expires_at": now + expires_in,
            "scope": scope,
            "token_type": body.get("token_type") or existing.get("token_type") or "Bearer",
        },
    )
    try:
        log_action(uid, "CALENDAR_CONNECTED", f"Connected {provider} calendar")
    except Exception:
        pass

    return_to = _safe_return_to(str(payload.get("return_to") or ""))
    # Ensure nav=settings and trigger a one-time sync on the client.
    connector = "&" if ("?" in return_to) else "?"
    redirect_path = f"{return_to}{connector}calendar_provider={provider}&calendar_connected=1&calendar_auto_sync=1"
    redirect_url = str(getattr(settings, "FRONTEND_BASE_URL", "http://localhost:5173")).rstrip("/") + redirect_path
    return RedirectResponse(url=redirect_url)


@router.get("/status")
async def calendar_status(user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    snap = _integration_doc(uid).get()
    data = snap.to_dict() if snap.exists else {}
    providers = data.get("providers") if isinstance(data, dict) else {}
    providers = providers if isinstance(providers, dict) else {}

    def _connected(p: dict) -> bool:
        if not isinstance(p, dict):
            return False
        if p.get("connected") is not True:
            return False
        # refresh token is the reliable indicator for ongoing access.
        return bool(str(p.get("refresh_token") or "").strip())

    return {
        "google": {"connected": _connected(providers.get("google") or {}), "updated_at": (providers.get("google") or {}).get("updated_at")},
        "outlook": {"connected": _connected(providers.get("outlook") or {}), "updated_at": (providers.get("outlook") or {}).get("updated_at")},
        "last_synced_at": data.get("last_synced_at") if isinstance(data, dict) else None,
    }


@router.post("/disconnect")
async def calendar_disconnect(payload: CalendarDisconnectRequest, user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    provider = payload.provider
    existing = await _get_provider_tokens(uid, provider)
    # Best-effort revoke for Google.
    if provider == "google":
        token = str(existing.get("refresh_token") or existing.get("access_token") or "").strip()
        if token:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    await client.post("https://oauth2.googleapis.com/revoke", params={"token": token})
            except Exception:
                pass

    _integration_doc(uid).set(
        {
            "providers": {
                provider: {
                    "connected": False,
                    "disconnected_at": _now_ts(),
                    "access_token": None,
                    "refresh_token": None,
                    "expires_at": None,
                    "scope": None,
                    "updated_at": _now_ts(),
                }
            },
            "updated_at": _now_ts(),
        },
        merge=True,
    )

    try:
        log_action(uid, "CALENDAR_DISCONNECTED", f"Disconnected {provider} calendar")
    except Exception:
        pass

    return {"ok": True}


@router.post("/sync")
async def calendar_sync(payload: CalendarSyncRequest, user: Dict[str, Any] = Depends(get_current_user)):
    uid = user.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    provider = payload.provider
    events = payload.events or []
    synced = await _sync_events_for_uid(
        uid=uid,
        provider=provider,
        events=events,
        reminders_enabled=payload.reminders_enabled,
    )

    _integration_doc(uid).set({"last_synced_at": _now_ts(), "updated_at": _now_ts()}, merge=True)
    try:
        log_action(uid, "CALENDAR_SYNC", f"Synced {synced} events to {provider}")
    except Exception:
        pass
    return {"ok": True, "synced": int(synced)}


async def _sync_events_for_uid(*, uid: str, provider: Provider, events: List[CalendarEvent], reminders_enabled: bool) -> int:
    """Sync events to a user's connected external calendar.

    This is used by both the normal /calendar/sync endpoint and shipper->driver assignment fan-out.
    """
    uid = str(uid or "").strip()
    if not uid:
        return 0
    events = list(events or [])
    if not events:
        return 0

    # Defensive: keep sync bounded.
    events = events[:250]
    now_dt = datetime.now(timezone.utc)

    if provider == "google":
        access_token = await _refresh_google_access_token(uid)
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        base = "https://www.googleapis.com/calendar/v3"
        async with httpx.AsyncClient(timeout=25.0) as client:
            synced = 0
            for e in events:
                # Skip past events best-effort.
                try:
                    if e.all_day:
                        start_dt = datetime.fromisoformat(e.start).replace(tzinfo=timezone.utc)
                    else:
                        start_dt = datetime.fromisoformat(e.start.replace("Z", "+00:00"))
                    if start_dt < (now_dt - timedelta(days=1)):
                        continue
                except Exception:
                    pass

                link_ref = _event_link_doc(uid, provider, e.internal_id)
                link_snap = link_ref.get()
                link = link_snap.to_dict() if link_snap.exists else {}
                external_id = str((link or {}).get("external_id") or "").strip()

                body = _google_event_payload(e, reminders_enabled)
                if external_id:
                    url = f"{base}/calendars/primary/events/{external_id}"
                    res = await client.patch(url, headers=headers, json=body)
                    if res.status_code == 404:
                        external_id = ""
                    elif res.status_code >= 400:
                        raise HTTPException(status_code=400, detail=f"Google sync failed: {res.text}")

                if not external_id:
                    url = f"{base}/calendars/primary/events"
                    res = await client.post(url, headers=headers, json=body)
                    if res.status_code >= 400:
                        raise HTTPException(status_code=400, detail=f"Google sync failed: {res.text}")
                    created = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
                    external_id = str(created.get("id") or "").strip()
                    if external_id:
                        link_ref.set(
                            {
                                "provider": provider,
                                "internal_id": e.internal_id,
                                "external_id": external_id,
                                "created_at": _now_ts(),
                                "updated_at": _now_ts(),
                            },
                            merge=True,
                        )
                synced += 1
            return int(synced)

    access_token = await _refresh_outlook_access_token(uid)
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    base = "https://graph.microsoft.com/v1.0"
    async with httpx.AsyncClient(timeout=25.0) as client:
        synced = 0
        for e in events:
            link_ref = _event_link_doc(uid, provider, e.internal_id)
            snap = link_ref.get()
            link = snap.to_dict() if snap.exists else {}
            external_id = str((link or {}).get("external_id") or "").strip()
            body = _outlook_event_payload(e, reminders_enabled)
            if external_id:
                res = await client.patch(f"{base}/me/events/{external_id}", headers=headers, json=body)
                if res.status_code == 404:
                    external_id = ""
                elif res.status_code >= 400:
                    raise HTTPException(status_code=400, detail=f"Outlook sync failed: {res.text}")
            if not external_id:
                res = await client.post(f"{base}/me/events", headers=headers, json=body)
                if res.status_code >= 400:
                    raise HTTPException(status_code=400, detail=f"Outlook sync failed: {res.text}")
                created = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
                external_id = str(created.get("id") or "").strip()
                if external_id:
                    link_ref.set(
                        {
                            "provider": provider,
                            "internal_id": e.internal_id,
                            "external_id": external_id,
                            "created_at": _now_ts(),
                            "updated_at": _now_ts(),
                        },
                        merge=True,
                    )
            synced += 1
        return int(synced)


# ----------------------------
# Internal calendar persistence
# ----------------------------


class InternalCalendarEventCreateRequest(BaseModel):
    title: str
    all_day: bool = True
    start: str  # YYYY-MM-DD
    end: str  # YYYY-MM-DD
    description: Optional[str] = None
    location: Optional[str] = None
    reminders: List[int] = Field(default_factory=list)


class InternalCalendarEventUpdateRequest(BaseModel):
    title: Optional[str] = None
    all_day: Optional[bool] = None
    start: Optional[str] = None
    end: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    reminders: Optional[List[int]] = None


class InternalCalendarEventAssignRequest(BaseModel):
    driver_uids: List[str] = Field(default_factory=list)
    carrier_uids: List[str] = Field(default_factory=list)
    shipper_uids: List[str] = Field(default_factory=list)
    sync_external: bool = True


def _user_events_col(uid: str):
    return db.collection("users").document(uid).collection("calendar_events")


def _user_reminder_sends_col(uid: str):
    return db.collection("users").document(uid).collection("calendar_reminder_sends")


def _safe_str(v: Any) -> str:
    return str(v or "").strip()


def _normalize_reminders(reminders: Any) -> List[int]:
    if not isinstance(reminders, list):
        return []
    out: List[int] = []
    seen = set()
    for x in reminders:
        try:
            m = int(x)
        except Exception:
            continue
        m = max(0, min(7 * 24 * 60, m))
        if m in seen:
            continue
        seen.add(m)
        out.append(m)
    out.sort()
    return out


def _is_ymd(s: str) -> bool:
    text = _safe_str(s)
    if len(text) != 10:
        return False
    try:
        datetime.fromisoformat(text)
        return True
    except Exception:
        return False


def _start_ts_for_event(doc: Dict[str, Any]) -> Optional[float]:
    start = _safe_str(doc.get("start"))
    if not start:
        return None
    # Stored as YYYY-MM-DD (all_day). Treat as midnight UTC.
    try:
        dt = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
        return float(dt.timestamp())
    except Exception:
        return None


def _notification_id(kind: str, uid: str, event_id: str, extra: str = "") -> str:
    raw = f"{kind}:{_safe_str(uid)}:{_safe_str(event_id)}:{_safe_str(extra)}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


@router.get("/internal/events")
async def list_internal_events(
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = _safe_str(user.get("uid"))
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    start_ymd = _safe_str(start)
    end_ymd = _safe_str(end)
    if start_ymd and not _is_ymd(start_ymd):
        raise HTTPException(status_code=400, detail="Invalid start date")
    if end_ymd and not _is_ymd(end_ymd):
        raise HTTPException(status_code=400, detail="Invalid end date")

    rows: List[Dict[str, Any]] = []
    for snap in _user_events_col(uid).stream():
        try:
            d = snap.to_dict() or {}
            d["id"] = snap.id
            s = _safe_str(d.get("start"))
            if start_ymd and s and s < start_ymd:
                continue
            if end_ymd and s and s > end_ymd:
                continue
            d["reminders"] = _normalize_reminders(d.get("reminders"))
            if not isinstance(d.get("assigned_driver_uids"), list):
                d["assigned_driver_uids"] = []
            if not isinstance(d.get("assigned_carrier_uids"), list):
                d["assigned_carrier_uids"] = []
            if not isinstance(d.get("assigned_shipper_uids"), list):
                d["assigned_shipper_uids"] = []
            rows.append(d)
        except Exception:
            continue

    rows.sort(key=lambda x: (_safe_str(x.get("start")), _safe_str(x.get("title"))))
    return {"events": rows}


@router.post("/internal/events")
async def create_internal_event(
    payload: InternalCalendarEventCreateRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = _safe_str(user.get("uid"))
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    title = _safe_str(payload.title)
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    start_ymd = _safe_str(payload.start)
    end_ymd = _safe_str(payload.end)
    if not _is_ymd(start_ymd) or not _is_ymd(end_ymd):
        raise HTTPException(status_code=400, detail="start/end must be YYYY-MM-DD")

    now = _now_ts()
    event_id = secrets.token_urlsafe(12)
    record: Dict[str, Any] = {
        "title": title,
        "type": "internal",
        "all_day": bool(payload.all_day),
        "start": start_ymd,
        "end": end_ymd,
        "description": _safe_str(payload.description) or None,
        "location": _safe_str(payload.location) or None,
        "reminders": _normalize_reminders(payload.reminders),
        "assigned_driver_uids": [],
        "assigned_carrier_uids": [],
        "assigned_shipper_uids": [],
        "source_uid": uid,
        "created_at": now,
        "updated_at": now,
    }

    _user_events_col(uid).document(event_id).set(record, merge=True)
    try:
        log_action(uid, "CALENDAR_INTERNAL_EVENT_CREATE", f"Created internal calendar event {event_id}")
    except Exception:
        pass

    record["id"] = event_id
    return {"ok": True, "event": record}


@router.patch("/internal/events/{event_id}")
async def update_internal_event(
    event_id: str,
    payload: InternalCalendarEventUpdateRequest = Body(...),
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = _safe_str(user.get("uid"))
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    eid = _safe_str(event_id)
    if not eid:
        raise HTTPException(status_code=400, detail="Invalid event id")

    ref = _user_events_col(uid).document(eid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Event not found")

    patch: Dict[str, Any] = {}
    if payload.title is not None:
        t = _safe_str(payload.title)
        if not t:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        patch["title"] = t
    if payload.all_day is not None:
        patch["all_day"] = bool(payload.all_day)
    if payload.start is not None:
        s = _safe_str(payload.start)
        if not _is_ymd(s):
            raise HTTPException(status_code=400, detail="Invalid start date")
        patch["start"] = s
    if payload.end is not None:
        e = _safe_str(payload.end)
        if not _is_ymd(e):
            raise HTTPException(status_code=400, detail="Invalid end date")
        patch["end"] = e
    if payload.description is not None:
        patch["description"] = _safe_str(payload.description) or None
    if payload.location is not None:
        patch["location"] = _safe_str(payload.location) or None
    if payload.reminders is not None:
        patch["reminders"] = _normalize_reminders(payload.reminders)

    patch["updated_at"] = _now_ts()
    ref.set(patch, merge=True)
    return {"ok": True}


@router.delete("/internal/events/{event_id}")
async def delete_internal_event(event_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    uid = _safe_str(user.get("uid"))
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    eid = _safe_str(event_id)
    if not eid:
        raise HTTPException(status_code=400, detail="Invalid event id")

    ref = _user_events_col(uid).document(eid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Event not found")

    d = snap.to_dict() or {}
    drivers = d.get("assigned_driver_uids") if isinstance(d.get("assigned_driver_uids"), list) else []
    carriers = d.get("assigned_carrier_uids") if isinstance(d.get("assigned_carrier_uids"), list) else []
    shippers = d.get("assigned_shipper_uids") if isinstance(d.get("assigned_shipper_uids"), list) else []
    ref.delete()

    # Best-effort cleanup driver copies.
    for driver_uid in drivers:
        duid = _safe_str(driver_uid)
        if not duid:
            continue
        try:
            _user_events_col(duid).document(eid).delete()
        except Exception:
            pass

    # Best-effort cleanup carrier copies.
    for carrier_uid in carriers:
        cuid = _safe_str(carrier_uid)
        if not cuid:
            continue
        try:
            _user_events_col(cuid).document(eid).delete()
        except Exception:
            pass

    # Best-effort cleanup shipper copies.
    for shipper_uid in shippers:
        suid = _safe_str(shipper_uid)
        if not suid:
            continue
        try:
            _user_events_col(suid).document(eid).delete()
        except Exception:
            pass

    return {"ok": True}


def _shipper_allowed_driver_uids(shipper_uid: str) -> List[str]:
    shipper_uid = _safe_str(shipper_uid)
    if not shipper_uid:
        return []

    allowed = set()
    try:
        q = db.collection("loads").where("created_by", "==", shipper_uid)
        snaps = q.stream()
    except Exception:
        snaps = db.collection("loads").stream()

    for snap in snaps:
        try:
            d = snap.to_dict() or {}
            if _safe_str(d.get("created_by")) != shipper_uid:
                continue
            driver_uid = _safe_str(d.get("assigned_driver") or d.get("assigned_driver_id") or d.get("assigned_driver_uid") or d.get("driver_id"))
            if driver_uid:
                allowed.add(driver_uid)
        except Exception:
            continue

    return sorted(allowed)


def _shipper_allowed_carrier_uids(shipper_uid: str) -> List[str]:
    shipper_uid = _safe_str(shipper_uid)
    if not shipper_uid:
        return []

    allowed = set()
    try:
        q = db.collection("loads").where("created_by", "==", shipper_uid)
        snaps = q.stream()
    except Exception:
        snaps = db.collection("loads").stream()

    for snap in snaps:
        try:
            d = snap.to_dict() or {}
            if _safe_str(d.get("created_by")) != shipper_uid:
                continue
            carrier_uid = _safe_str(
                d.get("assigned_carrier")
                or d.get("assigned_carrier_id")
                or d.get("carrier_id")
                or d.get("carrier_uid")
            )
            if carrier_uid:
                allowed.add(carrier_uid)
        except Exception:
            continue

    return sorted(allowed)


def _carrier_allowed_shipper_uids(carrier_uid: str) -> List[str]:
    carrier_uid = _safe_str(carrier_uid)
    if not carrier_uid:
        return []

    allowed = set()
    snaps: List[Any] = []
    seen_doc_ids = set()
    try:
        for field in ["assigned_carrier", "assigned_carrier_id", "carrier_id", "carrier_uid"]:
            for s in db.collection("loads").where(field, "==", carrier_uid).stream():
                if getattr(s, "id", None) in seen_doc_ids:
                    continue
                seen_doc_ids.add(getattr(s, "id", None))
                snaps.append(s)
    except Exception:
        snaps = list(db.collection("loads").stream())

    for snap in snaps:
        try:
            d = snap.to_dict() or {}
            assigned = _safe_str(d.get("assigned_carrier") or d.get("assigned_carrier_id") or d.get("carrier_id") or d.get("carrier_uid"))
            if assigned != carrier_uid:
                continue
            shipper_uid = _safe_str(d.get("created_by"))
            if shipper_uid:
                allowed.add(shipper_uid)
        except Exception:
            continue

    return sorted(allowed)


def _carrier_allowed_driver_uids(carrier_uid: str) -> List[str]:
    carrier_uid = _safe_str(carrier_uid)
    if not carrier_uid:
        return []

    allowed = set()
    snaps: List[Any] = []
    seen_doc_ids = set()
    try:
        for field in ["assigned_carrier", "assigned_carrier_id", "carrier_id", "carrier_uid"]:
            for s in db.collection("loads").where(field, "==", carrier_uid).stream():
                if getattr(s, "id", None) in seen_doc_ids:
                    continue
                seen_doc_ids.add(getattr(s, "id", None))
                snaps.append(s)
    except Exception:
        snaps = list(db.collection("loads").stream())

    for snap in snaps:
        try:
            d = snap.to_dict() or {}
            assigned = _safe_str(d.get("assigned_carrier") or d.get("assigned_carrier_id") or d.get("carrier_id") or d.get("carrier_uid"))
            if assigned != carrier_uid:
                continue
            driver_uid = _safe_str(
                d.get("assigned_driver")
                or d.get("assigned_driver_id")
                or d.get("assigned_driver_uid")
                or d.get("driver_id")
            )
            if driver_uid:
                allowed.add(driver_uid)
        except Exception:
            continue

    return sorted(allowed)


@router.post("/internal/events/{event_id}/assign")
async def assign_internal_event_to_related_users(
    event_id: str,
    payload: InternalCalendarEventAssignRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    uid = _safe_str(user.get("uid"))
    role = _safe_str(user.get("role"))
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if role not in {"shipper", "carrier"}:
        raise HTTPException(status_code=403, detail="Only shippers and carriers can assign events")

    eid = _safe_str(event_id)
    if not eid:
        raise HTTPException(status_code=400, detail="Invalid event id")

    ref = _user_events_col(uid).document(eid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Event not found")

    event = snap.to_dict() or {}
    title = _safe_str(event.get("title")) or "Calendar Event"
    start_ymd = _safe_str(event.get("start"))
    end_ymd = _safe_str(event.get("end"))
    all_day = bool(event.get("all_day") is not False)
    reminders = _normalize_reminders(event.get("reminders"))
    reminder_minutes = reminders[0] if reminders else 60

    requested_drivers = [_safe_str(x) for x in (payload.driver_uids or []) if _safe_str(x)]
    requested_carriers = [_safe_str(x) for x in (payload.carrier_uids or []) if _safe_str(x)]
    requested_shippers = [_safe_str(x) for x in (payload.shipper_uids or []) if _safe_str(x)]

    requested_drivers = sorted(set(requested_drivers))
    requested_carriers = sorted(set(requested_carriers))
    requested_shippers = sorted(set(requested_shippers))

    async def _sync_to_connected_external(target_uid: str) -> None:
        if not payload.sync_external:
            return
        try:
            snap_int = _integration_doc(target_uid).get()
            integ = snap_int.to_dict() if snap_int.exists else {}
            providers = integ.get("providers") if isinstance(integ, dict) else {}
            providers = providers if isinstance(providers, dict) else {}

            def _connected(p: Any) -> bool:
                if not isinstance(p, dict):
                    return False
                if p.get("connected") is not True:
                    return False
                return bool(_safe_str(p.get("refresh_token")))

            for prov in ["google", "outlook"]:
                if not _connected(providers.get(prov) or {}):
                    continue
                await _sync_events_for_uid(
                    uid=target_uid,
                    provider=prov,  # type: ignore
                    events=[
                        CalendarEvent(
                            internal_id=f"internal:{eid}",
                            title=title,
                            all_day=True,
                            start=start_ymd,
                            end=end_ymd,
                            description=_safe_str(event.get("description")) or None,
                            location=_safe_str(event.get("location")) or None,
                            reminder_minutes=reminder_minutes,
                        )
                    ],
                    reminders_enabled=True,
                )
        except Exception:
            return

    now = _now_ts()
    wrote = 0

    if role == "shipper":
        # Primary: shipper -> carriers (amendment)
        if requested_carriers:
            allowed = set(_shipper_allowed_carrier_uids(uid))
            filtered_carriers = [c for c in requested_carriers if c in allowed]
            if not filtered_carriers:
                raise HTTPException(status_code=403, detail="No requested carriers are linked to your loads")

            for carrier_uid in filtered_carriers:
                try:
                    _user_events_col(carrier_uid).document(eid).set(
                        {
                            "title": title,
                            "type": "internal",
                            "all_day": all_day,
                            "start": start_ymd,
                            "end": end_ymd,
                            "description": event.get("description"),
                            "location": event.get("location"),
                            "reminders": reminders,
                            "source_uid": uid,
                            "source_role": "shipper",
                            "source_event_id": eid,
                            "created_at": now,
                            "updated_at": now,
                        },
                        merge=True,
                    )

                    notif_id = _notification_id("calendar_assigned", carrier_uid, eid)
                    db.collection("notifications").document(notif_id).set(
                        {
                            "id": notif_id,
                            "user_id": carrier_uid,
                            "notification_type": "calendar_event_assigned",
                            "category": "calendar",
                            "title": "New calendar event assigned",
                            "message": f"{title} ({start_ymd})",
                            "resource_type": "calendar_event",
                            "resource_id": eid,
                            "action_url": "/carrier-dashboard?nav=alerts",
                            "is_read": False,
                            "created_at": int(now),
                            "event_start": start_ymd,
                            "source_uid": uid,
                        },
                        merge=True,
                    )
                    wrote += 1
                except Exception:
                    continue

                await _sync_to_connected_external(carrier_uid)

            # Update source event record
            try:
                existing = snap.to_dict() or {}
                existing_list = (
                    existing.get("assigned_carrier_uids")
                    if isinstance(existing.get("assigned_carrier_uids"), list)
                    else []
                )
                merged = sorted(set([_safe_str(x) for x in existing_list if _safe_str(x)] + filtered_carriers))
                ref.set({"assigned_carrier_uids": merged, "updated_at": _now_ts()}, merge=True)
            except Exception:
                pass

            try:
                log_action(uid, "CALENDAR_EVENT_ASSIGNED", f"Assigned calendar event {eid} to {len(filtered_carriers)} carriers")
            except Exception:
                pass

            return {"ok": True, "assigned": len(filtered_carriers), "notifications_written": int(wrote)}

        # Backward compatibility: shipper -> drivers
        if not requested_drivers:
            raise HTTPException(status_code=400, detail="No carrier_uids provided")

        allowed = set(_shipper_allowed_driver_uids(uid))
        filtered_drivers = [d for d in requested_drivers if d in allowed]
        if not filtered_drivers:
            raise HTTPException(status_code=403, detail="No requested drivers are linked to your loads")

        for driver_uid in filtered_drivers:
            try:
                _user_events_col(driver_uid).document(eid).set(
                    {
                        "title": title,
                        "type": "internal",
                        "all_day": all_day,
                        "start": start_ymd,
                        "end": end_ymd,
                        "description": event.get("description"),
                        "location": event.get("location"),
                        "reminders": reminders,
                        "source_uid": uid,
                        "source_role": "shipper",
                        "source_event_id": eid,
                        "created_at": now,
                        "updated_at": now,
                    },
                    merge=True,
                )

                notif_id = _notification_id("calendar_assigned", driver_uid, eid)
                db.collection("notifications").document(notif_id).set(
                    {
                        "id": notif_id,
                        "user_id": driver_uid,
                        "notification_type": "calendar_event_assigned",
                        "category": "calendar",
                        "title": "New calendar event assigned",
                        "message": f"{title} ({start_ymd})",
                        "resource_type": "calendar_event",
                        "resource_id": eid,
                        "action_url": "/driver-dashboard?nav=alerts",
                        "is_read": False,
                        "created_at": int(now),
                        "event_start": start_ymd,
                        "source_uid": uid,
                    },
                    merge=True,
                )
                wrote += 1
            except Exception:
                continue

            await _sync_to_connected_external(driver_uid)

        try:
            existing = snap.to_dict() or {}
            existing_list = (
                existing.get("assigned_driver_uids")
                if isinstance(existing.get("assigned_driver_uids"), list)
                else []
            )
            merged = sorted(set([_safe_str(x) for x in existing_list if _safe_str(x)] + filtered_drivers))
            ref.set({"assigned_driver_uids": merged, "updated_at": _now_ts()}, merge=True)
        except Exception:
            pass

        try:
            log_action(uid, "CALENDAR_EVENT_ASSIGNED", f"Assigned calendar event {eid} to {len(filtered_drivers)} drivers")
        except Exception:
            pass

        return {"ok": True, "assigned": len(filtered_drivers), "notifications_written": int(wrote)}

    # role == carrier
    if not requested_drivers and not requested_shippers:
        raise HTTPException(status_code=400, detail="No driver_uids or shipper_uids provided")

    allowed_drivers = set(_carrier_allowed_driver_uids(uid))
    allowed_shippers = set(_carrier_allowed_shipper_uids(uid))

    filtered_drivers = [d for d in requested_drivers if d in allowed_drivers]
    filtered_shippers = [s for s in requested_shippers if s in allowed_shippers]

    # If caller requested some ids but none are allowed, treat as forbidden.
    if (requested_drivers and not filtered_drivers) and (requested_shippers and not filtered_shippers):
        raise HTTPException(status_code=403, detail="No requested users are linked to your loads")

    for driver_uid in filtered_drivers:
        try:
            _user_events_col(driver_uid).document(eid).set(
                {
                    "title": title,
                    "type": "internal",
                    "all_day": all_day,
                    "start": start_ymd,
                    "end": end_ymd,
                    "description": event.get("description"),
                    "location": event.get("location"),
                    "reminders": reminders,
                    "source_uid": uid,
                    "source_role": "carrier",
                    "source_event_id": eid,
                    "created_at": now,
                    "updated_at": now,
                },
                merge=True,
            )

            notif_id = _notification_id("calendar_assigned", driver_uid, eid)
            db.collection("notifications").document(notif_id).set(
                {
                    "id": notif_id,
                    "user_id": driver_uid,
                    "notification_type": "calendar_event_assigned",
                    "category": "calendar",
                    "title": "New calendar event assigned",
                    "message": f"{title} ({start_ymd})",
                    "resource_type": "calendar_event",
                    "resource_id": eid,
                    "action_url": "/driver-dashboard?nav=alerts",
                    "is_read": False,
                    "created_at": int(now),
                    "event_start": start_ymd,
                    "source_uid": uid,
                },
                merge=True,
            )
            wrote += 1
        except Exception:
            continue
        await _sync_to_connected_external(driver_uid)

    for shipper_uid in filtered_shippers:
        try:
            _user_events_col(shipper_uid).document(eid).set(
                {
                    "title": title,
                    "type": "internal",
                    "all_day": all_day,
                    "start": start_ymd,
                    "end": end_ymd,
                    "description": event.get("description"),
                    "location": event.get("location"),
                    "reminders": reminders,
                    "source_uid": uid,
                    "source_role": "carrier",
                    "source_event_id": eid,
                    "created_at": now,
                    "updated_at": now,
                },
                merge=True,
            )

            notif_id = _notification_id("calendar_assigned", shipper_uid, eid)
            db.collection("notifications").document(notif_id).set(
                {
                    "id": notif_id,
                    "user_id": shipper_uid,
                    "notification_type": "calendar_event_assigned",
                    "category": "calendar",
                    "title": "New calendar event assigned",
                    "message": f"{title} ({start_ymd})",
                    "resource_type": "calendar_event",
                    "resource_id": eid,
                    "action_url": "/shipper-dashboard?nav=alerts",
                    "is_read": False,
                    "created_at": int(now),
                    "event_start": start_ymd,
                    "source_uid": uid,
                },
                merge=True,
            )
            wrote += 1
        except Exception:
            continue
        await _sync_to_connected_external(shipper_uid)

    try:
        existing = snap.to_dict() or {}
        existing_dr = existing.get("assigned_driver_uids") if isinstance(existing.get("assigned_driver_uids"), list) else []
        existing_sh = existing.get("assigned_shipper_uids") if isinstance(existing.get("assigned_shipper_uids"), list) else []
        merged_dr = sorted(set([_safe_str(x) for x in existing_dr if _safe_str(x)] + filtered_drivers))
        merged_sh = sorted(set([_safe_str(x) for x in existing_sh if _safe_str(x)] + filtered_shippers))
        ref.set({"assigned_driver_uids": merged_dr, "assigned_shipper_uids": merged_sh, "updated_at": _now_ts()}, merge=True)
    except Exception:
        pass

    try:
        log_action(uid, "CALENDAR_EVENT_ASSIGNED", f"Carrier assigned calendar event {eid} to {len(filtered_shippers)} shippers and {len(filtered_drivers)} drivers")
    except Exception:
        pass

    return {"ok": True, "assigned": int(len(filtered_drivers) + len(filtered_shippers)), "notifications_written": int(wrote)}


@router.post("/driver/reminders/poll")
async def poll_driver_due_reminders(user: Dict[str, Any] = Depends(get_current_user)):
    uid = _safe_str(user.get("uid"))
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")

    now = _now_ts()
    # Only consider reminders for events within the next 48 hours.
    horizon = now + 48.0 * 3600.0

    created = 0
    for snap in _user_events_col(uid).stream():
        try:
            d = snap.to_dict() or {}
            event_id = snap.id
            start_ts = _start_ts_for_event(d)
            if not start_ts:
                continue
            if start_ts < (now - 24.0 * 3600.0) or start_ts > horizon:
                continue

            title = _safe_str(d.get("title")) or "Calendar Event"
            start_ymd = _safe_str(d.get("start"))
            reminders = _normalize_reminders(d.get("reminders"))
            if not reminders:
                continue

            for minutes in reminders:
                due_at = start_ts - float(minutes) * 60.0
                if now < due_at:
                    continue
                if now > start_ts:
                    continue

                send_id = _notification_id("calendar_reminder", uid, event_id, str(minutes))
                send_ref = _user_reminder_sends_col(uid).document(send_id)
                if send_ref.get().exists:
                    continue

                # Mark send before writing notification to reduce duplicates.
                send_ref.set({"event_id": event_id, "minutes": minutes, "sent_at": now}, merge=True)

                notif_id = _notification_id("calendar_reminder_notif", uid, event_id, str(minutes))
                db.collection("notifications").document(notif_id).set(
                    {
                        "id": notif_id,
                        "user_id": uid,
                        "notification_type": "calendar_event_reminder",
                        "category": "calendar",
                        "title": f"Reminder: {title}",
                        "message": f"Starts on {start_ymd}",
                        "resource_type": "calendar_event",
                        "resource_id": event_id,
                        "action_url": "/driver-dashboard?nav=alerts",
                        "is_read": False,
                        "created_at": int(now),
                        "event_start": start_ymd,
                        "reminder_minutes": minutes,
                    },
                    merge=True,
                )
                created += 1
        except Exception:
            continue

    return {"ok": True, "created": int(created)}
