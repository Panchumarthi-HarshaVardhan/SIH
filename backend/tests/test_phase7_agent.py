"""
Test Suite for Phase 1: Anomaly Intelligence Agent (Backend Service).
Validates schemas, read-only tools, system prompts, guardrails, LLM provider abstraction,
and FastAPI /api/agent endpoints.
"""

import asyncio
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.agent.schemas import (
    validate_obs_id,
    MapCoordinates,
    MapBounds,
    MapContext,
    AgentChatRequest,
    AgentChatResponse,
    AgentCapabilitiesResponse,
    AgentStructuredAction,
    ZoomToAnomalyAction,
    FilterAnomaliesAction,
    HighlightAnomaliesAction,
    parse_map_action,
    MapAction,
)
from app.agent.prompts import (
    AGENT_SYSTEM_PROMPT,
    MANDATORY_DISCLAIMERS,
    SUPPORTED_CNN_CLASSES,
)
from app.agent.tools import (
    AGENT_TOOLS_REGISTRY,
    AGENT_TOOLS_DEFINITIONS,
    tool_get_visible_anomalies,
    tool_get_anomaly_details,
    tool_get_persistent_clusters,
    tool_get_osm_industrial_context,
    tool_get_satellite_evidence,
    tool_get_multispectral_cnn_prediction,
    tool_get_evidence_fusion,
    tool_get_priority_ranking,
    tool_get_threat_zones_and_impact,
    tool_get_spread_forecast,
    tool_get_incident_audit_trail,
    tool_get_system_readiness_status,
)
from app.agent.service import (
    AnomalyIntelligenceAgent,
    MockLLMClient,
    GeminiLLMClient,
)


@pytest.fixture
def client():
    return TestClient(app)


# ==============================================================================
# 1. Schemas and Validation Tests
# ==============================================================================

def test_observation_id_validation_valid():
    """Verify that valid observation IDs pass regex validation."""
    assert validate_obs_id("demo_industrial_p1") == "demo_industrial_p1"
    assert validate_obs_id("a1b2c3d4e5f60718") == "a1b2c3d4e5f60718"
    assert validate_obs_id("FIRMS-2026-09-IND") == "FIRMS-2026-09-IND"
    assert validate_obs_id(None) is None
    assert validate_obs_id("   ") is None


def test_observation_id_validation_invalid():
    """Verify that malicious or malformed observation IDs are rejected."""
    with pytest.raises(ValueError):
        validate_obs_id("ab")  # Too short (< 3 chars)

    with pytest.raises(ValueError):
        validate_obs_id("a" * 65)  # Too long (> 64 chars)

    with pytest.raises(ValueError):
        validate_obs_id("demo'; DROP TABLE users;--")  # SQL injection syntax

    with pytest.raises(ValueError):
        validate_obs_id("<script>alert(1)</script>")  # XSS syntax


def test_map_context_validation():
    """Verify MapContext model constraints and sanitization."""
    coords = MapCoordinates(lat=17.701, lon=83.301)
    bounds = MapBounds(min_lat=17.0, max_lat=18.0, min_lon=83.0, max_lon=84.0)

    ctx = MapContext(
        selected_observation_id="demo_industrial_p1",
        center=coords,
        zoom=12,
        bounds=bounds,
        visible_observation_ids=["demo_industrial_p1", "demo_wildfire_p2"]
    )
    assert ctx.selected_observation_id == "demo_industrial_p1"
    assert ctx.zoom == 12
    assert len(ctx.visible_observation_ids) == 2


def test_map_context_invalid_obs_id():
    """Verify MapContext rejects invalid observation IDs."""
    with pytest.raises(ValidationError):
        MapContext(selected_observation_id="bad id with spaces!")


def test_agent_chat_request_validation():
    """Verify AgentChatRequest enforces message constraints."""
    req = AgentChatRequest(message="What is the FRP for this fire?")
    assert req.message == "What is the FRP for this fire?"

    with pytest.raises(ValidationError):
        AgentChatRequest(message="")  # Empty message disallowed


# ==============================================================================
# 2. System Prompts & CNN Class Constraints Tests
# ==============================================================================

def test_supported_cnn_classes_exact():
    """Verify the 6-band Residual CNN supports strictly WILDFIRE, INDUSTRIAL_FIRE, NON_FIRE."""
    assert set(SUPPORTED_CNN_CLASSES) == {"WILDFIRE", "INDUSTRIAL_FIRE", "NON_FIRE"}
    assert "PERSISTENT_THERMAL_SOURCE" not in SUPPORTED_CNN_CLASSES
    assert "AGRICULTURAL_BURNING" not in SUPPORTED_CNN_CLASSES


def test_mandatory_disclaimers_present():
    """Verify all 4 required operational/scientific disclaimers exist."""
    assert len(MANDATORY_DISCLAIMERS) == 4
    assert any("Candidate Classification" in d for d in MANDATORY_DISCLAIMERS)
    assert any("Sentinel-2" in d for d in MANDATORY_DISCLAIMERS)
    assert any("Sentinel-1" in d and "temperature" in d for d in MANDATORY_DISCLAIMERS)
    assert any("Threat zones are simulation envelopes" in d for d in MANDATORY_DISCLAIMERS)


def test_system_prompt_guardrails():
    """Verify AGENT_SYSTEM_PROMPT explicitly encodes critical operational rules."""
    assert "WILDFIRE" in AGENT_SYSTEM_PROMPT
    assert "INDUSTRIAL_FIRE" in AGENT_SYSTEM_PROMPT
    assert "NON_FIRE" in AGENT_SYSTEM_PROMPT
    assert "DOES NOT MEASURE TEMPERATURE" in AGENT_SYSTEM_PROMPT
    assert "STRICT HALLUCINATION GUARDRAILS" in AGENT_SYSTEM_PROMPT


# ==============================================================================
# 3. Agent Tool Catalog & Registry Tests
# ==============================================================================

def test_tool_registry_and_definitions_match():
    """Verify all 12 tools are registered in both AGENT_TOOLS_REGISTRY and AGENT_TOOLS_DEFINITIONS."""
    expected_tools = {
        "get_visible_anomalies",
        "get_anomaly_details",
        "get_persistent_clusters",
        "get_osm_industrial_context",
        "get_satellite_evidence",
        "get_multispectral_cnn_prediction",
        "get_evidence_fusion",
        "get_priority_ranking",
        "get_threat_zones_and_impact",
        "get_spread_forecast",
        "get_incident_audit_trail",
        "get_system_readiness_status",
    }
    assert set(AGENT_TOOLS_REGISTRY.keys()) == expected_tools
    defined_names = {d["name"] for d in AGENT_TOOLS_DEFINITIONS}
    assert defined_names == expected_tools


def test_tool_get_visible_anomalies():
    """Verify get_visible_anomalies executes and returns structured observation list."""
    res = asyncio.run(tool_get_visible_anomalies({"limit": 5}))
    assert "count" in res
    assert "sample" in res
    assert isinstance(res["sample"], list)


def test_tool_get_anomaly_details_benchmark():
    """Verify get_anomaly_details returns complete investigation for benchmark scenario."""
    res = asyncio.run(tool_get_anomaly_details({"observation_id": "demo_industrial_p1"}))
    assert "observation" in res
    assert res["observation"]["observation_id"] == "demo_industrial_p1"
    assert "evidence_fusion" in res


def test_tool_get_persistent_clusters():
    """Verify get_persistent_clusters executes non-blocking spatial-temporal clustering."""
    res = asyncio.run(tool_get_persistent_clusters({"region": "india", "min_score": 0.0}))
    assert "total_clusters" in res
    assert "clusters" in res
    assert isinstance(res["clusters"], list)


def test_tool_get_osm_industrial_context():
    """Verify get_osm_industrial_context executes proximity query."""
    res = asyncio.run(tool_get_osm_industrial_context({"latitude": 17.701, "longitude": 83.301, "radius_km": 5.0}))
    assert "latitude" in res
    assert "longitude" in res
    assert "mapped_facilities_count" in res


def test_tool_get_satellite_evidence():
    """Verify get_satellite_evidence retrieves Sentinel-2 optical and Sentinel-1 SAR fallback."""
    res = asyncio.run(tool_get_satellite_evidence({"observation_id": "demo_industrial_p1"}))
    assert "sentinel_2" in res
    assert "sentinel_1" in res


def test_tool_get_multispectral_cnn_prediction():
    """Verify get_multispectral_cnn_prediction outputs strictly one of the 3 supported classes."""
    res = asyncio.run(tool_get_multispectral_cnn_prediction({"observation_id": "demo_industrial_p1"}))
    assert "predicted_class" in res
    assert res["predicted_class"] in SUPPORTED_CNN_CLASSES
    assert "probabilities" in res


def test_tool_get_evidence_fusion():
    """Verify get_evidence_fusion returns multi-layer reasoning and scores."""
    res = asyncio.run(tool_get_evidence_fusion({"observation_id": "demo_industrial_p1"}))
    assert "fused_score" in res
    assert "candidate_classification" in res
    assert "weight_breakdown" in res


def test_tool_get_priority_ranking():
    """Verify get_priority_ranking returns operational dispatch ranking."""
    res = asyncio.run(tool_get_priority_ranking({"region": "india", "limit": 5}))
    assert "count" in res
    assert "leaderboard" in res
    assert isinstance(res["leaderboard"], list)


def test_tool_get_threat_zones_and_impact():
    """Verify get_threat_zones_and_impact calculates concentric envelopes and asset exposure."""
    res = asyncio.run(tool_get_threat_zones_and_impact({"observation_id": "demo_industrial_p1"}))
    assert "threat_zones" in res
    assert "inner_radius_meters" in res["threat_zones"]
    assert "impact_summary" in res


def test_tool_get_spread_forecast():
    """Verify get_spread_forecast returns multi-horizon projections."""
    res = asyncio.run(tool_get_spread_forecast({"observation_id": "demo_wildfire_p2"}))
    assert "horizons" in res
    assert "1h" in res["horizons"]


def test_tool_get_incident_audit_trail():
    """Verify get_incident_audit_trail returns lifecycle state machine status."""
    res = asyncio.run(tool_get_incident_audit_trail({"observation_id": "demo_industrial_p1"}))
    assert "lifecycle_state" in res
    assert "actions_count" in res


def test_tool_get_system_readiness_status():
    """Verify get_system_readiness_status returns health report."""
    res = asyncio.run(tool_get_system_readiness_status({}))
    assert "overall_status" in res
    assert "subsystems" in res


# ==============================================================================
# 4. LLM Client and Orchestrator Service Tests
# ==============================================================================

def test_mock_llm_client_tool_call_generation():
    """Verify MockLLMClient identifies keywords and issues appropriate tool calls."""
    mock_client = MockLLMClient()
    assert mock_client.is_configured() is True

    # Test visible anomalies intent
    res = asyncio.run(mock_client.generate(messages=[{"role": "user", "content": "How many active thermal anomalies are there?"}]))
    assert len(res.get("tool_calls", [])) > 0
    assert res["tool_calls"][0]["name"] == "get_visible_anomalies"

    # Test priority ranking intent
    res = asyncio.run(mock_client.generate(messages=[{"role": "user", "content": "Show me the top priority dispatch incidents"}]))
    assert res["tool_calls"][0]["name"] == "get_priority_ranking"

    # Test system status intent
    res = asyncio.run(mock_client.generate(messages=[{"role": "user", "content": "What is the system readiness status?"}]))
    assert res["tool_calls"][0]["name"] == "get_system_readiness_status"


def test_agent_orchestration_with_mock_client():
    """Verify AnomalyIntelligenceAgent conducts full autonomous tool loop with MockLLMClient."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())

    req = AgentChatRequest(
        message="What is the current status and priority of the active anomalies?",
        map_context=MapContext(selected_observation_id="demo_industrial_p1")
    )

    response = asyncio.run(agent.chat(req))
    assert isinstance(response, AgentChatResponse)
    assert len(response.reply) > 0
    assert len(response.tools_used) > 0
    assert len(response.evidence_sources) > 0
    assert len(response.disclaimers) > 0


def test_gemini_client_unconfigured_behavior():
    """Verify GeminiLLMClient handles unconfigured state cleanly."""
    unconfigured_gemini = GeminiLLMClient(api_key="")
    assert unconfigured_gemini.is_configured() is False

    agent = AnomalyIntelligenceAgent(llm_client=unconfigured_gemini)
    req = AgentChatRequest(message="Tell me about this fire")
    res = asyncio.run(agent.chat(req))

    assert "GEMINI_API_KEY" in res.reply or "not yet configured" in res.reply
    assert res.tools_used == []


# ==============================================================================
# 5. FastAPI REST API Integration Tests
# ==============================================================================

def test_api_agent_capabilities_endpoint(client):
    """Test GET /api/agent/capabilities returns full tool catalog and disclaimers."""
    response = client.get("/api/agent/capabilities")
    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "READY"
    assert "tools_available" in data
    assert len(data["tools_available"]) == 12
    assert set(data["supported_cnn_classes"]) == {"WILDFIRE", "INDUSTRIAL_FIRE", "NON_FIRE"}
    assert len(data["disclaimers"]) == 4


def test_api_agent_chat_endpoint_success(client):
    """Test POST /api/agent/chat processes questions with map context."""
    payload = {
        "message": "What is the priority ranking of active incidents?",
        "session_id": "test_session_001",
        "map_context": {
            "selected_observation_id": "demo_industrial_p1",
            "zoom": 10,
            "center": {"lat": 17.7, "lon": 83.3},
            "bounds": {"min_lat": 17.0, "max_lat": 18.0, "min_lon": 83.0, "max_lon": 84.0},
            "visible_observation_ids": ["demo_industrial_p1"]
        }
    }

    response = client.post("/api/agent/chat", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "reply" in data
    assert len(data["reply"]) > 0
    assert "tools_used" in data
    assert "evidence_sources" in data
    assert "disclaimers" in data
    assert data["session_id"] == "test_session_001"


def test_api_agent_chat_endpoint_invalid_observation_id(client):
    """Test POST /api/agent/chat rejects malicious observation IDs in map_context."""
    payload = {
        "message": "Investigate this observation",
        "map_context": {
            "selected_observation_id": "bad;DROP TABLE;"
        }
    }
    response = client.post("/api/agent/chat", json=payload)
    assert response.status_code == 422


# ==============================================================================
# 6. Phase 2: MapAction Validation & Generation Tests
# ==============================================================================

def test_map_action_zoom_validation_valid():
    """Verify ZoomToAnomalyAction parses valid coordinates and zoom levels."""
    raw = {
        "type": "ZOOM_TO_ANOMALY",
        "observation_id": "demo_industrial_p1",
        "latitude": 20.31,
        "longitude": 86.61,
        "zoom": 14
    }
    action = parse_map_action(raw)
    assert isinstance(action, ZoomToAnomalyAction)
    assert action.type == "ZOOM_TO_ANOMALY"
    assert action.observation_id == "demo_industrial_p1"
    assert action.latitude == 20.31
    assert action.longitude == 86.61
    assert action.zoom == 14


def test_map_action_zoom_validation_invalid():
    """Verify ZoomToAnomalyAction rejects invalid coordinates or zoom levels."""
    # Latitude out of bounds (> 90)
    assert parse_map_action({
        "type": "ZOOM_TO_ANOMALY",
        "observation_id": "demo_industrial_p1",
        "latitude": 91.0,
        "longitude": 86.61,
        "zoom": 14
    }) is None

    # Longitude out of bounds (< -180)
    assert parse_map_action({
        "type": "ZOOM_TO_ANOMALY",
        "observation_id": "demo_industrial_p1",
        "latitude": 20.0,
        "longitude": -185.0,
        "zoom": 14
    }) is None

    # Zoom out of bounds (< 1)
    assert parse_map_action({
        "type": "ZOOM_TO_ANOMALY",
        "observation_id": "demo_industrial_p1",
        "latitude": 20.0,
        "longitude": 86.0,
        "zoom": 0
    }) is None


def test_map_action_filter_validation_valid():
    """Verify FilterAnomaliesAction validates priority and classification."""
    raw = {
        "type": "FILTER_ANOMALIES",
        "priority_index": ["P1", "P2"],
        "classification": "INDUSTRIAL_FIRE"
    }
    action = parse_map_action(raw)
    assert isinstance(action, FilterAnomaliesAction)
    assert action.type == "FILTER_ANOMALIES"
    assert action.priority_index == ["P1", "P2"]
    assert action.classification == "INDUSTRIAL_FIRE"


def test_map_action_filter_validation_invalid_classification():
    """Verify FilterAnomaliesAction strictly rejects unsupported CNN classes."""
    # Reject AGRICULTURAL_BURNING (not a CNN class)
    assert parse_map_action({
        "type": "FILTER_ANOMALIES",
        "classification": "AGRICULTURAL_BURNING"
    }) is None

    # Reject PERSISTENT_THERMAL_SOURCE (not a CNN class)
    assert parse_map_action({
        "type": "FILTER_ANOMALIES",
        "classification": "PERSISTENT_THERMAL_SOURCE"
    }) is None

    # Reject arbitrary string
    assert parse_map_action({
        "type": "FILTER_ANOMALIES",
        "classification": "RANDOM_FIRE"
    }) is None


def test_map_action_filter_validation_invalid_priority():
    """Verify FilterAnomaliesAction rejects non-standard priority codes."""
    assert parse_map_action({
        "type": "FILTER_ANOMALIES",
        "priority_index": ["P1", "P5"]
    }) is None


def test_map_action_highlight_validation_valid():
    """Verify HighlightAnomaliesAction validates observation ID lists."""
    raw = {
        "type": "HIGHLIGHT_ANOMALIES",
        "observation_ids": ["demo_industrial_p1", "demo_wildfire_p2"]
    }
    action = parse_map_action(raw)
    assert isinstance(action, HighlightAnomaliesAction)
    assert action.type == "HIGHLIGHT_ANOMALIES"
    assert len(action.observation_ids) == 2


def test_map_action_highlight_validation_empty():
    """Verify HighlightAnomaliesAction rejects empty ID lists."""
    assert parse_map_action({
        "type": "HIGHLIGHT_ANOMALIES",
        "observation_ids": []
    }) is None


def test_map_action_arbitrary_code_rejection():
    """Verify arbitrary JS, SQL, or unsupported action types are strictly rejected."""
    assert parse_map_action({
        "type": "EXEC_JAVASCRIPT",
        "code": "window.alert('pwned')"
    }) is None

    assert parse_map_action({
        "type": "SQL_QUERY",
        "sql": "DROP TABLE hotspots;"
    }) is None

    assert parse_map_action({
        "type": "DELETE_RECORD",
        "id": "123"
    }) is None


# ==============================================================================
# 7. Phase 2: Map-Aware Question Workflows
# ==============================================================================

def test_workflow_show_highest_risk_anomaly():
    """Workflow 5: 'Show me the highest-risk anomaly.' returns ZOOM_TO_ANOMALY action."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())
    req = AgentChatRequest(message="Show me the highest-risk anomaly.")
    res = asyncio.run(agent.chat(req))

    assert len(res.reply) > 0
    assert "get_priority_ranking" in res.tools_used
    assert res.action is not None
    assert res.action.type == "ZOOM_TO_ANOMALY"
    assert len(res.action.observation_id) > 0
    assert -90.0 <= res.action.latitude <= 90.0
    assert -180.0 <= res.action.longitude <= 180.0
    assert res.action.zoom >= 1


def test_workflow_show_p1_industrial_fire_candidates():
    """Workflow 6: 'Show me P1 industrial fire candidates.' returns FILTER_ANOMALIES action."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())
    req = AgentChatRequest(message="Show me P1 industrial fire candidates.")
    res = asyncio.run(agent.chat(req))

    assert len(res.reply) > 0
    assert res.action is not None
    assert res.action.type == "FILTER_ANOMALIES"
    assert isinstance(res.action, FilterAnomaliesAction)
    assert res.action.priority_index == ["P1"]
    assert res.action.classification == "INDUSTRIAL_FIRE"


def test_workflow_highlight_persistent_anomalies():
    """Workflow 7: 'Highlight persistent anomalies.' returns HIGHLIGHT_ANOMALIES action."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())
    req = AgentChatRequest(message="Highlight persistent anomalies.")
    res = asyncio.run(agent.chat(req))

    assert len(res.reply) > 0
    assert "get_persistent_clusters" in res.tools_used
    assert res.action is not None
    assert res.action.type == "HIGHLIGHT_ANOMALIES"
    assert isinstance(res.action, HighlightAnomaliesAction)
    assert len(res.action.observation_ids) > 0


def test_workflow_why_is_this_classified_uses_selected_id():
    """Workflow 1: 'Why is this anomaly classified as an industrial fire?' uses selected_observation_id."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())
    req = AgentChatRequest(
        message="Why is this anomaly classified as an industrial fire?",
        map_context=MapContext(selected_observation_id="demo_industrial_p1")
    )
    res = asyncio.run(agent.chat(req))
    assert "get_anomaly_details" in res.tools_used
    assert "demo_industrial_p1" in res.reply


def test_workflow_why_is_this_high_priority_uses_selected_id():
    """Workflow 2: 'Why is this high priority?' uses selected_observation_id."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())
    req = AgentChatRequest(
        message="Why is this high priority?",
        map_context=MapContext(selected_observation_id="demo_industrial_p1")
    )
    res = asyncio.run(agent.chat(req))
    assert "get_anomaly_details" in res.tools_used
    assert "demo_industrial_p1" in res.reply


def test_workflow_what_anomalies_are_visible():
    """Workflow 3: 'What anomalies are visible?' queries visible anomalies tool."""
    agent = AnomalyIntelligenceAgent(llm_client=MockLLMClient())
    req = AgentChatRequest(
        message="What anomalies are visible?",
        map_context=MapContext(
            bounds=MapBounds(min_lat=17.0, max_lat=18.0, min_lon=83.0, max_lon=84.0),
            visible_observation_ids=["demo_industrial_p1"]
        )
    )
    res = asyncio.run(agent.chat(req))
    assert "get_visible_anomalies" in res.tools_used
    assert "active thermal anomalies" in res.reply.lower() or "firms" in res.reply.lower()

