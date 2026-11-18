import { describe, expect, it } from "vitest";
import { dayOf, groupHistory, matchHistory, trailText, type BrowserVisit } from "./history";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).getTime();
const visit = (url: string, time: number, title = ""): BrowserVisit => ({ url, title, at: time });

describe("groupHistory", () => {
  it("splits by local day and folds a run of pages on one site", () => {
    const history = [
      visit("https://a.example/three", at(19, 12)),
      visit("https://a.example/two", at(19, 11)),
      visit("https://b.example/", at(19, 10)),
      visit("https://a.example/one", at(19, 9)),
      visit("https://a.example/", at(18, 20)),
    ];
    const days = groupHistory(history);
    expect(days.map((day) => day.start)).toEqual([new Date(2026, 10, 19).getTime(), new Date(2026, 10, 18).getTime()]);
    expect(days[0]?.rows.map((row) => (row.kind === "site" ? `${row.origin}×${row.visits.length}` : row.visit.url))).toEqual([
      "https://a.example×2",
      "https://b.example/",
      "https://a.example/one",
    ]);
    // A run never crosses midnight.
    expect(days[1]?.rows).toEqual([{ kind: "page", visit: history[4] }]);
  });

  it("is empty for no history", () => {
    expect(groupHistory([])).toEqual([]);
  });
});

describe("dayOf", () => {
  it("names today and yesterday by the local calendar", () => {
    const now = at(19, 8);
    expect(dayOf(at(19, 0), now)).toBe("today");
    expect(dayOf(at(18, 23), now)).toBe("yesterday");
    expect(dayOf(at(17, 23), now)).toBe("earlier");
  });
});

describe("matchHistory", () => {
  it("matches the title or the URL, ignoring case", () => {
    const history = [visit("https://a.example/pomp", 1, "Claim"), visit("https://b.example/", 2, "Bazar")];
    expect(matchHistory(history, "CLAIM")).toEqual([history[0]]);
    expect(matchHistory(history, "b.exa")).toEqual([history[1]]);
    expect(matchHistory(history, " ")).toEqual(history);
  });
});

describe("trailText", () => {
  it("joins the path trail", () => {
    expect(trailText("https://www.permatell.xyz/pomp/claim/72mVqAhoivaMzHOEVNRo6Kisy8avXCsjJJpitpM5mVQ")).toBe("pomp › claim › …");
    expect(trailText("https://a.example/")).toBe("");
  });
});
