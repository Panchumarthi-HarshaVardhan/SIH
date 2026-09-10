import os
import json
import logging
import numpy as np
from PIL import Image
from typing import Dict, Any, Optional, Tuple, List

from app.ml.dataset.config import (
    SAMPLES_DIR,
    ML_PATCH_SIZE,
    MULTISPECTRAL_BANDS
)

logger = logging.getLogger("patch_generator")

MULTISPECTRAL_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B02", "B03", "B04", "B08", "B11", "B12"],
    output: { bands: 6, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  return [sample.B02, sample.B03, sample.B04, sample.B08, sample.B11, sample.B12];
}
"""


def generate_multispectral_patch(
    sample_id: str,
    latitude: float,
    longitude: float,
    label: str,
    cloud_cover: float = 0.0,
    bands_data: Optional[Dict[str, np.ndarray]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    output_dir: str = SAMPLES_DIR,
    patch_size: int = ML_PATCH_SIZE
) -> Tuple[str, str]:
    """
    Creates a standardized NumPy .npz multispectral patch file (B02, B03, B04, B08, B11, B12)
    and an accompanying RGB preview .png for visual inspection.
    Returns (npz_path, preview_png_path).
    """
    os.makedirs(output_dir, exist_ok=True)
    npz_path = os.path.join(output_dir, f"{sample_id}.npz")
    preview_png_path = os.path.join(output_dir, f"{sample_id}_preview.png")

    # If band data is not supplied, create deterministic realistic spectral signature
    if bands_data is None:
        np.random.seed(int(abs(hash(sample_id)) % (2**31)))
        
        # Base reflectance background
        base = np.random.uniform(0.05, 0.20, (patch_size, patch_size)).astype(np.float32)
        
        # Add cloud reflectance if cloud_cover > 0
        if cloud_cover > 0:
            cloud_noise = np.random.uniform(0.0, (cloud_cover / 100.0), (patch_size, patch_size)).astype(np.float32)
            base = np.clip(base + cloud_noise * 0.6, 0.0, 1.0)

        # Spectral characteristics based on class
        if label == "WILDFIRE":
            # High SWIR (B12, B11) in active burning zone, low NIR/Red
            b02 = base * 0.8
            b03 = base * 0.9
            b04 = base * 1.1
            b08 = base * 0.7  # vegetation burn scar
            b11 = np.clip(base * 2.5 + np.random.uniform(0.2, 0.7, (patch_size, patch_size)), 0.0, 1.0).astype(np.float32)
            b12 = np.clip(base * 3.0 + np.random.uniform(0.3, 0.9, (patch_size, patch_size)), 0.0, 1.0).astype(np.float32)
        elif label == "INDUSTRIAL_FIRE":
            # Very localized intense SWIR spike in industrial zone
            b02 = base * 1.0
            b03 = base * 1.0
            b04 = base * 1.2
            b08 = base * 1.1  # built environment / roofs
            b11 = np.clip(base * 2.8 + np.random.uniform(0.2, 0.8, (patch_size, patch_size)), 0.0, 1.0).astype(np.float32)
            b12 = np.clip(base * 3.5 + np.random.uniform(0.3, 1.0, (patch_size, patch_size)), 0.0, 1.0).astype(np.float32)
        else: # NON_FIRE
            # Typical vegetation/soil/urban reflectance (no SWIR thermal anomalies)
            b02 = base * 0.9
            b03 = base * 1.0
            b04 = base * 0.9
            b08 = np.clip(base * 2.2, 0.0, 1.0).astype(np.float32)  # Healthy vegetation NIR peak
            b11 = base * 0.8
            b12 = base * 0.6

        bands_data = {
            "B02": b02.astype(np.float32),
            "B03": b03.astype(np.float32),
            "B04": b04.astype(np.float32),
            "B08": b08.astype(np.float32),
            "B11": b11.astype(np.float32),
            "B12": b12.astype(np.float32),
        }

    meta = metadata or {}
    meta.update({
        "sample_id": sample_id,
        "latitude": latitude,
        "longitude": longitude,
        "label": label,
        "cloud_cover": cloud_cover,
        "patch_size": patch_size,
        "bands": MULTISPECTRAL_BANDS
    })

    # Save .npz archive
    np.savez_compressed(
        npz_path,
        B02=bands_data["B02"],
        B03=bands_data["B03"],
        B04=bands_data["B04"],
        B08=bands_data["B08"],
        B11=bands_data["B11"],
        B12=bands_data["B12"],
        metadata=json.dumps(meta)
    )

    # Generate and save RGB preview PNG (B04: Red, B03: Green, B02: Blue)
    r = np.clip(bands_data["B04"] * 2.5 * 255.0, 0, 255).astype(np.uint8)
    g = np.clip(bands_data["B03"] * 2.5 * 255.0, 0, 255).astype(np.uint8)
    b = np.clip(bands_data["B02"] * 2.5 * 255.0, 0, 255).astype(np.uint8)
    rgb_arr = np.stack([r, g, b], axis=-1)
    img = Image.fromarray(rgb_arr, mode="RGB")
    img.save(preview_png_path, format="PNG")

    return npz_path, preview_png_path


def load_multispectral_patch(npz_path: str) -> Dict[str, Any]:
    """
    Load a multispectral .npz patch and return bands array dict and metadata.
    """
    if not os.path.exists(npz_path):
        raise FileNotFoundError(f"Multispectral patch not found at: {npz_path}")

    with np.load(npz_path) as data:
        meta = {}
        if "metadata" in data:
            try:
                meta = json.loads(str(data["metadata"]))
            except Exception:
                meta = {}

        return {
            "B02": data["B02"],
            "B03": data["B03"],
            "B04": data["B04"],
            "B08": data["B08"],
            "B11": data["B11"],
            "B12": data["B12"],
            "metadata": meta
        }
