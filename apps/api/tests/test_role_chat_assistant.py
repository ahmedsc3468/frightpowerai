from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional, Tuple
import sys
import time

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

pytest.importorskip("firebase_admin")


def _split_path(path: str) -> List[str]:
    return [p for p in str(path or "").strip("/").split("/") if p]


@dataclass
class _Snap:
    id: str
    _data: Optional[Dict[str, Any]]

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data or {})


class _Query:
    def __init__(
        self,
        db: "_FakeDB",
        collection_path: str,
        filters: Optional[List[Tuple[str, str, Any]]] = None,
        limit_n: Optional[int] = None,
    ):
        self._db = db
        self._collection_path = collection_path
        self._filters = list(filters or [])
        self._limit_n = limit_n

    def where(self, field_path: str, op_string: str, value: Any):
        return _Query(
            self._db,
            self._collection_path,
            filters=[*self._filters, (str(field_path), str(op_string), value)],
            limit_n=self._limit_n,
        )

    def limit(self, n: int):
        return _Query(
            self._db,
            self._collection_path,
            filters=list(self._filters),
            limit_n=max(0, int(n)),
        )

    def stream(self) -> Iterable[_Snap]:
        rows = self._db._collection_docs(self._collection_path)
        snaps: List[_Snap] = []
        for doc_id, data in rows:
            if not self._passes_filters(data):
                continue
            snaps.append(_Snap(doc_id, data))
        if self._limit_n is not None:
            snaps = snaps[: self._limit_n]
        return snaps

    def _passes_filters(self, data: Dict[str, Any]) -> bool:
        for field, op, value in self._filters:
            if op != "==":
                return False
            if data.get(field) != value:
                return False
        return True


class _Collection(_Query):
    def __init__(self, db: "_FakeDB", collection_path: str):
        super().__init__(db, collection_path)
        self._collection_path = collection_path

    def document(self, doc_id: Optional[str] = None):
        if not doc_id:
            doc_id = f"auto_{self._db.next_id(self._collection_path)}"
        return _DocRef(self._db, f"{self._collection_path}/{doc_id}")

    def add(self, data: Dict[str, Any]):
        doc = self.document()
        doc.set(data)
        return doc


class _DocRef:
    def __init__(self, db: "_FakeDB", doc_path: str):
        self._db = db
        self._doc_path = doc_path.strip("/")

    @property
    def id(self) -> str:
        return _split_path(self._doc_path)[-1]

    def get(self, transaction=None):
        _ = transaction
        data = self._db._docs.get(self._doc_path)
        return _Snap(self.id, data)

    def set(self, data: Dict[str, Any], merge: bool = False):
        cur = dict(self._db._docs.get(self._doc_path) or {})
        if not merge:
            self._db._docs[self._doc_path] = dict(data or {})
            return
        cur.update(dict(data or {}))
        self._db._docs[self._doc_path] = cur

    def update(self, data: Dict[str, Any]):
        self.set(data, merge=True)

    def delete(self):
        self._db._docs.pop(self._doc_path, None)

    def collection(self, name: str):
        return _Collection(self._db, f"{self._doc_path}/{name}")


class _CollectionGroupQuery:
    def __init__(self, db: "_FakeDB", group_name: str, limit_n: Optional[int] = None):
        self._db = db
        self._group_name = str(group_name or "").strip()
        self._limit_n = limit_n

    def limit(self, n: int):
        return _CollectionGroupQuery(self._db, self._group_name, limit_n=max(0, int(n)))

    def stream(self) -> Iterable[_Snap]:
        snaps: List[_Snap] = []
        for path, data in self._db._docs.items():
            parts = _split_path(path)
            if len(parts) < 2:
                continue
            if parts[-2] != self._group_name:
                continue
            snaps.append(_Snap(parts[-1], data))
        if self._limit_n is not None:
            snaps = snaps[: self._limit_n]
        return snaps


class _FakeDB:
    def __init__(self):
        self._docs: Dict[str, Dict[str, Any]] = {}
        self._id_counters: Dict[str, int] = {}

    def next_id(self, collection_path: str) -> int:
        key = str(collection_path or "")
        n = int(self._id_counters.get(key) or 0) + 1
        self._id_counters[key] = n
        return n

    def collection(self, name: str):
        return _Collection(self, str(name))

    def collection_group(self, group_name: str):
        return _CollectionGroupQuery(self, group_name)

    def _collection_docs(self, collection_path: str) -> List[Tuple[str, Dict[str, Any]]]:
        prefix = _split_path(collection_path)
        out: List[Tuple[str, Dict[str, Any]]] = []
        for full_path, data in self._docs.items():
            parts = _split_path(full_path)
            if len(parts) != len(prefix) + 1:
                continue
            if parts[:-1] != prefix:
                continue
            out.append((parts[-1], dict(data or {})))
        return out


@pytest.fixture()
def assistant_env(monkeypatch):
    from apps.api import main, role_chat

    fake_db = _FakeDB()

    # Ensure all role assistant endpoints use isolated fake storage.
    monkeypatch.setattr(main, "db", fake_db, raising=False)
    monkeypatch.setattr(role_chat, "db", fake_db, raising=False)
    monkeypatch.setattr(role_chat, "log_action", lambda *a, **k: None, raising=False)
    monkeypatch.setattr(main, "log_action", lambda *a, **k: None, raising=False)

    # Force deterministic fallback replies in endpoint tests.
    monkeypatch.setattr(main.settings, "GROQ_API_KEY", "", raising=False)
    monkeypatch.setattr(role_chat.settings, "GROQ_API_KEY", "", raising=False)

    # Seed representative data for tools/context/analytics.
    now_ts = float(time.time())
    fake_db.collection("loads").document("L_POSTED_1").set(
        {
            "load_id": "L_POSTED_1",
            "status": "posted",
            "origin": "Chicago, IL",
            "destination": "Dallas, TX",
            "pickup_date": "2026-01-03",
            "delivery_date": "2026-01-05",
            "linehaul_rate": 1400,
            "created_by": "shipper1",
            "created_at": now_ts - 3600,
            "updated_at": now_ts - 1200,
        }
    )
    fake_db.collection("loads").document("L_POSTED_OLD").set(
        {
            "load_id": "L_POSTED_OLD",
            "status": "posted",
            "origin": "Phoenix, AZ",
            "destination": "Denver, CO",
            "pickup_date": "2025-12-01",
            "delivery_date": "2025-12-02",
            "linehaul_rate": 1200,
            "created_by": "shipper1",
            "created_at": now_ts - (40 * 86400),
            "updated_at": now_ts - (39 * 86400),
        }
    )
    fake_db.collection("loads").document("L_DRIVER_1").set(
        {
            "load_id": "L_DRIVER_1",
            "status": "in_transit",
            "origin": "California",
            "destination": "Texas",
            "pickup_date": "2026-01-04",
            "delivery_date": "2026-01-07",
            "linehaul_rate": 2100,
            "assigned_driver": "driver1",
            "assigned_carrier": "carrier1",
            "carrier_id": "carrier1",
            "created_by": "shipper1",
            "offers": [],
            "last_location": {"latitude": 33.4484, "longitude": -112.0740, "timestamp": 1772542200.0},
            "additional_stops": [
                {"type": "fuel_stop", "location": "Albuquerque, NM", "eta": "2026-01-05 10:00 AM"},
                {"type": "weigh_station", "location": "Amarillo, TX", "eta": "2026-01-05 2:00 PM"},
            ],
            "created_at": now_ts - 7200,
            "updated_at": now_ts - 1800,
        }
    )
    fake_db.collection("loads").document("FP-26ATL-YJ405-S895159").set(
        {
            "load_id": "FP-26ATL-YJ405-S895159",
            "status": "posted",
            "origin": "Chicago, IL",
            "destination": "Dallas, TX",
            "created_by": "shipper1",
            "offers": [
                {"offer_id": "off_1", "carrier_id": "carrier1", "carrier_name": "Carrier One", "status": "pending"}
            ],
            "created_at": now_ts - 5400,
            "updated_at": now_ts - 2400,
        }
    )
    fake_db.collection("marketplace_services").document("svc_1").set(
        {"id": "svc_1", "name": "Roadside Hero", "category": "roadside", "location": "Dallas"}
    )
    fake_db.collection("config").document("driver_required_documents").set(
        {
            "required": [
                {"key": "cdl", "title": "CDL"},
                {"key": "medical_card", "title": "Medical Card"},
                {"key": "consent", "title": "Consent"},
            ]
        }
    )
    fake_db.collection("drivers").document("driver1").set(
        {
            "driver_id": "driver1",
            "name": "Abbas Khan",
            "carrier_id": "carrier1",
            "is_available": True,
            "status": "active",
        }
    )
    fake_db.collection("drivers").document("driver2").set(
        {
            "driver_id": "driver2",
            "name": "Driver Two",
            "carrier_id": "carrier1",
            "is_available": False,
            "status": "active",
        }
    )
    fake_db.collection("users").document("driver2").set(
        {"name": "Driver Two", "is_available": False}
    )

    client = TestClient(main.app)
    env = {"client": client, "main": main, "role_chat": role_chat, "db": fake_db}
    try:
        yield env
    finally:
        main.app.dependency_overrides = {}


def _set_user(env: Dict[str, Any], user: Dict[str, Any]) -> None:
    env["main"].app.dependency_overrides[env["role_chat"].get_current_user] = lambda: dict(user)


def _set_admin(env: Dict[str, Any], user: Dict[str, Any]) -> None:
    env["main"].app.dependency_overrides[env["role_chat"].require_admin] = lambda: dict(user)


def test_role_assistant_conversation_lifecycle(assistant_env):
    client = assistant_env["client"]
    _set_user(
        assistant_env,
        {
            "uid": "driver1",
            "role": "driver",
            "name": "Driver One",
            "onboarding_completed": False,
            "dot_number": "",
            "onboarding_data": {"documents": []},
        },
    )

    post = client.post("/chat/assistant", json={"message": "Summarize my current load status"})
    assert post.status_code == 200
    payload = post.json()
    conversation_id = str(payload.get("conversation_id") or "").strip()
    message_id = str(payload.get("message_id") or "").strip()
    assert conversation_id
    assert message_id
    assert payload.get("reply")

    listed = client.get("/chat/assistant/conversations?limit=20")
    assert listed.status_code == 200
    rows = (listed.json() or {}).get("conversations") or []
    assert any(str(r.get("conversation_id")) == conversation_id for r in rows)

    detail = client.get(f"/chat/assistant/conversations/{conversation_id}?limit=200")
    assert detail.status_code == 200
    messages = (detail.json() or {}).get("messages") or []
    assert len(messages) == 2
    assert [m.get("role") for m in messages] == ["user", "assistant"]
    assert any(str(m.get("id")) == message_id for m in messages)

    exported_md = client.get(
        f"/chat/assistant/conversations/{conversation_id}/export?format=markdown&limit=200"
    )
    assert exported_md.status_code == 200
    assert conversation_id in exported_md.text
    assert "Summarize my current load status" in exported_md.text

    exported_json = client.get(
        f"/chat/assistant/conversations/{conversation_id}/export?format=json&limit=200"
    )
    assert exported_json.status_code == 200
    exported_payload = exported_json.json() or {}
    assert str(exported_payload.get("conversation_id") or "") == conversation_id
    assert len(exported_payload.get("messages") or []) == 2

    deleted = client.delete(f"/chat/assistant/conversations/{conversation_id}")
    assert deleted.status_code == 200
    deleted_payload = deleted.json() or {}
    assert deleted_payload.get("ok") is True
    assert int(deleted_payload.get("deleted_messages") or 0) == 2

    after_delete = client.get(f"/chat/assistant/conversations/{conversation_id}?limit=50")
    assert after_delete.status_code == 404


def test_role_assistant_permissions_for_expanded_tools(assistant_env):
    client = assistant_env["client"]

    # Driver cannot use carrier-only marketplace search tool.
    _set_user(assistant_env, {"uid": "driver1", "role": "driver"})
    blocked = client.post(
        "/chat/assistant",
        json={
            "message": "Find marketplace loads",
            "tool_name": "get_marketplace_loads",
            "tool_args": {"limit": 5},
        },
    )
    assert blocked.status_code == 200
    blocked_tools = (blocked.json() or {}).get("tools_executed") or []
    assert len(blocked_tools) == 1
    assert blocked_tools[0].get("ok") is False
    assert "not allowed for role 'driver'" in str(blocked_tools[0].get("error") or "")

    # Carrier can use the same tool and receives data.
    _set_user(assistant_env, {"uid": "carrier1", "role": "carrier"})
    allowed = client.post(
        "/chat/assistant",
        json={
            "message": "Find marketplace loads",
            "tool_name": "get_marketplace_loads",
            "tool_args": {"limit": 5},
        },
    )
    assert allowed.status_code == 200
    allowed_tools = (allowed.json() or {}).get("tools_executed") or []
    assert len(allowed_tools) == 1
    assert allowed_tools[0].get("ok") is True
    result = allowed_tools[0].get("result") or {}
    assert int(result.get("total") or 0) >= 1


def test_role_assistant_infers_and_fetches_driver_location(assistant_env):
    client = assistant_env["client"]
    _set_user(
        assistant_env,
        {
            "uid": "driver1",
            "role": "driver",
            "name": "Abbas Khan",
            "onboarding_completed": True,
        },
    )

    res = client.post("/chat/assistant", json={"message": "whats my location?"})
    assert res.status_code == 200
    payload = res.json() or {}
    tools = payload.get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_location_snapshot"
    assert tools[0].get("ok") is True
    location = ((tools[0].get("result") or {}).get("location") or {})
    assert float(location.get("latitude")) == pytest.approx(33.4484)
    assert float(location.get("longitude")) == pytest.approx(-112.074)


def test_role_assistant_infers_and_fetches_associated_drivers(assistant_env):
    client = assistant_env["client"]
    _set_user(
        assistant_env,
        {
            "uid": "driver1",
            "role": "driver",
            "name": "Abbas Khan",
            "onboarding_completed": True,
        },
    )

    res = client.post("/chat/assistant", json={"message": "who are the drivers associated with me"})
    assert res.status_code == 200
    payload = res.json() or {}
    tools = payload.get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_associated_drivers"
    assert tools[0].get("ok") is True
    result = tools[0].get("result") or {}
    assert "carrier_id" not in result
    assert int(result.get("total") or 0) >= 2
    names = {str(r.get("name") or "") for r in (result.get("drivers") or [])}
    assert "Abbas Khan" in names
    assert "Driver Two" in names
    # Driver role must not receive operational/private IDs for associated drivers.
    first_driver = (result.get("drivers") or [{}])[0]
    assert "driver_id" not in first_driver
    assert "status" not in first_driver
    assert "is_available" not in first_driver
    assert "vehicle_type" not in first_driver


def test_shipper_natural_language_posted_count_uses_live_load_tool(assistant_env):
    client = assistant_env["client"]
    _set_user(
        assistant_env,
        {
            "uid": "shipper1",
            "role": "shipper",
            "name": "Shipper One",
            "onboarding_completed": True,
        },
    )

    res = client.post("/chat/assistant", json={"message": "how many loads have i posted from day 1"})
    assert res.status_code == 200
    payload = res.json() or {}
    tools = payload.get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "list_my_loads"
    assert tools[0].get("ok") is True
    result = tools[0].get("result") or {}
    assert str(result.get("status_filter") or "") == "posted"
    assert int(result.get("total") or 0) == 3


def test_shipper_natural_language_in_transit_count_uses_status_alias(assistant_env):
    client = assistant_env["client"]
    _set_user(
        assistant_env,
        {
            "uid": "shipper1",
            "role": "shipper",
            "name": "Shipper One",
            "onboarding_completed": True,
        },
    )

    res = client.post("/chat/assistant", json={"message": "how many loads are currently in transit?"})
    assert res.status_code == 200
    payload = res.json() or {}
    tools = payload.get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "list_my_loads"
    assert tools[0].get("ok") is True
    result = tools[0].get("result") or {}
    assert str(result.get("status_filter") or "") == "in_transit"
    assert int(result.get("total") or 0) == 1


def test_offer_query_extracts_real_load_id_instead_of_first_word(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "shipper1", "role": "shipper"})

    res = client.post(
        "/chat/assistant",
        json={"message": "show offers for load FP-26ATL-YJ405-S895159"},
    )
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_load_offers"
    assert tools[0].get("ok") is True
    result = tools[0].get("result") or {}
    assert str(result.get("load_id") or "") == "FP-26ATL-YJ405-S895159"
    assert int(result.get("total") or 0) >= 1


def test_show_my_offers_without_load_id_uses_summary_tool(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "shipper1", "role": "shipper"})

    res = client.post("/chat/assistant", json={"message": "show my offers"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_load_summary"
    assert tools[0].get("ok") is True


def test_compliance_steps_phrase_maps_to_compliance_tasks_tool(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "carrier1", "role": "carrier", "onboarding_completed": False})

    res = client.post("/chat/assistant", json={"message": "show me compliance steps"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_compliance_tasks"
    assert tools[0].get("ok") is True


def test_invoice_payment_status_phrase_maps_to_financial_snapshot_tool(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "carrier1", "role": "carrier"})

    res = client.post("/chat/assistant", json={"message": "invoice payment status"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_earnings_snapshot"
    assert tools[0].get("ok") is True


def test_active_loads_query_maps_to_active_status_filter(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "shipper1", "role": "shipper"})

    res = client.post("/chat/assistant", json={"message": "list my active loads"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "list_my_loads"
    assert tools[0].get("ok") is True
    result = tools[0].get("result") or {}
    statuses = set(result.get("statuses_filter") or [])
    assert "posted" in statuses
    assert int(result.get("total") or 0) >= 1


def test_next_stops_and_etas_query_maps_to_structured_tool(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "driver1", "role": "driver"})

    res = client.post("/chat/assistant", json={"message": "Show my next stops and ETAs"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_next_stops_etas"
    assert tools[0].get("ok") is True
    result = tools[0].get("result") or {}
    assert bool(result.get("has_active_load"))
    assert int(result.get("total") or 0) >= 1


def test_today_date_range_intent_filters_load_counts(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "shipper1", "role": "shipper"})

    res = client.post("/chat/assistant", json={"message": "how many posted loads do i have today"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "list_my_loads"
    result = tools[0].get("result") or {}
    assert str(result.get("status_filter") or "") == "posted"
    assert result.get("date_from_ts") is not None
    assert result.get("date_to_ts") is not None
    # Only today's posted loads should be counted, not historical posted loads.
    assert int(result.get("total") or 0) == 2


def test_shipper_cannot_access_associated_drivers_tool(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "shipper1", "role": "shipper"})

    res = client.post("/chat/assistant", json={"message": "who are the drivers associated with me"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_associated_drivers"
    assert tools[0].get("ok") is False
    assert "not allowed for role 'shipper'" in str(tools[0].get("error") or "")


def test_driver_cannot_read_unassigned_load_details_by_id(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "driver1", "role": "driver"})

    res = client.post(
        "/chat/assistant",
        json={
            "message": "show load details",
            "tool_name": "get_load_details",
            "tool_args": {"load_id": "L_POSTED_1"},
        },
    )
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    assert tools[0].get("name") == "get_load_details"
    assert tools[0].get("ok") is False
    assert "role-visible loads" in str(tools[0].get("error") or "")


def test_driver_tool_payload_redacts_ids_and_tokens(assistant_env):
    client = assistant_env["client"]
    _set_user(
        assistant_env,
        {
            "uid": "driver1",
            "role": "driver",
            "name": "Driver One",
            "onboarding_completed": True,
            "email": "driver1@example.com",
        },
    )

    res = client.post("/chat/assistant", json={"message": "who are the drivers associated with me"})
    assert res.status_code == 200
    tools = (res.json() or {}).get("tools_executed") or []
    assert len(tools) == 1
    result = tools[0].get("result") or {}
    assert "carrier_id" not in result
    for row in (result.get("drivers") or []):
        assert "driver_id" not in row


def test_non_admin_reply_text_sanitizer_masks_sensitive_tokens():
    from apps.api import role_chat

    raw = "driver_id: abc123 carrier_id=xyz789 email test@example.com uid: p123 tax_id=7890"
    out = role_chat._sanitize_reply_text_for_role("driver", raw)
    assert "abc123" not in out
    assert "xyz789" not in out
    assert "test@example.com" not in out
    assert "p123" not in out
    assert "7890" not in out


def test_role_assistant_preferences_round_trip_and_validation(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "shipper1", "role": "shipper"})

    defaults = client.get("/chat/assistant/preferences")
    assert defaults.status_code == 200
    defaults_payload = defaults.json() or {}
    assert defaults_payload.get("tone") == "balanced"
    assert int(defaults_payload.get("history_window") or 0) == 30

    updated = client.patch(
        "/chat/assistant/preferences",
        json={
            "tone": "direct",
            "verbosity": "short",
            "response_format": "bullets",
            "auto_tool_inference_default": False,
            "history_window": 45,
        },
    )
    assert updated.status_code == 200
    updated_payload = updated.json() or {}
    assert updated_payload.get("tone") == "direct"
    assert updated_payload.get("verbosity") == "short"
    assert updated_payload.get("response_format") == "bullets"
    assert updated_payload.get("auto_tool_inference_default") is False
    assert int(updated_payload.get("history_window") or 0) == 45

    invalid = client.patch("/chat/assistant/preferences", json={"tone": "casual"})
    assert invalid.status_code == 400
    assert "Invalid tone" in str((invalid.json() or {}).get("detail") or "")


def test_role_assistant_analytics_user_and_admin_views(assistant_env):
    client = assistant_env["client"]

    _set_user(assistant_env, {"uid": "driver1", "role": "driver"})
    first = client.post("/chat/assistant", json={"message": "List my loads in transit"})
    assert first.status_code == 200
    second = client.post("/chat/assistant", json={"message": "Show my next stops and ETAs"})
    assert second.status_code == 200

    my_analytics = client.get("/chat/assistant/analytics?days=30&limit=200")
    assert my_analytics.status_code == 200
    my_payload = my_analytics.json() or {}
    assert int(my_payload.get("total_requests") or 0) >= 2
    assert int(my_payload.get("successful_requests") or 0) >= 2
    assert float(my_payload.get("estimated_cost_usd") or 0.0) >= 0.0

    _set_admin(assistant_env, {"uid": "admin1", "role": "admin"})
    admin_analytics = client.get("/chat/assistant/admin/analytics?days=30&limit=1000")
    assert admin_analytics.status_code == 200
    admin_payload = admin_analytics.json() or {}
    assert int(admin_payload.get("total_events") or 0) >= 2
    by_role = admin_payload.get("by_role") or {}
    assert int(by_role.get("driver") or 0) >= 2

    invalid_role = client.get("/chat/assistant/admin/analytics?role=invalid")
    assert invalid_role.status_code == 400


def test_role_assistant_message_ids_are_unique_across_turns(assistant_env):
    client = assistant_env["client"]
    _set_user(assistant_env, {"uid": "driver1", "role": "driver"})

    cid = "driver_thread_dedupe_test"
    r1 = client.post("/chat/assistant", json={"message": "Summarize my current load status", "conversation_id": cid})
    r2 = client.post("/chat/assistant", json={"message": "List my loads in transit", "conversation_id": cid})
    assert r1.status_code == 200
    assert r2.status_code == 200

    m1 = str((r1.json() or {}).get("message_id") or "")
    m2 = str((r2.json() or {}).get("message_id") or "")
    assert m1
    assert m2
    assert m1 != m2

    convo = client.get(f"/chat/assistant/conversations/{cid}?limit=200")
    assert convo.status_code == 200
    messages = (convo.json() or {}).get("messages") or []
    ids = [str(m.get("id") or "") for m in messages]
    assert len(messages) == 4
    assert len(ids) == len(set(ids))
    assert ids.count(m1) == 1
    assert ids.count(m2) == 1


def test_compose_llm_reply_retries_and_recovers(monkeypatch):
    from apps.api import role_chat

    monkeypatch.setattr(role_chat.settings, "GROQ_API_KEY", "test-key", raising=False)
    sleep_calls: List[int] = []
    monkeypatch.setattr(role_chat, "_sleep_with_backoff", lambda attempt: sleep_calls.append(int(attempt)))

    state = {"calls": 0}

    class _FakeCompletions:
        def create(self, **kwargs):
            _ = kwargs
            state["calls"] += 1
            if state["calls"] < 3:
                raise RuntimeError("503 Service Unavailable")
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="retry success"))]
            )

    class _FakeGroq:
        def __init__(self, **kwargs):
            _ = kwargs
            self.chat = SimpleNamespace(completions=_FakeCompletions())

    fake_module = ModuleType("groq")
    fake_module.Groq = _FakeGroq
    monkeypatch.setitem(sys.modules, "groq", fake_module)

    out = role_chat._compose_llm_reply(
        role_scope="driver",
        message="status update",
        history=[],
        tool_results=[],
    )
    assert out == "retry success"
    assert state["calls"] == 3
    assert sleep_calls == [1, 2]


def test_compose_llm_reply_falls_back_after_retry_exhaustion(monkeypatch):
    from apps.api import role_chat

    monkeypatch.setattr(role_chat.settings, "GROQ_API_KEY", "test-key", raising=False)
    sleep_calls: List[int] = []
    monkeypatch.setattr(role_chat, "_sleep_with_backoff", lambda attempt: sleep_calls.append(int(attempt)))

    class _AlwaysFailCompletions:
        def create(self, **kwargs):
            _ = kwargs
            raise RuntimeError("timeout while contacting upstream")

    class _AlwaysFailGroq:
        def __init__(self, **kwargs):
            _ = kwargs
            self.chat = SimpleNamespace(completions=_AlwaysFailCompletions())

    fake_module = ModuleType("groq")
    fake_module.Groq = _AlwaysFailGroq
    monkeypatch.setitem(sys.modules, "groq", fake_module)

    out = role_chat._compose_llm_reply(
        role_scope="driver",
        message="status update",
        history=[],
        tool_results=[],
    )
    assert "driver workflow" in out.lower()
    assert sleep_calls == [1, 2]


def test_admin_analytics_denies_non_admin_when_dependency_raises(assistant_env):
    client = assistant_env["client"]

    def _deny_non_admin():
        raise HTTPException(status_code=403, detail="Admin access required")

    assistant_env["main"].app.dependency_overrides[assistant_env["role_chat"].require_admin] = _deny_non_admin
    res = client.get("/chat/assistant/admin/analytics")
    assert res.status_code == 403


def test_driver_aihub_scroll_is_container_scoped():
    # Static regression check: AI Hub should not force page-level scroll jumps.
    root = Path(__file__).resolve().parents[3]
    aihub_path = root / "src" / "components" / "driver" / "AiHub.jsx"
    src = aihub_path.read_text(encoding="utf-8")

    assert "window.scrollTo(" not in src
    assert "document.body.scrollTop" not in src
    assert "document.documentElement.scrollTop" not in src
    assert "messagesContainerRef.current" in src
    assert "node.scrollTo({ top: node.scrollHeight" in src
