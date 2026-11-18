// @vitest-environment node
import { describe, expect, it } from "vitest";
import { attackerNames, draftFields, draftProblems, hasTestBlock, rubricSeverity } from "./drafts.ts";
import { COMMIT, THREAT_MODEL, goodAdvisory, makeDeps, writeRound } from "./harness.ts";

const DIR = ".gleam-scan/rounds/keys";

async function problems(files: Record<string, string>): Promise<string[]> {
  const deps = makeDeps();
  writeRound(deps, "keys", { files });
  return (await draftProblems(deps, DIR, COMMIT)).map((p) => `${p.path}: ${p.message}`);
}

describe("rubricSeverity", () => {
  it("follows the SECURITY.md table", () => {
    expect(rubricSeverity("unapproved", "none")).toBe("critical");
    expect(rubricSeverity("key", "one-click")).toBe("high");
    expect(rubricSeverity("mismatch", "none")).toBe("high");
    expect(rubricSeverity("control", "unusual")).toBe("medium");
    expect(rubricSeverity("disclosure", "none")).toBe("medium");
    expect(rubricSeverity("lockout", "unusual")).toBe("low");
    expect(rubricSeverity("none", "none")).toBe("low");
  });
});

describe("draft parsing", () => {
  it("reads the rating lines once each, in any case, without backticks", () => {
    expect(draftFields("severity: High\nLoss: `mismatch`\nLoss: key\nFix location: a.ts#f")).toEqual({
      severity: "High",
      loss: "mismatch",
      "fix location": "a.ts#f",
    });
  });

  it("lists the threat model's attackers", () => {
    expect(attackerNames(THREAT_MODEL)).toEqual(["Malicious website", "Someone at an unlocked browser"]);
  });

  it("finds a Vitest case only inside a fenced block", () => {
    expect(hasTestBlock('it("x", () => {})')).toBe(false);
    expect(hasTestBlock('```ts\ntest("x", () => {});\n```')).toBe(true);
    expect(hasTestBlock("```ts\nit.each([1])(\"x\", () => {});\n```")).toBe(true);
  });
});

describe("draftProblems", () => {
  it("passes a complete advisory", async () => {
    expect(await problems({ "advisory-1.md": goodAdvisory() })).toEqual([]);
  });

  it("refuses PR drafts and Low advisories", async () => {
    const out = await problems({ "pr-1.md": "x", "advisory-1.md": goodAdvisory("x", { Severity: "low" }) });
    expect(out[0]).toMatch(/pr-1\.md: scans don't file PRs/);
    expect(out[1]).toMatch(/advisory-1\.md: a Low finding isn't filed/);
  });

  it("names the missing lines and the missing test", async () => {
    const out = await problems({ "advisory-1.md": "Title: x\nShort." });
    expect(out).toEqual([
      `${DIR}/advisory-1.md: add the \`Severity:\`, \`Attacker:\`, \`Loss:\`, \`Requires:\`, \`Fix location:\` lines under the attestation id (security/scan/REPORT.md § Rating lines).`,
      `${DIR}/advisory-1.md: add the failing test as a \`\`\`ts block in <details>: a Vitest \`it(…)\` that fails at the tag (security/scan/REPORT.md).`,
    ]);
  });

  it("refuses a severity above what the answers give, and allows one below", async () => {
    const [inflated] = await problems({ "advisory-1.md": goodAdvisory("x", { Severity: "critical" }) });
    expect(inflated).toMatch(/Severity is critical, but Loss: mismatch with Requires: one-click gives high .* set `Severity: high`/);
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { Severity: "medium" }) })).toEqual([]);
    const [low] = await problems({ "advisory-1.md": goodAdvisory("x", { Severity: "medium", Loss: "none" }) });
    expect(low).toMatch(/Loss: none with Requires: one-click is Low/);
  });

  it("checks the answers against the lists and the threat model", async () => {
    const out = await problems({ "advisory-1.md": goodAdvisory("x", { Attacker: "A hacker", Loss: "funds", Requires: "two-clicks" }) });
    expect(out).toEqual([
      expect.stringMatching(/Loss must be one of `key`/),
      expect.stringMatching(/Requires must be one of `none`, `one-click`, `unusual`/),
      expect.stringMatching(/Attacker must name a row of docs\/THREAT_MODEL\.md § Attackers: "Malicious website"/),
    ]);
  });

  it("checks the fix location exists at the tag", async () => {
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { "Fix location": "pkg/a.ts" }) })).toEqual([
      expect.stringMatching(/Fix location must be `<file>#<function>`/),
    ]);
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { "Fix location": "pkg/zz.ts#f" }) })).toEqual([
      expect.stringMatching(/names pkg\/zz\.ts, which isn't in the release/),
    ]);
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { "Fix location": "pkg/a.ts#nope" }) })).toEqual([
      expect.stringMatching(/names `nope`, which isn't a function in pkg\/a\.ts/),
    ]);
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { "Fix location": "pkg/c.ts#KeySession.get" }) })).toEqual([]);
  });
});
