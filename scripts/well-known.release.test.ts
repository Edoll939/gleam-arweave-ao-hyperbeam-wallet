// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkWellKnown } from "./well-known.mjs";

const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

const stub = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  (async (url: string, init?: RequestInit) => handler(url, init)) as unknown as typeof fetch;

describe("checkWellKnown", () => {
  it("accepts both files served as JSON and requests them without following redirects", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const problems = await checkWellKnown({
      host: "example.test",
      readRepoFile: async () => "{}",
      fetchImpl: stub((url, init) => {
        seen.push([url, init]);
        return json("{}");
      }),
    });
    expect(problems).toEqual([]);
    expect(seen.map(([u]) => u)).toEqual([
      "https://example.test/.well-known/apple-app-site-association",
      "https://example.test/.well-known/assetlinks.json",
    ]);
    expect(seen.every(([, i]) => i?.redirect === "manual")).toBe(true);
  });

  it("reports a redirect, a wrong content type and a non-JSON body", async () => {
    const problems = await checkWellKnown({
      fetchImpl: stub((url) =>
        url.endsWith("association")
          ? new Response(null, { status: 301, headers: { location: "https://elsewhere.test/" } })
          : json("<html>", { headers: { "content-type": "text/html" } }),
      ),
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/status 301/);
    expect(problems[1]).toMatch(/content-type "text\/html"/);
    expect(problems[2]).toMatch(/not JSON/);
  });

  it("treats a thrown fetch as a problem", async () => {
    const problems = await checkWellKnown({
      fetchImpl: stub(() => {
        throw new Error("ENOTFOUND");
      }),
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/ENOTFOUND/);
  });

  it("reports valid JSON that differs from the repo copy, and accepts reordered keys", async () => {
    const problems = await checkWellKnown({
      readRepoFile: async (file) => (file === "assetlinks.json" ? '{"a":1,"b":2}' : "{}"),
      fetchImpl: stub((url) =>
        url.endsWith("assetlinks.json") ? json('{"b":2,"a":1}') : json('{"other":true}'),
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/apple-app-site-association.*differs from the repo copy/);
  });

  it("treats an unreadable repo copy as a problem", async () => {
    const problems = await checkWellKnown({
      readRepoFile: async () => {
        throw new Error("ENOENT");
      },
      fetchImpl: stub(() => json("{}")),
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/cannot read the repo copy/);
  });
});
