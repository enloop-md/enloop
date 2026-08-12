import type { ReactNode } from "react";
import { CaptureNotice } from "./CaptureNotice.js";
import { captureIsOn, type CaptureSettings, type WrapperState } from "../lib/capture.js";

/**
 * The two capture checkboxes, wherever the tester meets them.
 *
 * They are one setting for the whole extension, not a property of a run — the
 * page-side wrapper is a browser-wide content-script registration, and there is
 * no version of this that switches itself on for one run and off for the next.
 * So the same control appears in Settings and in front of a run, writes the
 * same key, and says so: ticking it here is ticking it everywhere, until it is
 * unticked.
 *
 * In front of a run because that is where the question is actually being asked.
 * A tester about to reproduce something odd knows in that moment whether they
 * want the console kept; nobody has that thought while in Settings, which is
 * why the feature otherwise stays off for people who would have wanted it.
 *
 * Two boxes rather than one because the two streams ask for different things.
 * Console output leaks whatever the app chose to print; requests carry auth
 * headers, cookies and bodies by design — so a tester who agreed to keep logs
 * has not thereby agreed to keep traffic.
 */

interface Toggle {
  /** In front of a run, where the label is competing with a Start button. */
  short: string;
  label: string;
  hint: ReactNode;
  checked: (s: CaptureSettings) => boolean;
  set: (s: CaptureSettings, on: boolean) => CaptureSettings;
  /** Rendered indented, and only while the toggle above it is on — it
   * modifies that one rather than standing beside it. */
  sub?: boolean;
  /** Hidden entirely when this is false. */
  shown?: (s: CaptureSettings) => boolean;
}

const TOGGLES: Toggle[] = [
  {
    checked: (s) => s.console,
    set: (s, on) => ({ ...s, console: on }),
    short: "Console output",
    label: "Capture console output",
    hint: (
      <>
        Wraps <code>console.log</code>/<code>warn</code>/<code>error</code> — plus uncaught errors
        — on pages you run cases against, and files what they print with the run. Console output
        can contain tokens and customer data, and runs are written to a folder people commit.
      </>
    ),
  },
  {
    checked: (s) => s.network !== "off",
    // Turning requests off drops the every-request choice with it; there is no
    // such thing as tracing everything while capturing nothing.
    set: (s, on) => ({ ...s, network: on ? "failed" : "off" }),
    short: "Failed requests",
    label: "Capture failed requests",
    hint: (
      <>
        Method, URL, status and duration for requests that failed or came back 4xx/5xx. Never
        headers, never bodies, and query strings are redacted. A button that did nothing because a
        request 500'd shows up here and often nowhere else.
      </>
    ),
  },
  {
    checked: (s) => s.network === "all",
    set: (s, on) => ({ ...s, network: on ? "all" : "failed" }),
    sub: true,
    shown: (s) => s.network !== "off",
    short: "…and the ones that worked",
    label: "…and the ones that worked",
    hint: (
      <>
        The whole trace: every request the page made, in order, with its status. Answers "what did
        this actually call when I clicked that" — the question DevTools normally gets opened for.
        Much noisier, so it reaches the log's ceiling sooner on a busy app, and it is worth turning
        back off once you have what you came for.
      </>
    ),
  },
];

export function CaptureToggles({
  settings,
  wrapper,
  onChange,
  compact = false,
  className = "",
}: {
  settings: CaptureSettings;
  /** What the active tab says about itself — drives the reload notice. */
  wrapper: WrapperState;
  onChange: (next: CaptureSettings) => void;
  /** The version that fits above a Start run button: short labels, no blurbs. */
  compact?: boolean;
  className?: string;
}) {
  const on = captureIsOn(settings);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {compact && (
        <p className="text-[11px] text-slate-500">
          Capture from the page — stays on for every run until you turn it off.
        </p>
      )}
      <div className={compact ? "flex flex-wrap gap-x-4 gap-y-1" : "space-y-2"}>
        {TOGGLES.filter((toggle) => toggle.shown?.(settings) ?? true).map((toggle) => (
          <label
            key={toggle.label}
            className={`${compact ? "flex items-center gap-1.5" : "flex items-start gap-2"} ${
              toggle.sub ? (compact ? "basis-full pl-5" : "pl-5") : ""
            }`}
          >
            <input
              type="checkbox"
              checked={toggle.checked(settings)}
              onChange={(e) => onChange(toggle.set(settings, e.target.checked))}
              className={compact ? "" : "mt-0.5"}
            />
            {compact ? (
              <span className="text-xs text-slate-700">{toggle.short}</span>
            ) : (
              <span>
                <span className="font-medium text-slate-800">{toggle.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{toggle.hint}</span>
              </span>
            )}
          </label>
        ))}
      </div>
      {on && (
        <>
          {/* Both places want the reload prompt; only Settings wants the "no
              access to this page yet" one. In a run flow that grant is asked
              for by the first step that needs it, and a second notice about
              the same missing permission is noise. */}
          <CaptureNotice wrapper={wrapper} explainUnknown={!compact} />
          <p className="text-[11px] text-slate-400">
            <span className="font-medium text-slate-500">
              Leave these off when you are not using them.
            </span>{" "}
            While either is on, every <code>console</code> call and every request on the sites you
            have granted Enloop goes through a wrapper — on a chatty page that costs a little of
            the speed you are there to judge.
          </p>
          {!compact && (
            <p className="text-[11px] text-slate-400">
              Capture covers the sites you have granted Enloop access to, and starts at the next
              load of each page. Turning it off needs no reload. Entries land in{" "}
              <code>console.md</code> in the run's folder; whether any of it reaches{" "}
              <code>report.md</code> is a separate question, asked when you finish the run.
            </p>
          )}
        </>
      )}
    </div>
  );
}
