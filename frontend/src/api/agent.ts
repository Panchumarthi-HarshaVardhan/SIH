/**
 * Anomaly Intelligence Agent API Client
 * Connects to /api/agent/chat and /api/agent/capabilities
 */

import { getApiUrl, apiFetch } from '../config/api.ts';
import type {
  AgentChatRequest,
  AgentChatResponse,
  AgentCapabilitiesResponse,
} from '../types/agent.ts';

/**
 * Fetches the agent capability manifest and model configuration status.
 */
export async function fetchAgentCapabilities(): Promise<AgentCapabilitiesResponse> {
  try {
    const response = await fetch(getApiUrl('/api/agent/capabilities'));
    if (!response.ok) {
      throw new Error(`Agent capabilities returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.warn('[AgentAPI] Failed to fetch capabilities, using fallback status:', err);
    return {
      status: 'offline',
      provider: 'unknown',
      model_configured: false,
      tools_available: [],
      supported_cnn_classes: ['WILDFIRE', 'INDUSTRIAL_FIRE', 'NON_FIRE'],
      supported_actions: ['ZOOM_TO_ANOMALY', 'FILTER_ANOMALIES', 'HIGHLIGHT_ANOMALIES'],
      disclaimers: [],
    };
  }
}

/**
 * Sends a chat message with live map context to the Anomaly Intelligence Agent.
 * Gracefully catches errors to prevent crashing the EOC dashboard.
 */
export async function sendAgentChatMessage(
  request: AgentChatRequest
): Promise<AgentChatResponse> {
  try {
    const response = await apiFetch(getApiUrl('/api/agent/chat'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AgentAPI] Chat request failed HTTP ${response.status}:`, errorText);
      return {
        reply: 'AI Agent is currently unavailable. The underlying anomaly detection system remains operational.',
        tools_used: [],
        evidence_sources: [],
        action: null,
        disclaimers: [],
        session_id: request.session_id || null,
      };
    }

    const data: AgentChatResponse = await response.json();
    return data;
  } catch (err) {
    console.error('[AgentAPI] Network exception during chat request:', err);
    return {
      reply: 'AI Agent is currently unavailable. The underlying anomaly detection system remains operational.',
      tools_used: [],
      evidence_sources: [],
      action: null,
      disclaimers: [],
      session_id: request.session_id || null,
    };
  }
}
