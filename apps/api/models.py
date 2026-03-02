# File: apps/api/models.py
from pydantic import BaseModel, EmailStr
from enum import Enum
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime

# --- 1. Enums (Must be defined first) ---

class Role(str, Enum):
    CARRIER = "carrier"
    DRIVER = "driver"
    SHIPPER = "shipper"
    BROKER = "broker"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

class OnboardingStep(str, Enum):
    WELCOME = "WELCOME"
    SELECT_ROLE = "SELECT_ROLE"
    COLLECT_INFO = "COLLECT_INFO"
    UPLOAD_DOC = "UPLOAD_DOC"
    REVIEW_SCORE = "REVIEW_SCORE"
    CREATE_ACCOUNT = "CREATE_ACCOUNT"
    COMPLETED = "COMPLETED"

# --- 2. Auth Models ---

class UserSignup(BaseModel):
    email: EmailStr
    password: str
    name: str
    phone: Optional[str] = None
    role: Role
    company_name: Optional[str] = None

class SignupResponse(BaseModel):
    user_id: str
    email: str
    phone: Optional[str] = None
    role: str
    requires_email_verification: bool = True
    requires_phone_verification: bool = False
    message: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: Dict[str, Any]

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class ProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    dot_number: Optional[str] = None
    mc_number: Optional[str] = None
    cdl_number: Optional[str] = None
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    billing_address: Optional[str] = None
    address: Optional[str] = None
    profile_picture_url: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    # Generic profile fields (used by admin profile + optional for others)
    department: Optional[str] = None
    time_zone: Optional[str] = None
    language: Optional[str] = None
    location: Optional[str] = None
    show_email_internal_only: Optional[bool] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    utc_offset_minutes: Optional[int] = None
    trusted_devices_enabled: Optional[bool] = None

    # Shipper/Broker business profile fields
    business_type: Optional[str] = None
    freight_type: Optional[str] = None
    regions_of_operation: Optional[str] = None

    # Shipper/Broker onboarding/profile fields
    tax_id: Optional[str] = None
    website: Optional[str] = None
    contact_title: Optional[str] = None


class UserSettings(BaseModel):
    language: Optional[str] = None
    time_zone: Optional[str] = None
    date_format: str = "mdy"  # mdy | dmy | ymd
    start_dashboard_view: str = "dashboard"
    auto_save_edits: bool = True
    email_digest_enabled: bool = True

    # Driver/Carrier UI preferences (safe for all roles; privileged roles can use them too,
    # but biometric auth enforcement is separate and remains backend-only).
    notification_preferences: Dict[str, bool] = {}
    calendar_sync: Optional[str] = None
    calendar_reminders_enabled: bool = True

    # Accessibility (explicitly excludes voice commands; that feature is not enabled here)
    font_size: str = "Medium"  # Small | Medium | Large
    high_contrast_mode: bool = False
    screen_reader_compatible: bool = True


class UserSettingsUpdate(BaseModel):
    language: Optional[str] = None
    time_zone: Optional[str] = None
    date_format: Optional[str] = None
    start_dashboard_view: Optional[str] = None
    auto_save_edits: Optional[bool] = None
    email_digest_enabled: Optional[bool] = None

    notification_preferences: Optional[Dict[str, bool]] = None
    calendar_sync: Optional[str] = None
    calendar_reminders_enabled: Optional[bool] = None
    font_size: Optional[str] = None
    high_contrast_mode: Optional[bool] = None
    screen_reader_compatible: Optional[bool] = None

class UserProfile(BaseModel):
    uid: str
    email: str
    name: str
    phone: Optional[str] = None
    role: Role
    status: Optional[str] = None  # active | disabled (legacy accounts may not set this)
    biometricEnabled: Optional[bool] = None
    company_name: Optional[str] = None
    dot_number: Optional[str] = None
    mc_number: Optional[str] = None
    is_verified: bool = False
    mfa_enabled: bool = False
    onboarding_completed: bool = False
    onboarding_step: str = "WELCOME"
    onboarding_score: int = 0
    created_at: Optional[datetime] = None
    profile_picture_url: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    # Generic profile fields (used by admin profile + optional for others)
    department: Optional[str] = None
    time_zone: Optional[str] = None
    language: Optional[str] = None
    location: Optional[str] = None
    show_email_internal_only: Optional[bool] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    utc_offset_minutes: Optional[int] = None
    trusted_devices_enabled: Optional[bool] = None

    # Shipper/Broker business profile fields
    business_type: Optional[str] = None
    freight_type: Optional[str] = None
    regions_of_operation: Optional[str] = None

    # Shipper/Broker onboarding/profile fields
    tax_id: Optional[str] = None
    website: Optional[str] = None
    contact_title: Optional[str] = None

# --- 3. Chat Models (Reference Enums above) ---

class ChatSession(BaseModel):
    session_id: str
    step: OnboardingStep = OnboardingStep.WELCOME
    role: Optional[Role] = None
    collected_data: Dict[str, Any] = {}
    document_ids: List[str] = []
    documents_with_scores: List[Dict[str, Any]] = []  # Track each doc with its score
    temp_score: float = 0.0  # Latest document score
    cumulative_score: float = 0.0  # Average of all documents
    missing_fields_across_docs: List[str] = []  # Aggregate missing fields
    compliance_score: float = 0.0

class ChatResponse(BaseModel):
    message: str
    next_step: OnboardingStep
    suggestions: List[str] = []
    ui_action: Optional[str] = None
    redirect_url: Optional[str] = None
    data_payload: Optional[Dict[str, Any]] = None

# --- 4. Onboarding Models ---

class OnboardingDataRequest(BaseModel):
    """Request model for onboarding data."""
    role: str
    data: Dict[str, Any]

class ChatbotAccountCreationRequest(BaseModel):
    """Request model for creating account from chatbot data."""
    role: str
    collected_data: Dict[str, Any]
    document_ids: List[str] = []
    documents: List[Dict[str, Any]] = []  # Full document data with scores
    compliance_score: float = 0.0
    missing_fields: List[str] = []  # Fields missing across all documents

class OnboardingStatusResponse(BaseModel):
    """Onboarding status response."""
    onboarding_completed: bool
    onboarding_step: str
    onboarding_score: int
    is_complete: bool
    current_step: Optional[str] = None
    progress: int = 0


# --- 5. Load Management Models (3-Step Wizard) ---

class AppointmentType(str, Enum):
    """Pickup/Delivery appointment types."""
    DROP_HOOK = "Drop & Hook"
    LIVE_LOAD = "Live Load"
    LIVE_UNLOAD = "Live Unload"
    FCFS = "FCFS"
    APPOINTMENT_REQUIRED = "Appointment Required"


class EquipmentType(str, Enum):
    """Equipment types for loads."""
    DRY_VAN = "Dry Van"
    REEFER = "Reefer"
    FLATBED = "Flatbed"
    STEPDECK = "Stepdeck"
    POWER_ONLY = "Power Only"
    HOTSHOT = "Hotshot"
    BOX_TRUCK = "Box Truck"
    CONESTOGA = "Conestoga"


class LoadType(str, Enum):
    """Load types."""
    FULL_TRUCKLOAD = "Full Truckload"
    LTL = "LTL"
    PARTIAL = "Partial"
    DEDICATED = "Dedicated"
    ROUND_TRIP = "Round Trip"
    MULTI_STOP = "Multi-Stop"


class RateType(str, Enum):
    """Rate calculation types."""
    FLAT_RATE = "Flat Rate"
    PER_MILE = "Per Mile"
    PER_STOP = "Per Stop"
    HOURLY = "Hourly"


class PaymentTerms(str, Enum):
    """Payment terms options."""
    QUICK_PAY = "Quick Pay"
    SEVEN_DAYS = "7 Days"
    FIFTEEN_DAYS = "15 Days"
    THIRTY_DAYS = "30 Days"
    CUSTOM = "Custom"


class VisibilityType(str, Enum):
    """Load visibility options."""
    PUBLIC = "Public"
    NETWORK_ONLY = "My Network Only"
    SELECTED_CARRIERS = "Selected Carriers Only"


class LoadStatus(str, Enum):
    """Load lifecycle statuses."""
    DRAFT = "draft"
    POSTED = "posted"
    TENDERED = "tendered"
    ACCEPTED = "accepted"
    COVERED = "covered"  # Load has been assigned to a carrier
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


# Step 1: Route & Equipment
class LoadStep1Create(BaseModel):
    """Step 1 - Route & Equipment information."""
    # Route Information
    origin: str  # Required
    destination: str  # Required
    pickup_date: str  # Required (ISO format or date string)
    delivery_date: Optional[str] = None
    pickup_appointment_type: Optional[AppointmentType] = None
    delivery_appointment_type: Optional[AppointmentType] = None
    
    # Additional Routes (multi-stop loads)
    additional_routes: Optional[List[Dict[str, Any]]] = []  # [{"location": "Dallas, TX", "type": "pickup", "date": "2024-01-15"}]
    
    # Equipment
    equipment_type: EquipmentType  # Required
    load_type: Optional[LoadType] = None
    weight: float  # Required (in lbs)
    pallet_count: Optional[int] = None


class LoadStep1Response(BaseModel):
    """Response after Step 1 completion."""
    load_id: str
    load_number: Optional[str] = None
    estimated_distance: Optional[float] = None  # miles
    estimated_transit_time: Optional[float] = None  # hours
    message: str = "Load ID generated successfully"


# Step 2: Price & Details
class LoadStep2Update(BaseModel):
    """Step 2 - Pricing & Details."""
    # Pricing
    rate_type: RateType  # Required
    linehaul_rate: float  # Required
    fuel_surcharge: Optional[float] = None
    advanced_charges: Optional[List[Dict[str, Any]]] = []  # [{"name": "Detention", "amount": 150}]
    
    # Details
    commodity: Optional[str] = None
    special_requirements: Optional[List[str]] = []  # e.g., ["Team", "Hazmat", "TWIC"]
    payment_terms: Optional[PaymentTerms] = PaymentTerms.THIRTY_DAYS
    notes: Optional[str] = None  # Driver instructions


# Step 3: Visibility & Preferences
class LoadStep3Update(BaseModel):
    """Step 3 - Visibility & Automation."""
    # Visibility
    visibility: VisibilityType = VisibilityType.PUBLIC
    selected_carriers: Optional[List[str]] = []  # Carrier IDs if SELECTED_CARRIERS
    
    # Automation
    auto_match_ai: bool = True
    instant_booking: bool = False  # Allow carriers to book without approval
    auto_post_to_freightpower: bool = True
    auto_post_to_truckstop: bool = False
    auto_post_to_123loadboard: bool = False
    
    # Notifications
    notify_on_carrier_views: bool = True
    notify_on_offer_received: bool = True
    notify_on_load_covered: bool = True


# Complete Load Model (All Steps Combined)
class LoadComplete(BaseModel):
    """Complete load model with all data from 3 steps."""
    # System fields
    load_id: str
    load_number: Optional[str] = None
    created_by: str  # User UID
    created_at: float  # Timestamp
    updated_at: float  # Timestamp
    status: LoadStatus = LoadStatus.DRAFT

    # Normalized ownership fields (backward compatible)
    payer_uid: Optional[str] = None
    payer_role: Optional[str] = None  # broker/shipper
    broker_id: Optional[str] = None
    carrier_uid: Optional[str] = None

    # Assignment / lifecycle fields (optional; may be absent on drafts/marketplace loads)
    assigned_carrier: Optional[str] = None
    assigned_carrier_id: Optional[str] = None
    carrier_id: Optional[str] = None
    assigned_driver: Optional[str] = None
    assigned_driver_id: Optional[str] = None
    assigned_driver_name: Optional[str] = None
    driver_assignment_status: Optional[str] = None  # pending, accepted, rejected
    offers: Optional[List[Dict[str, Any]]] = None
    offers_count: Optional[int] = None

    # Workflow timestamps (epoch seconds)
    picked_up_at: Optional[float] = None
    delivered_at: Optional[float] = None
    pod_submitted_at: Optional[float] = None
    completed_at: Optional[float] = None

    # Derived performance fields
    on_time: Optional[bool] = None
    
    # Step 1: Route & Equipment
    origin: str
    destination: str
    pickup_date: str
    delivery_date: Optional[str] = None
    pickup_appointment_type: Optional[str] = None
    delivery_appointment_type: Optional[str] = None
    equipment_type: str
    load_type: Optional[str] = None
    weight: float
    pallet_count: Optional[int] = None
    estimated_distance: Optional[float] = None
    estimated_transit_time: Optional[float] = None
    
    # Step 2: Price & Details
    rate_type: Optional[str] = None
    linehaul_rate: Optional[float] = None
    advanced_charges: Optional[List[Dict[str, Any]]] = []
    commodity: Optional[str] = None
    special_requirements: Optional[List[str]] = []
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    
    # Step 3: Visibility & Automation
    visibility: Optional[str] = None
    selected_carriers: Optional[List[str]] = []
    auto_match_ai: bool = True
    instant_booking: bool = False
    auto_post_to_freightpower: bool = True
    auto_post_to_truckstop: bool = False
    auto_post_to_123loadboard: bool = False
    notify_on_carrier_views: bool = True
    notify_on_offer_received: bool = True
    notify_on_load_covered: bool = True
    
    # Calculated fields
    total_rate: Optional[float] = None
    
    # Metadata
    metadata: Dict[str, Any] = {}


class LoadResponse(BaseModel):
    """Standard load response."""
    load: LoadComplete
    message: str = "Success"


class LoadListResponse(BaseModel):
    """Response for listing loads."""
    loads: List[LoadComplete]
    total: int
    page: int = 1
    page_size: int = 20


# AI-Generated Instructions
class GenerateInstructionsRequest(BaseModel):
    """Request for AI-generated driver instructions."""
    load_id: str
    origin: str
    destination: str
    equipment_type: str
    commodity: Optional[str] = None
    special_requirements: Optional[List[str]] = []


class GenerateInstructionsResponse(BaseModel):
    """Response with AI-generated instructions."""
    instructions: str
    load_id: str

# --- 6. Shipper & Driver Load Management Models ---

class TenderOfferRequest(BaseModel):
    """Request for carrier to submit a tender offer/bid on a load."""
    rate: float
    notes: Optional[str] = None
    eta: Optional[str] = None  # Estimated delivery time


class AcceptCarrierRequest(BaseModel):
    """Request for shipper to accept a carrier for a load."""
    carrier_id: str
    carrier_name: Optional[str] = None
    offer_id: Optional[str] = None  # Reference to the offer being accepted
    notes: Optional[str] = None


class RejectOfferRequest(BaseModel):
    """Request for shipper to reject a carrier offer."""
    carrier_id: Optional[str] = None
    offer_id: Optional[str] = None  # Preferred method to identify the offer
    reason: Optional[str] = None


class DriverStatusUpdateRequest(BaseModel):
    """Request for driver to update load status."""
    new_status: str  # IN_TRANSIT or DELIVERED
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None  # Proof of delivery/pickup


class LoadStatusChangeLog(BaseModel):
    """Log entry for load status changes."""
    timestamp: float
    actor_uid: str
    actor_role: str
    old_status: str
    new_status: str
    notes: Optional[str] = None
    metadata: Dict[str, Any] = {}


class LoadActionResponse(BaseModel):
    """Generic response for load actions."""
    success: bool
    message: str
    load_id: Optional[str] = None
    new_status: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class OfferResponse(BaseModel):
    """Response containing offer details."""
    offer_id: str
    load_id: str
    carrier_id: str
    carrier_name: str
    rate: float
    notes: Optional[str] = None
    eta: Optional[str] = None
    status: str  # pending, accepted, rejected
    submitted_at: float


class OffersListResponse(BaseModel):
    """Response containing list of offers on a load."""
    load_id: str
    offers: List[OfferResponse]


# AI Calculation Models
class DistanceCalculationRequest(BaseModel):
    """Request for AI distance calculation."""
    origin: str
    destination: str


class DistanceCalculationResponse(BaseModel):
    """Response with distance and transit time."""
    distance_miles: float
    estimated_hours: float
    estimated_days: int
    confidence: float
    notes: Optional[str] = None


class LoadCostCalculationRequest(BaseModel):
    """Request for load cost calculation."""
    distance_miles: float
    rate_per_mile: float
    additional_charges: Optional[Dict[str, float]] = None


class LoadCostCalculationResponse(BaseModel):
    """Response with cost breakdown."""
    distance_miles: float
    rate_per_mile: float
    linehaul: float
    additional_charges: Dict[str, float]
    additional_total: float
    total_cost: float


# HERE Maps API Models
class GeocodeRequest(BaseModel):
    """Request for geocoding an address."""
    address: str
    limit: Optional[int] = 5


class GeocodeResponse(BaseModel):
    """Response with geocoded results."""
    results: List[Dict[str, Any]]


class ReverseGeocodeRequest(BaseModel):
    """Request for reverse geocoding coordinates."""
    lat: float
    lng: float


class ReverseGeocodeResponse(BaseModel):
    """Response with reverse geocoded address."""
    lat: float
    lng: float
    label: str
    address: Dict[str, Any]


class RouteRequest(BaseModel):
    """Request for route calculation."""
    origin: str
    destination: str
    waypoints: Optional[List[str]] = None
    transport_mode: Optional[str] = "truck"
    truck_type: Optional[str] = None
    height: Optional[float] = None
    width: Optional[float] = None
    length: Optional[float] = None
    weight: Optional[float] = None
    hazmat: Optional[bool] = False
    return_polyline: Optional[bool] = True


class RouteResponse(BaseModel):
    """Response with route information."""
    distance_miles: float
    distance_meters: float
    duration_seconds: int
    duration_hours: float
    estimated_days: int
    polyline: Optional[str] = None
    origin: str
    destination: str
    waypoints: Optional[List[str]] = None
    error: Optional[str] = None


class MatrixRequest(BaseModel):
    """Request for distance matrix calculation."""
    origins: List[str]
    destinations: List[str]
    transport_mode: Optional[str] = "truck"


class MatrixResponse(BaseModel):
    """Response with distance matrix."""
    matrix: List[Dict[str, Any]]
    origins: List[Dict[str, Any]]
    destinations: List[Dict[str, Any]]
    error: Optional[str] = None


class SnapshotRequest(BaseModel):
    """Request for static map snapshot."""
    center: Tuple[float, float]
    zoom: Optional[int] = 12
    width: Optional[int] = 800
    height: Optional[int] = 600
    markers: Optional[List[Dict[str, Any]]] = None
    polyline: Optional[str] = None


class SnapshotResponse(BaseModel):
    """Response with snapshot URL."""
    url: str