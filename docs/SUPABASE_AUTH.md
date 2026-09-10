# Supabase Authentication Architecture & Security Guide (SIH 26162)

## 1. Executive Summary

This document details the **Supabase Authentication and Role-Based Access Control (RBAC)** implementation for the **SIH 26162 Industrial Fire & Thermal Anomaly Intelligence Platform**.

Authentication is integrated as a non-invasive, hardened security perimeter surrounding the existing React 18 / Vite frontend and FastAPI backend without modifying or disrupting the underlying NASA FIRMS ingestion, Copernicus Sentinel-1/Sentinel-2 pipelines, PyTorch 6-band CNN classifiers, or decision-support algorithms.

---

## 2. Security Guarantees & Zero-Secret Architecture

### A. Frontend Secret Isolation
- The frontend web application is strictly configured with the **public / publishable anon key** (`VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY`).
- Under no circumstances is the `SUPABASE_SECRET_KEY` or service-role token bundled into the client build or accessible in the browser.
- Git configuration explicitly ignores `.env` files to prevent accidental credential leakage.

### B. Dual Asymmetric & Symmetric JWT Verification
- The backend verifies incoming Bearer JWT tokens using two resilient mechanisms:
  1. **Asymmetric JWKS Validation:** Dynamically queries and caches public keys from `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` for tokens signed with RS256/ES256.
  2. **HMAC-SHA256 Fallback:** Securely validates tokens signed with HS256 against `SUPABASE_JWT_SECRET` / `SUPABASE_SECRET_KEY`.
- Validates token expiration (`exp`), subject claim presence (`sub`), and prevents token spoofing.

### C. Immutable Audit Attribution
- Every operator triage action recorded via `POST /api/incidents/{observation_id}/action` or `/api/alerts/{id}/*` automatically binds the actor ID to the verified operator identity (`current_user.email` or `current_user.user_id`) extracted directly from the cryptographically verified JWT, preventing spoofed operator logs.

---

## 3. Frontend Architecture

### File Layout
```
frontend/src/
├── lib/
│   └── supabase.ts              # Supabase client (persisted sessions, auto-refresh)
├── auth/
│   ├── AuthContext.tsx          # Session provider & state management
│   ├── useAuth.ts               # Custom React hook for consuming auth
│   └── index.ts                 # Clean module exports
├── components/auth/
│   ├── AuthModal.tsx            # EOC-themed dark charcoal & green login/register modal
│   └── AuthGate.tsx             # Terminal barrier guarding operational dashboard
├── components/
│   └── TopBar.tsx               # Header with operator badge, role chip, and sign out
└── config/
    └── api.ts                   # Centralized apiFetch with dynamic Bearer token injection
```

### Authentication State Flow
1. **Application Mount:** `AuthProvider` queries `supabase.auth.getSession()` and initializes an active session listener via `supabase.auth.onAuthStateChange()`.
2. **Zero-Flicker Guard:** `AuthGate` displays a terminal radar loading state while verifying credentials, preventing flash-of-unauthenticated-content (FOUC).
3. **Session Active:** If valid, the operator is seamlessly admitted into the EOC operational dashboard, with their operator display name and role badge displayed in `TopBar.tsx`.
4. **Token Injection:** All operational fetch requests made through `apiFetch()` automatically extract the fresh JWT via `getAccessToken()` and inject `Authorization: Bearer <access_token>`.
5. **Sign Out:** Operator clicks `Sign Out` in `TopBar`, triggering `supabase.auth.signOut()`, flushing cached session storage, and returning to the secure `AuthModal`.

---

## 4. Backend Architecture

### File Layout
```
backend/app/auth/
├── __init__.py                  # Exported authentication symbols
├── schemas.py                   # AuthenticatedUser Pydantic data model
├── jwt.py                       # JWKS client & HS256 cryptographic verification
└── dependencies.py              # FastAPI dependencies (get_current_user, require_role)
```

### Route Protection Matrix

| Route | Method | Access Level | Description |
|---|---|---|---|
| `/` | GET | **Public** | Sanity root check |
| `/api/health` | GET | **Public** | Unified health & readiness status |
| `/api/system/readiness` | GET | **Public** | Subsystem diagnostic engine |
| `/api/system/status` | GET | **Public** | Environment probe report |
| `/api/firms/*` | GET | **Public** | FIRMS thermal detections for map viewport |
| `/api/hotspots/*` | GET | **Public** | Spatial cluster telemetry |
| `/api/agent/capabilities` | GET | **Public** | Agent manifest & tool catalog |
| `/api/agent/chat` | POST | **Authenticated** | Multi-source LLM intelligence agent |
| `/api/firms/{id}/investigation` | GET | **Authenticated** | 6-source optical & radiometric synthesis |
| `/api/firms/{id}/decision-support` | GET | **Authenticated** | Prioritization, threat zones & projections |
| `/api/incidents/{id}/action` | POST | **Authenticated** | Incident triage (ACKNOWLEDGE, DISPATCH, etc.) |
| `/api/incidents/{id}/audit-trail` | GET | **Authenticated** | Chronological lifecycle history |
| `/api/incidents/operational-summary` | GET | **Authenticated** | Fleet triage counts and metrics |
| `/api/alerts/{id}/*` | POST | **Authenticated** | Alert acknowledge, investigate, resolve, dismiss |

---

## 5. Verification & Testing Guide

### Running Backend Tests
```bash
cd backend
PYTHONPATH=. ../.venv/bin/pytest tests/test_auth.py -v
```
**Coverage:**
- Valid JWT decoding and claim extraction.
- Rejection of expired tokens (HTTP 401).
- Rejection of forged or invalid signatures (HTTP 401).
- Enforcement of authentication on protected routes (`/api/agent/chat`, `/api/firms/{id}/investigation`, `/api/incidents/{id}/action`).
- Accessibility of public operational and health probes (`/api/health`, `/api/system/readiness`).
- Immutable actor stamping on incident actions.
- Role-based authorization (`require_role("admin")`).

### Running Frontend Tests
```bash
cd frontend
npm test
```
**Coverage:**
- Supabase client initialization using publishable key.
- Safe unauthenticated state handling in `getAccessToken()`.
- Bearer token header injection in `apiFetch()`.
- User display name and role resolution hierarchy.
- User-friendly error message mapping (no raw Supabase codes).
- Password strength validation.
- Preservation of mandatory scientific disclaimers.

### Building Frontend
```bash
cd frontend
npm run build
```
Ensures complete TypeScript type checking and asset bundling.
