import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Place, PersonLocation } from '@georeminder/shared';
import { api } from '../api';

const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [TILE_URL],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** GeoJSON polygon approximating a circle of `radiusM` metres. */
function circle(
  lng: number,
  lat: number,
  radiusM: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export interface Draft {
  lat: number;
  lng: number;
  enter_radius_m: number;
  approach_radius_m: number;
  color: string;
}

interface Props {
  places: Place[];
  persons?: PersonLocation[];
  selectedId: string | null;
  draft: Draft | null;
  onSelect: (place: Place) => void;
  onMapClick: (lat: number, lng: number) => void;
}

export function MapView({ places, persons = [], selectedId, draft, onSelect, onMapClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onMapClick);
  useEffect(() => {
    clickRef.current = onMapClick;
  }, [onMapClick]);

  // Init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const first = places[0];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: first ? [first.lng, first.lat] : [26.1025, 44.4268],
      zoom: first ? 13 : 11,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource('radii', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'radii-fill',
        type: 'fill',
        source: 'radii',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
      });
      map.addLayer({
        id: 'radii-line',
        type: 'line',
        source: 'radii',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-dasharray': ['get', 'dash'],
        },
      });
      setReady(true);
    });
    map.on('click', (e) => clickRef.current(e.lngLat.lat, e.lngLat.lng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers + radii
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const features: GeoJSON.Feature[] = [];
    const addRadii = (
      lng: number,
      lat: number,
      enter: number,
      approach: number,
      color: string,
      strong: boolean,
    ) => {
      features.push({
        ...circle(lng, lat, approach),
        properties: { color, opacity: strong ? 0.12 : 0.05, dash: [4, 3] },
      });
      features.push({
        ...circle(lng, lat, enter),
        properties: { color, opacity: strong ? 0.25 : 0.12, dash: [1, 0] },
      });
    };
    for (const p of places) {
      const el = document.createElement('div');
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${p.color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);cursor:pointer;opacity:${p.active ? 1 : 0.4}`;
      el.title = p.name;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelect(p);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      markersRef.current.push(marker);
      if (!draft || p.id !== selectedId)
        addRadii(p.lng, p.lat, p.enter_radius_m, p.approach_radius_m, p.color, p.id === selectedId);
    }
    for (const person of persons) {
      const el = document.createElement('div');
      el.style.cssText = 'font-size:18px;cursor:default';
      el.textContent = '🧍';
      el.title = `${person.person} · ${new Date(person.recorded_at).toLocaleString()}`;
      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([person.lng, person.lat]).addTo(map),
      );
    }
    if (draft) {
      const el = document.createElement('div');
      el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${draft.color};border:3px solid #fff;box-shadow:0 0 0 2px ${draft.color}`;
      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([draft.lng, draft.lat]).addTo(map),
      );
      addRadii(
        draft.lng,
        draft.lat,
        draft.enter_radius_m,
        draft.approach_radius_m,
        draft.color,
        true,
      );
    }
    (map.getSource('radii') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    });
  }, [places, persons, selectedId, draft, ready, onSelect]);

  // Fly to selection
  useEffect(() => {
    const map = mapRef.current;
    const p = places.find((x) => x.id === selectedId);
    if (map && p) map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [selectedId, places]);

  return (
    <div className="map-wrap">
      <AddressSearch
        onPick={(lat, lng) => mapRef.current?.flyTo({ center: [lng, lat], zoom: 15 })}
      />
      <div ref={containerRef} className="map" />
    </div>
  );
}

function AddressSearch({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ display_name: string; lat: number; lng: number }>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setResults((await api.geocode(q)).items);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="map-search">
      <input
        placeholder="Search address (Nominatim)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void search()}
        disabled={busy}
      />
      {results.length > 0 && (
        <div className="results">
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => {
                onPick(r.lat, r.lng);
                setResults([]);
              }}
            >
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
