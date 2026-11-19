import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityPage, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { PlatformProvider } from "../../../app-platform/context";
import { fakeAppPlatform } from "../../../app-platform/testing";
import { SendView, type SendViewProps } from "./SendView";

afterEach(() => {
  cleanup();
});

function renderSendView(props: SendViewProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <PlatformProvider platform={fakeAppPlatform()}>
      <QueryClientProvider client={queryClient}>
        <SendView {...props} />
      </QueryClientProvider>
    </PlatformProvider>,
  );
}

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx",
  name: "Wallet One",
  method: "jwk",
  publicKey: "pub1",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

const AO_PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
const RECIPIENT = "AAAAAA1111111111111111111111111111111111111";

/** Balances hang forever (slow gateway / failed load); everything else answers. */
function hangingBalancesSend(): RuntimePort["send"] {
  const hang = () => new Promise<never>(() => {});
  return vi.fn(async (message: { type: string; payload: unknown }) => {
    switch (message.type) {
      case "getBalance":
      case "getTokenBalances":
        return hang();
      case "getActivity":
        return { entries: [], cursor: null } satisfies ActivityPage;
      case "getArFee":
        return "100000000";
      case "getPendingTransfers":
        return [];
      case "estimateTransfer":
        return { fee: null };
      case "assessRecipient":
        return { firstTime: false, lookalikeOf: null };
      case "submitTransfer":
        return { txId: "ao-tx-1" };
      case "listContacts":
        return [];
      case "getState":
        return { wallets: [WALLET], activeWalletId: WALLET.id, session: null };
      case "getDisplaySettings":
        return { currency: "USD", header: "full", tokenLogos: true, tokenRows: "detailed", headline: "total", balancesHidden: false };
      case "getTokenPrices":
        return [];
      default:
        throw new Error(`unhandled message type in test: ${message.type}`);
    }
  }) as RuntimePort["send"];
}

/** Balances load with a real AO row (denomination 12, 50 AO). */
function loadedBalancesSend(): RuntimePort["send"] {
  const ao: TokenBalance = {
    address: WALLET.address,
    processId: AO_PROCESS_ID,
    ticker: "AO",
    denomination: 12,
    name: null,
    quantity: "50000000000000",
  };
  const send = hangingBalancesSend() as unknown as ReturnType<typeof vi.fn>;
  return vi.fn(async (message: { type: string; payload: unknown }) => {
    if (message.type === "getBalance") return "1000000000000";
    if (message.type === "getTokenBalances") return [ao];
    return (send as (message: { type: string; payload: unknown }) => Promise<unknown>)(message);
  }) as unknown as RuntimePort["send"];
}

async function sendAo(
  send: RuntimePort["send"],
  amountDisplay: string,
  onReview?: () => void,
  waitForText?: string,
) {
  renderSendView({ runtime: fakeRuntime({ send }), wallet: WALLET, token: null, onBack: vi.fn(), onDone: vi.fn() });
  // Open the token picker and take the AO row.
  fireEvent.click(screen.getByRole("button", { name: /^AR/ }));
  // Control only: wait for the balances query to resolve (the real AO row
  // shows "50") before picking — otherwise the click lands on the synthetic
  // AO row shown before they load.
  if (waitForText !== undefined) {
    await waitFor(() => expect(screen.getByText(waitForText)).toBeTruthy());
  }
  const aoRow = screen.getAllByText("AO")[0]!.closest("button");
  expect(aoRow).not.toBeNull();
  expect(aoRow?.getAttribute("disabled")).toBeNull();
  fireEvent.click(aoRow!);
  await waitFor(() => expect(screen.getByRole("button", { name: "AO" })).toBeTruthy());
  // Type recipient + amount, continue to review.
  fireEvent.change(screen.getByPlaceholderText("Paste an address"), { target: { value: RECIPIENT } });
  fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: amountDisplay } });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
  onReview?.();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByText("Signed and sent.")).toBeTruthy());
}

describe("Sending AO picked before the balances load", () => {
  it("submits the amount the review shows", async () => {
    const send = hangingBalancesSend();
    await sendAo(send, "10", () => {
      // The review the user approved reads "10 AO".
      expect(screen.getAllByText("10").length).toBeGreaterThan(0);
      expect(screen.getAllByText("AO").length).toBeGreaterThan(0);
    });

    // The decisive assertion: what actually got signed/submitted must
    // match the review — 10 AO at denomination 12, not 10 raw units.
    expect(send).toHaveBeenCalledWith({
      type: "submitTransfer",
      payload: {
        walletId: WALLET.id,
        recipient: RECIPIENT,
        token: AO_PROCESS_ID,
        amount: "10000000000000",
        fee: null,
      },
    });
    // And the success screen tells the user they sent 10 AO.
    expect(screen.getByText(`10 AO to ${RECIPIENT}`)).toBeTruthy();
  });

  it("submits the same amount once the balances have loaded", async () => {
    const send = loadedBalancesSend();
    await sendAo(send, "10", undefined, "50");
    expect(send).toHaveBeenCalledWith({
      type: "submitTransfer",
      payload: {
        walletId: WALLET.id,
        recipient: RECIPIENT,
        token: AO_PROCESS_ID,
        amount: "10000000000000",
        fee: null,
      },
    });
  });
});
