import { existsSync } from "node:fs";
import { resolve } from "node:path";
export const windows = {
  terminalShell(env = process.env) {
    const shell =
      env.AXIOM_PWSH_EXE ||
      resolve(env.ProgramFiles || "C:/Program Files", "PowerShell/7/pwsh.exe");
    if (!existsSync(shell)) throw Error("PowerShell 7 executable not found; set AXIOM_PWSH_EXE");
    return shell;
  },
  sandboxEntry(root) {
    return resolve(root, "src/sandbox-pi.mjs");
  },
  async sandboxWorker({ root, dir, temp, args }) {
    if (!dir || !temp)
      throw Error("Windows ACL worker requires private job and temporary directories");
    const cli = resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
    process.argv = [
      process.execPath,
      resolve(root, "vendor/dsh/native/acl-runner.mjs"),
      "--workspace",
      dir,
      "--temp",
      temp,
      "--mode",
      "workspace-write",
      "--",
      process.execPath,
      cli,
      ...args,
    ];
    await import("../../vendor/dsh/native/acl-runner.mjs");
  },
};
