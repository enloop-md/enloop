/**
 * Reaching a deployment's data from the machine the validator runs on.
 *
 * An environment may record how an agent gets to its database: through
 * Teleport (`tsh`), through a command that holds a VPN or an ssh tunnel
 * open, or not at all (`manual` — a sentence for a human). This module is
 * the only place that opens a tunnel, runs a probe or executes a query;
 * the panel shows one line and never calls any of it. It is plain Node and
 * deliberately not bundled into `lib.mjs`: it needs `child_process` and
 * `net`, which the browser half of the shared code must never import.
 *
 * Nothing here handles a secret. `tsh` carries its own certificates, the
 * database client is run with `PGPASSWORD` unset so it cannot pick one up
 * from the shell, and a probe is the user's own script.
 */
import { accessSync, constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

/** Whether `cmd` resolves on PATH — asked before spawning so the failure
 * reads `tsh not installed` instead of a Node ENOENT stack. */
export function onPath(cmd) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      accessSync(path.join(dir, cmd), constants.X_OK);
      return true;
    } catch {
      // Not here.
    }
  }
  return false;
}

/** Run to completion, never throw on a non-zero exit — the exit code is
 * the result here, not an exception. `timedOut` is set when the timeout
 * killed it. */
function run(cmd, args, { cwd, timeoutMs, env, shell } = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, env, shell, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === "number" ? error.code : null) : 0,
          timedOut: Boolean(error?.killed),
          spawnError: error && typeof error.code === "string" ? error.code : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

function lastLine(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function seconds(ms) {
  return `${Math.round(ms / 1000)} s`;
}

/** A failure that carries what the caller should say: `needsLogin` marks
 * the one outcome the agent cannot fix by itself. */
class ReachError extends Error {
  constructor(message, { needsLogin = false } = {}) {
    super(message);
    this.needsLogin = needsLogin;
  }
}

// ---- E11: read-only by construction ----

/** SQL with its string literals blanked, so a `;` or a `delete` inside a
 * quoted value does not count. Line and block comments go too — they are
 * where a second statement hides. */
function bareSql(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Why `sql` may not run as a lookup, or `null` when it may. The rule is
 * mechanical on purpose: first keyword `select` or `with`, one statement,
 * and no data-modifying verb anywhere — a `with … as (delete …)` is legal
 * Postgres and would otherwise pass on its first word.
 */
export function whyNotReadOnly(sql) {
  const bare = bareSql(sql).trim().replace(/;\s*$/, "");
  const first = /^([a-z]+)/i.exec(bare)?.[1]?.toLowerCase();
  if (!first) return "the query is empty";
  if (first !== "select" && first !== "with") {
    return `a lookup must be read-only — it has to start with select or with, not ${first}`;
  }
  if (/;/.test(bare)) return "a lookup must be read-only — one statement only, no `;` between statements";
  const verb = /\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|call|do|copy|lock|vacuum)\b/i.exec(bare);
  if (verb) return `a lookup must be read-only — it contains ${verb[1].toLowerCase()}`;
  return null;
}

/** E11. */
export function isReadOnlySql(sql) {
  return whyNotReadOnly(sql) === null;
}

// ---- Pasted tsh lines ----

/** A shell-ish split: whitespace-separated, quotes grouped, no expansion.
 * Enough for what a person pastes from their terminal history. */
function tokens(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * What the environment master pastes verbatim: `tsh login --proxy=H`,
 * `tsh db login S`, `tsh db connect S --db-user U --db-name N`,
 * `tsh proxy db S --db-user U --db-name N [--port P]`, joined by `&&` or
 * newlines. Every `--proxy`, the first positional after `db login`,
 * `db connect` or `proxy db`, `--db-user` and `--db-name` are taken;
 * whatever is left is kept in `note` so nothing the user typed is lost
 * silently. A paste that names neither a proxy nor a service is not a
 * reach, and the error says what was found instead.
 */
export function parseTshString(text) {
  const reach = { transport: "tsh" };
  const leftovers = [];
  const segments = String(text)
    .split(/&&|\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const words = tokens(segment);
    const at = words.indexOf("tsh");
    if (at === -1) {
      leftovers.push(segment);
      continue;
    }
    const args = words.slice(at + 1);
    let service;
    let sub;
    if (args[0] === "db" && (args[1] === "login" || args[1] === "connect")) sub = 2;
    else if (args[0] === "proxy" && args[1] === "db") sub = 2;
    else if (args[0] === "login") sub = 1;
    else sub = 0;
    for (let i = sub; i < args.length; i++) {
      const a = args[i];
      const valued = /^--(proxy|db-user|db-name|port|user|cluster)(?:=(.*))?$/.exec(a);
      if (valued) {
        let value = valued[2];
        if (value === undefined) value = args[++i];
        if (valued[1] === "proxy") reach.proxy = value;
        else if (valued[1] === "db-user") reach.dbUser = value;
        else if (valued[1] === "db-name") reach.dbName = value;
        // --port belongs to the tunnel that was open then; a new one is
        // picked per probe. --user/--cluster are login details tsh keeps.
        continue;
      }
      if (a === "--tunnel") continue;
      if (a.startsWith("-")) {
        leftovers.push(a);
        continue;
      }
      if (sub === 2 && !service) service = a;
      else leftovers.push(a);
    }
    if (service) reach.dbService ??= service;
    if (sub === 0 && args.length) leftovers.push(`tsh ${args.join(" ")}`);
  }
  if (!reach.proxy && !reach.dbService) {
    const found = Object.entries(reach)
      .filter(([k]) => k !== "transport")
      .map(([k, v]) => `${k}=${v}`);
    throw new Error(
      `not a tsh reach: no --proxy and no database service in "${text}"` +
        (found.length ? ` (found ${found.join(", ")})` : ""),
    );
  }
  if (leftovers.length) reach.note = `not parsed: ${leftovers.join(" ")}`;
  return reach;
}

// ---- Probing and tunnelling ----

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Teleport's own preconditions, in the order a person would hit them:
 * the binary, a live login, the service being one tsh can see. Throws a
 * `ReachError`; `needsLogin` marks the second. */
async function tshPreflight(reach, { cwd }) {
  if (!onPath("tsh")) throw new ReachError("tsh not installed");
  const login = `run: tsh login${reach.proxy ? ` --proxy=${reach.proxy}` : ""}`;
  const status = await run("tsh", ["status", "--format=json"], { cwd, timeoutMs: 15000 });
  if (status.code !== 0) throw new ReachError(login, { needsLogin: true });
  try {
    const parsed = JSON.parse(status.stdout);
    const until = parsed?.active?.valid_until ?? parsed?.valid_until;
    if (until && Number.isFinite(Date.parse(until)) && Date.parse(until) < Date.now()) {
      throw new ReachError(login, { needsLogin: true });
    }
  } catch (e) {
    if (e instanceof ReachError) throw e;
    // Unparseable status with exit 0: treat as logged in and let the
    // tunnel say otherwise.
  }
  if (!reach.dbService) throw new ReachError("no database service recorded — set one with --db-service");
  const ls = await run("tsh", ["db", "ls", "--format=json"], { cwd, timeoutMs: 15000 });
  if (ls.code !== 0) throw new ReachError(`tsh db ls failed: ${lastLine(ls.stderr) || `exit ${ls.code}`}`);
  let names = [];
  try {
    const list = JSON.parse(ls.stdout);
    names = (Array.isArray(list) ? list : []).map((d) => d?.metadata?.name ?? d?.name).filter(Boolean);
  } catch {
    throw new ReachError("tsh db ls printed something that is not JSON");
  }
  if (!names.includes(reach.dbService)) {
    throw new ReachError(`database service "${reach.dbService}" not in tsh db ls (${names.join(", ") || "none"})`);
  }
}

/** `sh -c "<probe>"` from the data folder: exit 0 is reachable. */
async function commandProbe(reach, { cwd, timeoutMs }) {
  if (!reach.probe?.trim()) throw new ReachError("no probe command recorded — set one with --probe");
  const r = await run("sh", ["-c", reach.probe], { cwd, timeoutMs });
  if (r.timedOut) throw new ReachError(`command timed out after ${seconds(timeoutMs)}`);
  if (r.code !== 0) {
    const why = lastLine(r.stderr);
    throw new ReachError(`command exited ${r.code}${why ? `: ${why}` : ""}`);
  }
}

/**
 * Open the way to the database, call `fn({ host, port })`, close it. For
 * `tsh` that is a `tsh proxy db --tunnel` child on a free local port,
 * killed when `fn` settles however it settles. For `command` it is the
 * probe, then `dbAddress` to learn where the database answers; nothing to
 * close. `manual` throws — a sentence cannot be tunnelled through.
 */
export async function withTunnel(reach, { cwd, timeoutMs = 20000 } = {}, fn) {
  if (reach.transport === "manual") {
    throw new ReachError("manual reach cannot run a query — record the value with --set");
  }
  if (reach.transport === "command") {
    await commandProbe(reach, { cwd, timeoutMs });
    if (!reach.dbAddress?.trim()) {
      throw new ReachError("command reach has no --db-address — a lookup needs the host:port it prints");
    }
    const r = await run("sh", ["-c", reach.dbAddress], { cwd, timeoutMs });
    const address = /^([^\s:]+):(\d+)$/.exec(lastLine(r.stdout));
    if (r.code !== 0 || !address) {
      throw new ReachError(`db-address command did not print host:port${r.stderr ? `: ${lastLine(r.stderr)}` : ""}`);
    }
    return fn({ host: address[1], port: Number(address[2]) });
  }

  await tshPreflight(reach, { cwd });
  const port = await freePort();
  const args = ["proxy", "db", "--tunnel", "--port", String(port), reach.dbService];
  if (reach.dbUser) args.push("--db-user", reach.dbUser);
  if (reach.dbName) args.push("--db-name", reach.dbName);
  const child = spawn("tsh", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  let exited = null;
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", () => {});
  child.on("exit", (code, signal) => (exited = { code, signal }));
  child.on("error", (e) => (exited = { code: null, signal: null, error: e }));
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (exited) {
        throw new ReachError(
          `tsh proxy db exited${exited.code !== null ? ` ${exited.code}` : ""}${lastLine(stderr) ? `: ${lastLine(stderr)}` : exited.error ? `: ${exited.error.message}` : ""}`,
        );
      }
      if (await tryConnect("127.0.0.1", port)) break;
      if (Date.now() > deadline) throw new ReachError(`tunnel did not open within ${seconds(timeoutMs)}`);
      await sleep(250);
    }
    return await fn({ host: "127.0.0.1", port });
  } finally {
    if (!exited) child.kill("SIGTERM");
  }
}

/** Which client a reach's protocol wants on PATH. */
function clientFor(reach) {
  return (reach.dbProtocol ?? "postgres") === "mysql" ? "mysql" : "psql";
}

/**
 * Run one read-only statement against `host:port` through the reach's
 * client and return the first column of the first row (`null` when the
 * result is empty). `psql -At` / `mysql -N -B` so the output is rows and
 * nothing else; the password variable is dropped from the environment
 * because the tunnel does the authentication and a stray `PGPASSWORD`
 * pointed at another database is a wrong answer that looks right.
 */
export async function querySql(reach, { host, port }, sql, { cwd, timeoutMs = 10000 } = {}) {
  const client = clientFor(reach);
  if (!onPath(client)) throw new ReachError(`${client} is not on PATH — install it to run lookups`);
  const env = { ...process.env, PGCONNECT_TIMEOUT: "10" };
  delete env.PGPASSWORD;
  delete env.MYSQL_PWD;
  let args;
  if (client === "psql") {
    args = ["-h", host, "-p", String(port), "-At", "-v", "ON_ERROR_STOP=1"];
    if (reach.dbUser) args.push("-U", reach.dbUser);
    if (reach.dbName) args.push("-d", reach.dbName);
    args.push("-c", sql);
  } else {
    args = ["-h", host, "-P", String(port), "-N", "-B", "--connect-timeout=10"];
    if (reach.dbUser) args.push("-u", reach.dbUser);
    if (reach.dbName) args.push(reach.dbName);
    args.push("-e", sql);
  }
  const r = await run(client, args, { cwd, timeoutMs, env });
  if (r.timedOut) throw new ReachError(`${client} timed out after ${seconds(timeoutMs)}`);
  if (r.code !== 0) throw new ReachError(`${client} exited ${r.code}${lastLine(r.stderr) ? `: ${lastLine(r.stderr)}` : ""}`);
  const rows = r.stdout
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(client === "psql" ? "|" : "\t"));
  return { value: rows.length ? (rows[0][0] ?? "") : null, rows };
}

/**
 * One probe, one verdict: `{ ok, detail, needsLogin }`. For `tsh` the
 * detail on success names the tunnel port and whether `select 1` ran —
 * a tunnel that opens is proof the proxy and the login are right, the
 * query that the service is the one meant. For `command` the probe's exit
 * code is the whole story. Never throws; a probe that cannot run is a
 * verdict too.
 */
export async function probeReach(reach, { cwd, timeoutMs = 20000 } = {}) {
  if (reach.transport === "manual") return { ok: false, detail: `manual: ${reach.note ?? ""}`, needsLogin: false };
  try {
    if (reach.transport === "command") {
      await commandProbe(reach, { cwd, timeoutMs });
      return { ok: true, detail: "exit 0", needsLogin: false };
    }
    const detail = await withTunnel(reach, { cwd, timeoutMs }, async ({ host, port }) => {
      const where = `tunnel opened on ${host}:${port}`;
      if (!onPath(clientFor(reach))) return `${where}; no ${clientFor(reach)} on PATH, query not run`;
      await querySql(reach, { host, port }, "select 1", { cwd, timeoutMs: 10000 });
      return `${where}, select 1 ok`;
    });
    return { ok: true, detail, needsLogin: false };
  } catch (e) {
    return { ok: false, detail: e.message, needsLogin: Boolean(e.needsLogin) };
  }
}
