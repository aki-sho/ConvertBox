const crypto = require("node:crypto");

class ConversionQueue {
  constructor({ execute, dispose = () => {}, onChange = () => {}, maxJobs = 100 }) {
    this.execute = execute;
    this.dispose = dispose;
    this.onChange = onChange;
    this.maxJobs = maxJobs;
    this.jobs = [];
    this.active = null;
    this.closed = false;
    this.pumping = null;
  }

  get busy() { return this.active !== null || this.jobs.some((job) => job.state === "queued"); }

  snapshot() {
    return this.jobs.map(({ id, spec, state, progress, message, result }) => ({
      id, fileName: spec.fileName, category: spec.category, targetFormat: spec.targetFormat,
      options: spec.options, state, progress, message,
      conversionId: result?.conversionId, saved: Boolean(result?.saved), outputPath: result?.outputPath
    }));
  }

  notify() { this.onChange(this.snapshot()); }

  enqueue(specs) {
    if (this.closed) throw new Error("アプリを終了しています");
    if (!specs.length || this.jobs.length + specs.length > this.maxJobs) throw new Error(`キューは${this.maxJobs}件までです。保存済みの項目をクリアしてください`);
    const added = specs.map((spec) => ({ id: crypto.randomUUID(), spec: structuredClone(spec), state: "queued", progress: 0, message: "待機中" }));
    this.jobs.push(...added);
    this.notify();
    this.start();
    return added.map((job) => job.id);
  }

  start() {
    if (this.pumping || this.closed) return;
    // Deferring makes the job IDs available to the caller before progress events.
    this.pumping = Promise.resolve().then(() => this.pump()).finally(() => {
      this.pumping = null;
      if (!this.closed && this.jobs.some((job) => job.state === "queued")) this.start();
    });
  }

  async pump() {
    while (!this.closed) {
      const job = this.jobs.find((item) => item.state === "queued");
      if (!job) break;
      const controller = new AbortController();
      this.active = { job, controller };
      job.state = "running";
      job.message = "解析・変換中";
      this.notify();
      try {
        const result = await this.execute(job.spec, controller.signal, (progress) => {
          if (job.state !== "running") return;
          job.progress = Math.max(0, Math.min(100, Number(progress) || 0));
          this.notify();
        });
        if (controller.signal.aborted && !result?.saved) {
          if (result) await this.dispose(result);
          job.state = "canceled";
          job.message = "中止しました";
        } else if (!result?.ok) {
          job.state = "failed";
          job.message = result?.detail || result?.message || "変換に失敗しました";
        } else {
          job.state = "completed";
          job.progress = 100;
          job.result = result;
          job.message = result.saved ? "保存しました" : "変換が完了しました。保存してください";
        }
      } catch (error) {
        job.state = controller.signal.aborted ? "canceled" : "failed";
        job.message = controller.signal.aborted ? "中止しました" : error.message;
      } finally {
        this.active = null;
        this.notify();
      }
    }
  }

  cancel(id) {
    const jobs = id == null ? this.jobs : this.jobs.filter((job) => job.id === id);
    for (const job of jobs) {
      if (["queued", "preparing"].includes(job.state)) { job.state = "canceled"; job.message = "中止しました"; }
      if (job.state === "running") {
        job.state = "canceling";
        job.message = "中止しています…";
        this.active.controller.abort();
      }
    }
    this.notify();
  }

  async retry(id, changes) {
    if (this.closed) throw new Error("アプリを終了しています");
    const job = this.jobs.find((item) => item.id === id);
    if (!job || !["failed", "canceled", "completed"].includes(job.state)) throw new Error("完了・失敗・中止した項目を選択してください");
    const previousState = job.state;
    job.state = "preparing";
    try { if (job.result) await this.dispose(job.result); }
    catch (error) { job.state = previousState; throw error; }
    if (this.closed || job.state === "canceled") { job.state = "canceled"; return; }
    job.spec = structuredClone({ ...job.spec, ...changes });
    job.result = undefined;
    job.state = "queued";
    job.progress = 0;
    job.message = "再実行を待っています";
    this.notify();
    this.start();
  }

  markSaved(conversionId, outputPath) {
    const job = this.jobs.find((item) => item.result?.conversionId === conversionId);
    if (job) { job.result.saved = true; job.result.outputPath = outputPath; job.message = "保存しました"; this.notify(); }
  }

  clearFinished() {
    this.jobs = this.jobs.filter((job) => ["queued", "running", "canceling", "preparing"].includes(job.state)
      || (job.state === "completed" && !job.result?.saved));
    this.notify();
  }

  async stop() {
    this.closed = true;
    this.cancel();
    await this.pumping;
  }
}

module.exports = { ConversionQueue };
