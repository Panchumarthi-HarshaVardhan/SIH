from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


class AuthenticatedUser(BaseModel):
    """
    Represents an authenticated EOC terminal user verified via Supabase JWT.
    """
    user_id: str = Field(..., description="Unique Supabase UUID (JWT 'sub')")
    email: Optional[str] = Field(None, description="Operator's official email address")
    role: str = Field("operator", description="Operational role (operator, analyst, admin, viewer)")
    app_metadata: Dict[str, Any] = Field(default_factory=dict, description="Supabase application metadata")
    user_metadata: Dict[str, Any] = Field(default_factory=dict, description="Supabase user custom metadata")
    roles: List[str] = Field(default_factory=list, description="All assigned role strings")
    raw_token: Optional[str] = Field(None, description="Raw Bearer JWT token string", exclude=True)

    @classmethod
    def from_jwt_claims(cls, claims: Dict[str, Any], raw_token: Optional[str] = None) -> "AuthenticatedUser":
        """
        Constructs an AuthenticatedUser instance from decoded JWT claims.
        """
        user_id = str(claims.get("sub", ""))
        email = claims.get("email")

        app_meta = claims.get("app_metadata", {}) or {}
        user_meta = claims.get("user_metadata", {}) or {}

        # 1. Server-authoritative roles (app_metadata cannot be modified by browser client)
        server_roles: List[str] = []
        if isinstance(app_meta.get("roles"), list):
            server_roles.extend(app_meta.get("roles"))
        if app_meta.get("role"):
            server_roles.append(str(app_meta.get("role")))
        if claims.get("role") and claims.get("role") != "authenticated":
            server_roles.append(str(claims.get("role")))

        cleaned_server_roles = [str(r).lower() for r in server_roles if r]

        # 2. Client-provided metadata is untrusted and cannot grant admin privileges
        untrusted_client_role = str(user_meta.get("role") or user_meta.get("requested_role") or "").lower()

        # Determine effective primary role (admin strictly requires server app_metadata)
        if any(r in ("admin", "commander", "incident_commander") for r in cleaned_server_roles):
            primary_role = "admin"
        elif any(r in ("analyst", "senior_analyst", "remote_sensing") for r in cleaned_server_roles):
            primary_role = "analyst"
        elif untrusted_client_role in ("analyst", "viewer", "operator"):
            primary_role = untrusted_client_role
        else:
            primary_role = "operator"

        effective_roles = list(set(cleaned_server_roles + [primary_role]))

        return cls(
            user_id=user_id,
            email=email,
            role=primary_role,
            app_metadata=app_meta,
            user_metadata=user_meta,
            roles=effective_roles,
            raw_token=raw_token
        )
