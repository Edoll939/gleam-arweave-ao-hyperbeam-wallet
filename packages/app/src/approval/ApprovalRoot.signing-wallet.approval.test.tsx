// Regression test for R3-2: a wallet-origin hardware transfer approval must
// show the SENDING wallet as From, not the wallet that happens to be active
// when the window loads. A hardware send from wallet A survives a switch to
// B (GHSA-8382's cancel-on-switch explicitly excludes Gleam's own requests),
// so a window loaded after the switch used to show From B while the transfer
// sent from A. The view now carries the pinned signing wallet, and the
// review resolves From from it.
//
// Fails without the fix: the reloaded review shows "Wallet Bravo" as From.
// Run: pnpm vitest run ApprovalRoot.signing-wallet
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ApprovalRequest, RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { bytesToBase64Url } from "@gleam/core";
import { ApprovalRoot } from "./ApprovalRoot.tsx";
import { renderWithPlatform } from "../app-platform/testing.tsx";
import { createRuntime } from "../../../runtime/src/create-runtime.ts";
import { createInMemoryPlatform } from "../../../runtime/testing/index.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function modulus(bytes = 512, fill = 7): string {
  return bytesToBase64Url(new Uint8Array(bytes).fill(fill));
}

it("a hardware send from A reviewed after switching to B still shows From A", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/tx_anchor")) {
        return new Response("A".repeat(43), { headers: { "Content-Type": "text/plain" } });
      }
      if (url.includes("/graphql")) {
        return new Response(
          JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("0", { headers: { "Content-Type": "text/plain" } });
    }),
  );
  const platform = createInMemoryPlatform();
  const runtime = createRuntime(platform);
  const extension = { tier: "extension" } as const;

  // B: software wallet. A: Keystone hardware wallet (sender). Adding A makes
  // A active; B stays unlocked (hardware wallets list as unlocked whenever
  // a session exists, so the approval shows the review, not the lock screen).
  const b = (await runtime.dispatch(
    "createWallet",
    { name: "Wallet Bravo", password: "test-only-wallet-password" },
    extension,
  )) as WalletSummary;
  const a = (await runtime.dispatch(
    "addHardwareWallet",
    {
      method: "keystone",
      publicKey: modulus(),
      device: { kind: "keystone", xfp: "1a2b3c4d" },
      name: "Wallet Alpha",
    },
    extension,
  )) as WalletSummary;
  expect(a.address).not.toBe(b.address);

  const present = vi.spyOn(platform.approvalPresenter, "present");
  const pending = runtime.dispatch(
    "submitTransfer",
    { walletId: a.id, recipient: "r".repeat(43), amount: "123", fee: "1000", token: null },
    extension,
  ) as Promise<unknown>;
  pending.catch(() => {});
  await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
  const requestId = present.mock.calls[0]![0] as string;

  // Ground truth: the pending record is pinned to A, and the view carries it.
  const records = (await platform.storage.get<{ request: { requestId: string }; walletId: string | null }[]>(
    "session:pendingApprovals",
  )) ?? [];
  expect(records.find((entry) => entry.request.requestId === requestId)?.walletId).toBe(a.id);
  const view = (await runtime.dispatch("getApproval", { requestId }, extension)) as ApprovalRequest;
  expect(view.signingWallet).toEqual({ id: a.id, address: a.address });

  const port: RuntimePort = {
    send: ((message: { type: string; payload: unknown }) =>
      runtime.dispatch(message.type as never, message.payload, extension)) as never,
    onMessage: () => () => {},
  };

  // First open, while A is active: From correctly shows A.
  const first = renderWithPlatform(
    <ApprovalRoot requestId={requestId} runtime={port} onClose={() => {}} armDelayMs={0} />,
  );
  await screen.findByRole("button", { name: "Send" });
  expect(first.container.textContent).toContain("Wallet Alpha");
  expect(first.container.textContent).not.toContain("Wallet Bravo");
  first.unmount();

  // Switch to B. The request SURVIVES: wallet-origin requests are excluded
  // from `rejectSwitchedApprovals`, and the post-store check in
  // `requestApproval` only covers `signsForActiveWallet` kinds.
  await runtime.dispatch("switchWallet", { walletId: b.id }, extension);
  const state = (await runtime.dispatch("getState", { recordActivity: false }, extension)) as WalletState;
  expect(state.activeWalletId).toBe(b.id);
  const stillPending = (await runtime.dispatch("getApproval", { requestId }, extension)) as ApprovalRequest;
  expect(stillPending.requestId).toBe(requestId);
  expect(stillPending.signingWallet).toEqual({ id: a.id, address: a.address });

  // Reloaded window after the switch: From still shows A, the sender —
  // not B, the wallet that happens to be active now.
  const second = renderWithPlatform(
    <ApprovalRoot requestId={requestId} runtime={port} onClose={() => {}} armDelayMs={0} />,
  );
  await screen.findByRole("button", { name: "Send" });
  expect(second.container.textContent).toContain("Wallet Alpha");
  expect(second.container.textContent).not.toContain("Wallet Bravo");

  // Approving moves the request to the device step for A, not B: the
  // signer is the pinned wallet A, and the review said so.
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await vi.waitFor(async () => {
    const request = (await runtime.dispatch("getApproval", { requestId }, extension)) as ApprovalRequest;
    expect(request.device?.address).toBe(a.address);
  });

  await runtime.dispatch("lockWallet", undefined, extension);
}, 60_000);
