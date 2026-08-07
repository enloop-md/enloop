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

## Configure

The skills run from *other* repos and read the grammar and run data from this
one, so they need to know where it lives. Set it once in your user
`settings.json`:

```json
{
  "env": {
    "ENLOOP_HOME": "/path/to/enloop"
  }
}
```

Then point them at your **data folder** — the directory you picked with
"Connect folder…" in the extension:

```json
{
  "env": {
    "ENLOOP_HOME": "/path/to/enloop",
    "ENLOOP_DATA_DIR": "/path/to/the/folder/you/connected"
  }
}
```

If you keep a **separate data folder per project**, set `ENLOOP_DATA_DIR` in
that project's `.claude/settings.json` rather than your user one — the project
value wins, so each repo writes to its own folder and you're never relying on
remembering which one is current. Keep `ENLOOP_HOME` in the user settings; it's
the same everywhere.

What each variable means, and why the data folder is the one people get wrong,
is in [skills.md](skills.md#what-the-skills-need-to-know).
