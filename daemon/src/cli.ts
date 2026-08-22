import { existsSync } from "node:fs";
import path from "node:path";
import { questionsTick, resolveBackend } from "./answer.js";
import { commandsTick } from "./commands.js";
import { HELP, loadConfig } from "./config.js";
import { log, warn } from "./log.js";
import { runSetup } from "./setup.js";
import { touchWatcher } from "./store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "setup") {
    await runSetup();
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const cfg = loadConfig(argv);
  const backend = cfg.commandsOnly ? null : resolveBackend(cfg);
  if (!cfg.commandsOnly && backend === null) {
    // Never silently ignore questions — refuse to start instead.
    throw new Error(
      "No answering backend is viable (no claude, no codex, no Anthropic credential). " +
        "Run `enloopd setup`, or start with --commands-only.",
    );
  }
  for (const dataDir of cfg.dataDirs) {
    if (!existsSync(path.join(dataDir, "test-cases"))) {
      warn(`${dataDir} does not look like an Enloop data folder (no test-cases/)`);
    }
  }

  log(
    `enloopd ${cfg.watcherId} — backend ${cfg.commandsOnly ? "commands-only" : backend}` +
      `${backend === "api" ? ` (${cfg.model})` : ""}, ` +
      `${cfg.dataDirs.length} folder(s), poll ${cfg.pollSeconds}s, defer ${cfg.deferSeconds}s`,
  );
  log(`a live Claude Code serve loop always wins questions; this daemon defers and yields`);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log("stopping after this pass (processes started by commands keep running to their own ends)");
  });

  do {
    for (const dataDir of cfg.dataDirs) {
      try {
        touchWatcher(dataDir, cfg.watcherId, cfg.host);
        if (!cfg.noCommands) await commandsTick(dataDir, cfg);
        if (!cfg.commandsOnly) await questionsTick(dataDir, backend, cfg);
      } catch (e) {
        warn(`${dataDir}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (cfg.once || stopping) break;
    await sleep(cfg.pollSeconds * 1000);
  } while (!stopping);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
