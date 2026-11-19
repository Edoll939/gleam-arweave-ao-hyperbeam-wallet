import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EGRESS_HOSTS } from "./egress-hosts";

/**
 * Runs the flows that handle plaintext key material in the built extension
 * and checks every request it makes, the background worker's included.
 * The host list is the real check. The byte check only catches a key or
 * password sent by accident: an attacker who encodes it first passes it.
 */
const extensionPath = fileURLToPath(new URL("../apps/extension/.output/chrome-mv3", import.meta.url));
const PASSWORD = "correct horse battery staple 42";

interface Sent {
  url: string;
  body: Buffer | null;
}

interface Harness {
  context: BrowserContext;
  page: Page;
  downloadsPath: string;
  sent: Sent[];
  blocked: string[];
  cleanup: () => Promise<void>;
}

/** Loads a copy of the build that grants `downloads`, which Playwright can't approve at runtime. */
async function launch(): Promise<Harness> {
  if (!existsSync(extensionPath)) {
    throw new Error(`No build at ${extensionPath}; run \`pnpm wxt:build\` first.`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "gleam-egress-"));
  const downloadsPath = join(scratch, "downloads");
  const path = join(scratch, "extension");
  cpSync(extensionPath, path, { recursive: true });
  const manifestPath = join(path, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { permissions: string[] };
  manifest.permissions.push("downloads");
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    acceptDownloads: true,
    downloadsPath,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  const sent: Sent[] = [];
  const blocked: string[] = [];
  // Deny by default; allowed hosts get an empty stub so the test needs no network.
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "chrome-extension:") return route.continue();
    sent.push({ url: request.url(), body: request.postDataBuffer() });
    if (url.protocol !== "https:" || !EGRESS_HOSTS.has(url.host)) {
      blocked.push(request.url());
      return route.abort();
    }
    return route.fulfill({ status: 404, body: "" });
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/passkey.html?mode=setup`);
  return {
    context,
    page,
    downloadsPath,
    sent,
    blocked,
    cleanup: async () => {
      await context.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

/** Calls a background method the way `@webext-core/messaging` does. */
function call(page: Page, type: string, data?: unknown): Promise<unknown> {
  return page.evaluate(
    ([type, data]) =>
      new Promise((resolve, reject) =>
        chrome.runtime.sendMessage({ id: Date.now(), type, data, timestamp: Date.now() }, (reply) =>
          reply?.err ? reject(new Error(reply.err.message)) : resolve(reply?.res),
        ),
      ),
    [type, data] as const,
  );
}

async function exportKeyfile(harness: Harness, walletId: string): Promise<Record<string, string>> {
  await call(harness.page, "downloadKeyfile", { walletId, password: PASSWORD });
  let keyfile: Record<string, string> | undefined;
  await expect
    .poll(() => {
      if (!existsSync(harness.downloadsPath)) return false;
      for (const name of readdirSync(harness.downloadsPath)) {
        try {
          const parsed = JSON.parse(readFileSync(join(harness.downloadsPath, name), "utf8")) as Record<string, string>;
          if (parsed.kty === "RSA") keyfile = parsed;
        } catch {
          // Still being written.
        }
      }
      return keyfile !== undefined;
    })
    .toBe(true);
  return keyfile!;
}

/** Text and byte forms of each secret, cut to a slice so a partial leak still matches. */
function needles(keyfile: Record<string, string>): { text: string[]; bytes: Buffer[] } {
  const secrets = [...["d", "p", "q"].map((field) => Buffer.from(keyfile[field]!, "base64url")), Buffer.from(PASSWORD)];
  const text = secrets.flatMap((bytes) =>
    [bytes.toString("base64url"), bytes.toString("base64"), bytes.toString("hex")].map((s) => s.slice(0, 24)),
  );
  text.push(PASSWORD, encodeURIComponent(PASSWORD));
  return { text, bytes: secrets.map((bytes) => bytes.subarray(0, 16)) };
}

function leaks(sent: Sent[], keyfile: Record<string, string>): string[] {
  const { text, bytes } = needles(keyfile);
  return sent.flatMap(({ url, body }) => {
    const haystack = decodeURIComponent(url) + (body ? body.toString("latin1") : "");
    const hit = text.some((needle) => url.includes(needle) || haystack.includes(needle)) || bytes.some((b) => body?.includes(b));
    return hit ? [url] : [];
  });
}

test("key flows contact only listed hosts and send no key or password", async () => {
  test.setTimeout(120_000);
  const first = await launch();
  const second = await launch();
  try {
    // Generate, export, lock, unlock.
    const created = (await call(first.page, "createWallet", { name: "Egress", password: PASSWORD })) as { id: string };
    const keyfile = await exportKeyfile(first, created.id);
    await call(first.page, "lockWallet");
    await call(first.page, "unlockWallet", { password: PASSWORD });

    // Import the same key into a fresh install, then lock and unlock it.
    await call(second.page, "importWallet", { jwk: keyfile, name: "Egress", password: PASSWORD });
    await call(second.page, "lockWallet");
    await call(second.page, "unlockWallet", { password: PASSWORD });

    // Let background work the flows started (balance reads, peer checks) send.
    await first.page.waitForTimeout(3000);

    const sent = [...first.sent, ...second.sent];
    expect(sent.length, "the route saw no requests, so it is not watching").toBeGreaterThan(0);
    expect([...first.blocked, ...second.blocked]).toEqual([]);
    expect(leaks(sent, keyfile)).toEqual([]);
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
});
