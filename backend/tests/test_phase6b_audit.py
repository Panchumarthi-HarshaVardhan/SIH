import os
import json
import pytest

from app.ml.dataset.config import (
    MAIN_MANIFEST_PATH,
    PHASE6B_AUDIT_REPORT_JSON,
    MULTISPECTRAL_BANDS,
    ALLOWED_LABEL_TYPES
)
from app.ml.dataset.manifest import ManifestManager, ManifestEntry
from app.ml.dataset.audit import run_phase6b_audit


def test_phase6b_audit_execution():
    """Run full Phase 6B dataset audit and verify integrity."""
    report = run_phase6b_audit()
    assert report["audit_status"] == "PASSED"
    assert report["total_samples"] >= 900
    assert report["missing_files_count"] == 0
    assert report["invalid_files_count"] == 0
    assert report["nan_inf_files_count"] == 0
    assert report["duplicate_samples_count"] == 0


def test_phase6b_label_provenance_integrity():
    """Verify that wildfire candidates are correctly labeled SOURCE_LABEL and industrial source is FIRMS_OSM_INDUSTRIAL_WEAK."""
    entries = ManifestManager.load_manifest(MAIN_MANIFEST_PATH)
    assert len(entries) >= 900

    wf_entries = [e for e in entries if e.label == "WILDFIRE"]
    assert len(wf_entries) >= 300
    for wf in wf_entries:
        assert wf.label_type in ("GROUND_TRUTH", "SOURCE_LABEL", "WEAK_LABEL", "MANUAL_REVIEW")
        assert wf.source_dataset in ("SEN2FIRE", "TS_SATFIRE")

    ind_entries = [e for e in entries if e.label == "INDUSTRIAL_FIRE"]
    assert len(ind_entries) == 250
    for ind in ind_entries:
        assert ind.label_type in ("WEAK_LABEL", "MANUAL_REVIEW")
        assert ind.source_dataset in ("FIRMS_OSM_INDUSTRIAL_WEAK", "FIRMS_OSM_SENTINEL2")


def test_phase6b_leakage_and_splits():
    """Verify zero ID and spatial leakage across train, val, and test manifests."""
    report = run_phase6b_audit()
    assert report["leakage_audit"]["status"] == "PASSED"
    assert report["leakage_audit"]["sample_id_overlap"] == 0
    assert report["leakage_audit"]["spatial_cluster_overlap"] == 0
    assert report["samples_per_split"]["train"] > 0
    assert report["samples_per_split"]["validation"] > 0
    assert report["samples_per_split"]["test"] > 0


def test_phase6b_band_completeness():
    """Verify all 6 bands (B02, B03, B04, B08, B11, B12) are present across all patches."""
    report = run_phase6b_audit()
    assert report["band_availability"]["required_bands"] == ["B02", "B03", "B04", "B08", "B11", "B12"]
    assert report["band_availability"]["all_6_bands_present_in_all_patches"] is True
