/**
 * Phase 2 Anomaly Intelligence Agent TypeScript Types.
 * Strictly typed schemas for Map Context, Structured MapActions, and Chat payloads.
 */

export interface MapCoordinates {
  lat: number;
  lon: number;
}

export interface MapBounds {
  min_lat: number;
  max_lat: number;
  min_lon: number;
  max_lon: number;
}

export interface MapContext {
  selected_observation_id?: string | null;
  center?: MapCoordinates;
  zoom?: number;
  bounds?: MapBounds;
  visible_observation_ids?: string[];
}

export interface ZoomToAnomalyAction {
  type: 'ZOOM_TO_ANOMALY';
  observation_id: string;
  latitude: number;
  longitude: number;
  zoom?: number;
}

export type PriorityIndex = 'P1' | 'P2' | 'P3' | 'P4';
export type CnnClassification = 'WILDFIRE' | 'INDUSTRIAL_FIRE' | 'NON_FIRE';

export interface FilterAnomaliesAction {
  type: 'FILTER_ANOMALIES';
  priority_index?: PriorityIndex[];
  classification?: CnnClassification;
}

export interface HighlightAnomaliesAction {
  type: 'HIGHLIGHT_ANOMALIES';
  observation_ids: string[];
}

export type MapAction =
  | ZoomToAnomalyAction
  | FilterAnomaliesAction
  | HighlightAnomaliesAction;

export interface AgentChatRequest {
  message: string;
  session_id?: string;
  map_context?: MapContext;
}

export interface AgentChatResponse {
  reply: string;
  tools_used: string[];
  evidence_sources: string[];
  action?: MapAction | null;
  disclaimers: string[];
  session_id?: string | null;
}

export interface AgentCapabilitiesResponse {
  status: string;
  provider: string;
  model_configured: boolean;
  tools_available: string[];
  supported_cnn_classes: string[];
  supported_actions: string[];
  disclaimers: string[];
}
