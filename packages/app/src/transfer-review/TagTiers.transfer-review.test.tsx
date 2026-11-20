import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SigningApprovalPreview } from "@gleam/core";
import { SigningApprovalScreen } from "../approval/SigningApprovalScreen";

const WALLET = "ECvThiUQHWJj-8HsiyF6C8_mgFbr6seluRs2GKyXa7Y";
const PROCESS = "VvF0Z3xMswxr2CVdLFei2a1NwYffiQ8nIQiPJ1gxJKY";
const HASH = "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c";

function item(tags: Array<{ name: string; value: string }>, target: string | null) {
  return { decodedData: "", tags, target, payloadHash: HASH, transfer: null };
}

function renderItems(items: NonNullable<SigningApprovalPreview["items"]>) {
  const preview: SigningApprovalPreview = {
    kind: items.length > 1 ? "batchSignDataItem" : "signDataItem",
    recipient: null,
    amount: null,
    fee: null,
    token: null,
    tokenDenomination: null,
    tokenTicker: null,
    decodedData: null,
    tags: [],
    payloadHash: HASH,
    items,
  };
  return render(
    <SigningApprovalScreen
      origin="https://example.com"
      preview={preview}
      from={{ name: "Crystal", address: WALLET }}
      onReject={vi.fn()}
      onSign={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("TagTiers on the signing approval screen", () => {
  it("heads an item with its Action and names the wallet", () => {
    renderItems([
      item(
        [
          { name: "Action", value: "Credit-Notice" },
          { name: "Quantity", value: "1" },
          { name: "Recipient", value: WALLET },
          { name: "From-Process", value: PROCESS },
          { name: "App-Name", value: "PermaTell" },
          { name: "Data-Protocol", value: "ao" },
        ],
        WALLET,
      ),
    ]);
    expect(screen.getByText("Credit-Notice")).toBeTruthy();
    expect(screen.getByText("Addresses")).toBeTruthy();
    expect(screen.getByText("This wallet")).toBeTruthy();
    expect(screen.getByText("Recipient")).toBeTruthy();
    expect(screen.getByText("PermaTell")).toBeTruthy();
    expect(screen.getByText("Protocol")).toBeTruthy();
    expect(screen.queryByText("Item 1")).toBeNull();
  });

  it("shows an address once under every tag that carries it, and keeps a near miss apart", () => {
    const nearMiss = `${PROCESS.slice(0, -1)}L`;
    renderItems([
      item(
        [
          { name: "creator", value: WALLET },
          { name: "asset-data", value: PROCESS },
          { name: "initial-holder", value: WALLET },
          { name: "logo", value: PROCESS },
          { name: "thumbnail", value: nearMiss },
        ],
        WALLET,
      ),
    ]);
    expect(screen.getAllByText("This wallet")).toHaveLength(1);
    const row = (label: string) => screen.getByText(label).closest(".grid");
    expect(row("Target")).toBe(row("creator"));
    expect(row("creator")).toBe(row("initial-holder"));
    expect(row("asset-data")).toBe(row("logo"));
    expect(row("thumbnail")).not.toBe(row("logo"));
    expect(row("creator")).not.toBe(row("logo"));
  });

  it("marks a protocol tag carrying an unexpected value", () => {
    renderItems([item([{ name: "Action", value: "Vote" }, { name: "Variant", value: "ao.TN.2" }], null)]);
    expect(screen.getByText("ao.TN.2")).toBeTruthy();
    expect(screen.getByText("Unusual")).toBeTruthy();
    expect(screen.getByText(/expected ao\.TN\.1 \/ ao\.N\.1/)).toBeTruthy();
  });

  it("shows no headline, and both copies, when Type carries conflicting case-variant copies", () => {
    const { container } = renderItems([
      item(
        [
          { name: "Type", value: "Process" },
          { name: "type", value: "Other" },
        ],
        null,
      ),
    ]);
    expect(container.querySelector(".text-h3")).toBeNull();
    expect(screen.getByText("Process")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("numbers the items of a request that signs more than one", () => {
    renderItems([item([{ name: "Action", value: "A" }], null), item([{ name: "Action", value: "B" }], null)]);
    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(screen.getByText("Item 2")).toBeTruthy();
  });

  it("escapes a bidi Quantity name in app tags instead of headlining it", () => {
    renderItems([item([{ name: "Action", value: "Vote" }, { name: "Quantity\u202E", value: "5" }], null)]);
    expect(screen.getByText("App tags")).toBeTruthy();
    expect(screen.getByText("<U+202E>")).toBeTruthy();
  });
});
