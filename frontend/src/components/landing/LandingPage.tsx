import React, { useEffect, useRef, useState, useCallback } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SpaceSceneController } from './SpaceSceneController';
import { CinematicHUD } from './CinematicHUD';
import { LandingNav } from './LandingNav';
import { HotspotTelemetryItem } from '../../types/hotspot';

gsap.registerPlugin(ScrollTrigger);

interface LandingPageProps {
  onLaunchDashboard: () => void;
  onSelectHotspotForInvestigation?: (hotspot: HotspotTelemetryItem) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onLaunchDashboard,
  onSelectHotspotForInvestigation,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpaceSceneController | null>(null);
  const lenisRef = useRef<Lenis | null>(null);

  // States
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [activeHotspot, setActiveHotspot] = useState<HotspotTelemetryItem | null>(null);
  const [loadingPercent, setLoadingPercent] = useState<number>(0);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Initialize Three.js Space Controller
  useEffect(() => {
    if (!mountRef.current) return;

    const controller = new SpaceSceneController({
      container: mountRef.current,
      onProgress: (percent) => {
        setLoadingPercent((prev) => Math.max(prev, percent));
        if (percent >= 100) {
          setTimeout(() => setIsLoaded(true), 600);
        }
      },
      onHotspotHover: (spot) => {
        if (spot) setActiveHotspot(spot);
      },
      onHotspotSelect: (spot) => {
        if (spot) {
          setActiveHotspot(spot);
          if (onSelectHotspotForInvestigation) {
            onSelectHotspotForInvestigation(spot);
          }
        }
      },
    });

    controllerRef.current = controller;

    // Safety fallback: if texture loader takes too long, dismiss loader after 3.5s
    const fallbackTimer = setTimeout(() => {
      setIsLoaded(true);
    }, 3500);

    return () => {
      clearTimeout(fallbackTimer);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [onSelectHotspotForInvestigation]);

  // Initialize Lenis & GSAP ScrollTrigger
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    lenisRef.current = lenis;

    lenis.on('scroll', ScrollTrigger.update);

    const tickerCb = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tickerCb);
    gsap.ticker.lagSmoothing(0);

    // Create ScrollTrigger on virtual scroll track
    const trigger = ScrollTrigger.create({
      trigger: scrollContainerRef.current,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.8,
      onUpdate: (self: { progress: number }) => {
        const p = self.progress;
        setScrollProgress(p);
        if (controllerRef.current) {
          controllerRef.current.setScrollProgress(p);
        }
      },
    });

    return () => {
      trigger.kill();
      gsap.ticker.remove(tickerCb);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  const handleScrollToSection = useCallback((sectionKey: 'space' | 'orbit' | 'india' | 'hotspots' | 'pipeline' | 'final') => {
    if (!lenisRef.current || !scrollContainerRef.current) return;

    const targetProgressMap = {
      space: 0.0,
      orbit: 0.30,
      india: 0.56,
      hotspots: 0.77,
      pipeline: 0.88,
      final: 0.98,
    };

    const targetP = targetProgressMap[sectionKey];
    const totalScroll = scrollContainerRef.current.scrollHeight - window.innerHeight;
    const targetScrollY = targetP * totalScroll;

    lenisRef.current.scrollTo(targetScrollY, { duration: 1.4 });
  }, []);

  const handleExploreHotspots = useCallback(() => {
    handleScrollToSection('hotspots');
  }, [handleScrollToSection]);

  const handleSelectHotspot = useCallback((spot: HotspotTelemetryItem) => {
    if (onSelectHotspotForInvestigation) {
      onSelectHotspotForInvestigation(spot);
    } else {
      onLaunchDashboard();
    }
  }, [onSelectHotspotForInvestigation, onLaunchDashboard]);

  return (
    <div className="landing-page-root">
      {/* 1. MINIMAL SCIENTIFIC LOADING SCREEN */}
      {!isLoaded && (
        <div className={`landing-loading-overlay ${loadingPercent >= 100 ? 'fade-out' : ''}`}>
          <div className="loading-content">
            <div className="loading-eyebrow">NASA FIRMS // SENTINEL-2 // OSM</div>
            <h2 className="loading-title">INITIALIZING EARTH OBSERVATION</h2>
            <div className="loading-bar-track">
              <div
                className="loading-bar-fill"
                style={{ width: `${Math.max(loadingPercent, 18)}%` }}
              />
            </div>
            <div className="loading-telemetry-row">
              <span>TARGET: IND_SUB</span>
              <span>CALIBRATING SENSORS...</span>
              <span>{Math.max(loadingPercent, 18)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. MINIMAL FIXED NAVIGATION */}
      <LandingNav
        onLaunchDashboard={onLaunchDashboard}
        onScrollToSection={handleScrollToSection}
      />

      {/* 3. FIXED THREE.JS 3D CINEMATIC VIEWPORT */}
      <div className="cinematic-viewport">
        <div className="landing-canvas-viewport" ref={mountRef} />
      </div>

      {/* 4. FLOATING SCIENTIFIC TELEMETRY HUD OVERLAY */}
      <CinematicHUD
        scrollProgress={scrollProgress}
        activeHotspot={activeHotspot}
        onSelectHotspot={handleSelectHotspot}
        onLaunchDashboard={onLaunchDashboard}
        onExploreHotspots={handleExploreHotspots}
      />

      {/* 5. VIRTUAL SCROLL TRACK CONTAINER (Drives GSAP ScrollTrigger) */}
      <div className="landing-scroll-track" ref={scrollContainerRef}>
        <div className="scroll-act-trigger" data-act="space" />
        <div className="scroll-act-trigger" data-act="orbit" />
        <div className="scroll-act-trigger" data-act="india" />
        <div className="scroll-act-trigger" data-act="hotspots" />
        <div className="scroll-act-trigger" data-act="pipeline" />
        <div className="scroll-act-trigger" data-act="final" />
      </div>
    </div>
  );
};
