import { getApiUrl } from '../config/api';

export interface LocationResolution {
  primary_name: string;
  secondary_locality: string;
  facility_name?: string | null;
  locality?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
}

// In-memory cache by coordinate key: `${lat.toFixed(3)},${lon.toFixed(3)}`
// Ensures OpenStreetMap reverse geocoding is NEVER called on every render
const coordinateCache = new Map<string, LocationResolution>();
const inFlightRequests = new Map<string, Promise<LocationResolution>>();

export function getCoordinateCacheKey(lat: number, lon: number): string {
  return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function getCachedLocationName(lat: number, lon: number): LocationResolution | undefined {
  return coordinateCache.get(getCoordinateCacheKey(lat, lon));
}

export function setCachedLocationName(lat: number, lon: number, resolution: LocationResolution): void {
  coordinateCache.set(getCoordinateCacheKey(lat, lon), resolution);
}

/**
 * Resolves the genuine place/facility name and administrative locality for a given coordinate
 * strictly adhering to the OpenStreetMap hierarchy:
 *   1. Facility / Place Name (e.g. Tata Steel, power plants, industrial facilities)
 *   2. Locality / Administrative Hierarchy (City, Town, Village, District, State)
 *
 * Implements strict coordinate-based in-memory caching to guarantee zero redundant network calls.
 */
export async function resolveLocationName(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<LocationResolution> {
  const cacheKey = getCoordinateCacheKey(lat, lon);

  // 1. Return immediately from cache if already resolved
  const cached = coordinateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Return existing in-flight request if already being fetched
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const fetchPromise = (async () => {
    try {
      const endpoint = getApiUrl(`/api/hotspots/reverse-geocode?lat=${lat}&lon=${lon}`);
      const res = await fetch(endpoint, {
        signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        const primary = data.primary_name || data.locality || data.district || data.state || 'Thermal Anomaly';
        const secondary = data.secondary_locality || data.state || 'India';

        const resolution: LocationResolution = {
          primary_name: primary,
          secondary_locality: secondary,
          facility_name: data.facility_name || null,
          locality: data.locality || null,
          city: data.city || null,
          district: data.district || null,
          state: data.state || null,
        };

        coordinateCache.set(cacheKey, resolution);
        return resolution;
      }
    } catch {
      // Graceful non-crashing fallback
    } finally {
      inFlightRequests.delete(cacheKey);
    }

    // Default graceful fallback if network fails
    const fallback: LocationResolution = {
      primary_name: 'Thermal Anomaly',
      secondary_locality: `${Number(lat).toFixed(2)}°N, ${Number(lon).toFixed(2)}°E`,
    };
    return fallback;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}
