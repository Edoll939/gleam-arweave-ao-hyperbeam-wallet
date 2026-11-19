// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FIELDS, FILED, LOSSES, REQUIRES, attackerNames, draftFields, draftProblems, hasTestBlock, rubricSeverity } from "./drafts.ts";
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
    expect(rubricSeverity("key", "rare")).toBe("medium");
    expect(rubricSeverity("unapproved", "rare")).toBe("low");
    expect(rubricSeverity("control", "rare")).toBe("low");
    expect(rubricSeverity("none", "none")).toBe("low");
  });
});

describe("draft parsing", () => {
  it("reads each form section once, in any case, without backticks around a one-line answer", () => {
    expect(draftFields("Title: x\n\n### severity\n\nHigh\n\n### Loss\n\n`mismatch`\n\n### Loss\n\nkey\n\n### Fix location\n\na.ts#f\n\n### Other\n\nz")).toEqual({
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
      `${DIR}/advisory-1.md: add the \`### Summary\`, \`### Severity\`, \`### Attacker\`, \`### Loss\`, \`### Requires\`, \`### Fix location\`, \`### Attestation id\`, \`### Failing test\`, \`### Details\` sections, in the order .github/VULNERABILITY_REPORT.yml gives (security/scan/REPORT.md § Advisory shape).`,
    ]);
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { "Failing test": "None yet." }) })).toEqual([
      `${DIR}/advisory-1.md: under \`### Failing test\`, put a Vitest \`it(…)\` that fails at the tag, in a \`\`\`ts block (security/scan/REPORT.md).`,
    ]);
  });

  it("refuses a severity above what the answers give, and allows one below", async () => {
    const [inflated] = await problems({ "advisory-1.md": goodAdvisory("x", { Severity: "critical" }) });
    expect(inflated).toMatch(/Severity is critical, but Loss: mismatch with Requires: one-click gives high .* set `### Severity` to High/);
    expect(await problems({ "advisory-1.md": goodAdvisory("x", { Severity: "medium" }) })).toEqual([]);
    const [low] = await problems({ "advisory-1.md": goodAdvisory("x", { Severity: "medium", Loss: "none" }) });
    expect(low).toMatch(/Loss: none with Requires: one-click is Low/);
  });

  it("checks the answers against the lists and the threat model", async () => {
    const out = await problems({ "advisory-1.md": goodAdvisory("x", { Attacker: "A hacker", Loss: "funds", Requires: "two-clicks" }) });
    expect(out).toEqual([
      expect.stringMatching(/Loss must be one of `key`/),
      expect.stringMatching(/Requires must be one of `none`, `one-click`, `unusual`, `rare`/),
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

describe("the report form", () => {
  const form = readFileSync(new URL("../../.github/VULNERABILITY_REPORT.yml", import.meta.url), "utf8");
  /** The labels in form order, and each dropdown's options, read from the form's fixed layout. */
  const labels = [...form.matchAll(/^ {6}label: (.+)$/gm)].map((m) => m[1]!);
  const options = (id: string) => {
    const at = form.indexOf(`    id: ${id}\n`);
    const block = form.slice(at, form.indexOf("    validations:", at));
    return [...block.matchAll(/^ {8}- (.+)$/gm)].map((m) => m[1]!);
  };

  it("asks for every section the CLI checks, in the same order", () => {
    expect(labels.map((label) => label.toLowerCase())).toEqual([...FIELDS]);
  });

  it("offers only the severities that are filed, and the rubric's answers", () => {
    expect(options("severity").map((o) => o.toLowerCase())).toEqual([...FILED]);
    expect(options("loss")).toEqual(LOSSES.filter((loss) => loss !== "none"));
    expect(options("requires")).toEqual([...REQUIRES]);
  });

  it("offers the threat model's attackers", () => {
    const threatModel = readFileSync(new URL("../../docs/THREAT_MODEL.md", import.meta.url), "utf8");
    expect(options("attacker")).toEqual(attackerNames(threatModel));
  });
});
