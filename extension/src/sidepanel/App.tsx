import { useState } from "react";
import { DataStoreProvider, useDataStore } from "./store/DataStoreProvider.js";
import { ConnectScreen } from "./screens/ConnectScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { CaseDetailScreen } from "./screens/CaseDetailScreen.js";
import { EditorScreen } from "./screens/EditorScreen.js";
import { RunSetupScreen } from "./screens/RunSetupScreen.js";
import { RunScreen } from "./screens/RunScreen.js";
import { RunHistoryScreen } from "./screens/RunHistoryScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";

type Screen =
  | { kind: "library" }
  | { kind: "caseDetail"; testCaseId: string }
  | { kind: "editor"; testCaseId?: string }
  | { kind: "runSetup"; testCaseId: string; version: number }
  | { kind: "run"; testCaseId: string; runId: string }
  | { kind: "history"; testCaseId?: string }
  | { kind: "settings" };

export default function App() {
  return (
    <DataStoreProvider>
      <Shell />
    </DataStoreProvider>
  );
}

function Shell() {
  const { connection } = useDataStore();
  const [stack, setStack] = useState<Screen[]>([{ kind: "library" }]);

  if (connection.status !== "connected") {
    return <ConnectScreen />;
  }

  const screen = stack[stack.length - 1];

  function push(next: Screen) {
    setStack((s) => [...s, next]);
  }

  function pop() {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }

  function replaceRoot(next: Screen) {
    setStack([next]);
  }

  switch (screen.kind) {
    case "library":
      return (
        <LibraryScreen
          onOpenCase={(id) => push({ kind: "caseDetail", testCaseId: id })}
          onNewCase={() => push({ kind: "editor" })}
          onSettings={() => push({ kind: "settings" })}
          onHistory={() => push({ kind: "history" })}
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
          onRunSetup={(version) =>
            push({ kind: "runSetup", testCaseId: screen.testCaseId, version })
          }
          onHistory={() => push({ kind: "history", testCaseId: screen.testCaseId })}
          onSettings={() => push({ kind: "settings" })}
        />
      );
    case "editor":
      return (
        <EditorScreen
          testCaseId={screen.testCaseId}
          onBack={pop}
          onSaved={(id) => replaceRoot({ kind: "caseDetail", testCaseId: id })}
        />
      );
    case "runSetup":
      return (
        <RunSetupScreen
          testCaseId={screen.testCaseId}
          version={screen.version}
          onBack={pop}
          onRunStarted={(runId) =>
            push({ kind: "run", testCaseId: screen.testCaseId, runId })
          }
          onSettings={() => push({ kind: "settings" })}
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
    case "history":
      return (
        <RunHistoryScreen
          testCaseId={screen.testCaseId}
          onBack={pop}
          onSettings={() => push({ kind: "settings" })}
          onOpenRun={(testCaseId, runId) => push({ kind: "run", testCaseId, runId })}
        />
      );
    case "settings":
      return <SettingsScreen onBack={pop} />;
  }
}
