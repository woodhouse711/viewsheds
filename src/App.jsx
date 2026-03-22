import { useState, useEffect, useRef, useCallback } from 'react';
import MapView from './components/MapView';
import PolarDiagram from './components/PolarDiagram';
import Controls from './components/Controls';
import LocationSearch from './components/LocationSearch';
import { prefetchViewshedTiles } from './lib/terrain';
import { fetchPeaks } from './lib/peaks';

const DEFAULT_OBSERVER = { lat: 47.6677, lng: -122.3829 };
const DEFAULT_RADIUS = 30;
const DEFAULT_OBS_HEIGHT = 2;
const NUM_AZIMUTHS = 720;
const TILE_ZOOM = 12;

// Geodetic helpers used for map-hover → azimuth conversion
const _toRad = (d) => d * Math.PI / 180;
function _bearing(lat1, lng1, lat2, lng2) {
  const φ1 = _toRad(lat1), φ2 = _toRad(lat2), Δλ = _toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = _toRad(lat2 - lat1), dLng = _toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function _nearestRay(rays, az) {
  let best = rays[0], bestDiff = 360;
  for (const r of rays) {
    const d = Math.abs(((r.azDeg - az) + 180) % 360 - 180);
    if (d < bestDiff) { bestDiff = d; best = r; }
  }
  return best;
}

const MOBILE_BP = '(max-width: 768px)';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BP).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BP);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

let workerInstance = null;
function getWorker() {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./workers/viewshed.worker.js', import.meta.url), {
      type: 'module',
    });
  }
  return workerInstance;
}

export default function App() {
  const isMobile = useIsMobile();

  const [observer, setObserver] = useState(DEFAULT_OBSERVER);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [obsHeight, setObsHeight] = useState(DEFAULT_OBS_HEIGHT);
  const [showViewshed, setShowViewshed] = useState(true);
  const [showFill, setShowFill] = useState(false);
  const [fillOpacity, setFillOpacity] = useState(0.12);
  const [showTopo, setShowTopo] = useState(false);
  const [viewshedResult, setViewshedResult] = useState(null);
  const [computing, setComputing] = useState(false);
  // hoverTarget links the map and diagram: { az, mapLat, mapLng, diagramAngleDeg }
  const [hoverTarget, setHoverTarget] = useState(null);
  const [diagramHeight, setDiagramHeight] = useState(180);
  const [handleHovered, setHandleHovered] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [peaks, setPeaks] = useState([]);
  const [locationInfo, setLocationInfo] = useState(null);
  const [exporting, setExporting] = useState(false);

  const computeRef = useRef(null);
  const dragRef = useRef(null);
  const pendingRef = useRef(false);
  const pendingParamsRef = useRef(null);
  const mapRef = useRef(null);
  const reverseGeoRef = useRef(null);
  const mapHoverRafRef = useRef(null);

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Reverse-geocode observer position (debounced 800ms)
  useEffect(() => {
    clearTimeout(reverseGeoRef.current);
    reverseGeoRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${observer.lat}&lon=${observer.lng}&format=json&zoom=12`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setLocationInfo(data.address || null);
      } catch {
        setLocationInfo(null);
      }
    }, 800);
  }, [observer]);

  const runViewshed = useCallback(async (obs, rad, height) => {
    if (pendingRef.current) {
      pendingParamsRef.current = { obs, rad, height };
      return;
    }
    pendingRef.current = true;
    pendingParamsRef.current = null;
    setPeaks([]);
    setComputing(true);
    try {
      const tiles = await prefetchViewshedTiles(obs.lat, obs.lng, rad);
      const worker = getWorker();
      worker.postMessage({ type: 'SET_TILES', payload: { tiles } });
      await new Promise((resolve, reject) => {
        const handler = (e) => {
          if (e.data.type === 'TILES_READY') { worker.removeEventListener('message', handler); resolve(); }
          else if (e.data.type === 'ERROR') { worker.removeEventListener('message', handler); reject(new Error(e.data.payload)); }
        };
        worker.addEventListener('message', handler);
      });
      worker.postMessage({
        type: 'COMPUTE',
        payload: { obsLat: obs.lat, obsLng: obs.lng, obsHeight: height, radiusKm: rad, numAzimuths: NUM_AZIMUTHS, tileZoom: TILE_ZOOM },
      });
      await new Promise((resolve, reject) => {
        const handler = (e) => {
          if (e.data.type === 'RESULT') {
            worker.removeEventListener('message', handler);
            setViewshedResult(e.data.payload);
            // Fetch peaks asynchronously — non-blocking, fails silently
            fetchPeaks(obs.lat, obs.lng, rad, 2500)
              .then(setPeaks)
              .catch(() => {});
            resolve();
          }
          else if (e.data.type === 'ERROR') { worker.removeEventListener('message', handler); reject(new Error(e.data.payload)); }
        };
        worker.addEventListener('message', handler);
      });
    } catch (err) {
      console.error('Viewshed error:', err);
    } finally {
      setComputing(false);
      pendingRef.current = false;
      const queued = pendingParamsRef.current;
      if (queued) {
        pendingParamsRef.current = null;
        runViewshed(queued.obs, queued.rad, queued.height);
      }
    }
  }, []);

  const scheduleCompute = useCallback((obs, rad, height) => {
    clearTimeout(computeRef.current);
    computeRef.current = setTimeout(() => runViewshed(obs, rad, height), 300);
  }, [runViewshed]);

  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = diagramHeight;
    const onMove = (me) => {
      const delta = startY - me.clientY;
      setDiagramHeight(Math.max(80, Math.min(600, startH + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dragRef.current = { onMove, onUp };
  }, [diagramHeight]);

  const handleObserverChange = useCallback((obs) => {
    setObserver(obs);
    if (showViewshed) scheduleCompute(obs, radius, obsHeight);
  }, [showViewshed, radius, obsHeight, scheduleCompute]);

  // Hover from diagram: az is the hovered azimuth; look up horizon point for map target
  const handleDiagramHover = useCallback((az) => {
    if (az === null || !viewshedResult?.rays) { setHoverTarget(null); return; }
    const ray = _nearestRay(viewshedResult.rays, az);
    setHoverTarget({ az, mapLat: ray.horizonLat, mapLng: ray.horizonLng, diagramAngleDeg: ray.maxAngleDeg });
  }, [viewshedResult]);

  // Hover from map: latlng is the hovered position; find its angle in the diagram
  const handleMapHover = useCallback((latlng) => {
    cancelAnimationFrame(mapHoverRafRef.current);
    if (!latlng || !viewshedResult?.rays) { setHoverTarget(null); return; }
    mapHoverRafRef.current = requestAnimationFrame(() => {
      const az = _bearing(observer.lat, observer.lng, latlng.lat, latlng.lng);
      const distKm = _haversineKm(observer.lat, observer.lng, latlng.lat, latlng.lng);
      const ray = _nearestRay(viewshedResult.rays, az);
      let bestSample = ray.samples[0], bestDiff = Infinity;
      for (const s of ray.samples) {
        const d = Math.abs(s.distKm - distKm);
        if (d < bestDiff) { bestDiff = d; bestSample = s; }
      }
      setHoverTarget({ az, mapLat: latlng.lat, mapLng: latlng.lng, diagramAngleDeg: bestSample?.angleDeg ?? ray.maxAngleDeg });
    });
  }, [observer, viewshedResult]);

  // Sidebar resize (desktop only) — drag handle on left edge
  const handleSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX, startW = sidebarWidth;
    const onMove = (me) => setSidebarWidth(Math.max(190, Math.min(500, startW + (startX - me.clientX))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const handleLocationSelect = useCallback((coords) => {
    handleObserverChange(coords);
    mapRef.current?.flyTo({ center: [coords.lng, coords.lat], zoom: 10 });
  }, [handleObserverChange]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // Load html2canvas from CDN at click-time — avoids Vite import analysis
      // and means no local npm install is required.
      if (!window._html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
        window._html2canvas = window.html2canvas;
      }
      const canvas = await window._html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#080c10',
        logging: false,
      });
      const filename = `viewshed_${observer.lat.toFixed(5)}_${observer.lng.toFixed(5)}.jpg`;
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/jpeg', 0.93);
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [observer]);

  useEffect(() => {
    if (showViewshed) scheduleCompute(observer, radius, obsHeight);
  }, [radius, obsHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showViewshed) scheduleCompute(observer, radius, obsHeight);
  }, [showViewshed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scheduleCompute(DEFAULT_OBSERVER, DEFAULT_RADIUS, DEFAULT_OBS_HEIGHT);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sidebarStyle = isMobile
    ? {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 260,
        maxWidth: '85vw',
        zIndex: 100,
        padding: 12,
        overflowY: 'auto',
        background: 'rgba(8,12,16,0.98)',
        borderLeft: '1px solid rgba(255,255,255,0.12)',
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s ease',
      }
    : {
        position: 'relative',
        width: sidebarWidth,
        minWidth: sidebarWidth,
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        padding: 12,
        overflowY: 'auto',
        background: 'rgba(8,12,16,0.97)',
        flexShrink: 0,
      };

  return (
    <div style={{ width: '100vw', height: '100dvh', background: '#080c10', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', color: '#d0d4dc', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ padding: '6px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(8,12,16,0.95)', zIndex: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 'bold', color: '#46BAB4', letterSpacing: '0.1em', flexShrink: 0 }}>VIEWSHED</span>

        {/* Location search */}
        <LocationSearch onSelect={handleLocationSelect} />

        {/* Coords display — hidden on mobile (visible in sidebar) */}
        {!isMobile && (
          <span style={{ fontSize: 10, color: '#556070', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {observer.lat.toFixed(4)}°, {observer.lng.toFixed(4)}°
          </span>
        )}

        {/* Export button — hidden on mobile */}
        {!isMobile && (
          <button
            onClick={handleExport}
            disabled={exporting}
            title="Save screenshot (lat/lng filename)"
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              color: exporting ? '#556070' : '#d0d4dc',
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '3px 7px',
              cursor: exporting ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            {exporting ? '…' : '⬇ JPG'}
          </button>
        )}

        {isMobile && (
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              background: sidebarOpen ? 'rgba(70,186,180,0.2)' : 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(70,186,180,0.4)',
              borderRadius: 4,
              color: '#46BAB4',
              fontSize: 16,
              lineHeight: 1,
              padding: '4px 9px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label="Toggle controls"
          >
            {sidebarOpen ? '✕' : '⚙'}
          </button>
        )}
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* Map + diagram column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <MapView
              observer={observer}
              onObserverChange={handleObserverChange}
              viewshedResult={viewshedResult}
              showFill={showFill}
              fillOpacity={fillOpacity}
              showViewshed={showViewshed}
              showTopo={showTopo}
              onMapReady={(m) => { mapRef.current = m; }}
              onMapHover={handleMapHover}
              hoverTarget={hoverTarget}
            />
          </div>

          {/* Resize handle — desktop only */}
          {!isMobile && (
            <div
              style={{
                height: 5,
                background: handleHovered ? 'rgba(70,186,180,0.25)' : 'rgba(255,255,255,0.04)',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                cursor: 'ns-resize',
                flexShrink: 0,
                userSelect: 'none',
              }}
              onMouseDown={handleResizeMouseDown}
              onMouseEnter={() => setHandleHovered(true)}
              onMouseLeave={() => setHandleHovered(false)}
            />
          )}

          {/* 360 diagram */}
          <div style={{ height: isMobile ? 160 : diagramHeight, background: '#080c10', flexShrink: 0, borderTop: isMobile ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
            <PolarDiagram
              viewshedResult={viewshedResult}
              observer={observer}
              peaks={peaks}
              hoverTarget={hoverTarget}
              onHoverAz={handleDiagramHover}
            />
          </div>
        </div>

        {/* Sidebar */}
        <aside style={sidebarStyle}>
          {/* Resize handle — desktop only */}
          {!isMobile && (
            <div
              onMouseDown={handleSidebarResize}
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: 5,
                cursor: 'ew-resize', zIndex: 5,
                background: 'rgba(255,255,255,0.03)',
                borderLeft: '1px solid rgba(255,255,255,0.07)',
              }}
            />
          )}
          <Controls
            showViewshed={showViewshed}
            onShowViewshed={setShowViewshed}
            showFill={showFill}
            onShowFill={setShowFill}
            fillOpacity={fillOpacity}
            onFillOpacity={setFillOpacity}
            showTopo={showTopo}
            onShowTopo={setShowTopo}
            radius={radius}
            onRadius={(r) => setRadius(r)}
            obsHeight={obsHeight}
            onObsHeight={(h) => setObsHeight(h)}
            viewshedResult={viewshedResult}
            computing={computing}
            observer={observer}
            locationInfo={locationInfo}
            peaks={peaks}
          />
        </aside>

        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.45)' }}
          />
        )}
      </main>
    </div>
  );
}
