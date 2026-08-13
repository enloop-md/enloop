# Enloop in Claude Code

Installing the skills, pointing them at your data folder, and invoking them.
What the skills actually *do* is in [skills.md](skills.md) — that half is the
same in every agent, and this page is only the Claude Code specifics.

Using Codex instead? [codex.md](codex.md).

## Install

All four skills ship in one plugin. Pick the path that matches what you're
doing.

**A. Try it, or use it solo across your own projects.** Add this repo as a
marketplace and install:

```
/plugin marketplace add enloop-md/enloop
/plugin install enloop@enloop
```

Update later with `/plugin update enloop`. Works in every project; nothing
to commit anywhere.

**B. Give it to your team.** Same two commands, run by each teammate. If the
repo is private, they need read access — marketplaces work fine from private
repositories. To make a project install it automatically for everyone who opens
it, declare the marketplace in that project's `.claude/settings.json` rather
than asking people to run commands.

**C. Develop it.** Symlink the plugin folder into your skills directory so
edits are live and versioned in one place:

```bash
ln -s "$PWD/plugins/enloop" ~/.claude/skills/enloop
```

It loads next session as `enloop@skills-dir`; `/reload-plugins` picks it up
immediately. This is the setup to use if you intend to change the skill or the
step contract. (If you've relocated `CLAUDE_CONFIG_DIR`, use that path instead
of `~/.claude`.)

## Invoke

Claude Code namespaces a plugin's skills, so each one is `/enloop:<skill>`:

| Skill | Command |
| --- | --- |
| Prepare an app repo, once | `/enloop:setup` |
| Write a quick case — happy path only | `/enloop:quick <ticket>` |
| Write the full case, edges and cleanup | `/enloop:full <ticket>` |
| Triage a finished run | `/enloop:check` |
| Backfill test selectors | `/enloop:instrument` |

All four carry `disable-model-invocation: true`: they edit repos and write
case files, so they run when you ask rather than when Claude infers you might
have wanted them.

The authoring skills want a Sonnet-class model or better — a config pinned
to a smaller one for cost trades authoring quality for it; see
[which model to run them on](skills.md#which-model-to-run-them-on).

## The guard hook

The plugin installs one hook: after every `Write` or `Edit` of a
`versions/v<n>.md` file, the real parser checks the result, and any errors
are fed straight back to the model that wrote it. The authoring skills
already end by validating; the hook is for the session that skips the
procedure — a weaker model, a plain "write me a test" that never invoked
the skill — which otherwise leaves a file the extension cannot load.
Warnings don't block (those are the contract's judgement calls); errors do,
because they are certainties — a case with no steps is not an opinion.

It costs one `node` start per write and stays silent for every file that
is not a case version.

## Configure

Installing the plugin is the whole installation: the case grammar and the
parser the skills validate against ship inside it, so there is nothing to
clone and no path to Enloop to set.

The one thing worth telling them is your **data folder** — the directory you
picked with "Connect folder…" in the extension. Skip even this if the repo
keeps its cases in an `enloop/` folder of its own; the skills find that
without configuration.

```json
{
  "env": {
    "ENLOOP_DATA_DIR": "/path/to/the/folder/you/connected"
  }
}
```

If you keep a **separate data folder per project**, set `ENLOOP_DATA_DIR` in
that project's `.claude/settings.json` rather than your user one — the project
value wins, so each repo writes to its own folder and you're never relying on
remembering which one is current.

What each variable means, and why the data folder is the one people get wrong,
is in [skills.md](skills.md#what-the-skills-need-to-know).
