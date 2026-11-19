import { describe, expect, it, vi } from "vitest";
import { createBrowseLinks, parseBrowseLink } from "./browse-link";

const link = (page: string) => `https://open.gleamwallet.app/browse?url=${encodeURIComponent(page)}`;

describe("parseBrowseLink", () => {
  it("returns the https page a browse link names", () => {
    expect(parseBrowseLink(link("https://iwashere.ar.io/"))).toBe("https://iwashere.ar.io/");
    expect(parseBrowseLink(link("https://example.ar.io/app?x=1#/route"))).toBe("https://example.ar.io/app?x=1#/route");
  });

  it.each([
    ["a page that isn't https", link("http://example.ar.io/")],
    ["a javascript: page", link("javascript:alert(1)")],
    ["a data: page", link("data:text/html,<p>hi</p>")],
    ["a page with credentials", link("https://user:pass@example.ar.io/")],
    ["a page that doesn't parse", link("not a url")],
    ["no page", "https://open.gleamwallet.app/browse"],
    ["an empty page", "https://open.gleamwallet.app/browse?url="],
    ["a second parameter", `${link("https://example.ar.io/")}&next=x`],
    ["the parameter twice", `${link("https://example.ar.io/")}&url=https%3A%2F%2Fother.ar.io%2F`],
    ["a fragment on the link", `${link("https://example.ar.io/")}#x`],
    ["another origin", "https://gleamwallet.app/browse?url=https%3A%2F%2Fexample.ar.io%2F"],
    ["plain http on the link", "http://open.gleamwallet.app/browse?url=https%3A%2F%2Fexample.ar.io%2F"],
    ["another path", "https://open.gleamwallet.app/browse/x?url=https%3A%2F%2Fexample.ar.io%2F"],
    ["credentials on the link", "https://a:b@open.gleamwallet.app/browse?url=https%3A%2F%2Fexample.ar.io%2F"],
    ["an oversized link", link(`https://example.ar.io/${"a".repeat(5000)}`)],
    ["a Points link", "https://open.gleamwallet.app/invite?code=GLEAM42"],
  ])("refuses %s", (_, url) => {
    expect(parseBrowseLink(url)).toBeNull();
  });

  it("refuses a value that isn't a string", () => {
    expect(parseBrowseLink(undefined)).toBeNull();
    expect(parseBrowseLink({ href: link("https://example.ar.io/") })).toBeNull();
  });
});

describe("createBrowseLinks", () => {
  it("keeps the latest page until the app subscribes", () => {
    const links = createBrowseLinks();
    links.open("https://one.ar.io/");
    links.open("https://two.ar.io/");
    const onOpen = vi.fn();
    links.subscribe(onOpen);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("https://two.ar.io/");

    const later = vi.fn();
    links.subscribe(later);
    expect(later).not.toHaveBeenCalled();
  });

  it("hands each page to the subscribers, and none after they leave", () => {
    const links = createBrowseLinks();
    const onOpen = vi.fn();
    const unsubscribe = links.subscribe(onOpen);
    links.open("https://one.ar.io/");
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("https://one.ar.io/");
    unsubscribe();
    links.open("https://two.ar.io/");
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
