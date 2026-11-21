import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openJobStore(dir) {
  const db = new DatabaseSync(join(dir, "jobs.sqlite"));
  const rows = (sql, ...args) =>
    db
      .prepare(sql)
      .all(...args)
      .map((row) => JSON.parse(row.value));
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  db.exec("PRAGMA synchronous=FULL");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 1) throw Error("Unsupported job database version");
  if (!version)
    transaction(() => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS jobs(id TEXT UNIQUE NOT NULL, value TEXT NOT NULL);
      CREATE INDEX jobs_status ON jobs(json_extract(value,'$.status'));
      CREATE INDEX jobs_team ON jobs(json_extract(value,'$.team'));
      CREATE TABLE plans(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE schedules(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX schedules_enabled ON schedules(json_extract(value,'$.enabled'));
      CREATE TABLE mail(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX mail_team ON mail(json_extract(value,'$.team'));
      CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
    `);
      const record = db.prepare("SELECT value FROM metadata WHERE id=1").get();
      const legacy = join(dir, "state.json");
      const old = record
        ? JSON.parse(record.value)
        : existsSync(legacy)
          ? JSON.parse(readFileSync(legacy, "utf8"))
          : {};
      for (const table of ["jobs", "plans", "schedules", "mail"]) {
        const insert = db.prepare("INSERT INTO " + table + "(id,value) VALUES(?,?)");
        if (table === "plans") {
          for (const [id, plan] of Object.entries(old.plans ?? {}))
            insert.run(id, JSON.stringify(plan));
        } else {
          const values = old[table] ?? [];
          for (const item of table === "jobs" ? values.reverse() : values)
            insert.run(item.id, JSON.stringify(item));
        }
      }
      db.exec("DROP TABLE metadata; PRAGMA user_version=1");
    });
  const put = db.prepare(
    "INSERT INTO jobs(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
  );
  const store = {
    active: () =>
      rows(
        "SELECT value FROM jobs WHERE json_extract(value,'$.status') IN ('queued','running') ORDER BY rowid DESC",
      ),
    team: (id) =>
      rows("SELECT value FROM jobs WHERE json_extract(value,'$.team')=? ORDER BY rowid DESC", id),
    job: (id) => rows("SELECT value FROM jobs WHERE id=?", id)[0],
    schedule: (id) => rows("SELECT value FROM schedules WHERE id=?", id)[0],
    enabledSchedules: () =>
      rows("SELECT value FROM schedules WHERE json_extract(value,'$.enabled')=1 ORDER BY rowid"),
    schedules: () => rows("SELECT value FROM schedules ORDER BY rowid"),
    mail: (team) =>
      rows("SELECT value FROM mail WHERE json_extract(value,'$.team')=? ORDER BY rowid", team),
    inbox: (team, node) =>
      rows(
        "SELECT value FROM mail WHERE json_extract(value,'$.team')=? AND json_extract(value,'$.to')=? ORDER BY rowid",
        team,
        node,
      ),
    mailCount: (team) =>
      db.prepare("SELECT count(*) AS n FROM mail WHERE json_extract(value,'$.team')=?").get(team).n,
    save(changed, change) {
      transaction(() => {
        for (const j of changed) put.run(j.id, JSON.stringify(j));
        if (!change) return;
        const { table, id, value, removeMail } = change;
        if (removeMail) {
          const del = db.prepare("DELETE FROM mail WHERE id=?");
          for (const key of removeMail) del.run(key);
        } else {
          if (!["plans", "schedules", "mail"].includes(table)) throw Error("Invalid storage table");
          if (value === undefined) db.prepare("DELETE FROM " + table + " WHERE id=?").run(id);
          else
            db.prepare(
              "INSERT INTO " +
                table +
                "(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
            ).run(id, JSON.stringify(value));
        }
      });
    },
    get state() {
      return {
        jobs: rows("SELECT value FROM jobs ORDER BY rowid DESC"),
        schedules: store.schedules(),
        plans: Object.fromEntries(
          db
            .prepare("SELECT id,value FROM plans")
            .all()
            .map((r) => [r.id, JSON.parse(r.value)]),
        ),
        mail: rows("SELECT value FROM mail ORDER BY rowid"),
      };
    },
    close: () => db.close(),
  };
  return store;
}
