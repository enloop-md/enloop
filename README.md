<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/enloop-dark.svg">
    <img src="assets/enloop.svg" alt="Enloop" width="620">
  </picture>
</p>

<p align="center"><em>Enloop — managing human attention</em></p>

<h3 align="center">Fix the Bottleneck in Human-in-the-Loop</h3>

<p align="center">
  The human is the slowest step in any AI feedback cycle. Enloop makes that step<br>
  ruthlessly effective. By handling the heavy lifting of context and instruction,<br>
  it frees you to operate at the speed of thought, turning validation from a<br>
  chore into a seamless flow.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/enloopmd-managing-human-a/fnpjeaabeckcihomnmeoapclokikanod"><strong>Install from the Chrome Web Store</strong></a>
  &nbsp;·&nbsp;
  <a href="https://enloop-md.github.io/enloop/">Open the viewer</a>
</p>

# Enloop

A Chrome side-panel extension for running manual and automated test cases,
plus the agent skills — for Claude Code and Codex — that write those cases
for you.

**A test case is one Markdown file**, committed next to the code it tests.
An agent writes it, the side panel executes it step by step:

```markdown
## Sync the contact
Where: %DOMAIN%/admin/sync-console
Selector: #sync-crm-mailer-btn
Click `Sync CRM → Mailer`.

### Expected
- A spinner appears on that button only.
- A toast reports synced / skipped / failed counts.
```

The principle behind all of it is in [MANIFESTO.md](MANIFESTO.md): the human
verifying a flow puts in zero effort — never asked to decide, to provide a
value, or to look anything up. A case that would ask is a defective case.

`Where:` is the screen to start on — `%DOMAIN%` is whatever tab you start the
run from, so the same case runs against a branch, staging or a local server —
`Selector:` is what the panel flashes for the tester, `"quoted values"` type
themselves into fields, and a fenced code block in place of instructions makes
the step automated. A complete worked
example and the full grammar are in [docs/case-format.md](docs/case-format.md).

Open source under the [MIT license](LICENSE) — the extension, the case parser,
and the skills are all in this repo. Cases are plain Markdown in a folder you
pick, read and written directly through the File System Access API: no server,
no database, no account.

## Get started

**1. Run cases — the extension.**
[Install it from the Chrome Web Store](https://chromewebstore.google.com/detail/enloopmd-managing-human-a/fnpjeaabeckcihomnmeoapclokikanod),
connect a folder, and let the Library load its example case — it runs against
a public practice site and exercises every control the panel has, so the first
thing you do is watch a run work rather than author one blind.

**2. Write cases — the skills.** One plugin, installed into the agent you use:

*Claude Code* — add this repo as a marketplace and install:

```
/plugin marketplace add enloop-md/enloop
/plugin install enloop@enloop
```

Then, from the repo of the app you're testing: `/enloop:setup` once, and
`/enloop:quick <ticket>` to write a case. Details, team installs, and the
guard hooks: [docs/claude-code.md](docs/claude-code.md).

*Codex* — the same repo is a Codex marketplace:

```bash
codex plugin marketplace add enloop-md/enloop
```

Then `/plugins` to install **enloop**, start a new session, and mention the
skills as `$setup`, `$quick <ticket>`. Details and Codex caveats:
[docs/codex.md](docs/codex.md).

## The pieces

- **[The extension](docs/extension.md)** runs cases: step by step, marking
  pass/fail, executing automated steps in the page, capturing notes, and
  writing a run report. Install it from the
  [Chrome Web Store](https://chromewebstore.google.com/detail/enloopmd-managing-human-a/fnpjeaabeckcihomnmeoapclokikanod).
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
  **serve** stays in the loop *during* a run: a session watching your folder
  answers "how do I check this?" from the step itself — with your screenshot
  and page structure in hand — patches the case if the step was the problem,
  and runs a case's setup commands when you click them in the panel.
  **guide** writes a case for an end user instead of a tester, with photo
  specs the runner turns into marked-up screenshots as it runs, and
  **export-guide** turns the finished run into a Markdown folder or one
  HTML page — a [user guide](docs/guides.md) nobody had to screenshot by hand.

## Start here

| I want to… | Go to |
| --- | --- |
| Install the extension | [Chrome Web Store](https://chromewebstore.google.com/detail/enloopmd-managing-human-a/fnpjeaabeckcihomnmeoapclokikanod) |
| Run cases in the browser | [docs/extension.md](docs/extension.md) |
| Write cases with **Claude Code** | [docs/claude-code.md](docs/claude-code.md) |
| Write cases with **Codex** | [docs/codex.md](docs/codex.md) |
| Understand what the skills do | [docs/skills.md](docs/skills.md) |
| Answer questions with no session open (enloopd) | [docs/daemon.md](docs/daemon.md) |
| Write or read a case by hand | [docs/case-format.md](docs/case-format.md) |
| Take screenshots on a run, write and export a user guide | [docs/guides.md](docs/guides.md) |
| Share a case with someone | [the viewer](https://enloop-md.github.io/enloop/) |

---

## Repository layout

```
extension/          Chrome extension (React + Vite, side panel)
viewer/             the online viewer (static page, GitHub Pages)
daemon/             enloopd — the standalone answering daemon (docs/daemon.md)
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
