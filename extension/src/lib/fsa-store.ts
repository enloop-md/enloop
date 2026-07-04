import {
  caseBookkeepingSchema,
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
  type StepPatch,
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
      selector: step.selector,
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
    startedAt: runFile.startedAt,
    finishedAt: runFile.finishedAt,
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

  // ---- TestCaseStore ----

  async listTestCases(): Promise<TestCaseSummary[]> {
    const dir = await this.testCasesDir(true);
    const ids = await listDirNames(dir);
    const summaries: TestCaseSummary[] = [];
    for (const id of ids) {
      try {
        const meta = await this.getTestCase(id);
        summaries.push({
          id: meta.id,
          title: meta.title,
          description: meta.description,
          tags: meta.tags,
          currentVersion: meta.currentVersion,
          updatedAt: meta.updatedAt,
          archived: meta.archived,
        });
      } catch {
        // A folder under test-cases/ with no parseable version yet (e.g.
        // mid-write, or not really a test case) — skip it rather than fail
        // the whole listing.
      }
    }
    summaries.sort((a, b) => a.title.localeCompare(b.title));
    return summaries;
  }

  async getTestCase(id: string): Promise<TestCaseMeta> {
    const caseDir = await getDir(await this.testCasesDir(true), id);
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
      description: current.description,
      tags: current.tags,
      currentVersion,
      createdAt: first.createdAt,
      updatedAt: current.createdAt,
      archived: bookkeeping?.archived ?? false,
    };
  }

  async listVersions(id: string): Promise<VersionSummary[]> {
    const caseDir = await getDir(await this.testCasesDir(true), id);
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
    const caseDir = await getDir(await this.testCasesDir(true), id);
    const versionsDir = await getDir(caseDir, "versions");
    return readVersion(versionsDir, version);
  }

  async getVersionSource(id: string, version: number): Promise<string> {
    const caseDir = await getDir(await this.testCasesDir(true), id);
    const versionsDir = await getDir(caseDir, "versions");
    const { text } = await readTextFile(versionsDir, versionFile(version));
    return text;
  }

  async createTestCase(bodyMarkdown: string): Promise<TestCaseMeta> {
    const parsed = parseCaseDocument(bodyMarkdown, { version: 1, createdAt: nowIso() });
    const id = newTestCaseId(parsed.title);
    const casesDir = await this.testCasesDir(true);
    const caseDir = await getDir(casesDir, id, { create: true });
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    await writeTextFile(versionsDir, versionFile(1), bodyMarkdown);
    await writeJson(caseDir, META_FILE, { archived: false } satisfies CaseBookkeeping);
    return this.getTestCase(id);
  }

  async createVersion(id: string, bodyMarkdown: string): Promise<TestCaseVersion> {
    const caseDir = await getDir(await this.testCasesDir(true), id);
    const versionsDir = await getDir(caseDir, "versions", { create: true });
    const versions = await listVersionNumbers(versionsDir);
    const nextVersion = (versions[versions.length - 1] ?? 0) + 1;
    // Validate before writing so a typo never lands as a broken version.
    parseCaseDocument(bodyMarkdown, { version: nextVersion, createdAt: nowIso() });
    await writeTextFile(versionsDir, versionFile(nextVersion), bodyMarkdown);
    return readVersion(versionsDir, nextVersion);
  }

  async archiveTestCase(id: string, archived: boolean): Promise<void> {
    const caseDir = await getDir(await this.testCasesDir(true), id);
    await writeJson(caseDir, META_FILE, { archived } satisfies CaseBookkeeping);
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
  ): Promise<Run> {
    const caseDir = await getDir(await this.testCasesDir(true), testCaseId);
    const versionsDir = await getDir(caseDir, "versions");
    const { text: rawMarkdown } = await readTextFile(versionsDir, versionFile(version));
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
