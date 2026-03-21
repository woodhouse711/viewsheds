const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Fetch named mountain peaks from OpenStreetMap within a radius.
 * Filters to ele >= minEle (default 3000m) client-side.
 * Returns array sorted by elevation descending.
 */
export async function fetchPeaks(lat, lng, radiusKm, minEle = 3000) {
  const radiusM = radiusKm * 1000;
  // Query all named peaks with an ele tag — filter elevation client-side
  // to avoid relying on Overpass string comparison quirks.
  const query =
    `[out:json][timeout:25];` +
    `node[natural=peak][name][ele](around:${radiusM},${lat},${lng});` +
    `out;`;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

  const data = await res.json();
  return data.elements
    .map((el) => ({
      lat: el.lat,
      lng: el.lon,
      name: el.tags.name,
      ele: parseFloat(el.tags.ele),
    }))
    .filter((p) => !isNaN(p.ele) && p.ele >= minEle)
    .sort((a, b) => b.ele - a.ele);
}
