// @ts-check
// Checks that the invite-link host serves the files iOS and Android fetch
// to verify the app may open its links. Run from release-all only: the
// release workflow blocks egress to this host.

import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const FILES = ["apple-app-site-association", "assetlinks.json"];

// The repo copies, resolved from this file so the check does not depend on
// the working directory. A stale or wrong deployment must fail even when
// it serves valid JSON with the right content type.
/** @param {string} file */
const repoFile = (file) => new URL(`../apps/site-open/.well-known/${file}`, import.meta.url);

/**
 * Returns a list of problems; empty means both files are served correctly.
 * Redirects count as problems because the platforms refuse to follow them.
 * The timeout keeps a dropped connection from hanging release-all.
 * @param {{ fetchImpl?: typeof fetch, host?: string, readRepoFile?: (file: string) => Promise<string> }} [opts]
 * @returns {Promise<string[]>}
 */
export async function checkWellKnown({
  fetchImpl = globalThis.fetch,
  host = "open.gleamwallet.app",
  readRepoFile = (file) => readFile(repoFile(file), "utf8"),
} = {}) {
  const problems = [];
  for (const file of FILES) {
    const url = `https://${host}/.well-known/${file}`;
    let expected;
    try {
      expected = JSON.parse(await readRepoFile(file));
    } catch (e) {
      problems.push(`${url}: cannot read the repo copy of ${file} (${/** @type {Error} */ (e).message})`);
      continue;
    }
    try {
      const res = await fetchImpl(url, { redirect: "manual", signal: globalThis.AbortSignal.timeout(10_000) });
      if (res.status !== 200) {
        problems.push(`${url}: status ${res.status}, expected 200`);
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("application/json")) problems.push(`${url}: content-type "${type}", expected application/json`);
      let served;
      try {
        served = JSON.parse(await res.text());
      } catch {
        problems.push(`${url}: body is not JSON`);
        continue;
      }
      if (!isDeepStrictEqual(served, expected)) {
        problems.push(`${url}: served content differs from the repo copy of ${file}`);
      }
    } catch (e) {
      problems.push(`${url}: ${/** @type {Error} */ (e).message}`);
    }
  }
  return problems;
}
