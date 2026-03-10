# Messaging Notifications: Quota Fix + Firebase Cloud Messaging (FCM) Guide

This doc is a “reflect-back” reference for the work done after the prompt:

> “come up with the most optimal solution for messages notifications… app hits the database every interval… slows down… consumes quota… solve the root problem…”

It explains:
- What caused the quota blow-ups
- What changed in backend + frontend
- What Firebase Cloud Messaging (FCM) is good for
- How to configure Web Push (`VITE_FIREBASE_VAPID_KEY`) safely
- How to validate and troubleshoot

---

## 1) The Root Problem

### Symptoms
- Lots of `OPTIONS 200` (CORS preflight; normal)
- Many `GET/POST ... 503` that later became `429 Too Many Requests`

### Root cause
- Firestore was returning **`429 ResourceExhausted (Quota exceeded)`**.
- Some code paths masked this as `503` due to timeouts and SDK retry/backoff.

### Why quota got exhausted
- The app’s “realtime messaging” was implemented as **polling loops**:
  - Frontend had intervals and frequent refresh calls.
  - Backend SSE endpoints were **still polling Firestore every 2–3 seconds per connected client**.

That pattern scales terribly: number of reads ≈ clients × (polls/min) × (queries/poll).

---

## 2) The New Architecture (High Level)

The optimal design is **two-channel**:

### A) Foreground realtime (app open)
- Use **SSE** (Server-Sent Events) to push updates to the open UI.
- Goal: instant UI updates without periodic Firestore reads.

### B) Background/offline notifications (app closed)
- Use **Firebase Cloud Messaging (FCM)**.
- Goal: “Firebase tells the app” there is a new message (push notification).

FCM is not a database change stream. It’s a notification channel.
To avoid polling Firestore, the backend sends FCM pushes at the moment it writes the message.

---

## 3) What Changed (Backend)

### 3.1 Auth error surfaced correctly
- Firestore quota errors are returned as **429** instead of misleading **503**.

### 3.2 SSE endpoints no longer poll Firestore
- The following SSE endpoints were converted from Firestore polling to **in-process push**:
  - `GET /messaging/threads/{thread_id}/stream`
  - `GET /messaging/threads/stream`
  - `GET /messaging/notifications/stream`

Instead of querying Firestore in a loop, they block on an in-memory pub/sub queue.

Key files:
- `apps/api/realtime.py` (in-process pub/sub hub)
- `apps/api/messaging.py` (publishes events on writes; SSE reads from hub)

Important limitation:
- The hub is **process-local**. If you run multiple workers/instances, use Redis Pub/Sub (same publish API).

### 3.3 FCM push notifications added

#### Device registration
- Endpoint: `POST /messaging/devices/register`
- Stores token and subscribes it to topics (best-effort):
  - `uid_<uid>` (direct message pushes)
  - `role_<role>` and `role_all` (admin/broadcast)

Why topics?
- Topic messaging avoids **reading device tokens from Firestore** during every send.

#### Chat message push
- When a message is sent (`POST /messaging/threads/{thread_id}/messages`):
  - Backend sends FCM push to each recipient’s `uid_<uid>` topic.

#### Admin broadcast push
- Admin sends broadcast (`POST /messaging/admin/notifications/send`):
  - Backend pushes to `role_all` or `role_<target_role>` topic.

Backend flag:
- Enable with `ENABLE_FCM=true` in `apps/.env`.

File updates:
- `apps/api/messaging.py`
- `apps/api/settings.py` (added `ENABLE_FCM`)

---

## 4) What Changed (Frontend)

### 4.1 Polling removed from messaging screens
The messaging screens no longer use timer polling to keep badges/threads updated.
They now react to pushed SSE events.

Files:
- `src/components/driver/Messaging.jsx`
- `src/components/carrier/Messaging.jsx`
- `src/components/shipper/Messaging.jsx`

### 4.2 Web Push (FCM) registration added

On login, the app attempts (best-effort):
1) Ask for Notification permission
2) Create/register a service worker
3) Get an FCM token
4) Call `POST /messaging/devices/register`

Files:
- `public/firebase-messaging-sw.js` (service worker)
- `src/fcm.js` (token registration + onMessage hook)
- `src/contexts/AuthContext.jsx` (calls `ensureFcmRegistered()` after login)

Frontend env var:
- `VITE_FIREBASE_VAPID_KEY=<public web push key>`

---

## 5) Config: VAPID Key (Web Push)

### What it is
- The Web Push “VAPID public key” is used by the browser to obtain an FCM token.
- It is **public** (safe to ship in the frontend).

### Where to get it
Firebase Console → Project settings → Cloud Messaging → Web Push certificates
- Generate key pair if needed
- Copy the **public key**

### Where to put it
Create `.env.local` (frontend root, same folder as `package.json`):

```
VITE_FIREBASE_VAPID_KEY=YOUR_PUBLIC_KEY
```

Restart Vite after changing env files.

### Important security note
Do NOT put any real private keys in `VITE_*` variables.
Vite exposes `VITE_*` values to the browser build.

---

## 6) Config: Backend FCM

### Enable
In `apps/.env`:

```
ENABLE_FCM=true
```

### Firebase Admin credentials
The backend uses Firebase Admin SDK (service account). Ensure your backend is correctly configured to authenticate.

---

## 7) How To Verify

### A) Verify SSE no longer polls Firestore
- Open messaging UI in 2 browsers/users.
- Watch backend logs: you should NOT see repeating Firestore reads every 2–3 seconds per client.

### B) Verify FCM registration
- Login in browser
- Accept notifications permission
- Backend should receive `POST /messaging/devices/register`

### C) Verify push notification
- With the receiving user logged in once (token registered), close the tab / background it.
- Send a message to that user.
- You should see a browser notification.

---

## 8) Troubleshooting

### No notification permission prompt
- Browser may have blocked prompts; check site settings.

### Token retrieval fails
- Missing `VITE_FIREBASE_VAPID_KEY`
- Service worker not registered (check DevTools → Application → Service Workers)

### No push received
- `ENABLE_FCM` is false on backend
- Token was never registered to backend
- Topic subscription failed (backend logs)

### Multi-instance deployment
- In-process hub won’t broadcast across instances.
- Use Redis Pub/Sub (or a managed realtime layer) for SSE fanout.

---

## 9) What FCM Is Good For (and what it is not)

Good for:
- Background/offline notifications: “New message from X”
- Re-engagement and alerts

Not good for:
- Replacing your entire chat transport while app is open.
  - You still want SSE/WebSocket for live chat UI updates.

---

## 10) Implementation Recap (Plain-English)

1) We stopped treating polling as “realtime”.
2) We rewired SSE so the server pushes events when it writes.
3) We added FCM so Firebase can notify the app when it’s not actively listening.
4) We used FCM Topics to avoid token lookups (which would recreate the Firestore-read problem).

That combination fixes the quota root cause and prevents it from coming back as usage grows.
