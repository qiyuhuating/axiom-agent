// Use the pinned Pi ESM entry so the GUI and native CLI share persistence hooks.
// The bundled entry has a separate, private copy of SessionManager.
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { acquireSessionLease, withSessionLease } from "./session-lease.mjs";

const dist = new URL("./", import.meta.resolve("@earendil-works/pi-coding-agent"));
const leases = new WeakMap();
const abandoned = new FinalizationRegistry((release) => release());
function releaseManager(manager) {
  leases.get(manager)?.release();
  leases.delete(manager);
  abandoned.unregister(manager);
}
function own(manager, path) {
  if (!path || leases.get(manager)?.path === path) return;
  const release = acquireSessionLease(path);
  releaseManager(manager);
  leases.set(manager, { path, release });
  abandoned.register(manager, release, manager);
}

const selector = new URL("modes/interactive/components/session-selector.js", dist).href;
const interactive = new URL("modes/interactive/interactive-mode.js", dist).href;
const storage = new URL("core/session-manager.js", dist).href;
const leaseModule = new URL("./session-lease.mjs", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (![selector, interactive, storage].includes(url)) return result;
    const source = Buffer.from(result.source).toString();
    if (url === interactive) {
      // These temporary managers belong to the TUI, outside AgentSession.dispose.
      const rename = "const mgr = SessionManager.open(sessionFilePath);";
      const fork =
        "const fork = SessionManager.forkFrom(sourcePath, cwd, this.sessionManager.getSessionDir());";
      if (
        ![
          rename,
          fork,
          "mgr.appendSessionInfo(next);",
          "return result;\n    }\n    getLoginProviderOptions",
        ].every((fragment) => source.includes(fragment))
      )
        throw Error("Update Pi TUI session integration");
      return {
        ...result,
        source: source
          .replace(
            "mgr.appendSessionInfo(next);",
            "try { mgr.appendSessionInfo(next); } finally { mgr[Symbol.dispose](); }",
          )
          .replace(fork, fork + " try {")
          .replace(
            "return result;\n    }\n    getLoginProviderOptions",
            "return result; } finally { fork[Symbol.dispose](); }\n    }\n    getLoginProviderOptions",
          ),
      };
    }
    if (url === storage) {
      const create = 'const fd = openSync(newSessionFile, "wx");';
      const done = "return new SessionManager(resolvedTargetCwd, dir, newSessionFile, true);";
      if (!source.includes(create) || !source.includes(done))
        throw Error("Update Pi session fork integration");
      // Keep the target exclusively owned through its first write and manager construction.
      return {
        ...result,
        source:
          "import { acquireSessionLease } from " +
          JSON.stringify(leaseModule) +
          ";\n" +
          source
            .replace(
              create,
              "const releaseTarget = acquireSessionLease(newSessionFile); try {\n" + create,
            )
            .replace(done, done + " } finally { releaseTarget(); }"),
      };
    }
    const signature = "async function deleteSessionFile(sessionPath) {";
    if (!source.includes(signature)) throw Error("Update Pi session deletion integration");
    return {
      ...result,
      source:
        "import { acquireSessionLease } from " +
        JSON.stringify(leaseModule) +
        ";\n" +
        source.replace(
          signature,
          `async function deleteSessionFile(sessionPath) {
          let release;
          try {
            release = acquireSessionLease(sessionPath);
            return await deleteOwnedSessionFile(sessionPath);
          } catch (error) {
            return { ok: false, method: "unlink", error: error.message };
          } finally { release?.(); }
        }
        async function deleteOwnedSessionFile(sessionPath) {`,
        ),
    };
  },
});

const { SessionManager } = await import(new URL("core/session-manager.js", dist));
const { AgentSession } = await import(new URL("core/agent-session.js", dist));
const proto = SessionManager.prototype;
proto[Symbol.dispose] = function () {
  releaseManager(this);
};
const open = SessionManager.open;
SessionManager.open = function (path, ...args) {
  return withSessionLease(path, () => open.call(this, path, ...args));
};
const load = proto._setSessionFile;
proto._setSessionFile = function (path, ...args) {
  return withSessionLease(path, () => {
    const result = load.call(this, path, ...args);
    own(this, this.getSessionFile());
    return result;
  });
};
for (const method of ["newSession", "createBranchedSession"]) {
  const original = proto[method];
  proto[method] = function (...args) {
    const result = original.apply(this, args);
    own(this, this.getSessionFile());
    return result;
  };
}
for (const method of ["_persist", "_rewriteFile"]) {
  const original = proto[method];
  proto[method] = function (...args) {
    own(this, this.getSessionFile());
    return original.apply(this, args);
  };
}
const fork = SessionManager.forkFrom;
SessionManager.forkFrom = function (source, ...args) {
  return withSessionLease(source, () => fork.call(this, source, ...args));
};
const dispose = AgentSession.prototype.dispose;
AgentSession.prototype.dispose = function () {
  try {
    return dispose.call(this);
  } finally {
    releaseManager(this.sessionManager);
  }
};
const cli = new URL("cli.js", dist);
process.argv[1] = fileURLToPath(cli);
await import(cli);
