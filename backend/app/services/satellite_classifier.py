import os
import time
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from PIL import Image

from app.config import SATELLITE_CLASSIFIER, SATELLITE_MODEL_DIR
from app.services.image_processing_service import validate_satellite_image

logger = logging.getLogger(__name__)

# Target Architecture Dataset Classes (Step 3)
SATELLITE_CLASSES = [
    "NON_FIRE",
    "NATURAL_FIRE",
    "INDUSTRIAL_FIRE",
    "PERSISTENT_THERMAL_SOURCE",
    "UNKNOWN"
]


class BaseSatelliteImageClassifier(ABC):
    """Abstract interface for Satellite Image Classifiers (CNN, Vision Transformer, Heuristic, etc.)."""

    @abstractmethod
    def classify_image(self, image_path: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Classify satellite image patch and return visual classification details."""
        pass


class TrainedSatelliteVisionClassifier(BaseSatelliteImageClassifier):
    """
    Production Trainable Computer Vision Model Classifier Adapter (Step 13).
    Wraps trained PyTorch vision model (ResNet18 / EfficientNet-B0) loaded from models/satellite_classifier/best_model.pth.
    Implements BaseSatelliteImageClassifier interface and incorporates Grad-CAM visual explanations.
    """

    def __init__(self, model_dir: str = SATELLITE_MODEL_DIR):
        self.model_dir = model_dir
        self.engine = None
        self.is_multispectral = False
        self._init_engine()

    def _init_engine(self):
        # 1. Prioritize trained 6-Band Sentinel-2 ResNet-18 model
        try:
            from app.ml.satellite_model.inference import get_inference_engine
            ms_engine = get_inference_engine()
            if ms_engine.is_ready():
                self.engine = ms_engine
                self.is_multispectral = True
                logger.info("TrainedSatelliteVisionClassifier using trained 6-Band MultispectralResNet18.")
                return
        except Exception as e:
            logger.warning(f"Could not load 6-band multispectral engine: {e}")

        # 2. Fallback to legacy PyTorch inference engine
        try:
            from app.ml.inference import get_inference_engine
            self.engine = get_inference_engine()
            self.is_multispectral = False
        except Exception as e:
            logger.error(f"Failed to initialize PyTorch inference engine: {e}")
            self.engine = None

    def classify_image(self, image_path: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

        if getattr(self, "is_multispectral", False) and self.engine and self.engine.is_ready():
            res = self.engine.predict(image_path, metadata=metadata)
            res["timestamp"] = timestamp_str
            return res

        if not self.engine or not getattr(self.engine, "is_loaded", False):
            return {
                "classification": "UNKNOWN",
                "confidence": 0.0,
                "visual_evidence": "Trained PyTorch vision model is uninitialized or missing trained weights checkpoint.",
                "model": "trained_cv_model",
                "model_version": "1.0",
                "model_type": "trained_cv_model",
                "timestamp": timestamp_str,
                "image_available": False,
                "features": {}
            }

        result = self.engine.predict_patch(image_path, metadata=metadata)
        result["timestamp"] = timestamp_str

        # Generate Grad-CAM visual explanation overlay if image exists
        if result.get("image_available") and image_path and os.path.exists(image_path):
            try:
                from app.ml.gradcam import generate_gradcam_explanation
                cam_res = generate_gradcam_explanation(image_path)
                if cam_res.get("success"):
                    result["gradcam_overlay_path"] = cam_res.get("heatmap_path")
                    result["gradcam_region"] = cam_res.get("highlighted_region")
            except Exception as e:
                logger.warning(f"Grad-CAM overlay error: {e}")

        return result


class ModularHeuristicVisionClassifier(BaseSatelliteImageClassifier):
    """
    Modular Multi-Spectral Satellite Image Classifier (Step 14).
    Fallback heuristic classifier used when trained model weights are unavailable.
    """

    def __init__(self):
        self.model_name = "ModularHeuristicVisionClassifier-v1.0"
        self.model_type = "heuristic_fallback"

    def classify_image(self, image_path: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
        meta = metadata or {}

        if not image_path or not os.path.exists(image_path):
            return {
                "classification": "UNKNOWN",
                "confidence": 0.0,
                "visual_evidence": "Satellite image patch unavailable for computer vision classification.",
                "model": self.model_name,
                "model_type": self.model_type,
                "timestamp": timestamp_str,
                "image_available": False,
                "features": {}
            }

        is_valid, err = validate_satellite_image(image_path)
        if not is_valid:
            return {
                "classification": "UNKNOWN",
                "confidence": 0.0,
                "visual_evidence": f"Satellite image validation failed: {err}",
                "model": self.model_name,
                "model_type": self.model_type,
                "timestamp": timestamp_str,
                "image_available": False,
                "features": {}
            }

        try:
            with Image.open(image_path) as img:
                if img.mode != "RGB":
                    img = img.convert("RGB")

                pixels = list(img.getdata())
                total_pixels = len(pixels)

                r_sum = sum(p[0] for p in pixels)
                g_sum = sum(p[1] for p in pixels)
                b_sum = sum(p[2] for p in pixels)

                r_avg = r_sum / total_pixels
                g_avg = g_sum / total_pixels
                b_avg = b_sum / total_pixels

                heat_core_pixels = sum(1 for p in pixels if p[0] > 200 and p[1] > 100)
                heat_core_ratio = round(heat_core_pixels / total_pixels, 4)

                spectral_thermal_index = round((r_avg - (g_avg + b_avg) / 2.0) / 255.0, 4)

                industrial_dist = meta.get("industrial_distance_km")
                is_industrial = industrial_dist is not None and industrial_dist <= 1.5
                persistence_score = float(meta.get("persistence_score", 0.0))
                frp = float(meta.get("frp", 0.0))

                if heat_core_ratio > 0.02 or spectral_thermal_index > 0.35 or frp > 35.0:
                    if is_industrial or meta.get("is_industrial_zone") == 1:
                        classification = "INDUSTRIAL_FIRE"
                        confidence = min(0.95, round(0.70 + (heat_core_ratio * 2.0) + (0.15 if is_industrial else 0.0), 2))
                        evidence = f"Optical imagery displays strong thermal heat core signature ({heat_core_ratio * 100:.1f}% patch area) localized directly over industrial infrastructure."
                    else:
                        classification = "NATURAL_FIRE"
                        confidence = min(0.92, round(0.65 + (heat_core_ratio * 2.5), 2))
                        evidence = f"Optical satellite imagery confirms active thermal combustion signature ({heat_core_ratio * 100:.1f}% patch area) in non-industrial terrain."
                elif persistence_score >= 60.0:
                    classification = "PERSISTENT_THERMAL_SOURCE"
                    confidence = min(0.90, round(0.60 + (persistence_score / 250.0), 2))
                    evidence = f"Satellite multi-spectral patch confirms persistent thermal emissions over repeated observations (Persistence Score: {persistence_score:.1f}/100)."
                elif heat_core_ratio == 0.0 and spectral_thermal_index < 0.1 and frp < 5.0:
                    classification = "NON_FIRE"
                    confidence = 0.85
                    evidence = "Satellite optical patch displays nominal ground reflectivity with no detectable thermal anomaly signature."
                else:
                    classification = "UNKNOWN"
                    confidence = 0.50
                    evidence = "Satellite imagery evidence is inconclusive. Additional optical/SAR observations required."

                return {
                    "classification": classification,
                    "confidence": confidence,
                    "visual_evidence": evidence,
                    "model": self.model_name,
                    "model_type": self.model_type,
                    "timestamp": timestamp_str,
                    "image_available": True,
                    "features": {
                        "heat_core_ratio": heat_core_ratio,
                        "red_channel_mean": round(r_avg, 2),
                        "green_channel_mean": round(g_avg, 2),
                        "blue_channel_mean": round(b_avg, 2),
                        "spectral_thermal_index": spectral_thermal_index
                    }
                }
        except Exception as ex:
            logger.error(f"Satellite image classification error: {ex}")
            return {
                "classification": "UNKNOWN",
                "confidence": 0.0,
                "visual_evidence": f"Classification error: {str(ex)}",
                "model": self.model_name,
                "model_type": self.model_type,
                "timestamp": timestamp_str,
                "image_available": True,
                "features": {}
            }


# Singleton classifier instance
_classifier_instance: Optional[BaseSatelliteImageClassifier] = None


def get_satellite_classifier() -> BaseSatelliteImageClassifier:
    """
    Factory function returning configured SatelliteImageClassifier instance.
    Checks config SATELLITE_CLASSIFIER ('trained' or 'heuristic') and model weights availability on disk.
    Defaults safely to TrainedSatelliteVisionClassifier when weights exist, or ModularHeuristicVisionClassifier fallback.
    """
    global _classifier_instance

    from app.ml.satellite_model.config import BEST_MODEL_PT
    weights_path = os.path.join(SATELLITE_MODEL_DIR, "best_model.pth")
    has_weights = os.path.exists(BEST_MODEL_PT) or os.path.exists(weights_path)
    use_trained = (SATELLITE_CLASSIFIER.lower() == "trained") or has_weights

    if _classifier_instance is None:
        if use_trained and has_weights:
            logger.info("Initializing TrainedSatelliteVisionClassifier with PyTorch 6-Band / ResNet model weights.")
            _classifier_instance = TrainedSatelliteVisionClassifier(model_dir=SATELLITE_MODEL_DIR)
        else:
            logger.info("Initializing ModularHeuristicVisionClassifier fallback.")
            _classifier_instance = ModularHeuristicVisionClassifier()

    return _classifier_instance
