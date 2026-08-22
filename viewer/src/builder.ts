/**
 * Building a case without an agent.
 *
 * The skills write cases from an app's source, which is the best way to get
 * one — and useless if you have no agent set up, or you are a tester who
 * wants to write down what you just did by hand. This is that path: a form
 * that emits the same grammar, so what comes out is an ordinary `.md` file
 * the extension runs and the viewer renders, with nothing second-class about
 * it.
 *
 * It serializes through `renderCaseMarkdown` in `@tcm/shared` rather than
 * assembling Markdown here, so the builder cannot drift from the parser: the
 * one function that knows how to write the grammar sits next to the one that
 * reads it.
 *
 * No framework, like the rest of the viewer. Structural changes (add or
 * remove a step) re-render their list; typing updates state and the preview
 * in place, so an input never loses focus mid-word.
 */

import {
  CURRENT_FORMAT_VERSION,
  parseCaseDocument,
  renderCaseMarkdown,
  VARIABLE_GENERATORS,
  type TestCaseVersion,
} from "@tcm/shared";

interface StepDraft {
  title: string;
  where: string;
  selectors: string;
  quick: boolean;
  extra: boolean;
  instructions: string;
  script: string;
  expected: string;
  note: string;
}

interface VariableDraft {
  name: string;
  description: string;
  defaultValue: string;
  generator: string;
  generatorArg: string;
}

interface Draft {
  title: string;
  project: string;
  author: string;
  tags: string;
  description: string;
  dependencies: string;
  prerequisites: string;
  variables: VariableDraft[];
  steps: StepDraft[];
}

function emptyStep(): StepDraft {
  return {
    title: "",
    where: "",
    selectors: "",
    quick: false,
    extra: false,
    instructions: "",
    script: "",
    expected: "",
    note: "",
  };
}

function emptyDraft(): Draft {
  return {
    title: "",
    project: "",
    author: "",
    tags: "",
    description: "",
    dependencies: "",
    prerequisites: "",
    variables: [],
    steps: [emptyStep()],
  };
}

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

/** Dependencies/prerequisites from their textarea: one item per line, the
 * bullet prefix optional — but an *indented* line continues the item above
 * it, matching the grammar's multiline items so an edited case round-trips
 * instead of having its wrapped items flattened into separate ones. */
const bulletItems = (text: string): string[] => {
  const items: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    if (/^[ \t]/.test(line) && items.length > 0) {
      items[items.length - 1] += "\n" + line.replace(/^(?: {1,2}|\t)/, "").trimEnd();
    } else {
      items.push(line.replace(/^[-*]\s*/, "").trim());
    }
  }
  return items;
};

/** Items back into textarea form, continuations indented under their item. */
const bulletText = (items: string[]): string =>
  items.map((item) => item.replace(/\n/g, "\n  ")).join("\n");

/** The draft as the parser's own model, ready to serialize. */
function toDocument(draft: Draft): TestCaseVersion {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    formatVersion: CURRENT_FORMAT_VERSION,
    author: draft.author,
    project: draft.project,
    changeNote: "",
    title: draft.title,
    description: draft.description,
    tags: draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    variables: draft.variables
      .filter((v) => v.name.trim())
      .map((v) => ({
        name: v.name.trim(),
        description: v.description,
        defaultValue: v.defaultValue.trim() || undefined,
        generator: (v.generator || undefined) as TestCaseVersion["variables"][number]["generator"],
        generatorArg: v.generatorArg.trim() || undefined,
      })),
    dependencies: bulletItems(draft.dependencies),
    prerequisites: bulletItems(draft.prerequisites),
    steps: draft.steps.map((s, index) => ({
      id: `step-${index + 1}`,
      order: index,
      title: s.title,
      type: s.script.trim() ? ("automated" as const) : ("manual" as const),
      instructions: s.instructions.trim() || undefined,
      expected: s.expected.trim() || undefined,
      script: s.script.trim() || undefined,
      selectors: lines(s.selectors),
      where: s.where.trim() || undefined,
      quick: s.quick,
      extra: s.extra,
      note: s.note.trim() || undefined,
    })),
  };
}

/** An existing case back into the form, so the builder doubles as an editor. */
function fromMarkdown(markdown: string): Draft {
  const doc = parseCaseDocument(
    markdown,
    { version: 1, createdAt: new Date().toISOString() },
    { requireSteps: false },
  );
  return {
    title: doc.title,
    project: doc.project,
    author: doc.author,
    tags: doc.tags.join(", "),
    description: doc.description,
    dependencies: bulletText(doc.dependencies),
    prerequisites: bulletText(doc.prerequisites),
    variables: doc.variables.map((v) => ({
      name: v.name,
      description: v.description,
      defaultValue: v.defaultValue ?? "",
      generator: v.generator ?? "",
      generatorArg: v.generatorArg ?? "",
    })),
    steps:
      doc.steps.length > 0
        ? doc.steps.map((s) => ({
            title: s.title,
            where: s.where ?? "",
            selectors: s.selectors.join("\n"),
            quick: s.quick,
            extra: s.extra,
            instructions: s.instructions ?? "",
            script: s.script ?? "",
            expected: s.expected ?? "",
            note: s.note ?? "",
          }))
        : [emptyStep()],
  };
}

// ---------------------------------------------------------------------------
// DOM helpers — small enough to stay readable, and there is no framework here
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(
  label: string,
  value: string,
  onInput: (value: string) => void,
  opts: { area?: boolean; placeholder?: string; hint?: string; rows?: number } = {},
): HTMLElement {
  const wrap = el("label", "bfield");
  wrap.appendChild(el("span", "blabel", label));
  const input = opts.area ? el("textarea") : el("input");
  if (opts.area && opts.rows) (input as HTMLTextAreaElement).rows = opts.rows;
  (input as HTMLInputElement).value = value;
  if (opts.placeholder) (input as HTMLInputElement).placeholder = opts.placeholder;
  input.addEventListener("input", () => onInput((input as HTMLInputElement).value));
  wrap.appendChild(input);
  if (opts.hint) wrap.appendChild(el("span", "bhint", opts.hint));
  return wrap;
}

export interface BuilderHandlers {
  /** Render the built case as a page, the way a recipient would see it. */
  onPreview: (markdown: string) => void;
  onClose: () => void;
}

/**
 * Mounts the builder into `root`. `initial` pre-fills it from an existing
 * case, which is what "Edit" in the toolbar passes.
 */
export function renderBuilder(
  root: HTMLElement,
  handlers: BuilderHandlers,
  initial?: string,
): void {
  let draft: Draft;
  try {
    draft = initial ? fromMarkdown(initial) : emptyDraft();
  } catch {
    draft = emptyDraft();
  }

  root.replaceChildren();
  const page = el("div", "builder");
  root.appendChild(page);

  const head = el("div", "builder-head");
  head.appendChild(el("h1", undefined, initial ? "Edit this case" : "Build a case"));
  head.appendChild(
    el(
      "p",
      "lede",
      "Fill in what you know. What comes out is an ordinary case file — the " +
        "same grammar an agent writes — that the extension runs and this page renders.",
    ),
  );
  page.appendChild(head);

  const form = el("div", "builder-form");
  page.appendChild(form);

  const previewPane = el("pre", "builder-preview");
  const stepsList = el("div", "blist");
  const varsList = el("div", "blist");

  function markdown(): string {
    return renderCaseMarkdown(toDocument(draft));
  }

  function refreshPreview(): void {
    previewPane.textContent = markdown();
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    draft[key] = value;
    refreshPreview();
  };

  // ---- the case itself
  const about = el("section", "bsection");
  about.appendChild(el("h2", undefined, "The case"));
  about.appendChild(
    field("Title", draft.title, (v) => set("title", v), {
      placeholder: "Sign in with SSO and land on the dashboard",
      hint: "What a tester scanning a list needs to recognise.",
    }),
  );
  about.appendChild(
    field("Project", draft.project, (v) => set("project", v), {
      placeholder: "Careerminds",
      hint: "The app under test. Groups cases in the Library.",
    }),
  );
  about.appendChild(field("Author", draft.author, (v) => set("author", v)));
  about.appendChild(
    field("Tags", draft.tags, (v) => set("tags", v), {
      placeholder: "auth, smoke",
      hint: "Comma separated.",
    }),
  );
  about.appendChild(
    field("Description", draft.description, (v) => set("description", v), {
      area: true,
      rows: 3,
      placeholder: "What this case covers, and when to run it.",
    }),
  );
  form.appendChild(about);

  // ---- before you start
  const before = el("section", "bsection");
  before.appendChild(el("h2", undefined, "Before you start"));
  before.appendChild(
    field("Prerequisites", draft.prerequisites, (v) => set("prerequisites", v), {
      area: true,
      rows: 2,
      placeholder: "Signed out entirely: open a fresh incognito window.",
      hint: "One per line — things the tester must do first.",
    }),
  );
  before.appendChild(
    field("Dependencies", draft.dependencies, (v) => set("dependencies", v), {
      area: true,
      rows: 2,
      placeholder: "The branch under test is deployed.",
      hint: "One per line — what must already be true, and is not theirs to arrange.",
    }),
  );
  form.appendChild(before);

  // ---- variables
  function renderVariables(): void {
    varsList.replaceChildren();
    draft.variables.forEach((variable, index) => {
      const card = el("div", "bcard");
      const bar = el("div", "bcard-head");
      bar.appendChild(el("span", "bcard-title", `%${variable.name || "NAME"}%`));
      const remove = el("button", "bghost", "Remove");
      remove.addEventListener("click", () => {
        draft.variables.splice(index, 1);
        renderVariables();
        refreshPreview();
      });
      bar.appendChild(remove);
      card.appendChild(bar);

      card.appendChild(
        field("Name", variable.name, (v) => {
          variable.name = v.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
          (bar.firstChild as HTMLElement).textContent = `%${variable.name || "NAME"}%`;
          refreshPreview();
        }, { placeholder: "BASE_URL", hint: "Used as %NAME% anywhere in the case." }),
      );
      card.appendChild(
        field("What it is", variable.description, (v) => {
          variable.description = v;
          refreshPreview();
        }),
      );
      card.appendChild(
        field("Default value", variable.defaultValue, (v) => {
          variable.defaultValue = v;
          refreshPreview();
        }, { placeholder: "https://app.example.com" }),
      );

      const genWrap = el("label", "bfield");
      genWrap.appendChild(el("span", "blabel", "Generated instead"));
      const select = el("select");
      const none = el("option", undefined, "no — use the default above");
      none.value = "";
      select.appendChild(none);
      for (const generator of VARIABLE_GENERATORS) {
        const option = el("option", undefined, generator);
        option.value = generator;
        select.appendChild(option);
      }
      select.value = variable.generator;
      select.addEventListener("change", () => {
        variable.generator = select.value;
        refreshPreview();
      });
      genWrap.appendChild(select);
      genWrap.appendChild(
        el("span", "bhint", "A fresh value each run — a timestamp, a random string."),
      );
      card.appendChild(genWrap);
      varsList.appendChild(card);
    });
  }

  const variables = el("section", "bsection");
  variables.appendChild(el("h2", undefined, "Values (optional)"));
  variables.appendChild(
    el(
      "p",
      "bhint",
      "Declare a value once and write %NAME% wherever it appears. The run fills it in.",
    ),
  );
  variables.appendChild(varsList);
  const addVariable = el("button", "bghost", "+ Add a value");
  addVariable.addEventListener("click", () => {
    draft.variables.push({
      name: "",
      description: "",
      defaultValue: "",
      generator: "",
      generatorArg: "",
    });
    renderVariables();
    refreshPreview();
  });
  variables.appendChild(addVariable);
  form.appendChild(variables);

  // ---- steps
  function renderSteps(): void {
    stepsList.replaceChildren();
    draft.steps.forEach((step, index) => {
      const card = el("div", "bcard");
      const bar = el("div", "bcard-head");
      bar.appendChild(el("span", "bcard-title", `Step ${index + 1}`));

      const up = el("button", "bghost", "↑");
      up.title = "Move up";
      up.disabled = index === 0;
      up.addEventListener("click", () => {
        [draft.steps[index - 1], draft.steps[index]] = [draft.steps[index], draft.steps[index - 1]];
        renderSteps();
        refreshPreview();
      });
      const down = el("button", "bghost", "↓");
      down.title = "Move down";
      down.disabled = index === draft.steps.length - 1;
      down.addEventListener("click", () => {
        [draft.steps[index + 1], draft.steps[index]] = [draft.steps[index], draft.steps[index + 1]];
        renderSteps();
        refreshPreview();
      });
      const remove = el("button", "bghost", "Remove");
      remove.disabled = draft.steps.length === 1;
      remove.addEventListener("click", () => {
        draft.steps.splice(index, 1);
        renderSteps();
        refreshPreview();
      });
      bar.append(up, down, remove);
      card.appendChild(bar);

      card.appendChild(
        field("What the tester does", step.title, (v) => {
          step.title = v;
          refreshPreview();
        }, { placeholder: "Open the sign-in page" }),
      );
      card.appendChild(
        field("Instructions", step.instructions, (v) => {
          step.instructions = v;
          refreshPreview();
        }, {
          area: true,
          rows: 3,
          placeholder: 'Put "**qa@example.com**" in the email field and press Continue.',
          hint: 'A value to type goes in quotes *and* bold — "**like this**" — and becomes a control.',
        }),
      );
      card.appendChild(
        field("Expected", step.expected, (v) => {
          step.expected = v;
          refreshPreview();
        }, {
          area: true,
          rows: 2,
          placeholder: "The dashboard loads with your name in the top-right menu.",
          hint: "Pass criteria only — what makes this step green.",
        }),
      );
      card.appendChild(
        field("Where", step.where, (v) => {
          step.where = v;
          refreshPreview();
        }, {
          placeholder: "%BASE_URL%/sign-in",
          hint: "The screen to start on. A URL or route gets a Go button.",
        }),
      );
      card.appendChild(
        field("Selectors", step.selectors, (v) => {
          step.selectors = v;
          refreshPreview();
        }, {
          area: true,
          rows: 2,
          placeholder: '[data-testid="sso-button"]',
          hint: "One per line. Tried in order; the first that matches wins.",
        }),
      );
      card.appendChild(
        field("Note", step.note, (v) => {
          step.note = v;
          refreshPreview();
        }, {
          area: true,
          rows: 2,
          hint: "Background a tester may want but must not need to judge pass/fail.",
        }),
      );
      card.appendChild(
        field("Script (makes this step automated)", step.script, (v) => {
          step.script = v;
          refreshPreview();
        }, {
          area: true,
          rows: 3,
          placeholder: 'if (!document.querySelector("#flash")) api.fail("no flash");',
          hint: "Runs in the page. Call api.fail(message) to fail the step.",
        }),
      );

      // One `Kind:` per step, so the two checkboxes are mutually exclusive —
      // ticking one clears the other rather than silently losing in the
      // serializer, where quick would win.
      const quickWrap = el("label", "bcheck");
      const quick = el("input");
      quick.type = "checkbox";
      const extraWrap = el("label", "bcheck");
      const extra = el("input");
      extra.type = "checkbox";
      quick.checked = step.quick;
      quick.addEventListener("change", () => {
        step.quick = quick.checked;
        if (quick.checked) {
          step.extra = false;
          extra.checked = false;
        }
        refreshPreview();
      });
      quickWrap.append(quick, document.createTextNode(" part of the quick path"));
      card.appendChild(quickWrap);
      extra.checked = step.extra;
      extra.addEventListener("change", () => {
        step.extra = extra.checked;
        if (extra.checked) {
          step.quick = false;
          quick.checked = false;
        }
        refreshPreview();
      });
      extraWrap.append(
        extra,
        document.createTextNode(" extra — optional side-check, skipped by default"),
      );
      card.appendChild(extraWrap);

      stepsList.appendChild(card);
    });
  }

  const steps = el("section", "bsection");
  steps.appendChild(el("h2", undefined, "Steps"));
  steps.appendChild(stepsList);
  const addStep = el("button", "bghost", "+ Add a step");
  addStep.addEventListener("click", () => {
    draft.steps.push(emptyStep());
    renderSteps();
    refreshPreview();
  });
  steps.appendChild(addStep);
  form.appendChild(steps);

  // ---- output
  const output = el("section", "bsection");
  output.appendChild(el("h2", undefined, "The file"));
  output.appendChild(
    el("p", "bhint", "This is the case file. Save it into your connected folder, or open it here."),
  );
  output.appendChild(previewPane);

  const actions = el("div", "builder-actions");
  const preview = el("button", "bprimary", "Open it as a case");
  preview.addEventListener("click", () => handlers.onPreview(markdown()));
  const download = el("button", "bghost", "⤓ Download .md");
  download.addEventListener("click", () => {
    const slug =
      draft.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "case";
    const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    const anchor = el("a");
    anchor.href = url;
    anchor.download = `${slug}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  const copy = el("button", "bghost", "Copy Markdown");
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(markdown()).then(
      () => (copy.textContent = "Copied"),
      () => (copy.textContent = "Could not copy"),
    );
    setTimeout(() => (copy.textContent = "Copy Markdown"), 1500);
  });
  const close = el("button", "bghost", "Cancel");
  close.addEventListener("click", handlers.onClose);
  actions.append(preview, download, copy, close);
  output.appendChild(actions);
  form.appendChild(output);

  renderVariables();
  renderSteps();
  refreshPreview();
}
