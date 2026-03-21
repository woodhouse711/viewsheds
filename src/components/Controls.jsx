import { useState } from 'react';

const styles = {
  panel: {
    background: 'rgba(8,12,16,0.93)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
    padding: '16px',
    color: '#d0d4dc',
    fontFamily: 'monospace',
    fontSize: 13,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minWidth: 220,
  },
  label: {
    color: '#556070',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 4,
  },
  value: {
    color: '#46BAB4',
    float: 'right',
  },
  slider: {
    width: '100%',
    accentColor: '#46BAB4',
    cursor: 'pointer',
    marginTop: 4,
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    userSelect: 'none',
  },
  dot: (on) => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: on ? '#46BAB4' : '#556070',
    border: '1px solid rgba(255,255,255,0.15)',
    transition: 'background 0.2s',
  }),
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    paddingBottom: 4,
  },
  infoLabel: { color: '#556070' },
  infoValue: { color: '#d0d4dc' },
  section: { display: 'flex', flexDirection: 'column', gap: 6 },
  divider: { borderTop: '1px solid rgba(255,255,255,0.05)', margin: '2px 0' },
  title: {
    fontWeight: 'bold',
    fontSize: 14,
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

export default function Controls({
  showViewshed,
  onShowViewshed,
  showFill,
  onShowFill,
  radius,
  onRadius,
  obsHeight,
  onObsHeight,
  viewshedResult,
  computing,
}) {
  const stats = computeStats(viewshedResult, obsHeight);

  return (
    <div style={styles.panel}>
      <div style={styles.title}>VIEWSHED</div>
      <div style={styles.divider} />

      <div style={styles.section}>
        <Toggle label="Show viewshed" value={showViewshed} onChange={onShowViewshed} />
        <Toggle label="Show visible fill" value={showFill} onChange={onShowFill} />
      </div>

      <div style={styles.divider} />

      <SliderRow
        label="Radius"
        min={2}
        max={80}
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

      {stats && (
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
      )}

      {!stats && !computing && (
        <div style={{ color: '#556070', fontSize: 11 }}>
          Click the map to place an observer and compute the viewshed.
        </div>
      )}
    </div>
  );
}
