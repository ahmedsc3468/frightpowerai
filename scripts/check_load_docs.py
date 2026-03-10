from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


PUBLIC_ID = "FP-26ATL-SH140-S847616"
LOAD_NUMBER = "FP-ATL-LD-000002"
EXPECTED_FILENAMES = {
    "bol_signature_FP-26ATL-SH140-S847616_1772558790.png",
    "bol_FP-ATL-LD-000002.pdf",
    "rate_confirmation_FP-ATL-LD-000002.pdf",
}


@dataclass(frozen=True)
class LoadMatch:
    doc_id: str
    matched_by: str
    load_id: str
    load_number: str
    status: str
    pickup_confirmed: bool
    picked_up: bool


def _safe_bool(v: Any) -> bool:
    return bool(v)


def main() -> int:
    # Initialize Firebase Admin from the local service account JSON.
    # Note: this script prints *no secrets*; it only reports existence.
    import firebase_admin
    from firebase_admin import credentials, firestore, storage

    repo_root = Path(__file__).resolve().parents[1]
    sa_path = repo_root / "apps" / "serviceAccountKey.json"
    if not sa_path.exists():
        raise FileNotFoundError(f"Missing service account JSON: {sa_path}")

    if not firebase_admin._apps:
        cred = credentials.Certificate(str(sa_path))
        firebase_admin.initialize_app(
            cred,
            {
                # Must match apps/api/database.py
                "storageBucket": "freightpowerai-e90fe.firebasestorage.app",
            },
        )

    db = firestore.client()
    default_bucket = storage.bucket()
    project_id = getattr(firebase_admin.get_app(), "project_id", None) or getattr(firebase_admin.get_app().cred, "project_id", None)
    fallback_bucket_name = f"{project_id}.appspot.com" if project_id else ""
    fallback_bucket = storage.bucket(fallback_bucket_name) if fallback_bucket_name else None
    loads = db.collection("loads")

    matches_by_id: dict[str, LoadMatch] = {}

    def add_match(doc_id: str, matched_by: str, data: dict[str, Any]) -> None:
        matches_by_id[doc_id] = LoadMatch(
            doc_id=str(doc_id),
            matched_by=matched_by,
            load_id=str(data.get("load_id") or ""),
            load_number=str(data.get("load_number") or ""),
            status=str(data.get("status") or ""),
            pickup_confirmed=_safe_bool(data.get("pickup_confirmed_at")),
            picked_up=_safe_bool(data.get("picked_up_at")),
        )

    # Field queries
    for field, value in [
        ("load_id", PUBLIC_ID),
        ("load_number", LOAD_NUMBER),
        ("load_id", LOAD_NUMBER),
    ]:
        for snap in loads.where(field, "==", value).limit(10).stream():
            add_match(snap.id, f"{field}=={value}", snap.to_dict() or {})

    # Direct doc-id checks (common patterns)
    for doc_id in [PUBLIC_ID, LOAD_NUMBER]:
        snap = loads.document(str(doc_id)).get()
        if snap.exists:
            add_match(snap.id, "doc_id", snap.to_dict() or {})

    print(f"bucket_name={default_bucket.name}")
    print(f"fallback_bucket_name={fallback_bucket.name if fallback_bucket else ''}")
    print(f"load_matches={len(matches_by_id)}")
    for m in matches_by_id.values():
        print(
            "-",
            {
                "doc_id": m.doc_id,
                "matched_by": m.matched_by,
                "load_id": m.load_id,
                "load_number": m.load_number,
                "status": m.status,
                "pickup_confirmed": m.pickup_confirmed,
                "picked_up": m.picked_up,
            },
        )

    # For each matched load, inspect its linked docs.
    for m in matches_by_id.values():
        docs_col = loads.document(m.doc_id).collection("documents")
        docs = list(docs_col.stream())
        print(f"\nload={m.doc_id} documents={len(docs)}")

        hits: list[dict[str, Any]] = []
        for d in docs:
            dd = d.to_dict() or {}
            storage_path = str(dd.get("storage_path") or "").strip()
            filename = str(dd.get("filename") or dd.get("file_name") or "").strip()
            kind = str(dd.get("kind") or dd.get("document_type") or dd.get("type") or "").strip().upper()

            is_expected = False
            if filename and filename in EXPECTED_FILENAMES:
                is_expected = True
            if storage_path and any(storage_path.endswith(x) for x in EXPECTED_FILENAMES):
                is_expected = True
            if not is_expected:
                continue

            storage_exists_default = False
            storage_exists_fallback = False
            if storage_path:
                try:
                    storage_exists_default = default_bucket.blob(storage_path).exists()
                except Exception:
                    storage_exists_default = False
                if fallback_bucket:
                    try:
                        storage_exists_fallback = fallback_bucket.blob(storage_path).exists()
                    except Exception:
                        storage_exists_fallback = False

            hits.append(
                {
                    "doc_id": d.id,
                    "kind": kind,
                    "filename": filename,
                    "storage_path": storage_path,
                    "storage_exists_default": storage_exists_default,
                    "storage_exists_fallback": storage_exists_fallback,
                }
            )

        print(f"expected_docs_found={len(hits)}")
        for h in hits:
            print("  -", h)

        # Targeted Storage listing for this load prefix (bounded)
        prefix = f"load_documents/{m.doc_id}/"
        for bucket_label, b in [("default", default_bucket), ("fallback", fallback_bucket)]:
            if not b:
                continue
            try:
                blobs = list(b.list_blobs(prefix=prefix, max_results=100))
            except Exception as e:
                print(f"storage_list_error[{bucket_label}]", type(e).__name__, str(e))
                continue
            print(f"storage_prefix[{bucket_label}]={prefix} count={len(blobs)}")
            for blob in blobs[:20]:
                print("   ", blob.name)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
