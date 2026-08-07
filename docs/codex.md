# Enloop in Codex

Installing the skills, pointing them at your data folder, and invoking them.
What the skills actually *do* is in [skills.md](skills.md) — that half is the
same in every agent, and this page is only the Codex specifics.

Using Claude Code instead? [claude-code.md](claude-code.md).

## Install

This repo is a Codex marketplace: `.agents/plugins/marketplace.json` points at
the same plugin folder Claude Code installs from.

```bash
codex plugin marketplace add enloop-md/enloop
```

Then `/plugins` in Codex to install **enloop**, and start a new session before
using it — bundled skills are picked up at session start.

To develop against a local checkout, add the marketplace by path instead:

```bash
codex plugin marketplace add ./path/to/enloop
```

## Invoke

Mention a skill explicitly with `$`, or run `/skills` to list what is loaded:

| Skill | Mention |
| --- | --- |
| Prepare an app repo, once | `$setup` |
| Write a quick case — happy path only | `$quick` |
| Write the full case, edges and cleanup | `$full` |
| Triage a finished run | `$check` |
| Backfill test selectors | `$instrument` |

All four set `allow_implicit_invocation: false` in their `agents/openai.yaml`
— the counterpart of Claude Code's `disable-model-invocation: true`. They edit
repos and write case files, so they run when you ask and not when Codex
guesses that you meant them.

### The bare-name caveat

Codex does not yet prefix a plugin's skills with the plugin name
([openai/codex#28608][ns] adds it), so these install under bare names:
`$quick`, not `$enloop-quick`. If another installed plugin claims the same
name, disambiguate with `/skills`.

They are deliberately **not** renamed to `enloop-*` here, because Claude Code
already namespaces them and the result there would be `/enloop:enloop-quick`.
When Codex ships plugin-namespaced skills, this section goes away and nothing
else changes.

[ns]: https://github.com/openai/codex/pull/28608

## Configure

The skills run from *other* repos and read the grammar and run data from this
one, so they need to know where it lives. Codex takes these from the shell
rather than from a per-repo settings file, so the durable home is your shell
profile — or a project-level `.envrc` if you use direnv, which is the closest
equivalent to a per-project value:

```bash
export ENLOOP_HOME=/path/to/enloop
export ENLOOP_DATA_DIR=/path/to/the/folder/you/connected
export ENLOOP_PROJECT="Your App"        # optional; the setup skill records it
```

`ENLOOP_DATA_DIR` is the directory you picked with "Connect folder…" in the
extension. What each variable means, and why the data folder is the one people
get wrong, is in [skills.md](skills.md#what-the-skills-need-to-know).

## What is not included

Skills only — the plugin bundles no MCP server. Everything these skills do is
read the repo and write Markdown, which Codex already does natively; an MCP
server would earn its place once there is a remote store to talk to (see
[`PLAN-BACKEND.md`](../PLAN-BACKEND.md)).
