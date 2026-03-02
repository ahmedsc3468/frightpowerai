// src/components/Signup.jsx
import React, { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext' 
import '../styles/carrier/CarrierSignup.css'
import carrier_ob_1 from '../assets/carrier_ob_1.png'
import carrier_ob_2 from '../assets/carrier_ob_2.jpg'
import carrier_ob_3 from '../assets/carrier_ob_3.jpg'
import pattern_bg_signup from '../assets/pattern_bg_signup.svg'

export default function Signup(){
  const { signup, login, sendVerificationLink } = useAuth() // Added login & sendVerificationLink
  const navigate = useNavigate()
  const loc = useLocation()
  
  // Visuals
  const images = [carrier_ob_1, carrier_ob_2, carrier_ob_3]
  const [currentImg, setCurrentImg] = useState(0)

  // Form State
  const [role, setRole] = useState(loc.state?.role || 'carrier')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('') 
  const [password, setPassword] = useState('')
  
  // UI State
  const [showPassword, setShowPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Pre-fill Logic (from Chatbot)
  useEffect(()=>{
    if(loc.state) {
      if(loc.state.role) setRole(loc.state.role)
      // If Chatbot sent data
      if (loc.state.prefill) {
         const { company, cdl, score } = loc.state.prefill;
         if (company) setName(company);
         // You can store score/cdl in localStorage or handle it after verification
         if (score) console.log("User has pre-verified score:", score);
      }
    }
  },[loc])

  // Support deep links like /signup?role=carrier&invitation_id=INV-XXXX
  useEffect(() => {
    try {
      const qs = new URLSearchParams(loc.search || '')
      const roleFromQuery = String(qs.get('role') || '').trim()
      if (roleFromQuery) setRole(roleFromQuery)

      const invitationId = String(qs.get('invitation_id') || qs.get('invite') || '').trim()
      if (invitationId) {
        localStorage.setItem('fp_pending_invitation_id', invitationId)
      }
    } catch {
      // ignore
    }
  }, [loc.search])

  useEffect(()=>{
    const t = setInterval(()=> setCurrentImg((p)=> (p+1)%images.length), 2500)
    return ()=> clearInterval(t)
  },[])

  // --- CORE LOGIC ---
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if(!acceptedTerms) {
      return setError("Please accept the terms and conditions to continue.")
    }

    // Optional: Phone formatting
    let formattedPhone = phone.replace(/\D/g, ''); 
    if (!formattedPhone.startsWith('+') && formattedPhone.length > 0) {
        formattedPhone = "+92" + formattedPhone.replace(/^0+/, ''); 
    }

    setError('')
    setLoading(true)

    try {
      // 1. Create Account in Backend
      await signup(email, password, name, formattedPhone || null, role)

      // 2. Wait for Firebase Auth to propagate (fix for "Invalid JWT Signature")
      await new Promise(resolve => setTimeout(resolve, 1000))

      // 3. Sign In to Firebase (Client Side) to get the User Object
      // We need to be signed in to send the verification email
      const userCredential = await login(email, password)

      // 4. Send the Verification Link
      await sendVerificationLink(userCredential.user)

      // 5. Redirect to role-specific onboarding page
      const onboardingRoutes = {
        carrier: '/carrier-onboarding',
        driver: '/driver-onboarding',
        shipper: '/shipper-onboarding'
      }

      alert("Account created! A verification email has been sent to your inbox. Let's complete your onboarding.")
      navigate(onboardingRoutes[role] || '/carrier-onboarding')

    } catch (err) {
      console.error(err)
      setError(err.message || "Failed to create account. Please try again.")
    }
    
    setLoading(false)
  }

  return (
    <div className="carrier-signup-container carrier-login-page">
      <div className="carrier-signup-left">
        <img src={pattern_bg_signup} alt="Pattern" className="carrier-signup-pattern-bg"/>
        <div className="carrier-signup-form-bg">
          <h1 className="carrier-signup-title">Sign up to FreightPower AI</h1>
          <p className="carrier-signup-subtitle">
            Creating a <strong>{role.charAt(0).toUpperCase() + role.slice(1)}</strong> account
          </p>

          {error && (
            <div style={{
              backgroundColor: '#fee2e2', 
              color: '#dc2626', 
              padding: '12px', 
              borderRadius: '8px', 
              marginBottom: '20px',
              fontSize: '14px',
              border: '1px solid #fecaca'
            }}>
              <i className="fa-solid fa-circle-exclamation" style={{marginRight:8}}></i>
              {error}
            </div>
          )}

          <form className="carrier-signup-form" onSubmit={handleSubmit}>
            
            {/* Name */}
            <div className="carrier-signup-field input-with-icon">
              <label>Full Name</label>
              <div className="input-icon-wrap">
                <i className="fa-solid fa-user" aria-hidden="true" />
                <input 
                  type="text" 
                  placeholder="John Doe" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Email */}
            <div className="carrier-signup-field input-with-icon">
              <label>Email</label>
              <div className="input-icon-wrap">
                <i className="fa-solid fa-envelope" aria-hidden="true" />
                <input 
                  type="email" 
                  placeholder="name@company.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Phone (Optional now for email flow, but good to keep) */}
            <div className="carrier-signup-field input-with-icon">
              <label>Mobile Phone</label>
              <div className="input-icon-wrap">
                <i className="fa-solid fa-phone" aria-hidden="true" />
                <input 
                  type="tel" 
                  placeholder="0300 1234567" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            {/* Password */}
            <div className="carrier-signup-field input-with-icon">
              <label>Password</label>
              <div className="input-icon-wrap">
                <i className="fa-solid fa-lock" aria-hidden="true" />
                <input 
                  id="signup-password" 
                  type={showPassword ? 'text' : 'password'} 
                  placeholder="Create a strong password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Terms */}
            <div className="carrier-signup-field">
              <label className="terms-ctrl">
                <input 
                  type="checkbox" 
                  checked={acceptedTerms} 
                  onChange={(e) => setAcceptedTerms(e.target.checked)} 
                />
                <span> By continuing, you agree to FreightPower AI <a className="policy-link" href="#">Terms of Use</a> and <a className="policy-link" href="#">Privacy Policy</a></span>
              </label>
            </div>

            {/* Submit Button */}
            <div className="carrier-signup-bottom-actions">
              <div className="carrier-signup-login-actions">
                <button 
                  type="submit" 
                  className="carrier-signup-btn"
                  disabled={loading}
                  style={{ opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer' }}
                >
                  {loading ? 'Creating Account...' : 'Create & Verify Email'}
                </button>
              </div>

              <div className="divider"><span>Need help logging in? Ask our AI Assistant</span></div>

              <button type="button" className="google-signin">
                <i className="fa-brands fa-google google-icon" aria-hidden="true" />
                Sign Up with Google
              </button>

              <div className="carrier-signup-login-text">
                Already have an account? <a href="/login">Sign In</a>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="carrier-signup-right-bg-simple">
        <img src={'/src/assets/blue_bg_signup.svg'} alt="Blue Background" className="carrier-signup-bg-svg" />
        <div className="carrier-signup-img-block">
          <img src={images[currentImg]} alt="Onboarding" className="carrier-signup-img-top-simple"/>
        </div>
        <div className="carrier-signup-info-bottom">
          <div className="carrier-signup-img-indicators" style={{ background: 'transparent', minHeight: '24px', marginBottom: '0', marginTop: '0' }}>
            {images.map((_, idx)=> (
              <span key={idx} onClick={()=> setCurrentImg(idx)} className={ idx === currentImg ? "carrier-signup-dot-active" : "carrier-signup-dot"} style={{ display: 'inline-block', verticalAlign: 'middle', cursor: 'pointer'}} />
            ))}
          </div>
          <div className="carrier-signup-info-simple">
            <h2>Onboard Faster,<br/>Manage Smarter with AI</h2>
            <ul>
              <li>Connect instantly, automate your documents, and move freight smarter in one intelligent digital marketplace.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}