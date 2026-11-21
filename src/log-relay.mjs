import { spawn } from "node:child_process";
import { closeSync, constants, fstatSync, ftruncateSync, openSync, writeSync } from "node:fs";

const [path, binary, ...args] = process.argv.slice(2);
const limit = 8 * 1024 * 1024;
const fd = openSync(path, constants.O_RDWR | constants.O_CREAT, 0o600);
function append(data) {
  try {
    const tail = data.subarray(-limit);
    let start = fstatSync(fd).size;
    if (start + tail.length > limit) {
      ftruncateSync(fd, 0);
      start = 0;
    }
    let offset = 0;
    while (offset < tail.length)
      offset += writeSync(fd, tail, offset, tail.length - offset, start + offset);
  } catch (e) {
    if (e.code !== "ENOSPC" && e.code !== "EDQUOT") throw e;
  }
}
const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
child.stdout.on("data", append);
child.stderr.on("data", append);
child.on("error", (error) => append(Buffer.from(error.message + "\n")));
child.on("close", (code) => {
  closeSync(fd);
  process.exitCode = code ?? 1;
});
