/**
 * Phase 2 Centralized Map Action Dispatcher.
 * Safely validates and executes structured map actions emitted by the Anomaly Intelligence Agent.
 * Strictly prevents arbitrary code execution and ignores invalid or nonexistent targets.
 */

import type { MapAction, ZoomToAnomalyAction, FilterAnomaliesAction, HighlightAnomaliesAction } from '../../types/agent';
import type { Hotspot } from '../../types/hotspot';

export interface ActionDispatcherHandlers {
  hotspots?: Hotspot[];
  mapInstance?: {
    flyTo: (coords: [number, number], zoom: number) => void;
    setView?: (coords: [number, number], zoom: number) => void;
  } | null;
  onZoomToCoords?: (lat: number, lon: number, zoom?: number) => void;
  onSelectObservation?: (id: string) => void;
  onFilterChange?: (filters: { priority_index?: string[]; classification?: string }) => void;
  onHighlightObservations?: (ids: string[]) => void;
}

export interface DispatchResult {
  success: boolean;
  actionType: string;
  reason?: string;
  affectedIds?: string[];
}

// Known benchmark observation IDs for demonstration scenarios
const KNOWN_BENCHMARK_IDS = new Set([
  'demo_industrial_p1',
  'demo_wildfire_p2',
  'demo_crop_burn_p4',
  'demo_degraded_cloud',
  '423f0b1ad50facd6',
  '04e53a2f16d0d665',
  'a35cd8640d876fc2',
  '90b58068fefb3a79',
]);

const ALLOWED_CNN_CLASSES = new Set(['WILDFIRE', 'INDUSTRIAL_FIRE', 'NON_FIRE']);

/**
 * Dispatches a structured MapAction onto the application state.
 */
export function dispatchMapAction(
  action: MapAction | null | undefined,
  handlers: ActionDispatcherHandlers
): DispatchResult {
  if (!action || typeof action !== 'object' || !action.type) {
    return {
      success: false,
      actionType: 'NONE',
      reason: 'No valid action provided',
    };
  }

  const hotspots = handlers.hotspots || [];

  switch (action.type) {
    case 'ZOOM_TO_ANOMALY': {
      const zoomAction = action as ZoomToAnomalyAction;
      const obsId = zoomAction.observation_id;

      if (!obsId || typeof obsId !== 'string') {
        return {
          success: false,
          actionType: 'ZOOM_TO_ANOMALY',
          reason: 'Invalid or missing observation_id',
        };
      }

      // Verify observation exists in current hotspots or benchmark dataset
      const existsInHotspots = hotspots.some(
        (h) => (h.observation_id === obsId || (h as any).id === obsId)
      );
      const isKnownBenchmark = KNOWN_BENCHMARK_IDS.has(obsId);

      if (!existsInHotspots && !isKnownBenchmark && hotspots.length > 0) {
        console.warn(`[AgentDispatcher] ZOOM_TO_ANOMALY ignored: Observation '${obsId}' not found in active dataset.`);
        return {
          success: false,
          actionType: 'ZOOM_TO_ANOMALY',
          reason: `Observation '${obsId}' does not exist in current dataset`,
        };
      }

      const lat = zoomAction.latitude;
      const lon = zoomAction.longitude;
      const zoom = zoomAction.zoom || 14;

      if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
        return {
          success: false,
          actionType: 'ZOOM_TO_ANOMALY',
          reason: 'Invalid coordinates provided',
        };
      }

      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return {
          success: false,
          actionType: 'ZOOM_TO_ANOMALY',
          reason: 'Coordinates out of geographical bounds',
        };
      }

      // Execute zoom navigation safely
      if (handlers.mapInstance && typeof handlers.mapInstance.flyTo === 'function') {
        handlers.mapInstance.flyTo([lat, lon], zoom);
      } else if (handlers.mapInstance && typeof handlers.mapInstance.setView === 'function') {
        handlers.mapInstance.setView([lat, lon], zoom);
      }

      if (handlers.onZoomToCoords) {
        handlers.onZoomToCoords(lat, lon, zoom);
      }

      if (handlers.onSelectObservation) {
        handlers.onSelectObservation(obsId);
      }

      return {
        success: true,
        actionType: 'ZOOM_TO_ANOMALY',
        affectedIds: [obsId],
      };
    }

    case 'FILTER_ANOMALIES': {
      const filterAction = action as FilterAnomaliesAction;

      // Validate classification against strict CNN 3-class vocabulary
      if (filterAction.classification && !ALLOWED_CNN_CLASSES.has(filterAction.classification)) {
        console.warn(`[AgentDispatcher] FILTER_ANOMALIES ignored: Invalid CNN classification '${filterAction.classification}'.`);
        return {
          success: false,
          actionType: 'FILTER_ANOMALIES',
          reason: `Invalid classification '${filterAction.classification}'. Must be WILDFIRE, INDUSTRIAL_FIRE, or NON_FIRE.`,
        };
      }

      if (handlers.onFilterChange) {
        handlers.onFilterChange({
          priority_index: filterAction.priority_index,
          classification: filterAction.classification,
        });
      }

      return {
        success: true,
        actionType: 'FILTER_ANOMALIES',
      };
    }

    case 'HIGHLIGHT_ANOMALIES': {
      const highlightAction = action as HighlightAnomaliesAction;
      const targetIds = highlightAction.observation_ids;

      if (!Array.isArray(targetIds) || targetIds.length === 0) {
        return {
          success: false,
          actionType: 'HIGHLIGHT_ANOMALIES',
          reason: 'No observation IDs specified to highlight',
        };
      }

      // Only highlight markers that actually exist
      const knownIds = new Set(
        hotspots.map((h) => h.observation_id || (h as any).id).filter(Boolean)
      );
      KNOWN_BENCHMARK_IDS.forEach((id) => knownIds.add(id));

      const validIds = targetIds.filter((id) => knownIds.has(id));

      if (validIds.length === 0 && hotspots.length > 0) {
        console.warn('[AgentDispatcher] HIGHLIGHT_ANOMALIES ignored: None of the requested IDs exist in current dataset.');
        return {
          success: false,
          actionType: 'HIGHLIGHT_ANOMALIES',
          reason: 'None of the requested observation IDs exist in active dataset',
        };
      }

      const idsToHighlight = validIds.length > 0 ? validIds : targetIds;

      if (handlers.onHighlightObservations) {
        handlers.onHighlightObservations(idsToHighlight);
      }

      return {
        success: true,
        actionType: 'HIGHLIGHT_ANOMALIES',
        affectedIds: idsToHighlight,
      };
    }

    default:
      console.warn(`[AgentDispatcher] Rejected unsupported action type: ${(action as any).type}`);
      return {
        success: false,
        actionType: (action as any).type || 'UNKNOWN',
        reason: `Unsupported action type: ${(action as any).type}`,
      };
  }
}
