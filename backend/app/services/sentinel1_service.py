import os
import math
import time
import json
import logging
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple, List
import httpx
from PIL import Image

import app.config as config
from app.services.satellite_auth_service import get_satellite_auth_service
from app.services.satellite_service import calculate_patch_bbox, parse_datetime_flexible

logger = logging.getLogger("sentinel1_service")
logging.getLogger("httpx").setLevel(logging.WARNING)

CDSE_CATALOG_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search"
CDSE_PROCESS_URL = "https://sh.dataspace.copernicus.eu/process/v1"

SAR_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["VV", "VH"],
    output: { bands: 3 }
  };
}
function evaluatePixel(sample) {
  // Enhanced SAR visualization: VV (Red), VH (Green), VH/VV ratio (Blue)
  var vv = Math.min(Math.max(sample.VV * 3.0, 0), 1);
  var vh = Math.min(Math.max(sample.VH * 8.0, 0), 1);
  var ratio = (sample.VV > 0.0001) ? Math.min(Math.max((sample.VH / sample.VV) * 2.0, 0), 1) : 0;
  return [vv, vh, ratio];
}
"""

SAR_DISCLAIMER = (
    "Sentinel-1 is SAR radar evidence that can provide cloud-independent surface information. "
    "It does not measure fire temperature."
)


def generate_s1_patch_id(lat: float, lon: float, timestamp: Optional[str] = None, observation_id: Optional[str] = None) -> str:
    """Generate deterministic unique ID for a Sentinel-1 SAR patch."""
    if observation_id:
        return f"sat_s1_{observation_id}"
    ts_str = timestamp if isinstance(timestamp, str) else "2026-09-01"
    date_part = ts_str.split()[0]
    raw_key = f"s1_{round(lat, 4)}_{round(lon, 4)}_{date_part}"
    digest = hashlib.md5(raw_key.encode("utf-8")).hexdigest()[:10]
    return f"sat_s1_{digest}"


class Sentinel1ImageProvider:
    """
    Dedicated Sentinel-1 SAR Satellite Image Provider leveraging Copernicus Data Space Ecosystem (CDSE).
    Queries official 'sentinel-1-grd' collection, prefers IW mode and dual-pol VV/VH,
    ranks candidates deterministically, and renders real cloud-penetrating SAR imagery.
    """

    def __init__(self):
        self.provider_name = "Copernicus Data Space"
        self.product_name = "Sentinel-1 GRD"
        self.cache_dir = config.SATELLITE_CACHE_DIR
        self.metadata_dir = os.path.join(config.PROJECT_ROOT, "data", "satellite", "metadata")
        os.makedirs(self.cache_dir, exist_ok=True)
        os.makedirs(self.metadata_dir, exist_ok=True)
        self.auth_service = get_satellite_auth_service()

    async def search_catalog(
        self,
        lat: float,
        lon: float,
        bbox: Tuple[float, float, float, float],
        center_dt: datetime,
        before_hours: Optional[int] = None,
        after_hours: Optional[int] = None,
        client: Optional[httpx.AsyncClient] = None
    ) -> List[Dict[str, Any]]:
        """
        Search Copernicus STAC Catalog API for sentinel-1-grd scene acquisitions
        intersecting the AOI bounding box over the asymmetric temporal search window.
        """
        b_hours = before_hours if before_hours is not None else getattr(config, "SENTINEL1_SEARCH_BEFORE_HOURS", 144)
        a_hours = after_hours if after_hours is not None else getattr(config, "SENTINEL1_SEARCH_AFTER_HOURS", 48)

        token = await self.auth_service.get_access_token(client=client)
        if not token:
            logger.warning("No Copernicus access token; skipping Sentinel-1 catalog search.")
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
            "collections": ["sentinel-1-grd"],
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
                    logger.info(f"Sentinel-1 STAC Catalog returned 0 scenes for AOI ({lat:.4f}, {lon:.4f}) in range {start_iso} to {end_iso}")
                    return []

                total_window_hours = max(1.0, float(b_hours + a_hours))
                candidates = self.rank_features(features, center_dt, total_window_hours, default_bbox=list(bbox))
                logger.info(f"Found {len(candidates)} Sentinel-1 candidates for ({lat:.4f}, {lon:.4f}).")
                return candidates
            else:
                logger.warning(f"Sentinel-1 Catalog search failed with HTTP {resp.status_code}")
                return []
        except Exception as ex:
            logger.error(f"Error querying Copernicus Sentinel-1 Catalog API: {type(ex).__name__} - {ex}")
            return []
        finally:
            if should_close:
                await client.aclose()

    def rank_features(
        self,
        features: List[Dict[str, Any]],
        center_dt: datetime,
        total_window_hours: float = 192.0,
        default_bbox: Optional[List[float]] = None
    ) -> List[Dict[str, Any]]:
        """
        Rank raw STAC catalog features deterministically using:
        - Mode preference (IW: 0.35)
        - Dual-polarization preference (VV/VH: 0.35)
        - Temporal proximity (0.30)
        """
        candidates = []
        for f in features:
            props = f.get("properties", {})
            acq_time_str = props.get("datetime")
            acq_dt = parse_datetime_flexible(acq_time_str) or center_dt
            time_diff_hours = round(abs((acq_dt - center_dt).total_seconds()) / 3600.0, 2)

            polarizations = props.get("polarizationChannels") or props.get("sar:polarizations") or ["VV", "VH"]
            if isinstance(polarizations, str):
                polarizations = [p.strip() for p in polarizations.split(",")]

            orbit_dir = props.get("sat:orbit_state") or props.get("orbitDirection") or "descending"
            instrument_mode = props.get("sar:instrument_mode") or "IW"

            mode_score = 1.0 if instrument_mode.upper() == "IW" else 0.6
            has_dual_pol = any("VV" in p.upper() for p in polarizations) and any("VH" in p.upper() for p in polarizations)
            pol_score = 1.0 if has_dual_pol else 0.5
            temporal_score = max(0.0, 1.0 - (time_diff_hours / total_window_hours))

            candidate_score = round(mode_score * 0.35 + pol_score * 0.35 + temporal_score * 0.30, 4)

            candidate_item = {
                "id": f.get("id"),
                "datetime": acq_time_str,
                "satellite_acquired_at": acq_dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "polarization": polarizations,
                "orbit_direction": orbit_dir,
                "acquisition_mode": instrument_mode,
                "time_difference_hours": time_diff_hours,
                "candidate_score": candidate_score,
                "temporal_score": round(temporal_score, 4),
                "mode_score": mode_score,
                "pol_score": pol_score,
                "bbox": f.get("bbox") or default_bbox or []
            }
            candidates.append(candidate_item)

        candidates.sort(key=lambda c: (-c["candidate_score"], c["time_difference_hours"]))
        return candidates

    async def retrieve_processing_image(
        self,
        bbox: Tuple[float, float, float, float],
        time_from_iso: str,
        time_to_iso: str,
        evalscript: str = SAR_EVALSCRIPT,
        width: int = 256,
        height: int = 256,
        client: Optional[httpx.AsyncClient] = None
    ) -> Optional[bytes]:
        """
        Retrieve raw PNG SAR raster bytes from Copernicus Processing API using sentinel-1-grd.
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
                        "type": "sentinel-1-grd",
                        "dataFilter": {
                            "timeRange": {
                                "from": time_from_iso,
                                "to": time_to_iso
                            }
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
                logger.warning(f"Sentinel-1 Processing API returned HTTP {resp.status_code}")
                return None
        except Exception as ex:
            logger.error(f"Error querying Copernicus Sentinel-1 Processing API: {type(ex).__name__} - {ex}")
            return None
        finally:
            if should_close:
                await client.aclose()

    async def fetch_sentinel1_image(
        self,
        lat: float,
        lon: float,
        timestamp: Optional[str] = None,
        radius_km: Optional[float] = None,
        observation_id: Optional[str] = None,
        force_refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Retrieve genuine Copernicus Sentinel-1 SAR satellite imagery evidence.
        
        Strict Scientific & Safety Rules:
        - NEVER generate or label synthetic data as Sentinel-1.
        - Never describe Sentinel-1 as detecting fire temperature (SAR is radar backscatter).
        - If retrieval fails, return explicit failure state with available=False.
        """
        r_km = radius_km or config.SATELLITE_PATCH_RADIUS_KM
        center_dt = parse_datetime_flexible(timestamp) or datetime.now(timezone.utc)
        bbox = calculate_patch_bbox(lat, lon, r_km)
        patch_id = generate_s1_patch_id(lat, lon, timestamp, observation_id)
        image_filename = f"{patch_id}.png"
        image_path = os.path.join(self.cache_dir, image_filename)
        meta_filename = f"{patch_id}_meta.json"
        meta_path = os.path.join(self.metadata_dir, meta_filename)
        retrieved_time = datetime.now(timezone.utc).isoformat()
        firms_acq_str = center_dt.strftime("%Y-%m-%d %H:%M UTC")

        before_hours = getattr(config, "SENTINEL1_SEARCH_BEFORE_HOURS", 144)
        after_hours = getattr(config, "SENTINEL1_SEARCH_AFTER_HOURS", 48)

        # 1. Check disk cache first
        if not force_refresh and os.path.exists(image_path):
            logger.info(f"Serving cached Sentinel-1 SAR patch from local file {image_path}")
            meta = {}
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as mf:
                        meta = json.load(mf)
                except Exception:
                    pass

            return {
                "status": "S1_FALLBACK_AVAILABLE",
                "available": True,
                "image_available": True,
                "role": "BACKUP",
                "is_synthetic": False,
                "is_radar_sar": True,
                "source": self.provider_name,
                "product": self.product_name,
                "product_id": meta.get("product_id", "S1_CACHED_GRD"),
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": meta.get("satellite_acquired_at", firms_acq_str),
                "retrieved_at": meta.get("retrieved_at", retrieved_time),
                "time_difference_hours": meta.get("time_difference_hours", 0.0),
                "polarization": meta.get("polarization", ["VV", "VH"]),
                "orbit_direction": meta.get("orbit_direction", "descending"),
                "acquisition_mode": meta.get("acquisition_mode", "IW"),
                "image_path": image_path,
                "image_url": f"/api/satellite/image/{patch_id}",
                "cached": True,
                "sar_disclaimer": SAR_DISCLAIMER,
                "message": "Sentinel-1 SAR radar evidence retrieved from local cache."
            }

        # 2. Check credentials
        if not self.auth_service.is_configured():
            msg = "Copernicus CDSE credentials unconfigured for Sentinel-1."
            logger.info(msg)
            return {
                "status": "S1_AUTH_FAILED",
                "available": False,
                "image_available": False,
                "role": "BACKUP",
                "is_synthetic": False,
                "is_radar_sar": True,
                "source": self.provider_name,
                "product": self.product_name,
                "product_id": None,
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": None,
                "retrieved_at": retrieved_time,
                "time_difference_hours": None,
                "polarization": None,
                "orbit_direction": None,
                "acquisition_mode": None,
                "image_path": None,
                "image_url": None,
                "cached": False,
                "sar_disclaimer": SAR_DISCLAIMER,
                "message": msg
            }

        # 3. Search STAC Catalog for Sentinel-1 GRD candidates
        candidates = await self.search_catalog(
            lat=lat,
            lon=lon,
            bbox=bbox,
            center_dt=center_dt,
            before_hours=before_hours,
            after_hours=after_hours
        )

        if not candidates:
            msg = f"No Sentinel-1 GRD scene intersected the AOI during {before_hours}h before to {after_hours}h after window."
            logger.info(f"S1_FALLBACK_UNAVAILABLE for {observation_id}: {msg}")
            return {
                "status": "S1_FALLBACK_UNAVAILABLE",
                "available": False,
                "image_available": False,
                "role": "BACKUP",
                "is_synthetic": False,
                "is_radar_sar": True,
                "source": self.provider_name,
                "product": self.product_name,
                "product_id": None,
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": None,
                "retrieved_at": retrieved_time,
                "time_difference_hours": None,
                "polarization": None,
                "orbit_direction": None,
                "acquisition_mode": None,
                "image_path": None,
                "image_url": None,
                "cached": False,
                "sar_disclaimer": SAR_DISCLAIMER,
                "message": msg
            }

        # 4. Take top-ranked candidate
        best_cand = candidates[0]
        sat_acq_dt = parse_datetime_flexible(best_cand["datetime"]) or center_dt
        sat_acq_str = sat_acq_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        time_diff = best_cand.get("time_difference_hours", 0.0)
        scene_id = best_cand.get("id")

        # Narrow time range around candidate acquisition
        time_from = (sat_acq_dt - timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
        time_to = (sat_acq_dt + timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ")

        # 5. Download genuine Sentinel-1 SAR image
        img_bytes = await self.retrieve_processing_image(
            bbox=bbox,
            time_from_iso=time_from,
            time_to_iso=time_to,
            evalscript=SAR_EVALSCRIPT,
            width=config.SATELLITE_IMAGE_SIZE,
            height=config.SATELLITE_IMAGE_SIZE
        )

        if not img_bytes:
            err_msg = "Sentinel-1 STAC candidate found, but Processing API failed to render SAR raster."
            logger.warning(f"S1_PROCESSING_FAILED for {observation_id}: {err_msg}")
            return {
                "status": "S1_PROCESSING_FAILED",
                "available": False,
                "image_available": False,
                "role": "BACKUP",
                "is_synthetic": False,
                "is_radar_sar": True,
                "source": self.provider_name,
                "product": self.product_name,
                "product_id": scene_id,
                "observation_id": observation_id,
                "latitude": lat,
                "longitude": lon,
                "bounding_box": list(bbox),
                "firms_acquired_at": firms_acq_str,
                "satellite_acquired_at": sat_acq_str,
                "retrieved_at": retrieved_time,
                "time_difference_hours": time_diff,
                "polarization": best_cand.get("polarization"),
                "orbit_direction": best_cand.get("orbit_direction"),
                "acquisition_mode": best_cand.get("acquisition_mode"),
                "image_path": None,
                "image_url": None,
                "cached": False,
                "sar_disclaimer": SAR_DISCLAIMER,
                "message": err_msg
            }

        # 6. Save image and metadata to disk
        try:
            with open(image_path, "wb") as f:
                f.write(img_bytes)

            meta_data = {
                "product_id": scene_id,
                "satellite_acquired_at": sat_acq_str,
                "retrieved_at": retrieved_time,
                "time_difference_hours": time_diff,
                "polarization": best_cand.get("polarization"),
                "orbit_direction": best_cand.get("orbit_direction"),
                "acquisition_mode": best_cand.get("acquisition_mode"),
                "latitude": lat,
                "longitude": lon,
                "bbox": list(bbox)
            }
            with open(meta_path, "w") as mf:
                json.dump(meta_data, mf, indent=2)

            logger.info(f"Saved real Sentinel-1 SAR image to {image_path} ({len(img_bytes)} bytes)")
        except Exception as ex:
            logger.error(f"Error saving Sentinel-1 SAR cache file: {ex}")

        return {
            "status": "S1_FALLBACK_AVAILABLE",
            "available": True,
            "image_available": True,
            "role": "BACKUP",
            "is_synthetic": False,
            "is_radar_sar": True,
            "source": self.provider_name,
            "product": self.product_name,
            "product_id": scene_id,
            "observation_id": observation_id,
            "latitude": lat,
            "longitude": lon,
            "bounding_box": list(bbox),
            "firms_acquired_at": firms_acq_str,
            "satellite_acquired_at": sat_acq_str,
            "retrieved_at": retrieved_time,
            "time_difference_hours": time_diff,
            "polarization": best_cand.get("polarization"),
            "orbit_direction": best_cand.get("orbit_direction"),
            "acquisition_mode": best_cand.get("acquisition_mode"),
            "image_path": image_path,
            "image_url": f"/api/satellite/image/{patch_id}",
            "cached": False,
            "sar_disclaimer": SAR_DISCLAIMER,
            "message": "Genuine Sentinel-1 SAR all-weather radar evidence retrieved successfully."
        }


# Singleton instance
_s1_provider_instance: Optional[Sentinel1ImageProvider] = None


def get_sentinel1_provider() -> Sentinel1ImageProvider:
    global _s1_provider_instance
    if _s1_provider_instance is None:
        _s1_provider_instance = Sentinel1ImageProvider()
    return _s1_provider_instance


# Aliases for consistent naming
Sentinel1Service = Sentinel1ImageProvider
get_sentinel1_service = get_sentinel1_provider
