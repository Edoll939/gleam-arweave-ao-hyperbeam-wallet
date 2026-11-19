import { findFunction, isJsxPath } from "../../packages/core/src/scan/index.ts";
import { advisoryDrafts, prDrafts, reportSections } from "./readability.ts";
import { readText, showAtCommit, type Deps, type Problem } from "./shared.ts";

/** SECURITY.md § Severity, question 2. */
export const LOSSES = ["key", "unapproved", "mismatch", "control", "disclosure", "lockout", "none"] as const;
/** SECURITY.md § Severity, question 3. */
export const REQUIRES = ["none", "one-click", "unusual", "rare"] as const;
/** Only these earn, so only these are filed (SCANS.md § Points). */
export const FILED = ["medium", "high", "critical"] as const;

type Loss = (typeof LOSSES)[number];
type Requires = (typeof REQUIRES)[number];
type Level = "low" | (typeof FILED)[number];

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** The SECURITY.md § Severity table. */
export function rubricSeverity(loss: Loss, requires: Requires): Level {
  if (loss === "none") return "low";
  if (requires === "rare") return loss === "key" ? "medium" : "low";
  if (requires === "unusual") return loss === "disclosure" || loss === "lockout" ? "low" : "medium";
  if (loss === "disclosure" || loss === "lockout") return "medium";
  if (loss === "key" || loss === "unapproved") return requires === "none" ? "critical" : "high";
  return "high";
}

/**
 * The sections `.github/VULNERABILITY_REPORT.yml` requires, as their
 * labels, lowercase. GitHub refuses a report through the API without them.
 */
export const FIELDS = ["summary", "severity", "attacker", "loss", "requires", "fix location", "attestation id", "failing test", "details"] as const;
type Field = (typeof FIELDS)[number];

/** Each section's answer; a one-line answer loses any backticks around it. */
export function draftFields(markdown: string): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  for (const [label, text] of reportSections(markdown)) {
    if (!(FIELDS as readonly string[]).includes(label) || text === "") continue;
    out[label as Field] = text.includes("\n") ? text : text.replace(/^`|`$/g, "");
  }
  return out;
}

const heading = (key: string) => `\`### ${key[0]!.toUpperCase()}${key.slice(1)}\``;

/** The first cell of each row of THREAT_MODEL.md § Attackers. */
export function attackerNames(threatModel: string): string[] {
  const at = threatModel.search(/^## Attackers\s*$/m);
  if (at === -1) return [];
  const section = threatModel.slice(at).split(/\n## /)[0]!;
  return section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]!.trim())
    .filter((cell) => cell !== "" && cell !== "Attacker" && !/^-+$/.test(cell));
}

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;

/** A fenced block that defines a Vitest case. */
export function hasTestBlock(markdown: string): boolean {
  for (const m of markdown.matchAll(FENCE)) if (/\b(?:it|test)(?:\.each\([^)]*\))?\s*\(/.test(m[1]!)) return true;
  return false;
}

const list = (values: readonly string[]) => values.map((v) => `\`${v}\``).join(", ");

/**
 * Blocking problems in a round's drafts: a PR draft at all, and an advisory
 * missing a section the report form requires, rated above what its own
 * answers give, or without a fix location at the tag or a failing test.
 */
export async function draftProblems(deps: Deps, dir: string, commit: string): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const file of await prDrafts(deps, dir)) {
    problems.push({
      path: file,
      message: `scans don't file PRs, since nothing below Medium earns; drop a Low finding, and delete ${file}.`,
    });
  }
  const threatModel = await showAtCommit(deps, commit, "docs/THREAT_MODEL.md");
  const attackers = threatModel === undefined ? [] : attackerNames(threatModel);
  for (const file of await advisoryDrafts(deps, dir)) {
    const text = await readText(deps, file);
    if (text !== undefined) problems.push(...(await advisoryProblems(deps, commit, file, text, attackers)));
  }
  return problems;
}

async function advisoryProblems(deps: Deps, commit: string, file: string, text: string, attackers: string[]): Promise<Problem[]> {
  const out: Problem[] = [];
  const push = (message: string) => out.push({ path: file, message });
  const f = draftFields(text);
  const missing = FIELDS.filter((key) => !f[key]);
  if (missing.length > 0) {
    const names = missing.map(heading).join(", ");
    push(`add the ${names} ${missing.length === 1 ? "section" : "sections"}, in the order .github/VULNERABILITY_REPORT.yml gives (security/scan/REPORT.md § Advisory shape).`);
  }

  const severity = f.severity?.toLowerCase();
  const loss = f.loss?.toLowerCase() as Loss | undefined;
  const requires = f.requires?.toLowerCase() as Requires | undefined;
  if (severity !== undefined && !(FILED as readonly string[]).includes(severity)) {
    push(
      severity === "low" || severity === "informational"
        ? `a Low finding isn't filed; drop it, and delete ${file}.`
        : `Severity must be one of ${list(FILED)}.`,
    );
  }
  if (loss !== undefined && !(LOSSES as readonly string[]).includes(loss)) push(`Loss must be one of ${list(LOSSES)} (SECURITY.md § Severity).`);
  if (requires !== undefined && !(REQUIRES as readonly string[]).includes(requires)) {
    push(`Requires must be one of ${list(REQUIRES)} (SECURITY.md § Severity).`);
  }
  if (f.attacker && attackers.length > 0 && !attackers.some((name) => name.toLowerCase() === f.attacker!.toLowerCase())) {
    push(`Attacker must name a row of docs/THREAT_MODEL.md § Attackers: ${attackers.map((a) => `"${a}"`).join(", ")}.`);
  }

  if (
    severity !== undefined &&
    (FILED as readonly string[]).includes(severity) &&
    (LOSSES as readonly string[]).includes(loss ?? "") &&
    (REQUIRES as readonly string[]).includes(requires ?? "")
  ) {
    const rubric = rubricSeverity(loss!, requires!);
    if (rubric === "low") {
      push(`Loss: ${loss} with Requires: ${requires} is Low (SECURITY.md § Severity), which isn't filed; drop it, and delete ${file}.`);
    } else if (RANK[severity as Level] > RANK[rubric]) {
      push(`Severity is ${severity}, but Loss: ${loss} with Requires: ${requires} gives ${rubric} (SECURITY.md § Severity); set \`### Severity\` to ${rubric[0]!.toUpperCase()}${rubric.slice(1)}. A report rated above what it shows loses its scan points.`);
    }
  }

  if (f["fix location"]) {
    const m = /^([^#\s]+)#(\S+)$/.exec(f["fix location"]);
    if (!m) push("Fix location must be `<file>#<function>`, the function a fix has to change.");
    else {
      const [, path, symbol] = m;
      const source = await showAtCommit(deps, commit, path!);
      if (source === undefined) push(`Fix location names ${path}, which isn't in the release; name the file at the tag.`);
      else if (!findFunction(source, symbol!, { jsx: isJsxPath(path!) })) {
        push(`Fix location names \`${symbol}\`, which isn't a function in ${path}; name the function a fix has to change, as \`Name\` or \`Class.method\`.`);
      }
    }
  }

  if (f["failing test"] !== undefined && !hasTestBlock(f["failing test"])) {
    push("under `### Failing test`, put a Vitest `it(…)` that fails at the tag, in a ```ts block (security/scan/REPORT.md).");
  }
  return out;
}
