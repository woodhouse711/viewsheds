import { useState, useEffect, useRef, useCallback } from 'react';
import MapView from './components/MapView';
import PolarDiagram from './components/PolarDiagram';
import Controls from './components/Controls';
import { prefetchViewshedTiles } from './lib/terrain';

const DEFAULT_OBSERVER = { lat: 47.6677, lng: -122.3829 };
const DEFAULT_RADIUS = 30;
const DEFAULT_OBS_HEIGHT = 2;
const NUM_AZIMUTHS = 360;
const TILE_ZOOM = 12;

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
  const [viewshedResult, setViewshedResult] = useState(null);
  const [computing, setComputing] = useState(false);
  const [hoveredAz, setHoveredAz] = useState(null);
  const [diagramHeight, setDiagramHeight] = useState(180);
  const [handleHovered, setHandleHovered] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const computeRef = useRef(null);
  const dragRef = useRef(null);
  const pendingRef = useRef(false);

  // Close sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const runViewshed = useCallback(async (obs, rad, height) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
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
          if (e.data.type === 'RESULT') { worker.removeEventListener('message', handler); setViewshedResult(e.data.payload); resolve(); }
          else if (e.data.type === 'ERROR') { worker.removeEventListener('message', handler); reject(new Error(e.data.payload)); }
        };
        worker.addEventListener('message', handler);
      });
    } catch (err) {
      console.error('Viewshed error:', err);
    } finally {
      setComputing(false);
      pendingRef.current = false;
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
        width: 240,
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        padding: 12,
        overflowY: 'auto',
        background: 'rgba(8,12,16,0.97)',
        flexShrink: 0,
      };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#080c10', display: 'flex', flexDirection: 'column', fontFamily: 'monospace', color: '#d0d4dc', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(8,12,16,0.95)', zIndex: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 'bold', color: '#46BAB4', letterSpacing: '0.1em' }}>VIEWSHED</span>
        {!isMobile && <span style={{ fontSize: 11, color: '#556070' }}>Line-of-sight terrain analysis</span>}
        <span style={{ fontSize: 11, color: '#556070', marginLeft: 'auto' }}>
          {observer.lat.toFixed(4)}°, {observer.lng.toFixed(4)}°
        </span>
        {isMobile && (
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              marginLeft: 8,
              background: sidebarOpen ? 'rgba(70,186,180,0.2)' : 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(70,186,180,0.4)',
              borderRadius: 4,
              color: '#46BAB4',
              fontSize: 16,
              lineHeight: 1,
              padding: '4px 9px',
              cursor: 'pointer',
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
              showViewshed={showViewshed}
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
              hoveredAz={hoveredAz}
              onHoverAz={setHoveredAz}
            />
          </div>
        </div>

        {/* Sidebar — desktop inline, mobile overlay */}
        <aside style={sidebarStyle}>
          <Controls
            showViewshed={showViewshed}
            onShowViewshed={setShowViewshed}
            showFill={showFill}
            onShowFill={setShowFill}
            radius={radius}
            onRadius={(r) => setRadius(r)}
            obsHeight={obsHeight}
            onObsHeight={(h) => setObsHeight(h)}
            viewshedResult={viewshedResult}
            computing={computing}
          />
        </aside>

        {/* Backdrop — tap to close sidebar on mobile */}
        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 99,
              background: 'rgba(0,0,0,0.45)',
            }}
          />
        )}
      </main>
    </div>
  );
}
