"""
Anomaly Intelligence Agent Module (Phase 1).
Provides conversational AI reasoning over multi-modal satellite, thermal, OSM, and decision support evidence.
"""

from app.agent.service import get_agent_service, AnomalyIntelligenceAgent
from app.agent.router import router as agent_router

__all__ = ["get_agent_service", "AnomalyIntelligenceAgent", "agent_router"]
