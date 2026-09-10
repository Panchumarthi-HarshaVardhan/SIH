import {
  faCheck,
  faEye,
  faFire,
  faInfoCircle,
  faMagnifyingGlass,
  faSatellite,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react';
import { FusedEvidenceResponse, SatelliteEvidence, Sentinel1Evidence } from '../types/hotspot';
import { getAssetUrl } from '../config/api';

interface SatelliteEvidenceCardProps {
  fusedEvidence?: FusedEvidenceResponse | null;
  satelliteData?: SatelliteEvidence | null;
  sentinel1Data?: Sentinel1Evidence | null;
  selectedSatellite?: string | null;
  fallbackReason?: string | null;
  observationId?: string | null;
  coordinates?: { lat: number; lon: number } | null;
  loading?: boolean;
}

export const SatelliteEvidenceCard: React.FC<SatelliteEvidenceCardProps> = ({
  fusedEvidence,
  satelliteData,
  sentinel1Data,
  selectedSatellite = 'SENTINEL_2',
  fallbackReason,
  observationId,
  coordinates,
  loading = false,
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalImageType, setModalImageType] = useState<'s2' | 's1'>('s2');
  const [showGradCam, setShowGradCam] = useState<boolean>(false);

  const sat: SatelliteEvidence | undefined = satelliteData || fusedEvidence?.evidence?.satellite || undefined;
  const s1: Sentinel1Evidence | undefined = sentinel1Data || undefined;

  const isS2Available = Boolean(sat?.image_available || sat?.available);
  const isS1Available = Boolean(s1?.available);
  const isSynthetic = Boolean((sat as any)?.synthetic || (sat as any)?.is_synthetic);

  const activeSat = selectedSatellite || (isS2Available ? 'SENTINEL_2' : (isS1Available ? 'SENTINEL_1' : 'NONE'));

  // Format UTC date cleanly
  const formatAcquisitionDate = (dateStr?: string | null): string => {
    if (!dateStr) return 'Pending Overpass';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const day = d.getUTCDate().toString().padStart(2, '0');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mon = months[d.getUTCMonth()];
        const year = d.getUTCFullYear();
        const hours = d.getUTCHours().toString().padStart(2, '0');
        const mins = d.getUTCMinutes().toString().padStart(2, '0');
        return `${day} ${mon} ${year}, ${hours}:${mins} UTC`;
      }
    } catch {
      // fallback
    }
    return dateStr;
  };

  if (loading) {
    return (
      <div className="satellite-evidence-card loading-skeleton">
        <div className="skeleton-title">
          <FontAwesomeIcon icon={faSatellite} spin className="mr-2" /> Querying Copernicus STAC Catalog (Sentinel-2 & Sentinel-1)...
        </div>
      </div>
    );
  }

  const cloudCover = sat?.cloud_cover != null ? Number(sat.cloud_cover) : (sat?.cloud_percentage != null ? Number(sat.cloud_percentage) : null);
  const rawAcqDate = sat?.satellite_acquired_at || sat?.captured_at;
  const formattedDate = formatAcquisitionDate(rawAcqDate);
  const providerName = sat?.source || 'Copernicus Data Space';
  const productName = sat?.product || 'Sentinel-2 L2A';
  const obsId = observationId || sat?.observation_id || 'N/A';
  const latVal = coordinates?.lat ?? sat?.latitude ?? 22.6789;
  const lonVal = coordinates?.lon ?? sat?.longitude ?? 80.54321;
  const s2ImageUrl = sat?.image_url ? getAssetUrl(sat.image_url) : null;
  const s1ImageUrl = s1?.image_url ? getAssetUrl(s1.image_url) : null;
  const satClass = (sat as any)?.class || (sat as any)?.class_name || (sat as any)?.candidate_class;
  const satConf = (sat as any)?.confidence;
  const satQuality = (sat as any)?.quality || (cloudCover !== null ? (cloudCover >= 70 ? 'VERY_HIGH_CLOUD' : cloudCover >= 50 ? 'HIGH_CLOUD' : cloudCover >= 30 ? 'MODERATE' : 'GOOD') : 'UNAVAILABLE');
  const temporalOffset = (sat as any)?.time_difference_hours;

  // Cloud cover category
  const getCloudCoverStatus = () => {
    if (satQuality === 'VERY_HIGH_CLOUD' || (cloudCover !== null && cloudCover >= 70)) {
      return {
        level: 'VERY_HIGH',
        label: 'VERY HIGH CLOUD COVER',
        warning: 'Dense cloud cover limits optical evidence quality. Optical evidence down-weighted.',
        badgeClass: 'cloud-badge-high',
        boxClass: 'cloud-box-high'
      };
    }
    if (satQuality === 'HIGH_CLOUD' || (cloudCover !== null && cloudCover >= 50)) {
      return {
        level: 'HIGH',
        label: 'HIGH CLOUD COVER',
        warning: 'High cloud cover limits optical visibility.',
        badgeClass: 'cloud-badge-high',
        boxClass: 'cloud-box-high'
      };
    }
    if (satQuality === 'MODERATE' || (cloudCover !== null && cloudCover >= 30)) {
      return {
        level: 'MODERATE',
        label: 'MODERATE CLOUD COVER',
        warning: 'Partial cloud obscuration possible; acceptable optical conditions.',
        badgeClass: 'cloud-badge-moderate',
        boxClass: 'cloud-box-moderate'
      };
    }
    if (cloudCover !== null) {
      return {
        level: 'LOW',
        label: 'LOW CLOUD COVER',
        warning: 'Clear optical atmospheric conditions.',
        badgeClass: 'cloud-badge-low',
        boxClass: 'cloud-box-low'
      };
    }
    return null;
  };

  const cloudStatus = getCloudCoverStatus();

  return (
    <>
      <div className="satellite-evidence-card">
        {/* CARD TOP BAR & ORCHESTRATION HEADER */}
        <div className="sat-card-header">
          <div className="sat-title-group">
            <span className="sat-icon"><FontAwesomeIcon icon={faSatellite} /></span>
            <div className="sat-title-column">
              <h4 className="sat-title-text">SATELLITE EVIDENCE ORCHESTRATION</h4>
              <span className="sat-provenance-sub">
                Copernicus Data Space Ecosystem • Sentinel-2 Primary + Sentinel-1 Backup
              </span>
            </div>
          </div>

          <div className="sat-status-badge-container">
            {activeSat === 'SENTINEL_2' && isS2Available ? (
              <span className="sat-badge-available">
                <FontAwesomeIcon icon={faCheck} className="mr-1" /> PRIMARY: SENTINEL-2 OPTICAL
              </span>
            ) : activeSat === 'SENTINEL_1' && isS1Available ? (
              <span className="sat-badge-synthetic" style={{ background: '#2e1065', color: '#c084fc', border: '1px solid #7e22ce' }}>
                <FontAwesomeIcon icon={faSatellite} className="mr-1" /> BACKUP: SENTINEL-1 SAR ACTIVE
              </span>
            ) : isSynthetic ? (
              <span className="sat-badge-synthetic">
                <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1" /> SYNTHETIC TEST DATA
              </span>
            ) : (
              <span className="sat-badge-unavailable">
                <FontAwesomeIcon icon={faXmark} className="mr-1" /> SATELLITE EVIDENCE UNAVAILABLE
              </span>
            )}
          </div>
        </div>

        {/* ORCHESTRATION SUMMARY BANNER */}
        {fallbackReason && (
          <div style={{
            margin: '0.75rem 0',
            padding: '0.6rem 0.8rem',
            background: 'rgba(126, 34, 206, 0.15)',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            borderRadius: '6px',
            fontSize: '0.85rem',
            color: '#e9d5ff'
          }}>
            <strong>Satellite Fallback Trigger:</strong> {fallbackReason}
          </div>
        )}

        {/* ===================================================================== */}
        {/* SECTION 1: SENTINEL-2 MULTISPECTRAL OPTICAL (PRIMARY) */}
        {/* ===================================================================== */}
        <div style={{ marginTop: '0.75rem', marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.85rem', background: 'rgba(12, 25, 36, 0.48)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FontAwesomeIcon icon={faEye} style={{ color: '#00B7FF' }} />
              <strong style={{ fontSize: '0.88rem', color: '#EAF6FF' }}>SENTINEL-2 OPTICAL EVIDENCE (PRIMARY)</strong>
            </div>
            <span style={{
              fontSize: '0.72rem',
              padding: '2px 8px',
              borderRadius: '4px',
              background: isS2Available ? '#EAF7ED' : '#FEE2E2',
              color: isS2Available ? '#166534' : '#991B1B',
              fontWeight: 700,
              border: isS2Available ? '1px solid #BBF7D0' : '1px solid #FECACA'
            }}>
              {isS2Available ? 'OPTICAL AVAILABLE' : ((sat as any)?.state || sat?.status || 'NO ACQUISITION')}
            </span>
          </div>

          <div className="sat-meta-grid-2x2">
            <div className="sat-meta-item">
              <span className="sat-meta-label">Optical Classification</span>
              <span className="sat-meta-val highlight-sat-class">
                {satClass ? satClass.replace('_', ' ') : 'Pending Model'}
                {satConf ? ` (${(satConf * 100).toFixed(0)}%)` : ''}
              </span>
            </div>
            <div className="sat-meta-item">
              <span className="sat-meta-label">Atmospheric Quality</span>
              <span className="sat-meta-val">
                {satQuality.replace('_', ' ')}
              </span>
            </div>
            <div className="sat-meta-item">
              <span className="sat-meta-label">Optical Acquisition</span>
              <span className="sat-meta-val">{formattedDate}</span>
            </div>
            <div className="sat-meta-item">
              <span className="sat-meta-label">Temporal Offset</span>
              <span className="sat-meta-val">
                {temporalOffset != null ? `${Math.abs(temporalOffset).toFixed(1)} hrs ${temporalOffset >= 0 ? 'after' : 'before'} FIRMS` : (cloudCover !== null ? `${cloudCover.toFixed(1)}% Cloud` : 'N/A')}
              </span>
            </div>
          </div>

          {/* CLOUD COVER WARNING BANNER */}
          {cloudStatus && (
            <div className={`sat-cloud-banner ${cloudStatus.boxClass}`} style={{ marginTop: '0.5rem' }}>
              <div className="cloud-banner-top">
                <span className={`cloud-tag ${cloudStatus.badgeClass}`}>
                  {cloudStatus.label}
                </span>
                <span className="cloud-percent-val">{cloudCover !== null ? `${cloudCover.toFixed(1)}%` : satQuality}</span>
              </div>
              <div className="cloud-banner-desc">
                {cloudStatus.warning} <span className="cloud-disclaimer">(Cloud cover limits optical evidence, but does not determine whether a fire exists)</span>
              </div>
            </div>
          )}

          {/* S2 IMAGE PREVIEW */}
          {isS2Available && s2ImageUrl ? (
            <div className="sat-image-presentation-box" style={{ marginTop: '0.75rem' }}>
              <div className="sat-image-frame">
                <img
                  src={s2ImageUrl}
                  alt="Copernicus Sentinel-2 True-Color Optical Acquisition"
                  className={`sat-optical-preview-img ${showGradCam ? 'gradcam-active' : ''}`}
                  onClick={() => { setModalImageType('s2'); setIsModalOpen(true); }}
                />
                {showGradCam && (
                  <div className="gradcam-overlay-sim">
                    <div className="gradcam-core-pulse" />
                    <span className="gradcam-tag">Thermal Focus Overlay</span>
                  </div>
                )}
              </div>

              <div className="sat-image-actions">
                <button
                  type="button"
                  className="btn-open-full-image"
                  onClick={() => { setModalImageType('s2'); setIsModalOpen(true); }}
                >
                  <FontAwesomeIcon icon={faMagnifyingGlass} className="mr-1" /> View Optical Fullscreen
                </button>
                {sat?.gradcam_overlay_path && (
                  <button
                    type="button"
                    className="btn-toggle-gradcam"
                    onClick={() => setShowGradCam(!showGradCam)}
                  >
                    <FontAwesomeIcon icon={showGradCam ? faEye : faFire} className="mr-1" /> {showGradCam ? 'Raw Optical' : 'Focus Heatmap'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="sat-unavailable-presentation-box" style={{ marginTop: '0.65rem', padding: '1rem' }}>
              <div className="unavail-icon"><FontAwesomeIcon icon={faSatellite} /></div>
              <div className="unavail-title" style={{ fontSize: '0.85rem' }}>OPTICAL IMAGERY UNAVAILABLE</div>
              <p className="unavail-message" style={{ fontSize: '0.78rem' }}>
                {sat?.error_message || sat?.visual_evidence || 'No suitable Sentinel-2 acquisition was found for this observation.'}
              </p>
            </div>
          )}
        </div>

        {/* ===================================================================== */}
        {/* SECTION 2: SENTINEL-1 SAR RADAR EVIDENCE (BACKUP) */}
        {/* ===================================================================== */}
        <div style={{
          marginBottom: '1rem',
          border: isS1Available ? '1px solid #7e22ce' : '1px solid #334155',
          borderRadius: '8px',
          padding: '0.75rem',
          background: isS1Available ? 'rgba(46, 16, 101, 0.25)' : 'rgba(15, 23, 42, 0.4)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FontAwesomeIcon icon={faSatellite} style={{ color: '#a855f7' }} />
              <strong style={{ fontSize: '0.9rem', color: '#f8fafc' }}>SENTINEL-1 SAR RADAR EVIDENCE (BACKUP)</strong>
            </div>
            <span style={{
              fontSize: '0.75rem',
              padding: '2px 8px',
              borderRadius: '4px',
              background: isS1Available ? '#581c87' : (s1?.state === 'S1_NOT_QUERIED' ? '#1e293b' : '#7f1d1d'),
              color: isS1Available ? '#e9d5ff' : (s1?.state === 'S1_NOT_QUERIED' ? '#94a3b8' : '#fca5a5'),
              fontWeight: 600
            }}>
              {isS1Available ? 'SAR BACKUP AVAILABLE' : (s1?.state || 'NOT QUERIED')}
            </span>
          </div>

          {s1?.state === 'S1_NOT_QUERIED' ? (
            <div style={{
              padding: '0.6rem 0.8rem',
              background: 'rgba(30, 41, 59, 0.5)',
              borderRadius: '6px',
              fontSize: '0.82rem',
              color: '#94a3b8',
              lineHeight: '1.4'
            }}>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>Not Queried: </span>
              {s1.reason_not_queried || 'Sentinel-2 optical conditions acceptable (<50% cloud cover). Sentinel-1 is only queried when optical evidence is degraded or unavailable.'}
            </div>
          ) : isS1Available ? (
            <>
              <div className="sat-meta-grid-2x2" style={{ marginTop: '0.5rem' }}>
                <div className="sat-meta-item">
                  <span className="sat-meta-label">SAR Polarization</span>
                  <span className="sat-meta-val" style={{ color: '#c084fc', fontWeight: 600 }}>
                    {Array.isArray(s1?.polarization) ? s1.polarization.join(', ') : (s1?.polarization || 'VV, VH')}
                  </span>
                </div>
                <div className="sat-meta-item">
                  <span className="sat-meta-label">Acquisition Mode & Orbit</span>
                  <span className="sat-meta-val">
                    {s1?.acquisition_mode || 'IW'} • {s1?.orbit_direction || 'Descending'}
                  </span>
                </div>
                <div className="sat-meta-item">
                  <span className="sat-meta-label">SAR Acquisition</span>
                  <span className="sat-meta-val">{formatAcquisitionDate(s1?.satellite_acquired_at)}</span>
                </div>
                <div className="sat-meta-item">
                  <span className="sat-meta-label">Cloud Capability</span>
                  <span className="sat-meta-val" style={{ color: '#34d399' }}>
                    All-Weather (Penetrates Clouds)
                  </span>
                </div>
              </div>

              {s1ImageUrl && (
                <div className="sat-image-presentation-box" style={{ marginTop: '0.75rem' }}>
                  <div className="sat-image-frame">
                    <img
                      src={s1ImageUrl}
                      alt="Copernicus Sentinel-1 SAR Radar Raster"
                      className="sat-optical-preview-img"
                      onClick={() => { setModalImageType('s1'); setIsModalOpen(true); }}
                    />
                  </div>
                  <div className="sat-image-actions">
                    <button
                      type="button"
                      className="btn-open-full-image"
                      style={{ background: '#581c87', borderColor: '#9333ea' }}
                      onClick={() => { setModalImageType('s1'); setIsModalOpen(true); }}
                    >
                      View SAR Radar Fullscreen
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="sat-unavailable-presentation-box" style={{ marginTop: '0.5rem', padding: '0.75rem' }}>
              <div className="unavail-title" style={{ fontSize: '0.85rem' }}>SAR RADAR BACKUP UNAVAILABLE</div>
              <p className="unavail-message" style={{ fontSize: '0.8rem' }}>
                {s1?.reason_not_queried || 'No Sentinel-1 GRD acquisition intersected the AOI during the temporal search window.'}
              </p>
            </div>
          )}
        </div>

        {/* EDUCATIONAL EVIDENCE DISTINCTION & MANDATORY DISCLAIMERS */}
        <div className="sat-distinction-footer">
          <div className="distinction-badges-row">
            <span className="distinction-pill pill-optical">Sentinel-2 Optical (Primary)</span>
            <span className="distinction-pill" style={{ background: '#3b0764', color: '#d8b4fe', borderColor: '#7e22ce' }}>Sentinel-1 SAR Radar (Backup)</span>
            <span className="distinction-pill pill-not-thermal">Neither measures fire temperature</span>
          </div>
          <div className="distinction-expl-text" style={{ lineHeight: '1.45', marginTop: '0.4rem' }}>
            <FontAwesomeIcon icon={faInfoCircle} className="mr-1 text-green" /> <strong>NASA FIRMS</strong> provides thermal anomaly detection. <strong>Sentinel-2</strong> provides optical multispectral evidence. <strong>Sentinel-1</strong> is SAR radar evidence that provides cloud-independent surface information; it does not measure fire temperature.
          </div>
        </div>
      </div>

      {/* LIGHTBOX / FULL IMAGE MODAL */}
      {isModalOpen && (
        <div className="sat-lightbox-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="sat-lightbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-header">
              <div className="lightbox-title-group">
                <span className="lightbox-icon"><FontAwesomeIcon icon={faSatellite} /></span>
                <div>
                  <h3 className="lightbox-title">
                    {modalImageType === 's1' ? 'SENTINEL-1 SAR RADAR BACKUP EVIDENCE' : 'SENTINEL-2 OPTICAL EVIDENCE'}
                  </h3>
                  <span className="lightbox-subtitle">
                    {modalImageType === 's1' ? 'Copernicus Sentinel-1 GRD • All-Weather Radar' : `${providerName} • ${productName}`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="lightbox-close-btn"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close modal"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="lightbox-body">
              <div className="lightbox-image-container">
                <img
                  src={modalImageType === 's1' ? (s1ImageUrl || '') : (s2ImageUrl || '')}
                  alt={modalImageType === 's1' ? 'Sentinel-1 SAR Radar Raster' : 'Full-resolution Sentinel-2 Optical Raster'}
                  className="lightbox-image"
                />
              </div>

              <div className="lightbox-details-panel">
                <h4 className="details-header">Acquisition Provenance & Sensor Science</h4>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Observation ID</span>
                    <strong className="detail-val detail-mono">{obsId}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Coordinates</span>
                    <strong className="detail-val detail-mono">
                      {latVal.toFixed(4)}°N, {lonVal.toFixed(4)}°E
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Sensor / Band</span>
                    <strong className="detail-val">
                      {modalImageType === 's1' ? 'C-band Synthetic Aperture Radar (SAR)' : 'MSI Multi-Spectral Optical'}
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Overpass Acquisition</span>
                    <strong className="detail-val">
                      {modalImageType === 's1' ? formatAcquisitionDate(s1?.satellite_acquired_at) : formattedDate}
                    </strong>
                  </div>
                </div>

                {modalImageType === 's2' && cloudStatus && cloudStatus.level === 'HIGH' && (
                  <div className="lightbox-cloud-alert">
                    <FontAwesomeIcon icon={faTriangleExclamation} /> <strong>HIGH CLOUD COVER ({cloudCover?.toFixed(1)}%):</strong> {cloudStatus.warning} Visual optical features may be obscured.
                  </div>
                )}

                <div className="lightbox-disclaimer-box" style={{ marginTop: '1rem' }}>
                  <strong><FontAwesomeIcon icon={faInfoCircle} className="mr-1 text-green" /> Critical Sensor Distinction:</strong>
                  <p>
                    {modalImageType === 's1'
                      ? 'Sentinel-1 transmits active C-band microwaves that penetrate clouds, haze, and smoke to measure surface roughness and structural backscatter. It does NOT detect radiant thermal heat or fire temperature. Thermal detection is measured independently by NASA FIRMS.'
                      : 'Sentinel-2 passively captures reflected sunlight across 12 optical bands during daylight passes. It provides multispectral surface context and burn vegetation scars. It is NOT a real-time thermal fire camera.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="lightbox-footer">
              <span className="lightbox-source-tag">Copernicus Data Space Ecosystem</span>
              <button
                type="button"
                className="btn-lightbox-close"
                onClick={() => setIsModalOpen(false)}
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
