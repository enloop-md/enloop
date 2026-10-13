/**
 * Marks a case that came in as a dropped file rather than being written for
 * this folder — and, in run lists, the runs of such a case. Without it an
 * imported copy sits in the Library looking exactly like one of the
 * project's own cases, and its runs are mistaken for the project's runs.
 */
export function ImportedBadge({ imported }: { imported: { at: string; file: string } }) {
  return (
    <span
      className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800"
      title={`Imported from ${imported.file} on ${new Date(imported.at).toLocaleString()} — not written for this project`}
    >
      imported
    </span>
  );
}
