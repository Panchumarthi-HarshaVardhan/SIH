/**
 * Centralized Frontend API Client & Endpoint Configuration
 *
 * Reads backend API base URL from Vite environment variable `VITE_API_BASE_URL`.
 * Defaults to 'http://localhost:8000' for local development.
 */

import { getAccessToken } from '../lib/supabase.ts';

export const API_BASE_URL: string = (
  (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.VITE_API_BASE_URL) || 'http://localhost:8000'
).replace(/\/+$/, '');

/**
 * Builds a normalized, fully-qualified backend API endpoint URL.
 *
 * @param path Endpoint path (e.g., '/api/hotspots', 'api/alerts')
 * @returns Complete URL string with API_BASE_URL prefix
 */
export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

/**
 * Central authenticated fetch wrapper that attaches the active Supabase JWT Bearer token.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

/**
 * Resolves static or media asset URLs (such as satellite image patches)
 * served by the backend or external CDNs.
 *
 * @param path Relative or absolute asset path
 * @returns Fully qualified asset URL or null if empty
 */
export function getAssetUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return getApiUrl(path);
}

/**
 * Fetches the newest real NASA FIRMS observation with data freshness categorization.
 */
export async function fetchLatestFirmsObservation(): Promise<import('../types/hotspot').LatestFirmsResponse> {
  const response = await apiFetch(getApiUrl('/api/firms/latest'));
  if (!response.ok) {
    throw new Error(`Failed to fetch latest FIRMS observation: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * In-flight promise registry for getInvestigation to prevent redundant concurrent fetches.
 */
const inFlightInvestigations = new Map<string, Promise<import('../types/hotspot').InvestigationResponse>>();

/**
 * Retrieves the comprehensive Phase 6F multi-source investigation for a given FIRMS observation ID.
 *
 * @param observationId The unique FIRMS observation ID
 * @param forceRefresh Whether to bypass backend and client caching
 * @param signal Optional AbortSignal to cancel in-flight HTTP request
 * @returns Fully validated InvestigationResponse
 */
export async function getInvestigation(
  observationId: string,
  forceRefresh: boolean = false,
  signal?: AbortSignal
): Promise<import('../types/hotspot').InvestigationResponse> {
  if (!observationId || typeof observationId !== 'string') {
    throw new Error('Observation ID is required to fetch investigation.');
  }

  const cleanId = observationId.trim();

  // If not forcing refresh, no signal passed or signal not aborted, and an identical request is in flight, reuse the promise
  if (!forceRefresh && !signal?.aborted && inFlightInvestigations.has(cleanId)) {
    return inFlightInvestigations.get(cleanId)!;
  }

  const queryParam = forceRefresh ? '?force_refresh=true' : '';
  const url = getApiUrl(`/api/firms/${encodeURIComponent(cleanId)}/investigation${queryParam}`);

  const fetchPromise = (async () => {
    try {
      const response = await apiFetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson.detail) {
            errorDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          }
        } catch {
          // fallback to status text
        }
        throw new Error(`Investigation fetch failed (${errorDetail})`);
      }

      const data: import('../types/hotspot').InvestigationResponse = await response.json();
      return data;
    } finally {
      // Clean up in-flight registry
      inFlightInvestigations.delete(cleanId);
    }
  })();

  if (!forceRefresh) {
    inFlightInvestigations.set(cleanId, fetchPromise);
  }

  return fetchPromise;
}

/**
 * In-flight promise registry for getDecisionSupport to prevent redundant concurrent fetches.
 */
const inFlightDecisionSupport = new Map<string, Promise<import('../types/hotspot').DecisionSupportResponse>>();

/**
 * Retrieves the comprehensive Phase 6H operational decision support for a given FIRMS observation ID.
 *
 * @param observationId The unique FIRMS observation ID
 * @param forceRefresh Whether to bypass backend and client caching
 * @param signal Optional AbortSignal to cancel in-flight HTTP request
 * @returns Fully validated DecisionSupportResponse
 */
export async function getDecisionSupport(
  observationId: string,
  forceRefresh: boolean = false,
  signal?: AbortSignal
): Promise<import('../types/hotspot').DecisionSupportResponse> {
  if (!observationId || typeof observationId !== 'string') {
    throw new Error('Observation ID is required to fetch decision support.');
  }

  const cleanId = observationId.trim();

  if (!forceRefresh && inFlightDecisionSupport.has(cleanId)) {
    return inFlightDecisionSupport.get(cleanId)!;
  }

  const queryParam = forceRefresh ? '?force_refresh=true' : '';
  const url = getApiUrl(`/api/firms/${encodeURIComponent(cleanId)}/decision-support${queryParam}`);

  const fetchPromise = (async () => {
    try {
      const response = await apiFetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson.detail) {
            errorDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          }
        } catch {
          // fallback to status text
        }
        throw new Error(`Decision support fetch failed (${errorDetail})`);
      }

      const raw: any = await response.json();

      // Normalize Threat Zones
      const tz = raw.threat_zone || raw.threat_zones || { available: false, zones: {} };
      const innerZone = tz.zones?.inner_zone || tz.zones?.inner;
      const secZone = tz.zones?.secondary_zone || tz.zones?.secondary;
      const monZone = tz.zones?.monitoring_zone || tz.zones?.monitoring;

      const highHazard = tz.high_hazard_zone || (innerZone ? {
        name: innerZone.name || 'Inner Tactical Zone',
        radius_meters: Math.round((innerZone.radius_km || 0.3) * 1000),
        description: innerZone.description || 'Immediate tactical isolation area. Thermal radiation & flashover hazard.',
        key_actions: ['Immediate tactical perimeter isolation', 'Deploy thermal suppression & foam units'],
      } : null);

      const modHazard = tz.moderate_hazard_zone || (secZone ? {
        name: secZone.name || 'Secondary Impact Zone',
        radius_meters: Math.round((secZone.radius_km || 0.8) * 1000),
        description: secZone.description || 'Secondary buffer zone. Airborne particulate and plume dispersion corridor.',
        key_actions: ['Secondary perimeter staging', 'Plume & atmospheric dispersion monitoring'],
      } : null);

      const precHazard = tz.precautionary_zone || (monZone ? {
        name: monZone.name || 'Perimeter Monitoring Zone',
        radius_meters: Math.round((monZone.radius_km || 1.85) * 1000),
        description: monZone.description || 'Extended precautionary buffer. Logistics & traffic control corridor.',
        key_actions: ['Traffic diversion & logistical staging', 'Coordinate with local municipal services'],
      } : null);

      const threatRadiusMeters = tz.threat_radius_meters || (precHazard?.radius_meters ?? modHazard?.radius_meters ?? highHazard?.radius_meters ?? 1000);

      const normalizedThreatZones = {
        ...tz,
        threat_radius_meters: threatRadiusMeters,
        high_hazard_zone: highHazard,
        moderate_hazard_zone: modHazard,
        precautionary_zone: precHazard,
      };

      // Normalize Asset Exposure
      const ae = raw.asset_exposure || { available: false, total_exposed_assets: 0, critical_infrastructure_count: 0, exposed_assets: [] };
      const exposedList = ae.exposed_assets || ae.facilities || [];
      const facilitiesList = exposedList.map((item: any) => ({
        ...item,
        name: item.name || item.asset_name || 'Mapped Facility',
        type: item.type || item.raw_type || item.category || 'Infrastructure',
        distance_km: item.distance_km ?? 0.5,
        is_critical: item.is_critical ?? (
          item.exposure_level?.includes('HIGH') ||
          item.threat_zone?.includes('Inner') ||
          item.category === 'INDUSTRIAL' ||
          item.category === 'UTILITIES'
        ),
      }));

      const normalizedAssetExposure = {
        ...ae,
        exposed_assets: exposedList,
        facilities: facilitiesList,
        high_vulnerability_count: ae.high_vulnerability_count ?? facilitiesList.filter((f: any) => f.is_critical).length,
        moderate_count: ae.moderate_count ?? facilitiesList.filter((f: any) => !f.is_critical).length,
      };

      // Normalize Priority
      const priority = raw.priority || {
        priority_index: 'P4',
        priority_level: 'LOW',
        priority_score: 0,
        priority_label: 'P4 — ROUTINE',
      };
      const normalizedPriority = {
        ...priority,
        scoring_breakdown: priority.scoring_breakdown || priority.contributing_factors || {},
        ranking_reasons: priority.ranking_reasons || priority.reasons || [],
        explainability_summary: priority.explainability_summary || raw.summary?.recommended_action || priority.priority_label || 'Evaluated based on multi-source radiometric intensity, spatial context, and asset exposure.',
      };

      // Normalize Future Impact
      const fi = raw.future_impact || { available: false, projections: {} };
      let projectionsList: any[] = [];
      if (Array.isArray(fi.projections)) {
        projectionsList = fi.projections;
      } else if (fi.projections && typeof fi.projections === 'object') {
        projectionsList = Object.entries(fi.projections).map(([key, val]: [string, any]) => ({
          time_horizon: val.time_horizon || key,
          hours: val.hours ?? (parseInt(key.replace(/[^0-9]/g, '')) || 1),
          projection_window_hours: val.hours ?? (parseInt(key.replace(/[^0-9]/g, '')) || 1),
          threat_level: val.threat_level || val.impact_level || 'MODERATE',
          risk_summary: val.risk_summary || `Projected footprint: ${val.projected_area_sqkm != null ? val.projected_area_sqkm.toFixed(1) + ' km²' : 'Expanding'} (${val.confidence_level || 'MEDIUM'} confidence). ${val.total_exposed_assets ?? 0} assets exposed.`,
          radius_meters: val.radius_meters || (val.projected_area_sqkm ? Math.round(Math.sqrt(val.projected_area_sqkm / Math.PI) * 1000) : undefined),
          ...val,
        }));
      }

      const normalizedFutureImpact = {
        ...fi,
        scenarios_evaluated: fi.scenarios_evaluated ?? projectionsList.length,
        projections: projectionsList,
        advisory_notes: fi.advisory_notes || (fi.escalation_reasons && fi.escalation_reasons.length > 0 ? fi.escalation_reasons : [
          'Spread models incorporate historical local wind vectors and terrain slope.',
          'Dynamic updates occur as refreshed FIRMS/Sentinel-2 passes are ingested.'
        ]),
      };

      // Normalize Recommended Actions
      const recActions = Array.isArray(raw.recommended_actions)
        ? raw.recommended_actions.map((rec: any) => {
            let stakeholders = rec.recommended_stakeholders;
            if (!stakeholders || !Array.isArray(stakeholders) || stakeholders.length === 0) {
              if (rec.category === 'DEPLOY_UNIT') {
                stakeholders = ['Industrial Fire Brigade', 'Rapid Tactical Unit'];
              } else if (rec.category === 'REVIEW_SATELLITE') {
                stakeholders = ['Remote Sensing Specialist', 'EOC Analyst'];
              } else if (rec.category === 'VERIFY_FACILITY') {
                stakeholders = ['Facility Safety Officer', 'Local EOC'];
              } else {
                stakeholders = ['Emergency Operations Center', 'Incident Commander'];
              }
            }
            return {
              ...rec,
              recommended_stakeholders: stakeholders,
            };
          })
        : [];

      // Normalize Safety Flags
      const safetyFlags = raw.safety_flags || {
        is_synthetic: !!raw.investigation?.sentinel2?.is_synthetic,
        is_calibrated: !!raw.investigation?.sentinel2?.is_calibrated,
        is_simulation_only: true,
      };

      const data: import('../types/hotspot').DecisionSupportResponse = {
        ...raw,
        threat_zone: normalizedThreatZones,
        threat_zones: normalizedThreatZones,
        asset_exposure: normalizedAssetExposure,
        priority: normalizedPriority,
        future_impact: normalizedFutureImpact,
        recommended_actions: recActions,
        safety_flags: safetyFlags,
      };

      return data;
    } finally {
      inFlightDecisionSupport.delete(cleanId);
    }
  })();

  if (!forceRefresh) {
    inFlightDecisionSupport.set(cleanId, fetchPromise);
  }

  return fetchPromise;
}

/**
 * Records an operator triage action on an incident (ACKNOWLEDGE, DISPATCH, INVESTIGATE, ESCALATE, RESOLVE, DISMISS, ADD_NOTE).
 */
export async function recordIncidentAction(
  observationId: string,
  request: import('../types/hotspot').IncidentActionRequest
): Promise<import('../types/hotspot').IncidentActionResponse> {
  if (!observationId || typeof observationId !== 'string') {
    throw new Error('Observation ID is required to record incident action.');
  }

  const cleanId = observationId.trim();
  const url = getApiUrl(`/api/incidents/${encodeURIComponent(cleanId)}/action`);

  const response = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.detail) {
        errorDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      // fallback
    }
    throw new Error(`Failed to record action: ${errorDetail}`);
  }

  return response.json();
}

/**
 * Retrieves the complete chronological audit trail and state history for an incident.
 */
export async function getIncidentAuditTrail(
  observationId: string,
  descending: boolean = true
): Promise<import('../types/hotspot').IncidentAuditTrailResponse> {
  if (!observationId || typeof observationId !== 'string') {
    throw new Error('Observation ID is required to fetch audit trail.');
  }

  const cleanId = observationId.trim();
  const url = getApiUrl(`/api/incidents/${encodeURIComponent(cleanId)}/audit-trail?descending=${descending}`);

  const response = await apiFetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.detail) {
        errorDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
      }
    } catch {
      // fallback
    }
    throw new Error(`Failed to fetch audit trail: ${errorDetail}`);
  }

  return response.json();
}

/**
 * Retrieves fleet-wide operational triage summary counts.
 */
export async function getIncidentOperationalSummary(): Promise<import('../types/hotspot').IncidentOperationalSummary> {
  const url = getApiUrl('/api/incidents/operational-summary');
  const response = await apiFetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch operational summary: HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Pre-configured verified benchmark scenarios for SIH judging and live demonstration.
 */
export const DEMO_SCENARIO_PRESETS: import('../types/hotspot').DemoScenarioPreset[] = [
  {
    id: 'demo_industrial_p1',
    name: 'Petrochemical Refinery Flare [P1 CRITICAL]',
    description: 'Persistent 45 MW thermal anomaly adjacent to LNG storage tanks. 6-band CNN confirmed industrial fire candidate.',
    observation_id: '423f0b1ad50facd6',
    priority: 'P1',
    priority_label: 'CRITICAL',
    candidate_class: 'INDUSTRIAL_FIRE',
    coordinates: [24.23818, 97.22869],
    location_name: 'Gujarat Petrochemical Corridor',
    badge: 'P1 CRITICAL',
  },
  {
    id: 'demo_wildfire_p2',
    name: 'Forest Canopy Wildfire [P2 HIGH]',
    description: 'High-radiance biomass fire spreading along timber line. Optical CNN identifies wildfire signatures.',
    observation_id: '04e53a2f16d0d665',
    priority: 'P2',
    priority_label: 'HIGH',
    candidate_class: 'WILDFIRE',
    coordinates: [22.6789, 80.54321],
    location_name: 'Kanha Forest Reserve Perimeter',
    badge: 'P2 HIGH',
  },
  {
    id: 'demo_crop_burn_p4',
    name: 'Agricultural Crop Residual [P4 LOW]',
    description: 'Transient thermal signature with zero nearby industrial facilities. Clear sky land validation.',
    observation_id: 'a35cd8640d876fc2',
    priority: 'P4',
    priority_label: 'LOW',
    candidate_class: 'NON_FIRE',
    coordinates: [30.7333, 76.7794],
    location_name: 'Northern Agricultural Belt',
    badge: 'P4 LOW',
  },
  {
    id: 'demo_degraded_cloud',
    name: 'Coastal Anomaly (Cloud Degraded) [P3 MEDIUM]',
    description: 'Thermal anomaly with >70% cloud cover. System activates safety guardrail and flags partial evidence.',
    observation_id: '90b58068fefb3a79',
    priority: 'P3',
    priority_label: 'MEDIUM',
    candidate_class: 'UNKNOWN',
    coordinates: [21.8456, 73.1234],
    location_name: 'Gulf Coastal Industrial Zone',
    badge: 'P3 GUARDRAIL',
  },
];

export interface SatelliteOrbitTelemetryResponse {
  satellite: string;
  instrument: string;
  norad_id: number;
  cospar_id: string;
  epoch_utc: string;
  orbital_elements: {
    altitude_km: number;
    inclination_deg: number;
    period_minutes: number;
    velocity_km_s: number;
    orbit_type: string;
  };
  sub_satellite_point: {
    latitude: number;
    longitude: number;
    altitude_km: number;
  };
  sensor_telemetry: {
    swath_width_km: number;
    swath_radius_km: number;
    status: string;
    acquisition_state: string;
    is_over_india: boolean;
  };
  ground_track: Array<{
    latitude: number;
    longitude: number;
    altitude_km: number;
    offset_minutes: number;
  }>;
  disclaimer: string;
}

/**
 * Retrieves live or deterministic orbital telemetry and ground track coordinates for NOAA-21 VIIRS.
 */
export async function fetchSatelliteOrbitTelemetry(): Promise<SatelliteOrbitTelemetryResponse> {
  const response = await fetch(getApiUrl('/api/satellite/orbit/telemetry'));
  if (!response.ok) {
    throw new Error(`Failed to fetch satellite orbit telemetry: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Dynamic Threat Zone Boundaries caller.
 */
export async function fetchThreatZones(
  frp: number,
  riskScore = 50.0,
  severity = 'MODERATE',
  classification = 'THERMAL_EVENT'
): Promise<import('../types/hotspot').ThreatZonesResponse> {
  const params = new URLSearchParams({
    frp: String(frp),
    risk_score: String(riskScore),
    severity,
    classification,
  });
  const response = await fetch(getApiUrl(`/api/threat-zones?${params.toString()}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch threat zones: HTTP ${response.status}`);
  }
  return response.json();
}



