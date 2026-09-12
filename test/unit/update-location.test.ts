import { beforeEach, describe, expect, it } from "vitest";
import { UpdateLocation } from "../../src/application/update-location.js";
import { coordinates } from "../../src/domain/coordinates.js";
import { ValidationError } from "../../src/domain/errors.js";
import { DEFAULT_FIX_POLICY, locationFix } from "../../src/domain/location.js";
import { FakeClock, InMemoryLocationRepository } from "../helpers/in-memory.js";

const now = new Date("2026-09-12T10:00:00Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);
const user = "11111111-1111-4111-8111-111111111111";

describe("UpdateLocation", () => {
  let repo: InMemoryLocationRepository;
  let useCase: UpdateLocation;

  beforeEach(() => {
    repo = new InMemoryLocationRepository();
    useCase = new UpdateLocation(repo, DEFAULT_FIX_POLICY, new FakeClock(now), 5);
  });

  it("stores a single fix as current and in history", async () => {
    const fix = locationFix({ position: coordinates(48.85, 2.35), accuracyM: 10, recordedAt: secondsAgo(5) });
    const res = await useCase.execute(user, [fix]);
    expect(res.accepted).toBe(1);
    expect(res.rejected).toEqual([]);
    expect(res.current?.position).toEqual(fix.position);
    expect(await repo.listHistory(user, 10)).toHaveLength(1);
  });

  it("promotes the newest acceptable fix from an out-of-order batch", async () => {
    const older = locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(60) });
    const newest = locationFix({ position: coordinates(48.851, 2.351), recordedAt: secondsAgo(5) });
    const middle = locationFix({ position: coordinates(48.8505, 2.3505), recordedAt: secondsAgo(30) });
    const res = await useCase.execute(user, [older, newest, middle]);
    expect(res.currentUpdated).toBe(true);
    expect(res.current?.position).toEqual(newest.position);
    expect(res.accepted).toBe(3);
    expect(await repo.listHistory(user, 10)).toHaveLength(3);
  });

  it("archives a stale fix without changing the current position", async () => {
    const first = locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(10) });
    await useCase.execute(user, [first]);
    const stale = locationFix({ position: coordinates(48.86, 2.36), recordedAt: secondsAgo(3600) });
    const res = await useCase.execute(user, [stale]);
    expect(res.currentUpdated).toBe(false);
    expect(res.current?.position).toEqual(first.position);
    expect(res.accepted).toBe(1);
    expect(res.rejected).toEqual([]);
    expect(await repo.listHistory(user, 10)).toHaveLength(2);
  });

  it("drops untrustworthy fixes and keeps the current position", async () => {
    const first = locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(10) });
    await useCase.execute(user, [first]);
    const future = locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(-600) });
    const res = await useCase.execute(user, [future]);
    expect(res.currentUpdated).toBe(false);
    expect(res.accepted).toBe(0);
    expect(res.rejected).toEqual([{ index: 0, reason: expect.stringMatching(/future/) }]);
    expect(await repo.listHistory(user, 10)).toHaveLength(1);
  });

  it("reports the index of each rejected fix and still accepts a later valid one", async () => {
    const teleport = locationFix({ position: coordinates(51.5, -0.12), recordedAt: secondsAgo(1) });
    const valid = locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(2) });
    await useCase.execute(user, [locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(30) })]);
    const res = await useCase.execute(user, [teleport, valid]);
    expect(res.rejected).toEqual([{ index: 0, reason: expect.stringMatching(/implausible/) }]);
    expect(res.current?.position).toEqual(valid.position);
  });

  it("enforces the batch size", async () => {
    const fixes = Array.from({ length: 6 }, (_, i) =>
      locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(i) }),
    );
    await expect(useCase.execute(user, fixes)).rejects.toThrow(ValidationError);
    await expect(useCase.execute(user, [])).rejects.toThrow(ValidationError);
  });

  it("isolates users", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    await useCase.execute(user, [locationFix({ position: coordinates(48.85, 2.35), recordedAt: secondsAgo(1) })]);
    expect(await repo.getCurrent(other)).toBeNull();
  });
});
