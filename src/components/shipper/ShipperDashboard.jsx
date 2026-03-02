import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_URL } from '../../config';
import { AUTO_REFRESH_MS } from '../../constants/refresh';
import TrackingVisibility from './TrackingVisibility';
import DocumentVault from './DocumentVault';
import Finance from './Finance';
import Messaging from './Messaging';
import ShipperProfile from './ShipperProfile';
import '../../styles/carrier/CarrierDashboard.css';
import '../../styles/shipper/ShipperDashboard.css';
import MyCarriers from './MyCarriers';
import ShipperMarketplace from './ShipperMarketplace';
import ComplianceOverview from './ComplianceOverview';
import AiHub from './AiHub';
import ShipperAnalytics from './Analytics';
import Settings from './Settings';
import Calendar from './Calendar';
import AddLoads from '../carrier/AddLoads';
import DraftLoadsModal from './DraftLoadsModal';
import InviteCarrierModal from './InviteCarrierModal';
import CarrierBids from './CarrierBids';
import ShipperMyLoads from './MyLoads';
import Bills from './Bills';
import '../../styles/shipper/InviteCarrierModal.css';
// OnboardingCoach removed - compliance data now shown in Compliance & Safety page
import logo from '/src/assets/logo.png';
import resp_logo from '/src/assets/logo_1.png';

export default function ShipperDashboard() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const FALLBACK_AVATAR_URL = 'https://randomuser.me/api/portraits/men/32.jpg';
  const [activeNav, setActiveNav] = useState('home');
  const [trackingInitialLoadId, setTrackingInitialLoadId] = useState(null);
  const [initialThreadId, setInitialThreadId] = useState(null);
  const [initialInvoiceId, setInitialInvoiceId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarDark, setIsSidebarDark] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Messaging unread badge
  const [messagingUnread, setMessagingUnread] = useState(0);

  // In-app notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifItems, setNotifItems] = useState([]);

  // Deep-link support (email links): /shipper-dashboard?nav=messaging&thread=<threadId>
  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      const nav = (qs.get('nav') || qs.get('section') || '').trim();
      const thread = (qs.get('thread') || qs.get('thread_id') || '').trim();
      const invoiceId = (qs.get('invoice_id') || qs.get('invoice') || '').trim();
      if (thread) {
        setInitialThreadId(thread);
        setActiveNav('messaging');
        return;
      }
      if (invoiceId) {
        setInitialInvoiceId(invoiceId);
        setActiveNav('bills');
        return;
      }
      if (nav) setActiveNav(nav);
    } catch {
      // ignore
    }
  }, [location.search]);

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
    } catch {
      // ignore
    } finally {
      setNotifLoading(false);
    }
  };

  // Keep unread count fresh (so new bids show up without opening the dropdown).
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      try {
        await fetchNotifications();
      } catch {
        // ignore
      }
    };

    // Initial fetch + poll
    tick();
    const id = setInterval(tick, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [currentUser]);

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
      // Best-effort
      markNotificationRead(id);
    }
    if (actionUrl) {
      setNotifOpen(false);
      navigate(actionUrl);
    }
  };

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

  // Onboarding data state
  const [shipperProfile, setShipperProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Dashboard stats state
  const [dashboardStats, setDashboardStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Home "Active Loads" list data (kept lightweight; Tracking page fetches full view)
  const [homeLoadsLoading, setHomeLoadsLoading] = useState(false);
  const [homeLoadsError, setHomeLoadsError] = useState('');
  const [homeLoads, setHomeLoads] = useState([]);

  // AddLoads modal state
  const [showAddLoads, setShowAddLoads] = useState(false);
  const [editingDraftLoad, setEditingDraftLoad] = useState(null);

  // Draft loads modal state
  const [showDraftLoadsModal, setShowDraftLoadsModal] = useState(false);

  // Invite Carrier modal state
  const [isInviteCarrierOpen, setIsInviteCarrierOpen] = useState(false);

  // File upload ref
  const fileInputRef = React.useRef(null);

  // Handle file upload
  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setStatsLoading(true);
    
    try {
      const token = await currentUser.getIdToken();
      
      for (const file of files) {
        // Create FormData for file upload
        const formData = new FormData();
        formData.append('file', file);
        
        console.log(`Uploading: ${file.name}...`);
        
        const response = await fetch(`${API_URL}/documents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Upload successful:', data);
          alert(`Document "${file.name}" uploaded successfully!\nType: ${data.doc_type}\nValidation: ${data.validation.status}`);
        } else {
          const error = await response.json();
          console.error('Upload failed:', error);
          alert(`Failed to upload "${file.name}": ${error.detail || 'Unknown error'}`);
        }
      }
      
      // Refresh dashboard stats after all uploads
      await fetchStats();
      
    } catch (err) {
      console.error('Error uploading documents:', err);
      alert('Error uploading documents. Please try again.');
    } finally {
      setStatsLoading(false);
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Fetch dashboard stats
  const fetchStats = async () => {
    if (!currentUser) {
      setStatsLoading(false);
      return;
    }
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/dashboard/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setDashboardStats(data);
      }
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };

  const fetchHomeLoads = async () => {
    if (!currentUser) return;
    setHomeLoadsLoading(true);
    setHomeLoadsError('');
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/loads?exclude_drafts=true&page=1&page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setHomeLoads([]);
        setHomeLoadsError('Failed to load shipments');
        return;
      }
      const data = await res.json();
      setHomeLoads(Array.isArray(data?.loads) ? data.loads : []);
    } catch (e) {
      setHomeLoads([]);
      setHomeLoadsError(e?.message || 'Failed to load shipments');
    } finally {
      setHomeLoadsLoading(false);
    }
  };

  // Handle editing draft loads
  const handleEditDraft = (draftLoad) => {
    setEditingDraftLoad(draftLoad);
    setShowAddLoads(true);
  };

  // Fetch dashboard stats
  useEffect(() => {
    fetchStats();
  }, [currentUser]);

  // Fetch a small set of loads used by the Home placeholders.
  useEffect(() => {
    fetchHomeLoads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Fetch profile data on mount (canonical source: /auth/me)
  useEffect(() => {
    const fetchProfile = async () => {
      if (!currentUser) {
        setProfileLoading(false);
        return;
      }
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (response.ok) {
          const data = await response.json();
          setShipperProfile(data);
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setProfileLoading(false);
      }
    };
    fetchProfile();
  }, [currentUser]);

  const refreshShipperProfile = async (patch = null) => {
    if (!currentUser) return;
    if (patch && typeof patch === 'object') {
      setShipperProfile((prev) => ({ ...(prev || {}), ...patch }));
    }

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setShipperProfile(data);
      }
    } catch {
      // ignore
    }
  };

  // Poll messaging unread summary (used for sidebar badge)
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
    const id = setInterval(tick, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [currentUser]);

  const navGroups = [
    {
      title: 'OPERATE',
      items: [
        { key: 'home', label: 'Dashboard', icon: 'fa-solid fa-house' },
        { key: 'my-loads', label: 'My Loads', icon: 'fa-solid fa-truck' },
        { key: 'my-carriers', label: 'My Carriers', icon: 'fa-solid fa-people-group' },
        { key: 'calendar', label: 'Calendar', icon: 'fa-regular fa-calendar-days' },
        { key: 'marketplace', label: 'Marketplace', icon: 'fa-solid fa-store' },
        { key: 'messaging', label: 'Messaging', icon: 'fa-solid fa-comments' },
        { key: 'alerts', label: 'Alerts & Notifications', icon: 'fa-solid fa-bell' },
        { key: 'carrier-bids', label: 'Carrier Bids', icon: 'fa-solid fa-hand-holding-dollar' },
        { key: 'tracking', label: 'Tracking & Visibility', icon: 'fa-solid fa-location-crosshairs' },
        { key: 'doc-vault', label: 'Document Vault', icon: 'fa-solid fa-folder' },
      ]
    },
    {
      title: 'MANAGE',
      items: [
        { key: 'finance', label: 'Finance', icon: 'fa-solid fa-wallet' },
        { key: 'bills', label: 'Invoices / Bills', icon: 'fa-solid fa-file-invoice-dollar' },
        { key: 'compliance', label: 'Compliance', icon: 'fa-solid fa-shield-halved' },
        { key: 'analytics', label: 'Analytics', icon: 'fa-solid fa-chart-column' }
      ]
    },
    {
      title: 'SYSTEM',
      items: [
        { key: 'profile', label: 'Profile', icon: 'fa-solid fa-user' },
        { key: 'settings', label: 'Settings', icon: 'fa-solid fa-gear' },
        { key: 'help', label: 'AI Hub', icon: 'fa-regular fa-circle-question' },
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

  // --- FILTER DROPDOWNS STATE ---
  const [openDropdown, setOpenDropdown] = useState(null);
  const [selectedRange, setSelectedRange] = useState('Last 30 Days');
  const [selectedRegion, setSelectedRegion] = useState('All Regions');
  const [selectedCarrier, setSelectedCarrier] = useState('All Carriers');
  const [selectedLane, setSelectedLane] = useState('All Lanes');
  const [homeSearchQuery, setHomeSearchQuery] = useState('');

  const ranges = ['Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Year to Date'];
  const regions = ['All Regions', 'North', 'South', 'East', 'West', 'Midwest'];
  const carriers = ['All Carriers', 'Swift Transport', 'Reliable Freight', 'Express Logistics'];
  const lanes = ['All Lanes', 'MN → IL', 'TX → AZ', 'FL → GA'];

  // close dropdowns on outside click
  React.useEffect(() => {
    function onDocClick() { setOpenDropdown(null); }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  function HomeView() {
    const normalizeStatus = (s) => String(s || '').trim().toLowerCase();
    const activeStatuses = new Set(['posted', 'tendered', 'covered', 'accepted', 'awarded', 'dispatched', 'in_transit']);
    const deliveredStatuses = new Set(['delivered', 'completed']);

    const activeLoads = (homeLoads || []).filter((l) => activeStatuses.has(normalizeStatus(l?.status || l?.load_status)));
    const deliveredLoads = (homeLoads || []).filter((l) => deliveredStatuses.has(normalizeStatus(l?.status || l?.load_status)));

    const totalCount = Number(dashboardStats?.total_loads || 0) || (homeLoads || []).length;
    const activeCount = Number(dashboardStats?.active_loads || 0) || activeLoads.length;

    const shortLoadLabel = (l) => {
      const num = String(l?.load_number || '').trim();
      if (num) return num;
      const id = String(l?.load_id || l?.id || '').trim();
      if (!id) return 'N/A';
      return id.length > 8 ? id.slice(-8) : id;
    };

    const badgeForStatus = (s) => {
      const st = normalizeStatus(s);
      if (st === 'in_transit') return { cls: 'pending', label: 'In Transit' };
      if (st === 'covered' || st === 'accepted' || st === 'dispatched') return { cls: 'active', label: 'Assigned' };
      if (st === 'posted' || st === 'tendered') return { cls: 'pending', label: 'Tendered' };
      if (st === 'delivered') return { cls: 'active', label: 'Delivered' };
      if (st === 'completed') return { cls: 'active', label: 'Settled' };
      return { cls: 'pending', label: st ? st.replace(/_/g, ' ') : 'Active' };
    };

    const etaText = (l) => {
      const st = normalizeStatus(l?.status || l?.load_status);
      if (st === 'delivered' || st === 'completed') {
        return 'Delivered';
      }
      const delivery = String(l?.delivery_date || '').trim();
      if (delivery) return `ETA: ${delivery}`;
      return 'ETA: TBD';
    };

    return (
      <>
        <header className="fp-header">
          <div className="fp-header-controls">
            <button className="btn small-cd" onClick={() => setShowAddLoads(true)}>+ Create Load</button>
            <button className="btn small ghost-cd" onClick={() => setIsInviteCarrierOpen(true)}>Invite Carrier</button>
            <button className="btn small ghost-cd" onClick={() => fileInputRef.current?.click()}>Upload Document</button>
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              multiple 
              onChange={handleFileUpload}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            />
            <button
              className="btn small ghost-cd"
              onClick={() => {
                const first = (activeLoads || [])[0];
                const id = String(first?.load_id || first?.id || '').trim();
                setTrackingInitialLoadId(id || null);
                setActiveNav('tracking');
                if (isSidebarOpen) setIsSidebarOpen(false);
              }}
            >
              Track Shipments
            </button>
          </div>
        </header>

        {/* Shipper Profile Card - Shows onboarding data */}
        {!profileLoading && shipperProfile && (
          <section style={{ marginBottom: '20px' }}>
            <div className="card" style={{ padding: '20px', background: '#f8fafc' }}>
              <div className="card-header">
                <h3><i className="fa-solid fa-building" style={{ marginRight: '8px' }}></i>Business Profile</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '16px' }}>
                {shipperProfile.company_name && (
                  <div><strong>Business:</strong> {shipperProfile.company_name}</div>
                )}
                {shipperProfile.business_type && (
                  <div><strong>Type:</strong> {shipperProfile.business_type}</div>
                )}
                {shipperProfile.name && (
                  <div><strong>Contact:</strong> {shipperProfile.name}</div>
                )}
                {shipperProfile.email && (
                  <div><strong>Email:</strong> {shipperProfile.email}</div>
                )}
              </div>
              {!shipperProfile.onboarding_completed && (
                <div style={{ marginTop: '16px', padding: '12px', background: '#fef3c7', borderRadius: '8px', color: '#92400e' }}>
                  <i className="fa-solid fa-exclamation-triangle" style={{ marginRight: '8px' }}></i>
                  Onboarding not complete. <button onClick={() => setActiveNav('profile')} style={{ background: 'none', border: 'none', color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Complete your profile</button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Onboarding Coach removed - compliance data now shown in Compliance & Safety page */}

        <section className="top-stats">
          <div className="card sd-small-card">
            <div className="sd-small-card-row">
              <h4>Active Loads</h4>
              <i className="fa-solid fa-truck" aria-hidden="true" />
            </div>
            <div className="big">{statsLoading ? '...' : (dashboardStats?.active_loads || 0)}</div>
            <div className="small-sub-active">+{dashboardStats?.active_loads_today || 0} today</div>
          </div>
          <div className="card sd-small-card">
            <div className="sd-small-card-row">
              <h4>On-Time %</h4>
              <i className="fa-solid fa-clock" aria-hidden="true" />
            </div>
            <div className="big green">{statsLoading ? '...' : `${dashboardStats?.on_time_percentage || 0}%`}</div>
            <div className="small-sub-time">{dashboardStats?.on_time_change || '+0%'}</div>
          </div>
          <div className="card sd-small-card">
            <div className="sd-small-card-row">
              <h4>Carrier Rating</h4>
              <i className="fa-solid fa-star" aria-hidden="true" />
            </div>
            <div className="big">{statsLoading ? '...' : (dashboardStats?.rating || 0)}</div>
            <div className="small-sub-rating">{dashboardStats?.rating_label || 'N/A'}</div>
          </div>

          <div className="card sd-small-card">
            <div className="sd-small-card-row">
              <h4>Total Revenue</h4>
              <i className="fa-solid fa-dollar-sign" aria-hidden="true" />
            </div>
            <div className="big">${statsLoading ? '...' : ((dashboardStats?.total_revenue || 0) / 1000).toFixed(0)}K</div>
            <div className="small-sub-revenue">{dashboardStats?.revenue_change || '+0%'} MTD</div>
          </div>
          <div className="card sd-small-card">
            <div className="sd-small-card-row">
              <h4>Compliance</h4>
              <i className="fa-solid fa-shield-halved" aria-hidden="true" />
            </div>
            <div className="big">{statsLoading ? '...' : `${dashboardStats?.compliance_score || 0}%`}</div>
            <div className="small-sub-compliance">{dashboardStats?.compliance_expiring || 0} expiring</div>
          </div>
          <div className="card sd-small-card" style={{ cursor: 'pointer' }} onClick={() => setShowDraftLoadsModal(true)}>
            <div className="sd-small-card-row">
              <h4>Draft Loads</h4>
              <i className="fa-solid fa-file-lines" aria-hidden="true" />
            </div>
            <div className="big">{statsLoading ? '...' : (dashboardStats?.draft_loads || 0)}</div>
            <div className="small-sub-task">Click to manage</div>
          </div>

          <div className="card sd-small-card shd-ai-summary">
            <h4>AI Summary</h4>
            <div className="big">{statsLoading ? '...' : (dashboardStats?.total_loads || 0)} loads</div>
          </div>
        </section>

        <section className="fp-filters" style={{display:'flex',gap:12,alignItems:'center',marginBottom:18,flexWrap:'wrap'}}>
            <select className="sb-carrier-filter-select" value={selectedRange} onChange={(e) => setSelectedRange(e.target.value)}>
              {ranges.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <select className="sb-carrier-filter-select" value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)}>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <select className="sb-carrier-filter-select" value={selectedCarrier} onChange={(e) => setSelectedCarrier(e.target.value)}>
              {carriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select className="sb-carrier-filter-select" value={selectedLane} onChange={(e) => setSelectedLane(e.target.value)}>
              {lanes.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

          <div style={{marginLeft:'auto'}} className="search-wrapper">
            <div className="ssd-search-box">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input 
                placeholder="Search..." 
                value={homeSearchQuery}
                onChange={(e) => setHomeSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="fp-grid" style={{gridTemplateColumns:'repeat(3,1fr)',gap:18}}>
          <div className="card ai-insights">
            <h3>AI Insights</h3>
            <div className="insight">Top Lane Alert<br/>MN → IL averaging $2.95/mi (+8%)</div>
            <ul className="muted">
              <li>Demand spike in Midwest corridors</li>
              <li>Fuel costs stabilizing</li>
            </ul>
          </div>

          <div className="card active-loads">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3>Active Loads</h3>
              <div className="muted">{activeCount} of {totalCount}</div>
            </div>
            <ul className="active-load-list">
              {homeLoadsError ? (
                <li>
                  <div className="muted">{homeLoadsError}</div>
                </li>
              ) : homeLoadsLoading ? (
                <li>
                  <div className="muted">Loading shipments…</div>
                </li>
              ) : (activeLoads || []).length === 0 ? (
                <li>
                  <div className="muted">No active loads yet.</div>
                </li>
              ) : (
                (activeLoads || []).slice(0, 3).map((l) => {
                  const id = String(l?.load_id || l?.id || Math.random());
                  const origin = String(l?.origin || l?.load_origin || 'N/A');
                  const dest = String(l?.destination || l?.load_destination || 'N/A');
                  const st = l?.status || l?.load_status;
                  const badge = badgeForStatus(st);
                  return (
                    <li key={id}>
                      <div className="load-left">
                        <strong>#{shortLoadLabel(l)}</strong>
                        <div className="muted">{origin} → {dest}</div>
                      </div>
                      <div className="load-right">
                        <div className={`int-status-badge ${badge.cls}`}>{badge.label}</div>
                        <div className="muted small">{etaText(l)}</div>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <div className="card top-carriers">
            <h3>Top Carriers</h3>
            <ol className="top-carriers">
              <li>
                <div className="carrier-left">
                  <div className="name">Swift Transport</div>
                  <div className="sub muted small">98.5% On-Time</div>
                </div>
                <div className="carrier-right">
                  <span className="rating">4.9★</span>
                  <div className="muted small">42 loads</div>
                </div>
              </li>
              <li>
                <div className="carrier-left">
                  <div className="name">Reliable Freight</div>
                  <div className="sub muted small">96.8% On-Time</div>
                </div>
                <div className="carrier-right">
                  <span className="rating blue">4.8★</span>
                  <div className="muted small">38 loads</div>
                </div>
              </li>
              <li>
                <div className="carrier-left">
                  <div className="name">Express Logistics</div>
                  <div className="sub muted small">95.2% On-Time</div>
                </div>
                <div className="carrier-right">
                  <span className="rating orange">4.7★</span>
                  <div className="muted small">29 loads</div>
                </div>
              </li>
            </ol>
          </div>

          <div className="card performance-card">
            <h3>Performance Health</h3>
            <div className="performance-metrics">
              <div className="metric">
                <strong className="green">Financial</strong>
                <div className="muted">92%</div>
              </div>
              <div className="metric">
                <strong className="blue">Operational</strong>
                <div className="muted">96%</div>
              </div>
            </div>
          </div>

          <div className="card compliance-card">
            <h3>Compliance Status</h3>
            <div className="sd-exp-item pill">
              <div className="exp-title">Insurance Expiring</div>
              <div className="exp-sub muted">Swift Transport - 3 days</div>
            </div>
            <div className="sd-exp-item pill">
              <div className="exp-title">DOT Audit Due</div>
              <div className="exp-sub muted">Reliable Freight - 7 days</div>
            </div>
          </div>
        </section>
      </>
    );
  }

  function ContentView({ activeNav }) {
    if (activeNav === 'home') return <HomeView />;
    if (activeNav === 'my-loads') return <ShipperMyLoads />;
    if (activeNav === 'my-carriers') return <MyCarriers />;
    if (activeNav === 'calendar') return <Calendar />;
    if (activeNav === 'marketplace') return <ShipperMarketplace />;
    if (activeNav === 'carrier-bids') return <CarrierBids />;
    if (activeNav === 'alerts') return (
      <div>
        <header className="fp-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div className="fp-header-titles" style={{ minWidth: 240, flex: '1 1 360px' }}>
            <h2>Alerts &amp; Notifications</h2>
            <p className="fp-subtitle">Updates, reminders, and important alerts.</p>
          </div>
          <div className="fp-header-controls" style={{ display: 'flex', justifyContent: 'flex-end', flex: '0 0 auto' }}>
            <button
              type="button"
              className="btn small ghost-cd"
              onClick={() => fetchNotifications()}
              disabled={Boolean(notifLoading)}
            >
              {notifLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </header>
        <section className="fp-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header"><h3>Notifications</h3></div>
            <div style={{ maxHeight: 560, overflowY: 'auto', padding: 14 }}>
              {Boolean(notifLoading) ? (
                <div className="muted">Loading…</div>
              ) : (notifItems || []).length === 0 ? (
                <div className="muted">No notifications yet.</div>
              ) : (
                <div className="expiring-list">
                  {(notifItems || []).map((n) => {
                    const isRead = Boolean(n?.is_read);
                    const title = String(n?.title || 'Notification');
                    const msg = String(n?.message || '');
                    const when = String(n?.relative_time || n?.formatted_time || n?.created_at_human || n?.created_at || '').trim();
                    return (
                      <div
                        key={String(n?.id || Math.random())}
                        className="sd-exp-item pill"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleNotifAction(n)}
                        onKeyDown={(e) => e.key === 'Enter' && handleNotifAction(n)}
                        style={{ cursor: 'pointer', opacity: isRead ? 0.75 : 1 }}
                      >
                        <div className="exp-title" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <span>{title}</span>
                          {!isRead ? (
                            <button
                              type="button"
                              className="btn small ghost-cd"
                              onClick={(e) => {
                                e.stopPropagation();
                                markNotificationRead(String(n?.id || '').trim());
                              }}
                            >
                              Mark read
                            </button>
                          ) : null}
                        </div>
                        {msg ? <div className="exp-sub">{msg}</div> : null}
                        {when ? <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{when}</div> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
    if (activeNav === 'tracking') return <TrackingVisibility initialLoadId={trackingInitialLoadId} />;
    if (activeNav === 'doc-vault') return <DocumentVault />;
    if (activeNav === 'finance') return <Finance />;
    if (activeNav === 'bills') return <Bills initialInvoiceId={initialInvoiceId} />;
    if (activeNav === 'compliance') return <ComplianceOverview />;
    if (activeNav === 'settings') return <Settings />;
    if (activeNav === 'help') return <AiHub />;
    if (activeNav === 'analytics') return <ShipperAnalytics />;
    if (activeNav === 'messaging') return <Messaging initialThreadId={initialThreadId} />;
    if (activeNav === 'profile') return (
      <div>
        <header className="fp-header">
          <div className="fp-header-titles">
            <h2>Profile</h2>
            <p className="fp-subtitle">Complete your business profile and onboarding information.</p>
          </div>
        </header>
        <section className="fp-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
            <ShipperProfile onProfileUpdate={refreshShipperProfile} />
          </div>
        </section>
      </div>
    );
    return (
      <div>
        <header className="fp-header">
          <div className="fp-header-titles">
            <h2>{navGroups.flatMap(g => g.items).find(i => i.key === activeNav)?.label || 'View'}</h2>
            <p className="fp-subtitle">This is the {activeNav} view.</p>
          </div>
        </header>
        <section className="fp-grid">
          <div className="card">
            <div className="card-header"><h3>Placeholder</h3></div>
            <div style={{ padding: 20 }}>Content for <strong>{activeNav}</strong> goes here.</div>
          </div>
        </section>
      </div>
    );
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
                  {/* Company name placed to the right of the logo (shipper-only) */}
                  <div className="brand-info">
                    <div className="company-name">Atlas Logistics LLC</div>
                    {/* Shipper-only status chips placed below the company name (column) */}
                    <div className="shipper-status">
                      <span className="int-status-badge active"><i className="fa-solid fa-check"/> Active & Operating</span>
                      <span className="int-status-badge blue"><i className="fa-solid fa-network-wired"/> TMS Connected</span>
                    </div>
                  </div>
                </div>
            </div>
          </div>

          <div className="topbar-right actions-right">
            <div className="icons">
              <div className="notif" id="fp-notif-dropdown-root" style={{ position: 'relative' }}>
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

                {notifOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 10px)',
                      width: 380,
                      maxWidth: '90vw',
                      background: isDarkMode ? '#0b1220' : '#ffffff',
                      border: isDarkMode ? '1px solid rgba(148,163,184,0.22)' : '1px solid #e5e7eb',
                      borderRadius: 12,
                      boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
                      overflow: 'hidden',
                      zIndex: 50,
                    }}
                  >
                    <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 800, color: isDarkMode ? '#e2e8f0' : '#0f172a' }}>Notifications</div>
                      <button
                        type="button"
                        className="btn small ghost-cd"
                        onClick={() => {
                          fetchNotifications();
                        }}
                        disabled={notifLoading}
                      >
                        {notifLoading ? 'Loading…' : 'Refresh'}
                      </button>
                    </div>
                    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                      {(notifItems || []).length === 0 ? (
                        <div style={{ padding: 14, color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13 }}>
                          {notifLoading ? 'Loading…' : 'No notifications yet.'}
                        </div>
                      ) : (
                        (notifItems || []).map((n) => {
                          const isRead = Boolean(n?.is_read);
                          const title = String(n?.title || 'Notification');
                          const msg = String(n?.message || '');
                          const hasAction = Boolean(String(n?.action_url || '').trim());
                          return (
                            <div
                              key={String(n?.id || Math.random())}
                              style={{
                                padding: 12,
                                borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.14)' : '1px solid #f1f5f9',
                                background: isRead ? 'transparent' : (isDarkMode ? 'rgba(59,130,246,0.10)' : '#eff6ff'),
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ display: 'grid', gap: 6 }}>
                                  <div style={{ fontWeight: 800, color: isDarkMode ? '#e2e8f0' : '#0f172a', fontSize: 13 }}>
                                    {title}
                                  </div>
                                  {msg ? (
                                    <div style={{ color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.35 }}>
                                      {msg}
                                    </div>
                                  ) : null}
                                  {n?.relative_time || n?.formatted_time ? (
                                    <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 11 }}>
                                      {String(n?.relative_time || n?.formatted_time)}
                                    </div>
                                  ) : null}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                                  {hasAction ? (
                                    <button type="button" className="btn small ghost-cd" onClick={() => handleNotifAction(n)}>
                                      View
                                    </button>
                                  ) : null}
                                  {!isRead && (
                                    <button
                                      type="button"
                                      className="btn small ghost-cd"
                                      onClick={() => markNotificationRead(String(n?.id || '').trim())}
                                    >
                                      Mark read
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <i className="fa-solid fa-robot bot-icon" aria-hidden="true" />
              <img
                src={shipperProfile?.profile_picture_url || FALLBACK_AVATAR_URL}
                alt="avatar"
                className="avatar-img"
                onError={(e) => {
                  e.target.src = FALLBACK_AVATAR_URL;
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={`fp-content-row ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <aside className={`fp-sidebar ${isSidebarOpen ? 'open' : ''} ${isSidebarDark ? 'dark' : ''}`}>
          <div className="sidebar-header">
            <div className="brand-row">
              <div className="logo"><img src={logo} alt="FreightPower" className="landing-logo-image" /></div>
            </div>
            <div className="chips sidebar-chips">
              <div className="company-name">{shipperProfile?.company_name || 'Your Company'}</div>
              <span className="int-status-badge active">Active & Operating</span>
              <span className="int-status-badge blue">TMS Connected</span>
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
                      onClick={() => handleNavClick(it.key)}
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

          <div className="sidebar-dark-control">
            <span className="dark-label">Dark Mode</span>
            <button
              className="dark-toggle"
              aria-pressed={isDarkMode}
              aria-label="Toggle dark mode"
              onClick={() => setIsDarkMode((s) => !s)}
            >
              <span className="dark-toggle-knob" />
            </button>
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

      {/* AddLoads Modal */}
      {showAddLoads && (
        <AddLoads 
          onClose={() => {
            setShowAddLoads(false);
            setEditingDraftLoad(null);
          }} 
          isShipper={true}
          draftLoad={editingDraftLoad}
        />
      )}

      {/* Draft Loads Modal */}
      {showDraftLoadsModal && (
        <DraftLoadsModal
          onClose={() => setShowDraftLoadsModal(false)}
          onEditDraft={handleEditDraft}
        />
      )}

      {/* Invite Carrier Modal */}
      <InviteCarrierModal 
        isOpen={isInviteCarrierOpen} 
        onClose={() => setIsInviteCarrierOpen(false)} 
      />

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />
    </div>
  );
}
