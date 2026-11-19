import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ProjectTrustStore } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/trust-manager.js";
import { config, root } from "./config.mjs";
import { workspacePath } from "./workspace.mjs";

const exec = promisify(execFile);
const permissionPath = resolve(config.sessionDir, "permission.json");
export const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
};
export async function writeJson(path, value) {
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, path);
}
export async function permission() {
  return (await readJson(permissionPath, { mode: "full" })).mode;
}
export async function setPermission(mode) {
  if (!["full", "ask", "read-only"].includes(mode)) throw Error("Invalid permission mode");
  await writeJson(permissionPath, { mode });
  return { mode };
}
export async function inventory() {
  const globalDir = getAgentDir(),
    localDir = resolve(config.workspace, ".pi");
  const trust = new ProjectTrustStore(globalDir).getEntry(config.workspace);
  const [global, local, globalMcp, localMcp] = await Promise.all([
    readJson(resolve(globalDir, "settings.json"), {}),
    readJson(resolve(localDir, "settings.json"), {}),
    readJson(resolve(globalDir, "mcp.json"), {}),
    readJson(resolve(localDir, "mcp.json"), {}),
  ]);
  const summarize = (obj, scope) =>
    Object.entries(obj.mcpServers ?? {}).map(([name, s]) => ({
      name,
      scope,
      enabled: s.enabled !== false,
      transport: s.url ? "http" : s.command ? "stdio" : "override",
      exposure: s.exposure ?? "codemode",
    }));
  return {
    packages: [
      ...(global.packages ?? []).map((p) => ({
        source: typeof p === "string" ? p : p.source,
        scope: "global",
      })),
      ...(local.packages ?? []).map((p) => ({
        source: typeof p === "string" ? p : p.source,
        scope: "project",
        disabled:
          typeof p === "object" &&
          p.autoload === false &&
          ["extensions", "skills", "prompts", "themes"].every(
            (key) => Array.isArray(p[key]) && p[key].length === 0,
          ),
      })),
    ],
    servers: [...summarize(globalMcp, "global"), ...summarize(localMcp, "project")],
    projectExtensions: local.extensions ?? [],
    workspace: config.workspace,
    trust,
  };
}
export async function resourceAction({
  operation,
  source,
  name,
  url,
  command,
  args: argv,
  trusted,
}) {
  if (operation === "trust") {
    if (typeof trusted !== "boolean") throw Error("Explicit trust decision required");
    new ProjectTrustStore(getAgentDir()).set(config.workspace, trusted);
    return {
      message: "Workspace-specific trust saved. Restart the Pi session host to apply.",
    };
  }
  let args;
  if (["package-disable", "package-enable", "package-update"].includes(operation)) {
    if (
      typeof source !== "string" ||
      !source.trim() ||
      source.startsWith("-") ||
      source.length > 1000
    )
      throw Error("Invalid package source");
    // Read the same native project configuration Pi consumes. Never toggle a global package.
    const path = await workspacePath(".pi/settings.json"),
      settings = await readJson(path, {});
    const packages = settings.packages ?? [];
    const index = packages.findIndex((p) => (typeof p === "string" ? p : p.source) === source);
    if (index < 0) throw Error("Package is not configured in this project");
    const item = packages[index];
    if (operation === "package-update") {
      if (!/^(npm:|git:)/.test(source))
        throw Error("Only installed npm/git sources are updateable");
      const global = await readJson(resolve(getAgentDir(), "settings.json"), {});
      if ((global.packages ?? []).some((p) => (typeof p === "string" ? p : p.source) === source))
        throw Error("Source also exists globally; use Pi native package manager to choose scope");
      args = ["update", "--extension", source, "--approve"];
    } else {
      const simple = typeof item === "string" || Object.keys(item).every((k) => k === "source");
      const disabled =
        typeof item === "object" &&
        item.autoload === false &&
        ["extensions", "skills", "prompts", "themes"].every(
          (k) => Array.isArray(item[k]) && item[k].length === 0,
        ) &&
        Object.keys(item).every((k) =>
          ["source", "autoload", "extensions", "skills", "prompts", "themes"].includes(k),
        );
      if (operation === "package-disable") {
        if (!simple && !disabled)
          throw Error("Package has custom resource filters; preserve them using Pi config");
        packages[index] = {
          source,
          autoload: false,
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        };
      } else {
        if (!disabled) throw Error("Package does not have a reversible disabled configuration");
        packages[index] = source;
      }
      await writeJson(path, { ...settings, packages });
      return { message: "Project package configuration saved. Reload Pi to apply." };
    }
  } else if (operation === "mcp-toggle") {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw Error("Invalid MCP name");
    const path = await workspacePath(".pi/mcp.json"),
      settings = await readJson(path, {});
    const servers = settings.mcpServers ?? {};
    if (!Object.hasOwn(servers, name)) throw Error("Project MCP server not found");
    servers[name] = { ...servers[name], enabled: servers[name].enabled === false };
    await writeJson(path, { ...settings, mcpServers: servers });
    return { message: "Project MCP configuration saved. Reload Pi to apply." };
  } else if (operation === "install" || operation === "remove") {
    if (
      typeof source !== "string" ||
      !source.trim() ||
      source.startsWith("-") ||
      source.length > 1000
    )
      throw Error("Invalid package source");
    args = [operation, source, "--local", ...(operation === "install" ? ["--approve"] : [])];
  } else if (operation === "mcp-add") {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw Error("Invalid MCP name");
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw Error("Invalid MCP URL");
    args = ["mcp", "add", name, "--local", "--url", u.href];
  } else if (operation === "mcp-add-stdio") {
    if (
      !/^[A-Za-z0-9_-]+$/.test(name) ||
      typeof command !== "string" ||
      !command.trim() ||
      command.startsWith("-") ||
      !Array.isArray(argv) ||
      argv.some((a) => typeof a !== "string")
    )
      throw Error("Invalid stdio MCP configuration");
    args = ["mcp", "add", name, "--local", "--exposure", "direct", "--", command, ...argv];
  } else if (operation === "mcp-check") {
    args = ["mcp", "list", "--json"];
  } else if (operation === "mcp-remove") {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw Error("Invalid MCP name");
    args = ["mcp", "remove", name, "--local"];
  } else throw Error("Unknown resource operation");
  const { stdout, stderr } = await exec(
    process.execPath,
    [resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), ...args],
    {
      cwd: config.workspace,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    },
  );
  return { message: (stdout + "\n" + stderr).trim() };
}

const providerPath = resolve(config.sessionDir, "axiom-providers.json");
export async function providers() {
  return readJson(providerPath, []);
}
export async function providerAction(value) {
  const { operation, name } = value;
  if (typeof name !== "string" || !/^axiom-custom-[a-z0-9-]{1,60}$/.test(name))
    throw Error("Provider name must start with axiom-custom-");
  const existing = await providers();
  if (operation === "remove") {
    await writeJson(
      providerPath,
      existing.filter((p) => p.name !== name),
    );
    return { ok: true };
  }
  if (operation !== "upsert") throw Error("Invalid provider operation");
  const url = new URL(value.baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Invalid API endpoint");
  const envKey = String(value.envKey || "");
  if (envKey && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey))
    throw Error("Enter an environment variable name, not a secret");
  if (!envKey && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error("Remote endpoint requires an API key environment variable");
  const api = value.api;
  if (!["openai-completions", "openai-responses", "anthropic-messages"].includes(api))
    throw Error("Unsupported API protocol");
  const modelId = String(value.modelId || "").trim(),
    contextWindow = Number(value.contextWindow),
    maxTokens = Number(value.maxTokens);
  if (
    !modelId ||
    modelId.length > 256 ||
    !Number.isSafeInteger(contextWindow) ||
    contextWindow < 1 ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > contextWindow
  )
    throw Error("Invalid model configuration");
  const p = {
    name,
    baseUrl: url.href,
    api,
    envKey,
    modelId,
    contextWindow,
    maxTokens,
    reasoning: value.reasoning === true,
    image: value.image === true,
  };
  await writeJson(providerPath, [...existing.filter((x) => x.name !== name), p]);
  return { ok: true };
}
