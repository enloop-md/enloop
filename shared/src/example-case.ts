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
Click "**tomsmith**", then click the Username field on the page. The value
is typed in for you, with the events a framework-controlled field needs in
order to notice the change.

### Expected
- The Username field contains tomsmith.

### Note
Double quotes around bold — "**like this**", which is why that reads as a
control too — is how a case marks a literal the tester has to type.
Backticks mean the opposite: something to *find* on screen, like
\`#username\`, which the panel turns into a Highlight control wherever it
appears in the prose.

## Type the password
Where: %BASE_URL%/login
Selector: #password
Kind: quick
Click "**SuperSecretPassword!**", then click the Password field.

### Expected
- The Password field is filled.

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
`;
}
