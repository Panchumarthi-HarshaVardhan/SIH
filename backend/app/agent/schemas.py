from typing import Dict, Any, List, Optional, Literal, Union, Annotated
from pydantic import BaseModel, Field, field_validator, TypeAdapter
import re

OBSERVATION_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]{3,64}$")


def validate_obs_id(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    cleaned = v.strip()
    if not cleaned:
        return None
    if not OBSERVATION_ID_REGEX.match(cleaned):
        raise ValueError(f"Invalid observation ID format: '{v}'. Must be 3-64 alphanumeric characters, underscores, or hyphens.")
    return cleaned


class MapCoordinates(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude coordinate in WGS-84 [-90.0, 90.0]")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude coordinate in WGS-84 [-180.0, 180.0]")


class MapBounds(BaseModel):
    min_lat: float = Field(..., ge=-90.0, le=90.0, description="Southern boundary latitude")
    max_lat: float = Field(..., ge=-90.0, le=90.0, description="Northern boundary latitude")
    min_lon: float = Field(..., ge=-180.0, le=180.0, description="Western boundary longitude")
    max_lon: float = Field(..., ge=-180.0, le=180.0, description="Eastern boundary longitude")

    @field_validator("max_lat")
    @classmethod
    def validate_latitude_order(cls, v: float, info) -> float:
        min_lat = info.data.get("min_lat")
        if min_lat is not None and v < min_lat:
            raise ValueError(f"max_lat ({v}) cannot be less than min_lat ({min_lat})")
        return v

    @field_validator("max_lon")
    @classmethod
    def validate_longitude_order(cls, v: float, info) -> float:
        min_lon = info.data.get("min_lon")
        if min_lon is not None and v < min_lon:
            raise ValueError(f"max_lon ({v}) cannot be less than min_lon ({min_lon})")
        return v


class MapContext(BaseModel):
    selected_observation_id: Optional[str] = Field(None, description="Currently selected FIRMS anomaly ID")
    center: Optional[MapCoordinates] = Field(None, description="Current map view center coordinates")
    zoom: Optional[int] = Field(None, ge=1, le=22, description="Current map zoom level (1-22)")
    bounds: Optional[MapBounds] = Field(None, description="Current visible viewport bounding box")
    visible_observation_ids: List[str] = Field(default_factory=list, description="IDs of anomalies currently inside viewport")

    @field_validator("selected_observation_id")
    @classmethod
    def validate_selected_id(cls, v: Optional[str]) -> Optional[str]:
        return validate_obs_id(v)

    @field_validator("visible_observation_ids")
    @classmethod
    def validate_visible_ids(cls, v: List[str]) -> List[str]:
        cleaned: List[str] = []
        for item in v:
            val = validate_obs_id(item)
            if val:
                cleaned.append(val)
        return cleaned


# ==============================================================================
# Phase 2 Structured Map Actions (Discriminated Union)
# ==============================================================================

class ZoomToAnomalyAction(BaseModel):
    type: Literal["ZOOM_TO_ANOMALY"] = "ZOOM_TO_ANOMALY"
    observation_id: str = Field(..., description="The FIRMS observation ID to zoom to")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude coordinate [-90.0, 90.0]")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude coordinate [-180.0, 180.0]")
    zoom: int = Field(14, ge=1, le=22, description="Target map zoom level (1-22)")

    @field_validator("observation_id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        res = validate_obs_id(v)
        if not res:
            raise ValueError("observation_id cannot be empty")
        return res


class FilterAnomaliesAction(BaseModel):
    type: Literal["FILTER_ANOMALIES"] = "FILTER_ANOMALIES"
    priority_index: Optional[List[Literal["P1", "P2", "P3", "P4"]]] = Field(
        None, description="Optional priority level filters (P1, P2, P3, P4)"
    )
    classification: Optional[Literal["WILDFIRE", "INDUSTRIAL_FIRE", "NON_FIRE"]] = Field(
        None, description="Optional CNN classification filter"
    )

    @field_validator("priority_index")
    @classmethod
    def validate_priorities(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            valid_p = {"P1", "P2", "P3", "P4"}
            for item in v:
                if item not in valid_p:
                    raise ValueError(f"Invalid priority '{item}'. Permitted priorities: {sorted(list(valid_p))}")
        return v


class HighlightAnomaliesAction(BaseModel):
    type: Literal["HIGHLIGHT_ANOMALIES"] = "HIGHLIGHT_ANOMALIES"
    observation_ids: List[str] = Field(..., min_length=1, description="List of observation IDs to visually highlight on the map")

    @field_validator("observation_ids")
    @classmethod
    def validate_ids(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("observation_ids cannot be empty")
        cleaned: List[str] = []
        for item in v:
            val = validate_obs_id(item)
            if not val:
                raise ValueError("observation_ids contains empty or invalid ID")
            cleaned.append(val)
        return cleaned


# Strict discriminated union for all supported map actions
MapAction = Annotated[
    Union[ZoomToAnomalyAction, FilterAnomaliesAction, HighlightAnomaliesAction],
    Field(discriminator="type")
]

_map_action_adapter = TypeAdapter(MapAction)


def parse_map_action(raw: Any) -> Optional[MapAction]:
    """Safely validate and parse raw action object into MapAction or return None."""
    if not raw or not isinstance(raw, dict):
        return None
    action_type = raw.get("type") or raw.get("action_type")
    if not action_type:
        return None

    if "parameters" in raw and isinstance(raw["parameters"], dict):
        normalized = {"type": action_type, **raw["parameters"]}
    else:
        normalized = dict(raw)
        if "action_type" in normalized and "type" not in normalized:
            normalized["type"] = normalized["action_type"]

    try:
        return _map_action_adapter.validate_python(normalized)
    except Exception:
        return None


# Legacy structured action schema retained for backward compatibility
class AgentStructuredAction(BaseModel):
    action_type: str = Field(..., description="Structured action type (ZOOM_TO_ANOMALY, FILTER_ANOMALIES, HIGHLIGHT_ANOMALIES)")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Action-specific parameters")


class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="User query or operator question")
    session_id: Optional[str] = Field(None, max_length=64, description="Optional conversation session identifier")
    map_context: Optional[MapContext] = Field(None, description="Real-time map viewport and selection context")


class AgentChatResponse(BaseModel):
    reply: str = Field(..., description="Grounded natural language response generated by the agent")
    tools_used: List[str] = Field(default_factory=list, description="List of backend tools executed to answer this query")
    evidence_sources: List[str] = Field(default_factory=list, description="Data provenance sources cited")
    action: Optional[MapAction] = Field(None, description="Validated structured map action (Phase 2)")
    disclaimers: List[str] = Field(default_factory=list, description="Applicable scientific and operational disclaimers")
    session_id: Optional[str] = Field(None, description="Conversation session ID")


class AgentCapabilitiesResponse(BaseModel):
    status: str = Field("READY", description="Agent service operational status")
    provider: str = Field("gemini", description="Configured LLM provider name")
    model_configured: bool = Field(False, description="Whether LLM credentials are validly configured")
    tools_available: List[str] = Field(default_factory=list, description="Catalog of available read-only agent tools")
    supported_cnn_classes: List[str] = Field(default_factory=list, description="Permitted CNN classification labels")
    supported_actions: List[str] = Field(
        default_factory=lambda: ["ZOOM_TO_ANOMALY", "FILTER_ANOMALIES", "HIGHLIGHT_ANOMALIES"],
        description="Permitted structured map actions"
    )
    disclaimers: List[str] = Field(default_factory=list, description="Mandatory project disclaimers")
