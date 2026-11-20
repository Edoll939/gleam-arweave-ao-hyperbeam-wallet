import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Collectible, SigningApprovalPreview } from "@gleam/core";
import { renderWithPlatform as render } from "../../../app-platform/testing";
import { SigningApprovalScreen } from "../../../approval/SigningApprovalScreen";
import { CollectibleDetailView } from "./CollectibleDetailView";

afterEach(cleanup);

const CARRIER = "c".repeat(43);
const TARGET = "t".repeat(43);
const name = (permawebName: Collectible["permawebName"]): Collectible => ({ id: CARRIER, name: "@alice", ticker: "NAME", permawebName });

describe("Change target", () => {
  it("shows on a held, unlisted name and opens a sheet that hands back a valid id", async () => {
    const onChangeTarget = vi.fn();
    render(
      <CollectibleDetailView
        collectible={name({ label: "alice" })}
        onBack={() => {}}
        onChangeTarget={onChangeTarget}
        sheetContainer={document.body}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change target" }));
    const field = await screen.findByLabelText("New target");

    fireEvent.change(field, { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("alert").textContent).toContain("isn't an Arweave id");
    expect(onChangeTarget).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: ` ${TARGET} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onChangeTarget).toHaveBeenCalledWith(TARGET);
  });

  it("is absent on a listed name and on any other collectible", () => {
    const { rerender } = render(
      <CollectibleDetailView collectible={name({ label: "alice", listed: true })} onBack={() => {}} onChangeTarget={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Change target" })).toBeNull();
    rerender(
      <CollectibleDetailView collectible={{ id: CARRIER, name: "Beam", ticker: "B" }} onBack={() => {}} onChangeTarget={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Change target" })).toBeNull();
  });
});

describe("the name change approval", () => {
  it("reads @name → target with the fee, and escapes hidden characters in both", () => {
    const preview: SigningApprovalPreview = {
      kind: "setNameTarget",
      recipient: null,
      amount: null,
      fee: "1001",
      token: null,
      tokenDenomination: null,
      tokenTicker: null,
      nameTarget: { carrier: CARRIER, label: "ali‮ce", target: TARGET },
      decodedData: null,
      tags: [],
      payloadHash: "",
      items: null,
    };
    render(<SigningApprovalScreen origin="gleam" preview={preview} onReject={() => {}} onSign={async () => {}} />);
    expect(screen.queryByText("@ali‮ce")).toBeNull();
    expect(document.body.textContent).toContain("U+202E");
    expect(screen.getByText(TARGET)).toBeTruthy();
    expect(screen.getByText("Points to")).toBeTruthy();
    expect(document.body.textContent).toContain("Network fee0.00000000101 AR");
    expect(screen.getByRole("button", { name: /Sign/ })).toBeTruthy();
  });
});
