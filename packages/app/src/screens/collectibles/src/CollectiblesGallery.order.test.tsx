import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { Collectible } from "@gleam/core";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { CollectiblesGallery, resetCollectiblesGalleryForTests, sortForGallery } from "./CollectiblesGallery";

afterEach(() => {
  cleanup();
  resetCollectiblesGalleryForTests();
});

let next = 0;
const piece = (name: string, contentType?: string): Collectible => ({
  id: `id-${next++}`,
  name,
  ticker: "ASSET",
  ...(contentType ? { contentType } : {}),
});
const name = (label: string): Collectible => ({ id: `id-${next++}`, name: `@${label}`, ticker: "NAME", permawebName: { label } });

describe("sortForGallery", () => {
  it("groups by kind, then A–Z with numbers in order, names last by label", () => {
    const items = [
      name("zy"),
      piece("Readme", "application/pdf"),
      piece("Frog #10", "image/png"),
      piece("Clip", "video/mp4"),
      piece("blob"),
      piece("frog #2", "image/png"),
      name("Alpha"),
      piece("Song", "audio/mpeg"),
      piece("Site", "text/html"),
    ];
    expect(sortForGallery(items).map((item) => item.name)).toEqual([
      "frog #2",
      "Frog #10",
      "Clip",
      "Song",
      "Site",
      "Readme",
      "blob",
      "@Alpha",
      "@zy",
    ]);
  });
});

describe("CollectiblesGallery grouping", () => {
  it("leaves a wider gap only where one kind ends and the next begins", () => {
    render(
      <CollectiblesGallery
        items={[name("zy"), piece("B", "image/png"), piece("A", "image/png"), name("abc")]}
        loading={false}
        onOpen={vi.fn()}
      />,
    );
    const thumbs = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(thumbs.map((thumb) => thumb.getAttribute("aria-label"))).toEqual(["A", "B", "@abc", "@zy"]);
    expect(thumbs.map((thumb) => thumb.className.includes("ml-3"))).toEqual([false, false, true, false]);
  });
});
