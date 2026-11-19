import type { BrowseLinkPort } from "@gleam/app/src/app-platform/types.ts";

const LINK_ORIGIN = "https://open.gleamwallet.app";
const MAX_LINK_LENGTH = 4096;

/**
 * The dApp page a browse link (`/browse?url=<page>`) asks to open, or
 * null. Anyone can write such a link and get it tapped, so it's held to
 * the same shape every time: one `url` parameter, no fragment, and a page
 * that is plain https with no credentials in it. The page then loads like
 * one the user typed: it gets Gleam's provider and nothing more.
 */
export function parseBrowseLink(url: unknown): string | null {
  if (typeof url !== "string" || url.length > MAX_LINK_LENGTH) return null;
  let link: URL;
  let page: URL;
  try {
    link = new URL(url);
    if (link.origin !== LINK_ORIGIN || link.pathname !== "/browse" || link.hash !== "") return null;
    if (link.username !== "" || link.password !== "") return null;
    const keys = [...link.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== "url") return null;
    page = new URL(link.searchParams.get("url") ?? "");
  } catch {
    return null;
  }
  if (page.protocol !== "https:" || page.hostname === "" || page.username !== "" || page.password !== "") return null;
  return page.href;
}

/**
 * Holds the latest browse link until the app is listening. A cold start
 * delivers the link before React mounts, so the first subscriber gets the
 * one that's waiting; an older one is replaced, not queued.
 */
export function createBrowseLinks(): BrowseLinkPort & { open(url: string): void } {
  let waiting: string | null = null;
  const listeners = new Set<(url: string) => void>();
  return {
    open(url) {
      if (listeners.size === 0) {
        waiting = url;
        return;
      }
      for (const listener of listeners) listener(url);
    },
    subscribe(onOpen) {
      listeners.add(onOpen);
      if (waiting !== null) {
        const url = waiting;
        waiting = null;
        onOpen(url);
      }
      return () => listeners.delete(onOpen);
    },
  };
}
