import {
  agentAnswerMetaSchema,
  agentQuestionAckSchema,
  agentQuestionProgressSchema,
  agentCommandRequestSchema,
  agentCommandStatusSchema,
  agentQuestionFileSchema,
  agentWatcherSchema,
  AGENT_PROTOCOL_VERSION,
  buildCaptureDigest,
  buildRunSource,
  checkRunCompat,
  compareVersionIds,
  nextMajorId,
  versionFileName,
  versionIdFromFileName,
  emptyEnvironments,
  environmentsFileSchema,
  caseBookkeepingSchema,
  countsByStep,
  filterToQuickSteps,
  freeRunFileSchema,
  newCommandId,
  newFreeRunId,
  newQuestionId,
  newRunId,
  newTestCaseId,
  parseCaseDocument,
  parseJsonl,
  renderCaptureLog,
  renderFreeRunFeedback,
  renderRunFeedback,
  renderRunReport,
  resolveRunValues,
  mainDomainName,
  runFileSchema,
  stepComments,
  stepNumberLabels,
  stripViewerComment,
  substituteVariables,
  toJsonl,
  withViewerComment,
  CAPTURE_MAX_BYTES,
  ZERO_CAPTURE_COUNTS,
  type AgentCommand,
  type AgentCommandDisplay,
  type AgentCommandRequest,
  type AgentCommandSourceField,
  type AgentQuestion,
  type AgentPresence,
  type AgentQuestionFile,
  type CapturedEntry,
  type CaseBookkeeping,
  type CompatResult,
  type DataStore,
  type EnvironmentsFile,
  type FreeRun,
  type FreeRunFile,
  type Run,
  type RunFile,
  type RunStatus,
  type RunSummary,
  type RunTier,
  type StepPatch,
  type SuiteSummary,
  type TestCaseMeta,
  type TestCaseSummary,
  type TestCaseVersion,
  type VersionSummary,
} from "@tcm/shared";
import {
  appendTextFile,
  fileSize,
  getDir,
  listDirNames,
  nowIso,
  readJson,
  readTextFile,
  readTextTail,
  writeBinaryFile,
  writeJson,
  writeTextFile,
  tryGetDir,
  tryReadJson,
  tryReadTextFile,
  NotFoundError,
} from "./fs-utils.js";

const TEST_CASES_DIR = "test-cases";
const RUNS_DIR = "runs";
const FREE_RUNS_DIR = "free-runs";
const META_FILE = "meta.json";
const CASE_FILE = "case.md";
const RUN_FILE = "run.json";
const REPORT_FILE = "report.md";
const FEEDBACK_FILE = "feedback.md";
const FREE_RUN_FILE = "free-run.json";
const NOTES_FILE = "notes.md";
const SUITE_FILE = "suite.md";
/** Named value sets for runs — see shared/src/environments.ts. */
const ENVIRONMENTS_FILE = "environments.json";
/** What the page printed, as it arrived: one JSON object per line, appended a
 * batch at a time. The machine record — see `shared/src/capture.ts`. */
const CONSOLE_RECORD_FILE = "console.jsonl";
/** The same thing rendered for a person, written once when the run finishes. */
const CONSOLE_FILE = "console.md";

// ---- the agent channel (`agent/`) — protocol in shared/src/schemas.ts ----
const AGENT_DIR = "agent";
const QUESTIONS_DIR = "questions";
const COMMANDS_DIR = "commands";
const WATCHERS_DIR = "watchers";
/** A watcher file younger than this is a live server; mirrors the
 * daemon's own freshness window. */
const WATCHER_FRESH_MS = 180_000;
/** Touched by the panel while it is open; the watching session reads the
 * mtime, so the body is informational. */
const HEARTBEAT_FILE = "heartbeat.json";
const QUESTION_FILE = "question.json";
const QUESTION_SCREENSHOT_FILE = "screenshot.png";
const QUESTION_PAGE_FILE = "page.html";
/** Agent-written the moment a pass sees the question — "working on it". */
const QUESTION_ACK_FILE = "ack.json";
const QUESTION_PROGRESS_FILE = "progress.json";
const ANSWER_FILE = "answer.md";
const ANSWER_META_FILE = "answer.json";
const COMMAND_REQUEST_FILE = "request.json";
const COMMAND_STATUS_FILE = "status.json";
const COMMAND_LOG_FILE = "output.log";
/** Written by the spawn wrapper the moment the process exits — the agent
 * only ticks once a minute, so this outranks `status.json` for completion. */
const COMMAND_EXIT_FILE = "exit-code";
/** Empty flag file: the tester asked for a stop; the session does the kill. */
const COMMAND_KILL_FILE = "kill";
const LOG_TAIL_BYTES = 4096;
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 900;

/** Ids are `"3"` (authored major) or `"3.1"` (mid-run patch minor) — see
 * shared/src/version-id.ts. Sorted ascending by (major, minor). */
async function listVersionIds(versionsDir: FileSystemDirectoryHandle): Promise<string[]> {
  const versions: string[] = [];
  for await (const [name, handle] of versionsDir.entries()) {
    if (handle.kind !== "file") continue;
    const id = versionIdFromFileName(name);
    if (id !== null) versions.push(id);
  }
  return versions.sort(compareVersionIds);
}

async function readVersion(
  versionsDir: FileSystemDirectoryHandle,
  version: string,
): Promise<TestCaseVersion> {
  const { text, lastModified } = await readTextFile(versionsDir, versionFileName(version));
  return parseCaseDocument(text, { version, createdAt: lastModified });
}

/** A dir containing `suite.md` is a suite; a dir containing `versions/` is
 * a case. Exactly one level of suite nesting is supported. */
async function isSuiteDir(dir: FileSystemDirectoryHandle): Promise<boolean> {
  return (await tryReadTextFile(dir, SUITE_FILE)) !== null;
}

async function readSuiteDoc(
  suiteDir: FileSystemDirectoryHandle,
): Promise<TestCaseVersion> {
  const { text, lastModified } = await readTextFile(suiteDir, SUITE_FILE);
  return parseCaseDocument(text, { version: "1", createdAt: lastModified }, { requireSteps: false });
}

/** Most recently edited first — `updatedAt` is the current version file's
 * mtime, so a case rises to the top of the Library the moment a new version
 * lands. Title is the tie-break, which keeps ordering stable for cases
 * written in the same second (a batch import, or a skill writing several). */
function byRecentlyUpdated(a: TestCaseSummary, b: TestCaseSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);
}

/**
 * Adds a batch to a folder's console record, and stops at the byte ceiling.
 *
 * The ceiling is checked with a stat rather than by counting entries, so an
 * append stays a stat plus a positioned write however long the run has been
 * going. Crossing it writes one `notice` line and refuses everything after —
 * a marker in the log rather than a silence, because a reader has no way to
 * tell a capped log from a quiet page.
 *
 * `CAPTURE_MAX_BYTES` is compared against character counts, which undercounts
 * multi-byte text. It is a ceiling to keep a chatty app from making a run
 * unsavable, not an accounting contract.
 */
async function appendCapture(
  dir: FileSystemDirectoryHandle,
  entries: CapturedEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const size = await fileSize(dir, CONSOLE_RECORD_FILE);
  if (size >= CAPTURE_MAX_BYTES) return;

  let batch = entries;
  if (size + toJsonl(entries).length >= CAPTURE_MAX_BYTES) {
    const kept: CapturedEntry[] = [];
    let used = size;
    for (const entry of entries) {
      const line = `${JSON.stringify(entry)}\n`;
      if (used + line.length >= CAPTURE_MAX_BYTES) break;
      used += line.length;
      kept.push(entry);
    }
    kept.push({
      level: "notice",
      at: nowIso(),
      url: "",
      text:
        `Capture stopped at ${Math.round(CAPTURE_MAX_BYTES / 1024)} KB. ` +
        `${entries.length - kept.length} entries from this batch, and anything after it, ` +
        "were not recorded.",
    });
    batch = kept;
  }
  await appendTextFile(dir, CONSOLE_RECORD_FILE, toJsonl(batch));
}

async function readCapture(dir: FileSystemDirectoryHandle): Promise<CapturedEntry[]> {
  const file = await tryReadTextFile(dir, CONSOLE_RECORD_FILE);
  return file ? parseJsonl(file.text) : [];
}

function composeRun(doc: TestCaseVersion, runFile: RunFile): Run {
  const stateByStepId = new Map(runFile.steps.map((s) => [s.stepId, s]));
  const steps = doc.steps.map((step) => {
    const state = stateByStepId.get(step.id) ?? {
      stepId: step.id,
      // Mirrors createRun: an extra step's resting state is skipped, and a
      // run.json missing the entry should not resurrect it as pending.
      status: (step.extra ? "skipped" : "pending") as "skipped" | "pending",
      comments: [],
      draft: null,
      automatedResult: null,
      startedAt: null,
      finishedAt: null,
      ...ZERO_CAPTURE_COUNTS,
      rating: null,
    };
    // The definition is spread rather than copied field by field: `where`
    // and `note` are optional on the schema, so a list that forgot them
    // typechecked and the panel silently lost the address and the note.
    const { id: _id, ...definition } = step;
    return {
      ...definition,
      stepId: step.id,
      status: state.status,
      comments: state.comments,
      draft: state.draft,
      automatedResult: state.automatedResult,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      consoleErrors: state.consoleErrors,
      consoleWarnings: state.consoleWarnings,
      networkFailures: state.networkFailures,
      requests: state.requests,
      rating: state.rating,
    };
  });
  return {
    id: runFile.id,
    testCaseId: runFile.testCaseId,
    testCaseVersion: runFile.testCaseVersion,
    testCaseTitle: runFile.testCaseTitle,
    status: runFile.status,
    comment: runFile.comment,
    tier: runFile.tier,
    environment: runFile.environment,
    consoleInReport: runFile.consoleInReport,
    rating: runFile.rating,
    startedAt: runFile.startedAt,
    finishedAt: runFile.finishedAt,
    dependencies: doc.dependencies,
    prerequisites: doc.prerequisites,
    groups: doc.groups,
    mainOrigin: runFile.variables[mainDomainName(doc) ?? "BASE_URL"] ?? "",
    swaps: runFile.swaps,
    steps,
  };
}

export class FsaDataStore implements DataStore {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async testCasesDir(create = false): Promise<FileSystemDirectoryHandle> {
    return getDir(this.root, TEST_CASES_DIR, { create });
  }

  private async runsDir(create = false): Promise<FileSystemDirectoryHandle> {
    return getDir(this.root, RUNS_DIR, { create });
  }

  private async freeRunsDir(create = false): Promise<FileSystemDirectoryHandle> {
    return getDir(this.root, FREE_RUNS_DIR, { create });
  }

  /** Locates a case's folder — directly under `test-cases/`, or one level
   * down inside a suite folder. Ids are globally unique, so this never
   * has to disambiguate between candidates. */
  private async findCaseDir(
    id: string,
  ): Promise<{ dir: FileSystemDirectoryHandle; suiteId?: string }> {
    const casesDir = await this.testCasesDir(true);
    const direct = await tryGetDir(casesDir, id);
    if (direct && !(await isSuiteDir(direct))) return { dir: direct };

    for (const name of await listDirNames(casesDir)) {
      const rootDir = await getDir(casesDir, name);
      if (!(await isSuiteDir(rootDir))) continue;
      const child = await tryGetDir(rootDir, id);
      if (child) return { dir: child, suiteId: name };
    }
    throw new NotFoundError(`Test case not found: ${id}`);
  }

  // ---- TestCaseStore ----

  async listTestCases(): Promise<TestCaseSummary[]> {
    const dir = await this.testCasesDir(true);
    const rootNames = await listDirNames(dir);
    const summaries: TestCaseSummary[] = [];
    for (const name of rootNames) {
      const rootDir = await getDir(dir, name);
      const caseIds = (await isSuiteDir(rootDir)) ? await listDirNames(rootDir) : [name];
      for (const caseId of caseIds) {
        try {
          const meta = await this.getTestCase(caseId);
          summaries.push({
            id: meta.id,
            title: meta.title,
            project: meta.project,
            description: meta.description,
            tags: meta.tags,
            currentVersion: meta.currentVersion,
            updatedAt: meta.updatedAt,
            archived: meta.archived,
            suiteId: meta.suiteId,
          });
        } catch {
          // A folder with no parseable version yet (e.g. mid-write, or not
          // really a test case) — skip it rather than fail the whole listing.
        }
      }
    }
    summaries.sort(byRecentlyUpdated);
    return summaries;
  }

  async getTestCase(id: string): Promise<TestCaseMeta> {
    const { dir: caseDir, suiteId } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    const versions = await listVersionIds(versionsDir);
    if (versions.length === 0) {
      throw new NotFoundError(`No versions found for test case: ${id}`);
    }
    const currentVersion = versions[versions.length - 1];
    const [first, current, bookkeeping] = await Promise.all([
      readVersion(versionsDir, versions[0]),
      readVersion(versionsDir, currentVersion),
      tryReadJson(caseDir, META_FILE, caseBookkeepingSchema),
    ]);
    return {
      id,
      title: current.title,
      project: current.project,
      description: current.description,
      tags: current.tags,
      currentVersion,
      createdAt: first.createdAt,
      updatedAt: current.createdAt,
      archived: bookkeeping?.archived ?? false,
      suiteId,
    };
  }

  async listVersions(id: string): Promise<VersionSummary[]> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    const versions = await listVersionIds(versionsDir);
    const summaries: VersionSummary[] = [];
    for (const v of versions) {
      const doc = await readVersion(versionsDir, v);
      summaries.push({
        version: v,
        changeNote: doc.changeNote,
        createdAt: doc.createdAt,
        stepCount: doc.steps.length,
      });
    }
    return summaries;
  }

  async getVersion(id: string, version: string): Promise<TestCaseVersion> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions");
    return readVersion(versionsDir, version);
  }

  /** The authored text, with the generated viewer-link comment taken back
   * out — it is regenerated on every write, so an editor that showed it
   * would be inviting someone to hand-edit a line that is about to be
   * overwritten, and an export that kept it could carry a stale link. */
  async getVersionSource(id: string, version: string): Promise<string> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions");
    const { text } = await readTextFile(versionsDir, versionFileName(version));
    return stripViewerComment(text);
  }

  async createTestCase(bodyMarkdown: string, suiteId?: string): Promise<TestCaseMeta> {
    const parsed = parseCaseDocument(bodyMarkdown, { version: "1", createdAt: nowIso() });
    const id = newTestCaseId(parsed.title);
    const casesDir = await this.testCasesDir(true);
    const parentDir = suiteId ? await getDir(casesDir, suiteId, { create: true }) : casesDir;
    const caseDir = await getDir(parentDir, id, { create: true });
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    await writeTextFile(versionsDir, versionFileName("1"), await withViewerComment(bodyMarkdown));
    await writeJson(caseDir, META_FILE, { archived: false } satisfies CaseBookkeeping);
    return this.getTestCase(id);
  }

  async createVersion(id: string, bodyMarkdown: string): Promise<TestCaseVersion> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    const versions = await listVersionIds(versionsDir);
    // The editor and the authoring skills land majors; minors are the
    // serve patch path (validator `write --patch`).
    const nextVersion = nextMajorId(versions);
    // Validate before writing so a typo never lands as a broken version.
    parseCaseDocument(bodyMarkdown, { version: nextVersion, createdAt: nowIso() });
    // The link comment is appended on the way to disk rather than being the
    // author's to maintain: it encodes the file, so anything else would mean
    // a link that quietly stops matching the case it is attached to.
    await writeTextFile(
      versionsDir,
      versionFileName(nextVersion),
      await withViewerComment(bodyMarkdown),
    );
    return readVersion(versionsDir, nextVersion);
  }

  async archiveTestCase(id: string, archived: boolean): Promise<void> {
    const { dir: caseDir } = await this.findCaseDir(id);
    await writeJson(caseDir, META_FILE, { archived } satisfies CaseBookkeeping);
  }

  // ---- Suites ----

  async listSuites(): Promise<SuiteSummary[]> {
    const dir = await this.testCasesDir(true);
    const rootNames = await listDirNames(dir);
    const summaries: SuiteSummary[] = [];
    for (const name of rootNames) {
      const rootDir = await getDir(dir, name);
      if (!(await isSuiteDir(rootDir))) continue;
      try {
        const [doc, bookkeeping, caseIds] = await Promise.all([
          readSuiteDoc(rootDir),
          tryReadJson(rootDir, META_FILE, caseBookkeepingSchema),
          listDirNames(rootDir),
        ]);
        summaries.push({
          id: name,
          title: doc.title,
          project: doc.project,
          description: doc.description,
          tags: doc.tags,
          caseCount: caseIds.length,
          archived: bookkeeping?.archived ?? false,
        });
      } catch {
        // Unparseable suite.md — skip, consistent with case listing.
      }
    }
    summaries.sort((a, b) => a.title.localeCompare(b.title));
    return summaries;
  }

  async getSuite(
    id: string,
  ): Promise<{ doc: TestCaseVersion; cases: TestCaseSummary[]; archived: boolean }> {
    const suiteDir = await getDir(await this.testCasesDir(true), id);
    const [doc, bookkeeping, caseIds] = await Promise.all([
      readSuiteDoc(suiteDir),
      tryReadJson(suiteDir, META_FILE, caseBookkeepingSchema),
      listDirNames(suiteDir),
    ]);
    const cases: TestCaseSummary[] = [];
    for (const caseId of caseIds) {
      try {
        const meta = await this.getTestCase(caseId);
        cases.push({
          id: meta.id,
          title: meta.title,
          project: meta.project,
          description: meta.description,
          tags: meta.tags,
          currentVersion: meta.currentVersion,
          updatedAt: meta.updatedAt,
          archived: meta.archived,
          suiteId: meta.suiteId,
        });
      } catch {
        // Skip a case folder with no parseable version yet.
      }
    }
    cases.sort(byRecentlyUpdated);
    return { doc, cases, archived: bookkeeping?.archived ?? false };
  }

  async getSuiteSource(id: string): Promise<string> {
    const suiteDir = await getDir(await this.testCasesDir(true), id);
    const { text } = await readTextFile(suiteDir, SUITE_FILE);
    return text;
  }

  async createSuite(bodyMarkdown: string): Promise<SuiteSummary> {
    const parsed = parseCaseDocument(bodyMarkdown, { version: "1", createdAt: nowIso() }, { requireSteps: false });
    const id = newTestCaseId(parsed.title);
    const suiteDir = await getDir(await this.testCasesDir(true), id, { create: true });
    await writeTextFile(suiteDir, SUITE_FILE, bodyMarkdown);
    await writeJson(suiteDir, META_FILE, { archived: false } satisfies CaseBookkeeping);
    return {
      id,
      title: parsed.title,
      project: parsed.project,
      description: parsed.description,
      tags: parsed.tags,
      caseCount: 0,
      archived: false,
    };
  }

  async saveSuite(id: string, bodyMarkdown: string): Promise<void> {
    // Validate before writing so a typo never lands as a broken suite.
    parseCaseDocument(bodyMarkdown, { version: "1", createdAt: nowIso() }, { requireSteps: false });
    const suiteDir = await getDir(await this.testCasesDir(true), id);
    await writeTextFile(suiteDir, SUITE_FILE, bodyMarkdown);
  }

  async archiveSuite(id: string, archived: boolean): Promise<void> {
    const suiteDir = await getDir(await this.testCasesDir(true), id);
    await writeJson(suiteDir, META_FILE, { archived } satisfies CaseBookkeeping);
  }

  async getRunSource(testCaseId: string, version: string, tier: RunTier = "full"): Promise<string> {
    const { dir: caseDir, suiteId } = await this.findCaseDir(testCaseId);
    const versionsDir = await getDir(caseDir, "versions");
    const { text } = await readTextFile(versionsDir, versionFileName(version));
    // Filter before merging: a suite's prep steps are shared setup, not
    // optional coverage, so a quick run keeps all of them.
    const caseMarkdown = tier === "quick" ? filterToQuickSteps(text) : text;
    if (!suiteId) return caseMarkdown;
    const suiteDir = await getDir(await this.testCasesDir(true), suiteId);
    const suiteFile = await tryReadTextFile(suiteDir, SUITE_FILE);
    return buildRunSource(caseMarkdown, suiteFile?.text ?? null);
  }

  // ---- EnvironmentStore ----

  async getEnvironments(): Promise<EnvironmentsFile> {
    const file = await tryReadJson(this.root, ENVIRONMENTS_FILE, environmentsFileSchema);
    return file ?? emptyEnvironments();
  }

  async saveEnvironments(file: EnvironmentsFile): Promise<void> {
    await writeJson(this.root, ENVIRONMENTS_FILE, file);
  }

  /** One folder, one set of environments — the id only matters to the
   * multi-storage wrapper above this store. */
  async getEnvironmentsForCase(_testCaseId: string): Promise<EnvironmentsFile> {
    return this.getEnvironments();
  }

  // ---- RunStore ----

  async listRuns(testCaseId?: string): Promise<RunSummary[]> {
    const runsDir = await this.runsDir(true);
    const testCaseIds = testCaseId ? [testCaseId] : await listDirNames(runsDir);
    const summaries: RunSummary[] = [];
    for (const tcId of testCaseIds) {
      let tcRunsDir: FileSystemDirectoryHandle;
      try {
        tcRunsDir = await getDir(runsDir, tcId);
      } catch (e) {
        if (e instanceof NotFoundError) continue;
        throw e;
      }
      const runIds = await listDirNames(tcRunsDir);
      for (const runId of runIds) {
        const runDir = await getDir(tcRunsDir, runId);
        const runFile = await tryReadJson(runDir, RUN_FILE, runFileSchema);
        if (!runFile) continue;
        const passCount = runFile.steps.filter((s) => s.status === "success").length;
        const failCount = runFile.steps.filter((s) => s.status === "failed").length;
        const warnCount = runFile.steps.filter((s) => s.status === "warning").length;
        const skipCount = runFile.steps.filter((s) => s.status === "skipped").length;
        summaries.push({
          id: runFile.id,
          testCaseId: runFile.testCaseId,
          testCaseVersion: runFile.testCaseVersion,
          testCaseTitle: runFile.testCaseTitle,
          status: runFile.status,
          tier: runFile.tier,
          startedAt: runFile.startedAt,
          finishedAt: runFile.finishedAt,
          stepCount: runFile.steps.length,
          passCount,
          failCount,
          warnCount,
          skipCount,
        });
      }
    }
    summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return summaries;
  }

  async getRun(testCaseId: string, runId: string): Promise<Run> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
    ]);
    const doc = parseCaseDocument(rawMarkdown, {
      version: runFile.testCaseVersion,
      createdAt: runFile.startedAt,
    });
    return composeRun(doc, runFile);
  }

  /**
   * The one pipeline that turns a stored version into what a run freezes:
   * compose (suite prep merged, tier filtered), resolve values, substitute,
   * re-parse. `createRun` and the hot-swap both go through here — the swap's
   * whole correctness argument is that its `case.md` is byte-equivalent to
   * what `createRun` would have written for the same version and values.
   */
  private async composeRunSource(
    testCaseId: string,
    version: string,
    tier: RunTier,
    variableValues: Record<string, string>,
  ): Promise<{
    substitutedMarkdown: string;
    doc: TestCaseVersion;
    declared: TestCaseVersion;
    resolvedValues: Record<string, string>;
  }> {
    const rawMarkdown = await this.getRunSource(testCaseId, version, tier);
    const declared = parseCaseDocument(rawMarkdown, { version, createdAt: nowIso() });
    const resolvedValues = resolveRunValues(declared, variableValues);
    const substitutedMarkdown = substituteVariables(rawMarkdown, resolvedValues);
    const doc = parseCaseDocument(substitutedMarkdown, { version, createdAt: nowIso() });
    return { substitutedMarkdown, doc, declared, resolvedValues };
  }

  async createRun(
    testCaseId: string,
    version: string,
    variableValues: Record<string, string> = {},
    tier: RunTier = "full",
    environment = "",
  ): Promise<Run> {
    const { substitutedMarkdown, doc, resolvedValues } = await this.composeRunSource(
      testCaseId,
      version,
      tier,
      variableValues,
    );

    const runId = newRunId();
    const runsDir = await this.runsDir(true);
    const tcRunsDir = await getDir(runsDir, testCaseId, { create: true });
    const runDir = await getDir(tcRunsDir, runId, { create: true });

    // Verbatim copy of the *substituted* text — frozen forever, regardless
    // of later edits to the case or a different run's variable values.
    await writeTextFile(runDir, CASE_FILE, substitutedMarkdown);

    const now = nowIso();
    const runFile: RunFile = {
      id: runId,
      testCaseId,
      testCaseVersion: version,
      testCaseTitle: doc.title,
      status: "in_progress",
      comment: "",
      tier,
      environment,
      consoleInReport: false,
      rating: null,
      startedAt: now,
      finishedAt: null,
      variables: resolvedValues,
      swaps: [],
      steps: doc.steps.map((s) => ({
        stepId: s.id,
        // An extra step is opt-in: it starts the run already skipped, so the
        // "current step" walk passes over it and an untouched one finishes
        // the run as what it truthfully was — skipped, not left undone.
        status: s.extra ? "skipped" : "pending",
        comments: [],
        draft: null,
        automatedResult: null,
        startedAt: null,
        finishedAt: null,
        ...ZERO_CAPTURE_COUNTS,
        rating: null,
      })),
    };
    await writeJson(runDir, RUN_FILE, runFile);

    return composeRun(doc, runFile);
  }

  async updateStep(
    testCaseId: string,
    runId: string,
    stepId: string,
    patch: StepPatch,
  ): Promise<Run> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
    ]);
    const index = runFile.steps.findIndex((s) => s.stepId === stepId);
    if (index === -1) throw new Error(`Step not found in run: ${stepId}`);
    runFile.steps[index] = { ...runFile.steps[index], ...patch };
    await writeJson(runDir, RUN_FILE, runFile);

    const doc = parseCaseDocument(rawMarkdown, {
      version: runFile.testCaseVersion,
      createdAt: runFile.startedAt,
    });
    return composeRun(doc, runFile);
  }

  async updateRun(
    testCaseId: string,
    runId: string,
    patch: { comment?: string; consoleInReport?: boolean; rating?: number | null },
  ): Promise<Run> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
    ]);
    const updated: RunFile = {
      ...runFile,
      comment: patch.comment ?? runFile.comment,
      consoleInReport: patch.consoleInReport ?? runFile.consoleInReport,
      // `null` is a value here — clearing the stars — so `??` would be wrong.
      rating: patch.rating === undefined ? runFile.rating : patch.rating,
    };
    await writeJson(runDir, RUN_FILE, updated);

    const doc = parseCaseDocument(rawMarkdown, {
      version: updated.testCaseVersion,
      createdAt: updated.startedAt,
    });
    return composeRun(doc, updated);
  }

  async appendConsole(
    testCaseId: string,
    runId: string,
    entries: CapturedEntry[],
  ): Promise<void> {
    await appendCapture(await this.getRunDir(testCaseId, runId), entries);
  }

  async finishRun(testCaseId: string, runId: string, status: RunStatus): Promise<Run> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile, captured] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
      readCapture(runDir),
    ]);

    // Counts are folded in here rather than on every append: they are only
    // ever read after a run finishes, and rewriting run.json every few seconds
    // for the sake of three integers would fight the step patches for the same
    // file. Entries that arrived outside any step are in `console.md` and in
    // the digest, but belong to no step's tally.
    const byStep = countsByStep(captured);
    const updated: RunFile = {
      ...runFile,
      status,
      finishedAt: nowIso(),
      steps: runFile.steps.map((step) => ({
        ...step,
        // A comment left in the box is a comment. Promoting it here means the
        // stored run is canonical from the moment it finishes, rather than
        // every future reader having to remember the box existed.
        comments: stepComments(step),
        draft: null,
        ...(byStep.get(step.stepId) ?? ZERO_CAPTURE_COUNTS),
      })),
    };
    await writeJson(runDir, RUN_FILE, updated);

    const doc = parseCaseDocument(rawMarkdown, {
      version: updated.testCaseVersion,
      createdAt: updated.startedAt,
    });

    if (captured.length > 0) {
      const labels = stepNumberLabels(doc.steps);
      const stepNumbers = new Map(doc.steps.map((step, index) => [step.id, labels[index]]));
      await writeTextFile(
        runDir,
        CONSOLE_FILE,
        renderCaptureLog(captured, {
          title: doc.title,
          subtitle: `Run ${updated.id} of v${updated.testCaseVersion}, started ${updated.startedAt}.`,
          stepLabel: (stepId) => {
            const number = stepNumbers.get(stepId);
            const step = doc.steps.find((s) => s.id === stepId);
            return number && step ? `Step ${number} — ${step.title}` : stepId;
          },
        }),
      );
    }

    // The digest is what crosses into the two files an agent reads, so it is
    // built only when the tester said it may. `console.md` stays on disk
    // either way: the checkbox governs what is handed on, not what is kept.
    const digest =
      captured.length > 0 && updated.consoleInReport ? buildCaptureDigest(captured) : null;

    // Human-readable artifact for sharing outside the extension (e.g. email)
    // — run.json stays the JSON source of truth the UI actually reads back.
    await writeTextFile(runDir, REPORT_FILE, renderRunReport(doc, updated, digest));

    const feedback = renderRunFeedback(doc, updated, digest);
    if (feedback) await writeTextFile(runDir, FEEDBACK_FILE, feedback);

    return composeRun(doc, updated);
  }

  async getRunFeedback(testCaseId: string, runId: string): Promise<string | null> {
    const runDir = await this.getRunDir(testCaseId, runId);
    try {
      return (await readTextFile(runDir, FEEDBACK_FILE)).text;
    } catch (e) {
      // finishRun writes the file only when there is something in it, so a
      // missing file is the ordinary "clean pass" case, not an error.
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  private async getRunDir(
    testCaseId: string,
    runId: string,
  ): Promise<FileSystemDirectoryHandle> {
    const runsDir = await this.runsDir(true);
    const tcRunsDir = await getDir(runsDir, testCaseId);
    return getDir(tcRunsDir, runId);
  }

  // ---- FreeRunStore ----

  async listFreeRuns(): Promise<FreeRunFile[]> {
    const dir = await this.freeRunsDir(true);
    const ids = await listDirNames(dir);
    const files: FreeRunFile[] = [];
    for (const id of ids) {
      const freeRunDir = await getDir(dir, id);
      const file = await tryReadJson(freeRunDir, FREE_RUN_FILE, freeRunFileSchema);
      if (file) files.push(file);
    }
    files.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return files;
  }

  async getFreeRun(id: string): Promise<FreeRun> {
    const dir = await getDir(await this.freeRunsDir(true), id);
    const [file, notesFile] = await Promise.all([
      readJson(dir, FREE_RUN_FILE, freeRunFileSchema),
      tryReadTextFile(dir, NOTES_FILE),
    ]);
    return { ...file, notes: notesFile?.text ?? "" };
  }

  async createFreeRun(title: string): Promise<FreeRun> {
    const id = newFreeRunId();
    const dir = await getDir(await this.freeRunsDir(true), id, { create: true });
    const file: FreeRunFile = { id, title, startedAt: nowIso(), finishedAt: null };
    await writeJson(dir, FREE_RUN_FILE, file);
    await writeTextFile(dir, NOTES_FILE, "");
    await writeTextFile(dir, FEEDBACK_FILE, renderFreeRunFeedback(file, ""));
    return { ...file, notes: "" };
  }

  async updateFreeRun(id: string, patch: { title?: string; notes?: string }): Promise<FreeRun> {
    const dir = await getDir(await this.freeRunsDir(true), id);
    const [file, existingNotes] = await Promise.all([
      readJson(dir, FREE_RUN_FILE, freeRunFileSchema),
      tryReadTextFile(dir, NOTES_FILE),
    ]);
    const updated: FreeRunFile = { ...file, title: patch.title ?? file.title };
    const notes = patch.notes ?? existingNotes?.text ?? "";
    await writeJson(dir, FREE_RUN_FILE, updated);
    await writeTextFile(dir, NOTES_FILE, notes);
    await writeTextFile(dir, FEEDBACK_FILE, renderFreeRunFeedback(updated, notes));
    return { ...updated, notes };
  }

  async appendFreeRunConsole(id: string, entries: CapturedEntry[]): Promise<void> {
    await appendCapture(await getDir(await this.freeRunsDir(true), id), entries);
  }

  async finishFreeRun(id: string): Promise<FreeRun> {
    const dir = await getDir(await this.freeRunsDir(true), id);
    const [file, notesFile, captured] = await Promise.all([
      readJson(dir, FREE_RUN_FILE, freeRunFileSchema),
      tryReadTextFile(dir, NOTES_FILE),
      readCapture(dir),
    ]);
    const notes = notesFile?.text ?? "";
    const updated: FreeRunFile = { ...file, finishedAt: nowIso() };
    await writeJson(dir, FREE_RUN_FILE, updated);
    await writeTextFile(dir, FEEDBACK_FILE, renderFreeRunFeedback(updated, notes));
    // A free run has no steps to hang entries off, so everything groups under
    // the session. It is also why nothing from here reaches `feedback.md`:
    // there is no finish bar to ask the question in, and an unasked question
    // is not consent.
    if (captured.length > 0) {
      await writeTextFile(
        dir,
        CONSOLE_FILE,
        renderCaptureLog(captured, {
          title: updated.title,
          subtitle: `Free run ${updated.id}, started ${updated.startedAt}.`,
          unstepped: "During the session",
        }),
      );
    }
    return { ...updated, notes };
  }

  // ---- AgentChannelStore ----

  /** `agent/` is created by the first ask/request and never by connect or
   * heartbeat — its presence is what tells both sides the channel is in
   * use, so an unused folder must stay clean. */
  private async questionsDir(create = false): Promise<FileSystemDirectoryHandle> {
    return getDir(await getDir(this.root, AGENT_DIR, { create }), QUESTIONS_DIR, { create });
  }

  private async commandsDir(create = false): Promise<FileSystemDirectoryHandle> {
    return getDir(await getDir(this.root, AGENT_DIR, { create }), COMMANDS_DIR, { create });
  }

  async askQuestion(
    testCaseId: string,
    runId: string,
    draft: {
      stepId: string;
      question: string;
      selection: string;
      pageUrl: string;
      screenshotPng: Uint8Array | null;
      pageHtml: string | null;
    },
  ): Promise<AgentQuestion> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
    ]);
    const doc = parseCaseDocument(rawMarkdown, {
      version: runFile.testCaseVersion,
      createdAt: runFile.startedAt,
    });
    const step = doc.steps.find((s) => s.id === draft.stepId);
    if (!step) throw new NotFoundError(`Step not found: ${draft.stepId}`);
    const attachments = [
      ...(draft.screenshotPng ? [QUESTION_SCREENSHOT_FILE] : []),
      ...(draft.pageHtml ? [QUESTION_PAGE_FILE] : []),
    ];
    const question: AgentQuestionFile = {
      id: newQuestionId(),
      testCaseId,
      runId,
      testCaseVersion: runFile.testCaseVersion,
      stepId: draft.stepId,
      stepTitle: step.title,
      selection: draft.selection,
      question: draft.question,
      environment: runFile.environment,
      pageUrl: draft.pageUrl,
      attachments,
      askedAt: nowIso(),
    };
    const qDir = await getDir(await this.questionsDir(true), question.id, { create: true });
    // Attachments land before question.json so a serve pass that sees the
    // question sees its evidence too — the envelope is the ready marker.
    if (draft.screenshotPng) {
      await writeBinaryFile(qDir, QUESTION_SCREENSHOT_FILE, draft.screenshotPng);
    }
    if (draft.pageHtml) await writeTextFile(qDir, QUESTION_PAGE_FILE, draft.pageHtml);
    await writeJson(qDir, QUESTION_FILE, question);
    return { ...question, pickedUpAt: null, pickedUpBy: null, progress: null, answer: null };
  }

  async listQuestions(testCaseId: string, runId: string): Promise<AgentQuestion[]> {
    const agentDir = await tryGetDir(this.root, AGENT_DIR);
    const questionsDir = agentDir && (await tryGetDir(agentDir, QUESTIONS_DIR));
    if (!questionsDir) return [];
    const questions: AgentQuestion[] = [];
    for (const name of await listDirNames(questionsDir)) {
      const qDir = await getDir(questionsDir, name);
      const question = await tryReadJson(qDir, QUESTION_FILE, agentQuestionFileSchema);
      if (!question || question.testCaseId !== testCaseId || question.runId !== runId) continue;
      // The agent writes answer.md first and answer.json second; only the
      // pair counts as answered, so a half-written answer is never shown.
      const [ack, progress, markdown, meta] = await Promise.all([
        tryReadJson(qDir, QUESTION_ACK_FILE, agentQuestionAckSchema),
        tryReadJson(qDir, QUESTION_PROGRESS_FILE, agentQuestionProgressSchema),
        tryReadTextFile(qDir, ANSWER_FILE),
        tryReadJson(qDir, ANSWER_META_FILE, agentAnswerMetaSchema),
      ]);
      questions.push({
        ...question,
        pickedUpAt: ack?.pickedUpAt ?? null,
        pickedUpBy: ack?.by?.kind ?? null,
        progress: progress?.text.trim() ? { text: progress.text.trim(), at: progress.at } : null,
        answer: markdown && meta ? { markdown: markdown.text, meta } : null,
      });
    }
    // Ids embed the asked-at stamp, so lexicographic is chronological.
    return questions.sort((a, b) => a.id.localeCompare(b.id));
  }

  private async composeCommand(
    dir: FileSystemDirectoryHandle,
    request: AgentCommandRequest,
  ): Promise<AgentCommand> {
    const [status, exitText, killFlag, logTail] = await Promise.all([
      tryReadJson(dir, COMMAND_STATUS_FILE, agentCommandStatusSchema),
      tryReadTextFile(dir, COMMAND_EXIT_FILE),
      tryReadTextFile(dir, COMMAND_KILL_FILE),
      readTextTail(dir, COMMAND_LOG_FILE, LOG_TAIL_BYTES),
    ]);
    const exitCode = exitText ? Number.parseInt(exitText.text.trim(), 10) : null;
    const finishedOnDisk = exitCode !== null && Number.isFinite(exitCode);

    let display: AgentCommandDisplay;
    if (status?.state === "refused") display = "refused";
    else if (finishedOnDisk) display = "exited";
    else if (status?.state === "killed") display = "killed";
    else if (!status) display = killFlag ? "stopping" : "queued";
    else display = killFlag ? "stopping" : "running";

    return {
      ...request,
      display,
      exitCode: finishedOnDisk ? exitCode : (status?.exitCode ?? null),
      reason: status?.reason ?? null,
      logTail,
    };
  }

  async requestCommand(
    testCaseId: string,
    runId: string,
    draft: { command: string; stepId: string | null; sourceField: AgentCommandSourceField },
  ): Promise<AgentCommand> {
    const request: AgentCommandRequest = {
      id: newCommandId(),
      testCaseId,
      runId,
      stepId: draft.stepId,
      sourceField: draft.sourceField,
      command: draft.command,
      timeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
      requestedAt: nowIso(),
    };
    const dir = await getDir(await this.commandsDir(true), request.id, { create: true });
    await writeJson(dir, COMMAND_REQUEST_FILE, request);
    return { ...request, display: "queued", exitCode: null, reason: null, logTail: "" };
  }

  async listCommands(testCaseId: string, runId: string): Promise<AgentCommand[]> {
    const agentDir = await tryGetDir(this.root, AGENT_DIR);
    const commandsDir = agentDir && (await tryGetDir(agentDir, COMMANDS_DIR));
    if (!commandsDir) return [];
    const commands: AgentCommand[] = [];
    for (const name of await listDirNames(commandsDir)) {
      const dir = await getDir(commandsDir, name);
      const request = await tryReadJson(dir, COMMAND_REQUEST_FILE, agentCommandRequestSchema);
      if (!request || request.testCaseId !== testCaseId || request.runId !== runId) continue;
      commands.push(await this.composeCommand(dir, request));
    }
    return commands.sort((a, b) => a.id.localeCompare(b.id));
  }

  async killCommand(_testCaseId: string, commandId: string): Promise<void> {
    const dir = await getDir(await this.commandsDir(), commandId);
    await writeTextFile(dir, COMMAND_KILL_FILE, "");
  }

  /** The asked step is exempt from freezing (and reset on swap), so the
   * question named by the offer has to be looked up — but only trusted when
   * it really belongs to this run. */
  private async allowedStepIds(
    testCaseId: string,
    runId: string,
    questionId: string | null,
  ): Promise<string[]> {
    if (!questionId) return [];
    const agentDir = await tryGetDir(this.root, AGENT_DIR);
    const questionsDir = agentDir && (await tryGetDir(agentDir, QUESTIONS_DIR));
    const qDir = questionsDir && (await tryGetDir(questionsDir, questionId));
    if (!qDir) return [];
    const question = await tryReadJson(qDir, QUESTION_FILE, agentQuestionFileSchema);
    if (!question || question.testCaseId !== testCaseId || question.runId !== runId) return [];
    return [question.stepId];
  }

  /** The shared front half of preview and swap: read the run, compose the
   * candidate exactly as `createRun` would, and judge it. */
  private async prepareSwap(
    testCaseId: string,
    runId: string,
    toVersion: string,
    questionId: string | null,
  ): Promise<{
    runDir: FileSystemDirectoryHandle;
    runFile: RunFile;
    verdict: CompatResult;
    substitutedMarkdown: string;
    doc: TestCaseVersion;
    allowStepIds: string[];
  }> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile, allowStepIds] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
      this.allowedStepIds(testCaseId, runId, questionId),
    ]);
    if (runFile.status !== "in_progress") {
      throw new Error("Only an in-flight run can swap versions.");
    }
    const currentDoc = parseCaseDocument(rawMarkdown, {
      version: runFile.testCaseVersion,
      createdAt: runFile.startedAt,
    });
    const { substitutedMarkdown, doc, declared } = await this.composeRunSource(
      testCaseId,
      toVersion,
      runFile.tier,
      runFile.variables,
    );
    // A run recorded before variable snapshots existed cannot prove the
    // candidate composes to the same values its case.md was frozen with.
    const verdict: CompatResult =
      declared.variables.length + declared.domains.length > 0 && Object.keys(runFile.variables).length === 0
        ? {
            ok: false,
            reasons: ["this run predates variable snapshots, so a candidate cannot be composed identically"],
            changedStepIds: [],
          }
        : checkRunCompat(currentDoc, doc, runFile.steps, { allowStepIds });
    return { runDir, runFile, verdict, substitutedMarkdown, doc, allowStepIds };
  }

  async previewSwap(
    testCaseId: string,
    runId: string,
    toVersion: string,
    questionId: string | null,
  ): Promise<CompatResult> {
    const { verdict } = await this.prepareSwap(testCaseId, runId, toVersion, questionId);
    return verdict;
  }

  async swapRunVersion(
    testCaseId: string,
    runId: string,
    toVersion: string,
    questionId: string | null,
  ): Promise<Run> {
    const { runDir, runFile, verdict, substitutedMarkdown, doc, allowStepIds } =
      await this.prepareSwap(testCaseId, runId, toVersion, questionId);
    if (!verdict.ok) {
      throw new Error(`v${toVersion} is not compatible with this run: ${verdict.reasons.join("; ")}`);
    }
    // The asked step may have changed despite carrying a verdict — the one
    // exemption `allowStepIds` buys. A verdict on text that no longer exists
    // is not kept: the step goes back to undone (an extra to its resting
    // skipped state) so the tester re-does it against the new instructions.
    // Comments stay — the tester's words are about the situation, not the
    // wording; the automated result goes — it ran the old script.
    const reset = new Set(
      allowStepIds.filter((id) => verdict.changedStepIds.includes(id)),
    );
    const steps = runFile.steps.map((state, i) => {
      if (!reset.has(state.stepId)) return state;
      if (state.status === "pending" || state.status === "running") return state;
      return {
        ...state,
        status: (doc.steps[i]?.extra ? "skipped" : "pending") as "skipped" | "pending",
        startedAt: null,
        finishedAt: null,
        automatedResult: null,
      };
    });
    const updated: RunFile = {
      ...runFile,
      testCaseVersion: toVersion,
      testCaseTitle: doc.title,
      swaps: [
        ...runFile.swaps,
        { fromVersion: runFile.testCaseVersion, toVersion, at: nowIso(), questionId },
      ],
      steps,
    };
    await writeTextFile(runDir, CASE_FILE, substitutedMarkdown);
    await writeJson(runDir, RUN_FILE, updated);
    return composeRun(doc, updated);
  }

  async agentPresence(_testCaseId: string): Promise<AgentPresence | null> {
    const agentDir = await tryGetDir(this.root, AGENT_DIR);
    const watchersDir = agentDir && (await tryGetDir(agentDir, WATCHERS_DIR));
    if (!watchersDir) return null;
    let present: AgentPresence | null = null;
    for await (const [name, handle] of watchersDir.entries()) {
      if (handle.kind !== "file") continue;
      const file = await tryReadTextFile(watchersDir, name);
      if (!file || Date.now() - Date.parse(file.lastModified) > WATCHER_FRESH_MS) continue;
      let watcher;
      try {
        watcher = agentWatcherSchema.parse(JSON.parse(file.text));
      } catch {
        continue;
      }
      // A file without `protocol` predates versioning, which was wire v1.
      const presence = { kind: watcher.kind, protocol: watcher.protocol ?? 1 };
      // claude-code wins the label when both are fresh — it answers first.
      if (presence.kind === "claude-code") return presence;
      present = presence;
    }
    return present;
  }

  async touchHeartbeat(): Promise<void> {
    const agentDir = await tryGetDir(this.root, AGENT_DIR);
    if (!agentDir) return;
    // The body says who the panel is, so a server can flag a protocol
    // mismatch; the mtime stays the liveness signal.
    let extension = "";
    try {
      extension = chrome.runtime.getManifest().version;
    } catch {
      // Not running as an extension (tests) — version stays blank.
    }
    await writeJson(agentDir, HEARTBEAT_FILE, {
      touchedAt: nowIso(),
      protocol: AGENT_PROTOCOL_VERSION,
      extension,
    });
  }
}
