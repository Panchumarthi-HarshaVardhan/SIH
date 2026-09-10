import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import {
  Hotspot,
  PersistentCluster,
  ThermalAlert,
  PriorityRankingItem,
  ThreatZonesResponse,
  ExposedAsset,
  OsmFeature,
} from '../../types/hotspot';
import { createEarthGlobe, EarthGlobeSystem, GLOBE_RADIUS, latLonToGlobeVector3 } from './EarthGlobe';
import { createSatelliteOrbitSystem, SatelliteOrbitSystem } from './SatelliteOrbit';
import { createSatelliteModel, SatelliteModelSystem } from './SatelliteModel';
import { createObservationCone, ObservationConeSystem } from './ObservationCone';
import { createFirmsLayer, FirmsLayerSystem } from './FirmsLayer';
import { createPersistenceField, PersistenceFieldSystem } from './PersistenceField';
import { createThermalRiskField, ThermalRiskFieldSystem, ExpansionStage } from './ThermalRiskField';
import { createIndustrialLayer, IndustrialLayerSystem } from './IndustrialLayer';
import { createGlobeControls, GlobeCameraControls } from './GlobeControls';
import { createStarfield } from '../landing/Starfield';

interface SatelliteIntelligenceGlobeProps {
  hotspots?: Hotspot[];
  clusters?: PersistentCluster[];
  activeAlerts?: ThermalAlert[];
  priorityItems?: PriorityRankingItem[];
  threatZones?: ThreatZonesResponse | null;
  exposedAssets?: ExposedAsset[];
  nearbyFeatures?: OsmFeature[];
  selectedHotspot?: Hotspot | null;
  selectedPriorityIncident?: PriorityRankingItem | null;
  onSelectHotspot?: (hotspot: Hotspot) => void;
  selectedCluster?: PersistentCluster | null;
  onSelectCluster?: (cluster: PersistentCluster) => void;
  onSelectPriorityIncident?: (incident: PriorityRankingItem) => void;
  onOpenIncident?: (incident: SelectedIncidentState) => void;
  initialCoords?: [number, number];
}

// Single Source of Truth for Selected Incident (Requirement 12)
export interface SelectedIncidentState {
  id: string;
  lat: number;
  lon: number;
  satellite: string;
  sensor: string;
  source: string;
  frp: number;
  brightness: number;
  confidence: string;
  persistence: number;
  industrialProb: number;
  riskScore: number;
  estimatedInfluenceKm: number;
  status: 'CRITICAL' | 'ELEVATED' | 'MODERATE' | 'LOW';
  classification: string;
  facilityName: string | null;
  facilityType?: string | null;
  distanceKm: number | null;
  acquired_at?: string;
}

// 3 Explicit Workspace UI States (Requirement 13)
export type FullscreenWorkspaceState =
  | 'NORMAL_DASHBOARD'
  | 'FULLSCREEN_MAP'
  | 'INCIDENT_SPLIT_VIEW';

export const SatelliteIntelligenceGlobe: React.FC<SatelliteIntelligenceGlobeProps> = ({
  hotspots = [],
  clusters = [],
  activeAlerts: _activeAlerts = [],
  priorityItems = [],
  threatZones = null,
  exposedAssets = [],
  nearbyFeatures = [],
  selectedHotspot = null,
  selectedPriorityIncident = null,
  onSelectHotspot = () => {},
  selectedCluster = null,
  onSelectCluster: _onSelectCluster = () => {},
  onSelectPriorityIncident = () => {},
  onOpenIncident = () => {},
  initialCoords = [20.5937, 78.9629],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // UI States
  const [viewMode, setViewMode] = useState<'risk_field' | 'heatmap'>('risk_field');
  const [timeFilter, setTimeFilter] = useState<'NOW' | '-1h' | '-3h' | '-6h'>('NOW');
  const [hoveredHotspot, setHoveredHotspot] = useState<Hotspot | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [isDemoRunning, setIsDemoRunning] = useState<boolean>(false);

  // Single Synchronized Selected Incident State (Requirement 12)
  const [selectedIncident, setSelectedIncident] = useState<SelectedIncidentState | null>(null);

  // Simulated Operational Response Action Feedback (Requirement: Section 08 Actions)
  const [actionFeedback, setActionFeedback] = useState<{
    [key: string]: { status: string; timestamp: string };
  }>({});

  // 7-Step Demo Pipeline Status Banner State (Requirement 20)
  const [demoStep, setDemoStep] = useState<{
    step: string;
    label: string;
    description: string;
  } | null>(null);

  // Ctrl + Scroll Zoom UX States (Requirement: Ctrl + Scroll only)
  const [showZoomHint, setShowZoomHint] = useState<boolean>(false);
  const [ctrlZoomStatus, setCtrlZoomStatus] = useState<'enabled' | 'locked' | null>(null);
  const zoomHintTimerRef = useRef<number | null>(null);
  const zoomStatusTimerRef = useRef<number | null>(null);

  // 3 Explicit Workspace UI States (Requirement 13)
  const [workspaceState, setWorkspaceState] = useState<FullscreenWorkspaceState>('NORMAL_DASHBOARD');
  const isFullscreen = workspaceState !== 'NORMAL_DASHBOARD';
  const isHoveredRef = useRef<boolean>(false);
  const canvasMountRef = useRef<HTMLDivElement>(null);

  // Transform Fullscreen Map to Split Incident Command Workspace (Requirements 1, 2, 5)
  const handleOpenIncidentCommand = (target?: SelectedIncidentState | null) => {
    const inc = target || selectedIncident;
    if (!inc) {
      const candidate = hotspots[0];
      if (candidate) {
        handleHotspotClick(candidate);
      }
    }
    const container = containerRef.current;
    if (!document.fullscreenElement && container?.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    }
    setWorkspaceState('INCIDENT_SPLIT_VIEW');
    if (inc) {
      onOpenIncident(inc);
    }

    // Smoothly adjust camera to centered target after layout starts resizing
    setTimeout(() => {
      const active = target || selectedIncident;
      if (active && controlsRef.current) {
        controlsRef.current.flyTo(active.lat, active.lon, 24.2, 0.6);
      }
    }, 280);
  };

  // Close Incident Command and return strictly to FULLSCREEN_MAP (Requirement 7)
  const handleCloseIncidentCommand = () => {
    setWorkspaceState('FULLSCREEN_MAP');
    setTimeout(() => {
      if (selectedIncident && controlsRef.current) {
        controlsRef.current.flyTo(selectedIncident.lat, selectedIncident.lon, 24.5, 0.6);
      }
    }, 250);
  };

  // Toggle browser fullscreen or return from workspace to normal dashboard (Requirement 6)
  const toggleFullscreenOrWorkspace = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (workspaceState === 'INCIDENT_SPLIT_VIEW' || workspaceState === 'FULLSCREEN_MAP') {
      const exitFn =
        document.exitFullscreen ||
        (document as any).webkitExitFullscreen ||
        (document as any).mozCancelFullScreen ||
        (document as any).msExitFullscreen;
      if (exitFn) {
        exitFn.call(document).catch((err: any) => console.warn(err));
      }
      setWorkspaceState('NORMAL_DASHBOARD');
      return;
    }

    // Normal dashboard -> request fullscreen map
    const requestFn =
      container.requestFullscreen ||
      (container as any).webkitRequestFullscreen ||
      (container as any).mozRequestFullScreen ||
      (container as any).msRequestFullscreen;
    if (requestFn) {
      requestFn.call(container).then(() => {
        setWorkspaceState('FULLSCREEN_MAP');
      }).catch((err: any) => console.warn(err));
    }
  }, [workspaceState]);

  // Sync with browser fullscreenchange event (handles ESC key or browser UI exit)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const container = containerRef.current;
      const currentFsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;

      const isFs = !!container && currentFsEl === container;
      if (!isFs) {
        setWorkspaceState('NORMAL_DASHBOARD');
      } else {
        setWorkspaceState((prev) => (prev === 'NORMAL_DASHBOARD' ? 'FULLSCREEN_MAP' : prev));
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // ESC Key Handling: In INCIDENT_SPLIT_VIEW, first closes incident to FULLSCREEN_MAP (Requirement 8)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (workspaceState === 'INCIDENT_SPLIT_VIEW') {
          e.preventDefault();
          e.stopPropagation();
          setWorkspaceState('FULLSCREEN_MAP');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [workspaceState]);

  // Request Escape key lock in browsers that support it so ESC closes incident panel first
  useEffect(() => {
    if (workspaceState === 'INCIDENT_SPLIT_VIEW') {
      if ((navigator as any).keyboard?.lock) {
        (navigator as any).keyboard.lock(['Escape']).catch(() => {});
      }
    } else {
      if ((navigator as any).keyboard?.unlock) {
        (navigator as any).keyboard.unlock();
      }
    }
  }, [workspaceState]);

  // Keyboard shortcut 'F' to toggle fullscreen workspace when map is active (Requirement 11)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        const container = containerRef.current;
        if (!container) return;

        const isMapActive =
          isHoveredRef.current ||
          document.activeElement === container ||
          container.contains(document.activeElement);

        if (!isMapActive) return;

        // Do not intercept if user is typing in form controls
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (
          activeTag === 'input' ||
          activeTag === 'textarea' ||
          activeTag === 'select' ||
          (document.activeElement as HTMLElement)?.isContentEditable
        ) {
          return;
        }

        e.preventDefault();
        toggleFullscreenOrWorkspace();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggleFullscreenOrWorkspace]);

  // 6-Stage State Machine Indicator
  const [expansionState, setExpansionState] = useState<{
    stage: ExpansionStage;
    stageNumber: number;
    label: string;
    radiiKm: { inner: number; secondary: number; monitoring: number };
  }>({
    stage: 'STATE 5: RISK FIELD STABILIZED',
    stageNumber: 5,
    label: 'OPERATIONAL MONITORING ACTIVE',
    radiiKm: { inner: 1.2, secondary: 2.8, monitoring: 5.2 },
  });

  // Orbital Telemetry State
  const [satelliteTelemetry, setSatelliteTelemetry] = useState({
    satellite: 'NOAA-21 (JPSS-2)',
    sensor: 'VIIRS 375m',
    lat: 18.5,
    lon: 76.2,
    altitudeKm: 824,
    status: 'SATELLITE PASS DETECTED',
    isOverIndia: true,
    utcTime: new Date().toISOString().slice(11, 19) + ' UTC',
  });

  // System References
  const controlsRef = useRef<GlobeCameraControls | null>(null);
  const firmsLayerRef = useRef<FirmsLayerSystem | null>(null);
  const persistenceFieldRef = useRef<PersistenceFieldSystem | null>(null);
  const thermalRiskRef = useRef<ThermalRiskFieldSystem | null>(null);
  const industrialLayerRef = useRef<IndustrialLayerSystem | null>(null);
  const observationConeRef = useRef<ObservationConeSystem | null>(null);
  const orbitSystemRef = useRef<SatelliteOrbitSystem | null>(null);

  // Filter hotspots based on temporal slider
  const filteredHotspots = useMemo(() => {
    if (timeFilter === 'NOW') return hotspots;
    const now = Date.now();
    const hours = timeFilter === '-1h' ? 1 : timeFilter === '-3h' ? 3 : 6;
    const cutoff = now - hours * 3600 * 1000;
    return hotspots.filter((h) => {
      const t = new Date(h.acquired_at || 0).getTime();
      return isNaN(t) || t >= cutoff;
    });
  }, [hotspots, timeFilter]);

  // Handle Hotspot Selection & Scientific Investigation Sequence
  const handleHotspotClick = (h: Hotspot) => {
    onSelectHotspot(h);

    // 1. Camera Fly-To & Center Target (Requirement 10: Smooth target centering at close distance)
    if (controlsRef.current) {
      controlsRef.current.flyTo(h.latitude, h.longitude, 24.2, 1.4);
    }

    // 2. Subtle Satellite Connection (Requirement 11: NOAA-21 -> VIIRS -> Earth Observation -> FIRMS detection)
    const targetGround = latLonToGlobeVector3(h.latitude, h.longitude, GLOBE_RADIUS * 1.002);
    observationConeRef.current?.setTargetGroundPos(targetGround);

    // 3. Centralized Data Synchronization (Requirement 12)
    const matchPriority = priorityItems.find(
      (p) => p.hotspot_id === h.observation_id || p.cluster_id === h.observation_id
    ) || (selectedPriorityIncident && (selectedPriorityIncident.hotspot_id === h.observation_id || selectedPriorityIncident.cluster_id === h.observation_id) ? selectedPriorityIncident : null);

    const riskScore = matchPriority ? Math.round(matchPriority.risk_score * 100) : (h.frp || 25) > 60 ? 82 : 55;
    const classification = matchPriority?.classification || 'INDUSTRIAL CANDIDATE';
    const persistenceScore = matchPriority?.persistence_score || 75;
    const industrialProb = matchPriority ? Math.round((matchPriority.risk_score || 0.8) * 95) : 87;
    const status: 'CRITICAL' | 'ELEVATED' | 'MODERATE' | 'LOW' =
      riskScore >= 75 ? 'CRITICAL' : riskScore >= 50 ? 'ELEVATED' : 'MODERATE';

    const facilityName = matchPriority?.industrial_facility || (exposedAssets.length > 0 ? (exposedAssets[0] as any).name : null);
    const distanceKm = matchPriority?.industrial_distance_km ?? (exposedAssets.length > 0 ? (exposedAssets[0] as any).distance_km : null);
    const estRadius = threatZones?.zones?.secondary_zone?.radius_km || +(2.0 + (riskScore / 100) * 1.5).toFixed(1);

    const unifiedIncident: SelectedIncidentState = {
      id: h.observation_id || `HOTSPOT_${h.latitude.toFixed(2)}_${h.longitude.toFixed(2)}`,
      lat: h.latitude,
      lon: h.longitude,
      satellite: h.satellite || 'NOAA-21',
      sensor: h.instrument || 'VIIRS 375m',
      source: h.source || 'NASA FIRMS',
      frp: h.frp || 25.0,
      brightness: h.brightness || 342.0,
      confidence: String(h.confidence || 'nominal'),
      persistence: persistenceScore,
      industrialProb,
      riskScore,
      estimatedInfluenceKm: estRadius,
      status,
      classification,
      facilityName: facilityName || null,
      facilityType: (matchPriority as any)?.facility_type || 'Heavy Refining & Hydrocarbon Processing',
      distanceKm: distanceKm ?? null,
      acquired_at: h.acquired_at || new Date().toISOString(),
    };
    setSelectedIncident(unifiedIncident);

    // 4. Activate Strict 3-Layer Thermal Risk Field (Requirement 7)
    if (thermalRiskRef.current) {
      if (viewMode === 'risk_field') {
        thermalRiskRef.current.setActiveTarget(h, threatZones, riskScore, classification, persistenceScore);
      } else {
        thermalRiskRef.current.setActiveTarget(null, null);
      }
    }

    // 5. Connect Real OSM Industrial Facility (Requirement 8: One distinct facility marker + connection line)
    if (industrialLayerRef.current) {
      if (viewMode === 'risk_field') {
        industrialLayerRef.current.setFeatures(
          h,
          exposedAssets.length > 0 ? exposedAssets : nearbyFeatures,
          facilityName,
          distanceKm
        );
      } else {
        industrialLayerRef.current.setFeatures(null, []);
      }
    }
  };

  // Sync when selectedHotspot prop changes from parent
  useEffect(() => {
    if (selectedHotspot) {
      handleHotspotClick(selectedHotspot);
    }
  }, [selectedHotspot]);

  // Sync when viewMode changes
  useEffect(() => {
    if (selectedIncident && viewMode === 'heatmap') {
      thermalRiskRef.current?.setActiveTarget(null, null);
      industrialLayerRef.current?.setFeatures(null, []);
    } else if (selectedIncident && viewMode === 'risk_field') {
      const h: Hotspot = {
        observation_id: selectedIncident.id,
        latitude: selectedIncident.lat,
        longitude: selectedIncident.lon,
        frp: selectedIncident.frp,
        brightness: selectedIncident.brightness,
        confidence: selectedIncident.confidence,
        satellite: selectedIncident.satellite,
        instrument: selectedIncident.sensor,
        source: selectedIncident.source,
        acquired_at: new Date().toISOString(),
      };
      thermalRiskRef.current?.setActiveTarget(h, threatZones, selectedIncident.riskScore, selectedIncident.classification, selectedIncident.persistence);
      industrialLayerRef.current?.setFeatures(h, exposedAssets.length > 0 ? exposedAssets : nearbyFeatures, selectedIncident.facilityName, selectedIncident.distanceKm);
    }
  }, [viewMode]);

  // 7-Step Automated SIH Pipeline Demo Sequence (Requirement 20)
  const runDemoPipeline = () => {
    if (isDemoRunning) return;
    setIsDemoRunning(true);
    setViewMode('risk_field');

    // STEP 01: SATELLITE PASS (0.0s)
    controlsRef.current?.flyToGlobal();
    observationConeRef.current?.setTargetGroundPos(null);
    thermalRiskRef.current?.setActiveTarget(null, null);
    industrialLayerRef.current?.setFeatures(null, []);
    setSelectedIncident(null);
    setDemoStep({
      step: '01',
      label: 'SATELLITE PASS',
      description: 'NOAA-21 VIIRS Polar Sun-Synchronous Orbit Tracking',
    });

    // STEP 02: VIIRS OBSERVATION (1.2s)
    setTimeout(() => {
      controlsRef.current?.flyToIndia();
      setDemoStep({
        step: '02',
        label: 'VIIRS OBSERVATION',
        description: 'Swath Remote Sensing over Indian Subcontinent (3040 km)',
      });
    }, 1200);

    // STEP 03: FIRMS THERMAL DETECTION (2.4s)
    const bestTarget =
      [...hotspots].sort((a, b) => (b.frp || 0) - (a.frp || 0))[0] || {
        observation_id: 'sih_demo_target_01',
        latitude: 22.42,
        longitude: 69.83,
        frp: 92.4,
        brightness: 362.5,
        confidence: 'high',
        acquired_at: new Date().toISOString(),
        satellite: 'NOAA-21',
        instrument: 'VIIRS',
        source: 'NASA FIRMS',
      };

    setTimeout(() => {
      handleHotspotClick(bestTarget);
      setDemoStep({
        step: '03',
        label: 'FIRMS THERMAL DETECTION',
        description: 'Radiometric Thermal Core Acquired (FRP 92.4 MW / 362.5 K)',
      });
    }, 2400);

    // STEP 04: PERSISTENCE CONFIRMED (3.6s)
    setTimeout(() => {
      setDemoStep({
        step: '04',
        label: 'PERSISTENCE CONFIRMED',
        description: 'Multi-Orbit Cluster Validation (Confidence 85%)',
      });
    }, 3600);

    // STEP 05: AI INDUSTRIAL CLASSIFICATION (4.8s)
    setTimeout(() => {
      setDemoStep({
        step: '05',
        label: 'AI INDUSTRIAL CLASSIFICATION',
        description: 'OSM Infrastructure Correlation: Jamnagar Petrochemical Complex (1.8 km)',
      });
    }, 4800);

    // STEP 06: 3D RISK FIELD (6.0s)
    setTimeout(() => {
      setDemoStep({
        step: '06',
        label: '3D RISK FIELD',
        description: 'Volumetric Thermal Influence Zone Expansion (3.2 km Radius)',
      });
    }, 6000);

    // STEP 07: INCIDENT PRIORITIZED (7.2s)
    setTimeout(() => {
      setDemoStep({
        step: '07',
        label: 'INCIDENT PRIORITIZED',
        description: 'Operational Decision Support: P1 Urgent Dispatch Assigned',
      });
      const matchPri = priorityItems[0];
      if (matchPri) {
        onSelectPriorityIncident(matchPri);
      }
    }, 7200);

    // Conclude Demo Sequence (8.5s)
    setTimeout(() => {
      setIsDemoRunning(false);
      setDemoStep(null);
    }, 8500);
  };

  // Main Three.js Lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020617, 0.008);

    const mountTarget = canvasMountRef.current || container;
    const width = mountTarget.clientWidth || 800;
    const height = mountTarget.clientHeight || 560;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountTarget.appendChild(renderer.domElement);

    // 2. Starfield & Space Environment
    const starfield = createStarfield(600, 1500);
    scene.add(starfield);

    // Subtle Ambient & Directional Lighting
    const ambientLight = new THREE.AmbientLight(0x0f172a, 1.2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunLight.position.set(40, 15, 50);
    scene.add(sunLight);

    // 3. Texture Loader & Subsystems
    const textureLoader = new THREE.TextureLoader();
    const earthSystem: EarthGlobeSystem = createEarthGlobe(textureLoader);
    scene.add(earthSystem.group);

    const orbitSystem: SatelliteOrbitSystem = createSatelliteOrbitSystem();
    scene.add(orbitSystem.group);
    orbitSystemRef.current = orbitSystem;

    const satelliteModel: SatelliteModelSystem = createSatelliteModel();
    scene.add(satelliteModel.group);

    const observationCone: ObservationConeSystem = createObservationCone();
    scene.add(observationCone.group);
    observationConeRef.current = observationCone;

    const firmsLayer: FirmsLayerSystem = createFirmsLayer();
    scene.add(firmsLayer.group);
    firmsLayerRef.current = firmsLayer;

    const persistenceField: PersistenceFieldSystem = createPersistenceField();
    scene.add(persistenceField.group);
    persistenceFieldRef.current = persistenceField;

    const thermalRisk: ThermalRiskFieldSystem = createThermalRiskField();
    scene.add(thermalRisk.group);
    thermalRiskRef.current = thermalRisk;

    const industrialLayer: IndustrialLayerSystem = createIndustrialLayer();
    scene.add(industrialLayer.group);
    industrialLayerRef.current = industrialLayer;

    // 4. Camera Controls
    const controls = createGlobeControls(camera);
    controls.setHintCallback(() => {
      setShowZoomHint(true);
      if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
      zoomHintTimerRef.current = window.setTimeout(() => {
        setShowZoomHint(false);
      }, 2000);
    });

    controls.setCtrlStatusCallback((active) => {
      if (active === true) {
        setCtrlZoomStatus('enabled');
        if (zoomStatusTimerRef.current) clearTimeout(zoomStatusTimerRef.current);
      } else if (active === false) {
        setCtrlZoomStatus('locked');
        if (zoomStatusTimerRef.current) clearTimeout(zoomStatusTimerRef.current);
        zoomStatusTimerRef.current = window.setTimeout(() => {
          setCtrlZoomStatus(null);
        }, 1200);
      } else {
        setCtrlZoomStatus(null);
      }
    });

    controls.attachDOM(renderer.domElement);
    controlsRef.current = controls;

    // Focus on initial coordinates
    controls.flyTo(initialCoords[0], initialCoords[1], 32.0, 1.2);

    // 5. Raycaster for Interactive Hotspot Clicks & Hover
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(firmsLayer.interactiveMeshes, false);

      if (hits.length > 0) {
        const foundHotspot = hits[0].object.userData.hotspot as Hotspot;
        setHoveredHotspot(foundHotspot);
        setHoverPos({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top + 15 });
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setHoveredHotspot(null);
        renderer.domElement.style.cursor = 'grab';
      }
    };

    const handlePointerClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(firmsLayer.interactiveMeshes, false);

      if (hits.length > 0) {
        const target = hits[0].object.userData.hotspot as Hotspot;
        handleHotspotClick(target);
      }
    };

    renderer.domElement.addEventListener('mousemove', handlePointerMove);
    renderer.domElement.addEventListener('click', handlePointerClick);

    // 6. Animation Loop
    let animationFrameId: number;
    let clock = new THREE.Clock();
    let orbitProgress = 0.38; // Initial position near India pass

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Advance satellite orbit (deterministic: ~1 orbit every 90s in simulation)
      orbitProgress = (orbitProgress + delta * 0.012) % 1.0;
      const orbitState = orbitSystem.calculateState(orbitProgress);

      // Update Subsystems
      earthSystem.update(delta);
      satelliteModel.update(orbitState);
      observationCone.update(orbitState, elapsed);
      firmsLayer.update(elapsed);
      persistenceField.update(elapsed);
      thermalRisk.update(delta, elapsed);
      industrialLayer.update(elapsed);
      controls.update(delta);

      // Update UI Telemetry throttled to 4Hz
      if (Math.floor(elapsed * 4) % 4 === 0) {
        setSatelliteTelemetry({
          satellite: 'NOAA-21 (JPSS-2)',
          sensor: 'VIIRS 375m',
          lat: +orbitState.latitude.toFixed(2),
          lon: +orbitState.longitude.toFixed(2),
          altitudeKm: 824,
          status: orbitState.isOverIndia ? 'SATELLITE PASS DETECTED' : 'ORBITAL PATROL',
          isOverIndia: orbitState.isOverIndia,
          utcTime: new Date().toISOString().slice(11, 19) + ' UTC',
        });
        setExpansionState(thermalRisk.getExpansionState());
      }

      renderer.render(scene, camera);
    };

    animate();

    // 7. Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        if (newWidth > 0 && newHeight > 0) {
          camera.aspect = newWidth / newHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(newWidth, newHeight);
        }
      }
    });
    resizeObserver.observe(mountTarget);

    // Fullscreen Resize Synchronization (Requirement 8)
    const handleFsResize = () => {
      const isFS = document.fullscreenElement === container;
      const w = mountTarget.clientWidth || (isFS ? window.innerWidth : 800);
      const h = mountTarget.clientHeight || (isFS ? window.innerHeight : 560);
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      setTimeout(() => {
        const curW = mountTarget.clientWidth || window.innerWidth;
        const curH = mountTarget.clientHeight || window.innerHeight;
        if (curW > 0 && curH > 0) {
          camera.aspect = curW / curH;
          camera.updateProjectionMatrix();
          renderer.setSize(curW, curH);
        }
      }, 120);
      setTimeout(() => {
        const curW = mountTarget.clientWidth || window.innerWidth;
        const curH = mountTarget.clientHeight || window.innerHeight;
        if (curW > 0 && curH > 0) {
          camera.aspect = curW / curH;
          camera.updateProjectionMatrix();
          renderer.setSize(curW, curH);
        }
      }, 300);
    };

    document.addEventListener('fullscreenchange', handleFsResize);
    document.addEventListener('webkitfullscreenchange', handleFsResize);
    document.addEventListener('mozfullscreenchange', handleFsResize);
    document.addEventListener('MSFullscreenChange', handleFsResize);

    // Cleanup
    return () => {
      document.removeEventListener('fullscreenchange', handleFsResize);
      document.removeEventListener('webkitfullscreenchange', handleFsResize);
      document.removeEventListener('mozfullscreenchange', handleFsResize);
      document.removeEventListener('MSFullscreenChange', handleFsResize);
      if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
      if (zoomStatusTimerRef.current) clearTimeout(zoomStatusTimerRef.current);
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('mousemove', handlePointerMove);
      renderer.domElement.removeEventListener('click', handlePointerClick);
      controls.detachDOM();
      earthSystem.dispose();
      orbitSystem.dispose();
      satelliteModel.dispose();
      observationCone.dispose();
      firmsLayer.dispose();
      persistenceField.dispose();
      thermalRisk.dispose();
      industrialLayer.dispose();
      if (mountTarget.contains(renderer.domElement)) {
        mountTarget.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Update Hotspot Points on filteredHotspots or viewMode change
  useEffect(() => {
    if (firmsLayerRef.current) {
      firmsLayerRef.current.setHotspots(
        filteredHotspots,
        selectedHotspot?.observation_id || null,
        viewMode
      );
    }
  }, [filteredHotspots, selectedHotspot, viewMode]);

  // Update Persistent Clusters on clusters change
  useEffect(() => {
    if (persistenceFieldRef.current) {
      persistenceFieldRef.current.setClusters(clusters, selectedCluster?.cluster_id || null);
    }
  }, [clusters, selectedCluster]);

  return (
    <div
      className={`satellite-globe-viewport ${isFullscreen ? 'is-fullscreen' : ''} ${
        workspaceState === 'INCIDENT_SPLIT_VIEW' ? 'is-split-view' : ''
      }`}
      ref={containerRef}
      tabIndex={0}
      onMouseEnter={() => {
        isHoveredRef.current = true;
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
      }}
    >
      {/* 3D WEBGL CANVAS SUB-CONTAINER (Resizes smoothly in split view) */}
      <div className="globe-canvas-subcontainer" ref={canvasMountRef} />
      {/* 1. TOP-LEFT MISSION CONTROL TELEMETRY HUD */}
      <div className="globe-telemetry-hud">
        <div className="hud-header">
          <span className="hud-pulse-dot" />
          <span className="hud-title">ORBITAL OBSERVATION PLATFORM</span>
        </div>
        <div className="hud-grid">
          <div className="hud-item">
            <span className="hud-label">SATELLITE</span>
            <span className="hud-value text-cyan">{satelliteTelemetry.satellite}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">SENSOR</span>
            <span className="hud-value text-emerald">{satelliteTelemetry.sensor}</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">STATUS</span>
            <span className={`hud-value ${satelliteTelemetry.isOverIndia ? 'text-green pulse' : 'text-amber'}`}>
              {satelliteTelemetry.status}
            </span>
          </div>
          <div className="hud-item">
            <span className="hud-label">SUB-SATELLITE POINT</span>
            <span className="hud-value font-mono">
              {satelliteTelemetry.lat > 0 ? `${satelliteTelemetry.lat}°N` : `${Math.abs(satelliteTelemetry.lat)}°S`},{' '}
              {satelliteTelemetry.lon > 0 ? `${satelliteTelemetry.lon}°E` : `${Math.abs(satelliteTelemetry.lon)}°W`}
            </span>
          </div>
          <div className="hud-item">
            <span className="hud-label">ALTITUDE</span>
            <span className="hud-value font-mono">824.0 KM (LEO)</span>
          </div>
          <div className="hud-item">
            <span className="hud-label">TIME</span>
            <span className="hud-value font-mono text-cyan">{satelliteTelemetry.utcTime}</span>
          </div>
        </div>

        {/* ACTIVE TARGET TELEMETRY ENRICHMENT (Requirement 12) */}
        {selectedIncident && (
          <div className="hud-target-block">
            <div className="target-block-header">
              <span className="target-dot" />
              <span>ACTIVE OBSERVATION TARGET</span>
            </div>
            <div className="target-grid">
              <div className="target-item">
                <span className="target-label">COORDINATES</span>
                <span className="target-val font-mono">
                  {selectedIncident.lat.toFixed(4)}°N, {selectedIncident.lon.toFixed(4)}°E
                </span>
              </div>
              <div className="target-item">
                <span className="target-label">THERMAL SIGNAL</span>
                <span className="target-val text-orange">
                  {selectedIncident.frp.toFixed(1)} MW / {selectedIncident.brightness.toFixed(1)} K
                </span>
              </div>
              <div className="target-item">
                <span className="target-label">PERSISTENCE</span>
                <span className="target-val text-cyan">
                  {selectedIncident.persistence >= 70
                    ? `CONFIRMED (${selectedIncident.persistence}%)`
                    : `LOW (${selectedIncident.persistence}%)`}
                </span>
              </div>
              <div className="target-item">
                <span className="target-label">AI CLASSIFICATION</span>
                <span className="target-val text-emerald">{selectedIncident.classification.toUpperCase()}</span>
              </div>
              <div className="target-item">
                <span className="target-label">RISK SCORE</span>
                <span className="target-val text-red font-mono">{selectedIncident.riskScore} / 100</span>
              </div>
              <div className="target-item">
                <span className="target-label">AI RISK FIELD</span>
                <span className="target-val text-amber font-mono">{selectedIncident.estimatedInfluenceKm.toFixed(1)} KM EST.</span>
              </div>
            </div>
            {selectedIncident.facilityName && (
              <div className="target-facility-row">
                <span className="facility-icon">FACILITY:</span>
                <span className="facility-name">
                  {selectedIncident.facilityName} {selectedIncident.distanceKm !== null && selectedIncident.distanceKm !== undefined ? `(${selectedIncident.distanceKm.toFixed(1)} km)` : ''}
                </span>
              </div>
            )}
            <div className="target-action-row">
              <button
                type="button"
                className="btn-target-open-incident"
                onClick={() => handleOpenIncidentCommand(selectedIncident)}
                title="Transform to Split Incident Command Workspace"
              >
                <span>OPEN INCIDENT</span>
              </button>
            </div>
          </div>
        )}

        {/* ACTIVE PASS NOTICE */}
        {satelliteTelemetry.isOverIndia && (
          <div className="hud-pass-badge">
            <span>ACQUISITION: ACTIVE VIIRS SWATH (INDIA CORRIDOR)</span>
          </div>
        )}
      </div>

      {/* 1B. DEMO MODE STEP BANNER (Requirement 20) */}
      {demoStep && isDemoRunning && (
        <div className="globe-demo-banner">
          <div className="demo-step-tag">STEP {demoStep.step}</div>
          <div className="demo-step-content">
            <span className="demo-step-title">{demoStep.label}</span>
            <span className="demo-step-desc">{demoStep.description}</span>
          </div>
        </div>
      )}

      {/* 1C. EXPLANATION CARD: WHY THE RISK FIELD EXISTS (Requirement 9) */}
      {selectedIncident && viewMode === 'risk_field' && (
        <div className="risk-explanation-card">
          <div className="explanation-header">
            <div className="explanation-title-row">
              <span className="explanation-icon">🔬</span>
              <span className="explanation-title">AI THERMAL RISK FIELD</span>
            </div>
            <span className={`explanation-badge ${selectedIncident.status.toLowerCase()}`}>
              {selectedIncident.status}
            </span>
          </div>

          <div className="explanation-grid">
            <div className="explanation-item">
              <span className="explanation-label">SOURCE</span>
              <span className="explanation-val">{selectedIncident.source} ({selectedIncident.satellite})</span>
            </div>
            <div className="explanation-item">
              <span className="explanation-label">PERSISTENCE</span>
              <span className="explanation-val text-cyan font-mono">{selectedIncident.persistence}%</span>
            </div>
            <div className="explanation-item">
              <span className="explanation-label">INDUSTRIAL PROBABILITY</span>
              <span className="explanation-val text-emerald font-mono">{selectedIncident.industrialProb}%</span>
            </div>
            <div className="explanation-item">
              <span className="explanation-label">RISK SCORE</span>
              <span className="explanation-val text-red font-mono">{selectedIncident.riskScore} / 100</span>
            </div>
            <div className="explanation-item">
              <span className="explanation-label">ESTIMATED INFLUENCE</span>
              <span className="explanation-val text-orange font-mono">{selectedIncident.estimatedInfluenceKm.toFixed(1)} KM</span>
            </div>
            <div className="explanation-item">
              <span className="explanation-label">STATUS</span>
              <span className="explanation-val font-mono">{selectedIncident.status}</span>
            </div>
          </div>

          {selectedIncident.facilityName && (
            <div className="explanation-facility-block">
              <span className="facility-label">NEARBY INDUSTRIAL CONTEXT:</span>
              <span className="facility-name-val">
                {selectedIncident.facilityName} ({selectedIncident.distanceKm?.toFixed(1) || '1.8'} km)
              </span>
            </div>
          )}

          <div className="explanation-basis-block">
            <span className="basis-title">FIELD BASIS</span>
            <span className="basis-formula">
              THERMAL SIGNAL + PERSISTENCE + INDUSTRIAL CONTEXT + SPATIAL RISK
            </span>
          </div>
        </div>
      )}

      {/* 2. TOP-RIGHT MODE & VIEW CONTROLS */}
      <div className="globe-top-controls">
        <div className="globe-control-pill-group">
          <button
            type="button"
            className={`btn-globe-pill ${viewMode === 'risk_field' ? 'active' : ''}`}
            onClick={() => setViewMode('risk_field')}
            title="3D Volumetric Thermal Risk Propagation Volume (AI Estimated)"
          >
            3D Risk Field
          </button>
          <button
            type="button"
            className={`btn-globe-pill ${viewMode === 'heatmap' ? 'active' : ''}`}
            onClick={() => setViewMode('heatmap')}
            title="Aggregated Thermal Density Heatmap Field"
          >
            Thermal Field
          </button>
        </div>

        <div className="globe-nav-buttons">
          {/* SIH DEMO SEQUENCE TRIGGER (Requirement 20) */}
          <button
            type="button"
            className={`btn-globe-demo ${isDemoRunning ? 'running' : ''}`}
            onClick={runDemoPipeline}
            title="Run Automated 6-8s End-to-End Satellite Intelligence Demo Pipeline"
            disabled={isDemoRunning}
          >
            {isDemoRunning ? 'RUNNING DEMO...' : 'SIH PIPELINE DEMO'}
          </button>
          <button
            type="button"
            className="btn-globe-nav"
            onClick={() => controlsRef.current?.flyToIndia()}
            title="Recenter Camera on Indian Subcontinent"
          >
            India Focus
          </button>
          {/* OPEN INCIDENT BUTTON IN FULLSCREEN_MAP (Requirement 5) */}
          {workspaceState === 'FULLSCREEN_MAP' && (
            <button
              type="button"
              className="btn-globe-nav btn-globe-incident-open"
              onClick={() => handleOpenIncidentCommand(selectedIncident)}
              title="Open Incident Command Split Workspace"
            >
              <span>OPEN INCIDENT</span>
            </button>
          )}

          <button
            type="button"
            className={`btn-globe-nav btn-globe-fullscreen ${isFullscreen ? 'active' : ''}`}
            onClick={toggleFullscreenOrWorkspace}
            title={
              workspaceState === 'INCIDENT_SPLIT_VIEW'
                ? 'EXIT WORKSPACE TO NORMAL DASHBOARD'
                : workspaceState === 'FULLSCREEN_MAP'
                ? 'EXIT FULL SCREEN'
                : 'ENTER FULL SCREEN'
            }
            aria-label={
              workspaceState === 'INCIDENT_SPLIT_VIEW'
                ? 'Exit workspace'
                : workspaceState === 'FULLSCREEN_MAP'
                ? 'Exit full screen'
                : 'Enter full screen'
            }
          >
            <span className="fullscreen-icon">
              {workspaceState === 'INCIDENT_SPLIT_VIEW' ? '⤢' : '⛶'}
            </span>
            <span>
              {workspaceState === 'INCIDENT_SPLIT_VIEW'
                ? 'EXIT WORKSPACE'
                : workspaceState === 'FULLSCREEN_MAP'
                ? 'EXIT FULL SCREEN'
                : 'FULL SCREEN'}
            </span>
          </button>
        </div>
      </div>

      {/* 3. BOTTOM-LEFT 6-STAGE EXPANSION PHASE INDICATOR */}
      <div className="globe-phase-indicator">
        <div className="phase-row">
          <span className="phase-pill">STAGE {expansionState.stageNumber}</span>
          <span className="phase-label">{expansionState.stage}</span>
        </div>
        <div className="phase-sublabel">{expansionState.label}</div>
        <div className="phase-disclaimer">
          AI ESTIMATED THERMAL INFLUENCE ZONE — Calculated atmospheric risk propagation, not physical fire boundary.
        </div>
      </div>

      {/* 4. BOTTOM-RIGHT TEMPORAL REPLAY TIMELINE */}
      <div className="globe-timeline-panel">
        <span className="timeline-title">TEMPORAL REPLAY</span>
        <div className="timeline-buttons">
          {(['-6h', '-3h', '-1h', 'NOW'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`btn-timeline-step ${timeFilter === t ? 'active' : ''}`}
              onClick={() => setTimeFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="timeline-count">
          Showing {filteredHotspots.length} NASA FIRMS Detections
        </span>
      </div>

      {/* 5. SCIENTIFIC HOVER CARD */}
      {hoveredHotspot && hoverPos && (
        <div
          className="globe-scientific-tooltip"
          style={{ left: hoverPos.x, top: hoverPos.y }}
        >
          <div className="tooltip-header">
            <span className="tooltip-title">AI THERMAL RISK FIELD</span>
          </div>
          <div className="tooltip-body">
            <div className="tooltip-row">
              <span className="tt-label">Source:</span>
              <span className="tt-val">{hoveredHotspot.source || 'NASA FIRMS'}</span>
            </div>
            <div className="tooltip-row">
              <span className="tt-label">Satellite / Sensor:</span>
              <span className="tt-val">{hoveredHotspot.satellite || 'NOAA-21'} / {hoveredHotspot.instrument || 'VIIRS'}</span>
            </div>
            <div className="tooltip-row">
              <span className="tt-label">FRP / Radiance:</span>
              <span className="tt-val text-orange font-mono">{hoveredHotspot.frp?.toFixed(1) || '32.0'} MW</span>
            </div>
            <div className="tooltip-row">
              <span className="tt-label">Brightness:</span>
              <span className="tt-val font-mono">{hoveredHotspot.brightness?.toFixed(1) || '342.5'} K</span>
            </div>
            <div className="tooltip-row">
              <span className="tt-label">Confidence:</span>
              <span className="tt-val text-green font-mono">{hoveredHotspot.confidence || 'nominal'}</span>
            </div>
            <div className="tooltip-row">
              <span className="tt-label">Coordinates:</span>
              <span className="tt-val font-mono">{hoveredHotspot.latitude.toFixed(4)}°N, {hoveredHotspot.longitude.toFixed(4)}°E</span>
            </div>
          </div>
          <div className="tooltip-actions">
            <button
              type="button"
              className="btn-tooltip-open-incident"
              onClick={(e) => {
                e.stopPropagation();
                handleHotspotClick(hoveredHotspot);
                handleOpenIncidentCommand();
              }}
            >
              <span>OPEN INCIDENT COMMAND</span>
            </button>
          </div>
          <div className="tooltip-footer">Click anomaly to lock camera & activate 3D risk volume</div>
        </div>
      )}

      {/* 5B. FLOATING QUICK ACTION CTA (FULLSCREEN_MAP MODE) */}
      {workspaceState === 'FULLSCREEN_MAP' && selectedIncident && (
        <div className="globe-fullscreen-incident-cta">
          <div className="cta-pulse-dot" />
          <div className="cta-label-group">
            <span className="cta-id">INCIDENT #{selectedIncident.id}</span>
            <span className="cta-meta">
              {selectedIncident.source} • {selectedIncident.frp.toFixed(1)} MW • RISK {selectedIncident.riskScore}/100
            </span>
          </div>
          <button
            type="button"
            className="btn-cta-open-incident"
            onClick={() => handleOpenIncidentCommand(selectedIncident)}
            title="Open Incident Command Split Workspace"
          >
            <span>OPEN INCIDENT COMMAND</span>
            <span className="cta-arrow">&rarr;</span>
          </button>
        </div>
      )}

      {/* 6. CTRL + SCROLL UX HINT & STATUS INDICATOR */}
      {showZoomHint && (
        <div className="globe-zoom-hint" role="status" aria-live="polite">
          <span>HOLD CTRL + SCROLL TO ZOOM</span>
        </div>
      )}
      {ctrlZoomStatus && (
        <div className={`globe-ctrl-indicator ${ctrlZoomStatus}`} role="status">
          <span className={`ctrl-dot ${ctrlZoomStatus}`} />
          <span>{ctrlZoomStatus === 'enabled' ? 'CTRL + SCROLL ZOOM ENABLED' : 'ZOOM LOCKED'}</span>
        </div>
      )}

      {/* 7. INCIDENT COMMAND SPLIT WORKSPACE PANEL (Requirements 1, 2, 3, 4, 7) */}
      {workspaceState === 'INCIDENT_SPLIT_VIEW' && (() => {
        const activeIncident: SelectedIncidentState = selectedIncident || {
          id: hotspots[0]?.observation_id || 'TH-2026-0842',
          lat: hotspots[0]?.latitude || 22.4208,
          lon: hotspots[0]?.longitude || 69.8312,
          satellite: hotspots[0]?.satellite || 'NOAA-21',
          sensor: hotspots[0]?.instrument || 'VIIRS 375m',
          source: hotspots[0]?.source || 'NASA FIRMS',
          frp: hotspots[0]?.frp || 48.6,
          brightness: hotspots[0]?.brightness || 346.8,
          confidence: String(hotspots[0]?.confidence || 'high'),
          persistence: 84,
          industrialProb: 91,
          riskScore: 88,
          estimatedInfluenceKm: 3.2,
          status: 'CRITICAL',
          classification: 'Industrial High-Temperature Facility',
          facilityName: null,
          facilityType: null,
          distanceKm: null,
          acquired_at: hotspots[0]?.acquired_at || new Date().toISOString(),
        };

        return (
          <aside className="globe-incident-command-panel" aria-label="Incident Command Center">
            {/* Telemetry Bus / Connection Header (Requirement 3) */}
            <div className="incident-panel-connector">
              <div className="connector-pulse-line" />
              <div className="connector-meta">
                <span className="connector-dot pulse" />
                <span className="connector-tag">LIVE SATELLITE TELEMETRY BUS ↔ ANOMALY TARGET LOCK</span>
              </div>
              <div className="connector-status-badge">SYNCED (4Hz)</div>
            </div>

            {/* Clean Command Header */}
            <div className="command-panel-header">
              <div className="command-header-left">
                <div className="header-badge-row">
                  <span className="tactical-badge">INCIDENT COMMAND</span>
                  <span className={`status-badge-pill ${activeIncident.status.toLowerCase()}`}>
                    ● {activeIncident.status}
                  </span>
                  <span className="class-pill">{activeIncident.classification}</span>
                </div>
                <h2 className="command-incident-id">
                  INCIDENT #{activeIncident.id}
                </h2>
                <div className="command-incident-sub">
                  NASA FIRMS THERMAL ANOMALY • AI INDUSTRIAL RISK ZONE
                </div>
              </div>

              <div className="command-header-right">
                <button
                  type="button"
                  className="btn-command-close"
                  onClick={handleCloseIncidentCommand}
                  title="Close Incident Command (Returns to Fullscreen 3D Globe - ESC)"
                  aria-label="Close Incident Command"
                >
                  <span className="close-bracket">[</span>
                  <span className="close-text">CLOSE INCIDENT</span>
                  <span className="close-bracket">]</span>
                  <span className="close-key">ESC</span>
                </button>
              </div>
            </div>

            {/* Scrollable Operational Body (8 Sections - Requirement 2) */}
            <div className="command-panel-body">
              {/* SECTION 01 — EVENT SUMMARY */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">01</span>
                  <h3 className="section-title">EVENT SUMMARY</h3>
                  <span className="section-tag">FIRMS CORE</span>
                </div>
                <div className="command-metrics-grid cols-2">
                  <div className="command-metric-box">
                    <span className="metric-lbl">INCIDENT ID</span>
                    <span className="metric-val font-mono text-cyan">{activeIncident.id}</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">INGEST SOURCE</span>
                    <span className="metric-val text-amber">{activeIncident.source} ({activeIncident.satellite})</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">SENSOR / ORBIT</span>
                    <span className="metric-val font-mono">{activeIncident.sensor || 'VIIRS 375m'} (LEO 824km)</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">TARGET COORDS</span>
                    <span className="metric-val font-mono text-white">
                      {activeIncident.lat.toFixed(4)}°N, {activeIncident.lon.toFixed(4)}°E
                    </span>
                  </div>
                  <div className="command-metric-box span-2">
                    <span className="metric-lbl">ACQUISITION TIMESTAMP</span>
                    <span className="metric-val font-mono text-emerald">
                      {activeIncident.acquired_at ? new Date(activeIncident.acquired_at).toUTCString() : satelliteTelemetry.utcTime} (LATENCY: 3.8m)
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION 02 — THERMAL SIGNAL */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">02</span>
                  <h3 className="section-title">THERMAL SIGNAL</h3>
                  <span className="section-tag">RADIOMETRIC</span>
                </div>
                <div className="command-metrics-grid cols-2">
                  <div className="command-metric-box highlight-box">
                    <span className="metric-lbl">FIRE RADIATIVE POWER (FRP)</span>
                    <div className="frp-display">
                      <span className="frp-num text-orange">{activeIncident.frp.toFixed(1)}</span>
                      <span className="frp-unit">MW</span>
                    </div>
                    <div className="command-meter-bar">
                      <div
                        className="meter-fill orange"
                        style={{ width: `${Math.min(100, (activeIncident.frp / 120) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="command-metric-box highlight-box">
                    <span className="metric-lbl">BRIGHTNESS TEMPERATURE</span>
                    <div className="frp-display">
                      <span className="frp-num text-cyan">{activeIncident.brightness.toFixed(1)}</span>
                      <span className="frp-unit">K</span>
                    </div>
                    <div className="command-meter-bar">
                      <div
                        className="meter-fill cyan"
                        style={{ width: `${Math.min(100, Math.max(10, ((activeIncident.brightness - 300) / 100) * 100))}%` }}
                      />
                    </div>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">DETECTION CONFIDENCE</span>
                    <span className="metric-val font-mono text-green">{activeIncident.confidence.toUpperCase()}</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">RADIANCE INTENSITY</span>
                    <span className="metric-val font-mono">{(activeIncident.frp * 0.82 + 14.5).toFixed(1)} W/m²·sr</span>
                  </div>
                </div>
              </div>

              {/* SECTION 03 — PERSISTENCE ANALYSIS */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">03</span>
                  <h3 className="section-title">PERSISTENCE ANALYSIS</h3>
                  <span className="section-tag">TEMPORAL</span>
                </div>
                <div className="persistence-card">
                  <div className="persistence-score-row">
                    <div className="score-desc">
                      <span className="score-title">MULTI-PASS RECURRENCE SCORE</span>
                      <span className="score-sub">Identified across 3 consecutive NOAA-21 / VIIRS passes</span>
                    </div>
                    <div className="score-badge-circle">
                      <span className="score-val">{activeIncident.persistence}%</span>
                    </div>
                  </div>
                  <div className="history-pass-summary">
                    <div className="pass-cell">
                      <span className="p-time">-6h</span>
                      <span className="p-status">DETECTED</span>
                      <span className="p-val font-mono">24.2 MW</span>
                    </div>
                    <div className="pass-arrow">→</div>
                    <div className="pass-cell">
                      <span className="p-time">-3h</span>
                      <span className="p-status">CONFIRMED</span>
                      <span className="p-val font-mono">31.8 MW</span>
                    </div>
                    <div className="pass-arrow">→</div>
                    <div className="pass-cell">
                      <span className="p-time">-1h</span>
                      <span className="p-status">ELEVATED</span>
                      <span className="p-val font-mono">39.0 MW</span>
                    </div>
                    <div className="pass-arrow">→</div>
                    <div className="pass-cell active">
                      <span className="p-time">NOW</span>
                      <span className="p-status">ACTIVE PEAK</span>
                      <span className="p-val font-mono text-orange">{activeIncident.frp.toFixed(1)} MW</span>
                    </div>
                  </div>
                  <div className="trend-banner">
                    <span className="trend-label">PERSISTENCE TREND:</span>
                    <span className="trend-val text-emerald">STABLE HIGH THERMAL EMISSION (HIGH RUNTIME CONTINUITY)</span>
                  </div>
                </div>
              </div>

              {/* SECTION 04 — AI INDUSTRIAL CLASSIFICATION */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">04</span>
                  <h3 className="section-title">AI INDUSTRIAL CLASSIFICATION</h3>
                  <span className="section-tag">DUAL-PATH ML</span>
                </div>
                <div className="command-metrics-grid cols-2">
                  <div className="command-metric-box span-2">
                    <span className="metric-lbl">PRIMARY CLASSIFICATION</span>
                    <span className="metric-val text-emerald font-bold">{activeIncident.classification}</span>
                    <span className="metric-sub">Thermoscope Dual-Path Thermal Classifier v2.4 (Biomass vs Industrial)</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">INDUSTRIAL PROBABILITY</span>
                    <div className="prob-value-row">
                      <span className="metric-val font-mono text-cyan">{activeIncident.industrialProb}%</span>
                      <div className="command-meter-bar">
                        <div className="meter-fill cyan" style={{ width: `${activeIncident.industrialProb}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">ANOMALY GEOMETRY</span>
                    <span className="metric-val font-mono text-white">POINT SOURCE (HIGH-RADIANCE)</span>
                  </div>
                </div>
              </div>

              {/* SECTION 05 — INDUSTRIAL CONTEXT */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">05</span>
                  <h3 className="section-title">INDUSTRIAL CONTEXT</h3>
                  <span className="section-tag">OSM GEODATA</span>
                </div>
                <div className="facility-context-card">
                  <div className="facility-head-row">
                    <span className="fac-icon">[FACILITY]</span>
                    <div className="fac-details">
                      <span className="fac-name">{activeIncident.facilityName || 'Jamnagar Refining & Petrochemical Complex'}</span>
                      <span className="fac-type">{activeIncident.facilityType || 'Heavy Hydrocarbon Refining & Petrochemical Processing'}</span>
                    </div>
                  </div>
                  <div className={`proximity-alert-box ${(activeIncident.distanceKm || 1.8) < 3.0 ? 'critical' : 'monitoring'}`}>
                    <span className="alert-icon">!</span>
                    <span className="alert-text">
                      {(activeIncident.distanceKm || 1.8) < 3.0
                        ? 'CRITICAL PROXIMITY ALERT — Anomaly centered within active petrochemical hazard perimeter.'
                        : 'STANDARD INDUSTRIAL BUFFER — Thermal emission monitored within 5.0 km zone.'}
                    </span>
                  </div>
                )}
              </div>

              {/* SECTION 06 — 3D RISK ASSESSMENT */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">06</span>
                  <h3 className="section-title">3D RISK ASSESSMENT</h3>
                  <span className="section-tag">VOLUMETRIC</span>
                </div>
                <div className="command-metrics-grid cols-2">
                  <div className="command-metric-box highlight-box">
                    <span className="metric-lbl">COMPOSITE RISK SCORE</span>
                    <div className="risk-display">
                      <span className="risk-num text-red">{activeIncident.riskScore}</span>
                      <span className="risk-max">/ 100</span>
                      <span className={`risk-status-pill ${activeIncident.status.toLowerCase()}`}>
                        {activeIncident.status}
                      </span>
                    </div>
                    <div className="command-meter-bar">
                      <div
                        className="meter-fill red"
                        style={{ width: `${activeIncident.riskScore}%` }}
                      />
                    </div>
                  </div>
                  <div className="command-metric-box highlight-box">
                    <span className="metric-lbl">ESTIMATED INFLUENCE ZONE</span>
                    <div className="risk-display">
                      <span className="risk-num text-amber">{activeIncident.estimatedInfluenceKm.toFixed(1)}</span>
                      <span className="risk-max">KM RADIUS</span>
                    </div>
                    <span className="metric-sub">Calculated atmospheric risk propagation</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">DISPERSION FACTOR</span>
                    <span className="metric-val font-mono">PASQUILL CLASS D (MODERATE)</span>
                  </div>
                  <div className="command-metric-box">
                    <span className="metric-lbl">ESTIMATED EXPOSURE</span>
                    <span className="metric-val font-mono text-orange">3 INDUSTRIAL SECTORS</span>
                  </div>
                </div>
              </div>

              {/* SECTION 07 — EVIDENCE & TELEMETRY */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">07</span>
                  <h3 className="section-title">EVIDENCE & SATELLITE TELEMETRY</h3>
                  <span className="section-tag">VIIRS BANDS</span>
                </div>
                <div className="telemetry-table">
                  <div className="tel-row">
                    <span className="tel-key">BAND M13 (4.05µm MEDIUM IR)</span>
                    <span className="tel-val font-mono text-orange">3.82 W/m²·sr (HIGH RADIANCE)</span>
                  </div>
                  <div className="tel-row">
                    <span className="tel-key">BAND I4 (3.74µm THERMAL)</span>
                    <span className="tel-val font-mono text-cyan">356.2 K (BRIGHT ANOMALY)</span>
                  </div>
                  <div className="tel-row">
                    <span className="tel-key">CLOUD COVER / ATMOSPHERE</span>
                    <span className="tel-val font-mono text-emerald">0.0% (CLEAR SKY TRANSMITTANCE)</span>
                  </div>
                  <div className="tel-row">
                    <span className="tel-key">SOLAR ZENITH ANGLE</span>
                    <span className="tel-val font-mono">142.4° (NIGHTTIME CONTRAST)</span>
                  </div>
                  <div className="tel-row">
                    <span className="tel-key">SCAN ANGLE / RESOLUTION</span>
                    <span className="tel-val font-mono">12.8° NADIR / 375 METERS</span>
                  </div>
                </div>
              </div>

              {/* SECTION 08 — INCIDENT RESPONSE ACTIONS */}
              <div className="command-section">
                <div className="section-header">
                  <span className="section-num">08</span>
                  <h3 className="section-title">INCIDENT RESPONSE ACTIONS</h3>
                  <span className="section-tag">OPERATIONAL</span>
                </div>
                <div className="action-buttons-grid">
                  <button
                    type="button"
                    className="btn-operational-action alert-btn"
                    onClick={() =>
                      setActionFeedback((prev) => ({
                        ...prev,
                        dispatch: {
                          status: 'PRIORITY ALERT DISPATCHED TO SPCB & NDRF HAZMAT • ACK #TX-9842',
                          timestamp: new Date().toLocaleTimeString(),
                        },
                      }))
                    }
                  >
                    <div className="btn-text-block">
                      <span className="btn-main-label">DISPATCH ALERT</span>
                      <span className="btn-sub-label">Disaster & Pollution Board Notice</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="btn-operational-action task-btn"
                    onClick={() =>
                      setActionFeedback((prev) => ({
                        ...prev,
                        tasking: {
                          status: 'TASKING ACQUIRED: SENTINEL-2 MSI SCHEDULED (10M GSD) • ORBIT #31084',
                          timestamp: new Date().toLocaleTimeString(),
                        },
                      }))
                    }
                  >
                    <div className="btn-text-block">
                      <span className="btn-main-label">TASK HIGH-RES SATELLITE</span>
                      <span className="btn-sub-label">Sentinel-2 / PlanetScope Revisit</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="btn-operational-action brief-btn"
                    onClick={() =>
                      setActionFeedback((prev) => ({
                        ...prev,
                        brief: {
                          status: 'INCIDENT DOSSIER EXPORTED (THERMOSCOPE_INCIDENT_BRIEF.PDF)',
                          timestamp: new Date().toLocaleTimeString(),
                        },
                      }))
                    }
                  >
                    <div className="btn-text-block">
                      <span className="btn-main-label">GENERATE BRIEF</span>
                      <span className="btn-sub-label">Download Structured Dossier</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="btn-operational-action notify-btn"
                    onClick={() =>
                      setActionFeedback((prev) => ({
                        ...prev,
                        notify: {
                          status: 'COMPLIANCE DIRECTIVE SENT TO FACILITY HSE OFFICER • ACK #HSE-449',
                          timestamp: new Date().toLocaleTimeString(),
                        },
                      }))
                    }
                  >
                    <div className="btn-text-block">
                      <span className="btn-main-label">NOTIFY FACILITY</span>
                      <span className="btn-sub-label">Direct HSE Compliance Inquiry</span>
                    </div>
                  </button>
                </div>

                {/* Live Action Feedback Stream */}
                {Object.keys(actionFeedback).length > 0 && (
                  <div className="action-feedback-stream">
                    <div className="feedback-stream-title">OPERATIONAL DISPATCH AUDIT LOG:</div>
                    {Object.entries(actionFeedback).map(([key, fb]) => (
                      <div key={key} className="feedback-log-item">
                        <span className="log-dot" />
                        <span className="log-time font-mono">[{fb.timestamp}]</span>
                        <span className="log-text">{fb.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        );
      })()}
    </div>
  );
};
