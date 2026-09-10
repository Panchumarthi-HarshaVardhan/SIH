import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the GeoJSON directly to replicate the logic in a pure ESM test
const boundaryPath = path.join(__dirname, '../src/data/india_boundary.json');
const indiaBoundaryData = JSON.parse(fs.readFileSync(boundaryPath, 'utf-8'));

// Replicate point-in-ring and pre-processing
function isPointInRing(x, y, ring) {
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

const geom = indiaBoundaryData.features[0].geometry;
const rawPolygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

const preprocessedPolygons = [];
let overallBbox = { minLon: 180, minLat: 90, maxLon: -180, maxLat: -90 };

for (const poly of rawPolygons) {
  if (!poly || poly.length === 0 || !poly[0] || poly[0].length < 3) continue;
  const outerRing = poly[0];
  const holes = poly.slice(1);
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (let i = 0; i < outerRing.length; i++) {
    const lon = outerRing[i][0];
    const lat = outerRing[i][1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  preprocessedPolygons.push({ bbox: { minLon, minLat, maxLon, maxLat }, outerRing, holes });
  if (minLon < overallBbox.minLon) overallBbox.minLon = minLon;
  if (minLat < overallBbox.minLat) overallBbox.minLat = minLat;
  if (maxLon > overallBbox.maxLon) overallBbox.maxLon = maxLon;
  if (maxLat > overallBbox.maxLat) overallBbox.maxLat = maxLat;
}

function isPointInsideIndia(latitude, longitude) {
  if (latitude == null || longitude == null) return false;
  const lat = typeof latitude === 'number' ? latitude : parseFloat(String(latitude));
  const lon = typeof longitude === 'number' ? longitude : parseFloat(String(longitude));
  if (isNaN(lat) || isNaN(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;

  if (
    lon < overallBbox.minLon ||
    lon > overallBbox.maxLon ||
    lat < overallBbox.minLat ||
    lat > overallBbox.maxLat
  ) {
    return false;
  }

  for (let i = 0; i < preprocessedPolygons.length; i++) {
    const { bbox, outerRing, holes } = preprocessedPolygons[i];
    if (lon < bbox.minLon || lon > bbox.maxLon || lat < bbox.minLat || lat > bbox.maxLat) continue;
    if (isPointInRing(lon, lat, outerRing)) {
      let inHole = false;
      for (let h = 0; h < holes.length; h++) {
        if (isPointInRing(lon, lat, holes[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

function filterThermalPointsInsideIndia(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  return points.filter(p => p && isPointInsideIndia(p.latitude, p.longitude));
}

test('isPointInsideIndia accurately identifies Indian locations', () => {
  assert.equal(isPointInsideIndia(28.6139, 77.2090), true, 'New Delhi should be inside India');
  assert.equal(isPointInsideIndia(19.0760, 72.8777), true, 'Mumbai should be inside India');
  assert.equal(isPointInsideIndia(34.0837, 74.7973), true, 'Srinagar should be inside India');
  assert.equal(isPointInsideIndia(34.1526, 77.5771), true, 'Leh, Ladakh should be inside India');
  assert.equal(isPointInsideIndia(11.6234, 92.7265), true, 'Port Blair (Andaman) should be inside India');
  assert.equal(isPointInsideIndia(10.5667, 72.6417), true, 'Kavaratti (Lakshadweep) should be inside India');
  assert.equal(isPointInsideIndia(26.1445, 91.7362), true, 'Guwahati should be inside India');
  assert.equal(isPointInsideIndia(8.0883, 77.5385), true, 'Kanyakumari should be inside India');
});

test('isPointInsideIndia excludes neighbouring countries and maritime waters', () => {
  assert.equal(isPointInsideIndia(31.5204, 74.3587), false, 'Lahore (PK) must be outside');
  assert.equal(isPointInsideIndia(24.8607, 67.0011), false, 'Karachi (PK) must be outside');
  assert.equal(isPointInsideIndia(27.7172, 85.3240), false, 'Kathmandu (NP) must be outside');
  assert.equal(isPointInsideIndia(23.8103, 90.4125), false, 'Dhaka (BD) must be outside');
  assert.equal(isPointInsideIndia(16.8661, 96.1951), false, 'Yangon (MM) must be outside');
  assert.equal(isPointInsideIndia(6.9271, 79.8612), false, 'Colombo (LK) must be outside');
  assert.equal(isPointInsideIndia(15.0, 65.0), false, 'Arabian Sea must be outside');
  assert.equal(isPointInsideIndia(15.0, 85.0), false, 'Bay of Bengal must be outside');
});

test('isPointInsideIndia safely handles invalid inputs', () => {
  assert.equal(isPointInsideIndia(null, 77.2), false);
  assert.equal(isPointInsideIndia(28.6, null), false);
  assert.equal(isPointInsideIndia(undefined, undefined), false);
  assert.equal(isPointInsideIndia(NaN, 77.2), false);
  assert.equal(isPointInsideIndia(28.6, NaN), false);
  assert.equal(isPointInsideIndia('abc', 'def'), false);
  assert.equal(isPointInsideIndia(200, 77.2), false);
  // String coordinates that parse validly
  assert.equal(isPointInsideIndia('28.6139', '77.2090'), true);
});

test('filterThermalPointsInsideIndia filters correctly without mutating original array', () => {
  const original = [
    { id: 1, latitude: 28.6139, longitude: 77.2090 }, // Delhi
    { id: 2, latitude: 31.5204, longitude: 74.3587 }, // Lahore
    { id: 3, latitude: 19.0760, longitude: 72.8777 }, // Mumbai
    { id: 4, latitude: null, longitude: 80.0 },       // Invalid
  ];

  const originalCopy = JSON.parse(JSON.stringify(original));
  const filtered = filterThermalPointsInsideIndia(original);

  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map(p => p.id), [1, 3]);
  assert.deepEqual(original, originalCopy, 'Original collection should remain unmutated');
});
