import { root } from "./config.mjs";
import { platform } from "./platform/index.mjs";

await platform.sandboxWorker({
  root,
  dir: process.env.AXIOM_JOB_DIR,
  temp: process.env.AXIOM_JOB_TEMP_ROOT,
  args: process.argv.slice(2),
});
