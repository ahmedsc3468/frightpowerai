import React, { useState, useEffect } from 'react';
import '../../styles/shipper/ShipperMarketplace.css';
import { useAuth } from '../../contexts/AuthContext';
import { API_URL } from '../../config';
import { AUTO_REFRESH_MS } from '../../constants/refresh';
import AddLoads from '../carrier/AddLoads';

const MARKETPLACE_THRESHOLD = 60;
const ACCESS_CACHE_PREFIX = 'fp_shipper_marketplace_access_v1:';

function readAccessCache(uid) {
  if (!uid) return null;
  try {
    const raw = sessionStorage.getItem(`${ACCESS_CACHE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const ts = Number(parsed.ts || 0);
    if (!ts || (Date.now() - ts) > AUTO_REFRESH_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAccessCache(uid, data) {
  if (!uid) return;
  try {
    sessionStorage.setItem(`${ACCESS_CACHE_PREFIX}${uid}`, JSON.stringify({ ts: Date.now(), ...(data || {}) }));
  } catch {
    // ignore
  }
}

export default function ShipperMarketplace() {
  const { currentUser } = useAuth();
  const cachedAccess = readAccessCache(currentUser?.uid);
  const tabs = ['All', 'Public Listings', 'Carriers', 'Service Providers', 'Technology', 'Insurance', 'AI Matches'];

  const regions = ['All Regions', 'North', 'South', 'East', 'West', 'Midwest'];
  const equipment = ['All Equipment', 'Dry Van', 'Reefer', 'Flatbed', 'Container'];
  const ratings = ['All Ratings', '4.5+ Stars', '4.0+ Stars', '3.5+ Stars'];

  const [activeTab, setActiveTab] = useState('All');
  const [openDropdown, setOpenDropdown] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(regions[0]);
  const [selectedEquipment, setSelectedEquipment] = useState(equipment[0]);
  const [selectedRating, setSelectedRating] = useState(ratings[0]);
  const [searchQuery, setSearchQuery] = useState('');

  // AddLoads modal state
  const [showAddLoads, setShowAddLoads] = useState(false);
  const [shipperLoads, setShipperLoads] = useState([]);
  const [marketplaceLoads, setMarketplaceLoads] = useState([]);
  const [loadsLoading, setLoadsLoading] = useState(false);

  // Offers modal state
  const [offersModalOpen, setOffersModalOpen] = useState(false);
  const [selectedLoadForOffers, setSelectedLoadForOffers] = useState(null);
  const [loadOffers, setLoadOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [acceptingOffer, setAcceptingOffer] = useState(false);

  // Marketplace gating state
  const [isMarketplaceReady, setIsMarketplaceReady] = useState(() => cachedAccess?.isMarketplaceReady ?? true);
  const [onboardingScore, setOnboardingScore] = useState(() => cachedAccess?.onboardingScore ?? 100);
  const [nextActions, setNextActions] = useState(() => cachedAccess?.nextActions ?? []);
  const [checkingAccess, setCheckingAccess] = useState(() => (currentUser ? !cachedAccess : true));
  const [consentEligible, setConsentEligible] = useState(() => cachedAccess?.consentEligible ?? true);
  const [missingConsents, setMissingConsents] = useState(() => cachedAccess?.missingConsents ?? []);
  const [gatingReason, setGatingReason] = useState(() => cachedAccess?.gatingReason ?? '');

  // Carriers and Service Providers state
  const [carriers, setCarriers] = useState([]);
  const [serviceProviders, setServiceProviders] = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All Categories');

  const categories = ['All Categories', 'Factoring', 'Insurance', 'Compliance', 'Legal', 'Repair', 'Medical', 'Testing', 'Dispatch'];

  // Check onboarding status AND consent eligibility to gate marketplace
  useEffect(() => {
    const checkMarketplaceAccess = async () => {
      if (!currentUser) {
        setCheckingAccess(false);
        return;
      }

      const fresh = readAccessCache(currentUser.uid);
      if (fresh) {
        setIsMarketplaceReady(Boolean(fresh.isMarketplaceReady));
        setOnboardingScore(Number(fresh.onboardingScore ?? 0));
        setNextActions(Array.isArray(fresh.nextActions) ? fresh.nextActions : []);
        setConsentEligible(Boolean(fresh.consentEligible));
        setMissingConsents(Array.isArray(fresh.missingConsents) ? fresh.missingConsents : []);
        setGatingReason(String(fresh.gatingReason || ''));
        setCheckingAccess(false);
        return;
      }

      setCheckingAccess(true);

      try {
        const token = await currentUser.getIdToken();

        let scoreValue = 0;
        let nextActionsValue = [];
        let consentsEligibleValue = true;
        let missingConsentsValue = [];

        // Check onboarding score
        let scoreOk = true;
        try {
          const onboardingResponse = await fetch(`${API_URL}/onboarding/coach-status`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          if (onboardingResponse.ok) {
            const data = await onboardingResponse.json();
            const score = data.total_score || 0;
            scoreValue = score;
            nextActionsValue = data.next_best_actions || [];
            setOnboardingScore(score);
            scoreOk = score >= MARKETPLACE_THRESHOLD;
            setNextActions(nextActionsValue);
          }
        } catch (err) {
          console.warn('Could not fetch onboarding status, allowing access:', err);
          scoreOk = true;
        }

        // Check consent eligibility
        let consentsOk = true;
        try {
          const consentResponse = await fetch(`${API_URL}/consents/marketplace-eligibility`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          if (consentResponse.ok) {
            const consentData = await consentResponse.json();
            consentsOk = consentData.eligible;
            consentsEligibleValue = consentData.eligible;
            missingConsentsValue = consentData.missing_consents || [];
            setConsentEligible(consentsEligibleValue);
            setMissingConsents(missingConsentsValue);
          }
        } catch (err) {
          console.warn('Could not fetch consent eligibility, allowing access:', err);
          consentsOk = true;
        }

        // Determine gating reason
        const gating = (!scoreOk && !consentsOk) ? 'both' : (!scoreOk ? 'score' : (!consentsOk ? 'consent' : ''));
        if (gating) setGatingReason(gating);

        const ready = scoreOk && consentsOk;
        setIsMarketplaceReady(ready);

        writeAccessCache(currentUser.uid, {
          isMarketplaceReady: ready,
          onboardingScore: Number(scoreValue || 0),
          nextActions: Array.isArray(nextActionsValue) ? nextActionsValue : [],
          consentEligible: Boolean(consentsEligibleValue),
          missingConsents: Array.isArray(missingConsentsValue) ? missingConsentsValue : [],
          gatingReason: gating,
        });
      } catch (error) {
        console.error('Error checking marketplace access:', error);
        setIsMarketplaceReady(true);

        writeAccessCache(currentUser.uid, {
          isMarketplaceReady: true,
          onboardingScore: Number(onboardingScore || 0),
          nextActions: Array.isArray(nextActions) ? nextActions : [],
          consentEligible: true,
          missingConsents: [],
          gatingReason: '',
        });
      } finally {
        setCheckingAccess(false);
      }
    };

    checkMarketplaceAccess();
  }, [currentUser]);

  // Event listener for dropdown clicks
  useEffect(() => {
    function onDocClick() { setOpenDropdown(null); }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Fetch shipper's own loads
  useEffect(() => {
    const fetchShipperLoads = async () => {
      if (!currentUser) return;
      
      setLoadsLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_URL}/loads`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          setShipperLoads(data.loads || []);
        }
      } catch (error) {
        console.error('Error fetching shipper loads:', error);
      } finally {
        setLoadsLoading(false);
      }
    };
    
    fetchShipperLoads();
  }, [currentUser]);

  // Fetch offers for a load
  const handleViewOffers = async (load) => {
    setSelectedLoadForOffers(load);
    setOffersModalOpen(true);
    setOffersLoading(true);
    
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads/${load.load_id}/offers`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setLoadOffers(data.offers || []);
      } else {
        console.error('Failed to fetch offers');
        setLoadOffers([]);
      }
    } catch (error) {
      console.error('Error fetching offers:', error);
      setLoadOffers([]);
    } finally {
      setOffersLoading(false);
    }
  };

  // Accept a carrier offer
  const handleAcceptOffer = async (offer) => {
    if (!window.confirm(`Accept ${offer.carrier_name}'s bid of $${offer.rate}?`)) {
      return;
    }

    setAcceptingOffer(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/loads/${offer.load_id}/accept-carrier`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          carrier_id: offer.carrier_id,
          carrier_name: offer.carrier_name,
          offer_id: offer.offer_id
        })
      });

      if (response.ok) {
        alert('Carrier accepted successfully! Load moved to ASSIGNED status.');
        setOffersModalOpen(false);
        // Refresh shipper loads
        window.location.reload();
      } else {
        const error = await response.json();
        alert(`Failed to accept carrier: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error accepting offer:', error);
      alert('Failed to accept carrier. Please try again.');
    } finally {
      setAcceptingOffer(false);
    }
  };

  // Fetch shipper's tendered loads (POSTED status, awaiting carrier bids) for Public Listings tab
  useEffect(() => {
    const fetchMarketplaceLoads = async () => {
      if (!currentUser || !isMarketplaceReady) return;
      
      try {
        const token = await currentUser.getIdToken();
        // Fetch tendered loads (shipper's own POSTED loads awaiting bids)
        const response = await fetch(`${API_URL}/loads/tendered`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          setMarketplaceLoads(data.loads || []);
        } else {
          console.error('Failed to fetch tendered loads:', response.statusText);
          setMarketplaceLoads([]);
        }
      } catch (error) {
        console.error('Error fetching tendered loads:', error);
        setMarketplaceLoads([]);
      }
    };
    
    fetchMarketplaceLoads();
  }, [currentUser, isMarketplaceReady]);

  // Fetch carriers from backend
  useEffect(() => {
    const fetchCarriers = async () => {
      if (!currentUser || !isMarketplaceReady) return;
      
      setCarriersLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`${API_URL}/carriers`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          setCarriers(data.carriers || []);
        }
      } catch (error) {
        console.error('Error fetching carriers:', error);
      } finally {
        setCarriersLoading(false);
      }
    };
    
    if (activeTab === 'Carriers' || activeTab === 'All') {
      fetchCarriers();
    }
  }, [currentUser, isMarketplaceReady, activeTab]);

  // Fetch service providers from backend
  useEffect(() => {
    const fetchServiceProviders = async () => {
      if (!currentUser || !isMarketplaceReady) return;
      
      setProvidersLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const categoryParam = selectedCategory !== 'All Categories' ? `?category=${selectedCategory.toLowerCase()}` : '';
        const response = await fetch(`${API_URL}/service-providers${categoryParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          setServiceProviders(data.providers || []);
        }
      } catch (error) {
        console.error('Error fetching service providers:', error);
      } finally {
        setProvidersLoading(false);
      }
    };
    
    if (activeTab === 'Service Providers' || activeTab === 'All') {
      fetchServiceProviders();
    }
  }, [currentUser, isMarketplaceReady, activeTab, selectedCategory]);

  const handleLoadAdded = () => {
    setShowAddLoads(false);
    // Refetch loads
    if (currentUser) {
      currentUser.getIdToken().then(token => {
        fetch(`${API_URL}/loads`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => res.json())
        .then(data => setShipperLoads(data.loads || []));
      });
    }
  };

  // Show loading state while checking access
  if (checkingAccess) {
    return (
      <div className="marketplace-loading" style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6' }}></i>
        <p style={{ marginTop: '10px', color: '#64748b' }}>Checking marketplace access...</p>
      </div>
    );
  }

  // Show gating message if onboarding not complete or consents missing
  if (!isMarketplaceReady) {
    return (
      <div className="marketplace-gated" style={{
        padding: '60px 40px',
        textAlign: 'center',
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        borderRadius: '16px',
        margin: '20px',
        border: '1px solid #e2e8f0'
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          background: '#fef3c7',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px'
        }}>
          <i className="fa-solid fa-lock" style={{ fontSize: '2rem', color: '#f59e0b' }}></i>
        </div>

        <h2 style={{ fontSize: '1.75rem', color: '#1e293b', marginBottom: '10px' }}>
          Marketplace Access Locked
        </h2>

        <p style={{ color: '#64748b', marginBottom: '20px', maxWidth: '500px', margin: '0 auto 20px' }}>
          {gatingReason === 'consent'
            ? 'You must sign all required consent forms to access the marketplace.'
            : gatingReason === 'both'
            ? 'Complete your onboarding and sign required consent forms to unlock the marketplace.'
            : `Complete your onboarding to unlock the marketplace. Score needed: ${MARKETPLACE_THRESHOLD}%`
          }
        </p>

        {/* Show missing consents if applicable */}
        {!consentEligible && missingConsents.length > 0 && (
          <div style={{
            background: '#fef2f2',
            padding: '15px 20px',
            borderRadius: '12px',
            maxWidth: '400px',
            margin: '0 auto 20px',
            border: '1px solid #fecaca'
          }}>
            <div style={{ fontWeight: '600', color: '#dc2626', marginBottom: '10px' }}>
              <i className="fa-solid fa-file-signature" style={{ marginRight: '8px' }}></i>
              Missing Required Consents
            </div>
            <ul style={{ textAlign: 'left', margin: 0, paddingLeft: '20px', color: '#7f1d1d' }}>
              {missingConsents.map((consent, idx) => (
                <li key={idx} style={{ marginBottom: '5px' }}>
                  {consent.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Show onboarding score if applicable */}
        {(gatingReason === 'score' || gatingReason === 'both') && (
        <div style={{
          background: '#fff',
          padding: '20px',
          borderRadius: '12px',
          maxWidth: '400px',
          margin: '0 auto 30px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', marginBottom: '15px' }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: onboardingScore >= 50 ? '#fef3c7' : '#fee2e2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.25rem',
              fontWeight: 'bold',
              color: onboardingScore >= 50 ? '#f59e0b' : '#ef4444'
            }}>
              {onboardingScore}%
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: '600', color: '#1e293b' }}>Current Score</div>
              <div style={{ color: '#64748b', fontSize: '0.875rem' }}>
                Need {MARKETPLACE_THRESHOLD - onboardingScore}% more to unlock
              </div>
            </div>
          </div>
        </div>
        )}

        {nextActions.length > 0 && (gatingReason === 'score' || gatingReason === 'both') && (
          <div style={{ textAlign: 'left', maxWidth: '400px', margin: '0 auto' }}>
            <h4 style={{ color: '#1e293b', marginBottom: '10px' }}>Complete These Steps:</h4>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {nextActions.slice(0, 3).map((action, index) => (
                <li key={index} style={{
                  padding: '10px 15px',
                  background: '#fff',
                  borderRadius: '8px',
                  marginBottom: '8px',
                  border: '1px solid #e2e8f0'
                }}>
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Convert shipper loads to listings format
  const allListings = shipperLoads.map(load => ({
    id: load.load_id,
    lane: `${load.origin} → ${load.destination}`,
    equipment: load.equipment_type || 'N/A',
    offerCount: load.offers ? load.offers.length : 0,
    postedOn: load.created_at ? new Date(load.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A',
    status: load.status === 'posted' ? 'Open' : load.status,
    fullData: load
  }));

  // Insurance-specific providers (shown under Insurance tab) - Keep for Insurance tab
  const insuranceProviders = [
    { name: 'LoadSure', icon: 'fa-solid fa-shield-halved', sub: 'Freight Insurance', category: 'Insurance', services: 'Cargo & liability coverage', rating: '4.9', status: 'Active', contact: 'website', actionText: 'Get Quote' },
    { name: 'CoverWallet', icon: 'fa-solid fa-wallet', sub: 'General Insurance', category: 'Insurance', services: 'COI, cargo, and commercial auto', rating: '4.8', status: 'Active', contact: 'email', actionText: 'Contact' },
    { name: 'FleetGuard Compliance', icon: 'fa-solid fa-clipboard-check', sub: 'Compliance', category: 'Compliance', services: 'BOC-3, IFTA, UCR, safety filings', rating: '4.7', status: 'Active', contact: 'phone', actionText: 'View' },
    { name: 'TruckShield', icon: 'fa-solid fa-truck', sub: 'Safety / Compliance', category: 'Safety', services: 'FMCSA monitoring, document audit', rating: '4.6', status: 'Renewal Pending', contact: 'website', actionText: 'Connect' },
    { name: 'TrueRate', icon: 'fa-solid fa-percent', sub: 'Factoring + Insurance', category: 'Multi Service', services: 'Cargo coverage with load factoring', rating: '4.8', status: 'Active', contact: 'email', actionText: 'View' }
  ];

  const techProviders = [
    { name: 'Motive (KeepTruckin)', icon: 'fa-solid fa-tachometer-alt-fast', iconLabel: 'ELD', tagClass: 'eld', iconClass: 'ic-eld', title: 'HOS tracking, GPS, driver safety monitoring and compliance management', rating: '4.8', status: 'Verified', action: 'Connect' },
    { name: 'Project44', icon: 'fa-solid fa-map-location-dot', iconLabel: 'Visibility', tagClass: 'visibility', iconClass: 'ic-visibility', title: 'Real-time freight tracking and supply chain visibility platform', rating: '4.9', status: 'Verified', action: 'Connect' },
    { name: 'QuickBooks Online', icon: 'fa-solid fa-calculator', iconLabel: 'Accounting', tagClass: 'accounting', iconClass: 'ic-accounting', title: 'Billing, invoicing, and expense tracking for transportation businesses', rating: '4.7', status: 'Active', action: 'Connect' },
    { name: 'OpenTMS', icon: 'fa-solid fa-route', iconLabel: 'TMS', tagClass: 'tms', iconClass: 'ic-tms', title: 'Load management, dispatch optimization and carrier communication', rating: '4.6', status: 'Integration Ready', action: 'View' },
    { name: 'FreightELD', icon: 'fa-solid fa-clipboard-check', iconLabel: 'Compliance', tagClass: 'compliance', iconClass: 'ic-compliance', title: 'Fleet logs, DVIR, fuel tracking and compliance reporting', rating: '4.8', status: 'Verified', action: 'Connect' },
    { name: 'WOFA.ai', icon: 'fa-solid fa-robot', iconLabel: 'AI/Automation', tagClass: 'ai', iconClass: 'ic-ai', title: 'Workflow automation and AI document processing bots', rating: '4.9', status: 'Verified', action: 'Connect' }
  ];

  // AI Matches carrier rows for the AI Matches tab
  const carrierMatches = [
    { name: 'RoadStar Freight', subtitle: 'High compliance, 3 matching lanes', region: 'Midwest', equipment: 'Reefer', match: '97%', compliance: 'Valid', actionText: 'Invite', avatarIcon: 'fa-solid fa-truck', avatarClass: 'match-blue' },
    { name: 'Atlas Hauling', subtitle: 'Strong delivery score', region: 'South', equipment: 'Flatbed', match: '95%', compliance: 'Valid', actionText: 'View', avatarIcon: 'fa-solid fa-box', avatarClass: 'match-purple' },
    { name: 'Skyline Logistics', subtitle: '2 matching lanes', region: 'West', equipment: 'Van', match: '92%', compliance: 'Insurance Expiring', actionText: 'Save', avatarIcon: 'fa-solid fa-shipping-fast', avatarClass: 'match-orange' }
  ];

  return (
    <div className="shipper-marketplace">
      {/* Top Dashboard Cards */}
      <div className="dashboard-cards">
        <div className="dashboard-card">
          <div className="card-header">
            <h4>Public Listings</h4>
            <div className="sm-card-icon blue">
              <i className="fa-solid fa-list"/>
            </div>
          </div>
          <div className="card-number">12</div>
          <div className="card-subtitle">3 new today</div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h4>Verified Carriers</h4>
            <div className="sm-card-icon green">
              <i className="fa-solid fa-question"/>
            </div>
          </div>
          <div className="card-number">2,847</div>
          <div className="card-subtitle">98% compliant</div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h4>Service Providers</h4>
            <div className="sm-card-icon purple">
              <i className="fa-solid fa-handshake"/>
            </div>
          </div>
          <div className="card-number">156</div>
          <div className="card-subtitle">24 categories</div>
        </div>

        <div className="dashboard-card">
          <div className="card-header">
            <h4>AI Matches</h4>
            <div className="sm-card-icon orange">
              <i className="fa-solid fa-lightbulb"/>
            </div>
          </div>
          <div className="card-number">8</div>
          <div className="card-subtitle">Ready to review</div>
        </div>
      </div>

      {/* Action Bar and Filters */}
      <div className="action-bar">
        <div className="action-left">
          <button className="btn small-cd" onClick={() => setShowAddLoads(true)}>
            <i className="fa-solid fa-plus" />
            Post Load to Marketplace
          </button>
          
          <div className="search-wrapper">
            <i className="fa-solid fa-magnifying-glass" />
            <input 
              type="text" 
              placeholder="Search" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="action-right fp-filters">
            <select
              className="sb-carrier-filter-select"
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
            >
              {regions.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>

            <select
              className="sb-carrier-filter-select"
              value={selectedEquipment}
              onChange={(e) => setSelectedEquipment(e.target.value)}
            >
              {equipment.map(eq => (
                <option key={eq} value={eq}>{eq}</option>
              ))}
            </select>

            <select
              className="sb-carrier-filter-select"
              value={selectedRating}
              onChange={(e) => setSelectedRating(e.target.value)}
            >
              {ratings.map(rt => (
                <option key={rt} value={rt}>{rt}</option>
              ))}
            </select>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mrkt-tabs tabs" style={{marginBottom: '20px'}}>
        {tabs.map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'All' && (
        <div className="tab-content">
          {/* Your Public Listings */}
      <div className="all-listings-card">
        <h3>All Listings</h3>
        <div className="listings-table">
          <div className="table-header">
            <div>LISTING ID</div>
            <div>LANE</div>
            <div>EQUIPMENT</div>
            <div>TYPE</div>
            <div>OFFER COUNT</div>
            <div>POSTED ON</div>
            <div>STATUS</div>
            <div>ACTIONS</div>
          </div>
          {allListings.filter(listing => {
            // Search filter
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = !searchQuery || 
              listing.id?.toString().toLowerCase().includes(searchLower) ||
              listing.lane?.toLowerCase().includes(searchLower) ||
              listing.equipment?.toLowerCase().includes(searchLower) ||
              listing.status?.toLowerCase().includes(searchLower);

            // Region filter
            const matchesRegion = selectedRegion === 'All Regions' || 
              listing.fullData?.origin?.toLowerCase().includes(selectedRegion.toLowerCase()) ||
              listing.fullData?.destination?.toLowerCase().includes(selectedRegion.toLowerCase());

            // Equipment filter
            const matchesEquipment = selectedEquipment === 'All Equipment' || 
              listing.equipment?.toLowerCase().includes(selectedEquipment.toLowerCase().replace(' ', ''));

            // Rating filter (for listings, this might not apply directly, but we'll keep it for consistency)
            const matchesRating = selectedRating === 'All Ratings';

            return matchesSearch && matchesRegion && matchesEquipment && matchesRating;
          }).map((listing, index) => (
            <div key={index} className="table-row">
              <div className="listing-id">{listing.id}</div>
              <div className="lane">
                <div>{listing.lane}</div>
                {listing.fullData?.additional_routes && listing.fullData.additional_routes.length > 0 && (
                  <div style={{
                    fontSize: '11px',
                    color: '#6b7280',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <i className="fa-solid fa-route"></i>
                    +{listing.fullData.additional_routes.length} additional stops
                  </div>
                )}
              </div>
              <div className="equipment">{listing.equipment}</div>
              <div className="load-type">
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  background: listing.fullData?.load_type === 'Full Truckload' || listing.fullData?.load_type === 'FTL' ? '#dbeafe' : '#fef3c7',
                  color: listing.fullData?.load_type === 'Full Truckload' || listing.fullData?.load_type === 'FTL' ? '#1e40af' : '#92400e'
                }}>
                  {listing.fullData?.load_type === 'Full Truckload' ? 'FTL' : listing.fullData?.load_type || 'FTL'}
                </span>
              </div>
              <div className="offer-count">
                <a 
                  href="#" 
                  className="int-status-badge blue"
                  onClick={(e) => {
                    e.preventDefault();
                    handleViewOffers(listing.fullData);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {listing.offerCount} offer{listing.offerCount !== 1 ? 's' : ''}
                </a>
              </div>
              <div className="posted-on">{listing.postedOn}</div>
              <div className="mrkt-status">
                <span className={`int-status-badge ${listing.status.toLowerCase()}`}>
                  {listing.status}
                </span>
              </div>
              <div className="actions">
                {listing.offerCount > 0 && listing.status.toLowerCase() === 'open' ? (
                  <button
                    onClick={() => handleViewOffers(listing.fullData)}
                    style={{
                      padding: '6px 12px',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '500'
                    }}
                  >
                    View Offers
                  </button>
                ) : (
                  <i className="fa-solid fa-ellipsis-h"></i>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Carrier Cards */}
      <div className="carrier-cards">
        {carriers.map((carrier, index) => (
          <div key={index} className="carrier-card">
            <div className='mrkt-sb-carrier-card'>
              <div className='mrkt-sb-name-icon'>
                <div className="carrier-icon">
              <i className="fa-solid fa-truck" aria-hidden="true" />
              </div>
              <div className="mrkt-carrier-details">
              <h4 className="carrier-name">{carrier.name}</h4>
              <p className="mc-number">{carrier.mcNumber}</p>
              </div>
              </div>
              <div className="mrkt-carrier-rating">
                <i className="fa-solid fa-star" /> 
                <span>{carrier.rating}</span>
              </div>
            </div>
            <div className="mrkt-carrier-details">
                <div className="detail-item">
                  <span className="detail-label">Region:</span>
                  <span className="detail-value">{carrier.region}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Equipment:</span>
                  <span className="detail-value">{carrier.equipment}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Compliance:</span>
                  <span className="detail-value">
                    <span className={`int-status-badge ${carrier.compliance}`}>
                  {carrier.compliance}
                    </span>
                  </span>
                </div>
              </div>
              <div className="carrier-actions">
              <button className="btn small-cd" style={{width: '100%'}}>Snapshot</button>
              <button className="btn small ghost-cd" style={{width: '100%'}}>Invite</button>
            </div>
          </div>
        ))}
      </div>

      {/* AI Recommendations */}
      <div className="ai-recommendations">
        <h3>
          AI Recommendations
        </h3>
        
        <div className="recommendation-cards">
          <div className="recommendation-card best-fit">
            <div className="recommendation-content">
              <h4>Best Fit for CHI → DAL Route</h4>
              <p>Based on equipment type, route history, and ratings</p>
              <div className="recommendation-summary">
                <span className="summary-item">3 carriers recommended</span>
                <span className="summary-item">96% match confidence</span>
              </div>
            </div>
            <button className="btn small-cd">View Matches</button>
          </div>

          <div className="recommendation-card rate-intel">
            <div className="recommendation-content">
              <h4>Rate Intelligence Update</h4>
              <p>Market rates for your active lanes have changed</p>
              <div className="rate-changes">
                <span className="rate-change positive">+$120 avg on CHI-DAL</span>
                <span className="rate-change negative">-$80 avg on ATL-MIA</span>
              </div>
            </div>
            <button className="btn small-cd">View Details</button>
          </div>
        </div>
      </div>
        </div>
      )}

      {activeTab === 'Public Listings' && (
        <div className="tab-content">
          {/* Shipper's Tendered Loads (POSTED, awaiting carrier bids) */}
      <div className="all-listings-card">
        <h3>Your Tendered Loads</h3>
        {marketplaceLoads.length === 0 ? (
          <div style={{padding: '40px', textAlign: 'center', color: '#666'}}>
            <p>No tendered loads. Post a load to get carrier bids.</p>
          </div>
        ) : (
        <div className="listings-table">
          <div className="table-header">
            <div>LOAD ID</div>
            <div>LANE</div>
            <div>EQUIPMENT</div>
            <div>TYPE</div>
            <div>RATE</div>
            <div>PICKUP DATE</div>
            <div>OFFERS</div>
            <div>STATUS</div>
            <div>ACTIONS</div>
          </div>
          {marketplaceLoads.filter(load => {
            // Search filter
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = !searchQuery || 
              load.load_id?.toString().toLowerCase().includes(searchLower) ||
              load.origin?.toLowerCase().includes(searchLower) ||
              load.destination?.toLowerCase().includes(searchLower) ||
              load.equipment_type?.toLowerCase().includes(searchLower);

            // Region filter
            const matchesRegion = selectedRegion === 'All Regions' || 
              load.origin?.toLowerCase().includes(selectedRegion.toLowerCase()) ||
              load.destination?.toLowerCase().includes(selectedRegion.toLowerCase());

            // Equipment filter
            const matchesEquipment = selectedEquipment === 'All Equipment' || 
              load.equipment_type?.toLowerCase().includes(selectedEquipment.toLowerCase().replace(' ', ''));

            return matchesSearch && matchesRegion && matchesEquipment;
          }).map((load, index) => (
            <div key={index} className="table-row">
              <div className="listing-id">{load.load_id}</div>
              <div className="lane">
                <div>{load.origin} → {load.destination}</div>
                {load.additional_routes && load.additional_routes.length > 0 && (
                  <div style={{
                    fontSize: '11px',
                    color: '#6b7280',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <i className="fa-solid fa-route"></i>
                    +{load.additional_routes.length} additional stops
                  </div>
                )}
              </div>
              <div className="equipment">{load.equipment_type || 'N/A'}</div>
              <div className="load-type">
                <span style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  background: load.load_type === 'Full Truckload' || load.load_type === 'FTL' ? '#dbeafe' : '#fef3c7',
                  color: load.load_type === 'Full Truckload' || load.load_type === 'FTL' ? '#1e40af' : '#92400e'
                }}>
                  {load.load_type === 'Full Truckload' ? 'FTL' : load.load_type === 'LTL' ? 'LTL' : load.load_type || 'FTL'}
                </span>
              </div>
              <div className="offer-count">
                {load.rate ? `$${load.rate}` : 'Negotiable'}
              </div>
              <div className="posted-on">{load.pickup_date || 'TBD'}</div>
              <div className="offer-count">
                <span 
                  className={`offer-badge ${(load.offers && load.offers.length > 0) ? 'clickable' : ''}`}
                  onClick={() => {
                    if (load.offers && load.offers.length > 0) {
                      handleViewOffers(load);
                    }
                  }}
                  style={{ cursor: (load.offers && load.offers.length > 0) ? 'pointer' : 'default' }}
                >
                  {load.offers ? load.offers.length : 0} {(load.offers && load.offers.length === 1) ? 'offer' : 'offers'}
                </span>
              </div>
              <div className="mrkt-status">
                <span className="int-status-badge active">
                  Active
                </span>
              </div>
              <div className="actions">
                {load.offers && load.offers.length > 0 ? (
                  <button className="btn small-cd" onClick={() => handleViewOffers(load)}>View Offers</button>
                ) : (
                  <button className="btn small-cd" disabled style={{opacity: 0.5}}>Awaiting Bids</button>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
      <div className="listings-summary">
          <div className="summary-box">
            <i className="fa-solid fa-circle-info" />
            <span>{marketplaceLoads.length} active tendered {marketplaceLoads.length === 1 ? 'load' : 'loads'} awaiting carrier bids · {marketplaceLoads.filter(l => l.offers && l.offers.length > 0).length} with offers</span>
          </div>
        </div>
        </div>
      )}

      {activeTab === 'Carriers' && (
        <div className="tab-content">
          <div className="carrier-listings-card">
            <div className="carriers-table-wrapper">
              <h3>Carrier Listings</h3>
              
              {carriersLoading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '36px', marginBottom: '12px', display: 'block' }}></i>
                  <p style={{ fontSize: '16px', fontWeight: '500' }}>Loading carriers...</p>
                </div>
              ) : carriers.length === 0 ? (
                <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
                  <i className="fa-solid fa-inbox" style={{ fontSize: '48px', marginBottom: '16px', display: 'block', opacity: 0.3 }}></i>
                  <p style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>No carriers found</p>
                  <p style={{ fontSize: '14px', color: '#9ca3af' }}>Carriers will appear here once they sign up on the platform.</p>
                </div>
              ) : (
                <table className="carriers-table">
                  <thead>
                    <tr>
                      <th>CARRIER NAME</th>
                      <th>DOT / MC</th>
                      <th>EQUIPMENT</th>
                      <th>SERVICE AREAS</th>
                      <th>RATING</th>
                      <th>TOTAL LOADS</th>
                      <th>STATUS</th>
                      <th>CONTACT</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carriers.filter(c => {
                      // Search filter
                      const searchLower = searchQuery.toLowerCase();
                      const matchesSearch = !searchQuery || 
                        c.name?.toLowerCase().includes(searchLower) ||
                        c.company_name?.toLowerCase().includes(searchLower) ||
                        c.email?.toLowerCase().includes(searchLower) ||
                        c.dot_number?.toString().includes(searchLower) ||
                        c.mc_number?.toString().includes(searchLower);

                      // Apply region filter
                      if (selectedRegion !== 'All Regions' && c.service_areas) {
                        const regions = Array.isArray(c.service_areas) ? c.service_areas : [c.service_areas];
                        if (!regions.some(r => r.toLowerCase().includes(selectedRegion.toLowerCase()))) {
                          return false;
                        }
                      }
                      // Apply equipment filter
                      if (selectedEquipment !== 'All Equipment' && c.equipment_types) {
                        const equipment = Array.isArray(c.equipment_types) ? c.equipment_types : [c.equipment_types];
                        if (!equipment.some(e => e.toLowerCase().includes(selectedEquipment.toLowerCase().replace(' ', '')))) {
                          return false;
                        }
                      }
                      // Apply rating filter
                      if (selectedRating !== 'All Ratings') {
                        const minRating = parseFloat(selectedRating.match(/[\d.]+/)?.[0] || '0');
                        if ((c.rating || 0) < minRating) {
                          return false;
                        }
                      }
                      return matchesSearch;
                    }).map((c, idx) => (
                      <tr key={c.id || idx}>
                        <td className="c-name">
                          <div className="avatar" aria-hidden>{(c.name || 'NA').split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}</div>
                          <div className="c-name-details">
                            <div className="c-name-title">{c.name || 'Unknown Carrier'}</div>
                            <div className="c-location">{c.company_name || 'N/A'}</div>
                          </div>
                        </td>
                        <td className="c-dotmc">
                          <div>DOT {c.dot_number || 'N/A'}</div>
                          <div>MC {c.mc_number || 'N/A'}</div>
                        </td>
                        <td>{Array.isArray(c.equipment_types) ? c.equipment_types.join(', ') : c.equipment_types || 'Various'}</td>
                        <td>{Array.isArray(c.service_areas) ? c.service_areas.join(', ') : c.service_areas || 'All Regions'}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fa-solid fa-star" style={{ color: '#fbbf24', fontSize: '14px' }}></i>
                            {(c.rating || 0).toFixed(1)}
                          </span>
                        </td>
                        <td>{c.total_loads || 0}</td>
                        <td>
                          <span className={`int-status-badge ${(c.status || 'active').toLowerCase()}`}>
                            {c.status || 'Active'}
                          </span>
                        </td>
                        <td className="c-contact">
                          <div style={{ fontSize: '13px' }}>{c.email || 'N/A'}</div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>{c.phone || 'N/A'}</div>
                        </td>
                        <td>
                          <button className="btn small-cd" style={{ padding: '6px 12px', fontSize: '12px' }}>
                            View Profile
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="listings-summary">
            <div className="summary-box">
              <i className="fa-solid fa-circle-info" />
              <span>{carriers.length} carriers available · Filter by region, equipment, and rating to find the best match for your loads.</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Service Providers' && (
        <div className="tab-content">
          <div className="provider-listings-card">
            <h3>Available Service Providers</h3>
            
            {/* Category Filter */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '20px',
                    border: selectedCategory === cat ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    background: selectedCategory === cat ? '#dbeafe' : 'white',
                    color: selectedCategory === cat ? '#1e40af' : '#64748b',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: selectedCategory === cat ? '600' : '500',
                    transition: 'all 0.2s'
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {providersLoading ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '36px', marginBottom: '12px', display: 'block' }}></i>
                <p style={{ fontSize: '16px', fontWeight: '500' }}>Loading service providers...</p>
              </div>
            ) : serviceProviders.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
                <i className="fa-solid fa-inbox" style={{ fontSize: '48px', marginBottom: '16px', display: 'block', opacity: 0.3 }}></i>
                <p style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>No service providers found</p>
                <p style={{ fontSize: '14px', color: '#9ca3af' }}>
                  {selectedCategory === 'All Categories' 
                    ? 'Service providers will appear here once they register on the platform.'
                    : `No ${selectedCategory.toLowerCase()} providers available. Try selecting a different category.`}
                </p>
              </div>
            ) : (
              <div className="providers-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '20px',
                marginTop: '20px'
              }}>
                {serviceProviders.map((p, i) => (
                  <div key={p.id || i} style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '20px',
                    background: p.featured ? 'linear-gradient(135deg, #fef3c7 0%, #fef9e7 100%)' : 'white',
                    boxShadow: p.featured ? '0 4px 12px rgba(251, 191, 36, 0.2)' : '0 2px 8px rgba(0,0,0,0.05)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = p.featured ? '0 4px 12px rgba(251, 191, 36, 0.2)' : '0 2px 8px rgba(0,0,0,0.05)';
                  }}
                  >
                    {p.featured && (
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        background: '#fbbf24',
                        color: 'white',
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        ★ Featured
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                      <div style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #3b82f6, #1e40af)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '20px',
                        fontWeight: '700'
                      }}>
                        {(p.name || 'SP').split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#1e293b', marginBottom: '4px' }}>
                          {p.name || 'Unknown Provider'}
                        </div>
                        <div style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '600',
                          background: '#dbeafe',
                          color: '#1e40af'
                        }}>
                          {p.category || 'General'}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
                        {Array.isArray(p.services) ? p.services.join(', ') : p.services || 'Various services available'}
                      </div>
                    </div>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingTop: '16px',
                      borderTop: '1px solid #e2e8f0',
                      marginBottom: '16px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <i className="fa-solid fa-star" style={{ color: '#fbbf24', fontSize: '14px' }}></i>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>
                          {(p.rating || 0).toFixed(1)}
                        </span>
                        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                          ({p.total_clients || 0} clients)
                        </span>
                      </div>
                      <span className={`int-status-badge ${(p.status || 'active').toLowerCase()}`}>
                        {p.status || 'Active'}
                      </span>
                    </div>

                    <div style={{ marginBottom: '16px', fontSize: '13px', color: '#6b7280' }}>
                      <div style={{ marginBottom: '6px' }}>
                        <i className="fa-solid fa-location-dot" style={{ marginRight: '8px', color: '#3b82f6' }}></i>
                        {Array.isArray(p.coverage_areas) ? p.coverage_areas.join(', ') : p.coverage_areas || 'Nationwide'}
                      </div>
                      {p.phone && (
                        <div style={{ marginBottom: '6px' }}>
                          <i className="fa-solid fa-phone" style={{ marginRight: '8px', color: '#3b82f6' }}></i>
                          {p.phone}
                        </div>
                      )}
                      {p.email && (
                        <div>
                          <i className="fa-solid fa-envelope" style={{ marginRight: '8px', color: '#3b82f6' }}></i>
                          {p.email}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn small-cd" style={{ flex: 1, padding: '10px', fontSize: '13px' }}>
                        <i className="fa-solid fa-phone" style={{ marginRight: '6px' }}></i>
                        Contact
                      </button>
                      <button className="btn small ghost-cd" style={{ flex: 1, padding: '10px', fontSize: '13px' }}>
                        <i className="fa-solid fa-info-circle" style={{ marginRight: '6px' }}></i>
                        Learn More
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="listings-summary">
            <div className="summary-box">
              <i className="fa-solid fa-circle-info" />
              <span>{serviceProviders.length} service providers available · Browse by category to find specialized services for your business needs.</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Insurance' && (
        <div className="tab-content">
          <div className="provider-listings-card">
            <h3>Insurance Providers</h3>
            <div className="providers-table-wrapper">
              <table className="providers-table">
                <thead>
                  <tr>
                    <th>PROVIDER</th>
                    <th>CATEGORY</th>
                    <th>SERVICES</th>
                    <th>RATING</th>
                    <th>STATUS</th>
                    <th>CONTACT</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {insuranceProviders.map((p, i) => (
                    <tr key={i}>
                      <td className="p-name"><div className={`avatar small icon-bg`}><i className={p.icon} aria-hidden="true"/></div><div className="p-details"><div className="p-title">{p.name}</div><div className="p-sub">{p.sub}</div></div></td>
                      <td><span className={`int-status-badge blue ${p.category.toLowerCase().replace(/\s+/g,'-')}`}>{p.category}</span></td>
                      <td className="p-services">{p.services}</td>
                      <td className="p-rating"><i className="fa-solid fa-star"/> <span>{p.rating}</span></td>
                      <td><span className={`int-status-badge ${p.status.toLowerCase().replace(/\s+/g,'-')} ${p.status.toLowerCase().includes('verified') ? 'active' : ''} ${p.status.toLowerCase().includes('pending') ? 'warning' : ''}`.trim()}>{p.status}</span></td>
                      <td className="p-contact">{p.contact === 'email' ? <i className="fa-solid fa-envelope"/> : p.contact === 'phone' ? <i className="fa-solid fa-phone"/> : <i className="fa-solid fa-globe"/>}</td>
                      <td className="p-action"><i className="fa-solid fa-ellipsis-h"></i></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="listings-summary">
          <div className="summary-box">
            <i className="fa-solid fa-circle-info" />
            <span>4 insurance providers offer same-day cargo coverage · 3 compliance partners have auto-renew integration support.</span>
          </div>
        </div>
        </div>
      )}

      {activeTab === 'Technology' && (
        <div className="tab-content">
          <div className="tech-grid">
            {techProviders.map((p, i) => (
              <div key={i} className="tech-card">
                <div className="tech-top">
                    <div className={`tech-icon ${p.iconClass || ''}`}><i className={p.icon} aria-hidden="true" /></div>
                    <div className="tech-top-right"><div className="tech-title">{p.name}</div><div className={`tech-pill ${p.tagClass || ''}`}>{p.iconLabel || ''}</div></div>
                    <div className="tech-rating"><i className="fa-solid fa-star"/> {p.rating}</div>
                  </div>

                <div className="tech-desc">{p.title}</div>

                <div className="tech-bottom">
                  <div className={`int-status-badge active`}>{p.status}</div>
                  <button className="btn small-cd">{p.action}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="listings-summary">
          <div className="summary-box">
            <i className="fa-solid fa-circle-info" />
            <span>6 tools matches your company type · 3 automation ready · 2 integrations pre-approved.</span>
          </div>
        </div>
        </div>
      )}

      {activeTab === 'AI Matches' && (
        <div className="tab-content ai-matches">
          <div className='headings-ai-tab'>Carrier Matches</div>
          <div className="carrier-listings-card">
            <div className="carriers-matches-table">
              {/* reuse carriers-table styles so AI matches keep same theme */}
              <table className="carriers-table">
              <thead>
                <tr>
                  <th>CARRIER</th>
                  <th>REGION</th>
                  <th>EQUIPMENT</th>
                  <th>MATCH %</th>
                  <th>COMPLIANCE</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {carrierMatches.map((c, i) => (
                  <tr key={i}>
                    <td className="c-name">
                      <div className={`avatar small ${c.avatarClass}`} aria-hidden><i className={c.avatarIcon} aria-hidden="true"/></div>
                      <div className="c-name-details">
                        <div className="c-name-title">{c.name}</div>
                        {/* reuse c-location styling for the subtitle */}
                        <div className="c-location">{c.subtitle}</div>
                      </div>
                    </td>
                    <td>{c.region}</td>
                    <td>{c.equipment}</td>
                    <td className="c-rating">{c.match}</td>
                    <td><span className={`int-status-badge ${c.compliance}`}>{c.compliance}</span></td>
                    <td className="c-actions"><i className='fa fa-ellipsis-h'></i></td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
          <div className='headings-ai-tab' style={{ marginTop: '20px' }}>Service Provider Matches</div>
          <div className="service-matches-wrap">
            <div className="matches-grid">
              <div className="match-card">
                <div className="match-top">
                  <div className="match-left">
                    <div className="tech-icon match-avatar"><i className="fa-solid fa-shield-halved"/></div>
                    <div className="match-meta">
                      <div className="match-title">LoadSure</div>
                      <div className="match-sub">Insurance</div>
                      <div className="match-desc">Lower cargo coverage rates</div>
                    </div>
                  </div>
                  <div className="match-percent">96%</div>
                </div>
                <div className="match-cta"><button className="btn small-cd">Contact ›</button></div>
              </div>

              <div className="match-card">
                <div className="match-top">
                  <div className="match-left">
                    <div className="tech-icon match-avatar"><i className="fa-solid fa-clipboard-check"/></div>
                    <div className="match-meta">
                      <div className="match-title">FleetGuard</div>
                      <div className="match-sub">Compliance</div>
                      <div className="match-desc">Auto-renew FMCSA docs</div>
                    </div>
                  </div>
                  <div className="match-percent">92%</div>
                </div>
                <div className="match-cta"><button className="btn small-cd">Connect ›</button></div>
              </div>

              <div className="match-card">
                <div className="match-top">
                  <div className="match-left">
                    <div className="tech-icon match-avatar"><i className="fa-solid fa-sack-dollar"/></div>
                    <div className="match-meta">
                      <div className="match-title">OpenFactoring</div>
                      <div className="match-sub">Factoring</div>
                      <div className="match-desc">Quick pay for carriers</div>
                    </div>
                  </div>
                  <div className="match-percent">90%</div>
                </div>
                <div className="match-cta"><button className="btn small-cd">View ›</button></div>
              </div>
            </div>
          </div>
          <div className='headings-ai-tab' style={{ marginTop: '20px' }}>Technology Matches</div>
          <div className="tech-matches-wrap">
            <div className="matches-grid">
              <div className="match-card">
                <div className="match-top">
                  <div className="match-left">
                    <div className="tech-icon match-avatar"><i className="fa-solid fa-clipboard-check" /></div>
                    <div className="match-meta">
                      <div className="match-title">FreightELD</div>
                      <div className="match-sub">ELD & Compliance</div>
                      <div className="match-desc">API Integration</div>
                    </div>
                  </div>
                  <div className="match-percent">98%</div>
                </div>
                <div className="match-cta"><button className="btn small-cd">Connect ›</button></div>
              </div>

              <div className="match-card">
                <div className="match-top">
                  <div className="match-left">
                    <div className="tech-icon ic-ai match-avatar"><i className="fa-solid fa-robot" /></div>
                    <div className="match-meta">
                      <div className="match-title">WOFA.ai</div>
                      <div className="match-sub">Automation / AI</div>
                      <div className="match-desc">Workflow Assistant</div>
                    </div>
                  </div>
                  <div className="match-percent">95%</div>
                </div>
                <div className="match-cta"><button className="btn small-cd">View ›</button></div>
              </div>

              <div className="match-card">
                <div className="match-top">
                  <div className="match-left">
                    <div className="tech-icon ic-accounting match-avatar"><i className="fa-solid fa-calculator" /></div>
                    <div className="match-meta">
                      <div className="match-title">QuickBooks</div>
                      <div className="match-sub">Accounting</div>
                      <div className="match-desc">API / OAuth</div>
                    </div>
                  </div>
                  <div className="match-percent">91%</div>
                </div>
                <div className="match-cta"><button className="btn small-cd">Connect ›</button></div>
              </div>
            </div>
          </div>
          <div className='headings-ai-tab' style={{ marginTop: '20px' }}>Rate & market Insights</div>
          <div className="aii-insights-row">
              <div className="match-card insight-green">
                <div className="aii-insight-title">Rate Increase</div>
                <div className="aii-insight-desc">MN → TX reefer rates are up 4.2% — consider posting more loads.</div>
                <div className="aii-insight-cta"><button className="btn small-cd">Post Load</button></div>
              </div>
              <div className="match-card insight-blue">
                <div className="aii-insight-title">New Carriers</div>
                <div className="aii-insight-desc">5 new carriers available in your service area.</div>
                <div className="aii-insight-cta"><button className="btn small-cd">View Carriers</button></div>
              </div>
              <div className="match-card insight-purple">
                <div className="aii-insight-title">Top Lane</div>
                <div className="aii-insight-desc">Top performing lane: Midwest → South (avg $2.92/mi).</div>
                <div className="aii-insight-cta"><button className="btn small-cd ">Save Insight</button></div>
              </div>
            </div>
            <div className='headings-ai-tab' style={{ marginTop: '20px' }}>Opportunities</div>
            <div className="opps-list">
              <div className="opp-item">
                <div className="opp-left">
                  <div className="opp-icon opp-icon-warning"><i className="fa-solid fa-shield-halved"/></div>
                  <div>
                    <div className="opp-title">Insurance Provider Missing</div>
                    <div className="opp-desc">You haven't connected an insurance provider — save up to 12% on coverage.</div>
                  </div>
                </div>
                <div className="opp-cta"><button className="btn small-cd">Connect</button></div>
              </div>

              <div className="opp-item">
                <div className="opp-left">
                  <div className="opp-icon opp-icon-alert"><i className="fa-solid fa-triangle-exclamation"/></div>
                  <div>
                    <div className="opp-title">Compliance Documents Expiring</div>
                    <div className="opp-desc">2 compliance documents expiring soon — connect with FleetGuard.</div>
                  </div>
                </div>
                <div className="opp-cta"><button className="btn small-cd">Fix Compliance</button></div>
              </div>

              <div className="opp-item">
                <div className="opp-left">
                  <div className="opp-icon opp-icon-integration"><i className="fa-solid fa-plug"/></div>
                  <div>
                    <div className="opp-title">Integration Opportunities</div>
                    <div className="opp-desc">3 tech tools integrate directly with your current setup — Connect now.</div>
                  </div>
                </div>
                <div className="opp-cta"><button className="btn small-cd">Connect Now</button></div>
              </div>
            </div>

            <div className="ai-analysis-box">
              <div className="ai-analysis-left"><div className="aai-icon"><i className="fa-solid fa-robot"/></div></div>
              <div className="ai-analysis-body">
                <div className="ai-analysis-title">AI Analysis Complete</div>
                <div className="ai-analysis-desc">AI scanned 1,243 regional carriers • Found 18 matches above 90% fit • 4 service providers recommended based on your last 5 loads.</div>
              </div>
            </div>

        </div>
      )}
      {showAddLoads && <AddLoads onClose={handleLoadAdded} isShipper={true} />}

      {/* Offers Modal */}
      {offersModalOpen && selectedLoadForOffers && (
        <div className="modal-overlay" onClick={() => setOffersModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{
            maxWidth: '700px',
            padding: '30px',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '24px', color: '#1e293b' }}>
                  Carrier Offers
                </h2>
                <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '14px' }}>
                  Load {selectedLoadForOffers.load_id}
                </p>
              </div>
              <button 
                onClick={() => setOffersModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#64748b'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: '25px', padding: '15px', background: '#f8fafc', borderRadius: '8px' }}>
              <div style={{ fontSize: '16px', fontWeight: '600', color: '#1e293b', marginBottom: '8px' }}>
                {selectedLoadForOffers.origin} → {selectedLoadForOffers.destination}
              </div>
              <div style={{ fontSize: '14px', color: '#64748b' }}>
                Equipment: {selectedLoadForOffers.equipment_type || 'N/A'} | 
                Pickup: {selectedLoadForOffers.pickup_date || 'TBD'} | 
                Posted Rate: ${selectedLoadForOffers.rate || 'Negotiable'}
              </div>
            </div>

            {offersLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6' }}></i>
                <p style={{ marginTop: '10px', color: '#64748b' }}>Loading offers...</p>
              </div>
            ) : loadOffers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                <i className="fa-solid fa-inbox" style={{ fontSize: '3rem', marginBottom: '15px', display: 'block' }}></i>
                <p style={{ fontSize: '16px', fontWeight: '500' }}>No offers yet</p>
                <p style={{ fontSize: '14px', marginTop: '5px' }}>Carriers will submit bids on your load from the marketplace.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {loadOffers.map((offer, index) => (
                  <div key={index} style={{
                    padding: '20px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: offer.status === 'accepted' ? '#ecfdf5' : 
                               offer.status === 'rejected' ? '#fef2f2' : 'white'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '12px'
                    }}>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: '600', color: '#1e293b' }}>
                          {offer.carrier_name}
                        </div>
                        <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                          Submitted {new Date(offer.submitted_at * 1000).toLocaleString()}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '24px',
                        fontWeight: '700',
                        color: '#3b82f6'
                      }}>
                        ${offer.rate}
                      </div>
                    </div>

                    {offer.eta && (
                      <div style={{ marginBottom: '8px', fontSize: '14px', color: '#64748b' }}>
                        <strong>ETA:</strong> {offer.eta}
                      </div>
                    )}

                    {offer.notes && (
                      <div style={{ 
                        marginBottom: '15px', 
                        padding: '12px', 
                        background: '#f8fafc', 
                        borderRadius: '6px',
                        fontSize: '14px',
                        color: '#475569'
                      }}>
                        <strong style={{ display: 'block', marginBottom: '4px' }}>Notes:</strong>
                        {offer.notes}
                      </div>
                    )}

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '12px'
                    }}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: offer.status === 'accepted' ? '#10b981' : 
                                   offer.status === 'rejected' ? '#ef4444' : '#3b82f6',
                        color: 'white'
                      }}>
                        {offer.status === 'accepted' ? '✓ Accepted' :
                         offer.status === 'rejected' ? '✗ Rejected' :
                         '⏳ Pending'}
                      </span>

                      {offer.status === 'pending' && (
                        <button
                          onClick={() => handleAcceptOffer(offer)}
                          disabled={acceptingOffer}
                          style={{
                            marginLeft: 'auto',
                            padding: '8px 16px',
                            background: acceptingOffer ? '#cbd5e1' : '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: acceptingOffer ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {acceptingOffer ? 'Accepting...' : 'Accept Carrier'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: '25px', textAlign: 'center' }}>
              <button
                onClick={() => setOffersModalOpen(false)}
                style={{
                  padding: '10px 24px',
                  background: 'transparent',
                  color: '#64748b',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
