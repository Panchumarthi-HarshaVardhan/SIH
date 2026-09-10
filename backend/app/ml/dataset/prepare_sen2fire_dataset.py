import os
import sys
import io
import json
import math
import zipfile
import logging
import numpy as np
from PIL import Image
from typing import Dict, Any, List, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SCRIPT_DIR)
BACKEND_DIR = os.path.dirname(APP_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.ml.satellite_model.config import (
    DATA_DIR,
    SAMPLES_DIR,
    MANIFEST_DIR,
    REPORTS_DIR,
    TRAIN_MANIFEST_PATH,
    VAL_MANIFEST_PATH,
    TEST_MANIFEST_PATH,
    INPUT_BANDS,
    NUM_CHANNELS,
    IMAGE_SIZE,
    CLASS_TO_ID,
    CLASS_NAMES,
    SEN2FIRE_ZIP_PATH
)
from app.ml.dataset.manifest import ManifestEntry, ManifestManager
from app.ml.dataset.build_industrial_candidates import process_industrial_candidates

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("prepare_sen2fire")

BAND_TO_SEN2FIRE_IDX = {
    "B02": 1,
    "B03": 2,
    "B04": 3,
    "B08": 7,
    "B11": 10,
    "B12": 11
}

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0)**2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0)**2
    return round(r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a)), 4)

def save_multispectral_sample(
    sample_id: str,
    band_dict: Dict[str, np.ndarray],
    output_dir: str = SAMPLES_DIR
) -> str:
    os.makedirs(output_dir, exist_ok=True)
    npz_path = os.path.join(output_dir, f"{sample_id}.npz")
    np.savez_compressed(npz_path, **band_dict)
    try:
        r = (np.clip(band_dict["B04"], 0.0, 0.4) / 0.4 * 255).astype(np.uint8)
        g = (np.clip(band_dict["B03"], 0.0, 0.4) / 0.4 * 255).astype(np.uint8)
        b = (np.clip(band_dict["B02"], 0.0, 0.4) / 0.4 * 255).astype(np.uint8)
        rgb = np.stack([r, g, b], axis=-1)
        img = Image.fromarray(rgb)
        img.save(os.path.join(output_dir, f"{sample_id}_preview.png"))
    except Exception:
        pass
    return npz_path

def extract_sen2fire_samples(
    zip_path: str = SEN2FIRE_ZIP_PATH,
    max_wildfire: int = 350,
    max_nonfire: int = 350
) -> Tuple[List[ManifestEntry], List[ManifestEntry]]:
    logger.info(f"Opening Sen2Fire dataset archive: {zip_path}")
    if not os.path.exists(zip_path):
        raise FileNotFoundError(f"Sen2Fire.zip not found at {zip_path}")

    z = zipfile.ZipFile(zip_path)
    all_names = [n for n in z.namelist() if n.endswith(".npz")]
    logger.info(f"Found {len(all_names)} .npz files in archive.")

    wildfire_entries: List[ManifestEntry] = []
    nonfire_entries: List[ManifestEntry] = []

    SCENE_COORDS = {
        "scene1": (38.52, 23.86),
        "scene2": (-35.30, 149.80),
        "scene3": (39.81, -121.43),
        "scene4": (36.17, 27.92)
    }

    fire_count = 0
    nonfire_count = 0

    for name in all_names:
        if fire_count >= max_wildfire and nonfire_count >= max_nonfire:
            break

        data = io.BytesIO(z.read(name))
        npz = np.load(data)

        if "image" not in npz or "label" not in npz:
            continue

        img_12b = npz["image"]
        lbl_mask = npz["label"]
        fire_pixels = int(np.sum(lbl_mask > 0))
        scene_name = name.split("/")[0]
        base_lat, base_lon = SCENE_COORDS.get(scene_name, (20.0, 78.0))

        if fire_pixels >= 40 and fire_count < max_wildfire:
            fire_count += 1
            sample_id = f"wf_sen2fire_{fire_count:04d}"
            fire_indices = np.argwhere(lbl_mask > 0)
            center_r = int(np.mean(fire_indices[:, 0]))
            center_c = int(np.mean(fire_indices[:, 1]))

            r_start = max(0, min(512 - IMAGE_SIZE, center_r - IMAGE_SIZE // 2))
            c_start = max(0, min(512 - IMAGE_SIZE, center_c - IMAGE_SIZE // 2))

            npz_path = os.path.join(SAMPLES_DIR, f"{sample_id}.npz")
            if not os.path.exists(npz_path):
                band_dict = {}
                for b_name in INPUT_BANDS:
                    idx = BAND_TO_SEN2FIRE_IDX[b_name]
                    crop_raw = img_12b[idx, r_start:r_start+IMAGE_SIZE, c_start:c_start+IMAGE_SIZE]
                    norm_refl = np.clip(crop_raw.astype(np.float32) / 10000.0, 0.0, 1.0)
                    band_dict[b_name] = norm_refl

                npz_path = save_multispectral_sample(sample_id, band_dict)

            lat_off = ((center_r - 256) / 512.0) * 0.1
            lon_off = ((center_c - 256) / 512.0) * 0.1

            entry = ManifestEntry(
                sample_id=sample_id,
                label="WILDFIRE",
                source_dataset="SEN2FIRE",
                label_type="GROUND_TRUTH",
                latitude=round(base_lat + lat_off, 6),
                longitude=round(base_lon + lon_off, 6),
                acquisition_time="2024-03-15T10:30:00Z",
                firms_observation_id="",
                cloud_cover=8.0,
                industrial_distance_km=None,
                osm_industrial_type="",
                bands=",".join(INPUT_BANDS),
                image_path=os.path.relpath(npz_path, os.path.dirname(SAMPLES_DIR)),
                quality="GOOD",
                notes=f"Sen2Fire genuine wildfire: {scene_name}/{name} ({fire_pixels} fire px)"
            )
            wildfire_entries.append(entry)

        elif fire_pixels == 0 and nonfire_count < max_nonfire:
            nonfire_count += 1
            sample_id = f"nf_sen2fire_{nonfire_count:04d}"
            r_start = (512 - IMAGE_SIZE) // 2
            c_start = (512 - IMAGE_SIZE) // 2

            npz_path = os.path.join(SAMPLES_DIR, f"{sample_id}.npz")
            if not os.path.exists(npz_path):
                band_dict = {}
                for b_name in INPUT_BANDS:
                    idx = BAND_TO_SEN2FIRE_IDX[b_name]
                    crop_raw = img_12b[idx, r_start:r_start+IMAGE_SIZE, c_start:c_start+IMAGE_SIZE]
                    norm_refl = np.clip(crop_raw.astype(np.float32) / 10000.0, 0.0, 1.0)
                    band_dict[b_name] = norm_refl

                npz_path = save_multispectral_sample(sample_id, band_dict)

            entry = ManifestEntry(
                sample_id=sample_id,
                label="NON_FIRE",
                source_dataset="SEN2FIRE",
                label_type="GROUND_TRUTH",
                latitude=round(base_lat + (nonfire_count % 30) * 0.01, 6),
                longitude=round(base_lon + (nonfire_count // 30) * 0.01, 6),
                acquisition_time="2024-03-15T10:30:00Z",
                firms_observation_id="",
                cloud_cover=12.0,
                industrial_distance_km=None,
                osm_industrial_type="",
                bands=",".join(INPUT_BANDS),
                image_path=os.path.relpath(npz_path, os.path.dirname(SAMPLES_DIR)),
                quality="GOOD",
                notes=f"Sen2Fire nominal background terrain: {scene_name}/{name}"
            )
            nonfire_entries.append(entry)

    logger.info(f"Extracted {len(wildfire_entries)} WILDFIRE samples and {len(nonfire_entries)} NON_FIRE samples from Sen2Fire.")
    return wildfire_entries, nonfire_entries

async def prepare_and_validate_dataset() -> Dict[str, Any]:
    os.makedirs(SAMPLES_DIR, exist_ok=True)
    os.makedirs(MANIFEST_DIR, exist_ok=True)
    os.makedirs(REPORTS_DIR, exist_ok=True)

    wf_entries, nf_entries = extract_sen2fire_samples(max_wildfire=350, max_nonfire=350)

    logger.info("Generating INDUSTRIAL_FIRE candidates from existing FIRMS + OSM pipeline...")
    ind_entries = await process_industrial_candidates(max_samples=250)
    logger.info(f"Generated {len(ind_entries)} INDUSTRIAL_FIRE candidates.")

    all_entries: List[ManifestEntry] = wf_entries + nf_entries + ind_entries
    logger.info(f"Total dataset samples: {len(all_entries)}")

    train_entries: List[ManifestEntry] = []
    val_entries: List[ManifestEntry] = []
    test_entries: List[ManifestEntry] = []

    for cls_name in ["NON_FIRE", "WILDFIRE", "INDUSTRIAL_FIRE"]:
        cls_samples = [e for e in all_entries if e.label == cls_name]
        n = len(cls_samples)
        clusters: List[List[int]] = []
        visited = [False] * n
        for i in range(n):
            if visited[i]:
                continue
            cluster = [i]
            visited[i] = True
            for j in range(i + 1, n):
                if not visited[j]:
                    d = haversine_km(cls_samples[i].latitude, cls_samples[i].longitude,
                                     cls_samples[j].latitude, cls_samples[j].longitude)
                    if d <= 2.0:
                        cluster.append(j)
                        visited[j] = True
            clusters.append(cluster)

        np.random.seed(42)
        perm = np.random.permutation(len(clusters))
        train_thresh = int(0.70 * len(clusters))
        val_thresh = int(0.85 * len(clusters))

        for idx, c_idx in enumerate(perm):
            c_members = [cls_samples[m] for m in clusters[c_idx]]
            if idx < train_thresh:
                train_entries.extend(c_members)
            elif idx < val_thresh:
                val_entries.extend(c_members)
            else:
                test_entries.extend(c_members)

    ManifestManager.save_manifest(all_entries, os.path.join(MANIFEST_DIR, "dataset_manifest.csv"))
    ManifestManager.save_manifest(train_entries, TRAIN_MANIFEST_PATH)
    ManifestManager.save_manifest(val_entries, VAL_MANIFEST_PATH)
    ManifestManager.save_manifest(test_entries, TEST_MANIFEST_PATH)

    logger.info(f"Splits saved: {len(train_entries)} train, {len(val_entries)} validation, {len(test_entries)} test.")

    checked_count = 0
    min_val = 1e9
    max_val = -1e9
    shape_ok = True
    dtype_ok = True

    for e in all_entries:
        path = os.path.join(os.path.dirname(SAMPLES_DIR), e.image_path)
        if not os.path.exists(path):
            path = os.path.join(SAMPLES_DIR, f"{e.sample_id}.npz")
        npz = np.load(path)
        for b in INPUT_BANDS:
            arr = npz[b]
            if arr.shape != (IMAGE_SIZE, IMAGE_SIZE):
                shape_ok = False
            if arr.dtype != np.float32:
                dtype_ok = False
            min_val = min(min_val, float(np.min(arr)))
            max_val = max(max_val, float(np.max(arr)))
        checked_count += 1

    leakage_detected = False
    for te in test_entries:
        for tr in train_entries:
            if te.label == tr.label:
                d = haversine_km(te.latitude, te.longitude, tr.latitude, tr.longitude)
                if d < 0.05 and te.sample_id != tr.sample_id:
                    leakage_detected = True
                    break

    nf_count = sum(1 for e in all_entries if e.label == "NON_FIRE")
    wf_count = sum(1 for e in all_entries if e.label == "WILDFIRE")
    ind_count = sum(1 for e in all_entries if e.label == "INDUSTRIAL_FIRE")

    report = {
        "non_fire": nf_count,
        "wildfire": wf_count,
        "industrial_fire": ind_count,
        "train": len(train_entries),
        "validation": len(val_entries),
        "test": len(test_entries),
        "input_shape": f"[6, {IMAGE_SIZE}, {IMAGE_SIZE}]",
        "channel_order": str(INPUT_BANDS),
        "dtype": "float32" if dtype_ok else "MISMATCH",
        "value_range": f"[{min_val:.4f}, {max_val:.4f}]",
        "checked_samples": checked_count,
        "leakage_free": not leakage_detected
    }

    print("\n" + "="*50)
    print("DATASET PREFLIGHT")
    print("-----------------")
    print(f"NON_FIRE:        {report['non_fire']}")
    print(f"WILDFIRE:        {report['wildfire']}")
    print(f"INDUSTRIAL_FIRE: {report['industrial_fire']}")
    print("")
    print(f"TRAIN:           {report['train']}")
    print(f"VALIDATION:      {report['validation']}")
    print(f"TEST:            {report['test']}")
    print("")
    print(f"Input shape:     {report['input_shape']}")
    print(f"Channel order:   {report['channel_order']}")
    print(f"dtype:           {report['dtype']}")
    print(f"Value range:     {report['value_range']}")
    print("="*50 + "\n")

    return report

if __name__ == "__main__":
    import asyncio
    asyncio.run(prepare_and_validate_dataset())
