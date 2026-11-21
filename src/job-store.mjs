import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
export function openJobStore(dir) {
  const db = new DatabaseSync(join(dir, "jobs.sqlite"));
  db.exec(
    "PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS jobs(id TEXT UNIQUE NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
  );
  const put = db.prepare(
    "INSERT INTO jobs(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
  );
  const meta = db.prepare("INSERT OR REPLACE INTO metadata VALUES(1,?)");
  const record = db.prepare("SELECT value FROM metadata WHERE id=1").get();
  const legacy = join(dir, "state.json");
  const state = record
    ? {
        ...JSON.parse(record.value),
        jobs: db
          .prepare("SELECT value FROM jobs ORDER BY rowid DESC")
          .all()
          .map((r) => JSON.parse(r.value)),
      }
    : existsSync(legacy)
      ? JSON.parse(readFileSync(legacy, "utf8"))
      : { jobs: [], plans: {}, schedules: [] };
  state.mail ??= [];
  function save(changed, metadata) {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const job of changed) put.run(job.id, JSON.stringify(job));
      if (metadata)
        meta.run(
          JSON.stringify({ plans: state.plans, schedules: state.schedules, mail: state.mail }),
        );
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!record) save([...state.jobs].reverse(), true);
  return { state, save, close: () => db.close() };
}
