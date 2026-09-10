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

interface TopBarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ currentView, onViewChange }) => {
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
      </div>
    </header>
  );
};
export default TopBar;
