export interface Hotspot {
  observation_id?: string;
  latitude: number;
  longitude: number;
  brightness: number;
  confidence: string | number;
  frp: number;
  acquired_at: string;
  acq_date?: string;
  acq_time?: string;
  satellite: string;
  instrument: string;
  source: string;
  ingested_at?: string;
}

export interface LatestFirmsResponse {
  available: boolean;
  observation_id?: string;
  latitude?: number;
  longitude?: number;
  brightness?: number;
  confidence?: string | number;
  frp?: number;
  satellite?: string;
  instrument?: string;
  acquired_at?: string;
  ingested_at?: string;
  age_minutes?: number;
  freshness: 'FRESH' | 'RECENT' | 'STALE' | 'NO_DATA';
  source?: string;
  message?: string;
  observation?: Hotspot | null;
}

export interface HotspotsApiResponse {
  source: string;
  region: string;
  bbox: number[];
  count: number;
  hotspots: Hotspot[];
  fetched_at: string;
}

export interface OsmFeature {
  name: string;
  type: string;
  category: string;
  latitude: number;
  longitude: number;
  distance_km: number;
  osm_id?: string;
  id?: string;
  source?: string;
  importance_weight?: number;
}

export interface HotspotContextResponse {
  hotspot: {
    latitude: number;
    longitude: number;
  };
  search_radius_km: number;
  context_classification: 'INDUSTRIAL' | 'URBAN' | 'RURAL_OR_AGRICULTURAL' | 'UNKNOWN';
  facility_count: number;
  nearby_features: OsmFeature[];
  nearby_facility?: string | null;
  distance_km?: number | null;
  fetched_at: string;
}


export interface PersistentCluster {
  cluster_id: string;
  center_latitude: number;
  center_longitude: number;
  observation_count: number;
  first_detected: string;
  last_detected: string;
  duration_hours: number;
  spatial_radius_km: number;
  persistence_score: number;
  total_frp?: number;
  classification: 'TEMPORARY' | 'SUSPICIOUS' | 'PERSISTENT' | 'HIGHLY PERSISTENT';
  observations: Hotspot[];
  industrial_context?: {
    context_classification: string;
    nearby_facility: string | null;
    facility_type: string | null;
    facility_category: string | null;
    distance_km: number | null;
  } | null;
  has_sufficient_history: boolean;
}

export interface PersistentClustersApiResponse {
  source: string;
  region: string;
  total_clusters: number;
  persistent_cluster_count: number;
  spatial_threshold_km: number;
  clusters: PersistentCluster[];
  status: string;
  message?: string;
  fetched_at: string;
}

export interface AiClassificationResponse {
  classification: string;
  confidence_percentage: number;
  model_source: 'ML_MODEL' | 'PROTOTYPE_RULE_ENGINE';
  model_status: 'trained' | 'not_trained';
  model_version: string;
  supporting_indicators: string[];
  features: Record<string, number | string>;
}

export interface RiskScoreResponse {
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  model_source: 'ML_MODEL' | 'PROTOTYPE_RULE_ENGINE';
  classification: string;
  components: {
    thermal_intensity: number;
    satellite_confidence: number;
    persistence: number;
    industrial_proximity: number;
    classification_context: number;
  };
  max_component_weights: {
    thermal_intensity: number;
    satellite_confidence: number;
    persistence: number;
    industrial_proximity: number;
    classification_context: number;
  };
  normalized_scores_100: Record<string, number>;
  reasons: string[];
  features: Record<string, number | string>;
  fetched_at: string;
}

export interface PriorityRankingItem {
  rank: number;
  cluster_id: string;
  hotspot_id?: string;
  latitude: number;
  longitude: number;
  frp?: number;
  brightness?: number;
  confidence?: string;
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  priority?: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  classification: string;
  industrial_facility: string;
  industrial_distance_km: number | null;
  closest_critical_asset?: OsmFeature | null;
  nearest_facility?: OsmFeature | null;
  primary_name?: string | null;
  secondary_locality?: string | null;
  display_locality?: string | null;
  exposed_assets_count?: number;
  exposure_summary?: Record<string, number>;
  nearby_features?: OsmFeature[];
  data_status?: string;
  persistence_score: number;
  observation_count: number;
  duration_hours: number;
  reasons: string[];
  recommended_action?: string;
  components?: Record<string, number>;
  data_source?: string;
}

export interface ThermalAlert {
  alert_id: string;
  cluster_id: string;
  latitude: number;
  longitude: number;
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  frp?: number;
  impact_score?: number;
  impact_level?: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  priority_index?: PriorityIndex;
  classification: string;
  model_source: 'ML_MODEL' | 'PROTOTYPE_RULE_ENGINE';
  persistence_score: number;
  observation_count: number;
  duration_hours: number;
  industrial_distance_km: number | null;
  facility_name: string | null;
  status: 'NEW' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';
  evidence: string[];
  features: Record<string, number | string>;
  created_at: string;
  updated_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
}

export interface AlertStats {
  total_alerts: number;
  active_alerts: number;
  critical_alerts: number;
  high_alerts: number;
  acknowledged_alerts: number;
  investigating_alerts: number;
  resolved_today: number;
  fetched_at: string;
}

export interface SatelliteEvidence {
  image_available: boolean;
  available?: boolean;
  is_synthetic?: boolean;
  classification?: 'INDUSTRIAL_FIRE' | 'NATURAL_FIRE' | 'PERSISTENT_THERMAL_SOURCE' | 'NON_FIRE' | 'UNKNOWN' | string;
  confidence?: number;
  source: string;
  product?: string;
  model?: string;
  model_type?: string;
  model_version?: string;
  captured_at?: string;
  satellite_acquired_at?: string;
  firms_acquired_at?: string;
  retrieved_at?: string;
  cloud_percentage?: number | null;
  cloud_cover?: number | null;
  class?: string;
  quality?: string;
  is_calibrated?: boolean;
  time_difference_hours?: number | null;
  image_url?: string;
  image_path?: string;
  bounding_box?: number[];
  observation_id?: string;
  latitude?: number;
  longitude?: number;
  visual_evidence?: string;
  status?: string;
  error_message?: string;
  class_probabilities?: Record<string, number>;
  gradcam_overlay_path?: string;
  gradcam_region?: string;
}


export interface FusedEvidenceResponse {
  final_classification: string;
  combined_confidence: number;
  combined_confidence_percentage: number;
  combined_risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  fusion_summary: string;
  evidence: {
    firms: {
      frp_mw: number;
      brightness_k: number;
      confidence: string;
      summary: string;
    };
    osm: {
      context: string;
      nearby_facility: string;
      distance_km: number | null;
      summary: string;
    };
    persistence: {
      persistence_score: number;
      observation_count: number;
      duration_hours: number;
      summary: string;
    };
    satellite: SatelliteEvidence;
  };
}

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export type IncidentLifecycleStatus =
  | 'AI_DETECTED'
  | 'UNDER_VERIFICATION'
  | 'CONFIRMED'
  | 'RESPONSE_INITIATED'
  | 'CONTAINMENT'
  | 'RESOLVED'
  | 'DISMISSED';

export type AuthorityRole =
  | 'SEOC_DIRECTOR'
  | 'FIRE_RESCUE_CHIEF'
  | 'INDUSTRIAL_SAFETY_INSPECTOR'
  | 'POLICE_COMMISSIONER'
  | 'CITIZEN_OBSERVER';

export interface SystemPipelineEvent {
  id: string;
  timestamp: string;
  stage: string;
  description: string;
  type: 'info' | 'success' | 'warning' | 'alert';
}

export function mapAlertStatusToLifecycle(status: string): IncidentLifecycleStatus {
  switch (status) {
    case 'NEW':
      return 'AI_DETECTED';
    case 'ACKNOWLEDGED':
      return 'UNDER_VERIFICATION';
    case 'INVESTIGATING':
      return 'RESPONSE_INITIATED';
    case 'RESOLVED':
      return 'RESOLVED';
    case 'DISMISSED':
      return 'DISMISSED';
    default:
      return 'AI_DETECTED';
  }
}

export function getSeverityFromFrpAndRisk(frp: number, riskScore?: number): IncidentSeverity {
  if ((riskScore !== undefined && riskScore >= 75) || frp >= 50) return 'CRITICAL';
  if ((riskScore !== undefined && riskScore >= 50) || frp >= 25) return 'HIGH';
  if ((riskScore !== undefined && riskScore >= 30) || frp >= 10) return 'MODERATE';
  return 'LOW';
}

export type PriorityIndex = 'P1' | 'P2' | 'P3' | 'P4';

export interface ThreatZoneDetail {
  name: string;
  radius_km: number;
  color: string;
  fill_opacity: number;
  threat_level: string;
  description: string;
}

export interface ThreatZonesResponse {
  zones: {
    inner_zone: ThreatZoneDetail;
    secondary_zone: ThreatZoneDetail;
    monitoring_zone: ThreatZoneDetail;
  };
  factors_applied: Record<string, any>;
  disclaimer: string;
}

export interface ExposedAsset {
  asset_name: string;
  category: 'INDUSTRIAL' | 'HEALTHCARE' | 'EDUCATION' | 'TRANSPORT' | 'UTILITIES' | 'SETTLEMENTS' | 'PUBLIC';
  raw_type: string;
  latitude: number;
  longitude: number;
  distance_km: number;
  threat_zone: string;
  exposure_level: string;
  status: string;
  data_source: string;
}

export interface AssetAnalysisResponse {
  total_exposed_assets: number;
  critical_infrastructure_count: number;
  category_counts: Record<string, number>;
  nearest_critical_asset?: ExposedAsset | null;
  exposed_assets: ExposedAsset[];
  data_provenance: string;
}

export interface ImpactAssessmentResponse {
  impact_score: number;
  impact_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  priority_index: PriorityIndex;
  priority_label: string;
  priority_description: string;
  components: {
    asset_exposure: number;
    infrastructure_criticality: number;
    fire_severity: number;
    persistence: number;
    industrial_context: number;
  };
  max_component_weights: Record<string, number>;
  explainable_reasons: string[];
  summary_statement: string;
}

export interface FullIncidentImpactResponse {
  incident: {
    latitude: number;
    longitude: number;
    frp: number;
    brightness: number;
    classification: string;
    risk_score: number;
    risk_level: string;
  };
  threat_zones: ThreatZonesResponse;
  asset_analysis: AssetAnalysisResponse;
  impact_assessment: ImpactAssessmentResponse;
  data_provenance: string;
}

export interface PriorityIncidentItem {
  cluster_id: string;
  latitude: number;
  longitude: number;
  frp: number;
  risk_score: number;
  risk_level: string;
  impact_score: number;
  impact_level: string;
  priority_index: PriorityIndex;
  priority_label: string;
  classification: string;
  exposed_assets_count: number;
  critical_infrastructure_count: number;
  nearest_critical_asset?: ExposedAsset | null;
  persistence_score: number;
  duration_hours: number;
  observation_count: number;
}

/* ==========================================================================
   PHASE 3 — FIRE SPREAD INTELLIGENCE & 3D THREAT TYPES
   ========================================================================== */

export type TimeHorizonKey = 'NOW' | '+1H' | '+3H' | '+6H' | '+12H';

export interface TimeHorizonGeometry {
  time_horizon: TimeHorizonKey;
  hours: number;
  label: string;
  center_latitude: number;
  center_longitude: number;
  displacement_km: number;
  radii_km: {
    core: number;
    high_risk: number;
    uncertainty: number;
    monitoring: number;
  };
  projected_area_sqkm: number;
  confidence_score: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  polygon_points: [number, number][];
  relative_intensity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
}

export interface SpreadProjectionResponse {
  incident_origin: {
    latitude: number;
    longitude: number;
    frp: number;
    risk_score: number;
    classification: string;
  };
  wind_data: {
    available: boolean;
    wind_speed_kmh?: number | null;
    wind_direction_deg?: number | null;
    heading_deg?: number | null;
    cardinal_direction: string;
    status_text: string;
  };
  spread_speed_kmh: number;
  estimated_direction: string;
  projections: Record<TimeHorizonKey, TimeHorizonGeometry>;
  explainable_reasons: string[];
  disclaimer: string;
  data_provenance: string;
}

export interface TimeSeriesHorizonImpact {
  time_horizon: TimeHorizonKey;
  hours: number;
  center_latitude: number;
  center_longitude: number;
  projected_area_sqkm: number;
  confidence_score: number;
  confidence_level: string;
  total_exposed_assets: number;
  critical_infrastructure_count: number;
  impact_score: number;
  impact_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  priority_index: PriorityIndex;
  priority_label: string;
  nearest_critical_asset?: ExposedAsset | null;
  exposed_assets: ExposedAsset[];
}

export interface FutureImpactForecastResponse {
  incident_origin: any;
  wind_data: any;
  spread_speed_kmh: number;
  estimated_direction: string;
  time_series_forecast: Record<TimeHorizonKey, TimeSeriesHorizonImpact>;
  escalation: {
    detected: boolean;
    initial_priority: string;
    projected_12h_priority: string;
    reasons: string[];
  };
  explainable_reasons: string[];
  disclaimer: string;
  data_provenance: string;
}

export interface SimulationResultResponse {
  status: string;
  is_simulation: boolean;
  isolation_guarantee: string;
  simulated_scenario_inputs: {
    wind_speed_kmh?: number | null;
    wind_direction_deg?: number | null;
    frp?: number | null;
    persistence_score?: number | null;
  };
  comparison_summary: {
    time_horizon: string;
    live_conditions: Record<string, any>;
    simulated_conditions: Record<string, any>;
    deltas: {
      delta_impact_score: number;
      delta_exposed_assets: number;
      delta_projected_area_sqkm: number;
      impact_escalated: boolean;
    };
  };
  live_forecast: FutureImpactForecastResponse;
  simulated_forecast: FutureImpactForecastResponse;
  data_provenance: string;
  disclaimer: string;
}

export type AppView = 'dashboard' | 'incidents' | 'map' | 'status' | 'settings';

export interface HotspotTelemetryItem {
  id: string;
  latitude: number;
  longitude: number;
  brightness: number;
  confidence: number | string;
  timestamp: string;
  riskScore: number;
  classification: string;
  clusterName: string;
  state: string;
  frp: number;
  satellite: string;
  instrument: string;
}

export interface ServiceDetail {
  configured?: boolean;
  status: string;
  connectivity_tested?: boolean;
  latency_ms?: number | null;
  http_status?: number | null;
  dialect?: string | null;
  provider?: string;
  product?: string;
  bands?: string;
  endpoint?: string;
  auth_status?: string;
  ingestion_status?: string;
  latest_observation_time?: string | null;
  observation_count?: number;
  stored_observations?: number;
  error_category?: string | null;
  service?: string;
  version?: string;
  environment?: string;
  search_radius_km?: number;
}

export interface SystemStatusResponse {
  status: 'OPERATIONAL' | 'DEGRADED' | 'DOWN';
  services: {
    backend: string;
    firms: string;
    database: string;
    satellite: string;
    satellite_hub?: string;
    sentinel_catalog?: string;
    sentinel_processing?: string;
    osm?: string;
  };
  details: {
    backend?: ServiceDetail;
    firms: ServiceDetail;
    database: ServiceDetail;
    satellite: ServiceDetail;
    satellite_hub?: ServiceDetail;
    sentinel_catalog?: ServiceDetail;
    sentinel_processing?: ServiceDetail;
    osm?: ServiceDetail;
    storage: 'SUPABASE_POSTGRESQL' | 'FILE_LOCAL';
  };
  timestamp: string;
  environment: string;
}

export interface FirmsWorkerStatus {
  service: string;
  state: 'NOT_STARTED' | 'RUNNING' | 'HEALTHY' | 'STALE' | 'ERROR';
  poll_interval_seconds: number;
  last_run_time: string | null;
  last_success_time: string | null;
  last_error: string | null;
  last_error_time: string | null;
  last_count: number;
  total_ingested: number;
  total_deduplicated: number;
  total_runs: number;
  current_storage_count: number;
  storage_backend: string;
  storage_path: string;
}

// ============================================================================
// PHASE 6F / 6G — CANONICAL INVESTIGATION SCHEMA INTERFACES
// ============================================================================

export interface DetectionEvidence {
  source: string;
  latitude: number;
  longitude: number;
  brightness: number;
  frp: number;
  confidence: string;
  satellite?: string | null;
  acquired_at?: string | null;
  freshness?: string | null;
}

export interface PersistenceEvidence {
  available: boolean;
  score?: number | null;
  observation_count: number;
  duration_hours: number;
  time_window_hours: number;
  classification?: string | null;
}

export interface IndustrialContextEvidence {
  available: boolean;
  score?: number | null;
  nearest_distance_m?: number | null;
  nearest_distance_km?: number | null;
  nearest_facility?: string | null;
  features: Array<{
    name?: string;
    type?: string;
    category?: string;
    distance_km?: number;
    latitude?: number;
    longitude?: number;
    osm_id?: string | number;
    [key: string]: any;
  }>;
  source: string;
}

export interface Sentinel2Evidence {
  available: boolean;
  state: string;
  class: 'WILDFIRE' | 'INDUSTRIAL_FIRE' | 'NON_FIRE' | 'UNKNOWN' | string;
  confidence: number;
  cloud_cover?: number | null;
  quality: 'GOOD' | 'MODERATE' | 'HIGH_CLOUD' | 'VERY_HIGH_CLOUD' | 'UNAVAILABLE' | string;
  is_synthetic: boolean;
  is_calibrated: boolean;
  satellite_acquired_at?: string | null;
  time_difference_hours?: number | null;
  image_url?: string | null;
  model?: string | null;
  class_probabilities: Record<string, number>;
}

export interface Sentinel1Evidence {
  available: boolean;
  state: 'S1_NOT_QUERIED' | 'S1_FALLBACK_AVAILABLE' | 'S1_FALLBACK_UNAVAILABLE' | 'S1_PROCESSING_FAILED' | 'S1_AUTH_FAILED' | string;
  role: 'BACKUP' | string;
  product_id?: string | null;
  polarization?: string[] | null;
  orbit_direction?: 'ascending' | 'descending' | string | null;
  acquisition_mode?: string | null;
  satellite_acquired_at?: string | null;
  time_difference_hours?: number | null;
  image_url?: string | null;
  source?: string;
  product?: string;
  is_synthetic: boolean;
  reason_not_queried?: string | null;
  sar_disclaimer?: string;
}

export interface FusionResult {
  candidate_class: 'WILDFIRE' | 'INDUSTRIAL_FIRE' | 'NON_FIRE' | 'UNKNOWN' | string;
  candidate_score: number;
  evidence_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT' | string;
  confidence_label: 'HIGH' | 'MEDIUM' | 'LOW' | 'INCONCLUSIVE' | string;
  reasoning: string[];
  conflict_detected: boolean;
  contributing_factors: Record<string, number>;
}

export interface RiskResult {
  risk_score: number;
  risk_level: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | string;
  primary_driver?: string | null;
  factors: Record<string, number>;
}

export interface Provenance {
  observation_id: string;
  firms_acquired_at?: string | null;
  sentinel2_acquired_at?: string | null;
  sentinel1_acquired_at?: string | null;
  selected_satellite?: 'SENTINEL_2' | 'SENTINEL_1' | 'NONE' | string;
  temporal_offset_hours?: number | null;
  osm_queried_at?: string | null;
  investigated_at: string;
}

export interface NearbyFeature {
  type: string;
  name: string;
  distance_km: number;
  relevance: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  category: string;
  ranking_score: number;
  latitude?: number | null;
  longitude?: number | null;
  osm_id?: string | null;
}

export interface PossibleCause {
  category: string;
  likely_source: string;
  assessment: string;
  confidence: number;
  confidence_label: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE' | string;
  distance_km?: number | null;
}

export interface LocationContext {
  classification: string;
  confidence: number;
  confidence_label: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE' | string;
  radius_km: number;
  locality?: string | null;
  district?: string | null;
  state?: string | null;
  country: string;
  primary_context: string;
  secondary_context?: string | null;
  primary_nearby_feature?: string | null;
  primary_distance_km?: number | null;
  reasoning: string[];
  nearby_features: NearbyFeature[];
  possible_cause?: PossibleCause | null;
  status: string;
}

export interface InvestigationResponse {
  observation_id: string;
  status?: string;
  detection: DetectionEvidence;
  persistence: PersistenceEvidence;
  industrial_context: IndustrialContextEvidence;
  sentinel2: Sentinel2Evidence;
  sentinel1?: Sentinel1Evidence;
  selected_satellite?: 'SENTINEL_2' | 'SENTINEL_1' | 'NONE' | string;
  satellite_fallback_reason?: string | null;
  fusion: FusionResult;
  risk: RiskResult;
  provenance: Provenance;
  warnings: string[];
  disclaimers: string[];
  location_context?: LocationContext | null;
  nearby_features?: NearbyFeature[];
  possible_cause?: PossibleCause | null;
}

export interface PriorityResult {
  priority_score: number;
  priority_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string;
  priority_index: 'P1' | 'P2' | 'P3' | 'P4' | string;
  priority_label?: string;
  contributing_factors?: Record<string, number>;
  reasons?: string[];
  scoring_breakdown?: Record<string, number>;
  factors?: Record<string, any>;
  explainability_summary?: string;
  ranking_reasons?: string[];
}

export interface ThreatZoneDetails {
  name?: string;
  radius_km?: number;
  radius_meters?: number;
  color?: string;
  fill_opacity?: number;
  threat_level?: string;
  description?: string;
  key_actions?: string[];
}

export interface ThreatZoneResult {
  available: boolean;
  threat_radius_meters?: number;
  estimated_spread_rate_m_min?: number | null;
  high_hazard_zone?: ThreatZoneDetails | null;
  moderate_hazard_zone?: ThreatZoneDetails | null;
  precautionary_zone?: ThreatZoneDetails | null;
  zones?: Record<string, ThreatZoneDetails>;
  factors_applied?: Record<string, any>;
  spread_scenario?: Record<string, any>;
  disclaimer?: string;
}

export interface AssetExposureItem {
  asset_name?: string;
  name?: string;
  type?: string;
  raw_type?: string;
  category: string;
  distance_km: number;
  threat_zone?: string;
  exposure_level?: string;
  status?: string;
  data_source?: string;
  latitude?: number;
  longitude?: number;
  osm_id?: string | number;
  is_critical?: boolean;
}

export interface AssetExposureResult {
  available: boolean;
  total_exposed_assets: number;
  critical_infrastructure_count: number;
  high_vulnerability_count?: number;
  moderate_count?: number;
  category_counts?: Record<string, number>;
  nearest_critical_asset?: AssetExposureItem | null;
  exposed_assets?: AssetExposureItem[];
  facilities?: AssetExposureItem[];
  source?: string;
}

export interface ImpactResult {
  available: boolean;
  impact_score: number;
  impact_level: string;
  critical_infrastructure_count?: number;
  impact_reasons?: string[];
  summary_statement?: string;
  breakdown?: Record<string, number>;
}

export interface FutureImpactItem {
  time_horizon?: string;
  hours?: number;
  projection_window_hours?: number;
  center_latitude?: number;
  center_longitude?: number;
  projected_area_sqkm?: number;
  confidence_score?: number;
  confidence_level?: string;
  total_exposed_assets?: number;
  critical_infrastructure_count?: number;
  impact_score?: number;
  impact_level?: string;
  priority_index?: string;
  priority_label?: string;
  threat_level?: string;
  risk_summary?: string;
  radius_meters?: number;
  scenario_spread_rate?: number;
  forecasted_time?: string;
  nearest_critical_asset?: Record<string, any> | null;
  exposed_assets?: Array<Record<string, any>>;
}

export interface FutureImpactResult {
  available: boolean;
  escalation_detected?: boolean;
  escalation_reasons?: string[];
  scenarios_evaluated?: number;
  projections?: Record<string, FutureImpactItem> | FutureImpactItem[];
  advisory_notes?: string[];
  disclaimer?: string;
}

export interface RecommendedAction {
  action_id?: string;
  priority: string;
  title: string;
  action_type?: string;
  category?: string;
  recommended_stakeholders?: string[];
  rationale: string;
}

export interface DecisionProvenance {
  observation_id: string;
  investigated_at?: string | null;
  threat_zone_calculated_at?: string | null;
  asset_query_at?: string | null;
  priority_evaluated_at?: string | null;
  decision_support_generated_at: string;
}

export interface IncidentSummary {
  candidate_class: string;
  evidence_strength: string;
  risk_level: string;
  priority_level: string;
  priority_index: string;
  persistence_interpretation: string;
  industrial_context_summary: string;
  optical_evidence_quality: string;
  asset_exposure_summary: string;
  recommended_action: string;
}

export interface DecisionSupportResponse {
  observation_id: string;
  status: 'SUCCESS' | 'PARTIAL_EVIDENCE' | 'DEGRADED' | string;
  summary: IncidentSummary;
  investigation: InvestigationResponse;
  priority: PriorityResult;
  threat_zone?: ThreatZoneResult;
  threat_zones?: ThreatZoneResult;
  asset_exposure: AssetExposureResult;
  impact: ImpactResult;
  future_impact: FutureImpactResult;
  recommended_actions: RecommendedAction[];
  provenance: DecisionProvenance;
  safety_flags?: {
    is_calibrated: boolean;
    is_synthetic: boolean;
    is_simulation_only: boolean;
  };
  disclaimers: string[];
  warnings: string[];
  created_at: string;
}

export interface IncidentActionRequest {
  action: 'ACKNOWLEDGE' | 'DISPATCH' | 'INVESTIGATE' | 'ESCALATE' | 'RESOLVE' | 'DISMISS' | 'ADD_NOTE' | string;
  user?: string;
  target_agency?: string | null;
  notes?: string | null;
  priority_override?: string | null;
}

export interface IncidentAuditItem {
  id: string;
  observation_id: string;
  timestamp: string;
  actor: string;
  actor_type: 'HUMAN_DISPATCHER' | 'AUTOMATED_PIPELINE' | 'SYSTEM_SUPERVISOR' | string;
  action: string;
  previous_status?: string | null;
  new_status: string;
  target_agency?: string | null;
  notes?: string | null;
  metadata?: Record<string, any>;
}

export interface IncidentStateSummary {
  observation_id: string;
  status: 'NEW' | 'ACKNOWLEDGED' | 'DISPATCHED' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED' | string;
  priority_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string;
  priority_index: 'P1' | 'P2' | 'P3' | 'P4' | string;
  assigned_agency?: string | null;
  last_updated_at: string;
  last_updated_by: string;
  total_actions_count: number;
}

export interface IncidentActionResponse {
  success: boolean;
  observation_id: string;
  action_recorded: string;
  current_state: IncidentStateSummary;
  audit_entry: IncidentAuditItem;
  message: string;
}

export interface IncidentAuditTrailResponse {
  observation_id: string;
  state: IncidentStateSummary;
  audit_trail: IncidentAuditItem[];
  disclaimers: string[];
  retrieved_at: string;
}

export interface IncidentOperationalSummary {
  total_incidents: number;
  new_count: number;
  acknowledged_count: number;
  dispatched_count: number;
  investigating_count: number;
  resolved_count: number;
  dismissed_count: number;
  p1_critical_active_count: number;
  p2_high_active_count: number;
  generated_at: string;
}

export interface DemoScenarioPreset {
  id: string;
  name: string;
  description: string;
  observation_id: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  priority_label: string;
  candidate_class: string;
  coordinates: [number, number];
  location_name: string;
  badge: string;
}


