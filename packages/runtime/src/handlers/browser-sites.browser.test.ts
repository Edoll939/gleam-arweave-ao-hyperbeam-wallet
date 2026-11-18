import { describe, expect, it } from "vitest";
import type { StoragePort } from "@gleam/core";
import {
  BrowserSitesHandler,
  BROWSER_HISTORY_KEY,
  BROWSER_RECENT_SITES_KEY,
  BROWSER_SITE_ICONS_KEY,
  MAX_HISTORY,
  MAX_HISTORY_URL_LENGTH,
  MAX_RECENT_SITES,
  MAX_SITE_ICON_LENGTH,
  MAX_TITLE_LENGTH,
  isValidBrowserVisit,
  isValidSiteIcon,
} from "./browser-sites";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml;base64,PHN2Zy8+";

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

describe("BrowserSitesHandler", () => {
  it("keeps both sites when two saves run at once", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await Promise.all([
      handler.saveBrowserSite({ url: "https://a.example" }),
      handler.saveBrowserSite({ url: "https://b.example" }),
    ]);
    expect((await handler.listBrowserSites()).saved.sort()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("starts empty", async () => {
    expect(await new BrowserSitesHandler(createFakeStorage()).listBrowserSites()).toEqual({ saved: [], recent: [], icons: {}, history: [] });
  });

  it("saves the origin of a page, newest first, without duplicates", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.saveBrowserSite({ url: "https://a.example/path?q=1" });
    await handler.saveBrowserSite({ url: "https://b.example/" });
    await handler.saveBrowserSite({ url: "https://a.example/other" });
    expect((await handler.listBrowserSites()).saved).toEqual(["https://a.example", "https://b.example"]);
  });

  it("removes a saved site", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.saveBrowserSite({ url: "https://a.example/" });
    await handler.removeBrowserSite({ origin: "https://a.example" });
    expect((await handler.listBrowserSites()).saved).toEqual([]);
  });

  it("rejects anything that isn't an http(s) URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await expect(handler.saveBrowserSite({ url: "javascript:alert(1)" })).rejects.toThrow();
    await expect(handler.recordRecentSite({ url: "not a url" })).rejects.toThrow();
    expect(await handler.listBrowserSites()).toEqual({ saved: [], recent: [], icons: {}, history: [] });
  });

  it("keeps ten recent origins, most recent first, one per origin", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    for (let index = 0; index < MAX_RECENT_SITES + 2; index += 1) {
      await handler.recordRecentSite({ url: `https://site${index}.example/` });
    }
    await handler.recordRecentSite({ url: "https://site5.example/page" });
    const { recent } = await handler.listBrowserSites();
    expect(recent).toHaveLength(MAX_RECENT_SITES);
    expect(recent[0]).toBe("https://site5.example");
    expect(recent.filter((origin) => origin === "https://site5.example")).toHaveLength(1);
  });

  it("clears the recent sites and history, and nothing saved", async () => {
    const storage = createFakeStorage();
    const handler = new BrowserSitesHandler(storage);
    await handler.saveBrowserSite({ url: "https://a.example/" });
    await handler.recordRecentSite({ url: "https://b.example/" });
    await handler.clearRecentSites();
    expect(await handler.listBrowserSites()).toEqual({ saved: ["https://a.example"], recent: [], icons: {}, history: [] });
    expect(await storage.get(BROWSER_RECENT_SITES_KEY)).toBeNull();
    expect(await storage.get(BROWSER_HISTORY_KEY)).toBeNull();
  });

  it("records each page in history, newest first, folding a repeat of the newest into it", async () => {
    let now = 1_000;
    const handler = new BrowserSitesHandler(createFakeStorage(), () => now);
    await handler.recordRecentSite({ url: "https://a.example/one", title: "One" });
    now = 2_000;
    await handler.recordRecentSite({ url: "https://a.example/two" });
    now = 3_000;
    await handler.recordRecentSite({ url: "https://a.example/two", title: "Two" });
    now = 4_000;
    await handler.recordRecentSite({ url: "https://a.example/two" });
    expect((await handler.listBrowserSites()).history).toEqual([
      { url: "https://a.example/two", title: "Two", at: 4_000 },
      { url: "https://a.example/one", title: "One", at: 1_000 },
    ]);
  });

  it("cleans the page's title and drops one that is only a URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    await handler.recordRecentSite({ url: "https://a.example/", title: "  Claim\u202e  your\n POMP " });
    await handler.recordRecentSite({ url: "https://b.example/", title: "https://b.example/" });
    await handler.recordRecentSite({ url: "https://c.example/", title: "x".repeat(MAX_TITLE_LENGTH + 50) });
    const titles = (await handler.listBrowserSites()).history.map((visit) => visit.title);
    expect(titles).toEqual(["x".repeat(MAX_TITLE_LENGTH), "", "Claim your POMP"]);
  });

  it("keeps at most MAX_HISTORY visits and skips a very long URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
      await handler.recordRecentSite({ url: `https://a.example/${index}` });
    }
    await handler.recordRecentSite({ url: `https://a.example/?q=${"a".repeat(MAX_HISTORY_URL_LENGTH)}` });
    const { history, recent } = await handler.listBrowserSites();
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0]?.url).toBe(`https://a.example/${MAX_HISTORY + 4}`);
    expect(recent).toEqual(["https://a.example"]);
  });

  it("skips stored visits that fail the guard", async () => {
    const storage = createFakeStorage();
    await storage.set(BROWSER_HISTORY_KEY, [{ url: "https://a.example/", title: "", at: 1 }, { url: 7 }, null, { url: "https://b.example/", title: "", at: "x" }]);
    expect((await new BrowserSitesHandler(storage).listBrowserSites()).history).toEqual([{ url: "https://a.example/", title: "", at: 1 }]);
    expect(isValidBrowserVisit({ url: "https://a.example/", title: "", at: Number.NaN })).toBe(false);
  });

  it("keeps a saved site's icon by origin, and drops it with the site", async () => {
    const storage = createFakeStorage();
    const handler = new BrowserSitesHandler(storage);
    await handler.saveBrowserSite({ url: "https://a.example/page", icon: PNG });
    await handler.saveBrowserSite({ url: "https://b.example/", icon: SVG });
    expect((await handler.listBrowserSites()).icons).toEqual({ "https://a.example": PNG, "https://b.example": SVG });

    await handler.removeBrowserSite({ origin: "https://a.example" });
    expect((await handler.listBrowserSites()).icons).toEqual({ "https://b.example": SVG });
    expect(await storage.get(BROWSER_SITE_ICONS_KEY)).toEqual({ "https://b.example": SVG });
  });

  it("saves the site without an icon that isn't a small image data URL", async () => {
    const handler = new BrowserSitesHandler(createFakeStorage());
    for (const icon of ["https://a.example/favicon.ico", "data:text/html;base64,PGI+", `data:image/png;base64,${"A".repeat(MAX_SITE_ICON_LENGTH)}`]) {
      await handler.saveBrowserSite({ url: "https://a.example/", icon });
    }
    expect(await handler.listBrowserSites()).toEqual({ saved: ["https://a.example"], recent: [], icons: {}, history: [] });
  });

  it("lists icons only for sites still saved, and skips stored values that fail the guard", async () => {
    const storage = createFakeStorage();
    await storage.set("local:browserSavedSites", ["https://a.example"]);
    await storage.set(BROWSER_SITE_ICONS_KEY, { "https://a.example": "javascript:1", "https://gone.example": PNG });
    expect((await new BrowserSitesHandler(storage).listBrowserSites()).icons).toEqual({});
  });
});

describe("isValidSiteIcon", () => {
  it("accepts base64 image data URLs only", () => {
    expect(isValidSiteIcon(PNG)).toBe(true);
    expect(isValidSiteIcon("data:image/png,raw")).toBe(false);
    expect(isValidSiteIcon("data:image/png;base64,abc\"><script>")).toBe(false);
    expect(isValidSiteIcon(42)).toBe(false);
  });
});
