import { describe, expect, it } from 'vitest';
import { locationFixSchema, placeInputSchema, ruleInputSchema, roundCoord } from './index.js';

const ts = '2026-01-01T00:00:00Z';

describe('shared schemas', () => {
  it('validates coordinate ranges and accuracy', () => {
    expect(
      locationFixSchema.safeParse({ person: 'alex', lat: 91, lng: 0, recorded_at: ts }).success,
    ).toBe(false);
    expect(
      locationFixSchema.safeParse({ person: 'alex', lat: 0, lng: -181, recorded_at: ts }).success,
    ).toBe(false);
    expect(
      locationFixSchema.safeParse({
        person: 'alex',
        lat: 44.4,
        lng: 26.1,
        accuracy_m: -1,
        recorded_at: ts,
      }).success,
    ).toBe(false);
    const ok = locationFixSchema.parse({ person: 'alex', lat: 44.4, lng: 26.1, recorded_at: ts });
    expect(ok.accuracy_m).toBe(0);
  });

  it('requires approach radius >= enter radius', () => {
    expect(
      placeInputSchema.safeParse({
        name: 'x',
        lat: 0,
        lng: 0,
        enter_radius_m: 500,
        approach_radius_m: 100,
      }).success,
    ).toBe(false);
    expect(placeInputSchema.safeParse({ name: 'x', lat: 0, lng: 0 }).success).toBe(true);
  });

  it('requires exactly one of place or group on rules', () => {
    const base = { name: 'r', trigger: 'approach' };
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '11111111-1111-4111-8111-111111111112';
    expect(ruleInputSchema.safeParse(base).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, place_id: a }).success).toBe(true);
    expect(ruleInputSchema.safeParse({ ...base, place_id: a, place_group_id: b }).success).toBe(
      false,
    );
  });

  it('rounds coordinates to 3 decimals by default', () => {
    expect(roundCoord(44.4267674)).toBe(44.427);
  });
});
