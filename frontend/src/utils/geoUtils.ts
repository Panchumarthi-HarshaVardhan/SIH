/**
 * Geographic Utility for India Boundary Verification & Thermal Anomaly Filtering
 *
 * Uses high-accuracy DataMeet OpenStreetMap simplified boundary geometry
 * encompassing Mainland India, Jammu & Kashmir, Ladakh, Andaman & Nicobar Islands,
 * and Lakshadweep.
 */

import indiaBoundaryData from '../data/india_boundary.json';

interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface PreprocessedPolygon {
  bbox: BoundingBox;
  outerRing: [number, number][];
  holes: [number, number][][];
}

// Pre-process polygons and bounding boxes for fast O(1) candidate elimination
const preprocessedPolygons: PreprocessedPolygon[] = [];
let overallBbox: BoundingBox = {
  minLon: 180,
  minLat: 90,
  maxLon: -180,
  maxLat: -90,
};

try {
  const geom = (indiaBoundaryData as any)?.features?.[0]?.geometry;
  if (geom) {
    const rawPolygons: [number, number][][][] =
      geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

    for (const poly of rawPolygons) {
      if (!poly || poly.length === 0 || !poly[0] || poly[0].length < 3) continue;

      const outerRing = poly[0];
      const holes = poly.slice(1);

      let minLon = 180;
      let minLat = 90;
      let maxLon = -180;
      let maxLat = -90;

      for (let i = 0; i < outerRing.length; i++) {
        const pt = outerRing[i];
        const lon = pt[0];
        const lat = pt[1];
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }

      const bbox: BoundingBox = { minLon, minLat, maxLon, maxLat };
      preprocessedPolygons.push({ bbox, outerRing, holes });

      if (minLon < overallBbox.minLon) overallBbox.minLon = minLon;
      if (minLat < overallBbox.minLat) overallBbox.minLat = minLat;
      if (maxLon > overallBbox.maxLon) overallBbox.maxLon = maxLon;
      if (maxLat > overallBbox.maxLat) overallBbox.maxLat = maxLat;
    }
  }
} catch (err) {
  console.error('Failed to initialize India boundary polygons:', err);
}

/**
 * Standard ray-casting algorithm to test whether point (x, y) is inside a closed polygon ring.
 *
 * @param x Longitude
 * @param y Latitude
 * @param ring Array of [lon, lat] coordinates
 */
function isPointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  const len = ring.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Validates whether geographic coordinates (latitude, longitude) fall strictly
 * inside India's territorial boundary polygon.
 *
 * Handles null, undefined, NaN, and string conversions safely without throwing.
 *
 * @param latitude Latitude in degrees (-90 to +90)
 * @param longitude Longitude in degrees (-180 to +180)
 * @returns true if point is geographically inside India, false otherwise
 */
export function isPointInsideIndia(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined
): boolean {
  if (latitude == null || longitude == null) {
    return false;
  }

  const lat = typeof latitude === 'number' ? latitude : parseFloat(String(latitude));
  const lon = typeof longitude === 'number' ? longitude : parseFloat(String(longitude));

  if (isNaN(lat) || isNaN(lon)) {
    return false;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return false;
  }

  // Fast rejection via overall bounding box
  if (
    lon < overallBbox.minLon ||
    lon > overallBbox.maxLon ||
    lat < overallBbox.minLat ||
    lat > overallBbox.maxLat
  ) {
    return false;
  }

  // Check each candidate polygon
  for (let i = 0; i < preprocessedPolygons.length; i++) {
    const { bbox, outerRing, holes } = preprocessedPolygons[i];

    // Skip if point outside polygon bbox
    if (
      lon < bbox.minLon ||
      lon > bbox.maxLon ||
      lat < bbox.minLat ||
      lat > bbox.maxLat
    ) {
      continue;
    }

    // Test outer ring
    if (isPointInRing(lon, lat, outerRing)) {
      // If inside outer ring, ensure it is NOT inside any hole (e.g. enclave/lake)
      let inHole = false;
      for (let h = 0; h < holes.length; h++) {
        if (isPointInRing(lon, lat, holes[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filters a collection of thermal anomaly points, preserving only those
 * that fall geographically inside India.
 *
 * Does NOT mutate the original collection; returns a fresh derived array.
 *
 * @param points Array of objects containing latitude and longitude properties
 * @returns Filtered array of points strictly inside India
 */
export function filterThermalPointsInsideIndia<
  T extends { latitude?: any; longitude?: any }
>(points: T[] | null | undefined): T[] {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  return points.filter((p) => {
    if (!p) return false;
    return isPointInsideIndia(p.latitude, p.longitude);
  });
}
