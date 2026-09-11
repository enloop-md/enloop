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
  type PhotoSpec,
  type TestCaseVersion,
} from "@tcm/shared";

interface StepDraft {
  title: string;
  where: string;
  via: string;
  selectors: string;
  quick: boolean;
  extra: boolean;
  instructions: string;
  script: string;
  expected: string;
  note: string;
  /** `### Photo` blocks, carried through untouched — the form has no fields
   * for them yet, and dropping them on edit would silently strip a guide. */
  photos: PhotoSpec[];
  /** Title of the group this step sits in — one of `Draft.groups`, or empty
   * for a step under the plain `# Steps`. */
  group: string;
}

interface GroupDraft {
  title: string;
  goal: string;
}

interface DomainDraft {
  name: string;
  description: string;
  defaultValue: string;
  match: string;
}

interface VariableDraft {
  name: string;
  description: string;
  defaultValue: string;
  generator: string;
  generatorArg: string;
  match: string;
}

interface Draft {
  title: string;
  goal: string;
  youWill: string;
  youWillNeed: string;
  project: string;
  /** `@kind` — carried through so editing a guide keeps it one. */
  kind: TestCaseVersion["kind"];
  author: string;
  tags: string;
  /** `@locations:` — comma-separated host globs, kept as typed. */
  locations: string;
  description: string;
  dependencies: string;
  prerequisites: string;
  domains: DomainDraft[];
  variables: VariableDraft[];
  groups: GroupDraft[];
  steps: StepDraft[];
}

function emptyStep(): StepDraft {
  return {
    title: "",
    where: "",
    via: "",
    selectors: "",
    quick: false,
    extra: false,
    instructions: "",
    script: "",
    expected: "",
    note: "",
    photos: [],
    group: "",
  };
}

function emptyDraft(): Draft {
  return {
    title: "",
    goal: "",
    youWill: "",
    youWillNeed: "",
    project: "",
    kind: "case",
    author: "",
    tags: "",
    locations: "",
    description: "",
    dependencies: "",
    prerequisites: "",
    domains: [],
    variables: [],
    groups: [],
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
    version: "1",
    createdAt: new Date().toISOString(),
    formatVersion: CURRENT_FORMAT_VERSION,
    author: draft.author,
    project: draft.project,
    changeNote: "",
    kind: draft.kind,
    title: draft.title,
    goal: draft.goal,
    youWill: draft.youWill,
    youWillNeed: bulletItems(draft.youWillNeed),
    description: draft.description,
    tags: draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    locations: draft.locations
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    // The implicit `DOMAIN` is the parser's to add back; writing it out
    // would put a `# Domains` section in a file whose author typed none.
    domains: draft.domains
      .filter((d) => d.name.trim())
      .map((d) => ({
        name: d.name.trim(),
        description: d.description,
        defaultValue: d.defaultValue.trim() || undefined,
        match: d.match.trim() || undefined,
      })),
    variables: draft.variables
      .filter((v) => v.name.trim())
      .map((v) => ({
        name: v.name.trim(),
        description: v.description,
        defaultValue: v.defaultValue.trim() || undefined,
        generator: (v.generator || undefined) as TestCaseVersion["variables"][number]["generator"],
        generatorArg: v.generatorArg.trim() || undefined,
        match: v.match.trim() || undefined,
      })),
    dependencies: bulletItems(draft.dependencies),
    prerequisites: bulletItems(draft.prerequisites),
    // A group named on a step but not in the list still renders as a
    // heading, with an empty goal the linter will ask for — better than a
    // step silently losing the group it was given.
    groups: [
      ...draft.groups
        .filter((g) => g.title.trim())
        .map((g) => ({ title: g.title.trim(), goal: g.goal.trim() })),
      ...draft.steps
        .map((s) => s.group.trim())
        .filter((title, i, all) => title && all.indexOf(title) === i)
        .filter((title) => !draft.groups.some((g) => g.title.trim() === title))
        .map((title) => ({ title, goal: "" })),
    ],
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
      via: s.via.trim() || undefined,
      quick: s.quick,
      extra: s.extra,
      note: s.note.trim() || undefined,
      photos: s.photos,
      group: s.group.trim() || undefined,
    })),
  };
}

/** An existing case back into the form, so the builder doubles as an editor. */
function fromMarkdown(markdown: string): Draft {
  const doc = parseCaseDocument(
    markdown,
    { version: "1", createdAt: new Date().toISOString() },
    { requireSteps: false },
  );
  return {
    title: doc.title,
    goal: doc.goal,
    youWill: doc.youWill,
    youWillNeed: bulletText(doc.youWillNeed),
    project: doc.project,
    kind: doc.kind,
    author: doc.author,
    tags: doc.tags.join(", "),
    locations: doc.locations.join(", "),
    description: doc.description,
    dependencies: bulletText(doc.dependencies),
    prerequisites: bulletText(doc.prerequisites),
    groups: doc.groups.map((g) => ({ title: g.title, goal: g.goal })),
    domains: doc.domains.filter((d) => !d.implicit).map((d) => ({
      name: d.name,
      description: d.description,
      defaultValue: d.defaultValue ?? "",
      match: d.match ?? "",
    })),
    variables: doc.variables.map((v) => ({
      name: v.name,
      description: v.description,
      defaultValue: v.defaultValue ?? "",
      generator: v.generator ?? "",
      generatorArg: v.generatorArg ?? "",
      match: v.match ?? "",
    })),
    steps:
      doc.steps.length > 0
        ? doc.steps.map((s) => ({
            title: s.title,
            where: s.where ?? "",
            via: s.via ?? "",
            selectors: s.selectors.join("\n"),
            quick: s.quick,
            extra: s.extra,
            instructions: s.instructions ?? "",
            script: s.script ?? "",
            expected: s.expected ?? "",
            note: s.note ?? "",
            photos: s.photos,
            group: s.group ?? "",
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
  about.appendChild(
    field("Goal", draft.goal, (v) => set("goal", v), {
      placeholder: "A user can sign in with either of their two email addresses",
      hint: "One plain line: what finishing this case proves. Pinned on screen for the whole run.",
    }),
  );
  about.appendChild(
    field("You will", draft.youWill, (v) => set("youWill", v), {
      placeholder: "log in and out several times, change the primary and secondary email",
      hint: "One line on the shape of the work, read before Start.",
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
    field("Locations", draft.locations, (v) => set("locations", v), {
      placeholder: "localhost:8080, *.example.com",
      hint: "Hosts this case is meant to run on, comma separated; * matches anything. Addresses built from %DOMAIN% show green when they fit one and red when they don't. The first one without * is where a reader with no open app starts.",
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
    field("You will need", draft.youWillNeed, (v) => set("youWillNeed", v), {
      area: true,
      rows: 2,
      placeholder: "Access to a mailbox that receives the confirmation codes.",
      hint: "One per line — what must be in the tester's hands before step 1. Shown open above Start.",
    }),
  );
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

  // ---- domains
  const domainsList = el("div", "blist");
  function renderDomains(): void {
    domainsList.replaceChildren();
    draft.domains.forEach((domain, index) => {
      const card = el("div", "bcard");
      const bar = el("div", "bcard-head");
      bar.appendChild(
        el("span", "bcard-title", `%${domain.name || "NAME"}%${index === 0 ? " — main" : ""}`),
      );
      const remove = el("button", "bghost", "Remove");
      remove.addEventListener("click", () => {
        draft.domains.splice(index, 1);
        renderDomains();
        refreshPreview();
      });
      bar.appendChild(remove);
      card.appendChild(bar);

      card.appendChild(
        field("Name", domain.name, (v) => {
          domain.name = v.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
          (bar.firstChild as HTMLElement).textContent =
            `%${domain.name || "NAME"}%${index === 0 ? " — main" : ""}`;
          refreshPreview();
        }, { placeholder: "APP", hint: "Used as %NAME%/route in Where: lines, prerequisites and links." }),
      );
      card.appendChild(
        field("What it is", domain.description, (v) => {
          domain.description = v;
          refreshPreview();
        }, { placeholder: "The web app under test." }),
      );
      card.appendChild(
        field("Default address", domain.defaultValue, (v) => {
          domain.defaultValue = v;
          refreshPreview();
        }, {
          placeholder: "https://staging.example.test",
          hint: "Scheme, host and port — the deployment a run uses when no environment is picked.",
        }),
      );
      card.appendChild(
        field("Matches tabs", domain.match, (v) => {
          domain.match = v;
          refreshPreview();
        }, {
          placeholder: "*.example.test",
          hint: "Optional glob. An open tab whose host fits counts as this domain.",
        }),
      );
      domainsList.appendChild(card);
    });
  }

  const domains = el("section", "bsection");
  domains.appendChild(el("h2", undefined, "Domains (optional)"));
  domains.appendChild(
    el(
      "p",
      "bhint",
      "Write app addresses as %DOMAIN%/route — DOMAIN needs no entry here; it follows the tab a run starts from. Declare a domain only for a second deployment the case touches — an admin console, a second tenant — and an environment picked before a run sets every one of them.",
    ),
  );
  domains.appendChild(domainsList);
  const addDomain = el("button", "bghost", "+ Add a domain");
  addDomain.addEventListener("click", () => {
    draft.domains.push({ name: "", description: "", defaultValue: "", match: "" });
    renderDomains();
    refreshPreview();
  });
  domains.appendChild(addDomain);
  form.appendChild(domains);

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
        }, { placeholder: "QA_EMAIL", hint: "Used as %NAME% anywhere in the case." }),
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
        }, { placeholder: "qa.bot@example.test" }),
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
      match: "",
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
          placeholder: "%DOMAIN%/sign-in",
          hint: "The screen to start on. A URL or route gets a Go button.",
        }),
      );
      card.appendChild(
        field("Via", step.via, (v) => {
          step.via = v;
          refreshPreview();
        }, {
          placeholder: "Settings → Users → the row for the account",
          hint: "How the page is reached in the app's own menus, for when the address is for another environment. Required when the step moves to a new page; \"link only\" if the UI has no path.",
        }),
      );
      card.appendChild(
        field("Group", step.group, (v) => {
          step.group = v;
          refreshPreview();
        }, {
          placeholder: "Restore password",
          hint: "Optional. The title of a group from the list above; steps of one group sit together.",
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

  // ---- groups
  const groupsList = el("div", "blist");
  function renderGroups(): void {
    groupsList.replaceChildren();
    draft.groups.forEach((group, index) => {
      const card = el("div", "bcard");
      const bar = el("div", "bcard-head");
      bar.appendChild(el("span", "bcard-title", group.title || `Group ${index + 1}`));
      const remove = el("button", "bghost", "Remove");
      remove.addEventListener("click", () => {
        draft.groups.splice(index, 1);
        renderGroups();
        refreshPreview();
      });
      bar.appendChild(remove);
      card.appendChild(bar);
      card.appendChild(
        field("Title", group.title, (v) => {
          group.title = v;
          (bar.firstChild as HTMLElement).textContent = v || `Group ${index + 1}`;
          refreshPreview();
        }, { placeholder: "Restore password", hint: "Type the same title in the Group field of each step that belongs here." }),
      );
      card.appendChild(
        field("Goal", group.goal, (v) => {
          group.goal = v;
          refreshPreview();
        }, {
          area: true,
          rows: 2,
          placeholder: "The reset mail reaches the migrated address and its link signs the user in.",
          hint: "What the group's steps prove together — required.",
        }),
      );
      groupsList.appendChild(card);
    });
  }

  const groups = el("section", "bsection");
  groups.appendChild(el("h2", undefined, "Groups (optional)"));
  groups.appendChild(
    el(
      "p",
      "bhint",
      "A case covering a broad change reads better as a few concerns — log in, restore a password, change the address — each with a goal and the steps that prove it. Steps keep numbering through groups.",
    ),
  );
  groups.appendChild(groupsList);
  const addGroup = el("button", "bghost", "+ Add a group");
  addGroup.addEventListener("click", () => {
    draft.groups.push({ title: "", goal: "" });
    renderGroups();
    refreshPreview();
  });
  groups.appendChild(addGroup);
  form.appendChild(groups);

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

  renderDomains();
  renderVariables();
  renderGroups();
  renderSteps();
  refreshPreview();
}
