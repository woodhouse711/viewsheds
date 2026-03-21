import { useEffect, useRef, useCallback, useState } from 'react';

const ACCENT = '#46BAB4';
const BG = '#080c10';
const GRID_COLOR = 'rgba(255,255,255,0.06)';
const LABEL_COLOR = '#556070';

const CARDINAL = [
  { label: 'N', az: 0 },
  { label: 'E', az: 90 },
  { label: 'S', az: 180 },
  { label: 'W', az: 270 },
];

export default function PolarDiagram({ viewshedResult, hoveredAz, onHoverAz }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const panRef = useRef(0); // current pan offset in degrees (0-360)
  const [, forceRedraw] = useState(0);

  // Convert an azimuth degree to canvas x, accounting for pan wrap
  const makeAzToX = useCallback((padL, plotW, panOffset) => {
    return (az) => {
      const shifted = ((az - panOffset) % 360 + 360) % 360;
      return padL + (shifted / 360) * plotW;
    };
  }, []);

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
    const panOffset = panRef.current;
    const azToX = makeAzToX(padL, plotW, panOffset);

    // Elevation range — anchor 0° (horizon) at 25% from bottom so positive angles
    // (visible peaks) always occupy 75% of chart height regardless of terrain flatness.
    let maxElev = -Infinity;
    rays.forEach((r) => {
      r.samples.forEach((s) => {
        if (s.angleDeg > maxElev) maxElev = s.angleDeg;
      });
    });
    const elevMax = Math.max(maxElev * 1.15, 2); // at least 2° of headroom above
    // horizonFrac=0.25 → |elevMin| = elevMax/3 → 0° sits 25% from bottom
    const elevMin = -(elevMax / 3);

    const elevToY = (e) => padT + plotH - ((e - elevMin) / (elevMax - elevMin)) * plotH;

    // Grid lines — elevation
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    const elevSpan = elevMax - elevMin;
    const elevStep = elevSpan > 20 ? 10 : elevSpan > 5 ? 5 : 1;
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

    // Cardinal azimuth lines + labels
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

    // Azimuth tick labels — show every 45° starting from panOffset
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = '9px monospace';
    for (let step = 0; step < 8; step++) {
      // label the azimuth that appears at each 45° screen position
      const screenAz = (panOffset + step * 45) % 360;
      const x = padL + (step / 8) * plotW;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(screenAz)}°`, x, padT + plotH + 28);
    }
    // right edge label
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(panOffset)}°`, W - padR, padT + plotH + 28);

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

    // Skyline — sort by shifted azimuth so line never crosses the canvas diagonally
    const sortedRays = [...rays].sort((a, b) => {
      const aS = ((a.azDeg - panOffset) % 360 + 360) % 360;
      const bS = ((b.azDeg - panOffset) % 360 + 360) % 360;
      return aS - bS;
    });
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sortedRays.forEach((ray, i) => {
      const x = azToX(ray.azDeg);
      const y = elevToY(ray.maxAngleDeg ?? 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    // close: connect last ray back to first (wrap)
    if (sortedRays.length > 0) {
      const first = sortedRays[0];
      ctx.lineTo(padL + plotW, elevToY(first.maxAngleDeg ?? 0));
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

    // Axes border
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

    // Pan indicator (subtle)
    ctx.fillStyle = 'rgba(70,186,180,0.4)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`pan: ${Math.round(panOffset)}°`, W - padR, padT - 3);
  }, [viewshedResult, hoveredAz, makeAzToX]);

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => { scheduleDraw(); }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(scheduleDraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [scheduleDraw]);

  // Drag pan
  const dragState = useRef(null);

  const handleMouseDown = useCallback((e) => {
    if (!viewshedResult) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - 48 - 16;
    dragState.current = { startX: e.clientX, startPan: panRef.current, plotW };

    const onMove = (me) => {
      if (!dragState.current) return;
      const { startX, startPan, plotW: pw } = dragState.current;
      const delta = (me.clientX - startX) / pw * 360;
      panRef.current = ((startPan - delta) % 360 + 360) % 360;
      scheduleDraw();
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [viewshedResult, scheduleDraw]);

  // Hover az (converts screen x back to azimuth accounting for pan)
  const handleMouseMove = useCallback(
    (e) => {
      if (!viewshedResult || dragState.current) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const padL = 48;
      const padR = 16;
      const plotW = rect.width - padL - padR;
      const x = e.clientX - rect.left - padL;
      const shifted = Math.max(0, Math.min(360, (x / plotW) * 360));
      const az = (panRef.current + shifted) % 360;
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
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'ew-resize' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}
