/**
 * useMapContext Hook.
 * Extracts and computes real-time Leaflet map viewport and selection context
 * for grounding the Anomaly Intelligence Agent queries.
 */

import { useMemo, useCallback } from 'react';
import type { MapContext, MapBounds, MapCoordinates } from '../../types/agent';
import type { Hotspot } from '../../types/hotspot';

export interface UseMapContextOptions {
  selectedObservationId?: string | null;
  hotspots?: Hotspot[];
  center?: [number, number] | MapCoordinates;
  zoom?: number;
  bounds?: MapBounds | null;
}

/**
 * Checks whether a given geographic coordinate is within viewport bounding box.
 */
export function isCoordinateWithinBounds(
  lat: number,
  lon: number,
  bounds: MapBounds
): boolean {
  return (
    lat >= bounds.min_lat &&
    lat <= bounds.max_lat &&
    lon >= bounds.min_lon &&
    lon <= bounds.max_lon
  );
}

/**
 * Filters existing hotspots to identify IDs visible within the current map bounds.
 */
export function extractVisibleObservationIds(
  hotspots: Hotspot[] = [],
  bounds?: MapBounds | null
): string[] {
  if (!bounds) {
    return hotspots.map((h) => h.observation_id || (h as any).id).filter(Boolean) as string[];
  }

  return hotspots
    .filter((h) => isCoordinateWithinBounds(h.latitude, h.longitude, bounds))
    .map((h) => h.observation_id || (h as any).id)
    .filter(Boolean) as string[];
}

export function useMapContext(options: UseMapContextOptions = {}) {
  const {
    selectedObservationId = null,
    hotspots = [],
    center,
    zoom = 5,
    bounds = null,
  } = options;

  const normalizedCenter: MapCoordinates | undefined = useMemo(() => {
    if (!center) return undefined;
    if (Array.isArray(center)) {
      return { lat: center[0], lon: center[1] };
    }
    return center;
  }, [center]);

  const visibleObservationIds = useMemo(() => {
    return extractVisibleObservationIds(hotspots, bounds);
  }, [hotspots, bounds]);

  const currentMapContext = useMemo<MapContext>(() => {
    return {
      selected_observation_id: selectedObservationId || undefined,
      center: normalizedCenter,
      zoom,
      bounds: bounds || undefined,
      visible_observation_ids: visibleObservationIds,
    };
  }, [selectedObservationId, normalizedCenter, zoom, bounds, visibleObservationIds]);

  const getMapContext = useCallback(
    (overrides?: Partial<UseMapContextOptions>): MapContext => {
      const effCenter = overrides?.center || center;
      const effZoom = overrides?.zoom ?? zoom;
      const effBounds = overrides?.bounds !== undefined ? overrides.bounds : bounds;
      const effSelected = overrides?.selectedObservationId !== undefined ? overrides.selectedObservationId : selectedObservationId;
      const effHotspots = overrides?.hotspots || hotspots;

      let normCenter: MapCoordinates | undefined;
      if (effCenter) {
        normCenter = Array.isArray(effCenter)
          ? { lat: effCenter[0], lon: effCenter[1] }
          : effCenter;
      }

      const visibleIds = extractVisibleObservationIds(effHotspots, effBounds);

      return {
        selected_observation_id: effSelected || undefined,
        center: normCenter,
        zoom: effZoom,
        bounds: effBounds || undefined,
        visible_observation_ids: visibleIds,
      };
    },
    [center, zoom, bounds, selectedObservationId, hotspots]
  );

  return {
    mapContext: currentMapContext,
    visibleObservationIds,
    getMapContext,
  };
}
