import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../../styles/carrier/CarrierDashboard.css';
import '../../styles/admin/AdminDashboard.css';
import TrackingVisibility from './TrackingVisibility';
import AdminAnalytics from './AdminAnalytics';
import UsersRoles from './UsersRoles';
import Carriers from './Carriers';
import Shippers from './Shippers';
import Drivers from './Drivers';
import ServiceProviders from './ServiceProviders';
import AdminMarketplace from './AdminMarketplace';
import ComplianceAudit from './ComplianceAudit';
import DocumentVault from './DocumentVault';
import AdminMessaging from './Messaging';
import Tasks from './Tasks';
import HiringOnboarding from './HiringOnboarding';
import SupportHub from './SupportHub';
import SystemSettings from './SystemSettings';
import MyProfile from './MyProfile';
import Notifications from './Notifications';
import Logout from './Logout';
import logo from '/src/assets/logo.png';
import resp_logo from '/src/assets/logo_1.png';
import { getJson, postJson } from '../../api/http';
import { useAuth } from '../../contexts/AuthContext';
import UserDetailsModal from './UserDetailsModal';
import { AUTO_REFRESH_MS } from '../../constants/refresh';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { section } = useParams();
  const { currentUser, userRole, logout } = useAuth();

  const [activeNav, setActiveNav] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarDark, setIsSidebarDark] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [adminProfile, setAdminProfile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchItems, setSearchItems] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [initialThreadId, setInitialThreadId] = useState(null);

  const [dashboardMetrics, setDashboardMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');

  const [recentUnreadThreads, setRecentUnreadThreads] = useState([]);
  const [recentUnreadLoading, setRecentUnreadLoading] = useState(false);

  // Notifications state
  const [notifUnread, setNotifUnread] = useState(0);

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
        { key: 'messages', label: 'Messages', icon: 'fa-solid fa-envelope' },
        { key: 'tasks', label: 'Tasks / To-Do', icon: 'fa-solid fa-list-check' },
        { key: 'hiring', label: 'Hiring & Onboarding', icon: 'fa-solid fa-user-plus' }
      ]
    },
    {
      title: 'SYSTEM & TOOLS',
      items: [
        { key: 'support', label: 'Support Hub', icon: 'fa-regular fa-circle-question' },
        { key: 'system-settings', label: 'System Settings', icon: 'fa-solid fa-gear' },
        { key: 'my-profile', label: 'My Profile', icon: 'fa-regular fa-user' },
        { key: 'notifications', label: 'Alerts & Notifications', icon: 'fa-regular fa-bell' },
        { key: 'logout', label: 'Logout', icon: 'fa-solid fa-right-from-bracket' }
      ]
    }
  ];

  const validNavKeys = useMemo(() => {
    const keys = new Set();
    navGroups.forEach((g) => g.items.forEach((it) => keys.add(it.key)));
    return keys;
  }, []);

  useEffect(() => {
    // If the URL doesn't specify a section, honor the user's preferred start view.
    if (!currentUser) return;
    if (section) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getJson('/auth/settings', { requestLabel: 'GET /auth/settings (start view)' });
        if (cancelled) return;
        const start = String(s?.start_dashboard_view || '').trim().toLowerCase();
        if (start && start !== 'dashboard' && validNavKeys.has(start)) {
          navigate(`/admin/${start}`, { replace: true });
        }
      } catch {
        // Ignore and use default.
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, section, validNavKeys, navigate]);

  useEffect(() => {
    const next = (section || 'dashboard').toLowerCase();
    setActiveNav(validNavKeys.has(next) ? next : 'dashboard');
  }, [section, validNavKeys]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await getJson('/auth/me', { requestLabel: 'GET /auth/me (admin)' });
        if (!mounted) return;
        setAdminProfile(me || null);
      } catch (e) {
        // Fallbacks will be used if this fails.
        if (!mounted) return;
        setAdminProfile(null);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const q = String(searchQuery || '').trim();
    setSearchError('');
    if (!q || q.length < 2) {
      setSearchItems([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await getJson(`/admin/users/search?q=${encodeURIComponent(q)}&limit=8`, {
          requestLabel: 'GET /admin/users/search',
          timeoutMs: 25000,
        });
        if (cancelled) return;
        setSearchItems(Array.isArray(res?.items) ? res.items : []);
      } catch (e) {
        if (cancelled) return;
        setSearchItems([]);
        setSearchError(e?.message || 'Search failed');
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (activeNav !== 'dashboard') return;
    let cancelled = false;
    setMetricsError('');
    setMetricsLoading(true);
    (async () => {
      try {
        const m = await getJson('/admin/dashboard/metrics', { requestLabel: 'GET /admin/dashboard/metrics' });
        if (cancelled) return;
        setDashboardMetrics(m || null);
      } catch (e) {
        if (cancelled) return;
        setDashboardMetrics(null);
        setMetricsError(e?.message || 'Failed to load dashboard metrics');
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeNav]);

  useEffect(() => {
    if (activeNav !== 'dashboard') return;
    let cancelled = false;
    setRecentUnreadLoading(true);
    (async () => {
      try {
        const [threadsResp, unreadResp, notifResp] = await Promise.all([
          getJson('/messaging/threads?limit=100', { requestLabel: 'GET /messaging/threads (dashboard)' }),
          getJson('/messaging/unread/summary', { requestLabel: 'GET /messaging/unread/summary (dashboard)' }),
          getJson('/notifications?page=1&page_size=1', { requestLabel: 'GET /notifications (dashboard)' }).catch(() => ({ unread_count: 0 })),
        ]);
        if (cancelled) return;

        const threads = Array.isArray(threadsResp?.threads) ? threadsResp.threads : [];
        const summaryThreads = unreadResp?.threads || {};

        const unread = threads
          .filter((t) => summaryThreads?.[t?.id]?.has_unread)
          .sort((a, b) => {
            const at = Number(summaryThreads?.[a?.id]?.last_message_at || a?.last_message_at || a?.updated_at || 0);
            const bt = Number(summaryThreads?.[b?.id]?.last_message_at || b?.last_message_at || b?.updated_at || 0);
            return bt - at;
          })
          .slice(0, 2);

        setRecentUnreadThreads(unread);
        setNotifUnread(Number(notifResp?.unread_count || 0));
      } catch (e) {
        if (cancelled) return;
        setRecentUnreadThreads([]);
      } finally {
        if (!cancelled) setRecentUnreadLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeNav]);

  // Poll notifications count
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    const tick = async () => {
      try {
        const notifResp = await getJson('/notifications?page=1&page_size=1', { requestLabel: 'GET /notifications (poll)' }).catch(() => ({ unread_count: 0 }));
        if (!alive) return;
        setNotifUnread(Number(notifResp?.unread_count || 0));
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
  }, [currentUser]);

  const adminName =
    adminProfile?.name
    || currentUser?.displayName
    || (currentUser?.email ? currentUser.email.split('@')[0] : '')
    || 'Admin';

  const adminAvatar =
    adminProfile?.profile_picture_url
    || currentUser?.photoURL
    || 'https://randomuser.me/api/portraits/men/75.jpg';

  const adminRoleLabel =
    (adminProfile?.role || userRole || 'admin')
      .toString()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const goToSection = (key) => {
    setActiveNav(key);
    navigate(`/admin/${key}`);
    if (isSidebarOpen) setIsSidebarOpen(false);
  };

  const openUserModal = (uid) => {
    setSelectedUserId(uid);
    setUserModalOpen(true);
  };

  const handleLogoutQuick = async () => {
    try {
      await logout();
    } finally {
      navigate('/admin/login', { replace: true });
    }
  };

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
            <div className="search-input-container" style={{width:720,maxWidth:'70%'}}>
              <input
                className="search-input"
                placeholder="Search users by name/email/DOT/MC/CDL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              />

              {searchOpen && (searchLoading || searchError || (searchItems?.length || 0) > 0) && (
                <div
                  className="adm-search-dropdown"
                  role="listbox"
                  aria-label="User search results"
                >
                  {searchLoading && <div className="adm-search-row muted">Searching…</div>}
                  {!!searchError && !searchLoading && <div className="adm-search-row error">{searchError}</div>}

                  {!searchLoading && !searchError && (searchItems || []).map((it) => (
                    <button
                      key={it.uid}
                      type="button"
                      className="adm-search-row"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearchQuery('');
                        setSearchItems([]);
                        setSearchOpen(false);
                        openUserModal(it.uid);
                      }}
                    >
                      <div className="adm-search-main">
                        <div className="adm-search-name">{it.name || it.email || it.uid}</div>
                        <div className="adm-search-sub muted">
                          {(it.role || 'user').toString().replace(/_/g, ' ')}
                          {it.dot_number ? ` • DOT ${it.dot_number}` : ''}
                          {it.mc_number ? ` • MC ${it.mc_number}` : ''}
                          {it.cdl_number ? ` • CDL ${it.cdl_number}` : ''}
                        </div>
                      </div>
                    </button>
                  ))}

                  {!searchLoading && !searchError && (searchItems?.length || 0) === 0 && String(searchQuery || '').trim().length >= 2 && (
                    <div className="adm-search-row muted">No matches</div>
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
              <button
                type="button"
                className="notif"
                style={{position:'relative',background:'transparent',border:0,padding:0,cursor:'pointer'}}
                aria-label="Open Alerts & Notifications"
                onClick={() => goToSection('notifications')}
              >
                <i className="fa-regular fa-bell notif-icon" aria-hidden="true" />
                {notifUnread > 0 && <span className="notif-badge" style={{position:'absolute',right:-6,top:-6}}>{notifUnread > 99 ? '99+' : notifUnread}</span>}
              </button>
              <button
                type="button"
                style={{background:'transparent',border:0,padding:0,cursor:'pointer'}}
                aria-label="Messages"
                onClick={() => goToSection('messages')}
              >
                <i className="fa-regular fa-comments" style={{fontSize:18}} aria-hidden="true" />
              </button>
            </div>

            <div className="profile" style={{display:'flex',alignItems:'center',gap:8}}>
              <button
                type="button"
                onClick={() => goToSection('my-profile')}
                aria-label="My Profile"
                style={{background:'transparent',border:0,padding:0,cursor:'pointer'}}
              >
                <img src={adminAvatar} alt="avatar" className="avatar-img"/>
              </button>
              <div className="profile-labels" style={{textAlign:'right'}}>
                <div style={{fontWeight:700}}>{adminName}</div>
                <div className="muted" style={{fontSize:12}}>{adminRoleLabel}</div>
                <button
                  type="button"
                  aria-label="Logout"
                  onClick={() => goToSection('logout')}
                  style={{background:'transparent',border:0,padding:0,cursor:'pointer'}}
                >
                  <i className="fa-solid fa-caret-down" />
                </button>
              </div>
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
              <span className="chip-cd success">{adminName}</span>
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
                        navigate(`/admin/${it.key}`);
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
          {/* Dark mode control - toggles site theme when clicked */}
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
                const resp = await postJson('/messaging/admin/threads/direct', { target_uid: targetUid });
                const tid = resp?.thread?.id || resp?.thread_id || null;
                setInitialThreadId(tid);
              } catch (e) {
                console.error('Failed to open direct thread:', e);
              } finally {
                setUserModalOpen(false);
                goToSection('messages');
              }
            }}
          />

          {activeNav === 'tracking' && (
            <TrackingVisibility />
          )}

          {activeNav === 'analytics' && (
            <AdminAnalytics />
          )}

          {activeNav === 'users' && (
            <UsersRoles onOpenUser={openUserModal} />
          )}

          {activeNav === 'carriers' && (
            <Carriers onOpenUser={openUserModal} />
          )}

          {activeNav === 'shippers' && (
            <Shippers onOpenUser={openUserModal} />
          )}

          {activeNav === 'drivers' && (
            <Drivers onOpenUser={openUserModal} />
          )}

          {activeNav === 'service-providers' && (
            <ServiceProviders />
          )}

          {activeNav === 'marketplace' && (
            <AdminMarketplace />
          )}

          {activeNav === 'document-vault' && (
            <DocumentVault />
          )}

          {activeNav === 'compliance-audit' && (
            <ComplianceAudit />
          )}

          {activeNav === 'messages' && (
            <AdminMessaging initialThreadId={initialThreadId} />
          )}

          {activeNav === 'tasks' && (
            <Tasks />
          )}

          {activeNav === 'hiring' && (
            <HiringOnboarding />
          )}

          {activeNav === 'support' && (
            <SupportHub />
          )}

          {activeNav === 'system-settings' && (
            <SystemSettings />
          )}

          {activeNav === 'my-profile' && (
            <MyProfile />
          )}

          {activeNav === 'notifications' && (
            <Notifications />
          )}

          {activeNav === 'logout' && (
            <Logout />
          )}

          {activeNav === 'dashboard' && (
            <>
            <header className="fp-header">
            <div className="fp-header-titles">
              <h2>Welcome, {adminName} <span role="img" aria-label="wave">👋</span></h2>
              <p className="fp-subtitle">Role: {adminRoleLabel} — Last login: Recently</p>
            </div>
          </header>

          {/*
            Quick actions intentionally hidden for now:
            1) Add User
            2) Upload Document
            3) Assign Task
            4) Support
          */}
          {/* <div className="buttons-aa">
              <button className="btn small-cd">+ Add User</button>
              <button className="btn ghost-cd small">Upload Document</button>
              <button className="btn ghost-cd small">Assign Task</button>
              <button className="btn small ghost-cd">Support</button>
            </div> */}

          {metricsError && (
            <div className="card" style={{ padding: 14, borderColor: '#fecaca', background: '#fff1f2' }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>Dashboard metrics unavailable</div>
              <div className="muted">{metricsError}</div>
            </div>
          )}
            <section className="fp-grid">
            <div className="card stats-card">
              <div className="card-headers"><h3>Pending Documents</h3><i className="fa-regular fa-file card-icon"/></div>
              <div className="statss"><div>{metricsLoading ? '—' : (dashboardMetrics?.pending_documents ?? '—')}</div></div>
            </div>

            <div className="card stats-card">
              <div className="card-headers"><h3>Active Carriers</h3><i className="fa-solid fa-truck card-icon"/></div>
              <div className="statss"><div>{metricsLoading ? '—' : (dashboardMetrics?.active_carriers ?? '—')}</div></div>
            </div>

            <div className="card stats-card">
              <div className="card-headers"><h3>Active Drivers</h3><i className="fa-solid fa-user card-icon"/></div>
              <div className="statss"><div>{metricsLoading ? '—' : (dashboardMetrics?.active_drivers ?? '—')}</div></div>
            </div>

            <div className="card stats-card">
              <div className="card-headers"><h3>Pending Onboardings</h3><i className="fa-solid fa-hourglass-half card-icon"/></div>
              <div className="statss"><div>{metricsLoading ? '—' : (dashboardMetrics?.pending_onboardings ?? '—')}</div></div>
            </div>

            <div className="card stats-card">
              <div className="card-headers"><h3>Support Tickets</h3><i className="fa-solid fa-ticket card-icon"/></div>
              <div className="statss"><div>{metricsLoading ? '—' : (dashboardMetrics?.support_tickets ?? '—')}</div></div>
            </div>

            <div className="card stats-card">
              <div className="card-headers"><h3>Compliance Rate</h3><i className="fa-solid fa-shield-halved card-icon"/></div>
              <div className="statss"><div>
                {metricsLoading ? '—' : `${Number(dashboardMetrics?.compliance_rate_percent ?? 0).toFixed(1)}%`}
                <span style={{ marginLeft: 10, color: Number(dashboardMetrics?.compliance_delta_percent ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                  {metricsLoading ? '' : `${Number(dashboardMetrics?.compliance_delta_percent ?? 0) >= 0 ? '+' : ''}${Number(dashboardMetrics?.compliance_delta_percent ?? 0).toFixed(1)}% this week`}
                </span>
              </div></div>
            </div>
          </section>

          {/* Lower content: recent activity (left) and support/messages (right) */}
          <section className="adm-lower-grid">
            <div>
              <div className="card recent-activity-card">
                <div className="card-row"><h3>Recent Activity</h3></div>
                <ul className="recent-list">
                  <li className="msg-item">
                    <div className="msg-body">
                      <div className="msg-head"><strong>Carrier "SpeedFast LLC"</strong> <span className="muted">submitted insurance doc</span></div>
                      <div className="muted">09:12 AM</div>
                    </div>
                    <div className="tag"><span className="int-status-badge resolved">Verified</span></div>
                  </li>

                  <li className="msg-item">
                    <div className="msg-body">
                      <div className="msg-head"><strong>Driver "John M."</strong> <span className="muted">completed onboarding</span></div>
                      <div className="muted">09:09 AM</div>
                    </div>
                    <div className="tag"><span className="int-status-badge resolved">Approved</span></div>
                  </li>

                  <li className="msg-item">
                    <div className="msg-body">
                      <div className="msg-head"><strong>Ticket #1023</strong> <span className="muted">resolved by Sub-Admin</span></div>
                      <div className="muted">08:55 AM</div>
                    </div>
                    <div className="tag"><span className="int-status-badge resolved">Closed</span></div>
                  </li>

                  <li className="msg-item">
                    <div className="msg-body">
                      <div className="msg-head"><strong>Compliance form</strong> <span className="muted">flagged missing signature</span></div>
                      <div className="muted">08:40 AM</div>
                    </div>
                    <div className="tag"><span className="int-status-badge pending">Attention</span></div>
                  </li>
                </ul>
                <div style={{marginTop:12}}><a className="view-all">View All Activity Logs</a></div>
              </div>

              <div className="card tasks-card" style={{marginTop:18}}>
                <div className="card-row"><h3>Tasks & To-Do</h3>
                  <div style={{marginBottom: '10px', gap:'8px', display:'flex'}}>
                    <button className="btn small-cd">+ New Task</button>
                    <button className="btn ghost-cd small">Open Task Board</button>
                  </div>
                </div>
                <ul className="recent-list">
                  <li className="task-item"><strong>Review new carrier onboarding</strong><div className="muted">Assigned to: You</div><div className="task-due muted">Due: Today <span className="int-status-badge pending">Pending</span></div></li>
                  <li className="task-item"><strong>Verify driver logs</strong><div className="muted">Assigned to: Koshin A.</div><div className="task-due muted">Due: Tomorrow <span className="int-status-badge in-progress">In Progress</span></div></li>
                  <li className="task-item"><strong>Resolve support ticket #1044</strong><div className="muted">Assigned to: Amina Y.</div><div className="task-due muted">Due: Today <span className="int-status-badge resolved">Resolved</span></div></li>
                </ul>
              </div>
            </div>

            <aside>
              <div className="card notifications-card">
                <div className="card-row"><h3>Support Hub</h3></div>
                <ul className="notifications-list">
                  <li className="notification-item"><div className="note-left"></div><div className="note-body"><div className="note-title" >#1045 - Login Issues</div><div className="note-sub muted">2 hours ago</div></div><div className="note-time"><span className="int-status-badge revoked">High</span></div></li>
                  <li className="notification-item"><div className="note-left"></div><div className="note-body"><div className="note-title">#1046 - Document Upload</div><div className="note-sub muted">4 hours ago</div></div><div className="note-time"><span className="int-status-badge pending">Medium</span></div></li>
                  <li className="notification-item"><div className="note-left"></div><div className="note-body"><div className="note-title">#1047 - Profile Update</div><div className="note-sub muted">6 hours ago</div></div><div className="note-time"><span className="int-status-badge active">Low</span></div></li>
                </ul>
                <div style={{marginTop:12}}><button className="btn small-cd">View All Tickets</button></div>
              </div>

              <div className="card recent-messages" style={{marginTop:18}}>
                <div className="card-row"><h3>Recent Messages</h3></div>
                <ul className="recent-list">
                  {recentUnreadLoading && (
                    <li className="msg-item"><div className="msg-body"><div className="muted">Loading unread messages…</div></div></li>
                  )}
                  {!recentUnreadLoading && (recentUnreadThreads || []).length === 0 && (
                    <li className="msg-item"><div className="msg-body"><div className="muted">No unread chats.</div></div></li>
                  )}

                  {!recentUnreadLoading && (recentUnreadThreads || []).map((t) => {
                    const title = t?.display_title || t?.other_display_name || t?.title || 'Conversation';
                    const preview = t?.last_message?.text || t?.last_message?.message || t?.last_message?.content || 'Unread message';
                    return (
                      <li key={t?.id} className="msg-item">
                        <button
                          type="button"
                          onClick={() => {
                            setInitialThreadId(t?.id || null);
                            goToSection('messages');
                          }}
                          style={{ display: 'flex', gap: 10, width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}
                        >
                          <img className="msg-avatar" src={t?.other_photo_url || 'https://www.gravatar.com/avatar/?d=mp'} alt="avatar" />
                          <div className="msg-body">
                            <div className="msg-head"><strong>{title}</strong> <span className="muted">{String(preview).slice(0, 60)}</span></div>
                            <div className="muted">Unread</div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div style={{marginTop:12}}><a className="view-all">View All Messages</a></div>
              </div>
            </aside>
          </section>
            </>
          )}
          
        </main>
      </div>
    </div>
  );
}
