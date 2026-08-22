import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
// The SDK's zod helper is typed against the `zod/v4` core that ships inside
// zod 3.25+; importing the same subpath keeps both on one nominal instance.
import { z } from "zod/v4";
import { lintCase, nextMinorId } from "@tcm/shared";
import { PATCH_TOOL_GUIDANCE } from "../brief.js";
import { log, warn } from "../log.js";
import { findCaseDir, listVersionIds } from "../store.js";

const execFileP = promisify(execFile);

export interface BackendResult {
  markdown: string;
  proposedVersion: string | null;
}

/**
 * The built-in answerer: one Tool Runner loop per question against the
 * Claude API, with a small closed tool set jailed to the app repo and the
 * data folder. Auth is the SDK's zero-arg resolution (ANTHROPIC_API_KEY,
 * or an `ant auth login` profile) — the daemon stores no key.
 *
 * The SDK import is dynamic and this module only loads for the `api`
 * backend, so `--commands-only` and the CLI backends run without
 * @anthropic-ai/sdk installed at all.
 */
export async function answerViaApi(opts: {
  brief: string;
  qDir: string;
  repo: string;
  dataDir: string;
  testCaseId: string;
  model: string;
  canPatch: boolean;
}): Promise<BackendResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { betaZodTool } = await import("@anthropic-ai/sdk/helpers/beta/zod");
  const client = new Anthropic();

  const roots = [path.resolve(opts.repo), path.resolve(opts.dataDir)];
  /** Every tool goes through this: a path outside the repo and the data
   * folder does not exist as far as the model is concerned. */
  const jail = (p: string): string => {
    const abs = path.resolve(p);
    if (!roots.some((root) => abs === root || abs.startsWith(root + path.sep))) {
      throw new Error(`path is outside the allowed roots: ${p}`);
    }
    return abs;
  };

  let proposedVersion: string | null = null;

  const tools = [
    betaZodTool({
      name: "read_file",
      description:
        "Read a text file inside the app repo or the data folder. Returns at most 100KB.",
      inputSchema: z.object({ path: z.string() }),
      run: ({ path: p }) => {
        const abs = jail(p);
        const size = statSync(abs).size;
        const text = readFileSync(abs, "utf8").slice(0, 100_000);
        return size > 100_000 ? `${text}\n[truncated: ${size} bytes total]` : text;
      },
    }),
    betaZodTool({
      name: "list_dir",
      description: "List a directory inside the app repo or the data folder.",
      inputSchema: z.object({ path: z.string() }),
      run: ({ path: p }) => readdirSync(jail(p)).join("\n") || "(empty)",
    }),
    betaZodTool({
      name: "grep",
      description:
        "Search file contents recursively (fixed string or regex) inside the app repo or the data folder. Returns matching lines with file:line.",
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string(),
        fixed: z.boolean().describe("true = literal string, false = regex").optional(),
      }),
      run: async ({ pattern, path: p, fixed }) => {
        const abs = jail(p);
        try {
          const { stdout } = await execFileP(
            "grep",
            ["-rn", "-I", "-m", "200", ...(fixed !== false ? ["-F"] : ["-E"]), pattern, abs],
            { maxBuffer: 4_000_000 },
          );
          return stdout.slice(0, 60_000) || "(no matches)";
        } catch (e: any) {
          return e?.code === 1 ? "(no matches)" : `grep failed: ${e?.message ?? e}`;
        }
      },
    }),
    ...(opts.canPatch
      ? [
          betaZodTool({
            name: "land_patch",
            description:
              "Land a patched version of the case being run, as the next minor version. Pass the COMPLETE case markdown. It is validated first; on errors nothing is written and the errors come back for you to fix.",
            inputSchema: z.object({ markdown: z.string() }),
            run: ({ markdown }) => {
              const result = lintCase(markdown);
              if (!result.ok) {
                return `REFUSED — fix these and call land_patch again:\n${result.errors
                  .map((f) => `(rule ${f.rule}) ${f.message}`)
                  .join("\n")}`;
              }
              const caseDir = findCaseDir(opts.dataDir, opts.testCaseId);
              if (!caseDir) return `REFUSED — case ${opts.testCaseId} not found in the data folder`;
              const id = nextMinorId(listVersionIds(caseDir));
              const file = path.join(caseDir, "versions", `v${id}.md`);
              if (existsSync(file)) return `REFUSED — ${file} already exists; do not retry`;
              writeFileSync(file, markdown, "utf8");
              proposedVersion = id;
              log(`landed patch v${id} of ${opts.testCaseId}`);
              return `landed v${id}`;
            },
          }),
        ]
      : []),
  ];

  const screenshot = path.join(opts.qDir, "screenshot.png");
  const content: any[] = [];
  if (existsSync(screenshot)) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: readFileSync(screenshot).toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: opts.brief + (opts.canPatch ? PATCH_TOOL_GUIDANCE : "") });

  const runner = client.beta.messages.toolRunner({
    model: opts.model,
    max_tokens: 16000,
    max_iterations: 30,
    messages: [{ role: "user", content }],
    tools,
  });
  const final = await runner.runUntilDone();

  const markdown = final.content
    .filter((b): b is { type: "text"; text: string } & typeof b => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!markdown) {
    warn(`api backend returned no text (stop_reason ${final.stop_reason})`);
    throw new Error(`no answer text (stop_reason ${final.stop_reason})`);
  }
  return { markdown, proposedVersion };
}
