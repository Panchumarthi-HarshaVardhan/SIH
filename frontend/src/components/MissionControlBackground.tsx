import React, { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  size: number;
  baseAlpha: number;
  alpha: number;
  twinkleSpeed: number;
  layer: number; // 0 = far/faint, 1 = mid, 2 = near/bright
}

export const MissionControlBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      initStars();
    };

    window.addEventListener('resize', handleResize);

    const starCount = Math.min(260, Math.floor((width * height) / 7500));
    let stars: Star[] = [];

    const initStars = () => {
      stars = [];
      for (let i = 0; i < starCount; i++) {
        const layer = Math.random() < 0.65 ? 0 : Math.random() < 0.85 ? 1 : 2;
        const size = layer === 0 ? 0.65 : layer === 1 ? 1.0 : 1.4;
        const baseAlpha = layer === 0 ? 0.25 + Math.random() * 0.2 : layer === 1 ? 0.45 + Math.random() * 0.25 : 0.7 + Math.random() * 0.25;

        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size,
          baseAlpha,
          alpha: baseAlpha,
          twinkleSpeed: 0.003 + Math.random() * 0.008,
          layer,
        });
      }
    };

    initStars();

    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      // Atmospheric daylight tropospheric base gradient
      const grad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.15,
        80,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85
      );
      grad.addColorStop(0, '#FAFCFE');
      grad.addColorStop(0.45, '#EEF4FA');
      grad.addColorStop(1, '#E2EBF5');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Subtle cyan-tinted atmospheric haze in upper sector
      const hazeGrad = ctx.createRadialGradient(
        width * 0.75,
        height * 0.15,
        50,
        width * 0.75,
        height * 0.15,
        width * 0.45
      );
      hazeGrad.addColorStop(0, 'rgba(14, 165, 233, 0.045)');
      hazeGrad.addColorStop(0.6, 'rgba(2, 132, 199, 0.015)');
      hazeGrad.addColorStop(1, 'rgba(240, 246, 252, 0)');
      ctx.fillStyle = hazeGrad;
      ctx.fillRect(0, 0, width, height);

      // Render drifting atmospheric particles / telemetry motes
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];

        // Layer drift velocities (extremely slow, calm drift)
        const speed = s.layer === 0 ? 1.0 : s.layer === 1 ? 2.0 : 3.2;
        s.y -= speed * dt;
        s.x += speed * 0.25 * dt;

        if (s.y < -5) s.y = height + 5;
        if (s.x > width + 5) s.x = -5;

        // Subtle twinkling
        s.alpha = s.baseAlpha + Math.sin(time * s.twinkleSpeed + i) * 0.15;
        const boundedAlpha = Math.max(0.1, Math.min(0.9, s.alpha));

        // Soft atmospheric mote point
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        if (s.layer === 2) {
          ctx.fillStyle = `rgba(2, 132, 199, ${boundedAlpha * 0.45})`;
          ctx.shadowBlur = 3;
          ctx.shadowColor = 'rgba(2, 132, 199, 0.25)';
        } else if (s.layer === 1) {
          ctx.fillStyle = `rgba(14, 165, 233, ${boundedAlpha * 0.35})`;
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = `rgba(148, 163, 184, ${boundedAlpha * 0.28})`;
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      animFrameId = requestAnimationFrame(render);
    };

    animFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="mission-control-bg-canvas"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};
export default MissionControlBackground;
