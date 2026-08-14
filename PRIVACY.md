# Enloop privacy policy

Effective 2026-08-14. This file is the policy; its history is public in this
repository, so every change to it is visible. The same text is served at
<https://enloop-md.github.io/enloop/privacy.html> for the Chrome Web Store
listing — keep the two in step.

## The short version

Enloop has no server and no accounts. It collects nothing, transmits
nothing, and stores everything on your machine, in places you choose.

## What the extension stores, and where

- **Test cases, runs, reports and feedback files** are plain files in a
  local folder you connect through your browser's File System Access
  picker. They never leave that folder unless you move them.
- **Panel state** — which screen was open, your capture preferences — lives
  in the browser's extension storage on your machine.
- **Site access** is granted by you, per origin, at the moment a step first
  needs it, and can be revoked at any time in Chrome's extension settings.

## What the extension can read

On sites you have granted access to, and only while you run a case there,
the extension acts on the page: it highlights elements, inserts values you
chose, and executes a case's automated steps. If you switch capture on for
a run, the page's console output and request log are recorded **into the
local run files** — those may contain data shown by the page, and they stay
on your machine under your control.

## What leaves your machine

Nothing, to us — Enloop's developers operate no backend and receive no
data, no telemetry, no analytics, no crash reports. Sharing is always your
own action: a share link carries the case *inside the URL* (the online
viewer renders it in your browser; the case text in the link's fragment is
not sent to the hosting server), a downloaded HTML page is a local file,
and anything you commit to a repository goes where you point it.

## The agent skills

The Claude Code and Codex skills run inside your own coding agent, under
your account with that provider, subject to that provider's terms. Enloop
adds no collection there either: the skills read your repository and write
case files into your local data folder.

## Changes

Changes to this policy are commits to this repository — diffable, dated,
and attributable, like everything else here.

## Contact

Questions or concerns: open an issue at
<https://github.com/enloop-md/enloop/issues> or write to
<ryabenko.sergey@gmail.com>.
