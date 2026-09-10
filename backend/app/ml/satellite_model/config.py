import os
import torch
from typing import List, Dict

import app.config as base_config

# Model and Classification Specifications
INPUT_BANDS: List[str] = ["B02", "B03", "B04", "B08", "B11", "B12"]
NUM_CHANNELS: int = len(INPUT_BANDS)  # 6 bands
IMAGE_SIZE: int = 128

# Canonical Class Mapping (0=NON_FIRE, 1=WILDFIRE, 2=INDUSTRIAL_FIRE)
CLASS_TO_ID: Dict[str, int] = {
    "NON_FIRE": 0,
    "WILDFIRE": 1,
    "INDUSTRIAL_FIRE": 2
}
ID_TO_CLASS: Dict[int, str] = {v: k for k, v in CLASS_TO_ID.items()}
CLASS_NAMES: List[str] = [ID_TO_CLASS[i] for i in range(len(CLASS_TO_ID))]
NUM_CLASSES: int = len(CLASS_TO_ID)

# Hyperparameters
DEFAULT_LR: float = 2e-4
DEFAULT_BATCH_SIZE: int = 16
DEFAULT_EPOCHS: int = 10
DEFAULT_PATIENCE: int = 4
WEIGHT_DECAY: float = 1e-4

# Directories and Manifest Paths
DATA_DIR = base_config.ML_SATELLITE_DATA_DIR
MANIFEST_DIR = base_config.ML_MANIFEST_DIR
SAMPLES_DIR = base_config.ML_SAMPLES_DIR
REPORTS_DIR = base_config.ML_REPORTS_DIR

CHECKPOINTS_DIR = os.path.join(DATA_DIR, "checkpoints")
METRICS_DIR = os.path.join(DATA_DIR, "metrics")
RAW_SEN2FIRE_DIR = os.path.join(DATA_DIR, "raw", "sen2fire")
SEN2FIRE_ZIP_PATH = os.path.join(RAW_SEN2FIRE_DIR, "Sen2Fire.zip")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed", "sen2fire")

TRAIN_MANIFEST_PATH = os.path.join(MANIFEST_DIR, "train.csv")
VAL_MANIFEST_PATH = os.path.join(MANIFEST_DIR, "validation.csv")
TEST_MANIFEST_PATH = os.path.join(MANIFEST_DIR, "test.csv")

# Model Artifacts and Checkpoint Paths
MODEL_DIR = os.path.join(base_config.BACKEND_DIR, "app", "ml", "models")
BEST_MODEL_PATH = os.path.join(MODEL_DIR, "satellite_classifier_best.pth")
MODEL_METADATA_PATH = os.path.join(MODEL_DIR, "satellite_classifier_metadata.json")

# New Canonical Checkpoints
BEST_MODEL_PT = os.path.join(CHECKPOINTS_DIR, "best_model.pt")
LAST_MODEL_PT = os.path.join(CHECKPOINTS_DIR, "last_model.pt")
TRAINING_METADATA_JSON = os.path.join(CHECKPOINTS_DIR, "training_metadata.json")
TRAINING_CONFIG_JSON = os.path.join(CHECKPOINTS_DIR, "training_config.json")
MODEL_METADATA_JSON = os.path.join(CHECKPOINTS_DIR, "model_metadata.json")

# Report & Statistics Paths
NORMALIZATION_STATS_PATH = os.path.join(REPORTS_DIR, "normalization_stats.json")
TRAINING_HISTORY_PATH = os.path.join(METRICS_DIR, "training_history.json")
TEST_METRICS_PATH = os.path.join(METRICS_DIR, "classification_report.json")
CONFUSION_MATRIX_PATH = os.path.join(METRICS_DIR, "confusion_matrix.json")
EVALUATION_REPORT_MD_PATH = os.path.join(REPORTS_DIR, "phase6c_evaluation_report.md")


def get_device() -> torch.device:
    """
    Selects CUDA GPU if available, else Apple Silicon MPS or CPU.
    """
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
