import { describe, expect, it } from "vitest";
import { BUILT_IN_SITES, knownSite, matchSites, pageTrail, parseAddress, resolveInput, siteHost, type KnownSite } from "./address";

const SITES = [
  "https://my.example/",
  ...BUILT_IN_SITES,
  "https://recent.example",
].map((url) => knownSite(url) as KnownSite);

describe("BUILT_IN_SITES", () => {
  it("lists the built-in dApps in alphabetical order, ignoring www.", () => {
    expect(BUILT_IN_SITES).toEqual(["https://ao.arweave.net/", "https://bazar.arweave.net/", "https://iwashere.ar.io/", "https://www.permatell.xyz/"]);
  });
});

describe("parseAddress", () => {
  it("keeps an http(s) URL as typed", () => {
    expect(parseAddress("https://bazar.arweave.net/#/path")).toBe("https://bazar.arweave.net/#/path");
    expect(parseAddress("  http://example.com  ")).toBe("http://example.com/");
  });

  it("adds https:// to text that looks like a host", () => {
    expect(parseAddress("bazar.arweave.net")).toBe("https://bazar.arweave.net/");
    expect(parseAddress("example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(parseAddress("localhost.test:8080")).toBe("https://localhost.test:8080/");
  });

  it("rejects any other scheme", () => {
    for (const text of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "ftp://example.com", "intent://x.y#Intent;end"]) {
      expect(parseAddress(text)).toBeNull();
    }
  });

  it("gives nothing for plain words, spaces and empty text", () => {
    for (const text of ["", "   ", "bazar", "two words.com", "what is ao"]) {
      expect(parseAddress(text)).toBeNull();
    }
  });

  it("gives nothing for a host that can't parse", () => {
    expect(parseAddress("https://")).toBeNull();
    expect(parseAddress("a b.com")).toBeNull();
    expect(parseAddress("https://exa mple.com")).toBeNull();
  });
});

describe("siteHost", () => {
  it("shows the punycode form of an internationalised host", () => {
    expect(siteHost("https://münchen.de/")?.host).toBe("xn--mnchen-3ya.de");
    expect(siteHost("https://аррӏе.com/")?.host).toMatch(/^xn--/);
  });

  it("marks only http: as insecure", () => {
    expect(siteHost("http://example.com")).toEqual({ host: "example.com", insecure: true });
    expect(siteHost("https://example.com")).toEqual({ host: "example.com", insecure: false });
  });

  it("keeps a port and refuses other schemes", () => {
    expect(siteHost("https://example.com:8443/x")?.host).toBe("example.com:8443");
    expect(siteHost("about:blank")).toBeNull();
    expect(siteHost("nonsense")).toBeNull();
  });
});

describe("matchSites", () => {
  it("matches a part of the host, in the order given, ignoring case and scheme", () => {
    expect(matchSites("ARWEAVE", SITES).map((site) => site.host)).toEqual(["ao.arweave.net", "bazar.arweave.net"]);
    expect(matchSites("https://my.", SITES).map((site) => site.host)).toEqual(["my.example"]);
  });

  it("matches nothing for empty text", () => {
    expect(matchSites("  ", SITES)).toEqual([]);
  });
});

describe("resolveInput", () => {
  it("opens text that parses as an address exactly as typed, even when it matches a known site", () => {
    expect(resolveInput("arweave.net", SITES)).toBe("https://arweave.net/");
    expect(resolveInput("ao.arw", SITES)).toBe("https://ao.arw/");
    expect(resolveInput("https://ao.arweave.net/x", SITES)).toBe("https://ao.arweave.net/x");
  });

  it("opens the first known site only for text that isn't an address", () => {
    expect(resolveInput("bazar", SITES)).toBe("https://bazar.arweave.net/");
    expect(resolveInput("recent", SITES)).toBe("https://recent.example");
  });

  it("opens nothing when text is neither", () => {
    expect(resolveInput("nothing here", SITES)).toBeNull();
    expect(resolveInput("javascript:alert(1)", SITES)).toBeNull();
  });
});

describe("pageTrail", () => {
  it("keeps an ID's ends when asked, for a typed address", () => {
    const url = "https://www.permatell.xyz/pomp/claim/o4nLGqCnCei5ncVkQhospY_5BKxNEhn_iLFTslICVro";
    expect(pageTrail(url)).toEqual(["pomp", "claim", "…"]);
    expect(pageTrail(url, { idEnds: true })).toEqual(["pomp", "claim", "o4nL…CVro"]);
  });

  it("is empty on a site's home page", () => {
    expect(pageTrail("https://ao.arweave.net/")).toEqual([]);
    expect(pageTrail("https://ao.arweave.net/?ref=x")).toEqual([]);
  });

  it("collapses an ID to … and drops the query", () => {
    expect(pageTrail("https://www.permatell.xyz/pomp/claim/72mVqAhoivaMzHOEVNRo6Kisy8avXCsjJJpitpM5mVQ?a=1")).toEqual([
      "pomp",
      "claim",
      "…",
    ]);
  });

  it("keeps words, folds a run of IDs into one …", () => {
    expect(pageTrail("https://app.example/pools/wAR-AO/add-liquidity")).toEqual(["pools", "wAR-AO", "add-liquidity"]);
    expect(pageTrail("https://x.com/a/status/1859123456789012345/abcdefabcdef1234567890")).toEqual(["a", "status", "…"]);
  });

  it("reads a hash route as the path", () => {
    expect(pageTrail("https://bazar.arweave.net/#/asset/Xyz0123456789abcdefABCDEF?tab=1")).toEqual(["asset", "…"]);
  });

  it("decodes segments and strips control and bidi characters", () => {
    expect(pageTrail("https://a.example/caf%C3%A9/%E2%80%AEevil")).toEqual(["café", "evil"]);
  });
});
