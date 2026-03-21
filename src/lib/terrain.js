// terrain.js — Terrain tile fetching, Terrarium PNG decoding, LRU cache

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TILE_ZOOM = 12;
const TILE_SIZE = 256;
const CACHE_MAX = 50;

// LRU cache using a Map (insertion-order iteration)
class LRUCache {
  constructor(max) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    // Refresh by re-inserting
    const val = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key, val) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      // Delete oldest (first) entry
      this.map.delete(this.map.keys().next().value);
    }
    this.map.set(key, val);
  }

  has(key) {
    return this.map.has(key);
  }
}

const elevCache = new LRUCache(CACHE_MAX);
const inflightRequests = new Map(); // key → Promise

// Web Mercator tile coordinates from lat/lng/zoom
function latLngToTile(lat, lng, zoom) {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
  return { x, y, z: zoom };
}

// Pixel offset within a tile for a given lat/lng
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

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

function tileUrl(z, x, y) {
  return TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// Decode a Terrarium PNG tile into a Float32Array of elevations (row-major)
async function decodeTile(z, x, y) {
  const url = tileUrl(z, x, y);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tile fetch failed: ${url}`);
  const blob = await res.blob();
  const img = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);

  const elev = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    elev[i] = r * 256 + g + b / 256 - 32768;
  }
  return elev;
}

// Fetch and cache a tile; returns Float32Array
async function fetchTile(z, x, y) {
  const key = tileKey(z, x, y);
  if (elevCache.has(key)) return elevCache.get(key);
  if (inflightRequests.has(key)) return inflightRequests.get(key);

  const promise = decodeTile(z, x, y).then((elev) => {
    elevCache.set(key, elev);
    inflightRequests.delete(key);
    return elev;
  });
  inflightRequests.set(key, promise);
  return promise;
}

// Pre-fetch all tiles needed to cover a bounding box
export async function prefetchTiles(bounds) {
  const { north, south, east, west } = bounds;
  const tl = latLngToTile(north, west, TILE_ZOOM);
  const br = latLngToTile(south, east, TILE_ZOOM);
  const fetches = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) {
      fetches.push(fetchTile(TILE_ZOOM, x, y));
    }
  }
  return Promise.all(fetches);
}

// Get elevation (meters) at a lat/lng. Returns 0 if tile not loaded.
export function getElevation(lat, lng) {
  const { x, y } = latLngToTile(lat, lng, TILE_ZOOM);
  const key = tileKey(TILE_ZOOM, x, y);
  const elev = elevCache.get(key);
  if (!elev) return 0;
  const { px, py } = latLngToPixel(lat, lng, TILE_ZOOM, x, y);
  const clampedPx = Math.max(0, Math.min(TILE_SIZE - 1, px));
  const clampedPy = Math.max(0, Math.min(TILE_SIZE - 1, py));
  return elev[clampedPy * TILE_SIZE + clampedPx];
}

// Async version — fetches tile if needed
export async function getElevationAsync(lat, lng) {
  const { x, y } = latLngToTile(lat, lng, TILE_ZOOM);
  await fetchTile(TILE_ZOOM, x, y);
  return getElevation(lat, lng);
}

// Return all cached tile data in a serializable form for the worker
export function getCachedTileData() {
  const tiles = {};
  for (const [key, elev] of elevCache.map.entries()) {
    tiles[key] = elev;
  }
  return tiles;
}

// Prefetch tiles covering the viewshed radius around a point
export async function prefetchViewshedTiles(lat, lng, radiusKm) {
  const KM_PER_DEG_LAT = 111.32;
  const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / KM_PER_DEG_LNG;
  return prefetchTiles({
    north: lat + dLat,
    south: lat - dLat,
    east: lng + dLng,
    west: lng - dLng,
  });
}

export { TILE_ZOOM, TILE_SIZE, latLngToTile, tileKey };
