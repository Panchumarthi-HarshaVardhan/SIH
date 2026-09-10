import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faFire,
  faSatellite,
  faArrowsRotate,
  faIndustry,
} from '@fortawesome/free-solid-svg-icons';

/**
 * InvestigationSkeleton Component
 * Provides a professional, content-matching skeleton placeholder for the Incident Investigation drawer.
 * Renders animated shimmer blocks mimicking the AI fusion card, Sentinel-2 multispectral evidence card,
 * FIRMS thermal metrics, and supporting persistence / OSM cards.
 */
export const InvestigationSkeleton: React.FC = () => {
  return (
    <div className="investigation-skeleton-container" role="status" aria-label="Loading incident investigation evidence">
      {/* 1. AI Candidate Classification Card Skeleton */}
      <div className="investigation-section fusion-highlight-section skeleton-card">
        <div className="section-header">
          <span className="section-number"><FontAwesomeIcon icon={faRobot} /></span>
          <span className="skeleton-line skeleton-title-line" style={{ width: '220px' }} />
          <span className="skeleton-pill" style={{ width: '110px' }} />
        </div>
        <div className="fusion-card-body">
          <div className="fusion-primary-grid">
            <div className="fusion-candidate-box skeleton-pulse-box">
              <span className="skeleton-line" style={{ width: '130px', height: '12px' }} />
              <div className="skeleton-line skeleton-large-title" style={{ width: '70%', height: '28px', margin: '8px 0' }} />
              <span className="skeleton-line" style={{ width: '180px', height: '12px' }} />
            </div>
            <div className="fusion-score-box skeleton-pulse-box">
              <span className="skeleton-line" style={{ width: '120px', height: '12px' }} />
              <div className="skeleton-line" style={{ width: '80px', height: '32px', margin: '6px auto' }} />
              <div className="skeleton-bar-track">
                <div className="skeleton-bar-fill" />
              </div>
            </div>
          </div>
          {/* Contributing factors row */}
          <div className="fusion-contributors-row" style={{ marginTop: '1rem' }}>
            <div className="contributor-item skeleton-pill-item"><span className="skeleton-line" style={{ width: '90px' }} /></div>
            <div className="contributor-item skeleton-pill-item"><span className="skeleton-line" style={{ width: '90px' }} /></div>
            <div className="contributor-item skeleton-pill-item"><span className="skeleton-line" style={{ width: '100px' }} /></div>
            <div className="contributor-item skeleton-pill-item"><span className="skeleton-line" style={{ width: '110px' }} /></div>
          </div>
          {/* Reasoning lines */}
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(0,0,0,0.02)', borderRadius: '6px' }}>
            <div className="skeleton-line" style={{ width: '160px', height: '14px', marginBottom: '8px' }} />
            <div className="skeleton-line" style={{ width: '90%', height: '12px', marginBottom: '6px' }} />
            <div className="skeleton-line" style={{ width: '75%', height: '12px' }} />
          </div>
        </div>
      </div>

      {/* 1b. Location Context Assessment Card Skeleton */}
      <div className="investigation-section skeleton-card" style={{ borderLeft: '3px solid rgba(245, 158, 11, 0.4)' }}>
        <div className="section-header">
          <span className="section-number"><FontAwesomeIcon icon={faIndustry} /></span>
          <span className="skeleton-line skeleton-title-line" style={{ width: '250px' }} />
          <span className="skeleton-pill" style={{ width: '140px' }} />
        </div>
        <div style={{ padding: '0.5rem 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
            <div className="info-box skeleton-pulse-box">
              <div className="skeleton-line" style={{ width: '110px', height: '10px' }} />
              <div className="skeleton-line" style={{ width: '160px', height: '18px', marginTop: '6px' }} />
            </div>
            <div className="info-box skeleton-pulse-box">
              <div className="skeleton-line" style={{ width: '100px', height: '10px' }} />
              <div className="skeleton-line" style={{ width: '140px', height: '18px', marginTop: '6px' }} />
            </div>
          </div>
          {/* Nearby feature row skeletons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="skeleton-line" style={{ width: '100%', height: '28px', borderRadius: '4px' }} />
            <div className="skeleton-line" style={{ width: '100%', height: '28px', borderRadius: '4px' }} />
          </div>
        </div>
      </div>

      {/* 2. Sentinel-2 Multispectral Evidence Card Skeleton */}
      <div className="investigation-section skeleton-card">
        <div className="section-header">
          <span className="section-number"><FontAwesomeIcon icon={faSatellite} /></span>
          <span className="skeleton-line skeleton-title-line" style={{ width: '280px' }} />
          <span className="skeleton-pill" style={{ width: '120px' }} />
        </div>
        <div className="satellite-card-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', gap: '1.25rem', marginTop: '1rem' }}>
          {/* Left: Image preview placeholder with shimmer */}
          <div className="skeleton-img-placeholder" style={{ minHeight: '180px', borderRadius: '8px' }}>
            <div className="skeleton-img-icon"><FontAwesomeIcon icon={faSatellite} /></div>
            <div className="skeleton-line" style={{ width: '110px', height: '10px' }} />
          </div>
          {/* Right: Metrics & band chips */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div className="section-grid-3" style={{ gap: '0.75rem' }}>
              <div className="info-box skeleton-pulse-box"><div className="skeleton-line" style={{ width: '60px', height: '10px' }} /><div className="skeleton-line" style={{ width: '80px', height: '18px', marginTop: '6px' }} /></div>
              <div className="info-box skeleton-pulse-box"><div className="skeleton-line" style={{ width: '70px', height: '10px' }} /><div className="skeleton-line" style={{ width: '90px', height: '18px', marginTop: '6px' }} /></div>
              <div className="info-box skeleton-pulse-box"><div className="skeleton-line" style={{ width: '65px', height: '10px' }} /><div className="skeleton-line" style={{ width: '75px', height: '18px', marginTop: '6px' }} /></div>
            </div>
            {/* Spectral band chips */}
            <div>
              <div className="skeleton-line" style={{ width: '150px', height: '11px', marginBottom: '8px' }} />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {['B02 (Blue)', 'B03 (Green)', 'B04 (Red)', 'B08 (NIR)', 'B11 (SWIR-1)', 'B12 (SWIR-2)'].map((b) => (
                  <span key={b} className="skeleton-pill" style={{ width: '84px', height: '22px' }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. NASA FIRMS Thermal Detection Card Skeleton */}
      <div className="investigation-section skeleton-card">
        <div className="section-header">
          <span className="section-number"><FontAwesomeIcon icon={faFire} /></span>
          <span className="skeleton-line skeleton-title-line" style={{ width: '320px' }} />
          <span className="skeleton-pill" style={{ width: '90px' }} />
        </div>
        <div className="section-grid-3" style={{ marginTop: '1rem' }}>
          <div className="info-box skeleton-pulse-box"><div className="skeleton-line" style={{ width: '100px', height: '10px' }} /><div className="skeleton-line" style={{ width: '70px', height: '24px', marginTop: '8px' }} /></div>
          <div className="info-box skeleton-pulse-box"><div className="skeleton-line" style={{ width: '90px', height: '10px' }} /><div className="skeleton-line" style={{ width: '80px', height: '24px', marginTop: '8px' }} /></div>
          <div className="info-box skeleton-pulse-box"><div className="skeleton-line" style={{ width: '110px', height: '10px' }} /><div className="skeleton-line" style={{ width: '60px', height: '24px', marginTop: '8px' }} /></div>
        </div>
        <div className="info-details-row" style={{ marginTop: '0.75rem' }}>
          <div className="skeleton-line" style={{ width: '180px', height: '12px' }} />
          <div className="skeleton-line" style={{ width: '150px', height: '12px' }} />
          <div className="skeleton-line" style={{ width: '200px', height: '12px' }} />
        </div>
      </div>

      {/* 4. Supporting Evidence Grid (OSM & Persistence) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="investigation-section skeleton-card" style={{ margin: 0 }}>
          <div className="section-header">
            <span className="section-number"><FontAwesomeIcon icon={faArrowsRotate} /></span>
            <span className="skeleton-line skeleton-title-line" style={{ width: '140px' }} />
          </div>
          <div style={{ padding: '0.75rem 0' }}>
            <div className="skeleton-line" style={{ width: '60%', height: '16px', marginBottom: '8px' }} />
            <div className="skeleton-line" style={{ width: '80%', height: '12px' }} />
          </div>
        </div>

        <div className="investigation-section skeleton-card" style={{ margin: 0 }}>
          <div className="section-header">
            <span className="section-number"><FontAwesomeIcon icon={faIndustry} /></span>
            <span className="skeleton-line skeleton-title-line" style={{ width: '160px' }} />
          </div>
          <div style={{ padding: '0.75rem 0' }}>
            <div className="skeleton-line" style={{ width: '70%', height: '16px', marginBottom: '8px' }} />
            <div className="skeleton-line" style={{ width: '85%', height: '12px' }} />
          </div>
        </div>
      </div>
    </div>
  );
};
