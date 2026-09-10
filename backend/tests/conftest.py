"""
Pytest configuration for SIH 26162 backend test suites.
Configures automatic auth dependency override for functional tests while preserving
strict un-mocked JWT verification for test_auth.py.
"""

import pytest
from app.main import app
from app.auth import get_current_user, AuthenticatedUser


@pytest.fixture(autouse=True)
def setup_test_auth(request):
    """
    For tests outside of test_auth.py, provide an authenticated test operator context
    so that functional phase 6 pipelines (investigation, decision support, incident audit)
    execute successfully.
    For test_auth.py, strictly do NOT override so that raw JWT validation is verified.
    """
    test_file_name = request.node.fspath.basename
    if "test_auth" in test_file_name:
        # Strictly ensure no dependency overrides are active for auth tests
        app.dependency_overrides.pop(get_current_user, None)
        yield
        app.dependency_overrides.pop(get_current_user, None)
    else:
        # Provide authenticated operator for functional test suites
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
            user_id="test-operator-uuid-phase6",
            email="operator@eoc.sih26162.gov",
            role="operator",
            roles=["operator", "authenticated"]
        )
        yield
        app.dependency_overrides.pop(get_current_user, None)
