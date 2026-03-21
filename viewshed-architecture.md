# Viewshed — Production Architecture

## Concept

A web application that renders real-time viewshed analysis on actual terrain data. The user places an observer on a map and sees what ground is visible from that point, including distant peak islands beyond intervening ridges. A synchronized polar horizon diagram shows the full hemispherical view as azimuth × elevation angle.

This builds naturally from the Field Atlas pipeline — the viewshed becomes a layer that can accompany any GPX route, answering "what did I actually see from this point on the trail?"

-----

## Data Source: AWS Terrain Tiles (Primary — Free, No Key)

The best option for a fully free, no-account elevation source. AWS hosts Mapzen's Terrain Tiles as a public dataset on S3. No API key, no signup, no usage limits, no cost at any scale. The Arnis/Minecraft project serves 300,000 users with millions of monthly tile requests at zero cost.

Tile URL (Terrarium format):

```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

Decoding: `elevation = (R * 256 + G + B / 256) - 32768` (meters)

Resolution: zoom 0-15. In the US, source data is USGS 3DEP at 10m. Globally, SRTM at 30m. At zoom 12 each tile covers ~10km × 10km at ~38m per pixel. At zoom 15, ~1.2km × 1.2km at ~5m per pixel.

Also available in other formats at the same S3 bucket:

- `elevation-tiles-prod/normal/{z}/{x}/{y}.png` (normal maps for hillshading)
- `elevation-tiles-prod/geotiff/{z}/{x}/{y}.tif` (raw GeoTIFF, 512×512)
- `elevation-tiles-prod/skadi/{N|S}yy/{N|S}yy{E|W}xxx.hgt.gz` (SRTM HGT format)

Attribution required: "Terrain Tiles contain 3DEP, SRTM, and GMTED2010 content courtesy of the U.S. Geological Survey and ETOPO1 content courtesy of U.S. National Oceanic and Atmospheric Administration."

### Alternative: Mapbox Terrain RGB

Higher quality processing but requires a free Mapbox token (50K requests/month free tier, then paid).

-----

## Architecture

### Option A: Client-Side (simplest, recommended for MVP)

All computation happens in the browser. No backend needed.

```
Browser
├── Map UI (MapLibre GL JS, free, open source)
│   ├── Base layer: dark/neutral vector tiles (MapTiler, Stadia, or self-hosted)
│   ├── Hillshade layer: Mapbox Terrain RGB → hillshade in shader
│   └── Viewshed overlay: GeoJSON polygon + island points
│
├── DEM Tile Fetcher
│   ├── Fetches AWS Terrarium PNG tiles on demand (zoom ~12-13 for ~30m cells)
│   ├── URL: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
│   ├── LRU cache of decoded elevation grids in memory
│   └── Decodes Terrarium → elevation: height = (R×256 + G + B/256) - 32768
│
├── Viewshed Engine (Web Worker)
│   ├── Receives observer position + params from main thread
│   ├── Reads elevation from cached tiles
│   ├── Raycasts 360-720 azimuths outward
│   ├── Returns: horizon points, visible cells, island cells, per-ray profiles
│   └── Runs in worker to keep UI at 60fps during drag interaction
│
└── Polar Diagram (Canvas 2D)
    ├── Renders azimuth × elevation angle
    ├── Skyline silhouette, visible terrain, islands
    └── Synchronized hover with map view
```

Tile decoding is the performance bottleneck. At zoom 12, each tile covers roughly 10km × 10km at ~38m resolution. A 50km radius viewshed needs to sample from ~25 tiles. With an LRU cache, most of these stay warm during drag interaction.

The raycasting itself is fast — 360 rays × 500 steps = 180,000 elevation lookups per computation, which completes in under 50ms on modern hardware. The Web Worker ensures the UI thread stays responsive.

### Option B: Server-Assisted

For higher resolution or larger radius analysis, offload computation to a server.

```
Client ←→ API Server (Node/Python)
                ├── Pre-cached USGS 3DEP tiles (10m resolution)
                ├── Viewshed computation on request
                └── Returns GeoJSON + polar profile data
```

This enables 10m resolution viewsheds at 100km+ radius, which would be impractical to compute client-side due to tile volume. However, it adds hosting cost and latency. Only worth it if the 30m client-side approach proves insufficient.

-----

## Viewshed Algorithm

The algorithm is standard GIS line-of-sight raycasting. For each of N azimuth rays (360-720), step outward from the observer at the DEM's native cell resolution.

```
for each azimuth (0° to 360°):
    maxAngle = -infinity
    everOccluded = false

    for each step outward to maxRadius:
        cellElev = sample DEM at (obsLat + dy×step, obsLng + dx×step)
        angle = atan2(cellElev - obsElev, horizontalDistance)

        if angle > maxAngle:
            mark cell VISIBLE
            if everOccluded: mark cell ISLAND
            maxAngle = angle
            update horizon point
        else:
            everOccluded = true
```

Key details:

Earth curvature matters beyond ~10km. At distance d (km), the curvature drop is approximately d²/12,742 km, or about 0.8m at 10km, 7.8m at 30km, 31m at 60km. This should be subtracted from cell elevation before computing the angle. The current prototype omits curvature correction, which inflates distant visibility.

Atmospheric refraction partially counters curvature. Standard refraction coefficient is 0.13, meaning effective earth radius for LOS calculations is R×(1/(1-0.13)) ≈ R×1.15. In practice, multiply the curvature drop by 0.87.

The corrected elevation at distance d becomes:

```
effectiveElev = cellElev - (d² / (2 × R × 1.15))
```

where R = 6,371 km.

-----

## Polar Horizon Diagram

The polar diagram maps the observer's full hemispherical view to a 2D rectangle.

X-axis: azimuth, 0° (N) through 360°.
Y-axis: elevation angle from the observer's eye. 0° is horizontal. Positive values look up (mountains). Negative values look down (valleys, water).

For each azimuth ray, every sampled cell is plotted at its (azimuth, elevation angle) coordinate. Colors encode:

- Visible terrain: teal, opacity scaled by distance (near = bright, far = dim)
- Island terrain: bright cyan (visible behind occlusion)
- Occluded terrain: not drawn (gap = sky)
- Skyline: continuous line connecting the maximum visible angle per azimuth

The result looks like a panoramic photograph abstracted to its geometric essence — the skyline silhouette is the terrain horizon as you'd actually see it rotating 360°.

This serves as both a visualization product (the "view from this point") and a validation tool (does the computed skyline match what you'd actually see?).

-----

## Field Atlas Integration

The viewshed becomes a natural layer in the Field Atlas print/CNC output pipeline.

For a GPX route, compute viewshed at sampled points along the track (every 500m or at detected dwell points). The union of visible areas becomes a "what you saw" overlay — a second map layer showing the total terrain experienced on the hike.

The polar diagram could render as a strip along the bottom of a print, synchronized with the route's progress — a continuous horizon panorama of the entire hike.

Specific integration points:

1. GPX parser already identifies positions and timestamps. Add viewshed computation at each sample point.
1. DEM data is already partially in the pipeline (contour generation). The same elevation tiles serve viewshed analysis.
1. SVG composition engine can render viewshed polygons as a new layer with the existing coastal palette.
1. Dwell detection (backlog item) becomes more meaningful — at a scenic viewpoint, include the polar diagram as an inset.

-----

## Implementation Plan

### Phase 1: Core engine (Claude Code project)

Set up a Vite + React project with MapLibre GL JS. Implement Terrain RGB tile fetching and LRU caching. Port the raycasting algorithm to a Web Worker. Add earth curvature correction. Render viewshed as GeoJSON overlay on the map. Target: working viewshed on real terrain data.

### Phase 2: Polar diagram

Add the split-screen polar horizon view. Synchronize hover/click between map and polar. Add peak detection (local maxima in the skyline silhouette) with auto-labeling.

### Phase 3: Interaction polish

Drag-to-explore with debounced recomputation. Zoom slider and pan. Viewshed toggle. Observer height control. Radius control.

### Phase 4: Field Atlas integration

Add GPX route overlay. Compute viewshed at route sample points. Render cumulative visibility as a map layer. Export polar diagram strip as SVG.

-----

## Tech Stack

- MapLibre GL JS (map rendering, free/open source fork of Mapbox GL)
- AWS Terrain Tiles (elevation data — 100% free, no key, no limits)
- Web Workers (offload viewshed computation)
- Vite (build tooling)
- React (UI)
- Canvas 2D (polar diagram, terrain detail rendering)

No backend required. No API keys required. All computation is client-side. All data sources are free.

-----

## Known Limitations of the Prototype

The current sandbox prototype uses an interpolated DEM from ~80 control points. This produces smooth terrain that lacks the thousands of ridgelines, drainage channels, saddles, and micro-features that define real viewshed boundary. The algorithm is correct; the data is not.

The production version using 10m USGS data will produce genuinely accurate viewsheds. The difference will be dramatic — real terrain has far more occlusion than the smooth interpolated surface, resulting in smaller, more fragmented visible areas with pronounced islands on distant peaks.
