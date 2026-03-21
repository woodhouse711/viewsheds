import { useEffect, useRef, useCallback } from 'react';

const ACCENT = '#46BAB4';
const ISLAND_COLOR = 'rgba(70,230,220,0.9)';
const BG = '#080c10';
const GRID_COLOR = 'rgba(255,255,255,0.06)';
const LABEL_COLOR = '#556070';
const TEXT_COLOR = '#d0d4dc';

const CARDINAL = [
  { label: 'N', az: 0 },
  { label: 'E', az: 90 },
  { label: 'S', az: 180 },
  { label: 'W', az: 270 },
];

export default function PolarDiagram({ viewshedResult, hoveredAz, onHoverAz }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const padL = 48;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (!viewshedResult || !viewshedResult.rays || viewshedResult.rays.length === 0) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Click map to compute viewshed', W / 2, H / 2);
      return;
    }

    const { rays } = viewshedResult;

    // Elevation range
    let minElev = Infinity;
    let maxElev = -Infinity;
    rays.forEach((r) => {
      r.samples.forEach((s) => {
        if (s.angleDeg < minElev) minElev = s.angleDeg;
        if (s.angleDeg > maxElev) maxElev = s.angleDeg;
      });
    });
    // Add some padding
    const elevRange = maxElev - minElev || 1;
    const elevMin = minElev - elevRange * 0.1;
    const elevMax = maxElev + elevRange * 0.15;

    const azToX = (az) => padL + (az / 360) * plotW;
    const elevToY = (e) => padT + plotH - ((e - elevMin) / (elevMax - elevMin)) * plotH;

    // Grid lines — elevation
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    const elevStep = elevRange > 20 ? 10 : elevRange > 5 ? 5 : 1;
    for (
      let e = Math.ceil(elevMin / elevStep) * elevStep;
      e <= elevMax;
      e += elevStep
    ) {
      const y = elevToY(e);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${e.toFixed(0)}°`, padL - 4, y + 3);
    }

    // Zero line
    if (elevMin <= 0 && elevMax >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const y0 = elevToY(0);
      ctx.beginPath();
      ctx.moveTo(padL, y0);
      ctx.lineTo(W - padR, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cardinal azimuth lines
    CARDINAL.forEach(({ label, az }) => {
      const x = azToX(az);
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, padT + plotH + 18);
    });

    // Azimuth tick labels
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = '9px monospace';
    for (let az = 0; az <= 360; az += 45) {
      const x = azToX(az);
      ctx.textAlign = 'center';
      ctx.fillText(`${az}°`, x, padT + plotH + 28);
    }

    // Plot all samples
    const maxDist = Math.max(...rays.map((r) => r.horizonDist || 0));

    rays.forEach((ray) => {
      ray.samples.forEach((s) => {
        const x = azToX(ray.azDeg);
        const y = elevToY(s.angleDeg);
        const alpha = 0.15 + 0.5 * (1 - s.distKm / (maxDist || 1));

        if (s.isIsland) {
          ctx.fillStyle = `rgba(70,230,220,${alpha})`;
        } else if (s.visible) {
          ctx.fillStyle = `rgba(70,186,180,${alpha})`;
        } else {
          ctx.fillStyle = `rgba(70,100,100,${Math.max(0.05, alpha * 0.4)})`;
        }
        ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
      });
    });

    // Skyline — max visible angle per azimuth
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    rays.forEach((ray) => {
      const x = azToX(ray.azDeg);
      const y = elevToY(ray.maxAngleDeg ?? 0);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    // Close back to first
    if (rays.length > 0) {
      const x0 = azToX(0);
      ctx.lineTo(azToX(360), elevToY(rays[0].maxAngleDeg ?? 0));
    }
    ctx.stroke();

    // Hover ray highlight
    if (hoveredAz !== null && hoveredAz !== undefined) {
      const x = azToX(hoveredAz);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axes borders
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, plotW, plotH);

    // Y-axis label
    ctx.save();
    ctx.translate(12, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Elevation angle (°)', 0, 0);
    ctx.restore();
  }, [viewshedResult, hoveredAz]);

  // Redraw when props change
  useEffect(() => {
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(draw);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Mouse move for hover
  const handleMouseMove = useCallback(
    (e) => {
      if (!viewshedResult) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const padL = 48;
      const padR = 16;
      const plotW = rect.width - padL - padR;
      const x = e.clientX - rect.left - padL;
      const az = Math.max(0, Math.min(360, (x / plotW) * 360));
      onHoverAz && onHoverAz(az);
    },
    [viewshedResult, onHoverAz]
  );

  const handleMouseLeave = useCallback(() => {
    onHoverAz && onHoverAz(null);
  }, [onHoverAz]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}
