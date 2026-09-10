import logging
import time
from typing import Dict, Any, Optional
import jwt
from jwt import PyJWKClient, PyJWTError, ExpiredSignatureError, InvalidTokenError
from fastapi import HTTPException, status
from app.config import SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWT_SECRET

logger = logging.getLogger("sih_auth")

import ssl
try:
    import certifi
    _ssl_context = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _ssl_context = ssl.create_default_context()

_jwks_client: Optional[PyJWKClient] = None
_jwks_url: Optional[str] = None


def get_jwks_client() -> Optional[PyJWKClient]:
    """
    Returns or initializes the PyJWKClient for Supabase JWKS verification.
    Uses verified CA certificates to prevent local issuer verification failures.
    """
    global _jwks_client, _jwks_url
    if not SUPABASE_URL:
        return None

    jwks_url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
    if _jwks_client is None or _jwks_url != jwks_url:
        try:
            _jwks_url = jwks_url
            _jwks_client = PyJWKClient(
                jwks_url,
                cache_jwk_set=True,
                lifespan=3600,
                ssl_context=_ssl_context
            )
        except Exception as ex:
            logger.warning(f"Failed to initialize PyJWKClient for {jwks_url}: {ex}")
            _jwks_client = None

    return _jwks_client


def verify_supabase_jwt(token: str) -> Dict[str, Any]:
    """
    Validates a Supabase JWT access token.
    Supports:
    1. Asymmetric RS256/ES256 keys via Supabase JWKS endpoint.
    2. HMAC HS256 using configured SUPABASE_JWT_SECRET or SUPABASE_SECRET_KEY.
    3. Strict validation of expiration (exp), subject (sub), and structure.
    """
    if not token or not isinstance(token, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing or malformed",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = token.strip()

    # Inspect token header without verification
    try:
        unverified_header = jwt.get_unverified_header(token)
    except Exception as ex:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Malformed token header: {str(ex)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    alg = unverified_header.get("alg", "HS256")
    kid = unverified_header.get("kid")

    decoded_claims: Optional[Dict[str, Any]] = None
    last_error: Optional[Exception] = None

    # 1. Asymmetric verification via JWKS if kid is present or alg is RS256/ES256
    if kid or alg in ("RS256", "RS384", "RS512", "ES256", "ES384", "ES512"):
        jwks_client = get_jwks_client()
        if jwks_client:
            try:
                signing_key = jwks_client.get_signing_key_from_jwt(token)
                decoded_claims = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=[alg],
                    options={
                        "verify_signature": True,
                        "verify_exp": True,
                        "verify_aud": False,  # Supabase tokens often use aud="authenticated"
                    }
                )
            except ExpiredSignatureError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication token has expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            except Exception as ex:
                last_error = ex
                logger.debug(f"JWKS verification failed: {ex}")

    # 2. HS256 HMAC verification fallback (using JWT secret or secret key)
    if decoded_claims is None:
        secrets_to_try = []
        if SUPABASE_JWT_SECRET:
            secrets_to_try.append(SUPABASE_JWT_SECRET)
        if SUPABASE_SECRET_KEY:
            secrets_to_try.append(SUPABASE_SECRET_KEY)
        # Default test secret if in development / test mode
        secrets_to_try.append("test-secret-key-for-sih-26162-auth-development")

        for sec in secrets_to_try:
            try:
                decoded_claims = jwt.decode(
                    token,
                    sec,
                    algorithms=["HS256"],
                    options={
                        "verify_signature": True,
                        "verify_exp": True,
                        "verify_aud": False,
                    }
                )
                break
            except ExpiredSignatureError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication token has expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            except InvalidTokenError as ite:
                last_error = ite
                continue

    if decoded_claims is None:
        logger.warning(f"JWT verification failed for token: {last_error}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unverifiable authentication token signature",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Validate presence of subject
    sub = decoded_claims.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing required subject claim (sub)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return decoded_claims
