import os
import math
import time
import logging
import hashlib
from datetime import datetime, timezone, timedelta
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Tuple, List
import httpx
from PIL import Image

import app.config as config
from app.services.satellite_auth_service import get_satellite_auth_service

logger = logging.getLogger("satellite_service")
logging.getLogger("httpx").setLevel(logging.WARNING)

CDSE_CATALOG_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search"
CDSE_PROCESS_URL = "https://sh.dataspace.copernicus.eu/process/v1"

TRUE_COLOR_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B04", "B03", "B02"],
    output: { bands: 3 }
  };
}
function evaluatePixel(sample) {
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02];
}
"""

FALSE_COLOR_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B08", "B04", "B03"],
    output: { bands: 3 }
  };
}
function evaluatePixel(sample) {
  return [2.5 * sample.B08, 2.5 * sample.B04, 2.5 * sample.B03];
}
"""


def calculate_patch_bbox(lat: float, lon: float, radius_km: float = 1.0) -> Tuple[float, float, float, float]:
    """
    Calculate bounding box [min_lon, min_lat, max_lon, max_lat] centered at (lat, lon)
    with specified radius in kilometers using WGS84 approximation.
    """
    lat_deg = radius_km / 111.32
    lon_deg = radius_km / (111.32 * math.cos(math.radians(lat)))
    return (
        round(lon - lon_deg, 6),
        round(lat - lat_deg, 6),
        round(lon + lon_deg, 6),
        round(lat + lat_deg, 6)
    )


def generate_patch_id(lat: float, lon: float, timestamp: Optional[str] = None, observation_id: Optional[str] = None) -> str:
    """Generate deterministic unique ID for a satellite patch based on observation or coords and date."""
    if observation_id:
        return f"sat_{observation_id}"
    ts_str = timestamp if isinstance(timestamp, str) else "2026-09-01"
    date_part = ts_str.split()[0]
    raw_key = f"{round(lat, 4)}_{round(lon, 4)}_{date_part}"
    digest = hashlib.md5(raw_key.encode("utf-8")).hexdigest()[:10]
    return f"sat_{digest}"


def parse_datetime_flexible(val: Any) -> Optional[datetime]:
    """Parse various datetime string formats into UTC timezone-aware datetime."""
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if not val or not isinstance(val, str):
        return None

    clean_str = val.strip()
    if clean_str.endswith(" UTC"):
        clean_str = clean_str[:-4].strip()
    if clean_str.endswith("Z"):
        clean_str = clean_str[:-1] + "+00:00"

    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(clean_str, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    try:
        dt = datetime.fromisoformat(clean_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def classify_cloud_quality(cloud_cover: float) -> Tuple[str, str]:
    """
    Classify optical observation quality based on cloud cover percentage.
    Returns (quality_status, quality_message).
    """
    if cloud_cover < 30.0:
        return "GOOD", "Clear optical atmospheric conditions (<30% cloud cover)."
    elif cloud_cover < 70.0:
        return "MODERATE", f"Moderate cloud cover ({cloud_cover:.1f}%); surface features partially visible."
    elif cloud_cover <= 90.0:
        return "HIGH_CLOUD", f"High cloud cover ({cloud_cover:.1f}%); optical visibility may be limited."
    else:
        return "VERY_HIGH_CLOUD", f"Very high cloud cover ({cloud_cover:.1f}%); surface features likely obscured."


class SatelliteImageProvider(ABC):
    """Abstract interface for modular Satellite Image Providers."""

    @abstractmethod
    async def fetch_satellite_image(
        self,
        lat: float,
        lon: float,
        timestamp: Optional[str] = None,
        radius_km: Optional[float] = None,
        observation_id: Optional[str] = None,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """Fetch real satellite imagery evidence for specified coordinates and timestamp."""
        pass


class Sentinel2ImageProvider(SatelliteImageProvider):
    """
    Genuine Sentinel-2 Satellite Image Provider leveraging the Copernicus Data Space Ecosystem (CDSE).
    Queries the STAC Catalog API for multi-candidate Sentinel-2 L2A acquisitions, ranks candidates
    deterministically using spatial, cloud, and temporal scores, and downloads true-color optical imagery.
    """

    def __init__(self):
        self.provider_name = "Copernicus Sentinel-2"
        self.product_name = "Sentinel-2 L2A"
        self.cache_dir = config.SATELLITE_CACHE_DIR
        os.makedirs(self.cache_dir, exist_ok=True)
        self.auth_service = get_satellite_auth_service()

    async def search_catalog(
        self,
        lat: float,
        lon: float,
        bbox: Tuple[float, float, float, float],
        center_dt: datetime,
        before_hours: Optional[int] = None,
        after_hours: Optional[int] = None,
        window_hours: Optional[int] = None,
        max_cloud_cover: float = 100.0,
        client: Optional[httpx.AsyncClient] = None
    ) -> List[Dict[str, Any]]:
        """
        Search Copernicus STAC Catalog API for all Sentinel-2 L2A scene acquisitions
        intersecting the AOI bounding box over the asymmetric search window.
        Scores and ranks all candidates deterministically.
        """
        # Resolve search window hours from config or arguments
        b_hours = before_hours if before_hours is not None else getattr(config, "SATELLITE_SEARCH_BEFORE_HOURS", 120)
        a_hours = after_hours if after_hours is not None else getattr(config, "SATELLITE_SEARCH_AFTER_HOURS", 48)
        if window_hours is not None:
            b_hours = window_hours
            a_hours = window_hours

        token = await self.auth_service.get_access_token(client=client)
        if not token:
            logger.warning("No Copernicus access token; skipping catalog search.")
            return []

        start_dt = center_dt - timedelta(hours=b_hours)
        end_dt = center_dt + timedelta(hours=a_hours)

        start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        body = {
            "collections": ["sentinel-2-l2a"],
            "datetime": f"{start_iso}/{end_iso}",
            "bbox": list(bbox),
            "limit": 20,
        }

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=5.0)
            should_close = True

        try:
            resp = await client.post(CDSE_CATALOG_URL, headers=headers, json=body)
            if resp.status_code == 200:
                features = resp.json().get("features", [])
                if not features:
                    logger.info(f"STAC Catalog returned 0 scenes for AOI ({lat:.4f}, {lon:.4f}) in range {start_iso} to {end_iso}")
                    return []

                total_window_hours = max(1.0, float(b_hours + a_hours))
                candidates = []

                for f in features:
                    props = f.get("properties", {})
                    acq_time_str = props.get("datetime")
                    acq_dt = parse_datetime_flexible(acq_time_str) or center_dt
                    cloud_cover = float(props.get("eo:cloud_cover", 0.0))
                    time_diff_hours = round(abs((acq_dt - center_dt).total_seconds()) / 3600.0, 2)

                    # Deterministic Candidate Scoring:
                    # candidate_score = spatial_score * 0.40 + cloud_score * 0.35 + temporal_score * 0.25
                    spatial_score = 1.0  # Catalog response guarantees spatial intersection with requested bbox
                    cloud_score = max(0.0, 1.0 - (cloud_cover / 100.0))
                    temporal_score = max(0.0, 1.0 - (time_diff_hours / total_window_hours))
                    candidate_score = round(spatial_score * 0.40 + cloud_score * 0.35 + temporal_score * 0.25, 4)

                    q_status, q_msg = classify_cloud_quality(cloud_cover)

                    candidate_item = {
                        "id": f.get("id"),
                        "datetime": acq_time_str,
                        "satellite_acquired_at": acq_dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
                        "cloud_cover": cloud_cover,
                        "cloud_percentage": cloud_cover,
                        "time_difference_hours": time_diff_hours,
                        "spatial_match": True,
                        "spatial_score": spatial_score,
                        "cloud_score": round(cloud_score, 4),
                        "temporal_score": round(temporal_score, 4),
                        "candidate_score": candidate_score,
                        "quality_status": q_status,
                        "quality_message": q_msg,
                        "bbox": f.get("bbox") or list(bbox)
                    }
                    candidates.append(candidate_item)

                # Deterministic Ranking: Highest score first, then lowest cloud cover, then smallest time difference
                candidates.sort(key=lambda c: (-c["candidate_score"], c["cloud_cover"], c["time_difference_hours"]))
                logger.info(f"Found {len(candidates)} Sentinel-2 candidates for ({lat:.4f}, {lon:.4f}). Top score: {candidates[0]['candidate_score']} (Cloud: {candidates[0]['cloud_cover']}%, Diff: {candidates[0]['time_difference_hours']}h)")
                return candidates
            else:
                logger.warning(f"Copernicus Catalog search failed with HTTP {resp.status_code}")
                return []
        except Exception as ex:
            logger.error(f"Error querying Copernicus Catalog API: {type(ex).__name__} - {ex}")
            return []
        finally:
            if should_close:
                await client.aclose()

    async def retrieve_processing_image(
        self,
        bbox: Tuple[float, float, float, float],
        time_from_iso: str,
        time_to_iso: str,
        evalscript: str = TRUE_COLOR_EVALSCRIPT,
        width: int = 256,
        height: int = 256,
        client: Optional[httpx.AsyncClient] = None
    ) -> Optional[bytes]:
        """
        Retrieve raw PNG image bytes from Copernicus Sentinel Hub Processing API.
        """
        token = await self.auth_service.get_access_token(client=client)
        if not token:
            return None

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "image/png"
        }

        body = {
            "input": {
                "bounds": {
                    "bbox": list(bbox),
                    "properties": {
                        "crs": "http://www.opengis.net/def/crs/EPSG/0/4326"
                    }
                },
                "data": [
                    {
                        "type": "sentinel-2-l2a",
                        "dataFilter": {
                            "timeRange": {
                                "from": time_from_iso,
                                "to": time_to_iso
                            },
                            "mosaickingOrder": "mostRecent"
                        }
                    }
                ]
            },
            "output": {
                "width": width,
                "height": height,
                "responses": [
                    {
                        "identifier": "default",
                        "format": {
                            "type": "image/png"
                        }
                    }
                ]
            },
            "evalscript": evalscript
        }

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=6.0)
            should_close = True

        try:
            resp = await client.post(CDSE_PROCESS_URL, headers=headers, json=body)
            if resp.status_code == 200 and resp.content and len(resp.content) > 0:
                return resp.content
            else:
                logger.warning(f"Sentinel Hub Processing API returned HTTP {resp.status_code}")
                return None
        except Exception as ex:
            logger.error(f"Error querying Copernicus Processing API: {type(ex).__name__} - {ex}")
            return None
        finally:
            if should_close:
                await client.aclose()

    async def fetch_satellite_image(
        self,
        lat: float,
        lon: float,
        timestamp: Optional[str] = None,
        radius_km: Optional[float] = None,
        observation_id: Optional[str] = None,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Retrieve genuine Copernicus Sentinel-2 satellite imagery evidence.
        
        Data Integrity Rules:
        - NEVER label synthetic/offline data as Sentinel-2 or real imagery.
        - If retrieval fails or credentials missing, return available=False with clear state machine status.
        """
        r_km = radius_km or config.SATELLITE_PATCH_RADIUS_KM
        center_dt = parse_datetime_flexible(timestamp) or datetime.now(timezone.utc)
        bbox = calculate_patch_bbox(lat, lon, r_km)
        patch_id = generate_patch_id(lat, lon, timestamp, observation_id)
        image_filename = f"{patch_id}.png"
        image_path = os.path.join(self.cache_dir, image_filename)
        retrieved_time = datetime.now(timezone.utc).isoformat()
        firms_acq_str = center_dt.strftime("%Y-%m-%d %H:%M UTC")

        before_hours = getattr(config, "SATELLITE_SEARCH_BEFORE_HOURS", 120)
        after_hours = getattr(config, "SATELLITE_SEARCH_AFTER_HOURS", 48)

        # 1. Check database and disk cache first
        if not force_refresh:
            try:
                from app.db.database import get_session_factory
                from app.db.repositories import SatelliteEvidenceRepository
                factory = get_session_factory()
                if factory:
                    with factory() as db:
                        cached_record = None
                        if observation_id:
                            cached_record = SatelliteEvidenceRepository.get_by_observation_id(db, observation_id)
                        if not cached_record:
                            cached_record = SatelliteEvidenceRepository.get_by_coords_and_time(db, lat, lon)

                        if cached_record and cached_record.status in ("AVAILABLE", "ACQUISITION_AVAILABLE", "ACQUISITION_AVAILABLE_HIGH_CLOUD") and os.path.exists(cached_record.true_color_path or ""):
                            logger.info(f"Returning cached satellite evidence for {observation_id or patch_id}")
                            rec_dict = cached_record.to_dict()
                            rec_dict["image_path"] = cached_record.true_color_path
                            rec_dict["cached"] = True
                            q_status, q_msg = classify_cloud_quality(rec_dict.get("cloud_percentage") or 0.0)
                            rec_dict["quality_status"] = q_status
                            rec_dict["quality_message"] = q_msg
                            return rec_dict
            except Exception as ex:
                logger.warning(f"Database cache lookup error: {ex}")

            if os.path.exists(image_path):
                logger.info(f"Serving cached satellite patch from local file {image_path}")
                return {
                    "status": "ACQUISITION_AVAILABLE",
                    "available": True,
                    "image_available": True,
                    "is_synthetic": False,
                    "source": self.provider_name,
                    "product": self.product_name,
                    "observation_id": observation_id,
                    "latitude": lat,
                    "longitude": lon,
                    "bounding_box": list(bbox),
                    "firms_acquired_at": firms_acq_str,
                    "satellite_acquired_at": firms_acq_str,
                    "retrieved_at": retrieved_time,
                    "time_difference_hours": 0.0,
                    "cloud_percentage": 0.0,
                    "quality_status": "GOOD",
                    "quality_message": "Clear optical conditions.",
                    "image_path": image_path,
                    "image_url": f"/api/satellite/image/{patch_id}",
                    "true_color_available": True,
                    "false_color_available": False,
                    "cached": True,
                    "visual_evidence": "Optical supporting evidence retrieved from local cache.",
                    "message": "Satellite imagery retrieved from local cache."
                }

        # 2. Check if credentials are configured
        if not self.auth_service.is_configured():
            msg = "Copernicus CDSE credentials unconfigured in backend/.env (COPERNICUS_CLIENT_ID / COPERNICUS_CLIENT_SECRET)."
            logger.info(msg)
            return {
                "status": "AUTH_FAILED",
                "available": False,
                "image_available": False,
                "is_synthetic": False,
                "source": self.provider_name,
                "product": self.product_name,
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": None,
                "retrieved_at": retrieved_time,
                "cloud_percentage": None,
                "quality_status": "UNAVAILABLE",
                "quality_message": msg,
                "image_path": None,
                "image_url": None,
                "true_color_available": False,
                "false_color_available": False,
                "cached": False,
                "visual_evidence": msg,
                "message": msg
            }

        # 3. Search STAC Catalog for all candidate Sentinel-2 L2A acquisitions
        candidates = await self.search_catalog(
            lat=lat,
            lon=lon,
            bbox=bbox,
            center_dt=center_dt,
            before_hours=before_hours,
            after_hours=after_hours
        )

        if not candidates:
            msg = f"No suitable Sentinel-2 L2A acquisition intersected the AOI during the {before_hours}h before / {after_hours}h after search window."
            logger.info(f"NO_ACQUISITION for observation {observation_id}: {msg}")
            
            # Store NOT_AVAILABLE metadata record in DB
            self._save_db_record({
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "provider": self.provider_name,
                "product": self.product_name,
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": None,
                "retrieved_at": retrieved_time,
                "cloud_percentage": None,
                "bbox": list(bbox),
                "status": "NO_ACQUISITION",
                "is_synthetic": False,
                "error_message": msg
            })
            return {
                "status": "NO_ACQUISITION",
                "available": False,
                "image_available": False,
                "is_synthetic": False,
                "source": self.provider_name,
                "product": self.product_name,
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": None,
                "retrieved_at": retrieved_time,
                "cloud_percentage": None,
                "quality_status": "UNAVAILABLE",
                "quality_message": msg,
                "image_path": None,
                "image_url": None,
                "true_color_available": False,
                "false_color_available": False,
                "cached": False,
                "visual_evidence": msg,
                "message": msg
            }

        # 4. Select top-ranked candidate
        best_candidate = candidates[0]
        sat_acq_dt = parse_datetime_flexible(best_candidate["datetime"]) or center_dt
        sat_acq_str = sat_acq_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        cloud_pct = best_candidate.get("cloud_cover", 0.0)
        time_diff = best_candidate.get("time_difference_hours", 0.0)
        scene_id = best_candidate.get("id")
        quality_status = best_candidate.get("quality_status", "GOOD")
        quality_message = best_candidate.get("quality_message", "")

        # Narrow time range for processing API request around exact candidate acquisition
        time_from = (sat_acq_dt - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        time_to = (sat_acq_dt + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")

        # 5. Download genuine Sentinel-2 True-Color image
        img_bytes = await self.retrieve_processing_image(
            bbox=bbox,
            time_from_iso=time_from,
            time_to_iso=time_to,
            evalscript=TRUE_COLOR_EVALSCRIPT,
            width=config.SATELLITE_IMAGE_SIZE,
            height=config.SATELLITE_IMAGE_SIZE
        )

        if not img_bytes:
            err_msg = "Catalog acquisition found, but Processing API failed to render raster."
            logger.warning(f"PROCESSING_FAILED for observation {observation_id}: {err_msg}")
            return {
                "status": "PROCESSING_FAILED",
                "available": False,
                "image_available": False,
                "is_synthetic": False,
                "source": self.provider_name,
                "product": self.product_name,
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": sat_acq_str,
                "retrieved_at": retrieved_time,
                "cloud_percentage": cloud_pct,
                "time_difference_hours": time_diff,
                "scene_id": scene_id,
                "quality_status": "UNAVAILABLE",
                "quality_message": err_msg,
                "image_path": None,
                "image_url": None,
                "true_color_available": False,
                "false_color_available": False,
                "cached": False,
                "visual_evidence": err_msg,
                "message": err_msg
            }

        # Save downloaded genuine image to cache
        with open(image_path, "wb") as f:
            f.write(img_bytes)

        # Determine evidence status
        final_status = "ACQUISITION_AVAILABLE_HIGH_CLOUD" if cloud_pct >= 70.0 else "ACQUISITION_AVAILABLE"

        visual_expl = (
            f"Sentinel-2 L2A optical evidence retrieved ({sat_acq_str}). "
            + (f"High cloud cover ({cloud_pct:.1f}%) may obscure ground features." if cloud_pct >= 70.0 else "Multi-spectral reflectance provides visual context.")
        )

        # Save metadata record to DB
        evidence_dict = {
            "observation_id": observation_id,
            "latitude": lat,
            "longitude": lon,
            "provider": self.provider_name,
            "product": self.product_name,
            "firms_acquired_at": firms_acq_str,
            "satellite_acquired_at": sat_acq_str,
            "retrieved_at": retrieved_time,
            "cloud_percentage": cloud_pct,
            "bbox": list(bbox),
            "true_color_path": image_path,
            "false_color_path": None,
            "image_url": f"/api/satellite/image/{patch_id}",
            "status": "AVAILABLE",
            "is_synthetic": False,
            "error_message": None
        }
        self._save_db_record(evidence_dict)

        logger.info(f"Successfully retrieved and cached real Sentinel-2 imagery for {observation_id or patch_id} (Status: {final_status}, Cloud: {cloud_pct}%, Score: {best_candidate.get('candidate_score')})")

        return {
            "status": final_status,
            "available": True,
            "image_available": True,
            "is_synthetic": False,
            "source": self.provider_name,
            "product": self.product_name,
            "observation_id": observation_id,
            "latitude": lat,
            "longitude": lon,
            "bounding_box": list(bbox),
            "firms_acquired_at": firms_acq_str,
            "satellite_acquired_at": sat_acq_str,
            "retrieved_at": retrieved_time,
            "time_difference_hours": time_diff,
            "cloud_percentage": cloud_pct,
            "scene_id": scene_id,
            "candidate_score": best_candidate.get("candidate_score"),
            "candidate_count": len(candidates),
            "quality_status": quality_status,
            "quality_message": quality_message,
            "image_path": image_path,
            "image_url": f"/api/satellite/image/{patch_id}",
            "true_color_available": True,
            "false_color_available": False,
            "cached": False,
            "visual_evidence": visual_expl,
            "message": "Real Sentinel-2 optical imagery retrieved successfully via Copernicus Data Space Ecosystem."
        }

    async def get_satellite_diagnostics(
        self,
        lat: float,
        lon: float,
        timestamp: Optional[str] = None,
        observation_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Diagnostic inspection method for STAC Catalog candidate search, scoring,
        and Processing API execution metrics without exposing credentials.
        """
        center_dt = parse_datetime_flexible(timestamp) or datetime.now(timezone.utc)
        bbox = calculate_patch_bbox(lat, lon, config.SATELLITE_PATCH_RADIUS_KM)
        firms_acq_str = center_dt.strftime("%Y-%m-%d %H:%M UTC")

        before_hours = getattr(config, "SATELLITE_SEARCH_BEFORE_HOURS", 120)
        after_hours = getattr(config, "SATELLITE_SEARCH_AFTER_HOURS", 48)

        start_dt = center_dt - timedelta(hours=before_hours)
        end_dt = center_dt + timedelta(hours=after_hours)
        start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        auth_configured = self.auth_service.is_configured()
        if not auth_configured:
            return {
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "firms_timestamp": firms_acq_str,
                "search_start": start_iso,
                "search_end": end_iso,
                "search_before_hours": before_hours,
                "search_after_hours": after_hours,
                "catalog_http_status": None,
                "catalog_results_count": 0,
                "candidates": [],
                "selected_scene": None,
                "cloud_cover": None,
                "time_difference_hours": None,
                "final_status": "AUTH_FAILED",
                "failure_reason": "Copernicus credentials not configured.",
                "image_url": None
            }

        candidates = await self.search_catalog(
            lat=lat,
            lon=lon,
            bbox=bbox,
            center_dt=center_dt,
            before_hours=before_hours,
            after_hours=after_hours
        )

        selected = candidates[0] if candidates else None

        if not candidates:
            return {
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "firms_timestamp": firms_acq_str,
                "search_start": start_iso,
                "search_end": end_iso,
                "search_before_hours": before_hours,
                "search_after_hours": after_hours,
                "catalog_http_status": 200,
                "catalog_results_count": 0,
                "candidates": [],
                "selected_scene": None,
                "cloud_cover": None,
                "time_difference_hours": None,
                "final_status": "NO_ACQUISITION",
                "failure_reason": f"No Sentinel-2 L2A acquisition intersected the AOI during {before_hours}h before to {after_hours}h after search window.",
                "image_url": None
            }

        patch_id = generate_patch_id(lat, lon, timestamp, observation_id)
        final_status = "ACQUISITION_AVAILABLE_HIGH_CLOUD" if selected["cloud_cover"] >= 70.0 else "ACQUISITION_AVAILABLE"

        return {
            "observation_id": observation_id,
            "latitude": lat,
            "longitude": lon,
            "firms_timestamp": firms_acq_str,
            "search_start": start_iso,
            "search_end": end_iso,
            "search_before_hours": before_hours,
            "search_after_hours": after_hours,
            "catalog_http_status": 200,
            "catalog_results_count": len(candidates),
            "candidates": candidates,
            "selected_scene": selected,
            "cloud_cover": selected["cloud_cover"],
            "time_difference_hours": selected["time_difference_hours"],
            "candidate_score": selected["candidate_score"],
            "final_status": final_status,
            "failure_reason": None,
            "image_url": f"/api/satellite/image/{patch_id}"
        }

    def _save_db_record(self, data: Dict[str, Any]) -> None:
        """Helper to save satellite evidence metadata to database if configured."""
        try:
            from app.db.database import get_session_factory
            from app.db.repositories import SatelliteEvidenceRepository
            factory = get_session_factory()
            if factory:
                with factory() as db:
                    SatelliteEvidenceRepository.save_evidence(db, data)
        except Exception as ex:
            logger.warning(f"Could not persist satellite evidence metadata to DB: {ex}")


def io_open(raw: bytes):
    import io
    return io.BytesIO(raw)


# Singleton satellite provider instance
_provider_instance: Optional[SatelliteImageProvider] = None


def get_satellite_provider() -> SatelliteImageProvider:
    """Factory function to return configured SatelliteImageProvider instance."""
    global _provider_instance
    if _provider_instance is None:
        _provider_instance = Sentinel2ImageProvider()
    return _provider_instance
