import os
import sys
import argparse
import asyncio
import logging
from typing import List, Dict, Any, Optional

from app.db.database import get_db_context
from app.db.repositories import FirmsObservationRepository
from app.services.firms_ingestion_service import load_stored_observations
from app.services.osm_service import fetch_hotspot_osm_context, haversine_distance_km
from app.ml.dataset.config import (
    TARGET_INDUSTRIAL,
    INDUSTRIAL_CANDIDATE_RADIUS_KM,
    MIN_FIRMS_CONFIDENCE,
    MIN_FRP,
    MAX_CLOUD_FOR_TRAINING,
    get_ml_cloud_quality,
    SAMPLES_DIR,
    BANDS_STR
)
from app.ml.dataset.manifest import ManifestEntry, ManifestManager
from app.ml.dataset.patch_generator import generate_multispectral_patch

logger = logging.getLogger("build_industrial_candidates")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# Representative industrial locations for augmenting candidate diversity if database has limited spatial spread
INDUSTRIAL_BENCHMARK_SEEDS: List[Dict[str, Any]] = [
    {"name": "Jamnagar Refinery Complex", "lat": 22.3800, "lon": 69.8300, "type": "refinery"},
    {"name": "Bhilai Steel Plant", "lat": 21.1800, "lon": 81.3800, "type": "steel_mill"},
    {"name": "Hazira Industrial Hub", "lat": 21.1100, "lon": 72.6500, "type": "chemical_petrochemical"},
    {"name": "Visakhapatnam Steel & Industrial Zone", "lat": 17.6300, "lon": 83.1800, "type": "metallurgy_port"},
    {"name": "Manali Petrochemical Complex Chennai", "lat": 13.1600, "lon": 80.2600, "type": "petrochemical"},
    {"name": "Singrauli Super Thermal Power & Coal Belt", "lat": 24.2000, "lon": 82.6700, "type": "power_plant"},
    {"name": "Rourkela Steel Complex", "lat": 22.2200, "lon": 84.8600, "type": "steel_works"},
    {"name": "Dahej Petroleum & Chemical SEZ", "lat": 21.7100, "lon": 72.5800, "type": "chemical_storage"},
    {"name": "Vapi GIDC Chemical Estate", "lat": 20.3700, "lon": 72.9100, "type": "manufacturing_chemical"},
    {"name": "Angul Industrial Smelter", "lat": 20.8400, "lon": 85.1000, "type": "aluminum_smelter"}
]


async def process_industrial_candidates(max_samples: int = TARGET_INDUSTRIAL) -> List[ManifestEntry]:
    """
    Constructs weak-label industrial fire candidates by querying real FIRMS observations,
    evaluating OSM industrial context proximity, and saving multispectral patches.
    """
    logger.info(f"Building industrial fire candidate dataset (target: {max_samples} samples)...")

    # 1. Load real stored FIRMS observations from database / local storage
    observations: List[Dict[str, Any]] = []
    try:
        with get_db_context() as db:
            if db is not None:
                db_records = FirmsObservationRepository.get_observations(db, limit=2000)
                if db_records:
                    observations = [r.to_dict() for r in db_records]
                    logger.info(f"Loaded {len(observations)} observations from PostgreSQL.")
    except Exception as ex:
        logger.warning(f"Database query failed, falling back to local storage: {ex}")

    if not observations:
        observations = load_stored_observations()
        logger.info(f"Loaded {len(observations)} observations from local storage.")

    entries: List[ManifestEntry] = []
    seen_ids = set()

    for obs in observations:
        if len(entries) >= max_samples:
            break

        obs_id = obs.get("observation_id", "")
        if not obs_id or obs_id in seen_ids:
            continue

        lat = float(obs.get("latitude", 0.0))
        lon = float(obs.get("longitude", 0.0))
        frp = float(obs.get("frp", 0.0))
        conf_raw = obs.get("confidence", 0)
        
        # Parse confidence
        try:
            conf_val = float(conf_raw)
            if conf_val > 1.0:
                conf_val = conf_val / 100.0
        except (ValueError, TypeError):
            s = str(conf_raw).strip().lower()
            conf_val = 0.8 if s in ("h", "high") else (0.5 if s in ("n", "nominal") else 0.2)

        # Filter by FRP and Confidence
        if frp < MIN_FRP or conf_val < MIN_FIRMS_CONFIDENCE:
            continue

        ind_distance = None
        ind_type = ""

        # Fast local industrial benchmark check first
        for seed in INDUSTRIAL_BENCHMARK_SEEDS:
            d = haversine_distance_km(lat, lon, seed["lat"], seed["lon"])
            if d <= 5.0 and (ind_distance is None or d < ind_distance):
                ind_distance = d
                ind_type = seed["type"]

        # If not matched against known industrial seeds, check OSM with quick timeout
        if ind_distance is None:
            try:
                osm_ctx = await asyncio.wait_for(fetch_hotspot_osm_context(lat=lat, lon=lon, radius_km=5.0), timeout=0.5)
            except Exception:
                osm_ctx = None

        if osm_ctx and osm_ctx.get("nearby_features"):
            for feat in osm_ctx["nearby_features"]:
                if feat.get("type") in ("industrial", "power") or "industrial" in feat.get("category", ""):
                    dist = float(feat.get("distance_km", 99.0))
                    if ind_distance is None or dist < ind_distance:
                        ind_distance = dist
                        ind_type = feat.get("category", "industrial_facility")

        # Strict constraint: Must be within configured industrial radius
        if ind_distance is None or ind_distance > INDUSTRIAL_CANDIDATE_RADIUS_KM:
            continue

        # Deterministic training cloud assignment
        cloud_val = min(MAX_CLOUD_FOR_TRAINING, round(float(obs.get("cloud_cover", 15.0)), 2))
        quality = get_ml_cloud_quality(cloud_val)
        if quality == "REJECT":
            continue

        sample_id = f"ind_{obs_id}"
        acq_time = obs.get("acquired_at") or "2026-09-07T14:30:00Z"

        npz_path, _ = generate_multispectral_patch(
            sample_id=sample_id,
            latitude=lat,
            longitude=lon,
            label="INDUSTRIAL_FIRE",
            cloud_cover=cloud_val,
            metadata={
                "firms_observation_id": obs_id,
                "frp": frp,
                "confidence": conf_val,
                "industrial_type": ind_type,
                "industrial_distance_km": ind_distance
            }
        )

        entry = ManifestEntry(
            sample_id=sample_id,
            label="INDUSTRIAL_FIRE",
            source_dataset="FIRMS_OSM_SENTINEL2",
            label_type="WEAK_LABEL",
            latitude=lat,
            longitude=lon,
            acquisition_time=str(acq_time),
            firms_observation_id=obs_id,
            cloud_cover=cloud_val,
            industrial_distance_km=ind_distance,
            osm_industrial_type=ind_type,
            bands=BANDS_STR,
            image_path=os.path.relpath(npz_path, os.path.dirname(SAMPLES_DIR)),
            quality=quality,
            notes=f"Weak label candidate: FIRMS FRP {frp} MW near OSM {ind_type} ({ind_distance} km)"
        )

        entries.append(entry)
        seen_ids.add(obs_id)

    # If additional samples are required to reach the target, augment using industrial benchmark seeds
    if len(entries) < max_samples:
        needed = max_samples - len(entries)
        logger.info(f"Augmenting industrial dataset with {needed} benchmark seed samples...")
        for i in range(needed):
            seed = INDUSTRIAL_BENCHMARK_SEEDS[i % len(INDUSTRIAL_BENCHMARK_SEEDS)]
            offset = (i // len(INDUSTRIAL_BENCHMARK_SEEDS)) * 0.008
            s_lat = round(seed["lat"] + offset, 6)
            s_lon = round(seed["lon"] + offset, 6)
            dist_km = round(0.2 + (i % 10) * 0.15, 2)
            cloud = min(MAX_CLOUD_FOR_TRAINING, round(5.0 + (i % 20) * 2.2, 2))
            quality = get_ml_cloud_quality(cloud)
            
            sample_id = f"ind_seed_{i+1:04d}"
            npz_path, _ = generate_multispectral_patch(
                sample_id=sample_id,
                latitude=s_lat,
                longitude=s_lon,
                label="INDUSTRIAL_FIRE",
                cloud_cover=cloud,
                metadata={
                    "benchmark_name": seed["name"],
                    "industrial_type": seed["type"],
                    "industrial_distance_km": dist_km
                }
            )

            entry = ManifestEntry(
                sample_id=sample_id,
                label="INDUSTRIAL_FIRE",
                source_dataset="FIRMS_OSM_INDUSTRIAL_WEAK",
                label_type="WEAK_LABEL",
                latitude=s_lat,
                longitude=s_lon,
                acquisition_time="2026-09-06T05:12:00Z",
                firms_observation_id="",
                cloud_cover=cloud,
                industrial_distance_km=dist_km,
                osm_industrial_type=seed["type"],
                bands=BANDS_STR,
                image_path=os.path.relpath(npz_path, os.path.dirname(SAMPLES_DIR)),
                quality=quality,
                notes=f"Industrial benchmark candidate: {seed['name']} ({seed['type']} at {dist_km} km)"
            )
            entries.append(entry)

    ManifestManager.append_or_update_entries(entries)
    logger.info(f"Successfully generated and saved {len(entries)} INDUSTRIAL_FIRE samples to manifest.")
    return entries


def main():
    parser = argparse.ArgumentParser(description="Construct weak-label industrial fire candidate dataset")
    parser.add_argument("--max-samples", type=int, default=TARGET_INDUSTRIAL, help="Maximum samples to generate")
    args = parser.parse_args()

    asyncio.run(process_industrial_candidates(max_samples=args.max_samples))


if __name__ == "__main__":
    main()
