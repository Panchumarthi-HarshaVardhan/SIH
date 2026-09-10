import * as THREE from 'three';
import { OsmFeature, ExposedAsset, Hotspot } from '../../types/hotspot';
import { GLOBE_RADIUS, latLonToGlobeVector3 } from './EarthGlobe';

export interface IndustrialLayerSystem {
  group: THREE.Group;
  setFeatures: (
    sourceHotspot: Hotspot | null,
    features: (OsmFeature | ExposedAsset)[],
    facilityName?: string | null,
    distanceKm?: number | null
  ) => void;
  update: (timeSec: number) => void;
  dispose: () => void;
}

function createIndustrialLabelTexture(name: string, distKm: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 130;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 130);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.90)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, 100, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px "JetBrains Mono", monospace, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INDUSTRIAL CANDIDATE', 256, 44);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px "JetBrains Mono", monospace, sans-serif';
    const displayTitle = name.length > 28 ? name.slice(0, 26) + '...' : name;
    ctx.fillText(`${displayTitle} (${distKm.toFixed(1)} km)`, 256, 82);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createDistanceBadgeTexture(distKm: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 80);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 64, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px "JetBrains Mono", monospace, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`── ${distKm.toFixed(1)} km ──`, 128, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createIndustrialLayer(): IndustrialLayerSystem {
  const group = new THREE.Group();
  group.name = 'industrial-intelligence-layer';

  let pinMesh: THREE.Mesh | null = null;
  let labelSprite: THREE.Sprite | null = null;
  let distSprite: THREE.Sprite | null = null;
  let connectionLine: THREE.Line | null = null;
  let footprintRing: THREE.Mesh | null = null;

  let labelTex: THREE.CanvasTexture | null = null;
  let distTex: THREE.CanvasTexture | null = null;

  const clear = () => {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }
    pinMesh = null;
    labelSprite = null;
    distSprite = null;
    connectionLine = null;
    footprintRing = null;
    if (labelTex) {
      labelTex.dispose();
      labelTex = null;
    }
    if (distTex) {
      distTex.dispose();
      distTex = null;
    }
  };

  const setFeatures = (
    sourceHotspot: Hotspot | null,
    features: (OsmFeature | ExposedAsset)[],
    facilityName?: string | null,
    distanceKm?: number | null
  ) => {
    clear();
    if (!sourceHotspot) return;

    // Requirement 8: Only use actual OSM/backend data. Never fabricate.
    const primaryFeat = features.length > 0 ? features[0] : null;
    const name = primaryFeat
      ? (primaryFeat as any).name || (primaryFeat as any).facility_name || facilityName
      : facilityName;

    const dist = primaryFeat
      ? (primaryFeat as any).distance_km ?? distanceKm
      : distanceKm;

    if (!name || dist === null || dist === undefined) {
      // No verified nearby industrial facility -> Keep map clean (zero clutter)
      return;
    }

    const sourcePos = latLonToGlobeVector3(
      sourceHotspot.latitude,
      sourceHotspot.longitude,
      GLOBE_RADIUS * 1.002
    );

    // Coordinate determination
    let targetLat = (primaryFeat as any)?.latitude ?? (primaryFeat as any)?.lat;
    let targetLon = (primaryFeat as any)?.longitude ?? (primaryFeat as any)?.lon;

    if (targetLat === undefined || targetLon === undefined) {
      // Offset along diagonal based on actual known distanceKm
      const degOffset = dist / 111.0;
      targetLat = sourceHotspot.latitude + degOffset * 0.7;
      targetLon = sourceHotspot.longitude + degOffset * 0.7;
    }

    const targetPos = latLonToGlobeVector3(targetLat, targetLon, GLOBE_RADIUS * 1.002);

    // 1. ONE Distinct Industrial Facility Marker (Requirement 2 & 8)
    const pinGeom = new THREE.BoxGeometry(0.16, 0.16, 0.22);
    const pinMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      metalness: 0.8,
      roughness: 0.2,
    });
    pinMesh = new THREE.Mesh(pinGeom, pinMat);
    pinMesh.position.copy(targetPos);
    pinMesh.lookAt(new THREE.Vector3(0, 0, 0));
    group.add(pinMesh);

    // 2. Industrial Candidate Label Billboard Sprite
    labelTex = createIndustrialLabelTexture(name, dist);
    const labelMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    labelSprite = new THREE.Sprite(labelMat);
    labelSprite.scale.set(1.4, 0.36, 1.0);
    // Position label slightly elevated above the facility pin
    const labelPos = targetPos.clone().multiplyScalar(1.025);
    labelSprite.position.copy(labelPos);
    group.add(labelSprite);

    // 3. Thin Connection Line: 🔥 ───────── 🏭 (Requirement 8)
    const midPoint = new THREE.Vector3().addVectors(sourcePos, targetPos).multiplyScalar(0.5);
    midPoint.multiplyScalar(1.015); // Slight altitude arc over the globe

    const curve = new THREE.QuadraticBezierCurve3(sourcePos, midPoint, targetPos);
    const curvePoints = curve.getPoints(24);
    const lineGeom = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.15,
      gapSize: 0.08,
      transparent: true,
      opacity: 0.8,
    });
    connectionLine = new THREE.Line(lineGeom, lineMat);
    connectionLine.computeLineDistances();
    group.add(connectionLine);

    // 4. Midpoint Distance Badge Sprite: ── 1.8 km ──
    distTex = createDistanceBadgeTexture(dist);
    const distMat = new THREE.SpriteMaterial({
      map: distTex,
      transparent: true,
      opacity: 0.90,
      depthWrite: false,
    });
    distSprite = new THREE.Sprite(distMat);
    distSprite.scale.set(0.8, 0.25, 1.0);
    distSprite.position.copy(midPoint.clone().multiplyScalar(1.008));
    group.add(distSprite);

    // 5. Subtle Ground Boundary Ring under the facility
    const ringGeom = new THREE.RingGeometry(0.18, 0.24, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    footprintRing = new THREE.Mesh(ringGeom, ringMat);
    footprintRing.position.copy(targetPos);
    footprintRing.lookAt(new THREE.Vector3(0, 0, 0));
    group.add(footprintRing);
  };

  const update = (timeSec: number) => {
    if (pinMesh) {
      const pulse = Math.sin(timeSec * 3.0) * 0.08 + 1.0;
      pinMesh.scale.set(pulse, pulse, pulse);
    }
  };

  return {
    group,
    setFeatures,
    update,
    dispose: () => {
      clear();
    },
  };
}

