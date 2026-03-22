// viewshed.worker.js — Raycasting viewshed computation in a Web Worker

const TILE_SIZE = 256;
const EARTH_RADIUS_KM = 6371;
const REFRACTION_FACTOR = 1.15;

let tileData = {}; // key → Float32Array

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

function latLngToTile(lat, lng, zoom) {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
  return { x, y };
}

function latLngToPixel(lat, lng, zoom, tileX, tileY) {
  const n = Math.pow(2, zoom);
  const px = ((lng + 180) / 360) * n * TILE_SIZE - tileX * TILE_SIZE;
  const latRad = (lat * Math.PI) / 180;
  const py =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n *
      TILE_SIZE -
    tileY * TILE_SIZE;
  return { px: Math.floor(px), py: Math.floor(py) };
}

function getElev(lat, lng, zoom) {
  const { x, y } = latLngToTile(lat, lng, zoom);
  const key = tileKey(zoom, x, y);
  const tile = tileData[key];
  if (!tile) return 0;
  const { px, py } = latLngToPixel(lat, lng, zoom, x, y);
  const cx = Math.max(0, Math.min(TILE_SIZE - 1, px));
  const cy = Math.max(0, Math.min(TILE_SIZE - 1, py));
  return tile[cy * TILE_SIZE + cx];
}

function computeViewshed({ obsLat, obsLng, obsHeight, radiusKm, numAzimuths, tileZoom }) {
  const zoom = tileZoom || 12;
  const obsElev = getElev(obsLat, obsLng, zoom) + obsHeight;
  const DEG_PER_KM_LAT = 1 / 111.32;
  const DEG_PER_KM_LNG = DEG_PER_KM_LAT / Math.cos((obsLat * Math.PI) / 180);
  // Variable step size: finer sampling near the observer where steep terrain
  // is underrepresented by fixed-interval steps (each 50m step at 1km changes
  // elevation angle ~3×more than the same step at 10km).
  // Terrain tile resolution at zoom 12 is ~25m/px, so 12.5m = 2 samples/px.
  const BASE_STEP = 0.05; // 50m beyond 10km
  function stepAt(d) {
    if (d < 4) return 0.0125;  // 12.5m — 4× within 4km
    if (d < 10) return 0.025;  // 25m   — 2× within 10km
    return BASE_STEP;           // 50m   — normal beyond 10km
  }

  const rays = [];

  for (let i = 0; i < numAzimuths; i++) {
    const azDeg = (360 / numAzimuths) * i;
    const azRad = (azDeg * Math.PI) / 180;
    const dLat = -Math.cos(azRad) * DEG_PER_KM_LAT;
    const dLng = Math.sin(azRad) * DEG_PER_KM_LNG;

    let maxAngle = -Infinity;
    const samples = [];
    let horizonIdx = -1;
    let everOccluded = false;

    let d = 0;
    while (d < radiusKm) {
      d += stepAt(d);
      if (d > radiusKm) d = radiusKm;
      const sLat = obsLat + dLat * d;
      const sLng = obsLng + dLng * d;
      const elev = getElev(sLat, sLng, zoom);
      const distM = d * 1000;

      // Earth curvature + atmospheric refraction correction
      const drop = ((d * d) / (2 * EARTH_RADIUS_KM * REFRACTION_FACTOR)) * 1000;
      const effectiveElev = elev - drop;

      const angle = Math.atan2(effectiveElev - obsElev, distM);
      const angleDeg = (angle * 180) / Math.PI;
      const visible = angle > maxAngle;
      const isIsland = visible && everOccluded;

      if (visible) {
        maxAngle = angle;
        horizonIdx = samples.length;
      } else {
        everOccluded = true;
      }

      samples.push({
        lat: sLat,
        lng: sLng,
        elev,
        distKm: d,
        angleDeg,
        visible,
        isIsland,
      });
    } // end while

    rays.push({
      azDeg,
      samples,
      horizonIdx,
      horizonLat: horizonIdx >= 0 ? samples[horizonIdx].lat : obsLat,
      horizonLng: horizonIdx >= 0 ? samples[horizonIdx].lng : obsLng,
      horizonDist: horizonIdx >= 0 ? samples[horizonIdx].distKm : 0,
      maxAngleDeg: maxAngle === -Infinity ? 0 : (maxAngle * 180) / Math.PI,
    });
  }

  return { rays, obsElev: getElev(obsLat, obsLng, zoom) };
}

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'SET_TILES') {
    tileData = payload.tiles;
    self.postMessage({ type: 'TILES_READY' });
    return;
  }

  if (type === 'COMPUTE') {
    try {
      const result = computeViewshed(payload);
      self.postMessage({ type: 'RESULT', payload: result });
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: err.message });
    }
    return;
  }
};
