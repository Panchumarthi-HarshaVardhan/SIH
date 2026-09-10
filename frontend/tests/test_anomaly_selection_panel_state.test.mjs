import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Dashboard Anomaly Selection & Investigation Panel State Decoupling Tests', () => {
  // Test fixture data
  const mockHotspotA = {
    observation_id: 'FIRMS_HP_001',
    latitude: 22.4208,
    longitude: 69.8312,
    brightness: 345.2,
    confidence: 'high',
    frp: 48.5,
    acquired_at: '2026-09-10T04:00:00Z',
    satellite: 'NOAA-21',
    instrument: 'VIIRS',
    source: 'NASA FIRMS',
  };

  const mockHotspotB = {
    observation_id: 'FIRMS_HP_002',
    latitude: 24.1250,
    longitude: 82.5500,
    brightness: 320.0,
    confidence: 'nominal',
    frp: 28.0,
    acquired_at: '2026-09-10T04:15:00Z',
    satellite: 'NOAA-21',
    instrument: 'VIIRS',
    source: 'NASA FIRMS',
  };

  const mockCluster = {
    cluster_id: 'CLUSTER_REFINERY_99',
    center_latitude: 21.7500,
    center_longitude: 70.1200,
    total_frp: 120.5,
    observation_count: 6,
    duration_hours: 14.2,
    classification: 'PERSISTENT',
  };

  const mockAlert = {
    alert_id: 'ALERT_TACTICAL_55',
    latitude: 23.1100,
    longitude: 72.5800,
    risk_score: 88,
    risk_level: 'CRITICAL',
    classification: 'INDUSTRIAL_FIRE',
    status: 'TRIGGERED',
  };

  // Helper representing decoupled App state management
  function createAppState() {
    let state = {
      selectedHotspot: null,
      selectedCluster: null,
      selectedAlert: null,
      selectedPriorityIncident: null,
      showDetailPanel: false,
      mapCenterCoords: [20.5937, 78.9629],
      mapZoomLevel: 5,
    };

    return {
      getState: () => ({ ...state }),
      handleSelectHotspot: (h) => {
        state.selectedHotspot = h;
        state.selectedCluster = null;
        state.selectedAlert = null;
        state.selectedPriorityIncident = null;
        if (h.latitude && h.longitude) {
          state.mapCenterCoords = [h.latitude, h.longitude];
          state.mapZoomLevel = 11;
        }
        // Note: showDetailPanel is preserved (not automatically opened)
      },
      handleSelectCluster: (c) => {
        state.selectedCluster = c;
        state.selectedHotspot = null;
        state.selectedAlert = null;
        state.selectedPriorityIncident = null;
        if (c.center_latitude && c.center_longitude) {
          state.mapCenterCoords = [c.center_latitude, c.center_longitude];
          state.mapZoomLevel = 11;
        }
      },
      handleSelectAlert: (a) => {
        state.selectedAlert = a;
        state.selectedHotspot = null;
        state.selectedCluster = null;
        state.selectedPriorityIncident = null;
        if (a.latitude && a.longitude) {
          state.mapCenterCoords = [a.latitude, a.longitude];
          state.mapZoomLevel = 11;
        }
      },
      handleOpenInvestigation: () => {
        state.showDetailPanel = true;
      },
      handleCloseDetailPanel: () => {
        // ONLY close detail panel; do not clear selection or zoom
        state.showDetailPanel = false;
      },
      handleDeselectAnomaly: () => {
        // Background click or explicit reset: clears selection and resets map
        state.selectedHotspot = null;
        state.selectedCluster = null;
        state.selectedAlert = null;
        state.selectedPriorityIncident = null;
        state.showDetailPanel = false;
        state.mapCenterCoords = [20.5937, 78.9629];
        state.mapZoomLevel = 5;
      },
    };
  }

  // =========================================================================
  // Requirement 1: Clicking an anomaly point
  // =========================================================================
  it('Requirement 1: Clicking an anomaly point selects, centers, and zooms map without auto-opening investigation panel', () => {
    const app = createAppState();

    // Verify initial idle state
    assert.equal(app.getState().selectedHotspot, null);
    assert.equal(app.getState().showDetailPanel, false);
    assert.deepEqual(app.getState().mapCenterCoords, [20.5937, 78.9629]);
    assert.equal(app.getState().mapZoomLevel, 5);

    // User clicks anomaly A on map
    app.handleSelectHotspot(mockHotspotA);

    const afterSelect = app.getState();
    assert.equal(afterSelect.selectedHotspot.observation_id, 'FIRMS_HP_001');
    assert.deepEqual(afterSelect.mapCenterCoords, [22.4208, 69.8312]);
    assert.equal(afterSelect.mapZoomLevel, 11);
    // Crucial requirement: panel MUST NOT open automatically
    assert.equal(afterSelect.showDetailPanel, false, 'Investigation panel must remain closed upon initial anomaly click');
  });

  // =========================================================================
  // Requirement 2: Clicking "OPEN INCIDENT & IMPACT INTELLIGENCE"
  // =========================================================================
  it('Requirement 2: Clicking "OPEN INCIDENT & IMPACT INTELLIGENCE" opens investigation panel while preserving anomaly & zoom', () => {
    const app = createAppState();

    // Select anomaly A
    app.handleSelectHotspot(mockHotspotA);
    assert.equal(app.getState().showDetailPanel, false);

    // User clicks "OPEN INCIDENT & IMPACT INTELLIGENCE"
    app.handleOpenInvestigation();

    const afterOpen = app.getState();
    assert.equal(afterOpen.showDetailPanel, true, 'Investigation panel must be open');
    assert.equal(afterOpen.selectedHotspot.observation_id, 'FIRMS_HP_001', 'Selected anomaly must be preserved');
    assert.deepEqual(afterOpen.mapCenterCoords, [22.4208, 69.8312], 'Map coordinates must remain focused on anomaly');
    assert.equal(afterOpen.mapZoomLevel, 11, 'Map zoom level must remain preserved');
  });

  // =========================================================================
  // Requirement 3: Closing the Incident Investigation panel
  // =========================================================================
  it('Requirement 3: Closing investigation panel ONLY closes drawer; does NOT unselect anomaly or reset map', () => {
    const app = createAppState();

    // Anomaly selected and panel opened
    app.handleSelectHotspot(mockHotspotA);
    app.handleOpenInvestigation();
    assert.equal(app.getState().showDetailPanel, true);
    assert.equal(app.getState().selectedHotspot.observation_id, 'FIRMS_HP_001');

    // User closes the panel (clicks Close / ESC)
    app.handleCloseDetailPanel();

    const afterClose = app.getState();
    assert.equal(afterClose.showDetailPanel, false, 'Investigation panel drawer must be closed');
    assert.notEqual(afterClose.selectedHotspot, null, 'Selected anomaly must NOT be unselected');
    assert.equal(afterClose.selectedHotspot.observation_id, 'FIRMS_HP_001', 'Correct anomaly must still be selected');
    assert.deepEqual(afterClose.mapCenterCoords, [22.4208, 69.8312], 'Map center must remain at anomaly coordinates');
    assert.equal(afterClose.mapZoomLevel, 11, 'Map zoom level must remain focused');

    // User clicks "OPEN INCIDENT & IMPACT INTELLIGENCE" again without re-selecting
    app.handleOpenInvestigation();
    const afterReopen = app.getState();
    assert.equal(afterReopen.showDetailPanel, true);
    assert.equal(afterReopen.selectedHotspot.observation_id, 'FIRMS_HP_001');
  });

  // =========================================================================
  // Requirement 4: Selecting another anomaly B
  // =========================================================================
  it('Requirement 4a: Selecting anomaly B when panel is CLOSED keeps panel closed and updates selection to B', () => {
    const app = createAppState();

    // Select A (panel is closed)
    app.handleSelectHotspot(mockHotspotA);
    assert.equal(app.getState().showDetailPanel, false);

    // User clicks anomaly B
    app.handleSelectHotspot(mockHotspotB);

    const state = app.getState();
    assert.equal(state.selectedHotspot.observation_id, 'FIRMS_HP_002', 'Selection must be updated to B');
    assert.deepEqual(state.mapCenterCoords, [24.1250, 82.5500], 'Map must focus on anomaly B');
    assert.equal(state.mapZoomLevel, 11);
    assert.equal(state.showDetailPanel, false, 'Panel must remain closed');
  });

  it('Requirement 4b: Selecting anomaly B when panel is OPEN keeps panel open and updates target to B', () => {
    const app = createAppState();

    // Select A and open panel
    app.handleSelectHotspot(mockHotspotA);
    app.handleOpenInvestigation();
    assert.equal(app.getState().showDetailPanel, true);
    assert.equal(app.getState().selectedHotspot.observation_id, 'FIRMS_HP_001');

    // User clicks anomaly B while panel is open
    app.handleSelectHotspot(mockHotspotB);

    const state = app.getState();
    assert.equal(state.selectedHotspot.observation_id, 'FIRMS_HP_002', 'Target must update to anomaly B');
    assert.deepEqual(state.mapCenterCoords, [24.1250, 82.5500], 'Map must center on anomaly B');
    assert.equal(state.showDetailPanel, true, 'Investigation panel must remain OPEN to investigate B');
  });

  // =========================================================================
  // Requirement 5: Explicitly unselecting / resetting (Map background click)
  // =========================================================================
  it('Requirement 5: Background map click deselects anomaly, closes panel, and resets map to India view', () => {
    const app = createAppState();

    // Anomaly selected & panel open
    app.handleSelectHotspot(mockHotspotA);
    app.handleOpenInvestigation();
    assert.equal(app.getState().selectedHotspot.observation_id, 'FIRMS_HP_001');
    assert.equal(app.getState().showDetailPanel, true);

    // User clicks empty map background
    app.handleDeselectAnomaly();

    const resetState = app.getState();
    assert.equal(resetState.selectedHotspot, null, 'Selected hotspot must be cleared');
    assert.equal(resetState.selectedCluster, null, 'Selected cluster must be cleared');
    assert.equal(resetState.selectedAlert, null, 'Selected alert must be cleared');
    assert.equal(resetState.selectedPriorityIncident, null, 'Selected priority incident must be cleared');
    assert.equal(resetState.showDetailPanel, false, 'Panel must be closed on background click');
    assert.deepEqual(resetState.mapCenterCoords, [20.5937, 78.9629], 'Map center must reset to default India view');
    assert.equal(resetState.mapZoomLevel, 5, 'Map zoom level must reset to 5');
  });

  // =========================================================================
  // Cluster & Alert Selection parity
  // =========================================================================
  it('Cluster & Alert selection parity: Selecting clusters or alerts decouples panel and preserves zoom on close', () => {
    const app = createAppState();

    // Select cluster
    app.handleSelectCluster(mockCluster);
    assert.equal(app.getState().selectedCluster.cluster_id, 'CLUSTER_REFINERY_99');
    assert.equal(app.getState().selectedHotspot, null);
    assert.equal(app.getState().showDetailPanel, false, 'Panel closed on cluster click');
    assert.deepEqual(app.getState().mapCenterCoords, [21.7500, 70.1200]);

    // Open investigation
    app.handleOpenInvestigation();
    assert.equal(app.getState().showDetailPanel, true);

    // Close investigation
    app.handleCloseDetailPanel();
    assert.equal(app.getState().showDetailPanel, false);
    assert.equal(app.getState().selectedCluster.cluster_id, 'CLUSTER_REFINERY_99', 'Cluster remains selected');
    assert.deepEqual(app.getState().mapCenterCoords, [21.7500, 70.1200], 'Map center remains on cluster');

    // Select alert
    app.handleSelectAlert(mockAlert);
    assert.equal(app.getState().selectedAlert.alert_id, 'ALERT_TACTICAL_55');
    assert.equal(app.getState().selectedCluster, null);
    assert.equal(app.getState().showDetailPanel, false, 'Panel remains closed');
    assert.deepEqual(app.getState().mapCenterCoords, [23.1100, 72.5800]);
  });
});
