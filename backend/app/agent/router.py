"""
Anomaly Intelligence Agent FastAPI Router.
Provides REST endpoints for conversational chat and capability discovery.
Mounted under /api/agent.
"""

import logging
from fastapi import APIRouter, HTTPException, Depends, status

from app.agent.schemas import (
    AgentChatRequest,
    AgentChatResponse,
    AgentCapabilitiesResponse,
)
from app.agent.service import AnomalyIntelligenceAgent, get_agent_service
from app.auth import get_current_user, AuthenticatedUser

logger = logging.getLogger("agent_router")

router = APIRouter()


@router.post(
    "/chat",
    response_model=AgentChatResponse,
    summary="Agentic Natural Language Investigation",
    description=(
        "Processes operator questions regarding satellite thermal anomalies, "
        "evidence fusion, industrial context, and tactical risk within the given map context."
    ),
)
async def agent_chat(
    request: AgentChatRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    agent: AnomalyIntelligenceAgent = Depends(get_agent_service),
) -> AgentChatResponse:
    """
    Executes an agentic tool-use loop to answer operational fire intelligence questions.
    Tools are strictly read-only and directly grounded in real NASA FIRMS, OSM,
    Copernicus, and ML subsystem evidence.
    """
    try:
        response = await agent.chat(request)
        return response
    except ValueError as ve:
        logger.warning(f"Validation error in agent chat request: {ve}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(ve),
        )
    except Exception as ex:
        logger.error(f"Internal error during agent chat execution: {ex}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agent service encountered an unexpected error: {str(ex)}",
        )


@router.get(
    "/capabilities",
    response_model=AgentCapabilitiesResponse,
    summary="Agent Capability Discovery & Operational Readiness",
    description="Returns available agent tools, LLM provider readiness, CNN constraints, and mandatory disclaimers.",
)
def agent_capabilities(
    agent: AnomalyIntelligenceAgent = Depends(get_agent_service),
) -> AgentCapabilitiesResponse:
    """
    Returns runtime agent capabilities, tool catalog, and model configuration status.
    """
    try:
        return agent.get_capabilities()
    except Exception as ex:
        logger.error(f"Error retrieving agent capabilities: {ex}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to retrieve agent capabilities: {str(ex)}",
        )
