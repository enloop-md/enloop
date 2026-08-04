import {
  buildRunSource,
  caseBookkeepingSchema,
  filterToQuickSteps,
  freeRunFileSchema,
  newFreeRunId,
  newRunId,
  newTestCaseId,
  parseCaseDocument,
  renderFreeRunFeedback,
  renderRunFeedback,
  renderRunReport,
  resolveVariableValues,
  runFileSchema,
  substituteVariables,
  type CaseBookkeeping,
  type DataStore,
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
  getDir,
  listDirNames,
  nowIso,
  readJson,
  readTextFile,
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

function versionFile(version: number): string {
  return `v${version}.md`;
}

const VERSION_FILE_RE = /^v(\d+)\.md$/;

async function listVersionNumbers(versionsDir: FileSystemDirectoryHandle): Promise<number[]> {
  const versions: number[] = [];
  for await (const [name, handle] of versionsDir.entries()) {
    if (handle.kind !== "file") continue;
    const match = VERSION_FILE_RE.exec(name);
    if (match) versions.push(Number(match[1]));
  }
  return versions.sort((a, b) => a - b);
}

async function readVersion(
  versionsDir: FileSystemDirectoryHandle,
  version: number,
): Promise<TestCaseVersion> {
  const { text, lastModified } = await readTextFile(versionsDir, versionFile(version));
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
  return parseCaseDocument(text, { version: 1, createdAt: lastModified }, { requireSteps: false });
}

/** Most recently edited first — `updatedAt` is the current version file's
 * mtime, so a case rises to the top of the Library the moment a new version
 * lands. Title is the tie-break, which keeps ordering stable for cases
 * written in the same second (a batch import, or a skill writing several). */
function byRecentlyUpdated(a: TestCaseSummary, b: TestCaseSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);
}

function composeRun(doc: TestCaseVersion, runFile: RunFile): Run {
  const stateByStepId = new Map(runFile.steps.map((s) => [s.stepId, s]));
  const steps = doc.steps.map((step) => {
    const state = stateByStepId.get(step.id) ?? {
      stepId: step.id,
      status: "pending" as const,
      comment: "",
      notes: [],
      tasks: [],
      automatedResult: null,
      startedAt: null,
      finishedAt: null,
    };
    return {
      stepId: step.id,
      order: step.order,
      title: step.title,
      type: step.type,
      instructions: step.instructions,
      expected: step.expected,
      script: step.script,
      selectors: step.selectors,
      quick: step.quick,
      status: state.status,
      comment: state.comment,
      notes: state.notes,
      tasks: state.tasks,
      automatedResult: state.automatedResult,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
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
    startedAt: runFile.startedAt,
    finishedAt: runFile.finishedAt,
    dependencies: doc.dependencies,
    prerequisites: doc.prerequisites,
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
    const versions = await listVersionNumbers(versionsDir);
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
    const versions = await listVersionNumbers(versionsDir);
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

  async getVersion(id: string, version: number): Promise<TestCaseVersion> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions");
    return readVersion(versionsDir, version);
  }

  async getVersionSource(id: string, version: number): Promise<string> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions");
    const { text } = await readTextFile(versionsDir, versionFile(version));
    return text;
  }

  async createTestCase(bodyMarkdown: string, suiteId?: string): Promise<TestCaseMeta> {
    const parsed = parseCaseDocument(bodyMarkdown, { version: 1, createdAt: nowIso() });
    const id = newTestCaseId(parsed.title);
    const casesDir = await this.testCasesDir(true);
    const parentDir = suiteId ? await getDir(casesDir, suiteId, { create: true }) : casesDir;
    const caseDir = await getDir(parentDir, id, { create: true });
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    await writeTextFile(versionsDir, versionFile(1), bodyMarkdown);
    await writeJson(caseDir, META_FILE, { archived: false } satisfies CaseBookkeeping);
    return this.getTestCase(id);
  }

  async createVersion(id: string, bodyMarkdown: string): Promise<TestCaseVersion> {
    const { dir: caseDir } = await this.findCaseDir(id);
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    const versions = await listVersionNumbers(versionsDir);
    const nextVersion = (versions[versions.length - 1] ?? 0) + 1;
    // Validate before writing so a typo never lands as a broken version.
    parseCaseDocument(bodyMarkdown, { version: nextVersion, createdAt: nowIso() });
    await writeTextFile(versionsDir, versionFile(nextVersion), bodyMarkdown);
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
    const parsed = parseCaseDocument(bodyMarkdown, { version: 1, createdAt: nowIso() }, { requireSteps: false });
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
    parseCaseDocument(bodyMarkdown, { version: 1, createdAt: nowIso() }, { requireSteps: false });
    const suiteDir = await getDir(await this.testCasesDir(true), id);
    await writeTextFile(suiteDir, SUITE_FILE, bodyMarkdown);
  }

  async archiveSuite(id: string, archived: boolean): Promise<void> {
    const suiteDir = await getDir(await this.testCasesDir(true), id);
    await writeJson(suiteDir, META_FILE, { archived } satisfies CaseBookkeeping);
  }

  async getRunSource(testCaseId: string, version: number, tier: RunTier = "full"): Promise<string> {
    const { dir: caseDir, suiteId } = await this.findCaseDir(testCaseId);
    const versionsDir = await getDir(caseDir, "versions");
    const { text } = await readTextFile(versionsDir, versionFile(version));
    // Filter before merging: a suite's prep steps are shared setup, not
    // optional coverage, so a quick run keeps all of them.
    const caseMarkdown = tier === "quick" ? filterToQuickSteps(text) : text;
    if (!suiteId) return caseMarkdown;
    const suiteDir = await getDir(await this.testCasesDir(true), suiteId);
    const suiteFile = await tryReadTextFile(suiteDir, SUITE_FILE);
    return buildRunSource(caseMarkdown, suiteFile?.text ?? null);
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

  async createRun(
    testCaseId: string,
    version: number,
    variableValues: Record<string, string> = {},
    tier: RunTier = "full",
  ): Promise<Run> {
    const rawMarkdown = await this.getRunSource(testCaseId, version, tier);
    const declared = parseCaseDocument(rawMarkdown, { version, createdAt: nowIso() });
    const resolvedValues = resolveVariableValues(declared.variables, variableValues);
    const substitutedMarkdown = substituteVariables(rawMarkdown, resolvedValues);
    const doc = parseCaseDocument(substitutedMarkdown, { version, createdAt: nowIso() });

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
      startedAt: now,
      finishedAt: null,
      steps: doc.steps.map((s) => ({
        stepId: s.id,
        status: "pending",
        comment: "",
        notes: [],
        tasks: [],
        automatedResult: null,
        startedAt: null,
        finishedAt: null,
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
    patch: { comment?: string },
  ): Promise<Run> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
    ]);
    const updated: RunFile = { ...runFile, comment: patch.comment ?? runFile.comment };
    await writeJson(runDir, RUN_FILE, updated);

    const doc = parseCaseDocument(rawMarkdown, {
      version: updated.testCaseVersion,
      createdAt: updated.startedAt,
    });
    return composeRun(doc, updated);
  }

  async finishRun(testCaseId: string, runId: string, status: RunStatus): Promise<Run> {
    const runDir = await this.getRunDir(testCaseId, runId);
    const [{ text: rawMarkdown }, runFile] = await Promise.all([
      readTextFile(runDir, CASE_FILE),
      readJson(runDir, RUN_FILE, runFileSchema),
    ]);
    const updated: RunFile = { ...runFile, status, finishedAt: nowIso() };
    await writeJson(runDir, RUN_FILE, updated);

    const doc = parseCaseDocument(rawMarkdown, {
      version: updated.testCaseVersion,
      createdAt: updated.startedAt,
    });
    // Human-readable artifact for sharing outside the extension (e.g. email)
    // — run.json stays the JSON source of truth the UI actually reads back.
    await writeTextFile(runDir, REPORT_FILE, renderRunReport(doc, updated));

    const feedback = renderRunFeedback(doc, updated);
    if (feedback) await writeTextFile(runDir, FEEDBACK_FILE, feedback);

    return composeRun(doc, updated);
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

  async finishFreeRun(id: string): Promise<FreeRun> {
    const dir = await getDir(await this.freeRunsDir(true), id);
    const [file, notesFile] = await Promise.all([
      readJson(dir, FREE_RUN_FILE, freeRunFileSchema),
      tryReadTextFile(dir, NOTES_FILE),
    ]);
    const notes = notesFile?.text ?? "";
    const updated: FreeRunFile = { ...file, finishedAt: nowIso() };
    await writeJson(dir, FREE_RUN_FILE, updated);
    await writeTextFile(dir, FEEDBACK_FILE, renderFreeRunFeedback(updated, notes));
    return { ...updated, notes };
  }
}
