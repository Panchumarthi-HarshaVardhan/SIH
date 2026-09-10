import os
import csv
import io
import time
import logging
import asyncio
import json
from typing import List, Dict, Any, Optional, Tuple
import httpx

from app.config import NASA_FIRMS_MAP_KEY

logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# Predefined geographical bounding boxes: [min_lon, min_lat, max_lon, max_lat]
REGION_BOUNDS = {
    "india": [68.0, 6.5, 97.5, 37.0],
    "andhra_pradesh": [76.5, 12.5, 84.8, 19.5],
}

# Official NASA FIRMS public 24h CSV feeds for South Asia
PUBLIC_FIRMS_FEEDS = [
    {
        "url": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_24h.csv",
        "instrument": "VIIRS",
        "default_satellite": "Suomi-NPP"
    },
    {
        "url": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_Asia_24h.csv",
        "instrument": "VIIRS",
        "default_satellite": "NOAA-20"
    },
    {
        "url": "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_South_Asia_24h.csv",
        "instrument": "MODIS",
        "default_satellite": "Terra/Aqua"
    }
]

# Simple in-memory cache: (cache_key) -> {"timestamp": float, "data": dict}
_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 300  # 5 minutes cache TTL

# Local Raw Backup File Path (Root repository: SIH-26162/data/raw/firms_latest_backup.json)
SERVICES_DIR = os.path.dirname(os.path.abspath(__file__)) # backend/app/services
APP_DIR = os.path.dirname(SERVICES_DIR)                  # backend/app
BACKEND_DIR = os.path.dirname(APP_DIR)                     # backend
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)                # SIH-26162
BACKUP_PATH = os.path.join(PROJECT_ROOT, "data", "raw", "firms_latest_backup.json")
INDIA_GEOJSON_PATH = os.path.join(PROJECT_ROOT, "data", "geojson", "india_boundary.json")

_india_geom = None


def _get_india_geometry():
    """Lazily load and cache the India boundary MultiPolygon."""
    global _india_geom
    if _india_geom is not None:
        return _india_geom
    if os.path.exists(INDIA_GEOJSON_PATH):
        try:
            from shapely.geometry import shape
            with open(INDIA_GEOJSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                _india_geom = shape(data["features"][0]["geometry"])
        except Exception as e:
            logger.warning(f"Unable to load India boundary geometry: {e}")
    return _india_geom


def is_point_inside_india(lat: Optional[float], lon: Optional[float]) -> bool:
    """Check if (lat, lon) falls strictly inside India's territorial boundary."""
    if lat is None or lon is None:
        return False
    try:
        f_lat = float(lat)
        f_lon = float(lon)
    except (ValueError, TypeError):
        return False

    # Rapid bounding box reject
    if not (6.5 <= f_lat <= 37.5 and 68.0 <= f_lon <= 97.5):
        return False

    geom = _get_india_geometry()
    if geom is None:
        return True

    try:
        from shapely.geometry import Point
        return bool(geom.contains(Point(f_lon, f_lat)))
    except Exception:
        return True


def _normalize_satellite_name(sat_code: str, default_name: str) -> str:
    """Map FIRMS satellite codes to human-readable names."""
    sat_map = {
        "N": "Suomi-NPP (VIIRS)",
        "1": "NOAA-20 (VIIRS)",
        "J1": "NOAA-20 (VIIRS)",
        "2": "NOAA-21 (VIIRS)",
        "J2": "NOAA-21 (VIIRS)",
        "T": "Terra (MODIS)",
        "A": "Aqua (MODIS)",
    }
    return sat_map.get(sat_code.strip().upper(), default_name)


def _format_acquisition_time(date_str: str, time_str: str) -> str:
    """Format FIRMS acq_date (YYYY-MM-DD) and acq_time (HHMM) into UTC datetime string."""
    time_clean = time_str.zfill(4) if time_str else "0000"
    hours = time_clean[:2]
    minutes = time_clean[2:4]
    return f"{date_str} {hours}:{minutes} UTC"


def _parse_firms_csv_row(row: Dict[str, str], default_sat: str, default_inst: str) -> Optional[Dict[str, Any]]:
    """Parse a single CSV row from NASA FIRMS into standardized JSON schema."""
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        
        # Extract brightness temperature (bright_ti4 for VIIRS, brightness for MODIS)
        brightness_raw = row.get("bright_ti4") or row.get("brightness") or "0"
        brightness = round(float(brightness_raw), 2)
        
        # Fire Radiative Power (FRP) in MW
        frp_raw = row.get("frp") or "0"
        frp = round(float(frp_raw), 2)
        
        # Confidence score ('low', 'nominal', 'high' for VIIRS or 0-100 for MODIS)
        confidence = row.get("confidence", "N/A")
        
        # Date & Time
        acq_date = row.get("acq_date", "")
        acq_time = row.get("acq_time", "")
        acquired_at = _format_acquisition_time(acq_date, acq_time)
        
        # Satellite & Instrument
        sat_code = row.get("satellite", "")
        satellite_name = _normalize_satellite_name(sat_code, default_sat)
        instrument = "VIIRS" if "bright_ti4" in row else default_inst
        
        return {
            "latitude": lat,
            "longitude": lon,
            "brightness": brightness,
            "confidence": confidence,
            "frp": frp,
            "acquired_at": acquired_at,
            "satellite": satellite_name,
            "instrument": instrument,
            "source": "NASA FIRMS"
        }
    except (KeyError, ValueError) as e:
        logger.warning(f"Skipping invalid FIRMS CSV row: {e}")
        return None


def _is_within_bbox(lat: float, lon: float, bbox: List[float]) -> bool:
    """Check if (lat, lon) falls inside bounding box [min_lon, min_lat, max_lon, max_lat]."""
    min_lon, min_lat, max_lon, max_lat = bbox
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


async def _fetch_single_feed(client: httpx.AsyncClient, feed: Dict[str, str], target_bbox: List[float]) -> List[Dict[str, Any]]:
    """Fetch and parse a single public NASA FIRMS CSV feed."""
    items = []
    try:
        resp = await client.get(feed["url"])
        if resp.status_code == 200:
            reader = csv.DictReader(io.StringIO(resp.text))
            for row in reader:
                item = _parse_firms_csv_row(row, feed["default_satellite"], feed["instrument"])
                if item and _is_within_bbox(item["latitude"], item["longitude"], target_bbox):
                    items.append(item)
    except Exception as ex:
        logger.error(f"Error reading public FIRMS feed {feed['url']}: {ex}")
    return items


def _load_stored_processed_hotspots(target_bbox: List[float]) -> List[Dict[str, Any]]:
    """
    Load stored Phase 2/3 ingested FIRMS observations filtered by bounding box.
    Queries Supabase database primary store first; falls back to local JSON storage.
    """
    try:
        from app.db.database import get_session_factory
        from app.db.repositories import FirmsObservationRepository

        factory = get_session_factory()
        if factory is not None:
            with factory() as db:
                db_records = FirmsObservationRepository.get_observations(db, limit=5000, offset=0, bbox=target_bbox)
                if db_records:
                    return [r.to_dict() for r in db_records]
    except Exception as ex:
        logger.warning(f"Database read failed in firms_service, falling back to local storage: {ex}")

    # Fallback to local JSON file
    from app.config import FIRMS_OBSERVATIONS_PATH
    if not os.path.exists(FIRMS_OBSERVATIONS_PATH):
        return []
    try:
        with open(FIRMS_OBSERVATIONS_PATH, "r", encoding="utf-8") as f:
            items = json.load(f)
            if isinstance(items, list):
                return [
                    it for it in items
                    if isinstance(it, dict) and _is_within_bbox(float(it.get("latitude", 0)), float(it.get("longitude", 0)), target_bbox)
                ]
    except Exception as e:
        logger.error(f"Error reading processed FIRMS observations: {e}")
    return []


def _load_backup_hotspots(target_bbox: List[float]) -> List[Dict[str, Any]]:
    """Load local backup FIRMS hotspots if online network fetch is unavailable."""
    if not os.path.exists(BACKUP_PATH):
        return []
    try:
        with open(BACKUP_PATH, "r", encoding="utf-8") as f:
            raw_items = json.load(f)
            return [it for it in raw_items if _is_within_bbox(it["latitude"], it["longitude"], target_bbox)]
    except Exception as e:
        logger.error(f"Error reading local FIRMS backup: {e}")
        return []


def _save_backup_hotspots(hotspots: List[Dict[str, Any]]) -> None:
    """Save fetched FIRMS hotspots to local backup storage."""
    try:
        os.makedirs(os.path.dirname(BACKUP_PATH), exist_ok=True)
        with open(BACKUP_PATH, "w", encoding="utf-8") as f:
            json.dump(hotspots, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving local FIRMS backup: {e}")


async def fetch_firms_hotspots(
    region: str = "india",
    custom_bbox: Optional[List[float]] = None,
    force_refresh: bool = False
) -> Dict[str, Any]:
    """
    Fetch active fire hotspots from Phase 2 ingested observations storage (if available),
    or NASA FIRMS API (if MAP_KEY available) / public 24h CSV feeds with fallback to backup.
    Caches response in-memory for 5 minutes.
    """
    # Determine target bounding box
    if custom_bbox and len(custom_bbox) == 4:
        target_bbox = custom_bbox
        cache_key = f"custom_{','.join(map(str, custom_bbox))}"
    else:
        region_clean = region.lower().strip()
        target_bbox = REGION_BOUNDS.get(region_clean, REGION_BOUNDS["india"])
        cache_key = region_clean

    # Check cache if not forcing refresh (and ensure cached data contains > 0 hotspots)
    now = time.time()
    if not force_refresh and cache_key in _cache:
        cached_entry = _cache[cache_key]
        if now - cached_entry["timestamp"] < CACHE_TTL_SECONDS and cached_entry["data"].get("count", 0) > 0:
            logger.info(f"Returning cached FIRMS hotspots for key: {cache_key}")
            return cached_entry["data"]

    hotspots: List[Dict[str, Any]] = []

    # Priority 1: If not forcing refresh, load from Phase 2 ingested storage
    if not force_refresh:
        stored_obs = _load_stored_processed_hotspots(target_bbox)
        if stored_obs:
            logger.info(f"Loaded {len(stored_obs)} real FIRMS observations from Phase 2 processed storage for bbox {target_bbox}")
            hotspots = stored_obs

    # Priority 2: If no stored observations or force_refresh requested, fetch online
    if not hotspots:
        map_key = NASA_FIRMS_MAP_KEY
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        try:
            async with httpx.AsyncClient(timeout=15.0, headers=headers, follow_redirects=True) as client:
                # Strategy A: Use NASA FIRMS MAP_KEY API if key is provided
                if map_key:
                    try:
                        min_lon, min_lat, max_lon, max_lat = target_bbox
                        bbox_str = f"{min_lon},{min_lat},{max_lon},{max_lat}"
                        api_url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/VIIRS_SNPP_NRT/{bbox_str}/1"
                        logger.info(f"Querying NASA FIRMS MAP_KEY API for target bbox: {bbox_str}")
                        
                        resp = await client.get(api_url)
                        if resp.status_code == 200 and not resp.text.startswith("Invalid MAP_KEY"):
                            reader = csv.DictReader(io.StringIO(resp.text))
                            for row in reader:
                                item = _parse_firms_csv_row(row, "VIIRS", "VIIRS")
                                if item and _is_within_bbox(item["latitude"], item["longitude"], target_bbox):
                                    hotspots.append(item)
                    except Exception as ex:
                        logger.warning(f"FIRMS MAP_KEY API query failed, falling back to public feeds: {ex}")

                # Strategy B: Fallback to public official 24h FIRMS CSV feeds concurrently
                if not hotspots:
                    logger.info("Fetching FIRMS hotspots concurrently from official public 24h CSV feeds...")
                    tasks = [_fetch_single_feed(client, feed, target_bbox) for feed in PUBLIC_FIRMS_FEEDS]
                    results = await asyncio.gather(*tasks, return_exceptions=True)
                    for res in results:
                        if isinstance(res, list):
                            hotspots.extend(res)
        except Exception as e:
            logger.warning(f"Network error fetching NASA FIRMS online: {e}")

        # Strategy C: Local Raw Backup Fallback if online fetch returned no hotspots
        if not hotspots:
            logger.info("Loading real FIRMS hotspots from local raw backup snapshot...")
            hotspots = _load_backup_hotspots(target_bbox)
        else:
            # Update local backup file with freshly retrieved online hotspots
            _save_backup_hotspots(hotspots)

    # Filter strictly to India territorial boundary if region is india and not custom bbox
    if region.lower().strip() == "india" and not custom_bbox:
        hotspots = [
            h for h in hotspots
            if is_point_inside_india(h.get("latitude"), h.get("longitude"))
        ]

    # Build standardized response
    response_data = {
        "source": "NASA FIRMS",
        "region": region,
        "bbox": target_bbox,
        "count": len(hotspots),
        "hotspots": hotspots,
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(now))
    }

    # Update cache if hotspots were found
    if len(hotspots) > 0:
        _cache[cache_key] = {
            "timestamp": now,
            "data": response_data
        }

    return response_data


async def check_firms_connectivity(timeout_seconds: float = 5.0) -> Dict[str, Any]:
    """
    Perform a single, controlled, minimal, timeout-protected connectivity check to NASA FIRMS API.
    
    Guarantees:
    - Never polls periodically or continuously.
    - Never fetches global data (uses minimal 0.1-degree bounding box).
    - Never logs or exposes the NASA FIRMS key.
    - Never stores observations in any database.
    
    Returns a dict with:
      - status: 'REACHABLE' | 'UNREACHABLE' | 'INVALID_CREDENTIAL' | 'NOT_CONFIGURED'
      - latency_ms: float or None
      - http_status: int or None
      - error_category: str or None
    """
    if not NASA_FIRMS_MAP_KEY:
        return {
            "status": "NOT_CONFIGURED",
            "latency_ms": None,
            "http_status": None,
            "error_category": None
        }

    # Use a minimal 0.1-degree test bounding box in central India for 1 day
    test_bbox = "78.9,20.5,79.0,20.6"
    test_url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{NASA_FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/{test_bbox}/1"
    headers = {
        "User-Agent": "SIH-26162-SystemStatusCheck/1.0"
    }

    start_time = time.time()
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds, headers=headers, follow_redirects=True) as client:
            resp = await client.get(test_url)
            elapsed_ms = round((time.time() - start_time) * 1000, 2)

            if resp.status_code == 200:
                if resp.text.startswith("Invalid MAP_KEY"):
                    logger.warning(f"FIRMS connectivity check returned invalid key error in {elapsed_ms}ms (HTTP 200)")
                    return {
                        "status": "INVALID_CREDENTIAL",
                        "latency_ms": elapsed_ms,
                        "http_status": 200,
                        "error_category": "invalid_map_key"
                    }
                else:
                    line_count = len(resp.text.strip().splitlines()) - 1 if resp.text.strip() else 0
                    logger.info(f"FIRMS connectivity check successful: HTTP 200 in {elapsed_ms}ms (record_count={max(0, line_count)})")
                    return {
                        "status": "REACHABLE",
                        "latency_ms": elapsed_ms,
                        "http_status": 200,
                        "error_category": None
                    }
            elif resp.status_code in (401, 403):
                logger.warning(f"FIRMS connectivity check failed: HTTP {resp.status_code} in {elapsed_ms}ms")
                return {
                    "status": "INVALID_CREDENTIAL",
                    "latency_ms": elapsed_ms,
                    "http_status": resp.status_code,
                    "error_category": "unauthorized"
                }
            else:
                logger.warning(f"FIRMS connectivity check returned HTTP {resp.status_code} in {elapsed_ms}ms")
                return {
                    "status": "UNREACHABLE",
                    "latency_ms": elapsed_ms,
                    "http_status": resp.status_code,
                    "error_category": f"http_{resp.status_code}"
                }
    except httpx.TimeoutException:
        elapsed_ms = round((time.time() - start_time) * 1000, 2)
        logger.warning(f"FIRMS connectivity check timed out after {elapsed_ms}ms")
        return {
            "status": "UNREACHABLE",
            "latency_ms": elapsed_ms,
            "http_status": None,
            "error_category": "timeout"
        }
    except Exception as ex:
        elapsed_ms = round((time.time() - start_time) * 1000, 2)
        logger.warning(f"FIRMS connectivity check failed after {elapsed_ms}ms: {type(ex).__name__}")
        return {
            "status": "UNREACHABLE",
            "latency_ms": elapsed_ms,
            "http_status": None,
            "error_category": type(ex).__name__
        }

