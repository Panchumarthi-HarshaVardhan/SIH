from typing import Optional, List, Callable
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.auth.schemas import AuthenticatedUser
from app.auth.jwt import verify_supabase_jwt

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> AuthenticatedUser:
    """
    FastAPI dependency that extracts and validates the Supabase Bearer JWT.
    Raises HTTP 401 if missing, invalid, or expired.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided. Bearer token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = verify_supabase_jwt(credentials.credentials)
    return AuthenticatedUser.from_jwt_claims(claims, raw_token=credentials.credentials)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[AuthenticatedUser]:
    """
    FastAPI dependency for optional authentication.
    Returns AuthenticatedUser if valid token is provided, otherwise None.
    """
    if credentials is None or not credentials.credentials:
        return None

    try:
        claims = verify_supabase_jwt(credentials.credentials)
        return AuthenticatedUser.from_jwt_claims(claims, raw_token=credentials.credentials)
    except HTTPException:
        return None


def require_role(*allowed_roles: str) -> Callable:
    """
    Role-Based Access Control (RBAC) dependency factory.
    Example: Depends(require_role("operator", "admin"))
    """
    normalized_allowed = [r.lower() for r in allowed_roles]

    async def role_checker(
        current_user: AuthenticatedUser = Depends(get_current_user)
    ) -> AuthenticatedUser:
        user_roles = [r.lower() for r in current_user.roles]
        if current_user.role.lower() not in user_roles:
            user_roles.append(current_user.role.lower())

        # Admins always have access
        if "admin" in user_roles:
            return current_user

        has_permission = any(role in normalized_allowed for role in user_roles)
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Requires one of roles: {', '.join(allowed_roles)}. Current role: {current_user.role}",
            )
        return current_user

    return role_checker
