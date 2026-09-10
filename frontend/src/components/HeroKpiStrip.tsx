import React from 'react';
import { Flame, RotateCw, Factory, AlertOctagon, CheckCircle2 } from 'lucide-react';

interface HeroKpiStripProps {
  thermalAnomaliesCount: number;
  persistentSourcesCount: number;
  industrialCandidatesCount: number;
  highRiskIncidentsCount: number;
  activeFilter?: string;
  onFilterClick?: (filter: 'all' | 'persistent' | 'industrial' | 'high_risk') => void;
}

export const HeroKpiStrip: React.FC<HeroKpiStripProps> = ({
  thermalAnomaliesCount,
  persistentSourcesCount,
  industrialCandidatesCount,
  highRiskIncidentsCount,
  activeFilter = 'all',
  onFilterClick,
}) => {
  const isHighRiskActive = highRiskIncidentsCount > 0;

  return (
    <section className="hero-kpi-strip" aria-label="Operational Metrics">
      {/* 1. THERMAL ANOMALIES */}
      <div
        className={`hero-kpi-card ${activeFilter === 'all' ? 'card-selected' : ''}`}
        onClick={() => onFilterClick && onFilterClick('all')}
        role="button"
        tabIndex={0}
      >
        <div className="kpi-top">
          <span className="kpi-title">THERMAL ANOMALIES</span>
          <Flame size={14} className="kpi-icon-tech text-muted" />
        </div>
        <div className="kpi-main">
          <span className="kpi-number">{thermalAnomaliesCount}</span>
        </div>
        <div className="kpi-bottom">
          <span className="kpi-caption">NASA FIRMS Active Telemetry</span>
        </div>
      </div>

      {/* 2. PERSISTENT SOURCES */}
      <div
        className={`hero-kpi-card ${activeFilter === 'persistent' ? 'card-selected' : ''}`}
        onClick={() => onFilterClick && onFilterClick('persistent')}
        role="button"
        tabIndex={0}
      >
        <div className="kpi-top">
          <span className="kpi-title">PERSISTENT SOURCES</span>
          <RotateCw size={13} className="kpi-icon-tech text-muted" />
        </div>
        <div className="kpi-main">
          <span className="kpi-number">{persistentSourcesCount}</span>
        </div>
        <div className="kpi-bottom">
          <span className="kpi-caption">Multi-Pass Satellite Recurrence</span>
        </div>
      </div>

      {/* 3. INDUSTRIAL CANDIDATES */}
      <div
        className={`hero-kpi-card ${activeFilter === 'industrial' ? 'card-selected' : ''}`}
        onClick={() => onFilterClick && onFilterClick('industrial')}
        role="button"
        tabIndex={0}
      >
        <div className="kpi-top">
          <span className="kpi-title">INDUSTRIAL CANDIDATES</span>
          <Factory size={14} className="kpi-icon-tech text-muted" />
        </div>
        <div className="kpi-main">
          <span className="kpi-number">{industrialCandidatesCount}</span>
        </div>
        <div className="kpi-bottom">
          <span className="kpi-caption">Within 5.0 KM Infrastructure</span>
        </div>
      </div>

      {/* 4. HIGH RISK INCIDENTS */}
      <div
        className={`hero-kpi-card kpi-card-critical-dominant ${activeFilter === 'high_risk' ? 'card-selected' : ''}`}
        onClick={() => onFilterClick && onFilterClick('high_risk')}
        role="button"
        tabIndex={0}
      >
        <div className="kpi-top">
          <span className="kpi-title">HIGH RISK INCIDENTS</span>
          {isHighRiskActive ? (
            <AlertOctagon size={14} className="kpi-icon-urgent text-red" />
          ) : (
            <CheckCircle2 size={14} className="kpi-icon-clear text-green" />
          )}
        </div>
        <div className="kpi-main">
          <span className={`kpi-number ${isHighRiskActive ? 'number-alert-urgent' : 'number-alert-clear'}`}>
            {highRiskIncidentsCount}
          </span>
          <span className={`kpi-status-tag ${isHighRiskActive ? 'tag-urgent' : 'tag-nominal'}`}>
            {isHighRiskActive ? 'ACTION REQUIRED' : 'NOMINAL'}
          </span>
        </div>
        <div className="kpi-bottom">
          <span className="kpi-caption">
            {isHighRiskActive ? 'Critical Triage Queue Active' : 'Zero High-Risk Escalations'}
          </span>
        </div>
      </div>
    </section>
  );
};
export default HeroKpiStrip;
