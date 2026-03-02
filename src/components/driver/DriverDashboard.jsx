import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useUserSettings } from '../../contexts/UserSettingsContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_URL } from '../../config';
import { AUTO_REFRESH_MS } from '../../constants/refresh';

import DocumentVault from './DocumentVault';
import Marketplace from './Marketplace';
import MyCarrier from './MyCarrier';
import HiringOnboarding from './HiringOnboarding';
import AccountSettings from './AccountSettings';
import AiHub from './AiHub';
import ConsentESignature from './ConsentESignature';
import Messaging from './Messaging';
import AlertsNotifications from './AlertsNotifications';
import HereMap from '../common/HereMap';
// OnboardingCoach removed - compliance data now shown in Compliance & Safety page
import '../../styles/driver/DriverDashboard.css';
import logo from '/src/assets/logo.png';
import resp_logo from '/src/assets/logo_1.png';
import { t } from '../../i18n/translate';

export default function DriverDashboard() {
  const { currentUser, logout } = useAuth();
  const { settings: userSettings } = useUserSettings();
  const language = userSettings?.language || 'English';
  const locale = language === 'Spanish' ? 'es-ES' : language === 'Arabic' ? 'ar' : 'en-US';
  const tr = (key, fallback) => t(language, key, fallback);
  const messagesPrefEnabled = Boolean(userSettings?.notification_preferences?.messages);
  const compliancePrefEnabled = Boolean(userSettings?.notification_preferences?.compliance_alerts);
  const navigate = useNavigate();
  const location = useLocation();
  const [activeNav, setActiveNav] = useState('home');
  const [initialThreadId, setInitialThreadId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isPostHire, setIsPostHire] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportFormData, setSupportFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const fileUploadRef = React.useRef(null);

  // Messaging unread badge
  const [messagingUnread, setMessagingUnread] = useState(0);

  // Messaging tray previews (topbar dropdown in Post-Hire)
  const [msgTrayLoading, setMsgTrayLoading] = useState(false);
  const [msgTrayThreads, setMsgTrayThreads] = useState([]);
  const [msgTrayUnreadSummary, setMsgTrayUnreadSummary] = useState({ total_unread: 0, threads: {}, channels: {} });

  // Notifications state
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifItems, setNotifItems] = useState([]);
  const notifItemsRef = React.useRef([]);
  const notifWasOpenRef = React.useRef(false);

  // Lightweight toast for admin notifications
  const [toast, setToast] = useState(null);
  const lastAdminMsgAtRef = React.useRef(0);

  const shouldHideNotificationForPrefs = useCallback((n) => {
    const toText = (v) => String(v || '').toLowerCase();
    const type = toText(n?.notification_type || n?.type);
    const category = toText(n?.category);
    const resource = toText(n?.resource_type);
    const title = toText(n?.title);
    const body = toText(n?.message || n?.body);

    const isMessageTagged = (
      category === 'messaging' ||
      category === 'messages' ||
      type === 'message'
    );

    const isComplianceTagged = (
      category === 'compliance' ||
      type === 'compliance_alert' ||
      resource === 'compliance'
    );

    if (!messagesPrefEnabled && isMessageTagged) return true;
    if (!compliancePrefEnabled && isComplianceTagged) return true;

    const isMessageLike = (
      type.includes('message') ||
      type.includes('messaging') ||
      resource.includes('message') ||
      resource.includes('thread') ||
      title.includes('message') ||
      title.includes('messaging')
    );

    const isComplianceLike = (
      type.includes('compliance') ||
      type.includes('document') ||
      type.includes('safety') ||
      resource.includes('document') ||
      title.includes('compliance') ||
      title.includes('document') ||
      title.includes('cdl') ||
      title.includes('medical') ||
      body.includes('compliance') ||
      body.includes('document') ||
      body.includes('cdl') ||
      body.includes('medical')
    );

    if (!messagesPrefEnabled && isMessageLike) return true;
    if (!compliancePrefEnabled && isComplianceLike) return true;
    return false;
  }, [messagesPrefEnabled, compliancePrefEnabled]);

  const fetchNotifications = async () => {
    if (!currentUser) return;
    setNotifLoading(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/notifications?page=1&page_size=20`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) return;
      const data = await res.json();
      const raw = Array.isArray(data?.notifications) ? data.notifications : [];
      const filtered = raw.filter((n) => !shouldHideNotificationForPrefs(n));
      setNotifItems(filtered);
      setNotifUnread(filtered.filter((n) => !n?.is_read).length);
    } catch {
      // ignore
    } finally {
      setNotifLoading(false);
    }
  };

  const fetchMessageTray = useCallback(async () => {
    if (!currentUser) return;
    if (!messagesPrefEnabled) {
      setMsgTrayThreads([]);
      setMsgTrayUnreadSummary({ total_unread: 0, threads: {}, channels: {} });
      setMsgTrayLoading(false);
      return;
    }

    setMsgTrayLoading(true);
    try {
      const token = await currentUser.getIdToken();

      // Ensure driver has their carrier direct thread available (best-effort)
      try {
        await fetch(`${API_URL}/messaging/driver/threads/my-carrier`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch {
        // ignore
      }

      const [threadsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/messaging/threads?limit=50`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${API_URL}/messaging/unread/summary`, { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (threadsRes.ok) {
        const data = await threadsRes.json();
        setMsgTrayThreads(Array.isArray(data?.threads) ? data.threads : []);
      }
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setMsgTrayUnreadSummary(data || { total_unread: 0, threads: {}, channels: {} });
      }
    } catch {
      // ignore
    } finally {
      setMsgTrayLoading(false);
    }
  }, [currentUser, messagesPrefEnabled]);

  const persistNotificationRead = async (notificationId) => {
    if (!currentUser || !notificationId) return;
    try {
      const token = await currentUser.getIdToken();
      await fetch(`${API_URL}/notifications/${encodeURIComponent(notificationId)}/mark-read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch {
      // ignore
    }
  };

  const markNotificationRead = async (notificationId) => {
    if (!currentUser || !notificationId) return;
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/notifications/${encodeURIComponent(notificationId)}/mark-read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) return;
      setNotifItems((prev) => (prev || []).map((n) => (n?.id === notificationId ? { ...n, is_read: true } : n)));
      setNotifUnread((prev) => Math.max(0, Number(prev || 0) - 1));
    } catch {
      // ignore
    }
  };

  const handleNotifToggle = async () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      await fetchNotifications();
    }
  };

  const handleNotifAction = async (n) => {
    const id = String(n?.id || '').trim();
    const actionUrl = String(n?.action_url || '').trim();
    if (id && !n?.is_read) {
      markNotificationRead(id);
    }
    if (actionUrl) {
      setNotifOpen(false);
      navigate(actionUrl);
    }
  };

  // Close notifications dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const onDocClick = (e) => {
      const el = e?.target;
      if (!el) return;
      const root = document.getElementById('fp-notif-dropdown-root');
      if (root && root.contains(el)) return;
      setNotifOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [notifOpen]);

  // Keep a ref to the latest notifications list for close-transition logic.
  useEffect(() => {
    notifItemsRef.current = Array.isArray(notifItems) ? notifItems : [];
  }, [notifItems]);

  // When the notifications tray closes, automatically mark all unopened notifications as opened.
  useEffect(() => {
    const wasOpen = Boolean(notifWasOpenRef.current);
    notifWasOpenRef.current = Boolean(notifOpen);
    if (!wasOpen || notifOpen) return;

    const current = Array.isArray(notifItemsRef.current) ? notifItemsRef.current : [];
    const unreadIds = current
      .filter((n) => !n?.is_read)
      .map((n) => String(n?.id || '').trim())
      .filter(Boolean);
    if (unreadIds.length === 0) return;

    // Shift unopened -> opened immediately in UI.
    setNotifItems((prev) => (prev || []).map((n) => {
      const id = String(n?.id || '').trim();
      if (!id) return n;
      return unreadIds.includes(id) ? { ...n, is_read: true } : n;
    }));
    setNotifUnread(0);

    // Persist read state (best-effort).
    Promise.all(unreadIds.map((id) => persistNotificationRead(id))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen]);

  // Allow other screens (e.g., Consent & E-Sign) to push new notifications into the tray immediately.
  useEffect(() => {
    const onNotif = (e) => {
      const notif = e?.detail?.notification;
      if (!notif || typeof notif !== 'object') return;
      const id = String(notif?.id || '').trim();
      if (!id) return;

      if (shouldHideNotificationForPrefs(notif)) return;

      setNotifItems((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.some((x) => String(x?.id || '').trim() === id)) return list;
        return [notif, ...list].slice(0, 20);
      });
      if (!notif?.is_read) {
        setNotifUnread((prev) => Number(prev || 0) + 1);
      }
    };
    window.addEventListener('fp-notification', onNotif);
    return () => window.removeEventListener('fp-notification', onNotif);
  }, [shouldHideNotificationForPrefs]);

  // Re-filter notifications in real-time when preferences change.
  useEffect(() => {
    setNotifItems((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.filter((n) => !shouldHideNotificationForPrefs(n));
    });
  }, [shouldHideNotificationForPrefs]);

  // Keep unread count consistent with the filtered list.
  useEffect(() => {
    const list = Array.isArray(notifItems) ? notifItems : [];
    setNotifUnread(list.filter((n) => !n?.is_read).length);
  }, [notifItems]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  // Deep-link support (email links): /driver-dashboard?nav=messaging&thread=<threadId>
  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      const nav = (qs.get('nav') || qs.get('section') || '').trim();
      const thread = (qs.get('thread') || qs.get('thread_id') || '').trim();
      if (thread) {
        setInitialThreadId(thread);
        setActiveNav('messaging');
        return;
      }
      if (nav) setActiveNav(nav);
    } catch {
      // ignore
    }
  }, [location.search]);

  // Onboarding data state
  const [driverProfile, setDriverProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [onboardingScore, setOnboardingScore] = useState(null);
  const [documentCompletion, setDocumentCompletion] = useState(0);
  const [hasConsent, setHasConsent] = useState(false);
  const [requiredDocsSnapshot, setRequiredDocsSnapshot] = useState(null);
  const [marketplaceViewsCount, setMarketplaceViewsCount] = useState(0);
  const [profileData, setProfileData] = useState({
    name: '',
    profilePicture: null,
    role: 'Pre-Hire Driver'
  });
  
  // Load tracking state
  const [loads, setLoads] = useState([]);
  const [activeLoad, setActiveLoad] = useState(null);
  const [assignedLoads, setAssignedLoads] = useState([]);
  const [completedLoads, setCompletedLoads] = useState([]);
  const [loadsLoading, setLoadsLoading] = useState(false);
  const [tripStarted, setTripStarted] = useState(false);
  const [pickupCompleted, setPickupCompleted] = useState(false);
  const [deliveryCompleted, setDeliveryCompleted] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [distanceLeft, setDistanceLeft] = useState(0);
  const [distanceToPickup, setDistanceToPickup] = useState(0);
  const [distanceToDelivery, setDistanceToDelivery] = useState(0);
  const [gpsPermissionGranted, setGpsPermissionGranted] = useState(false);

  // Fetch onboarding data on mount
  useEffect(() => {
    const fetchProfile = async () => {
      if (!currentUser) {
        setProfileLoading(false);
        return;
      }
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_URL}/onboarding/data`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (response.ok) {
          const data = await response.json();
          setDriverProfile(data);
          if (typeof data.onboarding_score !== 'undefined') {
            setOnboardingScore(data.onboarding_score);
          }
          
          // Update profile data for header display
          if (data.data) {
            setProfileData({
              name: data.data.fullName || currentUser.displayName || 'Driver',
              profilePicture: data.data.profile_picture_url || null,
              role: isPostHire ? 'Active Driver' : 'Pre-Hire Driver'
            });
          }
          
          // Set availability status from profile
          if (typeof data.is_available !== 'undefined') {
            setIsAvailable(data.is_available);
          }
          
          // Set marketplace views count
          if (typeof data.marketplace_views_count !== 'undefined') {
            setMarketplaceViewsCount(data.marketplace_views_count);
          }
        }

        // Fetch onboarding coach for progress/score if available
        const coachRes = await fetch(`${API_URL}/onboarding/coach-status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (coachRes.ok) {
          const coach = await coachRes.json();
          if (typeof coach.total_score !== 'undefined') {
            setOnboardingScore(coach.total_score);
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setProfileLoading(false);
      }
    };
    fetchProfile();
  }, [currentUser, isPostHire]);

  const fetchRequiredDocs = useCallback(async () => {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/onboarding/driver/required-docs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setRequiredDocsSnapshot(data);

      // Consent is driven by the E‑Sign 'data_sharing_consent' gate (per-carrier)
      const consentEligible = Boolean(data?.consent?.eligible);
      setHasConsent(consentEligible);

      // Document completion: based on required document items, not a generic docs object
      const required = Array.isArray(data?.required) ? data.required : [];
      const requiredDocumentItems = required.filter((x) => (x?.kind || '').toString().toLowerCase() === 'document');
      const total = requiredDocumentItems.length;
      const completed = requiredDocumentItems.filter((x) => {
        const s = (x?.status || '').toString();
        return s && s !== 'Missing' && s !== 'Expired';
      }).length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      setDocumentCompletion(percent);
    } catch (e) {
      console.error('Error fetching required docs:', e);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchRequiredDocs();

    const onDocsUpdated = () => fetchRequiredDocs();
    const onConsentUpdated = () => fetchRequiredDocs();
    const onVisibility = () => {
      if (!document.hidden) fetchRequiredDocs();
    };

    window.addEventListener('fp:documents-updated', onDocsUpdated);
    window.addEventListener('fp:consent-updated', onConsentUpdated);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('fp:documents-updated', onDocsUpdated);
      window.removeEventListener('fp:consent-updated', onConsentUpdated);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchRequiredDocs]);

  // Ensure compliance notifications are generated/cleaned up when enabling the toggle.
  useEffect(() => {
    if (!currentUser) return;
    if (compliancePrefEnabled) {
      fetchRequiredDocs();
    }
  }, [currentUser, compliancePrefEnabled, fetchRequiredDocs]);

  // Poll messaging unread summary (used for sidebar badge)
  useEffect(() => {
    let alive = true;
    if (!currentUser) return;
    if (!messagesPrefEnabled) {
      setMessagingUnread(0);
      return;
    }

    const tick = async () => {
      try {
        const token = await currentUser.getIdToken();

        // Best-effort: process due calendar reminders (in-app) for assigned events.
        try {
          const rr = await fetch(`${API_URL}/calendar/driver/reminders/poll`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (rr.ok) {
            const rj = await rr.json();
            const created = Number(rj?.created || 0);
            if (created > 0) {
              fetchNotifications();
            }
          }
        } catch {
          // ignore
        }

        const res = await fetch(`${API_URL}/messaging/unread/summary`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        const nextUnread = Number(data?.total_unread || 0);
        setMessagingUnread((prev) => (prev === nextUnread ? prev : nextUnread));

        // Admin toasts are tied to the Preferences -> Notifications -> Messages toggle.
        // We treat "admin_channels" (broadcast by admins) as the source of admin messages.
        if (messagesPrefEnabled) {
          const channels = data?.channels || {};
          const chAll = channels?.all || {};
          const chRole = channels?.driver || {};
          const lastAt = Math.max(Number(chAll?.last_message_at || 0), Number(chRole?.last_message_at || 0));
          const hasUnread = Boolean(chAll?.has_unread || chRole?.has_unread);

          if (hasUnread && lastAt && lastAt > (lastAdminMsgAtRef.current || 0)) {
            lastAdminMsgAtRef.current = lastAt;
            setToast({
              title: 'New message from Admin',
              body: 'Open Messaging to read it.',
            });

            // Optional browser notification (only if already granted; do not prompt here).
            try {
              if (window?.Notification && Notification.permission === 'granted') {
                new Notification('FreightPower', { body: 'New message from Admin' });
              }
            } catch {
              // ignore
            }
          }
        }
      } catch (_) {
        // ignore
      }
    };

    tick();
    const id = setInterval(tick, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [currentUser, messagesPrefEnabled]);

  // Reset admin notification watermark when the toggle is disabled.
  useEffect(() => {
    if (!messagesPrefEnabled) {
      lastAdminMsgAtRef.current = 0;
      setToast(null);
      setMsgTrayThreads([]);
      setMsgTrayUnreadSummary({ total_unread: 0, threads: {}, channels: {} });
    }
  }, [messagesPrefEnabled]);

  // Fetch notification unread count on mount (no polling)
  useEffect(() => {
    if (!currentUser) return;
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // When notification preferences change, refresh from backend immediately.
  useEffect(() => {
    if (!currentUser) return;
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, messagesPrefEnabled, compliancePrefEnabled]);

  const timeLeftLabel = useMemo(() => {
    const load = activeLoad;
    if (!load) return tr('driverDashboard.time.etaTbd', 'ETA TBD');
    const raw = load.delivery_date || load.delivery_datetime || load.delivery_time || load.pickup_date || load.pickup_datetime || null;
    if (!raw) return tr('driverDashboard.time.etaTbd', 'ETA TBD');
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return tr('driverDashboard.time.etaTbd', 'ETA TBD');
    const diffMs = d.getTime() - Date.now();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec <= 0) return tr('driverDashboard.time.due', 'Due');
    const mins = Math.floor(diffSec / 60);
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return `${days}${tr('driverDashboard.time.dayAbbrev', 'd')} ${remHours}${tr('driverDashboard.time.hourAbbrev', 'h')} ${tr('driverDashboard.time.left', 'left')}`;
    }
    if (hours <= 0) return `${Math.max(1, remMins)}${tr('driverDashboard.time.minAbbrev', 'm')} ${tr('driverDashboard.time.left', 'left')}`;
    return `${hours}${tr('driverDashboard.time.hourAbbrev', 'h')} ${remMins}${tr('driverDashboard.time.minAbbrev', 'm')} ${tr('driverDashboard.time.left', 'left')}`;
  }, [activeLoad]);

  const navGroups = [
    {
      title: t(language, 'nav.operations', 'OPERATIONS'),
      items: [
        { key: 'home', label: t(language, 'nav.myLoads', 'My Loads'), icon: 'fa-solid fa-house' },
        { key: 'docs', label: t(language, 'nav.docs', 'Document Vault'), icon: 'fa-solid fa-folder' },
        { key: 'marketplace', label: t(language, 'nav.marketplace', 'Marketplace'), icon: 'fa-solid fa-store' },
      ]
    },
    {
      title: t(language, 'nav.management', 'MANAGEMENT'),
      items: [
        { key: 'carrier', label: t(language, 'nav.myCarrier', 'My Carrier'), icon: 'fa-solid fa-building' },
        { key: 'compliance', label: t(language, 'nav.compliance', 'Compliance & Safety'), icon: 'fa-solid fa-shield-halved' },
        { key: 'hiring', label: t(language, 'nav.hiring', 'Hiring & Onboarding'), icon: 'fa-solid fa-user-plus' },
        { key: 'esign', label: t(language, 'nav.esign', 'Consent & E-Signature'), icon: 'fa-solid fa-pen-fancy' }
      ]
    },
    {
      title: t(language, 'nav.support', 'SUPPORT'),
      items: [
        { key: 'messaging', label: t(language, 'nav.messaging', 'Messaging'), icon: 'fa-solid fa-envelope' },
        { key: 'alerts', label: t(language, 'nav.alerts', 'Alerts & Notifications'), icon: 'fa-solid fa-bell' },
        { key: 'settings', label: t(language, 'nav.settings', 'Account & Settings'), icon: 'fa-solid fa-gear' },
        { key: 'help', label: t(language, 'nav.aiHub', 'AI Hub'), icon: 'fa-solid fa-robot' },
        { key: 'logout', label: t(language, 'nav.logout', 'Logout'), icon: 'fa-solid fa-right-from-bracket' }
      ]
    }
  ];


  // Handle logout
  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  // Handle navigation click
  const handleNavClick = (key) => {
    if (key === 'logout') {
      handleLogout();
    } else {
      setActiveNav(key);
      if (isSidebarOpen) setIsSidebarOpen(false);
    }
  };

  const openOnboardingCenter = () => {
    try {
      const qs = new URLSearchParams(location.search || '');
      qs.set('nav', 'settings');
      qs.set('tab', 'onboarding');
      navigate({ pathname: location.pathname, search: `?${qs.toString()}` }, { replace: true });
    } catch {
      // ignore
    }
    setActiveNav('settings');
    if (isSidebarOpen) setIsSidebarOpen(false);
  };

  const openAlerts = () => {
    setNotifOpen(false);
    setActiveNav('alerts');
    if (isSidebarOpen) setIsSidebarOpen(false);
  };

  const openMessaging = (threadId = null) => {
    setNotifOpen(false);
    if (threadId) setInitialThreadId(threadId);
    setActiveNav('messaging');
    if (isSidebarOpen) setIsSidebarOpen(false);
  };

  const fmtMsgWhen = (ts) => {
    const n = Number(ts || 0);
    if (!n) return '';
    const d = new Date(n * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const missingRequiredDocsCount = useMemo(() => {
    const required = Array.isArray(requiredDocsSnapshot?.required) ? requiredDocsSnapshot.required : [];
    return required.filter((x) => {
      const kind = String(x?.kind || '').toLowerCase();
      if (kind !== 'document') return false;
      const s = String(x?.status || '');
      return s === 'Missing' || s === 'Expired';
    }).length;
  }, [requiredDocsSnapshot]);

  // Handle availability toggle
  const handleAvailabilityToggle = async () => {
    if (availabilityLoading || !currentUser) return;
    
    try {
      setAvailabilityLoading(true);
      const newAvailability = !isAvailable;
      
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/driver/availability`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_available: newAvailability })
      });
      
      if (response.ok) {
        setIsAvailable(newAvailability);
        console.log(`✅ Availability updated to: ${newAvailability ? 'Available' : 'Unavailable'}`);
      } else {
        console.error('Failed to update availability');
        alert(tr('driverDashboard.availability.updateFailed', 'Failed to update availability. Please try again.'));
      }
    } catch (error) {
      console.error('Error toggling availability:', error);
      alert(tr('driverDashboard.availability.updateError', 'Error updating availability. Please try again.'));
    } finally {
      setAvailabilityLoading(false);
    }
  };

  // Handle document upload
  const handleDocumentUpload = () => {
    fileUploadRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', 'general'); // Can be customized

      const response = await fetch(`${API_URL}/documents/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (response.ok) {
        alert(tr('driverDashboard.alert.documentUploadSuccess', 'Document uploaded successfully!'));
      } else {
        alert(tr('driverDashboard.alert.documentUploadFailed', 'Failed to upload document. Please try again.'));
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      alert(tr('driverDashboard.alert.documentUploadError', 'Error uploading document. Please try again.'));
    } finally {
      if (fileUploadRef.current) {
        fileUploadRef.current.value = '';
      }
    }
  };

  // Handle support form submission
  const handleSupportSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    try {
      setSupportSubmitting(true);
      const token = await currentUser.getIdToken();
      
      const response = await fetch(`${API_URL}/support/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...supportFormData,
          user_id: currentUser.uid,
          timestamp: new Date().toISOString()
        })
      });

      if (response.ok) {
        // Show success toast
        alert(tr('driverDashboard.alert.supportRequestSent', 'Your support request has been sent to our admin staff at help@freightpower-ai.com'));
        setShowSupportModal(false);
        setSupportFormData({ name: '', email: '', subject: '', message: '' });
      } else {
        alert(tr('driverDashboard.alert.supportSubmitFailed', 'Failed to submit support request. Please try again.'));
      }
    } catch (error) {
      console.error('Error submitting support:', error);
      alert(tr('driverDashboard.alert.supportSubmitError', 'Error submitting support request. Please try again.'));
    } finally {
      setSupportSubmitting(false);
    }
  };

  // Fetch loads for driver
  const fetchLoads = async () => {
    if (!currentUser) return;
    try {
      setLoadsLoading(true);
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        const allLoads = data.loads || [];
        console.log('📦 Fetched loads:', allLoads);
        console.log('📦 First load structure:', allLoads[0]);
        setLoads(allLoads);
        
        // Filter loads by status
        const active = allLoads.find(l => l.status === 'in_transit');
        const assigned = allLoads.filter(l => l.status === 'covered' || l.status === 'assigned');
        const completed = allLoads.filter(l => l.status === 'delivered');
        
        setActiveLoad(active || null);
        setAssignedLoads(assigned);
        setCompletedLoads(completed);
        
        // If there's an active load, check its state
        if (active) {
          setTripStarted(true);
          setPickupCompleted(!!active.pickup_confirmed_at);
          setDeliveryCompleted(active.status === 'delivered');
        }
      }
    } catch (error) {
      console.error('Error fetching loads:', error);
    } finally {
      setLoadsLoading(false);
    }
  };

  // Start trip
  const handleStartTrip = async (load) => {
    if (!currentUser || !load) return;
    
    console.log('🚀 Starting trip for load:', load);
    
    // Get the load ID - it could be in different fields
    const loadId = load.load_id || load.id || load._id;
    console.log('🆔 Load ID found:', loadId);
    console.log('🔍 Available fields:', Object.keys(load));
    
    if (!loadId) {
      alert(tr('driverDashboard.alert.loadIdNotFound', 'Load ID not found'));
      console.error('Load object:', load);
      return;
    }
    
    try {
      const token = await currentUser.getIdToken();
      const url = `${API_URL}/loads/${loadId}/driver-update-status`;
      console.log('📡 API URL:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ new_status: 'in_transit' })
      });
      
      if (response.ok) {
        console.log('✅ Trip started successfully');
        setTripStarted(true);
        fetchLoads(); // Refresh loads
      } else {
        const error = await response.json();
        console.error('❌ API Error:', error);
        alert(error.detail || tr('driverDashboard.alert.startTripFailed', 'Failed to start trip'));
      }
    } catch (error) {
      console.error('❌ Network Error:', error);
      alert(tr('driverDashboard.alert.startTripError', 'Error starting trip. Please try again.'));
    }
  };

  // Mark pickup completed - saves timestamp to database
  const handleMarkPickup = async () => {
    if (!activeLoad || !currentUser) return;
    
    const loadId = activeLoad.load_id || activeLoad.id || activeLoad._id;
    if (!loadId) {
      alert(tr('driverDashboard.alert.loadIdNotFound', 'Load ID not found'));
      return;
    }
    
    try {
      const token = await currentUser.getIdToken();
      const payload = {
        pickup_confirmed: true,
        pickup_timestamp: new Date().toISOString(),
        latitude: currentLocation?.latitude || null,
        longitude: currentLocation?.longitude || null
      };
      
      // Update in Firestore via API
      const response = await fetch(`${API_URL}/loads/${loadId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        setPickupCompleted(true);
        console.log('✅ Pickup timestamp saved:', payload.pickup_timestamp);
      } else {
        console.error('Failed to save pickup timestamp');
        // Still mark as completed locally
        setPickupCompleted(true);
      }
    } catch (error) {
      console.error('Error saving pickup timestamp:', error);
      // Still mark as completed locally
      setPickupCompleted(true);
    }
  };

  // Mark delivery completed
  const handleMarkDelivery = async () => {
    if (!activeLoad || !currentUser) return;
    
    const loadId = activeLoad.load_id || activeLoad.id || activeLoad._id;
    if (!loadId) {
      alert(tr('driverDashboard.alert.loadIdNotFound', 'Load ID not found'));
      return;
    }
    
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads/${loadId}/driver-update-status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ new_status: 'delivered' })
      });
      
      if (response.ok) {
        setDeliveryCompleted(true);
        fetchLoads();
        alert(tr('driverDashboard.alert.deliveryMarkedCompleted', 'Delivery marked as completed!'));
      } else {
        const error = await response.json();
        alert(error.detail || tr('driverDashboard.alert.markDeliveryFailed', 'Failed to mark delivery'));
      }
    } catch (error) {
      console.error('Error marking delivery:', error);
      alert(tr('driverDashboard.alert.markDeliveryError', 'Error marking delivery. Please try again.'));
    }
  };

  // Calculate distance using Haversine formula
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
  };

  // Get current GPS location
  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      console.error('Geolocation not supported');
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        setCurrentLocation(location);
        setGpsPermissionGranted(true);
        
        // Calculate distances if active load exists
        if (activeLoad) {
          updateDistances(location);
        }
      },
      (error) => {
        console.error('GPS Error:', error);
        setGpsPermissionGranted(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  // Update distances to pickup and delivery
  const updateDistances = (location) => {
    if (!activeLoad || !location) return;
    
    // Parse pickup coordinates
    const pickupCoords = activeLoad.origin_coordinates || activeLoad.pickup_coordinates;
    if (pickupCoords) {
      const dist = calculateDistance(
        location.latitude,
        location.longitude,
        pickupCoords.latitude || pickupCoords.lat,
        pickupCoords.longitude || pickupCoords.lng
      );
      setDistanceToPickup(dist);
    }
    
    // Parse delivery coordinates
    const deliveryCoords = activeLoad.destination_coordinates || activeLoad.delivery_coordinates;
    if (deliveryCoords) {
      const dist = calculateDistance(
        location.latitude,
        location.longitude,
        deliveryCoords.latitude || deliveryCoords.lat,
        deliveryCoords.longitude || deliveryCoords.lng
      );
      setDistanceToDelivery(dist);
    }
  };

  // GPS tracking - update location every 30 seconds when trip is active
  useEffect(() => {
    if (!tripStarted || !activeLoad) return;
    
    // Get initial location
    getCurrentLocation();
    
    // Update location every 30 seconds
    const intervalId = setInterval(() => {
      getCurrentLocation();
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, [tripStarted, activeLoad]);

  // Fetch loads when switching to post-hire
  useEffect(() => {
    if (isPostHire && currentUser) {
      fetchLoads();
    }
  }, [isPostHire, currentUser]);

  function HomeView() {
    return (
      <>
        <header className="fp-header">
          <div className="fp-header-titles">
            <h2>
              <span role="img" aria-label={tr('driverDashboard.home.waveLabel', 'wave')}>👋</span>
              {tr('driverDashboard.home.welcomePrefix', 'Welcome to FreightPower,')} {profileData.name || tr('driverDashboard.home.defaultName', 'Driver')}!
            </h2>
            <p className="fp-subtitle">{tr('driverDashboard.home.subtitle', 'Complete your onboarding to start connecting with carriers and finding loads.')}</p>
            <button onClick={() => setIsPostHire(true)} className="btn small green-btn">{tr('driverDashboard.home.postHire', 'Post Hire')}</button>
          </div>
        </header>

        {/* Driver Profile Card - Shows onboarding data */}
        {!profileLoading && driverProfile && driverProfile.data && (
          <section style={{ marginBottom: '20px' }}>
            <div className="card" style={{ padding: '20px', background: '#f8fafc' }}>
              <div className="card-header">
                <h3><i className="fa-solid fa-user" style={{ marginRight: '8px' }}></i>{tr('driverDashboard.home.driverProfile', 'Driver Profile')}</h3>
                {onboardingScore !== null && (
                  <div className="pill" style={{ background:'#e0f2fe', color:'#075985', padding:'6px 10px', borderRadius:'999px', fontWeight:600 }}>
                    {tr('driverDashboard.home.onboardingScore', 'Onboarding Score:')} {Math.round(onboardingScore)}%
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '16px' }}>
                {driverProfile.data.fullName && (
                  <div><strong>{tr('driverDashboard.labels.name', 'Name:')}</strong> {driverProfile.data.fullName}</div>
                )}
                {driverProfile.data.cdlNumber && (
                  <div><strong>{tr('driverDashboard.labels.cdlNumber', 'CDL Number:')}</strong> {driverProfile.data.cdlNumber}</div>
                )}
                {driverProfile.data.cdlClass && (
                  <div><strong>{tr('driverDashboard.labels.cdlClass', 'CDL Class:')}</strong> {driverProfile.data.cdlClass}</div>
                )}
                {driverProfile.data.issuingState && (
                  <div><strong>{tr('driverDashboard.labels.issuingState', 'Issuing State:')}</strong> {driverProfile.data.issuingState}</div>
                )}
                {driverProfile.data.preferredRegions && (
                  <div><strong>{tr('driverDashboard.labels.preferredRegions', 'Preferred Regions:')}</strong> {driverProfile.data.preferredRegions}</div>
                )}
                {driverProfile.data.equipmentExperience && (
                  <div><strong>{tr('driverDashboard.labels.equipmentExperience', 'Equipment Experience:')}</strong> {driverProfile.data.equipmentExperience}</div>
                )}
              </div>
              {!driverProfile.onboarding_completed && (
                <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', color: '#92400e' }}>
                  <i className="fa-solid fa-exclamation-triangle" style={{ marginRight: '8px' }}></i>
                  {tr('driverDashboard.home.onboardingNotComplete', 'Onboarding not complete.')}{' '}
                  <span 
                    onClick={openOnboardingCenter}
                    style={{ color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {tr('driverDashboard.home.completeNow', 'Complete now')}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Onboarding Coach removed - compliance data now shown in Compliance & Safety page */}

        <section className="fp-grid">
          {/* Onboarding Progress Card */}
          <div className="card dd-onboarding-card span-3">
            <div className="dd-onboarding-progress">
              <span className="dd-progress-title">{tr('driverDashboard.home.onboardingProgress', 'Onboarding Progress')}</span>
              <span className="dd-progress-percent">
                {(() => {
                  const docsPct = Math.max(0, Math.min(100, Number(documentCompletion || 0)));
                  const consentPct = hasConsent ? 100 : 0;
                  const availabilityPct = isAvailable ? 100 : 0;
                  const progress = Math.round((0.33 * docsPct) + (0.33 * consentPct) + (0.34 * availabilityPct));
                  return `${progress}%`;
                })()}
                {' '}{tr('common.complete', 'Complete')}
              </span>
            </div>
            <div className="dd-progress-bar">
              <div className="dd-progress-bar-inner" style={{ 
                width: (() => {
                  const docsPct = Math.max(0, Math.min(100, Number(documentCompletion || 0)));
                  const consentPct = hasConsent ? 100 : 0;
                  const availabilityPct = isAvailable ? 100 : 0;
                  const progress = Math.round((0.33 * docsPct) + (0.33 * consentPct) + (0.34 * availabilityPct));
                  return `${progress}%`;
                })()
              }} />
            </div>
            <div className="dd-onboarding-steps">
              {/* Document Upload Step */}
              <div className={`dd-step ${documentCompletion === 100 ? 'dd-step-complete' : documentCompletion > 0 ? 'dd-step-inprogress' : 'dd-step-pending'}`}>
                <i className={`fa-solid ${documentCompletion === 100 ? 'fa-check-circle dd-step-complete-icon-fa' : documentCompletion > 0 ? 'fa-hourglass-half dd-step-inprogress-icon-fa' : 'fa-regular fa-circle dd-step-pending-icon-fa'}`}></i>
                <div className="dd-step-title">{tr('driverDashboard.home.docsUploaded', 'Docs Uploaded')}</div>
                <div className="dd-step-status">
                  {documentCompletion === 100 ? (
                    <span style={{ color: '#10b981' }}>{tr('common.complete', 'Complete')}</span>
                  ) : documentCompletion > 0 ? (
                    <span style={{ color: '#f59e0b' }}>{tr('common.inProgress', 'In Progress')}</span>
                  ) : (
                    <span style={{ color: '#ef4444' }}>{tr('common.incomplete', 'Incomplete')}</span>
                  )}
                </div>
              </div>
              
              {/* Consent Step */}
              <div className={`dd-step ${hasConsent ? 'dd-step-complete' : 'dd-step-pending'}`}>
                <i className={`fa-solid ${hasConsent ? 'fa-check-circle dd-step-complete-icon-fa' : 'fa-regular fa-circle dd-step-pending-icon-fa'}`}></i>
                <div className="dd-step-title">{tr('driverDashboard.home.consentGiven', 'Consent Given')}</div>
                <div className="dd-step-status">
                  {hasConsent ? (
                    <span style={{ color: '#10b981' }}>{tr('common.complete', 'Complete')}</span>
                  ) : (
                    <span style={{ color: '#6c757d' }}>{tr('common.pending', 'Pending')}</span>
                  )}
                </div>
              </div>
              
              {/* Availability Step */}
              <div className={`dd-step ${isAvailable ? 'dd-step-complete' : 'dd-step-pending'}`}>
                <i className={`fa-solid ${isAvailable ? 'fa-check-circle dd-step-complete-icon-fa' : 'fa-regular fa-circle dd-step-pending-icon-fa'}`}></i>
                <div className="dd-step-title">{tr('driverDashboard.home.availabilityOn', 'Availability On')}</div>
                <div className="dd-step-status">
                  {isAvailable ? (
                    <span style={{ color: '#10b981' }}>{tr('common.active', 'Active')}</span>
                  ) : (
                    <span style={{ color: '#6c757d' }}>{tr('common.pending', 'Pending')}</span>
                  )}
                </div>
              </div>
            </div>
            <button 
              className="btn small-cd"
              onClick={() => handleNavClick('settings')}
            >
              {tr('driverDashboard.home.goToProfile', 'Go to Profile')}
            </button>
          </div>

          {/* Marketplace Activity */}
          <div className="card dd-marketplace-card">
            <div className="card-header">
              <h3>{tr('driverDashboard.home.marketplaceActivity', 'Marketplace Activity')}</h3>
              {marketplaceViewsCount > 0 && (
                <span className="dd-marketplace-new dd-marketplace-green">{marketplaceViewsCount} {tr('driverDashboard.home.newLabel', 'New')}</span>
              )}
            </div>
            <div className="dd-marketplace-content dd-center dd-marketplace-padding">
              <div className="dd-marketplace-eye">
                <i className="fa-solid fa-eye dd-marketplace-eye-icon"></i>
              </div>
              <div className="dd-marketplace-viewed">{marketplaceViewsCount} {tr('driverDashboard.home.carriersViewedYou', 'Carriers Viewed You')}</div>
              <div className="dd-marketplace-desc">
                {marketplaceViewsCount > 0 
                  ? tr('driverDashboard.home.marketplaceDescHasViews', 'This week carriers have shown interest in your profile')
                  : tr('driverDashboard.home.marketplaceDescNoViews', 'No views this week. Toggle availability to be discovered by carriers')}
              </div>
              <button 
                className="btn small-cd"
                onClick={() => handleNavClick('marketplace')}
              >
                {tr('driverDashboard.home.viewMarketplace', 'View Marketplace')}
              </button>
            </div>
          </div>

          {/* AI Suggestions */}
          {Boolean(userSettings?.notification_preferences?.ai_tips) && (
            <div className="card dd-ai-suggestions-card">
              <div className="card-header">
                <h3>{tr('driverDashboard.home.aiSuggestions', 'AI Suggestions')}</h3>
              </div>
              <div className="dd-ai-suggestion">
                <div className="dd-suggestion-title">{tr('driverDashboard.home.ai.medicalCardExpiring', 'Medical Card Expiring')}</div>
                <div className="dd-suggestion-text">{tr('driverDashboard.home.ai.expiresInDays', 'Expires in 15 days')}</div>
              </div>
              <div className="dd-ai-suggestion">
                <div className="dd-suggestion-title">{tr('driverDashboard.home.ai.profileTipTitle', 'Profile Tip')}</div>
                <div className="dd-suggestion-text">{tr('driverDashboard.home.ai.profileTipText', 'Add experience details to attract carriers')}</div>
              </div>
              <div className="dd-ai-suggestion">
                <div className="dd-suggestion-title">{tr('driverDashboard.home.ai.marketplaceReadyTitle', 'Marketplace Ready')}</div>
                <div className="dd-suggestion-text">{tr('driverDashboard.home.ai.marketplaceReadyText', 'Turn on availability to be discovered')}</div>
              </div>
            </div>
          )}

          {/* Service Providers */}
          <div className="card dd-service-providers-card">
            <div className="card-header">
              <h3>{tr('driverDashboard.home.serviceProviders', 'Service Providers')}</h3>
              <span 
                className="view-all" 
                onClick={() => handleNavClick('marketplace')}
                style={{ cursor: 'pointer' }}
              >
                {tr('common.viewAll', 'View All')}
              </span>
            </div>
            <div className="dd-service-grid">
              <div 
                className="dd-service-item dd-center"
                onClick={() => handleNavClick('marketplace')}
                style={{ cursor: 'pointer' }}
              >
                <i className="fa-solid fa-gavel" />
                <div>{tr('driverDashboard.home.services.legalHelp', 'Legal Help')}</div>
              </div>
              <div 
                className="dd-service-item dd-center"
                onClick={() => handleNavClick('marketplace')}
                style={{ cursor: 'pointer' }}
              >
                <i className="fa-solid fa-wrench" />
                <div>{tr('driverDashboard.home.services.roadside', 'Roadside')}</div>
              </div>
              <div 
                className="dd-service-item dd-center"
                onClick={() => handleNavClick('marketplace')}
                style={{ cursor: 'pointer' }}
              >
                <i className="fa-solid fa-parking" />
                <div>{tr('driverDashboard.home.services.parking', 'Parking')}</div>
              </div>
              <div 
                className="dd-service-item dd-center"
                onClick={() => handleNavClick('marketplace')}
                style={{ cursor: 'pointer' }}
              >
                <i className="fa-solid fa-gas-pump" />
                <div>{tr('driverDashboard.home.services.fuel', 'Fuel')}</div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card dd-quick-actions-card span-3">
            <div className="card-header">
              <h3>{t(language, 'dashboard.quickActions', 'Quick Actions')}</h3>
            </div>
            <div className="dd-quick-actions">
              <input 
                type="file" 
                ref={fileUploadRef} 
                style={{ display: 'none' }} 
                onChange={handleFileSelected}
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              />
              <button 
                className="btn small-cd"
                onClick={handleDocumentUpload}
              >
                <i className="fa-solid fa-upload"></i>
                {t(language, 'dashboard.uploadDocument', 'Upload Document')}
              </button>
              <button 
                className="btn small-cd"
                onClick={() => handleNavClick('marketplace')}
              >
                <i className="fa-solid fa-store"></i>
                {t(language, 'dashboard.browseMarketplace', 'Browse Marketplace')}
              </button>
              <button 
                className="btn small-cd"
                onClick={() => handleNavClick('esign')}
              >
                <i className="fa-solid fa-pen"></i>
                {t(language, 'dashboard.completeConsent', 'Complete Consent')}
              </button>
              <button 
                className="btn small ghost-cd"
                onClick={() => setShowSupportModal(true)}
              >
                <i className="fa-solid fa-headset"></i>
                {t(language, 'dashboard.getSupport', 'Get Support')}
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  function PostHireView() {
    const [homeComplianceLoading, setHomeComplianceLoading] = useState(false);
    const [homeCompliance, setHomeCompliance] = useState(null);

    const refreshHomeCompliance = useCallback(async () => {
      if (!currentUser) return;
      setHomeComplianceLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_URL}/compliance/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        setHomeCompliance(await res.json());
      } catch {
        // ignore
      } finally {
        setHomeComplianceLoading(false);
      }
    }, [currentUser]);

    useEffect(() => {
      refreshHomeCompliance();
      // Prefer not to poll; update on known events.
      const onDocsUpdated = () => refreshHomeCompliance();
      window.addEventListener('fp:documents-updated', onDocsUpdated);
      return () => window.removeEventListener('fp:documents-updated', onDocsUpdated);
    }, [refreshHomeCompliance]);

    useEffect(() => {
      // Keep message previews in sync for Home cards.
      if (messagesPrefEnabled) fetchMessageTray();
    }, [fetchMessageTray, messagesPrefEnabled]);

    const complianceCardItems = useMemo(() => {
      const role = homeCompliance?.role_data || {};
      const parseExpiry = (value) => {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const expiryStatus = (value) => {
        const d = parseExpiry(value);
        if (!d) return 'missing';
        const days = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (days < 0) return 'expired';
        if (days <= 30) return 'warning';
        return 'ok';
      };
      const norm = (s) => String(s || '').toLowerCase().trim();
      const simpleStatus = (s) => {
        const v = norm(s);
        if (!v || v === 'pending' || v === 'in_progress' || v === 'in-progress') return 'pending';
        if (v === 'pass' || v === 'passed' || v === 'clear' || v === 'cleared' || v === 'complete' || v === 'completed' || v === 'ok' || v === 'approved') return 'ok';
        if (v === 'fail' || v === 'failed' || v === 'rejected' || v === 'denied') return 'bad';
        return 'pending';
      };

      const cdl = expiryStatus(role.cdl_expiry);
      const medical = expiryStatus(role.medical_card_expiry);
      const drug = simpleStatus(role.drug_test_status);
      const mvr = simpleStatus(role.mvr_status);
      const clearinghouse = simpleStatus(role.clearinghouse_status);

      const bg = (mvr === 'ok' && clearinghouse === 'ok') ? 'ok' : ((mvr === 'bad' || clearinghouse === 'bad') ? 'bad' : 'pending');

      return [
        { key: 'cdl', label: tr('driverDashboard.compliance.cdlLicense', 'CDL License'), icon: 'fa-solid fa-id-card', status: cdl },
        { key: 'medical', label: tr('driverDashboard.compliance.medicalCard', 'Medical Card'), icon: 'fa-solid fa-file-medical', status: medical },
        { key: 'drug', label: tr('driverDashboard.compliance.drugTest', 'Drug Test'), icon: 'fa-solid fa-search', status: drug },
        { key: 'background', label: tr('driverDashboard.compliance.backgroundCheck', 'Background Check'), icon: 'fa-solid fa-clipboard-check', status: bg },
      ];
    }, [homeCompliance]);

    const complianceStatusIcon = (status) => {
      if (status === 'ok') return <i className="fa-solid fa-check" />;
      if (status === 'warning') return <i className="fa-solid fa-exclamation-triangle" />;
      if (status === 'expired' || status === 'bad') return <i className="fa-solid fa-xmark" />;
      return <i className="fa-solid fa-clock" />;
    };

    // Calculate total distance and distance left for active load
    const getTotalDistance = () => {
      if (!activeLoad) return 0;
      return activeLoad.estimated_distance || activeLoad.distance_miles || activeLoad.total_distance || 0;
    };

    const getDistanceLeft = () => {
      if (!activeLoad || !pickupCompleted) return getTotalDistance();
      // If pickup is completed, calculate distance from current location to delivery
      // For now, return a placeholder - you'll need real geolocation
      return Math.round(getTotalDistance() * 0.3); // Assuming 30% distance remaining
    };

    const getPickupLocation = () => {
      if (!activeLoad) return { city: '', state: '', full: '' };
      const origin = activeLoad.origin;
      if (typeof origin === 'string') {
        // If origin is a string like "Chicago, IL"
        const parts = origin.split(',').map(s => s.trim());
        return {
          city: parts[0] || '',
          state: parts[1] || '',
          full: origin
        };
      } else if (origin && typeof origin === 'object') {
        // If origin is an object with city/state
        return {
          city: origin.city || '',
          state: origin.state || '',
          full: `${origin.city || ''}, ${origin.state || ''}`
        };
      }
      return { city: tr('driverDashboard.postHire.pickup', 'Pickup'), state: '', full: tr('driverDashboard.postHire.pickupLocation', 'Pickup Location') };
    };

    const getDeliveryLocation = () => {
      if (!activeLoad) return { city: '', state: '', full: '' };
      const destination = activeLoad.destination;
      if (typeof destination === 'string') {
        // If destination is a string like "Atlanta, GA"
        const parts = destination.split(',').map(s => s.trim());
        return {
          city: parts[0] || '',
          state: parts[1] || '',
          full: destination
        };
      } else if (destination && typeof destination === 'object') {
        // If destination is an object with city/state
        return {
          city: destination.city || '',
          state: destination.state || '',
          full: `${destination.city || ''}, ${destination.state || ''}`
        };
      }
      return { city: tr('driverDashboard.postHire.delivery', 'Delivery'), state: '', full: tr('driverDashboard.postHire.deliveryLocation', 'Delivery Location') };
    };

    const getRate = () => {
      if (!activeLoad) return 0;
      return activeLoad.total_rate || activeLoad.linehaul_rate || activeLoad.rate || activeLoad.price || 0;
    };

    const pickupLoc = getPickupLocation();
    const deliveryLoc = getDeliveryLocation();
    const totalDistance = getTotalDistance();
    const distanceLeft = getDistanceLeft();
    const rate = getRate();
    const ratePerMile = totalDistance > 0 ? (rate / totalDistance).toFixed(2) : '0.00';

    const ddTheme = {
      text: isDarkMode ? '#f1f5f9' : '#1e293b',
      muted: isDarkMode ? '#94a3b8' : '#64748b',
      border: isDarkMode ? '#353535' : '#e2e8f0',
      surfaceAlt: isDarkMode ? '#1f2937' : '#f8fafc',
      chip: isDarkMode ? '#1f2937' : '#f1f5f9',
      iconMuted: isDarkMode ? '#94a3b8' : '#cbd5e1',
      warningBg: isDarkMode ? '#3a2a00' : '#fef3c7',
      warningLabel: isDarkMode ? '#fde68a' : '#92400e',
      warningText: isDarkMode ? '#fed7aa' : '#78350f'
    };

    return (
      <>
        <header className="fp-header">
          <div className="fp-header-titles">
            <button onClick={() => setIsPostHire(false)} className="btn small">{tr('driverDashboard.postHire.backToPreHire', 'Back to Pre-Hire')}</button>
          </div>
        </header>

        {/* Active Load Card - Full Width */}
        {activeLoad ? (
          <div className="card dd-active-load-card">
            <div className="dd-active-load-header">
              <h3>{tr('driverDashboard.postHire.activeLoadTitle', 'Active Load - Pickup to Delivery')}</h3>
              <span className="dd-load-status">{tripStarted ? tr('driverDashboard.postHire.inTransit', 'In Transit') : tr('driverDashboard.postHire.readyToStart', 'Ready to Start')}</span>
            </div>
            
            {tripStarted ? (
              <div className="dd-active-load-content">
                <div className="dd-load-info-grid">
                  <div className="dd-load-info-item">
                    <span className="dd-info-label">{tr('driverDashboard.postHire.pickup', 'Pickup')}</span>
                    <span className="dd-info-value">
                      {pickupLoc.full}
                    </span>
                    <span className="dd-info-status" style={{fontSize: '0.875rem', color: ddTheme.muted}}>
                      {activeLoad.pickup_date || tr('driverDashboard.postHire.dateTbd', 'Date TBD')}
                    </span>
                  </div>
                  <div className="dd-load-info-item">
                    <span className="dd-info-label">{tr('driverDashboard.postHire.delivery', 'Delivery')}</span>
                    <span className="dd-info-value">
                      {deliveryLoc.full}
                    </span>
                    <span className="dd-info-status" style={{fontSize: '0.875rem', color: ddTheme.muted}}>
                      {activeLoad.delivery_date || tr('driverDashboard.postHire.dateTbd', 'Date TBD')}
                    </span>
                  </div>
                  <div className="dd-load-info-item">
                    <span className="dd-info-label">{tr('driverDashboard.postHire.distance', 'Distance')}</span>
                    <span className="dd-info-value">{distanceLeft} {tr('driverDashboard.units.milesLeft', 'miles left')}</span>
                    <span className="dd-info-status">{totalDistance} {tr('driverDashboard.units.totalMiles', 'total miles')}</span>
                  </div>
                  <div className="dd-load-info-item">
                    <span className="dd-info-label">{tr('driverDashboard.postHire.rate', 'Rate')}</span>
                    <span className="dd-info-value">${rate}</span>
                    <span className="dd-info-status">${ratePerMile}/{tr('driverDashboard.units.perMile', 'mile')}</span>
                  </div>
                </div>
                
                {/* Pickup and Delivery Checkboxes Row */}
                <div style={{display: 'flex', gap: '24px', padding: '16px 0', borderTop: `1px solid ${ddTheme.border}`}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <input 
                      type="checkbox" 
                      checked={pickupCompleted} 
                      onChange={handleMarkPickup}
                      style={{cursor: 'pointer', width: '18px', height: '18px'}}
                    />
                    <span style={{fontSize: '0.9rem', color: pickupCompleted ? '#22c55e' : ddTheme.muted, fontWeight: '500'}}>
                      {pickupCompleted ? tr('driverDashboard.postHire.pickupCompletedShort', '✓ Pickup Completed') : tr('driverDashboard.postHire.markPickup', 'Mark Pickup')}
                    </span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <input 
                      type="checkbox" 
                      checked={deliveryCompleted} 
                      onChange={handleMarkDelivery}
                      disabled={!pickupCompleted}
                      style={{cursor: pickupCompleted ? 'pointer' : 'not-allowed', width: '18px', height: '18px', opacity: pickupCompleted ? 1 : 0.5}}
                    />
                    <span style={{fontSize: '0.9rem', color: deliveryCompleted ? '#22c55e' : ddTheme.muted, fontWeight: '500', opacity: pickupCompleted ? 1 : 0.5}}>
                      {deliveryCompleted ? tr('driverDashboard.postHire.deliveredShort', '✓ Delivered') : tr('driverDashboard.postHire.markDelivery', 'Mark Delivery')}
                    </span>
                  </div>
                </div>

                <div className="dd-load-actions">
                  <button className="btn small ghost-cd dd-btn">
                    <i className="fa-solid fa-location-arrow"></i>
                    {tr('driverDashboard.postHire.navigate', 'Navigate')}
                  </button>
                  <button className="btn small ghost-cd dd-btn">
                    <i className="fa-solid fa-upload"></i>
                    {tr('driverDashboard.postHire.uploadPod', 'Upload POD')}
                  </button>
                  <button className="btn small ghost-cd dd-btn">
                    <i className="fa-solid fa-comment"></i>
                    {tr('driverDashboard.postHire.messageDispatch', 'Message Dispatch')}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{padding: '20px', textAlign: 'center'}}>
                <p style={{marginBottom: '16px', color: ddTheme.muted}}>{tr('driverDashboard.postHire.startTripHint', 'Click Start Trip to begin tracking')}</p>
                <button className="btn small-cd" onClick={() => handleStartTrip(activeLoad)}>
                  <i className="fa-solid fa-play" style={{marginRight: '8px'}}></i>
                  {tr('driverDashboard.postHire.startTrip', 'Start Trip')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="card dd-active-load-card" style={{textAlign: 'center', padding: '40px'}}>
            <i className="fa-solid fa-truck" style={{fontSize: '3rem', color: ddTheme.iconMuted, marginBottom: '16px'}}></i>
            <h3 style={{margin: '0 0 8px', color: ddTheme.text}}>{tr('driverDashboard.postHire.noActiveLoad', 'No Active Load')}</h3>
            <p style={{margin: 0, color: ddTheme.muted}}>
              {tr('driverDashboard.postHire.noActiveLoadDesc', "You don't have any active loads at the moment. Check your assigned loads below to start a new trip.")}
            </p>
          </div>
        )}

        {/* Detailed Trip Tracking Section - Only shows when active load exists */}
        {activeLoad && tripStarted && (
          <div className="card" style={{marginBottom: '24px'}}>
            <div className="card-header">
              <h3 style={{margin: 0, fontSize: '1.25rem', fontWeight: '600', color: ddTheme.text}}>
                <i className="fa-solid fa-route" style={{marginRight: '8px', color: '#3b82f6'}}></i>
                {tr('driverDashboard.postHire.tripDetails', 'Trip Details')}
              </h3>
              {gpsPermissionGranted ? (
                <span style={{fontSize: '0.875rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '4px'}}>
                  <i className="fa-solid fa-circle" style={{fontSize: '0.5rem'}}></i>
                  {tr('driverDashboard.postHire.gpsActive', 'GPS Active')}
                </span>
              ) : (
                <span style={{fontSize: '0.875rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px'}}>
                  <i className="fa-solid fa-circle" style={{fontSize: '0.5rem'}}></i>
                  {tr('driverDashboard.postHire.gpsDisabled', 'GPS Disabled')}
                </span>
              )}
            </div>
            
            {/* Row 1: Pickup Location */}
            <div style={{padding: '20px', borderBottom: `1px solid ${ddTheme.border}`}}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px'}}>
                <div style={{flex: 1}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px'}}>
                    <div style={{width: '40px', height: '40px', borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                      <i className="fa-solid fa-location-dot" style={{color: '#3b82f6', fontSize: '1.25rem'}}></i>
                    </div>
                    <div>
                      <div style={{fontSize: '0.875rem', color: ddTheme.muted, marginBottom: '2px'}}>{tr('driverDashboard.postHire.pickupLocation', 'Pickup Location')}</div>
                      <div style={{fontSize: '1.125rem', fontWeight: '600', color: ddTheme.text}}>{pickupLoc.full}</div>
                    </div>
                  </div>
                  <div style={{paddingLeft: '52px'}}>
                    {gpsPermissionGranted ? (
                      <div style={{fontSize: '0.875rem', color: ddTheme.muted}}>
                        <i className="fa-solid fa-location-crosshairs" style={{marginRight: '6px', color: '#3b82f6'}}></i>
                        {distanceToPickup} {tr('driverDashboard.units.milesAway', 'miles away')}
                      </div>
                    ) : (
                      <div style={{fontSize: '0.875rem', color: '#f59e0b'}}>
                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight: '6px'}}></i>
                        {tr('driverDashboard.postHire.enableGpsForDistance', 'Enable GPS for distance')}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                  <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '12px 20px', background: pickupCompleted ? '#dcfce7' : ddTheme.chip, borderRadius: '8px', transition: 'all 0.2s'}}>
                    <input 
                      type="checkbox" 
                      checked={pickupCompleted} 
                      onChange={handleMarkPickup}
                      style={{width: '20px', height: '20px', cursor: 'pointer', accentColor: '#22c55e'}}
                    />
                    <span style={{fontSize: '0.95rem', fontWeight: '600', color: pickupCompleted ? '#16a34a' : ddTheme.muted}}>
                      {pickupCompleted ? tr('driverDashboard.postHire.pickupCompletedShort', '✓ Pickup Completed') : tr('driverDashboard.postHire.markPickup', 'Mark Pickup')}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Row 2: Load Details */}
            <div style={{padding: '20px', background: ddTheme.surfaceAlt, borderBottom: `1px solid ${ddTheme.border}`}}>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px'}}>
                <div>
                  <div style={{fontSize: '0.75rem', color: ddTheme.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>{tr('driverDashboard.postHire.loadId', 'Load ID')}</div>
                  <div style={{fontSize: '0.95rem', fontWeight: '600', color: ddTheme.text}}>{activeLoad.load_id}</div>
                </div>
                <div>
                  <div style={{fontSize: '0.75rem', color: ddTheme.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>{tr('driverDashboard.postHire.equipment', 'Equipment')}</div>
                  <div style={{fontSize: '0.95rem', fontWeight: '600', color: ddTheme.text}}>{activeLoad.equipment_type || tr('driverDashboard.postHire.notSpecified', 'Not Specified')}</div>
                </div>
                <div>
                  <div style={{fontSize: '0.75rem', color: ddTheme.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>{tr('driverDashboard.postHire.weight', 'Weight')}</div>
                  <div style={{fontSize: '0.95rem', fontWeight: '600', color: ddTheme.text}}>{activeLoad.weight ? `${activeLoad.weight} ${tr('driverDashboard.units.lbs', 'lbs')}` : tr('driverDashboard.postHire.notSpecified', 'Not Specified')}</div>
                </div>
                <div>
                  <div style={{fontSize: '0.75rem', color: ddTheme.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>{tr('driverDashboard.postHire.commodity', 'Commodity')}</div>
                  <div style={{fontSize: '0.95rem', fontWeight: '600', color: ddTheme.text}}>{activeLoad.commodity || tr('driverDashboard.postHire.generalFreight', 'General Freight')}</div>
                </div>
                <div>
                  <div style={{fontSize: '0.75rem', color: ddTheme.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>{tr('driverDashboard.postHire.totalRate', 'Total Rate')}</div>
                  <div style={{fontSize: '0.95rem', fontWeight: '600', color: '#16a34a'}}>${rate}</div>
                </div>
                <div>
                  <div style={{fontSize: '0.75rem', color: ddTheme.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>{tr('driverDashboard.postHire.totalDistance', 'Total Distance')}</div>
                  <div style={{fontSize: '0.95rem', fontWeight: '600', color: ddTheme.text}}>{totalDistance} {tr('driverDashboard.units.miles', 'miles')}</div>
                </div>
              </div>
              {activeLoad.special_requirements && (
                <div style={{marginTop: '16px', padding: '12px', background: ddTheme.warningBg, borderRadius: '6px', borderLeft: '3px solid #f59e0b'}}>
                  <div style={{fontSize: '0.75rem', color: ddTheme.warningLabel, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px'}}>
                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight: '6px'}}></i>
                    {tr('driverDashboard.postHire.specialRequirements', 'Special Requirements')}
                  </div>
                  <div style={{fontSize: '0.875rem', color: ddTheme.warningText}}>{activeLoad.special_requirements}</div>
                </div>
              )}
            </div>

            {/* Row 3: Delivery Location */}
            <div style={{padding: '20px'}}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px'}}>
                <div style={{flex: 1}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px'}}>
                    <div style={{width: '40px', height: '40px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                      <i className="fa-solid fa-flag-checkered" style={{color: '#16a34a', fontSize: '1.25rem'}}></i>
                    </div>
                    <div>
                      <div style={{fontSize: '0.875rem', color: ddTheme.muted, marginBottom: '2px'}}>{tr('driverDashboard.postHire.deliveryLocation', 'Delivery Location')}</div>
                      <div style={{fontSize: '1.125rem', fontWeight: '600', color: ddTheme.text}}>{deliveryLoc.full}</div>
                    </div>
                  </div>
                  <div style={{paddingLeft: '52px'}}>
                    {gpsPermissionGranted ? (
                      <div style={{fontSize: '0.875rem', color: ddTheme.muted}}>
                        <i className="fa-solid fa-location-crosshairs" style={{marginRight: '6px', color: '#16a34a'}}></i>
                        {distanceToDelivery} {tr('driverDashboard.units.milesAway', 'miles away')}
                      </div>
                    ) : (
                      <div style={{fontSize: '0.875rem', color: '#f59e0b'}}>
                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight: '6px'}}></i>
                        {tr('driverDashboard.postHire.enableGpsForDistance', 'Enable GPS for distance')}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                  <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: pickupCompleted ? 'pointer' : 'not-allowed', padding: '12px 20px', background: deliveryCompleted ? '#dcfce7' : (pickupCompleted ? ddTheme.chip : ddTheme.surfaceAlt), borderRadius: '8px', opacity: pickupCompleted ? 1 : 0.5, transition: 'all 0.2s'}}>
                    <input 
                      type="checkbox" 
                      checked={deliveryCompleted} 
                      onChange={handleMarkDelivery}
                      disabled={!pickupCompleted}
                      style={{width: '20px', height: '20px', cursor: pickupCompleted ? 'pointer' : 'not-allowed', accentColor: '#22c55e'}}
                    />
                    <span style={{fontSize: '0.95rem', fontWeight: '600', color: deliveryCompleted ? '#16a34a' : ddTheme.muted}}>
                      {deliveryCompleted ? tr('driverDashboard.postHire.deliveredShort', '✓ Delivered') : tr('driverDashboard.postHire.markDelivery', 'Mark Delivery')}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="dd-two-column-layout">
          {/* Left Column */}
          <div className="dd-left-column">
            {/* Load Summary */}
            <div className="dd-load-summary-section">
              <h3 className="dd-section-title">{tr('driverDashboard.postHire.loadSummary', 'Load Summary')}</h3>
              <div className="card dd-load-summary-card dd-no-header">
                <div className="dd-summary-stats-horizontal">
                  <div className="dd-stat-item-horizontal">
                    <div className="dd-stat-number-large">{assignedLoads.length}</div>
                    <div className="dd-stat-label-horizontal">{tr('driverDashboard.postHire.assigned', 'Assigned')}</div>
                  </div>
                  <div className="dd-stat-item-horizontal">
                    <div className="dd-stat-number-large">{activeLoad ? 1 : 0}</div>
                    <div className="dd-stat-label-horizontal">{tr('driverDashboard.postHire.inTransit', 'In Transit')}</div>
                  </div>
                  <div className="dd-stat-item-horizontal">
                    <div className="dd-stat-number-large">{completedLoads.length}</div>
                    <div className="dd-stat-label-horizontal">{tr('driverDashboard.postHire.completed', 'Completed')}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Route Cards - Assigned Loads */}
            {assignedLoads.length > 0 ? (
              assignedLoads.map((load) => {
                // Parse origin
                const origin = typeof load.origin === 'string' 
                  ? load.origin.split(',').map(s => s.trim())[0] 
                  : (load.origin?.city || tr('driverDashboard.postHire.pickup', 'Pickup'));
                
                // Parse destination
                const destination = typeof load.destination === 'string' 
                  ? load.destination.split(',').map(s => s.trim())[0] 
                  : (load.destination?.city || tr('driverDashboard.postHire.delivery', 'Delivery'));
                
                // Get rate
                const loadRate = load.total_rate || load.linehaul_rate || load.rate || load.price || 0;
                
                return (
                  <div key={load.load_id} className="card dd-route-card">
                    <div className="dd-route-header">
                      <h4>{origin} {tr('common.to', 'to')} {destination}</h4>
                      <span className="int-status-badge active">{tr('driverDashboard.postHire.assigned', 'Assigned')}</span>
                    </div>
                    <div className="dd-route-info">
                      <div className="dd-route-details">
                        <div>{tr('driverDashboard.postHire.pickup', 'Pickup')}: {load.pickup_date || tr('common.tbd', 'TBD')}</div>
                        <div>{tr('driverDashboard.postHire.delivery', 'Delivery')}: {load.delivery_date || tr('common.tbd', 'TBD')}</div>
                        <div>{tr('driverDashboard.postHire.rate', 'Rate')}: ${loadRate}</div>
                      </div>
                      <div className="dd-route-actions">
                        <button className="btn small-cd" onClick={() => handleStartTrip(load)}>
                          {tr('driverDashboard.postHire.startTrip', 'Start Trip')}
                        </button>
                        <button className="btn small ghost-cd">{tr('driverDashboard.postHire.viewDetails', 'View Details')}</button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="card dd-route-card" style={{textAlign: 'center', padding: '30px'}}>
                <i className="fa-solid fa-clipboard-list" style={{fontSize: '2.5rem', color: ddTheme.iconMuted, marginBottom: '12px'}}></i>
                <p style={{margin: 0, color: ddTheme.muted}}>{tr('driverDashboard.postHire.noAssignedLoads', 'No assigned loads at the moment')}</p>
              </div>
            )}

            {/* Live Route Tracking */}
            <div className="card dd-live-route-card">
              <div className="dd-section-title">
                <h3>{tr('driverDashboard.postHire.liveRouteTracking', 'Live Route Tracking')}</h3>
              </div>
              <div className="dd-live-route-content">
                <HereMap
                  containerId="driver-route-map"
                  center={{ lat: 39.8283, lng: -98.5795 }}
                  zoom={6}
                  markers={[
                    { lat: 39.8283, lng: -98.5795, label: tr('driverDashboard.postHire.currentLocation', 'Current Location'), icon: 'https://cdn-icons-png.flaticon.com/512/684/684908.png' }
                  ]}
                  height="300px"
                  width="100%"
                />
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="dd-right-column">
            {/* Compliance Status */}
            <div className="card dd-compliance-card">
              <div className="dd-section-title">
                <h3>{tr('driverDashboard.postHire.complianceStatus', 'Compliance Status')}</h3>
              </div>
              <div className="dd-compliance-items">
                {complianceCardItems.map((item) => (
                  <div className="dd-compliance-item" key={item.key}>
                    <i className={item.icon}></i>
                    <span>{item.label}</span>
                    {complianceStatusIcon(item.status)}
                  </div>
                ))}
              </div>
              <button className="btn small-cd" style={{width: '100%'}} onClick={() => handleNavClick('compliance')}>
                {homeComplianceLoading ? tr('common.loading', 'Loading…') : tr('driverDashboard.postHire.viewAllDocuments', 'View All Documents')}
              </button>
            </div>

            {/* Messages & Alerts Section */}
            <div className="dd-messages-alerts-section">
              <h3 className="dd-section-title">{tr('driverDashboard.postHire.messagesAndAlerts', 'Messages & Alerts')}</h3>

              {msgTrayLoading && (msgTrayThreads || []).length === 0 ? (
                <div className="card dd-message-card" style={{ padding: 16, opacity: 0.9 }}>
                  {tr('driverDashboard.postHire.loadingMessages', 'Loading messages…')}
                </div>
              ) : (msgTrayThreads || []).length === 0 ? (
                <div className="card dd-message-card" style={{ padding: 16, opacity: 0.9 }}>
                  {tr('driverDashboard.postHire.noMessagesYet', 'No messages yet.')}
                </div>
              ) : (
                (msgTrayThreads || [])
                  .slice()
                  .sort((a, b) => (Number(b?.last_message_at || 0) - Number(a?.last_message_at || 0)))
                  .slice(0, 3)
                  .map((t) => {
                    const threadId = String(t?.id || '').trim();
                    const unread = Boolean(msgTrayUnreadSummary?.threads?.[threadId]?.has_unread);
                    const title = String(t?.display_title || t?.other_display_name || t?.title || tr('common.message', 'Message'));
                    const text = String(t?.last_message?.text || '').trim() || tr('driverDashboard.postHire.openToViewMessages', 'Open to view messages.');
                    return (
                      <button
                        key={threadId || title}
                        type="button"
                        className={`card dd-message-card ${unread ? 'dd-notif-item--unread' : ''}`}
                        onClick={() => {
                          if (!threadId) return;
                          setInitialThreadId(threadId);
                          setActiveNav('messaging');
                        }}
                        style={{ textAlign: 'left', width: '100%', cursor: threadId ? 'pointer' : 'default' }}
                      >
                        <div className="dd-message-icon">
                          <i className="fa-solid fa-comment" />
                        </div>
                        <div className="dd-message-content">
                          <div className="dd-message-title">{title}{unread ? ` (${tr('common.new', 'New')})` : ''}</div>
                          <div className="dd-message-text">{text}</div>
                        </div>
                      </button>
                    );
                  })
              )}
            </div>

            {/* AI Suggestions Card */}
            {Boolean(userSettings?.notification_preferences?.ai_tips) && (
              <div className="card dd-ai-suggestions-separate-card">
                <div className="dd-section-title">
                  <span>{tr('driverDashboard.postHire.aiSuggestions', 'AI Suggestions')}</span>
                </div>
                <div className="dd-suggestion-item">
                  <div className="dd-suggestion-title">{tr('driverDashboard.postHire.ai.fuelStopRecommended', 'Fuel Stop Recommended')}</div>
                  <div className="dd-suggestion-text">{tr('driverDashboard.postHire.ai.fuelStopRecommendedDesc', 'Pilot at Exit 142 - Best price in 50 miles ahead')}</div>
                  <button className="dd-suggestion-link">{tr('driverDashboard.postHire.navigate', 'Navigate')}</button>
                </div>
                <div className="dd-suggestion-item">
                  <div className="dd-suggestion-title">{tr('driverDashboard.postHire.ai.breakRequiredSoon', 'Break Required Soon')}</div>
                  <div className="dd-suggestion-text">{tr('driverDashboard.postHire.ai.breakRequiredSoonDesc', '30-min break needed in 45 minutes')}</div>
                  <button className="dd-suggestion-link">{tr('driverDashboard.postHire.ai.findRestAreas', 'Find Rest Areas')}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Driver Compliance View Component
  function DriverComplianceView() {
    const [loading, setLoading] = useState(true);
    const [complianceStatus, setComplianceStatus] = useState({
      score: 0, breakdown: {}, status_color: 'Red', documents: [], issues: [], warnings: [], recommendations: []
    });
    const [complianceData, setComplianceData] = useState({
      cdlNumber: '', cdlState: '', cdlClass: '', cdlExpiry: '', medicalCardExpiry: '',
      drugTestStatus: 'pending', mvrStatus: 'pending', clearinghouseStatus: 'pending'
    });
    const [complianceTasks, setComplianceTasks] = useState([]);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [analyzingAI, setAnalyzingAI] = useState(false);

    const fetchData = useCallback(async () => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const statusRes = await fetch(`${API_URL}/compliance/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (statusRes.ok) {
          const data = await statusRes.json();
          setComplianceStatus({
            score: data.compliance_score || 0, breakdown: data.score_breakdown || {},
            status_color: data.status_color || 'Red', documents: data.documents || [],
            issues: data.issues || [], warnings: data.warnings || [],
            recommendations: data.recommendations || []
          });
          if (data.role_data) {
            setComplianceData(prev => ({
              ...prev, cdlNumber: data.role_data.cdl_number || '', cdlState: data.role_data.cdl_state || '',
              cdlClass: data.role_data.cdl_class || '', cdlExpiry: data.role_data.cdl_expiry || '',
              medicalCardExpiry: data.role_data.medical_card_expiry || '',
              drugTestStatus: data.role_data.drug_test_status || 'pending',
              mvrStatus: data.role_data.mvr_status || 'pending',
              clearinghouseStatus: data.role_data.clearinghouse_status || 'pending'
            }));
          }
        }
        const tasksRes = await fetch(`${API_URL}/compliance/tasks`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (tasksRes.ok) setComplianceTasks(await tasksRes.json());
      } catch (e) {
        console.error('Error:', e);
      } finally {
        setLoading(false);
      }
    }, [currentUser]);

    useEffect(() => {
      if (!currentUser) return;
      fetchData();

      const onDocsUpdated = () => fetchData();
      const onFocus = () => fetchData();
      const onVisibility = () => {
        if (!document.hidden) fetchData();
      };

      window.addEventListener('fp:documents-updated', onDocsUpdated);
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.removeEventListener('fp:documents-updated', onDocsUpdated);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }, [currentUser, fetchData]);

    const runAIAnalysis = async () => {
      if (!currentUser) return;
      setAnalyzingAI(true);
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_URL}/compliance/ai-analyze`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) setAiAnalysis(await res.json());
      } catch (e) { console.error('AI error:', e); }
      finally { setAnalyzingAI(false); }
    };

    const cvTheme = {
      text: isDarkMode ? '#f1f5f9' : '#0f172a',
      muted: isDarkMode ? '#94a3b8' : '#6b7280',
      border: isDarkMode ? '#353535' : '#e5e7eb',
      rowBorder: isDarkMode ? '#353535' : '#f3f4f6',
      surfaceAlt: isDarkMode ? '#1f2937' : '#f8fafc',
      successBg: isDarkMode ? '#052e16' : '#f0fdf4',
      successText: isDarkMode ? '#bbf7d0' : '#166534'
    };

    const getScoreColor = (score) => score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

    if (loading) return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
        <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6' }}></i>
        <span style={{ marginLeft: '10px' }}>{tr('driverDashboard.compliance.loadingData', 'Loading compliance data...')}</span>
      </div>
    );

    return (
      <div style={{ padding: '20px' }}>
        <header style={{ marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>{tr('driverDashboard.compliance.title', 'Compliance & Safety')}</h2>
          <p style={{ color: cvTheme.muted, margin: '8px 0' }}>{tr('driverDashboard.compliance.subtitle', 'Monitor your compliance status and required documents')}</p>
        </header>

        {/* Score Card */}
        <div className="card" style={{ padding: '20px', marginBottom: '20px', background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)', color: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, color: 'white' }}>{tr('driverDashboard.compliance.aiScore', 'AI Compliance Score')}</h3>
              <p style={{ margin: '8px 0 0', opacity: 0.8 }}>{tr('driverDashboard.compliance.aiScoreSubtitle', 'Based on documents, verification, and completeness')}</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '48px', fontWeight: 'bold', color: getScoreColor(complianceStatus.score) }}>
                {complianceStatus.score}%
              </div>
              <div style={{ fontSize: '14px', opacity: 0.8 }}>{complianceStatus.status_color} {tr('common.status', 'Status')}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '20px' }}>
            {Object.entries(complianceStatus.breakdown).map(([key, val]) => (
              <div key={key} style={{ background: 'rgba(255,255,255,0.1)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'capitalize' }}>{key.replace('_', ' ')}</div>
                <div style={{ fontSize: '20px', fontWeight: '600' }}>{val}%</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          {/* Left Column */}
          <div>
            {/* CDL & Credentials */}
            <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
              <h4 style={{ margin: '0 0 16px' }}><i className="fas fa-id-card" style={{ marginRight: '8px' }}></i>{tr('driverDashboard.compliance.cdlCredentials', 'CDL & Credentials')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div><strong>{tr('driverDashboard.compliance.cdlNumber', 'CDL Number')}:</strong> {complianceData.cdlNumber || tr('common.notProvided', 'Not provided')}</div>
                <div><strong>{tr('driverDashboard.compliance.cdlState', 'CDL State')}:</strong> {complianceData.cdlState || tr('common.notProvided', 'Not provided')}</div>
                <div><strong>{tr('driverDashboard.compliance.cdlClass', 'CDL Class')}:</strong> {complianceData.cdlClass || tr('common.notProvided', 'Not provided')}</div>
                <div><strong>{tr('driverDashboard.compliance.cdlExpiry', 'CDL Expiry')}:</strong> {complianceData.cdlExpiry || tr('common.notProvided', 'Not provided')}</div>
                <div><strong>{tr('driverDashboard.compliance.medicalCardExpiry', 'Medical Card Expiry')}:</strong> {complianceData.medicalCardExpiry || tr('common.notProvided', 'Not provided')}</div>
              </div>
            </div>

            {/* Compliance Checks */}
            <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
              <h4 style={{ margin: '0 0 16px' }}><i className="fas fa-clipboard-check" style={{ marginRight: '8px' }}></i>{tr('driverDashboard.compliance.complianceChecks', 'Compliance Checks')}</h4>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: cvTheme.surfaceAlt, borderRadius: '8px' }}>
                  <span>{tr('driverDashboard.compliance.drugTest', 'Drug Test')}</span>
                  <span className={`int-status-badge ${complianceData.drugTestStatus === 'passed' ? 'active' : 'pending'}`}>
                    {tr(`driverDashboard.compliance.status.${String(complianceData.drugTestStatus || 'pending').toLowerCase()}`, complianceData.drugTestStatus)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: cvTheme.surfaceAlt, borderRadius: '8px' }}>
                  <span>{tr('driverDashboard.compliance.mvrCheck', 'MVR Check')}</span>
                  <span className={`int-status-badge ${complianceData.mvrStatus === 'passed' ? 'active' : 'pending'}`}>
                    {tr(`driverDashboard.compliance.status.${String(complianceData.mvrStatus || 'pending').toLowerCase()}`, complianceData.mvrStatus)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: cvTheme.surfaceAlt, borderRadius: '8px' }}>
                  <span>{tr('driverDashboard.compliance.clearinghouse', 'FMCSA Clearinghouse')}</span>
                  <span className={`int-status-badge ${complianceData.clearinghouseStatus === 'passed' ? 'active' : 'pending'}`}>
                    {tr(`driverDashboard.compliance.status.${String(complianceData.clearinghouseStatus || 'pending').toLowerCase()}`, complianceData.clearinghouseStatus)}
                  </span>
                </div>
              </div>
            </div>

            {/* Documents */}
            <div className="card" style={{ padding: '20px' }}>
              <h4 style={{ margin: '0 0 16px' }}><i className="fas fa-file-alt" style={{ marginRight: '8px' }}></i>{tr('driverDashboard.compliance.uploadedDocuments', 'Uploaded Documents')}</h4>
              {complianceStatus.documents && complianceStatus.documents.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ borderBottom: `1px solid ${cvTheme.border}` }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>{tr('driverDashboard.compliance.table.document', 'Document')}</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>{tr('driverDashboard.compliance.table.type', 'Type')}</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>{tr('driverDashboard.compliance.table.expiry', 'Expiry')}</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>{tr('driverDashboard.compliance.table.status', 'Status')}</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>{tr('driverDashboard.compliance.table.uploaded', 'Uploaded')}</th>
                  </tr></thead>
                  <tbody>
                    {complianceStatus.documents.map((doc, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${cvTheme.rowBorder}` }}>
                        <td style={{ padding: '8px' }}>{doc.file_name || doc.filename || tr('driverDashboard.compliance.table.document', 'Document')}</td>
                        <td style={{ padding: '8px', fontSize: '12px' }}>{(doc.document_type || doc.type || 'OTHER').replace(/_/g, ' ').toUpperCase()}</td>
                        <td style={{ padding: '8px', fontSize: '12px', color: cvTheme.muted }}>
                          {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString(locale) : tr('common.na', 'N/A')}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <span className={`int-status-badge ${doc.status === 'Valid' ? 'active' : doc.status === 'Expired' ? 'inactive' : 'pending'}`}>
                            {doc.status || tr('common.unknown', 'Unknown')}
                          </span>
                        </td>
                        <td style={{ padding: '8px', color: cvTheme.muted, fontSize: '12px' }}>
                          {doc.uploaded_at ? new Date(doc.uploaded_at * 1000).toLocaleDateString(locale, { 
                            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                          }) : tr('common.na', 'N/A')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p style={{ color: cvTheme.muted }}>{tr('driverDashboard.compliance.noDocumentsUploaded', 'No documents uploaded yet')}</p>}
            </div>
          </div>

          {/* Right Column - AI Assistant */}
          <div>
            <div className="card" style={{ padding: '20px' }}>
              <h4 style={{ margin: '0 0 16px' }}><i className="fas fa-robot" style={{ marginRight: '8px' }}></i>{tr('driverDashboard.compliance.aiAssistant', 'AI Compliance Assistant')}</h4>
              <button onClick={runAIAnalysis} disabled={analyzingAI} className="btn small-cd" style={{ width: '100%', marginBottom: '16px' }}>
                {analyzingAI ? tr('driverDashboard.compliance.analyzing', 'Analyzing...') : tr('driverDashboard.compliance.runAiAnalysis', 'Run AI Analysis')}
              </button>
              {aiAnalysis && (
                <div style={{ padding: '12px', background: cvTheme.successBg, color: cvTheme.successText, borderRadius: '8px', marginBottom: '16px' }}>
                  <strong>{tr('driverDashboard.compliance.riskLevel', 'Risk Level')}:</strong> {aiAnalysis.analysis?.risk_level || tr('common.unknown', 'Unknown')}
                  <p style={{ margin: '8px 0 0', fontSize: '14px' }}>{aiAnalysis.analysis?.summary || ''}</p>

                  {Array.isArray(aiAnalysis.analysis?.top_findings) && aiAnalysis.analysis.top_findings.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{tr('driverDashboard.compliance.topFindings', 'Top Findings')}</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {aiAnalysis.analysis.top_findings.slice(0, 5).map((item, i) => (
                          <li key={`finding-${i}`} style={{ marginBottom: 4 }}>{String(item)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(aiAnalysis.analysis?.next_actions) && aiAnalysis.analysis.next_actions.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{tr('driverDashboard.compliance.nextActions', 'Next Actions')}</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {aiAnalysis.analysis.next_actions.slice(0, 5).map((item, i) => (
                          <li key={`action-${i}`} style={{ marginBottom: 4 }}>{String(item)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <h5 style={{ margin: '16px 0 8px' }}>{tr('driverDashboard.compliance.tasks', 'Tasks')}</h5>
              {complianceTasks.length > 0 ? complianceTasks.slice(0, 5).map((task, idx) => (
                <div key={idx} style={{ padding: '8px', background: cvTheme.surfaceAlt, borderRadius: '6px', marginBottom: '8px', fontSize: '14px' }}>
                  <strong>{task.title}</strong>
                  <div style={{ color: cvTheme.muted, fontSize: '12px' }}>{task.description}</div>
                </div>
              )) : <p style={{ color: cvTheme.muted, fontSize: '14px' }}>{tr('driverDashboard.compliance.noPendingTasks', 'No pending tasks')}</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function ContentView({ activeNav }) {
    switch (activeNav) {
      case 'home':
        return isPostHire ? <PostHireView /> : <HomeView />;
      case 'docs':
        return <DocumentVault isPostHire={isPostHire} setIsPostHire={setIsPostHire} onNavigate={handleNavClick} />;
      case 'marketplace':
        return (
          <Marketplace 
            isPostHire={isPostHire} 
            setIsPostHire={setIsPostHire}
            isAvailable={isAvailable}
            onAvailabilityToggle={handleAvailabilityToggle}
            onNavigate={handleNavClick}
          />
        );
      case 'carrier':
        return <MyCarrier />;
      case 'compliance':
        return <DriverComplianceView />;
      case 'hiring':
        return <HiringOnboarding onNavigate={handleNavClick} />;
      case 'esign':
        return <ConsentESignature />;
      case 'messaging':
        return <Messaging initialThreadId={initialThreadId} />;
      case 'alerts':
        return (
          <AlertsNotifications
            items={notifItems}
            loading={notifLoading}
            isDarkMode={isDarkMode}
            onRefresh={fetchNotifications}
            onAction={handleNotifAction}
            onMarkRead={markNotificationRead}
          />
        );
      case 'settings':
        return <AccountSettings onNavigate={handleNavClick} onProfileUpdate={() => {
          // Refresh profile data when settings are updated
          const fetchProfile = async () => {
            if (!currentUser) return;
            try {
              const token = await currentUser.getIdToken();
              const response = await fetch(`${API_URL}/onboarding/data`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });
              if (response.ok) {
                const data = await response.json();
                if (data.data) {
                  setProfileData({
                    name: data.data.fullName || currentUser.displayName || 'Driver',
                    profilePicture: data.data.profile_picture_url || null,
                    role: isPostHire ? 'Active Driver' : 'Pre-Hire Driver'
                  });
                }
              }
            } catch (error) {
              console.error('Error refreshing profile:', error);
            }
          };
          fetchProfile();
        }} />;
      case 'help':
        return <AiHub />;
      default:
        return (
          <div>
            <header className="fp-header">
              <div className="fp-header-titles">
                <h2>{navGroups.flatMap(g => g.items).find(i => i.key === activeNav)?.label || tr('driverDashboard.generic.view', 'View')}</h2>
                <p className="fp-subtitle">{tr('driverDashboard.generic.placeholderDesc', 'This is the view. Only the inner area changes.')}</p>
              </div>
            </header>
            <section className="fp-grid">
              <div className="card">
                <div className="card-header"><h3>{tr('driverDashboard.generic.placeholder', 'Placeholder')}</h3></div>
              </div>
            </section>
          </div>
        );
    }
  }

  return (
    <div className={`fp-dashboard-root dd-driver-dashboard ${isDarkMode ? 'dark-root' : ''}`}>
      {toast && (
        <div
          className="fp-toast"
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 3000,
            background: 'rgba(17, 24, 39, 0.95)',
            color: '#fff',
            padding: '12px 14px',
            borderRadius: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            width: 'min(360px, calc(100vw - 32px))',
            border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'pointer',
          }}
          onClick={() => {
            setActiveNav('messaging');
            setToast(null);
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{toast.title}</div>
          <div style={{ fontSize: 13, opacity: 0.95 }}>{toast.body}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>{tr('driverDashboard.toast.clickToOpenMessaging', 'Click to open Messaging')}</div>
        </div>
      )}
      <div className="fp-topbar">
        <div className="topbar-row topbar-row-1">
          <div className="topbar-left">
            <button className="hamburger" aria-label={tr('driverDashboard.topbar.openSidebar', 'Open sidebar')} onClick={() => setIsSidebarOpen(true)}>
              <i className="fa-solid fa-bars" />
            </button>
            <div className="brand-block">
              <div className="brand-row">
                <div className="logo">
                  <div className="logo">
                                    {/* Desktop / large-screen logo */}
                                    <img src={logo} alt={tr('driverDashboard.logoAlt', 'FreightPower')} className="landing-logo-image desktop-logo" />
                                    {/* Responsive compact logo shown at <=768px */}
                                    <img src={resp_logo} alt={tr('driverDashboard.logoAlt', 'FreightPower')} className="landing-logo-image mobile-logo" />
                                  </div>
                </div>
                      <div className="user-profile dd-user-profile">
                        <img 
                          src={profileData.profilePicture || "https://randomuser.me/api/portraits/men/75.jpg"} 
                          alt={profileData.name} 
                          className="avatar-img user-avatar-desktop dd-avatar-img"
                          onError={(e) => {
                            e.target.src = "https://randomuser.me/api/portraits/men/75.jpg";
                          }}
                        />
                        <div className="user-info user-info-desktop dd-user-info">
                          <div className="user-name">{profileData.name || tr('driverDashboard.home.defaultName', 'Driver')}</div>
                          <div className="user-role dd-user-role">{isPostHire ? tr('driverDashboard.role.activeDriver', 'Active Driver') : tr('driverDashboard.role.preHireDriver', 'Pre-Hire Driver')}</div>
                        </div>
                      </div>

              </div>
            </div>
          </div>

          <div className="topbar-right actions-right dd-actions-right">
            {isPostHire ? (
              /* Post-hire topbar content */
              <>
                <span className="dd-posthire-status">
                  <span className="dd-status-dot dd-all-docs-active" />
                  <span className="dd-status-text">{tr('driverDashboard.postHire.allDocsActive', 'All Docs Active')}</span>
                </span>
                <span className="dd-posthire-status">
                  <span className="dd-status-text">{isAvailable ? tr('common.available', 'Available') : tr('common.unavailable', 'Unavailable')}</span>
                  <label className="dd-toggle-switch">
                    <input 
                      type="checkbox" 
                      checked={isAvailable}
                      onChange={handleAvailabilityToggle}
                      disabled={availabilityLoading}
                    />
                    <span className="dd-toggle-slider"></span>
                  </label>
                </span>
                <span className="dd-posthire-status">
                  <i className="fa-regular fa-clock dd-timer-icon" />
                  <span className="dd-status-text">{timeLeftLabel}</span>
                </span>
                <div className="dd-notif-bell" style={{ position: 'relative' }}>
                  <div id="fp-notif-dropdown-root" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="notif"
                      onClick={handleNotifToggle}
                      aria-label={tr('driverDashboard.notifications.openTray', 'Open notifications tray')}
                      style={{ position: 'relative' }}
                    >
                    <i className="fa-regular fa-bell notif-icon dd-notif-icon" aria-hidden="true" />
                    {notifUnread > 0 && <span className="dd-notif-badge">{notifUnread > 99 ? '99+' : notifUnread}</span>}
                    </button>

                    {notifOpen && (
                      <div className="dd-notif-dropdown" role="dialog" aria-label={tr('common.notifications', 'Notifications')}>
                        <div className="dd-notif-dropdown-header">
                          <div className="dd-notif-dropdown-title">{tr('common.notifications', 'Notifications')}</div>
                          <div className="dd-notif-dropdown-actions">
                            <button type="button" className="btn small ghost-cd" onClick={() => setNotifOpen(false)}>
                              {tr('common.close', 'Close')}
                            </button>
                          </div>
                        </div>

                        <div className="dd-notif-dropdown-body" style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                          <div className="dd-notif-section">
                            <div className="dd-notif-section-title">
                              {tr('driverDashboard.notifications.unopened', 'Unopened')} ({(notifItems || []).filter((n) => !n?.is_read).length})
                            </div>
                            {(notifItems || []).filter((n) => !n?.is_read).length === 0 ? (
                              <div className="dd-notif-empty">{tr('driverDashboard.notifications.noneUnopened', 'No unopened notifications.')}</div>
                            ) : (
                              (notifItems || [])
                                .filter((n) => !n?.is_read)
                                .slice(0, 3)
                                .map((n) => (
                                  <button
                                    key={String(n?.id || Math.random())}
                                    type="button"
                                    className="dd-notif-item dd-notif-item--unread"
                                    onClick={() => handleNotifAction(n)}
                                  >
                                    <div className="dd-notif-item-title">{String(n?.title || tr('driverDashboard.notifications.notification', 'Notification'))}</div>
                                    <div className="dd-notif-item-body">{String(n?.message || n?.body || '')}</div>
                                    <div className="dd-notif-item-when">{String(n?.relative_time || n?.formatted_time || '')}</div>
                                  </button>
                                ))
                            )}
                          </div>

                          <div className="dd-notif-section" style={{ marginTop: 10 }}>
                            <div className="dd-notif-section-title">{tr('driverDashboard.notifications.opened', 'Opened')}</div>
                            {(notifItems || []).filter((n) => Boolean(n?.is_read)).length === 0 ? (
                              <div className="dd-notif-empty">{tr('driverDashboard.notifications.noneOpened', 'No opened notifications.')}</div>
                            ) : (
                              (notifItems || [])
                                .filter((n) => Boolean(n?.is_read))
                                .slice(0, 3)
                                .map((n) => (
                                  <button
                                    key={String(n?.id || Math.random())}
                                    type="button"
                                    className="dd-notif-item"
                                    onClick={() => handleNotifAction(n)}
                                  >
                                    <div className="dd-notif-item-title">{String(n?.title || tr('driverDashboard.notifications.notification', 'Notification'))}</div>
                                    <div className="dd-notif-item-body">{String(n?.message || n?.body || '')}</div>
                                    <div className="dd-notif-item-when">{String(n?.relative_time || n?.formatted_time || '')}</div>
                                  </button>
                                ))
                            )}
                          </div>

                          {Boolean(notifLoading) && (
                            <div className="dd-notif-empty">{tr('common.loading', 'Loading…')}</div>
                          )}

                          <button
                            type="button"
                            onClick={openAlerts}
                            className="dd-notif-see-more"
                            style={{
                              marginTop: 10,
                              width: '100%',
                              textAlign: 'center',
                              fontSize: 12,
                              opacity: 0.85,
                              textDecoration: 'underline',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            {tr('driverDashboard.notifications.seeMore', 'Click to see more')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Pre-hire topbar content */
              <>
                {missingRequiredDocsCount > 0 && (
                  <span className="dd-missing-doc-chip">
                    <span className="missing-doc-dot dd-missing-doc-dot" />
                    <span className="missing-doc-text dd-missing-doc-text">{tr('driverDashboard.docs.missingDocs', 'Missing Docs')}</span>
                  </span>
                )}
                <div className="dd-notif-bell" style={{ position: 'relative' }}>
                  <div id="fp-notif-dropdown-root" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="notif"
                      onClick={handleNotifToggle}
                      aria-label={tr('driverDashboard.notifications.openTray', 'Open notifications tray')}
                      style={{ position: 'relative' }}
                    >
                    <i className="fa-regular fa-bell notif-icon dd-notif-icon" aria-hidden="true" />
                    {notifUnread > 0 && <span className="dd-notif-badge">{notifUnread > 99 ? '99+' : notifUnread}</span>}
                    </button>

                    {notifOpen && (
                      <div className="dd-notif-dropdown" role="dialog" aria-label={tr('common.notifications', 'Notifications')}>
                        <div className="dd-notif-dropdown-header">
                          <div className="dd-notif-dropdown-title">{tr('common.notifications', 'Notifications')}</div>
                          <div className="dd-notif-dropdown-actions">
                            <button type="button" className="btn small ghost-cd" onClick={() => setNotifOpen(false)}>
                              {tr('common.close', 'Close')}
                            </button>
                          </div>
                        </div>

                        <div className="dd-notif-dropdown-body" style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
                          <div className="dd-notif-section">
                            <div className="dd-notif-section-title">
                              {tr('driverDashboard.notifications.unopened', 'Unopened')} ({(notifItems || []).filter((n) => !n?.is_read).length})
                            </div>
                            {(notifItems || []).filter((n) => !n?.is_read).length === 0 ? (
                              <div className="dd-notif-empty">{tr('driverDashboard.notifications.noneUnopened', 'No unopened notifications.')}</div>
                            ) : (
                              (notifItems || [])
                                .filter((n) => !n?.is_read)
                                .slice(0, 3)
                                .map((n) => (
                                  <button
                                    key={String(n?.id || Math.random())}
                                    type="button"
                                    className="dd-notif-item dd-notif-item--unread"
                                    onClick={() => handleNotifAction(n)}
                                  >
                                    <div className="dd-notif-item-title">{String(n?.title || tr('driverDashboard.notifications.notification', 'Notification'))}</div>
                                    <div className="dd-notif-item-body">{String(n?.message || n?.body || '')}</div>
                                    <div className="dd-notif-item-when">{String(n?.relative_time || n?.formatted_time || '')}</div>
                                  </button>
                                ))
                            )}
                          </div>

                          <div className="dd-notif-section" style={{ marginTop: 10 }}>
                            <div className="dd-notif-section-title">{tr('driverDashboard.notifications.opened', 'Opened')}</div>
                            {(notifItems || []).filter((n) => Boolean(n?.is_read)).length === 0 ? (
                              <div className="dd-notif-empty">{tr('driverDashboard.notifications.noneOpened', 'No opened notifications.')}</div>
                            ) : (
                              (notifItems || [])
                                .filter((n) => Boolean(n?.is_read))
                                .slice(0, 3)
                                .map((n) => (
                                  <button
                                    key={String(n?.id || Math.random())}
                                    type="button"
                                    className="dd-notif-item"
                                    onClick={() => handleNotifAction(n)}
                                  >
                                    <div className="dd-notif-item-title">{String(n?.title || tr('driverDashboard.notifications.notification', 'Notification'))}</div>
                                    <div className="dd-notif-item-body">{String(n?.message || n?.body || '')}</div>
                                    <div className="dd-notif-item-when">{String(n?.relative_time || n?.formatted_time || '')}</div>
                                  </button>
                                ))
                            )}
                          </div>

                          {Boolean(notifLoading) && (
                            <div className="dd-notif-empty">{tr('common.loading', 'Loading…')}</div>
                          )}

                          <button
                            type="button"
                            onClick={openAlerts}
                            className="dd-notif-see-more"
                            style={{
                              marginTop: 10,
                              width: '100%',
                              textAlign: 'center',
                              fontSize: 12,
                              opacity: 0.85,
                              textDecoration: 'underline',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            {tr('driverDashboard.notifications.seeMore', 'Click to see more')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`fp-content-row ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <aside className={`fp-sidebar ${isSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div className="brand-row">
              <div className="logo"><img src={logo} alt={tr('driverDashboard.logoAlt', 'FreightPower')} className="landing-logo-image" /></div>
            </div>
            <div className="ids mobile-ids">
              <div className="mobile-id-line"><span className="id-pair"><span className="id-label">{profileData.name || tr('driverDashboard.home.defaultName', 'Driver')}</span></span></div>
              <div className="mobile-id-line"><span className="id-pair"><span className="id-label">{isPostHire ? tr('driverDashboard.role.activeDriver', 'Active Driver') : tr('driverDashboard.role.preHireDriver', 'Pre-Hire Driver')}</span></span></div>
            </div>
            <div className="chips sidebar-chips">
              {isPostHire ? (
                <>
                  <span className="chip green">{tr('driverDashboard.postHire.allDocsActive', 'All Docs Active')}</span>
                  <span className={`chip ${isAvailable ? 'blue' : 'gray'}`}>
                    {isAvailable ? tr('common.available', 'Available') : tr('common.unavailable', 'Unavailable')}
                  </span>
                  <span className="chip orange">{timeLeftLabel}</span>
                </>
              ) : (
                missingRequiredDocsCount > 0 ? <span className="chip yellow">{tr('driverDashboard.docs.missingDocs', 'Missing Docs')}</span> : null
              )}
            </div>
          </div>
          <nav className="fp-nav">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.title}>
                <div className="nav-group-title">{group.title}</div>
                <ul>
                  {group.items.map((item) => (
                    <li
                      className={`nav-item ${activeNav === item.key ? 'active' : ''}`}
                      key={item.key}
                      onClick={() => handleNavClick(item.key)}
                      role="button"
                      tabIndex={0}
                    >
                      <i className={`${item.icon} icon`} aria-hidden="true"></i>
                      <span className="label">{item.label}</span>
                      {item.key === 'messaging' && messagingUnread > 0 && (
                        <span className="nav-unread-badge">{messagingUnread > 99 ? '99+' : messagingUnread}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="sidebar-dark-control" aria-hidden="false">
            <span className="dark-label">{t(language, 'dashboard.darkMode', 'Dark Mode')}</span>
            <button
              className="dark-toggle"
              aria-pressed={isDarkMode}
              aria-label={t(language, 'dashboard.toggleDarkMode', 'Toggle dark mode')}
              onClick={() => setIsDarkMode((s) => !s)}
            >
              <span className="dark-toggle-knob" />
            </button>
          </div>
          <button className="sidebar-close" aria-label={t(language, 'dashboard.closeSidebar', 'Close sidebar')} onClick={() => setIsSidebarOpen(false)}>
            <i className="fa-solid fa-xmark" />
          </button>
        </aside>

        {isSidebarOpen && <div className="overlay" onClick={() => setIsSidebarOpen(false)} />}

        <main className="fp-main">
          <ContentView activeNav={activeNav} />
        </main>
      </div>

      {/* Support Modal */}
      {showSupportModal && (
        <div className="modal-overlay" onClick={() => setShowSupportModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>{t(language, 'support.title', 'Get Support')}</h3>
              <button className="modal-close" onClick={() => setShowSupportModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <form onSubmit={handleSupportSubmit} style={{ padding: '20px' }}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600' }}>{t(language, 'common.name', 'Name')}</label>
                <input
                  type="text"
                  required
                  value={supportFormData.name}
                  onChange={(e) => setSupportFormData(prev => ({ ...prev, name: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                  placeholder={t(language, 'support.yourName', 'Your name')}
                />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600' }}>{t(language, 'common.email', 'Email')}</label>
                <input
                  type="email"
                  required
                  value={supportFormData.email}
                  onChange={(e) => setSupportFormData(prev => ({ ...prev, email: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                  placeholder={t(language, 'support.yourEmail', 'your.email@example.com')}
                />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600' }}>{t(language, 'common.subject', 'Subject')}</label>
                <input
                  type="text"
                  required
                  value={supportFormData.subject}
                  onChange={(e) => setSupportFormData(prev => ({ ...prev, subject: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                  placeholder={t(language, 'support.subjectPlaceholder', 'Brief description of your issue')}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '600' }}>{t(language, 'common.message', 'Message')}</label>
                <textarea
                  required
                  value={supportFormData.message}
                  onChange={(e) => setSupportFormData(prev => ({ ...prev, message: e.target.value }))}
                  rows={5}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '14px',
                    resize: 'vertical'
                  }}
                  placeholder={t(language, 'support.messagePlaceholder', 'Please describe your issue in detail...')}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn small ghost-cd"
                  onClick={() => setShowSupportModal(false)}
                  disabled={supportSubmitting}
                >
                  {t(language, 'common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="btn small-cd"
                  disabled={supportSubmitting}
                >
                  {supportSubmitting
                    ? t(language, 'common.sending', 'Sending…')
                    : t(language, 'common.sendRequest', 'Send Request')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
