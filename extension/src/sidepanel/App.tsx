import { useEffect, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { HOME, loadNavStack, saveNavStack, type Screen } from "../lib/nav-state.js";
import { DataStoreProvider, useDataStore } from "./store/DataStoreProvider.js";
import { ConnectScreen } from "./screens/ConnectScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { CaseDetailScreen } from "./screens/CaseDetailScreen.js";
import { EditorScreen } from "./screens/EditorScreen.js";
import { RunScreen } from "./screens/RunScreen.js";
import { RunHistoryScreen } from "./screens/RunHistoryScreen.js";
import { FreeRunScreen } from "./screens/FreeRunScreen.js";
import { SuiteDetailScreen } from "./screens/SuiteDetailScreen.js";
import { SuiteEditorScreen } from "./screens/SuiteEditorScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { EnvironmentsScreen } from "./screens/EnvironmentsScreen.js";

export default function App() {
  return (
    <ErrorBoundary>
      <DataStoreProvider>
        <Shell />
      </DataStoreProvider>
    </ErrorBoundary>
  );
}

function Shell() {
  const { state, store } = useDataStore();
  // Null while the stored stack is being read. The panel is destroyed every
  // time it closes, so this is what keeps a click into the page from
  // throwing away the run the tester was in the middle of.
  const [stack, setStack] = useState<Screen[] | null>(null);

  useEffect(() => {
    void loadNavStack().then((restored) => setStack(restored ?? [HOME]));
  }, []);

  useEffect(() => {
    if (stack) void saveNavStack(stack);
  }, [stack]);

  // The Connect screen is now only for having nothing mounted: no storages at
  // all, or every one of them waiting on a permission Chrome dropped. With one
  // storage granted the Library renders and handles the rest with banners.
  if (state.status !== "ready" || !store) {
    return <ConnectScreen />;
  }

  if (!stack) return null;

  const screen = stack[stack.length - 1];

  function push(next: Screen) {
    setStack((s) => [...(s ?? [HOME]), next]);
  }

  function pop() {
    setStack((s) => (s && s.length > 1 ? s.slice(0, -1) : s));
  }

  function replaceRoot(next: Screen) {
    setStack([next]);
  }

  switch (screen.kind) {
    case "library":
      return (
        <LibraryScreen
          onOpenCase={(id) => push({ kind: "caseDetail", testCaseId: id })}
          onOpenSuite={(suiteId) => push({ kind: "suiteDetail", suiteId })}
          onNewCase={() => push({ kind: "editor" })}
          onNewSuite={() => push({ kind: "suiteEditor" })}
          onNewFreeRun={(freeRunId) => push({ kind: "freeRun", freeRunId })}
          onSettings={() => push({ kind: "settings" })}
          onHistory={() => push({ kind: "history" })}
          onOpenRun={(testCaseId, runId) => push({ kind: "run", testCaseId, runId })}
          onOpenFreeRun={(freeRunId) => push({ kind: "freeRun", freeRunId })}
        />
      );
    case "caseDetail":
      return (
        <CaseDetailScreen
          testCaseId={screen.testCaseId}
          onBack={pop}
          onEdit={() => push({ kind: "editor", testCaseId: screen.testCaseId })}
          onRunStarted={(runId) =>
            push({ kind: "run", testCaseId: screen.testCaseId, runId })
          }
          onHistory={() => push({ kind: "history", testCaseId: screen.testCaseId })}
          onSettings={() => push({ kind: "settings" })}
        />
      );
    case "editor":
      return (
        <EditorScreen
          testCaseId={screen.testCaseId}
          suiteId={screen.suiteId}
          onBack={pop}
          onSaved={(id) => replaceRoot({ kind: "caseDetail", testCaseId: id })}
        />
      );
    case "suiteDetail":
      return (
        <SuiteDetailScreen
          suiteId={screen.suiteId}
          onBack={pop}
          onOpenCase={(id) => push({ kind: "caseDetail", testCaseId: id })}
          onNewCaseInSuite={(suiteId) => push({ kind: "editor", suiteId })}
          onEditSuite={(suiteId) => push({ kind: "suiteEditor", suiteId })}
          onSettings={() => push({ kind: "settings" })}
        />
      );
    case "suiteEditor":
      return (
        <SuiteEditorScreen
          suiteId={screen.suiteId}
          onBack={pop}
          onSaved={(id) => replaceRoot({ kind: "suiteDetail", suiteId: id })}
        />
      );
    case "run":
      return (
        <RunScreen
          testCaseId={screen.testCaseId}
          runId={screen.runId}
          onBack={pop}
          onSettings={() => push({ kind: "settings" })}
        />
      );
    case "freeRun":
      return (
        <FreeRunScreen
          freeRunId={screen.freeRunId}
          onBack={pop}
          onSettings={() => push({ kind: "settings" })}
        />
      );
    case "history":
      return (
        <RunHistoryScreen
          testCaseId={screen.testCaseId}
          onBack={pop}
          onSettings={() => push({ kind: "settings" })}
          onOpenRun={(testCaseId, runId) => push({ kind: "run", testCaseId, runId })}
          onOpenFreeRun={(freeRunId) => push({ kind: "freeRun", freeRunId })}
        />
      );
    case "settings":
      return (
        <SettingsScreen
          onBack={pop}
          onEnvironments={(storageId) => push({ kind: "environments", storageId })}
        />
      );
    case "environments":
      return <EnvironmentsScreen storageId={screen.storageId} onBack={pop} />;
  }
}
