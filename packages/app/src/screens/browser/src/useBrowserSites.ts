import { useCallback, useEffect, useState } from "react";
import type { RuntimePort } from "@gleam/core";
import type { BrowserVisit } from "./history";

export interface BrowserSites {
  saved: string[];
  recent: string[];
  /** A saved site's stored icon, by origin. */
  icons: Record<string, string>;
  history: BrowserVisit[];
}

const NONE: BrowserSites = { saved: [], recent: [], icons: {}, history: [] };

/** The saved and recent origins and the page history, most recent first. A failed read leaves them empty. */
export function useBrowserSites(runtime: RuntimePort) {
  const [sites, setSites] = useState<BrowserSites>(NONE);

  const reload = useCallback(async () => {
    try {
      setSites(await runtime.send<void, BrowserSites>({ type: "listBrowserSites", payload: undefined }));
    } catch {
      setSites(NONE);
    }
  }, [runtime]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...sites, reload };
}
