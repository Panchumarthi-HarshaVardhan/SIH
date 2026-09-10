import React, { useState } from 'react';
import { useAuth } from '../../auth';
import { ShieldCheck, LogIn, UserPlus, AlertCircle, CheckCircle2, Lock, Mail, User, Info } from 'lucide-react';

interface AuthModalProps {
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess }) => {
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [requestedRole, setRequestedRole] = useState('operator');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please provide your official email address.');
      return;
    }

    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setErrorMessage('Please enter a valid official email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please provide your security passcode.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Security passcode must be at least 6 characters long.');
      return;
    }

    if (isSignUp) {
      if (!name.trim()) {
        setErrorMessage('Please enter your full operational name.');
        return;
      }

      if (password !== confirmPassword) {
        setErrorMessage('Security passcodes do not match. Please verify both fields.');
        return;
      }
    }

    setSubmitting(true);

    try {
      if (isSignUp) {
        const { error, data } = await signUp(trimmedEmail, password, name.trim(), requestedRole);
        if (error) {
          const raw = (error.message || '').toLowerCase();
          if (raw.includes('rate limit') || raw.includes('over_email_send_rate_limit')) {
            setErrorMessage('Email verification service rate limit reached. Please wait a few moments before requesting access again, or contact your EOC administrator.');
          } else if (raw.includes('already registered') || raw.includes('already exists')) {
            setErrorMessage('An account with this email address already exists. Please switch to Sign In.');
          } else {
            setErrorMessage(error.message || 'Unable to complete registration. Please check your network connection.');
          }
        } else {
          if (data?.session) {
            setSuccessMessage('Account registered and session authenticated successfully.');
            onSuccess?.();
          } else {
            setSuccessMessage('Access request recorded! If email verification is enabled, please verify the confirmation link sent to your email before signing in.');
            // Clean passwords
            setPassword('');
            setConfirmPassword('');
          }
        }
      } else {
        const { error } = await signIn(trimmedEmail, password);
        if (error) {
          const raw = (error.message || '').toLowerCase();
          if (raw.includes('invalid login credentials')) {
            setErrorMessage('Invalid operator email or passcode. Please check your credentials.');
          } else if (raw.includes('email not confirmed')) {
            setErrorMessage('Email address has not been confirmed yet. Please verify your inbox confirmation link before signing in.');
          } else if (raw.includes('rate limit')) {
            setErrorMessage('Too many sign-in attempts. Please wait a moment before trying again.');
          } else {
            setErrorMessage(error.message || 'Authentication failed. Please verify network connectivity.');
          }
        } else {
          onSuccess?.();
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during authentication.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: '460px',
      margin: '0 auto',
      backgroundColor: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
      padding: '2rem',
      color: '#0f172a',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxSizing: 'border-box'
    }}>
      {/* Header Banner */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '50px',
          height: '50px',
          borderRadius: '10px',
          backgroundColor: '#ecfdf5',
          border: '1px solid #a7f3d0',
          marginBottom: '0.75rem',
          color: '#059669'
        }}>
          <ShieldCheck size={26} />
        </div>
        <h2 style={{
          fontSize: '1.35rem',
          fontWeight: '700',
          letterSpacing: '-0.025em',
          margin: '0 0 0.35rem 0',
          color: '#0f172a'
        }}>
          Emergency Operations Center
        </h2>
        <p style={{
          fontSize: '0.84rem',
          color: '#64748b',
          margin: 0,
          fontWeight: 400
        }}>
          Thermal Anomaly & Industrial Fire Intelligence Platform
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        backgroundColor: '#f1f5f9',
        borderRadius: '8px',
        padding: '4px',
        marginBottom: '1.5rem',
        border: '1px solid #e2e8f0'
      }}>
        <button
          type="button"
          onClick={() => { setIsSignUp(false); setErrorMessage(null); setSuccessMessage(null); }}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '0.85rem',
            fontWeight: isSignUp ? '500' : '600',
            color: isSignUp ? '#64748b' : '#0f172a',
            backgroundColor: isSignUp ? 'transparent' : '#ffffff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: isSignUp ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.08)',
            transition: 'all 0.15s ease'
          }}
        >
          <LogIn size={15} /> Sign In
        </button>
        <button
          type="button"
          onClick={() => { setIsSignUp(true); setErrorMessage(null); setSuccessMessage(null); }}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '0.85rem',
            fontWeight: isSignUp ? '600' : '500',
            color: isSignUp ? '#0f172a' : '#64748b',
            backgroundColor: isSignUp ? '#ffffff' : 'transparent',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: isSignUp ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <UserPlus size={15} /> Request Access
        </button>
      </div>

      {/* Alert Error Notice */}
      {errorMessage && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: '8px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          fontSize: '0.83rem',
          marginBottom: '1.25rem',
          lineHeight: '1.4'
        }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#dc2626' }} />
          <div>{errorMessage}</div>
        </div>
      )}

      {/* Alert Success Notice */}
      {successMessage && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: '8px',
          backgroundColor: '#ecfdf5',
          border: '1px solid #a7f3d0',
          color: '#065f46',
          fontSize: '0.83rem',
          marginBottom: '1.25rem',
          lineHeight: '1.4'
        }}>
          <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px', color: '#059669' }} />
          <div style={{ flex: 1 }}>
            <div>{successMessage}</div>
            {isSignUp && (
              <button
                type="button"
                onClick={() => { setIsSignUp(false); setErrorMessage(null); setSuccessMessage(null); }}
                style={{
                  marginTop: '8px',
                  padding: '4px 10px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  backgroundColor: '#ffffff',
                  border: '1px solid #a7f3d0',
                  borderRadius: '4px',
                  color: '#059669',
                  cursor: 'pointer'
                }}
              >
                Switch to Sign In →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Auth Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        {isSignUp && (
          <div>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#334155', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
              Full Operational Name
            </label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                required
                placeholder="Capt. John Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 36px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  color: '#0f172a',
                  fontSize: '0.88rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = '#10b981'}
                onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
              />
            </div>
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#334155', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
            Official Email Address
          </label>
          <div style={{ position: 'relative' }}>
            <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="email"
              required
              placeholder="operator@eoc.sih26162.gov"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 36px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                color: '#0f172a',
                fontSize: '0.88rem',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => e.target.style.borderColor = '#10b981'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#334155', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
            Security Passcode
          </label>
          <div style={{ position: 'relative' }}>
            <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="password"
              required
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 36px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                color: '#0f172a',
                fontSize: '0.88rem',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => e.target.style.borderColor = '#10b981'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
            />
          </div>
        </div>

        {isSignUp && (
          <div>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#334155', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
              Confirm Security Passcode
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 36px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  color: '#0f172a',
                  fontSize: '0.88rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = '#10b981'}
                onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
              />
            </div>
          </div>
        )}

        {isSignUp && (
          <div>
            <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#334155', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>
              Requested Operational Tier
            </label>
            <select
              value={requestedRole}
              onChange={(e) => setRequestedRole(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                color: '#0f172a',
                fontSize: '0.88rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            >
              <option value="operator">Field Tactical Operator (Standard Triage & Dispatch)</option>
              <option value="analyst">Remote Sensing Specialist (Multi-Sensor Analysis)</option>
              <option value="viewer">EOC Operations Viewer (Read-Only Telemetry)</option>
            </select>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '6px', fontSize: '0.72rem', color: '#64748b', lineHeight: 1.3 }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: '1px', color: '#94a3b8' }} />
              <span>Administrative roles require verification by an active Incident Commander. New registrations default to Operator privileges upon approval.</span>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: '0.5rem',
            padding: '11px 16px',
            backgroundColor: submitting ? '#059669' : '#10b981',
            color: '#ffffff',
            fontWeight: '600',
            fontSize: '0.92rem',
            borderRadius: '6px',
            border: 'none',
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 2px 4px rgba(16, 185, 129, 0.25)',
            transition: 'background-color 0.15s ease'
          }}
          onMouseEnter={(e) => {
            if (!submitting) e.currentTarget.style.backgroundColor = '#059669';
          }}
          onMouseLeave={(e) => {
            if (!submitting) e.currentTarget.style.backgroundColor = '#10b981';
          }}
        >
          {submitting ? (
            <span>{isSignUp ? 'Submitting Request...' : 'Authenticating...'}</span>
          ) : isSignUp ? (
            <>
              <UserPlus size={16} /> Submit Access Request
            </>
          ) : (
            <>
              <LogIn size={16} /> Secure Terminal Sign In
            </>
          )}
        </button>
      </form>

      {/* Security notice footer */}
      <div style={{
        marginTop: '1.75rem',
        paddingTop: '1rem',
        borderTop: '1px solid #f1f5f9',
        textAlign: 'center',
        fontSize: '0.72rem',
        color: '#94a3b8'
      }}>
        Protected by Supabase Auth & JWT Signature Verification
        <br />
        Authorized Emergency Personnel Only • All Actions Audited
      </div>
    </div>
  );
};
