/**
 * One `DataStore` over several storages.
 *
 * Screens ask `useReadyStore()` for a store and get this. They never learn
 * that more than one folder is connected: ids arrive already carrying the
 * storage they came from, and every call routes itself. That is the whole
 * design — the alternative, threading a storage id through every screen,
 * touches every file in the panel to say something none of them care about.
 *
 * Three method shapes:
 *
 * - **Fan-out** — the list methods. Ask every child, tag the results, merge,
 *   and *re-sort*, because each child only sorted its own rows.
 * - **Routed** — everything taking an id. Split it, find the child, hand it
 *   the local half, re-tag what comes back.
 * - **Targeted** — creation, which has no id to route on. The `…In` methods
 *   name the storage; the plain `DataStore` ones use the default.
 *
 * Namespacing lives in the `tag*` helpers below and nowhere else. That is
 * deliberate: a namespace applied ad hoc at call sites is how one gets
 * forgotten, and a forgotten one is invisible until somebody clicks the row.
 */

import {
  joinId,
  splitId,
  type AgentCommand,
  type AgentCommandSourceField,
  type AgentQuestion,
  type CapturedEntry,
  type CompatResult,
  type DataStore,
  type EnvironmentsFile,
  type FreeRun,
  type FreeRunFile,
  type Run,
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
import { NotFoundError } from "./fs-utils.js";

/** A storage that could not be read on the last fan-out. */
export interface DegradedStorage {
  storageId: string;
  message: string;
}

export class WorkspaceStore implements DataStore {
  constructor(
    private readonly children: Map<string, DataStore>,
    /** Called after every fan-out with the storages that failed it, so the
     * Library can raise a banner per broken folder. Called with `[]` when
     * everything answered, so a reconnect clears the banner without a
     * reload. */
    private readonly onDegraded: (degraded: DegradedStorage[]) => void = () => {},
    private defaultStorageId: string | null = null,
  ) {}

  // ---- routing ----

  private child(storageId: string): DataStore {
    const store = this.children.get(storageId);
    if (!store) {
      throw new NotFoundError(
        "That case is in a storage that is no longer connected. Open the Library to see what is.",
      );
    }
    return store;
  }

  /** Splits an id and hands back both the child and the local id. */
  private route(id: string): { store: DataStore; storageId: string; localId: string } {
    const { storageId, localId } = splitId(id);
    return { store: this.child(storageId), storageId, localId };
  }

  private target(storageId?: string): { store: DataStore; storageId: string } {
    const id = storageId ?? this.defaultStorageId ?? [...this.children.keys()][0];
    if (!id) throw new NotFoundError("No storage is connected.");
    return { store: this.child(id), storageId: id };
  }

  setDefaultStorageId(id: string | null): void {
    this.defaultStorageId = id;
  }

  get storageIds(): string[] {
    return [...this.children.keys()];
  }

  /**
   * Asks every child and keeps whatever answers.
   *
   * `allSettled`, never `all`: a folder whose permission lapsed, or that was
   * deleted or renamed on disk, must cost its own rows and nothing else. One
   * unreadable storage emptying the whole Library would make multi-storage
   * worse than the single folder it replaces.
   */
  private async fanOut<T>(call: (store: DataStore, storageId: string) => Promise<T[]>): Promise<T[]> {
    const ids = [...this.children.keys()];
    const settled = await Promise.allSettled(
      ids.map((id) => call(this.children.get(id)!, id)),
    );
    const degraded: DegradedStorage[] = [];
    const rows: T[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") rows.push(...result.value);
      else {
        degraded.push({
          storageId: ids[i],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    this.onDegraded(degraded);
    return rows;
  }

  // ---- namespacing (the only place it happens) ----

  private tagCase(storageId: string, c: TestCaseSummary): TestCaseSummary {
    return {
      ...c,
      id: joinId(storageId, c.id),
      suiteId: c.suiteId ? joinId(storageId, c.suiteId) : undefined,
    };
  }

  private tagMeta(storageId: string, m: TestCaseMeta): TestCaseMeta {
    return {
      ...m,
      id: joinId(storageId, m.id),
      suiteId: m.suiteId ? joinId(storageId, m.suiteId) : undefined,
    };
  }

  private tagSuite(storageId: string, s: SuiteSummary): SuiteSummary {
    return { ...s, id: joinId(storageId, s.id) };
  }

  private tagRunSummary(storageId: string, r: RunSummary): RunSummary {
    return { ...r, id: joinId(storageId, r.id), testCaseId: joinId(storageId, r.testCaseId) };
  }

  private tagRun(storageId: string, r: Run): Run {
    return { ...r, id: joinId(storageId, r.id), testCaseId: joinId(storageId, r.testCaseId) };
  }

  private tagFreeRunFile(storageId: string, f: FreeRunFile): FreeRunFile {
    return { ...f, id: joinId(storageId, f.id) };
  }

  /** Question/command ids themselves are never namespaced — every method
   * that takes one also takes the (namespaced) testCaseId that routes it. */
  private tagQuestion(storageId: string, q: AgentQuestion): AgentQuestion {
    return { ...q, testCaseId: joinId(storageId, q.testCaseId), runId: joinId(storageId, q.runId) };
  }

  private tagCommand(storageId: string, c: AgentCommand): AgentCommand {
    return { ...c, testCaseId: joinId(storageId, c.testCaseId), runId: joinId(storageId, c.runId) };
  }

  private tagFreeRun(storageId: string, f: FreeRun): FreeRun {
    return { ...f, id: joinId(storageId, f.id) };
  }

  // ---- TestCaseStore ----

  async listTestCases(): Promise<TestCaseSummary[]> {
    const rows = await this.fanOut(async (store, storageId) =>
      (await store.listTestCases()).map((c) => this.tagCase(storageId, c)),
    );
    // Each child sorted only its own rows; the merge has to sort again or the
    // Library reads as "grouped by storage" when it means "most recent first".
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  }

  async getTestCase(id: string): Promise<TestCaseMeta> {
    const { store, storageId, localId } = this.route(id);
    return this.tagMeta(storageId, await store.getTestCase(localId));
  }

  async listVersions(id: string): Promise<VersionSummary[]> {
    const { store, localId } = this.route(id);
    return store.listVersions(localId);
  }

  async getVersion(id: string, version: number): Promise<TestCaseVersion> {
    const { store, localId } = this.route(id);
    return store.getVersion(localId, version);
  }

  async getVersionSource(id: string, version: number): Promise<string> {
    const { store, localId } = this.route(id);
    return store.getVersionSource(localId, version);
  }

  /** Targets the default storage. Screens that let the user choose call
   * `createTestCaseIn` instead. */
  async createTestCase(bodyMarkdown: string, suiteId?: string): Promise<TestCaseMeta> {
    const storageId = suiteId ? splitId(suiteId).storageId : undefined;
    return this.createTestCaseIn(this.target(storageId).storageId, bodyMarkdown, suiteId);
  }

  async createTestCaseIn(
    storageId: string,
    bodyMarkdown: string,
    suiteId?: string,
  ): Promise<TestCaseMeta> {
    const store = this.child(storageId);
    let localSuiteId: string | undefined;
    if (suiteId) {
      const suite = splitId(suiteId);
      // A case cannot join a suite in another storage: the suite's prep steps
      // are merged from a file in *its* folder, which this case's folder has
      // no way to reach.
      if (suite.storageId !== storageId) {
        throw new NotFoundError("That suite is in a different storage.");
      }
      localSuiteId = suite.localId;
    }
    return this.tagMeta(storageId, await store.createTestCase(bodyMarkdown, localSuiteId));
  }

  async createVersion(id: string, bodyMarkdown: string): Promise<TestCaseVersion> {
    const { store, localId } = this.route(id);
    return store.createVersion(localId, bodyMarkdown);
  }

  async archiveTestCase(id: string, archived: boolean): Promise<void> {
    const { store, localId } = this.route(id);
    return store.archiveTestCase(localId, archived);
  }

  async listSuites(): Promise<SuiteSummary[]> {
    const rows = await this.fanOut(async (store, storageId) =>
      (await store.listSuites()).map((s) => this.tagSuite(storageId, s)),
    );
    return rows.sort((a, b) => a.title.localeCompare(b.title));
  }

  async getSuite(
    id: string,
  ): Promise<{ doc: TestCaseVersion; cases: TestCaseSummary[]; archived: boolean }> {
    const { store, storageId, localId } = this.route(id);
    const suite = await store.getSuite(localId);
    return { ...suite, cases: suite.cases.map((c) => this.tagCase(storageId, c)) };
  }

  async getSuiteSource(id: string): Promise<string> {
    const { store, localId } = this.route(id);
    return store.getSuiteSource(localId);
  }

  async createSuite(bodyMarkdown: string): Promise<SuiteSummary> {
    return this.createSuiteIn(this.target().storageId, bodyMarkdown);
  }

  async createSuiteIn(storageId: string, bodyMarkdown: string): Promise<SuiteSummary> {
    return this.tagSuite(storageId, await this.child(storageId).createSuite(bodyMarkdown));
  }

  async saveSuite(id: string, bodyMarkdown: string): Promise<void> {
    const { store, localId } = this.route(id);
    return store.saveSuite(localId, bodyMarkdown);
  }

  async archiveSuite(id: string, archived: boolean): Promise<void> {
    const { store, localId } = this.route(id);
    return store.archiveSuite(localId, archived);
  }

  async getRunSource(testCaseId: string, version: number, tier?: RunTier): Promise<string> {
    const { store, localId } = this.route(testCaseId);
    return store.getRunSource(localId, version, tier);
  }

  // ---- EnvironmentStore ----

  /** Targets the default storage; the run-setup screen uses
   * `getEnvironmentsForCase` instead, and Settings the `…In` variants. */
  async getEnvironments(): Promise<EnvironmentsFile> {
    return this.target().store.getEnvironments();
  }

  async saveEnvironments(file: EnvironmentsFile): Promise<void> {
    return this.target().store.saveEnvironments(file);
  }

  /** Environments live with the case's folder, which routing makes
   * automatic — a case is offered its own project's deployments, never a
   * sibling folder's. */
  async getEnvironmentsForCase(testCaseId: string): Promise<EnvironmentsFile> {
    const { store, localId } = this.route(testCaseId);
    return store.getEnvironmentsForCase(localId);
  }

  async getEnvironmentsIn(storageId: string): Promise<EnvironmentsFile> {
    return this.child(storageId).getEnvironments();
  }

  async saveEnvironmentsIn(storageId: string, file: EnvironmentsFile): Promise<void> {
    return this.child(storageId).saveEnvironments(file);
  }

  // ---- RunStore ----

  async listRuns(testCaseId?: string): Promise<RunSummary[]> {
    if (testCaseId) {
      const { store, storageId, localId } = this.route(testCaseId);
      return (await store.listRuns(localId)).map((r) => this.tagRunSummary(storageId, r));
    }
    const rows = await this.fanOut(async (store, storageId) =>
      (await store.listRuns()).map((r) => this.tagRunSummary(storageId, r)),
    );
    return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getRun(testCaseId: string, runId: string): Promise<Run> {
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagRun(storageId, await store.getRun(localId, splitId(runId).localId));
  }

  /** A run is written to the storage its case came from, which routing makes
   * automatic — a case and its history stay together, including inside a repo
   * where `runs/` is gitignored. */
  async createRun(
    testCaseId: string,
    version: number,
    variableValues?: Record<string, string>,
    tier?: RunTier,
    environment?: string,
  ): Promise<Run> {
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagRun(
      storageId,
      await store.createRun(localId, version, variableValues, tier, environment),
    );
  }

  async updateStep(
    testCaseId: string,
    runId: string,
    stepId: string,
    patch: StepPatch,
  ): Promise<Run> {
    const { store, storageId, localId } = this.route(testCaseId);
    // `stepId` is `step-3`, scoped to its own case — never namespaced.
    return this.tagRun(
      storageId,
      await store.updateStep(localId, splitId(runId).localId, stepId, patch),
    );
  }

  async updateRun(
    testCaseId: string,
    runId: string,
    patch: { comment?: string; consoleInReport?: boolean },
  ): Promise<Run> {
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagRun(storageId, await store.updateRun(localId, splitId(runId).localId, patch));
  }

  /** Captured output follows its run, which routing makes automatic — a run's
   * console log cannot end up in a different folder from the run. */
  async appendConsole(
    testCaseId: string,
    runId: string,
    entries: CapturedEntry[],
  ): Promise<void> {
    const { store, localId } = this.route(testCaseId);
    return store.appendConsole(localId, splitId(runId).localId, entries);
  }

  async finishRun(testCaseId: string, runId: string, status: RunStatus): Promise<Run> {
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagRun(storageId, await store.finishRun(localId, splitId(runId).localId, status));
  }

  // ---- AgentChannelStore ----

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
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagQuestion(
      storageId,
      await store.askQuestion(localId, splitId(runId).localId, draft),
    );
  }

  async listQuestions(testCaseId: string, runId: string): Promise<AgentQuestion[]> {
    const { store, storageId, localId } = this.route(testCaseId);
    const rows = await store.listQuestions(localId, splitId(runId).localId);
    return rows.map((q) => this.tagQuestion(storageId, q));
  }

  async requestCommand(
    testCaseId: string,
    runId: string,
    draft: { command: string; stepId: string | null; sourceField: AgentCommandSourceField },
  ): Promise<AgentCommand> {
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagCommand(
      storageId,
      await store.requestCommand(localId, splitId(runId).localId, draft),
    );
  }

  async listCommands(testCaseId: string, runId: string): Promise<AgentCommand[]> {
    const { store, storageId, localId } = this.route(testCaseId);
    const rows = await store.listCommands(localId, splitId(runId).localId);
    return rows.map((c) => this.tagCommand(storageId, c));
  }

  async killCommand(testCaseId: string, commandId: string): Promise<void> {
    const { store, localId } = this.route(testCaseId);
    return store.killCommand(localId, commandId);
  }

  async previewSwap(testCaseId: string, runId: string, toVersion: number): Promise<CompatResult> {
    const { store, localId } = this.route(testCaseId);
    return store.previewSwap(localId, splitId(runId).localId, toVersion);
  }

  async swapRunVersion(
    testCaseId: string,
    runId: string,
    toVersion: number,
    questionId: string | null,
  ): Promise<Run> {
    const { store, storageId, localId } = this.route(testCaseId);
    return this.tagRun(
      storageId,
      await store.swapRunVersion(localId, splitId(runId).localId, toVersion, questionId),
    );
  }

  async touchHeartbeat(): Promise<void> {
    // Deliberately not `fanOut`: a lapsed folder failing a background
    // heartbeat must not raise and clear the Library's degraded banners on
    // a 20-second cadence. The next user-initiated fan-out reports it.
    await Promise.allSettled([...this.children.values()].map((store) => store.touchHeartbeat()));
  }

  // ---- FreeRunStore ----

  async listFreeRuns(): Promise<FreeRunFile[]> {
    const rows = await this.fanOut(async (store, storageId) =>
      (await store.listFreeRuns()).map((f) => this.tagFreeRunFile(storageId, f)),
    );
    return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getFreeRun(id: string): Promise<FreeRun> {
    const { store, storageId, localId } = this.route(id);
    return this.tagFreeRun(storageId, await store.getFreeRun(localId));
  }

  async createFreeRun(title: string): Promise<FreeRun> {
    return this.createFreeRunIn(this.target().storageId, title);
  }

  async createFreeRunIn(storageId: string, title: string): Promise<FreeRun> {
    return this.tagFreeRun(storageId, await this.child(storageId).createFreeRun(title));
  }

  async updateFreeRun(id: string, patch: { title?: string; notes?: string }): Promise<FreeRun> {
    const { store, storageId, localId } = this.route(id);
    return this.tagFreeRun(storageId, await store.updateFreeRun(localId, patch));
  }

  async appendFreeRunConsole(id: string, entries: CapturedEntry[]): Promise<void> {
    const { store, localId } = this.route(id);
    return store.appendFreeRunConsole(localId, entries);
  }

  async finishFreeRun(id: string): Promise<FreeRun> {
    const { store, storageId, localId } = this.route(id);
    return this.tagFreeRun(storageId, await store.finishFreeRun(localId));
  }
}
