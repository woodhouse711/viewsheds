import { useEffect, useRef, useCallback, useState } from 'react';

const ACCENT = '#46BAB4';
const BG = '#080c10';
const GRID_COLOR = 'rgba(255,255,255,0.06)';
const LABEL_COLOR = '#556070';
const PEAK_COLOR = 'rgba(255,210,80,0.92)';
const PEAK_ELE_COLOR = 'rgba(180,160,80,0.75)';

const toRad = (d) => d * Math.PI / 180;

function bearing(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CARDINAL = [
  { label: 'N', az: 0 },
  { label: 'E', az: 90 },
  { label: 'S', az: 180 },
  { label: 'W', az: 270 },
];

export default function PolarDiagram({ viewshedResult, observer, peaks, hoveredAz, onHoverAz }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const panRef = useRef(0); // current pan offset in degrees (0-360)
  const [zScale, setZScale] = useState(1);

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

    // Elevation range — drive the axis from the SKYLINE (ray.maxAngleDeg), not all
    // sample angles. Occluded terrain samples can have very negative angleDeg values
    // (far below ridges) that distort the centering and push visible peaks off the top.
    let maxElev = -Infinity;
    let minElev = Infinity;
    rays.forEach((r) => {
      const a = r.maxAngleDeg ?? 0;
      if (a > maxElev) maxElev = a;
      if (a < minElev) minElev = a;
    });
    if (maxElev === -Infinity) maxElev = 2;
    if (minElev === Infinity) minElev = -1;
    const center = (maxElev + minElev) / 2;
    const baseHalfSpan = Math.max((maxElev - minElev) / 2 * 1.15, 1); // min 1° half-span
    const halfSpan = baseHalfSpan / zScale;
    const elevMax = center + halfSpan;
    const elevMin = center - halfSpan;

    const elevToY = (e) => padT + plotH - ((e - elevMin) / (elevMax - elevMin)) * plotH;

    // Grid lines — elevation
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    const elevSpan = elevMax - elevMin;
    const elevStep = elevSpan > 20 ? 10 : elevSpan > 5 ? 5 : elevSpan > 1 ? 1 : 0.5;
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
      ctx.fillText(`${e.toFixed(elevStep < 1 ? 1 : 0)}°`, padL - 4, y + 3);
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
      const screenAz = (panOffset + step * 45) % 360;
      const x = padL + (step / 8) * plotW;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(screenAz)}°`, x, padT + plotH + 28);
    }
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
    if (sortedRays.length > 0) {
      const first = sortedRays[0];
      ctx.lineTo(padL + plotW, elevToY(first.maxAngleDeg ?? 0));
    }
    ctx.stroke();

    // Hover ray highlight + callout
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

      // Find nearest ray and annotate its horizon angle + distance
      let nearRay = rays[0];
      let minRayDiff = 360;
      for (const ray of rays) {
        const diff = Math.abs(((ray.azDeg - hoveredAz) + 180) % 360 - 180);
        if (diff < minRayDiff) { minRayDiff = diff; nearRay = ray; }
      }
      const hAngle = nearRay.maxAngleDeg ?? 0;
      const hDist = nearRay.horizonDist ?? 0;
      const hy = elevToY(hAngle);

      // Compute terrain elevation at the horizon point
      const obsElev = viewshedResult.obsElev ?? 0;
      const horizonElevM = Math.round(obsElev + hDist * 1000 * Math.tan(hAngle * Math.PI / 180));

      // Position label to avoid left/right edges
      const onRight = x < padL + plotW * 0.62;
      const lx = onRight ? x + 5 : x - 5;
      const ly = Math.max(padT + 10, Math.min(hy - 6, padT + plotH - 24));
      ctx.textAlign = onRight ? 'left' : 'right';

      ctx.fillStyle = ACCENT;
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${horizonElevM.toLocaleString()} m`, lx, ly);

      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '9px monospace';
      ctx.fillText(`${hDist.toFixed(1)} km`, lx, ly + 12);
    }

    // Axes border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, plotW, plotH);

    // Y-axis label — "Z" slider panel covers x=0–18, so draw label at x=20 area
    // (omitted: the degree labels and slider itself make the axis self-evident)

    // Peak labels — drawn after skyline so they sit on top
    if (peaks && peaks.length > 0 && observer && viewshedResult) {
      const obsLat = observer.lat;
      const obsLng = observer.lng;
      const obsElev = viewshedResult.obsElev || 0;
      const usedX = []; // collision guard

      for (const peak of peaks) {
        const az = bearing(obsLat, obsLng, peak.lat, peak.lng);
        const distKm = haversineKm(obsLat, obsLng, peak.lat, peak.lng);

        // Canvas X for this azimuth
        const shifted = ((az - panOffset) % 360 + 360) % 360;
        const x = padL + (shifted / 360) * plotW;
        if (x < padL || x > padL + plotW) continue;

        // Label collision — skip if within 24px of another label
        if (usedX.some((ox) => Math.abs(x - ox) < 24)) continue;

        // Find nearest ray by azimuth
        let nearestRay = rays[0];
        let minDiff = 360;
        for (const ray of rays) {
          const diff = Math.abs(((ray.azDeg - az) + 180) % 360 - 180);
          if (diff < minDiff) { minDiff = diff; nearestRay = ray; }
        }

        // Find sample nearest to peak distance
        let nearestSample = null;
        let minDD = Infinity;
        for (const s of nearestRay.samples) {
          const dd = Math.abs(s.distKm - distKm);
          if (dd < minDD) { minDD = dd; nearestSample = s; }
        }

        // Only label if the peak point is visible (not occluded by nearer ridge)
        if (!nearestSample || !nearestSample.visible) continue;

        // Peak elevation angle from observer eye
        const peakAngleDeg = Math.atan2(peak.ele - obsElev, distKm * 1000) * 180 / Math.PI;
        const y = elevToY(peakAngleDeg);

        // Skip if outside plot height
        if (y < padT + 4 || y > padT + plotH - 2) continue;

        usedX.push(x);

        // Tick line from peak dot up to label
        ctx.strokeStyle = PEAK_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x, y - 11);
        ctx.stroke();
        ctx.setLineDash([]);

        // Peak dot
        ctx.fillStyle = PEAK_COLOR;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();

        // Name
        ctx.fillStyle = PEAK_COLOR;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(peak.name, x, y - 13);

        // Elevation
        ctx.fillStyle = PEAK_ELE_COLOR;
        ctx.font = '8px monospace';
        ctx.fillText(`${Math.round(peak.ele)}m`, x, y - 23);
      }
    }

    // Pan indicator (subtle)
    ctx.fillStyle = 'rgba(70,186,180,0.4)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`pan: ${Math.round(panOffset)}°`, W - padR, padT - 3);
  }, [viewshedResult, observer, peaks, hoveredAz, makeAzToX, zScale]);

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
    <div style={{ position: 'relative', width: '100%', height: '100%', background: BG }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'ew-resize' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* Vertical Z-scale slider — lives in the left padding of the canvas (padL=48) */}
      <div style={{
        position: 'absolute',
        left: 2,
        top: 18,    // aligned with padT=16
        bottom: 34, // aligned with padB=32
        width: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        pointerEvents: 'auto',
      }}>
        <span style={{ color: LABEL_COLOR, fontSize: 8, fontFamily: 'monospace', lineHeight: 1 }}>
          ×{zScale % 1 === 0 ? zScale : zScale.toFixed(1)}
        </span>
        <input
          type="range"
          orient="vertical"
          min={0.2}
          max={10}
          step={0.1}
          value={zScale}
          onChange={(e) => setZScale(Number(e.target.value))}
          style={{
            flex: 1,
            writingMode: 'vertical-lr',
            direction: 'rtl',
            accentColor: ACCENT,
            cursor: 'pointer',
            width: 16,
          }}
        />
        <button
          onClick={() => setZScale(1)}
          disabled={zScale === 1}
          style={{
            background: 'none',
            border: `1px solid ${zScale === 1 ? 'rgba(255,255,255,0.07)' : 'rgba(70,186,180,0.4)'}`,
            color: zScale === 1 ? '#556070' : ACCENT,
            fontFamily: 'monospace',
            fontSize: 8,
            padding: '1px 3px',
            borderRadius: 2,
            cursor: zScale === 1 ? 'default' : 'pointer',
            lineHeight: 1.3,
          }}
        >
          1:1
        </button>
      </div>
    </div>
  );
}

