import type { RunStatus, RunStepStatus } from "@tcm/shared";

const STEP_STYLES: Record<RunStepStatus, string> = {
  pending: "bg-slate-100 text-slate-500",
  running: "bg-blue-100 text-blue-700 animate-pulse",
  success: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  skipped: "bg-slate-100 text-slate-400 line-through",
};

const RUN_STYLES: Record<RunStatus, string> = {
  in_progress: "bg-blue-100 text-blue-700",
  passed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  aborted: "bg-slate-200 text-slate-600",
};

export function StepStatusBadge({ status }: { status: RunStepStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STEP_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${RUN_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}
