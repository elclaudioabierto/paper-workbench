const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const readline = require("node:readline");
class Codex extends EventEmitter {
  constructor(options = {}) {
    super();
    this.binary = options.binary || "codex";
    this.args = options.args || ["app-server"];
    this.pending = new Map();
    this.sequence = 0;
    this.child = null;
    this.ready = null;
    this.stderr = "";
    this.version = null;
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.connect().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }
  async connect() {
    const child = spawn(this.binary, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stderr = "";
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-8000);
    });
    const fail = (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = null;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
      this.emit("disconnected", error.message);
    };
    child.on("error", (e) =>
      fail(
        new Error(
          `Cannot start Codex (${this.binary}): ${e.message}. Install the Codex CLI and ensure it is on PATH.`,
        ),
      ),
    );
    child.on("exit", (code, signal) =>
      fail(
        new Error(
          `Codex stopped (${signal || code}). ${this.stderr.slice(-1000)}`,
        ),
      ),
    );
    child.stdin.on("error", (e) => fail(e));
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch (e) {
        this.emit("protocolError", e.message);
      }
    });
    const result = await this.request("initialize", {
      clientInfo: {
        name: "paper_workbench",
        title: "Paper Workbench",
        version: require("../package.json").version,
      },
      capabilities: { experimentalApi: false },
    });
    this.version = result.userAgent || null;
    this.notify("initialized", {});
    return result;
  }
  write(message) {
    if (!this.child?.stdin.writable) throw new Error("Codex is disconnected.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  notify(method, params) {
    this.write({ method, params });
  }
  request(method, params = {}, timeout = 60000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  receive(message) {
    if (message.method && message.id !== undefined) {
      // Workbench tasks don't need executable tools, external app access or interactive tool prompts.
      // Deny server-initiated actions instead of leaving Codex waiting indefinitely.
      let result;
      if (
        /requestApproval|execCommandApproval|applyPatchApproval/.test(
          message.method,
        )
      )
        result = { decision: "decline" };
      else if (/requestPermissions/.test(message.method))
        result = { permissions: {}, scope: "turn" };
      else if (/requestUserInput/.test(message.method))
        result = { answers: {} };
      else if (/elicitation/.test(message.method))
        result = { action: "decline", content: null };
      else if (/tool\/call/.test(message.method))
        result = {
          contentItems: [
            {
              type: "inputText",
              text: "This manuscript workbench does not permit this tool.",
            },
          ],
          success: false,
        };
      if (result) this.write({ id: message.id, result });
      else
        this.write({
          id: message.id,
          error: {
            code: -32601,
            message: "Unsupported request in Paper Workbench",
          },
        });
      this.emit("notification", {
        method: "workbench/actionDeclined",
        params: { method: message.method, requestId: message.id },
      });
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(
          new Error(message.error.message || JSON.stringify(message.error)),
        );
      else pending.resolve(message.result);
    } else if (message.method) this.emit("notification", message);
  }
  stop() {
    const child = this.child;
    if (child) child.kill();
  }
}
module.exports = { Codex };
