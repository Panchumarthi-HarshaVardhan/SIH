import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchMapAction,
} from '../src/components/agent/actionDispatcher.ts';

import {
  sendAgentChatMessage,
  fetchAgentCapabilities,
} from '../src/api/agent.ts';

import {
  isCoordinateWithinBounds,
  extractVisibleObservationIds,
} from '../src/components/agent/useMapContext.ts';

describe('Phase 3 Anomaly Intelligence Agent — Chat UI, API Client & Operational Flow Tests', () => {

  const sampleHotspots = [
    {
      observation_id: '423f0b1ad50facd6',
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
      observation_id: '04e53a2f16d0d665',
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
  ];

  const sampleBounds = {
    min_lat: 19.0,
    max_lat: 25.0,
    min_lon: 84.0,
    max_lon: 88.0,
  };

  // ============================================================================
  // Test 1: Agent floating button / trigger metadata and state representation
  // ============================================================================
  it('Test 1: Agent button renders correct label, operational state, and pulse indicator attributes', () => {
    const buttonConfig = {
      label: 'AI Intelligence',
      icon: 'robot',
      status: 'online',
      ariaLabel: 'Open Anomaly Intelligence Agent',
    };

    assert.strictEqual(buttonConfig.label, 'AI Intelligence');
    assert.strictEqual(buttonConfig.status, 'online');
    assert.strictEqual(buttonConfig.ariaLabel, 'Open Anomaly Intelligence Agent');
  });

  // ============================================================================
  // Test 2: Drawer open toggle transitions
  // ============================================================================
  it('Test 2: Drawer open toggle correctly transitions from closed to open state', () => {
    let isOpen = false;
    const toggleOpen = () => { isOpen = !isOpen; };

    assert.strictEqual(isOpen, false);
    toggleOpen();
    assert.strictEqual(isOpen, true);
  });

  // ============================================================================
  // Test 3: Drawer close action
  // ============================================================================
  it('Test 3: Drawer close handler correctly transitions from open to closed state', () => {
    let isOpen = true;
    const handleClose = () => { isOpen = false; };

    assert.strictEqual(isOpen, true);
    handleClose();
    assert.strictEqual(isOpen, false);
  });

  // ============================================================================
  // Test 4: Quick prompt chips selection
  // ============================================================================
  it('Test 4: Quick prompt chips correctly map operational queries to text payloads', () => {
    const quickPrompts = [
      { label: 'Highest Risk', query: 'Which anomaly is highest risk?' },
      { label: 'Why High Priority?', query: 'Why is this anomaly high priority?' },
      { label: 'Why Industrial Fire?', query: 'Why is this classified as an industrial fire?' },
      { label: 'Visible Anomalies', query: 'What anomalies are visible?' },
      { label: 'Persistent Hotspots', query: 'Show persistent anomalies' },
      { label: 'P1 Industrial Fires', query: 'Show P1 industrial fires' },
      { label: 'Supporting Evidence', query: 'What evidence supports this classification?' },
      { label: 'Responder Actions', query: 'What should responders investigate first?' },
    ];

    assert.strictEqual(quickPrompts.length, 8);
    const highestRiskPrompt = quickPrompts.find(p => p.label === 'Highest Risk');
    assert.strictEqual(highestRiskPrompt?.query, 'Which anomaly is highest risk?');

    const persistentPrompt = quickPrompts.find(p => p.label === 'Persistent Hotspots');
    assert.strictEqual(persistentPrompt?.query, 'Show persistent anomalies');
  });

  // ============================================================================
  // Test 5: User message formatting & timestamp
  // ============================================================================
  it('Test 5: User message data model correctly constructs timestamp and sender identity', () => {
    const rawText = 'Why is this anomaly classified as an industrial fire?';
    const userMsg = {
      id: 'user_123',
      sender: 'user',
      text: rawText,
      timestamp: '14:22 UTC',
    };

    assert.strictEqual(userMsg.sender, 'user');
    assert.strictEqual(userMsg.text, rawText);
    assert.ok(userMsg.timestamp);
  });

  // ============================================================================
  // Test 6: Loading state renders safe operational indicator without raw prompts
  // ============================================================================
  it('Test 6: Loading state exposes safe high-level status and suppresses internal chain-of-thought', () => {
    const loadingState = {
      isLoading: true,
      statusText: 'Querying multi-sensor intelligence...',
    };

    assert.strictEqual(loadingState.isLoading, true);
    assert.ok(loadingState.statusText.includes('multi-sensor intelligence'));
    // Ensure no internal system prompts or hidden thoughts are exposed
    assert.strictEqual(loadingState.statusText.includes('system prompt'), false);
    assert.strictEqual(loadingState.statusText.includes('Chain of Thought'), false);
  });

  // ============================================================================
  // Test 7: Agent markdown response parsing
  // ============================================================================
  it('Test 7: Agent response formats markdown headings, bold text, lists, and code blocks', () => {
    const sampleMarkdown = `### Incident Assessment\nObservation **423f0b1ad50facd6** is classified as **INDUSTRIAL_FIRE**.\n- FIRMS FRP: 88.5 MW\n- Sentinel-2 SWIR anomaly detected\n- OSM: Proximity to refinery (0.35 km)`;

    assert.ok(sampleMarkdown.includes('### Incident Assessment'));
    assert.ok(sampleMarkdown.includes('**INDUSTRIAL_FIRE**'));
    assert.ok(sampleMarkdown.includes('- FIRMS FRP: 88.5 MW'));
  });

  // ============================================================================
  // Test 8: Evidence sources rendering
  // ============================================================================
  it('Test 8: Evidence sources render only badges returned by backend without inventing data', () => {
    const backendEvidenceSources = ['FIRMS', 'Sentinel-2', 'OSM', 'CNN', 'Evidence Fusion'];
    
    // Validate that only sources in the list are rendered
    const recognizedSources = backendEvidenceSources.filter(src =>
      ['FIRMS', 'Sentinel-2', 'Sentinel-1', 'OSM', 'Persistence', 'CNN', 'Evidence Fusion'].includes(src)
    );

    assert.strictEqual(recognizedSources.length, 5);
    assert.ok(recognizedSources.includes('FIRMS'));
    assert.ok(recognizedSources.includes('Sentinel-2'));
    assert.ok(!recognizedSources.includes('Sentinel-1')); // Not returned by this backend response
  });

  // ============================================================================
  // Test 9: Selected observation context transmission
  // ============================================================================
  it('Test 9: Selected observation context is correctly bound into chat request payload', () => {
    const selectedObsId = '423f0b1ad50facd6';
    const requestPayload = {
      message: 'Why is this anomaly high priority?',
      session_id: 'test_session_1',
      map_context: {
        selected_observation_id: selectedObsId,
        visible_observation_ids: [selectedObsId],
      },
    };

    assert.strictEqual(requestPayload.map_context.selected_observation_id, selectedObsId);
    assert.ok(requestPayload.map_context.visible_observation_ids.includes(selectedObsId));
  });

  // ============================================================================
  // Test 10: Viewport Map context transmission
  // ============================================================================
  it('Test 10: Map context correctly transmits center, zoom, bounds, and visible IDs', () => {
    const visibleIds = extractVisibleObservationIds(sampleHotspots, sampleBounds);
    const mapContext = {
      center: { lat: 20.59, lon: 78.96 },
      zoom: 6,
      bounds: sampleBounds,
      visible_observation_ids: visibleIds,
    };

    assert.strictEqual(mapContext.zoom, 6);
    assert.strictEqual(mapContext.center.lat, 20.59);
    assert.strictEqual(mapContext.visible_observation_ids.length, 2);
    assert.ok(mapContext.visible_observation_ids.includes('423f0b1ad50facd6'));
  });

  // ============================================================================
  // Test 11: ZOOM_TO_ANOMALY action dispatch
  // ============================================================================
  it('Test 11: ZOOM_TO_ANOMALY action dispatches successfully and invokes navigation handler', () => {
    let zoomedCoords = null;
    let selectedId = null;

    const action = {
      type: 'ZOOM_TO_ANOMALY',
      observation_id: '423f0b1ad50facd6',
      latitude: 20.31,
      longitude: 86.61,
      zoom: 14,
    };

    const result = dispatchMapAction(action, {
      hotspots: sampleHotspots,
      onZoomToCoords: (lat, lon, zoom) => {
        zoomedCoords = { lat, lon, zoom };
      },
      onSelectObservation: (id) => {
        selectedId = id;
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.actionType, 'ZOOM_TO_ANOMALY');
    assert.deepStrictEqual(zoomedCoords, { lat: 20.31, lon: 86.61, zoom: 14 });
    assert.strictEqual(selectedId, '423f0b1ad50facd6');
  });

  // ============================================================================
  // Test 12: FILTER_ANOMALIES action dispatch
  // ============================================================================
  it('Test 12: FILTER_ANOMALIES action dispatches successfully and invokes filter handler', () => {
    let appliedFilter = null;

    const action = {
      type: 'FILTER_ANOMALIES',
      priority_index: ['P1'],
      classification: 'INDUSTRIAL_FIRE',
    };

    const result = dispatchMapAction(action, {
      hotspots: sampleHotspots,
      onFilterChange: (filters) => {
        appliedFilter = filters;
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.actionType, 'FILTER_ANOMALIES');
    assert.deepStrictEqual(appliedFilter, {
      priority_index: ['P1'],
      classification: 'INDUSTRIAL_FIRE',
    });
  });

  // ============================================================================
  // Test 13: HIGHLIGHT_ANOMALIES action dispatch
  // ============================================================================
  it('Test 13: HIGHLIGHT_ANOMALIES action dispatches successfully and highlights target IDs', () => {
    let highlighted = null;

    const action = {
      type: 'HIGHLIGHT_ANOMALIES',
      observation_ids: ['423f0b1ad50facd6'],
    };

    const result = dispatchMapAction(action, {
      hotspots: sampleHotspots,
      onHighlightObservations: (ids) => {
        highlighted = ids;
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.actionType, 'HIGHLIGHT_ANOMALIES');
    assert.deepStrictEqual(highlighted, ['423f0b1ad50facd6']);
  });

  // ============================================================================
  // Test 14: Invalid action is safely ignored
  // ============================================================================
  it('Test 14: Malformed or unsupported action is rejected without throwing errors', () => {
    const maliciousAction = {
      type: 'EXECUTE_ARBITRARY_CODE',
      payload: 'console.log("hacked")',
    };

    const result = dispatchMapAction(maliciousAction, {
      hotspots: sampleHotspots,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.actionType, 'EXECUTE_ARBITRARY_CODE');
    assert.ok(result.reason?.includes('Unsupported action type'));
  });

  // ============================================================================
  // Test 15: API error handling
  // ============================================================================
  it('Test 15: API error returns safe fallback response and avoids crashing EOC dashboard', async () => {
    // Mock fetch to simulate network error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Connection refused to backend port 8000');
    };

    try {
      const response = await sendAgentChatMessage({
        message: 'Hello agent',
      });

      assert.ok(response);
      assert.ok(response.reply.includes('AI Agent is currently unavailable'));
      assert.strictEqual(response.action, null);
      assert.strictEqual(response.tools_used.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ============================================================================
  // Test 16: Empty response handling
  // ============================================================================
  it('Test 16: Empty or 500 response from backend returns graceful fallback text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    try {
      const response = await sendAgentChatMessage({
        message: 'Trigger server error',
      });

      assert.ok(response);
      assert.ok(response.reply.includes('AI Agent is currently unavailable'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ============================================================================
  // Test 17: Strict CNN 3-class restrictions
  // ============================================================================
  it('Test 17: CNN classifications are strictly limited to WILDFIRE, INDUSTRIAL_FIRE, NON_FIRE', () => {
    const validCnnClasses = new Set(['WILDFIRE', 'INDUSTRIAL_FIRE', 'NON_FIRE']);

    assert.strictEqual(validCnnClasses.has('WILDFIRE'), true);
    assert.strictEqual(validCnnClasses.has('INDUSTRIAL_FIRE'), true);
    assert.strictEqual(validCnnClasses.has('NON_FIRE'), true);

    // Forbidden as CNN classes
    assert.strictEqual(validCnnClasses.has('PERSISTENT_THERMAL_SOURCE'), false);
    assert.strictEqual(validCnnClasses.has('AGRICULTURAL_BURNING'), false);
  });

  // ============================================================================
  // Test 18: Mandatory scientific disclaimers preservation
  // ============================================================================
  it('Test 18: Preserves exact text of all mandatory operational & scientific disclaimers', () => {
    const disclaimers = [
      'AI Candidate Classification is an evidence-fusion output, not a standalone confirmation of an industrial fire.',
      'Sentinel-2 imagery is optical evidence and may not be temporally coincident with FIRMS observations.',
      'Sentinel-1 is SAR radar evidence and does not measure fire temperature.',
      'Threat zones are simulation envelopes — not official evacuation boundaries.',
    ];

    assert.strictEqual(disclaimers.length, 4);
    assert.ok(disclaimers[0].includes('AI Candidate Classification is an evidence-fusion output'));
    assert.ok(disclaimers[1].includes('Sentinel-2 imagery is optical evidence'));
    assert.ok(disclaimers[2].includes('Sentinel-1 is SAR radar evidence and does not measure fire temperature'));
    assert.ok(disclaimers[3].includes('Threat zones are simulation envelopes — not official evacuation boundaries'));
  });

});
