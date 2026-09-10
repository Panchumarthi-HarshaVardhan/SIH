import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isCoordinateWithinBounds,
  extractVisibleObservationIds,
} from '../src/components/agent/useMapContext.ts';

import {
  dispatchMapAction,
} from '../src/components/agent/actionDispatcher.ts';

describe('Phase 2 Anomaly Intelligence Agent — Map Context & Action Dispatcher Tests', () => {

  const mockHotspots = [
    {
      observation_id: 'demo_industrial_p1',
      latitude: 20.31,
      longitude: 86.61,
      brightness: 345.2,
      confidence: 'high',
      frp: 88.5,
      acquired_at: '2026-09-08 10:30 UTC',
      satellite: 'NOAA-20',
      instrument: 'VIIRS',
      source: 'NASA FIRMS',
    },
    {
      observation_id: 'demo_wildfire_p2',
      latitude: 23.51,
      longitude: 85.34,
      brightness: 330.1,
      confidence: 'nominal',
      frp: 52.0,
      acquired_at: '2026-09-08 11:15 UTC',
      satellite: 'Suomi-NPP',
      instrument: 'VIIRS',
      source: 'NASA FIRMS',
    },
    {
      observation_id: 'obs_out_of_bounds',
      latitude: 10.0,
      longitude: 76.0,
      brightness: 310.0,
      confidence: 'low',
      frp: 12.0,
      acquired_at: '2026-09-08 12:00 UTC',
      satellite: 'Aqua',
      instrument: 'MODIS',
      source: 'NASA FIRMS',
    },
  ];

  const mockBounds = {
    min_lat: 19.0,
    max_lat: 25.0,
    min_lon: 84.0,
    max_lon: 88.0,
  };

  // ============================================================================
  // 1. Map Context Coordinate & Viewport Bounding
  // ============================================================================

  it('Test 1: isCoordinateWithinBounds correctly identifies points inside/outside bounding box', () => {
    assert.strictEqual(isCoordinateWithinBounds(20.31, 86.61, mockBounds), true);
    assert.strictEqual(isCoordinateWithinBounds(23.51, 85.34, mockBounds), true);
    assert.strictEqual(isCoordinateWithinBounds(10.0, 76.0, mockBounds), false);
    assert.strictEqual(isCoordinateWithinBounds(26.0, 86.0, mockBounds), false);
  });

  it('Test 2: extractVisibleObservationIds returns only observations inside viewport bounds', () => {
    const visibleIds = extractVisibleObservationIds(mockHotspots, mockBounds);
    assert.strictEqual(visibleIds.length, 2);
    assert.ok(visibleIds.includes('demo_industrial_p1'));
    assert.ok(visibleIds.includes('demo_wildfire_p2'));
    assert.ok(!visibleIds.includes('obs_out_of_bounds'));
  });

  it('Test 3: extractVisibleObservationIds returns all observations when bounds are null', () => {
    const allIds = extractVisibleObservationIds(mockHotspots, null);
    assert.strictEqual(allIds.length, 3);
    assert.ok(allIds.includes('obs_out_of_bounds'));
  });

  // ============================================================================
  // 2. Action Dispatcher: ZOOM_TO_ANOMALY
  // ============================================================================

  it('Test 4: dispatchMapAction ZOOM_TO_ANOMALY executes navigation for existing hotspot', () => {
    let flyToCalled = false;
    let flyToCoords = null;
    let selectedId = null;

    const mockMap = {
      flyTo: (coords, zoom) => {
        flyToCalled = true;
        flyToCoords = coords;
      },
    };

    const action = {
      type: 'ZOOM_TO_ANOMALY',
      observation_id: 'demo_industrial_p1',
      latitude: 20.31,
      longitude: 86.61,
      zoom: 14,
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
      mapInstance: mockMap,
      onSelectObservation: (id) => { selectedId = id; },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.actionType, 'ZOOM_TO_ANOMALY');
    assert.strictEqual(flyToCalled, true);
    assert.deepStrictEqual(flyToCoords, [20.31, 86.61]);
    assert.strictEqual(selectedId, 'demo_industrial_p1');
  });

  it('Test 5: dispatchMapAction ZOOM_TO_ANOMALY safely ignores nonexistent observation ID', () => {
    let flyToCalled = false;
    const mockMap = {
      flyTo: () => { flyToCalled = true; },
    };

    const action = {
      type: 'ZOOM_TO_ANOMALY',
      observation_id: 'nonexistent_observation_9999',
      latitude: 15.0,
      longitude: 75.0,
      zoom: 14,
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
      mapInstance: mockMap,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(flyToCalled, false);
    assert.ok(result.reason.includes('does not exist'));
  });

  it('Test 6: dispatchMapAction ZOOM_TO_ANOMALY rejects out-of-bounds coordinates', () => {
    const action = {
      type: 'ZOOM_TO_ANOMALY',
      observation_id: 'demo_industrial_p1',
      latitude: 95.0, // Invalid latitude
      longitude: 86.61,
      zoom: 14,
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.reason.includes('out of geographical bounds'));
  });

  // ============================================================================
  // 3. Action Dispatcher: FILTER_ANOMALIES
  // ============================================================================

  it('Test 7: dispatchMapAction FILTER_ANOMALIES updates existing filters with CNN classes', () => {
    let filterApplied = null;

    const action = {
      type: 'FILTER_ANOMALIES',
      priority_index: ['P1', 'P2'],
      classification: 'INDUSTRIAL_FIRE',
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
      onFilterChange: (filters) => { filterApplied = filters; },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.actionType, 'FILTER_ANOMALIES');
    assert.deepStrictEqual(filterApplied.priority_index, ['P1', 'P2']);
    assert.strictEqual(filterApplied.classification, 'INDUSTRIAL_FIRE');
  });

  it('Test 8: dispatchMapAction FILTER_ANOMALIES strictly rejects unsupported CNN classes', () => {
    let filterApplied = null;

    const action = {
      type: 'FILTER_ANOMALIES',
      classification: 'AGRICULTURAL_BURNING', // Forbidden as CNN class
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
      onFilterChange: (f) => { filterApplied = f; },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(filterApplied, null);
    assert.ok(result.reason.includes('Invalid classification'));
  });

  // ============================================================================
  // 4. Action Dispatcher: HIGHLIGHT_ANOMALIES
  // ============================================================================

  it('Test 9: dispatchMapAction HIGHLIGHT_ANOMALIES highlights existing markers', () => {
    let highlighted = null;

    const action = {
      type: 'HIGHLIGHT_ANOMALIES',
      observation_ids: ['demo_industrial_p1', 'nonexistent_id_123'],
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
      onHighlightObservations: (ids) => { highlighted = ids; },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.actionType, 'HIGHLIGHT_ANOMALIES');
    // Only existing ID is passed to highlighter
    assert.deepStrictEqual(highlighted, ['demo_industrial_p1']);
  });

  it('Test 10: dispatchMapAction HIGHLIGHT_ANOMALIES rejects empty ID lists', () => {
    const action = {
      type: 'HIGHLIGHT_ANOMALIES',
      observation_ids: [],
    };

    const result = dispatchMapAction(action, {
      hotspots: mockHotspots,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.reason.includes('No observation IDs specified'));
  });

  // ============================================================================
  // 5. Safety: Arbitrary JavaScript & Unsupported Action Rejection
  // ============================================================================

  it('Test 11: dispatchMapAction rejects arbitrary JavaScript or unsupported actions', () => {
    const arbitraryAction = {
      type: 'EXECUTE_JS',
      code: 'document.body.innerHTML = "hacked";',
    };

    const result = dispatchMapAction(arbitraryAction, {
      hotspots: mockHotspots,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.reason.includes('Unsupported action type'));
  });

  it('Test 12: dispatchMapAction safely handles null or undefined action', () => {
    const resultNull = dispatchMapAction(null, { hotspots: mockHotspots });
    assert.strictEqual(resultNull.success, false);

    const resultUndefined = dispatchMapAction(undefined, { hotspots: mockHotspots });
    assert.strictEqual(resultUndefined.success, false);
  });
});
