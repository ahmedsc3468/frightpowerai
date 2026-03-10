/* Firebase Cloud Messaging service worker (web push).

   This enables background notifications when the tab is not focused.
   You must set VITE_FIREBASE_VAPID_KEY in your frontend env for token registration.
*/

// Use compat builds in the service worker for broad compatibility.
// Version does not need to match the app exactly; it must support messaging.
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyClzYECMNer89EjBs_h12hb5tDIghUslMM',
  authDomain: 'freightpowerai-e90fe.firebaseapp.com',
  projectId: 'freightpowerai-e90fe',
  storageBucket: 'freightpowerai-e90fe.firebasestorage.app',
  messagingSenderId: '529930908639',
  appId: '1:529930908639:web:e86b1112c5a80f60248a6a'
});

const messaging = firebase.messaging();

// Handle background messages.
messaging.onBackgroundMessage((payload) => {
  try {
    const title = payload?.notification?.title || 'FreightPower';
    const body = payload?.notification?.body || 'New notification';
    const data = payload?.data || {};

    self.registration.showNotification(title, {
      body,
      data,
    });
  } catch {
    // ignore
  }
});

// When user clicks a notification, focus an existing tab or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification?.data || {};

  // Best-effort: deep-link to messaging with thread id.
  const threadId = data.thread_id || '';
  const url = threadId ? `/?nav=messaging&thread=${encodeURIComponent(threadId)}` : '/?nav=messaging';

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client?.url && 'focus' in client) {
          await client.focus();
          try { client.navigate(url); } catch { /* ignore */ }
          return;
        }
      }
      if (clients.openWindow) {
        await clients.openWindow(url);
      }
    })()
  );
});
