import {
  faArrowsRotate,
  faIndustry,
  faMagnifyingGlass,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState, useMemo } from 'react';
import {
  Hotspot,
  PersistentCluster,
  ThermalAlert,
  PriorityRankingItem,
} from '../types/hotspot';

interface IncidentsViewProps {
  hotspots: Hotspot[];
  clusters: PersistentCluster[];
  alerts: ThermalAlert[];
  priorityItems: PriorityRankingItem[];
  loading: boolean;
  onSelectHotspot: (h: Hotspot) => void;
  onSelectCluster: (c: PersistentCluster) => void;
  onSelectAlert: (a: ThermalAlert) => void;
  onOpenInvestigation?: () => void;
}

export function IncidentsView({
  hotspots,
  clusters,
  alerts,
  priorityItems,
  loading,
  onSelectHotspot,
  onSelectCluster,
  onSelectAlert,
  onOpenInvestigation,
}: IncidentsViewProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'high_risk' | 'industrial' | 'persistent'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Build unified incident row list
  const combinedList = useMemo(() => {
    if (priorityItems.length > 0) {
      return priorityItems.map((p, idx) => {
        const cluster = clusters.find(c => c.cluster_id === p.cluster_id);
        const alert = alerts.find(a => a.cluster_id === p.cluster_id);
        return {
          id: p.cluster_id,
          rank: p.rank || idx + 1,
          lat: p.latitude,
          lon: p.longitude,
          riskScore: p.risk_score,
          riskLevel: p.risk_level,
          facility: p.industrial_facility || 'Rural / Unregistered Land',
          distanceKm: p.industrial_distance_km,
          obsCount: p.observation_count,
          durationHours: p.duration_hours,
          classification: p.classification,
          status: alert?.status || 'NEW',
          clusterObj: cluster,
          alertObj: alert,
        };
      });
    }

    // Fallback: build from clusters
    if (clusters.length > 0) {
      const sorted = [...clusters].sort((a, b) => (b.total_frp || 0) - (a.total_frp || 0));
      return sorted.map((c, idx) => {
        const alert = alerts.find(a => a.cluster_id === c.cluster_id);
        const totalFrp = c.total_frp || 20.0;
        const score = Math.min(0.95, (totalFrp / 100) * 0.5 + (c.observation_count > 1 ? 0.3 : 0.1));
        const level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' =
          score >= 0.7 ? 'CRITICAL' : score >= 0.4 ? 'HIGH' : score >= 0.2 ? 'MODERATE' : 'LOW';

        return {
          id: c.cluster_id,
          rank: idx + 1,
          lat: c.center_latitude,
          lon: c.center_longitude,
          riskScore: score,
          riskLevel: level,
          facility: c.industrial_context?.nearby_facility || 'Rural / Agricultural Zone',
          distanceKm: c.industrial_context?.distance_km ?? null,
          obsCount: c.observation_count,
          durationHours: c.duration_hours,
          classification: c.classification || 'TEMPORARY',
          status: alert?.status || 'NEW',
          clusterObj: c,
          alertObj: alert,
        };
      });
    }

    // Fallback: build from raw hotspots
    return hotspots.map((h, idx) => {
      const frpVal = h.frp || 10.0;
      const score = Math.min(0.95, frpVal / 100);
      const level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' =
        score >= 0.7 ? 'CRITICAL' : score >= 0.4 ? 'HIGH' : score >= 0.2 ? 'MODERATE' : 'LOW';

      return {
        id: h.observation_id || `HOTSPOT_${idx + 1}`,
        rank: idx + 1,
        lat: h.latitude,
        lon: h.longitude,
        riskScore: score,
        riskLevel: level,
        facility: 'Rural / Unregistered Land',
        distanceKm: null,
        obsCount: 1,
        durationHours: 0,
        classification: 'NASA FIRMS Detection',
        status: 'NEW',
        clusterObj: undefined,
        alertObj: undefined,
      };
    });
  }, [priorityItems, clusters, alerts, hotspots]);

  // Apply filters and search
  const filteredRows = useMemo(() => {
    return combinedList.filter(row => {
      // Tab filter
      if (activeTab === 'high_risk' && row.riskScore < 0.70 && row.riskLevel !== 'CRITICAL') return false;
      if (activeTab === 'industrial' && (!row.distanceKm || row.distanceKm > 1.0)) return false;
      if (activeTab === 'persistent' && row.obsCount <= 1) return false;

      // Status filter
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = row.facility.toLowerCase().includes(q);
        const matchesId = row.id.toLowerCase().includes(q);
        const matchesCoords = `${row.lat},${row.lon}`.includes(q);
        const matchesClass = row.classification.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesCoords && !matchesClass) return false;
      }

      return true;
    });
  }, [combinedList, activeTab, statusFilter, searchQuery]);

  return (
    <div className="incidents-view-container">
      {/* HEADER BAR */}
      <div className="incidents-view-header">
        <div>
          <h2 className="view-title"><FontAwesomeIcon icon={faTriangleExclamation} /> Active Incidents & Thermal Triage Queue</h2>
          <p className="view-subtitle">
            Ranked queue of thermal anomalies prioritized by Operational Risk Score and industrial proximity.
          </p>
        </div>
        <div className="incident-stats-badge">
          <span>{filteredRows.length} showing</span>
          <span className="dot-sep">•</span>
          <span>{combinedList.length} total monitored</span>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="incidents-toolbar">
        <div className="tab-buttons-group">
          <button
            type="button"
            className={`btn-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Incidents ({combinedList.length})
          </button>
          <button
            type="button"
            className={`btn-tab ${activeTab === 'high_risk' ? 'active' : ''}`}
            onClick={() => setActiveTab('high_risk')}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} /> High Risk ({combinedList.filter(r => r.riskScore >= 0.70 || r.riskLevel === 'CRITICAL').length})
          </button>
          <button
            type="button"
            className={`btn-tab ${activeTab === 'industrial' ? 'active' : ''}`}
            onClick={() => setActiveTab('industrial')}
          >
            <FontAwesomeIcon icon={faIndustry} /> Industrial Candidates ({combinedList.filter(r => r.distanceKm !== null && r.distanceKm <= 1.0).length})
          </button>
          <button
            type="button"
            className={`btn-tab ${activeTab === 'persistent' ? 'active' : ''}`}
            onClick={() => setActiveTab('persistent')}
          >
            <FontAwesomeIcon icon={faArrowsRotate} /> Persistent Sources ({combinedList.filter(r => r.obsCount > 1).length})
          </button>
        </div>

        <div className="search-and-status-group">
          <input
            type="text"
            className="input-search-incidents"
            placeholder="Search facility, ID, coordinates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className="select-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            <option value="NEW">NEW</option>
            <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
            <option value="INVESTIGATING">INVESTIGATING</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="DISMISSED">DISMISSED</option>
          </select>
        </div>
      </div>

      {/* INCIDENTS TABLE */}
      <div className="incidents-table-wrapper">
        {loading ? (
          <div className="loading-state-box"><FontAwesomeIcon icon={faArrowsRotate} spin className="mr-1 text-green" /> Loading incident queue from PostgreSQL & FIRMS...</div>
        ) : filteredRows.length === 0 ? (
          <div className="empty-state-box">No incidents found matching current filter criteria.</div>
        ) : (
          <table className="incidents-data-table">
            <thead>
              <tr>
                <th>Rank / ID</th>
                <th>Operational Risk</th>
                <th>Coordinates</th>
                <th>Nearest Industrial Facility</th>
                <th>Persistence</th>
                <th>AI Classification</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isCrit = row.riskLevel === 'CRITICAL' || row.riskScore >= 0.70;
                const isHigh = row.riskLevel === 'HIGH' || row.riskScore >= 0.40;
                const riskBadgeClass = isCrit ? 'risk-badge-critical' : isHigh ? 'risk-badge-high' : 'risk-badge-moderate';

                return (
                  <tr
                    key={row.id}
                    className="incident-table-row"
                    onClick={() => {
                      if (row.clusterObj) {
                        onSelectCluster(row.clusterObj);
                      } else if (row.alertObj) {
                        onSelectAlert(row.alertObj);
                      } else {
                        const matched = hotspots.find(h =>
                          h.observation_id === row.id ||
                          (Math.abs(h.latitude - row.lat) < 0.05 && Math.abs(h.longitude - row.lon) < 0.05)
                        );
                        if (matched) {
                          onSelectHotspot(matched);
                        } else {
                          onSelectHotspot({
                            observation_id: row.id,
                            latitude: row.lat,
                            longitude: row.lon,
                            frp: 25.8,
                            brightness: 350.0,
                            confidence: 'h',
                            satellite: 'VIIRS',
                            instrument: 'VIIRS',
                            acquired_at: '2026-09-07 14:30 UTC'
                          } as Hotspot);
                        }
                      }
                    }}
                  >
                    <td>
                      <div className="table-rank-id">
                        <span className="row-rank">#{row.rank}</span>
                        <span className="row-id">{row.id}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`risk-badge ${riskBadgeClass}`}>
                        {row.riskScore.toFixed(2)} • {row.riskLevel}
                      </span>
                    </td>
                    <td className="coords-cell">
                      {row.lat.toFixed(4)}°N, {row.lon.toFixed(4)}°E
                    </td>
                    <td>
                      <div className="facility-cell">
                        <span className="cell-facility-name">{row.facility}</span>
                        <span className="cell-facility-dist">
                          {row.distanceKm !== null
                            ? `${(row.distanceKm * 1000).toFixed(0)}m proximity`
                            : 'No close facility'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="persistence-cell-badge">
                        {row.obsCount} passes ({row.durationHours.toFixed(1)}h)
                      </span>
                    </td>
                    <td>
                      <span className="ai-class-cell">{row.classification}</span>
                    </td>
                    <td>
                      <span className={`lifecycle-status-pill status-${row.status.toLowerCase()}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-table-investigate"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.clusterObj) onSelectCluster(row.clusterObj);
                          else if (row.alertObj) onSelectAlert(row.alertObj);
                          onOpenInvestigation && onOpenInvestigation();
                        }}
                      >
                        <FontAwesomeIcon icon={faMagnifyingGlass} /> Investigate
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
