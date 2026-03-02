import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';
import { getJson, postJson } from '../../api/http';

// Reuse the same profile styles as the Driver profile for identical UX.
import '../../styles/driver/AccountSettings.css';

export default function ShipperProfile({ onProfileUpdate }) {
  const { currentUser } = useAuth();
  const fileInputRef = useRef(null);
  const w9InputRef = useRef(null);

  const FALLBACK_AVATAR_URL = 'https://randomuser.me/api/portraits/men/32.jpg';

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [w9Uploading, setW9Uploading] = useState(false);
  const [onboardingMissing, setOnboardingMissing] = useState({ requiredFields: [], optionalFields: [], documents: [] });

  const [profileData, setProfileData] = useState({
    businessName: '',
    businessType: '',
    taxId: '',
    website: '',
    contactFullName: '',
    contactTitle: '',
    phone: '',
    email: '',
    address: '',
    billingAddress: '',
    profilePicture: null,
  });

  useEffect(() => {
    const detectDark = () => {
      const dashboardRoot = document.querySelector('.fp-dashboard-root');
      if (dashboardRoot) return dashboardRoot.classList.contains('dark-root');
      return (
        document.body.classList.contains('dark-root') ||
        document.documentElement.classList.contains('dark-root')
      );
    };

    const update = () => setIsDarkMode(detectDark());
    update();

    const dashboardRoot = document.querySelector('.fp-dashboard-root');
    if (!dashboardRoot) return;
    const observer = new MutationObserver(() => update());
    observer.observe(dashboardRoot, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const fetchProfile = async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const me = await getJson('/auth/me', { requestLabel: 'GET /auth/me (shipper profile)' });
      setProfileData({
        businessName: me?.company_name || '',
        businessType: me?.business_type || '',
        taxId: me?.tax_id || '',
        website: me?.website || '',
        contactFullName: me?.name || '',
        contactTitle: me?.contact_title || '',
        phone: me?.phone || '',
        email: me?.email || currentUser.email || '',
        address: me?.address || '',
        billingAddress: me?.billing_address || '',
        profilePicture: me?.profile_picture_url || null,
      });
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Failed to load profile data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const refreshOnboardingMissing = async () => {
    if (!currentUser) return;
    try {
      setOnboardingLoading(true);
      const data = await getJson('/onboarding/shipper/missing', { requestLabel: 'GET /onboarding/shipper/missing' });
      setOnboardingMissing({
        requiredFields: Array.isArray(data?.missing_required_fields) ? data.missing_required_fields : [],
        optionalFields: Array.isArray(data?.missing_optional_fields) ? data.missing_optional_fields : [],
        documents: Array.isArray(data?.missing_documents) ? data.missing_documents : [],
      });
    } catch {
      setOnboardingMissing({ requiredFields: [], optionalFields: [], documents: [] });
    } finally {
      setOnboardingLoading(false);
    }
  };

  useEffect(() => {
    refreshOnboardingMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const handleInputChange = (field, value) => {
    setProfileData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setMessage({ type: 'error', text: 'Invalid file type. Please upload JPG, PNG, GIF, or WebP' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'File size must be less than 5MB' });
      return;
    }

    try {
      setUploading(true);
      setMessage({ type: '', text: '' });

      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/auth/profile/picture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.detail || 'Failed to upload profile picture');
      }

      const result = await response.json();
      setProfileData((prev) => ({ ...prev, profilePicture: result.profile_picture_url }));
      setMessage({ type: 'success', text: 'Profile picture uploaded successfully!' });
      if (typeof onProfileUpdate === 'function') {
        await Promise.resolve(onProfileUpdate({ profile_picture_url: result.profile_picture_url }));
      }
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (e2) {
      setMessage({ type: 'error', text: e2?.message || 'Failed to upload profile picture' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveProfileUpdate = async ({ showMessage = true } = {}) => {
    if (!currentUser) return;

    try {
      setSaving(true);
      if (showMessage) setMessage({ type: '', text: '' });

      const updateData = {
        company_name: profileData.businessName,
        business_type: profileData.businessType,
        tax_id: profileData.taxId,
        website: profileData.website,
        phone: profileData.phone,
        address: profileData.address,
        billing_address: profileData.billingAddress,
        contact_title: profileData.contactTitle,
      };

      if (profileData.contactFullName) {
        updateData.name = profileData.contactFullName;
        const nameParts = profileData.contactFullName.split(' ').filter(Boolean);
        if (nameParts.length > 0) {
          updateData.first_name = nameParts[0];
          if (nameParts.length > 1) {
            updateData.last_name = nameParts.slice(1).join(' ');
          }
        }
      }

      await postJson('/auth/profile/update', updateData, { requestLabel: 'POST /auth/profile/update (shipper profile)' });

      if (showMessage) setMessage({ type: 'success', text: 'Profile updated and saved!' });
      if (typeof onProfileUpdate === 'function') onProfileUpdate();
      await fetchProfile();
      refreshOnboardingMissing();
      if (showMessage) setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (e) {
      if (showMessage) setMessage({ type: 'error', text: e?.message || 'Failed to update profile. Please try again.' });
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      await saveProfileUpdate({ showMessage: true });
    } catch {
      // handled
    }
  };

  const hasAnyOnboardingMissing =
    (onboardingMissing?.requiredFields || []).length > 0 ||
    (onboardingMissing?.optionalFields || []).length > 0 ||
    (onboardingMissing?.documents || []).length > 0;

  const modalMissingFields = [...(onboardingMissing?.requiredFields || []), ...(onboardingMissing?.optionalFields || [])];

  const openOnboardingModal = async () => {
    setOnboardingOpen(true);
    await refreshOnboardingMissing();
  };

  const closeOnboardingModal = () => {
    if (onboardingSaving || w9Uploading) return;
    setOnboardingOpen(false);
  };

  const uploadW9 = async (file) => {
    if (!file || !currentUser) return;

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setMessage({ type: 'error', text: 'W9 must be a PDF, JPG, or PNG file' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'W9 file size must be less than 25MB' });
      return;
    }

    try {
      setW9Uploading(true);
      setMessage({ type: '', text: '' });

      const token = await currentUser.getIdToken();
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      formDataUpload.append('document_type', 'w9');

      const res = await fetch(`${API_URL}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formDataUpload,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || 'Failed to upload W9');
      }

      setMessage({ type: 'success', text: 'W9 uploaded successfully!' });
      await refreshOnboardingMissing();
      setTimeout(() => setMessage({ type: '', text: '' }), 2500);
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Failed to upload W9' });
    } finally {
      setW9Uploading(false);
      if (w9InputRef.current) w9InputRef.current.value = '';
    }
  };

  const completeOnboarding = async () => {
    if (!currentUser) return;
    try {
      setOnboardingSaving(true);
      setMessage({ type: '', text: '' });

      await saveProfileUpdate({ showMessage: false });

      await postJson('/onboarding/shipper/complete', {}, { requestLabel: 'POST /onboarding/shipper/complete' });

      setMessage({ type: 'success', text: 'Onboarding completed!' });
      if (typeof onProfileUpdate === 'function') onProfileUpdate();
      await refreshOnboardingMissing();
      setOnboardingOpen(false);
      setTimeout(() => setMessage({ type: '', text: '' }), 2500);
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Unable to complete onboarding. Please review the missing items.' });
      await refreshOnboardingMissing();
    } finally {
      setOnboardingSaving(false);
    }
  };

  const asTheme = {
    text: isDarkMode ? '#f1f5f9' : '#0f172a',
    muted: isDarkMode ? '#94a3b8' : '#6b7280',
    surfaceAlt: isDarkMode ? '#1f2937' : '#f8fafc',
  };

  if (loading) {
    return (
      <div className="account-settings-container">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '240px' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6' }} />
          <span style={{ marginLeft: '10px' }}>Loading profile...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="account-settings-container" style={{ padding: 0, width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      {message.text && (
        <div
          className={`profile-message ${message.type}`}
          style={{
            padding: '12px 16px',
            marginBottom: '20px',
            borderRadius: '8px',
            backgroundColor: message.type === 'success' ? '#d1fae5' : '#fee2e2',
            color: message.type === 'success' ? '#065f46' : '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <i className={`fa-solid ${message.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`} />
          {message.text}
        </div>
      )}

      <div className="profile-preferences-section" style={{ gridTemplateColumns: '1fr' }}>
        <div className="profile-card" style={{ minWidth: 0 }}>
          <div className="profile-card-title">
            <span>Profile</span>
          </div>

          <div className="profile-card-header">
            <img
              src={profileData.profilePicture || FALLBACK_AVATAR_URL}
              alt="Profile"
              className="profile-avatar"
              onError={(e) => {
                e.target.src = FALLBACK_AVATAR_URL;
              }}
            />
            <div>
              <div className="profile-name">{profileData.businessName || profileData.contactFullName || 'Shipper'}</div>
              <button className="change-photo-btn" onClick={handlePhotoClick} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Change Photo'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handlePhotoChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {hasAnyOnboardingMissing && (
            <div
              style={{
                background: asTheme.surfaceAlt,
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ color: asTheme.text }}>
                <div style={{ fontWeight: 700 }}>Onboarding incomplete</div>
                <div style={{ color: asTheme.muted, fontSize: 13 }}>Complete the missing items.</div>
              </div>
              <button type="button" className="btn small ghost-cd" onClick={openOnboardingModal} disabled={onboardingLoading}>
                {onboardingLoading ? 'Loading…' : 'Complete onboarding'}
              </button>
            </div>
          )}

          <div className="profile-field">
            <label>Business Name</label>
            <input
              type="text"
              value={profileData.businessName}
              onChange={(e) => handleInputChange('businessName', e.target.value)}
              placeholder="Business Name"
            />
          </div>

          <div className="profile-field">
            <label>Business Type</label>
            <select
              value={profileData.businessType}
              onChange={(e) => handleInputChange('businessType', e.target.value)}
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 6,
                border: isDarkMode ? '1px solid #424242' : '1px solid #e5e7eb',
                background: isDarkMode ? '#2c2c2c' : '#fff',
                color: asTheme.text,
              }}
            >
              <option value="">Select type</option>
              <option value="shipper">Shipper</option>
              <option value="broker">Broker</option>
            </select>
          </div>

          <div className="profile-field">
            <label>Tax ID (EIN)</label>
            <input
              type="text"
              value={profileData.taxId}
              onChange={(e) => handleInputChange('taxId', e.target.value)}
              placeholder="Tax ID (EIN)"
            />
          </div>

          <div className="profile-field">
            <label>Primary Contact</label>
            <input
              type="text"
              value={profileData.contactFullName}
              onChange={(e) => handleInputChange('contactFullName', e.target.value)}
              placeholder="Full Name"
            />
          </div>

          <div className="profile-field">
            <label>Contact Title</label>
            <input
              type="text"
              value={profileData.contactTitle}
              onChange={(e) => handleInputChange('contactTitle', e.target.value)}
              placeholder="Title / Role"
            />
          </div>

          <div className="profile-field">
            <label>Phone</label>
            <input
              type="text"
              value={profileData.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div className="profile-field">
            <label>Email</label>
            <input
              type="email"
              value={profileData.email}
              readOnly
              style={{
                backgroundColor: isDarkMode ? asTheme.surfaceAlt : '#f3f4f6',
                color: asTheme.muted,
                cursor: 'not-allowed',
              }}
            />
          </div>

          <div className="profile-field">
            <label>Address</label>
            <textarea
              value={profileData.address}
              rows={2}
              onChange={(e) => handleInputChange('address', e.target.value)}
              placeholder="123 Main St, Dallas, TX 75201"
            />
          </div>

          <div className="profile-field">
            <label>Website</label>
            <input
              type="text"
              value={profileData.website}
              onChange={(e) => handleInputChange('website', e.target.value)}
              placeholder="https://"
            />
          </div>

          <div className="profile-field">
            <label>Billing Address</label>
            <textarea
              value={profileData.billingAddress}
              rows={2}
              onChange={(e) => handleInputChange('billingAddress', e.target.value)}
              placeholder="Billing Address"
            />
          </div>

          <button className="btn small-cd" onClick={handleSaveProfile} disabled={saving} style={{ marginTop: '16px', width: '100%' }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {onboardingOpen && (
        <div
          className="modal-overlay"
          onClick={closeOnboardingModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{
              width: '100%',
              maxWidth: 720,
              maxHeight: '80vh',
              overflow: 'hidden',
              borderRadius: 12,
              background: isDarkMode ? '#2c2c2c' : '#ffffff',
              color: asTheme.text,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: 18,
                borderBottom: isDarkMode ? '1px solid #424242' : '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Complete onboarding</div>
                <div style={{ fontSize: 13, color: asTheme.muted }}>Only missing items are shown.</div>
              </div>
              <button type="button" className="btn small ghost-cd" onClick={closeOnboardingModal} disabled={onboardingSaving || w9Uploading}>
                Close
              </button>
            </div>

            <div style={{ padding: 18, overflowY: 'auto' }}>
              {onboardingLoading ? (
                <div className="muted">Loading…</div>
              ) : !hasAnyOnboardingMissing ? (
                <div className="muted">No missing onboarding items.</div>
              ) : (
                <>
                  {modalMissingFields.includes('company_name') && (
                    <div className="profile-field">
                      <label>Business Name</label>
                      <input
                        type="text"
                        value={profileData.businessName}
                        onChange={(e) => handleInputChange('businessName', e.target.value)}
                        placeholder="Business Name"
                      />
                    </div>
                  )}

                  {modalMissingFields.includes('business_type') && (
                    <div className="profile-field">
                      <label>Business Type</label>
                      <select
                        value={profileData.businessType}
                        onChange={(e) => handleInputChange('businessType', e.target.value)}
                        style={{
                          width: '100%',
                          padding: 8,
                          borderRadius: 6,
                          border: isDarkMode ? '1px solid #424242' : '1px solid #e5e7eb',
                          background: isDarkMode ? '#2c2c2c' : '#fff',
                          color: asTheme.text,
                        }}
                      >
                        <option value="">Select type</option>
                        <option value="shipper">Shipper</option>
                        <option value="broker">Broker</option>
                      </select>
                    </div>
                  )}

                  {modalMissingFields.includes('tax_id') && (
                    <div className="profile-field">
                      <label>Tax ID (EIN)</label>
                      <input
                        type="text"
                        value={profileData.taxId}
                        onChange={(e) => handleInputChange('taxId', e.target.value)}
                        placeholder="Tax ID (EIN)"
                      />
                    </div>
                  )}

                  {modalMissingFields.includes('address') && (
                    <div className="profile-field">
                      <label>Business Address</label>
                      <textarea
                        value={profileData.address}
                        rows={2}
                        onChange={(e) => handleInputChange('address', e.target.value)}
                        placeholder="Address"
                      />
                    </div>
                  )}

                  {modalMissingFields.includes('phone') && (
                    <div className="profile-field">
                      <label>Phone</label>
                      <input
                        type="text"
                        value={profileData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  )}

                  {modalMissingFields.includes('name') && (
                    <div className="profile-field">
                      <label>Primary Contact</label>
                      <input
                        type="text"
                        value={profileData.contactFullName}
                        onChange={(e) => handleInputChange('contactFullName', e.target.value)}
                        placeholder="Full Name"
                      />
                    </div>
                  )}

                  {modalMissingFields.includes('contact_title') && (
                    <div className="profile-field">
                      <label>Contact Title</label>
                      <input
                        type="text"
                        value={profileData.contactTitle}
                        onChange={(e) => handleInputChange('contactTitle', e.target.value)}
                        placeholder="Title / Role"
                      />
                    </div>
                  )}

                  {modalMissingFields.includes('website') && (
                    <div className="profile-field">
                      <label>Website</label>
                      <input
                        type="text"
                        value={profileData.website}
                        onChange={(e) => handleInputChange('website', e.target.value)}
                        placeholder="https://"
                      />
                    </div>
                  )}

                  {(onboardingMissing?.documents || []).includes('w9') && (
                    <div style={{ marginTop: 6, marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>W9 Form</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" className="btn small ghost-cd" onClick={() => w9InputRef.current?.click()} disabled={w9Uploading}>
                          {w9Uploading ? 'Uploading…' : 'Upload W9'}
                        </button>
                        <input
                          ref={w9InputRef}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadW9(f);
                          }}
                          style={{ display: 'none' }}
                        />
                        <div style={{ fontSize: 13, color: asTheme.muted }}>PDF/JPG/PNG • Max 25MB</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div
              style={{
                padding: 18,
                borderTop: isDarkMode ? '1px solid #424242' : '1px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <button type="button" className="btn small ghost-cd" onClick={refreshOnboardingMissing} disabled={onboardingLoading || onboardingSaving || w9Uploading}>
                Refresh
              </button>
              <button type="button" className="btn small-cd" onClick={completeOnboarding} disabled={onboardingSaving || onboardingLoading || w9Uploading}>
                {onboardingSaving ? 'Saving…' : 'Complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
