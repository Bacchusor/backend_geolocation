import { sql, type SQL } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Parse the hex EWKB PostGIS returns for a geography(Point) column. */
export function parseEwkbPoint(hex: string): LatLng {
  const buf = Buffer.from(hex, 'hex');
  const little = buf.readUInt8(0) === 1;
  const type = little ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  const hasSrid = (type & 0x20000000) !== 0;
  let offset = 5 + (hasSrid ? 4 : 0);
  const x = little ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  offset += 8;
  const y = little ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
  return { lat: y, lng: x };
}

export const geographyPoint = customType<{ data: LatLng; driverData: string; config: undefined }>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(value: LatLng): SQL {
    return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`;
  },
  fromDriver(value: string): LatLng {
    return parseEwkbPoint(value);
  },
});

/** SQL fragment for a geography point from lat/lng parameters (lng first!). */
export const geoPoint = (lat: number, lng: number): SQL =>
  sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
