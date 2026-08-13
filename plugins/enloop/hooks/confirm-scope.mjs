#!/usr/bin/env node
/**
 * UserPromptSubmit: a bare `/enloop:quick` or `/enloop:full` is usually
 * Enter pressed on an autocomplete, not a decision to author something
 * unnamed. The skills say what to do about it, but that instruction lives
 * three lines into a file a weak model may not weigh; this injects the
 * same demand into the turn itself, deterministically, whenever the
 * invocation arrives with no scope. Anything else — arguments present,
 * any other prompt — passes untouched.
 */
import { readFileSync } from "node:fs";

let prompt = "";
try {
  prompt = JSON.parse(readFileSync(0, "utf8"))?.prompt ?? "";
} catch {
  process.exit(0);
}
if (!/^\/enloop:(quick|full)\s*$/.test(String(prompt).trim())) process.exit(0);

console.log(
  "The skill was invoked with no scope — usually Enter pressed on an autocomplete. " +
    "Before anything else: derive the likeliest scope from git (a feature branch's diff " +
    "against the default branch; on the default branch, uncommitted changes, else the last " +
    'commit) and ask ONE closed question — "Write the case for <that>? Yes — or name a ' +
    'ticket, branch or feature instead." Then wait for the answer. Never proceed on an ' +
    "empty or guessed scope.",
);
process.exit(0);
