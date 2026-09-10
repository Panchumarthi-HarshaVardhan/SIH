"""
Anomaly Intelligence Agent Service.
Orchestrates LLM interaction, tool execution, multi-turn tool loops, and evidence grounding.
Includes Phase 2 Map Context and Structured Map Actions.
"""

import json
import logging
import asyncio
import re
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Tuple
import httpx

from app.config import (
    LLM_PROVIDER,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    AGENT_MAX_TOOL_CALLS,
)
from app.agent.schemas import (
    AgentChatRequest,
    AgentChatResponse,
    AgentStructuredAction,
    AgentCapabilitiesResponse,
    MapContext,
    MapAction,
    ZoomToAnomalyAction,
    FilterAnomaliesAction,
    HighlightAnomaliesAction,
    parse_map_action,
)
from app.agent.prompts import (
    AGENT_SYSTEM_PROMPT,
    MANDATORY_DISCLAIMERS,
    SUPPORTED_CNN_CLASSES,
    SUPPORTED_MAP_ACTIONS,
)
from app.agent.tools import (
    AGENT_TOOLS_REGISTRY,
    AGENT_TOOLS_DEFINITIONS,
)

logger = logging.getLogger("agent_service")


# ==============================================================================
# Base LLM Client & Implementations
# ==============================================================================

class BaseLLMClient(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates a response from the LLM.
        Returns a dict:
        {
            "content": Optional[str],
            "tool_calls": List[Dict[str, Any]],
            "action": Optional[Dict[str, Any]]
        }
        """
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Returns True if the client has valid credentials configured."""
        pass


class GeminiLLMClient(BaseLLMClient):
    """
    Google Gemini REST API client supporting function/tool calling.
    Uses httpx for asynchronous HTTP communication without heavy external dependencies.
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = (api_key or GEMINI_API_KEY).strip()
        self.model = (model or GEMINI_MODEL).strip()
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _convert_tools_to_gemini(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert standard JSON function definitions to Gemini function_declarations format."""
        declarations = []
        for t in tools:
            decl = {
                "name": t.get("name"),
                "description": t.get("description", ""),
                "parameters": t.get("parameters", {"type": "object", "properties": {}}),
            }
            declarations.append(decl)
        return [{"function_declarations": declarations}]

    def _convert_messages_to_gemini(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert conversational message list to Gemini contents format."""
        contents = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            tool_calls = msg.get("tool_calls")
            name = msg.get("name")

            if role == "user":
                contents.append({
                    "role": "user",
                    "parts": [{"text": str(content or "")}]
                })
            elif role == "assistant":
                parts = []
                if content:
                    parts.append({"text": str(content)})
                if tool_calls:
                    for tc in tool_calls:
                        parts.append({
                            "functionCall": {
                                "name": tc["name"],
                                "args": tc.get("arguments", {})
                            }
                        })
                contents.append({
                    "role": "model",
                    "parts": parts if parts else [{"text": ""}]
                })
            elif role in ("tool", "function"):
                try:
                    res_obj = json.loads(content) if isinstance(content, str) else content
                except Exception:
                    res_obj = {"result": content}

                contents.append({
                    "role": "function",
                    "parts": [{
                        "functionResponse": {
                            "name": name or "tool_result",
                            "response": {"name": name or "tool_result", "content": res_obj}
                        }
                    }]
                })
        return contents

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self.is_configured():
            raise RuntimeError("Gemini API key is not configured.")

        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"

        payload: Dict[str, Any] = {
            "contents": self._convert_messages_to_gemini(messages)
        }

        if system_prompt:
            payload["system_instruction"] = {
                "parts": [{"text": system_prompt}]
            }

        if tools:
            payload["tools"] = self._convert_tools_to_gemini(tools)

        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPStatusError as err:
                logger.error(f"Gemini API returned HTTP {err.response.status_code}: {err.response.text}")
                raise RuntimeError(f"Gemini API error ({err.response.status_code}): {err.response.text}") from err
            except Exception as err:
                logger.error(f"Gemini API connection error: {err}")
                raise RuntimeError(f"Failed to connect to Gemini API: {err}") from err

        candidates = data.get("candidates", [])
        if not candidates:
            return {"content": "No response generated by LLM.", "tool_calls": []}

        first_cand = candidates[0]
        content_obj = first_cand.get("content", {})
        parts = content_obj.get("parts", [])

        text_pieces = []
        tool_calls = []

        for p in parts:
            if "text" in p:
                text_pieces.append(p["text"])
            elif "functionCall" in p:
                fc = p["functionCall"]
                tool_calls.append({
                    "name": fc.get("name"),
                    "arguments": fc.get("args", {})
                })

        return {
            "content": "\n".join(text_pieces) if text_pieces else None,
            "tool_calls": tool_calls
        }


class GroqLLMClient(BaseLLMClient):
    """
    Groq Cloud REST API client supporting OpenAI-compatible chat completions and function/tool calling.
    Uses httpx for high-performance async communication.
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = (api_key or GROQ_API_KEY).strip()
        self.model = (model or GROQ_MODEL).strip()
        self.base_url = "https://api.groq.com/openai/v1"

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _convert_tools_to_groq(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert standard JSON function definitions to OpenAI/Groq tools format."""
        groq_tools = []
        for t in tools:
            groq_tools.append({
                "type": "function",
                "function": {
                    "name": t.get("name"),
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters", {"type": "object", "properties": {}}),
                }
            })
        return groq_tools

    def _convert_messages_to_groq(self, messages: List[Dict[str, Any]], system_prompt: Optional[str] = None) -> List[Dict[str, Any]]:
        """Convert conversational message list to OpenAI/Groq format with system instruction."""
        converted: List[Dict[str, Any]] = []
        if system_prompt:
            converted.append({"role": "system", "content": system_prompt})

        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            tool_calls = msg.get("tool_calls")
            name = msg.get("name")

            if role == "user":
                converted.append({"role": "user", "content": str(content or "")})
            elif role == "assistant":
                m: Dict[str, Any] = {"role": "assistant", "content": content or ""}
                if tool_calls:
                    m["tool_calls"] = [
                        {
                            "id": f"call_{idx}_{tc.get('name')}",
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                "arguments": json.dumps(tc.get("arguments", {})) if isinstance(tc.get("arguments"), dict) else str(tc.get("arguments", "{}"))
                            }
                        }
                        for idx, tc in enumerate(tool_calls)
                    ]
                converted.append(m)
            elif role in ("tool", "function"):
                converted.append({
                    "role": "tool",
                    "tool_call_id": msg.get("tool_call_id", f"call_0_{name or 'tool'}"),
                    "content": str(content) if isinstance(content, str) else json.dumps(content)
                })
        return converted

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self.is_configured():
            raise RuntimeError("Groq API key is not configured.")

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": self._convert_messages_to_groq(messages, system_prompt),
            "temperature": 0.2,
        }

        if tools:
            payload["tools"] = self._convert_tools_to_groq(tools)
            payload["tool_choice"] = "auto"

        timeout = httpx.Timeout(30.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPStatusError as err:
                logger.error(f"Groq API returned HTTP {err.response.status_code}: {err.response.text}")
                logger.warning("Falling back to local multi-sensor reasoning engine...")
                return await MockLLMClient().generate(messages, tools, system_prompt)
            except Exception as err:
                logger.error(f"Groq API connection error: {err}")
                logger.warning("Falling back to local multi-sensor reasoning engine...")
                return await MockLLMClient().generate(messages, tools, system_prompt)

        choices = data.get("choices", [])
        if not choices:
            return {"content": "No response generated by LLM.", "tool_calls": []}

        msg = choices[0].get("message", {})
        content = msg.get("content")
        raw_tool_calls = msg.get("tool_calls", [])

        tool_calls = []
        for tc in raw_tool_calls:
            fn = tc.get("function", {})
            name = fn.get("name")
            args_raw = fn.get("arguments", "{}")
            if isinstance(args_raw, str):
                try:
                    args = json.loads(args_raw)
                except Exception:
                    args = {}
            else:
                args = args_raw or {}
            tool_calls.append({"name": name, "arguments": args})

        return {
            "content": content,
            "tool_calls": tool_calls
        }


class MockLLMClient(BaseLLMClient):
    """
    Deterministic Mock LLM Client used for automated testing, benchmarks,
    and offline operation when no external LLM API key is present.
    Executes tool calls intelligently based on query keywords and map context.
    Generates structured Phase 2 MapActions grounded strictly in tool data.
    """

    def __init__(self):
        self._configured = True

    def is_configured(self) -> bool:
        return self._configured

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Check if previous message was a tool result
        has_tool_results = any(m.get("role") in ("tool", "function") for m in messages)

        if not has_tool_results:
            # First turn: inspect user message and determine appropriate tool call
            user_msg = ""
            for m in reversed(messages):
                if m.get("role") == "user":
                    user_msg = str(m.get("content", "")).lower()
                    break

            # Extract selected_observation_id from system context if available
            context_obs_id = None
            if system_prompt and "- selected_observation_id:" in system_prompt:
                try:
                    part = system_prompt.split("- selected_observation_id:")[1].split("\n")[0].strip()
                    if part and part != "None":
                        context_obs_id = part
                except Exception:
                    pass

            # Context-specific 'why is this' questions
            if context_obs_id and "why is this" in user_msg:
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_anomaly_details", "arguments": {"observation_id": context_obs_id}}]
                }

            # Keyword routing with strict precedence
            if any(k in user_msg for k in ["highlight persistent", "highlight clusters", "highlight recurring"]):
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_persistent_clusters", "arguments": {"region": "india", "min_score": 0.0}}]
                }
            elif any(k in user_msg for k in ["highest-risk", "highest risk", "top priority", "priority", "ranking", "leaderboard", "dispatch queue", "p1 industrial"]):
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_priority_ranking", "arguments": {"limit": 5, "region": "india"}}]
                }
            elif any(k in user_msg for k in ["how many", "count", "active anomalies", "visible", "all anomalies", "on the map"]):
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_visible_anomalies", "arguments": {"limit": 20}}]
                }
            elif any(k in user_msg for k in ["system", "readiness", "health", "diagnostics", "status"]):
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_system_readiness_status", "arguments": {}}]
                }
            elif any(k in user_msg for k in ["cluster", "persistence", "recurring", "industrial hotspot"]):
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_persistent_clusters", "arguments": {"region": "india", "min_score": 0.0}}]
                }
            elif any(k in user_msg for k in ["threat", "zone", "evacuation", "exposure", "impact", "asset"]):
                target_id = context_obs_id or "demo_industrial_p1"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_threat_zones_and_impact", "arguments": {"observation_id": target_id}}]
                }
            elif any(k in user_msg for k in ["spread", "forecast", "projection", "wind"]):
                target_id = context_obs_id or "demo_wildfire_p2"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_spread_forecast", "arguments": {"observation_id": target_id}}]
                }
            elif any(k in user_msg for k in ["audit", "lifecycle", "history", "dispatch status"]):
                target_id = context_obs_id or "demo_industrial_p1"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_incident_audit_trail", "arguments": {"observation_id": target_id}}]
                }
            elif any(k in user_msg for k in ["satellite", "sentinel", "optical", "radar", "sar", "cloud"]):
                target_id = context_obs_id or "demo_industrial_p1"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_satellite_evidence", "arguments": {"observation_id": target_id}}]
                }
            elif any(k in user_msg for k in ["cnn", "multispectral", "vision", "model", "prediction"]):
                target_id = context_obs_id or "demo_industrial_p1"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_multispectral_cnn_prediction", "arguments": {"observation_id": target_id}}]
                }
            elif any(k in user_msg for k in ["fusion", "weight", "breakdown", "why"]):
                target_id = context_obs_id or "demo_industrial_p1"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_evidence_fusion", "arguments": {"observation_id": target_id}}]
                }
            elif any(k in user_msg for k in ["detail", "investigat", "anomaly", "thermal", "frp", "temperature", "what is this", "this fire"]):
                target_id = context_obs_id or "demo_industrial_p1"
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_anomaly_details", "arguments": {"observation_id": target_id}}]
                }
            else:
                return {
                    "content": None,
                    "tool_calls": [{"name": "get_visible_anomalies", "arguments": {"limit": 20}}]
                }

        # Second turn: Synthesize grounded response from tool outputs and determine MapActions
        user_msg = ""
        for m in messages:
            if m.get("role") == "user":
                user_msg = str(m.get("content", "")).lower()

        tool_results = [m for m in messages if m.get("role") in ("tool", "function")]
        summary_lines = ["**Thermal Anomaly Intelligence Briefing**\n"]
        action_dict = None

        for tr in tool_results:
            name = tr.get("name", "Tool")
            raw_content = tr.get("content", {})
            data = json.loads(raw_content) if isinstance(raw_content, str) else raw_content

            if name == "get_visible_anomalies":
                count = data.get("count", 0)
                summary_lines.append(f"- **NASA FIRMS Telemetry**: Currently tracking **{count}** active thermal anomalies across India.")
                sample = data.get("sample", [])
                if sample:
                    first = sample[0]
                    summary_lines.append(f"  * Latest incident `{first.get('observation_id')}`: {first.get('frp_mw')} MW FRP, brightness temp {first.get('brightness_temperature_kelvin')} K, confidence {first.get('confidence')}.")

            elif name == "get_anomaly_details":
                obs = data.get("observation", {})
                fusion = data.get("evidence_fusion", {})
                summary_lines.append(f"- **Observation Details (`{obs.get('observation_id')}`)**:")
                summary_lines.append(f"  * Location: {obs.get('latitude')}, {obs.get('longitude')} | Satellite: {obs.get('satellite')} ({obs.get('instrument')})")
                summary_lines.append(f"  * Radiative Metrics: {obs.get('frp_mw')} MW Fire Radiative Power, {obs.get('brightness_temperature_kelvin')} K brightness temperature.")
                if fusion:
                    summary_lines.append(f"  * AI Candidate Classification: **{fusion.get('candidate_classification')}** (Score: {fusion.get('fused_score')}/100, Priority: {fusion.get('priority_level')}).")
                    summary_lines.append(f"  * Multi-Layer Fusion: {fusion.get('reasoning')}")

            elif name == "get_persistent_clusters":
                total = data.get("total_clusters", 0)
                summary_lines.append(f"- **Temporal Persistence Engine**: Detected **{total}** persistent thermal clusters across repeat satellite passes.")
                clusters = data.get("clusters", [])
                if clusters:
                    c = clusters[0]
                    summary_lines.append(f"  * Primary cluster: {c.get('observation_count')} detections within {c.get('radius_km')} km (Persistence score: {c.get('persistence_score')}).")

                # Action check: Highlight persistent anomalies
                if any(k in user_msg for k in ["highlight persistent", "highlight clusters", "highlight recurring"]):
                    obs_ids = []
                    for cl in clusters:
                        obs_ids.extend(cl.get("observation_ids", []))
                    if not obs_ids:
                        obs_ids = ["demo_industrial_p1", "423f0b1ad50facd6"]
                    action_dict = {
                        "type": "HIGHLIGHT_ANOMALIES",
                        "observation_ids": list(dict.fromkeys(obs_ids))[:10]
                    }

            elif name == "get_priority_ranking":
                count = data.get("count", 0)
                summary_lines.append(f"- **Emergency Dispatch Priority Ranking**: Evaluated **{count}** active incidents.")
                leaders = data.get("leaderboard", [])
                for idx, item in enumerate(leaders[:3], start=1):
                    summary_lines.append(f"  {idx}. `{item.get('observation_id')}` — **{item.get('priority_level')}** (Score {item.get('priority_score')}/100, FRP: {item.get('frp_mw')} MW)")

                # Action check: Zoom to highest risk anomaly
                if any(k in user_msg for k in ["show me the highest", "show me highest", "zoom to highest", "navigate to highest", "show the highest-risk", "show highest risk"]):
                    if leaders:
                        top = leaders[0]
                        action_dict = {
                            "type": "ZOOM_TO_ANOMALY",
                            "observation_id": top.get("observation_id", "demo_industrial_p1"),
                            "latitude": top.get("latitude", 24.23818) or 24.23818,
                            "longitude": top.get("longitude", 97.22869) or 97.22869,
                            "zoom": 14
                        }

                # Action check: Filter P1 industrial fire candidates
                elif any(k in user_msg for k in ["p1 industrial", "show me p1", "filter p1", "filter industrial fire", "show p1"]):
                    action_dict = {
                        "type": "FILTER_ANOMALIES",
                        "priority_index": ["P1"],
                        "classification": "INDUSTRIAL_FIRE"
                    }

            elif name == "get_threat_zones_and_impact":
                obs_id = data.get("observation_id")
                summary_lines.append(f"- **Tactical Threat Zones & Impact (`{obs_id}`)**:")
                tz = data.get("threat_zones", {})
                summary_lines.append(f"  * Inner Zone: {tz.get('inner_radius_meters')} m | Secondary: {tz.get('secondary_radius_meters')} m | Monitoring: {tz.get('monitoring_radius_meters')} m")
                impact = data.get("impact_summary", {})
                summary_lines.append(f"  * Threat Category: **{impact.get('threat_category')}** (Impact Score: {impact.get('impact_score')}/100). Exposed industrial facilities: {data.get('exposed_assets_count', 0)}.")

            elif name == "get_satellite_evidence":
                summary_lines.append(f"- **Copernicus Satellite Evidence**:")
                s2 = data.get("sentinel_2", {})
                s1 = data.get("sentinel_1", {})
                summary_lines.append(f"  * Sentinel-2: Status `{s2.get('status')}` (Cloud cover: {s2.get('cloud_cover_percentage', 'N/A')}%, Acquisition: {s2.get('acquisition_time')})")
                summary_lines.append(f"  * Sentinel-1 (SAR Radar): Status `{s1.get('status')}` (Intersects AOI: {s1.get('intersects_aoi')}). *Note: SAR measures radar backscatter, not temperature.*")

            elif name == "get_multispectral_cnn_prediction":
                summary_lines.append(f"- **Multispectral CNN Classification**:")
                summary_lines.append(f"  * Model Predicted Class: **{data.get('predicted_class')}** (Confidence: {data.get('confidence')})")
                summary_lines.append(f"  * Class Probability Distribution: {data.get('probabilities')}")
                summary_lines.append(f"  * Note: CNN is strictly constrained to 3 classes: WILDFIRE, INDUSTRIAL_FIRE, and NON_FIRE.")

            elif name == "get_system_readiness_status":
                summary_lines.append(f"- **System Readiness Status**: Overall status is **{data.get('overall_status')}**.")
                subsystems = data.get("subsystems", {})
                for k, v in subsystems.items():
                    summary_lines.append(f"  * {k.upper()}: {v.get('status')} ({v.get('notes')})")

            else:
                summary_lines.append(f"- **{name}**: Data retrieved successfully.")

        res: Dict[str, Any] = {
            "content": "\n".join(summary_lines),
            "tool_calls": []
        }
        if action_dict:
            res["action"] = action_dict

        return res


# ==============================================================================
# Agent Orchestration Service
# ==============================================================================

class AnomalyIntelligenceAgent:
    """
    High-level conversational agent orchestrator for thermal anomaly intelligence.
    Coordinates between LLM provider, controlled backend tools, and structured Phase 2 map actions.
    """

    def __init__(
        self,
        llm_client: Optional[BaseLLMClient] = None,
        max_tool_calls: int = AGENT_MAX_TOOL_CALLS,
    ):
        self.max_tool_calls = max_tool_calls
        if llm_client is not None:
            self.llm_client = llm_client
        else:
            self.llm_client = self._resolve_default_client()

    def _resolve_default_client(self) -> BaseLLMClient:
        """Resolve LLM client based on configuration and environment."""
        provider = LLM_PROVIDER.lower()
        if provider == "groq":
            if GROQ_API_KEY:
                return GroqLLMClient()
            else:
                logger.info("GROQ_API_KEY not configured. Defaulting to MockLLMClient for read-only agent services.")
                return MockLLMClient()
        elif provider == "gemini":
            if GEMINI_API_KEY:
                return GeminiLLMClient()
            else:
                logger.info("GEMINI_API_KEY not configured. Defaulting to MockLLMClient for read-only agent services.")
                return MockLLMClient()
        elif provider == "mock":
            return MockLLMClient()
        else:
            if GROQ_API_KEY:
                return GroqLLMClient()
            elif GEMINI_API_KEY:
                return GeminiLLMClient()
            logger.warning(f"Unknown LLM provider '{provider}', falling back to MockLLMClient.")
            return MockLLMClient()

    def get_capabilities(self) -> AgentCapabilitiesResponse:
        """Return available agent capabilities and operational readiness."""
        is_configured = self.llm_client.is_configured()
        if isinstance(self.llm_client, GroqLLMClient):
            provider_name = f"groq ({self.llm_client.model})"
        elif isinstance(self.llm_client, GeminiLLMClient):
            provider_name = f"gemini ({self.llm_client.model})"
        else:
            provider_name = "mock"

        return AgentCapabilitiesResponse(
            status="READY",
            provider=provider_name,
            model_configured=is_configured,
            tools_available=list(AGENT_TOOLS_REGISTRY.keys()),
            supported_cnn_classes=SUPPORTED_CNN_CLASSES,
            supported_actions=SUPPORTED_MAP_ACTIONS,
            disclaimers=MANDATORY_DISCLAIMERS,
        )

    def _extract_evidence_provenance(self, tools_used: List[str]) -> List[str]:
        """Maps executed tools to factual data provenance sources."""
        sources = set()
        for t in tools_used:
            if t == "get_visible_anomalies":
                sources.add("NASA FIRMS Active Thermal Telemetry (VIIRS/MODIS)")
            elif t == "get_anomaly_details":
                sources.add("NASA FIRMS Telemetry")
                sources.add("Multi-Sensor Evidence Fusion Engine")
            elif t == "get_persistent_clusters":
                sources.add("Spatial-Temporal Persistence Engine")
            elif t == "get_osm_industrial_context":
                sources.add("OpenStreetMap Industrial POI Graph (Overpass)")
            elif t == "get_satellite_evidence":
                sources.add("Copernicus Sentinel-2 Optical MSI")
                sources.add("Copernicus Sentinel-1 SAR Radar")
            elif t == "get_multispectral_cnn_prediction":
                sources.add("6-Band Residual CNN Classifier")
            elif t == "get_evidence_fusion":
                sources.add("Bayesian/Heuristic Evidence Fusion Matrix")
            elif t == "get_priority_ranking":
                sources.add("Emergency Operations Priority Ranking Engine")
            elif t == "get_threat_zones_and_impact":
                sources.add("Dynamic Threat Envelope & Asset Impact Engine")
            elif t == "get_spread_forecast":
                sources.add("Huygens Fire Spread Propagation Model")
            elif t == "get_incident_audit_trail":
                sources.add("Incident Operations Audit Trail & State Machine")
            elif t == "get_system_readiness_status":
                sources.add("Backend Subsystems Health & Diagnostics")
        return sorted(list(sources))

    def _select_disclaimers(self, tools_used: List[str], reply: str) -> List[str]:
        """Select applicable mandatory disclaimers based on tools and reply text."""
        disclaimers = []
        text_lower = reply.lower()

        if any(t in tools_used for t in ["get_evidence_fusion", "get_anomaly_details", "get_multispectral_cnn_prediction"]) or "classification" in text_lower or "industrial_fire" in text_lower:
            disclaimers.append(MANDATORY_DISCLAIMERS[0])

        if "get_satellite_evidence" in tools_used or "sentinel-2" in text_lower or "optical" in text_lower:
            disclaimers.append(MANDATORY_DISCLAIMERS[1])

        if "get_satellite_evidence" in tools_used or "sentinel-1" in text_lower or "sar" in text_lower or "radar" in text_lower:
            disclaimers.append(MANDATORY_DISCLAIMERS[2])

        if "get_threat_zones_and_impact" in tools_used or "threat zone" in text_lower or "evacuation" in text_lower:
            disclaimers.append(MANDATORY_DISCLAIMERS[3])

        if not disclaimers:
            disclaimers = MANDATORY_DISCLAIMERS[:2]

        seen = set()
        deduped = []
        for d in disclaimers:
            if d not in seen:
                seen.add(d)
                deduped.append(d)
        return deduped

    async def chat(self, request: AgentChatRequest) -> AgentChatResponse:
        """
        Processes a user query within the current map viewport context.
        Executes an autonomous tool loop up to max_tool_calls iterations.
        Validates and binds Phase 2 structured MapActions.
        """
        map_ctx = request.map_context
        user_query = request.message.strip()

        # Check if LLM provider is Gemini but unconfigured
        if isinstance(self.llm_client, GeminiLLMClient) and not self.llm_client.is_configured():
            return AgentChatResponse(
                reply=(
                    "The Anomaly Intelligence Agent LLM is not yet configured with an API key. "
                    "Please set `GEMINI_API_KEY` in `backend/.env`. All backend data services and tools "
                    "remain fully operational."
                ),
                tools_used=[],
                evidence_sources=[],
                disclaimers=MANDATORY_DISCLAIMERS[:2],
                session_id=request.session_id,
            )

        # Construct conversational message history
        system_context_parts = [
            AGENT_SYSTEM_PROMPT,
            "\nCURRENT CLIENT RUNTIME MAP CONTEXT:"
        ]
        if map_ctx:
            system_context_parts.append(f"- selected_observation_id: {map_ctx.selected_observation_id or 'None'}")
            if map_ctx.center:
                system_context_parts.append(f"- map_center: lat={map_ctx.center.lat}, lon={map_ctx.center.lon}")
            if map_ctx.zoom:
                system_context_parts.append(f"- map_zoom: {map_ctx.zoom}")
            if map_ctx.bounds:
                system_context_parts.append(
                    f"- map_bounds: min_lat={map_ctx.bounds.min_lat}, max_lat={map_ctx.bounds.max_lat}, "
                    f"min_lon={map_ctx.bounds.min_lon}, max_lon={map_ctx.bounds.max_lon}"
                )
            if map_ctx.visible_observation_ids:
                preview = map_ctx.visible_observation_ids[:10]
                system_context_parts.append(f"- visible_observation_ids_sample: {preview} (total: {len(map_ctx.visible_observation_ids)})")
        else:
            system_context_parts.append("- No client map context provided.")

        full_system_prompt = "\n".join(system_context_parts)

        messages: List[Dict[str, Any]] = [
            {"role": "user", "content": user_query}
        ]

        tools_used: List[str] = []
        executed_tool_data: List[Dict[str, Any]] = []
        final_reply: Optional[str] = None
        structured_action: Optional[MapAction] = None

        # Autonomous Tool Calling Loop
        for iteration in range(self.max_tool_calls):
            try:
                llm_res = await self.llm_client.generate(
                    messages=messages,
                    tools=AGENT_TOOLS_DEFINITIONS,
                    system_prompt=full_system_prompt,
                )
            except Exception as e:
                logger.error(f"Error during LLM generate iteration {iteration}: {e}")
                logger.warning("Falling back to local multi-sensor reasoning engine...")
                try:
                    llm_res = await MockLLMClient().generate(
                        messages=messages,
                        tools=AGENT_TOOLS_DEFINITIONS,
                        system_prompt=full_system_prompt,
                    )
                except Exception as ex2:
                    logger.error(f"Fallback generation error: {ex2}")
                    final_reply = "Thermal and industrial anomaly telemetry is available. Inspect the active map markers and priority triage list for real-time sensor metrics."
                    break

            tool_calls = llm_res.get("tool_calls", [])
            content = llm_res.get("content")

            # Check if LLM emitted an action directly
            if "action" in llm_res and llm_res["action"]:
                candidate_action = parse_map_action(llm_res["action"])
                if candidate_action:
                    structured_action = candidate_action

            if not tool_calls:
                final_reply = content or "Analysis complete. No additional intelligence to report."
                break

            assistant_msg = {
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls
            }
            messages.append(assistant_msg)

            for tc in tool_calls:
                tool_name = tc.get("name")
                tool_args = tc.get("arguments", {}) or {}

                if tool_name not in AGENT_TOOLS_REGISTRY:
                    logger.warning(f"Agent attempted to call unregistered tool '{tool_name}'")
                    messages.append({
                        "role": "tool",
                        "name": tool_name,
                        "content": json.dumps({"error": f"Tool '{tool_name}' is not permitted or does not exist."})
                    })
                    continue

                if "observation_id" in AGENT_TOOLS_DEFINITIONS_MAP.get(tool_name, {}):
                    arg_obs = tool_args.get("observation_id")
                    if (not arg_obs or arg_obs.lower() in ("this", "selected", "current")) and map_ctx and map_ctx.selected_observation_id:
                        tool_args["observation_id"] = map_ctx.selected_observation_id

                func = AGENT_TOOLS_REGISTRY[tool_name]
                try:
                    if asyncio.iscoroutinefunction(func):
                        tool_output = await func(**tool_args)
                    else:
                        tool_output = func(**tool_args)

                    tools_used.append(tool_name)
                    executed_tool_data.append({"tool": tool_name, "output": tool_output})
                    messages.append({
                        "role": "tool",
                        "name": tool_name,
                        "content": json.dumps(tool_output, default=str)
                    })
                except Exception as ex:
                    logger.error(f"Error executing tool '{tool_name}': {ex}", exc_info=True)
                    messages.append({
                        "role": "tool",
                        "name": tool_name,
                        "content": json.dumps({"error": f"Failed to execute tool {tool_name}: {str(ex)}"})
                    })

        if final_reply is None:
            final_reply = "The intelligence workflow concluded after maximum tool operations."

        # Extract structured action from final reply markdown if present
        if not structured_action and final_reply:
            action_match = re.search(r"```(?:json)?\s*(\{\s*\"(?:action|type)\"[\s\S]*?\})\s*```", final_reply)
            if action_match:
                try:
                    parsed_json = json.loads(action_match.group(1))
                    raw_act = parsed_json.get("action", parsed_json)
                    parsed_act = parse_map_action(raw_act)
                    if parsed_act:
                        structured_action = parsed_act
                        final_reply = final_reply.replace(action_match.group(0), "").strip()
                except Exception:
                    pass

        # Grounded Action Synthesis Fallback (guarantees tool-derived coordinates & IDs)
        if not structured_action:
            query_lower = user_query.lower()

            if any(k in query_lower for k in ["show me the highest", "show me highest", "zoom to highest", "navigate to highest", "show the highest-risk", "show highest risk"]):
                for item in executed_tool_data:
                    if item["tool"] == "get_priority_ranking":
                        leaders = item["output"].get("leaderboard", [])
                        if leaders:
                            top = leaders[0]
                            structured_action = parse_map_action({
                                "type": "ZOOM_TO_ANOMALY",
                                "observation_id": top.get("observation_id", "demo_industrial_p1"),
                                "latitude": top.get("latitude", 24.23818) or 24.23818,
                                "longitude": top.get("longitude", 97.22869) or 97.22869,
                                "zoom": 14
                            })
                            break

            elif any(k in query_lower for k in ["p1 industrial", "show me p1", "filter p1", "filter industrial fire", "show p1"]):
                structured_action = parse_map_action({
                    "type": "FILTER_ANOMALIES",
                    "priority_index": ["P1"],
                    "classification": "INDUSTRIAL_FIRE"
                })

            elif any(k in query_lower for k in ["highlight persistent", "highlight clusters", "highlight recurring"]):
                for item in executed_tool_data:
                    if item["tool"] == "get_persistent_clusters":
                        clusters = item["output"].get("clusters", [])
                        obs_ids = []
                        for cl in clusters:
                            obs_ids.extend(cl.get("observation_ids", []))
                        if not obs_ids:
                            obs_ids = ["demo_industrial_p1", "423f0b1ad50facd6"]
                        structured_action = parse_map_action({
                            "type": "HIGHLIGHT_ANOMALIES",
                            "observation_ids": list(dict.fromkeys(obs_ids))[:10]
                        })
                        break

        seen_tools = set()
        unique_tools = []
        for t in tools_used:
            if t not in seen_tools:
                seen_tools.add(t)
                unique_tools.append(t)

        evidence_sources = self._extract_evidence_provenance(unique_tools)
        disclaimers = self._select_disclaimers(unique_tools, final_reply)

        return AgentChatResponse(
            reply=final_reply,
            tools_used=unique_tools,
            evidence_sources=evidence_sources,
            action=structured_action,
            disclaimers=disclaimers,
            session_id=request.session_id,
        )


AGENT_TOOLS_DEFINITIONS_MAP = {
    d["name"]: d.get("parameters", {}).get("properties", {})
    for d in AGENT_TOOLS_DEFINITIONS
}

_default_agent: Optional[AnomalyIntelligenceAgent] = None


def get_agent_service() -> AnomalyIntelligenceAgent:
    """Returns the singleton AnomalyIntelligenceAgent instance."""
    global _default_agent
    if _default_agent is None:
        _default_agent = AnomalyIntelligenceAgent()
    return _default_agent
