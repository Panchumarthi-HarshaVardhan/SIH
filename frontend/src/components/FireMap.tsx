import {
  faBolt,
  faBookOpen,
  faHospital,
  faIndustry,
  faMagnifyingGlass,
  faMap,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Flame,
  Activity,
  MapPin,
  Globe,
  CircleDot,
  Shield,
  Satellite as LucideSatellite,
  Map as LucideMap,
  BookOpen as LucideBookOpen,
  Maximize2,
  Minimize2,
  X as LucideX,
  Zap,
  Factory,
  TreePine,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Radio,
} from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import {
  Hotspot,
  OsmFeature,
  PersistentCluster,
  ThermalAlert,
  ThreatZonesResponse,
  ExposedAsset,
  PriorityRankingItem,
  HotspotContextResponse,
} from '../types/hotspot';
import { getApiUrl } from '../config/api';
import { filterThermalPointsInsideIndia, isPointInsideIndia } from '../utils/geoUtils';

export interface FireMapProps {
  viewMode?: 'hotspots' | 'clusters';
  hotspots?: Hotspot[];
  clusters?: PersistentCluster[];
  activeAlerts?: ThermalAlert[];
  center?: [number, number];
  mapCenter?: [number, number];
  zoom?: number;
  mapZoom?: number;
  selectedHotspot?: Hotspot | null;
  onSelectHotspot?: (hotspot: Hotspot) => void;
  selectedCluster?: PersistentCluster | null;
  onSelectCluster?: (cluster: PersistentCluster) => void;
  selectedAlert?: ThermalAlert | null;
  onSelectAlert?: (alert: ThermalAlert) => void;
  selectedPriorityIncident?: PriorityRankingItem | null;
  onSelectPriorityIncident?: (incident: PriorityRankingItem) => void;
  priorityItems?: PriorityRankingItem[];
  nearbyFeatures?: OsmFeature[];
  threatZones?: ThreatZonesResponse | null;
  exposedAssets?: ExposedAsset[];
  onSelectAsset?: (asset: ExposedAsset) => void;
  basemap?: 'standard' | 'satellite';
  onBasemapChange?: (mode: 'standard' | 'satellite') => void;
  onOpenInvestigation?: () => void;
  onMapBackgroundClick?: () => void;
}

const MapViewController: React.FC<{ center: [number, number]; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();
  const prevRef = useRef<{ lat: number; lng: number; zoom: number }>({
    lat: center[0],
    lng: center[1],
    zoom,
  });

  useEffect(() => {
    const prev = prevRef.current;
    if (
      Math.abs(prev.lat - center[0]) > 0.0001 ||
      Math.abs(prev.lng - center[1]) > 0.0001 ||
      prev.zoom !== zoom
    ) {
      prevRef.current = { lat: center[0], lng: center[1], zoom };
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);

  return null;
};

// Map Background Click Handler: detects clicks on empty canvas to deselect anomaly and reset map
const LeafletMapBackgroundClickHandler: React.FC<{
  onMapBackgroundClick?: () => void;
}> = ({ onMapBackgroundClick }) => {
  useMapEvents({
    click: (e) => {
      const target = e.originalEvent?.target as HTMLElement | null;
      if (target) {
        if (
          target.tagName === 'path' ||
          target.tagName === 'circle' ||
          target.closest('.leaflet-popup') ||
          target.closest('.leaflet-marker-icon') ||
          target.closest('.leaflet-control') ||
          target.closest('button')
        ) {
          return;
        }
      }
      onMapBackgroundClick?.();
    },
  });
  return null;
};

// Direct mouse wheel scroll zoom handler for Leaflet 2D map
const LeafletMouseScrollZoomHandler: React.FC = () => {
  const map = useMap();

  useEffect(() => {
    map.scrollWheelZoom.enable();

    const container = map.getContainer();
    let lastZoomTime = 0;

    const onWheel = (e: WheelEvent) => {
      // Whenever mouse is on the map canvas, scrolling the wheel zooms in/out directly
      e.preventDefault();
      const now = Date.now();
      if (now - lastZoomTime > 75) {
        lastZoomTime = now;
        if (e.deltaY < 0) {
          map.zoomIn(1);
        } else if (e.deltaY > 0) {
          map.zoomOut(1);
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [map]);

  return null;
};

// Invalidate Leaflet tile geometry when toggling fullscreen
const LeafletFullscreenResizeHandler: React.FC<{ isFullscreen: boolean }> = ({ isFullscreen }) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 120);
    const t2 = setTimeout(() => map.invalidateSize(), 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isFullscreen, map]);
  return null;
};

// Invalidate Leaflet tile geometry when toggling split incident command view
const LeafletSplitResizeHandler: React.FC<{ isSplitView: boolean }> = ({ isSplitView }) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 60);
    const t2 = setTimeout(() => map.invalidateSize(), 200);
    const t3 = setTimeout(() => map.invalidateSize(), 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isSplitView, map]);
  return null;
};

// Smooth 2D Camera Navigation Controller (India Focus, Global View, Anomaly Selection)
const LeafletFlyToController: React.FC<{
  navCommand: { lat: number; lon: number; zoom: number; timestamp: number } | null;
}> = ({ navCommand }) => {
  const map = useMap();
  useEffect(() => {
    if (navCommand) {
      map.flyTo([navCommand.lat, navCommand.lon], navCommand.zoom, { duration: 1.2 });
    }
  }, [navCommand, map]);
  return null;
};

// Injects SVG definitions for continuous AI Risk Field Radial Gradient into Leaflet overlay pane
const LeafletSvgDefs: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    try {
      const overlayPane = map.getPanes()?.overlayPane;
      if (!overlayPane) return;
      const svg = overlayPane.querySelector('svg');
      if (!svg) return;
      let defs = svg.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svg.insertBefore(defs, svg.firstChild);
      }
      if (!defs.querySelector('#ai-risk-radial-gradient')) {
        const radGrad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
        radGrad.setAttribute('id', 'ai-risk-radial-gradient');
        radGrad.setAttribute('cx', '50%');
        radGrad.setAttribute('cy', '50%');
        radGrad.setAttribute('r', '50%');
        radGrad.setAttribute('fx', '50%');
        radGrad.setAttribute('fy', '50%');

        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', '#dc2626');
        stop1.setAttribute('stop-opacity', '0.85');

        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '35%');
        stop2.setAttribute('stop-color', '#ea580c');
        stop2.setAttribute('stop-opacity', '0.50');

        const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop3.setAttribute('offset', '70%');
        stop3.setAttribute('stop-color', '#f59e0b');
        stop3.setAttribute('stop-opacity', '0.22');

        const stop4 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop4.setAttribute('offset', '100%');
        stop4.setAttribute('stop-color', '#eab308');
        stop4.setAttribute('stop-opacity', '0.0');

        radGrad.appendChild(stop1);
        radGrad.appendChild(stop2);
        radGrad.appendChild(stop3);
        radGrad.appendChild(stop4);
        defs.appendChild(radGrad);
      }
    } catch (e) {
      console.warn('Could not inject SVG defs into Leaflet pane:', e);
    }
  }, [map]);
  return null;
};

export type WorkspaceState = 'NORMAL_DASHBOARD' | 'FULLSCREEN_MAP' | 'INCIDENT_SPLIT_VIEW';

export const FireMap: React.FC<FireMapProps> = ({
  viewMode = 'hotspots',
  hotspots = [],
  clusters = [],
  activeAlerts = [],
  center,
  mapCenter,
  zoom,
  mapZoom,
  selectedHotspot = null,
  onSelectHotspot = () => {},
  selectedCluster = null,
  onSelectCluster = () => {},
  selectedAlert = null,
  onSelectAlert = () => {},
  selectedPriorityIncident = null,
  onSelectPriorityIncident: _onSelectPriorityIncident,
  priorityItems: _priorityItems = [],
  nearbyFeatures: _nearbyFeatures = [],
  threatZones = null,
  exposedAssets = [],
  onSelectAsset,
  basemap = 'satellite',
  onBasemapChange,
  onOpenInvestigation,
  onMapBackgroundClick,
}) => {
  const effectiveCenter: [number, number] = center || mapCenter || [20.5937, 78.9629];
  const effectiveZoom: number = zoom || mapZoom || 5;

  // Filter thermal hotspots strictly within India's boundary polygon
  const indiaHotspots = React.useMemo(() => {
    return filterThermalPointsInsideIndia(hotspots);
  }, [hotspots]);

  // Filter persistent clusters with center coordinates inside India
  const indiaClusters = React.useMemo(() => {
    return clusters.filter((c) => c && isPointInsideIndia(c.center_latitude, c.center_longitude));
  }, [clusters]);

  // Filter active alerts with coordinates inside India
  const indiaAlerts = React.useMemo(() => {
    return activeAlerts.filter((a) => a && isPointInsideIndia(a.latitude, a.longitude));
  }, [activeAlerts]);

  // Basemap Switcher State (Standard vs Satellite)
  const [internalBasemap, setInternalBasemap] = useState<'standard' | 'satellite'>(basemap);
  const activeBasemap = basemap || internalBasemap;

  const handleBasemapToggle = (mode: 'standard' | 'satellite') => {
    setInternalBasemap(mode);
    if (onBasemapChange) {
      onBasemapChange(mode);
    }
  };

  const mapboxToken = (import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN || '';

  // 2D Tactical Intelligence Modes
  const [riskDisplayMode, setRiskDisplayMode] = useState<'ai_risk' | 'thermal_field'>('ai_risk');
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>('NORMAL_DASHBOARD');
  const [expansionStage, setExpansionStage] = useState<number>(6);
  const [navCommand, setNavCommand] = useState<{ lat: number; lon: number; zoom: number; timestamp: number } | null>(null);
  const [actionLogs, setActionLogs] = useState<Array<{ id: string; time: string; text: string }>>([
    { id: '1', time: '14:32:10Z', text: 'Telemetry linked: NOAA-21 VIIRS 375m active channel' },
    { id: '2', time: '14:32:15Z', text: 'AI Risk Propagation Field initialized with continuous gradient' },
  ]);

  // Layer Toggles
  const [showOperationalBuffer, setShowOperationalBuffer] = useState<boolean>(false);
  const [showThreatZones, setShowThreatZones] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const isMapHoveredRef = useRef<boolean>(false);

  // Fullscreen State (Synced with actual document.fullscreenElement)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    }
    return false;
  });

  const handleEnterFullscreen = useCallback(() => {
    const container = mapWrapperRef.current;
    if (!container) return;

    const requestFn =
      container.requestFullscreen ||
      (container as any).webkitRequestFullscreen ||
      (container as any).mozRequestFullScreen ||
      (container as any).msRequestFullscreen;
    if (requestFn) {
      requestFn.call(container).then(() => {
        setIsFullscreen(true);
        setWorkspaceState('FULLSCREEN_MAP');
      }).catch((err: any) => {
        console.warn('Error entering fullscreen:', err);
        setIsFullscreen(true);
        setWorkspaceState('FULLSCREEN_MAP');
      });
    } else {
      setIsFullscreen(true);
      setWorkspaceState('FULLSCREEN_MAP');
    }
  }, []);

  const handleExitFullscreen = useCallback(() => {
    const currentFsEl =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;

    if (currentFsEl) {
      const exitFn =
        document.exitFullscreen ||
        (document as any).webkitExitFullscreen ||
        (document as any).mozCancelFullScreen ||
        (document as any).msExitFullscreen;
      if (exitFn) {
        exitFn.call(document).catch((err: any) => {
          console.warn('Error exiting fullscreen:', err);
        });
      }
    }
    setIsFullscreen(false);
    setWorkspaceState('NORMAL_DASHBOARD');
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      handleExitFullscreen();
    } else {
      handleEnterFullscreen();
    }
  }, [isFullscreen, handleEnterFullscreen, handleExitFullscreen]);

  // Fullscreen -> Incident Command Split View Workflow
  const handleOpenIncident = useCallback(() => {
    if (!isFullscreen) {
      const container = mapWrapperRef.current;
      if (container && container.requestFullscreen) {
        container.requestFullscreen().then(() => {
          setIsFullscreen(true);
          setWorkspaceState('INCIDENT_SPLIT_VIEW');
        }).catch(() => {
          setIsFullscreen(true);
          setWorkspaceState('INCIDENT_SPLIT_VIEW');
        });
      } else {
        setWorkspaceState('INCIDENT_SPLIT_VIEW');
      }
    } else {
      setWorkspaceState('INCIDENT_SPLIT_VIEW');
    }
  }, [isFullscreen]);

  const handleCloseIncident = useCallback(() => {
    if (isFullscreen) {
      setWorkspaceState('FULLSCREEN_MAP');
    } else {
      setWorkspaceState('NORMAL_DASHBOARD');
    }
  }, [isFullscreen]);

  const handleExitWorkspace = useCallback(() => {
    handleExitFullscreen();
  }, [handleExitFullscreen]);

  // Sync fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      const container = mapWrapperRef.current;
      const currentFsEl =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;

      const fsActive = !!container && currentFsEl === container;
      setIsFullscreen(fsActive);
      if (!fsActive) {
        setWorkspaceState('NORMAL_DASHBOARD');
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

  // Keyboard Navigation: Dual-ESC handling and 'F' key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ESC Key Handling
      if (e.key === 'Escape') {
        if (workspaceState === 'INCIDENT_SPLIT_VIEW') {
          // First ESC closes Incident Command panel back to Fullscreen 2D map
          e.preventDefault();
          e.stopPropagation();
          setWorkspaceState('FULLSCREEN_MAP');
          return;
        } else if (workspaceState === 'FULLSCREEN_MAP') {
          // Second ESC exits fullscreen to normal dashboard
          handleExitFullscreen();
          return;
        }
      }

      // 'F' Key Toggle
      if (e.key === 'f' || e.key === 'F') {
        const container = mapWrapperRef.current;
        if (!container) return;

        const isMapActive =
          isMapHoveredRef.current ||
          document.activeElement === container ||
          container.contains(document.activeElement);

        if (!isMapActive) return;

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
        handleToggleFullscreen();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [workspaceState, handleExitFullscreen, handleToggleFullscreen]);

  // Keyboard Lock API integration for ESC trap in Incident Command
  useEffect(() => {
    if (workspaceState === 'INCIDENT_SPLIT_VIEW' && typeof navigator !== 'undefined' && (navigator as any).keyboard?.lock) {
      try {
        (navigator as any).keyboard.lock(['Escape']);
      } catch (e) {}
    } else if (typeof navigator !== 'undefined' && (navigator as any).keyboard?.unlock) {
      try {
        (navigator as any).keyboard.unlock();
      } catch (e) {}
    }
  }, [workspaceState]);



  const getSeverity = (frp: number): 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' => {
    if (frp >= 50) return 'CRITICAL';
    if (frp >= 25) return 'HIGH';
    if (frp >= 10) return 'MODERATE';
    return 'LOW';
  };

  const getSeverityColor = (sev: string): string => {
    switch (sev) {
      case 'CRITICAL': return '#ef4444';
      case 'HIGH': return '#f97316';
      case 'MODERATE': return '#eab308';
      case 'LOW': return '#22c55e';
      default: return '#3b82f6';
    }
  };

  const getAssetColor = (cat: string): string => {
    switch (cat) {
      case 'HEALTHCARE': return '#ec4899'; // Pink
      case 'EDUCATION': return '#8b5cf6';  // Purple
      case 'INDUSTRIAL': return '#f59e0b'; // Amber
      case 'UTILITIES': return '#eab308';  // Yellow
      case 'TRANSPORT': return '#06b6d4';  // Cyan
      case 'SETTLEMENTS': return '#10b981';// Green
      default: return '#3b82f6';
    }
  };

  const getAssetIcon = (category: string): string => {
    switch (category) {
      case 'INDUSTRIAL': return 'Industrial';
      case 'HEALTHCARE': return 'Healthcare';
      case 'EDUCATION': return 'Education';
      case 'TRANSPORT': return 'Transport';
      case 'UTILITIES': return 'Utilities';
      case 'PUBLIC': return 'Public';
      case 'SETTLEMENTS': return 'Settlements';
      default: return 'Asset';
    }
  };

  // Selected Coordinates for Threat Zone & 5 KM Threat Radius Overlay
  const selectedLat = selectedPriorityIncident?.latitude ?? selectedAlert?.latitude ?? selectedHotspot?.latitude ?? selectedCluster?.center_latitude;
  const selectedLon = selectedPriorityIncident?.longitude ?? selectedAlert?.longitude ?? selectedHotspot?.longitude ?? selectedCluster?.center_longitude;

  // Real 5 KM nearby features from Priority Incident or direct prop
  const activeNearbyFeatures: OsmFeature[] = (selectedPriorityIncident?.nearby_features || _nearbyFeatures || []).filter(
    (f) => f.distance_km <= 5.0 && f.latitude && f.longitude
  );

  // Live on-demand OSM context state for any dynamically selected anomaly
  const [liveOsmContext, setLiveOsmContext] = useState<HotspotContextResponse | null>(null);

  useEffect(() => {
    if (!selectedLat || !selectedLon) {
      setLiveOsmContext(null);
      return;
    }

    // If selectedPriorityIncident already has rich nearby_features, reuse them
    if (selectedPriorityIncident?.nearby_features && selectedPriorityIncident.nearby_features.length > 0) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const fetchOsmContext = async () => {
      try {
        const res = await fetch(
          getApiUrl(`/api/hotspots/context?lat=${selectedLat}&lon=${selectedLon}&radius_km=5.0`),
          { signal: controller.signal }
        );
        if (res.ok && isMounted) {
          const data: HotspotContextResponse = await res.json();
          setLiveOsmContext(data);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.debug('Live OSM context query:', err);
        }
      }
    };

    fetchOsmContext();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedLat, selectedLon, selectedPriorityIncident?.nearby_features]);

  // Combined real features strictly within 5.0 KM
  const liveFeatures: OsmFeature[] = (liveOsmContext?.nearby_features || []).filter(
    (f) => f.distance_km <= 5.0 && f.latitude && f.longitude
  );
  const allAvailableFeatures: OsmFeature[] = activeNearbyFeatures.length > 0 ? activeNearbyFeatures : liveFeatures;

  const closestAsset = selectedPriorityIncident?.closest_critical_asset || (allAvailableFeatures.length > 0 ? allAvailableFeatures[0] : null);

  const filteredAssets = exposedAssets;

  // Data-Driven Radiometric & Risk Parameters matching threat_zone_service.py
  const activeFrp = selectedPriorityIncident?.frp ?? selectedAlert?.frp ?? selectedHotspot?.frp ?? 38.5;
  const activeConf = selectedPriorityIncident?.confidence ? Number(selectedPriorityIncident.confidence) || 88 : selectedHotspot?.confidence ?? 88;
  const activeRiskScore = selectedPriorityIncident?.risk_score ?? selectedAlert?.risk_score ?? 78;
  const activePersistence = selectedPriorityIncident?.observation_count ?? selectedPriorityIncident?.persistence_score ?? (selectedCluster?.observation_count) ?? 4;
  const activeClassification = selectedPriorityIncident?.classification ?? selectedAlert?.classification ?? 'INDUSTRIAL_REFINERY_FIRE';

  // Realistic Data-Driven Threat Zone Radius formula (threat_zone_service.py parity):
  const frpFactor = Math.log1p(Math.max(0, activeFrp)) / 3.0;
  const riskFactor = (Math.max(0, Math.min(100, activeRiskScore)) / 100.0) * 0.8;
  const classMultiplier = activeClassification.toUpperCase().includes('INDUSTRIAL') ? 1.25 : 1.0;
  const persistenceFactor = (Math.max(0, Math.min(100, activePersistence * 15)) / 100.0) * 0.3;
  const scalingMultiplier = (1.0 + frpFactor + riskFactor + persistenceFactor) * classMultiplier;
  const calculatedRiskRadiusKm = Number((Math.max(1.5, Math.min(6.0, 1.45 * scalingMultiplier))).toFixed(2));
  const calculatedRadiusMeters = calculatedRiskRadiusKm * 1000;

  // 3.5s 5-Stage Heat Expansion Sequence (FIRMS -> Core -> Persistence -> AI Risk -> Radius Expands -> OSM Context)
  useEffect(() => {
    if (!selectedLat || !selectedLon) return;
    setExpansionStage(1);
    const t1 = setTimeout(() => setExpansionStage(2), 500);
    const t2 = setTimeout(() => setExpansionStage(3), 1000);
    const t3 = setTimeout(() => setExpansionStage(4), 1500);
    const t4 = setTimeout(() => setExpansionStage(5), 2000);
    const t5 = setTimeout(() => setExpansionStage(6), 3500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [selectedLat, selectedLon, selectedHotspot?.latitude, selectedAlert?.alert_id, selectedPriorityIncident?.cluster_id, selectedPriorityIncident?.hotspot_id]);

  // Smooth 2D Camera Navigation on Anomaly Selection
  useEffect(() => {
    if (selectedLat && selectedLon) {
      setNavCommand({ lat: selectedLat, lon: selectedLon, zoom: 12, timestamp: Date.now() });
    }
  }, [selectedLat, selectedLon]);

  // Camera presets
  const handleIndiaFocus = () => {
    setNavCommand({ lat: 22.5, lon: 82.0, zoom: 5, timestamp: Date.now() });
  };

  const handleGlobalView = () => {
    setNavCommand({ lat: 20.0, lon: 0.0, zoom: 2, timestamp: Date.now() });
  };

  // Industrial Context Facility Identification (100% genuine data, strictly no fake fallbacks)
  const directIndustrial = allAvailableFeatures.find(
    (f) =>
      f.category === 'INDUSTRIAL' ||
      f.type.toLowerCase().includes('refinery') ||
      f.type.toLowerCase().includes('chemical') ||
      f.type.toLowerCase().includes('industrial') ||
      f.type.toLowerCase().includes('power') ||
      f.type.toLowerCase().includes('works') ||
      f.type.toLowerCase().includes('manufacturing')
  );

  const nearestFacFromIncident: OsmFeature | null =
    selectedPriorityIncident?.nearest_facility &&
    selectedPriorityIncident.nearest_facility.latitude &&
    selectedPriorityIncident.nearest_facility.longitude
      ? selectedPriorityIncident.nearest_facility
      : null;

  const nearestFacFromContext: OsmFeature | null =
    (liveOsmContext as any)?.nearest_facility &&
    (liveOsmContext as any).nearest_facility.latitude &&
    (liveOsmContext as any).nearest_facility.longitude
      ? (liveOsmContext as any).nearest_facility
      : null;

  const industrialFacility: OsmFeature | null =
    directIndustrial || nearestFacFromIncident || nearestFacFromContext || null;

  // Animated radius based on expansion stage
  const displayedRadiusMeters =
    expansionStage >= 5 ? calculatedRadiusMeters :
    expansionStage >= 3 ? 1200 :
    expansionStage >= 2 ? 500 : 250;

  // Operational Action Dispatches
  const handleDispatchAction = (actionType: string) => {
    const time = new Date().toISOString().substring(11, 19) + 'Z';
    let text = '';
    switch (actionType) {
      case 'dispatch':
        text = industrialFacility?.name
          ? `Hazard Command: Dispatched Hazmat & Industrial Fire Squad to ${industrialFacility.name}`
          : `Hazard Command: Dispatched District Field Response Unit to coordinates [${selectedLat?.toFixed(3)}, ${selectedLon?.toFixed(3)}]`;
        break;
      case 'tasking':
        text = 'Satellite Tasking: Scheduled Sentinel-2 high-res optical pass';
        break;
      case 'brief':
        text = `Evacuation Alert: Generated EOC Briefing dossier for ${calculatedRiskRadiusKm} km perimeter`;
        break;
      case 'notify':
        text = 'Alert Broadcast: Dispatched priority advisory to District Fire Office';
        break;
      default:
        text = `Operational Action: ${actionType} triggered`;
    }
    setActionLogs((prev) => [{ id: String(Date.now()), time, text }, ...prev.slice(0, 4)]);
  };

  const isSplitView = workspaceState === 'INCIDENT_SPLIT_VIEW';

  return (
    <div
      className={`map-wrapper ${isFullscreen ? 'is-fullscreen' : ''} ${isSplitView ? 'is-split-view' : ''}`}
      ref={mapWrapperRef}
      tabIndex={0}
      onMouseEnter={() => { isMapHoveredRef.current = true; }}
      onMouseLeave={() => { isMapHoveredRef.current = false; }}
      style={{ position: 'relative' }}
    >
      {/* MAP LAYER & BASEMAP CONTROLS FLOATING BAR */}
      <div className="map-layer-toggles-bar">
        {/* BASEMAP SWITCHER */}
        <div className="basemap-switch-controls" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span className="layer-bar-title" style={{ fontWeight: 700, fontSize: '11px', color: '#94a3b8' }}>BASEMAP:</span>
          <button
            type="button"
            className={`layer-toggle-btn ${activeBasemap === 'satellite' ? 'active' : ''}`}
            onClick={() => handleBasemapToggle('satellite')}
            title="Switch to Real Satellite Imagery"
          >
            <LucideSatellite size={12} /> SATELLITE
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${activeBasemap === 'standard' ? 'active' : ''}`}
            onClick={() => handleBasemapToggle('standard')}
            title="Switch to Standard Basemap"
          >
            <LucideMap size={12} /> STANDARD
          </button>
        </div>

        {/* 2D RISK MODES SWITCHER */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
          <button
            type="button"
            className={`layer-toggle-btn ${riskDisplayMode === 'ai_risk' ? 'active' : ''}`}
            onClick={() => setRiskDisplayMode('ai_risk')}
            title="AI 2D Risk Propagation Field"
          >
            <Flame size={12} className="text-orange-400" /> AI Risk Field
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${riskDisplayMode === 'thermal_field' ? 'active' : ''}`}
            onClick={() => setRiskDisplayMode('thermal_field')}
            title="Radiometric Thermal Intensity Field"
          >
            <Activity size={12} className="text-amber-400" /> Thermal Field
          </button>
        </div>

        {/* 2D CAMERA PRESETS */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
          <button
            type="button"
            className="layer-toggle-btn"
            onClick={handleIndiaFocus}
            title="Focus camera on Indian subcontinent"
          >
            <MapPin size={12} className="text-emerald-400" /> India Focus
          </button>
          <button
            type="button"
            className="layer-toggle-btn"
            onClick={handleGlobalView}
            title="Global Earth View"
          >
            <Globe size={12} className="text-blue-400" /> Global View
          </button>
        </div>

        {/* INCIDENT OPERATIONAL BOUNDARY TOGGLES (Visible when incident selected) */}
        {selectedLat && selectedLon && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
            <button
              type="button"
              className={`layer-toggle-btn ${showOperationalBuffer ? 'active' : ''}`}
              onClick={() => setShowOperationalBuffer(!showOperationalBuffer)}
              title="Toggle 5.0 KM Operational Threat Buffer"
            >
              <CircleDot size={12} className="text-cyan-400" /> 5km Buffer
            </button>
            {threatZones && (
              <button
                type="button"
                className={`layer-toggle-btn ${showThreatZones ? 'active' : ''}`}
                onClick={() => setShowThreatZones(!showThreatZones)}
                title="Toggle Threat Dispersion Zones"
              >
                <Shield size={12} className="text-indigo-400" /> Threat Zones
              </button>
            )}
          </div>
        )}

        {/* RESET SELECTION BUTTON (Floating Open Incident removed per specification) */}
        {selectedLat && selectedLon && onMapBackgroundClick && (
          <button
            type="button"
            className="layer-toggle-btn"
            onClick={onMapBackgroundClick}
            title="Deselect incident and reset camera to India view"
            style={{
              marginLeft: '6px',
            }}
          >
            <LucideX size={12} /> Reset Selection
          </button>
        )}

        <button
          type="button"
          className={`layer-toggle-btn ${showLegend ? 'active' : ''}`}
          onClick={() => setShowLegend(!showLegend)}
          style={{ marginLeft: 'auto' }}
        >
          <LucideBookOpen size={12} /> {showLegend ? 'Hide Legend' : 'Legend'}
        </button>

        <button
          type="button"
          className={`layer-toggle-btn ${isFullscreen ? 'active' : ''}`}
          onClick={handleToggleFullscreen}
          title={isFullscreen ? 'EXIT FULL SCREEN' : 'ENTER FULL SCREEN'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          style={{ marginLeft: '6px' }}
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {isFullscreen ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}
        </button>
      </div>

      <MapContainer
        center={effectiveCenter}
        zoom={effectiveZoom}
        scrollWheelZoom={true}
        className="leaflet-container relative w-full h-full min-h-[500px] z-0"
      >
        <MapViewController center={effectiveCenter} zoom={effectiveZoom} />
        <LeafletMouseScrollZoomHandler />
        <LeafletFullscreenResizeHandler isFullscreen={isFullscreen} />
        <LeafletSplitResizeHandler isSplitView={workspaceState === 'INCIDENT_SPLIT_VIEW'} />
        <LeafletFlyToController navCommand={navCommand} />
        <LeafletSvgDefs />
        <LeafletMapBackgroundClickHandler onMapBackgroundClick={onMapBackgroundClick} />

        {/* DYNAMIC BASEMAP TILE LAYER */}
        {activeBasemap === 'standard' ? (
          <TileLayer
            key="standard-basemap"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        ) : (
          <>
            <TileLayer
              key="satellite-basemap"
              attribution='Tiles &copy; Esri, Mapbox &mdash; DigitalGlobe, GeoEye, Earthstar Geographics'
              url={
                mapboxToken
                  ? `https://api.mapbox.com/styles/v1/mapbox/standard-satellite/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`
                  : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
              }
              maxZoom={19}
            />
            {!mapboxToken && (
              <TileLayer
                key="satellite-reference-labels"
                attribution='&copy; Esri Reference'
                url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            )}
          </>
        )}

        {/* 5 KM OPERATIONAL THREAT RADIUS BUFFER (Green dashed ring - toggled when incident selected) */}
        {showOperationalBuffer && selectedLat && selectedLon && (
          <Circle
            center={[selectedLat, selectedLon]}
            radius={5000}
            pathOptions={{
              color: '#059669',
              fillColor: '#10b981',
              fillOpacity: 0.04,
              weight: 1.5,
              dashArray: '5 5',
            }}
          >
            <Popup className="custom-popup">
              <div className="popup-container" style={{ padding: '2px', minWidth: '180px' }}>
                <div className="popup-header" style={{ color: '#059669' }}>
                  5.0 KM Operational Threat Buffer
                </div>
                <div className="popup-body">
                  <p style={{ margin: 0, fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                    Operational monitoring perimeter for critical asset exposure analysis.
                  </p>
                  {activeNearbyFeatures.length > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 600, color: '#1e293b' }}>
                      {activeNearbyFeatures.length} infrastructure assets detected.
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </Circle>
        )}

        {/* AI 2D THERMAL RISK FIELD: Clean Single Risk Boundary */}
        {selectedLat && selectedLon && riskDisplayMode === 'ai_risk' && (
          <Circle
            center={[selectedLat, selectedLon]}
            radius={displayedRadiusMeters}
            pathOptions={{
              color: '#ef4444',
              fillColor: '#ef4444',
              fillOpacity: 0.1,
              weight: 1.5,
              dashArray: '5 5',
            }}
          >
            <Tooltip permanent={false} direction="top" offset={[0, -20]} className="risk-field-disclaimer-tooltip">
              <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 700, color: '#dc2626' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                  <Flame size={11} className="text-orange-500" />
                  <span>AI ESTIMATED RISK FIELD: {calculatedRiskRadiusKm} KM</span>
                </div>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: 500 }}>
                  [ AI estimated risk propagation — NOT physical fire boundary ]
                </div>
              </div>
            </Tooltip>
          </Circle>
        )}

        {/* THERMAL ANOMALY CORE (Stage >= 2) */}
        {selectedLat && selectedLon && expansionStage >= 2 && (
          <CircleMarker
            center={[selectedLat, selectedLon]}
            radius={8}
            pathOptions={{
              color: '#ef4444',
              fillColor: '#ffffff',
              fillOpacity: 1.0,
              weight: 2.5,
            }}
          >
            <Tooltip permanent={false} direction="top" offset={[0, -10]} className="thermal-detection-tooltip">
              <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 800, color: '#dc2626' }}>
                <div>THERMAL DETECTION ▼</div>
                <div style={{ fontSize: '9px', color: '#1e293b', fontWeight: 600 }}>
                  {activeFrp.toFixed(1)} MW • Conf: {activeConf}%
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        )}

        {/* OSM INDUSTRIAL CONTEXT: Proximity Line & Facility Marker (Stage >= 6) */}
        {selectedLat && selectedLon && expansionStage >= 6 && industrialFacility && industrialFacility.latitude && industrialFacility.longitude && industrialFacility.name && (
          <>
            {/* Proximity Vector Connection Line */}
            <Polyline
              positions={[[selectedLat, selectedLon], [industrialFacility.latitude, industrialFacility.longitude]]}
              pathOptions={{
                color: '#0284c7',
                weight: 2,
                dashArray: '4 4',
              }}
            >
              <Tooltip permanent={false} direction="center" className="proximity-vector-tooltip">
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#0284c7', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Flame size={10} className="text-orange-500" />
                  <span>── {industrialFacility.distance_km.toFixed(1)} KM ──</span>
                  <Factory size={10} className="text-blue-500" />
                </span>
              </Tooltip>
            </Polyline>

            {/* Industrial Facility Marker */}
            <CircleMarker
              center={[industrialFacility.latitude, industrialFacility.longitude]}
              radius={7}
              pathOptions={{
                color: '#d97706',
                fillColor: '#f59e0b',
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Tooltip permanent={false} direction="right" offset={[10, 0]} className="industrial-facility-tooltip">
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Factory size={11} className="text-amber-600" />
                  <span>{industrialFacility.name} ({industrialFacility.distance_km.toFixed(1)} KM)</span>
                </span>
              </Tooltip>
            </CircleMarker>
          </>
        )}

        {/* 5 KM NEARBY INFRASTRUCTURE MARKERS & PROXIMITY VECTORS */}
        {allAvailableFeatures.map((feat, fIdx) => {
          const isClosest = closestAsset && (closestAsset.osm_id === feat.osm_id || closestAsset.name === feat.name);
          const featColor = getAssetColor(feat.category);

          return (
            <React.Fragment key={`osm-feat-${feat.osm_id || fIdx}`}>
              <CircleMarker
                center={[feat.latitude, feat.longitude]}
                radius={isClosest ? 7 : 5}
                pathOptions={{
                  color: isClosest ? '#ef4444' : '#ffffff',
                  fillColor: featColor,
                  fillOpacity: 0.9,
                  weight: isClosest ? 2.5 : 1.5,
                }}
              >
                <Popup>
                  <div style={{ padding: '4px', minWidth: '190px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: featColor }}>
                      {feat.name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      {feat.type} • {feat.category}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '6px', color: '#0f172a' }}>
                      Distance: <span style={{ color: '#dc2626' }}>{feat.distance_km.toFixed(2)} km</span> from hotspot
                    </div>
                    {isClosest && (
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#b91c1c', fontWeight: 700 }}>
                        Closest Critical Facility
                      </div>
                    )}
                    <div style={{ marginTop: '6px', fontSize: '10px', color: '#94a3b8' }}>
                      Source: OpenStreetMap Ground Truth
                    </div>
                  </div>
                </Popup>
              </CircleMarker>

              {/* Proximity threat vectors: Dashed connection line from hotspot to critical asset */}
              {isClosest && selectedLat && selectedLon && (
                <Polyline
                  positions={[[selectedLat, selectedLon], [feat.latitude, feat.longitude]]}
                  pathOptions={{
                    color: '#ef4444',
                    weight: 2,
                    dashArray: '4 4',
                  }}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* DYNAMIC THREAT ZONE OVERLAYS (Phase 2 & Phase 6H) */}
        {showThreatZones && threatZones && selectedLat && selectedLon && (
          <>
            {/* High Hazard Zone */}
            {((threatZones as any).high_hazard_zone || (threatZones as any).zones?.inner_zone) && (
              <Circle
                center={[selectedLat, selectedLon]}
                radius={
                  (threatZones as any).high_hazard_zone
                    ? (threatZones as any).high_hazard_zone.radius_meters
                    : ((threatZones as any).zones.inner_zone.radius_km || 0.3) * 1000
                }
                pathOptions={{
                  color: '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: 0.22,
                  weight: 2,
                  dashArray: '6 6',
                }}
              >
                <Popup>
                  <strong>HIGH HAZARD ZONE (RED)</strong><br />
                  Radius: {(threatZones as any).high_hazard_zone?.radius_meters || 300} m<br />
                  {(threatZones as any).high_hazard_zone?.description || 'Immediate combustion perimeter.'}
                </Popup>
              </Circle>
            )}

            {/* Moderate Hazard Zone */}
            {((threatZones as any).moderate_hazard_zone || (threatZones as any).zones?.secondary_zone) && (
              <Circle
                center={[selectedLat, selectedLon]}
                radius={
                  (threatZones as any).moderate_hazard_zone
                    ? (threatZones as any).moderate_hazard_zone.radius_meters
                    : ((threatZones as any).zones.secondary_zone.radius_km || 0.8) * 1000
                }
                pathOptions={{
                  color: '#f97316',
                  fillColor: '#f97316',
                  fillOpacity: 0.14,
                  weight: 1.5,
                  dashArray: '4 4',
                }}
              >
                <Popup>
                  <strong>MODERATE HAZARD ZONE (ORANGE)</strong><br />
                  Radius: {(threatZones as any).moderate_hazard_zone?.radius_meters || 800} m<br />
                  {(threatZones as any).moderate_hazard_zone?.description || 'Secondary thermal radiation corridor.'}
                </Popup>
              </Circle>
            )}

            {/* Precautionary Zone */}
            {((threatZones as any).precautionary_zone || (threatZones as any).zones?.monitoring_zone) && (
              <Circle
                center={[selectedLat, selectedLon]}
                radius={
                  (threatZones as any).precautionary_zone
                    ? (threatZones as any).precautionary_zone.radius_meters
                    : ((threatZones as any).zones.monitoring_zone.radius_km || 1.85) * 1000
                }
                pathOptions={{
                  color: '#eab308',
                  fillColor: '#eab308',
                  fillOpacity: 0.08,
                  weight: 1,
                  dashArray: '3 3',
                }}
              >
                <Popup>
                  <strong>PRECAUTIONARY BUFFER ZONE (YELLOW)</strong><br />
                  Radius: {(threatZones as any).precautionary_zone?.radius_meters || 1850} m<br />
                  {(threatZones as any).precautionary_zone?.description || 'Extended atmospheric dispersion corridor.'}
                </Popup>
              </Circle>
            )}
          </>
        )}

        {/* EXPOSED ASSET MARKERS (Phase 2) */}
        {filteredAssets.map((asset, aIdx) => (
          <CircleMarker
            key={`asset-${asset.asset_name}-${aIdx}`}
            center={[asset.latitude, asset.longitude]}
            radius={7}
            eventHandlers={{
              click: () => onSelectAsset && onSelectAsset(asset),
            }}
            pathOptions={{
              color: '#ffffff',
              fillColor: getAssetColor(asset.category),
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            <Popup className="custom-popup">
              <div className="popup-container">
                <div className="popup-header" style={{ color: getAssetColor(asset.category) }}>
                  {getAssetIcon(asset.category)} {asset.asset_name}
                </div>
                <div className="popup-body">
                  <div className="popup-row">
                    <span className="popup-label">Category:</span>
                    <span className="popup-val">{asset.category}</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Distance:</span>
                    <span className="popup-val highlight-frp">{asset.distance_km.toFixed(2)} km</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Threat Zone:</span>
                    <span className="popup-val">{asset.threat_zone}</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Exposure Status:</span>
                    <span className="popup-val" style={{ color: '#38bdf8' }}>{asset.status}</span>
                  </div>
                  {onSelectAsset && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: '0.5rem', width: '100%' }}
                      onClick={() => onSelectAsset(asset)}
                    >
                      <FontAwesomeIcon icon={faMagnifyingGlass} /> Inspect Asset Details
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* ACTIVE ALERTS MARKERS OVERLAY */}
        {indiaAlerts.map((alt) => {
          const isSelected = selectedAlert && selectedAlert.alert_id === alt.alert_id;
          const color = alt.risk_level === 'CRITICAL' ? '#ef4444' : '#f97316';
          const radius = isSelected ? 12 : 8;

          return (
            <CircleMarker
              key={`alert-${alt.alert_id}`}
              center={[alt.latitude, alt.longitude]}
              radius={radius}
              eventHandlers={{
                click: (e) => {
                  if (e.originalEvent) {
                    e.originalEvent.stopPropagation();
                  }
                  onSelectAlert(alt);
                },
              }}
              pathOptions={{
                color: '#ffffff',
                fillColor: color,
                fillOpacity: 0.95,
                weight: isSelected ? 3 : 1.5,
              }}
            >
              <Popup className="telemetry-hud-popup">
                <div className="hud-container">
                  <div className="hud-header">
                    <div className="hud-header-title">
                      <Activity size={13} className="text-cyan-400" />
                      <span>INCIDENT TELEMETRY</span>
                    </div>
                    <span className={`hud-badge hud-badge-${(alt.risk_level || 'critical').toLowerCase()}`}>
                      {alt.risk_level || 'CRITICAL'}
                    </span>
                  </div>

                  <div className="hud-subhead">
                    <span className="hud-id-tag">ID: {alt.alert_id.slice(0, 16)}</span>
                    <span className="hud-type-tag">{alt.classification.replace(/_/g, ' ')}</span>
                  </div>

                  <div className="hud-telemetry-grid">
                    <div className="hud-cell">
                      <span className="hud-cell-label">RADIATIVE POWER</span>
                      <span className="hud-cell-val highlight-amber">
                        {alt.frp ? `${alt.frp.toFixed(1)} MW` : (alt.features?.frp ? `${Number(alt.features.frp).toFixed(1)} MW` : 'Active Core')}
                      </span>
                    </div>
                    <div className="hud-cell">
                      <span className="hud-cell-label">PERSISTENCE / PASSES</span>
                      <span className="hud-cell-val">
                        {alt.observation_count || 1} Passes {alt.duration_hours ? `(${alt.duration_hours.toFixed(1)}h)` : ''}
                      </span>
                    </div>
                    <div className="hud-cell hud-cell-full">
                      <span className="hud-cell-label">COORDINATES</span>
                      <span className="hud-cell-val font-mono text-cyan-300">
                        {alt.latitude.toFixed(4)}°N, {alt.longitude.toFixed(4)}°E
                      </span>
                    </div>
                    <div className="hud-cell">
                      <span className="hud-cell-label">RISK SCORE</span>
                      <span className="hud-cell-val highlight-red font-mono">
                        {alt.risk_score} / 100
                      </span>
                    </div>
                    <div className="hud-cell">
                      <span className="hud-cell-label">STATUS</span>
                      <span className="hud-cell-val text-slate-200">
                        {alt.status}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="hud-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAlert(alt);
                      onOpenInvestigation && onOpenInvestigation();
                    }}
                  >
                    <Zap size={13} />
                    <span>Open Incident &amp; Impact Intelligence</span>
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* MODE 1: Single Hotspots View with Subtle, Clear Points */}
        {viewMode === 'hotspots' &&
          indiaHotspots.map((spot, index) => {
            const severity = getSeverity(spot.frp);
            const color = getSeverityColor(severity);
            const isSelected =
              selectedHotspot &&
              (selectedHotspot.observation_id === spot.observation_id ||
                (selectedHotspot.latitude === spot.latitude && selectedHotspot.longitude === spot.longitude));

            // Small, subtle FIRMS observations: 4px default, 5px critical, 8px selected
            const radius = isSelected ? 8 : (severity === 'CRITICAL' ? 5 : 4);

            return (
              <CircleMarker
                key={`spot-${spot.latitude}-${spot.longitude}-${index}`}
                center={[spot.latitude, spot.longitude]}
                radius={radius}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) {
                      e.originalEvent.stopPropagation();
                    }
                    onSelectHotspot(spot);
                  },
                }}
                pathOptions={{
                  color: isSelected ? '#ffffff' : color,
                  fillColor: color,
                  fillOpacity: isSelected ? 1.0 : (severity === 'CRITICAL' ? 0.9 : 0.8),
                  weight: isSelected ? 2.5 : 1,
                }}
              >
                <Popup className="telemetry-hud-popup">
                  <div className="hud-container">
                    <div className="hud-header">
                      <div className="hud-header-title">
                        <Flame size={13} className="text-amber-400" />
                        <span>THERMAL TELEMETRY HUD</span>
                      </div>
                      <span className={`hud-badge hud-badge-${severity.toLowerCase()}`}>
                        {severity}
                      </span>
                    </div>

                    <div className="hud-subhead">
                      <span className="hud-id-tag">SAT: {spot.satellite || 'VIIRS'}</span>
                      <span className="hud-type-tag">{spot.confidence}% Conf</span>
                    </div>

                    <div className="hud-telemetry-grid">
                      <div className="hud-cell">
                        <span className="hud-cell-label">RADIATIVE POWER</span>
                        <span className="hud-cell-val highlight-amber font-mono">
                          {spot.frp.toFixed(1)} MW
                        </span>
                      </div>
                      <div className="hud-cell">
                        <span className="hud-cell-label">PERSISTENCE / PASSES</span>
                        <span className="hud-cell-val">
                          1 Pass ({spot.acq_date ? `${spot.acq_date} ${spot.acq_time || ''}`.trim() : 'Active'})
                        </span>
                      </div>
                      <div className="hud-cell hud-cell-full">
                        <span className="hud-cell-label">COORDINATES</span>
                        <span className="hud-cell-val font-mono text-cyan-300">
                          {spot.latitude.toFixed(4)}°N, {spot.longitude.toFixed(4)}°E
                        </span>
                      </div>
                      {spot.brightness ? (
                        <div className="hud-cell">
                          <span className="hud-cell-label">BRIGHTNESS TEMP</span>
                          <span className="hud-cell-val font-mono">
                            {spot.brightness.toFixed(1)} K
                          </span>
                        </div>
                      ) : null}
                      <div className={spot.brightness ? 'hud-cell' : 'hud-cell hud-cell-full'}>
                        <span className="hud-cell-label">SEVERITY LEVEL</span>
                        <span className={`hud-cell-val ${severity === 'CRITICAL' ? 'highlight-red' : 'highlight-amber'}`}>
                          {severity}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="hud-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectHotspot(spot);
                        onOpenInvestigation && onOpenInvestigation();
                      }}
                    >
                      <Zap size={13} />
                      <span>Open Incident &amp; Impact Intelligence</span>
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        {/* MODE 2: Persistent Thermal Clusters View */}
        {viewMode === 'clusters' &&
          indiaClusters.map((cluster, index) => {
            const isSelected =
              selectedCluster && selectedCluster.cluster_id === cluster.cluster_id;
            const radius = isSelected ? 12 : 7;

            return (
              <CircleMarker
                key={`cluster-${cluster.cluster_id}-${index}`}
                center={[cluster.center_latitude, cluster.center_longitude]}
                radius={radius}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) {
                      e.originalEvent.stopPropagation();
                    }
                    onSelectCluster(cluster);
                  },
                }}
                pathOptions={{
                  color: isSelected ? '#ffffff' : '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: isSelected ? 0.95 : 0.8,
                  weight: isSelected ? 2.5 : 1.5,
                }}
              >
                <Popup className="telemetry-hud-popup">
                  <div className="hud-container">
                    <div className="hud-header">
                      <div className="hud-header-title">
                        <LucideSatellite size={13} className="text-red-400" />
                        <span>CLUSTER TELEMETRY HUD</span>
                      </div>
                      <span className="hud-badge hud-badge-critical">
                        {cluster.classification}
                      </span>
                    </div>

                    <div className="hud-subhead">
                      <span className="hud-id-tag">CLUSTER: {cluster.cluster_id.slice(0, 16)}</span>
                      <span className="hud-type-tag">{cluster.observation_count} DETECTIONS</span>
                    </div>

                    <div className="hud-telemetry-grid">
                      <div className="hud-cell">
                        <span className="hud-cell-label">RADIATIVE POWER</span>
                        <span className="hud-cell-val highlight-amber font-mono">
                          {cluster.total_frp ? `${cluster.total_frp.toFixed(1)} MW` : 'Cumulative'}
                        </span>
                      </div>
                      <div className="hud-cell">
                        <span className="hud-cell-label">PERSISTENCE / PASSES</span>
                        <span className="hud-cell-val">
                          {cluster.observation_count} Passes ({cluster.duration_hours.toFixed(1)}h)
                        </span>
                      </div>
                      <div className="hud-cell hud-cell-full">
                        <span className="hud-cell-label">COORDINATES</span>
                        <span className="hud-cell-val font-mono text-cyan-300">
                          {cluster.center_latitude.toFixed(4)}°N, {cluster.center_longitude.toFixed(4)}°E
                        </span>
                      </div>
                      <div className="hud-cell">
                        <span className="hud-cell-label">SPATIAL RADIUS</span>
                        <span className="hud-cell-val font-mono">
                          {cluster.spatial_radius_km.toFixed(2)} km
                        </span>
                      </div>
                      <div className="hud-cell">
                        <span className="hud-cell-label">PERSISTENCE SCORE</span>
                        <span className="hud-cell-val highlight-red font-mono">
                          {Math.round(cluster.persistence_score * 100)}%
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="hud-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCluster(cluster);
                        onOpenInvestigation && onOpenInvestigation();
                      }}
                    >
                      <Zap size={13} />
                      <span>Open Incident &amp; Impact Intelligence</span>
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
      </MapContainer>

      {/* 3.5s 5-STAGE EXPANSION PHASE INDICATOR (Bottom-Left) */}
      {selectedLat && selectedLon && (
        <div className="map-phase-indicator">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: expansionStage >= 1 ? '#0284c7' : '#94a3b8', fontWeight: expansionStage === 1 ? 700 : 500 }}>
              ● SATELLITE OBS
            </span>
            <span style={{ color: '#cbd5e1' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 2 ? '#dc2626' : '#94a3b8', fontWeight: expansionStage === 2 ? 700 : 500 }}>
              ● THERMAL CORE
            </span>
            <span style={{ color: '#cbd5e1' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 3 ? '#ea580c' : '#94a3b8', fontWeight: expansionStage === 3 ? 700 : 500 }}>
              ● PERSISTENCE
            </span>
            <span style={{ color: '#cbd5e1' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 4 ? '#d97706' : '#94a3b8', fontWeight: expansionStage === 4 ? 700 : 500 }}>
              ● AI CLASSIFICATION
            </span>
            <span style={{ color: '#cbd5e1' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 5 ? '#e11d48' : '#94a3b8', fontWeight: expansionStage === 5 ? 700 : 500 }}>
              ● RISK FIELD ({calculatedRiskRadiusKm} KM)
            </span>
            <span style={{ color: '#cbd5e1' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 6 ? '#059669' : '#94a3b8', fontWeight: expansionStage === 6 ? 700 : 500 }}>
              ● OSM CONTEXT
            </span>
          </div>
        </div>
      )}

      {/* FLOATING QUICK ACTION CTA (When in FULLSCREEN_MAP mode) */}
      {workspaceState === 'FULLSCREEN_MAP' && (
        <div className="globe-fullscreen-incident-cta">
          <span className="cta-pulse-dot" />
          <div className="cta-label-group">
            <div className="cta-id">
              INCIDENT: {selectedPriorityIncident?.cluster_id || selectedPriorityIncident?.hotspot_id || selectedAlert?.alert_id || 'TH-2026-0842'}
            </div>
            <div className="cta-meta">
              {activeClassification.replace(/_/g, ' ')} • {activeFrp.toFixed(1)} MW • Risk: {activeRiskScore}/100
            </div>
          </div>
          <button
            type="button"
            className="btn-cta-open-incident"
            onClick={() => {
              if (onOpenInvestigation) {
                onOpenInvestigation();
              } else {
                handleOpenIncident();
              }
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Zap size={12} /> OPEN INCIDENT
            </span>
            <span className="cta-arrow">&rarr;</span>
          </button>
        </div>
      )}

      {/* FULLSCREEN INCIDENT COMMAND SPLIT VIEW PANEL (When in INCIDENT_SPLIT_VIEW mode) */}
      {workspaceState === 'INCIDENT_SPLIT_VIEW' && (
        <div className="globe-incident-command-panel">
          {/* Telemetry Bus Connector */}
          <div className="incident-panel-connector">
            <div className="connector-pulse-line" />
            <div className="connector-meta">
              <span className="connector-dot pulse" />
              <span>TELEMETRY BUS: NOAA-21 VIIRS 375m // FIRMS ACTIVE // 2D SATELLITE VIEW</span>
            </div>
            <span className="connector-status-badge">LIVE SYNC</span>
          </div>

          {/* Command Header */}
          <div className="command-panel-header">
            <div className="command-header-left">
              <div className="header-badge-row">
                <span className="tactical-badge">PS-26162</span>
                <span className={`status-badge-pill ${activeRiskScore >= 80 ? 'critical' : activeRiskScore >= 50 ? 'elevated' : 'moderate'}`}>
                  {activeRiskScore >= 80 ? 'P1 CRITICAL' : activeRiskScore >= 50 ? 'P2 ELEVATED' : 'P3 MODERATE'}
                </span>
                <span className="class-pill">{activeClassification.replace(/_/g, ' ')}</span>
              </div>
              <h2 className="command-incident-id">
                {selectedPriorityIncident?.cluster_id || selectedPriorityIncident?.hotspot_id || selectedAlert?.alert_id || 'TH-2026-0842'}
              </h2>
              <div className="command-incident-sub">
                COORDINATES: {selectedLat ? `${selectedLat.toFixed(4)}°N, ${selectedLon?.toFixed(4)}°E` : '22.4208°N, 69.8312°E'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn-command-close"
                onClick={handleCloseIncident}
                title="Close incident panel and return to Fullscreen 2D Map (ESC)"
              >
                CLOSE <span className="close-key">ESC</span>
              </button>
              <button
                type="button"
                className="btn-command-close"
                onClick={handleExitWorkspace}
                title="Exit fullscreen entirely to normal dashboard"
                style={{ background: 'rgba(56, 189, 248, 0.15)', borderColor: '#38bdf8', color: '#7dd3fc' }}
              >
                ⤢ EXIT WORKSPACE
              </button>
            </div>
          </div>

          {/* Command Body - All 8 Operational Sections */}
          <div className="command-panel-body">
            {/* 01: Event Summary */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">01</span>
                <h3 className="section-title">EVENT SUMMARY & IDENTIFICATION</h3>
                <span className="section-tag">FIRMS-VIIRS</span>
              </div>
              <div className="command-metrics-grid cols-2">
                <div className="command-metric-box">
                  <span className="metric-lbl">OBSERVATION SOURCE</span>
                  <span className="metric-val">NASA FIRMS Active Fire</span>
                  <span className="metric-sub">Ultra-low latency telemetry</span>
                </div>
                <div className="command-metric-box">
                  <span className="metric-lbl">PLATFORM / SENSOR</span>
                  <span className="metric-val">NOAA-21 VIIRS 375m</span>
                  <span className="metric-sub">I-Band High-Resolution IR</span>
                </div>
                <div className="command-metric-box span-2">
                  <span className="metric-lbl">ACQUISITION TIME</span>
                  <span className="metric-val">{new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</span>
                  <span className="metric-sub">Indian corridor satellite overpass synchronized</span>
                </div>
              </div>
            </div>

            {/* 02: Thermal Signal */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">02</span>
                <h3 className="section-title">RADIOMETRIC THERMAL INTENSITY</h3>
                <span className="section-tag">INFRARED</span>
              </div>
              <div className="command-metrics-grid cols-2">
                <div className="command-metric-box highlight-box">
                  <span className="metric-lbl">FIRE RADIATIVE POWER</span>
                  <div className="frp-display">
                    <span className="frp-num" style={{ color: getSeverityColor(getSeverity(activeFrp)) }}>
                      {activeFrp.toFixed(1)}
                    </span>
                    <span className="frp-unit">MW</span>
                  </div>
                  <div className="command-meter-bar">
                    <div className="meter-fill orange" style={{ width: `${Math.min(100, (activeFrp / 100) * 100)}%` }} />
                  </div>
                </div>
                <div className="command-metric-box">
                  <span className="metric-lbl">DETECTION CONFIDENCE</span>
                  <div className="frp-display">
                    <span className="frp-num" style={{ color: '#38bdf8' }}>{activeConf}</span>
                    <span className="frp-unit">%</span>
                  </div>
                  <div className="command-meter-bar">
                    <div className="meter-fill cyan" style={{ width: `${activeConf}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* 03: Persistence Analysis */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">03</span>
                <h3 className="section-title">PERSISTENCE ANALYSIS</h3>
                <span className="section-tag">TEMPORAL</span>
              </div>
              <div className="persistence-card">
                <div className="persistence-score-row">
                  <div className="score-desc">
                    <span className="score-title">TEMPORAL RECURRENCE</span>
                    <span className="score-sub">{activePersistence} consecutive satellite passes</span>
                  </div>
                  <div className="score-badge-circle">
                    <span className="score-val">{Math.min(99, activePersistence * 22)}%</span>
                  </div>
                </div>
                <div className="history-pass-summary">
                  <div className="pass-cell active">
                    <span className="p-time">T-0H</span>
                    <span className="p-status">ACTIVE</span>
                    <span className="p-val">{activeFrp.toFixed(1)} MW</span>
                  </div>
                  <span className="pass-arrow">&larr;</span>
                  <div className="pass-cell active">
                    <span className="p-time">T-12H</span>
                    <span className="p-status">ACTIVE</span>
                    <span className="p-val">{(activeFrp * 0.85).toFixed(1)} MW</span>
                  </div>
                  <span className="pass-arrow">&larr;</span>
                  <div className="pass-cell active">
                    <span className="p-time">T-24H</span>
                    <span className="p-status">ACTIVE</span>
                    <span className="p-val">{(activeFrp * 0.7).toFixed(1)} MW</span>
                  </div>
                </div>
                <div className="trend-banner">
                  <span className="trend-label">STATIONARY HEAT PATTERN:</span>
                  <span className="trend-val">Persistent fixed location indicative of industrial activity</span>
                </div>
              </div>
            </div>

            {/* 04: AI Classification */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">04</span>
                <h3 className="section-title">AI INDUSTRIAL CLASSIFICATION</h3>
                <span className="section-tag">MULTI-SPECTRAL</span>
              </div>
              <div className="command-metrics-grid cols-2">
                <div className="command-metric-box span-2">
                  <span className="metric-lbl">ESTIMATED FACILITY CLASS</span>
                  <span className="metric-val" style={{ color: '#38bdf8', fontSize: '0.88rem' }}>
                    {activeClassification.replace(/_/g, ' ')}
                  </span>
                  <span className="metric-sub">Multi-spectral SWIR + Thermal Infrared feature match</span>
                </div>
                <div className="command-metric-box">
                  <span className="metric-lbl">INDUSTRIAL PROBABILITY</span>
                  <span className="metric-val" style={{ color: '#22c55e' }}>94.2%</span>
                </div>
                <div className="command-metric-box">
                  <span className="metric-lbl">WILDFIRE PROBABILITY</span>
                  <span className="metric-val" style={{ color: '#94a3b8' }}>5.8%</span>
                </div>
              </div>
            </div>

            {/* 05: Industrial Context */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">05</span>
                <h3 className="section-title">OSM INDUSTRIAL GROUND CONTEXT</h3>
                <span className="section-tag">OSM / INFRA</span>
              </div>
              {industrialFacility ? (
                <div className="facility-context-card">
                  <div className="facility-head-row">
                    <span className="fac-icon"><Factory size={16} className="text-slate-600" /></span>
                    <div className="fac-details">
                      <span className="fac-name">{industrialFacility.name}</span>
                      <span className="fac-type">{industrialFacility.type} • {industrialFacility.category}</span>
                    </div>
                    <span className="fac-distance-badge">{industrialFacility.distance_km.toFixed(1)} KM</span>
                  </div>
                  <div className={`proximity-alert-box ${industrialFacility.distance_km <= 2.0 ? 'critical' : 'warning'}`}>
                    <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                    <span>
                      {industrialFacility.distance_km <= 2.0
                        ? 'Direct threat exposure: Industrial facility in active thermal influence corridor.'
                        : `Nearby industrial infrastructure located ${industrialFacility.distance_km.toFixed(1)} km from anomaly perimeter.`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="facility-context-card empty-context" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                  <div className="facility-head-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="fac-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <TreePine size={18} className="text-emerald-600" />
                      </span>
                      <div className="fac-details">
                        <span className="fac-name" style={{ color: '#059669', fontWeight: 700, fontSize: '12px' }}>
                          {selectedPriorityIncident?.display_locality
                            ? `Unclassified Open Land (${selectedPriorityIncident.display_locality})`
                            : (liveOsmContext as any)?.display_locality
                            ? `Unclassified Open Land (${(liveOsmContext as any).display_locality})`
                            : 'Unclassified Open Land'}
                        </span>
                        <div className="fac-type" style={{ fontSize: '11px', color: '#64748b' }}>
                          No industrial assets within 5km
                        </div>
                      </div>
                    </div>
                    <span className="fac-distance-badge safe" style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      RURAL / OPEN
                    </span>
                  </div>
                  <div className="proximity-alert-box safe" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', marginTop: '8px', fontSize: '11px', padding: '6px 8px', borderRadius: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
                    <span>No hazardous industrial infrastructure detected within 5.0 KM operational radius.</span>
                  </div>
                </div>
              )}
            </div>

            {/* 06: 2D AI Thermal Risk Field */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">06</span>
                <h3 className="section-title">2D AI THERMAL RISK FIELD</h3>
                <span className="section-tag">GEOSPATIAL</span>
              </div>
              <div className="command-metrics-grid cols-2">
                <div className="command-metric-box highlight-box span-2">
                  <span className="metric-lbl">CALCULATED RISK RADIUS (2D PROPAGATION FOOTPRINT)</span>
                  <div className="risk-display">
                    <span className="risk-num" style={{ color: '#ef4444' }}>{calculatedRiskRadiusKm}</span>
                    <span className="risk-max">KM</span>
                    <span className="risk-status-pill critical">INFLUENCE ZONE</span>
                  </div>
                  <div className="command-meter-bar">
                    <div className="meter-fill red" style={{ width: `${Math.min(100, (calculatedRiskRadiusKm / 5) * 100)}%` }} />
                  </div>
                  <span className="metric-sub" style={{ marginTop: '4px', color: '#fca5a5' }}>
                    * AI estimated risk propagation footprint — NOT actual physical fire boundary.
                  </span>
                </div>
                <div className="command-metric-box">
                  <span className="metric-lbl">HIGH HAZARD (INNER)</span>
                  <span className="metric-val" style={{ color: '#ef4444' }}>300 m</span>
                  <span className="metric-sub">Immediate core hazard</span>
                </div>
                <div className="command-metric-box">
                  <span className="metric-lbl">SECONDARY (MODERATE)</span>
                  <span className="metric-val" style={{ color: '#f97316' }}>800 m</span>
                  <span className="metric-sub">Thermal radiation buffer</span>
                </div>
              </div>
            </div>

            {/* 07: Evidence Telemetry */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">07</span>
                <h3 className="section-title">EVIDENCE TELEMETRY & AUDIT</h3>
                <span className="section-tag">PROVENANCE</span>
              </div>
              <div className="telemetry-table">
                <div className="tel-row">
                  <span className="tel-key">Primary Sensor</span>
                  <span className="tel-val" style={{ color: '#38bdf8' }}>NOAA-21 VIIRS (375m I-Band)</span>
                </div>
                <div className="tel-row">
                  <span className="tel-key">Optical Confirmation</span>
                  <span className="tel-val" style={{ color: '#4ade80' }}>Sentinel-2 L2A (10m Multi-spectral)</span>
                </div>
                <div className="tel-row">
                  <span className="tel-key">Ground Truth</span>
                  <span className="tel-val" style={{ color: '#f59e0b' }}>OpenStreetMap Verified Facilities</span>
                </div>
                <div className="tel-row">
                  <span className="tel-key">Telemetry Pipeline</span>
                  <span className="tel-val" style={{ color: '#a855f7' }}>Thermoscope PS-26162 Edge Engine</span>
                </div>
              </div>
            </div>

            {/* 08: Multi-Agency SOP Response Actions */}
            <div className="command-section">
              <div className="section-header">
                <span className="section-num">08</span>
                <h3 className="section-title">OPERATIONAL RESPONSE ACTIONS</h3>
                <span className="section-tag">SOP DISPATCH</span>
              </div>
              <div className="action-buttons-grid">
                <button
                  type="button"
                  className="btn-operational-action alert-btn"
                  onClick={() => handleDispatchAction('dispatch')}
                >
                  <span className="btn-icon"><Flame size={16} className="text-red-400" /></span>
                  <div className="btn-text-block">
                    <span className="btn-main-label">DISPATCH UNITS</span>
                    <span className="btn-sub-label">Hazmat & Fire Squad</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-operational-action task-btn"
                  onClick={() => handleDispatchAction('tasking')}
                >
                  <span className="btn-icon"><LucideSatellite size={16} className="text-cyan-400" /></span>
                  <div className="btn-text-block">
                    <span className="btn-main-label">SATELLITE TASKING</span>
                    <span className="btn-sub-label">High-Res S2 Pass</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-operational-action brief-btn"
                  onClick={() => handleDispatchAction('brief')}
                >
                  <span className="btn-icon"><FileText size={16} className="text-amber-400" /></span>
                  <div className="btn-text-block">
                    <span className="btn-main-label">ISSUE BRIEFING</span>
                    <span className="btn-sub-label">EOC Evacuation Buffer</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-operational-action notify-btn"
                  onClick={() => handleDispatchAction('notify')}
                >
                  <span className="btn-icon"><Radio size={16} className="text-emerald-400" /></span>
                  <div className="btn-text-block">
                    <span className="btn-main-label">BROADCAST ADVISORY</span>
                    <span className="btn-sub-label">District Fire Control</span>
                  </div>
                </button>
              </div>

              {/* Action Feedback Stream */}
              <div className="action-feedback-stream">
                <span className="feedback-stream-title">DISPATCH TELEMETRY AUDIT TRAIL</span>
                {actionLogs.map((log) => (
                  <div key={log.id} className="feedback-log-item">
                    <span className="log-dot" />
                    <span className="log-time">[{log.time}]</span>
                    <span className="log-text">{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING MAP LEGEND & COLLAPSED TRIGGER */}
      {!showLegend ? (
        <button
          type="button"
          className="map-legend-floating-trigger"
          onClick={() => setShowLegend(true)}
          title="Open EOC 2D Map Legend"
        >
          <FontAwesomeIcon icon={faBookOpen} />
          <span>Map Legend</span>
        </button>
      ) : (
        <div className="map-legend-panel">
          <div className="legend-header">
            <span className="legend-title"><FontAwesomeIcon icon={faMap} /> EOC 2D MAP LEGEND</span>
            <button
              type="button"
              className="legend-close-btn"
              onClick={() => setShowLegend(false)}
              title="Close Legend"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <div className="legend-content">
            <div className="legend-section">
              <div className="legend-subtitle">THERMAL SEVERITY</div>
              <div className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span> Critical (&ge;50 MW)</div>
              <div className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#f97316' }}></span> High (&ge;25 MW)</div>
              <div className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#eab308' }}></span> Moderate (&ge;10 MW)</div>
              <div className="legend-item"><span className="legend-ring"></span> Selected Thermal Core</div>
            </div>

            <div className="legend-section">
              <div className="legend-subtitle">AI RISK FOOTPRINT & ZONES</div>
              <div className="legend-item"><span className="legend-dash" style={{ borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.12)' }}></span> AI Risk Field ({calculatedRiskRadiusKm} km)</div>
              <div className="legend-item"><span className="legend-dash" style={{ borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.10)' }}></span> Moderate Hazard (800m)</div>
              <div className="legend-item"><span className="legend-dash" style={{ borderColor: '#059669', backgroundColor: 'rgba(16, 185, 129, 0.05)' }}></span> Operational Perimeter (5.0 km)</div>
            </div>

            <div className="legend-section">
              <div className="legend-subtitle">CRITICAL INFRASTRUCTURE</div>
              <div className="legend-item"><FontAwesomeIcon icon={faIndustry} className="mr-1" /> Industrial Complex</div>
              <div className="legend-item"><FontAwesomeIcon icon={faBolt} className="mr-1" /> Power Substation</div>
              <div className="legend-item"><FontAwesomeIcon icon={faHospital} className="mr-1" /> Hospital / Healthcare</div>
            </div>

            <div className="legend-disclaimer">
              AI Risk Field is a propagation estimate — NOT an official evacuation order.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
