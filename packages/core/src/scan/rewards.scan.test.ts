import { describe, expect, it } from "vitest";
import { isPatchRelease, paidPlacesFor, roundReward, scanRewardOf } from "./rewards";

describe("scan rewards", () => {
  it("opens one paid place per 3 unexamined functions on a patch, from 1 to 100", () => {
    expect(paidPlacesFor(0, "1.49.1")).toBe(1);
    expect(paidPlacesFor(3, "1.49.1")).toBe(1);
    expect(paidPlacesFor(4, "1.49.1")).toBe(2);
    expect(paidPlacesFor(31, "1.49.1")).toBe(11);
    expect(paidPlacesFor(150, "1.49.1")).toBe(50);
    expect(paidPlacesFor(300, "1.49.1")).toBe(100);
    expect(paidPlacesFor(594, "1.49.1")).toBe(100);
  });

  it("opens at least 50 paid places on an x.y.0 release, at most 100", () => {
    expect(paidPlacesFor(0, "1.50.0")).toBe(50);
    expect(paidPlacesFor(149, "1.50.0")).toBe(50);
    expect(paidPlacesFor(153, "1.50.0")).toBe(51);
    expect(paidPlacesFor(594, "2.0.0")).toBe(100);
  });

  it("calls a release a patch only when its third part is above 0", () => {
    expect(isPatchRelease("1.49.1")).toBe(true);
    expect(isPatchRelease("1.43.12")).toBe(true);
    expect(isPatchRelease("1.50.0")).toBe(false);
    expect(isPatchRelease("2.0.0")).toBe(false);
    expect(isPatchRelease("1.50")).toBe(false);
  });

  it("truncates 0.1% of the day's issued points", () => {
    expect(scanRewardOf(1_243_332n)).toBe(1243n);
    expect(scanRewardOf(0n)).toBe(0n);
  });

  it("adds 10% of the base per round after the first", () => {
    expect(roundReward(1000n, 1)).toBe(1000n);
    expect(roundReward(1000n, 2)).toBe(1100n);
    expect(roundReward(1243n, 5)).toBe(1740n);
    expect(() => roundReward(1000n, 0)).toThrow();
  });
});
