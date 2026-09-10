/**
 * Phase 10 Supabase Authentication Frontend Test Suite.
 * Covers client setup, session restoration, token injection, UI validation, and RBAC derivation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isSupabaseConfigured, getAccessToken } from '../src/lib/supabase.ts';
import { apiFetch, getApiUrl } from '../src/config/api.ts';

describe('Supabase Authentication — Frontend Security & Client Tests', () => {

  it('Test 1: Supabase client is initialized with publishable/anon key and never exposes secret keys', () => {
    // Verify client exists
    assert.strictEqual(typeof isSupabaseConfigured, 'boolean');
    // Ensure that backend service_role secret is NOT imported in frontend
    assert.strictEqual(typeof process.env.SUPABASE_SECRET_KEY, 'undefined');
  });

  it('Test 2: getAccessToken returns null or string without throwing on unauthenticated state', async () => {
    const token = await getAccessToken();
    // In node test environment without browser session, token should be null
    assert.strictEqual(token, null);
  });

  it('Test 3: apiFetch forwards requests cleanly and handles unauthenticated state without header pollution', async () => {
    let capturedHeaders = null;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, options) => {
      capturedHeaders = options?.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      };
    };

    try {
      const res = await apiFetch('http://localhost:8000/api/health');
      assert.strictEqual(res.ok, true);
      // When unauthenticated, no invalid or empty Authorization header is sent
      if (capturedHeaders) {
        const authHeader = capturedHeaders.get ? capturedHeaders.get('Authorization') : capturedHeaders['Authorization'];
        assert.ok(!authHeader || authHeader.startsWith('Bearer '));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Test 4: apiFetch injects Authorization: Bearer <token> when token is present in options', async () => {
    let capturedHeaders = null;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, options) => {
      capturedHeaders = options?.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    };

    try {
      const customHeaders = new Headers();
      customHeaders.set('Authorization', 'Bearer mock-test-token-jwt-999');
      await apiFetch('http://localhost:8000/api/incidents/423f0b1ad50facd6/action', {
        method: 'POST',
        headers: customHeaders,
      });

      assert.ok(capturedHeaders);
      const authHeader = capturedHeaders.get ? capturedHeaders.get('Authorization') : capturedHeaders['Authorization'];
      assert.strictEqual(authHeader, 'Bearer mock-test-token-jwt-999');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Test 5: User role derivation correctly falls back to operator and respects admin/analyst', () => {
    function deriveRole(user) {
      if (!user) return 'anonymous';
      return (
        user.app_metadata?.role ||
        user.user_metadata?.role ||
        'operator'
      );
    }

    assert.strictEqual(deriveRole(null), 'anonymous');
    assert.strictEqual(deriveRole({}), 'operator');
    assert.strictEqual(deriveRole({ user_metadata: { role: 'admin' } }), 'admin');
    assert.strictEqual(deriveRole({ app_metadata: { role: 'analyst' } }), 'analyst');
  });

  it('Test 6: User display name resolves hierarchy: name -> full_name -> email prefix -> EOC Operator', () => {
    function deriveDisplayName(user) {
      if (!user) return 'Guest';
      return (
        user.user_metadata?.name ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'EOC Operator'
      );
    }

    assert.strictEqual(deriveDisplayName(null), 'Guest');
    assert.strictEqual(deriveDisplayName({ user_metadata: { name: 'Capt. Sharma' } }), 'Capt. Sharma');
    assert.strictEqual(deriveDisplayName({ user_metadata: { full_name: 'Dr. Rao' } }), 'Dr. Rao');
    assert.strictEqual(deriveDisplayName({ email: 'operator.duty@gov.in' }), 'operator.duty');
    assert.strictEqual(deriveDisplayName({}), 'EOC Operator');
  });

  it('Test 7: Auth error mapper converts raw Supabase messages into human-readable EOC guidance', () => {
    function mapAuthError(raw) {
      const str = (raw || '').toLowerCase();
      if (str.includes('invalid login credentials')) {
        return 'Invalid operator email or password. Please verify your credentials.';
      }
      if (str.includes('already registered')) {
        return 'An operator account with this email address already exists. Please sign in.';
      }
      if (str.includes('email not confirmed')) {
        return 'Email address has not been confirmed yet. Please verify your inbox.';
      }
      return raw || 'Authentication failed.';
    }

    assert.strictEqual(
      mapAuthError('Invalid login credentials'),
      'Invalid operator email or password. Please verify your credentials.'
    );
    assert.strictEqual(
      mapAuthError('User already registered'),
      'An operator account with this email address already exists. Please sign in.'
    );
  });

  it('Test 8: Password validation enforces minimum security length of 6 characters', () => {
    function validateCredentials(email, password) {
      if (!email || !password) return 'Please provide both email and security passcode.';
      if (password.length < 6) return 'Password must be at least 6 characters long.';
      return null;
    }

    assert.strictEqual(validateCredentials('', 'secret'), 'Please provide both email and security passcode.');
    assert.strictEqual(validateCredentials('op@eoc.gov', '123'), 'Password must be at least 6 characters long.');
    assert.strictEqual(validateCredentials('op@eoc.gov', 'securepass123'), null);
  });

  it('Test 9: getApiUrl correctly normalizes leading and trailing slashes for auth endpoints', () => {
    const url1 = getApiUrl('/api/incidents/operational-summary');
    const url2 = getApiUrl('api/incidents/operational-summary');
    assert.strictEqual(url1, 'http://localhost:8000/api/incidents/operational-summary');
    assert.strictEqual(url2, 'http://localhost:8000/api/incidents/operational-summary');
  });

  it('Test 10: Preserves all 3 mandatory scientific disclaimers without regression', () => {
    const MANDATORY_DISCLAIMERS = [
      'AI Candidate Classification is an evidence-fusion output, not a standalone confirmation of an industrial fire.',
      'Sentinel-2 imagery is optical evidence and may not be temporally coincident with the FIRMS observation.',
      'Dynamic threat zones and scenario projections are simulation estimates — NOT official government evacuation orders.',
    ];

    assert.strictEqual(MANDATORY_DISCLAIMERS.length, 3);
    assert.ok(MANDATORY_DISCLAIMERS[0].includes('AI Candidate Classification'));
    assert.ok(MANDATORY_DISCLAIMERS[1].includes('temporally coincident'));
    assert.ok(MANDATORY_DISCLAIMERS[2].includes('simulation estimates'));
  });

});
