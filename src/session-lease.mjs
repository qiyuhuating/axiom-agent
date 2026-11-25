import { mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const leases = new Map();

function canonicalPath(file) {
  const path = resolve(file);
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    mkdirSync(dirname(path), { recursive: true });
    return join(realpathSync.native(dirname(path)), basename(path));
  }
}

// SQLite's OS lock is released even on SIGKILL. Keep its backing file so that
// competing openers always synchronize on the same inode.
export function acquireSessionLease(file) {
  const path = canonicalPath(file);
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  let lease = leases.get(key);
  if (!lease) {
    const directory = join(dirname(path), ".axiom-locks");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(directory, basename(key) + ".sqlite"));
    try {
      db.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      db.close();
      if (error.errcode === 5)
        throw Error("Session in use by another Axiom GUI or Pi CLI: " + path);
      throw error;
    }
    lease = { db, users: 0 };
    leases.set(key, lease);
  }
  lease.users++;
  return () => {
    if (--lease.users === 0) {
      lease.db.close();
      leases.delete(key);
    }
  };
}

export function withSessionLease(file, operation) {
  const release = acquireSessionLease(file);
  try {
    return operation();
  } finally {
    release();
  }
}
