import os
import json
import logging
import numpy as np
from PIL import Image
import torch
from typing import Dict, Any, Union, List, Optional

from app.ml.satellite_model.config import (
    CLASS_NAMES,
    ID_TO_CLASS,
    INPUT_BANDS,
    BEST_MODEL_PATH,
    BEST_MODEL_PT,
    MODEL_METADATA_PATH,
    TRAINING_METADATA_JSON,
    NORMALIZATION_STATS_PATH,
    get_device
)
from app.ml.satellite_model.model import get_model, MultispectralCNN
from app.ml.satellite_model.transforms import MultispectralTransform
from app.ml.dataset.patch_generator import load_multispectral_patch

logger = logging.getLogger("satellite_inference")


class SatelliteInferenceEngine:
    """
    Inference Engine for 6-band Sentinel-2 Optical Classification.
    Provides fast, deterministic inference on multispectral imagery.
    """

    def __init__(
        self,
        checkpoint_path: Optional[str] = None,
        metadata_path: Optional[str] = None,
        stats_path: str = NORMALIZATION_STATS_PATH,
        device: Optional[torch.device] = None
    ):
        # Prefer new canonical checkpoint path if available
        if checkpoint_path is None:
            if os.path.exists(BEST_MODEL_PT):
                self.checkpoint_path = BEST_MODEL_PT
            else:
                self.checkpoint_path = BEST_MODEL_PATH
        else:
            self.checkpoint_path = checkpoint_path

        if metadata_path is None:
            if os.path.exists(TRAINING_METADATA_JSON):
                self.metadata_path = TRAINING_METADATA_JSON
            else:
                self.metadata_path = MODEL_METADATA_PATH
        else:
            self.metadata_path = metadata_path

        self.stats_path = stats_path
        self.device = device or get_device()
        self.model: Optional[MultispectralCNN] = None
        self.metadata: Dict[str, Any] = {}
        self.transform: Optional[MultispectralTransform] = None

        self._initialize()

    def _initialize(self) -> None:
        # 1. Load Metadata
        if os.path.exists(self.metadata_path):
            try:
                with open(self.metadata_path, "r", encoding="utf-8") as f:
                    self.metadata = json.load(f)
            except Exception as e:
                logger.warning(f"Could not load metadata from {self.metadata_path}: {e}")

        # 2. Load Normalization Stats
        mean = None
        std = None
        if os.path.exists(self.stats_path):
            try:
                with open(self.stats_path, "r", encoding="utf-8") as f:
                    stats = json.load(f)
                    mean = stats.get("mean")
                    std = stats.get("std")
            except Exception as e:
                logger.warning(f"Could not load normalization stats from {self.stats_path}: {e}")

        self.transform = MultispectralTransform(is_train=False, mean=mean, std=std)

        # 3. Load Model Checkpoint
        if os.path.exists(self.checkpoint_path):
            try:
                model = get_model(architecture="resnet18", pretrained=False)
                state = torch.load(self.checkpoint_path, map_location=self.device, weights_only=True)
                model.load_state_dict(state)
                model.to(self.device)
                model.eval()
                self.model = model
                self.is_loaded = True
                logger.info(f"Loaded satellite classifier model from {self.checkpoint_path}")
            except Exception as e:
                logger.error(f"Failed to load checkpoint {self.checkpoint_path}: {e}")
                self.model = None
                self.is_loaded = False
        else:
            logger.warning(f"Model checkpoint not found at {self.checkpoint_path}. Inference engine uninitialized.")
            self.is_loaded = False

    def is_ready(self) -> bool:
        return self.model is not None

    def predict(
        self,
        input_data: Union[str, Dict[str, np.ndarray], torch.Tensor],
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Predict candidate classification for multispectral Sentinel-2 data.
        Input can be:
          - file path to .npz multispectral patch file
          - file path to .png / .jpg optical image file
          - dictionary mapping band names ('B02', 'B03', 'B04', 'B08', 'B11', 'B12') to 2D numpy arrays
          - PyTorch Tensor of shape [6, H, W] or [1, 6, H, W]
        """
        if self.model is None:
            return {
                "predicted_class": "NON_FIRE",
                "predicted_class_id": 0,
                "classification": "NON_FIRE",
                "class_probabilities": {"NON_FIRE": 1.0, "WILDFIRE": 0.0, "INDUSTRIAL_FIRE": 0.0},
                "confidence": 1.0,
                "visual_evidence": "Checkpoint unavailable; returning default neutral classification.",
                "model_version": "uninitialized",
                "model": "Trained 6-Band ResNet-18",
                "input_bands": INPUT_BANDS,
                "available_bands": INPUT_BANDS,
                "image_available": False,
                "is_calibrated": False
            }

        # 1. Format Tensor
        if isinstance(input_data, str):
            if not os.path.exists(input_data):
                return {
                    "predicted_class": "NON_FIRE",
                    "classification": "NON_FIRE",
                    "confidence": 0.0,
                    "visual_evidence": f"File not found: {input_data}",
                    "model": "Trained 6-Band ResNet-18",
                    "image_available": False
                }
            if input_data.endswith(".npz"):
                patch = load_multispectral_patch(input_data)
                band_arrays = [patch[b].astype(np.float32) for b in INPUT_BANDS]
                tensor = torch.from_numpy(np.stack(band_arrays, axis=0))
            else:
                with Image.open(input_data) as img:
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img = img.resize((128, 128))
                    arr = np.array(img, dtype=np.float32) / 255.0
                    b04 = arr[:, :, 0]
                    b03 = arr[:, :, 1]
                    b02 = arr[:, :, 2]
                    # Thermal band heuristics for RGB representation
                    b08 = np.clip(b04 * 0.9 + b03 * 0.1, 0.0, 1.0)
                    b11 = np.clip(b04 * 1.25, 0.0, 1.0)
                    b12 = np.clip(b04 * 1.15, 0.0, 1.0)
                    band_arrays = [b02, b03, b04, b08, b11, b12]
                    tensor = torch.from_numpy(np.stack(band_arrays, axis=0))
        elif isinstance(input_data, dict):
            band_arrays = [input_data[b].astype(np.float32) for b in INPUT_BANDS]
            tensor = torch.from_numpy(np.stack(band_arrays, axis=0))
        elif isinstance(input_data, torch.Tensor):
            tensor = input_data.float()
            if tensor.ndim == 4:
                tensor = tensor.squeeze(0)
        else:
            raise ValueError(f"Unsupported input data type: {type(input_data)}")

        # 2. Preprocess / Normalize
        if self.transform:
            tensor = self.transform(tensor)

        if tensor.ndim == 3:
            tensor = tensor.unsqueeze(0)  # Shape [1, 6, H, W]

        # 3. Model Forward Pass
        tensor = tensor.to(self.device)
        with torch.no_grad():
            logits = self.model(tensor)
            probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
            pred_id = int(np.argmax(probs))

        pred_class = ID_TO_CLASS[pred_id]
        conf = float(round(probs[pred_id], 4))
        prob_dict = {
            CLASS_NAMES[i]: float(round(probs[i], 4)) for i in range(len(CLASS_NAMES))
        }

        # Evidence Summary text
        if pred_class == "INDUSTRIAL_FIRE":
            evidence_summary = (
                f"Trained 6-Band ResNet-18 detected active combustion signature over industrial infrastructure "
                f"with {conf * 100:.1f}% confidence across Sentinel-2 bands B02-B12."
            )
        elif pred_class == "WILDFIRE":
            evidence_summary = (
                f"Trained 6-Band ResNet-18 confirmed vegetative wildfire combustion anomaly "
                f"with {conf * 100:.1f}% confidence."
            )
        else:
            evidence_summary = (
                f"Trained 6-Band ResNet-18 classified nominal terrain (no thermal anomaly) "
                f"with {conf * 100:.1f}% confidence."
            )

        return {
            "predicted_class": pred_class,
            "predicted_class_id": pred_id,
            "classification": pred_class,
            "class_probabilities": prob_dict,
            "confidence": conf,
            "visual_evidence": evidence_summary,
            "model_version": self.metadata.get("model_version", "1.0"),
            "model_architecture": "MultispectralResNet18",
            "model": "Trained 6-Band ResNet-18",
            "input_bands": INPUT_BANDS,
            "available_bands": INPUT_BANDS,
            "image_available": True,
            "is_calibrated": False
        }


# Singleton engine instance
_engine_instance: Optional[SatelliteInferenceEngine] = None


def get_inference_engine() -> SatelliteInferenceEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = SatelliteInferenceEngine()
    return _engine_instance


def predict_multispectral(
    input_data: Union[str, Dict[str, np.ndarray], torch.Tensor]
) -> Dict[str, Any]:
    """
    Public helper for multispectral candidate prediction.
    """
    engine = get_inference_engine()
    return engine.predict(input_data)
