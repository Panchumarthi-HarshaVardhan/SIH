import time
import logging
from typing import Optional, Dict, Any
import httpx

import app.config as config

logger = logging.getLogger("satellite_auth")
logging.getLogger("httpx").setLevel(logging.WARNING)

CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"


class SatelliteAuthService:
    """
    Singleton service managing OAuth2 Client Credentials authentication
    for the Copernicus Data Space Ecosystem (CDSE) / Sentinel Hub APIs.
    
    Guarantees:
    - Automatically caches access token until near expiration.
    - Never logs client secrets or access tokens.
    - Handles connectivity/authentication errors gracefully.
    """

    def __init__(self):
        self._cached_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def is_configured(self) -> bool:
        """Check if Copernicus credentials are provided in environment."""
        return bool(config.COPERNICUS_CLIENT_ID and config.COPERNICUS_CLIENT_SECRET)

    async def get_access_token(self, client: Optional[httpx.AsyncClient] = None) -> Optional[str]:
        """
        Retrieve valid OAuth2 Bearer access token.
        Returns cached token if still valid; otherwise requests a new token.
        """
        if not self.is_configured():
            logger.info("Copernicus credentials unconfigured; satellite access token unavailable.")
            return None

        # Return cached token if valid (with 60s safety buffer)
        now = time.time()
        if self._cached_token and now < (self._token_expires_at - 60):
            return self._cached_token

        # Acquire new token
        payload = {
            "client_id": config.COPERNICUS_CLIENT_ID,
            "client_secret": config.COPERNICUS_CLIENT_SECRET,
            "grant_type": "client_credentials"
        }

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=4.0)
            should_close = True

        try:
            resp = await client.post(CDSE_TOKEN_URL, data=payload)
            if resp.status_code == 200:
                data = resp.json()
                token = data.get("access_token")
                expires_in = int(data.get("expires_in", 600))
                if token:
                    self._cached_token = token
                    self._token_expires_at = time.time() + expires_in
                    logger.info("Successfully acquired and cached Copernicus CDSE OAuth2 access token.")
                    return token
            elif resp.status_code in (400, 401, 403):
                logger.warning(f"Copernicus authentication rejected with HTTP {resp.status_code}.")
                self.clear_cached_token()
                return None
            else:
                logger.warning(f"Copernicus token endpoint returned HTTP {resp.status_code}.")
                return None
        except Exception as ex:
            logger.error(f"Error connecting to Copernicus authentication endpoint: {type(ex).__name__}")
            return None
        finally:
            if should_close:
                await client.aclose()

        return None

    def clear_cached_token(self) -> None:
        """Clear cached OAuth2 token to force refresh on next call."""
        self._cached_token = None
        self._token_expires_at = 0.0

    async def check_auth_connectivity(self, timeout_seconds: float = 5.0) -> Dict[str, Any]:
        """
        Perform isolated, timeout-protected connectivity check to Copernicus Auth endpoint.
        Never exposes client credentials or token values.
        """
        if not self.is_configured():
            return {
                "status": "NOT_CONFIGURED",
                "configured": False,
                "provider": "Copernicus Sentinel Hub",
                "latency_ms": None,
                "error_category": None
            }

        start_time = time.time()
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                token = await self.get_access_token(client=client)
                elapsed_ms = round((time.time() - start_time) * 1000, 2)
                if token:
                    return {
                        "status": "CONNECTED",
                        "configured": True,
                        "provider": "Copernicus Sentinel Hub",
                        "latency_ms": elapsed_ms,
                        "error_category": None
                    }
                else:
                    return {
                        "status": "UNAVAILABLE",
                        "configured": True,
                        "provider": "Copernicus Sentinel Hub",
                        "latency_ms": elapsed_ms,
                        "error_category": "auth_rejected"
                    }
        except Exception as ex:
            elapsed_ms = round((time.time() - start_time) * 1000, 2)
            return {
                "status": "ERROR",
                "configured": True,
                "provider": "Copernicus Sentinel Hub",
                "latency_ms": elapsed_ms,
                "error_category": type(ex).__name__
            }


# Singleton instance
_auth_service: Optional[SatelliteAuthService] = None


def get_satellite_auth_service() -> SatelliteAuthService:
    """Factory function returning the singleton SatelliteAuthService instance."""
    global _auth_service
    if _auth_service is None:
        _auth_service = SatelliteAuthService()
    return _auth_service
