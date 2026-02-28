from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi.testclient import TestClient
import pytest


@dataclass
class _Snap:
    id: str
    _data: Optional[Dict[str, Any]]

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data or {})


class _DocRef:
    def __init__(self, db: "_FakeDB", path: str):
        self._db = db
        self._path = path

    @property
    def id(self) -> str:
        return self._path.split("/")[-1]

    def get(self, transaction=None):
        _ = transaction
        col_path, doc_id = self._split()
        return _Snap(doc_id, self._db._collections.get(col_path, {}).get(doc_id))

    def set(self, data: Dict[str, Any], merge: bool = False):
        col_path, doc_id = self._split()
        col = self._db._collections.setdefault(col_path, {})
        if not merge or doc_id not in col:
            col[doc_id] = dict(data)
            return
        merged = dict(col[doc_id])
        merged.update(dict(data))
        col[doc_id] = merged

    def update(self, data: Dict[str, Any]):
        self.set(data, merge=True)

    def _split(self) -> Tuple[str, str]:
        parts = self._path.split("/")
        col_path = "/".join(parts[:-1])
        doc_id = parts[-1]
        return col_path, doc_id


class _Query:
    def __init__(self, collection: "_Collection", filters: Optional[List[Tuple[str, str, Any]]] = None, limit_n: Optional[int] = None):
        self._collection = collection
        self._filters = list(filters or [])
        self._limit_n = limit_n

    def where(self, field: str, op: str, value: Any) -> "_Query":
        return _Query(self._collection, filters=[*self._filters, (field, op, value)], limit_n=self._limit_n)

    def limit(self, n: int) -> "_Query":
        return _Query(self._collection, filters=self._filters, limit_n=int(n))

    def stream(self) -> Iterable[_Snap]:
        docs = self._collection._db._collections.get(self._collection._path, {})
        snaps: List[_Snap] = []
        for doc_id, data in docs.items():
            if not self._matches(data):
                continue
            snaps.append(_Snap(doc_id, data))
            if self._limit_n is not None and len(snaps) >= self._limit_n:
                break
        return snaps

    def _matches(self, data: Dict[str, Any]) -> bool:
        for field, op, value in self._filters:
            if op != "==":
                raise NotImplementedError(op)
            if data.get(field) != value:
                return False
        return True


class _Collection:
    def __init__(self, db: "_FakeDB", path: str):
        self._db = db
        self._path = path

    def document(self, doc_id: str) -> _DocRef:
        return _DocRef(self._db, f"{self._path}/{doc_id}")

    def where(self, field: str, op: str, value: Any) -> _Query:
        return _Query(self).where(field, op, value)

    def limit(self, n: int) -> _Query:
        return _Query(self).limit(n)

    def stream(self) -> Iterable[_Snap]:
        return _Query(self).stream()


class _FakeDB:
    def __init__(self):
        self._collections: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def collection(self, name: str) -> _Collection:
        return _Collection(self, name)

    def get_all(self, refs: List[_DocRef]):
        return [ref.get() for ref in refs]


@pytest.fixture()
def app_client(monkeypatch):
    from apps.api import main

    fake_db = _FakeDB()
    monkeypatch.setattr(main, "db", fake_db)

    class _Store:
        def get_load(self, load_id: str):
            _ = load_id
            return None

        def update_load(self, load_id: str, updates: Dict[str, Any]):
            _ = load_id
            _ = updates
            return None

    monkeypatch.setattr(main, "store", _Store())

    client = TestClient(main.app)
    return client, fake_db, main


def test_tracking_load_locations_enriches_carrier_and_driver_names(app_client):
    client, fake_db, main = app_client

    # Seed a load that is in_transit, has a driver with GPS, and has a carrier id
    # but is missing assigned_carrier_name/carrier_name on the load itself.
    fake_db.collection("loads").document("L1").set(
        {
            "status": "in_transit",
            "created_by": "shipper1",
            "assigned_driver_id": "driver1",
            "assigned_carrier_id": "carrier1",
        }
    )

    # Driver GPS lives on users/{driver_uid}
    fake_db.collection("users").document("driver1").set(
        {"gps_lat": 33.1, "gps_lng": -84.2, "name": "Driver Dan"}
    )

    # Carrier profile may live on carriers/{carrier_uid}
    fake_db.collection("carriers").document("carrier1").set({"company_name": "CarrierCo LLC"})

    main.app.dependency_overrides[main.get_current_user] = lambda: {"uid": "shipper1", "role": "shipper"}
    try:
        res = client.get("/tracking/loads/locations")
        assert res.status_code == 200
        payload = res.json()

        assert payload["count"] == 1
        item = payload["items"][0]
        assert item["load_id"] == "L1"
        assert item["gps_lat"] == 33.1
        assert item["gps_lng"] == -84.2
        assert item["driver_name"] == "Driver Dan"
        assert item["carrier_name"] == "CarrierCo LLC"
    finally:
        main.app.dependency_overrides = {}
