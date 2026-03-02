import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_URL } from '../../config';
import '../../styles/carrier/CarrierDashboard.css';
import peopleIcon from '../../assets/ai_driver.svg';
import MyLoads from './MyLoads';
import DocumentVault from './DocumentVault';
import ShipperPartners from './ShipperPartners';
import Marketplace from './Marketplace';
import DriversAndDispatches from './DriversAndDispatches';
import FactoringInvoicing from './FactoringInvoicing';
import Integrations from './Integrations';
import ComplianceSafety from './ComplianceSafety';
import ConsentESignature from './ConsentESignature';
import Messaging from './Messaging';
import AlertsNotifications from './AlertsNotifications';
import Analytics from './Analytics';
import Calendar from './Calendar';
import Settings from './Settings';
import HelpHub from './HelpHub';
// OnboardingCoach removed - compliance data now shown in Compliance & Safety page
import logo from '/src/assets/logo.png';
import resp_logo from '/src/assets/logo_1.png';
// Note: Font Awesome icons are used instead of custom SVGs for simplicity
// icon images replaced by Font Awesome icons

export default function CarrierDashboard() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Dashboard stats state
  const [activeLoads, setActiveLoads] = useState({ inProgress: 0, delivered: 0, completed: 0 });
  const [driversCompliance, setDriversCompliance] = useState({ active: 0, expiring: 0, alerts: 0 });
  const [earnings, setEarnings] = useState({ week: '$0', month: '$0', factoring: '$0' });
  const [expiringDocuments, setExpiringDocuments] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [marketplaceLoads, setMarketplaceLoads] = useState([]);
  const [availableDriversCount, setAvailableDriversCount] = useState(0);
  const [vehicleCounts, setVehicleCounts] = useState(null); // aggregated across associated drivers
  
  const [activeNav, setActiveNav] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('fp_carrier_preferences') || '{}') || {};
      const dv = String(stored.defaultView || '').trim();
      if (dv === 'Analytics') return 'analytics';
      if (dv === 'My Loads Default View') return 'my-loads';
      if (dv === 'Dashboard Overview') return 'home';
      return 'home';
    } catch {
      return 'home';
    }
  });
  const [initialThreadId, setInitialThreadId] = useState(null);
  const [activeMarketplaceSection, setActiveMarketplaceSection] = useState('loads');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarDark, setIsSidebarDark] = useState(false);
  const [themePreference, setThemePreference] = useState(() => {
    try {
      const v = String(localStorage.getItem('fp_theme_preference') || '').trim().toLowerCase();
      return v === 'light' || v === 'dark' || v === 'device' ? v : 'device';
    } catch {
      return 'device';
    }
  });
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Apply theme preference (light/dark/device) to dashboard.
  useEffect(() => {
    let mediaQuery = null;
    let onChange = null;

    const apply = () => {
      if (themePreference === 'dark') {
        setIsDarkMode(true);
        return;
      }
      if (themePreference === 'light') {
        setIsDarkMode(false);
        return;
      }
      // device
      try {
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        setIsDarkMode(Boolean(mediaQuery.matches));
        onChange = (e) => setIsDarkMode(Boolean(e.matches));
        if (typeof mediaQuery.addEventListener === 'function') {
          mediaQuery.addEventListener('change', onChange);
        } else if (typeof mediaQuery.addListener === 'function') {
          mediaQuery.addListener(onChange);
        }
      } catch {
        setIsDarkMode(false);
      }
    };

    apply();

    return () => {
      if (!mediaQuery || !onChange) return;
      try {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', onChange);
        } else if (typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(onChange);
        }
      } catch {
        // ignore
      }
    };
  }, [themePreference]);

  // Receive theme preference changes from Settings (same-tab custom event).
  useEffect(() => {
    const handler = (e) => {
      const pref = String(e?.detail?.preference || '').trim().toLowerCase();
      const next = pref === 'light' || pref === 'dark' || pref === 'device' ? pref : 'device';
      setThemePreference(next);
      try {
        localStorage.setItem('fp_theme_preference', next);
      } catch {
        // ignore
      }
    };

    window.addEventListener('fp-theme-preference', handler);
    return () => window.removeEventListener('fp-theme-preference', handler);
  }, []);

  // Messaging unread badge
  const [messagingUnread, setMessagingUnread] = useState(0);

  // Home: Recent unread threads snapshot
  const [recentUnreadThreads, setRecentUnreadThreads] = useState([]);
  const [recentUnreadLoading, setRecentUnreadLoading] = useState(false);

  // Notifications state
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifItems, setNotifItems] = useState([]);
  const [latestNotifications, setLatestNotifications] = useState([]);

  // Deep-link support (email links): /carrier-dashboard?nav=messaging&thread=<threadId>
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
  const [companyProfile, setCompanyProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [complianceScore, setComplianceScore] = useState(null);
  const [dotNumber, setDotNumber] = useState('');
  const [mcNumber, setMcNumber] = useState('');

  // FMCSA verification summary (best-effort; may be missing fields)
  const [fmcsaSummary, setFmcsaSummary] = useState(null);
  const [fmcsaLoading, setFmcsaLoading] = useState(false);
  
  // Modal states
  const [showReportFraudModal, setShowReportFraudModal] = useState(false);
  const [showSuggestEditModal, setShowSuggestEditModal] = useState(false);
  const [reportFraudData, setReportFraudData] = useState({ subject: '', message: '' });
  const [suggestEditData, setSuggestEditData] = useState({ subject: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!currentUser) {
        setDashboardLoading(false);
        return;
      }

      const classifyLoad = (load) => {
        const status = String(load?.status || '').toLowerCase();
        if (status === 'draft') return { column: 'draft', statusFlag: 'draft' };
        if (status === 'completed') return { column: 'settled', statusFlag: 'settled' };
        if (status === 'delivered') return { column: 'delivered', statusFlag: 'delivered' };
        if (status === 'in_transit') return { column: 'inTransit', statusFlag: 'in transit' };
        if (status === 'accepted') return { column: 'accepted', statusFlag: 'accepted' };

        const hasDriver = Boolean(load?.assigned_driver || load?.assigned_driver_id);
        if (hasDriver) {
          const das = String(load?.driver_assignment_status || '').toLowerCase();
          if (das === 'accepted' || status === 'covered') return { column: 'accepted', statusFlag: 'accepted' };
          return { column: 'tendered', statusFlag: 'assigned' };
        }
        return { column: 'tendered', statusFlag: 'unassigned' };
      };

      const fmtMoney = (amt) => {
        const n = Number(amt || 0);
        return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };
      
      try {
        const token = await currentUser.getIdToken();

        // Loads: used for both Home Active Loads and Marketplace Snapshot
        let carrierLoads = [];
        try {
          const loadsRes = await fetch(`${API_URL}/loads?page_size=200&exclude_drafts=false`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (loadsRes.ok) {
            const loadsData = await loadsRes.json();
            carrierLoads = loadsData.loads || [];

            const grouped = { accepted: 0, inTransit: 0, delivered: 0, settled: 0 };
            carrierLoads.forEach((l) => {
              const { column } = classifyLoad(l);
              if (column === 'accepted') grouped.accepted += 1;
              if (column === 'inTransit') grouped.inTransit += 1;
              if (column === 'delivered') grouped.delivered += 1;
              if (column === 'settled') grouped.settled += 1;
            });

            setActiveLoads({
              inProgress: grouped.accepted + grouped.inTransit,
              delivered: grouped.delivered,
              completed: grouped.settled,
            });

            const availableLoads = carrierLoads
              .filter(l => l.status === 'posted' || l.status === 'available')
              .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
              .slice(0, 2);
            setMarketplaceLoads(availableLoads);
          }
        } catch (error) {
          console.error('Error fetching loads:', error);
        }
        
        // Fetch drivers data
        const driversRes = await fetch(`${API_URL}/drivers/my-drivers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        let driversData = null; // Store for reuse later
        if (driversRes.ok) {
          driversData = await driversRes.json();
          const drivers = driversData.drivers || [];

          // Aggregate vehicle counts across associated drivers
          const counts = { powerUnits: 0, reefers: 0, dryVans: 0 };
          drivers.forEach((d) => {
            const vtRaw = d?.vehicle_type || d?.vehicleType || '';
            const vt = String(vtRaw).trim().toLowerCase().replace('-', '_').replace(' ', '_');
            if (!vt) return;
            if (vt === 'power_unit' || vt === 'powerunit' || vt === 'tractor' || vt === 'truck') counts.powerUnits += 1;
            else if (vt === 'reefer' || vt === 'refrigerated') counts.reefers += 1;
            else if (vt === 'dry_van' || vt === 'dryvan' || vt === 'dry' || vt === 'van') counts.dryVans += 1;
          });
          setVehicleCounts(counts);
          
          // Count active drivers
          const activeDrivers = drivers.filter(d => d.status === 'available' || d.status === 'assigned' || d.status === 'on_route').length;
          
          // Count expiring licenses (check CDL expiration if available)
          const expiringLicenses = drivers.filter(d => {
            if (d.cdl_expiration_date) {
              const expDate = new Date(d.cdl_expiration_date);
              const today = new Date();
              const daysUntilExpiry = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
              return daysUntilExpiry > 0 && daysUntilExpiry <= 90; // Expiring in next 90 days
            }
            return false;
          }).length;
          
          // Count safety alerts (drivers with low safety scores or violations)
          const safetyAlerts = drivers.filter(d => {
            const safetyScore = d.safety_score || 100;
            return safetyScore < 80 || d.violations_count > 0;
          }).length;
          
          setDriversCompliance({
            active: activeDrivers,
            expiring: expiringLicenses,
            alerts: safetyAlerts
          });
        }
        
        // Fetch compliance status for expiring documents
        const complianceRes = await fetch(`${API_URL}/compliance/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (complianceRes.ok) {
          const cData = await complianceRes.json();
          
          // Extract expiring documents from compliance data
          const expiring = [];
          if (cData.documents) {
            cData.documents.forEach(doc => {
              if (doc.expiration_date) {
                const expDate = new Date(doc.expiration_date);
                const today = new Date();
                const daysUntilExpiry = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
                
                if (daysUntilExpiry > 0 && daysUntilExpiry <= 30) {
                  expiring.push({
                    title: doc.document_type || 'Document',
                    days: daysUntilExpiry,
                    type: daysUntilExpiry <= 7 ? 'pink' : daysUntilExpiry <= 14 ? 'yellow' : 'blue'
                  });
                }
              }
            });
          }
          
          // Sort by days until expiry
          expiring.sort((a, b) => a.days - b.days);
          setExpiringDocuments(expiring.slice(0, 3)); // Show top 3
        }
        
        // Earnings: sum paid (and partially paid) invoices
        try {
          const invRes = await fetch(`${API_URL}/invoices?limit=500`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (invRes.ok) {
            const invData = await invRes.json();
            const invoices = invData.invoices || [];
            const now = Date.now() / 1000;
            const weekAgo = now - 7 * 86400;
            const monthAgo = now - 30 * 86400;

            const paidLike = invoices.filter((inv) => {
              const s = String(inv?.status || '').toLowerCase();
              return s === 'paid' || s === 'partially_paid';
            });

            const paidAmount = (inv) => {
              const s = String(inv?.status || '').toLowerCase();
              if (s === 'paid') return Number(inv?.amount_total || 0);
              return Number(inv?.amount_paid || 0);
            };

            const weekTotal = paidLike
              .filter(inv => Number(inv?.paid_at || 0) >= weekAgo)
              .reduce((sum, inv) => sum + paidAmount(inv), 0);
            const monthTotal = paidLike
              .filter(inv => Number(inv?.paid_at || 0) >= monthAgo)
              .reduce((sum, inv) => sum + paidAmount(inv), 0);
            const factoringTotal = paidLike
              .filter(inv => Boolean(inv?.factoring_enabled))
              .reduce((sum, inv) => sum + paidAmount(inv), 0);

            setEarnings({
              week: fmtMoney(weekTotal),
              month: fmtMoney(monthTotal),
              factoring: fmtMoney(factoringTotal),
            });
          }
        } catch (error) {
          console.error('Error fetching invoices:', error);
        }

        // Home: Recent unread message threads snapshot
        try {
          setRecentUnreadLoading(true);
          const [threadsRes, unreadRes] = await Promise.all([
            fetch(`${API_URL}/messaging/threads?limit=50`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${API_URL}/messaging/unread/summary`, { headers: { 'Authorization': `Bearer ${token}` } }),
          ]);

          const threadsData = threadsRes.ok ? await threadsRes.json() : { threads: [] };
          const unreadData = unreadRes.ok ? await unreadRes.json() : { threads: {} };

          const threads = threadsData.threads || [];
          const perThread = unreadData.threads || {};

          const unreadThreads = threads
            .map((t) => ({
              ...t,
              unread_count: Number(perThread?.[t.id] || 0),
            }))
            .filter((t) => (t.unread_count || 0) > 0)
            .sort((a, b) => Number(b.last_message_at || b.updated_at || 0) - Number(a.last_message_at || a.updated_at || 0))
            .slice(0, 3);

          setRecentUnreadThreads(unreadThreads);
        } catch (error) {
          console.error('Error fetching recent messages:', error);
          setRecentUnreadThreads([]);
        } finally {
          setRecentUnreadLoading(false);
        }
        
        // Get available drivers count from already fetched drivers data
        // Count drivers who are available (not on trip)
        if (driversData) {
          const drivers = driversData.drivers || [];
          const availDrivers = drivers.filter(d => 
            (d.status === 'available' || !d.status) && 
            d.is_available === true
          );
          setAvailableDriversCount(availDrivers.length);
        }
        
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setDashboardLoading(false);
      }
    };
    
    fetchDashboardData();
  }, [currentUser]);

  // Fetch messaging unread summary once (no polling)
  useEffect(() => {
    let alive = true;
    if (!currentUser) return;

    const tick = async () => {
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_URL}/messaging/unread/summary`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setMessagingUnread(Number(data?.total_unread || 0));
      } catch (_) {
        // ignore
      }
    };

    tick();
    return () => {
      alive = false;
    };
  }, [currentUser]);

  // Fetch notifications
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
      setNotifItems(Array.isArray(data?.notifications) ? data.notifications : []);
      setNotifUnread(Number(data?.unread_count || 0));
      // Set latest 3 notifications for home view
      setLatestNotifications((data?.notifications || []).slice(0, 3));
    } catch {
      // ignore
    } finally {
      setNotifLoading(false);
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
      setLatestNotifications((prev) => prev.map((n) => (n?.id === notificationId ? { ...n, is_read: true } : n)));
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

  // Fetch notifications on mount (no polling)
  useEffect(() => {
    if (!currentUser) return;
    fetchNotifications();
  }, [currentUser]);

  // Close dropdown on outside click
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
          setCompanyProfile(data);
          if (typeof data.onboarding_score !== 'undefined') {
            setComplianceScore(data.onboarding_score);
          }
        }

        // also fetch compliance status to show current compliance score
        const complianceRes = await fetch(`${API_URL}/compliance/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (complianceRes.ok) {
          const cData = await complianceRes.json();
          if (typeof cData.compliance_score !== 'undefined') {
            setComplianceScore(cData.compliance_score);
          }
          // Set DOT and MC numbers from the extracted document values
          if (cData.dot_number) {
            setDotNumber(cData.dot_number);
          }
          if (cData.mc_number) {
            setMcNumber(cData.mc_number);
          }
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setProfileLoading(false);
      }
    };
    fetchProfile();
  }, [currentUser]);

  // Fetch FMCSA verification summary (for header chips)
  useEffect(() => {
    let alive = true;
    if (!currentUser) return;

    const usdot = String(dotNumber || companyProfile?.data?.dotNumber || '').trim();
    const mc = String(mcNumber || companyProfile?.data?.mcNumber || '').trim();
    if (!usdot && !mc) return;

    (async () => {
      setFmcsaLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_URL}/fmcsa/verify`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            usdot: usdot || undefined,
            mc_number: mc || undefined
          })
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        setFmcsaSummary(data);
      } catch {
        // ignore
      } finally {
        if (alive) setFmcsaLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [currentUser, dotNumber, mcNumber, companyProfile?.data?.dotNumber, companyProfile?.data?.mcNumber]);

  const dash = '—';
  const isFmcsaVerified = Boolean(
    fmcsaSummary?.verified === true || String(fmcsaSummary?.result || '').trim().toLowerCase() === 'verified'
  );
  const dotStatusText = (isFmcsaVerified
    ? 'ACTIVE'
    : String(
      fmcsaSummary?.dot_status || (fmcsaSummary?.result || '')
    ).trim()
  ) || dash;
  const operatingText = String(
    fmcsaSummary?.authority_status || fmcsaSummary?.operating_authority || ''
  ).trim() || dash;
  const safetyText = String(
    fmcsaSummary?.safety_rating || ''
  ).trim() || dash;
  const eldText = String(companyProfile?.data?.eldProvider || '').trim() || dash;

  // Fleet counts are aggregated from associated drivers' current vehicle types.
  const powerUnitsVal = vehicleCounts?.powerUnits;
  const reefersVal = vehicleCounts?.reefers;
  const dryVansVal = vehicleCounts?.dryVans;

  const navGroups = [
    {
      title: 'OPERATIONS',
      items: [
        { key: 'home', label: 'Home', icon: 'fa-solid fa-house' },
        { key: 'my-loads', label: 'My Loads', icon: 'fa-solid fa-truck' },
        { key: 'docs', label: 'Document Vault', icon: 'fa-solid fa-folder' },
        { key: 'shippers', label: 'My Shippers/Brokers', icon: 'fa-solid fa-people-group' },
        { key: 'marketplace', label: 'Marketplace', icon: 'fa-solid fa-store' },
        { key: 'drivers', label: 'Drivers & Dispatches', icon: 'fa-solid fa-route' },
      ]
    },
    {
      title: 'FINANCE',
      items: [
        { key: 'factoring', label: 'Factoring & Invoicing', icon: 'fa-solid fa-dollar-sign' },
        { key: 'integrations', label: 'Integrations', icon: 'fa-solid fa-plug' }
      ]
    },
    {
      title: 'MANAGEMENT',
      items: [
        { key: 'compliance', label: 'Compliance & Safety', icon: 'fa-solid fa-shield-halved' },
        { key: 'esign', label: 'Consent & eSignature', icon: 'fa-solid fa-pen-fancy' }
      ]
    },
    {
      title: 'COLLABORATION',
      items: [
        { key: 'messaging', label: 'Messaging', icon: 'fa-solid fa-envelope' },
        { key: 'alerts', label: 'Alerts & Notifications', icon: 'fa-solid fa-bell' }
      ]
    },
    {
      title: 'INSIGHTS',
      items: [
        { key: 'analytics', label: 'Analytics & Reports', icon: 'fa-solid fa-chart-column' },
        { key: 'calendar', label: 'Calendar', icon: 'fa-solid fa-calendar-days' }
      ]
    },
    {
      title: 'SYSTEM',
      items: [
        { key: 'settings', label: 'Settings', icon: 'fa-solid fa-gear' },
        { key: 'help', label: 'Help Hub', icon: 'fa-regular fa-circle-question' },
        { key: 'logout', label: 'Logout', icon: 'fa-solid fa-right-from-bracket' }
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

  // Handle Report Fraud
  const handleReportFraud = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setShowReportFraudModal(true);
  };

  const handleSubmitReportFraud = async () => {
    if (!reportFraudData.message.trim()) {
      alert('Please enter a message');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/report-fraud`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: reportFraudData.subject || undefined,
          message: reportFraudData.message,
          user_email: currentUser.email,
          user_name: currentUser.displayName || currentUser.email?.split('@')[0]
        })
      });

      if (response.ok) {
        alert('Fraud report submitted successfully!');
        setReportFraudData({ subject: '', message: '' });
        setShowReportFraudModal(false);
      } else {
        const error = await response.json();
        alert(`Error: ${error.detail || 'Failed to submit fraud report'}`);
      }
    } catch (error) {
      console.error('Error submitting fraud report:', error);
      alert('Failed to submit fraud report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Suggest Edit
  const handleSuggestEdit = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setShowSuggestEditModal(true);
  };

  const handleSubmitSuggestEdit = async () => {
    if (!suggestEditData.message.trim()) {
      alert('Please enter a suggestion');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/suggest-edit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject: suggestEditData.subject || undefined,
          message: suggestEditData.message,
          user_email: currentUser.email,
          user_name: currentUser.displayName || currentUser.email?.split('@')[0]
        })
      });

      if (response.ok) {
        alert('Edit suggestion submitted successfully!');
        setSuggestEditData({ subject: '', message: '' });
        setShowSuggestEditModal(false);
      } else {
        const error = await response.json();
        alert(`Error: ${error.detail || 'Failed to submit edit suggestion'}`);
      }
    } catch (error) {
      console.error('Error submitting edit suggestion:', error);
      alert('Failed to submit edit suggestion. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Small router for the inner content area so the sidebar & topbar remain mounted
  function HomeView() {
    return (
      <>
        <header className="fp-header">
          <div className="fp-header-titles">
            <h2>Dashboard</h2>
            <p className="fp-subtitle">Welcome back! Here's what's happening with your fleet today.</p>
          </div>
        </header>

        {/* Company Profile Card - Shows onboarding data */}
        {!profileLoading && companyProfile && companyProfile.data && (
          <section style={{ marginBottom: '20px' }}>
            <div className="card" style={{ padding: '20px', background: '#f8fafc' }}>
              <div className="card-header">
                <h3><i className="fa-solid fa-building" style={{ marginRight: '8px' }}></i>Company Profile</h3>
                {complianceScore !== null && (
                  <div className="pill" style={{ background:'#e0f2fe', color:'#075985', padding:'6px 10px', borderRadius:'999px', fontWeight:600 }}>
                    Compliance Score: {Math.round(complianceScore)}%
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '16px' }}>
                {companyProfile.data.companyName && (
                  <div><strong>Company:</strong> {companyProfile.data.companyName}</div>
                )}
                {companyProfile.data.dotNumber && (
                  <div><strong>DOT Number:</strong> {companyProfile.data.dotNumber}</div>
                )}
                {companyProfile.data.mcNumber && (
                  <div><strong>MC Number:</strong> {companyProfile.data.mcNumber}</div>
                )}
                {companyProfile.data.contactEmail && (
                  <div><strong>Contact:</strong> {companyProfile.data.contactEmail}</div>
                )}
                {companyProfile.data.fleetSize && (
                  <div><strong>Fleet Size:</strong> {companyProfile.data.fleetSize} units</div>
                )}
                {companyProfile.data.homeTerminal && (
                  <div><strong>Home Terminal:</strong> {companyProfile.data.homeTerminal}</div>
                )}
              </div>
              {!companyProfile.onboarding_completed && (
                <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', color: '#92400e' }}>
                  <i className="fa-solid fa-exclamation-triangle" style={{ marginRight: '8px' }}></i>
                  Onboarding not complete.{' '}
                  <span 
                    onClick={() => setActiveNav('settings')}
                    style={{ color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    Complete now
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Onboarding Coach removed - compliance data now shown in Compliance & Safety page */}

        <section className="fp-grid">
          <div className="card stats-card">
            <div className="card-header">
              <h3>Active Loads</h3>
              <i className="fa-solid fa-truck cd-card-icon small" aria-hidden="true" />
            </div>
            <div className="stats">
              <div>In Progress <span>{dashboardLoading ? '...' : (activeLoads.inProgress ?? '-')}</span></div>
              <div>Delivered <span>{dashboardLoading ? '...' : (activeLoads.delivered ?? '-')}</span></div>
              <div>Completed <span>{dashboardLoading ? '...' : (activeLoads.completed ?? '-')}</span></div>
            </div>
          </div>

          <div className="card compliance-card">
            <div className="card-header">
              <h3>Drivers Compliance</h3>
              <i className="fa-solid fa-people-group cd-card-icon small" aria-hidden="true" />
            </div>
            <div className="stats">
              <div>Active Drivers <span>{dashboardLoading ? '...' : (driversCompliance.active ?? '-')}</span></div>
              <div>Expiring Licenses <span>{dashboardLoading ? '...' : (driversCompliance.expiring ?? '-')}</span></div>
              <div>Safety Alerts <span>{dashboardLoading ? '...' : (driversCompliance.alerts ?? '-')}</span></div>
            </div>
          </div>

          <div className="card small-card expiring-card">
            <div className="card-header">
              <h3>Expiring Documents</h3>
              <i className="fa-solid fa-triangle-exclamation cd-card-icon small" aria-hidden="true" />
            </div>
            <div className="expiring-list">
              {dashboardLoading ? (
                <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>
              ) : expiringDocuments.length > 0 ? (
                expiringDocuments.map((doc, index) => (
                  <div key={index} className={`exp-item pill ${doc.type}`}>
                    <span className="exp-title">{doc.title}</span>
                    <span className={`exp-days ${doc.type}`}>{doc.days} {doc.days === 1 ? 'day' : 'days'}</span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '8px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>No expiring documents</div>
              )}
            </div>
          </div>

          <div className="card suggestions-card">
            <div className="card-header">
              <h3>AI Suggestions</h3>
              <i className="fa-solid fa-robot cd-card-icon small" aria-hidden="true" />
            </div>
            <ul>
              <li>Renew insurance in 12 days to avoid compliance issues</li>
              <li>3 high-paying loads available in your area</li>
            </ul>
          </div>

          <div className="card earnings-card">
            <div className="card-header">
              <h3>Earnings Overview</h3>
              <i className="fa-solid fa-dollar-sign cd-card-icon small" aria-hidden="true" />
            </div>
            <div className="stats earnings-stats">
              <div>This Week <span className="green">{dashboardLoading ? '...' : earnings.week}</span></div>
              <div>This Month <span className="green">{dashboardLoading ? '...' : earnings.month}</span></div>
              <div>Factoring Funded <span className="blue">{dashboardLoading ? '...' : earnings.factoring}</span></div>
            </div>
          </div>

          <div className="card small-card integrations-card">
            <div className="card-header">
              <h3>Integrations Health</h3>
              <i className="fa-solid fa-plug cd-card-icon small" aria-hidden="true" />
            </div>
            <ul className="integrations-list">
              <li>QuickBooks <span className="dot green"/></li>
              <li>ELD System <span className="dot green"/></li>
              <li>Bank Connection <span className="dot orange"/></li>
              <li>Factoring <span className="dot green"/></li>
            </ul>
          </div>

          <div className="card recent-messages span-3">
            <div className="card-row">
              <h3>Recent Messages</h3>
              <a className="view-all" onClick={() => setActiveNav('messaging')} style={{ cursor: 'pointer' }}>View All</a>
            </div>
            <ul className="recent-list">
              {(dashboardLoading || recentUnreadLoading) ? (
                <li className="msg-item" style={{ justifyContent: 'center' }}>
                  <div className="muted">Loading...</div>
                </li>
              ) : (recentUnreadThreads || []).length > 0 ? (
                (recentUnreadThreads || []).map((t) => {
                  const title = t.display_title || t.other_display_name || t.title || 'Conversation';
                  const preview = (t.last_message && t.last_message.text) ? t.last_message.text : 'Unread message';
                  const ts = Number(t.last_message_at || t.updated_at || 0);
                  const timeLabel = ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  const roleLabel = String(t.kind || '').includes('shipper') ? '- Shipper' : String(t.kind || '').includes('driver') ? '- Driver' : '';

                  return (
                    <li
                      key={t.id}
                      className="msg-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => { setInitialThreadId(t.id); setActiveNav('messaging'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setInitialThreadId(t.id); setActiveNav('messaging'); } }}
                      style={{ cursor: 'pointer' }}
                    >
                      <img className="msg-avatar" src={peopleIcon} alt="chat" />
                      <div className="msg-body">
                        <div className="msg-head">
                          <strong>{title}</strong> {roleLabel ? <span className="role">{roleLabel}</span> : null}
                        </div>
                        <div className="muted">{preview}</div>
                      </div>
                      <div className="msg-time">{timeLabel}</div>
                    </li>
                  );
                })
              ) : (
                <li
                  className="msg-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveNav('messaging')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveNav('messaging'); }}
                  style={{ cursor: 'pointer', justifyContent: 'center' }}
                >
                  <div className="muted">No unread messages</div>
                </li>
              )}
            </ul>
          </div>

          <div className="card marketplace-snapshot span-3">
            <div className="card-row">
              <h3>Marketplace Snapshot</h3>
              <button 
                className="btn ghost-cd small"
                onClick={() => { setActiveMarketplaceSection('loads'); setActiveNav('marketplace'); }}
                aria-label="View all marketplace listings"
              >
                View All Marketplace
              </button>
            </div>
            <div className="market-grid">
              <div className="market-col loads">
                <h4 className="col-title">Available Loads</h4>
                {dashboardLoading ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>
                ) : marketplaceLoads.length > 0 ? (
                  marketplaceLoads.map((load, index) => {
                    const origin = typeof load.origin === 'string' ? load.origin : (load.origin?.city ? `${load.origin.city}, ${load.origin.state}` : 'Origin');
                    const destination = typeof load.destination === 'string' ? load.destination : (load.destination?.city ? `${load.destination.city}, ${load.destination.state}` : 'Destination');
                    const rate = load.total_rate || load.linehaul_rate || load.rate || 0;
                    const pickupDate = load.pickup_date || 'TBD';
                    
                    return (
                      <div 
                        key={index} 
                        className="load-item"
                        onClick={() => { setActiveMarketplaceSection('loads'); setActiveNav('marketplace'); }}
                        style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div className="load-left">
                          <div className="load-route">{origin} → {destination}</div>
                          <div className="load-sub muted">{load.load_id || 'Load'}</div>
                        </div>
                        <div className="load-right">
                          <div className="price green">${rate}</div>
                          <div className="pickup muted">Pickup: {pickupDate}</div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>No available loads</div>
                )}
              </div>

              <div className="market-col drivers">
                <h4 className="col-title">Available Drivers</h4>
                <div className="driver-count">{dashboardLoading ? '...' : (availableDriversCount || '-')}</div>
                <div className="driver-sub muted">Drivers ready for hire</div>
                <button className="btn small green-btn" onClick={() => { setActiveMarketplaceSection('drivers'); setActiveNav('marketplace'); }}>View Candidates</button>
              </div>

              <div className="market-col offers">
                <h4 className="col-title">Service Offers</h4>
                <div className="offer-item">
                  <div className="offer-left">Fuel Discount<div className="muted">Save on fuel at 500+ locations</div></div>
                  <div className="offer-right"><span className="int-status-badge active">15% OFF</span></div>
                </div>
                <div className="offer-item">
                  <div className="offer-left">Factoring Rate<div className="muted">Special rate for new clients</div></div>
                  <div className="offer-right"><span className="int-status-badge active">1.5%</span></div>
                </div>
              </div>
            </div>
          </div>

          <div className="card notifications-card span-3">
            <div className="card-row">
              <h3>Latest Notifications</h3>
              <a className="view-all" onClick={() => setActiveNav('alerts')} style={{ cursor: 'pointer' }}>View All</a>
            </div>
            <ul className="notifications-list">
              {latestNotifications.length === 0 ? (
                <li className="notification-item">
                  <div className="note-body">
                    <div className="note-sub muted">No notifications</div>
                  </div>
                </li>
              ) : (
                latestNotifications.map((notif) => {
                  // Determine dot color based on notification type
                  let dotColor = 'blue';
                  if (notif.notification_type === 'compliance_alert') dotColor = 'red';
                  else if (notif.notification_type === 'load_update') dotColor = 'orange';
                  else if (notif.notification_type === 'payment') dotColor = 'green';

                  return (
                    <li 
                      key={notif.id} 
                      className="notification-item"
                      style={{ cursor: notif.action_url ? 'pointer' : 'default' }}
                      onClick={() => handleNotifAction(notif)}
                    >
                      <div className="note-left">
                        <span className={`dot ${dotColor}`} style={{ opacity: notif.is_read ? 0.5 : 1 }} />
                      </div>
                      <div className="note-body">
                        <div className="note-title">{notif.title || 'Notification'}</div>
                        <div className="note-sub muted">{notif.message || ''}</div>
                      </div>
                      <div className="note-time">{notif.relative_time || notif.formatted_time || 'Recently'}</div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </section>
      </>
    );
  }

  function ContentView({ activeNav }) {
    // For now, only 'home' renders the full dashboard; other routes show placeholders.
    switch (activeNav) {
      case 'home':
        return <HomeView />;
      case 'my-loads':
        return <MyLoads />;
      case 'docs':
        return <DocumentVault />;
      case 'shippers':
        return <ShipperPartners />;
      case 'marketplace':
        return <Marketplace activeSection={activeMarketplaceSection} setActiveSection={setActiveMarketplaceSection} />;
      case 'drivers':
        return <DriversAndDispatches />;
      case 'factoring':
        return <FactoringInvoicing />;
      case 'integrations':
        return <Integrations />;
      case 'compliance':
        return <ComplianceSafety />;
      case 'esign':
        return <ConsentESignature />;
      case 'messaging':
        return <Messaging initialThreadId={initialThreadId} />;
      case 'alerts':
        return <AlertsNotifications />;
      case 'analytics':
        return <Analytics />;
      case 'calendar':
        return <Calendar />;
      case 'settings':
        return <Settings />;
      case 'help':
        return <HelpHub />;
      default:
        return (
          <div>
            <header className="fp-header">
              <div className="fp-header-titles">
                <h2>{navGroups.flatMap(g => g.items).find(i => i.key === activeNav)?.label || 'View'}</h2>
                <p className="fp-subtitle">This is the {activeNav} view. Only the inner area changes.</p>
              </div>
            </header>
            <section className="fp-grid">
              <div className="card">
                <div className="card-header"><h3>Placeholder</h3></div>
                <div style={{ padding: 20 }}>
                  <p>Content for <strong>{activeNav}</strong> goes here. Replace this with real components as needed.</p>
                </div>
              </div>
            </section>
          </div>
        );
    }
  }

  return (
  <div className={`fp-dashboard-root ${isDarkMode ? 'dark-root' : ''}`}>
      <div className="fp-topbar">
        <div className="topbar-row topbar-row-1">
          <div className="topbar-left">
            <button className="hamburger" aria-label="Open sidebar" onClick={() => setIsSidebarOpen(true)}>
              <i className="fa-solid fa-bars" />
            </button>
            <div className="brand-block">
              <div className="brand-row">
                <div className="logo">
                  {/* Desktop / large-screen logo */}
                  <img src={logo} alt="FreightPower" className="landing-logo-image desktop-logo" />
                  {/* Responsive compact logo shown at <=768px */}
                  <img src={resp_logo} alt="FreightPower" className="landing-logo-image mobile-logo" />
                </div>
                {/* verified moved into sidebar header; topbar inline chips removed */}
                <div className="ids">
                  <span className="id-pair"><span className="id-label">DOT:</span> <span className="id-value">{dotNumber || 'N/A'}</span></span>
                  <span className="ids-sep">•</span>
                  <span className="id-pair"><span className="id-label">MC:</span> <span className="id-value">{mcNumber || 'N/A'}</span></span>
                </div>
              </div>
            </div>
          </div>

          <div className="topbar-right actions-right">
            <div className="actions">
              <button type="button" className="btn small-cd"><i className="fa-solid fa-link"/> Connect</button>
              <button type="button" className="btn ghost-cd small" onClick={handleReportFraud}><i className="fa-solid fa-triangle-exclamation"/> Report Fraud</button>
              <button type="button" className="btn ghost-cd small" onClick={handleSuggestEdit}><i className="fa-solid fa-pen"/> Suggest Edit</button>
            </div>
            {/* mobile-only icons in the first row: visible on small screens */}
            <div className="icons-mobile">
              <div
                className="notif"
                role="button"
                aria-label="Open Alerts & Notifications"
                onClick={() => { setActiveNav('alerts'); setIsSidebarOpen(false); }}
              >
                <i className="fa-regular fa-bell notif-icon" aria-hidden="true" />
                {notifUnread > 0 && <span className="notif-badge">{notifUnread > 99 ? '99+' : notifUnread}</span>}
              </div>
              <i
                className="fa-solid fa-robot bot-icon"
                aria-hidden="true"
                role="button"
                aria-label="Open Help Hub"
                onClick={() => { setActiveNav('help'); setIsSidebarOpen(false); }}
              />
              <img
                src="https://randomuser.me/api/portraits/men/75.jpg"
                alt="avatar"
                className="avatar-img"
                role="button"
                aria-label="Open Settings"
                onClick={() => { setActiveNav('settings'); setIsSidebarOpen(false); }}
              />
            </div>
          </div>
        </div>

        <div className="topbar-row topbar-row-2">
          <div className="topbar-left second-left">
            <div className="chips">
              <span className="chip-cd success">DOT {dotStatusText}{fmcsaLoading ? '…' : ''}</span>
              <span className="chip-cd info">Operating: {operatingText}</span>
              <span className="chip-cd yellow">Safety: {safetyText}</span>
              <span className="chip-cd blue">ELD: {eldText}</span>
            </div>
            <div className="fleet-stats">
              <span className="fleet-item"><i className="fa-solid fa-truck"/> <strong>{powerUnitsVal ?? dash}</strong> Power Units</span>
              <span className="fleet-item"><i className="fa-solid fa-snowflake"/> <strong>{reefersVal ?? dash}</strong> Reefers</span>
              <span className="fleet-item"><i className="fa-solid fa-box"/> <strong>{dryVansVal ?? dash}</strong> Dry Vans</span>
            </div>
          </div>

          <div className="topbar-right">
            <div className="icons">
              <span className="lang"><i className="fa-solid fa-globe"/> EN</span>
              <div
                className="notif"
                id="fp-notif-dropdown-root-2"
                style={{ position: 'relative' }}
                role="button"
                aria-label="Open Alerts & Notifications"
              >
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    setActiveNav('alerts');
                    setIsSidebarOpen(false);
                  }}
                  aria-label="Open Alerts & Notifications"
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <i className="fa-regular fa-bell notif-icon" aria-hidden="true" />
                  {notifUnread > 0 && <span className="notif-badge">{notifUnread > 99 ? '99+' : notifUnread}</span>}
                </button>
              </div>
              <i
                className="fa-solid fa-robot bot-icon"
                aria-hidden="true"
                role="button"
                aria-label="Open Help Hub"
                onClick={() => { setActiveNav('help'); setIsSidebarOpen(false); }}
              />
              <img
                src="https://randomuser.me/api/portraits/men/75.jpg"
                alt="avatar"
                className="avatar-img"
                role="button"
                aria-label="Open Settings"
                onClick={() => { setActiveNav('settings'); setIsSidebarOpen(false); }}
              />
            </div>
          </div>
        </div>
      </div>

  <div className={`fp-content-row ${isSidebarOpen ? 'sidebar-open' : ''}`}>
  <aside className={`fp-sidebar ${isSidebarOpen ? 'open' : ''} ${isSidebarDark ? 'dark' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-row">
            <div className="logo"> <img src={logo} alt="FreightPower" className="landing-logo-image" /></div>
          </div>
          {/* DOT / MC line for mobile drawer */}
          <div className="ids mobile-ids">
            <div className="mobile-id-line"><span className="id-pair"><span className="id-label">DOT:</span> <span className="id-value">{dotNumber || 'N/A'}</span></span></div>
            <div className="mobile-id-line"><span className="id-pair"><span className="id-label">MC:</span> <span className="id-value">{mcNumber || 'N/A'}</span></span></div>
          </div>
          <div className="chips sidebar-chips">
            <span className="chip-cd success">DOT {dotStatusText}{fmcsaLoading ? '…' : ''}</span>
            <span className="chip-cd info">Operating: {operatingText}</span>
            <span className="chip-cd yellow">Safety: {safetyText}</span>
            <span className="chip-cd blue">ELD: {eldText}</span>
          </div>
          <div className="fleet-stats sidebar-fleet">
            <span className="fleet-item"><i className="fa-solid fa-truck"/> <strong>{powerUnitsVal ?? dash}</strong> Power Units</span>
            <span className="fleet-item"><i className="fa-solid fa-snowflake"/> <strong>{reefersVal ?? dash}</strong> Reefers</span>
            <span className="fleet-item"><i className="fa-solid fa-box"/> <strong>{dryVansVal ?? dash}</strong> Dry Vans</span>
          </div>
        </div>
        <nav className="fp-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              <ul>
                {group.items.map((it) => (
                  <li
                    className={`nav-item ${activeNav === it.key ? 'active' : ''}`}
                    key={it.key}
                    onClick={() => { 
                      if (it.key === 'logout') {
                        handleLogout();
                      } else {
                        setActiveNav(it.key);
                        if (it.key === 'marketplace') {
                          setActiveMarketplaceSection('loads');
                        }
                        if (isSidebarOpen) setIsSidebarOpen(false);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <i className={`${it.icon} icon`} aria-hidden="true"></i>
                    <span className="label">{it.label}</span>
                    {it.key === 'messaging' && messagingUnread > 0 && (
                      <span className="nav-unread-badge">{messagingUnread > 99 ? '99+' : messagingUnread}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {/* Dark mode control - toggles site theme when clicked */}
        <div className="sidebar-dark-control" aria-hidden="false">
          <span className="dark-label">Dark Mode</span>
          <button
            className="dark-toggle"
            aria-pressed={isDarkMode}
            aria-label="Toggle dark mode"
            onClick={() => {
              const nextPref = isDarkMode ? 'light' : 'dark';
              setThemePreference(nextPref);
              try {
                localStorage.setItem('fp_theme_preference', nextPref);
              } catch {
                // ignore
              }
            }}
          >
            <span className="dark-toggle-knob" />
          </button>
        </div>
        {/* action buttons in the mobile drawer */}
        <div className="sidebar-actions">
          <button type="button" className="btn small-cd"><i className="fa-solid fa-link"/> Connect</button>
          <button type="button" className="btn ghost-cd small" onClick={handleReportFraud}><i className="fa-solid fa-triangle-exclamation"/> Report Fraud</button>
          <button type="button" className="btn ghost-cd small subtle" onClick={handleSuggestEdit}><i className="fa-solid fa-pen"/> Suggest Edit</button>
        </div>
        <button className="sidebar-close" aria-label="Close sidebar" onClick={() => setIsSidebarOpen(false)}>
          <i className="fa-solid fa-xmark" />
        </button>
      </aside>

      {isSidebarOpen && <div className="overlay" onClick={() => setIsSidebarOpen(false)} />}

      <main className="fp-main">
        <ContentView activeNav={activeNav} />
      </main>
      </div>

      {/* Report Fraud Modal */}
      {showReportFraudModal && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setShowReportFraudModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '8px', color: '#dc2626' }}></i>Report Fraud</h2>
              <button type="button" className="modal-close" onClick={() => !isSubmitting && setShowReportFraudModal(false)} disabled={isSubmitting}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="fraud-subject">Subject (Optional)</label>
                <input
                  type="text"
                  id="fraud-subject"
                  value={reportFraudData.subject}
                  onChange={(e) => setReportFraudData({ ...reportFraudData, subject: e.target.value })}
                  placeholder="Brief description of the issue"
                  disabled={isSubmitting}
                />
              </div>
              <div className="form-group">
                <label htmlFor="fraud-message">Message <span style={{ color: '#dc2626' }}>*</span></label>
                <textarea
                  id="fraud-message"
                  value={reportFraudData.message}
                  onChange={(e) => setReportFraudData({ ...reportFraudData, message: e.target.value })}
                  placeholder="Please provide details about the fraud or suspicious activity..."
                  rows={6}
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn ghost-cd" onClick={() => setShowReportFraudModal(false)} disabled={isSubmitting}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={handleSubmitReportFraud} disabled={isSubmitting || !reportFraudData.message.trim()}>
                {isSubmitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suggest Edit Modal */}
      {showSuggestEditModal && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setShowSuggestEditModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2><i className="fa-solid fa-pen" style={{ marginRight: '8px', color: '#2563eb' }}></i>Suggest Edit</h2>
              <button type="button" className="modal-close" onClick={() => !isSubmitting && setShowSuggestEditModal(false)} disabled={isSubmitting}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="edit-subject">Subject (Optional)</label>
                <input
                  type="text"
                  id="edit-subject"
                  value={suggestEditData.subject}
                  onChange={(e) => setSuggestEditData({ ...suggestEditData, subject: e.target.value })}
                  placeholder="Brief description of your suggestion"
                  disabled={isSubmitting}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-message">Suggestion <span style={{ color: '#dc2626' }}>*</span></label>
                <textarea
                  id="edit-message"
                  value={suggestEditData.message}
                  onChange={(e) => setSuggestEditData({ ...suggestEditData, message: e.target.value })}
                  placeholder="Please describe your suggestion or edit..."
                  rows={6}
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn ghost-cd" onClick={() => setShowSuggestEditModal(false)} disabled={isSubmitting}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={handleSubmitSuggestEdit} disabled={isSubmitting || !suggestEditData.message.trim()}>
                {isSubmitting ? 'Submitting...' : 'Submit Suggestion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
