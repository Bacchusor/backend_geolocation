import { describe, expect, it } from 'vitest';
import { isWithinWindow, localTime, startOfLocalDay } from './time-window.js';
import { renderMessage } from './template.js';
import { checkPlausibility, haversineM } from './plausibility.js';
import { EMPTY_STATE, forceTransition, stepPlaceState } from './geofence.js';
import { SecretBox, safeEqual } from '../crypto.js';
import { parseEwkbPoint } from '../db/geo.js';

const TZ = 'Europe/Bucharest';

describe('time window', () => {
  it('computes local time in the configured zone', () => {
    // 2026-07-01T10:30Z is 13:30 in Bucharest (UTC+3, DST), a Wednesday
    const lt = localTime(new Date('2026-07-01T10:30:00Z'), TZ);
    expect(lt).toEqual({ weekday: 3, minutes: 13 * 60 + 30 });
  });
  it('accepts inside a simple window and rejects outside', () => {
    const rule = { window_start: '09:00', window_end: '20:00', days_of_week: [1, 2, 3, 4, 5] };
    expect(isWithinWindow(rule, new Date('2026-07-01T10:30:00Z'), TZ).ok).toBe(true);
    expect(isWithinWindow(rule, new Date('2026-07-01T19:30:00Z'), TZ).ok).toBe(false); // 22:30 local
    expect(isWithinWindow(rule, new Date('2026-07-04T10:30:00Z'), TZ).ok).toBe(false); // Saturday
  });
  it('handles windows crossing midnight', () => {
    const rule = { window_start: '22:00', window_end: '06:00', days_of_week: [5] }; // Friday night
    expect(isWithinWindow(rule, new Date('2026-07-03T20:00:00Z'), TZ).ok).toBe(true); // Fri 23:00
    expect(isWithinWindow(rule, new Date('2026-07-04T01:00:00Z'), TZ).ok).toBe(true); // Sat 04:00 (belongs to Fri window)
    expect(isWithinWindow(rule, new Date('2026-07-04T05:00:00Z'), TZ).ok).toBe(false); // Sat 08:00
  });
  it('no window means all day on listed days', () => {
    expect(
      isWithinWindow(
        { window_start: null, window_end: null, days_of_week: [3] },
        new Date('2026-07-01T10:30:00Z'),
        TZ,
      ).ok,
    ).toBe(true);
    expect(
      isWithinWindow(
        { window_start: null, window_end: null, days_of_week: [4] },
        new Date('2026-07-01T10:30:00Z'),
        TZ,
      ).ok,
    ).toBe(false);
  });
  it('startOfLocalDay returns local midnight', () => {
    const d = startOfLocalDay(new Date('2026-07-01T10:30:15Z'), TZ);
    expect(d.toISOString()).toBe('2026-06-30T21:00:00.000Z');
  });
});

describe('message template', () => {
  const items = [
    { name: 'Milk', category: 'Kitchen' },
    { name: 'Soap', category: 'Bathroom' },
    { name: 'Bread', category: 'Kitchen' },
  ];
  it('renders placeholders', () => {
    const msg = renderMessage('{count} items for {shop}: {items}', {
      count: 3,
      shop: 'Lidl',
      place: 'Lidl Titan',
      person: 'alex',
      items,
      groupByCategory: false,
    });
    expect(msg).toBe('3 items for Lidl: Milk, Soap, Bread');
  });
  it('groups by category', () => {
    const msg = renderMessage('{items}', {
      count: 3,
      shop: 'Lidl',
      place: 'p',
      person: 'a',
      items,
      groupByCategory: true,
    });
    expect(msg).toBe('Kitchen: Milk, Bread · Bathroom: Soap');
  });
  it('keeps unknown placeholders', () => {
    expect(
      renderMessage('{nope} {place}', {
        count: 0,
        shop: '',
        place: 'X',
        person: 'a',
        items: [],
        groupByCategory: false,
      }),
    ).toBe('{nope} X');
  });
});

describe('plausibility', () => {
  const now = new Date('2026-07-01T10:00:00Z');
  const opts = { maxSpeedMps: 100, maxFixAgeHours: 24, now };
  it('haversine is roughly right', () => {
    // Bucharest -> Cluj ~ 324 km
    expect(haversineM(44.4268, 26.1025, 46.7712, 23.6236)).toBeGreaterThan(320_000);
    expect(haversineM(44.4268, 26.1025, 46.7712, 23.6236)).toBeLessThan(330_000);
  });
  it('rejects future and stale fixes', () => {
    const fix = { lat: 0, lng: 0, accuracy_m: 10, recorded_at: new Date('2026-07-01T11:00:00Z') };
    expect(checkPlausibility(null, fix, opts).ok).toBe(false);
    expect(
      checkPlausibility(null, { ...fix, recorded_at: new Date('2026-06-29T00:00:00Z') }, opts).ok,
    ).toBe(false);
  });
  it('rejects out-of-order fixes', () => {
    const prev = { lat: 0, lng: 0, recorded_at: new Date('2026-07-01T09:59:00Z') };
    const fix = { lat: 0, lng: 0, accuracy_m: 10, recorded_at: new Date('2026-07-01T09:58:00Z') };
    expect(checkPlausibility(prev, fix, opts)).toEqual({
      ok: false,
      reason: 'out of order: older than current position',
    });
  });
  it('rejects implausible jumps within the velocity window but accepts after a long gap', () => {
    const prev = { lat: 44.4268, lng: 26.1025, recorded_at: new Date('2026-07-01T09:50:00Z') };
    const fix = {
      lat: 46.7712,
      lng: 23.6236,
      accuracy_m: 10,
      recorded_at: new Date('2026-07-01T09:55:00Z'),
    };
    expect(checkPlausibility(prev, fix, opts).ok).toBe(false);
    const later = { ...fix, recorded_at: new Date('2026-07-01T09:59:00Z') };
    const prevOld = { ...prev, recorded_at: new Date('2026-07-01T07:00:00Z') };
    expect(checkPlausibility(prevOld, later, opts).ok).toBe(true);
  });
});

describe('geofence state machine', () => {
  const place = { enter_radius_m: 100, approach_radius_m: 500, dwell_seconds: 60 };
  const t0 = new Date('2026-07-01T10:00:00Z');
  it('fires approach then enter, with hysteresis on the way out', () => {
    let s = stepPlaceState(place, EMPTY_STATE, 450, 20, t0, 1.25);
    expect(s.transitions).toEqual(['approach']);
    s = stepPlaceState(place, s.next, 80, 20, t0, 1.25);
    expect(s.transitions).toEqual(['enter']);
    // 110 m is outside enter radius but inside the 125 m hysteresis band: no exit
    s = stepPlaceState(place, s.next, 110, 20, t0, 1.25);
    expect(s.transitions).toEqual([]);
    expect(s.next.in_enter).toBe(true);
    s = stepPlaceState(place, s.next, 130, 20, t0, 1.25);
    expect(s.transitions).toEqual(['exit']);
    expect(s.next.in_approach).toBe(true);
    s = stepPlaceState(place, s.next, 640, 20, t0, 1.25);
    expect(s.next.in_approach).toBe(false);
  });
  it('fires dwell once after dwell_seconds inside', () => {
    let s = stepPlaceState(place, EMPTY_STATE, 50, 10, t0, 1.25);
    expect(s.transitions).toEqual(['approach', 'enter']);
    s = stepPlaceState(place, s.next, 50, 10, new Date(t0.getTime() + 30_000), 1.25);
    expect(s.transitions).toEqual([]);
    s = stepPlaceState(place, s.next, 50, 10, new Date(t0.getTime() + 61_000), 1.25);
    expect(s.transitions).toEqual(['dwell']);
    s = stepPlaceState(place, s.next, 50, 10, new Date(t0.getTime() + 120_000), 1.25);
    expect(s.transitions).toEqual([]);
  });
  it('ignores a tier when accuracy exceeds its radius', () => {
    const s = stepPlaceState(place, EMPTY_STATE, 50, 150, t0, 1.25);
    expect(s.transitions).toEqual(['approach']);
    expect(s.skippedTiers.map((x) => x.tier)).toEqual(['enter']);
  });
  it('applies device zone transitions directly', () => {
    const e = forceTransition(EMPTY_STATE, 'enter', t0);
    expect(e.transitions).toEqual(['approach', 'enter']);
    const x = forceTransition(e.next, 'exit', t0);
    expect(x.transitions).toEqual(['exit']);
    expect(x.next).toEqual(EMPTY_STATE);
  });
});

describe('crypto', () => {
  it('round-trips and rejects tampering', () => {
    const box = new SecretBox('0'.repeat(64));
    const enc = box.encrypt('secret-token');
    expect(box.decrypt(enc)).toBe('secret-token');
    const tampered = Buffer.from(enc, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => box.decrypt(tampered.toString('base64'))).toThrow();
  });
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});

describe('ewkb', () => {
  it('parses a PostGIS point (lng 26.1025, lat 44.4268)', () => {
    // Little-endian EWKB point with SRID flag (0x20000001), SRID 4326, x=lng, y=lat
    const buf = Buffer.alloc(25);
    buf.writeUInt8(1, 0);
    buf.writeUInt32LE(0x20000001, 1);
    buf.writeUInt32LE(4326, 5);
    buf.writeDoubleLE(26.1025, 9);
    buf.writeDoubleLE(44.4268, 17);
    const p = parseEwkbPoint(buf.toString('hex'));
    expect(p.lng).toBeCloseTo(26.1025, 4);
    expect(p.lat).toBeCloseTo(44.4268, 4);
  });
});
