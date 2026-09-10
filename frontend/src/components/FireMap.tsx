import {
  faBolt,
  faBookOpen,
  faFire,
  faHospital,
  faIndustry,
  faMagnifyingGlass,
  faMap,
  faSatellite,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Popup, Tooltip, useMap } from 'react-leaflet';
import {
  Hotspot,
  OsmFeature,
  PersistentCluster,
  ThermalAlert,
  ThreatZonesResponse,
  ExposedAsset,
  PriorityRankingItem,
} from '../types/hotspot';
import { filterThermalPointsInsideIndia, isPointInsideIndia } from '../utils/geoUtils';

interface FireMapProps {
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
}

const MapViewController: React.FC<{ center: [number, number]; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
};

// CTRL + SCROLL ZOOM ONLY handler for Leaflet 2D tactical map
const LeafletCtrlScrollZoomHandler: React.FC<{
  onShowHint: () => void;
  onCtrlStatus: (active: boolean | null) => void;
}> = ({ onShowHint, onCtrlStatus }) => {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    map.scrollWheelZoom.disable();

    let isOver = false;
    let lastZoomTime = 0;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey && !e.shiftKey) {
        // Ctrl + scroll zoom authorized: prevent document scroll and smoothly step zoom
        e.preventDefault();
        const now = Date.now();
        if (now - lastZoomTime > 160) {
          lastZoomTime = now;
          if (e.deltaY < 0) {
            map.zoomIn(1);
          } else if (e.deltaY > 0) {
            map.zoomOut(1);
          }
        }
        onCtrlStatus(true);
      } else {
        // Normal scroll: DO NOT zoom, DO NOT preventDefault -> allows natural page scroll
        onShowHint();
      }
    };

    const onMouseEnter = () => {
      isOver = true;
    };

    const onMouseLeave = () => {
      isOver = false;
      onCtrlStatus(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' && isOver) {
        onCtrlStatus(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        onCtrlStatus(isOver ? false : null);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mouseenter', onMouseEnter);
    container.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mouseenter', onMouseEnter);
      container.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [map, onShowHint, onCtrlStatus]);

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
  const [showThreatZones] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(true);

  // Ctrl + Scroll Zoom Interaction Feedback
  const [showZoomHint, setShowZoomHint] = useState<boolean>(false);
  const [ctrlZoomStatus, setCtrlZoomStatus] = useState<'enabled' | 'locked' | null>(null);
  const zoomHintTimerRef = useRef<number | null>(null);
  const zoomStatusTimerRef = useRef<number | null>(null);

  const handleShowHint = useCallback(() => {
    setShowZoomHint(true);
    if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    zoomHintTimerRef.current = window.setTimeout(() => {
      setShowZoomHint(false);
    }, 2000);
  }, []);

  const handleCtrlStatus = useCallback((active: boolean | null) => {
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
  }, []);

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

  useEffect(() => {
    return () => {
      if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
      if (zoomStatusTimerRef.current) clearTimeout(zoomStatusTimerRef.current);
    };
  }, []);

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
  const closestAsset = selectedPriorityIncident?.closest_critical_asset || (activeNearbyFeatures.length > 0 ? activeNearbyFeatures[0] : null);

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

  // Industrial Context Facility Identification
  const industrialFacility: OsmFeature = activeNearbyFeatures.find(
    (f) => f.category === 'INDUSTRIAL' || f.type.toLowerCase().includes('refinery') || f.type.toLowerCase().includes('chemical') || f.type.toLowerCase().includes('industrial')
  ) || {
    name: selectedPriorityIncident?.industrial_facility || 'Petrochemical Processing & Hydrocarbon Unit',
    type: 'Refinery / Chemical Complex',
    category: 'INDUSTRIAL',
    distance_km: selectedPriorityIncident?.industrial_distance_km ?? 1.8,
    latitude: (selectedLat || 22.42) + 0.012,
    longitude: (selectedLon || 69.83) + 0.011,
    osm_id: '99401',
  };

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
        text = `Hazard Command: Dispatched Hazmat & Industrial Fire Squad to ${industrialFacility.name}`;
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
      {/* TACTICAL TOP-LEFT SATELLITE OBSERVATION OVERLAY */}
      <div className="tactical-satellite-overlay">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
          <span style={{ color: '#38bdf8', fontWeight: 800, fontSize: '10px', letterSpacing: '0.08em' }}>
            SATELLITE OBSERVATION • NOAA-21 VIIRS 375m
          </span>
        </div>
        <div style={{ fontSize: '9.5px', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '1px', lineHeight: 1.35 }}>
          <div>STATUS: <span style={{ color: '#4ade80', fontWeight: 700 }}>ACTIVE ORBIT PASS</span> • FIRMS SYNCED</div>
          {selectedLat && selectedLon ? (
            <div>
              TARGET: <span style={{ color: '#f8fafc', fontWeight: 700 }}>{selectedLat.toFixed(3)}°N, {selectedLon.toFixed(3)}°E</span> • FRP: <span style={{ color: '#ef4444', fontWeight: 700 }}>{activeFrp.toFixed(1)} MW</span>
            </div>
          ) : (
            <div>SURVEILLANCE: <span style={{ color: '#f8fafc' }}>INDIAN SUB-CONTINENTAL GRID</span></div>
          )}
          <div>MODE: <span style={{ color: '#f59e0b', fontWeight: 700 }}>{riskDisplayMode === 'ai_risk' ? 'AI RISK PROPAGATION FIELD' : 'THERMAL RADIOMETRIC FIELD'}</span></div>
        </div>
      </div>

      {/* MAP LAYER & BASEMAP CONTROLS FLOATING BAR */}
      <div className="map-layer-toggles-bar">
        {/* BASEMAP SWITCHER */}
        <div className="basemap-switch-controls" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span className="layer-bar-title" style={{ fontWeight: 700, fontSize: '11px', color: '#cbd5e1' }}>BASEMAP:</span>
          <button
            type="button"
            className={`layer-toggle-btn ${activeBasemap === 'satellite' ? 'active' : ''}`}
            onClick={() => handleBasemapToggle('satellite')}
            title="Switch to Real Satellite Imagery"
          >
            <FontAwesomeIcon icon={faSatellite} /> SATELLITE
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${activeBasemap === 'standard' ? 'active' : ''}`}
            onClick={() => handleBasemapToggle('standard')}
            title="Switch to Standard Basemap"
          >
            <FontAwesomeIcon icon={faMap} /> STANDARD
          </button>
        </div>

        {/* 2D RISK MODES SWITCHER */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
          <button
            type="button"
            className={`layer-toggle-btn ${riskDisplayMode === 'ai_risk' ? 'active' : ''}`}
            onClick={() => setRiskDisplayMode('ai_risk')}
            title="AI 2D Risk Propagation Field with smooth continuous radial gradient"
          >
            AI Risk Field
          </button>
          <button
            type="button"
            className={`layer-toggle-btn ${riskDisplayMode === 'thermal_field' ? 'active' : ''}`}
            onClick={() => setRiskDisplayMode('thermal_field')}
            title="Radiometric Thermal Intensity Field"
          >
            Thermal Field
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
            India Focus
          </button>
          <button
            type="button"
            className="layer-toggle-btn"
            onClick={handleGlobalView}
            title="Global Earth View"
          >
            Global View
          </button>
        </div>

        {/* OPEN INCIDENT BUTTON */}
        {selectedLat && selectedLon && (
          <button
            type="button"
            className="layer-toggle-btn active"
            onClick={handleOpenIncident}
            title="Open Incident Intelligence Command Panel (Split Workspace)"
            style={{
              marginLeft: '6px',
              background: 'rgba(0, 183, 255, 0.15)',
              borderColor: 'rgba(0, 183, 255, 0.4)',
              color: '#EAF6FF',
              fontWeight: 700,
            }}
          >
            OPEN INCIDENT
          </button>
        )}

        <button
          type="button"
          className={`layer-toggle-btn ${showLegend ? 'active' : ''}`}
          onClick={() => setShowLegend(!showLegend)}
          style={{ marginLeft: 'auto' }}
        >
          <FontAwesomeIcon icon={faBookOpen} /> {showLegend ? 'Hide Legend' : 'Show Legend'}
        </button>

        <button
          type="button"
          className={`layer-toggle-btn ${isFullscreen ? 'active' : ''}`}
          onClick={handleToggleFullscreen}
          title={isFullscreen ? 'EXIT FULL SCREEN' : 'ENTER FULL SCREEN'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          style={{ marginLeft: '6px' }}
        >
          <span style={{ fontSize: '12px' }}>⛶</span> {isFullscreen ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}
        </button>
      </div>

      <MapContainer
        center={effectiveCenter}
        zoom={effectiveZoom}
        scrollWheelZoom={false}
        className="leaflet-container"
      >
        <MapViewController center={effectiveCenter} zoom={effectiveZoom} />
        <LeafletCtrlScrollZoomHandler onShowHint={handleShowHint} onCtrlStatus={handleCtrlStatus} />
        <LeafletFullscreenResizeHandler isFullscreen={isFullscreen} />
        <LeafletSplitResizeHandler isSplitView={isSplitView} />
        <LeafletFlyToController navCommand={navCommand} />
        <LeafletSvgDefs />

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

        {/* 5 KM OPERATIONAL THREAT RADIUS BUFFER (Green dashed ring) */}
        {selectedLat && selectedLon && (
          <Circle
            center={[selectedLat, selectedLon]}
            radius={5000}
            pathOptions={{
              color: '#059669',
              fillColor: '#10b981',
              fillOpacity: 0.03,
              weight: 1.5,
              dashArray: '5 5',
            }}
          >
            <Popup>
              <div style={{ padding: '4px', minWidth: '180px' }}>
                <strong style={{ color: '#059669', fontSize: '13px' }}>5.0 KM Operational Threat Buffer</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#475569' }}>
                  Maximum operational monitoring perimeter for critical asset exposure analysis.
                </p>
                {activeNearbyFeatures.length > 0 && (
                  <div style={{ marginTop: '6px', fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>
                    {activeNearbyFeatures.length} infrastructure assets detected.
                  </div>
                )}
              </div>
            </Popup>
          </Circle>
        )}

        {/* AI 2D THERMAL RISK FIELD: Smooth Radial Gradient Footprint */}
        {selectedLat && selectedLon && riskDisplayMode === 'ai_risk' && (
          <>
            {/* Outermost Risk Footprint Perimeter (Dashed border + subtle fill) */}
            <Circle
              center={[selectedLat, selectedLon]}
              radius={displayedRadiusMeters}
              pathOptions={{
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: '5 5',
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -20]} className="risk-field-disclaimer-tooltip">
                <div style={{ textAlign: 'center', fontSize: '9px', fontWeight: 700, color: '#fca5a5' }}>
                  <div>AI ESTIMATED RISK FIELD: {calculatedRiskRadiusKm} KM</div>
                  <div style={{ fontSize: '8px', color: '#cbd5e1', fontWeight: 500 }}>
                    [ AI estimated risk propagation — NOT actual physical fire boundary ]
                  </div>
                </div>
              </Tooltip>
            </Circle>

            {/* Intermediate Gradient Transition Zone */}
            <Circle
              center={[selectedLat, selectedLon]}
              radius={Math.round(displayedRadiusMeters * 0.55)}
              pathOptions={{
                color: '#f97316',
                fillColor: '#f97316',
                fillOpacity: 0.22,
                weight: 1,
                dashArray: '3 3',
              }}
            />

            {/* High Threat Thermal Zone */}
            <Circle
              center={[selectedLat, selectedLon]}
              radius={Math.round(displayedRadiusMeters * 0.25)}
              pathOptions={{
                color: '#dc2626',
                fillColor: '#dc2626',
                fillOpacity: 0.38,
                weight: 1.5,
              }}
            />
          </>
        )}

        {/* THERMAL ANOMALY CORE & 375m VIIRS PIXEL FOOTPRINT (Stage >= 2) */}
        {selectedLat && selectedLon && expansionStage >= 2 && (
          <>
            {/* VIIRS 375m Resolution Pixel Footprint Buffer */}
            <Circle
              center={[selectedLat, selectedLon]}
              radius={375}
              pathOptions={{
                color: '#f97316',
                fillColor: '#f97316',
                fillOpacity: 0.25,
                weight: 1.5,
                dashArray: '2 2',
              }}
            />

            {/* Selected Thermal Anomaly Core (Bright center + permanent label) */}
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
              <Tooltip permanent direction="top" offset={[0, -10]} className="thermal-detection-tooltip">
                <div style={{ textAlign: 'center', fontSize: '10px', fontWeight: 800, color: '#ef4444' }}>
                  <div>THERMAL DETECTION ▼</div>
                  <div style={{ fontSize: '9px', color: '#f8fafc', fontWeight: 600 }}>
                    {activeFrp.toFixed(1)} MW • Conf: {activeConf}%
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          </>
        )}

        {/* OSM INDUSTRIAL CONTEXT: Proximity Line & Facility Marker (Stage >= 6) */}
        {selectedLat && selectedLon && expansionStage >= 6 && industrialFacility && (
          <>
            {/* Proximity Vector Connection Line */}
            <Polyline
              positions={[[selectedLat, selectedLon], [industrialFacility.latitude, industrialFacility.longitude]]}
              pathOptions={{
                color: '#38bdf8',
                weight: 2,
                dashArray: '4 4',
              }}
            >
              <Tooltip permanent direction="center" className="proximity-vector-tooltip">
                <span style={{ fontSize: '9px', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.04em' }}>
                  HAZARD ── {industrialFacility.distance_km.toFixed(1)} KM ── FACILITY
                </span>
              </Tooltip>
            </Polyline>

            {/* Industrial Facility Marker */}
            <CircleMarker
              center={[industrialFacility.latitude, industrialFacility.longitude]}
              radius={7}
              pathOptions={{
                color: '#f59e0b',
                fillColor: '#f59e0b',
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Tooltip permanent direction="right" offset={[10, 0]} className="industrial-facility-tooltip">
                <span style={{ fontSize: '9px', fontWeight: 700, color: '#fbbf24' }}>
                  {industrialFacility.name} ({industrialFacility.distance_km.toFixed(1)} KM)
                </span>
              </Tooltip>
            </CircleMarker>
          </>
        )}

        {/* 5 KM NEARBY INFRASTRUCTURE MARKERS & PROXIMITY VECTORS */}
        {activeNearbyFeatures.map((feat, fIdx) => {
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
                click: () => onSelectAlert(alt),
              }}
              pathOptions={{
                color: '#ffffff',
                fillColor: color,
                fillOpacity: 0.95,
                weight: isSelected ? 3 : 1.5,
              }}
            >
              <Popup className="custom-popup">
                <div className="popup-container">
                  <div className="popup-header" style={{ color: color }}>
                    <FontAwesomeIcon icon={faTriangleExclamation} /> ACTIVE INCIDENT ALERT ({alt.alert_id})
                  </div>
                  <div className="popup-body">
                    <div className="popup-row">
                      <span className="popup-label">Risk Priority:</span>
                      <span className="popup-val highlight-frp">{alt.risk_score} / 100 ({alt.risk_level})</span>
                    </div>
                    {alt.impact_score !== undefined && (
                      <div className="popup-row">
                        <span className="popup-label">Impact Score:</span>
                        <span className="popup-val highlight-frp">{alt.impact_score} / 100 ({alt.priority_index || 'P1'})</span>
                      </div>
                    )}
                    <div className="popup-row">
                      <span className="popup-label">Classification:</span>
                      <span className="popup-val">{alt.classification.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="popup-row">
                      <span className="popup-label">Status:</span>
                      <span className="popup-val">{alt.status}</span>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: '0.5rem', width: '100%' }}
                      onClick={() => onSelectAlert(alt)}
                    >
                      <FontAwesomeIcon icon={faBolt} /> Open Incident & Impact Intelligence
                    </button>
                  </div>
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
              selectedHotspot.latitude === spot.latitude &&
              selectedHotspot.longitude === spot.longitude;

            // Small, subtle FIRMS observations: 4px default, 5px critical, 8px selected
            const radius = isSelected ? 8 : (severity === 'CRITICAL' ? 5 : 4);

            return (
              <CircleMarker
                key={`spot-${spot.latitude}-${spot.longitude}-${index}`}
                center={[spot.latitude, spot.longitude]}
                radius={radius}
                eventHandlers={{
                  click: () => onSelectHotspot(spot),
                }}
                pathOptions={{
                  color: isSelected ? '#ffffff' : color,
                  fillColor: color,
                  fillOpacity: isSelected ? 1.0 : (severity === 'CRITICAL' ? 0.9 : 0.8),
                  weight: isSelected ? 2.5 : 1,
                }}
              >
                <Popup className="custom-popup">
                  <div className="popup-container">
                    <div className="popup-header" style={{ color }}>
                      <FontAwesomeIcon icon={faFire} /> THERMAL ANOMALY ({severity})
                    </div>
                    <div className="popup-body">
                      <div className="popup-row">
                        <span className="popup-label">Severity Level:</span>
                        <span className="popup-val highlight-frp">{severity}</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-label">Radiative Power:</span>
                        <span className="popup-val highlight-frp">{spot.frp.toFixed(1)} MW</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-label">Coordinates:</span>
                        <span className="popup-val">{spot.latitude.toFixed(3)}°N, {spot.longitude.toFixed(3)}°E</span>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ marginTop: '0.6rem', width: '100%' }}
                        onClick={() => onSelectHotspot(spot)}
                      >
                        <FontAwesomeIcon icon={faBolt} /> Open Incident & Impact Intelligence
                      </button>
                    </div>
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
                  click: () => onSelectCluster(cluster),
                }}
                pathOptions={{
                  color: isSelected ? '#ffffff' : '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: isSelected ? 0.95 : 0.8,
                  weight: isSelected ? 2.5 : 1.5,
                }}
              >
                <Popup className="custom-popup">
                  <div className="popup-container">
                    <div className="popup-header"><FontAwesomeIcon icon={faSatellite} /> PERSISTENT CLUSTER</div>
                    <div className="popup-body">
                      <div className="popup-row">
                        <span className="popup-label">Cluster ID:</span>
                        <span className="popup-val">{cluster.cluster_id}</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-label">Detections:</span>
                        <span className="popup-val">{cluster.observation_count} observations</span>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ marginTop: '0.5rem', width: '100%' }}
                        onClick={() => onSelectCluster(cluster)}
                      >
                        <FontAwesomeIcon icon={faBolt} /> Open Incident & Impact Intelligence
                      </button>
                    </div>
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
            <span style={{ color: expansionStage >= 1 ? '#38bdf8' : '#475569', fontWeight: expansionStage === 1 ? 800 : 500 }}>
              ● SATELLITE OBS
            </span>
            <span style={{ color: '#475569' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 2 ? '#ef4444' : '#475569', fontWeight: expansionStage === 2 ? 800 : 500 }}>
              ● THERMAL CORE
            </span>
            <span style={{ color: '#475569' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 3 ? '#f97316' : '#475569', fontWeight: expansionStage === 3 ? 800 : 500 }}>
              ● PERSISTENCE
            </span>
            <span style={{ color: '#475569' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 4 ? '#eab308' : '#475569', fontWeight: expansionStage === 4 ? 800 : 500 }}>
              ● AI CLASSIFICATION
            </span>
            <span style={{ color: '#475569' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 5 ? '#f43f5e' : '#475569', fontWeight: expansionStage === 5 ? 800 : 500 }}>
              ● RISK FIELD ({calculatedRiskRadiusKm} KM)
            </span>
            <span style={{ color: '#475569' }}>&rarr;</span>
            <span style={{ color: expansionStage >= 6 ? '#10b981' : '#475569', fontWeight: expansionStage === 6 ? 800 : 500 }}>
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
            onClick={() => setWorkspaceState('INCIDENT_SPLIT_VIEW')}
          >
            <span>OPEN INCIDENT</span>
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
              <div className="facility-context-card">
                <div className="facility-head-row">
                  <span className="fac-icon"><FontAwesomeIcon icon={faIndustry} /></span>
                  <div className="fac-details">
                    <span className="fac-name">{industrialFacility.name}</span>
                    <span className="fac-type">{industrialFacility.type} • {industrialFacility.category}</span>
                  </div>
                  <span className="fac-distance-badge">{industrialFacility.distance_km.toFixed(1)} KM</span>
                </div>
                <div className="proximity-alert-box critical">
                  <span className="alert-badge-tech"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
                  <span>Direct threat exposure: Industrial fuel storage & processing facility in active influence corridor.</span>
                </div>
              </div>
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
                  <span className="btn-icon"><FontAwesomeIcon icon={faFire} /></span>
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
                  <span className="btn-icon"><FontAwesomeIcon icon={faSatellite} /></span>
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
                  <span className="btn-icon"><FontAwesomeIcon icon={faBookOpen} /></span>
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
                  <span className="btn-icon"><FontAwesomeIcon icon={faBolt} /></span>
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

      {/* FLOATING MAP LEGEND */}
      {showLegend && (
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
              <div className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#f97316' }}></span> High (&ge;25 MW)</div>
              <div className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#eab308' }}></span> Moderate (&ge;10 MW)</div>
              <div className="legend-item"><span className="legend-ring"></span> Selected Thermal Core</div>
            </div>

            <div className="legend-section">
              <div className="legend-subtitle">AI RISK FOOTPRINT & ZONES</div>
              <div className="legend-item"><span className="legend-dash" style={{ borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.22)' }}></span> AI Risk Field ({calculatedRiskRadiusKm} km)</div>
              <div className="legend-item"><span className="legend-dash" style={{ borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.14)' }}></span> Moderate Hazard (800m)</div>
              <div className="legend-item"><span className="legend-dash" style={{ borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.05)' }}></span> Operational Perimeter (5.0 km)</div>
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

      {/* CTRL + SCROLL UX HINT & STATUS INDICATOR */}
      {showZoomHint && (
        <div className="globe-zoom-hint" role="status" aria-live="polite">
          <span className="hint-icon"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
          <span>HOLD CTRL + SCROLL TO ZOOM</span>
        </div>
      )}
      {ctrlZoomStatus && (
        <div className={`globe-ctrl-indicator ${ctrlZoomStatus}`} role="status">
          <span className={`ctrl-dot ${ctrlZoomStatus}`} />
          <span>{ctrlZoomStatus === 'enabled' ? 'CTRL + SCROLL ZOOM ENABLED' : 'ZOOM LOCKED'}</span>
        </div>
      )}
    </div>
  );
};
