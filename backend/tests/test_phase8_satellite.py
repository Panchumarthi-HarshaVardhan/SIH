import unittest
import os
import json
import asyncio
import httpx

from app.services.satellite_service import Sentinel2ImageProvider, calculate_patch_bbox, generate_patch_id
from app.services.image_processing_service import validate_satellite_image, preprocess_satellite_image
from app.services.satellite_classifier import ModularHeuristicVisionClassifier
from app.services.evidence_fusion_service import fuse_thermal_evidence


class TestPhase8SatelliteIntelligence(unittest.TestCase):

    def setUp(self):
        self.client = httpx.Client(base_url="http://127.0.0.1:8000", timeout=60.0)
        self.provider = Sentinel2ImageProvider()
        self.classifier = ModularHeuristicVisionClassifier()
        self.test_lat = 21.1045
        self.test_lon = 72.6402

    def test_calculate_patch_bbox(self):
        min_lon, min_lat, max_lon, max_lat = calculate_patch_bbox(self.test_lat, self.test_lon, radius_km=1.0)
        self.assertLess(min_lon, self.test_lon)
        self.assertGreater(max_lon, self.test_lon)
        self.assertLess(min_lat, self.test_lat)
        self.assertGreater(max_lat, self.test_lat)

    def test_generate_patch_id(self):
        patch_id1 = generate_patch_id(self.test_lat, self.test_lon, "2026-09-01")
        patch_id2 = generate_patch_id(self.test_lat, self.test_lon, "2026-09-01")
        self.assertEqual(patch_id1, patch_id2)
        self.assertTrue(patch_id1.startswith("sat_"))

    def test_sentinel2_provider_fetch(self):
        res = asyncio.run(self.provider.fetch_satellite_image(self.test_lat, self.test_lon, "2026-09-01"))
        self.assertTrue(res["available"])
        self.assertIn("image_path", res)
        self.assertTrue(os.path.exists(res["image_path"]))

    def test_image_preprocessing(self):
        res = asyncio.run(self.provider.fetch_satellite_image(self.test_lat, self.test_lon, "2026-09-01"))
        img_path = res["image_path"]

        valid, err = validate_satellite_image(img_path)
        self.assertTrue(valid)
        self.assertIsNone(err)

        prep_res = preprocess_satellite_image(img_path, target_size=(256, 256))
        self.assertTrue(prep_res["success"])
        self.assertEqual(prep_res["processed_dimensions"], [256, 256])

    def test_satellite_classifier(self):
        res = asyncio.run(self.provider.fetch_satellite_image(self.test_lat, self.test_lon, "2026-09-01"))
        img_path = res["image_path"]

        cv_res = self.classifier.classify_image(img_path, metadata={
            "industrial_distance_km": 0.35,
            "persistence_score": 85.0,
            "frp": 45.0
        })

        self.assertIn(cv_res["classification"], ["INDUSTRIAL_FIRE", "NATURAL_FIRE", "PERSISTENT_THERMAL_SOURCE", "NON_FIRE", "UNKNOWN"])
        self.assertGreaterEqual(cv_res["confidence"], 0.0)
        self.assertLessEqual(cv_res["confidence"], 1.0)
        self.assertTrue(cv_res["image_available"])

    def test_evidence_fusion_service(self):
        spot_dict = {
            "latitude": self.test_lat,
            "longitude": self.test_lon,
            "frp": 55.0,
            "brightness": 348.0,
            "confidence": "high",
            "persistence_score": 90.0,
            "observation_count": 8,
            "duration_hours": 14.5
        }

        osm_ctx = {
            "context_classification": "INDUSTRIAL",
            "nearby_facility": "Surat Steel Mill",
            "distance_km": 0.35
        }

        sat_ev = {
            "image_available": True,
            "classification": "INDUSTRIAL_FIRE",
            "confidence": 0.88,
            "visual_evidence": "Strong thermal core over industrial structure.",
            "source": "Sentinel-2 L2A"
        }

        fused = fuse_thermal_evidence(spot_dict, osm_context=osm_ctx, satellite_evidence=sat_ev)

        self.assertEqual(fused["final_classification"], "INDUSTRIAL_FIRE_CANDIDATE")
        self.assertGreater(fused["combined_confidence"], 0.70)
        self.assertIn("evidence", fused)
        self.assertIn("satellite", fused["evidence"])

    def test_api_satellite_evidence(self):
        response = self.client.get(f"/api/satellite/evidence?lat={self.test_lat}&lon={self.test_lon}&frp=45.0&persistence_score=80.0")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("final_classification", data)
        self.assertIn("combined_confidence", data)
        self.assertIn("evidence", data)
        self.assertIn("satellite", data["evidence"])

    def test_api_satellite_image_serve(self):
        res = asyncio.run(self.provider.fetch_satellite_image(self.test_lat, self.test_lon, "2026-09-01"))
        patch_id = res.get("image_id") or res.get("patch_id") or (res["image_url"].split("/")[-1] if res.get("image_url") else generate_patch_id(self.test_lat, self.test_lon))

        response = self.client.get(f"/api/satellite/image/{patch_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")

    def test_api_incidents_evidence(self):
        list_resp = self.client.get("/api/alerts?limit=1")
        self.assertEqual(list_resp.status_code, 200)
        alerts = list_resp.json().get("alerts", [])
        if alerts:
            alert_id = alerts[0]["alert_id"]
            resp = self.client.get(f"/api/incidents/{alert_id}/evidence")
            if resp.status_code != 200:
                print("FAILED DETAIL:", resp.json())
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["alert_id"], alert_id)
            self.assertIn("multi_modal_evidence", data)

    def test_phase1_to_7_regression(self):
        r_health = self.client.get("/api/health")
        self.assertEqual(r_health.status_code, 200)

        r_hotspots = self.client.get("/api/hotspots?region=india")
        self.assertEqual(r_hotspots.status_code, 200)

        r_context = self.client.get(f"/api/hotspots/context?lat={self.test_lat}&lon={self.test_lon}")
        self.assertEqual(r_context.status_code, 200)

        r_risk = self.client.get(f"/api/hotspots/risk?lat={self.test_lat}&lon={self.test_lon}")
        self.assertEqual(r_risk.status_code, 200)

        r_alerts = self.client.get("/api/alerts")
        self.assertEqual(r_alerts.status_code, 200)


if __name__ == "__main__":
    unittest.main()
