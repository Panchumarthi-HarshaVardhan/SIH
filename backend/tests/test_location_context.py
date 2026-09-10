import pytest
import asyncio
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from app.main import app
from app.config import OSM_CONTEXT_RADIUS_KM, OSM_REQUEST_TIMEOUT_SECONDS
from app.services.location_context_service import (
    LocationContextEngine,
    calculate_proximity_score,
    calculate_feature_score,
    get_location_context_engine,
)
from app.services.osm_service import haversine_distance_km
from app.schemas.investigation import (
    LocationContext,
    NearbyFeature,
    PossibleCause,
    InvestigationResponse,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_location_cache():
    engine = get_location_context_engine()
    engine.clear_cache()
    yield
    engine.clear_cache()


# ==============================================================================
# 1. HAVERSINE & GEODESIC DISTANCE TESTS
# ==============================================================================

def test_haversine_distance_exactness():
    """
    Test 1: Haversine distance calculation is exact and within expected geodesic bounds.
    Between (20.9692, 86.0071) and (20.9640, 86.0074) is approximately 0.58 km.
    """
    lat1, lon1 = 20.9692, 86.0071
    lat2, lon2 = 20.9640, 86.0074
    dist = haversine_distance_km(lat1, lon1, lat2, lon2)
    assert 0.50 <= dist <= 0.70, f"Expected approx 0.58 km, got {dist}"
    assert haversine_distance_km(lat1, lon1, lat1, lon1) == 0.0


def test_proximity_score_decay():
    """
    Test 2: Proximity decay curve correctly favors proximate features (<0.5km = 1.0 -> 0.9, 5km = 0.0).
    """
    assert calculate_proximity_score(0.1, 5.0) >= 0.95
    assert calculate_proximity_score(0.5, 5.0) == 0.90
    assert calculate_proximity_score(1.0, 5.0) == 0.70
    assert calculate_proximity_score(2.0, 5.0) == 0.40
    assert calculate_proximity_score(5.0, 5.0) == 0.0
    assert calculate_proximity_score(6.0, 5.0) == 0.0


# ==============================================================================
# 2. FEATURE SCORING & DETERMINISTIC RANKING TESTS
# ==============================================================================

def test_feature_scoring_and_ranking():
    """
    Test 3: Nearby industrial facility ranks higher than distant or minor features.
    """
    score_near_ind, rel_near = calculate_feature_score(
        distance_km=0.4,
        category="INDUSTRIAL",
        firms_frp=35.0,
        persistence_score=75.0,
        max_radius_km=5.0
    )
    score_dist_ind, rel_dist = calculate_feature_score(
        distance_km=4.2,
        category="INDUSTRIAL",
        firms_frp=35.0,
        persistence_score=75.0,
        max_radius_km=5.0
    )

    assert score_near_ind > score_dist_ind
    assert rel_near == "HIGH"
    assert rel_dist in ["LOW", "MEDIUM"]


# ==============================================================================
# 3. INDUSTRIAL CONTEXT TEST
# ==============================================================================

def test_industrial_context_resolution():
    """
    Test 4: Incident located near industrial facilities resolves to INDUSTRIAL_CONTEXT.
    """
    async def _run():
        engine = LocationContextEngine(radius_km=5.0)

        mock_osm_elements = [
            {
                "id": "node/101",
                "name": "Heavy Steel Works",
                "type": "Industrial Manufacturing Facility",
                "category": "INDUSTRIAL",
                "latitude": 20.9710,
                "longitude": 86.0090,
                "distance_km": 0.28,
                "tags": {"industrial": "steel"}
            },
            {
                "id": "node/102",
                "name": "Electrical Substation Alpha",
                "type": "Electrical Substation",
                "category": "INFRASTRUCTURE",
                "latitude": 20.9750,
                "longitude": 86.0120,
                "distance_km": 0.82,
                "tags": {"power": "substation"}
            }
        ]

        with patch.object(engine, "query_osm_features", new_callable=AsyncMock) as mock_q, \
             patch.object(engine, "resolve_geographic_locality", new_callable=AsyncMock) as mock_geo:
            mock_q.return_value = mock_osm_elements
            mock_geo.return_value = {"locality": "Duburi", "district": "Jajpur", "state": "Odisha", "country": "India"}

            result = await engine.analyze_location_context(
                lat=20.9692,
                lon=86.0071,
                firms_data={"frp": 28.5, "brightness": 342.0},
                persistence_data={"score": 80.0}
            )

            assert result.classification == "INDUSTRIAL_CONTEXT"
            assert result.confidence >= 0.70
            assert result.confidence_label in ["HIGH", "MEDIUM"]
            assert result.locality == "Duburi"
            assert result.district == "Jajpur"
            assert result.state == "Odisha"
            assert result.possible_cause is not None
            assert result.possible_cause.category == "INDUSTRIAL_ACTIVITY"
            assert "Heavy Steel Works" in result.possible_cause.likely_source
            assert len(result.nearby_features) == 2
            assert result.nearby_features[0].category == "INDUSTRIAL"

    asyncio.run(_run())


# ==============================================================================
# 4. INFRASTRUCTURE CONTEXT TEST
# ==============================================================================

def test_infrastructure_context_resolution():
    """
    Test 5: Incident near an electrical substation with no nearby factory resolves to INFRASTRUCTURE_CONTEXT.
    """
    async def _run():
        engine = LocationContextEngine(radius_km=5.0)

        mock_osm_elements = [
            {
                "id": "node/201",
                "name": "Thermal Power Substation",
                "type": "Electrical Substation",
                "category": "INFRASTRUCTURE",
                "latitude": 21.5020,
                "longitude": 84.1020,
                "distance_km": 0.45,
                "tags": {"power": "substation"}
            }
        ]

        with patch.object(engine, "query_osm_features", new_callable=AsyncMock) as mock_q, \
             patch.object(engine, "resolve_geographic_locality", new_callable=AsyncMock) as mock_geo:
            mock_q.return_value = mock_osm_elements
            mock_geo.return_value = {"locality": "Sambalpur Area", "district": "Sambalpur", "state": "Odisha", "country": "India"}

            result = await engine.analyze_location_context(
                lat=21.5000,
                lon=84.1000,
                firms_data={"frp": 15.0, "brightness": 328.0}
            )

            assert result.classification == "INFRASTRUCTURE_CONTEXT"
            assert result.possible_cause is not None
            assert result.possible_cause.category == "ENERGY_INFRASTRUCTURE"
            assert "substation" in result.possible_cause.likely_source.lower()

    asyncio.run(_run())


# ==============================================================================
# 5. WILDFIRE / FOREST CONTEXT TEST
# ==============================================================================

def test_wildfire_context_resolution():
    """
    Test 6: Forest/Woodland dominant without proximate industrial infrastructure resolves to WILDFIRE_CONTEXT.
    """
    async def _run():
        engine = LocationContextEngine(radius_km=5.0)

        mock_osm_elements = [
            {
                "id": "way/301",
                "name": "Similipal Tiger Reserve Forest",
                "type": "Forest / Woodland",
                "category": "ENVIRONMENTAL",
                "latitude": 21.8500,
                "longitude": 86.3500,
                "distance_km": 0.65,
                "tags": {"natural": "wood", "landuse": "forest"}
            }
        ]

        with patch.object(engine, "query_osm_features", new_callable=AsyncMock) as mock_q, \
             patch.object(engine, "resolve_geographic_locality", new_callable=AsyncMock) as mock_geo:
            mock_q.return_value = mock_osm_elements
            mock_geo.return_value = {"locality": "Similipal", "district": "Mayurbhanj", "state": "Odisha", "country": "India"}

            result = await engine.analyze_location_context(
                lat=21.8450,
                lon=86.3450,
                firms_data={"frp": 45.0, "brightness": 355.0}
            )

            assert result.classification == "WILDFIRE_CONTEXT"
            assert result.possible_cause is not None
            assert result.possible_cause.category == "NATURAL_VEGETATION"
            assert "forest" in result.possible_cause.likely_source.lower()

    asyncio.run(_run())


# ==============================================================================
# 6. AGRICULTURAL CONTEXT TEST
# ==============================================================================

def test_agricultural_context_resolution():
    """
    Test 7: Farmland/Crop fields dominant resolves to AGRICULTURAL_CONTEXT (distinguished from wildfire).
    """
    async def _run():
        engine = LocationContextEngine(radius_km=5.0)

        mock_osm_elements = [
            {
                "id": "way/401",
                "name": "Paddy Cultivation Farmland",
                "type": "Agricultural / Farmland",
                "category": "AGRICULTURAL",
                "latitude": 30.5020,
                "longitude": 75.8020,
                "distance_km": 0.35,
                "tags": {"landuse": "farmland"}
            }
        ]

        with patch.object(engine, "query_osm_features", new_callable=AsyncMock) as mock_q, \
             patch.object(engine, "resolve_geographic_locality", new_callable=AsyncMock) as mock_geo:
            mock_q.return_value = mock_osm_elements
            mock_geo.return_value = {"locality": "Ludhiana Rural", "district": "Ludhiana", "state": "Punjab", "country": "India"}

            result = await engine.analyze_location_context(
                lat=30.5000,
                lon=75.8000,
                firms_data={"frp": 12.0, "brightness": 325.0}
            )

            assert result.classification == "AGRICULTURAL_CONTEXT"
            assert result.possible_cause is not None
            assert result.possible_cause.category == "AGRICULTURAL_ACTIVITY"
            assert "farmland" in result.possible_cause.likely_source.lower() or "crop" in result.possible_cause.likely_source.lower()

    asyncio.run(_run())


# ==============================================================================
# 7. NO CLEAR CONTEXT TEST
# ==============================================================================

def test_no_clear_context_resolution():
    """
    Test 8: Sparse or remote location with no mapped features inside 5 km returns NO_CLEAR_CONTEXT.
    """
    async def _run():
        engine = LocationContextEngine(radius_km=5.0)

        with patch.object(engine, "query_osm_features", new_callable=AsyncMock) as mock_q, \
             patch.object(engine, "resolve_geographic_locality", new_callable=AsyncMock) as mock_geo:
            mock_q.return_value = []
            mock_geo.return_value = {"locality": None, "district": "Barmer", "state": "Rajasthan", "country": "India"}

            result = await engine.analyze_location_context(lat=26.0000, lon=71.0000)

            assert result.classification == "NO_CLEAR_CONTEXT"
            assert result.primary_context == "NO_CLEAR_CONTEXT"
            assert result.possible_cause is not None
            assert result.possible_cause.category == "UNRESOLVED"
            assert len(result.nearby_features) == 0

    asyncio.run(_run())


# ==============================================================================
# 8. OSM SERVICE TIMEOUT & FAULT ISOLATION TEST
# ==============================================================================

def test_osm_timeout_fault_isolation():
    """
    Test 9: External OSM network timeout does not crash the LocationContextEngine.
    """
    async def _run():
        engine = LocationContextEngine(radius_km=5.0)

        with patch.object(engine, "query_osm_features", side_effect=Exception("Overpass Gateway Timeout")), \
             patch.object(engine, "resolve_geographic_locality", new_callable=AsyncMock) as mock_geo:
            mock_geo.return_value = {"locality": None, "district": None, "state": "Odisha", "country": "India"}

            result = await engine.analyze_location_context(lat=20.9692, lon=86.0071)

            assert result.classification == "NO_CLEAR_CONTEXT"
            assert result.status == "UNAVAILABLE"
            assert result.confidence == 0.0

    asyncio.run(_run())


# ==============================================================================
# 9. END-TO-END INVESTIGATION API INTEGRATION TEST
# ==============================================================================

def test_unknown_classification_triggers_location_context_api():
    """
    Test 10: Calling /api/firms/{id}/investigation on an observation with UNKNOWN candidate_class
    automatically triggers and attaches location_context and possible_cause.
    """
    resp = client.get("/api/firms/38cb8f6cd5acfc82/investigation?force_refresh=false")
    assert resp.status_code == 200
    data = resp.json()

    # Validate against InvestigationResponse schema
    validated = InvestigationResponse(**data)
    assert validated.observation_id == "38cb8f6cd5acfc82"
    assert validated.fusion.candidate_class in ["UNKNOWN", "INDUSTRIAL_FIRE", "WILDFIRE", "NON_FIRE"]

    # Location context must be present
    assert validated.location_context is not None
    assert validated.location_context.radius_km == 5.0
    assert validated.location_context.country == "India"
    assert validated.location_context.classification in [
        "INDUSTRIAL_CONTEXT",
        "INFRASTRUCTURE_CONTEXT",
        "WILDFIRE_CONTEXT",
        "AGRICULTURAL_CONTEXT",
        "TRANSPORT_CONTEXT",
        "RESIDENTIAL_CONTEXT",
        "MIXED_CONTEXT",
        "NO_CLEAR_CONTEXT"
    ]
    assert validated.possible_cause is not None
    assert validated.possible_cause.category is not None
    assert len(validated.nearby_features) >= 0


def test_osm_failure_does_not_break_api_status_200():
    """
    Test 11: Total failure of OSM Overpass does NOT crash API (HTTP 200 maintained).
    """
    with patch("app.services.location_context_service.LocationContextEngine.query_osm_features", side_effect=Exception("Total OSM Network Down")):
        resp = client.get("/api/firms/38cb8f6cd5acfc82/investigation?force_refresh=true")
        assert resp.status_code == 200
        data = resp.json()
        assert data["observation_id"] == "38cb8f6cd5acfc82"
        assert "location_context" in data


# ==============================================================================
# 5. PRIORITY INCIDENTS OSM HIERARCHY & REVERSE GEOCODE TESTS
# ==============================================================================

def test_resolve_osm_locality_named_facility():
    """
    Test 12: Anomaly located at named facility (e.g. Tata Steel) resolves facility as Primary Name.
    Hierarchy:
      - Line 1 (Primary Name): Tata Steel
      - Line 2 (Locality / State): Locality and State (e.g. Duburi, Odisha or Odisha)
    """
    from app.services.osm_service import resolve_osm_locality
    res = asyncio.run(resolve_osm_locality(20.96, 86.01))
    assert res is not None
    assert res.get("primary_name") == "TATA Steel"
    assert "Odisha" in (res.get("secondary_locality") or "")
    assert res.get("facility_name") == "TATA Steel"


def test_resolve_osm_locality_administrative_fallback():
    """
    Test 13: Anomaly with no named facility falls back to administrative hierarchy (City/Town/Suburb).
    """
    from app.services.osm_service import resolve_osm_locality
    res = asyncio.run(resolve_osm_locality(16.30, 80.44))
    assert res is not None
    assert res.get("primary_name") is not None
    assert res.get("primary_name") != "Tata Steel"
    assert "Andhra Pradesh" in (res.get("secondary_locality") or "")


def test_resolve_osm_locality_caching():
    """
    Test 14: Repeated calls for the same coordinates hit the in-memory cache.
    """
    from app.services.osm_service import resolve_osm_locality, _nominatim_cache
    lat, lon = 20.96, 86.01
    nom_key = (round(lat, 3), round(lon, 3))
    assert nom_key in _nominatim_cache

    res1 = asyncio.run(resolve_osm_locality(lat, lon))
    res2 = asyncio.run(resolve_osm_locality(lat, lon))
    assert res1 == res2


def test_reverse_geocode_api_endpoint():
    """
    Test 15: /api/hotspots/reverse-geocode endpoint returns primary_name and secondary_locality.
    """
    resp = client.get("/api/hotspots/reverse-geocode?lat=20.96&lon=86.01")
    assert resp.status_code == 200
    data = resp.json()
    assert data["latitude"] == 20.96
    assert data["longitude"] == 86.01
    assert data["primary_name"] == "TATA Steel"
    assert "Odisha" in data["secondary_locality"]

