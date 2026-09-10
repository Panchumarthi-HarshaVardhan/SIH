import { useEffect, useState, useCallback } from 'react';
import { TopBar } from './components/TopBar';
import { DashboardView } from './components/DashboardView';
import { IncidentsView } from './components/IncidentsView';
import { SystemStatusView } from './components/SystemStatusView';
import { SettingsView } from './components/SettingsView';
import { FireMap } from './components/FireMap';
import { IncidentDetailPanel } from './components/IncidentDetailPanel';
import {
  Hotspot,
  HotspotsApiResponse,
  PersistentCluster,
  PersistentClustersApiResponse,
  PriorityRankingItem,
  ThermalAlert,
  AppView,
  LatestFirmsResponse,
} from './types/hotspot';
import { getApiUrl, fetchLatestFirmsObservation, getDecisionSupport, DEMO_SCENARIO_PRESETS } from './config/api';
import { AnomalyIntelligenceAgentDrawer } from './components/agent';
import { AuthProvider } from './auth';
import { AuthGate } from './components/auth/AuthGate';

function AppContent() {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [region, setRegion] = useState<string>('india');
  const [customBbox, setCustomBbox] = useState<string>('');

  // Primary Data State
  const [hotspotsData, setHotspotsData] = useState<HotspotsApiResponse | null>(null);
  const [loadingHotspots, setLoadingHotspots] = useState<boolean>(false);

  const [clustersData, setClustersData] = useState<PersistentClustersApiResponse | null>(null);
  const [loadingClusters, setLoadingClusters] = useState<boolean>(false);

  const [priorityItems, setPriorityItems] = useState<PriorityRankingItem[]>([]);
  const [loadingPriority, setLoadingPriority] = useState<boolean>(false);
  const [selectedPriorityIncident, setSelectedPriorityIncident] = useState<PriorityRankingItem | null>(null);
  const [basemap, setBasemap] = useState<'standard' | 'satellite'>('standard');

  const [alerts, setAlerts] = useState<ThermalAlert[]>([]);
  const [_latestFirms, setLatestFirms] = useState<LatestFirmsResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toUTCString().slice(17, 25) + ' UTC');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Selected Incident for Detail Panel
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<PersistentCluster | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<ThermalAlert | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState<boolean>(false);

  // Active Map Overlays (Phase 6I)
  const [mapThreatZones, setMapThreatZones] = useState<any>(null);
  const [mapExposedAssets, setMapExposedAssets] = useState<any[]>([]);
  const [mapCenterCoords, setMapCenterCoords] = useState<[number, number] | undefined>(undefined);
  const [mapZoomLevel, setMapZoomLevel] = useState<number | undefined>(undefined);

  // Fetch Threat Zones & Assets for Map on Incident Selection
  const loadDecisionSupportForMap = useCallback(async (observationId?: string | null, lat?: number, lon?: number) => {
    if (!observationId) {
      setMapThreatZones(null);
      setMapExposedAssets([]);
      return;
    }
    try {
      const dec = await getDecisionSupport(observationId);
      if (dec?.threat_zones) {
        setMapThreatZones(dec.threat_zones);
      }
      if (dec?.asset_exposure?.facilities) {
        setMapExposedAssets(
          dec.asset_exposure.facilities.map((f: any) => ({
            asset_name: f.name,
            latitude: f.latitude || lat || 20.59,
            longitude: f.longitude || lon || 78.96,
            category: (f.category || 'INDUSTRIAL').toUpperCase(),
            distance_km: f.distance_km || 0.5,
            threat_zone: f.is_critical ? 'HIGH HAZARD' : 'PRECAUTIONARY',
            status: f.is_critical ? 'CRITICAL EXPOSURE' : 'MODERATE EXPOSURE',
          }))
        );
      }
    } catch {
      // Fallback: clear or preserve
      setMapThreatZones(null);
      setMapExposedAssets([]);
    }
  }, []);

  // 1. Fetch Hotspots
  const loadHotspots = useCallback(async (selectedRegion: string, bboxStr: string) => {
    setLoadingHotspots(true);
    try {
      let endpoint = `/api/hotspots?region=${selectedRegion}`;
      if (selectedRegion === 'custom' && bboxStr) {
        endpoint += `&bbox=${encodeURIComponent(bboxStr)}`;
      }
      const response = await fetch(getApiUrl(endpoint));
      if (response.ok) {
        const data: HotspotsApiResponse = await response.json();
        setHotspotsData(data);
      }
    } catch (err) {
      console.error('Failed to load hotspots:', err);
    } finally {
      setLoadingHotspots(false);
    }
  }, []);

  // 2. Fetch Persistent Clusters
  const loadClusters = useCallback(async (selectedRegion: string, bboxStr: string) => {
    setLoadingClusters(true);
    try {
      let endpoint = `/api/persistent-hotspots?region=${selectedRegion}`;
      if (selectedRegion === 'custom' && bboxStr) {
        endpoint += `&bbox=${encodeURIComponent(bboxStr)}`;
      }
      const response = await fetch(getApiUrl(endpoint));
      if (response.ok) {
        const data: PersistentClustersApiResponse = await response.json();
        setClustersData(data);
      }
    } catch (err) {
      console.error('Failed to load clusters:', err);
    } finally {
      setLoadingClusters(false);
    }
  }, []);

  // 3. Fetch Priority Rankings (Non-blocking with strict client timeout)
  const loadPriority = useCallback(async (selectedRegion: string) => {
    setLoadingPriority(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(getApiUrl(`/api/hotspots/priority-ranking?region=${selectedRegion}`), {
        signal: controller.signal,
      });
      if (response.ok) {
        const data = await response.json();
        const items: PriorityRankingItem[] = data.rankings || data.priority_events || [];
        setPriorityItems(items);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to load priority rankings:', err);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoadingPriority(false);
    }
  }, []);

  const handleEnrichHotspot = useCallback(async (hotspotId: string, lat: number, lon: number) => {
    try {
      const res = await fetch(getApiUrl(`/api/hotspots/${encodeURIComponent(hotspotId)}/enrich-osm?lat=${lat}&lon=${lon}&radius_km=5.0`));
      if (res.ok) {
        const enriched = await res.json();
        const resolvedFacility = enriched.nearest_facility?.name
          || enriched.closest_industrial?.name
          || (enriched.display_locality ? `Unclassified Open Land (${enriched.display_locality})` : 'No industrial assets within 5km');
        const resolvedDistance = enriched.nearest_facility?.distance_km ?? enriched.closest_industrial?.distance_km ?? null;

        setPriorityItems((prev) =>
          prev.map((item) => {
            if (item.cluster_id === hotspotId || item.hotspot_id === hotspotId) {
              return {
                ...item,
                data_status: enriched.data_status,
                nearby_features: enriched.nearby_features,
                closest_critical_asset: enriched.closest_critical_asset,
                nearest_facility: enriched.nearest_facility,
                display_locality: enriched.display_locality,
                industrial_facility: resolvedFacility,
                industrial_distance_km: resolvedDistance,
                exposed_assets_count: enriched.facility_count,
                exposure_summary: enriched.category_summary,
              };
            }
            return item;
          })
        );
        setSelectedPriorityIncident((prev) => {
          if (prev && (prev.cluster_id === hotspotId || prev.hotspot_id === hotspotId)) {
            return {
              ...prev,
              data_status: enriched.data_status,
              nearby_features: enriched.nearby_features,
              closest_critical_asset: enriched.closest_critical_asset,
              nearest_facility: enriched.nearest_facility,
              display_locality: enriched.display_locality,
              industrial_facility: resolvedFacility,
              industrial_distance_km: resolvedDistance,
              exposed_assets_count: enriched.facility_count,
              exposure_summary: enriched.category_summary,
            };
          }
          return prev;
        });
      }
    } catch (e) {
      console.error('Failed to enrich hotspot OSM:', e);
    }
  }, []);

  // 4. Fetch Alerts
  const loadAlerts = useCallback(async () => {
    try {
      const response = await fetch(getApiUrl('/api/alerts'));
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts || []);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  }, []);

  // 5. Fetch Latest Observation
  const loadLatestObservation = useCallback(async () => {
    try {
      const obs = await fetchLatestFirmsObservation();
      setLatestFirms(obs);
    } catch (err) {
      console.error('Failed to fetch latest FIRMS observation:', err);
    }
  }, []);

  // Master Refresh
  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      loadHotspots(region, customBbox),
      loadClusters(region, customBbox),
      loadPriority(region),
      loadAlerts(),
      loadLatestObservation(),
    ]);
    setLastUpdated(new Date().toUTCString().slice(17, 25) + ' UTC');
    setRefreshing(false);
  }, [region, customBbox, loadHotspots, loadClusters, loadPriority, loadAlerts, loadLatestObservation]);

  useEffect(() => {
    handleRefreshAll();
    const interval = setInterval(handleRefreshAll, 60000);
    return () => clearInterval(interval);
  }, [handleRefreshAll]);

  // Selection Handlers - Decoupled from Investigation Panel Drawer State
  const handleSelectHotspot = (h: Hotspot) => {
    setSelectedHotspot(h);
    setSelectedCluster(null);
    setSelectedAlert(null);
    setSelectedPriorityIncident(null);
    // Preserves showDetailPanel state: if already open, it stays open for the new anomaly.
    // If closed, it stays closed.
    if (h.latitude && h.longitude) {
      setMapCenterCoords([h.latitude, h.longitude]);
      setMapZoomLevel(11);
    }
    loadDecisionSupportForMap(h.observation_id, h.latitude, h.longitude);
  };

  const handleSelectCluster = (c: PersistentCluster) => {
    setSelectedCluster(c);
    setSelectedHotspot(null);
    setSelectedAlert(null);
    setSelectedPriorityIncident(null);
    if (c.center_latitude && c.center_longitude) {
      setMapCenterCoords([c.center_latitude, c.center_longitude]);
      setMapZoomLevel(11);
    }
    const obsId = c.observations && c.observations.length > 0 ? c.observations[0].observation_id : c.cluster_id;
    loadDecisionSupportForMap(obsId, c.center_latitude, c.center_longitude);
  };

  const handleSelectAlert = (a: ThermalAlert) => {
    setSelectedAlert(a);
    setSelectedHotspot(null);
    setSelectedCluster(null);
    setSelectedPriorityIncident(null);
    if (a.latitude && a.longitude) {
      setMapCenterCoords([a.latitude, a.longitude]);
      setMapZoomLevel(11);
    }
    const obsId = a.cluster_id ? a.cluster_id.replace('FIRMS_', '') : a.alert_id;
    loadDecisionSupportForMap(obsId, a.latitude, a.longitude);
  };

  const handleSelectPriorityIncident = useCallback((p: PriorityRankingItem) => {
    setSelectedPriorityIncident(p);
    const obsId = p.hotspot_id || p.cluster_id;
    const fallbackHotspot: Hotspot = {
      observation_id: obsId,
      latitude: p.latitude,
      longitude: p.longitude,
      brightness: p.brightness || 340.0,
      confidence: p.confidence || 'nominal',
      frp: p.frp || 25.0,
      acquired_at: new Date().toISOString(),
      satellite: p.data_source || 'NASA FIRMS',
      instrument: 'VIIRS',
      source: 'NASA FIRMS',
    };
    setSelectedHotspot(fallbackHotspot);
    setSelectedCluster(null);
    setSelectedAlert(null);
    if (p.latitude && p.longitude) {
      setMapCenterCoords([p.latitude, p.longitude]);
      setMapZoomLevel(12);
    }
    loadDecisionSupportForMap(obsId, p.latitude, p.longitude);
  }, [loadDecisionSupportForMap]);

  // Demo Scenario Handler (SIH Judge Benchmark Cases)
  const handleSelectDemoScenario = (scenarioId: string) => {
    const scenario = DEMO_SCENARIO_PRESETS.find(
      (s) =>
        s.id === scenarioId ||
        s.observation_id === scenarioId ||
        (scenarioId === 'demo-p1-refinery' && s.id === 'demo_industrial_p1') ||
        (scenarioId === 'demo-p2-steel' && s.id === 'demo_wildfire_p2') ||
        (scenarioId === 'demo-p3-wildfire' && (s.id === 'demo_wildfire_p2' || s.id === 'demo_crop_burn_p4'))
    );
    if (!scenario) return;

    const demoHotspot: Hotspot = {
      observation_id: scenario.observation_id,
      latitude: scenario.coordinates[0],
      longitude: scenario.coordinates[1],
      brightness: 345.0,
      confidence: 'high',
      frp: 45.0,
      acquired_at: new Date().toISOString(),
      satellite: 'NOAA-20 (VIIRS)',
      instrument: 'VIIRS',
      source: 'NASA FIRMS',
    };

    setSelectedHotspot(demoHotspot);
    setSelectedCluster(null);
    setSelectedAlert(null);
    setMapCenterCoords(scenario.coordinates);
    setMapZoomLevel(12);
    setShowDetailPanel(true);
    loadDecisionSupportForMap(scenario.observation_id, scenario.coordinates[0], scenario.coordinates[1]);
  };

  // Explicit Investigation Panel Controls: Open panel without altering selection
  const handleOpenInvestigation = useCallback(() => {
    setShowDetailPanel(true);
  }, []);

  // Closing the Investigation Panel ONLY closes the drawer.
  // It NEVER deselects the anomaly, unsets selection, or resets the map zoom/center.
  const handleCloseDetailPanel = useCallback(() => {
    setShowDetailPanel(false);
  }, []);

  // Explicit anomaly deselection and map reset (triggered ONLY by clicking the map background or explicit reset)
  const handleDeselectAnomaly = useCallback(() => {
    setSelectedHotspot(null);
    setSelectedCluster(null);
    setSelectedAlert(null);
    setSelectedPriorityIncident(null);
    setShowDetailPanel(false);
    setMapCenterCoords([20.5937, 78.9629]);
    setMapZoomLevel(5);
  }, []);

  const handleAlertStatusChange = async (alertId: string, newStatus: ThermalAlert['status'], notes?: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/alerts/${encodeURIComponent(alertId)}/status`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, notes }),
      });
      if (res.ok) {
        loadAlerts();
      }
    } catch (e) {
      console.error('Failed to update alert status:', e);
    }
  };

  return (
    <div className="app-layout">
      {/* 1. TOP HEADER & NAVIGATION */}
      <TopBar
        currentView={currentView}
        onViewChange={setCurrentView}
      />

      {/* 2. MAIN VIEW CONTAINER */}
      <main className="app-main-content">
        {/* VIEW 1: DASHBOARD */}
        {currentView === 'dashboard' && (
          <DashboardView
            hotspots={hotspotsData?.hotspots || []}
            clusters={clustersData?.clusters || []}
            alerts={alerts}
            priorityItems={priorityItems}
            loadingHotspots={loadingHotspots}
            loadingClusters={loadingClusters}
            loadingPriority={loadingPriority}
            lastUpdated={lastUpdated}
            selectedHotspot={selectedHotspot}
            selectedCluster={selectedCluster}
            selectedAlert={selectedAlert}
            selectedPriorityIncident={selectedPriorityIncident}
            onSelectHotspot={handleSelectHotspot}
            onSelectCluster={handleSelectCluster}
            onSelectAlert={handleSelectAlert}
            onSelectPriorityIncident={handleSelectPriorityIncident}
            onOpenInvestigation={handleOpenInvestigation}
            onDeselectAnomaly={handleDeselectAnomaly}
            onRefreshAll={handleRefreshAll}
            refreshing={refreshing}
            onNavigateView={setCurrentView}
            onEnrichHotspot={handleEnrichHotspot}
            basemap={basemap}
            onBasemapChange={setBasemap}
            mapCenter={mapCenterCoords}
            mapZoom={mapZoomLevel}
          />
        )}

        {/* VIEW 2: INCIDENTS */}
        {currentView === 'incidents' && (
          <IncidentsView
            hotspots={hotspotsData?.hotspots || []}
            clusters={clustersData?.clusters || []}
            alerts={alerts}
            priorityItems={priorityItems}
            loading={loadingPriority || loadingHotspots}
            onSelectHotspot={handleSelectHotspot}
            onSelectCluster={handleSelectCluster}
            onSelectAlert={handleSelectAlert}
            onOpenInvestigation={handleOpenInvestigation}
          />
        )}

        {/* VIEW 3: FULL MAP VIEW */}
        {currentView === 'map' && (
          <div className="fullscreen-map-view">
            <FireMap
              hotspots={hotspotsData?.hotspots || []}
              clusters={clustersData?.clusters || []}
              activeAlerts={alerts}
              selectedHotspot={selectedHotspot}
              selectedCluster={selectedCluster}
              selectedAlert={selectedAlert}
              selectedPriorityIncident={selectedPriorityIncident}
              onSelectHotspot={handleSelectHotspot}
              onSelectCluster={handleSelectCluster}
              onSelectAlert={handleSelectAlert}
              onOpenInvestigation={handleOpenInvestigation}
              onMapBackgroundClick={handleDeselectAnomaly}
              threatZones={mapThreatZones}
              exposedAssets={mapExposedAssets}
              mapCenter={mapCenterCoords}
              mapZoom={mapZoomLevel}
              center={mapCenterCoords}
              zoom={mapZoomLevel}
              basemap={basemap}
              onBasemapChange={setBasemap}
            />
          </div>
        )}

        {/* VIEW 4: SYSTEM STATUS */}
        {currentView === 'status' && <SystemStatusView />}

        {/* VIEW 5: SETTINGS */}
        {currentView === 'settings' && (
          <div className="subview-wrapper">
            <SettingsView
              region={region}
              onRegionChange={setRegion}
              customBbox={customBbox}
              onCustomBboxChange={setCustomBbox}
              onApplyCustomBbox={handleRefreshAll}
              onRefresh={handleRefreshAll}
              onSelectDemoScenario={handleSelectDemoScenario}
            />
          </div>
        )}
      </main>

      {/* 3. 5-PART INCIDENT DETAILS PANEL (DRAWER MODAL) */}
      {showDetailPanel && (
        <IncidentDetailPanel
          hotspot={selectedHotspot}
          cluster={selectedCluster}
          alert={selectedAlert}
          priorityIncident={selectedPriorityIncident}
          onClose={handleCloseDetailPanel}
          onStatusChange={handleAlertStatusChange}
        />
      )}

      {/* 4. ANOMALY INTELLIGENCE AGENT OPERATIONAL DRAWER (Phase 3) */}
      <AnomalyIntelligenceAgentDrawer
        hotspots={hotspotsData?.hotspots || []}
        selectedObservationId={
          selectedHotspot?.observation_id ||
          selectedPriorityIncident?.hotspot_id ||
          selectedPriorityIncident?.cluster_id ||
          (selectedAlert?.cluster_id ? selectedAlert.cluster_id.replace('FIRMS_', '') : selectedAlert?.alert_id) ||
          null
        }
        onSelectObservation={(obsId) => {
          const found = (hotspotsData?.hotspots || []).find(
            (h) => h.observation_id === obsId || (h as any).id === obsId
          );
          if (found) {
            handleSelectHotspot(found);
          }
        }}
        onZoomToCoords={(lat, lon, zoom) => {
          setMapCenterCoords([lat, lon]);
          setMapZoomLevel(zoom || 14);
        }}
        onFilterChange={(filters) => {
          console.log('[App] Agent applied filters:', filters);
        }}
        onHighlightObservations={(ids) => {
          console.log('[App] Agent highlighted observations:', ids);
        }}
      />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppContent />
      </AuthGate>
    </AuthProvider>
  );
}

export default App;
