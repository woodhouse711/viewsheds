// geo.js — Coordinate utilities and earth curvature correction

export const EARTH_RADIUS_KM = 6371;
// Atmospheric refraction factor (effective radius multiplier)
const REFRACTION_FACTOR = 1.15;

// Earth curvature drop in meters at distance d km
export function curvatureDrop(distKm) {
  return ((distKm * distKm) / (2 * EARTH_RADIUS_KM * REFRACTION_FACTOR)) * 1000;
}

// Haversine distance in km between two lat/lng points
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = EARTH_RADIUS_KM;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Convert azimuth degrees + distance km from origin lat/lng to destination lat/lng
export function destinationPoint(lat, lng, azDeg, distKm) {
  const DEG_PER_KM_LAT = 1 / 111.32;
  const DEG_PER_KM_LNG = DEG_PER_KM_LAT / Math.cos((lat * Math.PI) / 180);
  const azRad = (azDeg * Math.PI) / 180;
  return {
    lat: lat + -Math.cos(azRad) * DEG_PER_KM_LAT * distKm,
    lng: lng + Math.sin(azRad) * DEG_PER_KM_LNG * distKm,
  };
}

// Bounding box from center + radius in km
export function bboxFromRadius(lat, lng, radiusKm) {
  const KM_PER_DEG_LAT = 111.32;
  const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / KM_PER_DEG_LNG;
  return {
    north: lat + dLat,
    south: lat - dLat,
    east: lng + dLng,
    west: lng - dLng,
  };
}
