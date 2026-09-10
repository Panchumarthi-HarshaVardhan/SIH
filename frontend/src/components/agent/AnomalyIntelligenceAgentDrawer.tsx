import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faPaperPlane,
  faXmark,
  faWindowMinimize,
  faTriangleExclamation,
  faLocationCrosshairs,
  faCircleCheck,
  faArrowsRotate,
  faSatellite,
  faIndustry,
  faFire,
  faBrain,
  faShieldHalved,
  faCircleInfo,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
import type { Hotspot } from '../../types/hotspot';
import type {
  MapAction,
  MapContext,
  AgentChatResponse,
} from '../../types/agent';
import { useMapContext } from './useMapContext';
import { dispatchMapAction } from './actionDispatcher';
import { sendAgentChatMessage } from '../../api/agent';

export interface AnomalyIntelligenceAgentDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  onToggle?: () => void;
  mapInstance?: any | null;
  hotspots?: Hotspot[];
  selectedObservationId?: string | null;
  onSelectObservation?: (id: string) => void;
  onZoomToCoords?: (lat: number, lon: number, zoom?: number) => void;
  onFilterChange?: (filters: { priority_index?: string[]; classification?: string }) => void;
  onHighlightObservations?: (ids: string[]) => void;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  toolsUsed?: string[];
  evidenceSources?: string[];
  action?: MapAction | null;
  actionSummary?: string | null;
  disclaimers?: string[];
  isError?: boolean;
}

const QUICK_PROMPTS = [
  { label: 'Highest Risk', query: 'Which anomaly is highest risk?' },
  { label: 'Why High Priority?', query: 'Why is this anomaly high priority?' },
  { label: 'Why Industrial Fire?', query: 'Why is this classified as an industrial fire?' },
  { label: 'Visible Anomalies', query: 'What anomalies are visible?' },
  { label: 'Persistent Hotspots', query: 'Show persistent anomalies' },
  { label: 'P1 Industrial Fires', query: 'Show P1 industrial fires' },
  { label: 'Supporting Evidence', query: 'What evidence supports this classification?' },
  { label: 'Responder Actions', query: 'What should responders investigate first?' },
];

/**
 * Lightweight safe Markdown renderer for operational agent responses.
 * Avoids raw HTML injection and formats headings, lists, bold text, and code.
 */
function renderMarkdownContent(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let inList = false;
  let listItems: string[] = [];

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="agent-md-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{parseInlineFormatting(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={`h4-${i}`} className="agent-md-h4">
          {parseInlineFormatting(trimmed.substring(4))}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="agent-md-h3">
          {parseInlineFormatting(trimmed.substring(3))}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="agent-md-h2">
          {parseInlineFormatting(trimmed.substring(2))}
        </h2>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(trimmed.substring(2));
    } else if (/^\d+\.\s/.test(trimmed)) {
      inList = true;
      listItems.push(trimmed.replace(/^\d+\.\s/, ''));
    } else {
      flushList();
      elements.push(
        <p key={`p-${i}`} className="agent-md-p">
          {parseInlineFormatting(trimmed)}
        </p>
      );
    }
  }

  flushList();
  return elements;
}

/**
 * Handles inline bold (**text**), italic (*text*), and code (`text`).
 */
function parseInlineFormatting(text: string): React.ReactNode {
  // Regex to split by bold, inline code, or italic
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`([^`]+)`/);
    const italicMatch = remaining.match(/\*([^*]+)\*/);

    // Find the earliest match
    let earliest: { type: 'bold' | 'code' | 'italic'; index: number; length: number; content: string } | null = null;

    if (boldMatch && boldMatch.index !== undefined) {
      earliest = { type: 'bold', index: boldMatch.index, length: boldMatch[0].length, content: boldMatch[1] };
    }
    if (codeMatch && codeMatch.index !== undefined && (!earliest || codeMatch.index < earliest.index)) {
      earliest = { type: 'code', index: codeMatch.index, length: codeMatch[0].length, content: codeMatch[1] };
    }
    if (italicMatch && italicMatch.index !== undefined && (!earliest || italicMatch.index < earliest.index)) {
      earliest = { type: 'italic', index: italicMatch.index, length: italicMatch[0].length, content: italicMatch[1] };
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    if (earliest.index > 0) {
      parts.push(remaining.substring(0, earliest.index));
    }

    if (earliest.type === 'bold') {
      parts.push(<strong key={`b-${keyIdx++}`}>{earliest.content}</strong>);
    } else if (earliest.type === 'code') {
      parts.push(<code key={`c-${keyIdx++}`} className="agent-code-inline">{earliest.content}</code>);
    } else if (earliest.type === 'italic') {
      parts.push(<em key={`i-${keyIdx++}`}>{earliest.content}</em>);
    }

    remaining = remaining.substring(earliest.index + earliest.length);
  }

  return <>{parts}</>;
}

/**
 * Maps known evidence source strings to icons and display names.
 */
function getEvidenceBadge(source: string): { icon: any; label: string; color: string } {
  const norm = source.toLowerCase();
  if (norm.includes('firms') || norm.includes('nasa')) {
    return { icon: faFire, label: 'NASA FIRMS', color: '#ef4444' };
  }
  if (norm.includes('sentinel-2') || norm.includes('s2') || norm.includes('optical')) {
    return { icon: faSatellite, label: 'Sentinel-2 L2A (Optical)', color: '#3b82f6' };
  }
  if (norm.includes('sentinel-1') || norm.includes('s1') || norm.includes('sar') || norm.includes('radar')) {
    return { icon: faSatellite, label: 'Sentinel-1 SAR (Radar)', color: '#06b6d4' };
  }
  if (norm.includes('osm') || norm.includes('openstreetmap') || norm.includes('industrial context')) {
    return { icon: faIndustry, label: 'OSM Industrial Context', color: '#f59e0b' };
  }
  if (norm.includes('persistence') || norm.includes('cluster')) {
    return { icon: faArrowsRotate, label: 'Temporal Persistence', color: '#8b5cf6' };
  }
  if (norm.includes('cnn') || norm.includes('residual cnn')) {
    return { icon: faBrain, label: '6-Band CNN', color: '#10b981' };
  }
  if (norm.includes('fusion') || norm.includes('evidence fusion')) {
    return { icon: faShieldHalved, label: 'Evidence Fusion', color: '#6366f1' };
  }
  return { icon: faCircleInfo, label: source, color: '#64748b' };
}

/**
 * Human-friendly operational tool names.
 */
function formatToolName(tool: string): string {
  const mapping: Record<string, string> = {
    get_visible_anomalies: 'FIRMS Viewport Query',
    get_anomaly_details: 'Multi-Sensor Investigation',
    get_persistent_clusters: 'Persistence Clustering',
    get_osm_industrial_context: 'OSM Infrastructure Context',
    get_satellite_evidence: 'Copernicus Dual Satellite',
    get_multispectral_cnn_prediction: 'Multispectral CNN Inference',
    get_evidence_fusion: 'Evidence Fusion Breakdown',
    get_priority_ranking: 'Decision Support Leaderboard',
    get_threat_zones_and_impact: 'Threat Zone Simulation',
    get_spread_forecast: 'Fire Spread Projection',
    get_incident_audit_trail: 'Incident Audit Trail',
    get_system_readiness_status: 'System Readiness Telemetry',
  };
  return mapping[tool] || tool.replace(/_/g, ' ');
}

export const AnomalyIntelligenceAgentDrawer: React.FC<AnomalyIntelligenceAgentDrawerProps> = ({
  isOpen: controlledIsOpen,
  onClose,
  onToggle,
  mapInstance,
  hotspots = [],
  selectedObservationId = null,
  onSelectObservation,
  onZoomToCoords,
  onFilterChange,
  onHighlightObservations,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('Querying multi-sensor intelligence...');
  const [sessionId, setSessionId] = useState<string>(() => `session_${Date.now().toString(36)}`);

  const isDrawerOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Map context hook for extracting viewport coordinates & bounds
  const { getMapContext } = useMapContext({
    selectedObservationId,
    hotspots,
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'agent',
      text: `### Thermal Emergency Operations Center — FireAI\n\nI am grounded in real-time multi-sensor telemetry, Copernicus satellite acquisitions, and OpenStreetMap infrastructure data.\n\nAsk me about active thermal detections, classification rationale, threat perimeters, or dispatch priorities.\n\n*Select an anomaly on the map to query specific sensor evidence.*`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      evidenceSources: [],
      disclaimers: [
        'AI Candidate Classification is an evidence-fusion output, not a standalone confirmation of an industrial fire.',
      ],
    },
  ]);

  // Auto-scroll on new message
  useEffect(() => {
    if (isDrawerOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isDrawerOpen, isMinimized, isLoading]);

  // Focus input on drawer open
  useEffect(() => {
    if (isDrawerOpen && !isMinimized) {
      inputRef.current?.focus();
    }
  }, [isDrawerOpen, isMinimized]);

  const handleOpenToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalIsOpen((prev) => !prev);
    }
    setIsMinimized(false);
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setInternalIsOpen(false);
    }
    setIsMinimized(false);
  };

  const executeSendMessage = useCallback(
    async (textToSend: string) => {
      const trimmed = textToSend.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        sender: 'user',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInputMessage('');
      setIsLoading(true);
      setLoadingStep('Querying multi-sensor intelligence...');

      // Capture live map context from Leaflet
      let mapContext: MapContext;
      if (mapInstance && typeof mapInstance.getBounds === 'function') {
        const bounds = mapInstance.getBounds();
        const center = mapInstance.getCenter();
        const zoom = mapInstance.getZoom();
        mapContext = getMapContext({
          center: { lat: center.lat, lon: center.lng },
          zoom,
          bounds: {
            min_lat: bounds.getSouth(),
            max_lat: bounds.getNorth(),
            min_lon: bounds.getWest(),
            max_lon: bounds.getEast(),
          },
          selectedObservationId,
        });
      } else {
        mapContext = getMapContext({
          selectedObservationId,
        });
      }

      try {
        const response: AgentChatResponse = await sendAgentChatMessage({
          message: trimmed,
          session_id: sessionId,
          map_context: mapContext,
        });

        if (response.session_id) {
          setSessionId(response.session_id);
        }

        // Execute structured map action if returned
        let actionSummary: string | null = null;
        if (response.action) {
          const dispatchResult = dispatchMapAction(response.action, {
            hotspots,
            mapInstance,
            onZoomToCoords,
            onSelectObservation,
            onFilterChange,
            onHighlightObservations,
          });

          if (dispatchResult.success) {
            if (response.action.type === 'ZOOM_TO_ANOMALY') {
              actionSummary = `Zoomed to anomaly: ${response.action.observation_id} (${response.action.latitude.toFixed(4)}, ${response.action.longitude.toFixed(4)})`;
            } else if (response.action.type === 'FILTER_ANOMALIES') {
              const filters = [];
              if (response.action.classification) filters.push(`Class: ${response.action.classification}`);
              if (response.action.priority_index) filters.push(`Priority: ${response.action.priority_index.join(', ')}`);
              actionSummary = `Filters applied: ${filters.join(' | ') || 'All'}`;
            } else if (response.action.type === 'HIGHLIGHT_ANOMALIES') {
              actionSummary = `Highlighted ${response.action.observation_ids.length} anomalies on map`;
            }
          }
        }

        const agentMsg: ChatMessage = {
          id: `agent_${Date.now()}`,
          sender: 'agent',
          text: response.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          toolsUsed: response.tools_used || [],
          evidenceSources: response.evidence_sources || [],
          action: response.action,
          actionSummary,
          disclaimers: response.disclaimers || [],
        };

        setMessages((prev) => [...prev, agentMsg]);
      } catch (err: any) {
        console.error('[AgentDrawer] Error handling response:', err);
        const errorMsg: ChatMessage = {
          id: `error_${Date.now()}`,
          sender: 'agent',
          text: 'AI Agent is currently unavailable. The underlying anomaly detection system remains operational.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [
      isLoading,
      mapInstance,
      getMapContext,
      selectedObservationId,
      sessionId,
      hotspots,
      onZoomToCoords,
      onSelectObservation,
      onFilterChange,
      onHighlightObservations,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeSendMessage(inputMessage);
    }
  };

  return (
    <>
      {/* 1. FLOATING LAUNCHER BUTTON */}
      {!isDrawerOpen && (
        <button
          type="button"
          className="agent-floating-btn"
          onClick={handleOpenToggle}
          title="Open Anomaly Intelligence Agent"
          aria-label="Open Anomaly Intelligence Agent"
        >
          <div className="agent-btn-pulse-ring" />
          <FontAwesomeIcon icon={faRobot} className="agent-btn-icon" />
          <span className="agent-btn-label">AI Intelligence</span>
          <span className="agent-btn-status-dot online" />
        </button>
      )}

      {/* 2. CHAT DRAWER PANEL */}
      {isDrawerOpen && (
        <aside
          className={`agent-drawer-panel ${isMinimized ? 'minimized' : 'expanded'}`}
          aria-label="Anomaly Intelligence Assistant"
        >
          {/* HEADER */}
          <div className="agent-drawer-header">
            <div className="agent-header-left">
              <div className="agent-header-icon-box">
                <FontAwesomeIcon icon={faRobot} />
              </div>
              <div className="agent-header-titles">
                <div className="agent-header-title-row">
                  <h3 className="agent-header-title">FireAI</h3>
                  <span className="agent-header-status-badge">
                    <span className="agent-header-status-dot" />
                    OPERATIONAL
                  </span>
                </div>
                <p className="agent-header-subtitle">
                  Thermal Anomaly &amp; Industrial Fire Reasoning
                </p>
              </div>
            </div>

            <div className="agent-header-actions">
              <button
                type="button"
                className="agent-header-action-btn"
                onClick={() => setIsMinimized((prev) => !prev)}
                title={isMinimized ? 'Expand panel' : 'Minimize panel'}
              >
                <FontAwesomeIcon icon={faWindowMinimize} />
              </button>
              <button
                type="button"
                className="agent-header-action-btn close"
                onClick={handleClose}
                title="Close panel"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          </div>

          {/* BODY (COLLAPSIBLE) */}
          {!isMinimized && (
            <>
              {/* TARGET ANOMALY CONTEXT BANNER (ONLY SHOWN WHEN ANOMALY SELECTED) */}
              {selectedObservationId && (
                <div className="agent-context-banner">
                  <div className="agent-context-left">
                    <span className="agent-context-tag">TARGET ANOMALY</span>
                    <span className="agent-context-desc">
                      <span className="agent-context-id">
                        <FontAwesomeIcon icon={faLocationCrosshairs} className="mr-1 text-green" />
                        {selectedObservationId}
                      </span>
                    </span>
                  </div>
                </div>
              )}

              {/* QUICK PROMPT CHIPS */}
              <div className="agent-quick-prompts-bar">
                <div className="agent-quick-prompts-scroll">
                  {QUICK_PROMPTS.map((qp, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="agent-prompt-chip"
                      disabled={isLoading}
                      onClick={() => executeSendMessage(qp.query)}
                      title={qp.query}
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* CONVERSATION HISTORY */}
              <div className="agent-messages-container">
                {messages.map((msg) => (
                  <div key={msg.id} className={`agent-message-wrapper ${msg.sender}`}>
                    <div className="agent-message-avatar">
                      <FontAwesomeIcon icon={msg.sender === 'user' ? faUser : faRobot} />
                    </div>

                    <div className="agent-message-content-box">
                      {/* TOOL EXECUTION ACTIVITY INDICATOR (FOR AGENT MESSAGES) */}
                      {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                        <div className="agent-tools-used-list">
                          <span className="agent-tools-header">Operations Checked:</span>
                          <div className="agent-tools-tags">
                            {msg.toolsUsed.map((tool, idx) => (
                              <span key={idx} className="agent-tool-tag">
                                <FontAwesomeIcon icon={faCircleCheck} className="mr-1 text-green" />
                                {formatToolName(tool)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* MAIN MESSAGE BODY */}
                      <div className="agent-message-text">
                        {renderMarkdownContent(msg.text)}
                      </div>

                      {/* EXECUTED MAP ACTION BANNER */}
                      {msg.actionSummary && (
                        <div className="agent-action-banner">
                          <FontAwesomeIcon icon={faLocationCrosshairs} className="agent-action-icon" />
                          <div className="agent-action-text">
                            <strong>Map Action Executed:</strong> {msg.actionSummary}
                          </div>
                        </div>
                      )}

                      {/* EVIDENCE USED BADGES */}
                      {msg.evidenceSources && msg.evidenceSources.length > 0 && (
                        <div className="agent-evidence-section">
                          <span className="agent-evidence-label">Evidence Grounding:</span>
                          <div className="agent-evidence-badges">
                            {msg.evidenceSources.map((src, idx) => {
                              const badge = getEvidenceBadge(src);
                              return (
                                <span
                                  key={idx}
                                  className="agent-evidence-badge"
                                  style={{ borderColor: badge.color }}
                                >
                                  <FontAwesomeIcon icon={badge.icon} style={{ color: badge.color, marginRight: '4px' }} />
                                  {badge.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* SCIENTIFIC DISCLAIMERS CALLOUT */}
                      {msg.disclaimers && msg.disclaimers.length > 0 && (
                        <div className="agent-disclaimers-box">
                          <div className="agent-disclaimers-header">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="text-amber" />
                            <span>Scientific & Operational Disclaimers</span>
                          </div>
                          <ul className="agent-disclaimers-list">
                            {msg.disclaimers.map((d, idx) => (
                              <li key={idx}>{d}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* LOADING STATE INDICATOR */}
                {isLoading && (
                  <div className="agent-message-wrapper agent loading">
                    <div className="agent-message-avatar">
                      <FontAwesomeIcon icon={faRobot} />
                    </div>
                    <div className="agent-message-content-box loading-box">
                      <div className="agent-loading-row">
                        <span className="agent-loading-dot" />
                        <span className="agent-loading-prefix">ANALYZING:</span>
                        <span className="agent-loading-text">{loadingStep}</span>
                      </div>
                      <div className="agent-loading-progress-bar">
                        <div className="agent-loading-progress-fill" />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* INPUT BAR */}
              <div className="agent-input-container">
                <div className="agent-input-wrapper">
                  <textarea
                    ref={inputRef}
                    className="agent-textarea"
                    placeholder="Ask anything..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="agent-send-btn"
                    disabled={isLoading || !inputMessage.trim()}
                    onClick={() => executeSendMessage(inputMessage)}
                    title="Send message"
                    aria-label="Send message"
                  >
                    <FontAwesomeIcon icon={faPaperPlane} />
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      )}
    </>
  );
};

export default AnomalyIntelligenceAgentDrawer;
