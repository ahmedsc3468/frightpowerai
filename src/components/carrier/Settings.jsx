import React, { useEffect, useState } from 'react';
import '../../styles/carrier/Settings.css';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';
import tzLookup from 'tz-lookup';

export default function Settings() {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('company-profile');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [loginFilter, setLoginFilter] = useState('Last Login');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [formData, setFormData] = useState({
    // Company Profile
    companyName: 'TransLogistics Inc.',
    phoneNumber: '(555) 123-4567',
    address: '1234 Freight Ave, Logistics City, TX 75001',
    email: 'contact@translogistics.com',
    
    // Federal Information
    dotNumber: '2847563',
    mcNumber: '928475',
    taxId: 'XX-XXXXXXX23',
    fmcsaSynced: true,
    
    // Banking Information
    bankName: 'First National Bank',
    routingNumber: '••••••••123',
    accountNumber: '••••••••••4567',
    accountType: 'Business Checking',
    
    // Contact Information
    dispatchContact: 'dispatch@translogistics.com',
    safetyContact: 'safety@translogistics.com',
    billingContact: 'billing@translogistics.com'
  });

  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);

  const normalizeNotificationPreferencesInAppOnly = (prefs) => {
    const p = (prefs && typeof prefs === 'object') ? prefs : {};
    const defaultToTrue = (value) => (value === false ? false : true);
    return {
      loads_in_app: defaultToTrue(p.loads_in_app),
      loads_email: false,
      loads_sms: false,
      compliance_in_app: defaultToTrue(p.compliance_in_app),
      compliance_email: false,
      compliance_sms: false,
      finance_in_app: defaultToTrue(p.finance_in_app),
      finance_email: false,
      finance_sms: false,
    };
  };

  const [preferences, setPreferences] = useState(() => {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem('fp_carrier_preferences') || '{}') || {};
    } catch {
      stored = {};
    }

    const storedTheme = (localStorage.getItem('fp_theme_preference') || '').trim().toLowerCase();
    const theme = storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'device' ? storedTheme : 'device';

    const defaultDocumentExportType = String(stored.defaultDocumentExportType || '').trim().toLowerCase();
    const normalizedExportType = defaultDocumentExportType === 'pdf' || defaultDocumentExportType === 'json' || defaultDocumentExportType === 'csv'
      ? defaultDocumentExportType
      : 'pdf';

    return {
      language: stored.language || 'English',
      dateFormat: stored.dateFormat || 'mdy', // mdy | dmy | ymd
      timeZone: stored.timeZone || '', // IANA time zone name
      currency: stored.currency || 'USD',

      notificationPreferences: normalizeNotificationPreferencesInAppOnly(stored.notificationPreferences),

      quietHoursStart: stored.quietHoursStart || '10:00 PM',
      quietHoursEnd: stored.quietHoursEnd || '7:00 AM',

      paymentTerms: stored.paymentTerms || 'Net 30',
      defaultInvoiceCurrency: stored.defaultInvoiceCurrency || (stored.currency || 'USD'),
      autoSendInvoices: Boolean(stored.autoSendInvoices),

      theme,
      defaultView: stored.defaultView || 'My Loads Default View',
      defaultDocumentExportType: normalizedExportType,
    };
  });

  const persistPreferences = (patch) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('fp_carrier_preferences', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const patchAuthSettings = async (update) => {
    if (!currentUser) return;
    try {
      setPrefsSaving(true);
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_URL}/auth/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(update || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || 'Failed to update preferences');
      return data;
    } finally {
      setPrefsSaving(false);
    }
  };

  const detectDeviceTimeZone = async () => {
    const fallback = () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        return '';
      }
    };

    if (!('geolocation' in navigator) || typeof navigator.geolocation?.getCurrentPosition !== 'function') {
      return fallback();
    }

    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          try {
            const tz = tzLookup(pos.coords.latitude, pos.coords.longitude);
            resolve(tz || fallback());
          } catch {
            resolve(fallback());
          }
        },
        () => resolve(fallback()),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
      );
    });
  };

  const applyThemePreference = (pref) => {
    const normalized = String(pref || '').trim().toLowerCase();
    const next = normalized === 'light' || normalized === 'dark' || normalized === 'device' ? normalized : 'device';
    try {
      localStorage.setItem('fp_theme_preference', next);
    } catch {
      // ignore
    }
    persistPreferences({ theme: next });
    window.dispatchEvent(new CustomEvent('fp-theme-preference', { detail: { preference: next } }));
  };

  useEffect(() => {
    const run = async () => {
      if (activeTab !== 'preferences' || !currentUser) return;

      try {
        setPrefsLoading(true);
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_URL}/auth/settings`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.detail || 'Failed to load preferences');

        persistPreferences({
          language: data?.language || 'English',
          dateFormat: data?.date_format || preferences.dateFormat || 'mdy',
          timeZone: data?.time_zone || preferences.timeZone || '',
          notificationPreferences:
            normalizeNotificationPreferencesInAppOnly(
              (typeof data?.notification_preferences === 'object' && data.notification_preferences)
                ? data.notification_preferences
                : preferences.notificationPreferences
            ),
        });

        const serverNotifs = (typeof data?.notification_preferences === 'object' && data.notification_preferences)
          ? data.notification_preferences
          : null;
        if (serverNotifs) {
          const normalized = normalizeNotificationPreferencesInAppOnly(serverNotifs);
          if (JSON.stringify(normalized) !== JSON.stringify(serverNotifs)) {
            try {
              await patchAuthSettings({ notification_preferences: normalized });
            } catch {
              // ignore
            }
          }
        }
      } catch (e) {
        setMessage({ type: 'error', text: e?.message || 'Failed to load preferences' });
      } finally {
        setPrefsLoading(false);
      }

      try {
        const tz = await detectDeviceTimeZone();
        if (tz && tz !== (preferences.timeZone || '')) {
          persistPreferences({ timeZone: tz });
          await patchAuthSettings({ time_zone: tz });
        }
      } catch {
        // ignore
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser]);

  useEffect(() => {
    const run = async () => {
      if (!currentUser) {
        setLoadingProfile(false);
        return;
      }
      try {
        setLoadingProfile(true);
        const token = await currentUser.getIdToken();
        const resp = await fetch(`${API_URL}/onboarding/data`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.detail || 'Failed to load profile');

        const d = data?.data || {};
        setFormData(prev => ({
          ...prev,
          companyName: d.companyName || prev.companyName || '',
          phoneNumber: d.phone || prev.phoneNumber || '',
          address: d.address || prev.address || '',
          email: d.email || prev.email || '',
          dotNumber: d.dotNumber || prev.dotNumber || '',
          mcNumber: d.mcNumber || prev.mcNumber || '',
        }));
      } catch (e) {
        console.error(e);
        setMessage({ type: 'error', text: e?.message || 'Failed to load profile' });
      } finally {
        setLoadingProfile(false);
      }
    };
    run();
  }, [currentUser]);

  // User Management Data
  const users = [
    {
      id: 1,
      name: 'John Smith',
      email: 'john.smith@translogistics.com',
      role: 'Owner',
      status: 'Active',
      lastLogin: '2 hours ago',
      avatar: 'JS'
    },
    {
      id: 2,
      name: 'Sarah Johnson',
      email: 'sarah.johnson@translogistics.com',
      role: 'Dispatcher',
      status: 'Active',
      lastLogin: '1 day ago',
      avatar: 'SJ'
    },
    {
      id: 3,
      name: 'Mike Chen',
      email: 'mike.chen@translogistics.com',
      role: 'Safety Manager',
      status: 'Inactive',
      lastLogin: '3 days ago',
      avatar: 'MC'
    },
    {
      id: 4,
      name: 'Lisa Torres',
      email: 'lisa.torres@translogistics.com',
      role: 'Accountant',
      status: 'Active',
      lastLogin: '5 days ago',
      avatar: 'LT'
    },
    {
      id: 5,
      name: 'David Wilson',
      email: 'david.wilson@translogistics.com',
      role: 'Fleet Mgr',
      status: 'Pending',
      lastLogin: '2 weeks ago',
      avatar: 'DW'
    }
  ];

  // Permissions Matrix Data
  const permissionModules = [
    {
      module: 'Dashboard',
      owner: true,
      dispatcher: true,
      driver: true,
      accountant: true,
      readOnly: true
    },
    {
      module: 'Loads Management',
      owner: true,
      dispatcher: true,
      driver: false,
      accountant: false,
      readOnly: false
    },
    {
      module: 'Fleet Management',
      owner: true,
      dispatcher: true,
      driver: false,
      accountant: false,
      readOnly: false
    },
    {
      module: 'Finance',
      owner: true,
      dispatcher: false,
      driver: false,
      accountant: true,
      readOnly: false
    },
    {
      module: 'Messaging',
      owner: true,
      dispatcher: true,
      driver: true,
      accountant: true,
      readOnly: true
    },
    {
      module: 'Reports',
      owner: true,
      dispatcher: true,
      driver: false,
      accountant: true,
      readOnly: true
    }
  ];

  // Recent Activity Data
  const recentActivity = [
    {
      id: 1,
      user: 'New user added',
      action: 'John Thompson was added as a Driver by John Smith',
      time: '2 minutes ago',
      icon: 'fa-solid fa-user-plus',
      color: 'green'
    },
    {
      id: 2,
      user: 'Role updated',
      action: 'Sarah Johnson\'s role changed from Driver to Dispatcher',
      time: '1 hour ago',
      icon: 'fa-solid fa-user-edit',
      color: 'blue'
    },
    {
      id: 3,
      user: 'Password reset',
      action: 'Mike Chen requested a new temporary company card',
      time: '3 hours ago',
      icon: 'fa-solid fa-key',
      color: 'orange'
    },
    {
      id: 4,
      user: 'User disabled',
      action: 'David Wilson was disabled due to inactivity',
      time: '1 day ago',
      icon: 'fa-solid fa-user-slash',
      color: 'red'
    }
  ];

  // Roles Data
  const roles = [
    { name: 'Fleet Owner', users: 2, color: 'red' },
    { name: 'Admin', users: 1, color: 'blue' },
    { name: 'Dispatcher', users: 5, color: 'purple' },
    { name: 'Driver', users: 3, color: 'green' },
    { name: 'Accountant', users: 2, color: 'yellow' },
    { name: 'Read-Only', users: 0, color: 'gray' },
    { name: 'Safety Officer', users: 2, color: 'orange' }
  ];

  // Operations Permissions
  const operationsPermissions = [
    { category: 'Operations', module: 'My Loads', view: true, create: true, edit: true, delete: true, export: true },
    { category: 'Operations', module: 'Document Vault', view: true, create: true, edit: true, delete: true, export: true },
    { category: 'Operations', module: 'Marketplace', view: true, create: true, edit: true, delete: false, export: true },
    { category: 'Finance', module: 'Factoring & Invoicing', view: true, create: true, edit: true, delete: true, export: true },
    { category: 'Management', module: 'Hiring & Onboarding', view: true, create: true, edit: true, delete: true, export: true },
    { category: 'Management', module: 'Compliance & Safety', view: true, create: true, edit: true, delete: false, export: true },
    { category: 'System', module: 'Settings', view: true, create: true, edit: true, delete: true, export: true }
  ];

  // API Keys Data
  const apiKeys = [
    { id: 1, name: 'Production API', key: '****-****-****-8a2d', scope: 'Load:RW', created: 'Jan 30, 2025', lastUsed: '2 hours ago', status: 'Active' },
    { id: 2, name: 'Development Key', key: '****-7c8c', scope: 'A/R', created: 'Dec 8, 2024', lastUsed: 'Never', status: 'Revoked' }
  ];

  // Webhooks Data
  const webhooks = [
    { id: 1, url: 'https://api.company.com/webhooks', events: 'load.created', deliveries: '47 / 50', lastAttempt: '5 min ago', status: 'Healthy' },
    { id: 2, url: 'https://staging-api.com/hook', events: 'invoice.paid', deliveries: '12 / 15', lastAttempt: '1 hour ago', status: 'Warning' }
  ];

  const tabs = [
    { key: 'company-profile', label: 'Company Profile', icon: 'fa-solid fa-building' },
    { key: 'user-management', label: 'User Management', icon: 'fa-solid fa-users' },
    { key: 'roles-permissions', label: 'Roles & Permissions', icon: 'fa-solid fa-shield-halved' },
    { key: 'security', label: 'Security', icon: 'fa-solid fa-lock' },
    { key: 'api-webhooks', label: 'API & Webhooks', icon: 'fa-solid fa-code' },
    { key: 'preferences', label: 'Preferences', icon: 'fa-solid fa-sliders' }
  ];

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveChanges = async () => {
    if (!currentUser) return;
    try {
      setSavingProfile(true);
      setMessage({ type: '', text: '' });
      const token = await currentUser.getIdToken();

      const payload = {
        companyName: formData.companyName,
        dotNumber: formData.dotNumber,
        mcNumber: formData.mcNumber,
        phone: formData.phoneNumber,
        address: formData.address,
      };

      const resp = await fetch(`${API_URL}/onboarding/update-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.detail || 'Failed to save changes');

      setMessage({ type: 'success', text: 'Company profile saved successfully.' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);

      // Re-load canonical data so all fields are in sync
      setLoadingProfile(true);
      const refetch = await fetch(`${API_URL}/onboarding/data`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const refetchData = await refetch.json().catch(() => ({}));
      if (refetch.ok) {
        const d = refetchData?.data || {};
        setFormData(prev => ({
          ...prev,
          companyName: d.companyName || prev.companyName || '',
          phoneNumber: d.phone || prev.phoneNumber || '',
          address: d.address || prev.address || '',
          email: d.email || prev.email || '',
          dotNumber: d.dotNumber || prev.dotNumber || '',
          mcNumber: d.mcNumber || prev.mcNumber || '',
        }));
      }
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: e?.message || 'Failed to save changes' });
    } finally {
      setSavingProfile(false);
      setLoadingProfile(false);
    }
  };

  const handleUploadLogo = () => {
    console.log('Upload logo functionality');
    // Implementation for logo upload
  };

  const renderComingSoonPanel = (content) => (
    <div className="tab-panel settings-coming-soon" aria-disabled="true">
      <div className="settings-coming-soon__content">{content}</div>
      <div className="settings-coming-soon__overlay">
        <div className="settings-coming-soon__label">COMING SOON</div>
      </div>
    </div>
  );

  return (
    <div className="settings-container">
      <header className="settings-header">
        <div className="settings-title-section">
          <h1>Settings</h1>
          <p>Manage your company profile, users, permissions, and system preferences</p>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="marketplace-nav">
        <div className="marketplace-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`marketplace-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="settings-content">
        {activeTab === 'company-profile' && (
          <div className="tab-panel">
            {message.text && (
              <div
                className={`profile-message ${message.type}`}
                style={{
                  padding: '12px 16px',
                  marginBottom: '14px',
                  borderRadius: '8px',
                  backgroundColor: message.type === 'success' ? '#d1fae5' : '#fee2e2',
                  color: message.type === 'success' ? '#065f46' : '#991b1b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <i
                  className={`fa-solid ${
                    message.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'
                  }`}
                ></i>
                {message.text}
              </div>
            )}

            {loadingProfile ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 220 }}>
                <i className="fas fa-spinner fa-spin" style={{ fontSize: '1.6rem', color: '#3b82f6' }}></i>
                <span style={{ marginLeft: 10 }}>Loading company profile...</span>
              </div>
            ) : (
              <>
              <div className="settings-grid">
                {/* Left Column */}
                <div className="settings-left-column">
                {/* Basic Information */}
                <div className="settings-section">
                  <h3 className="section-title">Basic Information</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Company Name</label>
                      <input
                        type="text"
                        value={formData.companyName}
                        onChange={(e) => handleInputChange('companyName', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone Number</label>
                      <input
                        type="text"
                        value={formData.phoneNumber}
                        onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                      />
                    </div>
                    <div className="form-group full-width">
                      <label>Address</label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => handleInputChange('address', e.target.value)}
                      />
                    </div>
                    <div className="form-group full-width">
                      <label>Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Federal Information */}
                <div className="settings-section">
                  <h3 className="section-title">Federal Information</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>DOT Number</label>
                      <input
                        type="text"
                        value={formData.dotNumber}
                        onChange={(e) => handleInputChange('dotNumber', e.target.value)}
                      />
                      <span className="form-help">Synced from FMCSA</span>
                    </div>
                    <div className="form-group">
                      <label>MC Number</label>
                      <input
                        type="text"
                        value={formData.mcNumber}
                        onChange={(e) => handleInputChange('mcNumber', e.target.value)}
                      />
                      <span className="form-help">Synced from FMCSA</span>
                    </div>
                    <div className="form-group">
                      <label>Tax ID (EIN)</label>
                      <input
                        type="text"
                        value={formData.taxId}
                        onChange={(e) => handleInputChange('taxId', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Banking Information */}
                <div className="settings-section">
                  <h3 className="section-title">Banking Information</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Bank Name</label>
                      <input
                        type="text"
                        value={formData.bankName}
                        onChange={(e) => handleInputChange('bankName', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Routing Number</label>
                      <input
                        type="text"
                        value={formData.routingNumber}
                        onChange={(e) => handleInputChange('routingNumber', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Account Number</label>
                      <input
                        type="text"
                        value={formData.accountNumber}
                        onChange={(e) => handleInputChange('accountNumber', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Account Type</label>
                      <select
                        value={formData.accountType}
                        onChange={(e) => handleInputChange('accountType', e.target.value)}
                      >
                        <option value="Business Checking">Business Checking</option>
                        <option value="Business Savings">Business Savings</option>
                        <option value="Personal Checking">Personal Checking</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="settings-right-column">
                {/* Company Logo */}
                <div className="settings-section">
                  <h3 className="section-title">Company Logo</h3>
                  <div className="logo-upload-section">
                    <div className="logo-preview">
                      <i className="fa-solid fa-building logo-placeholder"></i>
                    </div>
                    <button className="btn small ghost-cd" onClick={handleUploadLogo}>
                      Upload Logo
                    </button>
                    <p className="upload-help">PNG, JPG up to 5MB</p>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="settings-section">
                  <h3 className="section-title">Contact Information</h3>
                  <div className="contact-info">
                    <div className="contact-item">
                      <label>Dispatch Contact</label>
                      <input
                        type="email"
                        value={formData.dispatchContact}
                        onChange={(e) => handleInputChange('dispatchContact', e.target.value)}
                      />
                    </div>
                    <div className="contact-item">
                      <label>Safety Contact</label>
                      <input
                        type="email"
                        value={formData.safetyContact}
                        onChange={(e) => handleInputChange('safetyContact', e.target.value)}
                      />
                    </div>
                    <div className="contact-item">
                      <label>Billing Contact</label>
                      <input
                        type="email"
                        value={formData.billingContact}
                        onChange={(e) => handleInputChange('billingContact', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
              </div>

            {/* Save Button */}
            <div className="settings-actions">
              <button className="btn small-cd" onClick={handleSaveChanges} disabled={savingProfile}>
                {savingProfile ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
              </>
            )}
          </div>
        )}

        {/* Roles & Permissions Tab */}
        {activeTab === 'roles-permissions' && renderComingSoonPanel(
          <>
            <div className="roles-header">
              <div className="roles-actions">
                <button className="btn small ghost-cd">
                  <i className="fa-solid fa-download"></i>
                  Export Roles
                </button>
                <button className="btn small-cd">
                  <i className="fa-solid fa-plus"></i>
                  Create Role
                </button>
              </div>
            </div>

            {/* Roles List */}
            <div className="roles-section">
              <h3>Roles</h3>
              <div className="roles-grid">
                {roles.map((role, index) => (
                  <div key={index} className="role-item">
                    <div className="role-info">
                      <div className="role-details">
                        <div className="role-name">{role.name}</div>
                        <div className="role-users">{role.users} users</div>
                      </div>
                    </div>
                    <button className="role-action">
                      <i className="fa-solid fa-ellipsis-h"></i>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Admin Role Section */}
            <div className="admin-role-section">
              <div className="admin-role-header">
                <h3>Admin Role</h3>
                <p>Assign users to the various operations and permissions</p>
              </div>
              
              <div className="admin-role-selector">
                <label>Admin Role</label>
                <select defaultValue="Fleet Owner + Manage Users">
                  <option>Fleet Owner + Manage Users</option>
                  <option>Admin</option>
                  <option>Super Admin</option>
                </select>
              </div>

              {/* Operations Permissions Table */}
              <div className="st-operations-table">
                <div className="st-operations-table-wrapper">
                  <div className="st-operations-table-inner">
                    <div className="st-table-header">
                  <div className="st-module-header">MODULE</div>
                  <div className="st-permission-header">
                    <span>VIEW</span>
                  </div>
                  <div className="st-permission-header">
                    <span>CREATE</span>
                  </div>
                  <div className="st-permission-header">
                    <span>EDIT</span>
                  </div>
                  <div className="st-permission-header">
                    <span>DELETE</span>
                  </div>
                  <div className="st-permission-header">
                    <span>EXPORT</span>
                  </div>
                </div>

                {(() => {
                  const categories = [...new Set(operationsPermissions.map(op => op.category))];
                  let rows = [];
                  
                  categories.forEach(category => {
                    // Add category header
                    rows.push(
                      <div key={`${category}-header`} className="st-category-row">
                        <div className="st-category-cell">{category}</div>
                        <div className="st-category-spacer"></div>
                        <div className="st-category-spacer"></div>
                        <div className="st-category-spacer"></div>
                        <div className="st-category-spacer"></div>
                        <div className="st-category-spacer"></div>
                      </div>
                    );
                    
                    // Add module rows for this category
                    operationsPermissions
                      .filter(op => op.category === category)
                      .forEach((operation, index) => {
                        rows.push(
                          <div key={`${category}-${index}`} className="st-table-row">
                            <div className="st-module-cell">
                              <span className="st-module-indent">{operation.module}</span>
                            </div>
                            <div className="st-permission-cell">
                              <input
                                type="checkbox"
                                checked={operation.view}
                                readOnly
                                className="st-permission-checkbox"
                              />
                            </div>
                            <div className="st-permission-cell">
                              <input
                                type="checkbox"
                                checked={operation.create}
                                readOnly
                                className="st-permission-checkbox"
                              />
                            </div>
                            <div className="st-permission-cell">
                              <input
                                type="checkbox"
                                checked={operation.edit}
                                readOnly
                                className="st-permission-checkbox"
                              />
                            </div>
                            <div className="st-permission-cell">
                              <input
                                type="checkbox"
                                checked={operation.delete}
                                readOnly
                                className="st-permission-checkbox"
                              />
                            </div>
                            <div className="st-permission-cell">
                              <input
                                type="checkbox"
                                checked={operation.export}
                                readOnly
                                className="st-permission-checkbox"
                              />
                            </div>
                          </div>
                        );
                      });
                  });
                  
                  return rows;
                })()}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* User Management Tab */}
        {activeTab === 'user-management' && renderComingSoonPanel(
          <>
            {/* User Statistics */}
            <div className="user-stats">
              <div className="stat-item">
                <div className="stat-number">24</div>
                <div className="stat-label">Active Users</div>
              </div>
              <div className="stat-item">
                <div className="stat-number">18</div>
                <div className="stat-label">Pending Invites</div>
              </div>
              <div className="stat-item">
                <div className="stat-number">3</div>
                <div className="stat-label">Inactive Users</div>
              </div>
              <div className="stat-item">
                <div className="stat-number">3</div>
                <div className="stat-label">Last Login</div>
              </div>
            </div>

            {/* User List Section */}
            <div className="user-list-section">
              <div className="section-header">
                <h3>Users</h3>
                <button className="btn small-cd">
                  <i className="fa-solid fa-plus"></i>
                  New Contact
                </button>
              </div>

              {/* Filters */}
              <div className="user-filters">
                <div className="search-box">
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                  />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="filter-select">
                  <option value="All Status">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Pending">Pending</option>
                </select>
                <select value={loginFilter} onChange={(e) => setLoginFilter(e.target.value)} className="filter-select">
                  <option value="Last Login">Last Login</option>
                  <option value="Recently Active">Recently Active</option>
                  <option value="Long Time">Long Time</option>
                </select>
              </div>

              {/* User Table */}
              <div className="users-table-container">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>USER</th>
                      <th>ROLE</th>
                      <th>STATUS</th>
                      <th>LAST LOGIN</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => (
                      <tr key={user.id}>
                        <td>
                          <div className="user-info">
                            <div className="user-avatar">{user.avatar}</div>
                            <div className="user-details">
                              <div className="user-name">{user.name}</div>
                              <div className="user-email">{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`role-badge ${user.role.toLowerCase().replace(' ', '-')}`}>
                            {user.role}
                          </span>
                        </td>
                        <td>
                          <span className={`int-status-badge ${user.status.toLowerCase()}`}>
                            {user.status}
                          </span>
                        </td>
                        <td className="last-login">{user.lastLogin}</td>
                        <td>
                          <div className="user-actions">
                            <button className="action-btn edit">
                              <i className="fa-solid fa-edit"></i>
                            </button>
                            <button className="action-btn delete">
                              <i className="fa-solid fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-pagination">
                <div className="pagination-info">Showing 1 to 5 of 24 entries</div>
                <div className="pagination-controls">
                  <button className="pagination-btn">1</button>
                  <button className="pagination-btn">2</button>
                  <button className="pagination-btn">3</button>
                </div>
              </div>
            </div>

            {/* Permissions Matrix */}
            <div className="permissions-section">
              <div className="section-header">
                <h3>Role & Permissions Matrix</h3>
                <p>Configure permissions for each user across different modules</p>
              </div>

              <div className="permissions-matrix">
                <div className="permissions-matrix-wrapper">
                  <div className="permissions-matrix-inner">
                    <div className="matrix-header">
                  <div className="module-col">Module / Role</div>
                  <div className="role-col">Owner</div>
                  <div className="role-col">Dispatcher</div>
                  <div className="role-col">Driver</div>
                  <div className="role-col">Accountant</div>
                  <div className="role-col">Read-Only</div>
                </div>
                
                {permissionModules.map((module, index) => (
                  <div key={index} className="matrix-row">
                    <div className="module-name">{module.module}</div>
                    <div className="permission-cell">
                      <div className={`permission-toggle ${module.owner ? 'enabled' : 'disabled'}`}>
                        <i className="fa-solid fa-check"></i>
                      </div>
                    </div>
                    <div className="permission-cell">
                      <div className={`permission-toggle ${module.dispatcher ? 'enabled' : 'disabled'}`}>
                        <i className="fa-solid fa-check"></i>
                      </div>
                    </div>
                    <div className="permission-cell">
                      <div className={`permission-toggle ${module.driver ? 'enabled' : 'disabled'}`}>
                        <i className="fa-solid fa-check"></i>
                      </div>
                    </div>
                    <div className="permission-cell">
                      <div className={`permission-toggle ${module.accountant ? 'enabled' : 'disabled'}`}>
                        <i className="fa-solid fa-check"></i>
                      </div>
                    </div>
                    <div className="permission-cell">
                      <div className={`permission-toggle ${module.readOnly ? 'enabled' : 'disabled'}`}>
                        <i className="fa-solid fa-check"></i>
                      </div>
                    </div>
                  </div>
                ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Security Settings */}
            <div className="security-section">
              <div className="security-header">
                <h3>Security Settings</h3>
                <p>Configure security policies and authentication settings</p>
              </div>
              
              <div className="security-settings-container">
                <div className="security-settings-left">
                  {/* Multi-Factor Authentication */}
                  <div className="security-card">
                    <h4>Multi-Factor Authentication</h4>
                    
                    <div className="security-option">
                      <div className="option-content">
                        <span className="option-title">Require MFA for Admins</span>
                        <span className="option-subtitle">All admin users must use MFA</span>
                      </div>
                      <div className="toggle-wrapper">
                        <input type="checkbox" id="admin-mfa-toggle" defaultChecked />
                        <label htmlFor="admin-mfa-toggle" className="security-toggle"></label>
                      </div>
                    </div>

                    <div className="security-option">
                      <div className="option-content">
                        <span className="option-title">Optional MFA for Others</span>
                        <span className="option-subtitle">Allow other users to enable MFA</span>
                      </div>
                      <div className="toggle-wrapper">
                        <input type="checkbox" id="optional-mfa-toggle" defaultChecked />
                        <label htmlFor="optional-mfa-toggle" className="security-toggle"></label>
                      </div>
                    </div>
                  </div>

                  {/* Login Alerts */}
                  <div className="security-card">
                    <h4>Login Alerts</h4>
                    
                    <div className="security-option">
                      <div className="option-content">
                        <span className="option-title">Email Notifications</span>
                        <span className="option-subtitle">Send email for new login attempts</span>
                      </div>
                      <div className="toggle-wrapper">
                        <input type="checkbox" id="email-notifications-toggle" defaultChecked />
                        <label htmlFor="email-notifications-toggle" className="security-toggle"></label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="security-settings-right">
                  {/* Session Management */}
                  <div className="security-card">
                    <h4>Session Management</h4>
                    
                    <div className="security-dropdown-option">
                      <label>Session Timeout (minutes)</label>
                      <select className="security-select" defaultValue="120">
                        <option value="30">30</option>
                        <option value="60">60</option>
                        <option value="120">120</option>
                        <option value="240">240</option>
                      </select>
                    </div>

                    <div className="security-dropdown-option">
                      <label>Maximum Concurrent Sessions</label>
                      <select className="security-select" defaultValue="3">
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="5">5</option>
                        <option value="unlimited">Unlimited</option>
                      </select>
                    </div>
                  </div>

                  {/* Password Policy */}
                  <div className="security-card">
                    <h4>Password Policy</h4>
                    
                    <div className="security-option">
                      <div className="option-content">
                        <span className="option-title">Force Strong Passwords</span>
                        <span className="option-subtitle">Require 8+ chars, numbers, symbols</span>
                      </div>
                      <div className="toggle-wrapper">
                        <input type="checkbox" id="strong-password-toggle" defaultChecked />
                        <label htmlFor="strong-password-toggle" className="security-toggle"></label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent User Activity */}
            <div className="recent-activity-section">
              <div className="section-header">
                <div>
                    <h3>Recent User Activity</h3>
                <p>Latest user management and security login activity</p>
                </div>
                <button className="view-all-btn">View All</button>
              </div>

              <div className="activity-list">
                {recentActivity.map(activity => (
                  <div key={activity.id} className="activity-item">
                    <div className={`activity-icon`}>
                      <i className={activity.icon}></i>
                    </div>
                    <div className="activity-content">
                      <div className="activity-title">{activity.user}</div>
                      <div className="activity-description">{activity.action}</div>
                    </div>
                    <div className="activity-time">{activity.time}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Security Settings Tab */}
        {activeTab === 'security' && renderComingSoonPanel(
          <>

            {/* Authentication Settings */}
            <div className="security-section">
              <div className="auth-container">
                <div className="auth-settings-main">
                  <div className="section-header">
                    <h3>
                      <i className="fa-solid fa-user-shield"></i>
                      Authentication Settings
                    </h3>
                  </div>

                  <div className="auth-settings-content">
                    <div className="mfa-section">
                      <h4>Multi-Factor Authentication (MFA)</h4>
                      
                      <div className="mfa-requirement">
                        <label>MFA Requirement</label>
                        <select defaultValue="Required for All Users">
                          <option>Required for All Users</option>
                          <option>Required for Admins</option>
                          <option>Optional</option>
                          <option>Disabled</option>
                        </select>
                      </div>

                      <div className="auth-methods">
                        <label className="section-label">Available Methods</label>
                        <div className="method-list">
                          <label className="checkbox-label">
                            <input type="checkbox" defaultChecked />
                            SMS
                          </label>
                          <label className="checkbox-label">
                            <input type="checkbox" defaultChecked />
                            Authenticator App
                          </label>
                          <label className="checkbox-label">
                            <input type="checkbox" />
                            Email OTP
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="biometric-section">
                      <h4>Biometric Login (Mobile App)</h4>
                      <div className="biometric-options">
                        <label className="checkbox-label">
                          <input type="checkbox" defaultChecked />
                          Allow Face ID
                        </label>
                        <label className="checkbox-label">
                          <input type="checkbox" defaultChecked />
                          Allow Fingerprint
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="audit-trail-panel">
                  <div className="audit-header">
                    <h4>
                      <i className="fa-solid fa-file-lines"></i>
                      Security Audit Trail
                    </h4>
                    <button className="export-btn-small">Export</button>
                  </div>

                  <div className="audit-list">
                    <div className="audit-item">
                      <div className="audit-dot"></div>
                      <div className="audit-content">
                        <div className="audit-title">MFA enabled for all users</div>
                        <div className="audit-time">2 hours ago</div>
                      </div>
                    </div>

                    <div className="audit-item">
                      <div className="audit-dot"></div>
                      <div className="audit-content">
                        <div className="audit-title">Password reset for John Doe</div>
                        <div className="audit-time">1 day ago</div>
                      </div>
                    </div>

                    <div className="audit-item">
                      <div className="audit-dot"></div>
                      <div className="audit-content">
                        <div className="audit-title">Login blocked from unknown IP</div>
                        <div className="audit-time">2 days ago</div>
                      </div>
                    </div>

                    <div className="audit-item">
                      <div className="audit-dot"></div>
                      <div className="audit-content">
                        <div className="audit-title">Session timeout updated</div>
                        <div className="audit-time">3 days ago</div>
                      </div>
                    </div>

                    <div className="audit-item">
                      <div className="audit-dot"></div>
                      <div className="audit-content">
                        <div className="audit-title">Device registered for Sarah Wilson</div>
                        <div className="audit-time">1 week ago</div>
                      </div>
                    </div>
                  </div>

                  <div className="view-all-events">
                    <button className="view-all-btn">View All Events</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Password Policy */}
            <div className="security-section">
              <h3>Password Policy</h3>
              
              <div className="password-settings">
                <div className="password-row">
                  <label>Minimum Length</label>
                  <select defaultValue="8">
                    <option>6</option>
                    <option>8</option>
                    <option>10</option>
                    <option>12</option>
                  </select>
                </div>

                <div className="password-row">
                  <label>Expiration Period</label>
                  <select defaultValue="90 days">
                    <option>30 days</option>
                    <option>60 days</option>
                    <option>90 days</option>
                    <option>Never</option>
                  </select>
                </div>

                <div className="password-requirements">
                  <label className="checkbox-label">
                    <input type="checkbox" defaultChecked />
                    Require special characters
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" defaultChecked />
                    Require uppercase and lowercase letters
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" />
                    Prevent password reuse (last 5 passwords)
                  </label>
                </div>
              </div>
            </div>

            {/* Login & Access Controls */}
            <div className="security-section">
              <h3>Login & Access Controls</h3>
              
              <div className="access-controls">
                <div className="control-row">
                  <div className="control-info">
                    <label>Login Alerts</label>
                  </div>
                  <div className="toggle-switch">
                    <input type="checkbox" id="loginAlerts" defaultChecked />
                    <label htmlFor="loginAlerts" className="security-toggle"></label>
                  </div>
                </div>

                <div className="device-management">
                  <h4>Device Management</h4>
                  <div className="device-list">
                    <div className="device-item">
                      <div className="device-info">
                        <i className="fa-solid fa-desktop"></i>
                        <div>
                          <span className="device-name">Chrome on Windows</span>
                          <span className="device-details">Currently Active • Trust signed</span>
                        </div>
                      </div>
                      <button className="device-action-btn">Block</button>
                    </div>
                    
                    <div className="device-item">
                      <div className="device-info">
                        <i className="fa-solid fa-mobile"></i>
                        <div>
                          <span className="device-name">Mobile App - iPhone</span>
                          <span className="device-details">Currently • Trust signed</span>
                        </div>
                      </div>
                      <button className="device-action-btn">Block</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* IP Allowlist */}
            <div className="security-section">
              <h3>IP Allowlist</h3>
              <div className="ip-allowlist">
                <div className="ip-input-row">
                  <input 
                    type="text" 
                    placeholder="Enter IP address or range (eg. 192.168.1.0/24)" 
                    className="ip-input"
                  />
                  <button className="btn small-cd">Add</button>
                </div>
                <p className="ip-note">View All Entry</p>
              </div>
            </div>

            {/* Session Management */}
            <div className="security-section">
              <h3>Session Management</h3>
              
              <div className="session-settings">
                <div className="session-row">
                  <label>Session Timeout</label>
                  <select defaultValue="1 hour">
                    <option>15 minutes</option>
                    <option>30 minutes</option>
                    <option>1 hour</option>
                    <option>4 hours</option>
                    <option>8 hours</option>
                  </select>
                </div>

                <div className="session-row">
                  <label>Concurrent Sessions</label>
                  <select defaultValue="Allow multiple devices">
                    <option>Allow multiple devices</option>
                    <option>Single device only</option>
                  </select>
                </div>

                <div className="force-logout">
                  <button className="force-logout-btn">
                    <i className="fa-solid fa-power-off"></i>
                    Logout selected Devices
                  </button>
                </div>
              </div>
            </div>

            <div className="security-footer">
              <button className="btn small ghost-cd">Cancel</button>
              <button className="btn small-cd">Save Changes</button>
            </div>
          </>
        )}

        {/* API & Webhooks Tab */}
        {activeTab === 'api-webhooks' && renderComingSoonPanel(
          <>

            {/* API Keys Section */}
            <div className="api-section">
              <div className="section-header">
                <h3>API Keys</h3>
                <button className="btn small-cd">
                  <i className="fa-solid fa-plus"></i>
                  New API
                </button>
              </div>

              <div className="api-table-container">
                <table className="api-table">
                  <thead>
                    <tr>
                      <th>KEY NAME</th>
                      <th>LAST 4</th>
                      <th>SCOPE</th>
                      <th>CREATED</th>
                      <th>LAST USED</th>
                      <th>STATUS</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map(key => (
                      <tr key={key.id}>
                        <td>{key.name}</td>
                        <td><code>{key.key}</code></td>
                        <td><span className="scope-badge">{key.scope}</span></td>
                        <td>{key.created}</td>
                        <td>{key.lastUsed}</td>
                        <td>
                          <span className={`int-status-badge ${key.status.toLowerCase()}`}>
                            {key.status}
                          </span>
                        </td>
                        <td>
                          <div className="api-actions">
                            <button className="action-icon"><i className="fa-solid fa-eye"></i></button>
                            <button className="action-icon"><i className="fa-solid fa-copy"></i></button>
                            <button className="action-icon"><i className="fa-solid fa-edit"></i></button>
                            <button className="action-icon"><i className="fa-solid fa-trash"></i></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Webhooks Section */}
            <div className="webhooks-section">
              <div className="section-header">
                <h3>Webhooks</h3>
                <button className="btn small-cd">
                  <i className="fa-solid fa-plus"></i>
                  New Webhook
                </button>
              </div>

              <div className="webhook-table-container">
                <table className="webhook-table">
                  <thead>
                    <tr>
                      <th>ENDPOINT URL</th>
                      <th>EVENTS</th>
                      <th>DELIVERIES (24H)</th>
                      <th>LAST ATTEMPT</th>
                      <th>STATUS</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map(webhook => (
                      <tr key={webhook.id}>
                        <td><code>{webhook.url}</code></td>
                        <td><span className="event-badge">{webhook.events}</span></td>
                        <td>{webhook.deliveries}</td>
                        <td>{webhook.lastAttempt}</td>
                        <td>
                          <span className={`int-status-badge ${webhook.status.toLowerCase()}`}>
                            {webhook.status}
                          </span>
                        </td>
                        <td>
                          <div className="webhook-actions">
                            <button className="action-icon"><i className="fa-solid fa-eye"></i></button>
                            <button className="action-icon"><i className="fa-solid fa-edit"></i></button>
                            <button className="action-icon"><i className="fa-solid fa-trash"></i></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Test Console */}
            <div className="test-console-section">
              <h3>Test Console</h3>
              <div className="test-console">
                <div className="console-form">
                  <div className="form-group">
                    <label>Event Type</label>
                    <select defaultValue="load.created">
                      <option>load.created</option>
                      <option>invoice.paid</option>
                      <option>driver.assigned</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Webhook Endpoint</label>
                    <select defaultValue="https://api.company.com/webhooks">
                      <option>https://api.company.com/webhooks</option>
                      <option>https://staging-api.com/hook</option>
                    </select>
                  </div>
                  <button className="btn small-cd">
                    <i className="fa-solid fa-paper-plane"></i>
                    Send Test Event
                  </button>
                </div>
                <div className="console-response">
                  <label>Last Response</label>
                  <div className="response-box">
                    <code>200 OK - 142ms</code>
                  </div>
                </div>
              </div>
            </div>

            {/* Security & Policies */}
            <div className="security-policies-section">
              <h3>Security & Policies</h3>
              <div className="policies-grid">
                <div className="policy-item">
                  <label>Signing Algorithm</label>
                  <span className="policy-value">HMAC-SHA256</span>
                </div>
                <div className="policy-item">
                  <label>Registry Protection</label>
                  <span className="policy-value">5-minute window</span>
                </div>
                <div className="policy-item">
                  <label>TLS Requirement</label>
                  <span className="policy-value">HTTPS Only</span>
                </div>
                <div className="policy-item">
                  <label>Rate Limit</label>
                  <span className="policy-value">500 req/min</span>
                </div>
                <div className="policy-item">
                  <label>Audit Logging</label>
                  <span className="policy-value">Enabled</span>
                </div>
                <div className="policy-item">
                  <label>PII Redaction</label>
                  <span className="policy-value">Active</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Preferences Tab */}
        {activeTab === 'preferences' && (
          <div className="tab-panel">

            {/* Language & Localization */}
            <div className="preferences-card">
              <h3> Language & Localization</h3>
              <p>Configure language and localization settings</p>
              
              <div className="locale-setting">
                <div className="locale-row">
                  <div className="locale-label">
                    <label>Default Language</label>
                  </div>
                  <div className="locale-select">
                    <select
                      value={preferences.language}
                      disabled={prefsLoading || prefsSaving}
                      onChange={async (e) => {
                        const value = e.target.value;
                        persistPreferences({ language: value });
                        try {
                          await patchAuthSettings({ language: value });
                        } catch (err) {
                          setMessage({ type: 'error', text: err?.message || 'Failed to update language' });
                        }
                      }}
                    >
                      <option value="English">English</option>
                      <option value="Spanish">Spanish</option>
                      <option value="French">French</option>
                    </select>
                  </div>
                </div>

                <div className="locale-row">
                  <div className="locale-label">
                    <label>Date Format</label>
                  </div>
                  <div className="locale-select">
                    <select
                      value={preferences.dateFormat}
                      disabled={prefsLoading || prefsSaving}
                      onChange={async (e) => {
                        const value = e.target.value;
                        persistPreferences({ dateFormat: value });
                        try {
                          await patchAuthSettings({ date_format: value });
                        } catch (err) {
                          setMessage({ type: 'error', text: err?.message || 'Failed to update date format' });
                        }
                      }}
                    >
                      <option value="mdy">MM/DD/YYYY</option>
                      <option value="dmy">DD/MM/YYYY</option>
                      <option value="ymd">YYYY-MM-DD</option>
                    </select>
                  </div>
                </div>

                <div className="locale-row">
                  <div className="locale-label">
                    <label>Time Zone</label>
                  </div>
                  <div className="locale-select">
                    <select value={preferences.timeZone || ''} disabled>
                      <option value={preferences.timeZone || ''}>
                        {preferences.timeZone || (prefsLoading ? 'Detecting…' : '—')}
                      </option>
                    </select>
                  </div>
                </div>

                <div className="locale-row">
                  <div className="locale-label">
                    <label>Currency</label>
                  </div>
                  <div className="locale-select">
                    <select
                      value={preferences.currency}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => {
                        const value = e.target.value;
                        persistPreferences({ currency: value, defaultInvoiceCurrency: value });
                      }}
                    >
                      <option value="USD">USD</option>
                      <option value="CAD">CAD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Notification Defaults */}
            <div className="preferences-card">
              <h3> Notification Defaults</h3>
              <p>Configure default notification preferences</p>
              
              <div className="notification-table">
                <div className="notification-table-wrapper">
                  <div className="notification-table-inner">
                    <div className="notification-header">
                      <div className="category-header">Category</div>
                      <div className="channel-header">In-App</div>
                      <div className="channel-header">Email</div>
                      <div className="channel-header">SMS</div>
                    </div>

                    <div className="notification-row">
                      <div className="category-name">Loads</div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.loads_in_app)}
                          disabled={prefsLoading || prefsSaving}
                          onChange={async (e) => {
                              const next = normalizeNotificationPreferencesInAppOnly({
                                ...(preferences.notificationPreferences || {}),
                                loads_in_app: e.target.checked,
                              });
                            persistPreferences({ notificationPreferences: next });
                            try {
                              await patchAuthSettings({ notification_preferences: next });
                            } catch (err) {
                              setMessage({ type: 'error', text: err?.message || 'Failed to update notification preferences' });
                            }
                          }}
                        />
                      </div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.loads_email)}
                          disabled
                          onChange={() => {}}
                        />
                      </div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.loads_sms)}
                          disabled
                          onChange={() => {}}
                        />
                      </div>
                    </div>

                    <div className="notification-row">
                      <div className="category-name">Compliance</div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.compliance_in_app)}
                          disabled={prefsLoading || prefsSaving}
                          onChange={async (e) => {
                              const next = normalizeNotificationPreferencesInAppOnly({
                                ...(preferences.notificationPreferences || {}),
                                compliance_in_app: e.target.checked,
                              });
                            persistPreferences({ notificationPreferences: next });
                            try {
                              await patchAuthSettings({ notification_preferences: next });
                            } catch (err) {
                              setMessage({ type: 'error', text: err?.message || 'Failed to update notification preferences' });
                            }
                          }}
                        />
                      </div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.compliance_email)}
                          disabled
                          onChange={() => {}}
                        />
                      </div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.compliance_sms)}
                          disabled
                          onChange={() => {}}
                        />
                      </div>
                    </div>

                    <div className="notification-row">
                      <div className="category-name">Finance</div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.finance_in_app)}
                          disabled={prefsLoading || prefsSaving}
                          onChange={async (e) => {
                              const next = normalizeNotificationPreferencesInAppOnly({
                                ...(preferences.notificationPreferences || {}),
                                finance_in_app: e.target.checked,
                              });
                            persistPreferences({ notificationPreferences: next });
                            try {
                              await patchAuthSettings({ notification_preferences: next });
                            } catch (err) {
                              setMessage({ type: 'error', text: err?.message || 'Failed to update notification preferences' });
                            }
                          }}
                        />
                      </div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.finance_email)}
                          disabled
                          onChange={() => {}}
                        />
                      </div>
                      <div className="channel-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(preferences.notificationPreferences?.finance_sms)}
                          disabled
                          onChange={() => {}}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="quiet-hours">
                <div className="quiet-hours-header">
                  <span>Quiet Hours</span>
                </div>
                <div className="quiet-hours-content">
                  <span>No notifications during these hours</span>
                  <div className="time-selectors">
                    <select
                      value={preferences.quietHoursStart}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => persistPreferences({ quietHoursStart: e.target.value })}
                    >
                      <option>9:00 PM</option>
                      <option>10:00 PM</option>
                      <option>11:00 PM</option>
                    </select>
                    <span>to</span>
                    <select
                      value={preferences.quietHoursEnd}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => persistPreferences({ quietHoursEnd: e.target.value })}
                    >
                      <option>6:00 AM</option>
                      <option>7:00 AM</option>
                      <option>8:00 AM</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Invoice & Finance Settings */}
            <div className="preferences-card">
              <h3>Invoice & Finance Settings</h3>
              <p>Configure default invoice and payment settings</p>
              
              <div className="finance-grid">
                <div className="finance-row">
                  <div className="finance-label">
                    <label>Invoice Prefix</label>
                  </div>
                  <div className="finance-input">
                    <input type="text" value="INV{LOAD_ID}" readOnly disabled />
                  </div>
                </div>

                <div className="finance-row">
                  <div className="finance-label">
                    <label>Payment Terms</label>
                  </div>
                  <div className="finance-select">
                    <select
                      value={preferences.paymentTerms}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => persistPreferences({ paymentTerms: e.target.value })}
                    >
                      <option value="Net 15">Net 15</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 60">Net 60</option>
                    </select>
                  </div>
                </div>

                <div className="finance-row">
                  <div className="finance-label">
                    <label>Default Currency</label>
                  </div>
                  <div className="finance-select">
                    <select
                      value={preferences.defaultInvoiceCurrency}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => persistPreferences({ defaultInvoiceCurrency: e.target.value })}
                    >
                      <option value="USD">USD</option>
                      <option value="CAD">CAD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="finance-checkbox">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={Boolean(preferences.autoSendInvoices)}
                    disabled={prefsLoading || prefsSaving}
                    onChange={(e) => persistPreferences({ autoSendInvoices: e.target.checked })}
                  />
                  Auto-send invoices when loads are completed
                </label>
              </div>
            </div>

            {/* Dashboard & UI Preferences */}
            <div className="preferences-card">
              <h3>Dashboard & UI Preferences</h3>
              <p>Customize your dashboard and interface settings</p>
              
              <div className="dashboard-grid">
                <div className="dashboard-row">
                  <div className="dashboard-label">
                    <label>Theme</label>
                  </div>
                  <div className="dashboard-select">
                    <select
                      value={preferences.theme}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => applyThemePreference(e.target.value)}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="device">Device</option>
                    </select>
                  </div>
                </div>

                <div className="dashboard-row">
                  <div className="dashboard-label">
                    <label>Default View</label>
                  </div>
                  <div className="dashboard-select">
                    <select
                      value={preferences.defaultView}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => persistPreferences({ defaultView: e.target.value })}
                    >
                      <option value="My Loads Default View">My Loads Default View</option>
                      <option value="Dashboard Overview">Dashboard Overview</option>
                      <option value="Analytics">Analytics</option>
                    </select>
                  </div>
                </div>

                <div className="dashboard-row">
                  <div className="dashboard-label">
                    <label>Default Document Export type</label>
                  </div>
                  <div className="dashboard-select">
                    <select
                      value={preferences.defaultDocumentExportType}
                      disabled={prefsLoading || prefsSaving}
                      onChange={(e) => persistPreferences({ defaultDocumentExportType: e.target.value })}
                    >
                      <option value="pdf">PDF</option>
                      <option value="json">JSON</option>
                      <option value="csv">CSV</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Document Handling */}
            {/*
            <div className="preferences-card">
              <h3>Document Handling</h3>
              <p>Configure document categorization and archival settings</p>
              
              <div className="document-checkboxes">
                <label className="checkbox-label">
                  <input type="checkbox" defaultChecked />
                  Auto-categorize documents (BOLs, Invoices, Load Agreements)
                </label>
                
                <label className="checkbox-label">
                  <input type="checkbox" />
                  Auto-archive completed documents
                </label>
              </div>
            </div>
            */}

          </div>
        )}

        {/* Placeholder content for other tabs */}
        {activeTab !== 'company-profile' && activeTab !== 'user-management' && activeTab !== 'roles-permissions' && activeTab !== 'security' && activeTab !== 'api-webhooks' && activeTab !== 'preferences' && (
          <div className="tab-panel">
            <div className="placeholder-content">
              <div className="placeholder-icon">
                <i className={tabs.find(t => t.key === activeTab)?.icon}></i>
              </div>
              <h3>{tabs.find(t => t.key === activeTab)?.label}</h3>
              <p>This section is under development. Settings for {tabs.find(t => t.key === activeTab)?.label.toLowerCase()} will be available soon.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}