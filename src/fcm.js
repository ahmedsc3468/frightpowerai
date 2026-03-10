import app from './firebase';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { postJson } from './api/http';

const TOKEN_STORAGE_KEY = 'fp:fcm:token:v1';

function getVapidKey() {
  return String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();
}

async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  // Reuse existing registration if present.
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;

  // Firebase expects this path for web push.
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

export async function ensureFcmRegistered() {
  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) return { ok: false, reason: 'messaging_not_supported' };

    const vapidKey = getVapidKey();
    if (!vapidKey) return { ok: false, reason: 'missing_vapid_key' };

    if (!('Notification' in window)) return { ok: false, reason: 'no_notification_api' };

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: `permission_${perm}` };

    const swReg = await ensureServiceWorker();
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg || undefined,
    });

    if (!token) return { ok: false, reason: 'token_empty' };

    const last = (() => {
      try { return localStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch { return ''; }
    })();

    if (token !== last) {
      await postJson('/messaging/devices/register', { token, platform: 'web' }).catch(() => {});
      try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* ignore */ }
    }

    // Foreground messages: no UI changes here; just emit an event.
    try {
      onMessage(messaging, (payload) => {
        try {
          window.dispatchEvent(new CustomEvent('fp:fcm:message', { detail: payload }));
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e?.message || 'unknown_error' };
  }
}
