import firebase_admin
from firebase_admin import credentials, firestore, storage
import os
from typing import Any, Dict
from datetime import timedelta

# Initialize Firebase only once
if not firebase_admin._apps:
    # Get the directory where this file is located
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # Go up one level to get to the apps folder
    apps_dir = os.path.dirname(current_dir)
    # Path to serviceAccountKey.json
    service_account_path = os.path.join(apps_dir, "serviceAccountKey.json")
    
    cred = credentials.Certificate(service_account_path)
    firebase_admin.initialize_app(cred, {
        'storageBucket': 'freightpowerai-e90fe.firebasestorage.app'
    })

db = firestore.client()
bucket = storage.bucket()


def signed_download_url(
    storage_path: str,
    *,
    filename: str | None = None,
    disposition: str = "attachment",
    ttl_seconds: int = 15 * 60,
) -> str | None:
    """Generate a short-lived signed download URL for a storage object.

    This avoids making objects public while still allowing browsers to download
    without attaching auth headers.
    """

    path = str(storage_path or "").strip()
    if not path:
        return None

    try:
        blob = bucket.blob(path)
        safe_name = None
        if filename:
            safe_name = str(filename).replace("\n", " ").replace("\r", " ").replace('"', "'").strip() or None

        kwargs: Dict[str, Any] = {
            "expiration": timedelta(seconds=int(ttl_seconds)),
            "method": "GET",
            "version": "v4",
        }
        if safe_name:
            kwargs["response_disposition"] = f"{disposition}; filename=\"{safe_name}\""

        return blob.generate_signed_url(**kwargs)
    except Exception:
        return None

# Helper to log actions
def log_action(user_id: str, action: str, details: str, ip: str = None):
    try:
        db.collection("audit_logs").add({
            "user_id": user_id,
            "action": action,
            "details": details,
            "ip_address": ip,
            "timestamp": firestore.SERVER_TIMESTAMP
        })
    except Exception as e:
        print(f"Audit log error: {e}")


def record_profile_update(
    user_id: str,
    changes: Dict[str, Any],
    source: str,
    actor_id: str | None = None,
    actor_role: str | None = None,
    fmcsa_verification: Dict[str, Any] | None = None,
):
    """Record a per-user profile update event.

    Stored under: users/{uid}/profile_updates (subcollection)
    """
    try:
        payload: Dict[str, Any] = {
            "source": source,
            "changes": changes,
            "actor_id": actor_id or user_id,
            "actor_role": actor_role,
            "timestamp": firestore.SERVER_TIMESTAMP,
        }
        if fmcsa_verification is not None:
            payload["fmcsa_verification"] = fmcsa_verification

        db.collection("users").document(user_id).collection("profile_updates").add(payload)
    except Exception as e:
        print(f"Profile update history error: {e}")