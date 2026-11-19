import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RuntimePort } from "@gleam/core";
import { useOtherWallets } from "./useOtherWallets";

describe("useOtherWallets", () => {
  it("reads the wallets without pushing back auto-lock", async () => {
    const send = vi.fn(async () => ({ wallets: [{ id: "a" }, { id: "b" }], activeWalletId: "a", session: null }));
    const runtime = { send } as unknown as RuntimePort;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useOtherWallets(runtime, "a"), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([{ id: "b" }]));
    expect(send).toHaveBeenCalledWith({ type: "getState", payload: { recordActivity: false } });
  });
});
