import { describe, expect, it, vi } from "vitest";
import { COMMUNITY_HYPERBEAM_PEER_URLS, L1_TOKEN_NODE_URLS, type NetworkSettings, type StoragePort } from "@gleam/core";
import {
  DISCOVERED_PEERS_KEY,
  DISMISSED_PEERS_KEY,
  mergeDiscoveredPeers,
  readL1NodeUrls,
  refreshDiscoveredPeersIfDue,
  saveNetworkSettings,
} from "./peers";

function createFakeStorage(): StoragePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
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
  } as StoragePort & { store: Map<string, unknown> };
}

const SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: [{ url: "https://mine.test", enabled: false }],
  activePeerUrl: "https://mine.test",
};

/** Location records for `urls`; of those, `l1` answer the canary's slot. */
function graphqlFetch(urls: string[], l1: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/slot/current")) {
      return l1.some((host) => url.startsWith(`${host}/`)) ? new Response("1509") : new Response("<html></html>");
    }
    if (url.endsWith("/graphql")) {
      const edges = urls.map((peer, index) => ({
        cursor: String(index),
        node: { id: String(index), owner: { address: `owner-${index}` }, block: { timestamp: index }, tags: [{ name: "Url", value: peer }] },
      }));
      return new Response(JSON.stringify({ data: { transactions: { pageInfo: { hasNextPage: false }, edges } } }));
    }
    return new Response("operator-address");
  }) as unknown as typeof fetch;
}

describe("mergeDiscoveredPeers", () => {
  it("appends new peers after the user's own and skips known or dismissed ones", () => {
    const merged = mergeDiscoveredPeers(SETTINGS, ["https://mine.test", "https://new.test", "https://gone.test"], ["https://gone.test"]);
    expect(merged.peers).toEqual([
      { url: "https://mine.test", enabled: false },
      { url: "https://new.test", enabled: true },
    ]);
    expect(merged.activePeerUrl).toBe("https://mine.test");
  });
});

describe("saveNetworkSettings", () => {
  it("remembers a community or discovered peer the user removed", async () => {
    const storage = createFakeStorage();
    await storage.set(DISCOVERED_PEERS_KEY, { at: 1, urls: ["https://kept.test", "https://removed.test"] });
    const [removedCommunity, ...keptCommunity] = COMMUNITY_HYPERBEAM_PEER_URLS;

    await saveNetworkSettings(storage, {
      ...SETTINGS,
      peers: [...SETTINGS.peers, ...[...keptCommunity, "https://kept.test"].map((url) => ({ url, enabled: true }))],
    });

    expect(storage.store.get(DISMISSED_PEERS_KEY)).toEqual([removedCommunity, "https://removed.test"]);
    expect(storage.store.get("local:networkSettings")).toMatchObject({ activePeerUrl: "https://mine.test" });
  });
});

describe("saveNetworkSettings after discovery drops a peer", () => {
  it("still remembers its removal, so rediscovery doesn't bring it back", async () => {
    const storage = createFakeStorage();
    const gone = "https://gone.test";
    await storage.set("local:networkSettings", { ...SETTINGS, peers: [...SETTINGS.peers, { url: gone, enabled: true }] });
    await storage.set(DISCOVERED_PEERS_KEY, { at: 1, urls: [] });

    await saveNetworkSettings(storage, SETTINGS);

    expect(storage.store.get(DISMISSED_PEERS_KEY)).toContain(gone);
    const merged = mergeDiscoveredPeers(SETTINGS, [gone], storage.store.get(DISMISSED_PEERS_KEY) as string[]);
    expect(merged.peers.map((peer) => peer.url)).not.toContain(gone);
  });
});

describe("refreshDiscoveredPeersIfDue", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("skips discovery while the stored result is under a day old", async () => {
    const storage = createFakeStorage();
    await storage.set(DISCOVERED_PEERS_KEY, { at: 1000, urls: ["https://a.test"] });
    const fetchImpl = graphqlFetch(["https://b.test"]);

    await refreshDiscoveredPeersIfDue(storage, async () => "https://gw.test", fetchImpl, () => 1000 + DAY - 1);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stores a fresh result once the old one is due", async () => {
    const storage = createFakeStorage();
    await storage.set(DISCOVERED_PEERS_KEY, { at: 0, urls: ["https://a.test"] });

    await refreshDiscoveredPeersIfDue(storage, async () => "https://gw.test", graphqlFetch(["https://b.test"]), () => DAY + 1);

    expect(storage.store.get(DISCOVERED_PEERS_KEY)).toEqual({ at: DAY + 1, urls: ["https://b.test"], l1Urls: [], l1Down: [] });
  });

  it("stores the peers that serve L1 tokens, and reads them after the shipped nodes", async () => {
    const storage = createFakeStorage();
    const community = COMMUNITY_HYPERBEAM_PEER_URLS.find((url) => !L1_TOKEN_NODE_URLS.includes(url))!;

    await refreshDiscoveredPeersIfDue(
      storage,
      async () => "https://gw.test",
      graphqlFetch(["https://b.test", "https://c.test"], [...L1_TOKEN_NODE_URLS, "https://c.test", community]),
      () => DAY + 1,
    );

    expect(storage.store.get(DISCOVERED_PEERS_KEY)).toMatchObject({ l1Urls: [community, "https://c.test"], l1Down: [] });
    expect(await readL1NodeUrls(storage)).toEqual([...L1_TOKEN_NODE_URLS, community, "https://c.test"]);
  });

  it("skips a shipped node that failed the probe until it passes again", async () => {
    const storage = createFakeStorage();
    const [dead, ...alive] = L1_TOKEN_NODE_URLS;

    await refreshDiscoveredPeersIfDue(storage, async () => "https://gw.test", graphqlFetch([], alive), () => DAY + 1);
    expect(storage.store.get(DISCOVERED_PEERS_KEY)).toMatchObject({ l1Down: [dead] });
    expect(await readL1NodeUrls(storage)).toEqual(alive);

    await refreshDiscoveredPeersIfDue(storage, async () => "https://gw.test", graphqlFetch([], [...L1_TOKEN_NODE_URLS]), () => 2 * DAY + 2);
    expect(await readL1NodeUrls(storage)).toEqual([...L1_TOKEN_NODE_URLS]);
  });

  it("keeps the last probe's answer when nothing passes, the shipped nodes included", async () => {
    const storage = createFakeStorage();
    const [dead] = L1_TOKEN_NODE_URLS;
    await storage.set(DISCOVERED_PEERS_KEY, { at: 0, urls: ["https://a.test"], l1Urls: ["https://a.test"], l1Down: [dead] });

    await refreshDiscoveredPeersIfDue(storage, async () => "https://gw.test", graphqlFetch(["https://b.test"]), () => DAY + 1);

    expect(storage.store.get(DISCOVERED_PEERS_KEY)).toEqual({ at: DAY + 1, urls: ["https://b.test"], l1Urls: ["https://a.test"], l1Down: [dead] });
  });

  it("falls back to every shipped node when all were down and none was found", async () => {
    const storage = createFakeStorage();
    await storage.set(DISCOVERED_PEERS_KEY, { at: 0, urls: [], l1Urls: [], l1Down: [...L1_TOKEN_NODE_URLS] });
    expect(await readL1NodeUrls(storage)).toEqual([...L1_TOKEN_NODE_URLS]);
  });

  it("reads only the shipped nodes before any discovery, and skips a stored value that isn't an https URL", async () => {
    const storage = createFakeStorage();
    expect(await readL1NodeUrls(storage)).toEqual([...L1_TOKEN_NODE_URLS]);
    await storage.set(DISCOVERED_PEERS_KEY, { at: 0, urls: [], l1Urls: ["http://plain.test", 7, "https://ok.test"] });
    expect(await readL1NodeUrls(storage)).toEqual([...L1_TOKEN_NODE_URLS, "https://ok.test"]);
  });

  it("skips L1 nodes the user removed or turned off, even when none are left", async () => {
    const storage = createFakeStorage();
    const [shipped, ...otherShipped] = L1_TOKEN_NODE_URLS;
    await storage.set(DISCOVERED_PEERS_KEY, {
      at: 0,
      urls: [],
      l1Urls: ["https://removed.test", "https://off.test", "https://kept.test"],
      l1Down: [],
    });
    await storage.set(DISMISSED_PEERS_KEY, ["https://removed.test"]);
    await storage.set("local:networkSettings", {
      ...SETTINGS,
      peers: [
        { url: "https://off.test/", enabled: false },
        { url: shipped!, enabled: false },
        { url: "https://kept.test", enabled: true },
      ],
    });

    expect(await readL1NodeUrls(storage)).toEqual([...otherShipped, "https://kept.test"]);

    await storage.set(DISMISSED_PEERS_KEY, ["https://removed.test", "https://kept.test", ...otherShipped]);
    expect(await readL1NodeUrls(storage)).toEqual([]);
  });

  it("falls back to the shipped nodes the user kept when the probe found every node down", async () => {
    const storage = createFakeStorage();
    const [shipped, ...otherShipped] = L1_TOKEN_NODE_URLS;
    await storage.set(DISCOVERED_PEERS_KEY, { at: 0, urls: [], l1Urls: [], l1Down: [...L1_TOKEN_NODE_URLS] });
    await storage.set("local:networkSettings", { ...SETTINGS, peers: [{ url: shipped!, enabled: false }] });

    expect(await readL1NodeUrls(storage)).toEqual(otherShipped);
  });

  it("keeps the old list when discovery finds nothing", async () => {
    const storage = createFakeStorage();
    await storage.set(DISCOVERED_PEERS_KEY, { at: 0, urls: ["https://a.test"] });

    await refreshDiscoveredPeersIfDue(storage, async () => "https://gw.test", graphqlFetch([]), () => DAY + 1);

    expect(storage.store.get(DISCOVERED_PEERS_KEY)).toEqual({ at: 0, urls: ["https://a.test"] });
  });
});
