import { useCallback, useEffect, useState } from "react";
import type {
  AgentCommand,
  AgentCommandSourceField,
  AgentQuestion,
  DataStore,
} from "@tcm/shared";

const POLL_INTERVAL_MS = 3000;

/** What an ask carries: the text plus whatever the component captured from
 * the page before submitting. Capture belongs to the UI (it owns the
 * checkboxes); this layer only transports. */
export interface AskDraft {
  stepId: string;
  question: string;
  selection: string;
  pageUrl: string;
  screenshotPng: Uint8Array | null;
  pageHtml: string | null;
}

/** A command still owed a change: the agent has yet to pick it up, is
 * running it, or has been asked to stop it. */
export function commandPending(command: AgentCommand): boolean {
  return (
    command.display === "queued" || command.display === "running" || command.display === "stopping"
  );
}

/**
 * The run screen's view of the agent channel: questions and commands for one
 * run, re-read from disk on a short timer while anything is waiting on the
 * other side.
 *
 * State lives on disk, not here — the panel document is destroyed every time
 * the tester clicks into the page under test, so this hook's whole job is to
 * re-derive everything from the files on mount and keep deriving while a
 * question is unanswered or a command unfinished. When nothing is pending
 * the timer stops; the next ask/run starts it again.
 */
export function useAgentChannel(
  store: DataStore,
  testCaseId: string,
  runId: string,
  active: boolean,
) {
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [commands, setCommands] = useState<AgentCommand[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [qs, cs] = await Promise.all([
        store.listQuestions(testCaseId, runId),
        store.listCommands(testCaseId, runId),
      ]);
      setQuestions(qs);
      setCommands(cs);
    } catch (e) {
      // A lapsed handle must not take the run screen down; the next
      // user-initiated store call will surface it properly.
      console.warn("agent channel refresh failed", e);
    }
  }, [store, testCaseId, runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const waiting =
    questions.some((q) => q.answer === null) || commands.some(commandPending);

  useEffect(() => {
    if (!active || !waiting) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, waiting, refresh]);

  const ask = useCallback(
    async (draft: AskDraft) => {
      await store.askQuestion(testCaseId, runId, draft);
      await refresh();
    },
    [store, testCaseId, runId, refresh],
  );

  const runCommand = useCallback(
    async (command: string, stepId: string | null, sourceField: AgentCommandSourceField) => {
      await store.requestCommand(testCaseId, runId, { command, stepId, sourceField });
      await refresh();
    },
    [store, testCaseId, runId, refresh],
  );

  const kill = useCallback(
    async (commandId: string) => {
      await store.killCommand(testCaseId, commandId);
      await refresh();
    },
    [store, testCaseId, refresh],
  );

  return { questions, commands, ask, runCommand, kill, refresh };
}
