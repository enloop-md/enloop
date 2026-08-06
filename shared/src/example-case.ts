import { CURRENT_FORMAT_VERSION } from "./markdown.js";

/**
 * The case a brand new connected folder can be filled with in one click.
 *
 * Cases are normally written by the Claude Code skills against a real app,
 * which is a loop that cannot start until the panel has something in it: a
 * first-time user connects an empty folder and is looking at an empty
 * Library with no way to find out what a run even looks like. This is that
 * something — one case, self-contained, safe to run repeatedly, and chosen
 * to exercise every control the panel offers rather than to be realistic:
 * `Where:` and Go, `Selector:` and Highlight, a quoted value typed into a
 * field, an automated step that decides its own result, a variable, and the
 * quick/full distinction.
 *
 * It runs against a public practice site rather than a page bundled here,
 * because the thing being demonstrated is the panel acting on a real page in
 * a real tab — a local fixture would demonstrate a different product.
 * `%BASE_URL%` is a variable so that a tester who cannot reach that site (or
 * would rather not) can point the whole case somewhere else from the case
 * screen without editing it.
 */
export const EXAMPLE_CASE_TITLE = "Enloop example: log in and out of a demo app";

export function exampleCaseSource(): string {
  return `# ${EXAMPLE_CASE_TITLE}
@version ${CURRENT_FORMAT_VERSION}
@project Enloop example
Tags: example

A two-minute case to run before writing any of your own. It exercises every
control the side panel has: **Go** opens a page in this tab, **Highlight**
flashes an element, a quoted value types itself into a field, and one step
runs a script inside the page and decides its own result.

It runs against the-internet.herokuapp.com, a public practice site — no
account of yours is involved, and the last step logs out again, so you can
run it as many times as you like.

# Variables

## BASE_URL
The site this case runs against. Every %BASE_URL% in the case is replaced
with this value when the run starts, so pointing it elsewhere moves the
whole case.
Default: https://the-internet.herokuapp.com

## RUN_TAG
A fresh value every run, to show what a generator does. It has no default:
the panel fills it in when the run starts, and you will see it appear
inside a step further down.
Generator: random-string 6

# Dependencies
- Chrome's side panel is open — you are reading this in it.

# Prerequisites
- An internet connection: this case runs against a public demo site.

# Steps

## Open the login page
Where: %BASE_URL%/login
Selector: #username
Kind: quick
Click **Go** next to *Where* above. It navigates the tab you are looking at
rather than opening a new one, so every later step acts on the page in
front of you.

### Expected
- The page shows a login form with Username and Password fields.
- **✨ Highlight** scrolls to the Username field and flashes it amber.

### Note
\`Where:\` here is \`%BASE_URL%/login\` rather than a bare \`/login\`. The
variable is substituted before the run starts, so Go knows the whole address
instead of having to guess an origin from whatever tab happens to be open.

## Type the username
Where: %BASE_URL%/login
Selector: #username
Kind: quick
Put "**tomsmith**" in the Username field.

### Expected
- The Username field contains tomsmith.

### Note
Double quotes around bold — "**like this**", which is why that phrase reads
as a control right here in this note — is how a case marks a literal the
tester has to enter, and every renderer turns it into one. What
the control *does* depends on where you are reading: in this side panel it
arms the page, so the value types itself into the next input you click, with
the events a framework-controlled field needs in order to notice. Open the
same case in the online viewer or a downloaded HTML page and there is no
page to type into, so the control copies the value to your clipboard
instead. Either way the step reads the same, which is the point of
describing the value rather than the mechanism.

Backticks mean the opposite: something to *find* on screen, like
\`#username\`, which becomes a Highlight control wherever it appears in the
prose.

## Type the password
Where: %BASE_URL%/login
Selector: #password
Selector: form input[type="password"]
Kind: quick
Put "**SuperSecretPassword!**" in [the Password field](#password).

### Expected
- The Password field is filled.

### Note
This step lists two \`Selector:\` lines. They are tried in order and the first
one that matches wins, which is how a case survives a \`data-testid\` that has
not shipped yet or an element that moved into a modal. The run screen says
which one matched. The link above is the other way to write a Highlight —
\`[the Password field](#password)\` — for when a bare selector would read badly
mid-sentence.

## Log in
Where: %BASE_URL%/login
Selector: button[type="submit"]
Kind: quick
Click the \`Login\` button.

### Expected
- The page moves to /secure.
- A green flash message reports a successful login.

## Check the flash message
Kind: quick
\`\`\`js
const flash = document.querySelector("#flash");
if (!flash) api.fail("No #flash message on the page.");
if (!flash.textContent.includes("You logged into a secure area!")) {
  api.fail("Unexpected flash text: " + flash.textContent.trim());
}
\`\`\`

### Expected
- The step marks itself green without anyone pressing Pass.

### Note
A fenced code block in place of instructions makes a step automated: the
script runs in the page's own world with full DOM access, and \`api.fail\`
fails the step. Nothing else about the step changes — it still has a title,
and you can still override its result by hand.

## Read the secure area
Where: %BASE_URL%/secure
Selector: #content h2
Read the heading of the page you landed on.

### Expected
- The heading reads "Secure Area".

### Note
This is the one step with no \`Kind: quick\` on it, so a **Quick** run skips
it and a **Full** run includes it. That is the whole mechanism: a case is
written once, in full, and the marks pick out the core path worth running
during development.

## Say something about this step
Kind: quick
Every step takes notes and tasks, and this is the one to try them on.

This one needs the side panel — a case being read in the viewer has no note
box to type into.

Under **Notes**, enter "**demo %RUN_TAG%**" and add it. Then open the type
menu beside it: a note is a *note*, a *feature request*, *bugfix required*,
or *docs update required*. Pick one of the last three.

Under **Tasks**, add "**check this on mobile too**" and tick it off.

### Expected
- The note carries the type you picked as a coloured label.
- \`%RUN_TAG%\` in what you typed came out as a short random string — that is
  the generator from the values panel, resolved when this run started.
- The task can be ticked and unticked.

### Note
Typed notes are what makes a finished run actionable rather than a verdict:
anything marked *bugfix required*, *feature request* or *docs update
required* is collected into \`feedback.md\` when the run finishes, which is
what the **check** skill reads back in the app repo. A plain note stays in
the report for a human.

## Log out
Where: %BASE_URL%/secure
Selector: a[href="/logout"]
Kind: quick
Click **Logout**.

### Expected
- The page returns to the login form.
- A flash message reports that you logged out.

### Note
Cleanup is a step like any other, and it is marked quick deliberately: a
case that cannot be run twice will be run once.

## Comment on the run as a whole
Find the box at the bottom of the run screen — *Comment on the whole run
(optional)* — and type "**felt quick, nothing surprising**".

### Expected
- The comment saves as you type; there is no button to press.

### Note
Some findings do not belong to any one step: "ran against yesterday's
build", "felt slow throughout". Those had nowhere to go before this box
existed, so a run that passed while worrying the tester produced no handoff
at all. A run comment counts as feedback on its own — it alone will produce
a \`feedback.md\`.

## Hand this case to someone else
Go back to the case screen (the arrow at the top left) and find **Share v1**
at the bottom. Open **⤓ Download** and take a look at the four entries.

Download **HTML page — full**, then open the file you just saved.

### Expected
- The downloaded page opens in any browser with no extension and no network:
  steps you can tick off, values you can copy, and the variables from this
  case in a panel at the top.
- Ticking a step in that file and reopening it keeps your place.

### Note
The four exports are two questions, not one. **Markdown or HTML** is who is
receiving it — a file for a repo, a PR or a coding agent, against a page for
a person. **Full or simplified** is how much of the machinery they should
see: simplified drops selectors and scripts and fills in default values, so
what is left is instructions.

## Send this case as a link
Still on the case screen, press **🔗 Copy link**, then paste it into the
address bar of a new tab.

### Expected
- The viewer opens this case, rendered as a page, with the same steps.
- The whole case travelled inside the link — nothing was uploaded, and there
  is no server behind that page.

### Note
Every case file the panel writes also ends with a comment carrying its own
link, so someone handed the raw \`.md\` can open it in a browser without
being told how. It is an HTML comment: invisible on GitHub and in previews,
plain in the file.

## See where your cases are kept
Open **Settings** (the gear, top right) and read the **Storages** section.

### Expected
- The folder you connected is listed, with the folder name under the label.
- **Add a folder…** is offered below it.

### Note
More than one folder can be connected at once, and the Library lists them
together with a filter to narrow to one. That is what makes a folder *inside
an app repo* work: cases are committed with the code they test and arrive
with a clone, while \`runs/\` and \`free-runs/\` stay out of the repo through a
\`.gitignore\` the panel writes. Cases are written into whichever folder you
choose when you create them.

## Finish the run and read what it wrote
Press **Finish run** and pick a verdict.

### Expected
- The run appears under **Runs** with its verdict, its tier (*quick* or
  *full*), and a count of what passed, warned and failed.
- In your connected folder, \`runs/<case-id>/<run-id>/\` now holds
  \`case.md\` — the exact case this run executed, frozen — plus \`run.json\`,
  a readable \`report.md\`, and \`feedback.md\` for the notes you left.

### Note
That frozen \`case.md\` is why a run stays meaningful after the case is
edited: it records what was actually executed, not what the case says today.

There is one more thing this case cannot show you, because it has no steps:
a **Free run** — an unscripted session with just a notes field, for when you
are exploring rather than following a script. The Library offers it beside
**New case**.
`;
}
