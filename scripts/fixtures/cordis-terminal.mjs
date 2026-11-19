import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const result = fileURLToPath(new URL("./terminal-plugin-result.json", import.meta.url));
function fail(error) { writeFileSync(result, JSON.stringify({ error: error.stack })); }
export default Object.assign(function (ctx) {
  const terminal = ctx.axiomTerminal;
  try {
    const { id } = terminal.action("create");
    assert.ok(id);
    assert.ok(terminal.list().some((item) => item.id === id));
    const record = terminal.get(id);
    assert.equal(record.id, id);
    assert.ok(record.listeners instanceof Set);
    assert.equal(terminal.get(id), record);
    const pty = record.pty;
    assert.ok(pty);
    let sent = false;
    let dataSeen = false;
    const subscription = pty.onData(() => { dataSeen = true; });
    const exitSubscription = pty.onExit(({ exitCode }) => {
      try {
        assert.equal(typeof exitCode, "number");
        assert.ok(terminal.list().some((item) => item.id === id && typeof item.exit === "number"));
        subscription.dispose();
        exitSubscription.dispose();
        assert.equal(terminal.action("close", { id }).ok, true);
        assert.ok(!terminal.list().some((item) => item.id === id));
        writeFileSync(result, JSON.stringify({ ok: true }));
      } catch (error) { fail(error); }
    });
    const listener = (event) => {
      try {
        if (!sent && /PS [^\r\n]*>/.test(record.buffer)) {
          sent = true;
          pty.resize(100, 30);
          pty.write("Write-Output ('AXIOM_'+'CORDIS_TERMINAL_OK')\r");
        }
        if (event.data && record.buffer.includes("AXIOM_CORDIS_TERMINAL_OK")) {
          assert.ok(dataSeen);
          record.listeners.delete(listener);
          pty.kill();
        }
      } catch (error) { fail(error); }
    };
    record.listeners.add(listener);
    listener({});
  } catch (error) { fail(error); }
}, { inject: ["axiomTerminal"] });
