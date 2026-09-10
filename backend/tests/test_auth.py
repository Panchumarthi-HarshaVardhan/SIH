"""
SIH 26162 Backend Supabase Authentication & JWT Security Test Suite.
Verifies token verification, expiry handling, route protection, RBAC, and incident audit actor attribution.
"""

import time
import pytest
import jwt
from fastapi import FastAPI, Depends, status
from fastapi.testclient import TestClient

from app.auth.schemas import AuthenticatedUser
from app.auth.jwt import verify_supabase_jwt
from app.auth.dependencies import get_current_user, get_optional_user, require_role
from app.config import SUPABASE_SECRET_KEY, SUPABASE_JWT_SECRET
from app.main import app as main_app

TEST_SECRET = SUPABASE_JWT_SECRET or SUPABASE_SECRET_KEY or "test-secret-key-for-sih-26162-auth-development"


def create_test_jwt(
    sub: str = "test-operator-uuid-1234",
    email: str = "operator@eoc.sih26162.gov",
    role: str = "operator",
    exp_delta: int = 3600,
    secret: str = TEST_SECRET,
    alg: str = "HS256",
    extra_claims: dict = None
) -> str:
    """Helper to construct signed JWTs for testing."""
    now = int(time.time())
    payload = {
        "sub": sub,
        "email": email,
        "aud": "authenticated",
        "iss": "https://agxtdttgjdtduyxeijcv.supabase.co/auth/v1",
        "iat": now,
        "exp": now + exp_delta,
        "app_metadata": {"role": role, "provider": "email"},
        "user_metadata": {"name": "Test Tactical Operator"},
        "role": role,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, secret, algorithm=alg)


@pytest.fixture
def client():
    return TestClient(main_app)


class TestSupabaseAuthBackend:
    """Comprehensive test suite for Supabase JWT authentication."""

    def test_1_valid_jwt_succeeds_and_extracts_identity(self):
        """Test 1: Valid JWT verifies correctly and extracts user_id, email, and role."""
        token = create_test_jwt(sub="user-42", email="officer@eoc.gov", role="operator")
        claims = verify_supabase_jwt(token)
        user = AuthenticatedUser.from_jwt_claims(claims, raw_token=token)

        assert user.user_id == "user-42"
        assert user.email == "officer@eoc.gov"
        assert user.role == "operator"

    def test_2_expired_jwt_rejected_with_401(self):
        """Test 2: Expired JWT is strictly rejected with 401."""
        expired_token = create_test_jwt(exp_delta=-100)
        with pytest.raises(Exception) as excinfo:
            verify_supabase_jwt(expired_token)
        assert "expired" in str(excinfo.value).lower()

    def test_3_tampered_signature_rejected_with_401(self):
        """Test 3: Token with invalid/tampered signature is rejected."""
        invalid_token = create_test_jwt(secret="wrong-secret-key-xyz")
        with pytest.raises(Exception) as excinfo:
            verify_supabase_jwt(invalid_token)
        assert "invalid" in str(excinfo.value).lower() or "signature" in str(excinfo.value).lower()

    def test_4_missing_token_on_protected_chat_returns_401(self, client):
        """Test 4: POST /api/agent/chat rejects unauthenticated requests with 401."""
        res = client.post("/api/agent/chat", json={"message": "Analyze hotspot", "map_context": {}})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert "WWW-Authenticate" in res.headers

    def test_5_missing_token_on_investigation_returns_401(self, client):
        """Test 5: GET /api/firms/{id}/investigation rejects unauthenticated requests with 401."""
        res = client.get("/api/firms/423f0b1ad50facd6/investigation")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_6_missing_token_on_incident_action_returns_401(self, client):
        """Test 6: POST /api/incidents/{id}/action rejects unauthenticated requests with 401."""
        res = client.post(
            "/api/incidents/423f0b1ad50facd6/action",
            json={"action": "ACKNOWLEDGE", "notes": "Test triage"}
        )
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_7_public_endpoints_remain_accessible_without_token(self, client):
        """Test 7: Autonomous probes and monitoring endpoints remain accessible without JWT."""
        res_health = client.get("/api/health")
        assert res_health.status_code == status.HTTP_200_OK

        res_readiness = client.get("/api/system/readiness")
        assert res_readiness.status_code == status.HTTP_200_OK

        res_root = client.get("/")
        assert res_root.status_code == status.HTTP_200_OK

    def test_8_incident_action_records_authenticated_actor_identity(self, client):
        """Test 8: Authenticated user ID/email is bound to incident action audit log."""
        token = create_test_jwt(sub="operator-uuid-9999", email="sarah.connor@eoc.gov")
        headers = {"Authorization": f"Bearer {token}"}

        res = client.post(
            "/api/incidents/423f0b1ad50facd6/action",
            json={"action": "ACKNOWLEDGE", "notes": "Dispatched tactical suppression"},
            headers=headers
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["success"] is True
        # Verify actor in audit_entry is the authenticated operator's email or user ID
        assert data["audit_entry"]["actor"] in ("sarah.connor@eoc.gov", "operator-uuid-9999")

    def test_9_role_based_access_control_dependency(self):
        """Test 9: require_role dependency allows permitted roles and raises 403 for unpermitted."""
        from fastapi import HTTPException
        import asyncio

        operator_user = AuthenticatedUser(user_id="u1", email="op@eoc.gov", role="operator", roles=["operator"])
        admin_user = AuthenticatedUser(user_id="u2", email="admin@eoc.gov", role="admin", roles=["admin"])

        # Dependency requiring admin
        admin_check = require_role("admin")

        # Admin user succeeds
        res_admin = asyncio.run(admin_check(current_user=admin_user))
        assert res_admin.user_id == "u2"

        # Operator user receives 403 Forbidden
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(admin_check(current_user=operator_user))
        assert excinfo.value.status_code == status.HTTP_403_FORBIDDEN

    def test_10_missing_sub_claim_rejected(self):
        """Test 10: JWT without sub claim is rejected."""
        now = int(time.time())
        token_no_sub = jwt.encode(
            {"email": "anon@eoc.gov", "iat": now, "exp": now + 3600},
            TEST_SECRET,
            algorithm="HS256"
        )
        with pytest.raises(Exception) as excinfo:
            verify_supabase_jwt(token_no_sub)
        assert "sub" in str(excinfo.value).lower()
