import { type Coordinates, coordinates } from "../../domain/coordinates.js";
import type { GeocodeResult } from "../../domain/geocoding.js";
import type { Geocoder } from "../../domain/ports.js";
import { fetchJson } from "./http.js";

interface MapboxFeature {
  place_name: string;
  center: [number, number]; // [lng, lat]
}
interface MapboxResponse {
  features: MapboxFeature[];
}

/** Mapbox Geocoding API v5. Results must be cached per Mapbox ToS (temporary caching allowed). */
export class MapboxGeocoder implements Geocoder {
  readonly name = "mapbox";

  constructor(
    private readonly accessToken: string,
    private readonly baseUrl = "https://api.mapbox.com/geocoding/v5/mapbox.places",
    private readonly fetchImpl = fetchJson,
  ) {}

  async forward(query: string, limit: number): Promise<GeocodeResult[]> {
    const url = new URL(`${this.baseUrl}/${encodeURIComponent(query)}.json`);
    url.searchParams.set("access_token", this.accessToken);
    url.searchParams.set("limit", String(limit));
    const res = await this.fetchImpl<MapboxResponse>(url.toString());
    return res.features.map((f) => this.toResult(f));
  }

  async reverse(position: Coordinates): Promise<GeocodeResult | null> {
    const url = new URL(`${this.baseUrl}/${position.lng},${position.lat}.json`);
    url.searchParams.set("access_token", this.accessToken);
    url.searchParams.set("limit", "1");
    const res = await this.fetchImpl<MapboxResponse>(url.toString());
    const first = res.features[0];
    return first ? this.toResult(first) : null;
  }

  private toResult(f: MapboxFeature): GeocodeResult {
    return { label: f.place_name, position: coordinates(f.center[1], f.center[0]), provider: this.name };
  }
}
