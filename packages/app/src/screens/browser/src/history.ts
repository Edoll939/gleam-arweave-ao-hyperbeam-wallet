import { pageTrail } from "./address";

export interface BrowserVisit {
  url: string;
  /** The page's own `<title>`, untrusted; empty when it had none. */
  title: string;
  /** Milliseconds since the epoch. */
  at: number;
}

/** One page, or a run of pages on one site in a row, folded into a single row. */
export type HistoryRow =
  | { kind: "page"; visit: BrowserVisit }
  | { kind: "site"; key: string; origin: string; visits: BrowserVisit[] };

export interface HistoryDay {
  /** Local midnight that starts the day. */
  start: number;
  rows: HistoryRow[];
}

export function originOf(url: string): string | null {
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

function dayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function dayOf(at: number, now: number): "today" | "yesterday" | "earlier" {
  const today = dayStart(now);
  if (dayStart(at) === today) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return dayStart(at) === yesterday.getTime() ? "yesterday" : "earlier";
}

/** History (newest first) by local day, with each run of pages on one site folded. */
export function groupHistory(history: readonly BrowserVisit[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  let run: BrowserVisit[] = [];
  let runOrigin: string | null = null;
  const flush = () => {
    const day = days[days.length - 1];
    const first = run[0];
    if (day && first) {
      day.rows.push(
        run.length === 1 ? { kind: "page", visit: first } : { kind: "site", key: `${first.at}:${first.url}`, origin: runOrigin ?? "", visits: run },
      );
    }
    run = [];
  };
  for (const visit of history) {
    const start = dayStart(visit.at);
    const origin = originOf(visit.url);
    if (days[days.length - 1]?.start !== start) {
      flush();
      days.push({ start, rows: [] });
    } else if (origin !== runOrigin) {
      flush();
    }
    runOrigin = origin;
    run.push(visit);
  }
  flush();
  return days;
}

/** Visits whose title or URL contains `query`, ignoring case. */
export function matchHistory(history: readonly BrowserVisit[], query: string): BrowserVisit[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...history];
  return history.filter((visit) => visit.title.toLowerCase().includes(needle) || visit.url.toLowerCase().includes(needle));
}

/** `pomp › claim › …`, or empty on a site's home page. */
export function trailText(url: string): string {
  return pageTrail(url).join(" › ");
}
