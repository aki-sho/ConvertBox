// Cleanup must never prevent the portable launcher from releasing its EXE.
function installShutdown({ app, stopProcesses, cleanup, reportError, timeoutMs = 5000 }) {
  let quitting = false;
  let finished = false;
  const report = (error) => {
    try { reportError(error); } catch { /* Logging must not block exit either. */ }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    app.exit(0);
  };

  app.on("before-quit", (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    const deadline = setTimeout(() => {
      report(new Error("終了処理が制限時間を超えたためアプリを終了します"));
      finish();
    }, timeoutMs);
    // Stop writers before removing their output. Each stage may fail independently.
    Promise.resolve()
      .then(stopProcesses)
      .catch(report)
      .then(cleanup)
      .catch(report)
      .finally(() => {
        clearTimeout(deadline);
        finish();
      });
  });

  app.on("window-all-closed", () => app.quit());
  return { isQuitting: () => quitting };
}

module.exports = { installShutdown };
