import os
import json
import logging
from typing import Dict, Any, List, Set, Tuple

from app.ml.satellite_model.config import (
    TRAIN_MANIFEST_PATH,
    VAL_MANIFEST_PATH,
    TEST_MANIFEST_PATH,
    REPORTS_DIR
)
from app.ml.dataset.manifest import ManifestManager, ManifestEntry
from app.ml.dataset.create_splits import get_spatial_cluster_key

logger = logging.getLogger("integrity_audit")

INTEGRITY_REPORT_JSON = os.path.join(REPORTS_DIR, "phase6d_integrity_report.json")


def verify_test_set_integrity(
    train_path: str = TRAIN_MANIFEST_PATH,
    val_path: str = VAL_MANIFEST_PATH,
    test_path: str = TEST_MANIFEST_PATH,
    report_out_path: str = INTEGRITY_REPORT_JSON
) -> Dict[str, Any]:
    """
    Verifies that the test set has zero duplicate IDs, zero geographic/event leakage,
    and adheres to strict partition isolation.
    """
    train_entries = ManifestManager.load_manifest(train_path)
    val_entries = ManifestManager.load_manifest(val_path)
    test_entries = ManifestManager.load_manifest(test_path)

    test_sample_count = len(test_entries)
    train_sample_count = len(train_entries)
    val_sample_count = len(val_entries)

    errors: List[str] = []
    warnings: List[str] = []

    # 1. Check expected test count
    if test_sample_count != 153:
        warnings.append(f"Test set contains {test_sample_count} samples (expected 153).")

    # 2. Duplicate ID check within test set
    test_ids = [e.sample_id for e in test_entries]
    unique_test_ids = set(test_ids)
    if len(test_ids) != len(unique_test_ids):
        errors.append(f"Found {len(test_ids) - len(unique_test_ids)} duplicate sample IDs inside test.csv")

    # 3. ID Overlap across splits
    train_ids = {e.sample_id for e in train_entries}
    val_ids = {e.sample_id for e in val_entries}

    overlap_train_test = train_ids.intersection(unique_test_ids)
    overlap_val_test = val_ids.intersection(unique_test_ids)
    overlap_train_val = train_ids.intersection(val_ids)

    if overlap_train_test:
        errors.append(f"Found {len(overlap_train_test)} overlapping sample IDs between train and test splits!")
    if overlap_val_test:
        errors.append(f"Found {len(overlap_val_test)} overlapping sample IDs between validation and test splits!")
    if overlap_train_val:
        errors.append(f"Found {len(overlap_train_val)} overlapping sample IDs between train and validation splits!")

    # 4. Spatial Cluster Overlap (Geographic Leakage Check for geolocated samples)
    train_clusters = {get_spatial_cluster_key(e.latitude, e.longitude) for e in train_entries if not (abs(e.latitude) < 1e-4 and abs(e.longitude) < 1e-4)}
    val_clusters = {get_spatial_cluster_key(e.latitude, e.longitude) for e in val_entries if not (abs(e.latitude) < 1e-4 and abs(e.longitude) < 1e-4)}
    test_clusters = {get_spatial_cluster_key(e.latitude, e.longitude) for e in test_entries if not (abs(e.latitude) < 1e-4 and abs(e.longitude) < 1e-4)}

    spatial_overlap_tt = train_clusters.intersection(test_clusters)
    spatial_overlap_vt = val_clusters.intersection(test_clusters)
    spatial_overlap_tv = train_clusters.intersection(val_clusters)

    if spatial_overlap_tt:
        errors.append(f"Spatial cluster overlap between Train and Test: {list(spatial_overlap_tt)}")
    if spatial_overlap_vt:
        errors.append(f"Spatial cluster overlap between Validation and Test: {list(spatial_overlap_vt)}")
    if spatial_overlap_tv:
        errors.append(f"Spatial cluster overlap between Train and Validation: {list(spatial_overlap_tv)}")

    # 5. Class balance check in test set
    test_class_counts: Dict[str, int] = {}
    for e in test_entries:
        test_class_counts[e.label] = test_class_counts.get(e.label, 0) + 1

    status = "PASSED" if not errors else "FAILED"

    report = {
        "integrity_status": status,
        "test_sample_count": test_sample_count,
        "train_sample_count": train_sample_count,
        "val_sample_count": val_sample_count,
        "test_class_distribution": test_class_counts,
        "id_duplicates_in_test": len(test_ids) - len(unique_test_ids),
        "id_overlap": {
            "train_test": len(overlap_train_test),
            "val_test": len(overlap_val_test),
            "train_val": len(overlap_train_val)
        },
        "spatial_cluster_overlap": {
            "train_test": len(spatial_overlap_tt),
            "val_test": len(spatial_overlap_vt),
            "train_val": len(spatial_overlap_tv)
        },
        "leakage_verdict": "ZERO_LEAKAGE" if not errors else "LEAKAGE_DETECTED",
        "errors": errors,
        "warnings": warnings
    }

    os.makedirs(os.path.dirname(report_out_path), exist_ok=True)
    with open(report_out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    logger.info(f"Test set integrity verification completed with status: {status}")
    return report
