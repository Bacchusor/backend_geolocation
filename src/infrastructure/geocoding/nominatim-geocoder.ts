import { type Coordinates, coordinates } from "../../domain/coordinates.js";
import type { GeocodeResult } from "../../domain/geocoding.js";
import type { Geocoder } from "../../domain/ports.js";
import { fetchJson } from "./http.js";

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * OpenStreetMap Nominatim. Free, but the public instance requires an
 * identifying User-Agent and at most 1 request/second: keep the cache in front
 * of it and use a paid provider (Mapbox) once traffic grows.
 */
export class NominatimGeocoder implements Geocoder {
  readonly name = "nominatim";

  constructor(
    private readonly userAgent: string,
    private readonly baseUrl = "https://nominatim.openstreetmap.org",
    private readonly fetchImpl = fetchJson,
  ) {}

  async forward(query: string, limit: number): Promise<GeocodeResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(limit));
    const items = await this.fetchImpl<NominatimItem[]>(url.toString(), { headers: this.headers() });
    return items.map((i) => this.toResult(i));
  }

  async reverse(position: Coordinates): Promise<GeocodeResult | null> {
    const url = new URL("/reverse", this.baseUrl);
    url.searchParams.set("lat", String(position.lat));
    url.searchParams.set("lon", String(position.lng));
    url.searchParams.set("format", "jsonv2");
    const item = await this.fetchImpl<NominatimItem | { error: string }>(url.toString(), {
      headers: this.headers(),
    });
    return "error" in item ? null : this.toResult(item);
  }

  private headers(): Record<string, string> {
    return { "User-Agent": this.userAgent, Accept: "application/json" };
  }

  private toResult(i: NominatimItem): GeocodeResult {
    return {
      label: i.display_name,
      position: coordinates(Number(i.lat), Number(i.lon)),
      provider: this.name,
    };
  }
}
