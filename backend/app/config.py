import os
import logging
from dotenv import load_dotenv

logger = logging.getLogger("sih_config")

# Base Directory Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) # backend/app
BACKEND_DIR = os.path.dirname(BASE_DIR)              # backend
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)           # root SIH-26162

# Explicitly load .env file from backend/.env or root .env
backend_env_path = os.path.join(BACKEND_DIR, ".env")
root_env_path = os.path.join(PROJECT_ROOT, ".env")

if os.path.exists(backend_env_path):
    load_dotenv(dotenv_path=backend_env_path, override=True)
elif os.path.exists(root_env_path):
    load_dotenv(dotenv_path=root_env_path, override=True)
else:
    load_dotenv(override=True)

# NASA FIRMS API Configuration
# Exact variable required: NASA_FIRMS_MAP_KEY
NASA_FIRMS_MAP_KEY = os.getenv("NASA_FIRMS_MAP_KEY", "").strip()

# Database Configuration (Placeholder / optional external database connection)
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

# Server & CORS Configuration
_cors_raw = os.getenv("CORS_ORIGINS") or os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000")
CORS_ORIGINS = [origin.strip() for origin in _cors_raw.split(",") if origin.strip()]

# Centralized Alert Configuration Parameters
ALERT_CRITICAL_THRESHOLD = float(os.getenv("ALERT_CRITICAL_THRESHOLD", "75.0"))
ALERT_HIGH_THRESHOLD = float(os.getenv("ALERT_HIGH_THRESHOLD", "50.0"))
ALERT_DEDUP_RADIUS_KM = float(os.getenv("ALERT_DEDUP_RADIUS_KM", "1.0"))
ALERT_COOLDOWN_HOURS = float(os.getenv("ALERT_COOLDOWN_HOURS", "12.0"))

# Persistent File Storage Paths (data/processed/)
DATA_DIR = os.path.join(PROJECT_ROOT, "data", "processed")
ALERTS_STORAGE_PATH = os.path.join(DATA_DIR, "alerts.json")
FIRMS_OBSERVATIONS_PATH = os.path.join(DATA_DIR, "firms_observations.json")
FIRMS_INGEST_STATE_PATH = os.path.join(DATA_DIR, "firms_ingestion_state.json")

# Phase 2 NASA FIRMS Ingestion Parameters
FIRMS_INGEST_INTERVAL_MINUTES = int(os.getenv("FIRMS_INGEST_INTERVAL_MINUTES", "10"))

# Phase 4 Copernicus Sentinel Hub Satellite Image Intelligence Parameters
COPERNICUS_CLIENT_ID = os.getenv("COPERNICUS_CLIENT_ID", "").strip()
COPERNICUS_CLIENT_SECRET = os.getenv("COPERNICUS_CLIENT_SECRET", "").strip()
SATELLITE_SEARCH_WINDOW_HOURS = int(os.getenv("SATELLITE_SEARCH_WINDOW_HOURS", "72"))
SATELLITE_SEARCH_BEFORE_HOURS = int(os.getenv("SATELLITE_SEARCH_BEFORE_HOURS", "120"))
SATELLITE_SEARCH_AFTER_HOURS = int(os.getenv("SATELLITE_SEARCH_AFTER_HOURS", "48"))
SATELLITE_MAX_CLOUD_COVER = float(os.getenv("SATELLITE_MAX_CLOUD_COVER", "80.0"))

# Phase 6K Sentinel-1 SAR Radar Backup Parameters
SENTINEL1_BACKUP_ENABLED = os.getenv("SENTINEL1_BACKUP_ENABLED", "true").lower() in ("true", "1", "yes")
SENTINEL1_SEARCH_BEFORE_HOURS = int(os.getenv("SENTINEL1_SEARCH_BEFORE_HOURS", "144"))
SENTINEL1_SEARCH_AFTER_HOURS = int(os.getenv("SENTINEL1_SEARCH_AFTER_HOURS", "48"))
SENTINEL1_ACQUISITION_MODE = os.getenv("SENTINEL1_ACQUISITION_MODE", "IW")
SENTINEL1_POLARIZATION = os.getenv("SENTINEL1_POLARIZATION", "DV")

# Phase 6A Satellite ML Dataset Construction Parameters
SATELLITE_DATASET_TARGET_WILDFIRE = int(os.getenv("SATELLITE_DATASET_TARGET_WILDFIRE", "400"))
SATELLITE_DATASET_TARGET_INDUSTRIAL = int(os.getenv("SATELLITE_DATASET_TARGET_INDUSTRIAL", "250"))
SATELLITE_DATASET_TARGET_NON_FIRE = int(os.getenv("SATELLITE_DATASET_TARGET_NON_FIRE", "400"))
INDUSTRIAL_CANDIDATE_RADIUS_KM = float(os.getenv("INDUSTRIAL_CANDIDATE_RADIUS_KM", "2.0"))
MIN_FIRMS_CONFIDENCE = float(os.getenv("MIN_FIRMS_CONFIDENCE", "0.5"))
MIN_FRP = float(os.getenv("MIN_FRP", "10.0"))
MAX_CLOUD_FOR_TRAINING = float(os.getenv("MAX_CLOUD_FOR_TRAINING", "60.0"))
ML_PATCH_SIZE = int(os.getenv("ML_PATCH_SIZE", "128"))
ML_PATCH_RADIUS_KM = float(os.getenv("ML_PATCH_RADIUS_KM", "1.0"))
ML_SATELLITE_DATA_DIR = os.path.join(BACKEND_DIR, "data", "ml", "satellite")
ML_MANIFEST_DIR = os.path.join(ML_SATELLITE_DATA_DIR, "manifests")
ML_SAMPLES_DIR = os.path.join(ML_SATELLITE_DATA_DIR, "samples")
ML_REPORTS_DIR = os.path.join(ML_SATELLITE_DATA_DIR, "reports")

# Phase 8 & 9 Satellite Image Parameters
SATELLITE_PROVIDER = os.getenv("SATELLITE_PROVIDER", "sentinel-2")
SATELLITE_API_KEY = os.getenv("SATELLITE_API_KEY", "")
SATELLITE_IMAGE_SIZE = int(os.getenv("SATELLITE_IMAGE_SIZE", "256"))
SATELLITE_PATCH_RADIUS_KM = float(os.getenv("SATELLITE_PATCH_RADIUS_KM", "1.0"))
SATELLITE_CACHE_DIR = os.path.join(PROJECT_ROOT, os.getenv("SATELLITE_CACHE_DIR", "data/satellite/cache"))
SATELLITE_DATASET_DIR = os.path.join(PROJECT_ROOT, os.getenv("SATELLITE_DATASET_DIR", "data/satellite"))

# Phase 9 Machine Learning Satellite Classifier Configuration
SATELLITE_CLASSIFIER = os.getenv("SATELLITE_CLASSIFIER", "trained")  # 'trained' or 'heuristic'
SATELLITE_MODEL_DIR = os.path.join(PROJECT_ROOT, os.getenv("SATELLITE_MODEL_DIR", "models/satellite_classifier"))
SATELLITE_METRICS_DIR = os.path.join(PROJECT_ROOT, os.getenv("SATELLITE_METRICS_DIR", "data/satellite/metrics"))

# Runtime Environment (development, staging, production, test)
ENVIRONMENT = os.getenv("ENVIRONMENT", os.getenv("APP_ENV", "development")).strip() or "development"

# Anomaly Intelligence Agent Configuration (Phase 1, 2, 3)
GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY", "")).strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
GROQ_API_KEY = (os.getenv("GROQ_API_KEY") or "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini" if GEMINI_API_KEY else ("groq" if GROQ_API_KEY else "gemini")).strip().lower()
AGENT_MAX_TOOL_CALLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "6"))

# Supabase Authentication Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://agxtdttgjdtduyxeijcv.supabase.co").strip().rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_PDCeB8_EbqZ_Y7kxOOROew_EjEa8omq")).strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", os.getenv("VITE_SUPABASE_ANON_KEY", SUPABASE_PUBLISHABLE_KEY)).strip()
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "").strip()
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "").strip()


def get_config_status() -> dict:
    """
    Returns a safe dictionary summarizing configuration status.
    Never exposes API keys or secret tokens.
    """
    is_configured = bool(GROQ_API_KEY) if LLM_PROVIDER == "groq" else bool(GEMINI_API_KEY)
    return {
        "nasa_firms_map_key_configured": bool(NASA_FIRMS_MAP_KEY),
        "firms_ingest_interval_minutes": FIRMS_INGEST_INTERVAL_MINUTES,
        "database_configured": bool(DATABASE_URL),
        "supabase_auth_configured": bool(SUPABASE_URL),
        "cors_origins": CORS_ORIGINS,
        "satellite_provider": SATELLITE_PROVIDER,
        "copernicus_configured": bool(COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET),
        "satellite_search_window_hours": SATELLITE_SEARCH_WINDOW_HOURS,
        "satellite_max_cloud_cover": SATELLITE_MAX_CLOUD_COVER,
        "satellite_classifier": SATELLITE_CLASSIFIER,
        "environment": ENVIRONMENT,
        "agent_llm_provider": LLM_PROVIDER,
        "agent_llm_configured": is_configured,
        "agent_max_tool_calls": AGENT_MAX_TOOL_CALLS,
    }


def log_startup_configuration(log_func=logger.info) -> None:
    """
    Logs configuration status cleanly on backend startup.
    Ensures zero secret leakage.
    """
    status = get_config_status()
    log_func("=" * 60)
    log_func("SIH 26162 Backend Environment Configuration:")
    if status["nasa_firms_map_key_configured"]:
        log_func("  [✓] NASA_FIRMS_MAP_KEY: Configured (Online MAP_KEY API query mode enabled)")
    else:
        log_func("  [!] NASA_FIRMS_MAP_KEY: Not Configured (Using public 24h CSV feeds & offline cache)")

    if status["database_configured"]:
        log_func("  [✓] DATABASE_URL: Configured")
    else:
        log_func(f"  [i] DATABASE_URL: Not Configured (Using local file persistence: {ALERTS_STORAGE_PATH})")

    log_func(f"  [i] CORS_ORIGINS: {status['cors_origins']}")
    log_func(f"  [i] SATELLITE_PROVIDER: {status['satellite_provider']}")
    log_func(f"  [i] SATELLITE_CLASSIFIER: {status['satellite_classifier']}")
    log_func("=" * 60)

