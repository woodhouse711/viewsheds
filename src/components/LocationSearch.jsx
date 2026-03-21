import { useState, useRef } from 'react';

const ACCENT = '#46BAB4';
const LABEL_COLOR = '#556070';

// Accept "lat, lng" (Google Maps copy format), "lat lng", or decimal with any separator
function parseLatLng(text) {
  const m = text.trim().match(/^(-?\d{1,3}\.?\d*)[,\s]+(-?\d{1,3}\.?\d*)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export default function LocationSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setError(null);

    // Try coordinate parse first
    const coords = parseLatLng(q);
    if (coords) {
      onSelect(coords);
      setQuery('');
      inputRef.current?.blur();
      return;
    }

    // Geocode with Nominatim
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (data.length > 0) {
        onSelect({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
        setQuery('');
        inputRef.current?.blur();
      } else {
        setError('Not found');
      }
    } catch {
      setError('Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, maxWidth: 320 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setError(null); }}
        placeholder="Search location or paste lat, lng…"
        style={{
          flex: 1,
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${error ? 'rgba(255,80,80,0.45)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 4,
          color: '#d0d4dc',
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '3px 8px',
          outline: 'none',
          minWidth: 0,
        }}
        onFocus={(e) => { e.target.style.borderColor = `${ACCENT}60`; }}
        onBlur={(e) => { e.target.style.borderColor = error ? 'rgba(255,80,80,0.45)' : 'rgba(255,255,255,0.1)'; }}
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        style={{
          background: 'none',
          border: `1px solid ${ACCENT}40`,
          borderRadius: 4,
          color: loading ? LABEL_COLOR : ACCENT,
          fontFamily: 'monospace',
          fontSize: 12,
          padding: '3px 8px',
          cursor: loading || !query.trim() ? 'default' : 'pointer',
          flexShrink: 0,
        }}
      >
        {loading ? '…' : '→'}
      </button>
      {error && (
        <span style={{ color: 'rgba(255,100,100,0.9)', fontSize: 10, flexShrink: 0 }}>{error}</span>
      )}
    </form>
  );
}
