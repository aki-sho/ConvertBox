const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installShutdown } = require("../src/main/shutdown");

async function check({ stopFails = false, cleanupFails = false, hangs = false, logFails = false } = {}) {
  const calls = [];
  const app = new EventEmitter();
  let exits = 0;
  let complete;
  const exited = new Promise((resolve) => { complete = resolve; });
  app.quit = () => app.emit("before-quit", { preventDefault() {} });
  app.exit = () => { exits++; calls.push("exit"); complete(); };
  const shutdown = installShutdown({
    app, timeoutMs: 30,
    stopProcesses: async () => {
      calls.push("stop");
      if (hangs) await new Promise(() => {});
      if (stopFails) throw new Error("stop failed");
    },
    cleanup: async () => {
      calls.push("cleanup");
      if (cleanupFails) throw new Error("EPERM: file locked");
    },
    reportError: () => { calls.push("error"); if (logFails) throw new Error("log locked"); }
  });
  app.emit("window-all-closed");
  app.quit(); // Repeated close/quit requests must not start another cleanup.
  assert.equal(shutdown.isQuitting(), true);
  await exited;
  assert.equal(exits, 1);
  assert.equal(calls.filter((call) => call === "stop").length, 1);
  if (!hangs) assert.equal(calls.filter((call) => call === "cleanup").length, 1);
  assert.equal(calls.at(-1), "exit");
}

(async () => {
  await check();
  await check({ cleanupFails: true });
  await check({ stopFails: true, cleanupFails: true, logFails: true });
  await check({ hangs: true });
  console.log("Shutdown check passed: normal, locked output, failed cleanup/logging, timeout, repeated quit");
})().catch((error) => { console.error(error); process.exitCode = 1; });
