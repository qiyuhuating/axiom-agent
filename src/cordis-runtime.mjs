import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Context, Service } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { config, root } from "./config.mjs";
export async function createRuntimeContext(jobs, terminal) {
  const ctx = new Context();
  class JobService extends Service {
    constructor(ctx) {
      super(ctx, "axiomJobs");
    }
    page(cursor, limit, session) {
      return jobs.jobPage(cursor, limit, session);
    }
    detail(id) {
      return jobs.jobDetail(id);
    }
    state() {
      return jobs.jobState();
    }
    action(action, value) {
      return jobs.jobAction(action, value);
    }
    teamTool(token, value) {
      return jobs.teamTool(token, value);
    }
  }
  class TerminalService extends Service {
    constructor(ctx) {
      super(ctx, "axiomTerminal");
    }
    list() {
      return terminal.legacy ? terminal.legacy.list() : terminal.listTerminals();
    }
    listAsync() {
      return terminal.listTerminals();
    }
    actionAsync(action, value) {
      return terminal.terminalAction(action, value);
    }
    get(id) {
      return terminal.legacy ? terminal.legacy.get(id) : terminal.getTerminal(id);
    }
    action(action, value) {
      return terminal.legacy
        ? terminal.legacy.action(action, value)
        : terminal.terminalAction(action, value);
    }
  }
  await ctx.plugin(JobService);
  await ctx.plugin(TerminalService);
  await ctx.plugin(Loader, {
    baseUrl: pathToFileURL(resolve(root, "package.json")).href,
  });
  await ctx.plugin(Include, {
    path: pathToFileURL(resolve(config.sessionDir, "cordis.json")).href,
    initial: [],
    enableLogs: true,
  });
  await ctx.loader.await();
  ctx.emit("axiom/runtime-ready");
  return ctx;
}
