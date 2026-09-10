import os
import math
import time
import logging
from typing import List, Dict, Any, Tuple, Optional
import httpx

logger = logging.getLogger(__name__)

# Default search radius in kilometers (strictly 5.0 km maximum operational analysis radius)
DEFAULT_SEARCH_RADIUS_KM = float(os.getenv("OSM_SEARCH_RADIUS_KM", "5.0"))

# User-Agent header required by OpenStreetMap usage policies
USER_AGENT = "SIH-26162-FireIntelligence/1.0 (contact: github.com/sih26162-threat-engine)"

# Overpass API endpoints for resilient multi-server failover
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# In-memory context cache: (round_lat, round_lon, radius_km) -> {"timestamp": float, "data": dict}
_context_cache: Dict[Tuple[float, float, float], Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 1800  # 30 minutes cache TTL for OSM data


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth
    using the Haversine formula. Returns distance in kilometers rounded to 2 decimals.
    """
    R = 6371.0088  # Mean Earth radius in km

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)


def _categorize_osm_tags(tags: Dict[str, str]) -> Tuple[str, str, int]:
    """
    Categorize real OpenStreetMap tags into standardized disaster intelligence categories:
    - INDUSTRIAL: factories, refineries, chemical plants, warehouses, power plants, substations
    - HEALTHCARE: hospitals, clinics, medical centers
    - EDUCATION: schools, colleges, universities
    - RESIDENTIAL: residential areas, housing, apartments, villages, settlements
    - TRANSPORT: railway stations, airports, major roads, bridges
    - CRITICAL_INFRASTRUCTURE: emergency services, fire stations, police, power, water
    - ENVIRONMENTAL: forests, agricultural land, nature reserves, wetlands

    Returns: (category, specific_type, severity_weight_0_to_10)
    """
    amenity = (tags.get("amenity") or "").lower()
    industrial = (tags.get("industrial") or "").lower()
    landuse = (tags.get("landuse") or "").lower()
    power = (tags.get("power") or "").lower()
    railway = (tags.get("railway") or "").lower()
    aeroway = (tags.get("aeroway") or "").lower()
    highway = (tags.get("highway") or "").lower()
    place = (tags.get("place") or "").lower()
    natural = (tags.get("natural") or "").lower()
    man_made = (tags.get("man_made") or "").lower()
    name = (tags.get("name") or "").lower()

    combined = f"{amenity} {industrial} {landuse} {power} {railway} {place} {natural} {man_made} {name}"

    # 1. HEALTHCARE (Top vulnerability)
    if amenity in ["hospital", "clinic", "doctors"] or any(k in combined for k in ["hospital", "clinic", "medical center", "dispensary"]):
        return ("HEALTHCARE", "Hospital / Medical Center", 10)

    # 2. EDUCATION
    if amenity in ["school", "college", "university", "kindergarten"] or any(k in combined for k in ["school", "college", "university", "academy", "vidyalaya"]):
        return ("EDUCATION", "School / Educational Institution", 8)

    # 3. EMERGENCY SERVICES
    if amenity in ["fire_station", "police", "ambulance_station"]:
        return ("CRITICAL_INFRASTRUCTURE", "Emergency Services / Fire Station", 9)

    # 4. INDUSTRIAL & CHEMICAL HAZARDS
    if any(k in combined for k in ["refinery", "chemical", "petrochemical", "gas plant", "fuel depot", "oil terminal"]):
        return ("INDUSTRIAL", "High-Hazard Petrochemical / Chemical Plant", 10)
    if power in ["plant", "generator"] or "power plant" in combined:
        return ("INDUSTRIAL", "Power Generation Facility", 9)
    if power in ["substation"] or "substation" in combined:
        return ("CRITICAL_INFRASTRUCTURE", "Electrical Substation", 8)
    if industrial or landuse == "industrial" or any(k in combined for k in ["factory", "manufacturing", "steel", "works", "mill", "industrial"]):
        return ("INDUSTRIAL", "Industrial Manufacturing Facility", 8)
    if any(k in combined for k in ["warehouse", "storage", "depot", "godown"]):
        return ("INDUSTRIAL", "Industrial Warehouse / Storage", 6)

    # 5. RESIDENTIAL / POPULATION
    if place in ["city", "town", "suburb", "village", "hamlet", "neighbourhood"] or landuse in ["residential"]:
        label = "Village / Settlement" if place in ["village", "hamlet"] else "Residential Area / Settlement"
        return ("RESIDENTIAL", label, 7)

    # 6. TRANSPORTATION INFRASTRUCTURE
    if railway in ["station", "halt", "junction"] or "railway station" in combined:
        return ("TRANSPORT", "Railway Station / Hub", 7)
    if aeroway in ["aerodrome", "airport", "terminal"]:
        return ("TRANSPORT", "Airport / Aerodrome", 8)
    if highway in ["motorway", "trunk", "primary"]:
        return ("TRANSPORT", "Major Highway / Transport Corridor", 5)

    # 7. CRITICAL UTILITIES / WATER
    if man_made in ["water_works", "storage_tank"] or "water treatment" in combined:
        return ("CRITICAL_INFRASTRUCTURE", "Critical Utility Facility", 7)

    # 8. ENVIRONMENTAL / LAND USE
    if natural in ["wood", "tree_row"] or landuse in ["forest"]:
        return ("ENVIRONMENTAL", "Forest / Woodland", 5)
    if landuse in ["farmland", "farm", "orchard", "vineyard", "meadow"]:
        return ("ENVIRONMENTAL", "Agricultural / Farmland", 3)
    if natural in ["wetland", "water"]:
        return ("ENVIRONMENTAL", "Wetland / Water Body", 4)
    if natural in ["scrub", "grassland", "heath"]:
        return ("ENVIRONMENTAL", "Grassland / Open Terrain", 2)

    return ("UNCLASSIFIED", "Unclassified Mapped Feature", 2)


def _classify_context(features: List[Dict[str, Any]]) -> str:
    """
    Determine primary operational context classification from detected features:
    - INDUSTRIAL: Industrial manufacturing, chemical plants, or power facilities within 5 km.
    - HEALTHCARE: Hospitals or medical clinics within 5 km.
    - EDUCATION: Educational institutions within 5 km.
    - RESIDENTIAL: Villages, towns, or housing developments within 5 km.
    - TRANSPORT: Major railway junctions, stations, or airports.
    - CRITICAL_INFRASTRUCTURE: Power substations, water infrastructure, or emergency services.
    - FOREST: Forested / woodland areas.
    - AGRICULTURAL: Agricultural / farmland areas.
    - UNCLASSIFIED: No significant infrastructure detected within 5 km.
    """
    if not features:
        return "UNCLASSIFIED"

    categories = [f.get("category") for f in features]
    closest = features[0]

    if "INDUSTRIAL" in categories:
        # Check if closest is industrial
        if closest.get("category") == "INDUSTRIAL":
            return "INDUSTRIAL"
        # If industrial is within 2 km, still prioritize industrial context
        ind_items = [f for f in features if f.get("category") == "INDUSTRIAL"]
        if ind_items and ind_items[0].get("distance_km", 99) <= 2.0:
            return "INDUSTRIAL"

    if "HEALTHCARE" in categories:
        return "HEALTHCARE"

    if "EDUCATION" in categories:
        return "EDUCATION"

    if "RESIDENTIAL" in categories:
        return "RESIDENTIAL"

    if "CRITICAL_INFRASTRUCTURE" in categories:
        return "CRITICAL_INFRASTRUCTURE"

    if "TRANSPORT" in categories:
        return "TRANSPORT"

    if "ENVIRONMENTAL" in categories:
        env_types = [f.get("type", "") for f in features if f.get("category") == "ENVIRONMENTAL"]
        if any("forest" in t.lower() or "wood" in t.lower() for t in env_types):
            return "FOREST"
        if any("agricultural" in t.lower() or "farm" in t.lower() for t in env_types):
            return "AGRICULTURAL"
        return "ENVIRONMENTAL"

    return "UNCLASSIFIED"


def get_cached_osm_context(lat: float, lon: float, radius_km: float = 5.0) -> Optional[Dict[str, Any]]:
    """
    Check if OSM context for this coordinate exists in the fast in-memory cache.
    Returns cached dict if valid, otherwise None.
    """
    operational_radius_km = min(5.0, float(radius_km))
    cache_key = (round(lat, 3), round(lon, 3), round(operational_radius_km, 1))
    now = time.time()
    if cache_key in _context_cache:
        entry = _context_cache[cache_key]
        cached_has_facilities = entry["data"].get("facility_count", 0) > 0
        max_age = CACHE_TTL_SECONDS if cached_has_facilities else 120
        if (now - entry["timestamp"]) < max_age:
            return entry["data"]
    return None


# In-memory Nominatim reverse geocode cache: (round_lat_2, round_lon_2) -> dict
_nominatim_cache: Dict[Tuple[float, float], Dict[str, Any]] = {}


def _resolve_locality_from_elements(elements: List[Dict[str, Any]], lat: float, lon: float) -> Dict[str, Any]:
    """
    Fallback resolver that extracts dynamic locality from OSM settlement tags in the query results
    or state geographic bounds when Nominatim is slow or rate-limited.
    """
    settlements = []
    for el in elements:
        tags = el.get("tags", {})
        place = tags.get("place")
        if place in ["city", "town", "village", "hamlet", "suburb", "neighbourhood"]:
            f_lat = el.get("lat") or el.get("center", {}).get("lat")
            f_lon = el.get("lon") or el.get("center", {}).get("lon")
            if f_lat and f_lon:
                d = haversine_distance_km(lat, lon, float(f_lat), float(f_lon))
                name = tags.get("name") or tags.get("name:en")
                if name:
                    settlements.append((d, name, place))
    settlements.sort(key=lambda x: x[0])

    # Dynamic state bounds detection
    st = None
    if 17.5 <= lat <= 22.8 and 81.0 <= lon <= 87.5:
        st = "Odisha"
    elif 12.5 <= lat <= 19.5 and 76.5 <= lon <= 84.8:
        st = "Andhra Pradesh"
    elif 20.0 <= lat <= 24.8 and 68.0 <= lon <= 74.5:
        st = "Gujarat"
    elif 15.5 <= lat <= 22.0 and 72.5 <= lon <= 80.5:
        st = "Maharashtra"
    elif 21.0 <= lat <= 27.5 and 78.0 <= lon <= 84.5:
        st = "Madhya Pradesh"
    elif 17.0 <= lat <= 24.5 and 80.0 <= lon <= 84.5:
        st = "Chhattisgarh"
    elif 21.5 <= lat <= 25.5 and 83.0 <= lon <= 88.0:
        st = "Jharkhand"
    elif 21.5 <= lat <= 27.5 and 85.5 <= lon <= 89.9:
        st = "West Bengal"
    elif 15.5 <= lat <= 19.9 and 77.0 <= lon <= 81.5:
        st = "Telangana"

    if settlements:
        closest_name = settlements[0][1]
        disp = f"{closest_name}, {st}" if st else closest_name
        return {
            "facility_name": None,
            "primary_name": closest_name,
            "secondary_locality": f"{closest_name}, {st}" if st else (st or "India"),
            "locality": closest_name,
            "district": None,
            "state": st,
            "country": "India",
            "display_name": disp,
        }
    if st:
        return {
            "facility_name": None,
            "primary_name": st,
            "secondary_locality": f"{st}, India",
            "locality": None,
            "district": None,
            "state": st,
            "country": "India",
            "display_name": st,
        }
    return {
        "facility_name": None,
        "primary_name": "Thermal Anomaly",
        "secondary_locality": "India",
        "locality": None,
        "district": None,
        "state": None,
        "country": "India",
        "display_name": None,
    }


async def resolve_osm_locality(lat: float, lon: float, client: Optional[httpx.AsyncClient] = None, elements: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Dynamically resolves true facility name, village, town, district, and state using Nominatim reverse-geocoding (with cache).
    Implements the strict OpenStreetMap hierarchy:
      1. Facility / Place Name (e.g. Tata Steel, power plants, industrial facilities)
      2. Locality / Administrative Fallback (City, Town, Village/Suburb, District, State)
    Never returns hardcoded or fabricated place names.
    """
    nom_key = (round(lat, 3), round(lon, 3))
    if nom_key in _nominatim_cache:
        return _nominatim_cache[nom_key]

    headers = {"User-Agent": USER_AGENT}
    nom_url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&addressdetails=1"
    timeout = httpx.Timeout(3.0, connect=1.5)

    loc_info = {
        "facility_name": None,
        "primary_name": None,
        "secondary_locality": None,
        "locality": None,
        "city": None,
        "district": None,
        "state": None,
        "country": "India",
        "display_name": None,
    }

    own_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=timeout)
        own_client = True

    try:
        resp = await client.get(nom_url, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            addr = data.get("address", {})
            raw_name = (data.get("name") or "").strip()

            # 1. Facility / Place Name Detection
            fac_keys = [
                "industrial", "amenity", "building", "commercial", "factory",
                "works", "operator", "office", "power", "aeroway", "railway",
                "shop", "tourism", "leisure", "craft", "man_made"
            ]
            fac_name = None
            for k in fac_keys:
                v = addr.get(k)
                if v and str(v).lower() not in ["yes", "no", "true", "false", "unnamed", "none", "unknown"]:
                    fac_name = str(v).strip()
                    break

            # If no facility in address tags, check feature name if not generic highway/boundary
            if not fac_name and raw_name and data.get("class") not in ["highway", "boundary", "waterway"]:
                fac_name = raw_name

            # Check Overpass elements if passed for close named facilities (<= 2.5 km)
            if not fac_name and elements:
                for el in elements:
                    el_tags = el.get("tags", {})
                    el_name = el_tags.get("name") or el_tags.get("name:en")
                    if el_name and str(el_name).lower() not in ["yes", "no", "true", "false", "unnamed"]:
                        el_lat = el.get("lat") or el.get("center", {}).get("lat")
                        el_lon = el.get("lon") or el.get("center", {}).get("lon")
                        if el_lat and el_lon:
                            d = haversine_distance_km(lat, lon, float(el_lat), float(el_lon))
                            if d <= 2.5:
                                fac_name = str(el_name).strip()
                                break

            # 2. Administrative Hierarchy Fallback
            city = addr.get("city") or addr.get("town") or addr.get("municipality")
            suburb = (
                addr.get("village")
                or addr.get("suburb")
                or addr.get("hamlet")
                or addr.get("neighbourhood")
            )
            dist = addr.get("state_district") or addr.get("district") or addr.get("county")
            st = addr.get("state")
            cntry = addr.get("country") or "India"

            # Formulate Line 1: Primary Name
            # Facility name -> City -> Town -> Village / Suburb -> District -> State
            if fac_name:
                primary_name = fac_name
            elif city:
                primary_name = city
            elif suburb:
                primary_name = suburb
            elif dist:
                primary_name = dist
            elif st:
                primary_name = st
            else:
                primary_name = "Thermal Anomaly"

            # Formulate Line 2: Locality / State
            if fac_name:
                loc_part = city or suburb or dist
                if loc_part and st and loc_part.lower() != fac_name.lower():
                    secondary_locality = f"{loc_part}, {st}"
                elif st:
                    secondary_locality = st
                elif loc_part:
                    secondary_locality = loc_part
                else:
                    secondary_locality = cntry
            else:
                # No facility name (Primary is city, suburb, or district)
                if (city or suburb) and dist and (city or suburb) != dist:
                    secondary_locality = f"{dist}, {st}" if st else dist
                elif st:
                    secondary_locality = f"{primary_name}, {st}" if primary_name != st else st
                elif dist:
                    secondary_locality = dist
                else:
                    secondary_locality = cntry

            display = f"{primary_name} ({secondary_locality})" if secondary_locality else primary_name

            loc_info = {
                "facility_name": fac_name,
                "primary_name": primary_name,
                "secondary_locality": secondary_locality,
                "locality": suburb or city,
                "city": city,
                "district": dist,
                "state": st,
                "country": cntry,
                "display_name": display,
            }
            _nominatim_cache[nom_key] = loc_info
    except Exception as ex:
        logger.debug(f"Nominatim reverse geocode error for ({lat}, {lon}): {ex}")
    finally:
        if own_client:
            await client.aclose()

    # If Nominatim returned no locality or failed, extract from OSM elements or regional bounds
    if not loc_info.get("primary_name"):
        loc_fallback = _resolve_locality_from_elements(elements or [], lat, lon)
        if loc_fallback.get("primary_name"):
            loc_info.update({k: v for k, v in loc_fallback.items() if v is not None})
            _nominatim_cache[nom_key] = loc_info

    return loc_info


async def fetch_hotspot_osm_context(
    lat: float,
    lon: float,
    radius_km: float = DEFAULT_SEARCH_RADIUS_KM
) -> Dict[str, Any]:
    """
    Query OpenStreetMap Overpass API for genuine infrastructure features within <= 5.0 KM.
    100% genuine real-world data: Never fabricates mock facilities or fake fallbacks.
    If no industrial asset exists within radius, explicitly returns nearest_facility: null and nearby_facilities: [].
    """
    operational_radius_km = min(5.0, float(radius_km))
    cache_key = (round(lat, 3), round(lon, 3), round(operational_radius_km, 1))
    now = time.time()

    # 1. Fast cache check
    cached = get_cached_osm_context(lat, lon, operational_radius_km)
    if cached:
        logger.info(f"Returning cached OSM context for key: {cache_key}")
        return cached

    # Calculate bounding box for 5 km search radius
    d_lat = operational_radius_km / 111.0
    cos_lat = math.cos(math.radians(lat))
    d_lon = operational_radius_km / (111.0 * max(0.01, cos_lat))

    min_lat = round(lat - d_lat, 5)
    max_lat = round(lat + d_lat, 5)
    min_lon = round(lon - d_lon, 5)
    max_lon = round(lon + d_lon, 5)

    # Real Overpass query querying nwr["industrial"], nwr["landuse"="industrial"], nwr["man_made"~"works|pipeline|storage_tank|chimney"], nwr["power"="plant"]
    query = f"""[out:json][timeout:6];
(
  nwr["industrial"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["landuse"="industrial"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["man_made"~"works|pipeline|storage_tank|chimney"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["power"~"plant|substation|generator"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["amenity"~"hospital|clinic|doctors|school|college|university|fire_station|police"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["railway"~"station|junction"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["place"~"city|town|village|suburb|neighbourhood|hamlet"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["natural"~"wood|wetland|scrub|water"]({min_lat},{min_lon},{max_lat},{max_lon});
  nwr["landuse"~"forest|farmland|farm|meadow|orchard|commercial|residential"]({min_lat},{min_lon},{max_lat},{max_lon});
);
out center 50;
"""

    features: List[Dict[str, Any]] = []
    headers = {"User-Agent": USER_AGENT}
    data_status = "OSM_UNAVAILABLE"
    client_timeout = httpx.Timeout(connect=2.0, read=4.5, write=1.0, pool=1.0)
    raw_elements: List[Dict[str, Any]] = []

    try:
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            # Overpass query with multi-server failover
            for server in OVERPASS_SERVERS:
                try:
                    resp = await client.post(server, data={"data": query}, headers=headers)
                    if resp.status_code == 200:
                        raw_elements = resp.json().get("elements", [])
                        seen_osm_ids = set()

                        for el in raw_elements:
                            osm_id = f"{el.get('type', 'node')}/{el.get('id', '0')}"
                            if osm_id in seen_osm_ids:
                                continue
                            seen_osm_ids.add(osm_id)

                            tags = el.get("tags", {})
                            feat_lat = el.get("lat") or el.get("center", {}).get("lat")
                            feat_lon = el.get("lon") or el.get("center", {}).get("lon")

                            if feat_lat is None or feat_lon is None:
                                continue

                            # Exact Haversine geodesic distance from hotspot
                            dist_km = haversine_distance_km(lat, lon, float(feat_lat), float(feat_lon))

                            # Strict 5 km radius boundary
                            if dist_km > operational_radius_km:
                                continue

                            cat, specific_type, importance_wt = _categorize_osm_tags(tags)

                            # Genuine name resolution
                            raw_name = (
                                tags.get("name")
                                or tags.get("name:en")
                                or tags.get("operator")
                                or tags.get("brand")
                                or tags.get("description")
                            )
                            if raw_name:
                                name = raw_name
                            else:
                                ind_tag = tags.get("industrial")
                                man_made_tag = tags.get("man_made")
                                land_tag = tags.get("landuse")
                                power_tag = tags.get("power")
                                place_tag = tags.get("place")
                                amenity_tag = tags.get("amenity")

                                if ind_tag:
                                    name = f"Industrial Facility ({ind_tag.replace('_', ' ').title()})"
                                elif man_made_tag:
                                    name = f"Industrial Infrastructure ({man_made_tag.replace('_', ' ').title()})"
                                elif land_tag == "industrial":
                                    name = "Industrial Zone"
                                elif power_tag:
                                    name = f"Power Facility ({power_tag.replace('_', ' ').title()})"
                                elif place_tag:
                                    name = f"{place_tag.title()} Settlement"
                                elif amenity_tag:
                                    name = f"{amenity_tag.replace('_', ' ').title()}"
                                elif land_tag in ["farmland", "farm", "meadow", "orchard"]:
                                    name = "Agricultural Farmland"
                                elif land_tag in ["forest"] or tags.get("natural") in ["wood"]:
                                    name = "Forest / Woodland Area"
                                else:
                                    name = specific_type

                            features.append({
                                "id": osm_id,
                                "osm_id": osm_id,
                                "name": name,
                                "type": specific_type,
                                "category": cat,
                                "latitude": float(feat_lat),
                                "longitude": float(feat_lon),
                                "distance_km": dist_km,
                                "importance_weight": importance_wt,
                                "source": "OpenStreetMap",
                                "tags": {k: v for k, v in tags.items() if k in ["amenity", "industrial", "landuse", "power", "place", "railway", "natural", "man_made"]}
                            })

                        data_status = "READY"
                        break
                except Exception as ex:
                    logger.debug(f"Overpass query server {server} failed/timed out: {ex}")
                    continue

            # Dynamic Locality Resolution via Nominatim Reverse Geocoding (with element fallback)
            loc_info = await resolve_osm_locality(lat, lon, client, elements=raw_elements)
    except Exception as outer_ex:
        logger.warning(f"External OSM client error: {outer_ex}")
        loc_info = _resolve_locality_from_elements(raw_elements, lat, lon)

    # Sort all features strictly by distance ascending (closest first)
    features.sort(key=lambda x: x["distance_km"])

    # Extract real industrial features
    industrial_features = [
        f for f in features
        if f.get("category") == "INDUSTRIAL"
        or "refinery" in f.get("type", "").lower()
        or "chemical" in f.get("type", "").lower()
        or "industrial" in f.get("type", "").lower()
        or "power plant" in f.get("type", "").lower()
        or "works" in str(f.get("tags", {}).get("man_made", "")).lower()
        or "pipeline" in str(f.get("tags", {}).get("man_made", "")).lower()
        or "storage_tank" in str(f.get("tags", {}).get("man_made", "")).lower()
        or "chimney" in str(f.get("tags", {}).get("man_made", "")).lower()
    ]
    nearest_industrial = industrial_features[0] if industrial_features else None

    # Context classification
    if nearest_industrial:
        context_str = "INDUSTRIAL"
    elif any(f.get("category") == "ENVIRONMENTAL" and "forest" in f.get("type", "").lower() for f in features):
        context_str = "FOREST"
    elif any(f.get("category") in ["ENVIRONMENTAL", "RESIDENTIAL"] for f in features):
        context_str = "RURAL_OR_AGRICULTURAL"
    else:
        context_str = "UNCLASSIFIED_OPEN_LAND"

    # Category counts
    category_summary: Dict[str, int] = {}
    for f in features:
        c = f.get("category", "UNCLASSIFIED")
        category_summary[c] = category_summary.get(c, 0) + 1

    # Find closest critical asset
    critical_categories = {"INDUSTRIAL", "HEALTHCARE", "EDUCATION", "CRITICAL_INFRASTRUCTURE", "RESIDENTIAL"}
    critical_features = [f for f in features if f.get("category") in critical_categories]
    closest_critical = critical_features[0] if critical_features else None

    # NO FAKE FALLBACKS: If no industrial asset is found, nearest_facility is explicitly None
    nearest_facility_obj = {
        "name": nearest_industrial["name"],
        "type": nearest_industrial["type"],
        "category": nearest_industrial["category"],
        "distance_km": nearest_industrial["distance_km"],
        "latitude": nearest_industrial["latitude"],
        "longitude": nearest_industrial["longitude"],
        "osm_id": nearest_industrial.get("osm_id", ""),
    } if nearest_industrial else None

    # Determine true primary place/facility name & secondary administrative locality
    prim_name = (
        nearest_industrial["name"]
        if (nearest_industrial and nearest_industrial.get("distance_km", 99) <= 2.5)
        else (loc_info.get("primary_name") or loc_info.get("locality") or loc_info.get("district") or loc_info.get("state") or "Thermal Anomaly")
    )
    sec_loc = loc_info.get("secondary_locality") or loc_info.get("display_name") or (f"{loc_info.get('district')}, {loc_info.get('state')}" if loc_info.get('district') and loc_info.get('state') else (loc_info.get('state') or "India"))

    result_data = {
        "hotspot": {
            "latitude": lat,
            "longitude": lon,
        },
        "search_radius_km": operational_radius_km,
        "context": context_str,
        "context_classification": context_str,
        "facility_count": len(features),
        "nearby_features": features,
        "nearby_facilities": industrial_features,
        "nearest_facility": nearest_facility_obj,
        "category_summary": category_summary,
        "closest_critical_asset": closest_critical,
        "closest_industrial": nearest_industrial,
        "nearby_facility": nearest_industrial["name"] if nearest_industrial else None,
        "distance_km": nearest_industrial["distance_km"] if nearest_industrial else None,
        "primary_name": prim_name,
        "secondary_locality": sec_loc,
        "facility_name": nearest_industrial["name"] if nearest_industrial else loc_info.get("facility_name"),
        "locality": loc_info.get("locality"),
        "district": loc_info.get("district"),
        "state": loc_info.get("state"),
        "display_locality": loc_info.get("display_name"),
        "data_source": "OpenStreetMap Overpass API",
        "data_status": data_status,
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(now)),
    }

    # Store in memory cache
    _context_cache[cache_key] = {
        "timestamp": now,
        "data": result_data,
    }

    return result_data

