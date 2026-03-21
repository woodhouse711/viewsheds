import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const HORIZON_LAYER = 'viewshed-horizon';
const ISLAND_LAYER = 'viewshed-islands';
const FILL_LAYER = 'viewshed-fill';
const OBSERVER_LAYER = 'viewshed-observer';

function buildHorizonGeoJSON(rays) {
  if (!rays || rays.length === 0) return { type: 'FeatureCollection', features: [] };

  const coords = rays.map((r) => [r.horizonLng, r.horizonLat]);
  // Close the loop
  if (coords.length > 0) coords.push(coords[0]);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      },
    ],
  };
}

function buildFillGeoJSON(rays, obsLat, obsLng) {
  if (!rays || rays.length === 0) return { type: 'FeatureCollection', features: [] };

  const coords = [[obsLng, obsLat]];
  rays.forEach((r) => coords.push([r.horizonLng, r.horizonLat]));
  coords.push(coords[1]); // close polygon

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {},
      },
    ],
  };
}

function buildIslandsGeoJSON(rays) {
  if (!rays || rays.length === 0) return { type: 'FeatureCollection', features: [] };

  const features = [];
  rays.forEach((ray) => {
    ray.samples.forEach((s) => {
      if (s.isIsland) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
          properties: { distKm: s.distKm },
        });
      }
    });
  });

  return { type: 'FeatureCollection', features };
}

function buildObserverGeoJSON(lat, lng) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {},
      },
    ],
  };
}

export default function MapView({
  observer,
  onObserverChange,
  viewshedResult,
  showFill,
  showViewshed,
  onMapReady,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const debounceRef = useRef(null);

  const notifyObserver = useCallback(
    (lat, lng) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onObserverChange({ lat, lng });
      }, 150);
    },
    [onObserverChange]
  );

  // Initialize map
  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [observer.lng, observer.lat],
      zoom: 10,
      pitchWithRotate: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      // Viewshed fill
      map.addSource('viewshed-fill-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: 'viewshed-fill-src',
        paint: {
          'fill-color': '#46BAB4',
          'fill-opacity': 0.08,
        },
      });

      // Horizon line
      map.addSource('viewshed-horizon-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: HORIZON_LAYER,
        type: 'line',
        source: 'viewshed-horizon-src',
        paint: {
          'line-color': '#46BAB4',
          'line-width': 2,
          'line-opacity': 0.9,
        },
      });

      // Islands
      map.addSource('viewshed-islands-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: ISLAND_LAYER,
        type: 'circle',
        source: 'viewshed-islands-src',
        paint: {
          'circle-color': 'rgba(70,230,220,0.8)',
          'circle-radius': 3,
          'circle-stroke-width': 0,
        },
      });

      // Observer marker
      map.addSource('viewshed-observer-src', {
        type: 'geojson',
        data: buildObserverGeoJSON(observer.lat, observer.lng),
      });
      map.addLayer({
        id: OBSERVER_LAYER,
        type: 'circle',
        source: 'viewshed-observer-src',
        paint: {
          'circle-color': '#46BAB4',
          'circle-radius': 7,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      mapRef.current = map;
      onMapReady && onMapReady(map);
    });

    // Click to set observer
    map.on('click', (e) => {
      if (isDraggingRef.current) return;
      const { lat, lng } = e.lngLat;
      onObserverChange({ lat, lng });
    });

    // Drag observer marker
    map.on('mousedown', OBSERVER_LAYER, (e) => {
      e.preventDefault();
      isDraggingRef.current = true;
      map.getCanvas().style.cursor = 'grabbing';

      const onMove = (ev) => {
        const { lat, lng } = ev.lngLat;
        // Update marker position immediately
        map.getSource('viewshed-observer-src').setData(buildObserverGeoJSON(lat, lng));
        notifyObserver(lat, lng);
      };

      const onUp = () => {
        map.getCanvas().style.cursor = '';
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        setTimeout(() => { isDraggingRef.current = false; }, 50);
      };

      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    });

    map.on('mouseenter', OBSERVER_LAYER, () => {
      map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', OBSERVER_LAYER, () => {
      if (!isDraggingRef.current) map.getCanvas().style.cursor = '';
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update observer marker position
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('viewshed-observer-src')) return;
    map.getSource('viewshed-observer-src').setData(buildObserverGeoJSON(observer.lat, observer.lng));
  }, [observer]);

  // Update viewshed layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('viewshed-horizon-src')) return;

    if (!showViewshed || !viewshedResult) {
      map.getSource('viewshed-horizon-src').setData({ type: 'FeatureCollection', features: [] });
      map.getSource('viewshed-islands-src').setData({ type: 'FeatureCollection', features: [] });
      map.getSource('viewshed-fill-src').setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const { rays } = viewshedResult;
    map.getSource('viewshed-horizon-src').setData(buildHorizonGeoJSON(rays));
    map.getSource('viewshed-islands-src').setData(buildIslandsGeoJSON(rays));

    if (showFill) {
      map.getSource('viewshed-fill-src').setData(buildFillGeoJSON(rays, observer.lat, observer.lng));
    } else {
      map.getSource('viewshed-fill-src').setData({ type: 'FeatureCollection', features: [] });
    }
  }, [viewshedResult, showViewshed, showFill, observer]);

  // Toggle layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(HORIZON_LAYER)) return;
    const vis = showViewshed ? 'visible' : 'none';
    map.setLayoutProperty(HORIZON_LAYER, 'visibility', vis);
    map.setLayoutProperty(ISLAND_LAYER, 'visibility', vis);
  }, [showViewshed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(FILL_LAYER)) return;
    map.setLayoutProperty(FILL_LAYER, 'visibility', showFill && showViewshed ? 'visible' : 'none');
  }, [showFill, showViewshed]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden' }}
    />
  );
}
