import { useState } from 'react';

const styles = {
  panel: {
    background: 'rgba(8,12,16,0.93)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#d0d4dc',
    fontFamily: 'monospace',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 210,
  },
  label: {
    color: '#556070',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: 2,
  },
  value: {
    color: '#46BAB4',
    float: 'right',
  },
  slider: {
    width: '100%',
    accentColor: '#46BAB4',
    cursor: 'pointer',
    marginTop: 2,
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    cursor: 'pointer',
    userSelect: 'none',
  },
  dot: (on) => ({
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: on ? '#46BAB4' : '#556070',
    border: '1px solid rgba(255,255,255,0.15)',
    transition: 'background 0.2s',
    flexShrink: 0,
  }),
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    paddingBottom: 2,
    gap: 6,
  },
  infoLabel: { color: '#556070', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  infoValue: { color: '#d0d4dc', fontSize: 11, flexShrink: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  divider: { borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1px 0' },
  title: {
    fontWeight: 'bold',
    fontSize: 13,
    color: '#d0d4dc',
    letterSpacing: '0.05em',
  },
};

function Toggle({ label, value, onChange }) {
  return (
    <div style={styles.toggle} onClick={() => onChange(!value)}>
      <div style={styles.dot(value)} />
      <span style={{ color: value ? '#d0d4dc' : '#556070' }}>{label}</span>
    </div>
  );
}

function SliderRow({ label, min, max, step, value, onChange, unit }) {
  return (
    <div style={styles.section}>
      <div style={styles.label}>
        {label} <span style={styles.value}>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={styles.slider}
      />
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{value}</span>
    </div>
  );
}

function computeStats(viewshedResult, obsHeight) {
  if (!viewshedResult || !viewshedResult.rays) return null;
  const { rays, obsElev } = viewshedResult;
  const horizonDists = rays.map((r) => r.horizonDist).filter((d) => d > 0);
  const maxDist = horizonDists.length ? Math.max(...horizonDists).toFixed(1) : '—';
  const avgDist =
    horizonDists.length
      ? (horizonDists.reduce((a, b) => a + b, 0) / horizonDists.length).toFixed(1)
      : '—';

  let islandCount = 0;
  let visibleCount = 0;
  let totalCount = 0;
  rays.forEach((r) => {
    r.samples.forEach((s) => {
      totalCount++;
      if (s.visible) visibleCount++;
      if (s.isIsland) islandCount++;
    });
  });

  return {
    elevation: obsElev != null ? `${obsElev.toFixed(0)} m` : '—',
    observerHeight: `${obsHeight} m`,
    maxHorizon: maxDist !== '—' ? `${maxDist} km` : '—',
    avgHorizon: avgDist !== '—' ? `${avgDist} km` : '—',
    visiblePct: totalCount ? `${((visibleCount / totalCount) * 100).toFixed(0)}%` : '—',
    islandPoints: islandCount,
  };
}

function buildLocation(locationInfo) {
  if (!locationInfo) return null;
  const a = locationInfo;
  // Settlement name: try increasingly rural fallbacks
  const place =
    a.city || a.town || a.village || a.hamlet || a.suburb || a.neighbourhood;
  // Protected / managed land names
  const managed =
    a.national_park || a.nature_reserve || a.forest || a.protected_area ||
    a.leisure || a.boundary;
  const county = a.county;
  const state   = a.state || a.province || a.region;
  const country = a.country;
  return { place, managed, county, state, country };
}

export default function Controls({
  showViewshed,
  onShowViewshed,
  showFill,
  onShowFill,
  fillOpacity,
  onFillOpacity,
  showTopo,
  onShowTopo,
  radius,
  onRadius,
  obsHeight,
  onObsHeight,
  viewshedResult,
  computing,
  observer,
  locationInfo,
  peaks,
}) {
  const stats = computeStats(viewshedResult, obsHeight);
  const loc = buildLocation(locationInfo);

  return (
    <div style={styles.panel}>
      <div style={styles.title}>VIEWSHED</div>
      <div style={styles.divider} />

      <div style={styles.section}>
        <Toggle label="Show viewshed" value={showViewshed} onChange={onShowViewshed} />
        <Toggle label="Show visible fill" value={showFill} onChange={onShowFill} />
        {showFill && (
          <div style={{ paddingLeft: 18 }}>
            <SliderRow
              label="Fill opacity"
              min={3}
              max={60}
              step={3}
              value={Math.round(fillOpacity * 100)}
              onChange={(v) => onFillOpacity(v / 100)}
              unit="%"
            />
          </div>
        )}
        <Toggle label="Topo / contours" value={showTopo} onChange={onShowTopo} />
      </div>

      <div style={styles.divider} />

      <SliderRow
        label="Radius"
        min={2}
        max={150}
        step={1}
        value={radius}
        onChange={onRadius}
        unit=" km"
      />
      <SliderRow
        label="Observer height"
        min={0}
        max={100}
        step={1}
        value={obsHeight}
        onChange={onObsHeight}
        unit=" m"
      />

      <div style={styles.divider} />

      {computing && (
        <div style={{ color: '#46BAB4', fontSize: 11 }}>⟳ Computing…</div>
      )}

      {/* Location */}
      {observer && (
        <div style={styles.section}>
          <div style={styles.label}>Location</div>
          <InfoRow label="Lat" value={`${observer.lat.toFixed(5)}°`} />
          <InfoRow label="Lng" value={`${observer.lng.toFixed(5)}°`} />
          {loc && (
            <>
              {(loc.place || loc.managed) && (
                <InfoRow
                  label={loc.managed && !loc.place ? 'Area' : 'Place'}
                  value={loc.place || loc.managed}
                />
              )}
              {loc.managed && loc.place && (
                <InfoRow label="Area" value={loc.managed} />
              )}
              {loc.county && !loc.place && !loc.managed && (
                <InfoRow label="County" value={loc.county} />
              )}
              {loc.state && <InfoRow label="State/Prov" value={loc.state} />}
              {loc.country && <InfoRow label="Country" value={loc.country} />}
            </>
          )}
        </div>
      )}

      {/* Peaks found in viewshed area */}
      {peaks && peaks.length > 0 && (
        <>
          <div style={styles.divider} />
          <div style={styles.section}>
            <div style={styles.label}>Peaks ≥ 2500 m</div>
            {peaks.slice(0, 12).map((p, i) => (
              <InfoRow
                key={i}
                label={p.name}
                value={`${Math.round(p.ele).toLocaleString()} m`}
              />
            ))}
          </div>
        </>
      )}

      {/* Viewshed stats */}
      {stats && (
        <>
          <div style={styles.divider} />
          <div style={styles.section}>
            <div style={styles.label}>Observer</div>
            <InfoRow label="Ground elevation" value={stats.elevation} />
            <InfoRow label="Eye height" value={stats.observerHeight} />
            <div style={{ ...styles.label, marginTop: 6 }}>Horizon</div>
            <InfoRow label="Max distance" value={stats.maxHorizon} />
            <InfoRow label="Avg distance" value={stats.avgHorizon} />
            <InfoRow label="Visible rays" value={stats.visiblePct} />
            <InfoRow label="Island points" value={stats.islandPoints} />
          </div>
        </>
      )}

      {!stats && !computing && (
        <div style={{ color: '#556070', fontSize: 11 }}>
          Click the map to place an observer and compute the viewshed.
        </div>
      )}
    </div>
  );
}
