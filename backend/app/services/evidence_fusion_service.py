import os
import math
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

from app.ml.satellite_model.inference import get_inference_engine

logger = logging.getLogger("evidence_fusion_service")

# Configurable baseline weights for fusion layers
DEFAULT_FUSION_WEIGHTS = {
    "firms_thermal": float(os.getenv("FUSION_WEIGHT_FIRMS", "0.30")),
    "persistence": float(os.getenv("FUSION_WEIGHT_PERSISTENCE", "0.20")),
    "industrial_context": float(os.getenv("FUSION_WEIGHT_OSM", "0.20")),
    "sentinel2_vision": float(os.getenv("FUSION_WEIGHT_SENTINEL2", "0.30"))
}

# Cloud cover quality thresholds
CLOUD_THRESHOLD_GOOD = 30.0
CLOUD_THRESHOLD_MODERATE = 50.0
CLOUD_THRESHOLD_HIGH = 70.0


def assess_sentinel2_cloud_quality(cloud_cover: Optional[float]) -> Tuple[str, float]:
    """
    Evaluates Sentinel-2 cloud quality and returns quality label and weight discount multiplier.
    
    Policy:
      - cloud < 30%: GOOD (multiplier 1.0)
      - 30% <= cloud < 50%: MODERATE (multiplier 0.85)
      - 50% <= cloud < 70%: HIGH_CLOUD (multiplier 0.40 - degraded)
      - cloud >= 70%: VERY_HIGH_CLOUD (multiplier 0.15 - strongly downweighted)
    """
    if cloud_cover is None:
        return "UNKNOWN", 0.50
    
    c = float(cloud_cover)
    if c < CLOUD_THRESHOLD_GOOD:
        return "GOOD", 1.00
    elif c < CLOUD_THRESHOLD_MODERATE:
        return "MODERATE", 0.85
    elif c < CLOUD_THRESHOLD_HIGH:
        return "HIGH_CLOUD", 0.40
    else:
        return "VERY_HIGH_CLOUD", 0.15


# ==============================================================================
# 1. NORMALIZATION FUNCTIONS (Deterministic, Bounded [0, 1], Fully Documented)
# ==============================================================================

def normalize_firms_thermal(
    frp: Optional[float] = None,
    brightness: Optional[float] = None,
    confidence: Optional[str] = None
) -> Tuple[float, Dict[str, Any]]:
    """
    Normalizes NASA FIRMS thermal anomaly metrics into a bounded score in [0, 1].

    Inputs:
      - frp: Fire Radiative Power in Megawatts (MW) (typical active fire range: 5 to 100+ MW)
      - brightness: Brightness temperature in Kelvin (K) (typical range: 300 to 450+ K)
      - confidence: Detection confidence string ('low', 'nominal', 'high') or percentage (0-100)

    Output:
      - Bounded float score in [0.0, 1.0]

    Rationale:
      - FRP represents the instantaneous thermal radiation output from active combustion.
      - Brightness reflects the peak sub-pixel temperature of the emitter.
      - Confidence incorporates satellite instrument quality flags (e.g., scan angle, sun glint, background temperature).
      - Weighted formula: 50% FRP + 30% Brightness + 20% Confidence.

    Limitations:
      - Small sub-pixel industrial flares may register modest FRP (<10 MW) while maintaining extreme temperatures.
      - High FRP can also occur in large open forest fires.
    """
    frp_val = float(frp) if frp is not None else 0.0
    bright_val = float(brightness) if brightness is not None else 300.0
    conf_str = str(confidence or "nominal").lower().strip()

    # FRP component: saturated at 50 MW
    s_frp = min(1.0, max(0.0, frp_val / 50.0))

    # Brightness component: 300K (ambient baseline) to 420K (high radiant heat)
    s_bright = min(1.0, max(0.0, (bright_val - 300.0) / 120.0))

    # Confidence component
    if "high" in conf_str or (conf_str.isdigit() and int(conf_str) >= 80):
        s_conf = 1.0
    elif "low" in conf_str or (conf_str.isdigit() and int(conf_str) < 50):
        s_conf = 0.3
    else:
        s_conf = 0.65  # nominal / medium

    thermal_score = round(0.50 * s_frp + 0.30 * s_bright + 0.20 * s_conf, 4)
    thermal_score = max(0.0, min(1.0, thermal_score))

    details = {
        "raw_frp": frp_val,
        "raw_brightness": bright_val,
        "raw_confidence": conf_str,
        "frp_factor": round(s_frp, 4),
        "brightness_factor": round(s_bright, 4),
        "confidence_factor": round(s_conf, 4)
    }
    return thermal_score, details


def normalize_persistence(
    score: Optional[float] = None,
    observation_count: Optional[int] = None,
    duration_hours: Optional[float] = None
) -> Tuple[float, Dict[str, Any]]:
    """
    Normalizes temporal persistence evidence into a bounded score in [0, 1].

    Inputs:
      - score: Internal persistence score in [0, 100] computed across temporal clustering
      - observation_count: Number of independent satellite passes detecting heat at this location
      - duration_hours: Time span between first and latest detection in hours

    Output:
      - Bounded float score in [0.0, 1.0]

    Rationale:
      - Industrial facilities (refineries, flare stacks, blast furnaces) emit localized heat persistently
        over multiple satellite passes spanning days or weeks.
      - Fast-moving brushfires typically pass through an AOI within 2 to 6 hours.
      - Score is normalized directly from the 0-100 persistence engine.

    Limitations:
      - Long-duration forest peat fires or persistent agricultural burning can also yield elevated persistence.
      - Persistence provides temporal stability context, not definitive proof of industrial origin.
    """
    if score is not None:
        p_score = max(0.0, min(100.0, float(score)))
    else:
        obs_c = int(observation_count or 1)
        dur_h = float(duration_hours or 0.0)
        p_score = min(100.0, (obs_c * 15.0) + (dur_h / 24.0 * 50.0))

    norm_score = round(p_score / 100.0, 4)
    norm_score = max(0.0, min(1.0, norm_score))

    details = {
        "persistence_score_100": p_score,
        "observation_count": observation_count or 1,
        "duration_hours": duration_hours or 0.0
    }
    return norm_score, details


def normalize_industrial_context(
    distance_km: Optional[float] = None,
    features: Optional[List[Dict[str, Any]]] = None
) -> Tuple[float, Dict[str, Any]]:
    """
    Normalizes OpenStreetMap industrial proximity context into a bounded score in [0, 1].

    Inputs:
      - distance_km: Distance in kilometers to nearest mapped industrial / manufacturing / refinery facility
      - features: List of nearby OSM infrastructure feature dictionaries

    Output:
      - Bounded float score in [0.0, 1.0]

    Rationale:
      - Industrial fire risk correlates strongly with proximity to hazardous facilities, storage tanks,
        metalworks, and energy plants.
      - Proximity decay curve:
          * dist <= 0.5 km: score = 1.0 (Direct industrial compound proximity)
          * 0.5 km < dist <= 2.0 km: score decays linearly from 1.0 to 0.4
          * 2.0 km < dist <= 5.0 km: score decays linearly from 0.4 to 0.0
          * dist > 5.0 km or None: score = 0.0 (Rural / non-industrial background)

    Limitations:
      - OpenStreetMap depends on volunteer contributions and may omit newly built or remote industrial facilities.
      - Proximity indicates geographical opportunity, not confirmation of an active factory fire.
    """
    if distance_km is None:
        return 0.0, {"distance_km": None, "nearest_facility": None, "feature_count": 0}

    d = float(distance_km)
    if d < 0:
        d = 0.0

    if d <= 0.5:
        score = 1.0
    elif d <= 2.0:
        score = 1.0 - (d - 0.5) / 1.5 * 0.6  # 1.0 -> 0.4
    elif d <= 5.0:
        score = 0.4 - (d - 2.0) / 3.0 * 0.4  # 0.4 -> 0.0
    else:
        score = 0.0

    score = round(max(0.0, min(1.0, score)), 4)
    nearest_feat = features[0] if features and len(features) > 0 else {}
    nearest_name = nearest_feat.get("name") or nearest_feat.get("type") or "Unknown Industrial Facility"

    details = {
        "distance_km": round(d, 3),
        "nearest_facility": nearest_name if score > 0 else "None within 5.0 km",
        "feature_count": len(features) if features else 0
    }
    return score, details


# ==============================================================================
# 2. EVIDENCE AGGREGATOR & FUSION SERVICE
# ==============================================================================

class EvidenceFusionService:
    """
    Deterministic Multi-Source Evidence Fusion Layer for SIH Problem Statement 26162.
    Synthesizes:
      1. NASA FIRMS Thermal Anomaly Radiance & Confidence
      2. Temporal Persistence Patterns
      3. OpenStreetMap Industrial Infrastructure Proximity Context
      4. Sentinel-2 6-Band Multispectral CNN AI Vision Classification
      5. Satellite Cloud-Cover Quality Guardrails
    """

    def __init__(self, weights: Optional[Dict[str, float]] = None):
        self.weights = weights or DEFAULT_FUSION_WEIGHTS

    def assemble_evidence_object(
        self,
        observation_id: str,
        firms_data: Optional[Dict[str, Any]] = None,
        persistence_data: Optional[Dict[str, Any]] = None,
        osm_data: Optional[Dict[str, Any]] = None,
        satellite_data: Optional[Dict[str, Any]] = None,
        sentinel1_data: Optional[Dict[str, Any]] = None,
        selected_satellite: str = "SENTINEL_2",
        base_ai_classification: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Builds a normalized, standardized Evidence Object adhering strictly to the SIH Phase 6E schema.
        Preserves availability flags without forcing missing signals into artificial numbers.
        """
        f = firms_data or {}
        p = persistence_data or {}
        osm = osm_data or {}
        sat = satellite_data or {}

        # 1. FIRMS Block
        firms_available = bool(f.get("frp") is not None or f.get("brightness") is not None or f.get("available", False))
        firms_block = {
            "available": firms_available,
            "brightness": float(f.get("brightness")) if f.get("brightness") is not None else None,
            "frp": float(f.get("frp")) if f.get("frp") is not None else None,
            "confidence": str(f.get("confidence", "nominal")),
            "satellite": f.get("satellite") or f.get("sensor") or "VIIRS/MODIS",
            "acquired_at": f.get("acquired_at") or f.get("timestamp"),
            "latitude": float(f.get("latitude")) if f.get("latitude") is not None else None,
            "longitude": float(f.get("longitude")) if f.get("longitude") is not None else None,
            "source": "NASA FIRMS"
        }

        # 2. Persistence Block
        pers_available = bool(p.get("score") is not None or p.get("persistence_score") is not None or p.get("observation_count", 1) > 1)
        pers_score = p.get("score") if p.get("score") is not None else p.get("persistence_score")
        pers_block = {
            "available": pers_available,
            "score": float(pers_score) if pers_score is not None else None,
            "observation_count": int(p.get("observation_count", 1)),
            "duration_hours": float(p.get("duration_hours", 0.0)),
            "time_window_hours": float(p.get("time_window_hours", 24.0)),
            "classification": p.get("classification", "TEMPORARY" if not pers_available else "SUSPICIOUS")
        }

        # 3. Industrial Context Block
        osm_available = bool(osm.get("distance_km") is not None or osm.get("nearby_facility") or osm.get("features"))
        dist_km = osm.get("distance_km")
        if dist_km is None and osm.get("nearby_features"):
            dist_km = osm["nearby_features"][0].get("distance_km")
        dist_m = round(float(dist_km) * 1000.0, 1) if dist_km is not None else None

        features_list = osm.get("features") or osm.get("nearby_features") or []
        osm_block = {
            "available": osm_available,
            "score": None,  # Will be populated by normalizer
            "nearest_distance_m": dist_m,
            "nearest_distance_km": float(dist_km) if dist_km is not None else None,
            "industrial_features": features_list,
            "osm_source": "OpenStreetMap"
        }

        # 4. Sentinel-2 Block
        sat_available = bool(sat.get("available") or sat.get("image_available") or sat.get("classification"))
        cloud_pct = sat.get("cloud_cover") if sat.get("cloud_cover") is not None else sat.get("cloud_percentage")
        cloud_pct_float = float(cloud_pct) if cloud_pct is not None else None
        quality_label, _ = assess_sentinel2_cloud_quality(cloud_pct_float) if sat_available else ("UNAVAILABLE", 0.0)

        sat_block = {
            "available": sat_available,
            "class": sat.get("classification") or sat.get("predicted_class") or "UNKNOWN",
            "confidence": float(sat.get("confidence", 0.0)),
            "cloud_cover": cloud_pct_float,
            "quality": quality_label,
            "state": sat.get("status") or ("ACQUISITION_AVAILABLE" if sat_available else "UNAVAILABLE"),
            "is_synthetic": bool(sat.get("is_synthetic", False)),
            "is_calibrated": False,  # Preserved explicitly: raw softmax output is not calibrated
            "satellite_acquired_at": sat.get("satellite_acquired_at") or sat.get("captured_at"),
            "time_difference_hours": sat.get("time_difference_hours"),
            "image_url": sat.get("image_url"),
            "model": sat.get("model", "MultispectralCNN-Phase6C"),
            "class_probabilities": sat.get("class_probabilities", {})
        }

        # 5. Sentinel-1 SAR Backup Block (Phase 6K)
        s1 = sentinel1_data or {}
        s1_available = bool(s1.get("available") or s1.get("image_available"))
        s1_block = {
            "available": s1_available,
            "state": s1.get("status") or ("S1_FALLBACK_AVAILABLE" if s1_available else "S1_NOT_QUERIED"),
            "role": "BACKUP",
            "product_id": s1.get("product_id"),
            "polarization": s1.get("polarization"),
            "orbit_direction": s1.get("orbit_direction"),
            "acquisition_mode": s1.get("acquisition_mode"),
            "satellite_acquired_at": s1.get("satellite_acquired_at"),
            "time_difference_hours": s1.get("time_difference_hours"),
            "image_url": s1.get("image_url"),
            "is_synthetic": bool(s1.get("is_synthetic", False)),
            "reason_not_queried": s1.get("reason_not_queried"),
            "sar_disclaimer": s1.get(
                "sar_disclaimer",
                "Sentinel-1 is SAR radar evidence that can provide cloud-independent surface information. It does not measure fire temperature."
            )
        }

        return {
            "observation_id": str(observation_id),
            "firms": firms_block,
            "persistence": pers_block,
            "industrial_context": osm_block,
            "sentinel2": sat_block,
            "sentinel1": s1_block,
            "selected_satellite": selected_satellite,
            "base_ai_classification": base_ai_classification
        }

    def fuse(
        self,
        evidence_object: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Executes transparent multi-source evidence fusion.
        Produces candidate classification, bounded score, quality guardrails,
        conflict resolution, reasoning, warnings, and complete provenance.
        """
        obs_id = evidence_object.get("observation_id", "UNKNOWN_OBS")
        firms = evidence_object.get("firms", {})
        pers = evidence_object.get("persistence", {})
        osm = evidence_object.get("industrial_context", {})
        sat = evidence_object.get("sentinel2", {})

        reasoning: List[str] = []
        warnings: List[str] = []
        sources: List[str] = []

        # 1. Evaluate FIRMS Evidence
        firms_score = 0.0
        firms_weight = self.weights["firms_thermal"]
        if firms.get("available"):
            sources.append("NASA FIRMS")
            firms_score, f_details = normalize_firms_thermal(
                frp=firms.get("frp"),
                brightness=firms.get("brightness"),
                confidence=firms.get("confidence")
            )
            if firms.get("acquired_at"):
                sources.append(f"NASA FIRMS Acquisition ({firms['acquired_at']})")
            if firms_score >= 0.50:
                reasoning.append(f"Strong NASA FIRMS thermal anomaly detected (FRP: {firms.get('frp', 'N/A')} MW, Brightness: {firms.get('brightness', 'N/A')} K).")
            else:
                reasoning.append(f"Moderate/low NASA FIRMS thermal signature (FRP: {firms.get('frp', 'N/A')} MW).")
        else:
            firms_weight = 0.0
            warnings.append("NASA FIRMS thermal metrics unavailable for this observation.")

        # 2. Evaluate Persistence Evidence
        pers_score = 0.0
        pers_weight = self.weights["persistence"]
        if pers.get("available") and pers.get("score") is not None:
            sources.append("FIRMS Persistence Engine")
            pers_score, p_details = normalize_persistence(
                score=pers.get("score"),
                observation_count=pers.get("observation_count"),
                duration_hours=pers.get("duration_hours")
            )
            if pers_score >= 0.60:
                reasoning.append(f"Persistent thermal emission observed over {pers.get('duration_hours', 0.0):.1f} hours across {pers.get('observation_count', 1)} passes (Persistence Score: {pers.get('score'):.1f}/100).")
            elif pers_score >= 0.30:
                reasoning.append(f"Moderate thermal recurrence (Persistence Score: {pers.get('score'):.1f}/100).")
            else:
                reasoning.append("Isolated or brief thermal signature with low temporal persistence.")
        else:
            pers_weight = 0.0

        # 3. Evaluate OpenStreetMap Industrial Context
        osm_score = 0.0
        osm_weight = self.weights["industrial_context"]
        if osm.get("available") and osm.get("nearest_distance_km") is not None:
            sources.append("OpenStreetMap Geospatial Context")
            osm_score, osm_details = normalize_industrial_context(
                distance_km=osm.get("nearest_distance_km"),
                features=osm.get("industrial_features")
            )
            osm["score"] = osm_score
            if osm_score >= 0.60:
                reasoning.append(f"Industrial infrastructure identified within {osm.get('nearest_distance_m', 0)}m ({osm_details.get('nearest_facility')}).")
            elif osm_score > 0.0:
                reasoning.append(f"Distal industrial infrastructure located {osm.get('nearest_distance_km', 0.0):.2f} km away.")
            else:
                reasoning.append("No industrial infrastructure mapped within 5.0 km radius.")
        else:
            osm_weight = 0.0
            osm["score"] = 0.0
            warnings.append("OpenStreetMap industrial context unavailable.")

        # 4. Evaluate Satellite Evidence (Sentinel-2 Optical Primary or Sentinel-1 SAR Radar Backup)
        s1 = evidence_object.get("sentinel1", {})
        selected_sat = evidence_object.get("selected_satellite", "SENTINEL_2")

        sat_score = 0.0
        sat_weight = self.weights["sentinel2_vision"]
        sat_class = sat.get("class", "UNKNOWN")
        sat_conf = float(sat.get("confidence", 0.0))
        cloud_pct = sat.get("cloud_cover")
        sat_quality, cloud_discount = assess_sentinel2_cloud_quality(cloud_pct)
        sat["quality"] = sat_quality

        if selected_sat == "SENTINEL_1" and s1.get("available"):
            # Phase 6K Sentinel-1 SAR Radar Backup Integration
            sources.append("Copernicus Sentinel-1 SAR Radar Backup")
            if s1.get("satellite_acquired_at"):
                sources.append(f"Sentinel-1 Acquisition ({s1['satellite_acquired_at']})")

            pols = s1.get("polarization") or ["VV", "VH"]
            pol_str = "/".join(pols) if isinstance(pols, list) else str(pols)
            orbit_dir = s1.get("orbit_direction", "descending")
            reasoning.append(
                f"Sentinel-1 SAR radar evidence utilized as cloud-independent backup (Polarization: {pol_str}, Orbit: {orbit_dir}). "
                "Provides structural surface backscatter penetrating cloud cover; does not measure thermal emission."
            )

            if cloud_pct is not None and float(cloud_pct) >= 70.0:
                warnings.append(f"Sentinel-1 SAR backup engaged due to dense Sentinel-2 cloud obscuration ({float(cloud_pct):.1f}%).")
            elif sat.get("state") in ("NO_ACQUISITION", "UNAVAILABLE"):
                reasoning.append("Sentinel-1 SAR radar evidence engaged due to absence of Sentinel-2 optical overpass.")

            # SAR contributes structural physical context without claiming thermal measurement
            sat_score = 0.50
            sat_weight = self.weights["sentinel2_vision"] * 0.50
            sat_quality = "SAR_ALL_WEATHER"
            cloud_discount = 1.00

            if s1.get("time_difference_hours") is not None:
                s1_diff = abs(float(s1["time_difference_hours"]))
                if s1_diff > 48.0:
                    warnings.append(f"Sentinel-1 SAR acquisition is {s1_diff:.1f} hours apart from FIRMS detection.")

        elif sat.get("available") and sat_class != "UNKNOWN":
            sources.append("Copernicus Sentinel-2 Multispectral")
            if sat.get("satellite_acquired_at"):
                sources.append(f"Sentinel-2 Acquisition ({sat['satellite_acquired_at']})")

            # Check synthetic guardrail
            if sat.get("is_synthetic", False):
                warnings.append("Synthetic satellite imagery detected: excluded from genuine evidentiary fusion.")
                sat_weight = 0.0
                sat_score = 0.0
            else:
                # Apply Cloud Guardrails
                sat_weight = sat_weight * cloud_discount
                sat_score = sat_conf

                if sat_quality == "GOOD":
                    reasoning.append(f"Sentinel-2 6-band CNN classifies optical patch as {sat_class} with {sat_conf*100:.1f}% confidence under clear atmospheric conditions (Cloud cover: {cloud_pct:.1f}%).")
                elif sat_quality == "MODERATE":
                    reasoning.append(f"Sentinel-2 CNN classifies optical patch as {sat_class} with moderate cloud cover ({cloud_pct:.1f}%).")
                elif sat_quality == "HIGH_CLOUD":
                    reasoning.append(f"Sentinel-2 optical evidence degraded by elevated cloud cover ({cloud_pct:.1f}%). Contribution down-weighted.")
                    warnings.append(f"Sentinel-2 evidence downgraded because cloud cover is {cloud_pct:.1f}%.")
                elif sat_quality == "VERY_HIGH_CLOUD":
                    reasoning.append(f"Sentinel-2 optical imagery severely obscured by dense cloud cover ({cloud_pct:.1f}%). Strongly down-weighted; cannot confirm industrial fire alone.")
                    warnings.append(f"Sentinel-2 optical evidence heavily obscured by cloud cover ({cloud_pct:.1f}%). Primary decision relies on FIRMS and geospatial context.")

                if sat.get("time_difference_hours") is not None:
                    time_diff = abs(float(sat["time_difference_hours"]))
                    if time_diff > 24.0:
                        warnings.append(f"Sentinel-2 optical acquisition is {time_diff:.1f} hours apart from FIRMS detection; optical conditions may have evolved.")
        else:
            sat_weight = 0.0
            reasoning.append("Satellite acquisition unavailable; classification based on FIRMS, persistence, and industrial context.")

        # 5. Weighted Normalization & Contribution Calculation
        total_active_weight = firms_weight + pers_weight + osm_weight + sat_weight
        if total_active_weight > 0:
            norm_firms_w = firms_weight / total_active_weight
            norm_pers_w = pers_weight / total_active_weight
            norm_osm_w = osm_weight / total_active_weight
            norm_sat_w = sat_weight / total_active_weight
        else:
            norm_firms_w = norm_pers_w = norm_osm_w = norm_sat_w = 0.0

        contributing_evidence = {
            "firms_thermal": {
                "active_weight": round(norm_firms_w, 4),
                "normalized_score": round(firms_score, 4),
                "effective_contribution": round(norm_firms_w * firms_score, 4)
            },
            "persistence": {
                "active_weight": round(norm_pers_w, 4),
                "normalized_score": round(pers_score, 4),
                "effective_contribution": round(norm_pers_w * pers_score, 4)
            },
            "industrial_context": {
                "active_weight": round(norm_osm_w, 4),
                "normalized_score": round(osm_score, 4),
                "effective_contribution": round(norm_osm_w * osm_score, 4)
            },
            "sentinel2_vision": {
                "active_weight": round(norm_sat_w, 4),
                "normalized_score": round(sat_score, 4),
                "effective_contribution": round(norm_sat_w * sat_score, 4),
                "cloud_quality": sat_quality,
                "cloud_multiplier": cloud_discount
            }
        }

        # 6. Candidate Classification & Conflict Handling Logic
        base_ai_class = str(evidence_object.get("base_ai_classification") or "").upper()
        has_industrial_osm = (osm_score >= 0.35) or bool(osm.get("nearest_distance_km") and float(osm["nearest_distance_km"]) <= 3.0)
        has_strong_firms = (firms_score >= 0.35) or (firms.get("frp") is not None and float(firms["frp"]) >= 15.0)
        has_high_persistence = (pers_score >= 0.40) or (pers.get("observation_count", 1) > 1)
        base_ai_industrial = any(term in base_ai_class for term in ["INDUSTRIAL", "PERSISTENT", "FLARE"])
        base_ai_wildfire = any(term in base_ai_class for term in ["WILDFIRE", "AGRICULTURAL", "FOREST"])

        candidate_class = "UNKNOWN"
        candidate_score = 0.0
        evidence_strength = "INSUFFICIENT"
        confidence_label = "INCONCLUSIVE"

        # Check for insufficient evidence first
        if not firms.get("available") and not sat.get("available") and not osm.get("available") and not pers.get("available"):
            candidate_class = "UNKNOWN"
            candidate_score = 0.0
            evidence_strength = "INSUFFICIENT"
            confidence_label = "INCONCLUSIVE"
            warnings.append("Insufficient multi-source evidence available to produce a candidate classification.")

        # Optical Conflicts: When clear Sentinel-2 imagery is available
        elif sat.get("available") and sat_class == "WILDFIRE" and has_industrial_osm and sat_quality in ["GOOD", "MODERATE"]:
            warnings.append("Conflicting evidence: Proximity to industrial infrastructure detected, but Sentinel-2 optical imagery indicates vegetative burning (WILDFIRE).")
            candidate_class = "WILDFIRE"
            candidate_score = round(0.50 * firms_score + 0.30 * sat_score + 0.20 * (1.0 - osm_score), 4)
            evidence_strength = "MODERATE"
            confidence_label = "MEDIUM"
            reasoning.append("Resolved conflict in favor of WILDFIRE candidate due to high-confidence Sentinel-2 optical vegetative burn patterns overriding nearby industrial proximity.")

        elif sat.get("available") and sat_class == "INDUSTRIAL_FIRE" and not has_industrial_osm and sat_quality in ["GOOD", "MODERATE"]:
            warnings.append("Conflicting evidence: Sentinel-2 classifier predicts INDUSTRIAL_FIRE, but OpenStreetMap shows no mapped industrial infrastructure within 5.0 km.")
            if has_strong_firms and has_high_persistence:
                candidate_class = "INDUSTRIAL_FIRE"
                candidate_score = round(0.40 * firms_score + 0.30 * pers_score + 0.30 * sat_score, 4)
                evidence_strength = "MODERATE"
                confidence_label = "MEDIUM"
                reasoning.append("Classified as INDUSTRIAL_FIRE candidate based on intense optical heat core and multi-pass persistence, despite absence of mapped OSM facilities.")
            else:
                candidate_class = "WILDFIRE"
                candidate_score = round(0.50 * firms_score + 0.30 * (1.0 - osm_score) + 0.20 * sat_score, 4)
                evidence_strength = "MODERATE"
                confidence_label = "MEDIUM"

        elif sat.get("available") and sat_class == "INDUSTRIAL_FIRE" and sat_quality in ["GOOD", "MODERATE"]:
            # Clear optical industrial fire
            candidate_class = "INDUSTRIAL_FIRE"
            raw_composite = (
                norm_firms_w * firms_score +
                norm_pers_w * pers_score +
                norm_osm_w * osm_score +
                norm_sat_w * sat_score
            )
            candidate_score = round(max(0.0, min(1.0, raw_composite)), 4)
            evidence_strength = "STRONG" if candidate_score >= 0.65 else "MODERATE"
            confidence_label = "HIGH" if candidate_score >= 0.65 else "MEDIUM"
            reasoning.append(f"Confirmed INDUSTRIAL_FIRE candidate via high-confidence Sentinel-2 optical classification ({sat_conf*100:.0f}%) and thermal alignment.")

        elif sat.get("available") and sat_class == "WILDFIRE" and sat_quality in ["GOOD", "MODERATE"]:
            # Clear optical wildfire
            candidate_class = "WILDFIRE"
            raw_composite = (
                norm_firms_w * firms_score +
                norm_pers_w * (1.0 - pers_score * 0.5) +
                norm_osm_w * (1.0 - osm_score) +
                norm_sat_w * sat_score
            )
            candidate_score = round(max(0.0, min(1.0, raw_composite)), 4)
            evidence_strength = "STRONG" if candidate_score >= 0.65 else "MODERATE"
            confidence_label = "HIGH" if candidate_score >= 0.65 else "MEDIUM"
            reasoning.append(f"Confirmed WILDFIRE candidate via Sentinel-2 optical vegetative combustion patterns ({sat_conf*100:.0f}%).")

        elif (has_industrial_osm or base_ai_industrial) and (has_strong_firms or has_high_persistence or firms.get("available")):
            # Industrial fire alignment: proximity to mapped industrial infrastructure + positive thermal detection
            candidate_class = "INDUSTRIAL_FIRE"
            raw_composite = (
                norm_firms_w * firms_score +
                norm_pers_w * pers_score +
                norm_osm_w * osm_score +
                norm_sat_w * (sat_score if sat_class == "INDUSTRIAL_FIRE" else 0.5)
            )
            candidate_score = round(max(0.0, min(1.0, raw_composite)), 4)
            evidence_strength = "STRONG" if candidate_score >= 0.60 else "MODERATE"
            confidence_label = "HIGH" if candidate_score >= 0.60 else "MEDIUM"
            reasoning.append("Classified as INDUSTRIAL_FIRE candidate based on proximity to mapped industrial infrastructure and thermal emission signature.")

        elif (firms.get("available") and (firms_score >= 0.15 or (firms.get("frp") is not None and float(firms["frp"]) >= 2.0))) or base_ai_wildfire:
            # Active combustion in non-industrial open/vegetation terrain
            candidate_class = "WILDFIRE"
            raw_composite = (
                norm_firms_w * firms_score +
                norm_pers_w * (1.0 - pers_score * 0.5) +
                norm_osm_w * (1.0 - osm_score) +
                norm_sat_w * (sat_score if sat_class == "WILDFIRE" else 0.5)
            )
            candidate_score = round(max(0.0, min(1.0, raw_composite)), 4)
            evidence_strength = "STRONG" if candidate_score >= 0.60 else "MODERATE"
            confidence_label = "HIGH" if candidate_score >= 0.60 else "MEDIUM"
            reasoning.append("Classified as WILDFIRE candidate based on active satellite thermal anomaly detection in non-industrial open/vegetation terrain.")

        elif (firms.get("available") and firms_score < 0.20 and not has_strong_firms) and (sat_class == "NON_FIRE" or not sat.get("available")):
            candidate_class = "NON_FIRE"
            candidate_score = round(1.0 - (0.5 * firms_score + 0.5 * (1.0 - sat_score if sat_class == "NON_FIRE" else 0.5)), 4)
            candidate_score = max(0.0, min(1.0, candidate_score))
            evidence_strength = "MODERATE"
            confidence_label = "MEDIUM"
            reasoning.append("Classified as NON_FIRE based on negligible thermal radiative power and lack of active combustion indicators.")

        else:
            # Inconclusive fallback only when no positive thermal or satellite signal exists
            candidate_class = "UNKNOWN"
            raw_composite = (
                norm_firms_w * firms_score +
                norm_pers_w * pers_score +
                norm_osm_w * osm_score +
                norm_sat_w * sat_score
            )
            candidate_score = round(max(0.0, min(1.0, raw_composite)), 4)
            evidence_strength = "WEAK"
            confidence_label = "LOW"

        # S2 High Cloud Guardrail overrides for Industrial Fire
        if sat_quality == "VERY_HIGH_CLOUD" and sat_class == "INDUSTRIAL_FIRE" and not has_industrial_osm:
            warnings.append("Down-weighted Sentinel-2 INDUSTRIAL_FIRE prediction due to extreme cloud cover (>70%). Cannot confirm industrial anomaly.")
            candidate_class = "UNKNOWN"
            candidate_score = round(candidate_score * 0.5, 4)
            evidence_strength = "WEAK"
            confidence_label = "LOW"

        # Guarantee strict mathematical boundaries
        candidate_score = float(max(0.0, min(1.0, candidate_score)))
        if math.isnan(candidate_score) or math.isinf(candidate_score):
            candidate_score = 0.0

        # Unique sources list
        unique_sources = list(dict.fromkeys(sources))

        return {
            "observation_id": obs_id,
            "candidate_class": candidate_class,
            "candidate_score": candidate_score,
            "evidence_strength": evidence_strength,
            "confidence_label": confidence_label,
            "contributing_evidence": contributing_evidence,
            "firms": firms,
            "persistence": pers,
            "industrial_context": osm,
            "sentinel2": sat,
            "sentinel1": s1,
            "selected_satellite": selected_sat,
            "reasoning": reasoning,
            "warnings": warnings,
            "sources": unique_sources,
            "disclaimer": (
                "AI Candidate Classification is an evidence-fusion output, not a standalone confirmation of an industrial fire. "
                "Sentinel-2 imagery is optical evidence and may not be temporally coincident with the FIRMS observation. "
                "Sentinel-1 is SAR radar evidence that can provide cloud-independent surface information. It does not measure fire temperature."
            )
        }


# Singleton service instance
_fusion_service_instance: Optional[EvidenceFusionService] = None


def get_evidence_fusion_service() -> EvidenceFusionService:
    global _fusion_service_instance
    if _fusion_service_instance is None:
        _fusion_service_instance = EvidenceFusionService()
    return _fusion_service_instance


def fuse_thermal_evidence(
    spot_dict: Dict[str, Any],
    osm_context: Optional[Dict[str, Any]] = None,
    ai_classification: Optional[Dict[str, Any]] = None,
    risk_result: Optional[Dict[str, Any]] = None,
    satellite_evidence: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Backward-compatible entry point for existing pipeline callers.
    Wraps modern EvidenceFusionService and formats response for UI and older controllers.
    """
    service = get_evidence_fusion_service()
    obs_id = str(spot_dict.get("observation_id") or spot_dict.get("id") or "OBS_UNKNOWN")

    evidence_obj = service.assemble_evidence_object(
        observation_id=obs_id,
        firms_data=spot_dict,
        persistence_data={
            "score": spot_dict.get("persistence_score"),
            "observation_count": spot_dict.get("observation_count", 1),
            "duration_hours": spot_dict.get("duration_hours", 0.0)
        },
        osm_data=osm_context or spot_dict.get("industrial_context"),
        satellite_data=satellite_evidence
    )

    fusion_res = service.fuse(evidence_obj)

    # Map to legacy schema expected by existing UI / tests while providing rich Phase 6E fields
    legacy_response = {
        "final_classification": f"{fusion_res['candidate_class']}_CANDIDATE" if not fusion_res['candidate_class'].endswith("CANDIDATE") and fusion_res['candidate_class'] != "UNKNOWN" else fusion_res['candidate_class'],
        "candidate_class": fusion_res["candidate_class"],
        "combined_confidence": fusion_res["candidate_score"],
        "combined_confidence_percentage": int(fusion_res["candidate_score"] * 100),
        "combined_risk_score": risk_result.get("risk_score") if risk_result else int(fusion_res["candidate_score"] * 100),
        "risk_level": risk_result.get("risk_level") if risk_result else ("HIGH" if fusion_res["candidate_score"] >= 0.70 else "MODERATE"),
        "fusion_summary": " ".join(fusion_res["reasoning"]),
        "evidence": {
            "firms": {
                "frp_mw": firms_frp if (firms_frp := spot_dict.get("frp")) is not None else 0.0,
                "brightness_k": spot_dict.get("brightness", 320.0),
                "confidence": str(spot_dict.get("confidence", "nominal")),
                "summary": f"FRP {spot_dict.get('frp', 0.0)} MW, Brightness {spot_dict.get('brightness', 320.0)} K, Confidence {spot_dict.get('confidence', 'nominal')}"
            },
            "osm": {
                "context": (osm_context or {}).get("context_classification", "RURAL_OR_AGRICULTURAL"),
                "nearby_facility": (osm_context or {}).get("nearby_facility") or "None",
                "distance_km": (osm_context or {}).get("distance_km"),
                "summary": f"Facility: {(osm_context or {}).get('nearby_facility', 'None')} ({(osm_context or {}).get('distance_km')} km)" if (osm_context or {}).get("distance_km") else "No nearby industrial facility within 5.0 km"
            },
            "persistence": {
                "persistence_score": float(spot_dict.get("persistence_score", 0.0)),
                "observation_count": int(spot_dict.get("observation_count", 1)),
                "duration_hours": float(spot_dict.get("duration_hours", 0.0)),
                "summary": f"Score {spot_dict.get('persistence_score', 0.0)}/100, {spot_dict.get('observation_count', 1)} passes over {spot_dict.get('duration_hours', 0.0)}h"
            },
            "satellite": fusion_res["sentinel2"]
        },
        "phase6e_fusion": fusion_res
    }

    return legacy_response
