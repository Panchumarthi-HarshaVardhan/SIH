import React from 'react';
import { AppView } from '../types/hotspot';
import {
  Orbit,
  LayoutDashboard,
  AlertTriangle,
  Map as MapIcon,
  Activity,
  Settings,
  Radio,
} from 'lucide-react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRightFromBracket, faUserShield } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../auth';

interface TopBarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ currentView, onViewChange }) => {
  const { user, displayName, role, signOut } = useAuth();

  return (
    <header className="app-topbar-wrapper">
      <div className="app-topbar">
        {/* BRAND IDENTITY: NASA-STYLE MISSION CONTROL */}
        <div className="topbar-brand" onClick={() => onViewChange('dashboard')} role="button" tabIndex={0}>
          <div className="brand-icon-box">
            <Radio size={18} className="brand-radar-icon" />
          </div>
          <div className="brand-titles">
            <div className="brand-title-row">
              <span className="brand-main-title">THERMOSCOPE</span>
              <span className="brand-mission-badge">MISSION CONTROL</span>
            </div>
            <span className="brand-sub-title">SATELLITE THERMAL INTELLIGENCE // PS 26162</span>
          </div>
        </div>

        {/* 2. PRIMARY NAVIGATION (ZERO EMOJIS, CLEAN TECHNICAL ICONS) */}
        <nav className="topbar-nav" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-tab cinematic-tab ${currentView === 'landing' ? 'active' : ''}`}
            onClick={() => onViewChange('landing')}
            title="Switch to 3D Cinematic Earth Observation Experience"
          >
            <Orbit size={14} className="nav-tab-icon" />
            <span className="nav-label">CINEMATIC VIEW</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => onViewChange('dashboard')}
            title="Primary Operational Mission Control"
          >
            <LayoutDashboard size={14} className="nav-tab-icon" />
            <span className="nav-label">DASHBOARD</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'incidents' ? 'active' : ''}`}
            onClick={() => onViewChange('incidents')}
            title="Prioritized Incident Triage Queue"
          >
            <AlertTriangle size={14} className="nav-tab-icon" />
            <span className="nav-label">INCIDENTS</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'map' ? 'active' : ''}`}
            onClick={() => onViewChange('map')}
            title="Full 2D Geospatial Threat Map"
          >
            <MapIcon size={14} className="nav-tab-icon" />
            <span className="nav-label">MAP</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'status' ? 'active' : ''}`}
            onClick={() => onViewChange('status')}
            title="Sensor Feeds & Ingestion Health"
          >
            <Activity size={14} className="nav-tab-icon" />
            <span className="nav-label">SYSTEM STATUS</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => onViewChange('settings')}
            title="Bounding Box & Simulation Presets"
          >
            <Settings size={14} className="nav-tab-icon" />
            <span className="nav-label">SETTINGS</span>
          </button>
        </nav>

        {/* 3. AUTHENTICATED USER BADGE & SIGNOUT (LIGHT UI) */}
        {user && (
          <div className="topbar-auth-controls" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginLeft: 'auto',
            paddingLeft: '1rem',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '24px',
              padding: '4px 14px 4px 6px',
              fontSize: '0.82rem',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: '#ecfdf5',
                border: '1px solid #a7f3d0',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem'
              }}>
                <FontAwesomeIcon icon={faUserShield} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{
                  fontWeight: 600,
                  color: '#0f172a',
                  maxWidth: '150px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {displayName}
                </span>
                <span style={{
                  fontSize: '0.67rem',
                  fontWeight: 600,
                  color: '#059669',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase'
                }}>
                  {role}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => signOut()}
              title="Sign out of EOC Terminal"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '0.78rem',
                fontWeight: 500,
                color: '#475569',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fef2f2';
                e.currentTarget.style.borderColor = '#fecaca';
                e.currentTarget.style.color = '#dc2626';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff';
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.color = '#475569';
              }}
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
export default TopBar;
