import type { Trigger } from '@georeminder/shared';

export interface PlaceGeo {
  enter_radius_m: number;
  approach_radius_m: number;
  dwell_seconds: number;
}

export interface PlaceState {
  in_approach: boolean;
  in_enter: boolean;
  entered_at: Date | null;
  dwell_notified: boolean;
}

export const EMPTY_STATE: PlaceState = {
  in_approach: false,
  in_enter: false,
  entered_at: null,
  dwell_notified: false,
};

export interface StepResult {
  next: PlaceState;
  transitions: Trigger[];
  /** Tiers that were not evaluated because the fix accuracy exceeds the radius. */
  skippedTiers: Array<{ tier: 'approach' | 'enter'; reason: string }>;
}

/**
 * Pure geofence state machine for one person × place.
 * - approach: distance <= approach_radius; leaves when distance > approach_radius × hysteresis
 * - enter:    distance <= enter_radius;    leaves (exit) when distance > enter_radius × hysteresis
 * - dwell:    inside the enter radius for >= dwell_seconds (fires once per stay)
 * A fix whose accuracy exceeds a radius cannot move that tier's state.
 */
export function stepPlaceState(
  place: PlaceGeo,
  prev: PlaceState,
  distanceM: number,
  accuracyM: number,
  now: Date,
  hysteresis: number,
): StepResult {
  const next: PlaceState = { ...prev };
  const transitions: Trigger[] = [];
  const skippedTiers: StepResult['skippedTiers'] = [];

  if (accuracyM > place.approach_radius_m) {
    skippedTiers.push({
      tier: 'approach',
      reason: `accuracy ${Math.round(accuracyM)} m > approach radius`,
    });
  } else if (!prev.in_approach && distanceM <= place.approach_radius_m) {
    next.in_approach = true;
    transitions.push('approach');
  } else if (prev.in_approach && distanceM > place.approach_radius_m * hysteresis) {
    next.in_approach = false;
  }

  if (accuracyM > place.enter_radius_m) {
    skippedTiers.push({
      tier: 'enter',
      reason: `accuracy ${Math.round(accuracyM)} m > enter radius`,
    });
  } else if (!prev.in_enter && distanceM <= place.enter_radius_m) {
    next.in_enter = true;
    next.entered_at = now;
    next.dwell_notified = false;
    transitions.push('enter');
  } else if (prev.in_enter && distanceM > place.enter_radius_m * hysteresis) {
    next.in_enter = false;
    next.entered_at = null;
    next.dwell_notified = false;
    transitions.push('exit');
  }

  if (
    next.in_enter &&
    !next.dwell_notified &&
    next.entered_at &&
    place.dwell_seconds > 0 &&
    now.getTime() - next.entered_at.getTime() >= place.dwell_seconds * 1000
  ) {
    next.dwell_notified = true;
    transitions.push('dwell');
  }

  return { next, transitions, skippedTiers };
}

/** Apply a device-reported zone transition (Home Assistant zone enter/exit). */
export function forceTransition(
  prev: PlaceState,
  transition: 'enter' | 'exit',
  now: Date,
): StepResult {
  const next: PlaceState = { ...prev };
  const transitions: Trigger[] = [];
  if (transition === 'enter') {
    if (!prev.in_approach) {
      next.in_approach = true;
      transitions.push('approach');
    }
    if (!prev.in_enter) {
      next.in_enter = true;
      next.entered_at = now;
      next.dwell_notified = false;
      transitions.push('enter');
    }
  } else {
    if (prev.in_enter) transitions.push('exit');
    next.in_enter = false;
    next.in_approach = false;
    next.entered_at = null;
    next.dwell_notified = false;
  }
  return { next, transitions, skippedTiers: [] };
}
