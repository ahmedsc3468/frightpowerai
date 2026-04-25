import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { getIdToken } from 'firebase/auth';
import { auth } from '../../firebase';
import { API_URL } from '../../config';
import '../../styles/admin/AdminDashboard.css';
import TrackingVisibility from '../super_admin/TrackingVisibility';
import AdminAnalytics from '../super_admin/AdminAnalytics';
import AiHub from '../super_admin/AiHub';
import IntegrationsManager from '../super_admin/IntegrationsManager';
import '../../styles/super_admin/SuperAdminDashboard.css';
import UsersRoles from '../super_admin/UsersRoles';
import Carriers from '../super_admin/Carriers';
import Drivers from '../super_admin/Drivers';
import Shippers from '../super_admin/Shippers';
import ServiceProviders from '../super_admin/ServiceProviders';
import AdminMarketplace from '../super_admin/AdminMarketplace';
import AdminDocumentVault from '../super_admin/DocumentVault';
import ComplianceAudit from '../super_admin/ComplianceAudit';
import FinanceBilling from '../super_admin/FinanceBilling';
import AdminMessaging from '../super_admin/Messaging';
import Tasks from '../super_admin/Tasks';
import HiringOnboarding from '../super_admin/HiringOnboarding';
import MarketingPromotion from '../super_admin/MarketingPromotion';
import SupportHub from '../super_admin/SupportHub';
import SystemSettings from '../super_admin/SystemSettings';
import AdminApprovals from '../super_admin/AdminApprovals';
import RemovalApprovals from '../super_admin/RemovalApprovals';
import UserDetailsModal from '../admin/UserDetailsModal';
import logo from '/src/assets/logo.png';
import { AUTO_REFRESH_MS } from '../../constants/refresh';
import resp_logo from '/src/assets/logo_1.png';

import { downloadJson } from '../../utils/fileDownload';

export default function SuperAdminDashboard(){
  const navigate = useNavigate();
  const { section } = useParams();

  const [activeNav, setActiveNav] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarDark, setIsSidebarDark] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifItems, setNotifItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [initialThreadId, setInitialThreadId] = useState(null);

  const handleExportReport = () => {
    const report = {
      generated_at: new Date().toISOString(),
      dashboard: {
        users: { total: 1250, pending_admin_approvals: 8, removal_requests: 3 },
        carriers: { total: 42, flagged: 2 },
        drivers: { online: 84, offline: 5 },
        compliance: { expiring_docs: 6, violations: 2, audits_pending: 1 },
        finance: { mtd_revenue: 184000, unpaid_invoices: 12 },
        documents: { new_uploads: 23, unsigned_forms: 4 },
        marketplace: { pending_listings: 11, flagged_for_review: 3 },
      }
    };
    downloadJson(`super_admin_report_${new Date().toISOString().slice(0, 10)}.json`, report);
  };

  const fetchNotifications = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      setNotifLoading(true);
      const token = await user.getIdToken();
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

  const markNotificationRead = async (notificationId) => {
    try {
      const user = auth.currentUser;
      if (!user || !notificationId) return;
      const token = await user.getIdToken();
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

  const navGroups = [
    {
      title: 'OVERVIEW',
      items: [
        { key: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-house' },
        { key: 'tracking', label: 'Tracking & Visibility', icon: 'fa-solid fa-location-dot' },
        { key: 'analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line' }
      ]
    },
    {
      title: 'MANAGEMENT',
      items: [
        { key: 'users', label: 'Users & Roles', icon: 'fa-solid fa-users' },
        { key: 'admin-approvals', label: 'Admin Approvals', icon: 'fa-solid fa-user-check' },
        { key: 'removal-approvals', label: 'Removal Approvals', icon: 'fa-solid fa-user-slash' },
        { key: 'carriers', label: 'Carriers', icon: 'fa-solid fa-truck' },
        { key: 'shippers', label: 'Shippers / Brokers', icon: 'fa-solid fa-people-group' },
        { key: 'drivers', label: 'Drivers', icon: 'fa-solid fa-person' },
        { key: 'service-providers', label: 'Service Providers', icon: 'fa-solid fa-briefcase' },
        { key: 'marketplace', label: 'Marketplace', icon: 'fa-solid fa-store' }
      ]
    },
    {
      title: 'OPERATIONS',
      items: [
        { key: 'document-vault', label: 'Document Vault', icon: 'fa-regular fa-folder' },
        { key: 'compliance-audit', label: 'Compliance & Audit', icon: 'fa-solid fa-shield-halved' },
        { key: 'finance-billing', label: 'Finance & Billing', icon: 'fa-solid fa-dollar-sign' },
        { key: 'alerts', label: 'Alerts & Notifications', icon: 'fa-solid fa-bell' },
        { key: 'marketing', label: 'Marketing & Promotion', icon: 'fa-solid fa-bullhorn' },
        { key: 'messages', label: 'Messages', icon: 'fa-solid fa-comments' },
        { key: 'tasks', label: 'Tasks / To-Do', icon: 'fa-solid fa-list-check' },
        { key: 'hiring', label: 'Hiring & Onboarding', icon: 'fa-solid fa-user-plus' }
      ]
    },
    {
      title: 'SYSTEM & TOOLS',
      items: [
        { key: 'ai-hub', label: 'AI Hub', icon: 'fa-solid fa-robot' },
        { key: 'integrations', label: 'Integrations Manager', icon: 'fa-solid fa-plug' },
        { key: 'support', label: 'Support Hub', icon: 'fa-regular fa-circle-question' },
        { key: 'system-settings', label: 'System Settings', icon: 'fa-solid fa-gear' }
      ]
    }
  ];

  const validNavKeys = useMemo(() => {
    const keys = new Set();
    navGroups.forEach((g) => g.items.forEach((it) => keys.add(it.key)));
    return keys;
  }, []);

  useEffect(() => {
    const next = (section || 'dashboard').toLowerCase();
    setActiveNav(validNavKeys.has(next) ? next : 'dashboard');
  }, [section, validNavKeys]);

  // Controlled access: verify session + role with backend.
  useEffect(() => {
    const run = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate('/super-admin/login', { replace: true });
          return;
        }

        const idToken = await getIdToken(user);
        const resp = await fetch(`${API_URL}/auth/super-admin/profile`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          await signOut(auth);
          navigate('/super-admin/login', { replace: true, state: { reason: data?.detail || 'Unauthorized' } });
          return;
        }

        if (data?.photo_url) setAvatarUrl(data.photo_url);
      } catch (e) {
        console.warn('SuperAdminDashboard auto-provision failed:', e);
        try {
          await signOut(auth);
        } catch (_) {
          // ignore
        }
        navigate('/super-admin/login', { replace: true });
      }
    };
    run();
  }, [navigate]);

  // Fetch notifications count
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const idToken = await getIdToken(user);
        const res = await fetch(`${API_URL}/notifications?page=1&page_size=1`, {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        if (!alive) return;
        if (res.ok) {
          const data = await res.json();
          setNotifUnread(Number(data?.unread_count || 0));
        }
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, AUTO_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/super-admin/login', { replace: true });
  };

  const openUserModal = (uid) => {
    const value = String(uid || '').trim();
    if (!value) return;
    setSelectedUserId(value);
    setUserModalOpen(true);
  };

  const performSearch = async (query) => {
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      const idToken = await getIdToken(user);
      // Search across users, carriers, and documents
      const [usersRes, carriersRes, documentsRes] = await Promise.allSettled([
        fetch(`${API_URL}/admin/users/search?q=${encodeURIComponent(query)}&limit=5`, {
          headers: { Authorization: `Bearer ${idToken}` }
        }),
        fetch(`${API_URL}/carriers?search=${encodeURIComponent(query)}&limit=5`, {
          headers: { Authorization: `Bearer ${idToken}` }
        }),
        fetch(`${API_URL}/documents?search=${encodeURIComponent(query)}&limit=5`, {
          headers: { Authorization: `Bearer ${idToken}` }
        })
      ]);

      const results = [];

      // Process users
      if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
        const usersData = await usersRes.value.json();
        const users = Array.isArray(usersData?.items)
          ? usersData.items
          : (Array.isArray(usersData?.users) ? usersData.users : []);
        if (users.length > 0) {
          users.forEach(user => {
            results.push({
              type: 'user',
              name: user.name || user.email || user.uid,
              subtitle: user.role || 'User',
              id: user.uid
            });
          });
        }
      }

      // Process carriers
      if (carriersRes.status === 'fulfilled' && carriersRes.value.ok) {
        const carriersData = await carriersRes.value.json();
        if (Array.isArray(carriersData.carriers)) {
          carriersData.carriers.forEach(carrier => {
            results.push({
              type: 'carrier',
              name: carrier.name || carrier.company_name || 'Unknown Carrier',
              subtitle: `DOT: ${carrier.dot_number || 'N/A'}`,
              id: carrier.id
            });
          });
        }
      }

      // Process documents
      if (documentsRes.status === 'fulfilled' && documentsRes.value.ok) {
        const documentsData = await documentsRes.value.json();
        const documents = Array.isArray(documentsData?.documents)
          ? documentsData.documents
          : (Array.isArray(documentsData?.items) ? documentsData.items : []);
        if (documents.length > 0) {
          documents.forEach(doc => {
            results.push({
              type: 'document',
              name: doc.name || doc.file_name || 'Document',
              subtitle: doc.doc_type || 'Document',
              id: doc.id
            });
          });
        }
      }

      setSearchResults(results.slice(0, 10)); // Limit to 10 results
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // Perform search when query changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        performSearch(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  return (
    <div className={`fp-dashboard-root ${isDarkMode ? 'dark-root' : ''}`}>
      <div className="fp-topbar">
        <div className="topbar-row topbar-row-1">
          <div className="topbar-left" style={{display:'flex',alignItems:'center',gap:12}}>
            <button className="hamburger" aria-label="Open sidebar" onClick={() => setIsSidebarOpen(true)}>
              <i className="fa-solid fa-bars" />
            </button>
            <div className="brand-block" style={{display:'flex',alignItems:'center',gap:12}}>
              <div className="logo">
                {/* Desktop / large-screen logo */}
                <img src={logo} alt="FreightPower" className="landing-logo-image desktop-logo" />
                {/* Responsive compact logo shown at <=768px */}
                <img src={resp_logo} alt="FreightPower" className="landing-logo-image mobile-logo" />
              </div>
            </div>
          </div>

          <div style={{flex:1,display:'flex',justifyContent:'center'}}>
            <div className="search-input-container" style={{width:720,maxWidth:'70%', position: 'relative'}}>
              <input 
                className="search-input" 
                placeholder="Search by user, carrier, or document..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  if (searchQuery.trim().length >= 2) {
                    performSearch(searchQuery);
                  }
                }}
              />
              {searchQuery.trim().length >= 2 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: isDarkMode ? '#0b1220' : '#ffffff',
                  border: isDarkMode ? '1px solid rgba(148,163,184,0.22)' : '1px solid #e5e7eb',
                  borderRadius: '8px',
                  marginTop: '4px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  zIndex: 1000,
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  {searchLoading ? (
                    <div style={{ padding: '12px', color: isDarkMode ? '#94a3b8' : '#64748b' }}>Searching...</div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((result, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '12px',
                          borderBottom: isDarkMode ? '1px solid rgba(148,163,184,0.14)' : '1px solid #f1f5f9',
                          cursor: 'pointer',
                          ':hover': { background: isDarkMode ? 'rgba(59,130,246,0.10)' : '#f8fafc' }
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = isDarkMode ? 'rgba(59,130,246,0.10)' : '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                        onClick={() => {
                          // Navigate to appropriate section based on result type
                          if (result.type === 'user') {
                            setActiveNav('users');
                            navigate(`/super-admin/users`);
                          } else if (result.type === 'carrier') {
                            setActiveNav('carriers');
                            navigate(`/super-admin/carriers`);
                          } else if (result.type === 'document') {
                            setActiveNav('document-vault');
                            navigate(`/super-admin/document-vault`);
                          }
                          setSearchQuery('');
                          setSearchResults([]);
                        }}
                      >
                        <div style={{ fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#0f172a' }}>
                          {result.name || result.title}
                        </div>
                        <div style={{ fontSize: '12px', color: isDarkMode ? '#94a3b8' : '#64748b', marginTop: '4px' }}>
                          {result.type === 'user' ? 'User' : result.type === 'carrier' ? 'Carrier' : 'Document'}
                          {result.subtitle && ` • ${result.subtitle}`}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '12px', color: isDarkMode ? '#94a3b8' : '#64748b' }}>No results found</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="topbar-right actions-right" style={{display:'flex',alignItems:'center',gap:12}}>
            <button className="search-toggle" aria-label="Open search">
              <i className="fa-solid fa-magnifying-glass" />
            </button>
            <div className="icons">
              <div className="notif" id="fp-notif-dropdown-root" style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="notif"
                  onClick={() => {
                    setNotifOpen(false);
                    setActiveNav('alerts');
                    navigate('/super-admin/alerts');
                    fetchNotifications();
                  }}
                  aria-label="Open Alerts & Notifications"
                  style={{ position: 'relative' }}
                >
                  <i className="fa-regular fa-bell notif-icon" aria-hidden="true" />
                  {notifUnread > 0 && (
                    <span className="notif-badge" style={{ position: 'absolute', right: -6, top: -6 }}>
                      {notifUnread > 99 ? '99+' : notifUnread}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div
                    className="notif-dropdown"
                    style={{
                      position: 'absolute',
                      top: 36,
                      right: 0,
                      width: 360,
                      maxWidth: '90vw',
                      background: isDarkMode ? '#0b1220' : '#ffffff',
                      border: isDarkMode ? '1px solid rgba(148,163,184,0.22)' : '1px solid #e5e7eb',
                      borderRadius: 12,
                      boxShadow: '0 12px 28px rgba(2,6,23,0.18)',
                      zIndex: 80,
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
                      <div style={{ fontWeight: 800, color: isDarkMode ? '#e2e8f0' : '#0f172a' }}>Notifications</div>
                      <button
                        type="button"
                        className="btn small ghost-cd"
                        onClick={() => fetchNotifications()}
                        disabled={notifLoading}
                      >
                        Refresh
                      </button>
                    </div>

                    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                      {notifLoading ? (
                        <div style={{ padding: 14, color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13 }}>Loading…</div>
                      ) : (notifItems || []).length === 0 ? (
                        <div style={{ padding: 14, color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13 }}>No notifications yet.</div>
                      ) : (
                        (notifItems || []).map((n) => {
                          const isRead = Boolean(n?.is_read);
                          const title = String(n?.title || 'Notification');
                          const body = String(n?.message || n?.body || '');
                          const when = String(n?.created_at_human || n?.created_at || '').trim();
                          return (
                            <div
                              key={String(n?.id || Math.random())}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleNotifAction(n)}
                              onKeyDown={(e) => e.key === 'Enter' && handleNotifAction(n)}
                              style={{
                                padding: 12,
                                borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.14)' : '1px solid #f1f5f9',
                                background: isRead ? 'transparent' : (isDarkMode ? 'rgba(59,130,246,0.10)' : '#eff6ff'),
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 800, color: isDarkMode ? '#e2e8f0' : '#0f172a', fontSize: 13 }}>
                                    {title}
                                  </div>
                                  {body ? (
                                    <div style={{ color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.35, marginTop: 4 }}>
                                      {body}
                                    </div>
                                  ) : null}
                                  {when ? (
                                    <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 11, marginTop: 6 }}>
                                      {when}
                                    </div>
                                  ) : null}
                                </div>
                                {!isRead && (
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
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <i className="fa-regular fa-comments" style={{fontSize:18}} aria-hidden="true" />
            </div>

            <div
              className="profile"
              style={{display:'flex',alignItems:'center',gap:8, cursor:'pointer'}}
              onClick={() => navigate('/super-admin/profile')}
              role="button"
              tabIndex={0}
              aria-label="Open profile"
            >
              <img src={avatarUrl || "https://www.gravatar.com/avatar/?d=mp"} alt="avatar" className="avatar-img"/>
              <div className="profile-labels" style={{textAlign:'right'}}>
                <div style={{fontWeight:700}}>Platform Admin</div>
                <div className="muted" style={{fontSize:12}}>Super Admin</div>
                <i className="fa-solid fa-caret-down" />
              </div>
            </div>

            <button
              className="btn small ghost-cd"
              onClick={() => navigate('/super-admin/admin-approvals')}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <i className="fa-solid fa-user-check" aria-hidden="true" />
              Admin Approvals
            </button>

            <button
              className="btn small ghost-cd"
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
              Log out
            </button>
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
              <span className="chip-cd success">Super Admin</span>
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
                        setActiveNav(it.key);
                        navigate(`/super-admin/${it.key}`);
                        if (isSidebarOpen) setIsSidebarOpen(false);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <i className={`${it.icon} icon`} aria-hidden="true"></i>
                      <span className="label">{it.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="sidebar-dark-control" aria-hidden="false">
            <span className="dark-label">Dark Mode</span>
            <button
              className={`dark-toggle ${isDarkMode ? 'on' : ''}`}
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

        <main className="adm-main fp-main">
          <UserDetailsModal
            open={userModalOpen}
            userId={selectedUserId}
            onClose={() => setUserModalOpen(false)}
            onSendMessage={async (u) => {
              try {
                const targetUid = String(u?.uid || '').trim();
                if (!targetUid) return;
                const user = auth.currentUser;
                if (!user) return;
                const idToken = await getIdToken(user);
                const res = await fetch(`${API_URL}/messaging/admin/threads/direct`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ target_uid: targetUid }),
                });
                if (res.ok) {
                  const data = await res.json().catch(() => ({}));
                  const tid = data?.thread?.id || data?.thread_id || null;
                  setInitialThreadId(tid);
                }
              } catch (e) {
                console.error('Failed to open direct thread:', e);
              } finally {
                setUserModalOpen(false);
                setActiveNav('messages');
                navigate('/super-admin/messages');
              }
            }}
          />

          {activeNav === 'dashboard' && (
            <div>
            <div className="ai-summary" style={{marginBottom: '20px'}}>
              <div className="ai-summary-left">
                <span className="aai-icon"><i className="fa fa-info-circle" aria-hidden="true"></i></span>
                <div className="aai-text">Platform stable — <strong>6 compliance alerts</strong> • <strong>3 pending provider verifications</strong> • <strong>1 flagged marketplace listing</strong>.</div>
              </div>
              <div className="aai-actions">
                <div className="sa-banner-updated">Last updated: 5 min ago</div>
              </div>
            </div>

          <section className="sa-grid">
            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-brain' style={{marginRight: '10px'}}></i></span>AI System Health</div>
              <div className="sa-card-body">All systems operational<br/><span className=" sa muted">3 compliance alerts &nbsp; 2 flagged providers</span></div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-truck' style={{marginRight: '10px'}}></i></span>Carriers Snapshot</div>
              <div className="sa-card-body big-number">192<br/><span className="sa muted">active carriers • 6 pending verification</span></div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-box' style={{marginRight: '10px'}}></i></span>Shippers & Brokers</div>
              <div className="sa-card-body big-number">74<br/><span className="sa muted">154 loads this week • 5 delayed</span></div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-briefcase' style={{marginRight: '10px'}}></i></span>Service Providers</div>
              <div className="sa-card-body big-number">42<br/><span className="sa muted">active partners • 3 pending onboarding</span></div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-shield-halved' style={{marginRight: '10px'}}></i></span>Compliance Alerts</div>
              <div className="sa-card-body">6 expiring docs<br/>2 violations<br/>1 audit pending</div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-credit-card' style={{marginRight: '10px'}}></i></span>Finance Overview</div>
              <div className="sa-card-body big-number">$184K<br/><span className="sa muted">MTD revenue • 12 unpaid invoices</span></div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-file' style={{marginRight: '10px'}}></i></span>Document Vault</div>
              <div className="sa-card-body">23 new uploads<br/><span className="sa muted">4 unsigned forms</span></div>
            </div>

            <div className="sa-card">
              <div className="sa-card-title"><span><i className='fas fa-store' style={{marginRight: '10px'}}></i></span>Marketplace Activity</div>
              <div className="sa-card-body">11 pending listings<br/><span className="sa muted">3 flagged for review</span></div>
            </div>

            <div className="sa-card sa-card">
              <div className="sa-card-title"><span><i className='fas fa-list-check' style={{marginRight: '10px'}}></i></span>Tasks / Recent Activity</div>
              <div className="sa-card-body">
                <ul className="sa-activity-list">
                  <li>User added</li>
                  <li>Policy uploaded</li>
                  <li>Message sent</li>
                </ul>
              </div>
            </div>
          </section>
          <div className='sa-buttons-btm'>
            <button className='btn small-cd' onClick={() => navigate('/super-admin/users')}><i className='fas fa-user-plus'></i>Add User</button>
            <button className='btn small ghost-cd' onClick={() => navigate('/super-admin/admin-approvals')}>
              <i className='fas fa-user-check'></i>Admin Approvals
            </button>
            <button className='btn small ghost-cd' onClick={handleExportReport}><i className='fas fa-file-export'></i>Export Report</button>
            <button className='btn small ghost-cd' onClick={() => navigate('/super-admin/messages')}><i className='fas fa-bullhorn'></i>Send Announcement</button>
            <button className='btn small ghost-cd' onClick={() => navigate('/super-admin/compliance-audit')}><i className='fas fa-shield-halved'></i>Open Compliance</button>
          </div>
          </div>
          )}  

          {activeNav === 'alerts' && (
            <div>
              <header className="fp-header">
                <div className="fp-header-titles">
                  <h2>Alerts &amp; Notifications</h2>
                  <p className="fp-subtitle">System alerts and platform notifications.</p>
                </div>
                <div className="fp-header-controls">
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

              <section className="fp-grid">
                <div className="card">
                  <div className="card-header"><h3>Notifications</h3></div>
                  <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                    {(notifItems || []).length === 0 ? (
                      <div style={{ padding: 14, fontSize: 13 }} className="muted">
                        {notifLoading ? 'Loading…' : 'No notifications yet.'}
                      </div>
                    ) : (
                      (notifItems || []).map((n) => {
                        const isRead = Boolean(n?.is_read);
                        const title = String(n?.title || 'Notification');
                        const body = String(n?.message || n?.body || '');
                        const when = String(n?.created_at_human || n?.relative_time || n?.formatted_time || n?.created_at || '').trim();
                        return (
                          <div
                            key={String(n?.id || Math.random())}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleNotifAction(n)}
                            onKeyDown={(e) => e.key === 'Enter' && handleNotifAction(n)}
                            style={{
                              padding: 12,
                              borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.14)' : '1px solid #f1f5f9',
                              background: isRead ? 'transparent' : (isDarkMode ? 'rgba(59,130,246,0.10)' : '#eff6ff'),
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 800, fontSize: 13 }}>{title}</div>
                                {body ? (
                                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.35, marginTop: 4 }}>
                                    {body}
                                  </div>
                                ) : null}
                                {when ? (
                                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{when}</div>
                                ) : null}
                              </div>
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
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeNav === 'tracking' && <TrackingVisibility /> }
          {activeNav === 'analytics' && <AdminAnalytics /> }
          {activeNav === 'users' && <UsersRoles onOpenUser={openUserModal} /> }
          {activeNav === 'admin-approvals' && <AdminApprovals /> }
          {activeNav === 'removal-approvals' && <RemovalApprovals /> }
            {activeNav === 'carriers' && <Carriers onOpenUser={openUserModal} /> }
            {activeNav === 'drivers' && <Drivers onOpenUser={openUserModal} /> }
            {activeNav === 'shippers' && <Shippers onOpenUser={openUserModal} /> }
            {activeNav === 'service-providers' && <ServiceProviders /> }
            {activeNav === 'marketplace' && <AdminMarketplace /> }
            {activeNav === 'document-vault' && <AdminDocumentVault /> }
            {activeNav === 'compliance-audit' && <ComplianceAudit /> }
            {activeNav === 'finance-billing' && <FinanceBilling /> }
            {activeNav === 'messages' && (<AdminMessaging initialThreadId={initialThreadId} /> )}
            {activeNav === 'marketing' && <MarketingPromotion /> }
            {activeNav === 'ai-hub' && <AiHub /> }
            {activeNav === 'integrations' && <IntegrationsManager /> }
            {activeNav === 'tasks' && <Tasks /> }
            {activeNav === 'hiring' && <HiringOnboarding /> }
            {activeNav === 'support' && <SupportHub /> }
            {activeNav === 'system-settings' && <SystemSettings /> }
        </main>
      </div>
    </div>
  );
}
