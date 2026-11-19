import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { fakeAppPlatform, renderWithPlatform as render } from "./app-platform/testing";
import type { BrowseLinkPort, DappBrowserPort } from "./app-platform/types";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wallet: WalletSummary = {
  id: "w1",
  address: "addr",
  name: "Main",
  method: "jwk",
  publicKey: "pk",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};
const unlocked = { wallets: [wallet], activeWalletId: "w1", session: { unlockedWalletIds: ["w1"] } } as unknown as WalletState;
const locked = { wallets: [wallet], activeWalletId: "w1", session: null } as unknown as WalletState;

function fakeBrowseLinks() {
  const listeners = new Set<(url: string) => void>();
  const port: BrowseLinkPort = {
    subscribe(onOpen) {
      listeners.add(onOpen);
      return () => listeners.delete(onOpen);
    },
  };
  return { port, emit: (url: string) => listeners.forEach((listener) => listener(url)) };
}

function setup(dappBrowser: boolean, { startLocked = false } = {}) {
  let state = startLocked ? locked : unlocked;
  const runtime: RuntimePort = {
    send: vi.fn(async ({ type }: { type: string }) => {
      if (type === "getState") return state;
      if (type === "unlockWallet") {
        state = unlocked;
        return { unlockedWalletIds: ["w1"] };
      }
      if (type === "getThemePreference") return { theme: "light" };
      if (type === "listBrowserSites") return { saved: [], recent: [], icons: {}, history: [] };
      if (type === "getPasskeyStatus") return { enrolled: false };
      if (type === "getBalance") return "0";
      if (type === "getTokenBalances" || type === "getConnectedApps") return [];
      return null;
    }) as unknown as RuntimePort["send"],
    onMessage: () => () => {},
  };
  const close = vi.fn(async () => {});
  const open = vi.fn<DappBrowserPort["open"]>(async () => {});
  const browseLinks = fakeBrowseLinks();
  const port: DappBrowserPort = {
    open,
    close,
    goBack: async () => {},
    reload: async () => {},
    setFrame: async () => {},
    setHidden: async () => {},
    clearSiteData: async () => {},
    pageIcon: async () => null,
    subscribe: () => () => {},
  };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  return {
    close,
    open,
    browseLinks,
    lock: () => {
      state = locked;
    },
    mount: () =>
      act(
        async () =>
          void render(
            <App layout="phone" />,
            fakeAppPlatform({ runtime, dappBrowser: port, browseLinks: browseLinks.port, capabilities: { dappBrowser } }),
          ),
      ),
  };
}

describe("App browser", () => {
  it("opens the browser from the main screen when the host has one", async () => {
    await setup(true).mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Browser" }));
    });
    expect(await screen.findByLabelText("Address")).toBeTruthy();
  });

  it("has no browser button where the host has none", async () => {
    await setup(false).mount();
    await screen.findByRole("button", { name: "Settings" });
    expect(screen.queryByRole("button", { name: "Browser" })).toBeNull();
  });

  it("closes the page and shows the lock screen when the wallet locks while browsing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const harness = setup(true);
    await harness.mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Browser" }));
    });
    harness.lock();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(harness.close).toHaveBeenCalled();
    expect(screen.queryByLabelText("Address")).toBeNull();
    vi.useRealTimers();
  });

  it("opens a browse link's page in the browser", async () => {
    const harness = setup(true);
    await harness.mount();
    await act(async () => harness.browseLinks.emit("https://iwashere.ar.io/"));
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://iwashere.ar.io/" })));
  });

  it("opens a second browse link's page over the first", async () => {
    const harness = setup(true);
    await harness.mount();
    await act(async () => harness.browseLinks.emit("https://iwashere.ar.io/"));
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://iwashere.ar.io/" })));
    await act(async () => harness.browseLinks.emit("https://bazar.arweave.net/"));
    await vi.waitFor(() => expect(harness.open).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://bazar.arweave.net/" })));
  });

  it("holds a browse link while the wallet is locked and opens it after the unlock", async () => {
    const harness = setup(true, { startLocked: true });
    await harness.mount();
    await act(async () => harness.browseLinks.emit("https://iwashere.ar.io/"));
    expect(harness.open).not.toHaveBeenCalled();

    fireEvent.change(await screen.findByPlaceholderText("Enter your password"), { target: { value: "pw" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    });
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledWith(expect.objectContaining({ url: "https://iwashere.ar.io/" })));
  });

  it("ignores browse links where the host has no browser", async () => {
    const harness = setup(false);
    await harness.mount();
    await act(async () => harness.browseLinks.emit("https://iwashere.ar.io/"));
    expect(screen.queryByLabelText("Address")).toBeNull();
  });
});
