import { useState, useEffect, useRef, useCallback } from 'react';
import MapView from './components/MapView';
import PolarDiagram from './components/PolarDiagram';
import Controls from './components/Controls';
import { prefetchViewshedTiles, getCachedTileData } from './lib/terrain';

// Default observer: Mount Tamalpais, CA — great viewshed demo location
const DEFAULT_OBSERVER = { lat: 37.9235, lng: -122.5965 };
const DEFAULT_RADIUS = 30;
const DEFAULT_OBS_HEIGHT = 2;
const NUM_AZIMUTHS = 360;
const TILE_ZOOM = 12;

const styles = {
  root: {
    width: '100vw',
    height: '100vh',
    background: '#080c10',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'monospace',
    color: '#d0d4dc',
    overflow: 'hidden',
  },
  header: {
    padding: '8px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(8,12,16,0.95)',
    zIndex: 10,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#46BAB4',
    letterSpacing: '0.1em',
  },
  headerSub: {
    fontSize: 11,
    color: '#556070',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  mapArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
    minHeight: 0,
  },
  diagramContainer: {
    height: 180,
    borderTop: '1px solid rgba(255,255,255,0.07)',
    background: '#080c10',
    flexShrink: 0,
  },
  sidebar: {
    width: 240,
    borderLeft: '1px solid rgba(255,255,255,0.07)',
    padding: 12,
    overflowY: 'auto',
    background: 'rgba(8,12,16,0.97)',
    flexShrink: 0,
  },
  coords: {
    fontSize: 11,
    color: '#556070',
    marginLeft: 'auto',
  },
};

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
  const [observer, setObserver] = useState(DEFAULT_OBSERVER);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [obsHeight, setObsHeight] = useState(DEFAULT_OBS_HEIGHT);
  const [showViewshed, setShowViewshed] = useState(true);
  const [showFill, setShowFill] = useState(false);
  const [viewshedResult, setViewshedResult] = useState(null);
  const [computing, setComputing] = useState(false);
  const [hoveredAz, setHoveredAz] = useState(null);

  const computeRef = useRef(null);
  const pendingRef = useRef(false);

  const runViewshed = useCallback(async (obs, rad, height) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setComputing(true);

    try {
      await prefetchViewshedTiles(obs.lat, obs.lng, rad);

      const tiles = getCachedTileData();
      const worker = getWorker();

      worker.postMessage({ type: 'SET_TILES', payload: { tiles } });

      await new Promise((resolve, reject) => {
        const handler = (e) => {
          if (e.data.type === 'TILES_READY') {
            worker.removeEventListener('message', handler);
            resolve();
          } else if (e.data.type === 'ERROR') {
            worker.removeEventListener('message', handler);
            reject(new Error(e.data.payload));
          }
        };
        worker.addEventListener('message', handler);
      });

      worker.postMessage({
        type: 'COMPUTE',
        payload: {
          obsLat: obs.lat,
          obsLng: obs.lng,
          obsHeight: height,
          radiusKm: rad,
          numAzimuths: NUM_AZIMUTHS,
          tileZoom: TILE_ZOOM,
        },
      });

      await new Promise((resolve, reject) => {
        const handler = (e) => {
          if (e.data.type === 'RESULT') {
            worker.removeEventListener('message', handler);
            setViewshedResult(e.data.payload);
            resolve();
          } else if (e.data.type === 'ERROR') {
            worker.removeEventListener('message', handler);
            reject(new Error(e.data.payload));
          }
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

  const scheduleCompute = useCallback(
    (obs, rad, height) => {
      clearTimeout(computeRef.current);
      computeRef.current = setTimeout(() => {
        runViewshed(obs, rad, height);
      }, 300);
    },
    [runViewshed]
  );

  const handleObserverChange = useCallback(
    (obs) => {
      setObserver(obs);
      if (showViewshed) scheduleCompute(obs, radius, obsHeight);
    },
    [showViewshed, radius, obsHeight, scheduleCompute]
  );

  useEffect(() => {
    if (showViewshed) scheduleCompute(observer, radius, obsHeight);
  }, [radius, obsHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showViewshed) scheduleCompute(observer, radius, obsHeight);
  }, [showViewshed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scheduleCompute(DEFAULT_OBSERVER, DEFAULT_RADIUS, DEFAULT_OBS_HEIGHT);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.headerTitle}>VIEWSHED</span>
        <span style={styles.headerSub}>Line-of-sight terrain analysis</span>
        <span style={styles.coords}>
          {observer.lat.toFixed(4)}°, {observer.lng.toFixed(4)}°
        </span>
      </header>

      <main style={styles.main}>
        <div style={styles.mapArea}>
          <div style={styles.mapContainer}>
            <MapView
              observer={observer}
              onObserverChange={handleObserverChange}
              viewshedResult={viewshedResult}
              showFill={showFill}
              showViewshed={showViewshed}
            />
          </div>
          <div style={styles.diagramContainer}>
            <PolarDiagram
              viewshedResult={viewshedResult}
              hoveredAz={hoveredAz}
              onHoverAz={setHoveredAz}
            />
          </div>
        </div>

        <aside style={styles.sidebar}>
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
      </main>
    </div>
  );
}
