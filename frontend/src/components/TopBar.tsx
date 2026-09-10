import React from 'react';
import { AppView } from '../types/hotspot';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFire,
  faChartSimple,
  faTriangleExclamation,
  faMap,
  faBolt,
  faGear,
  faRightFromBracket,
  faUserShield,
} from '@fortawesome/free-solid-svg-icons';
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
        {/* BRAND IDENTITY */}
        <div className="topbar-brand" onClick={() => onViewChange('dashboard')} style={{ cursor: 'pointer' }}>
          <div className="brand-icon-box">
            <FontAwesomeIcon icon={faFire} className="brand-fa-icon" />
          </div>
          <div className="brand-titles">
            <h1 className="brand-main-title">Industrial Fire Intelligence</h1>
          </div>
        </div>

      {/* 2. PRIMARY NAVIGATION */}
      <nav className="topbar-nav" aria-label="Main Navigation">
        <button
          type="button"
          className={`nav-tab ${currentView === 'dashboard' ? 'active' : ''}`}
          onClick={() => onViewChange('dashboard')}
        >
          <FontAwesomeIcon icon={faChartSimple} className="nav-fa-icon" />
          <span className="nav-label">Dashboard</span>
        </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'incidents' ? 'active' : ''}`}
            onClick={() => onViewChange('incidents')}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} className="nav-fa-icon" />
            <span className="nav-label">Incidents</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'map' ? 'active' : ''}`}
            onClick={() => onViewChange('map')}
          >
            <FontAwesomeIcon icon={faMap} className="nav-fa-icon" />
            <span className="nav-label">Map</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'status' ? 'active' : ''}`}
            onClick={() => onViewChange('status')}
          >
            <FontAwesomeIcon icon={faBolt} className="nav-fa-icon" />
            <span className="nav-label">System Status</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => onViewChange('settings')}
          >
            <FontAwesomeIcon icon={faGear} className="nav-fa-icon" />
            <span className="nav-label">Settings</span>
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
