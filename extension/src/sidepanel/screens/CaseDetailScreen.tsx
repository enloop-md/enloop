import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultEnvironment,
  emptyEnvironments,
  environmentsForProject,
  environmentValues,
  generateVariableValue,
  mainDomainName,
  matchesLocations,
  matchesPagePattern,
  missingEnvironmentValues,
  resolveRunValues,
  parseCaseDocument,
  renderBulletList,
  renderCasePage,
  renderReadableCase,
  splitId,
  VARIABLE_GENERATOR_LABELS,
  viewerLink,
  withViewerComment,
  type Environment,
  type EnvironmentsFile,
  type RunTier,
  type TestCaseDomain,
  type TestCaseMeta,
  type TestCaseVariable,
  type TestCaseVersion,
  type VersionSummary,
} from "@tcm/shared";
import { CaptureToggles } from "../../components/CaptureToggles.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { useCaptureSettings } from "../useCapture.js";
import { getActivePageUrl } from "../../lib/automation.js";
import { useActivePageUrl } from "../../lib/use-active-page.js";
import { readTypedValues, writeTypedValues } from "../../lib/value-memory.js";
import { downloadTextFile, fileSlug } from "../../lib/download.js";

export function CaseDetailScreen({
  testCaseId,
  onBack,
  onEdit,
  onRunStarted,
  onHistory,
  onSettings,
}: {
  testCaseId: string;
  onBack: () => void;
  onEdit: () => void;
  onRunStarted: (runId: string) => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [meta, setMeta] = useState<TestCaseMeta | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [version, setVersion] = useState<TestCaseVersion | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // What a run of the current version would actually execute: the case
  // merged with its suite. Loaded here so starting a run never has to stop
  // and ask — the values are already resolved and on screen.
  const [domains, setDomains] = useState<TestCaseDomain[]>([]);
  const [variables, setVariables] = useState<TestCaseVariable[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  /** True once the run source has been parsed — distinguishes "no variables
   * declared" from "not looked yet", which the environment restore needs. */
  const [variablesLoaded, setVariablesLoaded] = useState(false);
  const [runStepCounts, setRunStepCounts] = useState({ total: 0, quick: 0 });
  // Previews only. Nothing here is passed to `createRun` unless the tester
  // typed it: a generated value regenerates at start, so a %TIMESTAMP% is
  // the moment the run began rather than the moment this screen opened.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  /** Names filled from the last run rather than typed just now. They are
   * "soft": shown as such, and given up to an environment that has its own
   * answer — see `applyEnvironment`. A value typed in this session is the
   * tester's decision about *this* run and outranks everything. */
  const [remembered, setRemembered] = useState<string[]>([]);
  /** Page values a domain's or a page variable's `Match:` refused, by name
   * — shown so the tester knows why a field is not following the open tab. */
  const [pageRefused, setPageRefused] = useState<Record<string, string>>({});
  const pageUrl = useActivePageUrl();
  const [valuesOpen, setValuesOpen] = useState(false);
  // This folder's named deployments — the addresses of every domain the
  // case declares, and the values that differ per deployment. A run picks
  // one, or goes without and lets the main domain follow the open tab —
  // which is also the whole answer for per-PR domains a service generates
  // (decided 2026-08-16).
  const [envFile, setEnvFile] = useState<EnvironmentsFile | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const envRestored = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Asked here rather than left in Settings: whether this run's console is
  // worth keeping is a thought people have on the way into a run, and capture
  // only starts from the page's next load — so it has to be decided before the
  // run, not once something interesting has already scrolled past.
  const capture = useCaptureSettings();

  useEffect(() => {
    let cancelled = false;
    // Environment trouble must never block a run — a broken
    // environments.json degrades to "no environments defined".
    store
      .getEnvironmentsForCase(testCaseId)
      .then((f) => !cancelled && setEnvFile(f))
      .catch(() => !cancelled && setEnvFile(emptyEnvironments()));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([store.getTestCase(testCaseId), store.listVersions(testCaseId)])
      .then(([m, v]) => {
        if (cancelled) return;
        setMeta(m);
        setVersions(v);
        setSelectedVersion(m.currentVersion);
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId]);

  useEffect(() => {
    if (selectedVersion == null) return;
    let cancelled = false;
    store
      .getVersion(testCaseId, selectedVersion)
      .then((v) => !cancelled && setVersion(v))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, selectedVersion]);

  // Parse what the run would execute. A separate effect from the metadata
  // load because it depends on the current version being known.
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    (async () => {
      const runSource = await store.getRunSource(testCaseId, meta.currentVersion);
      if (cancelled) return;
      const doc = parseCaseDocument(runSource, {
        version: meta.currentVersion,
        createdAt: new Date().toISOString(),
      });
      setDomains(doc.domains);
      setVariables(doc.variables);
      setLocations(doc.locations);
      setVariablesLoaded(true);
      setRunStepCounts({ total: doc.steps.length, quick: doc.steps.filter((s) => s.quick).length });
    })().catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, meta?.currentVersion]);

  /** The environments this case may pick from: its project's, plus any
   * unscoped ones. A folder holds several projects' cases, and staging of
   * one is not staging of another. */
  const project = meta?.project ?? "";
  const offered = useMemo(
    () => (envFile ? environmentsForProject(envFile, project) : []),
    [envFile, project],
  );
  const selectedEnv: Environment | undefined = selectedEnvId
    ? offered.find((e) => e.id === selectedEnvId)
    : undefined;
  /** What the resolver sees of the picked environment — nothing when none
   * is picked, which is what lets the main domain follow the open tab. */
  const envContext = useMemo(
    () => (selectedEnv ? environmentValues(selectedEnv) : undefined),
    [selectedEnv],
  );

  // What the run would use, for display — recomputed every time the active
  // tab or the picked environment changes, because a page value snapshotted
  // when this screen opened describes a tab the tester may have long since
  // left. The run itself re-reads the tab at the moment Start is pressed;
  // this keeps what they are looking at equal to what that read will find.
  // Through the shared resolver, so a domain or page variable whose
  // `Match:` refuses the tab — or no page at all — falls through to the
  // environment and the declared default exactly as it does everywhere
  // else. Page-derived entries follow the tab; other generators keep their
  // first preview rather than rerolling on every tab switch.
  useEffect(() => {
    setPreviews((prev) => {
      const next = resolveRunValues(
        { domains, variables, locations },
        {},
        { pageUrl, environment: envContext },
      );
      for (const v of variables) {
        if (
          !v.generator?.startsWith("page-") &&
          v.generator &&
          !envContext?.values[v.name] &&
          prev[v.name] !== undefined
        ) {
          next[v.name] = prev[v.name];
        }
      }
      return next;
    });
    // What the page *would* have yielded where `Match:` refused it, so the
    // values form can say why a field is not following the open tab and
    // offer the refusal as an explicit override. Only meaningful with no
    // environment picked — with one, the tab is not consulted at all.
    const refused: Record<string, string> = {};
    if (!envContext && pageUrl) {
      let origin = "";
      try {
        origin = new URL(pageUrl).origin;
      } catch {
        origin = "";
      }
      for (const d of domains) {
        if (d.match && origin && !matchesPagePattern(d.match, origin))
          refused[d.name] = origin;
      }
    }
    for (const v of variables) {
      if (!v.match || !v.generator?.startsWith("page-")) continue;
      const raw = generateVariableValue({ ...v, match: undefined }, { pageUrl });
      if (raw && !matchesPagePattern(v.match, raw)) refused[v.name] = raw;
    }
    setPageRefused(refused);
  }, [domains, variables, locations, pageUrl, envContext]);

  /** The last choice is remembered per folder — "which deployment am I
   * testing" rarely changes between runs of cases from the same repo. */
  const envMemoryKey = `enloop:environment:${splitId(testCaseId).storageId}`;

  function applyEnvironment(envId: string | null) {
    setSelectedEnvId(envId);
    if (envId) localStorage.setItem(envMemoryKey, envId);
    else localStorage.removeItem(envMemoryKey);

    // Picking a deployment must not run against the address remembered from
    // the last one. Only remembered values give way; one typed in this
    // session stays, because the tester typed it knowing what they picked.
    const picked = envId ? offered.find((e) => e.id === envId) : undefined;
    const provided = picked ? environmentValues(picked) : undefined;
    if (!provided || remembered.length === 0) return;
    const given = remembered.filter((name) =>
      (provided.domains[name] ?? provided.values[name] ?? "").trim(),
    );
    if (given.length === 0) return;
    setEdited((prev) => {
      const next = { ...prev };
      for (const name of given) delete next[name];
      return next;
    });
    setRemembered((prev) => prev.filter((name) => !given.includes(name)));
  }

  /**
   * A value the tester typed: kept for the next run of this case, and no
   * longer "remembered" — they have just made it their own.
   *
   * Written here rather than from an effect on `edited`, because not every
   * change to that map is a decision worth keeping: the restore filters
   * itself, and switching environment drops values that must still be there
   * when the tester switches back.
   */
  function editValue(name: string, value: string) {
    const next = { ...edited, [name]: value };
    setEdited(next);
    writeTypedValues(testCaseId, next);
    setRemembered((prev) => prev.filter((n) => n !== name));
  }

  /** Back to auto: the case decides this value again, here and on the next
   * run — forgetting is how a remembered value is got rid of. */
  function resetValue(name: string) {
    const next = { ...edited };
    delete next[name];
    setEdited(next);
    writeTypedValues(testCaseId, next);
    setRemembered((prev) => prev.filter((n) => n !== name));
  }

  // Pick the starting environment once both the environment list and the
  // case's project are known: the remembered one when it still applies to
  // this project, else the project's default, else none.
  useEffect(() => {
    if (envRestored.current || !envFile || !variablesLoaded || !meta) return;
    envRestored.current = true;
    const saved = localStorage.getItem(envMemoryKey);
    const rememberedEnv = saved ? offered.find((e) => e.id === saved) : undefined;
    const initial = rememberedEnv ?? defaultEnvironment(envFile, project);
    if (initial) setSelectedEnvId(initial.id);

    // The values this tester typed the last time they ran this case. Held
    // back where the starting environment answers for the same name: a
    // remembered address is a note about the deployment you were on, and
    // "Staging" is the deployment you are on now.
    const provided = initial ? environmentValues(initial) : undefined;
    const restored = Object.fromEntries(
      Object.entries(
        readTypedValues(testCaseId, [...domains, ...variables].map((e) => e.name)),
      ).filter(
        ([name]) => !(provided?.domains[name] ?? provided?.values[name] ?? "").trim(),
      ),
    );
    if (Object.keys(restored).length > 0) {
      setEdited(restored);
      setRemembered(Object.keys(restored));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot restore
  }, [envFile, variablesLoaded, meta]);

  /** Where each value on the form comes from, so the tester can read "this
   * address is staging's" or "this follows the open tab" instead of
   * inferring it. */
  function sourceOf(name: string, kind: "domain" | "variable"): string {
    if (name in edited) return "typed";
    if (
      envContext &&
      (envContext.domains[name] ?? envContext.values[name] ?? "").trim()
    ) {
      return selectedEnv?.name ?? "environment";
    }
    if (kind === "domain") {
      const d = domains.find((x) => x.name === name);
      const isMain = domains[0]?.name === name;
      const preview = previews[name] ?? "";
      if (!envContext && preview && preview !== d?.defaultValue?.trim())
        return "open tab";
      if (!envContext && preview && isMain && pageUrl) {
        try {
          if (new URL(pageUrl).origin === preview) return "open tab";
        } catch {
          // not a URL — the default it is
        }
      }
      return preview ? "default" : "no value";
    }
    const v = variables.find((x) => x.name === name);
    if (v?.generator && (previews[name] ?? "").trim()) {
      return `${VARIABLE_GENERATOR_LABELS[v.generator]} · fresh at start`;
    }
    return (previews[name] ?? "").trim() ? "default" : "no value";
  }

  /** Names that would reach the run empty: the case is refused rather than
   * run with literal placeholders, per MANIFESTO.md — a run never asks. */
  const unresolvedNames = useMemo(
    () =>
      [...domains, ...variables]
        .map((entry) => entry.name)
        .filter((name) => !(edited[name] ?? previews[name] ?? "").trim()),
    [domains, variables, edited, previews],
  );

  async function startRun(tier: RunTier) {
    if (!meta) return;
    if (unresolvedNames.length > 0) {
      setValuesOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Generators run now, not when the screen opened, and page-* ones read
      // the tab as it is at this moment — the store resolves variables
      // without any page context, so everything needing it is resolved here,
      // through the shared resolver so a refused or absent page still falls
      // through to the default. A value the tester typed wins outright,
      // which is also how a `Match:` refusal is overridden.
      const pageUrl = await getActivePageUrl().catch(() => undefined);
      const values = resolveRunValues({ domains, variables, locations }, edited, {
        pageUrl,
        environment: envContext,
      });
      const environmentName = selectedEnv?.name ?? "";
      const run = await store.createRun(
        testCaseId,
        meta.currentVersion,
        values,
        tier,
        environmentName,
      );
      onRunStarted(run.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Four exports along two axes, because "send someone this case" turns out
   * to be two questions, not one.
   *
   * **Markdown or HTML** is who the recipient is. Markdown is the file — for
   * a repo, a PR, another Enloop folder, or Claude Code. HTML is a page: one
   * self-contained file with the steps tickable, the values copyable and the
   * variables fillable, which opens in any browser by double-clicking it and
   * needs neither this extension nor a network.
   *
   * **Full or simplified** is how much of the machinery the recipient should
   * see. Full is the case as authored, selectors and scripts included.
   * Simplified is it rewritten for someone carrying it out by hand: no
   * selectors, no scripts, defaults filled in, automated steps listed at the
   * end rather than standing in the sequence as things to do.
   *
   * Everything except the raw Markdown is built from the *run* source, so a
   * case inside a suite carries the suite's prep steps with it — a reader
   * handed the case alone would otherwise be missing the setup it assumes.
   * The raw Markdown is the exception on purpose: it is the file, and a file
   * that quietly gained its suite's steps would no longer round-trip.
   */
  async function download(kind: "source" | "readable" | "html-full" | "html-simple") {
    if (!meta || selectedVersion == null) return;
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    try {
      const slug = fileSlug(meta.title);
      const exportedAt = new Date().toISOString();

      if (kind === "source") {
        const source = await store.getVersionSource(testCaseId, selectedVersion);
        downloadTextFile(`${slug}-v${selectedVersion}.md`, await withViewerComment(source));
        return;
      }

      const runSource = await store.getRunSource(testCaseId, selectedVersion);
      const merged = parseCaseDocument(runSource, { version: selectedVersion, createdAt: exportedAt });

      if (kind === "readable") {
        const readable = renderReadableCase(merged, { exportedAt });
        downloadTextFile(
          `${slug}-v${selectedVersion}-simplified.md`,
          await withViewerComment(readable),
        );
        return;
      }

      const simplified = kind === "html-simple";
      downloadTextFile(
        `${slug}-v${selectedVersion}${simplified ? "-simplified" : ""}.html`,
        renderCasePage(merged, { simplified, exportedAt, viewerUrl: await viewerLink(runSource) }),
        "text/html",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** The same page the HTML download produces, as a link instead of a file —
   * the case travels inside it, so there is nothing to host and nothing to
   * upload. */
  async function copyViewerLink(simplified = false) {
    if (selectedVersion == null) return;
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    try {
      const runSource = await store.getRunSource(testCaseId, selectedVersion);
      await navigator.clipboard.writeText(await viewerLink(runSource, { simplified }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!meta) return;
    setBusy(true);
    try {
      await store.archiveTestCase(testCaseId, !meta.archived);
      setMeta({ ...meta, archived: !meta.archived });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!meta) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Test case" onBack={onBack} onSettings={onSettings} />
        {error == null ? (
          <p className="p-3 text-sm text-slate-400">Loading…</p>
        ) : (
          <ErrorNotice error={error} className="p-3" />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={meta.title} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto p-3">
        <ErrorNotice error={error} className="mb-2" />
        {(version?.project || meta.project || version?.kind === "guide") && (
          <div className="mb-2 flex items-baseline gap-1.5 text-xs">
            {(version?.project || meta.project) && (
              <>
                <span className="font-medium text-slate-500">Project:</span>
                <span className="text-slate-600">{version?.project || meta.project}</span>
              </>
            )}
            {/* Same badge as an automated step: a fact about how the case
                is written, not a status. A guide runs like any case; the
                verdicts read Done / Could not, and a finished run exports. */}
            {version?.kind === "guide" && (
              <span
                className="ml-auto rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700"
                title="A user guide: written for an end user, run like a case, exported with its screenshots"
              >
                guide
              </span>
            )}
          </div>
        )}
        {(version?.author || version?.formatVersion) && (
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 text-[11px] text-slate-400">
            {version.author && <span>by {version.author}</span>}
            {version.formatVersion && <span>grammar {version.formatVersion}</span>}
          </div>
        )}
        {/* Goal, then the shape of the work, then what must be in hand —
            the four lines a tester reads before Start, per MANIFESTO.md.
            Above the description, which is background. */}
        {version?.goal.trim() && (
          <p className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm font-medium text-emerald-900">
            {version.goal}
          </p>
        )}
        {version?.youWill.trim() && (
          <p className="mb-2 text-sm text-slate-600">
            <span className="font-medium text-slate-700">You will: </span>
            {version.youWill}
          </p>
        )}
        {version && version.youWillNeed.length > 0 && (
          <div className="mb-3">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-500">You will need</h2>
            <Markdown text={renderBulletList(version.youWillNeed)} className="text-sm text-slate-600" />
          </div>
        )}
        {version && version.groups.length > 0 && (
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-600">
            {version.groups.map((g) => (
              <li key={g.title}>{g.title}</li>
            ))}
          </ul>
        )}
        {meta.description && (
          <Markdown text={meta.description} className="mb-3 text-sm text-slate-600" />
        )}
        {meta.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {meta.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mb-3 flex items-center gap-2 text-sm">
          <label className="text-slate-500">Version</label>
          <select
            value={selectedVersion ?? meta.currentVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {versions?.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.version === meta.currentVersion ? " (current)" : ""} — {v.changeNote}
              </option>
            ))}
          </select>
        </div>

        {version && version.dependencies.length > 0 && (
          <div className="mb-3">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">Dependencies</h2>
            <Markdown text={renderBulletList(version.dependencies)} className="text-sm text-slate-600" />
          </div>
        )}

        {version && version.prerequisites.length > 0 && (
          <div className="mb-3">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">Prerequisites</h2>
            <Markdown text={renderBulletList(version.prerequisites)} className="text-sm text-slate-600" />
          </div>
        )}

        {version && version.steps.length > 0 && (
          <h2 className="mb-1 flex items-baseline gap-2 text-xs font-semibold uppercase text-slate-400">
            <span>Steps</span>
            <span className="font-normal normal-case text-slate-400">
              {version.steps.length} total
              {version.steps.some((s) => s.quick) &&
                ` · ${version.steps.filter((s) => s.quick).length} quick`}
            </span>
          </h2>
        )}

        <ol className="space-y-2">
          {version?.steps.map((s, i) => (
            <li key={s.id}>
              {s.group && version.steps[i - 1]?.group !== s.group && (
                <div className="mb-1 mt-3 border-l-2 border-amber-400 pl-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {s.group}
                  </div>
                  {version.groups
                    .find((g) => g.title === s.group)
                    ?.goal.trim() && (
                    <Markdown
                      text={
                        version.groups.find((g) => g.title === s.group)!.goal
                      }
                      className="text-xs text-slate-500"
                    />
                  )}
                </div>
              )}
              <div className="rounded border border-slate-200 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">#{i + 1}</span>
                  <span className="flex-1 font-medium text-slate-800">
                    {s.title}
                  </span>
                  {s.quick && (
                    <span
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                      title="Runs in a quick run as well as a full one"
                    >
                      quick
                    </span>
                  )}
                  {s.type === "automated" && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
                      automated
                    </span>
                  )}
                </div>
                {s.selectors.map((sel, si) => (
                  <code
                    key={`${si}-${sel}`}
                    className={`mt-1 block text-[10px] ${
                      si === 0 ? "text-amber-600" : "text-amber-600/60"
                    }`}
                  >
                    {s.selectors.length > 1 ? `${si + 1}. ${sel}` : sel}
                  </code>
                ))}
                {s.instructions && (
                  <Markdown
                    text={s.instructions}
                    className="mt-1 text-xs text-slate-500"
                  />
                )}
                {s.type === "automated" && s.script && (
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                    {s.script}
                  </pre>
                )}
                {s.expected && (
                  <div className="mt-1 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">
                      Expected:
                    </span>
                    <Markdown
                      text={s.expected}
                      className="text-xs text-slate-500"
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="border-t border-slate-200">
        {envFile && offered.length > 0 && (
          <EnvironmentPicker
            file={envFile}
            offered={offered}
            selectedId={selectedEnvId}
            declared={[
              ...domains.map((d) => d.name),
              ...variables.map((v) => v.name),
            ]}
            onSelect={applyEnvironment}
          />
        )}
        {(domains.length > 0 || variables.length > 0) && (
          <RunValues
            domains={domains}
            variables={variables}
            locations={locations}
            previews={previews}
            edited={edited}
            refused={pageRefused}
            sourceOf={sourceOf}
            open={valuesOpen}
            onToggle={() => setValuesOpen((o) => !o)}
            remembered={remembered}
            onChange={editValue}
            onReset={resetValue}
          />
        )}
        <CaptureToggles
          settings={capture.settings}
          wrapper={capture.wrapper}
          onChange={capture.set}
          compact
          className="border-b border-slate-100 bg-slate-50 px-3 py-2"
        />
        <div className="space-y-2 p-3">
          {unresolvedNames.length > 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              This run cannot start: {unresolvedNames.map((n) => `%${n}%`).join(", ")}{" "}
              {unresolvedNames.length === 1 ? "has" : "have"} no value. See the values above —
              each says where its value comes from.
            </p>
          )}
          {/* One primary Start. When the case marks a quick path, that is the
              run — the version a tester takes by default — and the full run is
              a secondary control; with no quick steps, or with every step
              quick, the two tiers are the same run and only one button shows.
              A tester is never asked to choose a tier. */}
          {(() => {
            const hasQuick = runStepCounts.quick > 0 && runStepCounts.quick < runStepCounts.total;
            const blocked = busy || meta.archived || unresolvedNames.length > 0;
            return (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => startRun(hasQuick ? "quick" : "full")}
                  disabled={blocked}
                  title={
                    hasQuick
                      ? `Runs the ${runStepCounts.quick} steps marked Kind: quick — the core path.`
                      : undefined
                  }
                  className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Start run{hasQuick ? ` (${runStepCounts.quick} steps)` : ""}
                </button>
                {hasQuick && (
                  <button
                    onClick={() => startRun("full")}
                    disabled={blocked}
                    title={`Every step — all ${runStepCounts.total}. A quick pass is not a full pass.`}
                    className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    Full ({runStepCounts.total})
                  </button>
                )}
              </div>
            );
          })()}
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              onClick={onHistory}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Runs
            </button>
            <button
              onClick={toggleArchive}
              disabled={busy}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {meta.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
          <ShareMenu
            version={selectedVersion}
            busy={busy}
            copied={copied}
            open={menuOpen}
            onToggle={() => setMenuOpen((o) => !o)}
            onClose={() => setMenuOpen(false)}
            onDownload={(kind) => void download(kind)}
            onCopyLink={(simplified) => void copyViewerLink(simplified)}
          />
        </div>
      </div>
    </div>
  );
}

type DownloadKind = "source" | "readable" | "html-full" | "html-simple";

const DOWNLOADS: Array<{ kind: DownloadKind; label: string; hint: string }> = [
  {
    kind: "html-full",
    label: "HTML page — full",
    hint: "One self-contained file: tick off steps, copy values, no extension needed",
  },
  {
    kind: "html-simple",
    label: "HTML page — simplified",
    hint: "The same page for a manual tester: no selectors or scripts",
  },
  {
    kind: "source",
    label: "Markdown — as authored",
    hint: "The case file itself, for a repo, a PR, or another Enloop folder",
  },
  {
    kind: "readable",
    label: "Markdown — simplified",
    hint: "For a person to read: defaults filled in, suite prep steps included",
  },
];

/**
 * Handing this case to someone who is not sitting in front of this panel.
 *
 * Four downloads and a link is too many controls to lay out flat in a
 * 400px-wide panel, and they are all the same decision anyway — so they
 * collapse into one button. It opens upward because it lives at the bottom
 * of the screen.
 */
function ShareMenu({
  version,
  busy,
  copied,
  open,
  onToggle,
  onClose,
  onDownload,
  onCopyLink,
}: {
  version: string | null;
  busy: boolean;
  copied: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDownload: (kind: DownloadKind) => void;
  /** `simplified` opens the link the way a consumer reads it — no
   * selectors, no scripts. The plain link is for another tester. */
  onCopyLink: (simplified: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div ref={container} className="relative flex items-center gap-2">
      <span className="text-xs text-slate-400">Share v{version}</span>
      <button
        onClick={onToggle}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        ⤓ Download <span className="text-[9px] text-slate-400">▾</span>
      </button>
      <button
        onClick={() => onCopyLink(false)}
        disabled={busy}
        title="A link to the online viewer with this case inside it — nothing is uploaded"
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        {copied ? "✓ Copied" : "🔗 Copy link"}
      </button>
      <button
        onClick={() => onCopyLink(true)}
        disabled={busy}
        title="The same link, opening the simplified view: no selectors, no scripts — for someone who will follow the case by hand"
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        🔗 Simple
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded border border-slate-200 bg-white shadow-lg"
        >
          {DOWNLOADS.map((item) => (
            <button
              key={item.kind}
              role="menuitem"
              onClick={() => onDownload(item.kind)}
              className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
            >
              <span className="block text-xs font-medium text-slate-700">{item.label}</span>
              <span className="block text-[10px] leading-snug text-slate-400">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Which deployment this run is against. Selecting one decides every
 * declared domain's address and any variable the environment carries; it
 * locks nothing — every value stays editable, and "No environment" is
 * always on the list, because some deployments (a per-PR preview whose
 * domain a service just generated) exist only as the tab someone has open.
 */
function EnvironmentPicker({
  file,
  offered,
  selectedId,
  declared,
  onSelect,
}: {
  file: EnvironmentsFile;
  offered: Environment[];
  selectedId: string | null;
  /** Names the case declares — what "N filled" counts against. */
  declared: string[];
  onSelect: (envId: string | null) => void;
}) {
  const selected = selectedId
    ? offered.find((e) => e.id === selectedId)
    : undefined;
  const values = selected ? environmentValues(selected) : null;
  const filled = values
    ? declared.filter((name) => name in values.domains || name in values.values)
        .length
    : 0;
  const missing = selected
    ? missingEnvironmentValues(file, selected).filter((name) =>
        declared.includes(name),
      )
    : [];

  return (
    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
      <label className="shrink-0 text-[11px] text-slate-500">Environment</label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700"
      >
        <option value="">No environment — follow the open tab</option>
        {offered.map((env) => (
          <option key={env.id} value={env.id}>
            {env.name}
            {env.default ? " (default)" : ""}
            {missingEnvironmentValues(file, env).length > 0
              ? ` (${missingEnvironmentValues(file, env).length} empty)`
              : ""}
          </option>
        ))}
      </select>
      {selected && (
        <span
          className="shrink-0 text-[10px] text-slate-400"
          title={
            missing.length > 0
              ? `No value for ${missing.join(", ")} in this environment — those fall back to the case's own defaults.`
              : undefined
          }
        >
          {filled} filled
          {missing.length > 0 ? ` · ${missing.length} empty` : ""}
        </span>
      )}
    </div>
  );
}

/** A domain field's border by where its address stands against `@locations`. */
const INPUT_TONE = {
  unchecked: "border-slate-300",
  match: "border-emerald-400",
  mismatch: "border-red-400",
} as const;

/**
 * The values a run will substitute for `%NAME%`, folded into the screen you
 * start the run from. This used to be a screen of its own between "Start
 * run" and step 1, which made every variable a gate: a form to read and
 * agree to before the run could begin, on cases where the pre-filled values
 * were right every time. Here it is collapsed by default and the run starts
 * without it — the values are still editable, they just no longer stand in
 * the way of the thing the tester came to do.
 *
 * Domains come first: they decide which deployment every address in the
 * run points at, and the main one is what a bare route resolves against.
 */
function RunValues({
  domains,
  variables,
  locations,
  previews,
  edited,
  remembered,
  refused,
  sourceOf,
  open,
  onToggle,
  onChange,
  onReset,
}: {
  domains: TestCaseDomain[];
  variables: TestCaseVariable[];
  /** The case's `@locations` globs — each domain's address is judged
   * against them below its field, before the run starts. */
  locations: string[];
  previews: Record<string, string>;
  edited: Record<string, string>;
  /** Of the edited names, the ones carried over from the last run rather
   * than typed just now — labelled, so a value that appears in a field
   * nobody touched today says where it came from. */
  remembered: string[];
  refused: Record<string, string>;
  sourceOf: (name: string, kind: "domain" | "variable") => string;
  open: boolean;
  onToggle: () => void;
  onChange: (name: string, value: string) => void;
  onReset: (name: string) => void;
}) {
  const rows: Array<{
    name: string;
    description: string;
    kind: "domain" | "variable";
    match?: string;
  }> = [
    ...domains.map((d) => ({
      name: d.name,
      description: d.description,
      kind: "domain" as const,
      match: d.match,
    })),
    ...variables.map((v) => ({
      name: v.name,
      description: v.description,
      kind: "variable" as const,
      match: v.match,
    })),
  ];
  const missing = rows.filter(
    (r) => !(edited[r.name] ?? previews[r.name] ?? "").trim(),
  );
  const mainName = mainDomainName({ domains }) ?? undefined;

  const renderRow = (row: (typeof rows)[number]) => {
    const isEdited = row.name in edited;
    const value = edited[row.name] ?? previews[row.name] ?? "";
    const source = sourceOf(row.name, row.kind);
    const location = row.kind === "domain" ? matchesLocations(locations, value) : "unchecked";
    return (
      <div key={row.name} className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-slate-600">
            %{row.name}%
            {row.kind === "domain" && (
              <span className="ml-1 rounded bg-slate-200 px-1 py-px text-[9px] font-normal text-slate-600">
                {row.name === mainName ? "main domain" : "domain"}
              </span>
            )}
          </label>
          {isEdited ? (
            <span className="flex shrink-0 items-center gap-1.5">
              {remembered.includes(row.name) && (
                <span className="text-[10px] text-slate-400">from your last run</span>
              )}
              <button
                onClick={() => onReset(row.name)}
                className="text-[10px] text-sky-600 hover:underline"
              >
                ↺ back to auto
              </button>
            </span>
          ) : (
            source !== "no value" && (
              <span className="shrink-0 text-[10px] text-slate-400">
                {source}
              </span>
            )
          )}
        </div>
        {row.description && (
          <p className="text-[11px] text-slate-400">{row.description}</p>
        )}
        <input
          value={value}
          onChange={(e) => onChange(row.name, e.target.value)}
          placeholder={row.kind === "domain" ? "https://…" : undefined}
          className={`w-full rounded border bg-white px-2 py-1 text-sm ${INPUT_TONE[location]}`}
        />
        {location === "mismatch" && (
          <p className="text-[10px] text-red-600">
            Not one of this case's locations ({locations.join(", ")}). The run will
            still use it — check the tab you started from.
          </p>
        )}
        {location === "match" && (
          <p className="text-[10px] text-emerald-700">Matches this case's locations.</p>
        )}
        {refused[row.name] && !isEdited && (
          <p className="text-[10px] text-amber-600">
            The open page (<code>{refused[row.name]}</code>) doesn't match{" "}
            <code>{row.match}</code>, so it wasn't used.{" "}
            <button
              onClick={() => onChange(row.name, refused[row.name])}
              className="text-sky-600 hover:underline"
            >
              Use it anyway
            </button>
          </p>
        )}
        {!value.trim() && (
          <p className="text-[10px] text-amber-600">
            No value — the run will not start with %{row.name}% empty.
            {row.kind === "domain"
              ? " Open the app in this tab, or pick an environment that has its address."
              : " The case should carry a default or a generator, or an environment should provide it — a defect for the check skill."}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="border-b border-slate-100 bg-slate-50">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-500 hover:bg-slate-100"
      >
        <span
          className={`text-[10px] transition-transform duration-200 ${
            open ? "rotate-90 text-slate-500" : "text-slate-300"
          }`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="flex-1">
          {domains.length > 0 &&
            `${domains.length} domain${domains.length === 1 ? "" : "s"}`}
          {domains.length > 0 && variables.length > 0 && " · "}
          {variables.length > 0 &&
            `${variables.length} value${variables.length === 1 ? "" : "s"}`}
          {" for this run"}
          {missing.length > 0 && (
            <span className="text-amber-600"> · {missing.length} with no value</span>
          )}
        </span>
        <span className="text-sky-600">{open ? "Hide" : "Edit"}</span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden" inert={!open}>
          <div className="space-y-2.5 px-3 pb-3">
            {rows.map(renderRow)}
            {!open
              ? null
              : mainName && (
                  <p className="text-[10px] text-slate-400">
                    Bare routes in the case open against %{mainName}%.
                  </p>
                )}
          </div>
        </div>
      </div>
    </div>
  );
}
