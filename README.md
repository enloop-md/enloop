<p align="center">
  <img src="assets/enloop-banner-bw-web.png" alt="Enloop" width="620">
</p>

<p align="center"><em>Enloop — managing human attention</em></p>

<h3 align="center">Fix the Bottleneck in Human-in-the-Loop</h3>

<p align="center">
  The human is the slowest step in any AI feedback cycle. Enloop makes that step<br>
  ruthlessly effective. By handling the heavy lifting of context and instruction,<br>
  it frees you to operate at the speed of thought, turning validation from a<br>
  chore into a seamless flow.
</p>

# Enloop

A Chrome side-panel extension for running manual and automated test cases,
plus the agent skills — for Claude Code and Codex — that write those cases
for you.

**A test case is one Markdown file.** This is the whole format:

```markdown
# Careerminds: Sync a contact from the CRM to the mailer
@version 0.0.3
@author Your Name
@project Careerminds
Tags: sync-console, integrations, manual

Verifies the single-contact sync path added in PROJ-1234.

# Variables

## TEST_CONTACT_EMAIL
Email of a contact present in both the CRM and the mailer.
Default: qa.bot@example.com

# Prerequisites
- Logged in to the admin as a super-admin

# Steps

## Open the sync console
Where: /admin/sync-console
Selector: #account-tabs
Navigate to the page.

### Expected
- The account picker renders as tabs.
- Each tab shows the account name with its sync purpose beneath it.

## Sync the contact
Where: /admin/sync-console
Selector: [data-testid="sync-crm-mailer"]
Selector: #sync-crm-mailer-btn
Click `Sync CRM → Mailer`.

### Expected
- A spinner appears on that button only.
- A toast reports synced / skipped / failed counts.

### Note
Regression check — this button used to stay disabled when the local column
had no match, even though the sync creates the record.
```

That file is what an agent writes, what the side panel executes step by step,
and what you commit next to the code it tests. `Where:` is the screen to start
on, `Selector:` is what the panel flashes for the tester, `"**quoted values**"`
type themselves into fields, and a fenced code block in place of instructions
makes the step automated. The full grammar is in
[docs/case-format.md](docs/case-format.md).

Open source under the [MIT license](LICENSE) — the extension, the case parser,
and the skills are all in this repo. Cases are plain Markdown in a folder you
pick, read and written directly through the File System Access API: no server,
no database, no account.

## The three pieces

- **[The extension](docs/extension.md)** runs cases: step by step, marking
  pass/fail, executing automated steps in the page, capturing notes, and
  writing a run report.
- **[The viewer](docs/extension.md#the-viewer)** shares them:
  <https://enloop-md.github.io/enloop/>. Send anyone a link and they read the
  case in a browser — steps to tick off, values to copy, variables to fill in
  — with no install and no account. The case rides inside the link, so there
  is still nothing uploaded anywhere.
- **[The builder](https://enloop-md.github.io/enloop/)** writes one without an
  agent: a form in the viewer that emits the same grammar, for when you want to
  write down what you just did by hand. It also opens any case you are viewing,
  so the viewer edits as well as reads.
- **[The skills](docs/skills.md)** close the loop: **setup** prepares an app
  repo once, **quick** and **full** write a case for a real feature or ticket from inside
  the repo being tested, and **check** triages the finished run back in that
  same repo — deciding per failure whether the app is wrong or the case is.

## Start here

| I want to… | Go to |
| --- | --- |
| Run cases in the browser | [docs/extension.md](docs/extension.md) |
| Write cases with **Claude Code** | [docs/claude-code.md](docs/claude-code.md) |
| Write cases with **Codex** | [docs/codex.md](docs/codex.md) |
| Understand what the skills do | [docs/skills.md](docs/skills.md) |
| Write or read a case by hand | [docs/case-format.md](docs/case-format.md) |
| Share a case with someone | [the viewer](https://enloop-md.github.io/enloop/) |

The quickest way in: install the extension, connect a folder, and let the
Library load its example case — it runs against a public practice site and
exercises every control the panel has, so the first thing you do is watch a
run work rather than author one blind.

---

## Repository layout

```
extension/          Chrome extension (React + Vite, side panel)
viewer/             the online viewer (static page, GitHub Pages)
shared/             parser, schemas, id/variable helpers — the grammar lives here
docs/               the documentation this README links to
plugins/enloop/     the distributable skill plugin (Claude Code + Codex)
                    skills/ is shared; .claude-plugin/ and .codex-plugin/
                    are one manifest each
.claude/skills/     enloop-demo (this repo only)
.claude-plugin/     Claude Code marketplace manifest
.agents/plugins/    Codex marketplace manifest
private/            local connected-folder data (git-ignored)
```

The case *page* — markup, styles and behaviour — lives in
[`shared/src/html.ts`](shared/src/html.ts), not in the viewer. The viewer
renders it from a link and the extension inlines it into a downloadable file,
and the promise of a shared link is that both show the same thing, so there is
deliberately only one of it. The behaviour is serialized into the standalone
file with `Function.prototype.toString`, which is why `attachCasePage` must
stay self-contained — a reference to anything outside its own body throws in
the downloaded file, where the surrounding module does not exist.

Development:

```bash
npm run dev         # extension with HMR
npm run dev:viewer  # viewer on http://localhost:5174
npm run build       # production build to extension/dist
npm run build:viewer
npm run typecheck   # shared + extension + viewer
```

The viewer deploys to GitHub Pages from `master` on any change under `viewer/`
or `shared/` — see [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
It needs **Settings → Pages → Source: GitHub Actions** switched on once in the
repo.

## Contributing

Issues and pull requests are welcome.

Two things to know before opening a PR:

- **The grammar's spec is the doc comment** at the top of
  [`shared/src/markdown.ts`](shared/src/markdown.ts). If you change how a
  document parses, change that comment in the same commit and bump
  `CURRENT_FORMAT_VERSION`. Existing case files must keep parsing.
- **Examples must be generic.** Everything in this repo — README samples, the
  step contract, doc comments — uses a fictional admin app with a CRM and a
  mailer. Don't paste in routes, ticket ids, company names, or bug narratives
  from a real employer or client; those belong in your own cases folder, which
  is git-ignored for exactly this reason.

## License

[MIT](LICENSE) © Sergey Ryabenko
