from __future__ import annotations

from dataclasses import dataclass
import asyncio
import time
from typing import Any, Dict, Optional


@dataclass(eq=False)
class Subscriber:
    uid: str
    role: str
    queue: "asyncio.Queue[dict]"
    created_at: float

    # Allow being stored in a set (identity semantics).
    __hash__ = object.__hash__


class RealtimeHub:
    """In-process realtime pub/sub for SSE.

    This eliminates Firestore polling by pushing events when the backend itself
    performs writes (send message, mark read, admin broadcast, etc.).

    Note: This is process-local. For multi-instance deployments, swap this with
    Redis pub/sub (same publish API).
    """

    def __init__(self):
        self._lock = asyncio.Lock()
        self._subs_by_uid: Dict[str, set[Subscriber]] = {}

    async def subscribe(self, *, uid: str, role: str) -> Subscriber:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=250)
        sub = Subscriber(uid=uid, role=(role or ""), queue=q, created_at=time.time())
        async with self._lock:
            self._subs_by_uid.setdefault(uid, set()).add(sub)
        return sub

    async def unsubscribe(self, sub: Subscriber) -> None:
        async with self._lock:
            s = self._subs_by_uid.get(sub.uid)
            if not s:
                return
            s.discard(sub)
            if not s:
                self._subs_by_uid.pop(sub.uid, None)

    async def publish_uid(self, uid: str, event: Dict[str, Any]) -> None:
        if not uid:
            return
        async with self._lock:
            subs = list(self._subs_by_uid.get(uid) or [])
        if not subs:
            return
        for sub in subs:
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop if the client is too slow; next reconnect will resync.
                pass

    async def publish_uids(self, uids: list[str], event: Dict[str, Any]) -> None:
        for uid in uids:
            await self.publish_uid(uid, event)

    async def publish_roles(self, roles: list[str], event: Dict[str, Any]) -> None:
        want = {str(r or "").lower() for r in (roles or []) if str(r or "").strip()}
        if not want:
            return
        async with self._lock:
            subs_by_uid = list(self._subs_by_uid.items())

        for uid, subs in subs_by_uid:
            for sub in list(subs):
                if str(sub.role or "").lower() in want:
                    try:
                        sub.queue.put_nowait(event)
                    except asyncio.QueueFull:
                        pass

    async def broadcast(self, event: Dict[str, Any]) -> None:
        async with self._lock:
            subs_by_uid = list(self._subs_by_uid.items())
        for _uid, subs in subs_by_uid:
            for sub in list(subs):
                try:
                    sub.queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass


hub = RealtimeHub()
