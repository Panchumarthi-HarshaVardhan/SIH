import os
import math
import time
import logging
from typing import Dict, Any, List, Optional, Tuple
import httpx

from app.config import OSM_CONTEXT_RADIUS_KM, OSM_REQUEST_TIMEOUT_SECONDS
from app.schemas.investigation import (
    NearbyFeature,
    PossibleCause,
    LocationContext,
)
from app.services.osm_service import (
    haversine_distance_km,
    OVERPASS_SERVERS,
    USER_AGENT,
    _categorize_osm_tags,
)

logger = logging.getLogger("location_context_service")

# In-memory cache for location context results: (round_lat, round_lon, radius_km) -> (timestamp, LocationContext dict)
_location_context_cache: Dict[Tuple[float, float, float], Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 1800  # 30 minutes cache TTL


# Category-specific baseline relevance weights
CATEGORY_RELEVANCE_WEIGHTS = {
    "INDUSTRIAL": 0.95,
    "INFRASTRUCTURE": 0.90,
    "ENVIRONMENTAL": 0.85,
    "AGRICULTURAL": 0.75,
    "TRANSPORT": 0.70,
    "RESIDENTIAL": 0.60,
    "HEALTHCARE": 0.80,
    "EDUCATION": 0.70,
    "CRITICAL_INFRASTRUCTURE": 0.90,
    "UNCLASSIFIED": 0.40,
}


def calculate_proximity_score(distance_km: float, max_radius_km: float = 5.0) -> float:
    """
    Computes a non-linear proximity score in [0.0, 1.0] favoring proximate features:
      - 0 to 0.5 km: Extremely strong (1.0 to 0.9)
      - 0.5 to 1.0 km: Strong (0.9 to 0.7)
      - 1.0 to 2.0 km: Moderate (0.7 to 0.4)
      - 2.0 to 5.0 km: Contextual (0.4 to 0.0)
      - > 5.0 km: 0.0
    """
    d = max(0.0, float(distance_km))
    if d <= 0.5:
        return round(1.0 - (d / 0.5) * 0.1, 4)
    elif d <= 1.0:
        return round(0.9 - ((d - 0.5) / 0.5) * 0.2, 4)
    elif d <= 2.0:
        return round(0.7 - ((d - 1.0) / 1.0) * 0.3, 4)
    elif d <= max_radius_km:
        return round(max(0.0, 0.4 - ((d - 2.0) / max(0.1, max_radius_km - 2.0)) * 0.4), 4)
    return 0.0


def calculate_feature_score(
    distance_km: float,
    category: str,
    firms_frp: Optional[float] = None,
    persistence_score: Optional[float] = None,
    max_radius_km: float = 5.0,
) -> Tuple[float, str]:
    """
    Calculates deterministic composite ranking score:
      feature_score = (proximity_score * 0.55) + (relevance_weight * 0.30) + (evidence_alignment * 0.15)
    Returns: (score_0_to_1, relevance_label)
    """
    prox_score = calculate_proximity_score(distance_km, max_radius_km)
    rel_weight = CATEGORY_RELEVANCE_WEIGHTS.get(category.upper(), 0.50)

    # Evidence alignment with thermal characteristics
    frp_val = float(firms_frp or 10.0)
    pers_val = float(persistence_score or 0.0)
    alignment = 0.50

    if category.upper() in ["INDUSTRIAL", "INFRASTRUCTURE", "CRITICAL_INFRASTRUCTURE"]:
        if pers_val >= 50.0:
            alignment = 1.00  # Persistent heat aligns with industrial source
        elif frp_val >= 25.0:
            alignment = 0.85
        else:
            alignment = 0.70
    elif category.upper() == "ENVIRONMENTAL":
        if pers_val < 30.0 and frp_val >= 20.0:
            alignment = 0.90  # Moving / high FRP heat aligns with wildfire
        else:
            alignment = 0.65
    elif category.upper() == "AGRICULTURAL":
        if pers_val < 30.0:
            alignment = 0.80  # Short-duration burn aligns with field residue
        else:
            alignment = 0.50
    elif category.upper() == "TRANSPORT":
        alignment = 0.60
    elif category.upper() == "RESIDENTIAL":
        alignment = 0.55

    score = round((prox_score * 0.55) + (rel_weight * 0.30) + (alignment * 0.15), 4)
    score = max(0.0, min(1.0, score))

    if score >= 0.70 or (distance_km <= 1.0 and rel_weight >= 0.85):
        relevance = "HIGH"
    elif score >= 0.40:
        relevance = "MEDIUM"
    else:
        relevance = "LOW"

    return score, relevance


class LocationContextEngine:
    """
    Autonomous Location Context Engine for SIH Problem Statement 26162.
    Triggered whenever multi-source primary fusion yields UNKNOWN (or for spatial triage).
    Performs comprehensive OpenStreetMap analysis around exact incident coordinates within 5.0 km,
    determines locality, ranks proximate features, and produces scientifically qualified contextual assessments.
    """

    def __init__(
        self,
        radius_km: float = OSM_CONTEXT_RADIUS_KM,
        timeout_seconds: float = OSM_REQUEST_TIMEOUT_SECONDS,
    ):
        self.radius_km = min(5.0, float(radius_km))
        self.timeout_seconds = float(timeout_seconds)

    def clear_cache(self) -> None:
        _location_context_cache.clear()

    async def resolve_geographic_locality(
        self,
        lat: float,
        lon: float,
        client: Optional[httpx.AsyncClient] = None
    ) -> Dict[str, Optional[str]]:
        """
        Resolves locality, district, state, and country from exact incident coordinates.
        Uses cached Nominatim reverse geocoding with fast fallback to Indian state bounds.
        Never throws exceptions or crashes.
        """
        locality_info: Dict[str, Optional[str]] = {
            "locality": None,
            "district": None,
            "state": None,
            "country": "India"
        }

        # Offline geographic bounds fallback for major Indian industrial/mining states
        def _apply_regional_fallback():
            if 17.5 <= lat <= 22.5 and 81.0 <= lon <= 87.5:
                locality_info["state"] = "Odisha"
            elif 21.0 <= lat <= 27.5 and 78.0 <= lon <= 84.5:
                locality_info["state"] = "Madhya Pradesh"
            elif 17.0 <= lat <= 24.5 and 80.0 <= lon <= 84.5:
                locality_info["state"] = "Chhattisgarh"
            elif 15.5 <= lat <= 22.0 and 72.5 <= lon <= 80.5:
                locality_info["state"] = "Maharashtra"
            elif 21.5 <= lat <= 25.5 and 83.0 <= lon <= 88.0:
                locality_info["state"] = "Jharkhand"
            elif 13.5 <= lat <= 19.5 and 77.0 <= lon <= 84.5:
                locality_info["state"] = "Andhra Pradesh"
            elif 15.5 <= lat <= 19.9 and 77.0 <= lon <= 81.5:
                locality_info["state"] = "Telangana"
            elif 21.5 <= lat <= 27.5 and 85.5 <= lon <= 89.9:
                locality_info["state"] = "West Bengal"

        headers = {"User-Agent": USER_AGENT}
        nom_url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&addressdetails=1"

        try:
            close_client = False
            if client is None:
                client = httpx.AsyncClient(timeout=min(self.timeout_seconds, 2.5))
                close_client = True

            try:
                resp = await client.get(nom_url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    addr = data.get("address", {})
                    
                    loc = (
                        addr.get("village")
                        or addr.get("suburb")
                        or addr.get("town")
                        or addr.get("city")
                        or addr.get("neighbourhood")
                        or addr.get("hamlet")
                        or addr.get("industrial")
                    )
                    dist = addr.get("state_district") or addr.get("county") or addr.get("district")
                    st = addr.get("state")
                    cntry = addr.get("country") or "India"

                    locality_info["locality"] = loc
                    locality_info["district"] = dist
                    locality_info["state"] = st
                    locality_info["country"] = cntry
            finally:
                if close_client:
                    await client.aclose()
        except Exception as ex:
            logger.debug(f"Reverse geocoding network exception: {ex}")

        # If any geographic level is missing, apply regional fallback
        if not locality_info["state"] or not locality_info["district"]:
            _apply_regional_fallback()

        return locality_info

    async def query_osm_features(
        self,
        lat: float,
        lon: float,
        radius_km: float = 5.0
    ) -> List[Dict[str, Any]]:
        """
        Executes an expanded 5.0 km Overpass query covering industrial, infrastructure,
        transport, natural/woodland, agricultural, and residential categories.
        """
        op_radius = min(5.0, float(radius_km))
        d_lat = op_radius / 111.0
        cos_lat = math.cos(math.radians(lat))
        d_lon = op_radius / (111.0 * max(0.01, cos_lat))

        min_lat = round(lat - d_lat, 5)
        max_lat = round(lat + d_lat, 5)
        min_lon = round(lon - d_lon, 5)
        max_lon = round(lon + d_lon, 5)

        query = f"""[out:json][timeout:6];
(
  node["industrial"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["industrial"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["landuse"~"industrial|commercial|residential|forest|farmland|farm|meadow|orchard|allotments|plantations"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["landuse"~"industrial|commercial|residential|forest|farmland|farm|meadow|orchard|allotments|plantations"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["power"~"substation|plant|generator|station"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["power"~"substation|plant|generator|station"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["man_made"~"works|storage_tank|pipeline|wastewater_plant"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["man_made"~"works|storage_tank|pipeline|wastewater_plant"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["railway"~"station|junction|yard|halt"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["railway"~"station|junction|yard|halt"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["aeroway"~"aerodrome|airport|heliport"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["aeroway"~"aerodrome|airport|heliport"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["natural"~"wood|wetland|scrub|water|grassland|heath"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["natural"~"wood|wetland|scrub|water|grassland|heath"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["place"~"city|town|village|suburb|neighbourhood|hamlet"]({min_lat},{min_lon},{max_lat},{max_lon});
  node["amenity"~"hospital|clinic|doctors|school|college|university|fire_station|police"]({min_lat},{min_lon},{max_lat},{max_lon});
  way["amenity"~"hospital|clinic|doctors|school|college|university|fire_station|police"]({min_lat},{min_lon},{max_lat},{max_lon});
);
out center 60;
"""
        raw_features: List[Dict[str, Any]] = []
        headers = {"User-Agent": USER_AGENT}
        per_server_timeout = min(self.timeout_seconds, 4.0)
        timeout = httpx.Timeout(per_server_timeout, connect=1.5)

        async with httpx.AsyncClient(timeout=timeout) as client:
            for server in OVERPASS_SERVERS:
                try:
                    resp = await client.post(server, data={"data": query}, headers=headers)
                    if resp.status_code == 200:
                        elements = resp.json().get("elements", [])
                        seen_ids = set()
                        for el in elements:
                            eid = f"{el.get('type', 'node')}/{el.get('id', '0')}"
                            if eid in seen_ids:
                                continue
                            seen_ids.add(eid)

                            f_lat = el.get("lat") or el.get("center", {}).get("lat")
                            f_lon = el.get("lon") or el.get("center", {}).get("lon")
                            if f_lat is None or f_lon is None:
                                continue

                            dist = haversine_distance_km(lat, lon, float(f_lat), float(f_lon))
                            if dist > op_radius:
                                continue

                            tags = el.get("tags", {})
                            cat, specific_type, _ = _categorize_osm_tags(tags)

                            # Refined infrastructure categorization
                            power_tag = (tags.get("power") or "").lower()
                            man_made_tag = (tags.get("man_made") or "").lower()
                            if power_tag in ["substation", "transformer", "station"] or "substation" in str(tags.get("name", "")).lower():
                                cat = "INFRASTRUCTURE"
                                specific_type = "Electrical Substation"
                            elif man_made_tag in ["pipeline", "storage_tank"]:
                                cat = "INFRASTRUCTURE"
                                specific_type = "Utility / Fuel Infrastructure"

                            # Name resolution
                            name = (
                                tags.get("name")
                                or tags.get("name:en")
                                or tags.get("operator")
                                or tags.get("brand")
                                or tags.get("description")
                            )
                            if not name:
                                place_t = tags.get("place")
                                ind_t = tags.get("industrial")
                                land_t = tags.get("landuse")
                                nat_t = tags.get("natural")
                                if ind_t:
                                    name = f"Industrial Facility ({ind_t.replace('_', ' ').title()})"
                                elif land_t == "industrial":
                                    name = "Industrial Land Area"
                                elif power_tag:
                                    name = f"Power Infrastructure ({power_tag.title()})"
                                elif place_t:
                                    name = f"{place_t.title()} Settlement"
                                elif land_t in ["farmland", "farm", "crop", "orchard"]:
                                    name = "Agricultural Farmland"
                                elif nat_t in ["wood", "forest"] or land_t == "forest":
                                    name = "Forest / Woodland Area"
                                elif nat_t:
                                    name = f"Natural {nat_t.title()} Terrain"
                                else:
                                    name = specific_type

                            raw_features.append({
                                "id": eid,
                                "name": name,
                                "type": specific_type,
                                "category": cat,
                                "latitude": float(f_lat),
                                "longitude": float(f_lon),
                                "distance_km": dist,
                                "tags": tags
                            })
                        if raw_features:
                            break
                except Exception as ex:
                    logger.debug(f"Overpass server query error ({server}): {ex}")
                    continue

        return raw_features

    async def analyze_location_context(
        self,
        lat: float,
        lon: float,
        firms_data: Optional[Dict[str, Any]] = None,
        persistence_data: Optional[Dict[str, Any]] = None,
        satellite_data: Optional[Dict[str, Any]] = None,
        fusion_data: Optional[Dict[str, Any]] = None,
        osm_data: Optional[Dict[str, Any]] = None,
    ) -> LocationContext:
        """
        Core LocationContextEngine pipeline:
          1. Check Cache
          2. Concurrently query OSM features and geographic locality
          3. Calculate exact Haversine distance and deterministic ranking
          4. Evaluate primary and secondary contextual classifications
          5. Synthesize possible cause and location-based explanation
          6. Cache and return LocationContext
        """
        t_start = time.perf_counter()
        op_radius = self.radius_km
        cache_key = (round(lat, 3), round(lon, 3), round(op_radius, 1))

        now = time.time()
        if cache_key in _location_context_cache:
            entry = _location_context_cache[cache_key]
            entry_ttl = entry.get("ttl", CACHE_TTL_SECONDS)
            if now - entry["timestamp"] < entry_ttl:
                logger.debug(f"Serving cached location context for {cache_key}")
                return LocationContext(**entry["data"])

        # Thermal and satellite characteristics for contextual alignment
        frp = float(firms_data.get("frp", 10.0)) if firms_data else 10.0
        brightness = float(firms_data.get("brightness", 330.0)) if firms_data else 330.0
        pers_score = float(persistence_data.get("score", 0.0)) if persistence_data else 0.0
        cloud_cover = None
        if satellite_data:
            cloud_cover = satellite_data.get("cloud_cover") or satellite_data.get("cloud_percentage")

        # 1. Fetch OSM raw features
        status_label = "READY"
        try:
            raw_features = await self.query_osm_features(lat=lat, lon=lon, radius_km=op_radius)
        except Exception as ex:
            logger.warning(f"LocationContextEngine OSM query failed: {ex}")
            raw_features = []
            status_label = "UNAVAILABLE"

        # Fallback to pre-fetched features in osm_data if Overpass returned no features
        if not raw_features and osm_data:
            existing_feats = osm_data.get("features") or osm_data.get("nearby_features") or []
            if isinstance(existing_feats, list):
                for f in existing_feats:
                    if isinstance(f, dict):
                        f_dist = float(f.get("distance_km", 0.0)) if f.get("distance_km") is not None else 0.0
                        if f_dist <= op_radius:
                            raw_features.append({
                                "id": f.get("osm_id") or f.get("id", "0"),
                                "name": f.get("name") or f.get("type", "Industrial Facility"),
                                "type": f.get("type", "industrial"),
                                "category": f.get("category", "INDUSTRIAL"),
                                "latitude": float(f.get("latitude", lat)),
                                "longitude": float(f.get("longitude", lon)),
                                "distance_km": f_dist,
                                "tags": f.get("tags", {})
                            })
                if raw_features:
                    status_label = "FALLBACK"

        # 2. Fetch geographic locality concurrently or with fallback
        geo_info = await self.resolve_geographic_locality(lat=lat, lon=lon)

        # 3. Rank features deterministically
        ranked_nearby: List[NearbyFeature] = []
        for feat in raw_features:
            dist = feat["distance_km"]
            cat = feat["category"]
            score, rel = calculate_feature_score(
                distance_km=dist,
                category=cat,
                firms_frp=frp,
                persistence_score=pers_score,
                max_radius_km=op_radius
            )
            ranked_nearby.append(NearbyFeature(
                type=feat["type"],
                name=feat["name"],
                distance_km=dist,
                relevance=rel,
                category=cat,
                ranking_score=score,
                latitude=feat["latitude"],
                longitude=feat["longitude"],
                osm_id=feat["id"]
            ))

        # Sort features by ranking_score descending, then distance_km ascending
        ranked_nearby.sort(key=lambda f: (-f.ranking_score, f.distance_km))

        # 4. Context Classification Evaluation
        context_classification = "NO_CLEAR_CONTEXT"
        primary_context = "NO_CLEAR_CONTEXT"
        secondary_context: Optional[str] = None
        confidence = 0.0
        confidence_label = "LOW"
        primary_feature: Optional[NearbyFeature] = ranked_nearby[0] if ranked_nearby else None

        if not ranked_nearby:
            context_classification = "NO_CLEAR_CONTEXT"
            primary_context = "NO_CLEAR_CONTEXT"
            confidence = 0.0
            confidence_label = "LOW" if status_label == "READY" else "UNAVAILABLE"
        else:
            # Group features by category
            cat_features: Dict[str, List[NearbyFeature]] = {}
            for f in ranked_nearby:
                cat_features.setdefault(f.category.upper(), []).append(f)

            # Find closest features per category
            closest_overall = min(ranked_nearby, key=lambda f: f.distance_km)
            ind_list = cat_features.get("INDUSTRIAL", [])
            infra_list = cat_features.get("INFRASTRUCTURE", []) + cat_features.get("CRITICAL_INFRASTRUCTURE", [])
            env_list = cat_features.get("ENVIRONMENTAL", [])
            agri_list = cat_features.get("AGRICULTURAL", [])
            trans_list = cat_features.get("TRANSPORT", [])
            res_list = cat_features.get("RESIDENTIAL", [])

            closest_ind = min(ind_list, key=lambda f: f.distance_km) if ind_list else None
            closest_infra = min(infra_list, key=lambda f: f.distance_km) if infra_list else None
            closest_env = min(env_list, key=lambda f: f.distance_km) if env_list else None
            closest_agri = min(agri_list, key=lambda f: f.distance_km) if agri_list else None
            closest_trans = min(trans_list, key=lambda f: f.distance_km) if trans_list else None

            # Classification Decision Tree
            # Rule 1: High-hazard industrial facility within <= 2.0 km or dominating
            if closest_ind and closest_ind.distance_km <= 2.0:
                context_classification = "INDUSTRIAL_CONTEXT"
                primary_context = "INDUSTRIAL_CONTEXT"
                primary_feature = closest_ind
                confidence = max(0.70, round(0.95 - (closest_ind.distance_km / 2.0) * 0.20, 2))
                confidence_label = "HIGH" if closest_ind.distance_km <= 1.0 else "MEDIUM"

                if closest_infra and closest_infra.distance_km <= 2.5:
                    secondary_context = "INFRASTRUCTURE_CONTEXT"
                elif closest_env and closest_env.distance_km <= 2.5:
                    secondary_context = "WILDFIRE_CONTEXT"

            # Rule 2: Dedicated power / electrical substation / utility infrastructure within <= 2.5 km
            elif closest_infra and closest_infra.distance_km <= 2.5:
                context_classification = "INFRASTRUCTURE_CONTEXT"
                primary_context = "INFRASTRUCTURE_CONTEXT"
                primary_feature = closest_infra
                confidence = max(0.65, round(0.90 - (closest_infra.distance_km / 2.5) * 0.25, 2))
                confidence_label = "HIGH" if closest_infra.distance_km <= 1.0 else "MEDIUM"

                if closest_ind:
                    secondary_context = "INDUSTRIAL_CONTEXT"
                elif closest_env:
                    secondary_context = "WILDFIRE_CONTEXT"

            # Rule 3: Forest / Woodland terrain dominant without proximate industrial
            elif closest_env and (not closest_ind or closest_ind.distance_km > 3.0):
                env_types = [f.type.lower() for f in env_list]
                is_forest = any("forest" in t or "wood" in t or "scrub" in t for t in env_types)
                if is_forest or closest_env.distance_km <= 2.0:
                    context_classification = "WILDFIRE_CONTEXT"
                    primary_context = "WILDFIRE_CONTEXT"
                    primary_feature = closest_env
                    confidence = max(0.60, round(0.85 - (closest_env.distance_km / op_radius) * 0.30, 2))
                    confidence_label = "HIGH" if closest_env.distance_km <= 1.5 else "MEDIUM"
                    if closest_agri:
                        secondary_context = "AGRICULTURAL_CONTEXT"
                else:
                    context_classification = "WILDFIRE_CONTEXT"
                    primary_context = "WILDFIRE_CONTEXT"
                    primary_feature = closest_env
                    confidence = 0.65
                    confidence_label = "MEDIUM"

            # Rule 4: Agricultural farmland dominant
            elif closest_agri and (not closest_ind or closest_ind.distance_km > 3.0):
                context_classification = "AGRICULTURAL_CONTEXT"
                primary_context = "AGRICULTURAL_CONTEXT"
                primary_feature = closest_agri
                confidence = max(0.55, round(0.80 - (closest_agri.distance_km / op_radius) * 0.30, 2))
                confidence_label = "MEDIUM" if closest_agri.distance_km <= 2.0 else "LOW"
                if closest_env:
                    secondary_context = "WILDFIRE_CONTEXT"

            # Rule 5: Transport infrastructure dominant
            elif closest_trans and closest_trans.distance_km <= 2.0:
                context_classification = "TRANSPORT_CONTEXT"
                primary_context = "TRANSPORT_CONTEXT"
                primary_feature = closest_trans
                confidence = max(0.55, round(0.75 - (closest_trans.distance_km / 2.0) * 0.20, 2))
                confidence_label = "MEDIUM"

            # Rule 6: Residential settlement dominant
            elif res_list and min(res_list, key=lambda f: f.distance_km).distance_km <= 1.5:
                closest_res = min(res_list, key=lambda f: f.distance_km)
                context_classification = "RESIDENTIAL_CONTEXT"
                primary_context = "RESIDENTIAL_CONTEXT"
                primary_feature = closest_res
                confidence = 0.60
                confidence_label = "MEDIUM"

            # Rule 7: Mixed context if multiple competing classes exist within 2.5 km
            elif len([c for c in [closest_ind, closest_infra, closest_env, closest_agri] if c and c.distance_km <= 2.5]) >= 2:
                context_classification = "MIXED_CONTEXT"
                primary_context = "MIXED_CONTEXT"
                primary_feature = closest_overall
                confidence = 0.50
                confidence_label = "MEDIUM"
                secondary_context = ranked_nearby[1].category if len(ranked_nearby) > 1 else None

            # Rule 8: Distant features only
            elif closest_overall.distance_km > 3.5:
                context_classification = "NO_CLEAR_CONTEXT"
                primary_context = "NO_CLEAR_CONTEXT"
                confidence = 0.30
                confidence_label = "LOW"
            else:
                context_classification = f"{closest_overall.category}_CONTEXT"
                primary_context = context_classification
                confidence = 0.50
                confidence_label = "MEDIUM"

        # 5. Determine Possible Cause & Assessment
        possible_cause: Optional[PossibleCause] = None
        prim_dist = primary_feature.distance_km if primary_feature else None
        prim_name = primary_feature.name if primary_feature else "Mapped Infrastructure"

        if context_classification == "INDUSTRIAL_CONTEXT":
            possible_cause = PossibleCause(
                category="INDUSTRIAL_ACTIVITY",
                likely_source=f"Nearby industrial facility ({prim_name})" if prim_name else "Nearby industrial facility",
                assessment=(
                    f"An industrial facility ({prim_name}) is located approximately {prim_dist:.2f} km from the thermal anomaly. "
                    "This provides contextual support for an industrial-related thermal source, but proximity alone does not confirm causation."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        elif context_classification == "INFRASTRUCTURE_CONTEXT":
            possible_cause = PossibleCause(
                category="ENERGY_INFRASTRUCTURE",
                likely_source=f"Electrical / power infrastructure ({prim_name})",
                assessment=(
                    f"A significant infrastructure facility ({prim_name}) is located {prim_dist:.2f} km from the incident coordinates. "
                    "This presents a plausible infrastructure-related thermal context, though field verification is required to confirm causation."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        elif context_classification == "WILDFIRE_CONTEXT":
            possible_cause = PossibleCause(
                category="NATURAL_VEGETATION",
                likely_source=f"Forest / woodland area ({prim_name})",
                assessment=(
                    f"The thermal anomaly is located near mapped forest/woodland terrain ({prim_dist:.2f} km away) with no proximate industrial infrastructure detected within the investigation radius. "
                    "This is consistent with a possible vegetation or brushfire source."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        elif context_classification == "AGRICULTURAL_CONTEXT":
            possible_cause = PossibleCause(
                category="AGRICULTURAL_ACTIVITY",
                likely_source=f"Farmland / crop area ({prim_name})",
                assessment=(
                    f"The incident is surrounded by mapped agricultural land ({prim_dist:.2f} km away). "
                    "Agricultural residue or controlled field burning is a plausible contextual source, although available evidence does not confirm the cause."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        elif context_classification == "TRANSPORT_CONTEXT":
            possible_cause = PossibleCause(
                category="TRANSPORT_CORRIDOR",
                likely_source=f"Transport corridor / railway infrastructure ({prim_name})",
                assessment=(
                    f"The incident is located along a major transportation corridor ({prim_dist:.2f} km away). "
                    "Railway or freight activity provides a plausible geographic context for the thermal reading."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        elif context_classification == "RESIDENTIAL_CONTEXT":
            possible_cause = PossibleCause(
                category="RESIDENTIAL_COMMUNITY",
                likely_source=f"Residential / settlement area ({prim_name})",
                assessment=(
                    f"The thermal anomaly is situated near a mapped residential settlement ({prim_name}) at {prim_dist:.2f} km. "
                    "Civic or domestic activity represents a possible contextual factor."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        elif context_classification == "MIXED_CONTEXT":
            sec_feat = ranked_nearby[1] if len(ranked_nearby) > 1 else None
            sec_name = f" and {sec_feat.name} ({sec_feat.distance_km:.2f} km)" if sec_feat else ""
            possible_cause = PossibleCause(
                category="MIXED_SOURCES",
                likely_source=f"Multiple proximate sources ({prim_name}{sec_name})",
                assessment=(
                    f"Multiple competing geographic contexts exist within the 5.0 km investigation radius ({prim_name} at {prim_dist:.2f} km{sec_name}). "
                    "A single dominant source cannot be determined from location context alone."
                ),
                confidence=confidence,
                confidence_label=confidence_label,
                distance_km=prim_dist
            )
        else:
            possible_cause = PossibleCause(
                category="UNRESOLVED",
                likely_source="No dominant mapped source identified",
                assessment=(
                    "No sufficiently relevant mapped feature was identified within the 5.0 km investigation radius. "
                    "The cause remains unresolved based on location context alone."
                ),
                confidence=0.0,
                confidence_label="UNAVAILABLE" if status_label != "READY" else "LOW",
                distance_km=None
            )

        # 6. Synthesize "Why this assessment?" Reasoning Bullets
        reasoning: List[str] = []

        if cloud_cover is not None and float(cloud_cover) >= 40.0:
            reasoning.append(f"Satellite optical evidence was degraded by elevated cloud cover ({float(cloud_cover):.1f}%). Primary classification is inconclusive.")
        elif satellite_data and not satellite_data.get("available"):
            reasoning.append("Optical satellite overpass was unavailable or outside the observation time window.")

        if firms_data:
            reasoning.append(f"NASA FIRMS detected a thermal anomaly with Fire Radiative Power (FRP) of {frp:.2f} MW and brightness temperature of {brightness:.1f} K.")

        if primary_feature:
            reasoning.append(f"OpenStreetMap mapping identifies {primary_feature.name} ({primary_feature.type}) located {primary_feature.distance_km:.2f} km from the exact coordinates.")
            if secondary_context and len(ranked_nearby) > 1:
                sec_f = ranked_nearby[1]
                reasoning.append(f"Secondary contextual feature: {sec_f.name} ({sec_f.type}) at {sec_f.distance_km:.2f} km.")

        if context_classification != "NO_CLEAR_CONTEXT":
            reasoning.append(f"The location context supports a {context_classification.replace('_', ' ').title()} assessment as a plausible proximate explanation.")
        else:
            reasoning.append("Sparse OpenStreetMap infrastructure within 5 km; no dominant contextual explanation available.")

        reasoning.append("Contextual assessment only — proximity provides geographic plausibility but does not confirm combustion origin.")

        result = LocationContext(
            classification=context_classification,
            confidence=confidence,
            confidence_label=confidence_label,
            radius_km=op_radius,
            locality=geo_info.get("locality"),
            district=geo_info.get("district"),
            state=geo_info.get("state"),
            country=geo_info.get("country") or "India",
            primary_context=primary_context,
            secondary_context=secondary_context,
            primary_nearby_feature=primary_feature.name if primary_feature else None,
            primary_distance_km=primary_feature.distance_km if primary_feature else None,
            reasoning=reasoning,
            nearby_features=ranked_nearby[:15],
            possible_cause=possible_cause,
            status=status_label
        )

        # Cache result (use short TTL if unavailable or empty to allow rapid recovery)
        entry_ttl = 60 if (status_label == "UNAVAILABLE" or len(raw_features) == 0) else CACHE_TTL_SECONDS
        _location_context_cache[cache_key] = {
            "timestamp": now,
            "ttl": entry_ttl,
            "data": result.model_dump()
        }

        dur_ms = round((time.perf_counter() - t_start) * 1000, 2)
        logger.info(f"LocationContextEngine completed for ({lat}, {lon}) in {dur_ms} ms -> {context_classification}")
        return result


# Singleton Engine Instance
_engine_instance: Optional[LocationContextEngine] = None


def get_location_context_engine() -> LocationContextEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = LocationContextEngine()
    return _engine_instance
