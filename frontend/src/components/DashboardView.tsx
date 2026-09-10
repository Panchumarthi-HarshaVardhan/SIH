import { useState, useMemo } from 'react';
import {
  Hotspot,
  PersistentCluster,
  ThermalAlert,
  PriorityRankingItem,
} from '../types/hotspot';
import { CompactStatusStrip } from './CompactStatusStrip';
import { HeroKpiStrip } from './HeroKpiStrip';
import { FireMap } from './FireMap';
import { SatelliteIntelligenceGlobe } from './globe/SatelliteIntelligenceGlobe';
import type { IncidentDrawerData } from './IncidentEvidenceDrawer';
import { RecentActivitySection } from './RecentActivitySection';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSatellite,
  faFire,
  faArrowsRotate,
  faIndustry,
  faTriangleExclamation,
  faFilter,
  faLocationDot,
  faGlobe,
} from '@fortawesome/free-solid-svg-icons';

interface DashboardViewProps {
  hotspots: Hotspot[];
  clusters: PersistentCluster[];
  alerts: ThermalAlert[];
  priorityItems: PriorityRankingItem[];
  loadingHotspots: boolean;
  loadingClusters: boolean;
  loadingPriority: boolean;
  lastUpdated: string;
  onSelectHotspot: (h: Hotspot) => void;
  onSelectCluster: (c: PersistentCluster) => void;
  onSelectAlert: (a: ThermalAlert) => void;
  onRefreshAll: () => void;
  refreshing?: boolean;
  onNavigateView?: (view: 'status' | 'incidents' | 'map' | 'settings') => void;
  selectedPriorityIncident?: PriorityRankingItem | null;
  onSelectPriorityIncident?: (p: PriorityRankingItem) => void;
  onEnrichHotspot?: (hotspotId: string, lat: number, lon: number) => void;
  basemap?: 'standard' | 'satellite';
  onBasemapChange?: (mode: 'standard' | 'satellite') => void;
}

export function DashboardView({
  hotspots,
  clusters,
  alerts,
  priorityItems,
  loadingPriority,
  lastUpdated = '',
  refreshing = false,
  onSelectHotspot,
  onSelectCluster,
  onSelectAlert,
  onRefreshAll,
  onNavigateView,
  selectedPriorityIncident,
  onSelectPriorityIncident,
  onEnrichHotspot,
  basemap = 'satellite',
  onBasemapChange,
}: DashboardViewProps) {
  const [metricFilter, setMetricFilter] = useState<'all' | 'persistent' | 'industrial' | 'high_risk'>('all');
  const [mapLayerMode, setMapLayerMode] = useState<'all' | 'hotspots' | 'clusters' | 'industrial'>('all');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MODERATE'>('ALL');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [activeMapCoords, setActiveMapCoords] = useState<[number, number] | null>(null);
  const [activeMapZoom, setActiveMapZoom] = useState<number>(5);
  const [displayMode, setDisplayMode] = useState<'3d_globe' | '2d_map'>('2d_map');
  const [activeTargetHotspot, setActiveTargetHotspot] = useState<Hotspot | null>(null);

  // Filtered Decision Counts
  const totalHotspots = hotspots.length;
  const persistentCount = clusters.filter(
    (c) => c.classification === 'PERSISTENT' || c.classification === 'HIGHLY PERSISTENT' || c.observation_count > 1
  ).length;
  const industrialCandidatesCount = priorityItems.filter(
    (p) => p.industrial_facility && p.industrial_distance_km !== null && p.industrial_distance_km <= 1.0
  ).length;
  const highRiskCount = priorityItems.filter(
    (p) => p.risk_score >= 0.7 || p.risk_level === 'CRITICAL' || p.risk_level === 'HIGH'
  ).length;

  const handleMetricFilterClick = (filter: 'all' | 'persistent' | 'industrial' | 'high_risk') => {
    setMetricFilter(filter);
    if (filter === 'persistent') setMapLayerMode('clusters');
    else if (filter === 'industrial') setMapLayerMode('industrial');
    else setMapLayerMode('all');
  };

  // Build unified Priority Incidents list for the 30% column
  const triageIncidents = useMemo<IncidentDrawerData[]>(() => {
    let list: IncidentDrawerData[] = [];

    if (priorityItems.length > 0) {
      list = priorityItems.map((p, idx) => ({
        id: p.cluster_id || p.hotspot_id || `priority_${idx + 1}`,
        rank: p.rank || idx + 1,
        latitude: p.latitude,
        longitude: p.longitude,
        risk_score: p.risk_score,
        risk_level: p.risk_level || p.priority || 'MODERATE',
        classification: p.classification || 'Industrial Fire Candidate',
        industrial_facility: p.industrial_facility || 'Thermal Anomaly (5 KM enrichment pending)',
        industrial_distance_km: p.industrial_distance_km ?? null,
        closest_critical_asset: p.closest_critical_asset ?? null,
        exposed_assets_count: p.exposed_assets_count ?? (p.nearby_features ? p.nearby_features.length : 0),
        exposure_summary: p.exposure_summary ?? {},
        nearby_features: p.nearby_features ?? [],
        data_status: p.data_status ?? 'OSM_UNAVAILABLE',
        persistence_score: p.persistence_score,
        observation_count: p.observation_count,
        duration_hours: p.duration_hours,
        frp: p.frp,
        brightness: p.brightness,
        reasons: p.reasons || [],
        recommended_action: p.recommended_action,
      }));
    } else if (clusters.length > 0) {
      list = [...clusters]
        .sort((a, b) => (b.total_frp || 0) - (a.total_frp || 0))
        .map((c, idx) => {
          const totalFrp = c.total_frp || 25.0;
          const score = Math.min(0.95, (totalFrp / 100) * 0.5 + (c.observation_count > 1 ? 0.3 : 0.1));
          const level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' =
            score >= 0.7 ? 'CRITICAL' : score >= 0.4 ? 'HIGH' : score >= 0.2 ? 'MODERATE' : 'LOW';

          return {
            id: c.cluster_id,
            rank: idx + 1,
            latitude: c.center_latitude,
            longitude: c.center_longitude,
            risk_score: score,
            risk_level: level,
            classification: c.classification || 'Persistent Thermal Source',
            industrial_facility: c.industrial_context?.nearby_facility || 'Rural / Agricultural Zone',
            industrial_distance_km: c.industrial_context?.distance_km ?? null,
            persistence_score: c.persistence_score || (c.observation_count > 1 ? 75 : 15),
            observation_count: c.observation_count,
            duration_hours: c.duration_hours,
            frp: totalFrp,
          };
        });
    } else {
      list = hotspots.map((h, idx) => {
        const frpVal = h.frp || 15.0;
        const score = Math.min(0.95, frpVal / 100);
        const level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' =
          score >= 0.7 ? 'CRITICAL' : score >= 0.4 ? 'HIGH' : score >= 0.2 ? 'MODERATE' : 'LOW';

        return {
          id: h.observation_id || `HOTSPOT_${idx + 1}`,
          rank: idx + 1,
          latitude: h.latitude,
          longitude: h.longitude,
          risk_score: score,
          risk_level: level,
          classification: 'NASA FIRMS Detection',
          industrial_facility: 'Rural Land',
          industrial_distance_km: null,
          persistence_score: 15,
          observation_count: 1,
          duration_hours: 0,
          frp: frpVal,
          brightness: h.brightness,
          satellite: h.satellite,
          acquired_at: h.acquired_at,
        };
      });
    }

    // Filter only important incidents: Critical, High, Moderate (or all if ALL selected)
    return list.filter((item) => {
      if (severityFilter === 'CRITICAL') return item.risk_level === 'CRITICAL';
      if (severityFilter === 'HIGH') return item.risk_level === 'HIGH';
      if (severityFilter === 'MODERATE') return item.risk_level === 'MODERATE';
      return true;
    });
  }, [priorityItems, clusters, hotspots, severityFilter]);

  const handleIncidentClick = (item: IncidentDrawerData) => {
    setSelectedIncidentId(item.id);
    setActiveMapCoords([item.latitude, item.longitude]);
    setActiveMapZoom(12);

    const matchingPri = priorityItems.find((p) => (p.cluster_id || p.hotspot_id) === item.id);
    if (matchingPri && onSelectPriorityIncident) {
      onSelectPriorityIncident(matchingPri);
      return;
    }

    const matchingHotspot = hotspots.find((h) => h.observation_id === item.id);
    const targetHotspot: Hotspot = matchingHotspot || {
      observation_id: item.id,
      latitude: item.latitude,
      longitude: item.longitude,
      brightness: item.brightness || 340,
      confidence: 'nominal',
      frp: item.frp || 25,
      acquired_at: item.acquired_at || new Date().toISOString(),
      satellite: item.satellite || 'NASA FIRMS',
      instrument: 'VIIRS',
      source: 'NASA FIRMS',
    };
    setActiveTargetHotspot(targetHotspot);

    // Coordinate with parent selection handlers to open the Right Sidebar Investigation Panel
    const matchingAlert = alerts.find((a) => a.cluster_id === item.id || a.alert_id === item.id);
    if (matchingAlert) {
      onSelectAlert(matchingAlert);
      return;
    }
    const matchingCluster = clusters.find((c) => c.cluster_id === item.id);
    if (matchingCluster) {
      onSelectCluster(matchingCluster);
      return;
    }
    onSelectHotspot(targetHotspot);
  };

  const getSeverityBadgeClass = (level: string) => {
    switch (level) {
      case 'CRITICAL':
        return 'badge-sev-critical';
      case 'HIGH':
        return 'badge-sev-high';
      case 'MODERATE':
        return 'badge-sev-medium';
      default:
        return 'badge-sev-low';
    }
  };

  return (
    <div className="dashboard-view-container">
      {/* 1. COMPACT SYSTEM STATUS STRIP */}
      <CompactStatusStrip
        lastUpdated={lastUpdated}
        onRefresh={onRefreshAll}
        refreshing={refreshing}
        onNavigateStatus={() => onNavigateView && onNavigateView('status')}
      />

      {/* 2. ENTERPRISE KPI DECISION STRIP */}
      <HeroKpiStrip
        thermalAnomaliesCount={totalHotspots}
        persistentSourcesCount={persistentCount}
        industrialCandidatesCount={industrialCandidatesCount}
        highRiskIncidentsCount={highRiskCount}
        activeFilter={metricFilter}
        onFilterClick={handleMetricFilterClick}
      />

      {/* 3. MAIN OPERATIONAL CONTENT: 70% MAP / 30% PRIORITY INCIDENTS */}
      <div className="dashboard-operational-grid">
        {/* LEFT ~70%: DOMINANT INTERACTIVE LIVE MAP */}
        <div className="dashboard-map-panel card-white">
          <div className="panel-header-bar">
            <div className="panel-title-group">
              <FontAwesomeIcon icon={displayMode === '2d_map' ? faSatellite : faGlobe} className="panel-header-icon text-green" />
              <h3 className="panel-title">
                {displayMode === '2d_map' ? '2D Satellite Intelligence & AI Risk Platform' : '3D Orbital Earth Perspective'}
              </h3>
            </div>

            {/* PRIMARY VIEW MODE SWITCHER: 2D SATELLITE (PRIMARY) VS 3D GLOBE */}
            <div className="map-view-switcher-group">
              <button
                type="button"
                className={`btn-mode-switcher ${displayMode === '2d_map' ? 'active' : ''}`}
                onClick={() => setDisplayMode('2d_map')}
                title="Primary 2D Top-Down Earth Observation Satellite Map with AI Risk Field & NASA FIRMS"
              >
                <FontAwesomeIcon icon={faSatellite} className="mr-1 text-emerald" />
                <span>2D Satellite Map</span>
              </button>
              <button
                type="button"
                className={`btn-mode-switcher ${displayMode === '3d_globe' ? 'active' : ''}`}
                onClick={() => setDisplayMode('3d_globe')}
                title="Secondary 3D Orbital Perspective"
              >
                <FontAwesomeIcon icon={faGlobe} className="mr-1 text-cyan" />
                <span>3D Globe View</span>
              </button>
            </div>

            {displayMode === '2d_map' && (
              <div className="map-layer-controls">
                <button
                  type="button"
                  className={`btn-layer-pill ${mapLayerMode === 'all' ? 'active' : ''}`}
                  onClick={() => setMapLayerMode('all')}
                >
                  All Sources
                </button>
                <button
                  type="button"
                  className={`btn-layer-pill ${mapLayerMode === 'hotspots' ? 'active' : ''}`}
                  onClick={() => setMapLayerMode('hotspots')}
                >
                  <FontAwesomeIcon icon={faFire} className="pill-icon-mr" />
                  <span>Thermal Spots</span>
                </button>
                <button
                  type="button"
                  className={`btn-layer-pill ${mapLayerMode === 'clusters' ? 'active' : ''}`}
                  onClick={() => setMapLayerMode('clusters')}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} className="pill-icon-mr" />
                  <span>Persistent</span>
                </button>
                <button
                  type="button"
                  className={`btn-layer-pill ${mapLayerMode === 'industrial' ? 'active' : ''}`}
                  onClick={() => setMapLayerMode('industrial')}
                >
                  <FontAwesomeIcon icon={faIndustry} className="pill-icon-mr" />
                  <span>Industrial</span>
                </button>
              </div>
            )}
          </div>

          <div className="map-embed-wrapper">
            {displayMode === '3d_globe' ? (
              <SatelliteIntelligenceGlobe
                hotspots={hotspots}
                clusters={clusters}
                activeAlerts={alerts}
                priorityItems={priorityItems}
                selectedHotspot={activeTargetHotspot}
                selectedPriorityIncident={selectedPriorityIncident}
                onSelectHotspot={(h) => {
                  setActiveTargetHotspot(h);
                  onSelectHotspot(h);
                }}
                onSelectCluster={onSelectCluster}
                onSelectPriorityIncident={onSelectPriorityIncident}
                initialCoords={activeMapCoords || [20.5937, 78.9629]}
              />
            ) : (
              <FireMap
                hotspots={hotspots}
                clusters={clusters}
                activeAlerts={alerts}
                priorityItems={priorityItems}
                selectedHotspot={activeTargetHotspot}
                selectedCluster={null}
                selectedPriorityIncident={selectedPriorityIncident}
                onSelectHotspot={(h) => {
                  setActiveTargetHotspot(h);
                  onSelectHotspot(h);
                }}
                onSelectCluster={onSelectCluster}
                onSelectAlert={onSelectAlert}
                mapCenter={activeMapCoords || [20.5937, 78.9629]}
                mapZoom={activeMapZoom}
                viewMode={mapLayerMode === 'clusters' ? 'clusters' : 'hotspots'}
                basemap={basemap}
                onBasemapChange={onBasemapChange}
              />
            )}
          </div>

          {/* COMPACT RECENT ACTIVITY FEED BELOW MAP */}
          <RecentActivitySection alertsCount={alerts.length} hotspotsCount={hotspots.length} />
        </div>

        {/* RIGHT ~30%: PRIORITY INCIDENTS LIST */}
        <div className="dashboard-triage-panel card-white">
          <div className="panel-header-bar">
            <div className="panel-title-group">
              <FontAwesomeIcon icon={faTriangleExclamation} className="panel-header-icon text-red" />
              <h3 className="panel-title">Priority Incidents</h3>
            </div>
            <span className="triage-count-badge">
              {loadingPriority && priorityItems.length === 0 ? '...' : `${triageIncidents.length} active`}
            </span>
          </div>

          {/* SEVERITY FILTER PILLS */}
          <div className="severity-filter-bar">
            <span className="filter-label">
              <FontAwesomeIcon icon={faFilter} className="mr-1 text-muted" /> Filter:
            </span>
            <button
              type="button"
              className={`pill-filter ${severityFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('ALL')}
            >
              All
            </button>
            <button
              type="button"
              className={`pill-filter ${severityFilter === 'CRITICAL' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('CRITICAL')}
            >
              Critical
            </button>
            <button
              type="button"
              className={`pill-filter ${severityFilter === 'HIGH' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('HIGH')}
            >
              High
            </button>
            <button
              type="button"
              className={`pill-filter ${severityFilter === 'MODERATE' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('MODERATE')}
            >
              Medium
            </button>
          </div>

          {/* INCIDENTS LIST */}
          <div className="triage-incidents-list">
            {loadingPriority && priorityItems.length === 0 ? (
              <div className="triage-loading-state" style={{ textAlign: 'center', padding: '24px 16px' }}>
                <FontAwesomeIcon icon={faArrowsRotate} spin style={{ fontSize: '18px', color: '#0284C7', marginBottom: '8px' }} />
                <div style={{ fontWeight: 600, color: '#0F172A', fontSize: '13px', letterSpacing: '0.04em' }}>SYNCING PRIORITY QUEUE...</div>
                <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>Connecting to threat prioritization engine</div>
              </div>
            ) : triageIncidents.length === 0 ? (
              <div className="triage-empty-state" style={{ textAlign: 'center', padding: '20px 12px' }}>
                <p style={{ color: '#64748B', fontSize: '12px', margin: 0 }}>No incidents match the selected severity filter.</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginTop: '8px', background: 'rgba(241, 245, 249, 0.9)', border: '1px solid rgba(203, 213, 225, 0.6)', color: '#0F172A', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                  onClick={onRefreshAll}
                >
                  <FontAwesomeIcon icon={faArrowsRotate} /> Retry Sync
                </button>
              </div>
            ) : (
              triageIncidents.map((inc) => {
                const isSelected = selectedIncidentId === inc.id;
                const scoreDisplay = inc.risk_score <= 1.0 ? Math.round(inc.risk_score * 100) : Math.round(inc.risk_score);
                const hasNearbyFeatures = inc.nearby_features && inc.nearby_features.length > 0;

                return (
                  <div
                    key={inc.id}
                    className={`incident-list-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleIncidentClick(inc)}
                    role="button"
                    tabIndex={0}
                    style={{
                      cursor: 'pointer',
                    }}
                  >
                    <div className="card-top-row">
                      <span className={`severity-badge ${getSeverityBadgeClass(inc.risk_level)}`}>
                        {inc.risk_level}
                      </span>
                      <span className="incident-risk-score font-mono font-bold" style={{ color: inc.risk_level === 'CRITICAL' ? '#DC2626' : inc.risk_level === 'HIGH' ? '#D97706' : '#64748B' }}>
                        Risk: {scoreDisplay}/100
                      </span>
                    </div>

                    <div className="card-mid-row">
                      <h4 className="incident-facility-name">
                        {inc.industrial_facility || 'Unregistered Sector'}
                      </h4>
                      <p className="incident-coords-text">
                        <FontAwesomeIcon icon={faLocationDot} className="mr-1 text-muted" />
                        {inc.latitude.toFixed(3)}°N, {inc.longitude.toFixed(3)}°E
                        {inc.industrial_distance_km !== null && inc.industrial_distance_km !== undefined
                          ? ` • ${Number(inc.industrial_distance_km).toFixed(2)} km`
                          : ''}
                      </p>
                    </div>

                    {/* Threat Exposure Status / Asset Counts */}
                    {hasNearbyFeatures ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#16A34A', background: 'rgba(22, 163, 74, 0.1)', border: '1px solid rgba(22, 163, 74, 0.25)', padding: '3px 8px', borderRadius: '4px', margin: '4px 0' }}>
                        <FontAwesomeIcon icon={faIndustry} />
                        <span>{inc.exposed_assets_count || inc.nearby_features!.length} mapped assets within 5.0 km</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#64748B', background: 'rgba(241, 245, 249, 0.7)', border: '1px solid rgba(203, 213, 225, 0.4)', padding: '3px 8px', borderRadius: '4px', margin: '4px 0' }}>
                        <span>Geospatial enrichment pending</span>
                        {onEnrichHotspot && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEnrichHotspot(inc.id, inc.latitude, inc.longitude);
                            }}
                            style={{ background: 'rgba(2, 132, 199, 0.1)', color: '#0284C7', border: '1px solid rgba(2, 132, 199, 0.3)', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
                          >
                            Enrich 5km
                          </button>
                        )}
                      </div>
                    )}

                    <div className="card-bottom-row">
                      <span className="incident-class-name font-medium">
                        {inc.classification.replace(/_/g, ' ')}
                      </span>
                      <span className="incident-time-tag">
                        {inc.id.slice(0, 14)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
