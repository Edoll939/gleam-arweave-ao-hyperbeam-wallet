import { createNativeBridgeTransport, installProvider } from "@gleam/provider";
import { version } from "../../package.json";

/**
 * The script the dApp view runs at document start in each page's main
 * frame: `window.arweaveWallet` and `window.gleam` over the native bridge.
 * No other wallet can reach this view, so `window.arweaveWallet` answers
 * under Wander's name and a site's Wander button connects Gleam.
 * `vite.config.ts` builds it into one self-contained IIFE that the app
 * imports as text (`virtual:gleam-provider-script`), so nothing is fetched.
 */
installProvider({ transport: createNativeBridgeTransport(), walletVersion: version, arweaveWalletName: "ArConnect" });
