const { spawn } = require("node:child_process");
const { LIMITS } = require("./resourceLimits");
const activeProcesses = new Set();

function runProcess(executable, args, onOutput, { timeoutMs = LIMITS.conversionTimeoutMs, maxStdoutBytes = Infinity, signal } = {}) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error("処理を中止しました"), { name: "AbortError" }));
  if (activeProcesses.size >= LIMITS.activeProcesses) return Promise.reject(new Error("同時に実行できる処理数の上限に達しました"));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutBytes = 0;
    let failure;
    activeProcesses.add(child);
    const fail = (error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => fail(new Error("処理時間の上限を超えたため停止しました")), timeoutMs);
    const abort = () => fail(Object.assign(new Error("処理を中止しました"), { name: "AbortError" }));
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) return fail(new Error("解析結果のサイズが上限を超えています"));
      if (failure) return;
      try { onOutput?.(chunk.toString()); }
      catch (error) { fail(error); }
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      activeProcesses.delete(child);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      activeProcesses.delete(child);
      if (failure) reject(failure);
      else if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim() || `変換処理が終了コード ${code} で停止しました`));
    });
  });
}

async function terminateActiveProcesses() {
  await Promise.all([...activeProcesses].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.removeListener("close", done);
      try { child.kill("SIGKILL"); } catch { /* Already exited. */ }
      resolve();
    }, 2000);
    function done() { clearTimeout(timer); resolve(); }
    child.once("close", done);
    try { child.kill("SIGTERM"); } catch { done(); }
  })));
}

module.exports = { runProcess, terminateActiveProcesses };
