import { FALLBACK_GATEWAY_URLS } from "../packages/core/src/arweave/first-run-gateway";
import {
  COMMUNITY_HYPERBEAM_PEER_URLS,
  DEFAULT_BUNDLER_URL,
  DEFAULT_HYPERBEAM_PEER_URLS,
  L1_TOKEN_NODE_URLS,
  POINTS_API_URL,
} from "../packages/core/src/models/network";

/**
 * Every host the built extension may contact during `egress.e2e.ts`. A host
 * added here is a reviewed change: this file is on the security surface.
 */
export const EGRESS_HOSTS: ReadonlySet<string> = new Set(
  [
    "https://arweave.net",
    "https://gleamwallet.app",
    DEFAULT_BUNDLER_URL,
    POINTS_API_URL,
    ...FALLBACK_GATEWAY_URLS,
    ...DEFAULT_HYPERBEAM_PEER_URLS,
    ...COMMUNITY_HYPERBEAM_PEER_URLS,
    ...L1_TOKEN_NODE_URLS,
  ].map((url) => new URL(url).host),
);
