import {
  faArrowsRotate,
  faBolt,
  faCircleCheck,
  faCompass,
  faEye,
  faFileLines,
  faFire,
  faHouse,
  faIndustry,
  faInfoCircle,
  faLocationDot,
  faMagnifyingGlass,
  faRobot,
  faSatellite,
  faScaleBalanced,
  faSeedling,
  faTrain,
  faTree,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  InvestigationResponse,
  Hotspot,
  PersistentCluster,
  ThermalAlert,
  PriorityRankingItem,
} from '../types/hotspot';
import { getInvestigation } from '../config/api';
import { SatelliteEvidenceCard } from './SatelliteEvidenceCard';
import { DecisionSupportPanel } from './DecisionSupportPanel';
import { ErrorBoundary } from './ErrorBoundary';
import { InvestigationSkeleton } from './InvestigationSkeleton';

export interface InvestigationPanelProps {
  observationId?: string | null;
  hotspot?: Hotspot | null;
  cluster?: PersistentCluster | null;
  alert?: ThermalAlert | null;
  priorityIncident?: PriorityRankingItem | null;
  onClose: () => void;
  onStatusChange?: (alertId: string, newStatus: ThermalAlert['status'], notes?: string) => void;
}

export const InvestigationPanel: React.FC<InvestigationPanelProps> = ({
  observationId: propObservationId,
  hotspot,
  cluster,
  alert,
  priorityIncident,
  onClose,
  onStatusChange,
}) => {
  // Determine primary observation ID
  const rawId =
    propObservationId ||
    hotspot?.observation_id ||
    (cluster?.observations && cluster.observations.length > 0
      ? cluster.observations[0].observation_id
      : undefined) ||
    cluster?.cluster_id ||
    (alert?.cluster_id && alert.cluster_id.startsWith('FIRMS_')
      ? alert.cluster_id.replace('FIRMS_', '')
      : undefined) ||
    alert?.cluster_id ||
    priorityIncident?.hotspot_id ||
    priorityIncident?.cluster_id ||
    (hotspot ? `HOTSPOT_${hotspot.latitude.toFixed(3)}_${hotspot.longitude.toFixed(3)}` : undefined);

  const cleanObservationId = rawId?.trim();

  // Investigation state
  const [data, setData] = useState<InvestigationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Coordinates: prioritize response detection coordinates, then selected entity, then priority/alert
  const lat = data?.detection?.latitude ?? hotspot?.latitude ?? cluster?.center_latitude ?? alert?.latitude ?? priorityIncident?.latitude ?? 20.0;
  const lon = data?.detection?.longitude ?? hotspot?.longitude ?? cluster?.center_longitude ?? alert?.longitude ?? priorityIncident?.longitude ?? 78.0;
  const alertId = alert?.alert_id;
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<'INVESTIGATE' | 'DECIDE'>('INVESTIGATE');
  const [provenanceExpanded, setProvenanceExpanded] = useState<boolean>(false);
  const [actionNotes, setActionNotes] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Monotonically increasing request sequence tracking & loaded ID tracking
  const requestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Derived state: show skeleton whenever loading OR when neither real data nor error has arrived
  const shouldShowSkeleton = loading || (!data && !error);

  const fetchInvestigationData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (!cleanObservationId) {
        setError('No valid Observation ID provided for investigation.');
        setLoading(false);
        setData(null);
        return;
      }

      // If forcing refresh, keep previous evidence visible while refreshing indicator spins
      // If initial/new incident selection, clear data so skeleton appears immediately
      if (!forceRefresh) {
        setData(null);
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      // Increment request sequence ID to invalidate prior in-flight responses
      requestIdRef.current += 1;
      const currentRequestId = requestIdRef.current;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await getInvestigation(cleanObservationId, forceRefresh, controller.signal);
        // Protect against race conditions: ignore response if a newer request has started
        if (currentRequestId !== requestIdRef.current) {
          return;
        }
        setData(res);
        setError(null);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return;
        }
        if (currentRequestId !== requestIdRef.current) {
          return;
        }
        console.error('Failed to load investigation:', err);
        setError(err.message || 'Evidence temporarily unavailable.');
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [cleanObservationId]
  );

  useEffect(() => {
    if (!cleanObservationId) {
      setData(null);
      setError('No valid Observation ID provided for investigation.');
      setLoading(false);
      return;
    }

    // Auto-load evidence immediately upon opening or switching incident
    fetchInvestigationData(false);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [cleanObservationId, fetchInvestigationData]);

  const handleAction = (status: ThermalAlert['status']) => {
    if (alertId && onStatusChange) {
      onStatusChange(alertId, status, actionNotes);
      setActionSuccess(`Status successfully updated to: ${status}`);
      setTimeout(() => setActionSuccess(null), 4000);
    } else {
      setActionSuccess(`Action '${status}' recorded for operational triage.`);
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  // Helper formatting
  const formatUtcDate = (val?: string | null): string => {
    if (!val) return 'Unavailable';
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
      }
    } catch {
      // fallback
    }
    return val;
  };

  const getCandidateBadgeClass = (candidate: string) => {
    switch (candidate?.toUpperCase()) {
      case 'INDUSTRIAL_FIRE':
      case 'INDUSTRIAL FIRE':
        return 'candidate-badge-industrial';
      case 'WILDFIRE':
        return 'candidate-badge-wildfire';
      case 'NON_FIRE':
      case 'NON FIRE':
        return 'candidate-badge-nonfire';
      default:
        return 'candidate-badge-unknown';
    }
  };

  const getRiskBadgeClass = (riskLevel: string) => {
    switch (riskLevel?.toUpperCase()) {
      case 'CRITICAL':
        return 'risk-badge-critical';
      case 'HIGH':
        return 'risk-badge-high';
      case 'MODERATE':
      case 'MEDIUM':
        return 'risk-badge-moderate';
      default:
        return 'risk-badge-low';
    }
  };

  const getEvidenceStrengthClass = (strength: string) => {
    switch (strength?.toUpperCase()) {
      case 'STRONG':
        return 'strength-badge-strong';
      case 'MODERATE':
        return 'strength-badge-moderate';
      case 'WEAK':
        return 'strength-badge-weak';
      default:
        return 'strength-badge-insufficient';
    }
  };

  const getContextBadgeClass = (contextClass?: string) => {
    switch (contextClass?.toUpperCase()) {
      case 'INDUSTRIAL_CONTEXT':
        return 'context-badge-industrial';
      case 'INFRASTRUCTURE_CONTEXT':
        return 'context-badge-infrastructure';
      case 'WILDFIRE_CONTEXT':
        return 'context-badge-wildfire';
      case 'AGRICULTURAL_CONTEXT':
        return 'context-badge-agricultural';
      case 'TRANSPORT_CONTEXT':
        return 'context-badge-transport';
      case 'RESIDENTIAL_CONTEXT':
        return 'context-badge-residential';
      case 'MIXED_CONTEXT':
        return 'context-badge-mixed';
      default:
        return 'context-badge-noclear';
    }
  };

  const getFeatureIcon = (category?: string) => {
    switch (category?.toUpperCase()) {
      case 'INDUSTRIAL':
        return faIndustry;
      case 'INFRASTRUCTURE':
      case 'CRITICAL_INFRASTRUCTURE':
        return faBolt;
      case 'ENVIRONMENTAL':
        return faTree;
      case 'AGRICULTURAL':
        return faSeedling;
      case 'TRANSPORT':
        return faTrain;
      case 'RESIDENTIAL':
        return faHouse;
      default:
        return faLocationDot;
    }
  };


  return (
    <div className="incident-detail-drawer-overlay" onClick={onClose}>
      <div className="incident-detail-drawer" onClick={(e) => e.stopPropagation()}>
        {/* ========================================================================= */}
        {/* 1. INVESTIGATION HEADER */}
        {/* ========================================================================= */}
        <div className="drawer-header investigation-header-container">
          <div className="drawer-title-group">
            <div className="investigation-badge-row">
              <span className="drawer-type-badge">INCIDENT INVESTIGATION</span>
              {data && (
                <>
                  <span className={`ai-candidate-pill ${getCandidateBadgeClass(data.fusion.candidate_class)}`}>
                    AI CANDIDATE: {data.fusion.candidate_class.replace('_', ' ')}
                  </span>
                  <span className={`evidence-strength-pill ${getEvidenceStrengthClass(data.fusion.evidence_strength)}`}>
                    EVIDENCE: {data.fusion.evidence_strength}
                  </span>
                  <span className={`risk-level-pill ${getRiskBadgeClass(data.risk.risk_level)}`}>
                    RISK: {data.risk.risk_level}
                  </span>
                </>
              )}
            </div>

            <h2 className="drawer-title">
              {cleanObservationId || `HOTSPOT-${lat.toFixed(3)}_${lon.toFixed(3)}`}
            </h2>

            <div className="drawer-subtitle">
              <span>{lat.toFixed(4)}°N, {lon.toFixed(4)}°E</span>
              <span className="dot-sep">•</span>
              <span>{data?.detection?.satellite || hotspot?.satellite || 'NASA FIRMS'}</span>
              <span className="dot-sep">•</span>
              <span>{formatUtcDate(data?.detection?.acquired_at || hotspot?.acquired_at)}</span>
            </div>
          </div>

          <div className="drawer-header-actions">
            <button
              type="button"
              className="btn-refresh-evidence"
              onClick={() => fetchInvestigationData(true)}
              disabled={loading || refreshing}
              title="Query live services and force fresh evidence fusion"
            >
              {refreshing ? 'Refreshing...' : 'Refresh Evidence'}
            </button>
            <button
              type="button"
              className="drawer-btn-close"
              onClick={onClose}
              aria-label="Close"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </div>

        {actionSuccess && <div className="action-success-banner"><FontAwesomeIcon icon={faCircleCheck} /> {actionSuccess}</div>}

        {/* WORKFLOW TAB SWITCHER: INVESTIGATE <-> DECIDE */}
        <div className="incident-workflow-tabs-bar">
          <button
            type="button"
            className={`workflow-tab-btn ${activeWorkflowTab === 'INVESTIGATE' ? 'active' : ''}`}
            onClick={() => setActiveWorkflowTab('INVESTIGATE')}
          >
            <FontAwesomeIcon icon={faMagnifyingGlass} /> 1. INVESTIGATE EVIDENCE
          </button>
          <button
            type="button"
            className={`workflow-tab-btn ${activeWorkflowTab === 'DECIDE' ? 'active' : ''}`}
            onClick={() => setActiveWorkflowTab('DECIDE')}
          >
            <FontAwesomeIcon icon={faScaleBalanced} /> 2. DECISION SUPPORT & PRIORITIZATION
          </button>
        </div>

        <div className="drawer-body">
          {/* ========================================================================= */}
          {/* ACTIVE TAB: DECISION SUPPORT & PRIORITIZATION */}
          {/* ========================================================================= */}
          {activeWorkflowTab === 'DECIDE' && (
            <ErrorBoundary fallbackTitle="Decision Support Temporarily Unavailable">
              <DecisionSupportPanel
                observationId={cleanObservationId}
                hotspot={hotspot}
                cluster={cluster}
                alert={alert}
                onClose={onClose}
                onStatusChange={onStatusChange}
              />
            </ErrorBoundary>
          )}

          {/* ========================================================================= */}
          {/* ACTIVE TAB: INVESTIGATE EVIDENCE */}
          {/* ========================================================================= */}
          {activeWorkflowTab === 'INVESTIGATE' && (
            <>
              {/* SKELETON LOADING STATE */}
              {shouldShowSkeleton && <InvestigationSkeleton />}

              {/* ERROR STATE */}
              {!shouldShowSkeleton && error && (
                <div className="investigation-error-banner" role="alert">
                  <div className="error-icon"><FontAwesomeIcon icon={faTriangleExclamation} /></div>
                  <div className="error-content">
                    <h4 className="error-heading">Investigation Temporarily Unavailable</h4>
                    <p className="error-message">{error}</p>
                    <div className="error-actions">
                      <button
                        type="button"
                        className="btn-retry-investigation"
                        onClick={() => fetchInvestigationData(false)}
                      >
                        <FontAwesomeIcon icon={faArrowsRotate} /> Retry Investigation
                      </button>
                      <button
                        type="button"
                        className="btn-retry-force"
                        onClick={() => fetchInvestigationData(true)}
                      >
                        <FontAwesomeIcon icon={faBolt} /> Force Live Query
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MAIN EVIDENCE CHAIN VIEW (RENDERED ON HTTP 200) */}
              {!shouldShowSkeleton && data && (
            <>
              {/* WARNINGS BANNER (IF ANY) */}
              {data.warnings && data.warnings.length > 0 && (
                <div className="investigation-system-warnings" role="alert">
                  <div className="warning-banner-header">
                    <span className="warning-icon"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
                    <strong>System Operational Warnings ({data.warnings.length}):</strong>
                  </div>
                  <ul className="warnings-list">
                    {data.warnings.map((w, idx) => (
                      <li key={idx} className="warning-item">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* CONFLICT DETECTED BANNER */}
              {data.fusion.conflict_detected && (
                <div className="investigation-conflict-banner" role="alert">
                  <div className="conflict-banner-header">
                    <span className="conflict-icon"><FontAwesomeIcon icon={faBolt} /></span>
                    <strong>Evidence Conflict Detected</strong>
                  </div>
                  <div className="conflict-banner-body">
                    Thermal radiance and industrial proximity context suggest one candidate pattern, whereas optical Sentinel-2 visual features indicate a conflicting pattern. High-resolution optical evidence is prioritized with reduced confidence.
                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* CARD 6: EVIDENCE FUSION CARD (PROMINENT AT TOP) */}
              {/* ========================================================================= */}
              <div className="investigation-section fusion-highlight-section">
                <div className="section-header">
                  <span className="section-number">AI</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faRobot} /></span>
                  <h3 className="section-title">AI CANDIDATE CLASSIFICATION</h3>
                  <span className={`section-tag ${getCandidateBadgeClass(data.fusion.candidate_class)}`}>
                    Candidate Output
                  </span>
                </div>

                <div className="fusion-card-body">
                  <div className="fusion-primary-grid">
                    <div className="fusion-candidate-box">
                      <span className="fusion-box-label">Synthesized Candidate</span>
                      <div className="fusion-candidate-title">
                        {data.fusion.candidate_class.replace('_', ' ')}
                      </div>
                      <div className="fusion-candidate-sub">
                        Evidence Strength: <strong>{data.fusion.evidence_strength}</strong>
                        {data.fusion.confidence_label && (
                          <span> • Confidence: <strong>{data.fusion.confidence_label}</strong></span>
                        )}
                      </div>
                    </div>

                    <div className="fusion-score-box">
                      <span className="fusion-box-label">Fusion Evidence Score</span>
                      <div className="fusion-score-val">
                        {(data.fusion.candidate_score * 100).toFixed(1)}%
                      </div>
                      <div className="fusion-meter-bar-track">
                        <div
                          className="fusion-meter-bar-fill"
                          style={{ width: `${Math.min(100, data.fusion.candidate_score * 100)}%` }}
                        />
                      </div>
                      <span className="fusion-score-caption">
                        Score: {data.fusion.candidate_score.toFixed(4)} / 1.0000
                      </span>
                    </div>
                  </div>

                  {/* CONTRIBUTING FACTORS */}
                  {data.fusion.contributing_factors && (
                    <div className="fusion-contributors-row">
                      <div className="contributor-item">
                        <span className="c-label"><FontAwesomeIcon icon={faFire} /> Thermal Radiance:</span>
                        <strong className="c-val">{((data.fusion.contributing_factors.thermal_anomaly ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                      <div className="contributor-item">
                        <span className="c-label"><FontAwesomeIcon icon={faArrowsRotate} /> Persistence:</span>
                        <strong className="c-val">{((data.fusion.contributing_factors.persistence ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                      <div className="contributor-item">
                        <span className="c-label"><FontAwesomeIcon icon={faIndustry} /> Industrial Context:</span>
                        <strong className="c-val">{((data.fusion.contributing_factors.industrial_context ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                      <div className="contributor-item">
                        <span className="c-label"><FontAwesomeIcon icon={faSatellite} /> Sentinel-2 CNN:</span>
                        <strong className="c-val">{((data.fusion.contributing_factors.sentinel2_cnn ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                    </div>
                  )}

                  {/* REASONING BULLETS */}
                  {data.fusion.reasoning && data.fusion.reasoning.length > 0 && (
                    <div className="fusion-reasoning-wrap">
                      <h4 className="reasoning-title">Why this classification?</h4>
                      <ul className="reasoning-list">
                        {data.fusion.reasoning.map((r, idx) => (
                          <li key={idx} className="reasoning-item">
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* LOCATION CONTEXT ASSESSMENT (Triggered when UNKNOWN or when location_context is available) */}
              {/* ========================================================================= */}
              {data.location_context && (
                <div className="investigation-section location-context-section">
                  <div className="section-header">
                    <span className="section-number">LOC</span>
                    <span className="section-icon"><FontAwesomeIcon icon={faCompass} /></span>
                    <h3 className="section-title">LOCATION CONTEXT ASSESSMENT</h3>
                    <span className={`section-tag ${getContextBadgeClass(data.location_context.classification)}`}>
                      {data.location_context.classification.replace('_', ' ')}
                    </span>
                  </div>

                  {data.fusion.candidate_class === 'UNKNOWN' && (
                    <div className="location-context-alert-banner">
                      <FontAwesomeIcon icon={faInfoCircle} /> Primary satellite & FIRMS fusion cannot confidently classify this incident. Automated 5 km OpenStreetMap location context analysis has been performed around exact coordinates ({lat.toFixed(4)}°N, {lon.toFixed(4)}°E).
                    </div>
                  )}

                  <div className="location-context-card-body">
                    {/* Primary Overview Grid */}
                    <div className="location-context-overview-grid">
                      <div className="context-overview-box">
                        <span className="context-box-label">Contextual Classification</span>
                        <div className="context-primary-val">
                          {data.location_context.classification.replace('_', ' ')}
                        </div>
                        <div className="context-subtext">
                          Confidence: <strong>{data.location_context.confidence_label}</strong> ({Math.round(data.location_context.confidence * 100)}%)
                        </div>
                        <div className="context-meter-track">
                          <div
                            className="context-meter-fill"
                            style={{ width: `${Math.min(100, Math.max(8, Math.round(data.location_context.confidence * 100)))}%` }}
                          />
                        </div>
                      </div>

                      <div className="context-overview-box">
                        <span className="context-box-label">Geographic Locality</span>
                        <div className="context-locality-val">
                          {data.location_context.locality || 'Area Unmapped'}
                          {data.location_context.district ? `, ${data.location_context.district}` : ''}
                        </div>
                        <div className="context-subtext">
                          {data.location_context.state ? `${data.location_context.state}, ` : ''}{data.location_context.country || 'India'}
                        </div>
                        <div className="context-radius-tag">
                          <FontAwesomeIcon icon={faLocationDot} /> Analysis Radius: {data.location_context.radius_km.toFixed(1)} km
                        </div>
                      </div>
                    </div>

                    {/* Possible Source / Likely Cause Card */}
                    {data.location_context.possible_cause && (
                      <div className="possible-cause-card">
                        <div className="possible-cause-header">
                          <span className="possible-cause-title">
                            <FontAwesomeIcon icon={faInfoCircle} /> POSSIBLE SOURCE / LIKELY CAUSE
                          </span>
                          <span className="possible-cause-category-badge">
                            {data.location_context.possible_cause.category.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="possible-cause-body">
                          <div className="possible-source-main">
                            <span className="possible-source-label">Likely Source:</span>
                            <strong className="possible-source-name">{data.location_context.possible_cause.likely_source}</strong>
                            {data.location_context.possible_cause.distance_km !== null && data.location_context.possible_cause.distance_km !== undefined && (
                              <span className="possible-source-dist-tag">
                                {data.location_context.possible_cause.distance_km < 1
                                  ? `${(data.location_context.possible_cause.distance_km * 1000).toFixed(0)} m`
                                  : `${data.location_context.possible_cause.distance_km.toFixed(2)} km`} away
                              </span>
                            )}
                          </div>
                          <p className="possible-cause-assessment-text">
                            {data.location_context.possible_cause.assessment}
                          </p>
                          <div className="possible-cause-disclaimer-note">
                            Contextual assessment only — proximity provides geographic plausibility but does not confirm causation.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Location Evidence (Ranked features within 5 km) */}
                    {data.location_context.nearby_features && data.location_context.nearby_features.length > 0 && (
                      <div className="location-evidence-block">
                        <h4 className="location-evidence-heading">
                          <FontAwesomeIcon icon={faLocationDot} /> LOCATION EVIDENCE (WITHIN 5 KM)
                        </h4>
                        <div className="nearby-features-list">
                          {data.location_context.nearby_features.slice(0, 8).map((feat, idx) => (
                            <div key={idx} className="nearby-feature-row">
                              <div className="feature-row-icon">
                                <FontAwesomeIcon icon={getFeatureIcon(feat.category)} />
                              </div>
                              <div className="feature-row-main">
                                <div className="feature-row-name">
                                  {feat.name}
                                  <span className="feature-row-type">• {feat.type}</span>
                                </div>
                                <div className="feature-row-sub">
                                  Category: <span className="feature-cat-text">{feat.category}</span>
                                  {feat.ranking_score > 0 && (
                                    <span className="feature-score-text">• Relevance Score: {(feat.ranking_score * 100).toFixed(0)}%</span>
                                  )}
                                </div>
                              </div>
                              <div className="feature-row-meta">
                                <span className="feature-distance-val">
                                  {feat.distance_km < 1
                                    ? `${(feat.distance_km * 1000).toFixed(0)} m`
                                    : `${feat.distance_km.toFixed(2)} km`}
                                </span>
                                <span className={`feature-relevance-pill relevance-${feat.relevance?.toLowerCase()}`}>
                                  {feat.relevance} RELEVANCE
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Why this assessment? */}
                    {data.location_context.reasoning && data.location_context.reasoning.length > 0 && (
                      <div className="context-reasoning-wrap">
                        <h4 className="reasoning-title">Why this assessment?</h4>
                        <ul className="reasoning-list">
                          {data.location_context.reasoning.map((r, idx) => (
                            <li key={idx} className="reasoning-item">
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* CARD 2: THERMAL DETECTION (NASA FIRMS) */}
              {/* ========================================================================= */}
              <div className="investigation-section">
                <div className="section-header">
                  <span className="section-number">1</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faFire} /></span>
                  <h3 className="section-title">NEAR-REAL-TIME SATELLITE THERMAL ANOMALY DETECTION</h3>
                  <span className="section-tag tag-firms">NASA FIRMS</span>
                </div>

                <div className="firms-explanation-tooltip">
                  <FontAwesomeIcon icon={faInfoCircle} className="mr-1 text-green" /> FIRMS detects thermal anomalies from satellite observations. A thermal anomaly is not necessarily an industrial fire.
                </div>

                <div className="section-grid-3">
                  <div className="info-box">
                    <span className="info-label">Fire Radiative Power</span>
                    <span className="info-value highlight-frp">{data.detection.frp.toFixed(1)} MW</span>
                    <span className="info-sub">Radiant combustion energy</span>
                  </div>
                  <div className="info-box">
                    <span className="info-label">Brightness Temp</span>
                    <span className="info-value">{data.detection.brightness.toFixed(1)} K</span>
                    <span className="info-sub">Sensor infrared radiance</span>
                  </div>
                  <div className="info-box">
                    <span className="info-label">Detection Confidence</span>
                    <span className="info-value">{data.detection.confidence}</span>
                    <span className="info-sub">Quality classification</span>
                  </div>
                </div>

                <div className="info-details-row">
                  <div><strong>Observation ID:</strong> <code>{data.observation_id}</code></div>
                  <div><strong>Sensor / Satellite:</strong> {data.detection.satellite || 'VIIRS/MODIS'}</div>
                  <div><strong>Acquired At:</strong> {formatUtcDate(data.detection.acquired_at)}</div>
                  <div><strong>Coordinates:</strong> {data.detection.latitude.toFixed(4)}°N, {data.detection.longitude.toFixed(4)}°E</div>
                </div>
              </div>

              {/* ========================================================================= */}
              {/* CARD 3: PERSISTENCE & RECURRENT DETECTIONS */}
              {/* ========================================================================= */}
              <div className="investigation-section">
                <div className="section-header">
                  <span className="section-number">2</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faArrowsRotate} /></span>
                  <h3 className="section-title">PERSISTENCE & REPEATED DETECTIONS</h3>
                  <span className={`section-tag ${data.persistence.observation_count > 1 ? 'tag-persistent' : 'tag-transient'}`}>
                    {data.persistence.observation_count > 1 ? 'Recurrent Multi-Pass' : 'Single Detection'}
                  </span>
                </div>

                <div className="section-grid-3">
                  <div className="info-box">
                    <span className="info-label">Observation Count</span>
                    <span className="info-value">{data.persistence.observation_count} passes</span>
                    <span className="info-sub">Deduplicated detections</span>
                  </div>
                  <div className="info-box">
                    <span className="info-label">Active Duration</span>
                    <span className="info-value">{data.persistence.duration_hours > 0 ? `${data.persistence.duration_hours.toFixed(1)} hrs` : '< 1 hr'}</span>
                    <span className="info-sub">Span between passes</span>
                  </div>
                  <div className="info-box">
                    <span className="info-label">Search Window</span>
                    <span className="info-value">{data.persistence.time_window_hours.toFixed(0)} hrs</span>
                    <span className="info-sub">Clustering time horizon</span>
                  </div>
                </div>

                <div className="persistence-meter-wrap">
                  <div className="meter-label-row">
                    <span>Persistence Score</span>
                    <span><strong>{(data.persistence.score ?? 0).toFixed(0)} / 100 ({data.persistence.classification || 'TEMPORARY'})</strong></span>
                  </div>
                  <div className="meter-bar-track">
                    <div
                      className="meter-bar-fill"
                      style={{ width: `${Math.min(100, data.persistence.score ?? 0)}%` }}
                    />
                  </div>
                  <div className="meter-caption">
                    {(data.persistence.score ?? 0) >= 60
                      ? 'High recurrence signature across multiple satellite orbits, characteristic of continuous industrial operations (flares/kilns) or prolonged burns.'
                      : (data.persistence.score ?? 0) >= 30
                      ? 'Moderate recurrence signature across 24h window.'
                      : 'Low persistence score; transient thermal signature or single satellite pass.'}
                  </div>
                </div>
              </div>

              {/* ========================================================================= */}
              {/* CARD 4: INDUSTRIAL CONTEXT (OPENSTREETMAP) */}
              {/* ========================================================================= */}
              <div className="investigation-section">
                <div className="section-header">
                  <span className="section-number">3</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faIndustry} /></span>
                  <h3 className="section-title">INDUSTRIAL CONTEXT</h3>
                  <span className="section-tag tag-osm">OpenStreetMap 5km</span>
                </div>

                <div className="industrial-context-content">
                  <div className="facility-highlight-card">
                    <div className="facility-headline">
                      <span className="facility-icon"><FontAwesomeIcon icon={faIndustry} /></span>
                      <div>
                        <h4 className="facility-name">
                          {data.industrial_context.nearest_facility || 'No nearby mapped industrial infrastructure'}
                        </h4>
                        <span className="facility-dist">
                          {data.industrial_context.nearest_distance_km != null
                            ? `Distance: ${data.industrial_context.nearest_distance_m ? Math.round(data.industrial_context.nearest_distance_m) : Math.round(data.industrial_context.nearest_distance_km * 1000)} meters (${data.industrial_context.nearest_distance_km.toFixed(2)} km)`
                            : 'No mapped industrial facilities within 5.0 km radius'}
                        </span>
                      </div>
                    </div>
                    <div className="facility-badge-row">
                      <span className="context-type-badge">
                        Proximity Score: {((data.industrial_context.score ?? 0) * 100).toFixed(0)}%
                      </span>
                      <span className="facility-count-badge">
                        {data.industrial_context.features?.length || 0} mapped facilities
                      </span>
                    </div>
                  </div>

                  {data.industrial_context.features && data.industrial_context.features.length > 0 && (
                    <div className="nearby-features-list">
                      <div className="features-list-title">Mapped Nearby Infrastructure:</div>
                      <ul>
                        {data.industrial_context.features.slice(0, 4).map((f, idx) => (
                          <li key={idx} className="feature-item">
                            <span className="feature-type">{f.type || f.category || 'Industrial'}</span>
                            <span className="feature-name">{f.name || 'Mapped industrial entity'}</span>
                            <span className="feature-dist">
                              {f.distance_km != null ? `${(f.distance_km * 1000).toFixed(0)}m` : 'Nearby'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================================= */}
              {/* CARD 5: SATELLITE EVIDENCE & ORCHESTRATION (COPERNICUS S2 + S1) */}
              {/* ========================================================================= */}
              <div className="investigation-section">
                <div className="section-header">
                  <span className="section-number">4</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faSatellite} /></span>
                  <h3 className="section-title">SATELLITE EVIDENCE & ORCHESTRATION</h3>
                  <span className="section-tag tag-copernicus">Copernicus Earth Observation</span>
                </div>

                <SatelliteEvidenceCard
                  satelliteData={data.sentinel2 as any}
                  sentinel1Data={data.sentinel1}
                  selectedSatellite={data.selected_satellite}
                  fallbackReason={data.satellite_fallback_reason}
                  observationId={data.observation_id}
                  coordinates={{ lat: data.detection.latitude, lon: data.detection.longitude }}
                  loading={false}
                />
              </div>

              {/* ========================================================================= */}
              {/* CARD 8: OPERATIONAL RISK ASSESSMENT */}
              {/* ========================================================================= */}
              <div className="investigation-section">
                <div className="section-header">
                  <span className="section-number">5</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faScaleBalanced} /></span>
                  <h3 className="section-title">OPERATIONAL RISK ASSESSMENT</h3>
                  <span className={`section-tag ${getRiskBadgeClass(data.risk.risk_level)}`}>
                    {data.risk.risk_level} RISK
                  </span>
                </div>

                <div className="risk-score-content">
                  <div className="op-risk-display">
                    <div className="op-score-box">
                      <span className="op-score-num">{data.risk.risk_score.toFixed(1)}</span>
                      <span className="op-score-denom">/ 100</span>
                      <span className="op-score-label">Operational Risk Score</span>
                    </div>
                    <div className="op-weights-list">
                      <div className="weight-item">
                        <span>Thermal Radiance (FRP):</span>
                        <strong>{((data.risk.factors?.thermal_frp ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                      <div className="weight-item">
                        <span>Industrial Proximity:</span>
                        <strong>{((data.risk.factors?.industrial_proximity ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                      <div className="weight-item">
                        <span>Persistence Score:</span>
                        <strong>{((data.risk.factors?.persistence ?? 0) * 100).toFixed(0)}%</strong>
                      </div>
                      <div className="weight-item">
                        <span>Primary Driver:</span>
                        <strong className="driver-highlight">{data.risk.primary_driver || 'Thermal Radiance'}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ========================================================================= */}
              {/* CARD 9: PROVENANCE SECTION (COLLAPSIBLE) */}
              {/* ========================================================================= */}
              <div className="investigation-section provenance-section">
                <div
                  className="section-header clickable-header"
                  onClick={() => setProvenanceExpanded(!provenanceExpanded)}
                  tabIndex={0}
                  role="button"
                  aria-expanded={provenanceExpanded}
                >
                  <span className="section-number">6</span>
                  <span className="section-icon"><FontAwesomeIcon icon={faFileLines} /></span>
                  <h3 className="section-title">EVIDENCE PROVENANCE & AUDIT TRAIL</h3>
                  <span className="expand-indicator">{provenanceExpanded ? '▲ Collapse' : '▼ Expand'}</span>
                </div>

                {provenanceExpanded && (
                  <div className="provenance-content">
                    <table className="provenance-table">
                      <tbody>
                        <tr>
                          <th>Observation ID</th>
                          <td><code>{data.provenance.observation_id}</code></td>
                        </tr>
                        <tr>
                          <th>FIRMS Acquisition Time</th>
                          <td>{formatUtcDate(data.provenance.firms_acquired_at)}</td>
                        </tr>
                        <tr>
                          <th>Active Satellite Source</th>
                          <td>
                            <strong style={{ color: data.selected_satellite === 'SENTINEL_1' ? '#c084fc' : (data.selected_satellite === 'SENTINEL_2' ? '#34d399' : '#94a3b8') }}>
                              {data.selected_satellite === 'SENTINEL_1'
                                ? 'Sentinel-1 SAR Radar (Backup)'
                                : (data.selected_satellite === 'SENTINEL_2' ? 'Sentinel-2 Optical (Primary)' : 'None (Thermal + Context Only)')}
                            </strong>
                          </td>
                        </tr>
                        <tr>
                          <th>Sentinel-2 Acquisition Time</th>
                          <td>{data.provenance.sentinel2_acquired_at ? formatUtcDate(data.provenance.sentinel2_acquired_at) : 'Unavailable'}</td>
                        </tr>
                        <tr>
                          <th>Sentinel-1 Acquisition Time</th>
                          <td>
                            {data.provenance.sentinel1_acquired_at
                              ? formatUtcDate(data.provenance.sentinel1_acquired_at)
                              : (data.sentinel1?.state === 'S1_NOT_QUERIED' ? 'Not Queried (S2 Usable)' : 'Unavailable')}
                          </td>
                        </tr>
                        <tr>
                          <th>Temporal Offset from FIRMS</th>
                          <td>
                            {data.provenance.temporal_offset_hours != null
                              ? `${data.provenance.temporal_offset_hours.toFixed(1)} hours`
                              : 'N/A (No temporal coincidence)'}
                          </td>
                        </tr>
                        <tr>
                          <th>OSM Query Timestamp</th>
                          <td>{formatUtcDate(data.provenance.osm_queried_at)}</td>
                        </tr>
                        <tr>
                          <th>Investigation Executed At</th>
                          <td>{formatUtcDate(data.provenance.investigated_at)}</td>
                        </tr>
                        <tr>
                          <th>Synthetic Imagery Safety Flag</th>
                          <td>
                            <span className={data.sentinel2.is_synthetic ? 'flag-bad' : 'flag-good'}>
                              {data.sentinel2.is_synthetic ? 'TRUE (Synthetic Data)' : 'FALSE (Genuine Data Only)'}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th>CNN Calibration Status</th>
                          <td>
                            <span className="flag-neutral">
                              {data.sentinel2.is_calibrated ? 'Calibrated Softmax' : 'Uncalibrated Softmax (Raw Probability)'}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ========================================================================= */}
              {/* CARD 11: MANDATORY DISCLAIMERS */}
              {/* ========================================================================= */}
              <div className="investigation-disclaimers-card">
                <div className="disclaimer-header">
                  <span><FontAwesomeIcon icon={faInfoCircle} /></span>
                  <strong>Regulatory & Operational Disclaimers</strong>
                </div>
                <div className="disclaimers-body">
                  <p className="disclaimer-paragraph">
                    1. <strong>AI Candidate Classification is an evidence-fusion output, not a standalone confirmation of an industrial fire.</strong> Field and aerial verification are required for operational dispatch.
                  </p>
                  <p className="disclaimer-paragraph">
                    2. <strong>Sentinel-2 imagery is optical evidence and may not be temporally coincident with the FIRMS observation.</strong> Optical acquisitions provide surface context and land-cover validation.
                  </p>
                </div>
              </div>

              {/* ========================================================================= */}
              {/* OPERATIONAL DECISION & TRIAGE ACTIONS */}
              {/* ========================================================================= */}
              <div className="decision-actions-panel">
                <div className="actions-title">OPERATIONAL DECISION & TRIAGE ACTIONS:</div>
                <div className="notes-input-wrap">
                  <input
                    type="text"
                    className="action-notes-input"
                    placeholder="Add investigation / dispatch notes..."
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                  />
                </div>
                <div className="actions-button-grid">
                  <button
                    type="button"
                    className="btn-action btn-acknowledge"
                    onClick={() => handleAction('ACKNOWLEDGED')}
                  >
                    <FontAwesomeIcon icon={faEye} /> Acknowledge
                  </button>
                  <button
                    type="button"
                    className="btn-action btn-investigate"
                    onClick={() => handleAction('INVESTIGATING')}
                  >
                    <FontAwesomeIcon icon={faMagnifyingGlass} /> Mark Investigating
                  </button>
                  <button
                    type="button"
                    className="btn-action btn-resolve"
                    onClick={() => handleAction('RESOLVED')}
                  >
                    <FontAwesomeIcon icon={faCircleCheck} /> Mark Resolved
                  </button>
                  <button
                    type="button"
                    className="btn-action btn-dismiss"
                    onClick={() => handleAction('DISMISSED')}
                  >
                    <FontAwesomeIcon icon={faXmark} /> Dismiss
                  </button>
                </div>
              </div>
            </>
          )}
          </>
        )}
        </div>
      </div>
    </div>
  );
};

