import { CHALLENGE_SIZE } from "./attestation";

/** The most paid places a release opens; later scans are recorded and earn nothing. */
export const PAID_SCANS_PER_RELEASE = 100;
/** The fewest paid places a patch release opens, so one with nothing unexamined still pays one scan. */
export const MIN_PAID_SCANS_PER_RELEASE = 1;
/**
 * The fewest paid places an `x.y.0` release opens, so scanners who turn up
 * for a new version always find paid work. Patches keep the lower floor: a
 * same-day fix would otherwise open a second full set for little new code.
 */
export const MIN_PAID_SCANS_PER_MINOR_RELEASE = 50;
/** A paid scan earns 1/1000 (0.1%) of the previous day's total holding points. */
const SCAN_REWARD_DIVISOR = 1000n;

/** What a paid scan earns on a day that issued `issuedAtomic` holding points, truncated. */
export function scanRewardOf(issuedAtomic: bigint): bigint {
  return issuedAtomic / SCAN_REWARD_DIVISOR;
}

/** Whether `release` (`x.y.z`, no `v`) is a patch, `z` above 0. */
export function isPatchRelease(release: string): boolean {
  const patch = release.split(".")[2];
  return patch !== undefined && /^\d+$/.test(patch) && patch !== "0";
}

/**
 * The paid places `release` opens when it has `unexamined` surface functions
 * no scan has examined in their current form: enough scans to answer each
 * once, within the release's floor and the cap.
 */
export function paidPlacesFor(unexamined: number, release: string): number {
  const needed = Math.ceil(Math.max(0, unexamined) / CHALLENGE_SIZE);
  const floor = isPatchRelease(release) ? MIN_PAID_SCANS_PER_RELEASE : MIN_PAID_SCANS_PER_MINOR_RELEASE;
  return Math.min(PAID_SCANS_PER_RELEASE, Math.max(floor, needed));
}

/** Each further round a wallet scans in one release earns this much more than the base reward, per round. */
export const ROUND_STEP_PERCENT = 10;

/** What round `round` (1 for a wallet's first scan of a release) earns on a place worth `baseAtomic`, truncated. */
export function roundReward(baseAtomic: bigint, round: number): bigint {
  if (!Number.isInteger(round) || round < 1) throw new Error(`A round is a whole number from 1, got ${round}.`);
  return (baseAtomic * BigInt(100 + ROUND_STEP_PERCENT * (round - 1))) / 100n;
}
