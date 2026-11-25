import { config } from "../src/config.mjs";

process.chdir(config.workspace);
await import("../src/pi-session-cli.mjs");
